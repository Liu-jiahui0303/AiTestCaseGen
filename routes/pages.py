import os
import sys
from flask import Blueprint, render_template, send_from_directory

pages_bp = Blueprint("pages", __name__)

# 打包后 image/ 目录在 sys._MEIPASS 下
_BASE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(__file__)))
_IMAGE_DIR = os.path.join(_BASE, "image")


@pages_bp.route("/")
def index():
    return render_template("index.html")


@pages_bp.route("/favicon.ico")
def favicon():
    return send_from_directory(_IMAGE_DIR, "tangtang.ico")
