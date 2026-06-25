# 默认 API 配置
DEFAULT_BASE_URL = "https://api.deepseek.com/anthropic"
DEFAULT_MODEL = "deepseek-v4-pro[1M]"
API_TIMEOUT = 180
MAX_TOKENS = 16384

# Excel 表头
EXCEL_HEADERS = ["用例编号", "测试模块", "测试标题", "前置条件", "测试步骤", "预期结果", "用例类型", "优先级"]
EXCEL_COL_WIDTHS = [14, 16, 30, 24, 40, 40, 14, 10]

# Excel 优先级行颜色
PRIORITY_FILLS = {
    "高": ("FCE4EC", "FCE4EC"),
    "中": ("FFF3E0", "FFF3E0"),
    "低": ("E8F5E9", "E8F5E9"),
}
