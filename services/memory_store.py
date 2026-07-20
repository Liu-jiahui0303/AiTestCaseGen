"""本地知识库 —— SQLite 存储历史 PRD + 用例，支持关键词检索"""
import os
import re
import sys
import json
import sqlite3
import threading
from datetime import datetime

# 数据库路径：打包后存 exe 同目录；开发时存项目根目录
if getattr(sys, "frozen", False):
    _EXE_DIR = os.path.dirname(sys.executable)
else:
    _EXE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DB_PATH = os.path.join(_EXE_DIR, "knowledge_base.db")

_lock = threading.Lock()
_initialized = False


def _get_conn() -> sqlite3.Connection:
    global _initialized
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    if not _initialized:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS records ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  prd_summary TEXT,"
            "  modules TEXT,"          # JSON array
            "  keywords TEXT,"          # JSON array
            "  test_cases_json TEXT,"
            "  case_count INTEGER DEFAULT 0,"
            "  created_at TEXT"
            ")"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_created ON records(created_at DESC)"
        )
        conn.commit()
        _initialized = True
    return conn


def _extract_keywords(prd_text: str, modules: list[str]) -> list[str]:
    """从 PRD 中提取关键词：标题行 + ##/###/数字序号后的短语 + 纯文本2-3字词组"""
    keywords = set(m.lower() for m in modules)
    # 提取 markdown 标题
    for m in re.findall(r"#+\s*(.+?)(?:\n|$)", prd_text):
        for w in re.split(r"[，。、\s]+", m.strip()):
            if 2 <= len(w) <= 8 and not re.match(r"^[\d\.\s]+$", w):
                keywords.add(w.lower())
    # 提取数字序号开头的内容行
    for m in re.findall(r"^\d+[\.\、\)]\s*(.+?)(?:$|\n)", prd_text, re.MULTILINE):
        for w in re.split(r"[，。、\s]+", m.strip()):
            if 2 <= len(w) <= 8:
                keywords.add(w.lower())
    # 纯文本兜底：去除数字后按标点分词，提取2-3字词组
    if not keywords:
        cleaned = re.sub(r"[\d\s]+", "", prd_text)
        for seg in re.split(r"[，。、；：！？,\.;:!\?\n]+", cleaned):
            seg = seg.strip()
            for i in range(len(seg) - 1):
                for wlen in (2, 3):
                    if i + wlen <= len(seg):
                        keywords.add(seg[i:i + wlen].lower())
    return list(keywords)[:30]


def _prd_summary(text: str) -> str:
    return text.strip()[:500]


def _normalize_prd(text: str) -> str:
    """用于判断是否为同一份 PRD：忽略大小写和空白差异。"""
    return re.sub(r"\s+", "", text or "").lower()


def _case_key(test_case: dict) -> str:
    """优先按规范化标题识别同一用例，无标题时按完整内容识别。"""
    if not isinstance(test_case, dict):
        return "raw:" + json.dumps(test_case, ensure_ascii=False, sort_keys=True)
    title = re.sub(r"\s+", "", str(test_case.get("title") or "")).lower()
    if title:
        return "title:" + title
    return "case:" + json.dumps(test_case, ensure_ascii=False, sort_keys=True)


def _merge_test_cases(existing: list, incoming: list) -> list:
    merged = list(existing)
    existing_keys = {_case_key(test_case) for test_case in merged}
    for test_case in incoming:
        key = _case_key(test_case)
        if key not in existing_keys:
            merged.append(test_case)
            existing_keys.add(key)
    return merged


