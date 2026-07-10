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


def save(prd_text: str, test_cases: list) -> int:
    """保存一次生成结果，返回记录 ID"""
    modules = list({tc.get("module", "未分类") for tc in test_cases})
    keywords = _extract_keywords(prd_text, modules)
    summary = _prd_summary(prd_text)

    with _lock:
        conn = _get_conn()
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
    if not keywords and not modules:
        return []

    with _lock:
        conn = _get_conn()
        all_rows = conn.execute(
            "SELECT id, modules, keywords, test_cases_json, case_count, created_at"
            " FROM records ORDER BY created_at DESC"
        ).fetchall()

    # 相似度 = 模块名匹配数 + 关键词重叠数
    scored = []
    for r in all_rows:
        rm = set(json.loads(r["modules"])) if r["modules"] else set()
        rk = set(json.loads(r["keywords"])) if r["keywords"] else set()
        qm = set(modules)
        score = len(qm & rm) * 3 + len(set(keywords) & rk)
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
            "SELECT id, modules, test_cases_json, case_count FROM records ORDER BY case_count DESC"
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
        titles = {tc.get("title", "").strip() for tc in tcs if tc.get("title", "").strip()}
        records.append({
            "id": r["id"],
            "modules": [m for m in mods if isinstance(m, str)],
            "module_key": ", ".join(sorted(mods)) if mods else "未分类",
            "case_count": r["case_count"],
            "titles": titles,
        })

    # 按 module_key 分组
    by_module: dict[str, list] = {}
    for rec in records:
        by_module.setdefault(rec["module_key"], []).append(rec)

    groups = []
    for mod_key, recs in by_module.items():
        if len(recs) < 2:
            continue  # 只有1条记录，无需去重
        merged = [False] * len(recs)
        for i in range(len(recs)):
            if merged[i]:
                continue
            group = [recs[i]]
            merged[i] = True
            for j in range(i + 1, len(recs)):
                if merged[j]:
                    continue
                # 计算标题重叠率（包含匹配：A含B 或 B含A 即算重叠）
                ti = recs[i]["titles"]
                tj = recs[j]["titles"]
                if not ti or not tj:
                    continue
                # 统计能匹配上的标题对数
                matched_i = set()
                matched_j = set()
                for a in ti:
                    for b in tj:
                        if a == b or a in b or b in a:
                            matched_i.add(a)
                            matched_j.add(b)
                overlap = max(len(matched_i), len(matched_j))
                min_size = min(len(ti), len(tj))
                if min_size > 0 and overlap / min_size >= overlap_threshold:
                    group.append(recs[j])
                    merged[j] = True
            if len(group) > 1:
                # 保留用例最多的记录
                group.sort(key=lambda x: x["case_count"], reverse=True)
                keep = group[0]
                merge_list = group[1:]
                # 合并新标题数
                all_titles = set(keep["titles"])
                for m in merge_list:
                    all_titles |= m["titles"]
                final_count = len(all_titles)
                # 保留记录中不被合并来源包含的标题（独有用例）
                merge_titles = set()
                for m2 in merge_list:
                    merge_titles |= m2["titles"]
                keep_only = sorted({a for a in keep["titles"]
                                    if not any(a == b or a in b or b in a for b in merge_titles)})
                # 合并来源中不被保留记录包含的标题（新增用例）
                new_only = sorted({b for b in merge_titles
                                   if not any(a == b or a in b or b in a for a in keep["titles"])})
                groups.append({
                    "module": mod_key,
                    "keep_id": keep["id"],
                    "keep_count": keep["case_count"],
                    "keep_titles": sorted(keep["titles"])[:8],
                    "merge_items": [{"id": m["id"], "count": m["case_count"],
                                     "titles": sorted(m["titles"])[:8],
                                     "overlap": sorted(
                                         {a for a in m["titles"] for b in keep["titles"] if a == b or a in b or b in a}
                                     )[:5]}
                                    for m in merge_list],
                    "final_count": final_count,
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
            existing_titles = {tc.get("title", "").strip() for tc in keep_tcs}

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
                    title = (tc.get("title") or "").strip()
                    if title and title not in existing_titles:
                        keep_tcs.append(tc)
                        existing_titles.add(title)

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
