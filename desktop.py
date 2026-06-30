"""桌面版入口 —— 原生窗口，双击即用"""
import sys
import os
import threading
import webview

# 把项目根目录加到 sys.path，确保打包后也能找到模块
_PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from app import create_app

# WebView 数据目录 —— 持久化 localStorage / Cookie
_DATA_DIR = os.path.join(os.environ.get("APPDATA", _PROJECT_ROOT), "AiTestCaseGen")
os.makedirs(_DATA_DIR, exist_ok=True)
_WEBVIEW_DATA = os.path.join(_DATA_DIR, "webview_data")


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
    app.run(debug=False, host="127.0.0.1", port=5000, use_reloader=False)


def main():
    # 后台线程启动 Flask
    t = threading.Thread(target=_start_flask, daemon=True)
    t.start()

    # 原生桌面窗口
    webview.create_window(
        title="AI 测试用例生成器",
        url="http://127.0.0.1:5000",
        width=1440,
        height=900,
        min_size=(960, 600),
        confirm_close=True,
    )
    webview.start(
        gui="edgechromium",
        storage_path=_WEBVIEW_DATA,
        private_mode=False,
    )


if __name__ == "__main__":
    main()