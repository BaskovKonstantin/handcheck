#!/usr/bin/env python3
"""Собрать единый PDF-документ проекта из Markdown-файлов docs/.

    python3 scripts/build-documentation-pdf.py

Источники: docs/DOCUMENTATION.md, TESTING.md, MATCHING.md, VALIDATION.md,
API.md, FSP-INTEGRATION.md, DEPLOYMENT.md, FUNCTIONAL-COVERAGE.md, ARCHITECTURE.md,
DATA-MODEL.md, MCP.md, JURY-DEMO.md, TZ.md.

Результат: docs/Documentation-HandCheck.pdf
"""

import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
OUT_HTML = os.path.join(DOCS, ".documentation.html")
OUT_PDF = os.path.join(DOCS, "Documentation-HandCheck.pdf")

ORDER = [
    "DOCUMENTATION.md",
    "FUNCTIONAL-COVERAGE.md",
    "TZ.md",
    "ARCHITECTURE.md",
    "TESTING.md",
    "MATCHING.md",
    "VALIDATION.md",
    "FSP-INTEGRATION.md",
    "API.md",
    "DATA-MODEL.md",
    "DEPLOYMENT.md",
    "MCP.md",
    "JURY-DEMO.md",
]

CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'Montserrat', 'DejaVu Sans', sans-serif; font-size: 10.5pt; color: #1c1d22; line-height: 1.45; }
h1 { color: #520978; font-size: 22pt; border-bottom: 3px solid #ff0053; padding-bottom: 6px; }
h2 { color: #520978; font-size: 15pt; margin-top: 22pt; }
h3 { color: #8a83d1; font-size: 12pt; }
h1, h2, h3 { font-family: 'Montserrat', 'DejaVu Sans', sans-serif; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 9pt; }
th, td { border: 1px solid #d9d5ea; padding: 4pt 6pt; vertical-align: top; }
th { background: #f3eefb; color: #520978; }
code { background: #f3eefb; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
pre { background: #f6f5fa; border-left: 3px solid #8a83d1; padding: 8pt; font-size: 8.5pt; white-space: pre-wrap; }
blockquote { border-left: 3px solid #ff0053; margin-left: 0; padding-left: 10pt; color: #4a4552; }
.pagebreak { page-break-after: always; }
"""


def main():
    try:
        import markdown
    except ImportError:
        sys.exit("Нужен пакет markdown: pip install markdown")

    parts = [
        "<!DOCTYPE html><html lang='ru'><head><meta charset='utf-8'>",
        "<title>HandCheck — документация проекта</title>",
        f"<style>{CSS}</style></head><body>",
    ]
    used = []
    for name in ORDER:
        path = os.path.join(DOCS, name)
        if not os.path.exists(path):
            continue
        used.append(name)
        text = open(path, encoding="utf8").read()
        html = markdown.markdown(text, extensions=["tables", "fenced_code", "toc", "attr_list"])
        if name != ORDER[0]:
            parts.append("<div class='pagebreak'></div>")
        parts.append(html)

    parts.append("</body></html>")
    open(OUT_HTML, "w", encoding="utf8").write("\n".join(parts))

    res = subprocess.run(
        ["soffice", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", DOCS, OUT_HTML],
        capture_output=True,
        text=True,
        timeout=600,
    )
    produced = os.path.join(DOCS, ".documentation.pdf")
    if not os.path.exists(produced):
        sys.exit(f"LibreOffice не создал PDF: {res.stdout} {res.stderr}")
    os.replace(produced, OUT_PDF)
    os.remove(OUT_HTML)
    print(f"Собрано: {OUT_PDF}")
    print("Разделы: " + ", ".join(used))


if __name__ == "__main__":
    main()