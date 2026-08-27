/* MiyeePDF - UI layer.
 *
 * All PDF work happens in pdf_engine.py, so this file only handles chrome:
 * loading files, drawing pages, collecting options and shuttling them across
 * the engine bridge.
 */

/* ------------------------------------------------------------------ */
/* engine bridge                                                       */
/* ------------------------------------------------------------------ */

// Keep in step with the ?v= query on the script/style tags in index.html so a
// redeploy never leaves a browser running a stale mix of old and new assets.
const APP_VERSION = '4.10.0';
const PYODIDE_VERSION = '314.0.5';
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYMUPDF_WHEEL = 'vendor/pymupdf-1.28.2-cp313-abi3-pyemscripten_2025_0_wasm32.whl';

class PyEngine {
    constructor() {
        this.pyodide = null;
        this.module = null;
        this.ready = false;
        this.error = null;
        this._promise = null;
        this.onStep = null;
        this.lastMessage = 'Getting things ready…';
        this.lastPct = 0;
    }

    /** Boot the engine. Safe to await from anywhere; only runs once.
     *
     * Progress is reported through `onStep`, which can be attached after boot
     * has already started - that lets the download begin the moment this file
     * parses, rather than waiting for DOMContentLoaded and the UI wiring.
     */
    boot() {
        if (!this._promise) this._promise = this._boot((msg, pct) => this._report(msg, pct));
        return this._promise;
    }

    _report(message, pct) {
        this.lastMessage = message;
        this.lastPct = pct;
        if (this.onStep) this.onStep(message, pct);
    }

    /** Approximate the wheel download for the progress bar.
     *
     * loadPackage() owns the actual fetch - it is the only thing that reliably
     * installs the package, and prefetching separately made the browser
     * download all 17 MB twice (loadPackage treats a path as a URL, so it
     * cannot be handed bytes, and HTTP-cache dedupe is not dependable). So the
     * bar is advanced on a timer sized to the payload instead, and snaps to
     * completion when the install actually returns.
     */
    _fakeProgress(from, to, expectedMs, onStep, label) {
        const started = Date.now();
        const timer = setInterval(() => {
            const frac = Math.min(0.97, (Date.now() - started) / expectedMs);
            onStep(label, from + (to - from) * frac);
        }, 250);
        return () => clearInterval(timer);
    }

    async _boot(onStep = () => {}) {
        try {
            // Kick the wheel download off immediately, then init Pyodide while
            // it streams in. These used to run one after the other.
            onStep('Setting up your workspace…', 5);
            let stop = this._fakeProgress(5, 45, 12000, onStep, 'Setting up your workspace…');
            this.pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX });
            stop();

            onStep('Downloading PDF tools (17 MB)…', 45);
            stop = this._fakeProgress(45, 88, 20000, onStep, 'Downloading PDF tools (17 MB)…');
            await this.pyodide.loadPackage(PYMUPDF_WHEEL);
            stop();

            onStep('Almost ready…', 90);
            const source = await (await fetch(`pdf_engine.py?v=${APP_VERSION}`)).text();
            this.pyodide.FS.writeFile('/pdf_engine.py', source);
            this.pyodide.runPython('import sys\nif "/" not in sys.path: sys.path.insert(0, "/")');
            this.module = this.pyodide.pyimport('pdf_engine');

            onStep('Ready', 100);
            this.ready = true;
            return this;
        } catch (err) {
            this.error = err;
            console.error('Engine failed to start:', err);
            throw err;
        }
    }

    /** Call a function in pdf_engine.py. Engine exceptions surface as JS errors. */
    async call(fn, ...args) {
        if (!this.ready) await this.boot();
        const target = this.module[fn];
        if (!target) throw new Error(`pdf_engine has no function '${fn}'`);
        const result = target(...args);
        return this._unwrap(result);
    }

    /** Same as call(), but parses a JSON string result. */
    async callJSON(fn, ...args) {
        const raw = await this.call(fn, ...args);
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    }

    /** Open a PDF, asking for the password if the file turns out to be
     * encrypted. Every tool loads documents through here, so a protected file
     * behaves the same way wherever it is opened rather than failing with a
     * raw engine error in fourteen of the fifteen tabs.
     *
     * Returns the same metadata as open_doc. Throws CANCELLED if the person
     * dismisses the prompt, which the busy-wrapper treats as "no error".
     */
    async openDoc(docId, bytes, fileName = '') {
        let password = '';
        let retry = false;
        for (;;) {
            try {
                return await this.callJSON('open_doc', docId, bytes, password);
            } catch (err) {
                if (!String(err.message || err).includes('PASSWORD_REQUIRED')) throw err;
                password = await UI.askPassword(fileName, retry);
                if (password === null) throw new Error('CANCELLED');
                retry = true;
            }
        }
    }

    _unwrap(value) {
        if (value && typeof value.toJs === 'function') {
            const converted = value.toJs({ create_pyproxies: false });
            value.destroy();
            return converted;
        }
        if (value && typeof value.getBuffer === 'function') {
            const buf = value.getBuffer();
            const copy = new Uint8Array(buf.data);
            buf.release();
            value.destroy();
            return copy;
        }
        return value;
    }
}

const engine = new PyEngine();

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function download(data, filename, mime = 'application/pdf') {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** PDF colour integer (0xRRGGBB) as a CSS colour. */
function intToCss(value) {
    return `#${(Number(value) >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`;
}

/* PyMuPDF span flags: 2 = italic, 4 = serifed, 8 = monospaced, 16 = bold. */
const FLAG_ITALIC = 2, FLAG_SERIF = 4, FLAG_MONO = 8, FLAG_BOLD = 16;

/** A widely installed stack that resembles a PDF font the browser cannot load.
 *
 * Used when a font is not embedded, or is embedded in a format (bare CFF,
 * Type 1) that browsers refuse - the on-screen text still reads as the same
 * kind of face as the page around it.
 */
function lookalikeFont(name, flags = 0) {
    const n = String(name || '').split('+').pop().toLowerCase();
    const bold = (flags & FLAG_BOLD) !== 0 || /bold|black|heavy|semibold|\bbd\b/.test(n);
    const italic = (flags & FLAG_ITALIC) !== 0 || /italic|oblique/.test(n);
    let family = '"Helvetica Neue", Helvetica, Arial, sans-serif';
    if ((flags & FLAG_MONO) !== 0 || /mono|courier|consol|menlo/.test(n)) {
        family = '"Courier New", Courier, monospace';
    } else if (/times|serif|georgia|garamond|cambria|roman|minion|book(?!man old)/.test(n)
               || ((flags & FLAG_SERIF) !== 0 && !/sans|arial|helvet|roboto|calibri/.test(n))) {
        family = 'Georgia, "Times New Roman", Times, serif';
    }
    return { family, weight: bold ? '700' : '400', style: italic ? 'italic' : 'normal' };
}

async function fileToBytes(file) {
    if (file.size > 200 * 1024 * 1024) throw new Error('File too large (max 200 MB)');
    return new Uint8Array(await file.arrayBuffer());
}

/* ------------------------------------------------------------------ */
/* application shell                                                   */
/* ------------------------------------------------------------------ */

const UI = {
    theme: 'light',

    init() {
        this.setupTabs();
        this.setupTheme();
        this.setupPickers();
        // Wire every tool straight away. These only attach listeners and render
        // markup, so the app is fully browsable while the engine downloads -
        // waiting for it here is what made the page look frozen on first visit.
        Tools.forEach((t) => { if (t.init) t.init(); });
        this.bootEngine();
    },

    setupTabs() {
        $$('.tab-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.showTab(btn.dataset.tab));
        });
    },

    /** Single entry point for switching tools, shared by the nav and the dashboard. */
    showTab(name) {
        const target = `${name}-tab`;
        if (!$(target)) return;
        $$('.tab-btn').forEach((b) => {
            const on = b.dataset.tab === name;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
            // On a phone the strip scrolls; keep the chosen tab in view.
            if (on && b.scrollIntoView) {
                b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });
        $$('.tab-content').forEach((c) => c.classList.toggle('active', c.id === target));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    setupTheme() {
        const toggle = $('theme-toggle');
        toggle.addEventListener('click', () => {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-color-scheme', this.theme);
            toggle.textContent = this.theme === 'dark' ? '☀️' : '🌙';
        });
        document.documentElement.setAttribute('data-color-scheme', this.theme);
    },

    /** Wire every "Select PDF" button and drop zone declaratively. */
    setupPickers() {
        $$('[data-pick]').forEach((btn) => {
            btn.addEventListener('click', () => $(btn.dataset.pick).click());
        });
        $$('[data-drop]').forEach((zone) => {
            const input = $(`${zone.dataset.drop}-file`);
            zone.addEventListener('click', (e) => {
                if (e.target === zone || e.target.tagName === 'P') input.click();
            });
            // The zone is reachable by keyboard, so it has to respond to one.
            zone.addEventListener('keydown', (e) => {
                if (e.target !== zone) return;
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
            });
            ['dragenter', 'dragover'].forEach((ev) =>
                zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
            ['dragleave', 'drop'].forEach((ev) =>
                zone.addEventListener(ev, () => zone.classList.remove('drag-over')));
            zone.addEventListener('drop', (e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
                if (files.length) {
                    const dt = new DataTransfer();
                    files.forEach((f) => dt.items.add(f));
                    input.files = dt.files;
                    input.dispatchEvent(new Event('change'));
                }
            });
        });
    },

    /** Latest boot message, so a tool waiting on the engine can show progress. */
    bootMessage: 'Getting things ready…',

    async bootEngine() {
        const step = $('engine-loading-step');
        const fill = $('engine-progress-fill');
        const badge = $('engine-badge');
        const badgeText = $('engine-badge-text');

        const paint = (message, pct) => {
            this.bootMessage = message;
            step.textContent = message;
            fill.style.width = `${pct}%`;
            badgeText.textContent = message.length > 34 ? `${Math.round(pct)}%` : message;
            // Keep a waiting operation's spinner in step with the download.
            if (!$('status-container').classList.contains('hidden')) {
                $('status-text').textContent = message;
            }
        };

        try {
            // Boot already began at parse time; attach to it and catch up.
            engine.onStep = paint;
            paint(engine.lastMessage, engine.lastPct);
            await engine.boot();
            $('engine-loading').classList.add('hidden');
            badge.className = 'engine-badge engine-badge--ready';
            badgeText.textContent = 'Ready';
        } catch (err) {
            this.bootMessage = 'Setup failed';
            step.textContent = 'Could not finish setting up. Please check your connection and reload the page.';
            fill.style.width = '100%';
            fill.style.background = 'var(--color-error)';
            badge.className = 'engine-badge engine-badge--error';
            badgeText.textContent = 'Setup failed';
        }
    },

    busy(message) {
        $('status-text').textContent = message;
        $('status-container').classList.remove('hidden');
    },

    idle() {
        $('status-container').classList.add('hidden');
    },

    toast(message, type = 'info') {
        $$('.toast').forEach((t) => t.remove());
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.textContent = message;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3600);
    },

    /** Ask for a PDF password. Resolves to the text typed, or null if the
     * person cancelled. Uses a real dialog rather than window.prompt(), which
     * mobile browsers render badly and some contexts block outright. */
    askPassword(fileName = '', retry = false) {
        const modal = $('pw-modal');
        const input = $('pw-input');
        const error = $('pw-error');
        $('pw-file').textContent = fileName ? `${fileName} needs a password to open.` : '';
        error.classList.toggle('hidden', !retry);
        input.value = '';
        modal.classList.remove('hidden');
        setTimeout(() => input.focus(), 50);

        return new Promise((resolve) => {
            const finish = (value) => {
                modal.classList.add('hidden');
                $('pw-submit').removeEventListener('click', onSubmit);
                input.removeEventListener('keydown', onKey);
                $$('[data-pwclose]', modal).forEach((el) => el.removeEventListener('click', onCancel));
                resolve(value);
            };
            const onSubmit = () => { if (input.value) finish(input.value); };
            const onCancel = () => finish(null);
            const onKey = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); onSubmit(); }
                if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            };
            $('pw-submit').addEventListener('click', onSubmit);
            input.addEventListener('keydown', onKey);
            $$('[data-pwclose]', modal).forEach((el) => el.addEventListener('click', onCancel));
        });
    },

    /** Turn an engine exception into something worth showing a person.
     * Python tracebacks arrive as one long string; the last line is the
     * useful part, but the raw text still reads like a crash report. */
    explain(err) {
        const raw = String(err && err.message || err);
        const last = raw.split('\n').filter(Boolean).pop() || 'Something went wrong';
        const known = [
            [/PASSWORD_REQUIRED/, 'This PDF is password-protected.'],
            [/needs a password|encrypted/i, 'This PDF is password-protected.'],
            [/cannot open broken|no objects found|not a (pdf|textpage)|format error|syntax error/i,
             'This file could not be read as a PDF. It may be damaged or not really a PDF.'],
            [/File too large/i, last],
            [/out of memory|Aborted|RangeError|allocation/i,
             'This file is too big to process in the browser. Try splitting it into smaller parts first.'],
            [/NetworkError|Failed to fetch/i,
             'A download failed. Check your connection and try again.'],
        ];
        for (const [pattern, friendly] of known) if (pattern.test(raw)) return friendly;
        // Strip the "PythonError: ExceptionType: " preamble Pyodide prepends.
        return last.replace(/^\w*(Error|Exception):\s*/, '').trim() || 'Something went wrong';
    },

    /** Run an async job with a spinner and uniform error reporting. */
    async run(message, job) {
        // On first use the engine may still be arriving; say so rather than
        // showing a task message that looks stuck.
        this.busy(engine.ready ? message : this.bootMessage);
        try {
            return await job();
        } catch (err) {
            // Dismissing the password prompt is a choice, not a failure.
            if (String(err.message || err).includes('CANCELLED')) return null;
            console.error(err);
            this.toast(this.explain(err), 'error');
            return null;
        } finally {
            this.idle();
        }
    },
};

