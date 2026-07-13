import json
import time
from collections import defaultdict

from flask import Blueprint, request, jsonify, send_file, Response, stream_with_context

from services.ai_client import AIClient, qwen_multimodal_stream
from services.excel_builder import build_excel
from services import memory_store
from utils.json_parser import extract_json
from utils.logger import setup_logging, write_frontend_log
from prompts.testcase_prompt import BUILTIN_PROMPTS, save_prompts

log = setup_logging("api")
api_bp = Blueprint("api", __name__, url_prefix="/api")

# ── 安全限制 ──
MAX_REQUEST_SIZE = 200 * 1024  # 200KB（纯文本）
MAX_MULTIMODAL_SIZE = 10 * 1024 * 1024  # 10MB（图文）
_RATE_WINDOW = 60  # 秒
_RATE_MAX_GENERATE = 10  # 生成类接口每窗口最多请求数
_RATE_MAX_OTHER = 60  # 其他接口每窗口最多请求数
_rate_limits = defaultdict(list)  # ip -> [timestamps]


def _check_rate_limit() -> tuple[bool, str]:
    """返回 (通过, 错误消息)。超过限制返回 (False, msg)。"""
    ip = request.remote_addr or "127.0.0.1"
    now = time.time()
    # 清理过期记录
    _rate_limits[ip] = [t for t in _rate_limits[ip] if now - t < _RATE_WINDOW]
    # 生成类接口限制更严
    path = request.path
    is_generate = "/generate" in path or "/chat" in path
    limit = _RATE_MAX_GENERATE if is_generate else _RATE_MAX_OTHER
    if len(_rate_limits[ip]) >= limit:
        return False, f"请求过于频繁，请 {int(_RATE_WINDOW)} 秒后重试"
    _rate_limits[ip].append(now)
    return True, ""


@api_bp.before_request
def _guard():
    """请求体大小检查 + 速率限制"""
    if request.method in ("POST", "PUT", "PATCH"):
        max_size = MAX_MULTIMODAL_SIZE if "/multimodal" in request.path else MAX_REQUEST_SIZE
        if request.content_length and request.content_length > max_size:
            return jsonify({"error": f"请求体过大，上限 {max_size // 1024}KB"}), 413
    if request.method == "POST" and "/knowledge" not in request.path:
        ok, msg = _check_rate_limit()
        if not ok:
            return jsonify({"error": msg}), 429


def _get_client(data: dict) -> AIClient:
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip()
    model = (data.get("model") or "").strip()
    if not api_key:
        raise ValueError("请输入 API Key")
    return AIClient(api_key=api_key, base_url=base_url, model=model)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


# ── 提示词 CRUD ──

@api_bp.route("/prompts", methods=["GET"])
def get_prompts():
    resp = jsonify({"prompts": BUILTIN_PROMPTS})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp


@api_bp.route("/prompts", methods=["POST"])
def post_prompts():
    data = request.get_json(silent=True) or {}
    prompts = data.get("prompts")
    if not isinstance(prompts, list) or len(prompts) == 0:
        return jsonify({"error": "提示词列表不能为空"}), 400
    try:
        save_prompts(prompts)
        log.info("Prompts saved: %d items", len(prompts))
        return jsonify({"ok": True, "count": len(prompts)})
    except Exception as e:
        log.error("Failed to save prompts: %s", e)
        return jsonify({"error": f"保存失败: {str(e)}"}), 500


# ── 前端日志 ──

@api_bp.route("/log", methods=["POST"])
def frontend_log():
    data = request.get_json(silent=True) or {}
    level = data.get("level", "info")
    message = data.get("message", "")
    write_frontend_log(level, message)
    return jsonify({"ok": True})


# ── 流式生成 ──

