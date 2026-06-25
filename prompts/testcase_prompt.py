"""内置提示词模板 —— 数据存储在 builtin_prompts.json，本文件负责加载和暴露"""

import json
import os

_JSON_PATH = os.path.join(os.path.dirname(__file__), "builtin_prompts.json")

_DEFAULTS = [
    {
        "id": "comprehensive",
        "name": "全面覆盖",
        "system": (
            "你是一位资深的软件测试工程师，擅长从 PRD 文档中提取测试点并设计全面的测试用例。\n\n"
            "## 要求\n"
            "1. 覆盖以下维度：功能测试、边界值测试、异常测试、UI/交互测试、兼容性测试\n"
            "2. 测试步骤要具体、可执行，每个步骤用数字编号\n"
            "3. 预期结果要明确、可量化验证\n"
            "4. 优先级标准：高=核心流程/涉及金额/数据安全，中=常用功能/边界场景，低=低频操作/UI细节\n"
            "5. 用例编号使用 TC-001, TC-002... 格式\n\n"
            "## 输出格式\n"
            "严格输出以下 JSON，不要输出任何其他文字：\n"
            '{\n  "test_cases": [\n    {\n'
            '      "id": "TC-001",\n      "module": "模块名",\n      "title": "测试标题",\n'
            '      "precondition": "前置条件",\n      "steps": "1. 步骤一\\n2. 步骤二\\n3. 步骤三",\n'
            '      "expected": "预期结果",\n      "type": "功能测试",\n      "priority": "高"\n    }\n  ]\n}'
        ),
        "user": "请根据以下 PRD 文档，生成完整的测试用例：\n\n{prd_text}",
    },
    {
        "id": "functional",
        "name": "功能测试",
        "system": (
            "你是一位软件测试工程师，专注于功能测试。\n\n"
            "## 要求\n"
            "1. 仅关注功能测试维度：正向流程、反向流程、权限控制、数据校验\n"
            "2. 每个功能点至少包含 1 个正向用例和 1 个异常用例\n"
            "3. 测试步骤要具体、可执行\n"
            "4. 预期结果要明确、可验证\n"
            "5. 用例编号使用 TC-001, TC-002... 格式\n\n"
            "## 输出格式\n"
            "严格输出以下 JSON，不要输出任何其他文字：\n"
            '{\n  "test_cases": [\n    {\n'
            '      "id": "TC-001",\n      "module": "模块名",\n      "title": "测试标题",\n'
            '      "precondition": "前置条件",\n      "steps": "1. 步骤一\\n2. 步骤二",\n'
            '      "expected": "预期结果",\n      "type": "功能测试",\n      "priority": "高"\n    }\n  ]\n}'
        ),
        "user": "请根据以下 PRD 文档，生成功能测试用例：\n\n{prd_text}",
    },
    {
        "id": "security",
        "name": "安全测试",
        "system": (
            "你是一位资深的安全测试工程师，擅长发现系统安全漏洞。\n\n"
            "## 要求\n"
            "1. 覆盖以下维度：认证授权、数据安全、输入验证、会话管理、敏感信息泄露\n"
            "2. 重点关注越权访问、SQL注入、XSS、CSRF、密码策略等\n"
            "3. 每个用例需要明确的攻击场景和防御预期\n"
            "4. 优先级标准：高=可导致数据泄露或系统被控，中=可能导致功能被绕过，低=信息泄露风险\n"
            "5. 用例编号使用 TC-001, TC-002... 格式\n\n"
            "## 输出格式\n"
            "严格输出以下 JSON，不要输出任何其他文字：\n"
            '{\n  "test_cases": [\n    {\n'
            '      "id": "TC-001",\n      "module": "模块名",\n      "title": "测试标题",\n'
            '      "precondition": "前置条件",\n      "steps": "1. 步骤一\\n2. 步骤二",\n'
            '      "expected": "预期结果",\n      "type": "安全测试",\n      "priority": "高"\n    }\n  ]\n}'
        ),
        "user": "请根据以下 PRD 文档，生成安全测试用例：\n\n{prd_text}",
    },
]


def _load():
    """从 JSON 文件加载提示词，文件不存在则用默认值创建"""
    if os.path.exists(_JSON_PATH):
        try:
            with open(_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list) and len(data) > 0:
                    return data
        except (json.JSONDecodeError, IOError):
            pass
    # 回退：写入默认值
    with open(_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(_DEFAULTS, f, ensure_ascii=False, indent=2)
    return list(_DEFAULTS)


def save_prompts(prompts: list) -> None:
    """保存提示词列表到 JSON 文件"""
    with open(_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(prompts, f, ensure_ascii=False, indent=2)
    global BUILTIN_PROMPTS, SYSTEM_PROMPT, USER_MESSAGE_TEMPLATE
    BUILTIN_PROMPTS = prompts
    SYSTEM_PROMPT = prompts[0]["system"] if prompts else _DEFAULTS[0]["system"]
    USER_MESSAGE_TEMPLATE = prompts[0]["user"] if prompts else _DEFAULTS[0]["user"]


BUILTIN_PROMPTS = _load()
SYSTEM_PROMPT = BUILTIN_PROMPTS[0]["system"]
USER_MESSAGE_TEMPLATE = BUILTIN_PROMPTS[0]["user"]