/* ------------------------------------------------------------------ */
/* reusable single-document page viewer                                */
/* ------------------------------------------------------------------ */

class DocView {
    /** @param {string} key matches the element id prefix used in index.html */
    constructor(key, { onRender } = {}) {
        this.key = key;
        this.docId = key;
        this.page = 0;
        this.pages = 0;
        this.info = null;
        this.file = null;
        this.onRender = onRender;

        this.img = $(`${key}-page-img`);
        this.holder = $(`${key}-holder`);
        this.overlay = $(`${key}-overlay`);

        // 0 means fit-to-width; anything else is a multiple of that.
        this.zoom = 0;

        $$(`[data-nav="${key}"]`).forEach((btn) => {
            btn.addEventListener('click', () => this.go(this.page + Number(btn.dataset.dir)));
        });
        // Scoped by key, like the page-navigation buttons: an unscoped
        // [data-zoom] selector binds every viewer to one tab's controls, so
        // zooming here would try to render documents that are not open.
        $$(`[data-zoom-for="${key}"]`).forEach((btn) => {
            btn.addEventListener('click', () => this.setZoom(btn.dataset.zoom));
        });
    }

    /** Zoom the page. Overlays are positioned in percentages, so they follow
     *  the image without any recalculation; only the render resolution and the
     *  holder width change. */
    async setZoom(action) {
        const steps = [1, 1.25, 1.5, 2, 3, 4];
        const current = this.zoom || 1;
        if (action === 'reset') {
            this.zoom = 0;
        } else if (action === 'in') {
            this.zoom = steps.find((s) => s > current + 0.001) || steps[steps.length - 1];
        } else if (action === 'out') {
            const below = steps.filter((s) => s < current - 0.001);
            this.zoom = below.length ? below[below.length - 1] : 0;
        } else {
            this.zoom = Number(action) || 0;
        }
        this.applyZoom();
        // Re-render sharper when magnified, so zooming shows more detail
        // rather than a bigger blur.
        await this.render();
    }

    applyZoom() {
        if (!this.holder) return;
        if (this.zoom) {
            this.holder.style.width = `${this.zoom * 100}%`;
            this.holder.style.maxWidth = 'none';
        } else {
            this.holder.style.width = '';
            this.holder.style.maxWidth = '';
        }
        const label = $(`${this.key}-zoom-level`);
        if (label) label.textContent = this.zoom ? `${Math.round(this.zoom * 100)}%` : 'Fit';
    }

    async load(file) {
        const bytes = await fileToBytes(file);
        this.file = file;
        this.info = await engine.openDoc(this.docId, bytes, file.name);
        this.pages = this.info.pages;
        this.page = 0;
        $(`${this.key}-workspace`).classList.remove('hidden');
        await this.render();
        return this.info;
    }

    async go(index) {
        if (index < 0 || index >= this.pages) return;
        this.page = index;
        await this.render();
    }

    async render() {
        // Render at the zoom level so magnifying reveals detail instead of
        // enlarging the same pixels. Capped so a 4x zoom cannot ask for a
        // page render big enough to stall the tab.
        const dpi = Math.round(Math.min(110 * Math.max(this.zoom || 1, 1), 300));
        const png = await engine.call('render_page', this.docId, this.page, dpi);
        if (this._url) URL.revokeObjectURL(this._url);
        this._url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
        await new Promise((resolve) => {
            this.img.onload = resolve;
            this.img.src = this._url;
        });
        const info = $(`${this.key}-page-info`);
        if (info) info.textContent = `${this.page + 1}/${this.pages}`;
        if (this.overlay) this.overlay.innerHTML = '';
        if (this.onRender) await this.onRender();
    }

    /** Pointer position on the page as 0..1 fractions. */
    fracFromEvent(e) {
        const r = this.overlay.getBoundingClientRect();
        return {
            x: Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1),
            y: Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1),
        };
    }

    async save(filename) {
        const bytes = await engine.call('save', this.docId);
        download(bytes, filename);
    }
}

/* ------------------------------------------------------------------ */
/* 1. Edit text + annotate                                             */
/* ------------------------------------------------------------------ */

