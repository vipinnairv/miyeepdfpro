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
# doc_id -> whether the file was password-protected when it was opened.
# Recorded once at open time because reading Document.needs_pass on an
# authenticated document de-authenticates it.
_WAS_ENCRYPTED = {}

# Base-14 fonts we can always embed. Real documents reference fonts we cannot
# re-embed from the browser, so editing falls back to the closest of these.
# Each family lists (regular, bold, italic, bold-italic) - PyMuPDF uses fixed
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


def _fit_size(text, font, size, width, measurer=None):
    """Shrink a font size until the text fits the width it has to replace."""
    if width <= 0 or not text:
        return size
    fnt = measurer or pymupdf.Font(font)
    for _ in range(40):
        if fnt.text_length(text, size) <= width or size <= 4:
            break
        size -= 0.5
    return size


# Suffixes that say nothing about the face itself. A PDF's BaseFont entry and
# the name text extraction reports disagree about these constantly - the same
# font turns up as "IPAGothic Regular" in one and "IPAGothic" in the other, or
# as "TimesNewRomanPSMT" against "TimesNewRoman".
_NEUTRAL_FONT_SUFFIXES = ("regular", "roman", "normal", "book", "std", "pro", "mt", "ps")


def _norm_font(value):
    """A font name reduced to the part that identifies the face."""
    name = (value or "").split("+")[-1].lower()
    for ch in "-_ .,":
        name = name.replace(ch, "")
    trimmed = True
    while trimmed:
        trimmed = False
        for suffix in _NEUTRAL_FONT_SUFFIXES:
            if len(name) > len(suffix) and name.endswith(suffix):
                name, trimmed = name[: -len(suffix)], True
    return name


def _same_font(a, b):
    """Whether two font names refer to the same face.

    Weight and slant words are deliberately *not* stripped, so a regular span
    never gets matched to the bold cut sitting next to it on the page.
    """
    return _norm_font(a) == _norm_font(b)


def _grab_embedded_font(doc, page, font_name, text):
    """Pull the document's *own* font file out of the PDF, if it can be reused.

    Real documents use fonts that do not map onto the base-14 set - a Roboto
    invoice rewritten in Helvetica looks obviously edited. When the font is
    embedded we can extract the actual file and write with it.

    Two things stop this from always working. The font may be referenced rather
    than embedded (nothing to extract), and embedded fonts are usually *subset*
    to the glyphs the document already uses, so newly typed characters may be
    missing. Both are checked here; the caller falls back to base-14.

    Returns (buffer, measuring_font) or (None, None). Deliberately returns the
    buffer rather than registering the font, because this must run *before*
    redaction while the page still references it, and the font has to be
    re-registered afterwards.
    """
    needed = {c for c in (text or "") if not c.isspace()}
    for info in page.get_fonts(full=True):
        xref, basefont = info[0], info[3]
        if not _same_font(basefont, font_name):
            continue
        try:
            _name, _ext, _ftype, buf = doc.extract_font(xref)
        except Exception:
            continue
        if not buf:
            continue  # referenced, not embedded - nothing to reuse
        try:
            fnt = pymupdf.Font(fontbuffer=buf)
            if any(not fnt.has_glyph(ord(c)) for c in needed):
                return None, None  # subset lacks a character being typed
            return buf, fnt
        except Exception:
            continue
    return None, None


def _register_font(page, buf, font_name, flags):
    """Attach the reused font to the page, or fall back to a base-14 match.

    Returns (fontname, measuring_font, matched_original).
    """
    if buf:
        try:
            tag = "MPDFembed"
            page.insert_font(fontname=tag, fontbuffer=buf)
            return tag, pymupdf.Font(fontbuffer=buf), True
        except Exception:
            pass
    fallback = _pick_font(font_name, int(flags or 0))
    return fallback, pymupdf.Font(fallback), False


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
    # Read needs_pass exactly once, here, before authenticating. Touching it
    # again afterwards silently drops the authentication: every later page read
    # comes back empty and the saved file is corrupt. Remember the answer
    # instead, and never ask the document a second time.
    was_encrypted = bool(doc.needs_pass)
    if was_encrypted:
        if not password or not doc.authenticate(password):
            doc.close()
            raise ValueError("PASSWORD_REQUIRED")
    _DOCS[doc_id] = doc
    _WAS_ENCRYPTED[doc_id] = was_encrypted
    return json.dumps(doc_info(doc_id))


def close_doc(doc_id):
    doc = _DOCS.pop(doc_id, None)
    _WAS_ENCRYPTED.pop(doc_id, None)
    if doc is not None:
        doc.close()
    return True