@api_bp.route("/generate/stream", methods=["POST"])
def generate_stream():
    data = request.get_json(silent=True) or {}
    prd_text = (data.get("prd") or "").strip()
    system_prompt = (data.get("system_prompt") or "").strip()
    user_template = (data.get("user_template") or "").strip()

    if not prd_text:
        return jsonify({"error": "请输入 PRD 内容"}), 400

    history = data.get("messages") or []  # 多轮对话上下文
    use_knowledge = data.get("use_knowledge", True)  # 是否启用知识库引用

    def stream():
        # 检索知识库
        matched_refs = ""
        if use_knowledge:
            log.info("[知识库] 开始检索, PRD预览: %s...", prd_text[:80].replace("\n"," "))
            matched = memory_store.search(prd_text, limit=3)
            log.info("[知识库] 检索完成, 匹配 %d 条记录", len(matched))
            if matched:
                ref_parts = []
                for idx, item in enumerate(matched):
                    try:
                        tcs = item.get("test_cases_json") or item.get("test_cases") or []
                        if isinstance(tcs, str):
                            tcs = json.loads(tcs)
                    except Exception:
                        tcs = []
                    samples = []
                    for tc in tcs[:2]:
                        sid = tc.get('id','?')
                        title = tc.get('title','')
                        steps = (tc.get('steps','') or '').replace('\n',' → ')
                        exp = (tc.get('expected','') or '')
                        parts = [f"【{sid}】{title}"]
                        if steps: parts.append(f"步骤: {steps}")
                        if exp: parts.append(f"预期: {exp}")
                        samples.append(" | ".join(parts))
                    if samples:
                        mods_raw = item.get("modules", [])
                        if isinstance(mods_raw, str):
                            try: mods_raw = json.loads(mods_raw)
                            except Exception: mods_raw = []
                        mods = ", ".join(mods_raw) if mods_raw else "历史记录"
                        ref_parts.append(f"### {mods}（{len(tcs)}条用例）\n" + "\n".join(samples))
                    log.info("[知识库] 记录#%d: id=%s, 模块=%s, 用例数=%d, 样本=%s",
                             idx+1, item.get("id"), mods if samples else "N/A",
                             len(tcs), ", ".join(s.get("title","") for s in tcs[:3]) if tcs else "无")
                if ref_parts:
                    matched_refs = (
                        "## 参考范例（来自你之前处理过的类似 PRD，请参考其用例结构和覆盖思路，但不要照抄，"
                        "结合当前 PRD 灵活调整）\n\n" + "\n\n".join(ref_parts) + "\n\n"
                    )
                    log.info("[知识库] 已注入参考, 共 %d 条记录, 参考文本长度=%d", len(matched), len(matched_refs))
                    log.info("[知识库] === 注入的参考文本 START ===\n%s\n[知识库] === 注入的参考文本 END ===", matched_refs)
                    # 构建结构化记录列表（前端用于表格展示）
                    kb_records = []
                    for item in matched:
                        try:
                            tcs_raw = item.get("test_cases_json") or item.get("test_cases") or "[]"
                            tcs_list = json.loads(tcs_raw) if isinstance(tcs_raw, str) else (tcs_raw or [])
                        except Exception:
                            tcs_list = []
                        try:
                            mods_raw2 = json.loads(item.get("modules","[]")) if isinstance(item.get("modules"), str) else (item.get("modules") or [])
                        except Exception:
                            mods_raw2 = []
                        kb_records.append({
                            "id": item.get("id"),
                            "modules": mods_raw2,
                            "case_count": len(tcs_list),
                            "samples": [{"id": tc.get("id",""), "title": tc.get("title",""),
                                         "steps": tc.get("steps",""), "expected": tc.get("expected","")}
                                        for tc in tcs_list[:5]],
                        })
                    yield _sse({"type": "knowledge", "matched": len(matched), "refs": matched_refs, "records": kb_records})
                else:
                    log.info("[知识库] 匹配到记录但无有效用例样本, 未注入参考")
                    yield _sse({"type": "knowledge", "matched": 0})
            else:
                log.info("[知识库] 无匹配记录, 未注入参考")
                yield _sse({"type": "knowledge", "matched": 0})
        else:
            log.info("[知识库] 用户关闭了知识库引用")

        yield _sse({"type": "connected"})
        try:
            client = _get_client(data)
            sp = system_prompt or ""
            ut = user_template or "{prd_text}"
            user_content = ut.format(prd_text=prd_text)
            # 知识库参考注入到用户消息末尾（不影响 system prompt）
            if matched_refs:
                user_content += "\n\n" + matched_refs
            messages = list(history) + [{"role": "user", "content": user_content}]
            log.info("Generate stream: PRD %d chars, history %d msgs, total %d, system_prompt %d chars, user_msg %d chars%s",
                     len(prd_text), len(history), len(messages), len(sp), len(user_content),
                     " (含知识库参考)" if matched_refs else "")
            log.info("[知识库] === 完整 System Prompt START ===\n%s\n[知识库] === 完整 System Prompt END ===", sp)
            log.info("[知识库] === User Message (含参考) START ===\n%s\n[知识库] === User Message END ===", user_content)
            for event in client.chat_stream(messages, sp):
                yield _sse(event)
            yield _sse({"type": "done"})
            log.info("Generate stream complete")
        except Exception as e:
            log.error("Generate stream error: %s", e)
            yield _sse({"type": "error", "message": str(e)})

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@api_bp.route("/generate/stream/multimodal", methods=["POST"])
def generate_multimodal_stream():
    """多模态流式生成（千问 Qwen3.7-Plus，支持图片 + 文字）"""
    data = request.get_json(silent=True) or {}
    prd_text = (data.get("prd") or "").strip()
    images = data.get("images") or []  # base64 data URI 列表
    system_prompt = (data.get("system_prompt") or "").strip()
    user_template = (data.get("user_template") or "").strip()
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip()
    model = (data.get("model") or "").strip()

    if not prd_text:
        return jsonify({"error": "请输入 PRD 内容"}), 400
    if not api_key:
        return jsonify({"error": "请输入 API Key"}), 400

    history = data.get("messages") or []
    use_knowledge = data.get("use_knowledge", True)

    def stream():
        # 检索知识库
        matched_refs = ""
        if use_knowledge:
            log.info("[知识库] 开始检索, PRD预览: %s...", prd_text[:80].replace("\n", " "))
            matched = memory_store.search(prd_text, limit=3)
            log.info("[知识库] 检索完成, 匹配 %d 条记录", len(matched))
            if matched:
                ref_parts = []
                for idx, item in enumerate(matched):
                    try:
                        tcs = item.get("test_cases_json") or item.get("test_cases") or []
                        if isinstance(tcs, str):
                            tcs = json.loads(tcs)
                    except Exception:
                        tcs = []
                    samples = []
                    for tc in tcs[:2]:
                        sid = tc.get("id", "?")
                        title = tc.get("title", "")
                        steps = (tc.get("steps", "") or "").replace("\n", " → ")
                        exp = (tc.get("expected", "") or "")
                        parts = [f"【{sid}】{title}"]
                        if steps:
                            parts.append(f"步骤: {steps}")
                        if exp:
                            parts.append(f"预期: {exp}")
                        samples.append(" | ".join(parts))
                    if samples:
                        mods_raw = item.get("modules", [])
                        if isinstance(mods_raw, str):
                            try:
                                mods_raw = json.loads(mods_raw)
                            except Exception:
                                mods_raw = []
                        mods = ", ".join(mods_raw) if mods_raw else "历史记录"
                        ref_parts.append(f"### {mods}（{len(tcs)}条用例）\n" + "\n".join(samples))
                    log.info("[知识库] 记录#%d: id=%s, 模块=%s, 用例数=%d",
                             idx + 1, item.get("id"), mods if samples else "N/A", len(tcs))
                if ref_parts:
                    matched_refs = (
                        "## 参考范例（来自你之前处理过的类似 PRD，请参考其用例结构和覆盖思路，但不要照抄，"
                        "结合当前 PRD 灵活调整）\n\n" + "\n\n".join(ref_parts) + "\n\n"
                    )
                    yield _sse({"type": "knowledge", "matched": len(matched),
                                "refs": matched_refs})
                    # 构建结构化记录
                    kb_records = []
                    for item in matched:
                        try:
                            tcs_raw = item.get("test_cases_json") or item.get("test_cases") or "[]"
                            tcs_list = json.loads(tcs_raw) if isinstance(tcs_raw, str) else (tcs_raw or [])
                        except Exception:
                            tcs_list = []
                        try:
                            mods_raw2 = json.loads(item.get("modules", "[]")) if isinstance(item.get("modules"), str) else (item.get("modules") or [])
                        except Exception:
                            mods_raw2 = []
                        kb_records.append({
                            "id": item.get("id"), "modules": mods_raw2,
                            "case_count": len(tcs_list),
                            "samples": [{"id": tc.get("id", ""), "title": tc.get("title", ""),
                                         "steps": tc.get("steps", ""), "expected": tc.get("expected", "")}
                                        for tc in tcs_list[:5]],
                        })
                    yield _sse({"type": "knowledge", "matched": len(matched),
                                "refs": matched_refs, "records": kb_records})
                else:
                    yield _sse({"type": "knowledge", "matched": 0})
            else:
                yield _sse({"type": "knowledge", "matched": 0})

        yield _sse({"type": "connected"})
        try:
            sp = system_prompt or ""
            ut = user_template or "{prd_text}"
            user_text = ut.format(prd_text=prd_text)
            if matched_refs:
                user_text += "\n\n" + matched_refs

            # 构建 OpenAI 多模态 content 数组
            content_parts = [{"type": "text", "text": user_text}]
            for img in images:
                if isinstance(img, str) and img.startswith("data:"):
                    content_parts.append({"type": "image_url", "image_url": {"url": img}})

            log.info("Multimodal stream: PRD %d chars, images %d, system_prompt %d chars, user_msg %d chars",
                     len(prd_text), len(images), len(sp), len(user_text))
            log.info("[知识库] === User Message (含参考) START ===\n%s\n[知识库] === User Message END ===", user_text)

            for event in qwen_multimodal_stream(
                api_key=api_key, base_url=base_url, model=model,
                content_parts=content_parts, system_prompt=sp,
            ):
                yield _sse(event)
            log.info("Multimodal stream complete")
        except Exception as e:
            log.error("Multimodal stream error: %s", e)
            yield _sse({"type": "error", "message": str(e)})

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@api_bp.route("/chat/stream", methods=["POST"])
def chat_stream():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages") or []
    system_prompt = (data.get("system_prompt") or "").strip()

    if not messages:
        return jsonify({"error": "消息列表为空"}), 400

    def stream():
        try:
            client = _get_client(data)
            for event in client.chat_stream(messages, system_prompt):
                yield _sse(event)
        except Exception as e:
            yield _sse({"type": "error", "message": str(e)})

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ── 非流式 ──

