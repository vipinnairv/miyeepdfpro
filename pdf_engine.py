"""PDF engine for the Advanced PDF Suite, powered by PyMuPDF.

Runs inside Pyodide in the browser. Every operation works on the real PDF
content stream, so text stays vector text: redaction removes glyphs instead of
painting over them, encryption re-saves the original document rather than
re-photographing it, and compression touches images without flattening pages.

The JavaScript layer keeps documents by id and passes geometry as fractions of
the page (0..1) so it never has to care about PDF points or the flipped y-axis.
"""

import base64
import csv
import difflib
import io
import json

import pymupdf

# doc_id -> pymupdf.Document
_DOCS = {}

# Base-14 fonts we can always embed. Real documents reference fonts we cannot
# re-embed from the browser, so editing falls back to the closest of these.
# Each family lists (regular, bold, italic, bold-italic) — PyMuPDF uses fixed
# four-letter names, so these cannot be built by concatenating a suffix.
_FONT_FAMILIES = {
    "helv": ("helv", "hebo", "heit", "hebi"),
    "tiro": ("tiro", "tibo", "tiit", "tibi"),
    "cour": ("cour", "cobo", "coit", "cobi"),
}

_FAMILY_ALIASES = {
    "helvetica": "helv", "arial": "helv", "verdana": "helv", "calibri": "helv",
    "segoeui": "helv", "roboto": "helv", "sans": "helv",
    "times": "tiro", "timesnewroman": "tiro", "georgia": "tiro",
    "garamond": "tiro", "cambria": "tiro", "serif": "tiro", "book": "tiro",
    "courier": "cour", "couriernew": "cour", "consolas": "cour",
    "mono": "cour", "menlo": "cour",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _doc(doc_id):
    if doc_id not in _DOCS:
        raise KeyError(f"document '{doc_id}' is not open")
    return _DOCS[doc_id]


def _rect_from_fracs(page, x0, y0, x1, y1):
    """Convert fractional (0..1) top-left coords into a PDF rect."""
    w, h = page.rect.width, page.rect.height
    return pymupdf.Rect(min(x0, x1) * w, min(y0, y1) * h,
                        max(x0, x1) * w, max(y0, y1) * h)


def _hex_to_rgb(value):
    value = (value or "#000000").lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def _int_to_rgb(value):
    """PyMuPDF reports span colours as a packed sRGB int."""
    return (((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255)


def _pick_font(font_name, flags=0):
    """Map an arbitrary PDF font name onto an embeddable base-14 font."""
    raw = (font_name or "").split("+")[-1]
    name = raw.lower().replace("-", "").replace(" ", "").replace("_", "")
    if "symbol" in name:
        return "symb"
    if "dingbat" in name or "zapf" in name:
        return "zadb"

    bold = "bold" in name or "black" in name or "heavy" in name or bool(flags & 2 ** 4)
    italic = "italic" in name or "oblique" in name or bool(flags & 2 ** 1)

    family = "helv"
    if flags & 2 ** 0:  # fixed-pitch flag
        family = "cour"
    elif flags & 2 ** 1 and "serif" in name:
        family = "tiro"
    for key, value in _FAMILY_ALIASES.items():
        if key in name:
            family = value
            break

    regular, bold_f, italic_f, bolditalic_f = _FONT_FAMILIES[family]
    if bold and italic:
        return bolditalic_f
    if bold:
        return bold_f
    if italic:
        return italic_f
    return regular


def _fit_size(text, font, size, width):
    """Shrink a font size until the text fits the width it has to replace."""
    if width <= 0 or not text:
        return size
    fnt = pymupdf.Font(font)
    for _ in range(40):
        if fnt.text_length(text, size) <= width or size <= 4:
            break
        size -= 0.5
    return size


def _page_indices(doc, spec):
    """Parse '1-3, 5' into 0-based indices; empty/None means every page."""
    if not spec or not str(spec).strip():
        return list(range(doc.page_count))
    found = []
    for chunk in str(spec).split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if "-" in chunk:
            a, _, b = chunk.partition("-")
            try:
                start, end = int(a), int(b)
            except ValueError:
                continue
            if start > end:
                start, end = end, start
            found.extend(range(start - 1, end))
        elif chunk.isdigit():
            found.append(int(chunk) - 1)
    return sorted({i for i in found if 0 <= i < doc.page_count})


# --------------------------------------------------------------------------
# document lifecycle
# --------------------------------------------------------------------------

def open_doc(doc_id, data, password=""):
    """Open a PDF from raw bytes. Returns basic metadata for the UI."""
    close_doc(doc_id)
    doc = pymupdf.open(stream=bytes(data), filetype="pdf")
    if doc.needs_pass:
        if not password or not doc.authenticate(password):
            doc.close()
            raise ValueError("PASSWORD_REQUIRED")
    _DOCS[doc_id] = doc
    return json.dumps(doc_info(doc_id))


def close_doc(doc_id):
    doc = _DOCS.pop(doc_id, None)
    if doc is not None:
        doc.close()
    return True


def doc_info(doc_id):
    doc = _doc(doc_id)
    meta = doc.metadata or {}
    return {
        "pages": doc.page_count,
        "encrypted": bool(doc.needs_pass),
        "title": meta.get("title") or "",
        "author": meta.get("author") or "",
        "sizes": [
            {"width": p.rect.width, "height": p.rect.height, "rotation": p.rotation}
            for p in doc
        ],
    }


def page_count(doc_id):
    return _doc(doc_id).page_count


def render_page(doc_id, pno, dpi=100):
    """Render one page to PNG bytes for display."""
    page = _doc(doc_id)[int(pno)]
    return page.get_pixmap(dpi=int(dpi)).tobytes("png")


def save(doc_id, garbage=3, deflate=True):
    """Serialise the working document."""
    return _doc(doc_id).tobytes(garbage=int(garbage), deflate=bool(deflate), clean=True)


# --------------------------------------------------------------------------
# text editing (real content-stream replacement)
# --------------------------------------------------------------------------

def get_spans(doc_id, pno):
    """Every text span on a page with the metrics needed to re-typeset it."""
    page = _doc(doc_id)[int(pno)]
    pw, ph = page.rect.width, page.rect.height
    spans = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"]
                if not text.strip():
                    continue
                x0, y0, x1, y1 = span["bbox"]
                spans.append({
                    "text": text,
                    "font": span["font"],
                    "size": round(span["size"], 2),
                    "colorInt": span["color"],
                    "flags": span["flags"],
                    "bbox": [x0, y0, x1, y1],
                    # fractions so the UI can place an overlay without knowing PDF units
                    "xFrac": x0 / pw, "yFrac": y0 / ph,
                    "wFrac": (x1 - x0) / pw, "hFrac": (y1 - y0) / ph,
                })
    return json.dumps(spans)


def edit_text(doc_id, pno, bbox, new_text, font_name="", size=0, color_int=0, flags=0):
    """Replace the text in one span, keeping the original look.

    The old glyphs are genuinely removed from the content stream (redaction),
    then the replacement is drawn with matched font, size and colour.
    """
    page = _doc(doc_id)[int(pno)]
    x0, y0, x1, y1 = [float(v) for v in bbox]
    rect = pymupdf.Rect(x0, y0, x1, y1)

    # Erase the original glyphs without disturbing anything else on the page.
    page.add_redact_annot(rect)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)

    if not new_text:
        return True

    font = _pick_font(font_name, int(flags))
    size = float(size) or (rect.height * 0.8)
    size = _fit_size(new_text, font, size, rect.width)
    page.insert_text(
        (rect.x0, rect.y1 - size * 0.22),
        new_text,
        fontsize=size,
        fontname=font,
        color=_int_to_rgb(int(color_int)),
    )
    return True


def search_text(doc_id, needle):
    """Find a phrase across the document; returns fractional hit rectangles."""
    doc = _doc(doc_id)
    hits = []
    for pno, page in enumerate(doc):
        pw, ph = page.rect.width, page.rect.height
        for r in page.search_for(needle):
            hits.append({
                "page": pno,
                "xFrac": r.x0 / pw, "yFrac": r.y0 / ph,
                "wFrac": r.width / pw, "hFrac": r.height / ph,
            })
    return json.dumps(hits)


# --------------------------------------------------------------------------
# redaction
# --------------------------------------------------------------------------

def redact(doc_id, marks_json, remove_images=False, fill="#000000"):
    """Permanently remove content under each mark.

    Unlike drawing a black box, the underlying text and image data are struck
    from the file, so the result cannot be recovered by copy/paste. `fill` only
    changes the colour of the box left behind — never what gets removed.
    """
    doc = _doc(doc_id)
    marks = json.loads(marks_json) if isinstance(marks_json, str) else marks_json
    colour = _hex_to_rgb(fill)
    touched = set()
    for mark in marks:
        page = doc[int(mark["page"])]
        rect = _rect_from_fracs(page, float(mark["xFrac"]), float(mark["yFrac"]),
                                float(mark["xFrac"]) + float(mark["wFrac"]),
                                float(mark["yFrac"]) + float(mark["hFrac"]))
        page.add_redact_annot(rect, fill=colour)
        touched.add(int(mark["page"]))

    mode = pymupdf.PDF_REDACT_IMAGE_REMOVE if remove_images else pymupdf.PDF_REDACT_IMAGE_NONE
    for pno in touched:
        doc[pno].apply_redactions(images=mode)
    return len(touched)


def redact_search(doc_id, needle, pages_spec="", fill="#000000"):
    """Find every occurrence of a phrase and redact it (Acrobat's find-and-redact)."""
    doc = _doc(doc_id)
    colour = _hex_to_rgb(fill)
    count = 0
    for pno in _page_indices(doc, pages_spec):
        page = doc[pno]
        found = page.search_for(needle)
        for rect in found:
            page.add_redact_annot(rect, fill=colour)
        if found:
            page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)
            count += len(found)
    return count


# --------------------------------------------------------------------------
# protection
# --------------------------------------------------------------------------

def encrypt(doc_id, user_pw, owner_pw="", allow_print=True, allow_copy=False,
            allow_modify=False, allow_annotate=False):
    """AES-256 encrypt the document itself — pages are never rasterised."""
    doc = _doc(doc_id)
    perms = 0
    if allow_print:
        perms |= pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_PRINT_HQ
    if allow_copy:
        perms |= pymupdf.PDF_PERM_COPY
    if allow_modify:
        perms |= pymupdf.PDF_PERM_MODIFY
    if allow_annotate:
        perms |= pymupdf.PDF_PERM_ANNOTATE

    return doc.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        owner_pw=owner_pw or user_pw,
        user_pw=user_pw,
        permissions=perms,
        garbage=3,
        deflate=True,
    )


