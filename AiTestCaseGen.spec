# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 构建配置 —— 打包为独立 exe"""

import sys
from pathlib import Path

_PROJECT_ROOT = Path(SPECPATH)

a = Analysis(
    ["desktop.py"],
    pathex=[str(_PROJECT_ROOT)],
    binaries=[],
    datas=[
        (str(_PROJECT_ROOT / "static"), "static"),
        (str(_PROJECT_ROOT / "templates"), "templates"),
        (str(_PROJECT_ROOT / "prompts" / "testcase_prompt.py"), "prompts"),
        (str(_PROJECT_ROOT / "image"), "image"),
    ],
    hiddenimports=[
        "flask",
        "httpx",
        "openpyxl",
        "webview",
        "routes.api",
        "routes.pages",
        "services.ai_client",
        "services.excel_builder",
        "utils.logger",
        "utils.json_parser",
        "prompts.testcase_prompt",
        "config.settings",
        "services.memory_store",
        "clr_loader",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="AiTestCaseGen",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # 不弹命令行黑窗
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(_PROJECT_ROOT / "image" / "tangtang.ico"),
)