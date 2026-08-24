# MiyeePDF

**Built by Vipin Nair**

An Acrobat-class PDF suite that runs **entirely in your browser**. No file is ever uploaded — every operation happens locally on your own device.

**Live:** https://vipinnairv.github.io/miyeepdfpro/

## Features

Fifteen tools, reachable from a dashboard on the home screen.

**Edit**
- **Edit Text** — tap any line or paragraph and type straight on the page; there is no dialog box. The editor uses the document's *own* embedded font at the page's own size and colour, so what you type is what you get, and the replacement is written back into the file in that same font. Paragraphs rewrap to fit. Plus real PDF annotations and a bookmarks/outline editor.
- **Fill & Sign** — draw, type or upload a signature; place initials, text, dates and check marks; fill and flatten form fields.
- **Watermark & Stamps** — watermarks, approval stamps, page numbers, headers/footers and legal **Bates numbering**.
- **Find & Replace** — genuine search-and-replace inside a PDF, each replacement taking the font, size and colour of the text it replaces.

**Organise**
- **Pages** — merge, split, reorder by drag-and-drop, rotate and delete.
- **Auto-Split** — cut a combined bundle wherever a marker appears, so each invoice or statement becomes its own file, named from the matched text.
- **Compare** — word-level diff between two versions, with changes highlighted in a downloadable copy.
- **Compress** — recompress images and clean the file while text stays real, searchable text.

**Protect**
- **Find Sensitive Data** — scan for PAN, GSTIN, Aadhaar, IFSC, card and account numbers, emails, phones and IPs, then permanently redact the ones you choose. Card and Aadhaar numbers are checksum-verified (Luhn and Verhoeff) so ordinary figures are not flagged.
- **Inspect & Sanitize** — reveal what travels with a PDF beyond its pages (author metadata, XMP, embedded files, JavaScript, hidden layers, annotations, links) and strip it before sharing.
- **Redact** — remove content from the file rather than covering it, with a selectable box colour.
- **Password Protect** — AES-256 encryption with per-permission control, and password removal.

**Convert**
- **OCR** — recognise scanned pages and write a real *invisible text layer* back into the PDF, so the output is genuinely searchable.
- **Export** — Word/HTML, plain text, tables to a formatted Excel workbook (or CSV), embedded images, and page renders to PNG or JPEG.


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