def save(prd_text: str, test_cases: list) -> int:
    """保存生成结果；相同 PRD 自动合并并返回已有记录 ID。"""
    summary = _prd_summary(prd_text)
    prd_key = _normalize_prd(summary)

    with _lock:
        conn = _get_conn()
        existing_row = None
        rows = conn.execute(
            "SELECT id, prd_summary, test_cases_json FROM records"
            " ORDER BY case_count DESC, id ASC"
        ).fetchall()
        for row in rows:
            if prd_key and _normalize_prd(row["prd_summary"] or "") == prd_key:
                existing_row = row
                break

        if existing_row:
            try:
                existing_cases = json.loads(existing_row["test_cases_json"] or "[]")
            except (json.JSONDecodeError, TypeError):
                existing_cases = []
            merged_cases = _merge_test_cases(existing_cases, test_cases)
            modules = list({tc.get("module", "未分类") for tc in merged_cases
                            if isinstance(tc, dict)})
            keywords = _extract_keywords(prd_text, modules)
            conn.execute(
                "UPDATE records SET prd_summary=?, modules=?, keywords=?,"
                " test_cases_json=?, case_count=?, created_at=? WHERE id=?",
                (summary, json.dumps(modules, ensure_ascii=False),
                 json.dumps(keywords, ensure_ascii=False),
                 json.dumps(merged_cases, ensure_ascii=False),
                 len(merged_cases), datetime.now().strftime("%Y-%m-%d %H:%M"),
                 existing_row["id"]),
            )
            conn.commit()
            return existing_row["id"]

        modules = list({tc.get("module", "未分类") for tc in test_cases
                        if isinstance(tc, dict)})
        keywords = _extract_keywords(prd_text, modules)
        cur = conn.execute(
            "INSERT INTO records (prd_summary, modules, keywords, test_cases_json, case_count, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (summary, json.dumps(modules, ensure_ascii=False),
             json.dumps(keywords, ensure_ascii=False),
             json.dumps(test_cases, ensure_ascii=False),
             len(test_cases), datetime.now().strftime("%Y-%m-%d %H:%M")),
        )
        conn.commit()
        return cur.lastrowid


def search(prd_text: str, limit: int = 3) -> list[dict]:
    """根据 PRD 检索最相关的历史记录"""
    modules = []
    for m in re.findall(r"##\s*(.+?)(?:\n|$)", prd_text):
        modules.append(m.strip())
    keywords = _extract_keywords(prd_text, modules)
    normalized_prd = _normalize_prd(prd_text)
    if not keywords and not modules:
        return []

    with _lock:
        conn = _get_conn()
        all_rows = conn.execute(
            "SELECT id, modules, keywords, test_cases_json, case_count, created_at"
            " FROM records ORDER BY created_at DESC"
        ).fetchall()

    query_modules = {_normalize_prd(module) for module in modules}
    query_keywords = {_normalize_prd(keyword) for keyword in keywords}

    # 相似度 = 模块名匹配数 + 关键词匹配数
    scored = []
    for r in all_rows:
        rm = set(json.loads(r["modules"])) if r["modules"] else set()
        rk = set(json.loads(r["keywords"])) if r["keywords"] else set()
        matched_modules = {
            module for module in rm
            if _normalize_prd(module)
            and (_normalize_prd(module) in query_modules
                 or _normalize_prd(module) in normalized_prd)
        }
        matched_keywords = {
            keyword for keyword in rk
            if _normalize_prd(keyword)
            and (_normalize_prd(keyword) in query_keywords
                 or _normalize_prd(keyword) in normalized_prd)
        }
        score = len(matched_modules) * 3 + len(matched_keywords)
        if score > 0:
            scored.append((score, dict(r)))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit]]


def get_all(limit: int = 50) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT id, prd_summary, modules, case_count, created_at"
            " FROM records ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["modules"] = json.loads(r["modules"]) if r["modules"] else []
        except (json.JSONDecodeError, TypeError):
            d["modules"] = []
        result.append(d)
    return result


def get_detail(record_id: int) -> dict | None:
    with _lock:
        conn = _get_conn()
        r = conn.execute("SELECT * FROM records WHERE id=?", (record_id,)).fetchone()
    if not r:
        return None
    d = dict(r)
    try:
        d["test_cases"] = json.loads(r["test_cases_json"]) if r["test_cases_json"] else []
    except (json.JSONDecodeError, TypeError):
        d["test_cases"] = []
    return d


