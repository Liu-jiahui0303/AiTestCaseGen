import json
import time
from collections import defaultdict

from flask import Blueprint, request, jsonify, send_file, Response, stream_with_context

from services.ai_client import AIClient
from services.excel_builder import build_excel
from utils.json_parser import extract_json
from utils.logger import setup_logging, write_frontend_log
from prompts.testcase_prompt import BUILTIN_PROMPTS, save_prompts

log = setup_logging("api")
api_bp = Blueprint("api", __name__, url_prefix="/api")

# ── 安全限制 ──
MAX_REQUEST_SIZE = 200 * 1024  # 200KB
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
        if request.content_length and request.content_length > MAX_REQUEST_SIZE:
            return jsonify({"error": f"请求体过大，上限 {MAX_REQUEST_SIZE // 1024}KB"}), 413
    if request.method == "POST":
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
    return jsonify({"prompts": BUILTIN_PROMPTS})


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

    def stream():
        yield _sse({"type": "connected"})
        try:
            client = _get_client(data)
            # 把 PRD 追加到历史消息末尾
            sp = system_prompt or ""
            ut = user_template or "{prd_text}"
            messages = list(history) + [{"role": "user", "content": ut.format(prd_text=prd_text)}]
            log.info("Generate stream: PRD %d chars, history %d msgs, total %d", len(prd_text), len(history), len(messages))
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