def doc_info(doc_id):
    doc = _doc(doc_id)
    meta = doc.metadata or {}
    return {
        "pages": doc.page_count,
        "encrypted": _WAS_ENCRYPTED.get(doc_id, False),
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


def get_web_font(doc_id, pno, font_name):
    """The page's own embedded font, in a form a browser can render.

    Used by the in-place editor so what you type on screen looks like what
    the PDF already contains. TrueType and OpenType go straight to the
    browser; anything else (bare CFF, Type1) comes back empty and the UI
    falls back to a lookalike stack.
    """
    doc = _doc(doc_id)
    page = doc[int(pno)]
    for info in page.get_fonts(full=True):
        xref, basefont = info[0], info[3]
        if not _same_font(basefont, font_name):
            continue
        try:
            _name, ext, _ftype, buf = doc.extract_font(xref)
        except Exception:
            continue
        if buf and ext in ("ttf", "otf"):
            return buf
    return b""


def edit_text(doc_id, pno, bbox, new_text, font_name="", size=0, color_int=0, flags=0):
    """Replace the text in one span, keeping the original look.

    The old glyphs are genuinely removed from the content stream (redaction),
    then the replacement is drawn with matched font, size and colour.
    """
    doc = _doc(doc_id)
    page = doc[int(pno)]
    x0, y0, x1, y1 = [float(v) for v in bbox]
    rect = pymupdf.Rect(x0, y0, x1, y1)

    # Grab the embedded font while the page still references it - redaction can
    # drop the resource.
    buf, _ = _grab_embedded_font(doc, page, font_name, new_text)

    # Erase the original glyphs without disturbing anything else on the page.
    page.add_redact_annot(rect)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)

    if not new_text:
        return json.dumps({"ok": True, "font": "", "exact": False})

    font, measurer, exact = _register_font(page, buf, font_name, flags)
    size = float(size) or (rect.height * 0.8)
    size = _fit_size(new_text, font, size, rect.width * 1.15, measurer)
    page.insert_text(
        (rect.x0, rect.y1 - size * 0.22),
        new_text,
        fontsize=size,
        fontname=font,
        color=_int_to_rgb(int(color_int)),
    )
    return json.dumps({"ok": True, "font": font_name if exact else _pick_font(font_name, int(flags or 0)),
                       "exact": exact, "size": round(size, 1)})


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
    changes the colour of the box left behind - never what gets removed.
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
    """AES-256 encrypt the document itself - pages are never rasterised."""
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
    """Bates numbering - sequential legal stamps like BATES000001."""
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
# OCR - build a genuinely searchable PDF
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

def _xlsx_col(idx):
    """0-based column index -> Excel column letters (0 -> A, 26 -> AA)."""
    s = ""
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def _xlsx_cell_value(raw):
    """Classify a table cell as numeric or text for xlsx export.

    Deliberately conservative: a value like "0123" or "00501" (an id or a
    postal code, not a quantity) is kept as text, because turning it into a
    real number would silently drop the leading zero -- a wrong-but-plausible
    number is worse than an unformatted string.
    """
    import re
    text = "" if raw is None else str(raw).replace("\r", " ").replace("\n", " ").strip()
    if not text:
        return False, text, None
    if not re.fullmatch(r"-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?", text):
        return False, text, None
    bare = text.replace(",", "")
    digits = bare.lstrip("-")
    if len(digits) > 1 and digits[0] == "0" and digits[1] != ".":
        return False, text, None
    return True, text, bare


_XLSX_STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><color rgb="FF1F2427"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF21808D"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3F6F6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD8DEE2"/></left><right style="thin"><color rgb="FFD8DEE2"/></right><top style="thin"><color rgb="FFD8DEE2"/></top><bottom style="thin"><color rgb="FFD8DEE2"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""