def update(record_id: int, prd_text: str, test_cases: list) -> bool:
    """更新一条已有记录，返回是否成功"""
    modules = list({tc.get("module", "未分类") for tc in test_cases})
    keywords = _extract_keywords(prd_text, modules)
    summary = _prd_summary(prd_text)

    with _lock:
        conn = _get_conn()
        conn.execute(
            "UPDATE records SET prd_summary=?, modules=?, keywords=?,"
            " test_cases_json=?, case_count=?, created_at=?"
            " WHERE id=?",
            (summary, json.dumps(modules, ensure_ascii=False),
             json.dumps(keywords, ensure_ascii=False),
             json.dumps(test_cases, ensure_ascii=False),
             len(test_cases), datetime.now().strftime("%Y-%m-%d %H:%M"),
             record_id),
        )
        conn.commit()
        return conn.total_changes > 0


def delete(record_id: int) -> bool:
    with _lock:
        conn = _get_conn()
        conn.execute("DELETE FROM records WHERE id=?", (record_id,))
        conn.commit()
        return True


def clear_all() -> int:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("SELECT COUNT(*) as cnt FROM records").fetchone()
        count = cur["cnt"] if cur else 0
        conn.execute("DELETE FROM records")
        conn.commit()
        return count


def dedup_preview(overlap_threshold: float = 0.5) -> dict:
    """分析所有记录，返回去重组预览（不执行删除）。
    返回: {"groups": [{module, keep_id, keep_count, merge_ids, merge_counts, final_count}, ...], "total_delete": N}
    """
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT id, prd_summary, modules, test_cases_json, case_count"
            " FROM records ORDER BY case_count DESC, id ASC"
        ).fetchall()

    records = []
    for r in rows:
        try:
            mods = json.loads(r["modules"]) if r["modules"] else []
        except Exception:
            mods = []
        try:
            tcs = json.loads(r["test_cases_json"]) if r["test_cases_json"] else []
        except Exception:
            tcs = []
        titles = {
            tc.get("title", "").strip()
            for tc in tcs
            if isinstance(tc, dict) and tc.get("title", "").strip()
        }
        records.append({
            "id": r["id"],
            "prd_key": _normalize_prd(r["prd_summary"] or ""),
            "modules": [m for m in mods if isinstance(m, str)],
            "module_key": ", ".join(sorted(mods)) if mods else "未分类",
            "case_count": r["case_count"],
            "titles": titles,
        })

    # 构建重复关系：相同 PRD 直接归组；不同 PRD 沿用同模块标题重叠规则。
    parents = list(range(len(records)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        left_root, right_root = find(left), find(right)
        if left_root != right_root:
            parents[right_root] = left_root

    for i in range(len(records)):
        for j in range(i + 1, len(records)):
            left, right = records[i], records[j]
            same_prd = bool(left["prd_key"] and left["prd_key"] == right["prd_key"])
            if same_prd:
                union(i, j)
                continue
            if left["module_key"] != right["module_key"]:
                continue
            left_titles, right_titles = left["titles"], right["titles"]
            if not left_titles or not right_titles:
                continue
            matched_left = set()
            matched_right = set()
            for left_title in left_titles:
                for right_title in right_titles:
                    if (left_title == right_title or left_title in right_title
                            or right_title in left_title):
                        matched_left.add(left_title)
                        matched_right.add(right_title)
            overlap = max(len(matched_left), len(matched_right))
            min_size = min(len(left_titles), len(right_titles))
            if min_size > 0 and overlap / min_size >= overlap_threshold:
                union(i, j)

    components: dict[int, list] = {}
    for index, record in enumerate(records):
        components.setdefault(find(index), []).append(record)

    groups = []
    for group in components.values():
        if len(group) < 2:
            continue
        # 保留用例最多的记录；数量相同时保留更早的 ID。
        group.sort(key=lambda item: (-item["case_count"], item["id"]))
        keep = group[0]
        merge_list = group[1:]
        all_titles = set(keep["titles"])
        for item in merge_list:
            all_titles |= item["titles"]
        merge_titles = set()
        for item in merge_list:
            merge_titles |= item["titles"]
        keep_only = sorted({title for title in keep["titles"]
                            if not any(title == other or title in other or other in title
                                       for other in merge_titles)})
        new_only = sorted({title for title in merge_titles
                           if not any(title == other or title in other or other in title
                                      for other in keep["titles"])})
        module_names = sorted({module for item in group for module in item["modules"]})
        groups.append({
            "module": ", ".join(module_names) if module_names else "未分类",
            "keep_id": keep["id"],
            "keep_count": keep["case_count"],
            "keep_titles": sorted(keep["titles"])[:8],
            "merge_items": [{
                "id": item["id"],
                "count": item["case_count"],
                "titles": sorted(item["titles"])[:8],
                "overlap": sorted({
                    title
                    for title in item["titles"]
                    for keep_title in keep["titles"]
                    if title == keep_title or title in keep_title or keep_title in title
                })[:5],
            } for item in merge_list],
            "final_count": len(all_titles),
            "keep_only": keep_only[:5],
            "new_only": new_only[:5],
        })

    total_delete = sum(len(g["merge_items"]) for g in groups)
    return {"groups": groups, "total_delete": total_delete}


def dedup_execute(groups: list[dict]) -> dict:
    """执行去重：合并用例，删除多余记录。groups 格式同 dedup_preview 返回值。
    返回: {"deleted": N, "updated": N}
    """
    deleted = 0
    updated = 0
    with _lock:
        conn = _get_conn()
        for g in groups:
            keep_id = g["keep_id"]
            # 获取保留记录的现有用例
            row = conn.execute(
                "SELECT test_cases_json FROM records WHERE id=?", (keep_id,)
            ).fetchone()
            if not row:
                continue
            try:
                keep_tcs = json.loads(row["test_cases_json"]) if row["test_cases_json"] else []
            except Exception:
                keep_tcs = []
            existing_keys = {_case_key(test_case) for test_case in keep_tcs}

            # 合并待删除记录中的新用例
            for mi in g["merge_items"]:
                mid = mi["id"]
                mrow = conn.execute(
                    "SELECT test_cases_json FROM records WHERE id=?", (mid,)
                ).fetchone()
                if not mrow:
                    continue
                try:
                    mtcs = json.loads(mrow["test_cases_json"]) if mrow["test_cases_json"] else []
                except Exception:
                    mtcs = []
                for tc in mtcs:
                    key = _case_key(tc)
                    if key not in existing_keys:
                        keep_tcs.append(tc)
                        existing_keys.add(key)

            # 更新保留记录
            modules = list({tc.get("module", "未分类") for tc in keep_tcs})
            keywords = _extract_keywords(
                conn.execute("SELECT prd_summary FROM records WHERE id=?", (keep_id,)).fetchone()["prd_summary"] or "",
                modules,
            )
            conn.execute(
                "UPDATE records SET modules=?, keywords=?, test_cases_json=?, case_count=?, created_at=?"
                " WHERE id=?",
                (json.dumps(modules, ensure_ascii=False),
                 json.dumps(keywords, ensure_ascii=False),
                 json.dumps(keep_tcs, ensure_ascii=False),
                 len(keep_tcs), datetime.now().strftime("%Y-%m-%d %H:%M"),
                 keep_id),
            )
            updated += 1

            # 删除多余记录
            for mi in g["merge_items"]:
                mid = mi["id"]
                conn.execute("DELETE FROM records WHERE id=?", (mid,))
                deleted += 1

        conn.commit()
    return {"deleted": deleted, "updated": updated}


def get_stats() -> dict:
    with _lock:
        conn = _get_conn()
        cur = conn.execute("SELECT COUNT(*) as cnt FROM records").fetchone()
        count = cur["cnt"] if cur else 0
    return {"count": count}
