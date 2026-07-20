"""API Blueprint 聚合入口。导入各路由模块以完成路由注册。"""

from routes.api_common import api_bp
from routes import prompt_routes as _prompt_routes
from routes import generation_routes as _generation_routes
from routes import knowledge_routes as _knowledge_routes
from routes import summary_routes as _summary_routes

__all__ = ["api_bp"]