const EditTool = {
    mode: 'TEXT',
    spans: [],
    editing: null,
    fontCache: new Map(),

    init() {
        this.view = new DocView('edit', { onRender: () => this.drawSpans() });
        $('edit-file').addEventListener('change', (e) => this.open(e.target.files[0]));

        $$('[data-editmode]').forEach((btn) => btn.addEventListener('click', () => {
            this.mode = btn.dataset.editmode;
            $$('[data-editmode]').forEach((b) => b.classList.toggle('active', b === btn));
            $('edit-hint').textContent =
                this.mode === 'TEXT' ? 'Tap a highlighted line and type - you edit straight on the page. Clear the box to delete the line.'
              : this.mode === 'BLOCK' ? 'Tap a paragraph and rewrite it in place - the text rewraps to fit.'
              : this.mode === 'ADD' ? 'Tap anywhere on the page to add new text there.'
              : `Drag across the page to add a ${this.mode} annotation.`;
            $('edit-add-options').classList.toggle('hidden', this.mode !== 'ADD');
            this.view.overlay.classList.toggle('overlay--add', this.mode === 'ADD');
            this.drawSpans();
        }));

        $('outline-add').addEventListener('click', () => {
            const title = $('outline-title').value.trim();
            if (!title) return UI.toast('Enter a bookmark title', 'error');
            this.outline = this.outline || [];
            this.outline.push([Number($('outline-level').value) || 1, title,
                               Number($('outline-page').value) || 1]);
            $('outline-title').value = '';
            this.renderOutline();
        });

        $('outline-apply').addEventListener('click', async () => {
            await UI.run('Updating bookmarks…', async () => {
                await this.mark();
                const n = await engine.call('set_outline', this.view.docId,
                                            JSON.stringify(this.outline || []));
                UI.toast(`${n} bookmark(s) applied - save to keep them`, 'success');
            });
        });

        $('edit-save').addEventListener('click', () => this.view.save('edited.pdf'));
        $('edit-search-btn').addEventListener('click', () => this.search());
        $('edit-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.search(); });

        $('edit-scan-ocr').addEventListener('click', () => this.ocrCurrent());
        $('edit-undo').addEventListener('click', () => this.step('undo'));
        $('edit-redo').addEventListener('click', () => this.step('redo'));

        // Ctrl+Z / Ctrl+Shift+Z while the Edit tab is showing and nothing is
        // being typed into - the browser's own undo owns the box while it is.
        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
            if (!$('edit-tab').classList.contains('active')) return;
            if (this.editing) return;
            const el = document.activeElement;
            if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
            e.preventDefault();
            this.step(e.shiftKey ? 'redo' : 'undo');
        });

        this.setupDragAnnotate();
        this.setupAddText();
    },

    /* ---- scanned pages ---- */

    /** A scanned page carries no text objects, so the editor has nothing to
     *  offer until the page has been read. Say so plainly and put the fix
     *  right there, rather than leaving an unclickable page and no reason. */
    async checkScanned() {
        const notice = $('edit-scan-notice');
        if (!notice) return;
        let status;
        try {
            status = await engine.callJSON('page_status', this.view.docId, this.view.page);
        } catch (err) {
            notice.classList.add('hidden');
            return;
        }
        this.pageStatus = status;
        // Editing a scanned page has to paint over pixels, not just swap
        // glyphs: the words you see are in the image, and the text layer OCR
        // adds is invisible.
        this.coverPixels = !!status.ocrLayer;

        if (status.scanned) {
            $('edit-scan-title').textContent =
                `Page ${this.view.page + 1} is a scan.`;
            $('edit-scan-detail').textContent =
                'Its words are part of an image, so there is nothing to tap yet. ' +
                'Reading the page finds the words and makes them editable.';
            $('edit-scan-ocr').textContent = 'Make this page editable';
            notice.classList.remove('hidden');
        } else if (status.ocrLayer) {
            $('edit-scan-title').textContent = 'Read from a scan.';
            $('edit-scan-detail').textContent =
                'Editing here paints over the scanned image and writes the new ' +
                'wording in its place, so what you see is what the file says.';
            $('edit-scan-ocr').textContent = 'Read again';
            notice.classList.remove('hidden');
        } else {
            notice.classList.add('hidden');
        }
    },

    async ocrCurrent() {
        const all = $('edit-scan-all').checked;
        const pages = all
            ? Array.from({ length: this.view.pages }, (_, i) => i)
            : [this.view.page];

        const bar = $('edit-scan-bar');
        const status = $('edit-scan-status');
        const btn = $('edit-scan-ocr');
        bar.classList.remove('hidden');
        status.classList.remove('hidden');
        btn.disabled = true;
        const setProgress = (pct, label) => {
            $('edit-scan-fill').style.width = `${pct}%`;
            $('edit-scan-pct').textContent = `${pct}%`;
            if (label) status.textContent = label;
        };

        try {
            await this.mark();
            const done = await recognisePages(this.view.docId, pages,
                                              $('edit-scan-lang').value, setProgress);
            await this.view.render();
            await this.refreshHistory();
            status.textContent = `${done} page(s) read - tap any line to edit it.`;
            UI.toast(`Read ${done} page(s) - the text is editable now`, 'success');
        } catch (err) {
            console.error(err);
            status.textContent = `Could not read the page: ${UI.explain(err)}`;
            UI.toast('Reading the page failed', 'error');
        } finally {
            btn.disabled = false;
            bar.classList.add('hidden');
        }
    },

    /* ---- undo / redo ---- */

    /** Take a snapshot before a change, so it can be stepped back. */
    async mark() {
        try {
            await engine.call('snapshot', this.view.docId);
            await this.refreshHistory();
        } catch (err) {
            // History is a convenience; never let it block the edit itself.
            console.warn('Could not record history', err);
        }
    },

    async refreshHistory() {
        // Never allowed to throw: this runs straight after a successful edit,
        // and letting it fail would report the edit itself as an error.
        try {
            const state = await engine.callJSON('history_state', this.view.docId);
            $('edit-undo').disabled = !state.undo;
            $('edit-redo').disabled = !state.redo;
            return state;
        } catch (err) {
            console.warn('Could not read history state', err);
            return { undo: 0, redo: 0 };
        }
    },

    async step(direction) {
        if (this.editing) this.cancelEdit();
        await UI.run(direction === 'undo' ? 'Undoing…' : 'Redoing…', async () => {
            const res = await engine.callJSON(direction, this.view.docId);
            if (!res.ok) {
                return UI.toast(direction === 'undo' ? 'Nothing left to undo'
                                                     : 'Nothing to redo', 'error');
            }
            await this.view.render();
            await this.refreshHistory();
            UI.toast(direction === 'undo' ? 'Change undone' : 'Change redone', 'success');
        });
    },

    /* ---- adding new text ---- */

    setupAddText() {
        this.view.overlay.addEventListener('click', (e) => {
            if (this.mode !== 'ADD' || this.editing) return;
            if (e.target !== this.view.overlay) return;   // ignore existing spans
            const at = this.view.fracFromEvent(e);
            this.beginAdd(at.x, at.y);
        });
    },

    /** An empty box placed where the page was clicked, styled to match what
     *  will be written, so adding text looks the same as editing it. */
    beginAdd(xFrac, yFrac) {
        if (this.editing) this.commitEdit();
        const img = this.view.img;
        const pageWidth = this.view.info.sizes[this.view.page].width;
        const scale = img.clientWidth / pageWidth;
        const size = Number($('edit-add-size').value) || 12;

        const el = document.createElement('div');
        el.className = 'inline-edit';
        try { el.contentEditable = 'plaintext-only'; } catch (err) { /* fall through */ }
        if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
        el.spellcheck = false;
        el.dataset.placeholder = 'Type here…';
        el.style.left = `${xFrac * 100}%`;
        el.style.top = `${yFrac * 100}%`;
        el.style.width = `${Math.max(10, (1 - xFrac) * 100 - 2)}%`;
        el.style.fontSize = `${Math.max(size * scale, 7)}px`;
        el.style.lineHeight = '1.25';
        el.style.color = $('edit-add-color').value;
        el.style.fontWeight = $('edit-add-bold').checked ? '700' : '400';
        el.style.fontStyle = $('edit-add-italic').checked ? 'italic' : 'normal';

        const tag = document.createElement('div');
        tag.className = 'inline-edit__tag';
        tag.style.left = `${xFrac * 100}%`;
        tag.style.top = `${yFrac * 100}%`;
        tag.textContent = `New text · ${size}pt - Enter to add, Esc to cancel`;

        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); return; }
            if (e.key !== 'Enter' || e.shiftKey) return;   // Shift+Enter breaks the line
            e.preventDefault();
            this.commitAdd();
        });
        el.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            document.execCommand('insertText', false, text);
        });
        el.addEventListener('blur', () => this.commitAdd());

        this.editing = { adding: true, el, tag, box: null, done: false, xFrac, yFrac, size };
        this.view.overlay.append(el, tag);
        el.focus({ preventScroll: true });
    },

    async commitAdd() {
        const ctx = this.editing;
        if (!ctx || ctx.done || !ctx.adding) return;
        ctx.done = true;
        const text = ctx.el.innerText.replace(/ /g, ' ').replace(/\s+$/, '');
        const widthFrac = ctx.el.offsetWidth / this.view.overlay.clientWidth;
        this.closeEditor();
        if (!text.trim()) return;

        await UI.run('Adding text…', async () => {
            await this.mark();
            const res = await engine.callJSON(
                'insert_text', this.view.docId, this.view.page, ctx.xFrac, ctx.yFrac,
                text, ctx.size, $('edit-add-color').value,
                $('edit-add-bold').checked, $('edit-add-italic').checked, widthFrac);
            if (!res.ok) return UI.toast(res.reason || 'Could not add the text', 'error');
            await this.view.render();
            await this.refreshHistory();
            UI.toast('Text added to the page', 'success');
        });
    },

    async open(file) {
        if (!file) return;
        this.fontCache = new Map();   // fonts are extracted from the open document
        await UI.run('Opening document…', async () => {
            const info = await this.view.load(file);
            $('edit-doc-info').innerHTML =
                `<strong>${file.name}</strong><br>${info.pages} page(s) · ${formatSize(file.size)}`;
            $('outline-page').max = info.pages;
            this.view.zoom = 0;
            this.view.applyZoom();
            await this.refreshAnnots();
            await this.loadOutline();
            await this.refreshHistory();
        });
    },

    async drawSpans() {
        const overlay = this.view.overlay;
        overlay.innerHTML = '';
        await this.checkScanned();
        if (this.mode !== 'TEXT' && this.mode !== 'BLOCK') return;

        // Line mode edits one span; paragraph mode edits a whole block and reflows.
        const isBlock = this.mode === 'BLOCK';
        this.spans = await engine.callJSON(isBlock ? 'get_blocks' : 'get_spans',
                                           this.view.docId, this.view.page);
        this.spans.forEach((item, index) => {
            const el = document.createElement('div');
            el.className = isBlock ? 'span-box span-box--block' : 'span-box';
            el.style.cssText = `left:${item.xFrac * 100}%;top:${item.yFrac * 100}%;` +
                               `width:${item.wFrac * 100}%;height:${item.hFrac * 100}%`;
            el.title = isBlock
                ? `Paragraph · ${item.lines} line(s) - tap to rewrite in place`
                : `${item.font} ${item.size}pt - tap to edit in place`;
            el.addEventListener('click', (e) => this.beginEdit(index, el, e));
            overlay.appendChild(el);
        });
    },

    /* ---- in-place text editing ---- */

    /** The face to draw the editor in, matching the page as closely as possible.
     *
     * The document's own embedded font is used when the browser can render it,
     * so the text you type on screen is the text you get in the PDF. Otherwise
     * a lookalike stack stands in.
     */
    async fontFor(item) {
        const key = `${item.font}|${item.flags}`;
        if (this.fontCache.has(key)) return this.fontCache.get(key);

        const look = lookalikeFont(item.font, item.flags);
        let spec = { ...look, exact: false };
        try {
            const bytes = await engine.call('get_web_font', this.view.docId,
                                            this.view.page, item.font || '');
            if (bytes && bytes.length) {
                const family = `MPDFface${this.fontCache.size}`;
                const face = new FontFace(family, bytes);
                await face.load();
                document.fonts.add(face);
                // An embedded face already carries its own weight and slant,
                // so asking for synthetic bold/italic on top would double it.
                spec = { family: `"${family}", ${look.family}`, weight: '400',
                         style: 'normal', exact: true };
            }
        } catch (err) {
            console.warn('Embedded font unavailable - using a lookalike', err);
        }
        this.fontCache.set(key, spec);
        return spec;
    },

    /** Open an editable box sitting exactly where the text is. */
    async beginEdit(index, box, event) {
        if (this.editing) this.commitEdit();
        const item = this.spans[index];
        const isBlock = this.mode === 'BLOCK';
        const img = this.view.img;
        const scale = img.clientWidth / this.view.info.sizes[this.view.page].width;
        const spec = await this.fontFor(item);

        const el = document.createElement('div');
        el.className = isBlock ? 'inline-edit inline-edit--block' : 'inline-edit';
        // plaintext-only keeps pasted markup out; older browsers get plain
        // contenteditable plus the paste handler below.
        try { el.contentEditable = 'plaintext-only'; } catch (err) { /* fall through */ }
        if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
        el.spellcheck = false;
        el.textContent = item.text;

        el.style.left = `${item.xFrac * 100}%`;
        el.style.top = `${item.yFrac * 100}%`;
        el.style.width = `${item.wFrac * 100}%`;
        el.style.fontFamily = spec.family;
        el.style.fontWeight = spec.weight;
        el.style.fontStyle = spec.style;
        el.style.fontSize = `${Math.max(item.size * scale, 7)}px`;
        el.style.color = intToCss(item.colorInt);
        const boxHeight = item.hFrac * img.clientHeight;
        if (isBlock) {
            el.style.minHeight = `${boxHeight}px`;
            el.style.lineHeight = `${(boxHeight / Math.max(item.lines || 1, 1)).toFixed(2)}px`;
        } else {
            // One line: matching line-height to the box centres it on the original.
            el.style.height = `${boxHeight}px`;
            el.style.lineHeight = `${boxHeight}px`;
        }

        const tag = document.createElement('div');
        tag.className = 'inline-edit__tag';
        tag.style.left = `${item.xFrac * 100}%`;
        tag.style.top = `${item.yFrac * 100}%`;
        tag.textContent = `${item.font} · ${item.size}pt`
            + (spec.exact ? '' : ' · lookalike')
            + (isBlock ? ' - Ctrl+Enter to apply, Esc to cancel'
                       : ' - Enter to apply, Esc to cancel');

        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); return; }
            if (e.key !== 'Enter') return;
            // A paragraph can hold line breaks, so it commits deliberately.
            if (isBlock && !(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            this.commitEdit();
        });
        el.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            document.execCommand('insertText', false, text);
        });
        el.addEventListener('blur', () => this.commitEdit());

        box.style.visibility = 'hidden';
        this.editing = { item, isBlock, el, tag, box, done: false };
        this.view.overlay.append(el, tag);

        el.focus({ preventScroll: true });
        this.placeCaret(el, event);
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
    },

    /** Put the caret where the page was tapped, rather than at the start. */
    placeCaret(el, event) {
        const sel = window.getSelection();
        if (!sel) return;
        let range = null;
        if (event && document.caretRangeFromPoint) {
            range = document.caretRangeFromPoint(event.clientX, event.clientY);
        } else if (event && document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(event.clientX, event.clientY);
            if (pos) {
                range = document.createRange();
                range.setStart(pos.offsetNode, pos.offset);
            }
        }
        if (!range || !el.contains(range.startContainer)) {
            range = document.createRange();
            range.selectNodeContents(el);
        }
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    },

    cancelEdit() {
        if (!this.editing) return;
        this.editing.done = true;
        this.closeEditor();
    },

    closeEditor() {
        const ctx = this.editing;
        this.editing = null;
        if (!ctx) return;
        ctx.el.remove();
        ctx.tag.remove();
        if (ctx.box) ctx.box.style.visibility = '';
    },

    /** Write what was typed back into the PDF itself. */
    async commitEdit() {
        const ctx = this.editing;
        if (!ctx || ctx.done) return;
        if (ctx.adding) return this.commitAdd();
        ctx.done = true;

        const raw = ctx.el.innerText.replace(/\u00a0/g, ' ').replace(/\s+$/, '');
        // A span is a single line, so anything typed across lines is joined.
        const next = ctx.isBlock ? raw : raw.replace(/\s*\n\s*/g, ' ');
        const item = ctx.item;
        const isBlock = ctx.isBlock;
        this.closeEditor();
        if (next === item.text) return;

        // Emptying the box deletes the text. This used to do nothing at all,
        // silently, leaving no way to remove a line. Deletion is worth
        // confirming, because the glyphs really are removed from the file.
        const deleting = !next.trim();
        if (deleting) {
            const what = isBlock ? 'this paragraph' : `"${item.text.slice(0, 60)}"`;
            if (!confirm(`Delete ${what} from the page?`)) {
                await this.view.render();
                return;
            }
        }

        await UI.run(deleting ? 'Deleting text…'
                              : (isBlock ? 'Rewriting paragraph…' : 'Replacing text…'), async () => {
            await this.mark();
            // On a page read from a scan the visible words are pixels, so the
            // region has to be painted over before the new wording is drawn.
            const res = await engine.callJSON(isBlock ? 'edit_block' : 'edit_text',
                                              this.view.docId, this.view.page, item.bbox,
                                              next, item.font, item.size,
                                              item.colorInt, item.flags,
                                              ...(isBlock ? [true, this.coverPixels]
                                                          : [this.coverPixels]));
            await this.view.render();
            await this.refreshHistory();
            if (deleting) return UI.toast('Text deleted from the page', 'success');
            const face = res.exact
                ? `kept ${item.font}`
                : 'matched with a similar font';
            UI.toast(isBlock
                ? (res.grew ? `Paragraph rewritten at ${res.size}pt, box grew to fit - ${face}`
                            : `Paragraph rewrapped at ${res.size}pt - ${face}`)
                : `Text replaced - ${face}`, 'success');
        });
    },

    /* ---- bookmarks / outline ---- */

    async loadOutline() {
        this.outline = await engine.callJSON('get_outline', this.view.docId);
        this.renderOutline();
    },

    renderOutline() {
        const box = $('edit-outline');
        if (!box) return;
        box.innerHTML = this.outline.length
            ? this.outline.map((row, i) => `
                <div class="outline-row" style="padding-left:${(row[0] - 1) * 14}px">
                    <span class="outline-title">${String(row[1]).replace(/[<>&]/g, '')}</span>
                    <span class="muted">p${row[2]}</span>
                    <button class="outline-del" data-out="${i}" title="Remove">✕</button>
                </div>`).join('')
            : '<p class="muted">No bookmarks yet.</p>';
        $$('.outline-del', box).forEach((b) => b.addEventListener('click', () => {
            this.outline.splice(Number(b.dataset.out), 1);
            this.renderOutline();
        }));
    },

    /** Drag a rectangle to place an annotation. */
    setupDragAnnotate() {
        const overlay = this.view.overlay;
        let start = null;
        let ghost = null;

        overlay.addEventListener('mousedown', (e) => {
            if (this.mode === 'TEXT') return;
            start = this.view.fracFromEvent(e);
            ghost = document.createElement('div');
            ghost.className = 'draw-ghost';
            overlay.appendChild(ghost);
        });
        overlay.addEventListener('mousemove', (e) => {
            if (!start || !ghost) return;
            const now = this.view.fracFromEvent(e);
            Object.assign(ghost.style, {
                left: `${Math.min(start.x, now.x) * 100}%`,
                top: `${Math.min(start.y, now.y) * 100}%`,
                width: `${Math.abs(now.x - start.x) * 100}%`,
                height: `${Math.abs(now.y - start.y) * 100}%`,
            });
        });
        window.addEventListener('mouseup', async (e) => {
            if (!start) return;
            const end = this.view.fracFromEvent(e);
            const from = start;
            start = null;
            if (ghost) { ghost.remove(); ghost = null; }
            if (Math.abs(end.x - from.x) < 0.01 || Math.abs(end.y - from.y) < 0.005) return;

            const needsText = this.mode === 'note' || this.mode === 'freetext';
            const text = needsText ? (prompt('Comment text:') || '') : '';
            await UI.run('Adding annotation…', async () => {
                await this.mark();
                await engine.call('annotate', this.view.docId, this.view.page, this.mode,
                                  from.x, from.y, end.x, end.y, text, $('edit-annot-color').value);
                await this.view.render();
                await this.refreshAnnots();
            });
        });
    },

    async refreshAnnots() {
        const list = await engine.callJSON('list_annotations', this.view.docId);
        $('edit-annot-list').innerHTML = list.length
            ? `<h4 class="side-subtitle">Comments (${list.length})</h4>` + list.map((a) =>
                `<div class="annot-item"><strong>${a.type}</strong> · p${a.page + 1}
                 <div class="muted">${a.content || '-'}</div></div>`).join('')
            : '';
    },

    async search() {
        const term = $('edit-search').value.trim();
        if (!term) return;
        const hits = await engine.callJSON('search_text', this.view.docId, term);
        $('edit-search-results').innerHTML = hits.length
            ? hits.map((h) => `<button class="search-hit" data-page="${h.page}">Page ${h.page + 1}</button>`).join('')
            : '<span class="muted">No matches</span>';
        $$('.search-hit', $('edit-search-results')).forEach((b) =>
            b.addEventListener('click', () => this.view.go(Number(b.dataset.page))));
    },
};

