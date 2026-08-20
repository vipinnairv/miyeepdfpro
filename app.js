/* MiyeePDF — UI layer.
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
const APP_VERSION = '4.5.0';
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
     * has already started — that lets the download begin the moment this file
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
     * loadPackage() owns the actual fetch — it is the only thing that reliably
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
        // markup, so the app is fully browsable while the engine downloads —
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
        $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
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

    /** Run an async job with a spinner and uniform error reporting. */
    async run(message, job) {
        // On first use the engine may still be arriving; say so rather than
        // showing a task message that looks stuck.
        this.busy(engine.ready ? message : this.bootMessage);
        try {
            return await job();
        } catch (err) {
            console.error(err);
            const detail = String(err.message || err).split('\n').filter(Boolean).pop();
            this.toast(detail, 'error');
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

        $$(`[data-nav="${key}"]`).forEach((btn) => {
            btn.addEventListener('click', () => this.go(this.page + Number(btn.dataset.dir)));
        });
    }

    async load(file) {
        const bytes = await fileToBytes(file);
        this.file = file;
        this.info = await engine.callJSON('open_doc', this.docId, bytes);
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
        const png = await engine.call('render_page', this.docId, this.page, 110);
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
    pending: null,

    init() {
        this.view = new DocView('edit', { onRender: () => this.drawSpans() });
        $('edit-file').addEventListener('change', (e) => this.open(e.target.files[0]));

        $$('[data-editmode]').forEach((btn) => btn.addEventListener('click', () => {
            this.mode = btn.dataset.editmode;
            $$('[data-editmode]').forEach((b) => b.classList.toggle('active', b === btn));
            $('edit-hint').textContent =
                this.mode === 'TEXT' ? 'Click a highlighted line to edit it.'
              : this.mode === 'BLOCK' ? 'Click a paragraph to rewrite it — the text will rewrap to fit.'
              : `Drag across the page to add a ${this.mode} annotation.`;
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
                const n = await engine.call('set_outline', this.view.docId,
                                            JSON.stringify(this.outline || []));
                UI.toast(`${n} bookmark(s) applied — save to keep them`, 'success');
            });
        });

        $('edit-save').addEventListener('click', () => this.view.save('edited.pdf'));
        $('edit-search-btn').addEventListener('click', () => this.search());
        $('edit-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.search(); });
        $('text-modal-apply').addEventListener('click', () => this.applyEdit());
        $$('[data-textclose]').forEach((el) => el.addEventListener('click', () => $('text-modal').classList.add('hidden')));

        this.setupDragAnnotate();
    },

    async open(file) {
        if (!file) return;
        await UI.run('Opening document…', async () => {
            const info = await this.view.load(file);
            $('edit-doc-info').innerHTML =
                `<strong>${file.name}</strong><br>${info.pages} page(s) · ${formatSize(file.size)}`;
            $('outline-page').max = info.pages;
            await this.refreshAnnots();
            await this.loadOutline();
        });
    },

    async drawSpans() {
        const overlay = this.view.overlay;
        overlay.innerHTML = '';
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
                ? `Paragraph · ${item.lines} line(s) — click to rewrite`
                : `${item.font} ${item.size}pt — click to edit`;
            el.addEventListener('click', () => this.promptEdit(index));
            overlay.appendChild(el);
        });
    },

    promptEdit(index) {
        const item = this.spans[index];
        this.pending = item;
        this.pendingIsBlock = this.mode === 'BLOCK';
        $('text-modal-meta').textContent = this.pendingIsBlock
            ? `Paragraph · ${item.lines} line(s) · ${item.font} ${item.size}pt — text will rewrap`
            : `${item.font} · ${item.size}pt`;
        const input = $('text-modal-input');
        input.value = item.text;
        input.rows = this.pendingIsBlock ? 8 : 3;
        $('text-modal').classList.remove('hidden');
        input.focus();
    },

    async applyEdit() {
        const item = this.pending;
        const isBlock = this.pendingIsBlock;
        const next = $('text-modal-input').value;
        $('text-modal').classList.add('hidden');
        if (!item || next === item.text) return;

        await UI.run(isBlock ? 'Rewriting paragraph…' : 'Replacing text…', async () => {
            if (isBlock) {
                const res = await engine.callJSON('edit_block', this.view.docId, this.view.page,
                                                  item.bbox, next, item.font, item.size,
                                                  item.colorInt, item.flags, true);
                await this.view.render();
                UI.toast(res.grew
                    ? `Paragraph rewritten at ${res.size}pt — the box grew to fit`
                    : `Paragraph rewritten and rewrapped at ${res.size}pt`, 'success');
            } else {
                await engine.call('edit_text', this.view.docId, this.view.page, item.bbox,
                                  next, item.font, item.size, item.colorInt, item.flags);
                await this.view.render();
                UI.toast('Text replaced in the PDF content stream', 'success');
            }
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
                 <div class="muted">${a.content || '—'}</div></div>`).join('')
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
/* 2. Pages — merge / split / organise                                 */
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
                await engine.call('open_doc', id, await fileToBytes(files[i]));
                ids.push(id);
            }
            const merged = files.length > 1 ? await engine.call('merge', JSON.stringify(ids)) : null;
            if (merged) await engine.call('open_doc', 'pages', merged);
            else await engine.call('open_doc', 'pages', await fileToBytes(files[0]));
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
            UI.toast('Ready — click the page to place it', 'success');
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
            UI.toast('Watermark applied — press Save to download', 'success');
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
            const info = await engine.callJSON('open_doc', 'ocr', await fileToBytes(file));
            this.pages = info.pages;
            const needs = [];
            for (let i = 0; i < info.pages; i++) {
                if (await engine.call('needs_ocr', 'ocr', i)) needs.push(i);
            }
            this.needs = needs;
            $('ocr-workspace').classList.remove('hidden');
            $('ocr-save').disabled = true;
            $('ocr-summary').innerHTML =
                `<strong>${file.name}</strong> — ${info.pages} page(s).<br>` +
                (needs.length
                    ? `<span class="warn">${needs.length} page(s) look scanned and have no searchable text.</span>`
                    : 'Every page already has extractable text — OCR is optional here.');
        });
    },

    async run() {
        const scope = $('ocr-scope').value;
        const targets = scope === 'all' ? Array.from({ length: this.pages }, (_, i) => i) : this.needs;
        if (!targets.length) return UI.toast('Nothing to OCR', 'error');

        $('ocr-bar').classList.remove('hidden');
        $('ocr-run').disabled = true;

        // The language pack is ~11 MB on first use. Without this logger the UI
        // sits silent through the download and looks like it has frozen.
        const setProgress = (pct, label) => {
            $('ocr-fill').style.width = `${pct}%`;
            $('ocr-pct').textContent = `${pct}%`;
            if (label) $('ocr-status').textContent = label;
        };
        setProgress(0, 'Loading OCR engine…');

        let worker;
        try {
            worker = await Tesseract.createWorker($('ocr-lang').value, 1, {
                logger: (m) => {
                    if (m.status && m.status !== 'recognizing text') {
                        setProgress(Math.round((m.progress || 0) * 100),
                                    `${m.status.charAt(0).toUpperCase()}${m.status.slice(1)}…`);
                    }
                },
            });
        } catch (err) {
            console.error(err);
            $('ocr-status').textContent =
                `Could not load the OCR engine (${err.message}). Check your connection and try again.`;
            $('ocr-run').disabled = false;
            return UI.toast('OCR engine failed to load', 'error');
        }

        let done = 0;
        try {
            for (const pno of targets) {
                $('ocr-status').textContent =
                    `Recognising page ${pno + 1} of ${targets.length === 1 ? pno + 1 : this.pages}…`;
                // Render at higher DPI: OCR accuracy depends on input resolution.
                const png = await engine.call('render_page', 'ocr', pno, 200);
                const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
                const { data } = await worker.recognize(url);

                const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
                const words = (data.words || []).map((w) => ({ text: w.text, bbox: w.bbox }));
                await engine.call('insert_ocr_layer', 'ocr', pno, JSON.stringify(words),
                                  bitmap.width, bitmap.height);
                URL.revokeObjectURL(url);

                done++;
                setProgress(Math.round((done / targets.length) * 100));
            }
            $('ocr-status').textContent = `Done — ${done} page(s) now carry a searchable text layer.`;
            $('ocr-save').disabled = false;
            UI.toast('OCR complete', 'success');
        } catch (err) {
            console.error(err);
            $('ocr-status').textContent = `OCR failed: ${err.message}`;
            UI.toast(`OCR failed: ${err.message}`, 'error');
        } finally {
            $('ocr-run').disabled = false;
            await worker.terminate();
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
            const info = await engine.callJSON('open_doc', 'compress', await fileToBytes(file));
            $('compress-workspace').classList.remove('hidden');
            $('compress-result').classList.add('hidden');
            $('compress-summary').innerHTML =
                `<strong>${file.name}</strong> — ${formatSize(file.size)} · ${info.pages} page(s)`;
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
            try {
                await engine.call('open_doc', 'protect', bytes);
            } catch (err) {
                if (!String(err.message).includes('PASSWORD_REQUIRED')) throw err;
                const pw = prompt('This PDF is password-protected. Enter the password:');
                if (!pw) throw new Error('Password required to open this file');
                await engine.call('open_doc', 'protect', bytes, pw);
            }
            const info = await engine.callJSON('doc_info', 'protect');
            $('protect-workspace').classList.remove('hidden');
            $('protect-summary').innerHTML =
                `<strong>${file.name}</strong> — ${info.pages} page(s) · ${formatSize(file.size)}`;
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
            UI.toast('Encrypted — text stays searchable for anyone with the password', 'success');
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
            UI.toast(n ? `Redacted ${n} occurrence(s) — content deleted from the file` : 'No matches found',
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
            UI.toast('Redactions applied — the covered content is gone from the file', 'success');
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
        $('export-text').addEventListener('click', () => this.text());
        $('export-tables').addEventListener('click', () => this.tables());
        $('export-images').addEventListener('click', () => this.images());
        $('export-pages').addEventListener('click', () => this.pageImages());
    },

    async open(file) {
        if (!file) return;
        this.name = file.name.replace(/\.pdf$/i, '');
        await UI.run('Opening document…', async () => {
            const info = await engine.callJSON('open_doc', 'export', await fileToBytes(file));
            $('export-workspace').classList.remove('hidden');
            $('export-summary').innerHTML = `<strong>${file.name}</strong> — ${info.pages} page(s)`;
        });
    },

    result(html) {
        const box = $('export-result');
        box.classList.remove('hidden');
        box.innerHTML = html;
    },

    async doc() {
        await UI.run('Building document…', async () => {
            const html = await engine.call('export_html', 'export');
            // .doc with an HTML payload is what Word opens with layout intact.
            download(new Blob([html], { type: 'application/msword' }), `${this.name}.doc`);
            this.result('Word document exported. Open it in Word or Google Docs.');
        });
    },

    async text() {
        await UI.run('Extracting text…', async () => {
            const text = await engine.call('export_text', 'export');
            download(new Blob([text], { type: 'text/plain' }), `${this.name}.txt`);
            this.result(`Extracted ${text.length.toLocaleString()} characters.`);
        });
    },

    async tables() {
        await UI.run('Detecting tables…', async () => {
            const tables = await engine.callJSON('export_tables', 'export');
            if (!tables.length) return this.result('No ruled tables were detected in this PDF.');
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
            const pages = await engine.callJSON('export_page_images', 'export',
                                                Number($('export-dpi').value || 150), 'png',
                                                $('export-pages-spec').value);
            const zip = new JSZip();
            pages.forEach((p) => zip.file(p.name, b64ToBytes(p.b64)));
            download(await zip.generateAsync({ type: 'blob' }), `${this.name}-pages.zip`, 'application/zip');
            this.result(`Rendered <strong>${pages.length}</strong> page image(s).`);
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
                    await engine.call('open_doc', `cmp${slot}`, await fileToBytes(file));
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
            const info = await engine.callJSON('open_doc', 'scan', await fileToBytes(file));
            $('scan-workspace').classList.remove('hidden');
            $('scan-results').innerHTML = '';
            $('scan-actions').classList.add('hidden');
            $('scan-summary').innerHTML = `<strong>${file.name}</strong> — ${info.pages} page(s)`;
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
            await engine.call('open_doc', 'inspect', await fileToBytes(file));
            const res = await engine.callJSON('inspect', 'inspect');
            $('inspect-workspace').classList.remove('hidden');
            $('inspect-result').classList.add('hidden');

            const c = res.counts;
            $('inspect-counts').innerHTML =
                `<strong>${file.name}</strong> — ${res.pages} page(s) · ` +
                `<span class="lvl lvl--risk">${c.risk || 0} risk</span> ` +
                `<span class="lvl lvl--warn">${c.warn || 0} to review</span> ` +
                `<span class="lvl lvl--info">${c.info || 0} informational</span>`;

            $('inspect-findings').innerHTML = res.findings.length
                ? res.findings.map((f) => `
                    <div class="finding finding--${f.level}">
                        <span class="finding__area">${f.area}</span>
                        <span class="finding__detail">${String(f.detail).replace(/[<>]/g, '')}</span>
                    </div>`).join('')
                : '<div class="result-box">Nothing hidden was found — this document is clean.</div>';
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
            const info = await engine.callJSON('open_doc', 'replace', await fileToBytes(file));
            $('replace-workspace').classList.remove('hidden');
            $('replace-result').classList.add('hidden');
            $('replace-summary').innerHTML = `<strong>${file.name}</strong> — ${info.pages} page(s)`;
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
            const info = await engine.callJSON('open_doc', 'autosplit', await fileToBytes(file));
            $('autosplit-workspace').classList.remove('hidden');
            $('autosplit-result').innerHTML = '';
            $('autosplit-run').disabled = true;
            $('autosplit-summary').innerHTML = `<strong>${file.name}</strong> — ${info.pages} page(s)`;
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
      blurb: 'Rewrite text for real — line by line or a whole paragraph with reflow.' },
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
      blurb: 'Detect PAN, GSTIN, Aadhaar, cards and more — then redact them.', badge: 'New' },
    { group: 'Protect', tab: 'inspect', icon: '🕵️', name: 'Inspect & Sanitize',
      blurb: 'See what hides in a PDF — metadata, scripts, attachments — and strip it.', badge: 'New' },
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

// Start fetching the engine immediately — this file is loaded at the end of
// <body>, so the download overlaps with DOM construction instead of queueing
// behind it. Errors are handled when the UI attaches its progress display.
engine.boot().catch(() => {});

document.addEventListener('DOMContentLoaded', () => UI.init());
window.PDFSuite = { engine, UI, Tools, TOOL_CARDS };
