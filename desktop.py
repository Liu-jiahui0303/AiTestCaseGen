"""桌面版入口 —— 原生窗口，双击即用"""
import sys
import os
import json
import threading
import httpx
import webview

# 把项目根目录加到 sys.path，确保打包后也能找到模块
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from app import create_app
from services.excel_builder import build_excel

# WebView 数据目录 —— 持久化 localStorage / Cookie
# 打包后存 exe 同目录；开发时存项目根目录
if getattr(sys, "frozen", False):
    _EXE_DIR = os.path.dirname(sys.executable)
else:
    _EXE_DIR = _PROJECT_ROOT
_WEBVIEW_DATA = os.path.join(_EXE_DIR, "webview_data")

_FLASK_PORT = 5000


class _JsApi:
    """暴露给前端 JS 的原生能力"""

    def save_excel(self, test_cases_json) -> str:
        """弹出原生保存对话框，导出 Excel"""
        # pywebview 可能已反序列化 JSON 为 list，兼容两种入参
        if isinstance(test_cases_json, str):
            test_cases = json.loads(test_cases_json)
        else:
            test_cases = test_cases_json

        # 弹出原生保存对话框
        result = webview.windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            directory="",
            save_filename="测试用例.xlsx",
            file_types=("Excel 文件 (*.xlsx)",),
        )
        if not result:
            return "cancel"
        save_path = result[0] if isinstance(result, (list, tuple)) else result

        # 直接用 excel_builder 生成并写入文件
        try:
            excel_io = build_excel(test_cases)
            with open(save_path, "wb") as f:
                f.write(excel_io.getvalue())
            return "ok"
        except Exception as e:
            return f"error: {e}"


def _resolve_static_folder():
    """打包到 exe 后 static/templates 路径会变，这里做兼容。"""
    # PyInstaller 会把数据文件放到 sys._MEIPASS
    base = getattr(sys, "_MEIPASS", _PROJECT_ROOT)
    return os.path.join(base, "static"), os.path.join(base, "templates")


def _start_flask():
    app = create_app()
    # 覆盖静态文件路径以兼容打包
    sf, tf = _resolve_static_folder()
    app.static_folder = sf
    app.template_folder = tf
    app.run(debug=False, host="127.0.0.1", port=_FLASK_PORT, use_reloader=False)


def main():
    # 后台线程启动 Flask
    t = threading.Thread(target=_start_flask, daemon=True)
    t.start()

    # 原生桌面窗口
    window = webview.create_window(
        title="AI 测试用例生成器",
        url=f"http://127.0.0.1:{_FLASK_PORT}",
        js_api=_JsApi(),
        width=1440,
        height=900,
        min_size=(960, 600),
        confirm_close=True,
    )
    webview.start(
        gui="edgechromium",
        storage_path=_WEBVIEW_DATA,
        private_mode=False,
        debug=False,
    )


if __name__ == "__main__":
    main()