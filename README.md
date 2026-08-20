# MiyeePDF

**Built by Vipin Nair**

An Acrobat-class PDF suite that runs **entirely in your browser**. No file is ever uploaded — every operation happens locally on your own device.

**Live:** https://vipinnairv.github.io/Miyeepdfpro/

## Features

- **Edit Text** — click any text block and genuinely rewrite it; font, size and colour are detected and matched. Plus real PDF annotations (highlight, underline, strikeout, sticky notes, callouts).
- **Pages** — merge, split, reorder by drag-and-drop, rotate and delete.
- **Fill & Sign** — draw, type or upload a signature; place initials, text, dates and check marks; fill and flatten form fields.
- **Watermark & Stamps** — text watermarks (tiled or centred, rotated, transparent), approval stamps, page numbers, headers/footers, and legal **Bates numbering**.
- **OCR** — recognises scanned pages and writes a real *invisible text layer* back into the PDF, so the output is genuinely searchable and selectable.
- **Compress** — recompresses embedded images and cleans the file while leaving text as text.
- **Protect** — AES-256 encryption with per-permission control, and password removal.
- **Redact** — draw an area or find-and-redact every occurrence of a phrase; content is destroyed, not hidden. The box colour is selectable.
- **Export** — Word/HTML, plain text, tables to CSV, embedded images, and page renders to PNG.
- **Compare** — word-level diff between two versions, with the changes highlighted in a downloadable copy.

## Real redaction, real encryption

Most browser PDF tools can only *draw on top of* a document. That leads to redaction that is a black rectangle over text you can still select underneath, and password-protection that flattens every page to a JPEG — destroying searchable text and bloating the file.

MiyeePDF edits the actual document instead:

| Operation | Typical browser tool | MiyeePDF |
|---|---|---|
| **Redact** | Black box drawn over text; original still recoverable | Content deleted from the file — gone from the raw bytes |
| **Protect** | Whole document re-photographed to enable encryption | AES-256 applied to the document; text stays searchable |
| **Compress** | Every page rasterized; text destroyed | Only images recompressed; text stays vector |
| **Edit text** | White box over old text, new text drawn on top | Original text replaced, matching font, size and colour |

## First load

The engine downloads once (about 28 MB) in the background while the page is usable, then the browser caches it, so later visits start quickly.

## Development

```
index.html      UI markup
app.js          UI layer + engine bootstrap (no PDF logic)
pdf_engine.py   every PDF operation
style.css       design tokens and components
vendor/         PyMuPDF WebAssembly wheel
```

Built on [PyMuPDF](https://pymupdf.readthedocs.io/) 1.28.2 compiled to WebAssembly, running under [Pyodide](https://pyodide.org/) 314.0.5, with [Tesseract.js](https://tesseract.projectnaptha.com/) for OCR recognition and [JSZip](https://stuk.github.io/jszip/) for multi-file exports.

The PyMuPDF wheel is committed under `vendor/` deliberately: PyPI does not send CORS headers, so the browser must load it same-origin.

**Cache busting:** `app.js` and `style.css` are loaded with a `?v=` query. When changing either, bump `APP_VERSION` in `app.js` and the matching query strings in `index.html` — otherwise browsers can serve a stale mix of old and new assets.
