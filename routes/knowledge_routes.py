from flask import jsonify, request

from routes.api_common import api_bp, log
from services import memory_store

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

