import re
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Optional, Tuple

from docx import Document
from pypdf import PdfReader


def parse_document(file_path: Path, original_name: str) -> dict:
    suffix = file_path.suffix.lower()
    warnings = []
    working_path = file_path

    if suffix == ".doc":
        converted = convert_doc_to_docx(file_path)
        if converted:
            working_path = converted
            suffix = ".docx"
            warnings.append("已将 .doc 转换为 .docx 后进行格式审核。")
        else:
            text = extract_doc_text(file_path)
            return build_text_document(original_name, ".doc", text, ["未能转换为 .docx，仅执行文本级内容审核；线上轻量镜像默认不安装 LibreOffice。"])

    if suffix == ".docx":
        parsed = parse_docx(working_path, original_name)
        parsed["warnings"].extend(warnings)
        return parsed

    if suffix == ".pdf":
        return parse_pdf(file_path, original_name)

    text = file_path.read_text("utf-8", errors="ignore")
    return build_text_document(original_name, suffix or "unknown", text, ["暂不支持该格式的精细格式审核。"])


def convert_doc_to_docx(file_path: Path) -> Optional[Path]:
    soffice = shutil.which("soffice") or shutil.which("libreoffice") or "/opt/homebrew/bin/soffice"
    if not Path(soffice).exists() and not shutil.which(soffice):
        return None

    out_dir = Path(tempfile.mkdtemp(prefix="sipg-doc-convert-"))
    try:
        subprocess.run(
            [soffice, "--headless", "--convert-to", "docx", "--outdir", str(out_dir), str(file_path)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=45,
        )
    except Exception:
        return None

    converted = out_dir / f"{file_path.stem}.docx"
    return converted if converted.exists() else None


def extract_text_with_textutil(file_path: Path) -> str:
    textutil = shutil.which("textutil")
    if not textutil:
        return ""
    try:
        result = subprocess.run([textutil, "-convert", "txt", "-stdout", str(file_path)], check=True, stdout=subprocess.PIPE, timeout=30)
        return result.stdout.decode("utf-8", errors="ignore")
    except Exception:
        return ""


def extract_doc_text(file_path: Path) -> str:
    antiword = shutil.which("antiword")
    if antiword:
        try:
            result = subprocess.run([antiword, str(file_path)], check=True, stdout=subprocess.PIPE, timeout=30)
            return result.stdout.decode("utf-8", errors="ignore")
        except Exception:
            pass
    return extract_text_with_textutil(file_path)


def parse_docx(file_path: Path, original_name: str) -> dict:
    doc = Document(str(file_path))
    paragraphs = []
    full_text_parts = []
    figure_count = 0
    table_title_count = 0

    for index, paragraph in enumerate(doc.paragraphs):
        text = normalize_text(paragraph.text)
        if not text:
            continue

        kind, level = infer_paragraph_kind(text, paragraph.style.name if paragraph.style else "")
        meta = paragraph_format_meta(paragraph)
        if text.startswith("图") or re.match(r"^图\s*\d+", text):
            figure_count += 1
        if text.startswith("表") or re.match(r"^表\s*\d+", text):
            table_title_count += 1

        paragraphs.append(
            {
                "index": index,
                "text": text,
                "kind": kind,
                "level": level,
                "style": paragraph.style.name if paragraph.style else "",
                "format": meta,
            }
        )
        full_text_parts.append(text)

    headings = [p for p in paragraphs if p["kind"] == "heading"]
    title = infer_title(original_name, paragraphs)
    return {
        "id": str(uuid.uuid4()),
        "filename": original_name,
        "fileType": "docx",
        "title": title,
        "text": "\n".join(full_text_parts),
        "paragraphs": paragraphs,
        "headings": headings,
        "stats": {
            "paragraphCount": len(paragraphs),
            "headingCount": len(headings),
            "figureCount": figure_count,
            "tableTitleCount": table_title_count,
            "hasFormatMetadata": True,
        },
        "warnings": [],
    }


def parse_pdf(file_path: Path, original_name: str) -> dict:
    try:
        reader = PdfReader(str(file_path))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages)
    except Exception:
        text = ""

    return build_text_document(original_name, "pdf", text, ["PDF 仅执行文本级审核；字体、段落、缩进等精细格式建议以 Word 源文件为准。"])


