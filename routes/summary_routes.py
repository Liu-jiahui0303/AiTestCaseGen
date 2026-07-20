from flask import jsonify, request

from routes.api_common import api_bp, log
from services.ai_client import summarize_text


@api_bp.route("/summarize", methods=["POST"])
def summarize():
    """从思考过程中提取会话标题"""
    data = request.get_json(silent=True) or {}
    api_key = (data.get("api_key") or "").strip()
    base_url = (data.get("base_url") or "").strip()
    model = (data.get("model") or "").strip()
    thinking = (data.get("thinking") or "").strip()

    if not api_key:
        return jsonify({"error": "请配置 API Key"}), 400
    if not thinking:
        return jsonify({"error": "无思考内容"}), 400

    try:
        title = summarize_text(api_key, base_url, model, thinking)
        return jsonify({"title": title})
    except Exception as e:
        log.error("Summarize error: %s", e)
        return jsonify({"error": str(e)}), 500
