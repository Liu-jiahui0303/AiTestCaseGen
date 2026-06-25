import re


def extract_json(text: str) -> str:
    """从 AI 返回内容中提取 JSON 字符串"""
    text = text.strip()
    # 去掉 markdown 代码块
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if m:
        return m.group(1).strip()
    # 找到 { 开头 } 结尾
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        return text[start:end + 1]
    return text
