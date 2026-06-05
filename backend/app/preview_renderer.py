from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

from pypdf import PdfReader


def build_rendered_preview(source_path: Path, document: dict, output_dir: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    file_type = document.get("fileType")
    if file_type == "pdf":
        page_count, page_texts = read_pdf_pages(source_path)
        if page_count:
            document["stats"]["pageCount"] = page_count
            document["pages"] = build_pages_from_existing_pdf(document, page_count)
        return {
            "available": True,
            "kind": "pdf",
            "path": str(source_path),
            "pageCount": page_count or document.get("stats", {}).get("pageCount", 1),
            "source": "original",
            "message": "PDF原文预览",
        }

    if file_type not in {"doc", "docx"}:
        return unavailable_preview("该格式暂不支持版式渲染预览。")

    pdf_path, error = convert_office_to_pdf(source_path, output_dir)
    if not pdf_path:
        return unavailable_preview(error or "未能生成Word版式预览。")

    page_count, page_texts = read_pdf_pages(pdf_path)
    if page_count:
        remap_paragraphs_to_rendered_pages(document, page_texts)
        document["stats"]["pageCount"] = page_count
        document["stats"]["renderedPageCount"] = page_count
    return {
        "available": True,
        "kind": "pdf",
        "path": str(pdf_path),
        "pageCount": page_count or document.get("stats", {}).get("pageCount", 1),
        "source": "libreoffice",
        "message": "Word已转换为PDF版式预览",
    }


def convert_office_to_pdf(source_path: Path, output_dir: Path) -> tuple[Path | None, str]:
    soffice = find_soffice()
    if not soffice:
        return None, "未检测到LibreOffice，无法生成Word版式预览。"

    profile_dir = Path(tempfile.mkdtemp(prefix="sipg-office-profile-"))
    try:
        subprocess.run(
            [
                soffice,
                f"-env:UserInstallation=file://{quote(str(profile_dir))}",
                "--headless",
                "--nologo",
                "--nofirststartwizard",
                "--convert-to",
                "pdf",
                "--outdir",
                str(output_dir),
                str(source_path),
            ],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=90,
        )
    except subprocess.TimeoutExpired:
        return None, "Word版式预览生成超时。"
    except Exception as error:
        return None, f"Word版式预览生成失败：{str(error)[:120]}"
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)

    pdf_path = output_dir / f"{source_path.stem}.pdf"
    if pdf_path.exists():
        return pdf_path, ""

    candidates = list(output_dir.glob("*.pdf"))
    return (candidates[0], "") if candidates else (None, "LibreOffice未输出PDF预览文件。")


def find_soffice() -> str:
    candidates = [
        shutil.which("soffice"),
        shutil.which("libreoffice"),
        "/opt/homebrew/bin/soffice",
        "/usr/bin/libreoffice",
        "/usr/bin/soffice",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return ""


def read_pdf_pages(pdf_path: Path) -> tuple[int, list[str]]:
    try:
        reader = PdfReader(str(pdf_path))
        page_texts = [page.extract_text() or "" for page in reader.pages]
        return len(reader.pages), page_texts
    except Exception:
        return 0, []


def remap_paragraphs_to_rendered_pages(document: dict, page_texts: list[str]) -> None:
    if not page_texts:
        return
    clean_pages = [compact_text(text) for text in page_texts]
    current_page = 1
    for paragraph in document.get("paragraphs", []):
        needle = compact_text(paragraph.get("text", ""))
        matched = find_page_for_text(needle, clean_pages, current_page)
        if matched:
            current_page = matched
        paragraph["pageNo"] = current_page

    pages = []
    for index in range(len(page_texts)):
        page_no = index + 1
        page_paragraphs = [paragraph for paragraph in document.get("paragraphs", []) if paragraph.get("pageNo") == page_no]
        pages.append(
            {
                "pageNo": page_no,
                "paragraphIndexes": [paragraph["index"] for paragraph in page_paragraphs],
                "text": "\n".join(paragraph["text"] for paragraph in page_paragraphs),
            }
        )
    document["pages"] = pages or document.get("pages", [])


def find_page_for_text(needle: str, clean_pages: list[str], start_page: int) -> int | None:
    if len(needle) < 4:
        return None
    probes = build_text_probes(needle)
    search_order = list(range(max(start_page - 1, 0), len(clean_pages))) + list(range(0, max(start_page - 1, 0)))
    for index in search_order:
        page_text = clean_pages[index]
        if any(probe and probe in page_text for probe in probes):
            return index + 1
    return None


def build_text_probes(text: str) -> list[str]:
    if len(text) <= 18:
        return [text]
    return [text[:48], text[:32], text[-32:]]


def compact_text(text: str) -> str:
    return re.sub(r"\s+", "", text or "")


def build_pages_from_existing_pdf(document: dict, page_count: int) -> list[dict]:
    pages = []
    for page_no in range(1, page_count + 1):
        page_paragraphs = [paragraph for paragraph in document.get("paragraphs", []) if paragraph.get("pageNo") == page_no]
        pages.append(
            {
                "pageNo": page_no,
                "paragraphIndexes": [paragraph["index"] for paragraph in page_paragraphs],
                "text": "\n".join(paragraph["text"] for paragraph in page_paragraphs),
            }
        )
    return pages


def unavailable_preview(message: str) -> dict:
    return {
        "available": False,
        "kind": "text",
        "pageCount": 0,
        "source": "fallback",
        "message": message,
    }
