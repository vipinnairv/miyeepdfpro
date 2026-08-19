# VIPINPDFSUITE

An Acrobat-class PDF suite that runs **entirely in your browser**. No file is ever uploaded — PyMuPDF is compiled to WebAssembly and executes locally via Pyodide.

**Live:** https://vipinnairv.github.io/VIPINPDFSUITE/

## Why Python?

Earlier versions used JavaScript PDF libraries, which can only *draw on top of* a PDF — they cannot alter its content stream. That forced real compromises: "redaction" was a black rectangle painted over text that was still selectable underneath, and compression and password-protection had to flatten every page to a JPEG, destroying searchable text and bloating the file.

PyMuPDF works on the actual document, which makes the difference concrete:

| Operation | JavaScript approach | PyMuPDF (current) |
|---|---|---|
| **Redact** | Black box drawn over text; original still recoverable | Glyphs deleted from the content stream — gone from the raw bytes |
| **Protect** | Whole document re-photographed to enable encryption | AES-256 applied to the document; text stays searchable |
| **Compress** | Every page rasterized; text destroyed | Only images recompressed; text stays vector |
| **Edit text** | White box over old text, new text drawn on top | Original glyphs replaced, matching font, size and colour |

## Features

- **Edit Text** — click any text block and genuinely rewrite it; font, size and colour are detected and matched. Plus real PDF annotations (highlight, underline, strikeout, sticky notes, callouts).
- **Pages** — merge, split, reorder by drag-and-drop, rotate and delete.
- **Fill & Sign** — draw, type or upload a signature; place initials, text, dates and check marks; fill and flatten AcroForm fields.
- **Watermark & Stamps** — text watermarks (tiled or centred, rotated, transparent), approval stamps, page numbers, headers/footers, and legal **Bates numbering**.
- **OCR** — recognises scanned pages and writes a real *invisible text layer* back into the PDF, so the output is genuinely searchable and selectable.
- **Compress** — recompresses embedded images and cleans the object tree while leaving text as text.
- **Protect** — AES-256 encryption with per-permission control, and password removal.
- **Redact** — draw an area or find-and-redact every occurrence of a phrase; content is destroyed, not hidden.
- **Export** — Word/HTML, plain text, tables to CSV, embedded images, and page renders to PNG.
- **Compare** — word-level diff between two versions, with the changes highlighted in a downloadable copy.

## First load

The Python engine is about 28 MB (Pyodide core plus the PyMuPDF wheel) and downloads in the background while the page is usable. The browser caches it, so subsequent visits start instantly. In local testing the engine was ready in about 7 seconds on a warm connection.

## Tech

- [PyMuPDF](https://pymupdf.readthedocs.io/) 1.28.2 — all PDF operations (`pdf_engine.py`)
- [Pyodide](https://pyodide.org/) 314.0.5 — CPython 3.14 in WebAssembly
- [Tesseract.js](https://tesseract.projectnaptha.com/) — OCR recognition; PyMuPDF writes the text layer
- [JSZip](https://stuk.github.io/jszip/) — bundles multi-file exports

The PyMuPDF wheel is committed under `vendor/` deliberately: PyPI does not send CORS headers, so the browser must load it same-origin.

## Layout

```
index.html      UI markup
app.js          UI layer + Pyodide bootstrap (no PDF logic)
pdf_engine.py   every PDF operation, running under Pyodide
style.css       design tokens and components
vendor/         PyMuPDF WebAssembly wheel
```