@api_bp.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip()
    model = (data.get("model") or "").strip()
    messages = data.get("messages") or []
    system_prompt = (data.get("system_prompt") or "").strip()

    log.info("Chat: %d messages, model=%s", len(messages), model or "default")

    if not api_key:
        return jsonify({"error": "请输入 API Key"}), 400
    if not messages:
        return jsonify({"error": "消息列表为空"}), 400

    try:
        client = AIClient(api_key=api_key, base_url=base_url, model=model)
        result = client.chat_raw(messages, system_prompt)
        return jsonify({
            "content": result["content"],
            "reasoning": result["reasoning"],
            "usage": result["usage"],
        })
    except Exception as e:
        log.error("Chat failed: %s", e)
        return jsonify({"error": f"对话失败: {str(e)}"}), 500


@api_bp.route("/generate", methods=["POST"])
def generate():
    data = request.get_json(silent=True) or {}
    prd_text = (data.get("prd") or "").strip()
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip()
    model = (data.get("model") or "").strip()
    system_prompt = (data.get("system_prompt") or "").strip()
    user_template = (data.get("user_template") or "").strip()

    if not prd_text:
        return jsonify({"error": "请输入 PRD 内容"}), 400
    if not api_key:
        return jsonify({"error": "请输入 API Key"}), 400

    try:
        client = AIClient(api_key=api_key, base_url=base_url, model=model)
        result = client.generate_testcases(prd_text, system_prompt, user_template)
    except Exception as e:
        log.error("Generate failed: %s", e)
        return jsonify({"error": f"AI 请求失败: {str(e)}"}), 500

    try:
        json_str = extract_json(result["content"])
        data = json.loads(json_str)
        test_cases = data.get("test_cases", [])
    except (json.JSONDecodeError, KeyError) as e:
        log.error("JSON parse error, raw: %s", result["content"][:500])
        return jsonify({"error": f"AI 返回格式解析失败，请重试。详情: {str(e)}"}), 500

    return jsonify({
        "test_cases": test_cases,
        "reasoning": result["reasoning"],
        "usage": result["usage"],
    })


