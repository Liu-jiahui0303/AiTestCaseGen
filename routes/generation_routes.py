import json

from flask import Response, jsonify, request, send_file, stream_with_context

from routes.api_common import _get_client, _sse, api_bp, log
from services.ai_client import AIClient, qwen_multimodal_stream, summarize_text
from services.excel_builder import build_excel
from services.knowledge_context import build_knowledge_context
from utils.json_parser import extract_json

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
            knowledge = build_knowledge_context(prd_text, log_sample_titles=True)
            matched_refs = knowledge["references"]
            if matched_refs:
                yield _sse({
                    "type": "knowledge",
                    "matched": knowledge["matched_count"],
                    "refs": matched_refs,
                    "records": knowledge["records"],
                })
            elif knowledge["matched_count"]:
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
            thinking_parts = []
            api_key = (data.get("api_key") or "").strip()
            base_url = (data.get("base_url") or "").strip()
            model = (data.get("model") or "").strip()
            for event in client.chat_stream(messages, sp):
                if event.get("type") == "done":
                    yield _sse({"type": "done", "title": ""})
                    full_t = "".join(thinking_parts)
                    if full_t:
                        try:
                            title = summarize_text(api_key, base_url, model, full_t)
                            if title:
                                yield _sse({"type": "session_title", "title": title})
                        except Exception as e:
                            log.warning("Auto title failed: %s", e)
                else:
                    if event.get("thinking"):
                        thinking_parts.append(event["thinking"])
                    yield _sse(event)
            log.info("Generate stream complete")
        except Exception as e:
            log.error("Generate stream error: %s", e)
            yield _sse({"type": "error", "message": str(e)})

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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
            knowledge = build_knowledge_context(prd_text)
            matched_refs = knowledge["references"]
            if matched_refs:
                # 保持现有事件顺序：先通知匹配状态，再发送结构化记录。
                yield _sse({
                    "type": "knowledge",
                    "matched": knowledge["matched_count"],
                    "refs": matched_refs,
                })
                yield _sse({
                    "type": "knowledge",
                    "matched": knowledge["matched_count"],
                    "refs": matched_refs,
                    "records": knowledge["records"],
                })
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

            log.info("Multimodal stream: PRD %d chars, images %d, system_prompt %d chars, user_msg %d chars, history %d msgs",
                     len(prd_text), len(images), len(sp), len(user_text), len(history))
            log.info("[知识库] === User Message (含参考) START ===\n%s\n[知识库] === User Message END ===", user_text)

            thinking_parts = []
            for event in qwen_multimodal_stream(
                api_key=api_key, base_url=base_url, model=model,
                content_parts=content_parts, system_prompt=sp,
                history=history,
            ):
                if event.get("thinking"):
                    thinking_parts.append(event["thinking"])
                yield _sse(event)
            yield _sse({"type":"done","title":""})
            full_t="".join(thinking_parts)
            if full_t:
                try:
                    title=summarize_text(api_key,base_url,model,full_t)
                    if title:yield _sse({"type":"session_title","title":title})
                except Exception as e:log.warning("Auto title failed: %s",e)
            log.info("Multimodal stream complete")
        except Exception as e:
            log.error("Multimodal stream error: %s", e)
            yield _sse({"type": "error", "message": str(e)})

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
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
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── 非流式 ──

@api_bp.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True) or {}
    provider = (data.get("provider") or "").strip().lower()
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
        is_qwen = provider == "qwen" or model.lower().startswith("qwen") or "dashscope" in base_url.lower()
        if is_qwen:
            last_message = messages[-1]
            if last_message.get("role") != "user" or not last_message.get("content"):
                return jsonify({"error": "最后一条消息必须是用户消息"}), 400
            content_parts = [{"type": "text", "text": str(last_message["content"])}]
            text_parts, thinking_parts = [], []
            for event in qwen_multimodal_stream(
                api_key=api_key,
                base_url=base_url,
                model=model,
                content_parts=content_parts,
                system_prompt=system_prompt,
                history=messages[:-1],
            ):
                if event.get("type") == "error":
                    raise RuntimeError(event.get("message") or "Qwen 对话失败")
                if event.get("text"):
                    text_parts.append(event["text"])
                if event.get("thinking"):
                    thinking_parts.append(event["thinking"])
            result = {
                "content": "".join(text_parts),
                "reasoning": "".join(thinking_parts),
                "usage": {},
            }
        else:
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
