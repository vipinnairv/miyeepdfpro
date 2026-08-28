# MiyeePDF

**Built by Vipin Nair**

An Acrobat-class PDF suite that runs **entirely in your browser**. No file is ever uploaded - every operation happens locally on your own device.

**Live:** https://vipinnairv.github.io/miyeepdfpro/

## Features

Fifteen tools, reachable from a dashboard on the home screen.

**Edit**
- **Edit Text** - tap any line or paragraph and type straight on the page; there is no dialog box. **Undo and redo** (Ctrl+Z / Ctrl+Shift+Z) cover every change, so a mistake no longer means reloading and losing your work. Clear a box to **delete** that text, switch to **Add text** to place new text anywhere, and **zoom** in for precise work on small type. **Scanned PDFs are editable too**: the page is read on the spot, and because the words you see there are pixels rather than text, an edit paints over the scan in its own paper colour (sampled from the page, so white, cream and grey scans all blend) before writing the new wording in. The editor uses the document's *own* embedded font at the page's own size and colour, so what you type is what you get, and the replacement is written back into the file in that same font. Paragraphs rewrap to fit. Plus real PDF annotations and a bookmarks/outline editor.
- **Fill & Sign** - draw, type or upload a signature; place initials, text, dates and check marks; fill and flatten form fields.
- **Watermark & Stamps** - watermarks, approval stamps, page numbers, headers/footers and legal **Bates numbering**. Takes several files at once, with Bates numbering running as one sequence across the whole bundle.
- **Find & Replace** - genuine search-and-replace inside a PDF, each replacement taking the font, size and colour of the text it replaces.

**Organise**
- **Pages** - merge, split, reorder by drag-and-drop, rotate and delete.
- **Auto-Split** - cut a combined bundle wherever a marker appears, so each invoice or statement becomes its own file, named from the matched text.
- **Compare** - word-level diff between two versions, with changes highlighted in a downloadable copy.
- **Compress** - recompress images and clean the file while text stays real, searchable text. Takes several files at once.

**Protect**
- **Find Sensitive Data** - scan for PAN, GSTIN, Aadhaar, IFSC, card and account numbers, emails, phones and IPs, then permanently redact them. Card and Aadhaar numbers are checksum-verified (Luhn and Verhoeff) so ordinary figures are not flagged. **Everything found is marked on the page itself**, so you see exactly what is about to be deleted and can click a mark, a row or a whole category to change your mind - redaction is irreversible, and it should not be a leap of faith. Results are grouped by kind. Removal is either a **black box** or **masking**, which deletes the original characters and writes something like `XXXXXXXXXXXX4291` back in, so a statement still reconciles. Point it at a folder of files and it scans and redacts every one.
- **Inspect & Sanitize** - reveal what travels with a PDF beyond its pages (author metadata, XMP, embedded files, JavaScript, hidden layers, annotations, links) and strip it before sharing.
- **Redact** - remove content from the file rather than covering it, with a selectable box colour.
- **Password Protect** - AES-256 encryption with per-permission control, and password removal. Password-protected files can be opened by every tool: you are asked to unlock once, and the rest of the app treats it like any other document.

**Convert**
- **OCR** - recognise scanned pages and write a real *invisible text layer* back into the PDF, so the output is genuinely searchable. Contrast is lifted before reading, which measurably helps tinted and low-contrast scans; a sideways or upside-down page can be found and turned upright first; and words the reader was unsure of are marked in amber so you can check them rather than trust them silently. The Edit tab can do this in place: open a scan there and it says so, reads the page on request, and then lets you edit it like any other document.
- **Export** - a real editable **Word .docx** (headings, bold and italic preserved), a web page, plain text, tables to a formatted Excel workbook (or CSV), embedded images, and page renders to PNG or JPEG.


## Finding your way around a long document

The Edit, Fill & Sign, Watermark and Redact viewers carry a **thumbnail rail**
down the side: click any page to go to it, and the page you are on is marked.
A **page number box** sits in the toolbar for jumping straight to page 84 of
120. Thumbnails are drawn only as they scroll into the rail, so a long file
opens as fast as a short one, and a thumbnail is redrawn when you change that
page, so the rail shows the document as it is now.

## Working on several files at once

Seven of the tools accept more than one PDF: **Compress**, **Password Protect**,
**Watermark & Stamps**, **OCR**, **Find & Replace**, **Inspect & Sanitize** and
**Find Sensitive Data**.
Drop a folder's worth in, set the options once, and you get a ZIP back with
every file done. A file that cannot be read, or a locked one whose password
you decline to type, is named in the summary and skipped rather than losing
the whole run.

Bates numbering treats a batch as one bundle: the sequence carries from the
last page of one file to the first page of the next, which is what a legal
filing needs.

The other tools stay single-document on purpose. Editing text, redacting,
signing, comparing, reordering pages and auto-splitting all need you to look
at the page in front of you, so a "do this to twenty files" button there would
be dishonest.

## Real redaction, real encryption

Most browser PDF tools can only *draw on top of* a document. That leads to redaction that is a black rectangle over text you can still select underneath, and password-protection that flattens every page to a JPEG - destroying searchable text and bloating the file.

MiyeePDF edits the actual document instead:

| Operation | Typical browser tool | MiyeePDF |
|---|---|---|
| **Redact** | Black box drawn over text; original still recoverable | Content deleted from the file - gone from the raw bytes |
| **Protect** | Whole document re-photographed to enable encryption | AES-256 applied to the document; text stays searchable |
| **Compress** | Every page rasterized; text destroyed | Only images recompressed; text stays vector |
| **Edit text** | White box over old text, new text drawn on top | Original text replaced, matching font, size and colour |
| **Mask an ID** | Characters covered; still selectable underneath | Original deleted, a masked stub written in its place |

## First load

The engine downloads once (about 28 MB) in the background while the page is usable. A service worker then keeps it in Cache Storage rather than the ordinary HTTP cache, which is evicted far more readily, so later visits start from disk and the app keeps working with no connection at all.

## Development

```
index.html      UI markup
app.js          UI layer + engine bootstrap (no PDF logic)
pdf_engine.py   every PDF operation
style.css       design tokens and components
sw.js           service worker: offline support and engine caching
vendor/         PyMuPDF WebAssembly wheel
```

Built on [PyMuPDF](https://pymupdf.readthedocs.io/) 1.28.2 compiled to WebAssembly, running under [Pyodide](https://pyodide.org/) 314.0.5, with [Tesseract.js](https://tesseract.projectnaptha.com/) for OCR recognition and [JSZip](https://stuk.github.io/jszip/) for multi-file exports.

The PyMuPDF wheel is committed under `vendor/` deliberately: PyPI does not send CORS headers, so the browser must load it same-origin.

**Cache busting:** `app.js` and `style.css` are loaded with a `?v=` query. When changing either, bump `APP_VERSION` in `app.js` and the matching query strings in `index.html` - otherwise browsers can serve a stale mix of old and new assets.