@api_bp.route("/export", methods=["POST"])
def export():
    data = request.get_json(silent=True) or {}
    test_cases = data.get("test_cases", [])
    if not test_cases:
        return jsonify({"error": "没有测试用例可导出"}), 400

    try:
        excel = build_excel(test_cases)
        return send_file(
            excel,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            as_attachment=True,
            download_name="测试用例.xlsx",
        )
    except Exception as e:
        log.error("Excel build error: %s", e)
        return jsonify({"error": f"Excel 生成失败: {str(e)}"}), 500


# ── 知识库 ──

@api_bp.route("/knowledge/stats", methods=["GET"])
def knowledge_stats():
    return jsonify(memory_store.get_stats())


@api_bp.route("/knowledge/list", methods=["GET"])
def knowledge_list():
    items = memory_store.get_all()
    return jsonify({"items": items, "total": len(items)})


@api_bp.route("/knowledge/detail/<int:record_id>", methods=["GET"])
def knowledge_detail(record_id: int):
    detail = memory_store.get_detail(record_id)
    if detail is None:
        return jsonify({"error": "记录不存在"}), 404
    return jsonify(detail)


@api_bp.route("/knowledge/save", methods=["POST"])
def knowledge_save():
    data = request.get_json(silent=True) or {}
    prd_text = (data.get("prd") or "").strip()
    test_cases = data.get("test_cases") or []
    log.info("Knowledge save received: prd_len=%d, tc_len=%d, data_keys=%s",
             len(prd_text), len(test_cases), list(data.keys()) if data else 'null')
    if not prd_text or not test_cases:
        return jsonify({"error": "PRD 和用例不能为空"}), 400
    record_id = memory_store.save(prd_text, test_cases)
    log.info("Knowledge saved: record %d (%d cases)", record_id, len(test_cases))
    return jsonify({"ok": True, "id": record_id})