def _build_xlsx(sheets, creator="MiyeePDF"):
    """Build a genuine .xlsx workbook, one worksheet per entry in `sheets`.

    sheets: [{"name": str, "rows": [[cell, ...], ...]}], first row of each
    treated as its header. Pure stdlib (zipfile) so the wasm bundle needs no
    extra vendored package for something a zip of XML files can do on its
    own -- openpyxl and its dependency are not part of the Pyodide package
    set, and PyPI wheels can't be fetched cross-origin from the browser
    (same reason PyMuPDF itself is vendored rather than pip-installed).
    Returns bytes.
    """
    import re
    import zipfile

    def esc(s):
        return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;"))

    shared = []
    shared_index = {}

    def sst(text):
        if text not in shared_index:
            shared_index[text] = len(shared)
            shared.append(text)
        return shared_index[text]

    sheet_xmls = []
    sheet_names = []
    used_names = set()
    for sheet in sheets:
        name = re.sub(r'[\[\]\*\?/\\:]', ' ', sheet["name"]).strip()[:31] or "Sheet"
        base, n = name, 2
        while name.lower() in used_names:
            suffix = f" ({n})"
            name = base[:31 - len(suffix)] + suffix
            n += 1
        used_names.add(name.lower())
        sheet_names.append(name)

        rows = sheet["rows"] or [[]]
        ncols = max((len(r) for r in rows), default=1) or 1
        widths = [8.0] * ncols
        row_xml = []
        for r_idx, row in enumerate(rows):
            is_header = r_idx == 0
            cells_xml = []
            for c_idx in range(ncols):
                raw = row[c_idx] if c_idx < len(row) else ""
                is_num, text, num_str = _xlsx_cell_value(raw)
                widths[c_idx] = min(max(widths[c_idx], len(text) + 2), 60)
                ref = f"{_xlsx_col(c_idx)}{r_idx + 1}"
                if is_header:
                    style = 1
                elif is_num:
                    style = 5 if r_idx % 2 else 4
                else:
                    style = 3 if r_idx % 2 else 2
                if is_num and not is_header:
                    cells_xml.append(f'<c r="{ref}" s="{style}"><v>{num_str}</v></c>')
                else:
                    idx = sst(text)
                    cells_xml.append(f'<c r="{ref}" t="s" s="{style}"><v>{idx}</v></c>')
            row_xml.append(f'<row r="{r_idx + 1}">' + "".join(cells_xml) + "</row>")

        cols_xml = "".join(
            f'<col min="{i + 1}" max="{i + 1}" width="{w:.2f}" customWidth="1"/>'
            for i, w in enumerate(widths)
        )
        dim_ref = f"A1:{_xlsx_col(ncols - 1)}{len(rows)}"
        sheet_xmls.append(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<dimension ref="{dim_ref}"/>'
            '<sheetViews><sheetView workbookViewId="0">'
            '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
            '</sheetView></sheetViews>'
            f'<cols>{cols_xml}</cols>'
            f'<sheetData>{"".join(row_xml)}</sheetData>'
            '</worksheet>'
        )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        + "".join(
            f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for i in range(len(sheet_xmls))
        )
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        + '</Types>'
    )

    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        '</Relationships>'
    )

    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets>'
        + "".join(
            f'<sheet name="{esc(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
            for i, n in enumerate(sheet_names)
        )
        + '</sheets></workbook>'
    )

    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(
            f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
            for i in range(len(sheet_xmls))
        )
        + f'<Relationship Id="rId{len(sheet_xmls) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + f'<Relationship Id="rId{len(sheet_xmls) + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        + '</Relationships>'
    )

    shared_strings_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared)}" uniqueCount="{len(shared)}">'
        + "".join(f'<si><t xml:space="preserve">{esc(t)}</t></si>' for t in shared)
        + '</sst>'
    )

    core_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:creator>{esc(creator)}</dc:creator>'
        f'<dc:title>{esc(sheet_names[0] if sheet_names else "Export")}</dc:title>'
        '</cp:coreProperties>'
    )
    app_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        f'<Application>{esc(creator)}</Application>'
        '</Properties>'
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook_xml)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/styles.xml", _XLSX_STYLES_XML)
        z.writestr("xl/sharedStrings.xml", shared_strings_xml)
        for i, sx in enumerate(sheet_xmls):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", sx)
        z.writestr("docProps/core.xml", core_xml)
        z.writestr("docProps/app.xml", app_xml)
    return buf.getvalue()


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


