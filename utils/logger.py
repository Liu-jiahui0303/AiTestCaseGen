"""统一日志模块：同时输出到控制台和 logs/ 目录"""

import logging
import os
import sys
from datetime import datetime

if getattr(sys, "frozen", False):
    _ROOT = os.path.dirname(sys.executable)
else:
    _ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LOG_DIR = os.path.join(_ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)


def setup_logging(name: str = "app") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    # 文件 handler —— 按日期切割
    today = datetime.now().strftime("%Y-%m-%d")
    fh = logging.FileHandler(os.path.join(LOG_DIR, f"{today}.log"), encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    ))

    # 控制台 handler
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("[%(name)s] %(message)s"))

    logger.addHandler(fh)
    logger.addHandler(ch)
    return logger


# ── 前端日志写入 ──

def write_frontend_log(level: str, message: str) -> None:
    """前端通过 API 上报的日志"""
    logger = logging.getLogger("frontend")
    if not logger.handlers:
        logger.setLevel(logging.DEBUG)
        today = datetime.now().strftime("%Y-%m-%d")
        fh = logging.FileHandler(os.path.join(LOG_DIR, f"frontend-{today}.log"), encoding="utf-8")
        fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S"))
        logger.addHandler(fh)
    getattr(logger, level, logger.info)(message)
