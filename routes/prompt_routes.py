from flask import jsonify, request

from prompts import testcase_prompt
from utils.logger import write_frontend_log
from routes.api_common import api_bp, log

# ── 提示词 CRUD ──

@api_bp.route("/prompts", methods=["GET"])
def get_prompts():
    resp = jsonify({"prompts": testcase_prompt.BUILTIN_PROMPTS})
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp


@api_bp.route("/prompts", methods=["POST"])
def post_prompts():
    data = request.get_json(silent=True) or {}
    prompts = data.get("prompts")
    if not isinstance(prompts, list) or len(prompts) == 0:
        return jsonify({"error": "提示词列表不能为空"}), 400
    try:
        testcase_prompt.save_prompts(prompts)
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
