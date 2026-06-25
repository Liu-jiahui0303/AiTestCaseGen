import io
import logging
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
from openpyxl.utils import get_column_letter

from config.settings import EXCEL_HEADERS, EXCEL_COL_WIDTHS, PRIORITY_FILLS

logger = logging.getLogger(__name__)


def build_excel(test_cases: list) -> io.BytesIO:
    """根据测试用例列表生成 Excel 文件，返回 BytesIO"""
    wb = Workbook()
    ws = wb.active
    ws.title = "测试用例"

    # 样式
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    header_font = Font(name="微软雅黑", bold=True, size=11, color="FFFFFF")
    body_font = Font(name="微软雅黑", size=10)
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )
    center_align = Alignment(horizontal="center", vertical="center")
    wrap_align = Alignment(vertical="center", wrap_text=True)

    # 表头
    for col, title in enumerate(EXCEL_HEADERS, 1):
        cell = ws.cell(row=1, column=col, value=title)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = center_align
        cell.border = thin_border

    # 数据行
    field_keys = ["id", "module", "title", "precondition", "steps", "expected", "type", "priority"]
    for row_idx, tc in enumerate(test_cases, 2):
        values = [tc.get(k, "") for k in field_keys]
        fill_color = PRIORITY_FILLS.get(tc.get("priority", ""))
        row_fill = PatternFill(start_color=fill_color[0], end_color=fill_color[1], fill_type="solid") if fill_color else None

        for col_idx, value in enumerate(values, 1):
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.font = body_font
            cell.border = thin_border
            cell.alignment = center_align if col_idx in (1, 7, 8) else wrap_align
            if row_fill:
                cell.fill = row_fill

    # 列宽
    for i, w in enumerate(EXCEL_COL_WIDTHS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w

    # 冻结首行 + 自动筛选
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(EXCEL_HEADERS))}{len(test_cases) + 1}"

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    logger.info("Excel generated: %d test cases", len(test_cases))
    return output
