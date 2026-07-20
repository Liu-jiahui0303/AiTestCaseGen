import json
import time
from collections import defaultdict

from flask import Blueprint, jsonify, request

from services.ai_client import AIClient
from utils.logger import setup_logging

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