@api_bp.route("/knowledge/<int:record_id>", methods=["PUT"])
def knowledge_update(record_id: int):
    data = request.get_json(silent=True) or {}
    prd_text = (data.get("prd") or "").strip()
    test_cases = data.get("test_cases") or []
    if not prd_text or not test_cases:
        return jsonify({"error": "PRD 和用例不能为空"}), 400
    ok = memory_store.update(record_id, prd_text, test_cases)
    if not ok:
        return jsonify({"error": "记录不存在"}), 404
    log.info("Knowledge updated: record %d (%d cases)", record_id, len(test_cases))
    return jsonify({"ok": True, "id": record_id})


@api_bp.route("/knowledge/<int:record_id>", methods=["DELETE"])
def knowledge_delete(record_id: int):
    memory_store.delete(record_id)
    log.info("Knowledge deleted: record %d", record_id)
    return jsonify({"ok": True})


@api_bp.route("/knowledge/clear", methods=["DELETE"])
def knowledge_clear():
    count = memory_store.clear_all()
    log.info("Knowledge cleared: %d records", count)
    return jsonify({"ok": True, "deleted": count})


@api_bp.route("/knowledge/dedup/preview", methods=["POST"])
def knowledge_dedup_preview():
    result = memory_store.dedup_preview()
    log.info("Dedup preview: %d groups, %d to delete", len(result["groups"]), result["total_delete"])
    return jsonify(result)


@api_bp.route("/knowledge/dedup/execute", methods=["POST"])
def knowledge_dedup_execute():
    data = request.get_json(silent=True) or {}
    groups = data.get("groups") or []
    if not groups:
        return jsonify({"error": "去重组不能为空"}), 400
    result = memory_store.dedup_execute(groups)
    log.info("Dedup execute: deleted %d records, updated %d", result["deleted"], result["updated"])
    return jsonify(result)