def build_text_document(original_name: str, file_type: str, text: str, warnings: list[str]) -> dict:
    paragraphs = [
        {
            "index": i,
            "text": normalize_text(part),
            "kind": infer_paragraph_kind(normalize_text(part), "")[0],
            "level": infer_paragraph_kind(normalize_text(part), "")[1],
            "style": "",
            "format": {},
        }
        for i, part in enumerate(re.split(r"\n{1,}", text or ""))
        if normalize_text(part)
    ]
    headings = [p for p in paragraphs if p["kind"] == "heading"]
    return {
        "id": str(uuid.uuid4()),
        "filename": original_name,
        "fileType": file_type.replace(".", ""),
        "title": infer_title(original_name, paragraphs),
        "text": "\n".join(p["text"] for p in paragraphs),
        "paragraphs": paragraphs,
        "headings": headings,
        "stats": {
            "paragraphCount": len(paragraphs),
            "headingCount": len(headings),
            "figureCount": sum(1 for p in paragraphs if p["text"].startswith("图")),
            "tableTitleCount": sum(1 for p in paragraphs if p["text"].startswith("表")),
            "hasFormatMetadata": False,
        },
        "warnings": warnings,
    }


def paragraph_format_meta(paragraph) -> dict:
    first_run = next((run for run in paragraph.runs if run.text.strip()), None)
    run_font = first_run.font if first_run else None
    style_font = paragraph.style.font if paragraph.style else None
    fmt = paragraph.paragraph_format

    font_name = get_east_asia_font(first_run) if first_run else None
    font_name = font_name or (run_font.name if run_font and run_font.name else None) or (style_font.name if style_font and style_font.name else None)
    size = (run_font.size.pt if run_font and run_font.size else None) or (style_font.size.pt if style_font and style_font.size else None)
    bold = first_run.bold if first_run and first_run.bold is not None else (style_font.bold if style_font and style_font.bold is not None else None)

    return {
        "font": font_name,
        "sizePt": round(size, 2) if size else None,
        "bold": bold,
        "spaceBeforePt": round(fmt.space_before.pt, 2) if fmt.space_before else None,
        "spaceAfterPt": round(fmt.space_after.pt, 2) if fmt.space_after else None,
        "lineSpacing": round(float(fmt.line_spacing), 2) if isinstance(fmt.line_spacing, float) else None,
        "firstLineIndentPt": round(fmt.first_line_indent.pt, 2) if fmt.first_line_indent else None,
        "leftIndentPt": round(fmt.left_indent.pt, 2) if fmt.left_indent else None,
        "alignment": str(fmt.alignment).split(".")[-1] if fmt.alignment is not None else None,
    }


def get_east_asia_font(run) -> Optional[str]:
    try:
        rpr = run._element.rPr
        if rpr is None or rpr.rFonts is None:
            return None
        return rpr.rFonts.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia")
    except Exception:
        return None


def infer_paragraph_kind(text: str, style_name: str) -> Tuple[str, Optional[int]]:
    if not text:
        return "body", None
    if "目录" == text.strip() or "目 录" == text.strip():
        return "toc_title", None
    if style_name.lower().startswith("heading"):
        level = int(re.findall(r"\d+", style_name)[0]) if re.findall(r"\d+", style_name) else 1
        return "heading", min(level, 4)
    if re.match(r"^(引言|结论|总结|参考文献|附录[A-ZＡ-Ｚ]?)$", text):
        return "heading", 1
    if re.match(r"^\d+\s+[^.。]{1,60}$", text):
        return "heading", 1
    if re.match(r"^\d+\.\d+\.\d+\.\d+\s*", text):
        return "heading", 4
    if re.match(r"^\d+\.\d+\.\d+\s*", text):
        return "heading", 3
    if re.match(r"^\d+\.\d+\s*", text):
        return "heading", 2
    if re.match(r"^[一二三四五六七八九十]+[、．.]\s*", text):
        return "heading", 1
    if len(text) < 42 and not text.endswith(("。", "；", ";")) and re.search(r"(研究|方案|内容|成果|分析|技术|实现|管理|结论)", text):
        return "heading", 1
    return "body", None


def infer_title(original_name: str, paragraphs: list[dict]) -> str:
    for paragraph in paragraphs[:30]:
        text = paragraph["text"]
        if 6 <= len(text) <= 60 and "研究报告" in text:
            return text
        if text.startswith("项目名称"):
            return text.split("：", 1)[-1].strip() or original_name
    return Path(original_name).stem


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("\u200f", "").strip())