_DOCX_STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/>
<w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Title">
<w:name w:val="Title"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="240" w:after="160"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="48"/><w:color w:val="1F2427"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading1">
<w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="120"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="21808D"/></w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading2">
<w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
<w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="200" w:after="100"/></w:pPr>
<w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="21808D"/></w:rPr>
</w:style>
</w:styles>"""


def export_docx(doc_id):
    """Export to a genuine .docx.

    The previous Word export wrote an HTML payload under a .doc extension,
    which makes Word open it with a "the format and extension don't match"
    warning and leaves the result awkward to edit. This builds real
    WordprocessingML instead, carrying over the things that survive the trip
    usefully: paragraph breaks, bold and italic, relative text size, and page
    breaks. Layout-exact conversion is not the goal -- an editable document is.
    """
    import zipfile

    def esc(s):
        return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

    doc = _doc(doc_id)

    # Body size is the most common span size in the document; headings are
    # judged relative to it, so a document set in 9pt is not treated as one
    # long heading just because another is set in 12pt.
    sizes = {}
    for page in doc:
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if span.get("text", "").strip():
                        key = round(float(span.get("size", 11)), 1)
                        sizes[key] = sizes.get(key, 0) + len(span["text"])
    body_size = max(sizes, key=sizes.get) if sizes else 11.0

    paragraphs = []
    for pno, page in enumerate(doc):
        if pno:
            paragraphs.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        for block in page.get_text("dict").get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                runs = []
                largest = 0.0
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text:
                        continue
                    size = float(span.get("size", body_size))
                    largest = max(largest, size)
                    flags = int(span.get("flags", 0))
                    props = []
                    if flags & 16:
                        props.append("<w:b/>")
                    if flags & 2:
                        props.append("<w:i/>")
                    props.append(f'<w:sz w:val="{max(2, int(round(size * 2)))}"/>')
                    runs.append(
                        f'<w:r><w:rPr>{"".join(props)}</w:rPr>'
                        f'<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'
                    )
                if not runs:
                    continue
                if largest >= body_size * 1.8:
                    style = "Title"
                elif largest >= body_size * 1.4:
                    style = "Heading1"
                elif largest >= body_size * 1.15:
                    style = "Heading2"
                else:
                    style = "Normal"
                style_xml = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>'
                paragraphs.append(f"<w:p>{style_xml}{''.join(runs)}</w:p>")

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{"".join(paragraphs)}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
        '</w:body></w:document>'
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        '</Relationships>'
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    meta = doc.metadata or {}
    core_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f'<dc:title>{esc(meta.get("title") or "")}</dc:title>'
        f'<dc:creator>{esc(meta.get("author") or "MiyeePDF")}</dc:creator>'
        '</cp:coreProperties>'
    )
    app_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
        '<Application>MiyeePDF</Application></Properties>'
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("word/document.xml", document_xml)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        z.writestr("word/styles.xml", _DOCX_STYLES_XML)
        z.writestr("docProps/core.xml", core_xml)
        z.writestr("docProps/app.xml", app_xml)
    return base64.b64encode(buf.getvalue()).decode()


def _find_page_tables(page):
    """Detect tables on a page: ruled borders first, then column alignment.

    Most PDFs export from Word/Excel/accounting software draw no ruling lines
    at all -- the "table" is just text lined up in columns -- so a
    ruled-only detector misses almost everything. Falling back to the
    text-alignment strategy only when ruled detection finds nothing keeps
    the common (ruled) case exact while still catching those.
    """
    try:
        found = list(page.find_tables().tables)
    except Exception:
        found = []
    if found:
        return found
    try:
        found = list(page.find_tables(
            vertical_strategy="text", horizontal_strategy="text",
        ).tables)
    except Exception:
        found = []
    return found


def export_tables(doc_id):
    """Detect tables and return them as CSV files."""
    doc = _doc(doc_id)
    out = []
    for pno, page in enumerate(doc):
        for tno, table in enumerate(_find_page_tables(page), 1):
            try:
                rows = table.extract()
            except Exception:
                continue
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


def export_tables_xlsx(doc_id):
    """Detect tables and return them as one real .xlsx workbook, one sheet
    per table -- formatted (bold header, borders, banded rows, auto-fit
    columns, frozen header) rather than a bare grid of values."""
    doc = _doc(doc_id)
    sheets = []
    for pno, page in enumerate(doc):
        for tno, table in enumerate(_find_page_tables(page), 1):
            try:
                rows = table.extract()
            except Exception:
                continue
            if not rows:
                continue
            clean = [["" if c is None else str(c).replace("\n", " ") for c in row] for row in rows]
            sheets.append({"name": f"Page {pno + 1} Table {tno}", "rows": clean})
    if not sheets:
        return json.dumps({"ok": False, "reason": "No tables were detected in this PDF."})
    data = _build_xlsx(sheets, creator="MiyeePDF")
    return json.dumps({
        "ok": True,
        "b64": base64.b64encode(data).decode(),
        "sheets": [{"name": s["name"], "rows": len(s["rows"]),
                    "cols": len(s["rows"][0]) if s["rows"] else 0} for s in sheets],
    })


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


def export_page_images(doc_id, dpi=150, fmt="png", pages_spec="", quality=90):
    """Render pages to PNG/JPEG at a chosen resolution (and JPEG quality)."""
    doc = _doc(doc_id)
    out = []
    for pno in _page_indices(doc, pages_spec):
        pix = doc[pno].get_pixmap(dpi=int(dpi))
        if fmt == "jpeg" and pix.alpha:
            pix = pymupdf.Pixmap(pix, 0)
        out.append({
            "name": f"page-{pno + 1}.{'jpg' if fmt == 'jpeg' else 'png'}",
            "b64": base64.b64encode(pix.tobytes(fmt, jpg_quality=int(quality))).decode(),
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


# --------------------------------------------------------------------------
# sensitive-data discovery
# --------------------------------------------------------------------------

# Ordered most-specific first. When two patterns claim overlapping text the
# earlier entry wins, which stops an IFSC code being found inside a GSTIN or a
# "phone number" being found inside a card number.
_SENSITIVE_PATTERNS = [
    ("GSTIN",    r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[Z][A-Z\d]\b",            "GST registration number"),
    ("PAN",      r"\b[A-Z]{5}\d{4}[A-Z]\b",                             "Permanent Account Number"),
    ("IFSC",     r"\b[A-Z]{4}0[A-Z0-9]{6}\b",                           "Bank branch (IFSC) code"),
    ("Card",     r"\b(?:\d[ -]?){12,18}\d\b",                           "Payment card number"),
    ("Aadhaar",  r"\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b",                 "Aadhaar number"),
    ("Email",    r"\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b",                     "Email address"),
    ("Phone",    r"(?:\+91[ -]?)?\b[6-9]\d{9}\b",                       "Mobile number"),
    ("Account",  r"\b\d{9,18}\b",                                       "Bank account number"),
    ("IPAddr",   r"\b(?:\d{1,3}\.){3}\d{1,3}\b",                        "IP address"),
]

_VERHOEFF_D = (
    (0,1,2,3,4,5,6,7,8,9),(1,2,3,4,0,6,7,8,9,5),(2,3,4,0,1,7,8,9,5,6),
    (3,4,0,1,2,8,9,5,6,7),(4,0,1,2,3,9,5,6,7,8),(5,9,8,7,6,0,4,3,2,1),
    (6,5,9,8,7,1,0,4,3,2),(7,6,5,9,8,2,1,0,4,3),(8,7,6,5,9,3,2,1,0,4),
    (9,8,7,6,5,4,3,2,1,0),
)
_VERHOEFF_P = (
    (0,1,2,3,4,5,6,7,8,9),(1,5,7,6,2,8,3,0,9,4),(5,8,0,3,7,9,6,1,4,2),
    (8,9,1,6,0,4,3,5,2,7),(9,4,5,3,1,2,6,8,7,0),(4,2,8,6,5,7,3,9,0,1),
    (2,7,9,3,8,0,6,4,1,5),(7,0,4,6,9,1,3,2,5,8),
)


def _luhn_ok(digits):
    """Standard card checksum - rejects most random digit runs."""
    total, alt = 0, False
    for ch in reversed(digits):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def _verhoeff_ok(digits):
    """Aadhaar checksum. Without it any 12-digit invoice figure looks like one."""
    c = 0
    for i, ch in enumerate(reversed(digits)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def _validate_hit(kind, text):
    """Second-stage check so a matching shape alone is not enough."""
    digits = "".join(ch for ch in text if ch.isdigit())
    if kind == "Card":
        return 13 <= len(digits) <= 19 and _luhn_ok(digits)
    if kind == "Aadhaar":
        return len(digits) == 12 and _verhoeff_ok(digits)
    if kind == "IPAddr":
        return all(0 <= int(p) <= 255 for p in text.split("."))
    if kind == "Account":
        # A bare digit run is the weakest signal; keep it plausible.
        return 9 <= len(digits) <= 18
    return True


def _page_word_index(page):
    """Join a page's words into one string, remembering each word's rect.

    Working from positioned words (rather than the raw text) means a match that
    straddles a line break still maps back to the right rectangles.
    """
    words = page.get_text("words")
    parts, spans = [], []
    cursor = 0
    for w in words:
        token = w[4]
        if not token:
            continue
        start = cursor
        parts.append(token)
        cursor += len(token)
        spans.append((start, cursor, pymupdf.Rect(w[0], w[1], w[2], w[3])))
        parts.append(" ")
        cursor += 1
    return "".join(parts), spans


def scan_sensitive(doc_id, kinds_json=None):
    """Find personal and financial identifiers across the document.

    Returns one entry per occurrence with the page, the matched text and the
    rectangles covering it, ready to feed straight into redaction.
    """
    import re

    doc = _doc(doc_id)
    wanted = None
    if kinds_json:
        wanted = set(json.loads(kinds_json) if isinstance(kinds_json, str) else kinds_json)

    compiled = [(k, re.compile(p), label) for k, p, label in _SENSITIVE_PATTERNS
                if wanted is None or k in wanted]

    results = []
    for pno, page in enumerate(doc):
        text, spans = _page_word_index(page)
        if not text.strip():
            continue
        pw, ph = page.rect.width, page.rect.height

        claimed = []          # char ranges already taken by a more specific pattern
        for kind, rx, label in compiled:
            for m in rx.finditer(text):
                start, end = m.span()
                value = m.group().strip()
                if not _validate_hit(kind, value):
                    continue
                if any(start < c_end and end > c_start for c_start, c_end in claimed):
                    continue
                claimed.append((start, end))

                rects = [r for s, e, r in spans if s < end and e > start]
                if not rects:
                    continue
                results.append({
                    "page": pno,
                    "kind": kind,
                    "label": label,
                    "text": value,
                    "rects": [{"xFrac": r.x0 / pw, "yFrac": r.y0 / ph,
                               "wFrac": r.width / pw, "hFrac": r.height / ph} for r in rects],
                })

    summary = {}
    for hit in results:
        summary[hit["kind"]] = summary.get(hit["kind"], 0) + 1
    return json.dumps({"hits": results, "summary": summary, "total": len(results)})


def redact_hits(doc_id, hits_json, fill="#000000"):
    """Permanently remove the scanned hits the user selected."""
    doc = _doc(doc_id)
    hits = json.loads(hits_json) if isinstance(hits_json, str) else hits_json
    colour = _hex_to_rgb(fill)
    touched = set()

    for hit in hits:
        page = doc[int(hit["page"])]
        for r in hit["rects"]:
            rect = _rect_from_fracs(page, float(r["xFrac"]), float(r["yFrac"]),
                                    float(r["xFrac"]) + float(r["wFrac"]),
                                    float(r["yFrac"]) + float(r["hFrac"]))
            page.add_redact_annot(rect, fill=colour)
        touched.add(int(hit["page"]))

    for pno in touched:
        doc[pno].apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)
    return len(hits)


# --------------------------------------------------------------------------
# document inspection & sanitising
# --------------------------------------------------------------------------

def inspect(doc_id):
    """Report what a PDF carries beyond its visible pages.

    Answers the practical question "is this safe to send outside?" - author
    names, revision tooling, attachments, scripts, hidden layers and off-page
    annotations all travel with a file and are easy to forget.
    """
    doc = _doc(doc_id)
    findings = []

    def flag(level, area, detail):
        findings.append({"level": level, "area": area, "detail": detail})

    meta = {k: v for k, v in (doc.metadata or {}).items() if v}
    for key in ("author", "title", "subject", "keywords", "creator", "producer"):
        if meta.get(key):
            flag("warn" if key in ("author", "keywords", "subject") else "info",
                 f"Metadata · {key}", meta[key])

    try:
        xml = doc.get_xml_metadata()
        if xml:
            flag("warn", "XMP metadata", f"{len(xml)} characters of embedded XMP")
    except Exception:
        pass

    try:
        n = doc.embfile_count()
        if n:
            names = ", ".join(doc.embfile_names())
            flag("risk", "Embedded files", f"{n} attached file(s): {names}")
    except Exception:
        pass

    # JavaScript lives under the catalog's /Names tree.
    try:
        cat = doc.pdf_catalog()
        kind, value = doc.xref_get_key(cat, "Names/JavaScript")
        if kind and kind != "null":
            flag("risk", "JavaScript", "Document-level JavaScript is present")
    except Exception:
        pass

    try:
        ocgs = doc.get_ocgs()
        if ocgs:
            hidden = [v.get("name", "?") for v in ocgs.values() if not v.get("on", True)]
            flag("warn" if hidden else "info", "Optional layers",
                 f"{len(ocgs)} layer(s)" + (f"; hidden: {', '.join(hidden)}" if hidden else ""))
    except Exception:
        pass

    annots, links, scanned = 0, 0, []
    for pno, page in enumerate(doc):
        annots += len(list(page.annots()))
        page_links = page.get_links()
        links += len(page_links)
        for link in page_links:
            if link.get("uri"):
                flag("info", "External link", f"page {pno + 1}: {link['uri']}")
        if len(page.get_text().strip()) < 12 and page.get_images():
            scanned.append(pno + 1)

    if annots:
        flag("warn", "Annotations", f"{annots} comment/markup annotation(s) still attached")
    if scanned:
        preview = ", ".join(str(p) for p in scanned[:12])
        flag("info", "Scanned pages",
             f"{len(scanned)} page(s) have no searchable text (p{preview}"
             + ("…)" if len(scanned) > 12 else ")"))
    if doc.is_form_pdf:
        flag("warn", "Form fields", "Fillable form fields are present and may hold entered data")

    fonts, embedded = set(), 0
    for page in doc:
        for f in page.get_fonts(full=True):
            fonts.add(f[3])
            if f[1]:
                embedded += 1
    if fonts:
        flag("info", "Fonts", f"{len(fonts)} font(s): {', '.join(sorted(fonts)[:6])}")

    order = {"risk": 0, "warn": 1, "info": 2}
    findings.sort(key=lambda f: order.get(f["level"], 3))
    counts = {"risk": 0, "warn": 0, "info": 0}
    for f in findings:
        counts[f["level"]] = counts.get(f["level"], 0) + 1

    return json.dumps({
        "findings": findings,
        "counts": counts,
        "pages": doc.page_count,
        "encrypted": _WAS_ENCRYPTED.get(doc_id, False),
    })


def sanitize(doc_id, metadata=True, attachments=True, javascript=True,
             annotations=True, links=True, forms=True, hidden_text=True):
    """Strip the parts of a document that travel invisibly.

    Returns a plain-language list of what was removed so the action is auditable.
    """
    doc = _doc(doc_id)
    removed = []

    before_meta = {k: v for k, v in (doc.metadata or {}).items() if v}
    before_annots = sum(len(list(p.annots())) for p in doc)
    before_links = sum(len(p.get_links()) for p in doc)
    try:
        before_files = doc.embfile_count()
    except Exception:
        before_files = 0

    doc.scrub(
        metadata=bool(metadata),
        attached_files=bool(attachments),
        embedded_files=bool(attachments),
        javascript=bool(javascript),
        remove_links=bool(links),
        reset_fields=bool(forms),
        hidden_text=bool(hidden_text),
        clean_pages=True,
        redactions=True,
        reset_responses=bool(annotations),
        thumbnails=True,
        xml_metadata=bool(metadata),
    )

    if metadata and before_meta:
        removed.append(f"Document metadata ({', '.join(sorted(before_meta))})")
    if attachments and before_files:
        removed.append(f"{before_files} embedded file(s)")
    if javascript:
        removed.append("Any document-level JavaScript")
    if links and before_links:
        removed.append(f"{before_links} link(s)")
    if annotations and before_annots:
        removed.append(f"Responses on {before_annots} annotation(s)")
    if hidden_text:
        removed.append("Hidden (invisible-render) text")

    return json.dumps({"removed": removed})


# --------------------------------------------------------------------------
# find & replace across the document
# --------------------------------------------------------------------------

def _span_at(page, rect):
    """The text span sitting under a rectangle, for font/size/colour matching."""
    best, best_area = None, 0
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                sr = pymupdf.Rect(span["bbox"])
                inter = sr & rect
                if not inter.is_empty:
                    area = inter.get_area()
                    if area > best_area:
                        best, best_area = span, area
    return best


def find_occurrences(doc_id, needle, pages_spec=""):
    """Preview every place a phrase appears, before changing anything."""
    doc = _doc(doc_id)
    out = []
    for pno in _page_indices(doc, pages_spec):
        page = doc[pno]
        pw, ph = page.rect.width, page.rect.height
        for rect in page.search_for(needle):
            span = _span_at(page, rect)
            out.append({
                "page": pno,
                "font": (span or {}).get("font", ""),
                "size": round((span or {}).get("size", 0), 1),
                "xFrac": rect.x0 / pw, "yFrac": rect.y0 / ph,
                "wFrac": rect.width / pw, "hFrac": rect.height / ph,
            })
    return json.dumps({"count": len(out), "hits": out})


def find_replace(doc_id, needle, replacement, pages_spec=""):
    """Replace every occurrence, keeping each hit's own font, size and colour.

    The original glyphs are removed from the content stream rather than covered,
    so the replaced text cannot be recovered by selecting the page.
    """
    doc = _doc(doc_id)
    replaced = 0

    for pno in _page_indices(doc, pages_spec):
        page = doc[pno]
        hits = page.search_for(needle)
        if not hits:
            continue

        # Capture styling - and the document's own font - before redaction
        # destroys the spans that reference them.
        styled = []
        for rect in hits:
            span = _span_at(page, rect)
            name = span["font"] if span else ""
            flags = span["flags"] if span else 0
            buf, _ = _grab_embedded_font(doc, page, name, replacement)
            styled.append((
                rect, name, flags, buf,
                float(span["size"]) if span else rect.height * 0.8,
                _int_to_rgb(int(span["color"])) if span else (0, 0, 0),
            ))
            page.add_redact_annot(rect)

        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)

        for rect, name, flags, buf, size, colour in styled:
            if replacement:
                font, measurer, _exact = _register_font(page, buf, name, flags)
                # Allow a little bleed past the old width; text rarely matches length.
                size = _fit_size(replacement, font, size, rect.width * 1.8, measurer)
                page.insert_text((rect.x0, rect.y1 - size * 0.22), replacement,
                                 fontsize=size, fontname=font, color=colour)
            replaced += 1

    return replaced


# --------------------------------------------------------------------------
# split a bundle wherever a pattern appears
# --------------------------------------------------------------------------

def _safe_name(text, fallback):
    keep = "".join(c if (c.isalnum() or c in " -_") else "-" for c in text).strip()
    keep = "-".join(keep.split())
    return (keep[:60] or fallback)


def split_by_pattern(doc_id, pattern, use_regex=False, name_from_match=True, preview=False):
    """Cut a combined document into parts wherever a marker appears.

    Built for statement and invoice bundles: each page carrying the marker
    starts a new document, and the matched text can name the file.
    """
    import re

    doc = _doc(doc_id)
    rx = re.compile(pattern, re.I) if use_regex else None

    starts = []
    for pno, page in enumerate(doc):
        text = page.get_text()
        matched = None
        if use_regex:
            m = rx.search(text)
            matched = m.group(0) if m else None
        elif pattern.lower() in text.lower():
            idx = text.lower().index(pattern.lower())
            # Take the rest of that line so an invoice number comes along too.
            matched = text[idx:idx + 60].splitlines()[0]
        if matched:
            starts.append((pno, matched.strip()))

    if not starts:
        return json.dumps({"parts": [], "message": "No page matched that pattern."})

    parts = []
    for i, (start, matched) in enumerate(starts):
        end = starts[i + 1][0] - 1 if i + 1 < len(starts) else doc.page_count - 1
        name = _safe_name(matched, f"part-{i + 1}") if name_from_match else f"part-{i + 1}"
        entry = {"name": f"{name}.pdf", "from": start + 1, "to": end + 1,
                 "pages": end - start + 1, "match": matched}
        if not preview:
            piece = pymupdf.open()
            piece.insert_pdf(doc, from_page=start, to_page=end)
            entry["b64"] = base64.b64encode(piece.tobytes(garbage=3, deflate=True)).decode()
            piece.close()
        parts.append(entry)

    return json.dumps({"parts": parts, "count": len(parts)})


# --------------------------------------------------------------------------
# paragraph-level editing and the document outline
# --------------------------------------------------------------------------

def get_blocks(doc_id, pno):
    """Paragraph-sized text blocks, for editing a whole passage at once."""
    page = _doc(doc_id)[int(pno)]
    pw, ph = page.rect.width, page.rect.height
    out = []
    for block in page.get_text("dict")["blocks"]:
        if block.get("type") != 0:
            continue
        spans = [s for line in block["lines"] for s in line["spans"] if s["text"].strip()]
        if not spans:
            continue
        text = "".join(
            "".join(s["text"] for s in line["spans"]) + " " for line in block["lines"]
        ).strip()
        if not text:
            continue
        lead = max(spans, key=lambda s: len(s["text"]))
        x0, y0, x1, y1 = block["bbox"]
        out.append({
            "text": text,
            "font": lead["font"],
            "size": round(lead["size"], 2),
            "colorInt": lead["color"],
            "flags": lead["flags"],
            "bbox": [x0, y0, x1, y1],
            "lines": len(block["lines"]),
            "xFrac": x0 / pw, "yFrac": y0 / ph,
            "wFrac": (x1 - x0) / pw, "hFrac": (y1 - y0) / ph,
        })
    return json.dumps(out)


def edit_block(doc_id, pno, bbox, new_text, font_name="", size=0, color_int=0,
               flags=0, grow=True):
    """Replace a whole paragraph, reflowing the replacement inside its box.

    Unlike span editing this rewraps across lines, so the new wording does not
    have to be the same length as the old.
    """
    doc = _doc(doc_id)
    page = doc[int(pno)]
    x0, y0, x1, y1 = [float(v) for v in bbox]
    rect = pymupdf.Rect(x0, y0, x1, y1)

    # Same as edit_text: capture the document's own font before redaction.
    buf, _ = _grab_embedded_font(doc, page, font_name, new_text)
    colour = _int_to_rgb(int(color_int))
    start_size = float(size) or 11.0

    page.add_redact_annot(rect)
    page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)

    if not new_text:
        return json.dumps({"ok": True, "size": 0, "grew": False, "exact": False})

    font, _measurer, exact = _register_font(page, buf, font_name, flags)

    # A paragraph may need more room than the original occupied. Try the box as
    # it is, then allow it to grow downward, and only then shrink the type.
    target = pymupdf.Rect(rect)
    grew = False
    for attempt in range(3):
        probe = pymupdf.open()
        probe_page = probe.new_page(width=page.rect.width, height=page.rect.height)
        # The reused font is registered on the real page only, so the throwaway
        # measuring page needs its own copy or the probe measures the wrong face.
        if exact and buf:
            try:
                probe_page.insert_font(fontname=font, fontbuffer=buf)
            except Exception:
                pass
        leftover = probe_page.insert_textbox(target, new_text, fontsize=start_size,
                                             fontname=font, align=0)
        probe.close()
        if leftover >= 0:
            break
        if grow and attempt == 0:
            room = page.rect.height - target.y1 - 24
            if room > 12:
                target = pymupdf.Rect(target.x0, target.y0, target.x1,
                                      min(page.rect.height - 24, target.y1 + room))
                grew = True
                continue
        start_size = max(5.0, start_size - 1.0)

    page.insert_textbox(target, new_text, fontsize=start_size, fontname=font,
                        color=colour, align=0)
    return json.dumps({"ok": True, "size": round(start_size, 1), "grew": grew, "exact": exact})


def get_outline(doc_id):
    """The document's bookmark tree as [[level, title, page], …]."""
    return json.dumps(_doc(doc_id).get_toc() or [])


def set_outline(doc_id, toc_json):
    """Replace the bookmark tree. Levels must start at 1 and step by one."""
    doc = _doc(doc_id)
    toc = json.loads(toc_json) if isinstance(toc_json, str) else toc_json

    cleaned, last_level = [], 0
    for row in toc:
        level = max(1, int(row[0]))
        title = str(row[1]).strip() or "Untitled"
        page = min(max(1, int(row[2])), doc.page_count)
        # PDF outlines reject a jump of more than one level at a time.
        level = min(level, last_level + 1)
        cleaned.append([level, title, page])
        last_level = level

    doc.set_toc(cleaned)
    return len(cleaned)
