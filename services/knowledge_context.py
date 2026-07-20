"""把知识库检索结果转换为 AI 参考文本和前端展示记录。"""

import json

from services import memory_store
from utils.logger import setup_logging

log = setup_logging("api")

_REFERENCE_INTRO = (
    "## 参考范例（来自你之前处理过的类似 PRD，请参考其用例结构和覆盖思路，但不要照抄，"
    "结合当前 PRD 灵活调整）\n\n"
)


def _json_list(value) -> list:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            return []
    return value if isinstance(value, list) else []


def build_knowledge_context(prd_text: str, *, log_sample_titles: bool = False) -> dict:
    """检索相似 PRD，返回参考文本、结构化记录和原始匹配数。"""
    log.info("[知识库] 开始检索, PRD预览: %s...", prd_text[:80].replace("\n", " "))
    matched = memory_store.search(prd_text, limit=3)
    log.info("[知识库] 检索完成, 匹配 %d 条记录", len(matched))

    ref_parts = []
    records = []
    for idx, item in enumerate(matched):
        test_cases = _json_list(item.get("test_cases_json") or item.get("test_cases") or [])
        modules = _json_list(item.get("modules") or [])

        samples = []
        for test_case in test_cases[:2]:
            case_id = test_case.get("id", "?")
            title = test_case.get("title", "")
            steps = (test_case.get("steps", "") or "").replace("\n", " → ")
            expected = test_case.get("expected", "") or ""
            parts = [f"【{case_id}】{title}"]
            if steps:
                parts.append(f"步骤: {steps}")
            if expected:
                parts.append(f"预期: {expected}")
            samples.append(" | ".join(parts))

        module_name = ", ".join(modules) if modules else "历史记录"
        if samples:
            ref_parts.append(f"### {module_name}（{len(test_cases)}条用例）\n" + "\n".join(samples))

        if log_sample_titles:
            titles = ", ".join(tc.get("title", "") for tc in test_cases[:3]) if test_cases else "无"
            log.info(
                "[知识库] 记录#%d: id=%s, 模块=%s, 用例数=%d, 样本=%s",
                idx + 1,
                item.get("id"),
                module_name if samples else "N/A",
                len(test_cases),
                titles,
            )
        else:
            log.info(
                "[知识库] 记录#%d: id=%s, 模块=%s, 用例数=%d",
                idx + 1,
                item.get("id"),
                module_name if samples else "N/A",
                len(test_cases),
            )

        records.append({
            "id": item.get("id"),
            "modules": modules,
            "case_count": len(test_cases),
            "samples": [
                {
                    "id": test_case.get("id", ""),
                    "title": test_case.get("title", ""),
                    "steps": test_case.get("steps", ""),
                    "expected": test_case.get("expected", ""),
                }
                for test_case in test_cases[:5]
            ],
        })

    references = _REFERENCE_INTRO + "\n\n".join(ref_parts) + "\n\n" if ref_parts else ""
    if references and log_sample_titles:
        log.info("[知识库] 已注入参考, 共 %d 条记录, 参考文本长度=%d", len(matched), len(references))
        log.info("[知识库] === 注入的参考文本 START ===\n%s\n[知识库] === 注入的参考文本 END ===", references)

    return {
        "references": references,
        "records": records,
        "matched_count": len(matched),
    }
