import os
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

RUNTIME_DIR = ROOT_DIR / "backend" / "runtime"
UPLOAD_DIR = RUNTIME_DIR / "uploads"
OUTPUT_DIR = RUNTIME_DIR / "outputs"
PREVIEW_DIR = RUNTIME_DIR / "previews"
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"

DASHSCOPE_BASE_URL = os.getenv("DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
DASHSCOPE_API_KEY = os.getenv("DASHSCOPE_API_KEY", "")
DASHSCOPE_MODEL = os.getenv("DASHSCOPE_MODEL", "qwen3.6-flash")
DASHSCOPE_REWRITE_MODEL = os.getenv("DASHSCOPE_REWRITE_MODEL", "qwen3.7-max")
DASHSCOPE_BENEFIT_MODEL = os.getenv("DASHSCOPE_BENEFIT_MODEL", "qwen3.6-plus")


def ensure_runtime_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