def decrypt(doc_id):
    """Save without encryption (requires the document to be open/authenticated)."""
    return _doc(doc_id).tobytes(encryption=pymupdf.PDF_ENCRYPT_NONE, garbage=3, deflate=True)


# --------------------------------------------------------------------------
# compression
# --------------------------------------------------------------------------

def compress(doc_id, level="medium"):
    """Shrink the file by recompressing images and cleaning the object tree.

    Text and vector art are left untouched, so the result stays searchable.
    """
    doc = _doc(doc_id)
    presets = {
        "low": (0.9, 300),
        "medium": (0.75, 150),
        "high": (0.55, 96),
    }
    quality, max_dpi = presets.get(level, presets["medium"])

    for pno in range(doc.page_count):
        page = doc[pno]
        for info in page.get_images(full=True):
            xref = info[0]
            try:
                base = doc.extract_image(xref)
            except Exception:
                continue
            pix = pymupdf.Pixmap(doc, xref)
            if pix.n - pix.alpha >= 4:  # CMYK -> RGB so JPEG is valid
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            if pix.alpha:
                pix = pymupdf.Pixmap(pix, 0)

            # Downsample anything wildly larger than it is displayed.
            rects = page.get_image_rects(xref)
            if rects:
                shown_w = max(r.width for r in rects) or 1
                target_w = min(pix.width, int(shown_w * max_dpi / 72))
                if 0 < target_w < pix.width:
                    scale = target_w / pix.width
                    pix = pymupdf.Pixmap(pix, 0)
                    pix.shrink(max(1, int(1 / max(scale, 1e-6)) // 2) or 1)

            try:
                new_bytes = pix.tobytes("jpeg", jpg_quality=int(quality * 100))
            except Exception:
                continue
            if len(new_bytes) < len(base.get("image", b"")):
                try:
                    doc.update_stream(xref, new_bytes, new=True)
                    doc.xref_set_key(xref, "Filter", "/DCTDecode")
                    doc.xref_set_key(xref, "ColorSpace", "/DeviceRGB")
                    doc.xref_set_key(xref, "BitsPerComponent", "8")
                    doc.xref_set_key(xref, "Width", str(pix.width))
                    doc.xref_set_key(xref, "Height", str(pix.height))
                except Exception:
                    pass

    return doc.tobytes(garbage=4, deflate=True, clean=True, deflate_images=True,
                       deflate_fonts=True)


# --------------------------------------------------------------------------
# page organisation
# --------------------------------------------------------------------------

def merge(doc_ids_json):
    """Concatenate several open documents, in the order given."""
    ids = json.loads(doc_ids_json) if isinstance(doc_ids_json, str) else list(doc_ids_json)
    out = pymupdf.open()
    for doc_id in ids:
        out.insert_pdf(_doc(doc_id))
    data = out.tobytes(garbage=3, deflate=True)
    out.close()
    return data


def split(doc_id, mode="individual", spec="", every=1):
    """Split into parts. Returns [{name, b64}] so JS can zip them."""
    doc = _doc(doc_id)
    parts = []

    def emit(name, start, end):
        piece = pymupdf.open()
        piece.insert_pdf(doc, from_page=start, to_page=end)
        parts.append({
            "name": name,
            "b64": base64.b64encode(piece.tobytes(garbage=3, deflate=True)).decode(),
        })
        piece.close()

    if mode == "ranges":
        for idx, chunk in enumerate([c.strip() for c in str(spec).split(",") if c.strip()], 1):
            idxs = _page_indices(doc, chunk)
            if idxs:
                emit(f"part-{idx}.pdf", idxs[0], idxs[-1])
    elif mode == "every":
        step = max(1, int(every))
        for idx, start in enumerate(range(0, doc.page_count, step), 1):
            emit(f"part-{idx}.pdf", start, min(start + step - 1, doc.page_count - 1))
    else:
        for pno in range(doc.page_count):
            emit(f"page-{pno + 1}.pdf", pno, pno)

    return json.dumps(parts)


def organize(doc_id, order_json, rotations_json="{}"):
    """Reorder/rotate/drop pages. `order_json` lists original indices to keep.

    Both arguments arrive as JSON strings: values handed straight over the
    JS bridge become JsProxy objects, which lack the dict/list API used here.
    """
    doc = _doc(doc_id)
    order = json.loads(order_json) if isinstance(order_json, str) else list(order_json)
    rotations = json.loads(rotations_json) if isinstance(rotations_json, str) else dict(rotations_json)

    out = pymupdf.open()
    for pos, original in enumerate(order):
        out.insert_pdf(doc, from_page=int(original), to_page=int(original))
        rot = rotations.get(str(original), rotations.get(int(original), 0)) or 0
        if rot:
            out[pos].set_rotation((out[pos].rotation + int(rot)) % 360)
    data = out.tobytes(garbage=3, deflate=True)
    out.close()
    return data


# --------------------------------------------------------------------------
# watermarks, stamps, numbering
# --------------------------------------------------------------------------

def watermark_text(doc_id, text, pages_spec="", size=48, color="#c81e1e", opacity=0.3,
                   rotate=45, tiled=False):
    doc = _doc(doc_id)
    rgb = _hex_to_rgb(color)
    font = pymupdf.Font("hebo")
    for pno in _page_indices(doc, pages_spec):
        page = doc[pno]
        w, h = page.rect.width, page.rect.height
        text_w = font.text_length(text, size)

        spots = []
        if tiled:
            step_x, step_y = text_w + 90, size * 3.2
            y = step_y / 2
            while y < h + step_y:
                x = step_x / 2
                while x < w + step_x:
                    spots.append((x, y))
                    x += step_x
                y += step_y
        else:
            spots.append((w / 2, h / 2))

        for cx, cy in spots:
            # Rotate about the text's own centre so tiling stays even.
            morph = ((pymupdf.Point(cx, cy), pymupdf.Matrix(float(rotate)))
                     if rotate else None)
            page.insert_text(
                (cx - text_w / 2, cy + size * 0.35), text,
                fontsize=size, fontname="hebo", color=rgb,
                fill_opacity=float(opacity), morph=morph,
            )
    return True


def watermark_image(doc_id, image_b64, pages_spec="", opacity=0.3, scale=0.5, tiled=False):
    doc = _doc(doc_id)
    raw = base64.b64decode(image_b64.split(",")[-1])
    for pno in _page_indices(doc, pages_spec):
        page = doc[pno]
        w, h = page.rect.width, page.rect.height
        iw = w * float(scale)
        pix = pymupdf.Pixmap(raw)
        ih = iw * (pix.height / pix.width)

        spots = []
        if tiled:
            y = ih / 2
            while y < h + ih:
                x = iw / 2
                while x < w + iw:
                    spots.append((x, y))
                    x += iw + 40
                y += ih + 40
        else:
            spots.append((w / 2, h / 2))

        for cx, cy in spots:
            rect = pymupdf.Rect(cx - iw / 2, cy - ih / 2, cx + iw / 2, cy + ih / 2)
            page.insert_image(rect, stream=raw, overlay=True, alpha=int(float(opacity) * 255))
    return True


def stamp(doc_id, stamps_json, color="#c81e1e"):
    """Place boxed approval stamps at fractional positions."""
    doc = _doc(doc_id)
    items = json.loads(stamps_json) if isinstance(stamps_json, str) else stamps_json
    rgb = _hex_to_rgb(color)
    font = pymupdf.Font("hebo")
    for item in items:
        page = doc[int(item["page"])]
        rect = _rect_from_fracs(page, float(item["xFrac"]), float(item["yFrac"]),
                                float(item["xFrac"]) + float(item["wFrac"]),
                                float(item["yFrac"]) + float(item["hFrac"]))
        page.draw_rect(rect, color=rgb, width=2.5)
        text = item["text"]
        size = _fit_size(text, "hebo", rect.height * 0.55, rect.width * 0.88)
        tw = font.text_length(text, size)
        page.insert_text((rect.x0 + (rect.width - tw) / 2, rect.y0 + rect.height / 2 + size * 0.35),
                         text, fontsize=size, fontname="hebo", color=rgb)
    return True


def page_numbers(doc_id, fmt="Page {n} of {total}", position="bottom-center",
                 start=1, size=10, color="#111111", margin=28):
    doc = _doc(doc_id)
    rgb = _hex_to_rgb(color)
    font = pymupdf.Font("helv")
    total = doc.page_count
    for idx, page in enumerate(doc):
        label = (fmt.replace("{n}", str(start + idx))
                    .replace("{total}", str(total))
                    .replace("{page}", str(start + idx)))
        tw = font.text_length(label, size)
        w, h = page.rect.width, page.rect.height
        x = margin if "left" in position else (w - margin - tw if "right" in position else (w - tw) / 2)
        y = margin if position.startswith("top") else h - margin
        page.insert_text((x, y), label, fontsize=size, fontname="helv", color=rgb)
    return True


def bates(doc_id, prefix="", suffix="", start=1, digits=6, position="bottom-right",
          size=10, color="#111111", margin=28):
    """Bates numbering — sequential legal stamps like BATES000001."""
    doc = _doc(doc_id)
    rgb = _hex_to_rgb(color)
    font = pymupdf.Font("helv")
    for idx, page in enumerate(doc):
        label = f"{prefix}{str(int(start) + idx).zfill(int(digits))}{suffix}"
        tw = font.text_length(label, size)
        w, h = page.rect.width, page.rect.height
        x = margin if "left" in position else (w - margin - tw if "right" in position else (w - tw) / 2)
        y = margin if position.startswith("top") else h - margin
        page.insert_text((x, y), label, fontsize=size, fontname="helv", color=rgb)
    return doc.page_count


def header_footer(doc_id, fields_json, size=9, color="#111111", margin=28, filename=""):
    """Headers/footers with {page}, {total}, {date}, {filename} placeholders."""
    import datetime
    doc = _doc(doc_id)
    fields = json.loads(fields_json) if isinstance(fields_json, str) else fields_json
    rgb = _hex_to_rgb(color)
    font = pymupdf.Font("helv")
    today = datetime.date.today().strftime("%Y-%m-%d")
    total = doc.page_count

    for idx, page in enumerate(doc):
        w, h = page.rect.width, page.rect.height
        for key, raw in fields.items():
            if not raw or not str(raw).strip():
                continue
            label = (str(raw).replace("{page}", str(idx + 1))
                             .replace("{total}", str(total))
                             .replace("{date}", today)
                             .replace("{filename}", filename))
            vertical, _, horizontal = key.partition("-")
            tw = font.text_length(label, size)
            x = margin if horizontal == "left" else (w - margin - tw if horizontal == "right" else (w - tw) / 2)
            y = margin if vertical == "header" else h - margin
            page.insert_text((x, y), label, fontsize=size, fontname="helv", color=rgb)
    return True


# --------------------------------------------------------------------------
# fill & sign
# --------------------------------------------------------------------------

def place_items(doc_id, items_json):
    """Drop signatures, initials, text, dates and check marks onto pages.

    Items carry fractional geometry from the UI; images arrive as data URLs.
    """
    doc = _doc(doc_id)
    items = json.loads(items_json) if isinstance(items_json, str) else items_json

    for item in items:
        page = doc[int(item["page"])]
        rect = _rect_from_fracs(page, float(item["xFrac"]), float(item["yFrac"]),
                                float(item["xFrac"]) + float(item["wFrac"]),
                                float(item["yFrac"]) + float(item["hFrac"]))
        if item.get("dataUrl"):
            raw = base64.b64decode(item["dataUrl"].split(",")[-1])
            page.insert_image(rect, stream=raw, overlay=True)
        else:
            text = item.get("text", "")
            if not text:
                continue
            font = _pick_font(item.get("font", "helv"))
            size = float(item.get("size") or rect.height * 0.7)
            size = _fit_size(text, font, size, rect.width)
            page.insert_text((rect.x0, rect.y1 - size * 0.25), text, fontsize=size,
                             fontname=font, color=_hex_to_rgb(item.get("color", "#000000")))
    return len(items)


def fill_form(doc_id, values_json, flatten=True):
    """Fill AcroForm fields by name, optionally flattening them into the page."""
    doc = _doc(doc_id)
    values = json.loads(values_json) if isinstance(values_json, str) else values_json
    filled = 0
    for page in doc:
        for widget in page.widgets():
            if widget.field_name not in values:
                continue
            value = values[widget.field_name]
            try:
                if widget.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
                    widget.field_value = bool(value)
                else:
                    widget.field_value = str(value)
                widget.update()
                filled += 1
            except Exception:
                continue
    if flatten and filled:
        # Re-saving with the form "baked" keeps values visible everywhere.
        doc.bake()
    return filled


def get_form_fields(doc_id):
    """List fillable form fields so the UI can render inputs for them."""
    doc = _doc(doc_id)
    out = []
    types = {
        pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
        pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
        pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "select",
        pymupdf.PDF_WIDGET_TYPE_LISTBOX: "select",
        pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    }
    for pno, page in enumerate(doc):
        for widget in page.widgets():
            out.append({
                "page": pno,
                "name": widget.field_name,
                "kind": types.get(widget.field_type, "text"),
                "value": widget.field_value if isinstance(widget.field_value, str) else "",
                "options": list(widget.choice_values or []) if widget.choice_values else [],
            })
    return json.dumps(out)


# --------------------------------------------------------------------------
# OCR — build a genuinely searchable PDF
# --------------------------------------------------------------------------

def needs_ocr(doc_id, pno):
    """A page with (almost) no extractable text is presumed to be a scan."""
    return len(_doc(doc_id)[int(pno)].get_text().strip()) < 12


def insert_ocr_layer(doc_id, pno, words_json, img_width, img_height):
    """Insert recognised words as invisible, selectable text.

    `words_json` carries Tesseract.js output in image-pixel coordinates; they are
    scaled to PDF points and drawn with render_mode=3 (invisible) so the page
    still *looks* like the scan but is fully searchable and copyable.
    """
    page = _doc(doc_id)[int(pno)]
    words = json.loads(words_json) if isinstance(words_json, str) else words_json
    sx = page.rect.width / float(img_width)
    sy = page.rect.height / float(img_height)
    added = 0

    for word in words:
        text = (word.get("text") or "").strip()
        if not text:
            continue
        b = word.get("bbox") or {}
        x0, y0 = float(b.get("x0", 0)) * sx, float(b.get("y0", 0)) * sy
        x1, y1 = float(b.get("x1", 0)) * sx, float(b.get("y1", 0)) * sy
        height = max(y1 - y0, 1)
        size = _fit_size(text, "helv", height * 0.95, max(x1 - x0, 1))
        page.insert_text((x0, y1 - height * 0.18), text, fontsize=size,
                         fontname="helv", render_mode=3)
        added += 1
    return added


# --------------------------------------------------------------------------
# export & convert
# --------------------------------------------------------------------------

def export_text(doc_id):
    return "\n\n".join(page.get_text() for page in _doc(doc_id))


def export_html(doc_id):
    """HTML that Word opens with layout largely intact."""
    doc = _doc(doc_id)
    body = "\n".join(
        f'<div class="pdf-page" style="position:relative">{page.get_text("html")}</div>'
        for page in doc
    )
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'>"
        "<style>.pdf-page{page-break-after:always;margin-bottom:24px}</style>"
        f"</head><body>{body}</body></html>"
    )


def export_tables(doc_id):
    """Detect ruled tables and return them as CSV files."""
    doc = _doc(doc_id)
    out = []
    for pno, page in enumerate(doc):
        try:
            found = page.find_tables()
        except Exception:
            continue
        for tno, table in enumerate(found.tables, 1):
            rows = table.extract()
            if not rows:
                continue
            buf = io.StringIO()
            writer = csv.writer(buf)
            for row in rows:
                writer.writerow(["" if c is None else str(c).replace("\n", " ") for c in row])
            out.append({
                "name": f"page{pno + 1}-table{tno}.csv",
                "rows": len(rows),
                "cols": len(rows[0]) if rows else 0,
                "csv": buf.getvalue(),
            })
    return json.dumps(out)


def export_images(doc_id):
    """Pull every embedded image out of the document."""
    doc = _doc(doc_id)
    out = []
    seen = set()
    for pno in range(doc.page_count):
        for info in doc[pno].get_images(full=True):
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                img = doc.extract_image(xref)
            except Exception:
                continue
            out.append({
                "name": f"image-{xref}.{img['ext']}",
                "b64": base64.b64encode(img["image"]).decode(),
                "width": img.get("width", 0),
                "height": img.get("height", 0),
            })
    return json.dumps(out)


def export_page_images(doc_id, dpi=150, fmt="png", pages_spec=""):
    """Render pages to PNG/JPEG at a chosen resolution."""
    doc = _doc(doc_id)
    out = []
    for pno in _page_indices(doc, pages_spec):
        pix = doc[pno].get_pixmap(dpi=int(dpi))
        if fmt == "jpeg" and pix.alpha:
            pix = pymupdf.Pixmap(pix, 0)
        out.append({
            "name": f"page-{pno + 1}.{'jpg' if fmt == 'jpeg' else 'png'}",
            "b64": base64.b64encode(pix.tobytes(fmt)).decode(),
        })
    return json.dumps(out)


# --------------------------------------------------------------------------
# annotations / review
# --------------------------------------------------------------------------

def annotate(doc_id, pno, kind, x0, y0, x1, y1, text="", color="#ffd400", author=""):
    """Add a real PDF annotation that other readers (including Acrobat) understand."""
    page = _doc(doc_id)[int(pno)]
    rect = _rect_from_fracs(page, float(x0), float(y0), float(x1), float(y1))
    rgb = _hex_to_rgb(color)
    annot = None

    if kind == "highlight":
        annot = page.add_highlight_annot(rect)
    elif kind == "underline":
        annot = page.add_underline_annot(rect)
    elif kind == "strikeout":
        annot = page.add_strikeout_annot(rect)
    elif kind == "squiggly":
        annot = page.add_squiggly_annot(rect)
    elif kind == "note":
        annot = page.add_text_annot(rect.tl, text or "Note")
    elif kind == "freetext":
        annot = page.add_freetext_annot(rect, text or "", fontsize=11, text_color=(0, 0, 0))
    elif kind == "rect":
        annot = page.add_rect_annot(rect)
    else:
        raise ValueError(f"unknown annotation type '{kind}'")

    if annot is not None:
        if kind in ("highlight", "underline", "strikeout", "squiggly", "rect"):
            annot.set_colors(stroke=rgb)
        if text and kind not in ("note", "freetext"):
            annot.set_info(content=text)
        if author:
            annot.set_info(title=author)
        annot.update()
    return True


def list_annotations(doc_id):
    doc = _doc(doc_id)
    out = []
    for pno, page in enumerate(doc):
        for annot in page.annots():
            info = annot.info
            out.append({
                "page": pno,
                "type": annot.type[1],
                "content": info.get("content", ""),
                "author": info.get("title", ""),
            })
    return json.dumps(out)


def flatten_annotations(doc_id):
    """Bake annotations into the page content so they cannot be edited away."""
    doc = _doc(doc_id)
    return doc.tobytes(garbage=3, deflate=True)


# --------------------------------------------------------------------------
# compare two documents
# --------------------------------------------------------------------------

def compare(doc_a, doc_b):
    """Word-level diff between two versions, page by page."""
    a, b = _doc(doc_a), _doc(doc_b)
    pages = []
    for pno in range(max(a.page_count, b.page_count)):
        text_a = a[pno].get_text() if pno < a.page_count else ""
        text_b = b[pno].get_text() if pno < b.page_count else ""
        words_a, words_b = text_a.split(), text_b.split()
        matcher = difflib.SequenceMatcher(None, words_a, words_b)

        changes = []
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            changes.append({
                "type": tag,
                "old": " ".join(words_a[i1:i2])[:400],
                "new": " ".join(words_b[j1:j2])[:400],
            })
        pages.append({
            "page": pno,
            "similarity": round(matcher.ratio() * 100, 1),
            "changes": changes,
            "onlyIn": ("a" if pno >= b.page_count else "b" if pno >= a.page_count else None),
        })

    total = sum(len(p["changes"]) for p in pages)
    return json.dumps({"pages": pages, "totalChanges": total})


def highlight_differences(doc_id, other_id):
    """Highlight, in `doc_id`, the words that differ from `other_id`."""
    doc, other = _doc(doc_id), _doc(other_id)
    marked = 0
    for pno in range(doc.page_count):
        if pno >= other.page_count:
            break
        # Hold one page object: annotations created from a throwaway `doc[pno]`
        # get garbage-collected and unbind before they can be updated.
        page = doc[pno]
        words_new = page.get_text().split()
        words_old = other[pno].get_text().split()
        matcher = difflib.SequenceMatcher(None, words_old, words_new)
        changed = set()
        for tag, _i1, _i2, j1, j2 in matcher.get_opcodes():
            if tag in ("replace", "insert"):
                changed.update(words_new[j1:j2])
        for token in list(changed)[:400]:
            token = token.strip(".,;:()[]\"'")
            if len(token) < 2:
                continue
            for rect in page.search_for(token):
                annot = page.add_highlight_annot(rect)
                annot.set_colors(stroke=(1, 0.85, 0.2))
                annot.update()
                marked += 1
    return marked