/* ------------------------------------------------------------------ */
/* 2. Pages - merge / split / organise                                 */
/* ------------------------------------------------------------------ */

const PagesTool = {
    order: [],
    rotations: {},
    selected: new Set(),

    init() {
        $('pages-file').addEventListener('change', (e) => this.open(Array.from(e.target.files)));
        $('pages-rotate-left').addEventListener('click', () => this.rotate(-90));
        $('pages-rotate-right').addEventListener('click', () => this.rotate(90));
        $('pages-delete').addEventListener('click', () => this.remove());
        $('pages-select-all').addEventListener('click', () => this.selectAll(true));
        $('pages-deselect').addEventListener('click', () => this.selectAll(false));
        $('pages-save').addEventListener('click', () => this.save());
        $('pages-split-mode').addEventListener('change', (e) => {
            $('pages-split-every').classList.toggle('hidden', e.target.value !== 'every');
            $('pages-split-ranges').classList.toggle('hidden', e.target.value !== 'ranges');
        });
    },

    async open(files) {
        if (!files.length) return;
        await UI.run('Loading pages…', async () => {
            // Multiple files are merged first, then organised as one document.
            const ids = [];
            for (let i = 0; i < files.length; i++) {
                const id = `pages_src_${i}`;
                await engine.openDoc(id, await fileToBytes(files[i]), files[i].name);
                ids.push(id);
            }
            // Merging is used even for a single file: it yields a plain copy of
            // the already-open document, so a protected file is not re-read
            // from its still-encrypted bytes and asked about a second time.
            const merged = await engine.call('merge', JSON.stringify(ids));
            await engine.call('open_doc', 'pages', merged);
            for (const id of ids) await engine.call('close_doc', id);

            const info = await engine.callJSON('doc_info', 'pages');
            this.order = Array.from({ length: info.pages }, (_, i) => i);
            this.rotations = {};
            this.selected.clear();
            $('pages-workspace').classList.remove('hidden');
            await this.renderGrid();
            UI.toast(`${info.pages} pages loaded`, 'success');
        });
    },

    async renderGrid() {
        const grid = $('pages-grid');
        grid.innerHTML = '';
        for (const original of this.order) {
            const png = await engine.call('render_page', 'pages', original, 36);
            const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
            const card = document.createElement('div');
            card.className = 'page-card' + (this.selected.has(original) ? ' selected' : '');
            card.draggable = true;
            card.dataset.original = original;
            card.innerHTML = `<img src="${url}" style="transform:rotate(${this.rotations[original] || 0}deg)">
                              <div class="page-card__label">Page ${original + 1}</div>`;
            card.addEventListener('click', () => {
                if (this.selected.has(original)) this.selected.delete(original);
                else this.selected.add(original);
                card.classList.toggle('selected');
            });
            card.addEventListener('dragstart', () => { this._drag = original; card.classList.add('dragging'); });
            card.addEventListener('dragend', () => card.classList.remove('dragging'));
            card.addEventListener('dragover', (e) => e.preventDefault());
            card.addEventListener('drop', (e) => {
                e.preventDefault();
                const from = this.order.indexOf(this._drag);
                const to = this.order.indexOf(original);
                if (from < 0 || to < 0 || from === to) return;
                this.order.splice(to, 0, ...this.order.splice(from, 1));
                this.renderGrid();
            });
            grid.appendChild(card);
        }
    },

    rotate(delta) {
        if (!this.selected.size) return UI.toast('Select pages first', 'error');
        this.selected.forEach((p) => {
            this.rotations[p] = ((this.rotations[p] || 0) + delta + 360) % 360;
        });
        this.renderGrid();
    },

    remove() {
        if (!this.selected.size) return UI.toast('Select pages first', 'error');
        this.order = this.order.filter((p) => !this.selected.has(p));
        this.selected.clear();
        this.renderGrid();
    },

    selectAll(on) {
        this.selected = on ? new Set(this.order) : new Set();
        this.renderGrid();
    },

    async save() {
        if (!this.order.length) return UI.toast('No pages left to save', 'error');
        await UI.run('Building PDF…', async () => {
            const bytes = await engine.call('organize', 'pages',
                                            JSON.stringify(this.order), JSON.stringify(this.rotations));
            const mode = $('pages-split-mode').value;
            if (!mode) { download(bytes, 'organized.pdf'); return; }

            await engine.call('open_doc', 'pages_out', bytes);
            const parts = await engine.callJSON('split', 'pages_out', mode,
                                                $('pages-split-ranges').value,
                                                Number($('pages-split-every').value || 1));
            const zip = new JSZip();
            parts.forEach((p) => zip.file(p.name, b64ToBytes(p.b64)));
            download(await zip.generateAsync({ type: 'blob' }), 'split-pages.zip', 'application/zip');
            UI.toast(`Split into ${parts.length} files`, 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 3. Fill & sign                                                      */
/* ------------------------------------------------------------------ */

const SignTool = {
    tool: 'SIGNATURE',
    items: [],
    signature: null,
    initials: null,
    target: 'SIGNATURE',

    init() {
        this.view = new DocView('sign', { onRender: () => this.drawItems() });
        $('sign-file').addEventListener('change', (e) => this.open(e.target.files[0]));

        $$('[data-signtool]').forEach((btn) => btn.addEventListener('click', () => {
            const next = btn.dataset.signtool;
            const isSig = next === 'SIGNATURE' || next === 'INITIALS';
            if (isSig && this.tool === next) return this.openModal(next);
            this.tool = next;
            $$('[data-signtool]').forEach((b) => b.classList.toggle('active', b === btn));
        }));

        this.view.overlay.addEventListener('click', (e) => {
            if (e.target === this.view.overlay) this.place(e);
        });
        $('sign-clear').addEventListener('click', () => { this.items = []; this.drawItems(); });
        $('sign-save').addEventListener('click', () => this.save());
        this.setupModal();
    },

    async open(file) {
        if (!file) return;
        await UI.run('Opening document…', async () => {
            await this.view.load(file);
            this.items = [];
            const fields = await engine.callJSON('get_form_fields', 'sign');
            this.fields = fields;
            $('sign-fields').innerHTML = fields.length
                ? fields.map((f, i) => `
                    <div class="form-group">
                        <label class="form-label">${f.name}</label>
                        ${f.kind === 'checkbox'
                            ? `<input type="checkbox" data-field="${i}">`
                            : f.kind === 'select'
                            ? `<select class="form-control" data-field="${i}"><option value=""></option>${
                                f.options.map((o) => `<option>${o}</option>`).join('')}</select>`
                            : `<input type="text" class="form-control" data-field="${i}" value="${f.value || ''}">`}
                    </div>`).join('')
                : '<p class="muted">No fillable fields detected.</p>';
        });
    },

    place(e) {
        const { x, y } = this.view.fracFromEvent(e);
        const size = this.view.info.sizes[this.view.page];
        const add = (item) => { this.items.push(item); this.drawItems(); };

        if (this.tool === 'SIGNATURE' || this.tool === 'INITIALS') {
            const img = this.tool === 'SIGNATURE' ? this.signature : this.initials;
            if (!img) return this.openModal(this.tool);
            const wFrac = Math.min(0.32, 170 / size.width);
            const hFrac = (wFrac * size.width) * (img.h / img.w) / size.height;
            return add({ page: this.view.page, dataUrl: img.dataUrl, text: '',
                         xFrac: x - wFrac / 2, yFrac: y - hFrac / 2, wFrac, hFrac });
        }

        const text = this.tool === 'TEXT' ? (prompt('Enter text:') || '')
                   : this.tool === 'DATE' ? new Date().toLocaleDateString()
                   : this.tool === 'CHECK' ? '✔' : '✗';
        if (!text) return;
        const fontSize = this.tool === 'CHECK' || this.tool === 'CROSS' ? 22 : 14;
        const wFrac = Math.max(0.06, (text.length * fontSize * 0.55) / size.width);
        const hFrac = (fontSize * 1.5) / size.height;
        add({ page: this.view.page, text, size: fontSize, color: '#12123a', dataUrl: '',
              xFrac: x - wFrac / 2, yFrac: y - hFrac / 2, wFrac, hFrac });
    },

    drawItems() {
        const overlay = this.view.overlay;
        overlay.innerHTML = '';
        this.items.filter((i) => i.page === this.view.page).forEach((item) => {
            const el = document.createElement('div');
            el.className = 'placed-item';
            el.style.cssText = `left:${item.xFrac * 100}%;top:${item.yFrac * 100}%;` +
                               `width:${item.wFrac * 100}%;height:${item.hFrac * 100}%`;
            el.innerHTML = item.dataUrl
                ? `<img src="${item.dataUrl}">`
                : `<span style="color:${item.color}">${item.text}</span>`;

            const del = document.createElement('button');
            del.className = 'placed-item__del';
            del.textContent = '✕';
            del.addEventListener('click', (e) => {
                e.stopPropagation();
                this.items = this.items.filter((i) => i !== item);
                this.drawItems();
            });
            el.appendChild(del);

            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const rect = overlay.getBoundingClientRect();
                const ox = e.clientX; const oy = e.clientY;
                const sx = item.xFrac; const sy = item.yFrac;
                const move = (ev) => {
                    item.xFrac = Math.min(Math.max(sx + (ev.clientX - ox) / rect.width, 0), 1 - item.wFrac);
                    item.yFrac = Math.min(Math.max(sy + (ev.clientY - oy) / rect.height, 0), 1 - item.hFrac);
                    el.style.left = `${item.xFrac * 100}%`;
                    el.style.top = `${item.yFrac * 100}%`;
                };
                const up = () => {
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
            });
            overlay.appendChild(el);
        });
    },

    setupModal() {
        $$('[data-sigclose]').forEach((el) => el.addEventListener('click', () => $('sig-modal').classList.add('hidden')));
        $$('[data-sigmode]').forEach((btn) => btn.addEventListener('click', () => {
            $$('[data-sigmode]').forEach((b) => b.classList.toggle('active', b === btn));
            $$('[data-sigpanel]').forEach((p) => p.classList.toggle('hidden', p.dataset.sigpanel !== btn.dataset.sigmode));
        }));

        const canvas = $('sig-canvas');
        const ctx = canvas.getContext('2d');
        let drawing = false;
        this.drew = false;
        const pos = (e) => {
            const r = canvas.getBoundingClientRect();
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: (cx - r.left) * (canvas.width / r.width), y: (cy - r.top) * (canvas.height / r.height) };
        };
        const start = (e) => {
            e.preventDefault();
            drawing = true; this.drew = true;
            const p = pos(e);
            ctx.strokeStyle = $('sig-color').value;
            ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            ctx.beginPath(); ctx.moveTo(p.x, p.y);
        };
        const move = (e) => { if (!drawing) return; e.preventDefault(); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
        const end = () => { drawing = false; };
        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);
        $('sig-clear').addEventListener('click', () => { ctx.clearRect(0, 0, canvas.width, canvas.height); this.drew = false; });

        const renderTyped = () => {
            const c = $('sig-type-canvas');
            const cx = c.getContext('2d');
            cx.clearRect(0, 0, c.width, c.height);
            const text = $('sig-typed').value.trim();
            if (!text) return;
            cx.fillStyle = $('sig-color').value;
            cx.font = `64px ${$('sig-font').value}`;
            cx.textAlign = 'center'; cx.textBaseline = 'middle';
            cx.fillText(text, c.width / 2, c.height / 2, c.width - 40);
        };
        $('sig-typed').addEventListener('input', renderTyped);
        $('sig-font').addEventListener('change', renderTyped);

        $('sig-upload').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.uploaded = ev.target.result;
                const c = $('sig-upload-canvas');
                const cx = c.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    cx.clearRect(0, 0, c.width, c.height);
                    const s = Math.min(c.width / img.width, c.height / img.height);
                    cx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2,
                                 img.width * s, img.height * s);
                };
                img.src = this.uploaded;
            };
            reader.readAsDataURL(file);
        });

        $('sig-use').addEventListener('click', () => this.commit());
    },

    openModal(target) {
        this.target = target;
        $('sig-title').textContent = target === 'INITIALS' ? 'Create Initials' : 'Create Signature';
        const c = $('sig-canvas');
        c.getContext('2d').clearRect(0, 0, c.width, c.height);
        this.drew = false;
        this.uploaded = null;
        $('sig-typed').value = '';
        [$('sig-type-canvas'), $('sig-upload-canvas')].forEach((cv) =>
            cv.getContext('2d').clearRect(0, 0, cv.width, cv.height));
        $('sig-modal').classList.remove('hidden');
    },

    commit() {
        const mode = document.querySelector('[data-sigmode].active').dataset.sigmode;
        let dataUrl = null;
        if (mode === 'draw') {
            if (!this.drew) return UI.toast('Draw your signature first', 'error');
            dataUrl = $('sig-canvas').toDataURL('image/png');
        } else if (mode === 'type') {
            if (!$('sig-typed').value.trim()) return UI.toast('Type your name first', 'error');
            dataUrl = $('sig-type-canvas').toDataURL('image/png');
        } else {
            if (!this.uploaded) return UI.toast('Choose an image first', 'error');
            dataUrl = this.uploaded;
        }
        const img = new Image();
        img.onload = () => {
            const payload = { dataUrl, w: img.naturalWidth || 300, h: img.naturalHeight || 100 };
            if (this.target === 'INITIALS') this.initials = payload; else this.signature = payload;
            this.tool = this.target;
            $$('[data-signtool]').forEach((b) => b.classList.toggle('active', b.dataset.signtool === this.target));
            $('sig-modal').classList.add('hidden');
            UI.toast('Ready - click the page to place it', 'success');
        };
        img.src = dataUrl;
    },

    async save() {
        await UI.run('Saving signed PDF…', async () => {
            const values = {};
            $$('[data-field]').forEach((input) => {
                const field = this.fields[Number(input.dataset.field)];
                values[field.name] = input.type === 'checkbox' ? input.checked : input.value;
            });
            if (Object.keys(values).length) {
                await engine.call('fill_form', 'sign', JSON.stringify(values), $('sign-flatten').checked);
            }
            if (this.items.length) {
                await engine.call('place_items', 'sign', JSON.stringify(this.items));
            }
            await this.view.save('signed.pdf');
            UI.toast('Signed PDF saved', 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 4. Watermark / stamps / numbering / Bates                           */
/* ------------------------------------------------------------------ */

const StampTool = {
    stamps: [],
    active: null,

    init() {
        this.view = new DocView('stamp', { onRender: () => this.drawStamps() });
        $('stamp-file').addEventListener('change', (e) => this.open(e.target.files[0]));

        $$('[data-stampsec]').forEach((btn) => btn.addEventListener('click', () => {
            $$('[data-stampsec]').forEach((b) => b.classList.toggle('active', b === btn));
            $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== btn.dataset.stampsec));
        }));

        $('wm-opacity').addEventListener('input', (e) => { $('wm-op-val').textContent = `${e.target.value}%`; });
        $('wm-rotate').addEventListener('input', (e) => { $('wm-rot-val').textContent = `${e.target.value}°`; });

        $('wm-apply').addEventListener('click', () => this.applyWatermark());
        $('stamp-apply').addEventListener('click', () => this.applyStamps());
        $('stamp-clear').addEventListener('click', () => { this.stamps = []; this.drawStamps(); });
        $('pn-apply').addEventListener('click', () => this.applyNumbers());
        $('hf-apply').addEventListener('click', () => this.applyHeaderFooter());
        $('bates-apply').addEventListener('click', () => this.applyBates());
        $('stamp-save').addEventListener('click', () => this.view.save('stamped.pdf'));

        $$('.stamp-btn').forEach((btn) => btn.addEventListener('click', () => {
            this.active = btn.dataset.stamp;
            $$('.stamp-btn').forEach((b) => b.classList.toggle('active', b === btn));
        }));
        $('stamp-custom').addEventListener('change', (e) => {
            if (e.target.value.trim()) this.active = e.target.value.trim().toUpperCase();
        });

        this.view.overlay.addEventListener('click', (e) => {
            if (!this.active || e.target !== this.view.overlay) return;
            const { x, y } = this.view.fracFromEvent(e);
            const size = this.view.info.sizes[this.view.page];
            const wFrac = Math.min(0.45, 170 / size.width);
            const hFrac = 38 / size.height;
            this.stamps.push({ page: this.view.page, text: this.active,
                               xFrac: x - wFrac / 2, yFrac: y - hFrac / 2, wFrac, hFrac });
            this.drawStamps();
        });
    },

    async open(file) {
        if (!file) return;
        this.file = file;
        await UI.run('Opening document…', () => this.view.load(file));
    },

    drawStamps() {
        const overlay = this.view.overlay;
        overlay.innerHTML = '';
        this.stamps.filter((s) => s.page === this.view.page).forEach((s) => {
            const el = document.createElement('div');
            el.className = 'stamp-ghost';
            el.style.cssText = `left:${s.xFrac * 100}%;top:${s.yFrac * 100}%;` +
                               `width:${s.wFrac * 100}%;height:${s.hFrac * 100}%`;
            el.textContent = s.text;
            overlay.appendChild(el);
        });
    },

    async applyWatermark() {
        await UI.run('Applying watermark…', async () => {
            await engine.call('watermark_text', 'stamp', $('wm-text').value || 'CONFIDENTIAL',
                              $('wm-pages').value, Number($('wm-size').value),
                              $('wm-color').value, Number($('wm-opacity').value) / 100,
                              Number($('wm-rotate').value), $('wm-tiled').checked);
            await this.view.render();
            UI.toast('Watermark applied - press Save to download', 'success');
        });
    },

    async applyStamps() {
        if (!this.stamps.length) return UI.toast('Place a stamp on the page first', 'error');
        await UI.run('Applying stamps…', async () => {
            await engine.call('stamp', 'stamp', JSON.stringify(this.stamps));
            this.stamps = [];
            await this.view.render();
            UI.toast('Stamps applied', 'success');
        });
    },

    async applyNumbers() {
        await UI.run('Adding page numbers…', async () => {
            await engine.call('page_numbers', 'stamp', $('pn-format').value, $('pn-pos').value,
                              Number($('pn-start').value || 1));
            await this.view.render();
            UI.toast('Page numbers added', 'success');
        });
    },

    async applyHeaderFooter() {
        const fields = {
            'header-left': $('hf-hl').value, 'header-center': $('hf-hc').value, 'header-right': $('hf-hr').value,
            'footer-left': $('hf-fl').value, 'footer-center': $('hf-fc').value, 'footer-right': $('hf-fr').value,
        };
        if (!Object.values(fields).some((v) => v.trim())) return UI.toast('Fill at least one field', 'error');
        await UI.run('Adding header/footer…', async () => {
            await engine.call('header_footer', 'stamp', JSON.stringify(fields), 9, '#111111', 28,
                              (this.file && this.file.name.replace(/\.pdf$/i, '')) || 'document');
            await this.view.render();
            UI.toast('Header/footer added', 'success');
        });
    },

    async applyBates() {
        await UI.run('Applying Bates numbering…', async () => {
            const n = await engine.call('bates', 'stamp', $('bates-prefix').value, $('bates-suffix').value,
                                        Number($('bates-start').value || 1), Number($('bates-digits').value || 6),
                                        $('bates-pos').value);
            await this.view.render();
            UI.toast(`Bates numbering applied to ${n} pages`, 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 5. OCR                                                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* shared OCR                                                          */
/* ------------------------------------------------------------------ */

/** Recognise pages and write an invisible text layer back into the document.
 *
 * Shared by the OCR tab and the Edit tab: a scanned page has no text objects
 * at all, so the editor needs exactly this before it has anything to offer.
 *
 * @param docId    document already open in the engine
 * @param pages    page indices to read
 * @param lang     Tesseract language code(s), e.g. "eng" or "eng+hin"
 * @param onStep   (pct, label) progress callback
 */
async function recognisePages(docId, pages, lang, onStep = () => {}) {
    onStep(0, 'Loading the reader…');
    const worker = await Tesseract.createWorker(lang, 1, {
        // The language pack is ~11 MB on first use. Without this the UI sits
        // silent through the download and looks like it has frozen.
        logger: (m) => {
            if (m.status && m.status !== 'recognizing text') {
                onStep(Math.round((m.progress || 0) * 100),
                       `${m.status.charAt(0).toUpperCase()}${m.status.slice(1)}…`);
            }
        },
    });
    try {
        let done = 0;
        for (const pno of pages) {
            onStep(Math.round((done / pages.length) * 100), `Reading page ${pno + 1}…`);
            // Render high: recognition accuracy follows input resolution.
            const png = await engine.call('render_page', docId, pno, 200);
            const blob = new Blob([png], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            try {
                const { data } = await worker.recognize(url);
                const bitmap = await createImageBitmap(blob);
                const words = (data.words || []).map((w) => ({ text: w.text, bbox: w.bbox }));
                await engine.call('insert_ocr_layer', docId, pno, JSON.stringify(words),
                                  bitmap.width, bitmap.height);
            } finally {
                URL.revokeObjectURL(url);
            }
            done++;
            onStep(Math.round((done / pages.length) * 100), `Read ${done} of ${pages.length}`);
        }
        return done;
    } finally {
        await worker.terminate();
    }
}

const OcrTool = {
    init() {
        $('ocr-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('ocr-run').addEventListener('click', () => this.run());
        $('ocr-save').addEventListener('click', async () => {
            const bytes = await engine.call('save', 'ocr');
            download(bytes, 'searchable.pdf');
        });
    },

    async open(file) {
        if (!file) return;
        await UI.run('Analysing document…', async () => {
            const info = await engine.openDoc('ocr', await fileToBytes(file), file.name);
            this.pages = info.pages;
            const needs = [];
            for (let i = 0; i < info.pages; i++) {
                if (await engine.call('needs_ocr', 'ocr', i)) needs.push(i);
            }
            this.needs = needs;
            $('ocr-workspace').classList.remove('hidden');
            $('ocr-save').disabled = true;
            $('ocr-summary').innerHTML =
                `<strong>${file.name}</strong> - ${info.pages} page(s).<br>` +
                (needs.length
                    ? `<span class="warn">${needs.length} page(s) look scanned and have no searchable text.</span>`
                    : 'Every page already has extractable text - OCR is optional here.');
        });
    },

    async run() {
        const scope = $('ocr-scope').value;
        const targets = scope === 'all' ? Array.from({ length: this.pages }, (_, i) => i) : this.needs;
        if (!targets.length) return UI.toast('Nothing to OCR', 'error');

        $('ocr-bar').classList.remove('hidden');
        $('ocr-run').disabled = true;
        const setProgress = (pct, label) => {
            $('ocr-fill').style.width = `${pct}%`;
            $('ocr-pct').textContent = `${pct}%`;
            if (label) $('ocr-status').textContent = label;
        };

        try {
            const done = await recognisePages('ocr', targets, $('ocr-lang').value, setProgress);
            $('ocr-status').textContent = `Done - ${done} page(s) now carry a searchable text layer.`;
            $('ocr-save').disabled = false;
            UI.toast('OCR complete', 'success');
        } catch (err) {
            console.error(err);
            $('ocr-status').textContent = `OCR failed: ${UI.explain(err)}`;
            UI.toast(`OCR failed: ${UI.explain(err)}`, 'error');
        } finally {
            $('ocr-run').disabled = false;
        }
    },
};

/* ------------------------------------------------------------------ */
/* 6. Compress                                                         */
/* ------------------------------------------------------------------ */

const CompressTool = {
    init() {
        $('compress-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('compress-run').addEventListener('click', () => this.run());
    },

    async open(file) {
        if (!file) return;
        this.file = file;
        await UI.run('Opening document…', async () => {
            const info = await engine.openDoc('compress', await fileToBytes(file), file.name);
            $('compress-workspace').classList.remove('hidden');
            $('compress-result').classList.add('hidden');
            $('compress-summary').innerHTML =
                `<strong>${file.name}</strong> - ${formatSize(file.size)} · ${info.pages} page(s)`;
        });
    },

    async run() {
        await UI.run('Compressing…', async () => {
            const bytes = await engine.call('compress', 'compress', $('compress-level').value);
            const saved = this.file.size - bytes.length;
            const pct = Math.round((saved / this.file.size) * 100);
            download(bytes, 'compressed.pdf');
            const box = $('compress-result');
            box.classList.remove('hidden');
            box.innerHTML = pct > 0
                ? `${formatSize(this.file.size)} → <strong>${formatSize(bytes.length)}</strong> (${pct}% smaller). Text stays searchable.`
                : `This file is already well optimised (${formatSize(bytes.length)}). Try a higher level for more.`;
        });
    },
};

/* ------------------------------------------------------------------ */
/* 7. Protect                                                          */
/* ------------------------------------------------------------------ */

const ProtectTool = {
    init() {
        $('protect-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('protect-run').addEventListener('click', () => this.encrypt());
        $('protect-remove').addEventListener('click', () => this.decrypt());
    },

    async open(file) {
        if (!file) return;
        this.file = file;
        await UI.run('Opening document…', async () => {
            const bytes = await fileToBytes(file);
            const info = await engine.openDoc('protect', bytes, file.name);
            $('protect-workspace').classList.remove('hidden');
            $('protect-summary').innerHTML =
                `<strong>${file.name}</strong> - ${info.pages} page(s) · ${formatSize(file.size)}`;
        });
    },

    async encrypt() {
        const pw = $('protect-user-pw').value;
        if (!pw) return UI.toast('Enter an open password', 'error');
        await UI.run('Encrypting with AES-256…', async () => {
            const bytes = await engine.call('encrypt', 'protect', pw, $('protect-owner-pw').value,
                                            $('perm-print').checked, $('perm-copy').checked,
                                            $('perm-modify').checked, $('perm-annot').checked);
            download(bytes, 'protected.pdf');
            UI.toast('Encrypted - text stays searchable for anyone with the password', 'success');
        });
    },

    async decrypt() {
        await UI.run('Removing protection…', async () => {
            const bytes = await engine.call('decrypt', 'protect');
            download(bytes, 'unlocked.pdf');
            UI.toast('Password removed', 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 8. Redact                                                           */
/* ------------------------------------------------------------------ */

const RedactTool = {
    marks: [],
    applied: 0,

    init() {
        this.view = new DocView('redact', { onRender: () => this.drawMarks() });
        $('redact-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('redact-undo').addEventListener('click', () => {
            for (let i = this.marks.length - 1; i >= 0; i--) {
                if (this.marks[i].page === this.view.page) { this.marks.splice(i, 1); break; }
            }
            this.drawMarks();
        });
        $('redact-clear').addEventListener('click', () => {
            this.marks = this.marks.filter((m) => m.page !== this.view.page);
            this.drawMarks();
        });
        $('redact-search').addEventListener('click', () => this.findAndRedact());
        $('redact-apply').addEventListener('click', () => this.apply());
        // Repaint existing marks so the preview matches the chosen colour.
        $('redact-color').addEventListener('input', () => this.drawMarks());
        this.setupDraw();
    },

    async open(file) {
        if (!file) return;
        this.marks = [];
        this.applied = 0;
        await UI.run('Opening document…', () => this.view.load(file));
    },

    setupDraw() {
        const overlay = this.view.overlay;
        let start = null;
        let ghost = null;
        overlay.addEventListener('mousedown', (e) => {
            start = this.view.fracFromEvent(e);
            ghost = document.createElement('div');
            ghost.className = 'draw-ghost draw-ghost--redact';
            overlay.appendChild(ghost);
        });
        overlay.addEventListener('mousemove', (e) => {
            if (!start || !ghost) return;
            const now = this.view.fracFromEvent(e);
            Object.assign(ghost.style, {
                left: `${Math.min(start.x, now.x) * 100}%`,
                top: `${Math.min(start.y, now.y) * 100}%`,
                width: `${Math.abs(now.x - start.x) * 100}%`,
                height: `${Math.abs(now.y - start.y) * 100}%`,
            });
        });
        window.addEventListener('mouseup', (e) => {
            if (!start) return;
            const end = this.view.fracFromEvent(e);
            const from = start;
            start = null;
            if (ghost) { ghost.remove(); ghost = null; }
            const w = Math.abs(end.x - from.x);
            const h = Math.abs(end.y - from.y);
            if (w < 0.01 || h < 0.005) return;
            this.marks.push({ page: this.view.page, xFrac: Math.min(from.x, end.x),
                              yFrac: Math.min(from.y, end.y), wFrac: w, hFrac: h });
            this.drawMarks();
        });
    },

    drawMarks() {
        const overlay = this.view.overlay;
        const colour = $('redact-color').value;
        overlay.innerHTML = '';
        this.marks.filter((m) => m.page === this.view.page).forEach((m) => {
            const el = document.createElement('div');
            el.className = 'redact-box';
            el.style.cssText = `left:${m.xFrac * 100}%;top:${m.yFrac * 100}%;` +
                               `width:${m.wFrac * 100}%;height:${m.hFrac * 100}%;` +
                               `background:${colour}`;
            overlay.appendChild(el);
        });
        $('redact-count').textContent = this.marks.length
            ? `${this.marks.length} area(s) marked across the document.` : '';
    },

    async findAndRedact() {
        const term = $('redact-term').value.trim();
        if (!term) return UI.toast('Enter text to redact', 'error');
        await UI.run('Finding and redacting…', async () => {
            const n = await engine.call('redact_search', 'redact', term, '', $('redact-color').value);
            if (n) this.applied += n;
            await this.view.render();
            UI.toast(n ? `Redacted ${n} occurrence(s) - content deleted from the file` : 'No matches found',
                     n ? 'success' : 'error');
        });
    },

    async apply() {
        // Find-and-redact applies immediately, so allow saving those results
        // even when no hand-drawn marks are outstanding.
        if (!this.marks.length && !this.applied) {
            return UI.toast('Mark an area, or use find & redact, first', 'error');
        }
        await UI.run('Applying redactions…', async () => {
            if (this.marks.length) {
                await engine.call('redact', 'redact', JSON.stringify(this.marks),
                              $('redact-images').checked, $('redact-color').value);
                this.marks = [];
            }
            this.applied = 0;
            await this.view.render();
            await this.view.save('redacted.pdf');
            UI.toast('Redactions applied - the covered content is gone from the file', 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 9. Export                                                           */
/* ------------------------------------------------------------------ */

const ExportTool = {
    init() {
        $('export-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('export-doc').addEventListener('click', () => this.doc());
        $('export-html').addEventListener('click', () => this.html());
        $('export-text').addEventListener('click', () => this.text());
        $('export-tables-xlsx').addEventListener('click', () => this.tablesXlsx());
        $('export-tables').addEventListener('click', () => this.tables());
        $('export-images').addEventListener('click', () => this.images());
        $('export-pages').addEventListener('click', () => this.pageImages());
        $('export-fmt').addEventListener('change', (e) => {
            const isJpeg = e.target.value === 'jpeg';
            $('export-quality-row').classList.toggle('hidden', !isJpeg);
            $('export-pages-label').textContent = `Pages → ${isJpeg ? 'JPEG' : 'PNG'}`;
        });
        $('export-quality').addEventListener('input', (e) => {
            $('export-quality-value').textContent = e.target.value;
        });
    },

    async open(file) {
        if (!file) return;
        this.name = file.name.replace(/\.pdf$/i, '');
        await UI.run('Opening document…', async () => {
            const info = await engine.openDoc('export', await fileToBytes(file), file.name);
            $('export-workspace').classList.remove('hidden');
            $('export-summary').innerHTML = `<strong>${file.name}</strong> - ${info.pages} page(s)`;
        });
    },

    result(html) {
        const box = $('export-result');
        box.classList.remove('hidden');
        box.innerHTML = html;
    },

    async doc() {
        await UI.run('Building document…', async () => {
            const b64 = await engine.call('export_docx', 'export');
            const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            download(b64ToBytes(b64), `${this.name}.docx`, mime);
            this.result('Word document exported. Headings, bold and italic are preserved, ' +
                        'and the text is fully editable.');
        });
    },

    async html() {
        await UI.run('Building page…', async () => {
            const html = await engine.call('export_html', 'export');
            download(new Blob([html], { type: 'text/html' }), `${this.name}.html`);
            this.result('Web page exported, keeping the original page layout.');
        });
    },

    async text() {
        await UI.run('Extracting text…', async () => {
            const text = await engine.call('export_text', 'export');
            download(new Blob([text], { type: 'text/plain' }), `${this.name}.txt`);
            this.result(`Extracted ${text.length.toLocaleString()} characters.`);
        });
    },

    async tablesXlsx() {
        await UI.run('Detecting tables…', async () => {
            const result = await engine.callJSON('export_tables_xlsx', 'export');
            if (!result.ok) return this.result(result.reason);
            const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            download(b64ToBytes(result.b64), `${this.name}-tables.xlsx`, mime);
            this.result(`Built one Excel workbook with <strong>${result.sheets.length}</strong> sheet(s): ` +
                        result.sheets.map((s) => `${s.name} (${s.rows}×${s.cols})`).join(', '));
        });
    },

    async tables() {
        await UI.run('Detecting tables…', async () => {
            const tables = await engine.callJSON('export_tables', 'export');
            if (!tables.length) return this.result('No tables were detected in this PDF.');
            const zip = new JSZip();
            tables.forEach((t) => zip.file(t.name, t.csv));
            download(await zip.generateAsync({ type: 'blob' }), `${this.name}-tables.zip`, 'application/zip');
            this.result(`Found <strong>${tables.length}</strong> table(s): ` +
                        tables.map((t) => `${t.name} (${t.rows}×${t.cols})`).join(', '));
        });
    },

    async images() {
        await UI.run('Extracting images…', async () => {
            const images = await engine.callJSON('export_images', 'export');
            if (!images.length) return this.result('No embedded images found.');
            const zip = new JSZip();
            images.forEach((i) => zip.file(i.name, b64ToBytes(i.b64)));
            download(await zip.generateAsync({ type: 'blob' }), `${this.name}-images.zip`, 'application/zip');
            this.result(`Extracted <strong>${images.length}</strong> image(s) at original quality.`);
        });
    },

    async pageImages() {
        await UI.run('Rendering pages…', async () => {
            const fmt = $('export-fmt').value;
            const pages = await engine.callJSON('export_page_images', 'export',
                                                Number($('export-dpi').value || 150), fmt,
                                                $('export-pages-spec').value,
                                                Number($('export-quality').value || 90));
            const zip = new JSZip();
            pages.forEach((p) => zip.file(p.name, b64ToBytes(p.b64)));
            download(await zip.generateAsync({ type: 'blob' }), `${this.name}-pages.zip`, 'application/zip');
            this.result(`Rendered <strong>${pages.length}</strong> ${fmt === 'jpeg' ? 'JPEG' : 'PNG'} page image(s).`);
        });
    },
};

/* ------------------------------------------------------------------ */
/* 10. Compare                                                         */
/* ------------------------------------------------------------------ */

const CompareTool = {
    loaded: { a: false, b: false },

    init() {
        ['A', 'B'].forEach((slot) => {
            $(`compare${slot}-file`).addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                await UI.run('Loading…', async () => {
                    await engine.openDoc(`cmp${slot}`, await fileToBytes(file), file.name);
                    $(`compare${slot}-name`).textContent = file.name;
                    this.loaded[slot.toLowerCase()] = true;
                    $('compare-run').disabled = !(this.loaded.a && this.loaded.b);
                });
            });
        });
        $('compare-run').addEventListener('click', () => this.run());
        $('compare-download').addEventListener('click', () => this.download());
    },

    async run() {
        await UI.run('Comparing documents…', async () => {
            const diff = await engine.callJSON('compare', 'cmpA', 'cmpB');
            const box = $('compare-result');
            if (!diff.totalChanges) {
                box.innerHTML = '<div class="summary-box">The two documents are textually identical.</div>';
                return;
            }
            box.innerHTML = `<div class="summary-box"><strong>${diff.totalChanges}</strong> change(s) found.</div>` +
                diff.pages.filter((p) => p.changes.length || p.onlyIn).map((p) => `
                    <div class="diff-page">
                        <h4>Page ${p.page + 1} <span class="muted">(${p.similarity}% similar)</span></h4>
                        ${p.onlyIn ? `<p class="muted">Only present in the ${p.onlyIn === 'a' ? 'original' : 'revised'} document.</p>` : ''}
                        ${p.changes.map((c) => `
                            <div class="diff-row">
                                ${c.old ? `<div class="diff-old">− ${c.old}</div>` : ''}
                                ${c.new ? `<div class="diff-new">+ ${c.new}</div>` : ''}
                            </div>`).join('')}
                    </div>`).join('');
            $('compare-download').disabled = false;
        });
    },

    async download() {
        await UI.run('Highlighting differences…', async () => {
            const n = await engine.call('highlight_differences', 'cmpB', 'cmpA');
            const bytes = await engine.call('save', 'cmpB');
            download(bytes, 'compared-highlighted.pdf');
            UI.toast(`${n} difference(s) highlighted in the revised copy`, 'success');
        });
    },
};

/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 11. Find sensitive data                                             */
/* ------------------------------------------------------------------ */

const ScanTool = {
    hits: [],

    init() {
        $('scan-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('scan-run').addEventListener('click', () => this.run());
        $('scan-redact').addEventListener('click', () => this.redact());
        $('scan-select-all').addEventListener('click', () => {
            const boxes = $$('#scan-results input[type=checkbox]');
            const turnOn = boxes.some((b) => !b.checked);
            boxes.forEach((b) => { b.checked = turnOn; });
        });
    },

    async open(file) {
        if (!file) return;
        await UI.run('Opening document…', async () => {
            const info = await engine.openDoc('scan', await fileToBytes(file), file.name);
            $('scan-workspace').classList.remove('hidden');
            $('scan-results').innerHTML = '';
            $('scan-actions').classList.add('hidden');
            $('scan-summary').innerHTML = `<strong>${file.name}</strong> - ${info.pages} page(s)`;
        });
    },

    async run() {
        const kinds = $$('#scan-kinds input:checked').map((b) => b.value);
        if (!kinds.length) return UI.toast('Choose at least one thing to look for', 'error');

        await UI.run('Scanning for sensitive data…', async () => {
            const res = await engine.callJSON('scan_sensitive', 'scan', JSON.stringify(kinds));
            this.hits = res.hits;
            const box = $('scan-results');

            if (!res.total) {
                box.innerHTML = '<div class="result-box">Nothing matching was found in this document.</div>';
                $('scan-actions').classList.add('hidden');
                return;
            }

            const chips = Object.entries(res.summary)
                .map(([k, n]) => `<span class="chip">${k} · ${n}</span>`).join('');
            box.innerHTML = `<div class="chip-row">${chips}</div>` + res.hits.map((h, i) => `
                <label class="scan-row">
                    <input type="checkbox" data-hit="${i}" checked>
                    <span class="scan-kind">${h.kind}</span>
                    <code class="scan-text">${h.text.replace(/[<>&]/g, '')}</code>
                    <span class="muted">page ${h.page + 1}</span>
                    <span class="muted scan-label">${h.label}</span>
                </label>`).join('');
            $('scan-actions').classList.remove('hidden');
            UI.toast(`${res.total} item(s) found`, 'success');
        });
    },

    async redact() {
        const chosen = $$('#scan-results input[type=checkbox]')
            .filter((b) => b.checked).map((b) => this.hits[Number(b.dataset.hit)]);
        if (!chosen.length) return UI.toast('Select at least one item', 'error');

        await UI.run(`Redacting ${chosen.length} item(s)…`, async () => {
            await engine.call('redact_hits', 'scan', JSON.stringify(chosen), $('scan-color').value);
            const bytes = await engine.call('save', 'scan');
            download(bytes, 'redacted.pdf');
            UI.toast(`${chosen.length} item(s) permanently removed`, 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 12. Inspect & sanitize                                              */
/* ------------------------------------------------------------------ */

const InspectTool = {
    init() {
        $('inspect-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('inspect-clean').addEventListener('click', () => this.clean());
    },

    async open(file) {
        if (!file) return;
        await UI.run('Inspecting document…', async () => {
            await engine.openDoc('inspect', await fileToBytes(file), file.name);
            const res = await engine.callJSON('inspect', 'inspect');
            $('inspect-workspace').classList.remove('hidden');
            $('inspect-result').classList.add('hidden');

            const c = res.counts;
            $('inspect-counts').innerHTML =
                `<strong>${file.name}</strong> - ${res.pages} page(s) · ` +
                `<span class="lvl lvl--risk">${c.risk || 0} risk</span> ` +
                `<span class="lvl lvl--warn">${c.warn || 0} to review</span> ` +
                `<span class="lvl lvl--info">${c.info || 0} informational</span>`;

            $('inspect-findings').innerHTML = res.findings.length
                ? res.findings.map((f) => `
                    <div class="finding finding--${f.level}">
                        <span class="finding__area">${f.area}</span>
                        <span class="finding__detail">${String(f.detail).replace(/[<>]/g, '')}</span>
                    </div>`).join('')
                : '<div class="result-box">Nothing hidden was found - this document is clean.</div>';
        });
    },

    async clean() {
        await UI.run('Sanitizing…', async () => {
            const res = await engine.callJSON('sanitize', 'inspect',
                $('san-metadata').checked, $('san-attach').checked, $('san-js').checked,
                $('san-annots').checked, $('san-links').checked, $('san-forms').checked,
                $('san-hidden').checked);
            const bytes = await engine.call('save', 'inspect');
            download(bytes, 'sanitized.pdf');
            const box = $('inspect-result');
            box.classList.remove('hidden');
            box.innerHTML = res.removed.length
                ? `Removed:<ul>${res.removed.map((r) => `<li>${r}</li>`).join('')}</ul>`
                : 'Nothing needed removing.';
            UI.toast('Sanitized copy saved', 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 13. Find & replace                                                  */
/* ------------------------------------------------------------------ */

const ReplaceTool = {
    init() {
        $('replace-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('replace-preview').addEventListener('click', () => this.preview());
        $('replace-run').addEventListener('click', () => this.run());
    },

    async open(file) {
        if (!file) return;
        await UI.run('Opening document…', async () => {
            const info = await engine.openDoc('replace', await fileToBytes(file), file.name);
            $('replace-workspace').classList.remove('hidden');
            $('replace-result').classList.add('hidden');
            $('replace-summary').innerHTML = `<strong>${file.name}</strong> - ${info.pages} page(s)`;
        });
    },

    async preview() {
        const find = $('replace-find').value;
        if (!find) return UI.toast('Enter text to find', 'error');
        await UI.run('Searching…', async () => {
            const res = await engine.callJSON('find_occurrences', 'replace', find,
                                              $('replace-pages').value);
            const box = $('replace-result');
            box.classList.remove('hidden');
            box.innerHTML = res.count
                ? `<strong>${res.count}</strong> match(es): ` +
                  res.hits.slice(0, 12).map((h) => `page ${h.page + 1}${h.font ? ` (${h.font} ${h.size}pt)` : ''}`).join(', ') +
                  (res.count > 12 ? ' …' : '')
                : 'No matches found.';
        });
    },

    async run() {
        const find = $('replace-find').value;
        if (!find) return UI.toast('Enter text to find', 'error');
        await UI.run('Replacing…', async () => {
            const n = await engine.call('find_replace', 'replace', find,
                                        $('replace-with').value, $('replace-pages').value);
            if (!n) return UI.toast('No matches found', 'error');
            const bytes = await engine.call('save', 'replace');
            download(bytes, 'replaced.pdf');
            const box = $('replace-result');
            box.classList.remove('hidden');
            box.innerHTML = `Replaced <strong>${n}</strong> occurrence(s). The original text was removed from the file, not covered over.`;
            UI.toast(`${n} replaced`, 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* 14. Auto-split by content                                           */
/* ------------------------------------------------------------------ */

const AutoSplitTool = {
    init() {
        $('autosplit-file').addEventListener('change', (e) => this.open(e.target.files[0]));
        $('autosplit-preview').addEventListener('click', () => this.preview());
        $('autosplit-run').addEventListener('click', () => this.run());
    },

    async open(file) {
        if (!file) return;
        this.name = file.name.replace(/\.pdf$/i, '');
        await UI.run('Opening document…', async () => {
            const info = await engine.openDoc('autosplit', await fileToBytes(file), file.name);
            $('autosplit-workspace').classList.remove('hidden');
            $('autosplit-result').innerHTML = '';
            $('autosplit-run').disabled = true;
            $('autosplit-summary').innerHTML = `<strong>${file.name}</strong> - ${info.pages} page(s)`;
        });
    },

    args() {
        return [$('autosplit-pattern').value, $('autosplit-regex').checked,
                $('autosplit-name').checked];
    },

    async preview() {
        const [pattern] = this.args();
        if (!pattern) return UI.toast('Enter a marker to split on', 'error');
        await UI.run('Finding split points…', async () => {
            const res = await engine.callJSON('split_by_pattern', 'autosplit', ...this.args(), true);
            const box = $('autosplit-result');
            if (!res.parts.length) {
                box.innerHTML = `<div class="result-box">${res.message || 'No page matched.'}</div>`;
                $('autosplit-run').disabled = true;
                return;
            }
            box.innerHTML = `<div class="result-box">Will produce <strong>${res.count}</strong> file(s):</div>` +
                res.parts.map((p) => `
                    <div class="split-row">
                        <code>${p.name.replace(/[<>&]/g, '')}</code>
                        <span class="muted">pages ${p.from}–${p.to} (${p.pages})</span>
                    </div>`).join('');
            $('autosplit-run').disabled = false;
        });
    },

    async run() {
        await UI.run('Splitting…', async () => {
            const res = await engine.callJSON('split_by_pattern', 'autosplit', ...this.args(), false);
            if (!res.parts.length) return UI.toast('No page matched', 'error');
            const zip = new JSZip();
            const used = new Map();
            res.parts.forEach((p) => {
                // Two invoices can carry the same marker; keep both.
                const n = (used.get(p.name) || 0) + 1;
                used.set(p.name, n);
                zip.file(n > 1 ? p.name.replace(/\.pdf$/, `-${n}.pdf`) : p.name, b64ToBytes(p.b64));
            });
            download(await zip.generateAsync({ type: 'blob' }), `${this.name}-split.zip`, 'application/zip');
            UI.toast(`Split into ${res.count} files`, 'success');
        });
    },
};

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */

// One manifest drives the home cards, so adding a tool means editing one place.
const TOOL_CARDS = [
    { group: 'Edit', tab: 'edit', icon: '📝', name: 'Edit Text',
      blurb: 'Rewrite text for real - line by line or a whole paragraph with reflow.' },
    { group: 'Edit', tab: 'sign', icon: '🖊️', name: 'Fill & Sign',
      blurb: 'Draw or type a signature, add dates and checks, fill form fields.' },
    { group: 'Edit', tab: 'stamp', icon: '💧', name: 'Watermark & Stamps',
      blurb: 'Watermarks, approval stamps, page numbers and Bates numbering.' },
    { group: 'Edit', tab: 'replace', icon: '🔁', name: 'Find & Replace',
      blurb: 'Search and replace inside a PDF, matching the original styling.', badge: 'New' },

    { group: 'Organise', tab: 'pages', icon: '📚', name: 'Pages',
      blurb: 'Merge, split, reorder by drag, rotate and delete.' },
    { group: 'Organise', tab: 'autosplit', icon: '✂️', name: 'Auto-Split',
      blurb: 'Break a bundle into one file per invoice, named from the text.', badge: 'New' },
    { group: 'Organise', tab: 'compare', icon: '⚖️', name: 'Compare',
      blurb: 'Word-level diff between two versions, with changes highlighted.' },
    { group: 'Organise', tab: 'compress', icon: '🗜️', name: 'Compress',
      blurb: 'Shrink the file while text stays real, searchable text.' },

    { group: 'Protect', tab: 'scan', icon: '🛡️', name: 'Find Sensitive Data',
      blurb: 'Detect PAN, GSTIN, Aadhaar, cards and more - then redact them.', badge: 'New' },
    { group: 'Protect', tab: 'inspect', icon: '🕵️', name: 'Inspect & Sanitize',
      blurb: 'See what hides in a PDF - metadata, scripts, attachments - and strip it.', badge: 'New' },
    { group: 'Protect', tab: 'redact', icon: '⬛', name: 'Redact',
      blurb: 'Black out content so it is deleted from the file, not just covered.' },
    { group: 'Protect', tab: 'protect', icon: '🔒', name: 'Password Protect',
      blurb: 'AES-256 encryption with per-permission control.' },

    { group: 'Convert', tab: 'ocr', icon: '🔍', name: 'OCR',
      blurb: 'Turn a scan into a genuinely searchable, selectable document.' },
    { group: 'Convert', tab: 'export', icon: '📤', name: 'Export',
      blurb: 'Word, plain text, tables to CSV, images and page renders.' },
];

const Dashboard = {
    init() {
        const root = $('dashboard');
        if (!root) return;
        const groups = [];
        TOOL_CARDS.forEach((card) => {
            // Skip anything whose tab is missing, so the two can't fall out of sync.
            if (!$(`${card.tab}-tab`)) return;
            let group = groups.find((g) => g.name === card.group);
            if (!group) { group = { name: card.group, cards: [] }; groups.push(group); }
            group.cards.push(card);
        });

        root.innerHTML = groups.map((g) => `
            <section class="dash-group">
                <h3 class="dash-group__title">${g.name}</h3>
                <div class="dash-grid">
                    ${g.cards.map((c) => `
                        <button class="dash-card" data-goto="${c.tab}">
                            <span class="dash-card__icon">${c.icon}</span>
                            <span class="dash-card__name">${c.name}${
                                c.badge ? `<span class="dash-card__badge">${c.badge}</span>` : ''}</span>
                            <span class="dash-card__blurb">${c.blurb}</span>
                        </button>`).join('')}
                </div>
            </section>`).join('');

        $$('[data-goto]', root).forEach((btn) => {
            btn.addEventListener('click', () => UI.showTab(btn.dataset.goto));
        });
    },
};

const Tools = [EditTool, PagesTool, SignTool, StampTool, OcrTool,
               CompressTool, ProtectTool, RedactTool, ExportTool, CompareTool,
               ScanTool, InspectTool, ReplaceTool, AutoSplitTool, Dashboard];

// Start fetching the engine immediately - this file is loaded at the end of
// <body>, so the download overlaps with DOM construction instead of queueing
// behind it. Errors are handled when the UI attaches its progress display.
engine.boot().catch(() => {});

document.addEventListener('DOMContentLoaded', () => UI.init());

// Keep the engine in Cache Storage rather than leaving it to the HTTP cache,
// which evicts it often enough that returning visitors paid the full download
// again. Registered after load so it never competes with the first paint.
// Harmless where service workers are unavailable (private windows, file://).
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).catch(() => {});
    });
}

window.PDFSuite = { engine, UI, Tools, TOOL_CARDS };
