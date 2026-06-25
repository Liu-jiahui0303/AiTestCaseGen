"""AI 测试用例生成器 —— 应用入口"""

from flask import Flask

from utils.logger import setup_logging
from routes.api import api_bp
from routes.pages import pages_bp

# 初始化日志
setup_logging("app")

def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(pages_bp)
    app.register_blueprint(api_bp)
    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, host="127.0.0.1", port=5000)
