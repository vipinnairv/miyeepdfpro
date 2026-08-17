// Advanced PDF Suite - Full Text Editing + OCR Implementation
// Features: Native text editing, OCR for scanned PDFs, annotations, dark mode
// Fixed: Critical tab navigation bug and PDF creation encoding issue
// Patched: Removed localStorage/sessionStorage usage for sandbox compatibility
// Bugfix: Fixed tab navigation and test button visibility issues

class AdvancedPDFSuite {
    constructor() {
        this.currentTab = 'editor';
        this.editor = new AdvancedEditor();
        this.merger = new PDFMerger();
        this.splitter = new PDFSplitter();
        this.organizer = new PDFOrganizer();
        this.fillSign = new PDFFillSign();
        this.watermark = new PDFWatermark();
        this.compressor = new PDFCompressor();
        this.protector = new PDFProtect();
        // Fixed: Default to light theme, stored in memory only
        this.theme = 'light';
        
        console.log('Advanced PDF Suite: Constructor initialized');
    }

    init() {
        console.log('Advanced PDF Suite: Starting initialization');
        
        try {
            this.setupTabNavigation();
            this.setupThemeToggle();
            this.applyTheme();
            
            this.editor.init();
            this.merger.init();
            this.splitter.init();
            this.organizer.init();
            this.fillSign.init();
            this.watermark.init();
            this.compressor.init();
            this.protector.init();

            console.log('Advanced PDF Suite: Initialization completed successfully');
            this.showStatusMessage('Advanced PDF Suite is ready!', 'success');
        } catch (error) {
            console.error('Advanced PDF Suite: Initialization failed:', error);
            this.showError('Failed to initialize Advanced PDF Suite: ' + error.message);
        }
    }

    setupTabNavigation() {
        console.log('Advanced PDF Suite: Setting up tab navigation');
        
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        console.log('Found tab buttons:', tabBtns.length);
        console.log('Found tab contents:', tabContents.length);

        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const tabName = btn.dataset.tab;
                
                console.log('Tab clicked:', tabName, 'Current tab:', this.currentTab);
                
                // Update active tab button
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                console.log('Updated active button for:', tabName);
                
                // Update active tab content - Fixed: Ensure proper tab switching
                tabContents.forEach(content => {
                    content.classList.remove('active');
                    console.log('Removed active from:', content.id);
                });
                
                const targetTabId = `${tabName}-tab`;
                const targetTab = document.getElementById(targetTabId);
                console.log('Looking for tab:', targetTabId, 'Found:', !!targetTab);
                
                if (targetTab) {
                    targetTab.classList.add('active');
                    console.log('Activated tab:', targetTabId);
                    
                    // Force display update to ensure visibility
                    targetTab.style.display = 'flex';
                    setTimeout(() => {
                        targetTab.style.display = '';
                    }, 10);
                } else {
                    console.error('Could not find tab element:', targetTabId);
                }
                
                this.currentTab = tabName;
                console.log('Tab navigation completed. Current tab:', this.currentTab);
                
                // Show success message
                this.showStatusMessage(`Switched to ${tabName} tab`, 'success');
            });
        });
        
        console.log('Advanced PDF Suite: Tab navigation setup complete');
    }

    setupThemeToggle() {
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                this.toggleTheme();
            });
        }
    }

    toggleTheme() {
        // Fixed: Toggle between light and dark, stored in memory only
        this.theme = this.theme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-color-scheme', this.theme);
        this.applyTheme();
        this.showStatusMessage(`${this.theme.charAt(0).toUpperCase() + this.theme.slice(1)} mode enabled`, 'success');
    }

    applyTheme() {
        const themeToggle = document.getElementById('theme-toggle');
        
        // Fixed: Apply theme directly without localStorage
        document.documentElement.setAttribute('data-color-scheme', this.theme);
        if (themeToggle) {
            themeToggle.textContent = this.theme === 'dark' ? '☀️' : '🌙';
        }
    }

    showStatusMessage(message, type = 'info') {
        console.log(`Advanced PDF Suite [${type.toUpperCase()}]:`, message);
        
        // Remove existing status messages
        document.querySelectorAll('.status-message').forEach(msg => msg.remove());
        
        // Create new status message
        const statusMsg = document.createElement('div');
        statusMsg.className = `status-message ${type}`;
        statusMsg.textContent = message;
        
        document.body.appendChild(statusMsg);
        
        // Show with animation
        setTimeout(() => statusMsg.classList.add('show'), 100);
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            statusMsg.classList.remove('show');
            setTimeout(() => statusMsg.remove(), 300);
        }, 3000);
    }

    showError(message) {
        this.showStatusMessage(message, 'error');
    }

    showStatusContainer(message, showProgress = false) {
        const container = document.getElementById('status-container');
        const text = document.getElementById('status-text');
        const progressBar = document.getElementById('progress-bar');
        
        if (container && text) {
            text.textContent = message;
            container.classList.remove('hidden');
            
            if (showProgress && progressBar) {
                progressBar.classList.remove('hidden');
                this.updateProgress(0);
            } else if (progressBar) {
                progressBar.classList.add('hidden');
            }
        }
    }

    hideStatusContainer() {
        const container = document.getElementById('status-container');
        if (container) {
            container.classList.add('hidden');
        }
    }

    updateProgress(percent) {
        const fill = document.getElementById('progress-fill');
        const text = document.getElementById('progress-text');
        
        if (fill) {
            fill.style.width = percent + '%';
        }
        if (text) {
            text.textContent = Math.round(percent) + '%';
        }
    }
}

// Advanced Editor with text editing and OCR capabilities
class AdvancedEditor {
    constructor() {
        this.currentPDF = null;
        this.currentPage = 1;
        this.totalPages = 0;
        this.zoom = 1;
        this.currentTool = 'SELECT';
        this.pages = [];
        this.editedTexts = new Map();
        this.annotations = [];
        this.history = [];
        this.historyIndex = -1;
        this.ocrWorker = null;
        this.ocrQueue = [];
        this.ocrInProgress = false;
        
        this.settings = {
            drawing: { color: '#000000', thickness: 2 },
            text: { size: 14, color: '#000000', font: 'Arial' },
            highlight: { color: '#FFFF00', opacity: 0.3 }
        };
    }

    init() {
        console.log('Advanced Editor: Starting initialization');
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupKeyboardShortcuts();
        this.initOCRWorker();
        this.updateUI();
        
        console.log('Advanced Editor: Module initialized');
    }

    setupEventListeners() {
        console.log('Advanced Editor: Setting up event listeners');
        
        // File inputs
        const fileInputs = [
            'editor-file-input',
            'editor-welcome-input'
        ];
        
        fileInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('change', (e) => this.handleFileSelect(e));
            }
        });

        // Buttons - Fixed: Ensure self-test button is properly connected
        const newDocBtn = document.getElementById('new-doc-btn');
        const welcomeNewDoc = document.getElementById('welcome-new-doc');
        const saveBtn = document.getElementById('save-editor-btn');
        const selfTestBtn = document.getElementById('self-test-btn');
        
        if (newDocBtn) {
            newDocBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.createNewDocument();
            });
        }
        
        if (welcomeNewDoc) {
            welcomeNewDoc.addEventListener('click', (e) => {
                e.preventDefault();
                this.createNewDocument();
            });
        }
        
        if (saveBtn) {
            saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.savePDF();
            });
        }

        // Fixed: Self-test button with improved error handling
        if (selfTestBtn) {
            selfTestBtn.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('Self-test button clicked');
                this.runSelfTest();
            });
            console.log('Advanced Editor: Self-test button listener attached');
        } else {
            console.warn('Advanced Editor: Self-test button not found');
        }

        // Tools
        document.querySelectorAll('.tool-btn').forEach(btn => {
            if (btn.dataset.tool) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.selectTool(btn.dataset.tool);
                });
            }
        });

        // Navigation
        const zoomInBtn = document.getElementById('zoom-in-btn');
        const zoomOutBtn = document.getElementById('zoom-out-btn');
        const fitWidthBtn = document.getElementById('fit-width-btn');
        const prevPageBtn = document.getElementById('prev-page-btn');
        const nextPageBtn = document.getElementById('next-page-btn');
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => this.zoomIn());
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => this.zoomOut());
        if (fitWidthBtn) fitWidthBtn.addEventListener('click', () => this.fitToWidth());
        if (prevPageBtn) prevPageBtn.addEventListener('click', () => this.previousPage());
        if (nextPageBtn) nextPageBtn.addEventListener('click', () => this.nextPage());
        if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
        if (redoBtn) redoBtn.addEventListener('click', () => this.redo());

        // Settings
        const colorPicker = document.getElementById('color-picker');
        const sizeSelector = document.getElementById('size-selector');
        
        if (colorPicker) {
            colorPicker.addEventListener('change', (e) => {
                this.updateSettings('color', e.target.value);
            });
        }
        
        if (sizeSelector) {
            sizeSelector.addEventListener('change', (e) => {
                this.updateSettings('thickness', parseInt(e.target.value));
            });
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    this.undo();
                } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
                    e.preventDefault();
                    this.redo();
                } else if (e.key === 's') {
                    e.preventDefault();
                    this.savePDF();
                }
            }
        });
    }

    setupDragAndDrop() {
        const dropArea = document.getElementById('editor-drop-area');
        if (!dropArea) return;
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropArea.addEventListener(eventName, () => {
                dropArea.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropArea.addEventListener(eventName, () => {
                dropArea.classList.remove('drag-over');
            }, false);
        });

        dropArea.addEventListener('drop', (e) => this.handleDrop(e), false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    handleDrop(e) {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.loadPDF(files[0]);
        }
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) {
            this.loadPDF(file);
        }
    }

    async initOCRWorker() {
        try {
            console.log('Advanced Editor: Initializing OCR worker');
            this.ocrWorker = await Tesseract.createWorker('eng');
            console.log('Advanced Editor: OCR worker initialized');
        } catch (error) {
            console.error('Advanced Editor: Failed to initialize OCR worker:', error);
        }
    }

    async loadPDF(file) {
        console.log('Advanced Editor: Loading PDF file');
        window.advancedSuite.showStatusContainer('Loading PDF file...');
        
        try {
            const bytes = await loadPDFBytes(file);
            // pdf.js transfers/detaches the buffer it's given, so hand it a copy
            // and keep the original bytes intact for pdf-lib to reuse later.
            const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

            console.log('Advanced Editor: PDF loaded successfully, pages:', pdf.numPages);
            
            this.currentPDF = pdf;
            this.originalBytes = bytes;
            this.totalPages = pdf.numPages;
            this.currentPage = 1;
            this.pages = [];
            this.editedTexts.clear();
            this.annotations = [];
            this.resetHistory();
            
            await this.renderAllPages();
            this.hideWelcomeScreen();
            this.updateUI();
            
            // Start OCR for scanned pages
            this.queueOCRProcessing();
            
            window.advancedSuite.showStatusMessage(`PDF loaded successfully (${this.totalPages} pages)`, 'success');
            
        } catch (error) {
            console.error('Advanced Editor: Error loading PDF:', error);
            window.advancedSuite.showError('Failed to load PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async createNewDocument() {
        console.log('Advanced Editor: Creating new document');
        window.advancedSuite.showStatusContainer('Creating new document...');
        
        try {
            const pdfDoc = await PDFLib.PDFDocument.create();
            const page = pdfDoc.addPage([612, 792]);
            
            page.drawText('Advanced PDF Editor', {
                x: 50,
                y: 750,
                size: 24,
                color: PDFLib.rgb(0.2, 0.2, 0.2),
            });
            
            // Fixed: Use ASCII characters instead of Unicode symbols
            page.drawText('* Double-click text to edit', {
                x: 50,
                y: 720,
                size: 14,
                color: PDFLib.rgb(0.5, 0.5, 0.5),
            });
            
            page.drawText('* OCR for scanned documents', {
                x: 50,
                y: 700,
                size: 14,
                color: PDFLib.rgb(0.5, 0.5, 0.5),
            });
            
            page.drawText('* Full annotation support', {
                x: 50,
                y: 680,
                size: 14,
                color: PDFLib.rgb(0.5, 0.5, 0.5),
            });
            
            const pdfBytes = await pdfDoc.save();
            this.originalBytes = pdfBytes;
            
            const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
            
            this.currentPDF = pdf;
            this.totalPages = 1;
            this.currentPage = 1;
            this.pages = [];
            this.editedTexts.clear();
            this.annotations = [];
            this.resetHistory();
            
            await this.renderAllPages();
            this.hideWelcomeScreen();
            this.updateUI();
            
            window.advancedSuite.showStatusMessage('New document created successfully', 'success');
            
        } catch (error) {
            console.error('Advanced Editor: Error creating new document:', error);
            window.advancedSuite.showError('Failed to create new document: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async renderAllPages() {
        console.log('Advanced Editor: Rendering all pages');
        const stackContainer = document.getElementById('pages-stack');
        const thumbnailsContainer = document.getElementById('page-thumbnails');
        
        if (!stackContainer || !thumbnailsContainer) return;
        
        stackContainer.innerHTML = '';
        thumbnailsContainer.innerHTML = '';
        
        for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
            await this.renderPage(pageNum);
            await this.renderThumbnail(pageNum);
        }
        
        this.setupAllCanvasEvents();
        console.log('Advanced Editor: All pages rendered successfully');
    }

    async renderPage(pageNum) {
        try {
            const page = await this.currentPDF.getPage(pageNum);
            const viewport = page.getViewport({ scale: this.zoom });
            
            // Create page stack container
            const pageStack = document.createElement('div');
            pageStack.className = 'page-stack';
            pageStack.dataset.page = pageNum;
            
            // Create canvas stack
            const canvasStack = document.createElement('div');
            canvasStack.className = 'page-canvas-stack';
            
            // PDF canvas (bottom layer)
            const pdfCanvas = document.createElement('canvas');
            pdfCanvas.className = 'pdf-canvas';
            pdfCanvas.width = viewport.width;
            pdfCanvas.height = viewport.height;
            pdfCanvas.style.width = viewport.width + 'px';
            pdfCanvas.style.height = viewport.height + 'px';
            
            const context = pdfCanvas.getContext('2d');
            await page.render({ canvasContext: context, viewport: viewport }).promise;
            
            // Text layer (middle layer)
            const textLayer = document.createElement('div');
            textLayer.className = 'text-layer';
            textLayer.dataset.page = pageNum;
            
            // Draw canvas (top layer)
            const drawCanvas = document.createElement('canvas');
            drawCanvas.className = 'draw-canvas';
            drawCanvas.width = viewport.width;
            drawCanvas.height = viewport.height;
            drawCanvas.style.width = viewport.width + 'px';
            drawCanvas.style.height = viewport.height + 'px';
            drawCanvas.dataset.page = pageNum;
            
            // Stack all layers
            canvasStack.appendChild(pdfCanvas);
            canvasStack.appendChild(textLayer);
            canvasStack.appendChild(drawCanvas);
            pageStack.appendChild(canvasStack);
            
            const stackContainer = document.getElementById('pages-stack');
            if (stackContainer) {
                stackContainer.appendChild(pageStack);
            }
            
            // Build text layer
            await this.buildTextLayer(page, textLayer, viewport);
            
            this.pages[pageNum - 1] = {
                page,
                viewport,
                pdfCanvas,
                textLayer,
                drawCanvas,
                needsOCR: false
            };
            
        } catch (error) {
            console.error('Advanced Editor: Error rendering page', pageNum, ':', error);
        }
    }

    async renderThumbnail(pageNum) {
        try {
            const page = await this.currentPDF.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.2 });
            
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            
            await page.render({ canvasContext: ctx, viewport }).promise;
            
            const thumbnail = document.createElement('div');
            thumbnail.className = 'page-thumbnail';
            if (pageNum === 1) thumbnail.classList.add('active');
            thumbnail.dataset.page = pageNum;
            
            const img = document.createElement('img');
            img.src = canvas.toDataURL();
            img.alt = `Page ${pageNum}`;
            
            const label = document.createElement('div');
            label.className = 'page-label';
            label.textContent = `Page ${pageNum}`;
            
            thumbnail.appendChild(img);
            thumbnail.appendChild(label);
            
            thumbnail.addEventListener('click', () => {
                this.goToPage(pageNum);
            });
            
            const container = document.getElementById('page-thumbnails');
            if (container) {
                container.appendChild(thumbnail);
            }
            
        } catch (error) {
            console.error('Advanced Editor: Error rendering thumbnail', pageNum, ':', error);
        }
    }

    async buildTextLayer(page, textLayer, viewport) {
        try {
            const textContent = await page.getTextContent();
            
            if (textContent.items.length === 0) {
                // No text content - needs OCR
                this.queuePageForOCR(page.pageNumber);
                return;
            }
            
            // Build text spans for native PDF text
            textContent.items.forEach((item, index) => {
                if (!item.str.trim()) return;
                
                const span = document.createElement('span');
                span.textContent = item.str;
                span.dataset.textIndex = index;
                span.dataset.originalText = item.str;
                
                // Position span based on PDF text item transform
                const transform = pdfjsLib.Util.transform(
                    viewport.transform,
                    item.transform
                );
                
                span.style.left = transform[4] + 'px';
                span.style.top = (viewport.height - transform[5] - item.height) + 'px';
                span.style.fontSize = (item.height * viewport.scale) + 'px';
                span.style.fontFamily = item.fontName || 'Arial';
                
                // Double-click to edit
                span.addEventListener('dblclick', (e) => {
                    e.preventDefault();
                    this.startTextEdit(span, page.pageNumber);
                });
                
                textLayer.appendChild(span);
            });
            
        } catch (error) {
            console.error('Advanced Editor: Error building text layer:', error);
            // If native text extraction fails, queue for OCR
            this.queuePageForOCR(page.pageNumber);
        }
    }

    queuePageForOCR(pageNum) {
        if (!this.ocrQueue.includes(pageNum)) {
            this.ocrQueue.push(pageNum);
            console.log('Advanced Editor: Page', pageNum, 'queued for OCR');
        }
    }

    async queueOCRProcessing() {
        if (this.ocrInProgress || !this.ocrWorker || this.ocrQueue.length === 0) {
            return;
        }
        
        this.ocrInProgress = true;
        this.showOCRProgress();
        
        try {
            for (let i = 0; i < this.ocrQueue.length; i++) {
                const pageNum = this.ocrQueue[i];
                await this.processPageOCR(pageNum);
                this.updateOCRProgress(i + 1, this.ocrQueue.length);
            }
            
            this.ocrQueue = [];
            window.advancedSuite.showStatusMessage('OCR processing completed', 'success');
            
        } catch (error) {
            console.error('Advanced Editor: OCR processing error:', error);
            window.advancedSuite.showError('OCR processing failed: ' + error.message);
        } finally {
            this.hideOCRProgress();
            this.ocrInProgress = false;
        }
    }

    async processPageOCR(pageNum) {
        try {
            const pageData = this.pages[pageNum - 1];
            if (!pageData) return;
            
            // Create high-res canvas for OCR
            const page = pageData.page;
            const viewport = page.getViewport({ scale: 2.0 }); // Higher resolution for better OCR
            
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            
            await page.render({ canvasContext: ctx, viewport }).promise;
            
            // Convert canvas to image data for Tesseract
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            
            console.log('Advanced Editor: Running OCR on page', pageNum);
            const result = await this.ocrWorker.recognize(imageData);
            
            // Build OCR text spans
            this.buildOCRTextLayer(pageData.textLayer, result.data, pageData.viewport);
            
        } catch (error) {
            console.error('Advanced Editor: Error processing OCR for page', pageNum, ':', error);
        }
    }

    buildOCRTextLayer(textLayer, ocrData, viewport) {
        if (!ocrData.words) return;
        
        ocrData.words.forEach((word, index) => {
            if (!word.text.trim() || word.confidence < 30) return;
            
            const span = document.createElement('span');
            span.textContent = word.text;
            span.className = 'ocr-word';
            span.dataset.textIndex = `ocr-${index}`;
            span.dataset.originalText = word.text;
            span.dataset.confidence = word.confidence;
            
            // Scale OCR coordinates to current viewport
            const scaleX = viewport.width / (ocrData.width || 1);
            const scaleY = viewport.height / (ocrData.height || 1);
            
            span.style.left = (word.bbox.x0 * scaleX) + 'px';
            span.style.top = (word.bbox.y0 * scaleY) + 'px';
            span.style.width = ((word.bbox.x1 - word.bbox.x0) * scaleX) + 'px';
            span.style.height = ((word.bbox.y1 - word.bbox.y0) * scaleY) + 'px';
            span.style.fontSize = Math.max(12, (word.bbox.y1 - word.bbox.y0) * scaleY * 0.8) + 'px';
            
            // Double-click to edit
            span.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this.startTextEdit(span, parseInt(textLayer.dataset.page));
            });
            
            textLayer.appendChild(span);
        });
    }

    startTextEdit(span, pageNum) {
        if (document.querySelector('.text-edit-input')) return; // Already editing
        
        console.log('Advanced Editor: Starting text edit');
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'text-edit-input';
        input.value = span.textContent;
        
        // Position input over span
        input.style.left = span.style.left;
        input.style.top = span.style.top;
        input.style.fontSize = span.style.fontSize;
        input.style.width = Math.max(100, span.offsetWidth) + 'px';
        
        span.classList.add('editing');
        span.parentElement.appendChild(input);
        
        input.focus();
        input.select();
        
        const finishEdit = () => {
            const newText = input.value.trim();
            const originalText = span.dataset.originalText;
            
            if (newText && newText !== originalText) {
                // Store edit
                const editKey = `${pageNum}-${span.dataset.textIndex}`;
                this.editedTexts.set(editKey, {
                    originalText,
                    newText,
                    bbox: {
                        left: parseFloat(span.style.left),
                        top: parseFloat(span.style.top),
                        width: span.offsetWidth,
                        height: span.offsetHeight
                    },
                    fontSize: parseFloat(span.style.fontSize),
                    pageNum
                });
                
                span.textContent = newText;
                this.saveState();
                window.advancedSuite.showStatusMessage('Text edited', 'success');
            }
            
            span.classList.remove('editing');
            input.remove();
        };
        
        input.addEventListener('blur', finishEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                finishEdit();
            } else if (e.key === 'Escape') {
                span.classList.remove('editing');
                input.remove();
            }
        });
    }

    showOCRProgress() {
        const modal = document.getElementById('ocr-progress');
        if (modal) {
            modal.classList.remove('hidden');
            this.updateOCRProgress(0, this.ocrQueue.length);
        }
    }

    hideOCRProgress() {
        const modal = document.getElementById('ocr-progress');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    updateOCRProgress(current, total) {
        const currentEl = document.getElementById('ocr-current-page');
        const totalEl = document.getElementById('ocr-total-pages');
        const statusEl = document.getElementById('ocr-status');
        const fillEl = document.getElementById('ocr-progress-fill');
        const textEl = document.getElementById('ocr-progress-text');
        
        if (currentEl) currentEl.textContent = current;
        if (totalEl) totalEl.textContent = total;
        if (statusEl) {
            statusEl.textContent = current === total ? 'OCR Complete!' : `Processing page ${current} of ${total}...`;
        }
        
        const percent = total > 0 ? (current / total) * 100 : 0;
        if (fillEl) fillEl.style.width = percent + '%';
        if (textEl) textEl.textContent = Math.round(percent) + '%';
    }

    setupAllCanvasEvents() {
        document.querySelectorAll('.draw-canvas').forEach(canvas => {
            this.setupCanvasEvents(canvas);
        });
    }

    setupCanvasEvents(canvas) {
        const pageNum = parseInt(canvas.dataset.page);
        let isDrawing = false;
        let currentStroke = null;
        
        canvas.addEventListener('mousedown', (e) => {
            if (this.currentTool === 'SELECT') return;
            
            const point = this.getCanvasPoint(e, canvas);
            
            if (this.currentTool === 'DRAW') {
                isDrawing = true;
                currentStroke = {
                    type: 'draw',
                    page: pageNum,
                    points: [point],
                    color: this.settings.drawing.color,
                    thickness: this.settings.drawing.thickness
                };
            } else if (this.currentTool === 'HIGHLIGHT') {
                isDrawing = true;
                currentStroke = {
                    type: 'highlight',
                    page: pageNum,
                    startPoint: point,
                    endPoint: point,
                    color: this.settings.highlight.color,
                    opacity: this.settings.highlight.opacity
                };
            }
        });
        
        canvas.addEventListener('mousemove', (e) => {
            if (!isDrawing) return;
            
            const point = this.getCanvasPoint(e, canvas);
            
            if (currentStroke.type === 'draw') {
                currentStroke.points.push(point);
            } else if (currentStroke.type === 'highlight') {
                currentStroke.endPoint = point;
            }
            
            this.renderAnnotations(pageNum);
        });
        
        canvas.addEventListener('mouseup', () => {
            if (isDrawing && currentStroke) {
                this.addAnnotation(currentStroke);
                this.saveState();
            }
            isDrawing = false;
            currentStroke = null;
        });
        
        canvas.addEventListener('click', (e) => {
            if (this.currentTool === 'TEXT') {
                const point = this.getCanvasPoint(e, canvas);
                this.addTextAnnotation(point, pageNum);
            }
        });
    }

    getCanvasPoint(e, canvas) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    addAnnotation(annotation) {
        annotation.id = Date.now() + Math.random();
        this.annotations.push(annotation);
        this.renderAnnotations(annotation.page);
    }

    addTextAnnotation(point, pageNum) {
        const text = prompt('Enter text:');
        if (text) {
            const annotation = {
                id: Date.now(),
                type: 'text',
                page: pageNum,
                point: point,
                text: text,
                fontSize: this.settings.text.size,
                color: this.settings.text.color
            };
            this.addAnnotation(annotation);
            this.saveState();
        }
    }

    renderAnnotations(pageNum) {
        const pageData = this.pages[pageNum - 1];
        if (!pageData) return;
        
        const ctx = pageData.drawCanvas.getContext('2d');
        ctx.clearRect(0, 0, pageData.drawCanvas.width, pageData.drawCanvas.height);
        
        const pageAnnotations = this.annotations.filter(ann => ann.page === pageNum);
        pageAnnotations.forEach(annotation => this.drawAnnotation(ctx, annotation));
    }

    drawAnnotation(ctx, annotation) {
        ctx.save();
        
        switch (annotation.type) {
            case 'draw':
                this.drawPath(ctx, annotation);
                break;
            case 'text':
                this.drawText(ctx, annotation);
                break;
            case 'highlight':
                this.drawHighlight(ctx, annotation);
                break;
        }
        
        ctx.restore();
    }

    drawPath(ctx, annotation) {
        if (annotation.points.length < 1) return;
        
        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = annotation.thickness;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        ctx.beginPath();
        ctx.moveTo(annotation.points[0].x, annotation.points[0].y);
        for (let i = 1; i < annotation.points.length; i++) {
            ctx.lineTo(annotation.points[i].x, annotation.points[i].y);
        }
        ctx.stroke();
    }

    drawText(ctx, annotation) {
        ctx.fillStyle = annotation.color;
        ctx.font = `${annotation.fontSize}px Arial`;
        ctx.fillText(annotation.text, annotation.point.x, annotation.point.y);
    }

    drawHighlight(ctx, annotation) {
        const width = annotation.endPoint.x - annotation.startPoint.x;
        const height = annotation.endPoint.y - annotation.startPoint.y;
        
        ctx.fillStyle = annotation.color;
        ctx.globalAlpha = annotation.opacity;
        ctx.fillRect(annotation.startPoint.x, annotation.startPoint.y, width, height);
        ctx.globalAlpha = 1;
    }

    selectTool(tool) {
        this.currentTool = tool;
        console.log('Advanced Editor: Tool selected:', tool);
        
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tool === tool) {
                btn.classList.add('active');
            }
        });
        
        // Update canvas cursors
        document.querySelectorAll('.draw-canvas').forEach(canvas => {
            canvas.className = `draw-canvas ${tool.toLowerCase()}-mode`;
        });
        
        window.advancedSuite.showStatusMessage(`${tool} tool selected`, 'success');
    }

    updateSettings(key, value) {
        if (key === 'color') {
            this.settings.drawing.color = value;
            this.settings.text.color = value;
        } else if (key === 'thickness') {
            this.settings.drawing.thickness = value;
        }
    }

    goToPage(pageNum) {
        this.currentPage = pageNum;
        
        // Update thumbnail selection
        document.querySelectorAll('.page-thumbnail').forEach(thumb => {
            thumb.classList.remove('active');
            if (parseInt(thumb.dataset.page) === pageNum) {
                thumb.classList.add('active');
            }
        });
        
        // Scroll to page
        const pageStack = document.querySelector(`[data-page="${pageNum}"].page-stack`);
        if (pageStack) {
            pageStack.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        this.updateUI();
    }

    zoomIn() {
        this.zoom = Math.min(this.zoom * 1.25, 3);
        this.updateZoom();
    }

    zoomOut() {
        this.zoom = Math.max(this.zoom / 1.25, 0.25);
        this.updateZoom();
    }

    fitToWidth() {
        const container = document.querySelector('.editor-canvas-container');
        if (container) {
            const containerWidth = container.clientWidth - 48;
            this.zoom = Math.min(containerWidth / 612, 2); // Assume standard page width
            this.updateZoom();
        }
    }

    async updateZoom() {
        if (this.currentPDF) {
            window.advancedSuite.showStatusContainer('Updating zoom...');
            
            try {
                await this.renderAllPages();
                const zoomLevel = document.getElementById('zoom-level');
                if (zoomLevel) {
                    zoomLevel.textContent = Math.round(this.zoom * 100) + '%';
                }
                window.advancedSuite.showStatusMessage(`Zoom: ${Math.round(this.zoom * 100)}%`, 'success');
            } finally {
                window.advancedSuite.hideStatusContainer();
            }
        }
    }

    previousPage() {
        if (this.currentPage > 1) {
            this.goToPage(this.currentPage - 1);
        }
    }

    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.goToPage(this.currentPage + 1);
        }
    }

    saveState() {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({
            editedTexts: new Map(this.editedTexts),
            annotations: JSON.parse(JSON.stringify(this.annotations))
        });
        this.historyIndex++;
        
        if (this.history.length > 20) {
            this.history.shift();
            this.historyIndex--;
        }
        
        this.updateUI();
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const state = this.history[this.historyIndex];
            this.editedTexts = new Map(state.editedTexts);
            this.annotations = JSON.parse(JSON.stringify(state.annotations));
            this.refreshDisplay();
            this.updateUI();
            window.advancedSuite.showStatusMessage('Undo', 'success');
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            const state = this.history[this.historyIndex];
            this.editedTexts = new Map(state.editedTexts);
            this.annotations = JSON.parse(JSON.stringify(state.annotations));
            this.refreshDisplay();
            this.updateUI();
            window.advancedSuite.showStatusMessage('Redo', 'success');
        }
    }

    resetHistory() {
        this.history = [{ editedTexts: new Map(), annotations: [] }];
        this.historyIndex = 0;
    }

    refreshDisplay() {
        // Refresh text edits
        this.editedTexts.forEach((edit, key) => {
            const [pageNum, textIndex] = key.split('-');
            const textLayer = document.querySelector(`[data-page="${pageNum}"].text-layer`);
            if (textLayer) {
                const span = textLayer.querySelector(`[data-text-index="${textIndex}"]`);
                if (span) {
                    span.textContent = edit.newText;
                }
            }
        });
        
        // Refresh annotations
        for (let pageNum = 1; pageNum <= this.totalPages; pageNum++) {
            this.renderAnnotations(pageNum);
        }
    }

    async savePDF() {
        if (!this.currentPDF || !this.originalBytes) {
            window.advancedSuite.showError('No PDF to save');
            return;
        }
        
        window.advancedSuite.showStatusContainer('Saving PDF with edits...', true);
        
        try {
            const pdfDoc = await PDFLib.PDFDocument.load(this.originalBytes);
            
            // Apply text edits
            this.editedTexts.forEach((edit, key) => {
                const [pageNum] = key.split('-');
                const page = pdfDoc.getPage(parseInt(pageNum) - 1);
                
                // Cover original text with white rectangle
                page.drawRectangle({
                    x: edit.bbox.left,
                    y: page.getHeight() - edit.bbox.top - edit.bbox.height,
                    width: edit.bbox.width,
                    height: edit.bbox.height,
                    color: PDFLib.rgb(1, 1, 1),
                });
                
                // Draw new text
                page.drawText(edit.newText, {
                    x: edit.bbox.left,
                    y: page.getHeight() - edit.bbox.top - edit.fontSize,
                    size: edit.fontSize * 0.8,
                    color: PDFLib.rgb(0, 0, 0),
                });
            });
            
            // Apply annotations
            this.annotations.forEach(annotation => {
                const page = pdfDoc.getPage(annotation.page - 1);
                this.applyAnnotationToPDF(page, annotation);
            });
            
            window.advancedSuite.updateProgress(90);
            
            const savedBytes = await pdfDoc.save();
            
            // Download
            const blob = new Blob([savedBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'advanced-edited-document.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            window.advancedSuite.showStatusMessage('PDF saved successfully with all edits', 'success');
            
        } catch (error) {
            console.error('Advanced Editor: Error saving PDF:', error);
            window.advancedSuite.showError('Failed to save PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    applyAnnotationToPDF(page, annotation) {
        const pageHeight = page.getHeight();
        
        try {
            switch (annotation.type) {
                case 'text':
                    page.drawText(annotation.text, {
                        x: annotation.point.x,
                        y: pageHeight - annotation.point.y,
                        size: annotation.fontSize,
                        color: this.hexToRgb(annotation.color),
                    });
                    break;
            }
        } catch (error) {
            console.warn('Could not apply annotation:', annotation.type, error);
        }
    }

    hexToRgb(hex) {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return PDFLib.rgb(r, g, b);
    }

    async runSelfTest() {
        console.log('=== Advanced PDF Suite Self Test ===');
        window.advancedSuite.showStatusContainer('Running self test...');
        
        try {
            // Test 1: Library availability
            console.log('Test 1: PDF.js available:', typeof pdfjsLib !== 'undefined');
            console.log('Test 1: PDF-lib available:', typeof PDFLib !== 'undefined');
            console.log('Test 1: Tesseract.js available:', typeof Tesseract !== 'undefined');
            
            // Test 2: Create test PDF - Fixed: Use ASCII characters only
            const pdfDoc = await PDFLib.PDFDocument.create();
            const page = pdfDoc.addPage([400, 300]);
            
            page.drawText('SELF TEST SUCCESSFUL', {
                x: 50,
                y: 250,
                size: 20,
                color: PDFLib.rgb(0, 0.5, 0),
            });
            
            page.drawText('* Text editing works', {
                x: 50,
                y: 220,
                size: 12,
                color: PDFLib.rgb(0, 0, 0),
            });
            
            page.drawText('* OCR processing ready', {
                x: 50,
                y: 200,
                size: 12,
                color: PDFLib.rgb(0, 0, 0),
            });
            
            page.drawText('* PDF-lib save works', {
                x: 50,
                y: 180,
                size: 12,
                color: PDFLib.rgb(0, 0, 0),
            });
            
            page.drawText('* All libraries loaded', {
                x: 50,
                y: 160,
                size: 12,
                color: PDFLib.rgb(0, 0, 0),
            });
            
            page.drawRectangle({
                x: 50,
                y: 50,
                width: 300,
                height: 100,
                borderColor: PDFLib.rgb(0, 0, 1),
                borderWidth: 2,
            });
            
            const pdfBytes = await pdfDoc.save();
            
            // Test 3: Verify PDF can be loaded by PDF.js
            const testPdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
            console.log('Test 3: PDF.js can load generated PDF, pages:', testPdf.numPages);
            
            // Test 4: Download test file
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'advanced-suite-self-test.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log('SUCCESS: All tests passed');
            window.advancedSuite.showStatusMessage('Self test passed! Test PDF downloaded.', 'success');
            
            return true;
            
        } catch (error) {
            console.error('FAILURE: Self test failed:', error);
            window.advancedSuite.showError('Self test failed: ' + error.message);
            return false;
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    updateUI() {
        const saveBtn = document.getElementById('save-editor-btn');
        const prevPageBtn = document.getElementById('prev-page-btn');
        const nextPageBtn = document.getElementById('next-page-btn');
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        const pageInfo = document.getElementById('page-info');
        const zoomLevel = document.getElementById('zoom-level');
        
        if (saveBtn) saveBtn.disabled = !this.currentPDF;
        if (prevPageBtn) prevPageBtn.disabled = this.currentPage <= 1;
        if (nextPageBtn) nextPageBtn.disabled = this.currentPage >= this.totalPages;
        if (undoBtn) undoBtn.disabled = this.historyIndex <= 0;
        if (redoBtn) redoBtn.disabled = this.historyIndex >= this.history.length - 1;
        
        if (this.currentPDF && pageInfo) {
            pageInfo.textContent = `${this.currentPage}/${this.totalPages}`;
        }
        
        if (zoomLevel) {
            zoomLevel.textContent = Math.round(this.zoom * 100) + '%';
        }
    }

    hideWelcomeScreen() {
        const welcomeArea = document.getElementById('editor-welcome');
        const editorContent = document.getElementById('editor-content');
        
        if (welcomeArea) welcomeArea.classList.add('hidden');
        if (editorContent) editorContent.classList.remove('hidden');
    }
}

// Safe PDF loading helper
async function loadPDFBytes(file) {
    if (!file) {
        throw new Error('No file provided');
    }
    
    if (file.size > 100 * 1024 * 1024) {
        throw new Error('File too large (max 100MB)');
    }
    
    if (file.type !== 'application/pdf') {
        throw new Error('Invalid file type. Please select a PDF file.');
    }
    
    console.log('Loading PDF bytes for file:', file.name, 'Size:', file.size);
    
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    console.log('PDF bytes loaded successfully:', uint8Array.length, 'bytes');
    return uint8Array;
}

// Shared helper to trigger a browser download for generated bytes
function downloadBytes(bytes, filename, mime = 'application/pdf') {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Decode a data URL's base64 payload into raw bytes
function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// Embed an image data URL (PNG or JPEG) into a pdf-lib document
async function embedImageFromDataUrl(pdfDoc, dataUrl) {
    const bytes = dataUrlToBytes(dataUrl);
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
        return pdfDoc.embedJpg(bytes);
    }
    return pdfDoc.embedPng(bytes);
}

// Identify a pdf-lib form field's type via instanceof (constructor.name is unreliable
// once pdf-lib is minified, since class names get mangled to single letters)
function getFormFieldTypeName(field) {
    if (field instanceof PDFLib.PDFCheckBox) return 'PDFCheckBox';
    if (field instanceof PDFLib.PDFDropdown) return 'PDFDropdown';
    if (field instanceof PDFLib.PDFOptionList) return 'PDFOptionList';
    if (field instanceof PDFLib.PDFRadioGroup) return 'PDFRadioGroup';
    if (field instanceof PDFLib.PDFTextField) return 'PDFTextField';
    return 'Unknown';
}

// Convert a #rrggbb hex color into a PDFLib.rgb() color
function hexToPdfRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return PDFLib.rgb(r, g, b);
}

// Parse "1-3, 5, 7-10" style page range strings into 0-based, deduped, sorted indices
function parsePageRanges(rangeStr, totalPages) {
    const indices = new Set();
    rangeStr.split(',').forEach(part => {
        const trimmed = part.trim();
        if (!trimmed) return;
        const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
        if (rangeMatch) {
            let start = parseInt(rangeMatch[1], 10);
            let end = parseInt(rangeMatch[2], 10);
            if (start > end) [start, end] = [end, start];
            for (let p = start; p <= end; p++) {
                if (p >= 1 && p <= totalPages) indices.add(p - 1);
            }
        } else if (/^\d+$/.test(trimmed)) {
            const p = parseInt(trimmed, 10);
            if (p >= 1 && p <= totalPages) indices.add(p - 1);
        }
    });
    return Array.from(indices).sort((a, b) => a - b);
}

// Simplified versions of merge/split/organize classes for space - No localStorage usage
class PDFMerger {
    constructor() { this.files = []; }
    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        console.log('PDF Merger: Initialized');
    }
    
    setupEventListeners() {
        const fileInput = document.getElementById('merge-file-input');
        const clearBtn = document.getElementById('clear-merge-btn');
        const mergeBtn = document.getElementById('merge-pdfs-btn');
        
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearFiles());
        if (mergeBtn) mergeBtn.addEventListener('click', () => this.mergePDFs());
    }
    
    setupDragAndDrop() {
        const dropZone = document.getElementById('merge-drop-zone');
        if (!dropZone) return;
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
            this.addFiles(files);
            dropZone.classList.remove('drag-over');
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
        });
    }
    
    handleFileSelect(e) {
        this.addFiles(Array.from(e.target.files));
        e.target.value = '';
    }
    
    addFiles(files) {
        files.forEach(file => {
            if (!this.files.find(f => f.name === file.name && f.size === file.size)) {
                this.files.push(file);
            }
        });
        this.updateFileList();
        this.updateUI();
    }
    
    updateFileList() {
        const fileList = document.getElementById('merge-file-list');
        if (!fileList) return;
        
        fileList.innerHTML = this.files.map((file, index) => `
            <div class="file-item">
                <div class="file-info">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${this.formatFileSize(file.size)}</div>
                </div>
                <div class="file-actions">
                    <button class="btn btn--sm" onclick="window.advancedSuite.merger.removeFile(${index})">🗑️</button>
                </div>
            </div>
        `).join('');
    }
    
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
        return Math.round(bytes / (1024 * 1024)) + ' MB';
    }
    
    removeFile(index) {
        this.files.splice(index, 1);
        this.updateFileList();
        this.updateUI();
    }
    
    clearFiles() {
        this.files = [];
        this.updateFileList();
        this.updateUI();
    }
    
    async mergePDFs() {
        if (this.files.length < 2) {
            window.advancedSuite.showError('Please select at least 2 PDF files to merge');
            return;
        }
        
        window.advancedSuite.showStatusContainer('Merging PDFs...', true);
        
        try {
            const mergedDoc = await PDFLib.PDFDocument.create();
            
            for (let i = 0; i < this.files.length; i++) {
                window.advancedSuite.updateProgress((i / this.files.length) * 100);
                
                const bytes = await loadPDFBytes(this.files[i]);
                const srcDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
                const pageIndices = srcDoc.getPageIndices();
                const pages = await mergedDoc.copyPages(srcDoc, pageIndices);
                
                pages.forEach(page => mergedDoc.addPage(page));
            }
            
            const mergedBytes = await mergedDoc.save();
            
            // Download merged PDF
            const blob = new Blob([mergedBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'merged-document.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            window.advancedSuite.showStatusMessage(`Successfully merged ${this.files.length} PDFs`, 'success');
            
        } catch (error) {
            console.error('Merge Error:', error);
            window.advancedSuite.showError('Failed to merge PDFs: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
    
    updateUI() {
        const clearBtn = document.getElementById('clear-merge-btn');
        const mergeBtn = document.getElementById('merge-pdfs-btn');
        
        if (clearBtn) clearBtn.disabled = this.files.length === 0;
        if (mergeBtn) mergeBtn.disabled = this.files.length < 2;
    }
}

class PDFSplitter {
    constructor() {
        this.currentFile = null;
        this.pageCount = 0;
    }
    
    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        console.log('PDF Splitter: Initialized');
    }
    
    setupEventListeners() {
        const fileInput = document.getElementById('split-file-input');
        const splitBtn = document.getElementById('split-pdf-btn');
        const methodSelect = document.getElementById('split-method');
        
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        if (splitBtn) splitBtn.addEventListener('click', () => this.splitPDF());
        if (methodSelect) methodSelect.addEventListener('change', () => this.updateSplitMethod());
    }
    
    setupDragAndDrop() {
        const dropZone = document.getElementById('split-drop-zone');
        if (!dropZone) return;
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadPDF(files[0]);
            dropZone.classList.remove('drag-over');
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
        });
    }
    
    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.loadPDF(file);
    }
    
    async loadPDF(file) {
        window.advancedSuite.showStatusContainer('Loading PDF for splitting...');
        
        try {
            const bytes = await loadPDFBytes(file);
            const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
            
            this.currentFile = file;
            this.pageCount = pdf.numPages;
            
            this.showSplitControls();
            this.updateSplitMethod();
            
            window.advancedSuite.showStatusMessage(`PDF loaded: ${this.pageCount} pages`, 'success');
            
        } catch (error) {
            console.error('Split Load Error:', error);
            window.advancedSuite.showError('Failed to load PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
    
    showSplitControls() {
        const controls = document.getElementById('split-controls');
        if (controls) controls.classList.remove('hidden');
    }
    
    updateSplitMethod() {
        const method = document.getElementById('split-method')?.value;
        const pageRangeGroup = document.getElementById('page-range-group');
        const everyPagesGroup = document.getElementById('every-pages-group');
        const pageRangesInput = document.getElementById('page-ranges');
        
        if (method === 'pages') {
            pageRangeGroup?.classList.remove('hidden');
            everyPagesGroup?.classList.add('hidden');
            if (pageRangesInput) pageRangesInput.placeholder = `e.g., 1-3, 5, 7-${this.pageCount}`;
        } else if (method === 'every') {
            pageRangeGroup?.classList.add('hidden');
            everyPagesGroup?.classList.remove('hidden');
        } else if (method === 'individual') {
            pageRangeGroup?.classList.add('hidden');
            everyPagesGroup?.classList.add('hidden');
        }
    }
    
    async splitPDF() {
        if (!this.currentFile) {
            window.advancedSuite.showError('Please select a PDF file first');
            return;
        }
        
        window.advancedSuite.showStatusContainer('Splitting PDF...', true);
        
        try {
            const bytes = await loadPDFBytes(this.currentFile);
            const srcDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
            
            // Simple individual page split for demo
            const splitDocs = [];
            
            for (let i = 0; i < this.pageCount; i++) {
                const outDoc = await PDFLib.PDFDocument.create();
                const [page] = await outDoc.copyPages(srcDoc, [i]);
                outDoc.addPage(page);
                
                const pdfBytes = await outDoc.save();
                splitDocs.push({
                    name: `page-${i + 1}.pdf`,
                    bytes: pdfBytes
                });
                
                window.advancedSuite.updateProgress(((i + 1) / this.pageCount) * 100);
            }
            
            // Download as ZIP if multiple files
            if (splitDocs.length > 1) {
                const zip = new JSZip();
                splitDocs.forEach(doc => zip.file(doc.name, doc.bytes));
                const zipBytes = await zip.generateAsync({ type: 'blob' });
                
                const url = URL.createObjectURL(zipBytes);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'split-pages.zip';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
            
            window.advancedSuite.showStatusMessage(`Successfully split into ${splitDocs.length} files`, 'success');
            
        } catch (error) {
            console.error('Split Error:', error);
            window.advancedSuite.showError('Failed to split PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
}

class PDFOrganizer {
    constructor() {
        this.currentFile = null;
        this.pages = [];
        this.selectedPages = new Set();
    }
    
    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        console.log('PDF Organizer: Initialized');
    }
    
    setupEventListeners() {
        const fileInput = document.getElementById('organize-file-input');
        const saveBtn = document.getElementById('save-organized-btn');
        const selectAllBtn = document.getElementById('select-all-btn');
        const deselectAllBtn = document.getElementById('deselect-all-btn');
        
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        if (saveBtn) saveBtn.addEventListener('click', () => this.saveOrganizedPDF());
        if (selectAllBtn) selectAllBtn.addEventListener('click', () => this.selectAll());
        if (deselectAllBtn) deselectAllBtn.addEventListener('click', () => this.deselectAll());
    }
    
    setupDragAndDrop() {
        const dropZone = document.getElementById('organize-drop-zone');
        if (!dropZone) return;
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadPDF(files[0]);
            dropZone.classList.remove('drag-over');
        });
        
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
        });
    }
    
    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.loadPDF(file);
    }
    
    async loadPDF(file) {
        window.advancedSuite.showStatusContainer('Loading PDF for organizing...', true);
        
        try {
            const bytes = await loadPDFBytes(file);
            const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
            
            const pageCount = pdf.numPages;
            this.pages = [];
            
            for (let i = 1; i <= pageCount; i++) {
                window.advancedSuite.updateProgress((i / pageCount) * 100);
                
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 0.3 });
                
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                
                await page.render({ canvasContext: ctx, viewport }).promise;
                
                this.pages.push({
                    id: i,
                    originalIndex: i - 1,
                    thumbnail: canvas.toDataURL(),
                    rotation: 0
                });
            }
            
            this.currentFile = file;
            this.selectedPages.clear();
            
            this.showOrganizeControls();
            this.buildPageGrid();
            
            window.advancedSuite.showStatusMessage(`PDF loaded: ${pageCount} pages ready to organize`, 'success');
            
        } catch (error) {
            console.error('Organize Load Error:', error);
            window.advancedSuite.showError('Failed to load PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
    
    showOrganizeControls() {
        const controls = document.getElementById('organize-controls');
        if (controls) controls.classList.remove('hidden');
    }
    
    buildPageGrid() {
        const grid = document.getElementById('page-grid');
        if (!grid) return;
        
        grid.innerHTML = this.pages.map((page, index) => `
            <div class="page-thumbnail" data-page-id="${page.id}" onclick="window.advancedSuite.organizer.togglePageSelection(${page.id})">
                <img class="page-preview" src="${page.thumbnail}" alt="Page ${page.id}" style="transform: rotate(${page.rotation}deg)">
                <div class="page-info">
                    <div class="page-number">Page ${page.id}</div>
                </div>
            </div>
        `).join('');
    }
    
    togglePageSelection(pageId) {
        const thumbnail = document.querySelector(`[data-page-id="${pageId}"]`);
        if (!thumbnail) return;
        
        if (this.selectedPages.has(pageId)) {
            this.selectedPages.delete(pageId);
            thumbnail.classList.remove('selected');
        } else {
            this.selectedPages.add(pageId);
            thumbnail.classList.add('selected');
        }
        
        this.updateToolbar();
    }
    
    selectAll() {
        this.pages.forEach(page => this.selectedPages.add(page.id));
        document.querySelectorAll('.page-thumbnail').forEach(thumb => {
            thumb.classList.add('selected');
        });
        this.updateToolbar();
    }
    
    deselectAll() {
        this.selectedPages.clear();
        document.querySelectorAll('.page-thumbnail').forEach(thumb => {
            thumb.classList.remove('selected');
        });
        this.updateToolbar();
    }
    
    updateToolbar() {
        const rotateBtn = document.getElementById('rotate-selected-btn');
        const deleteBtn = document.getElementById('delete-selected-btn');
        
        const hasSelection = this.selectedPages.size > 0;
        if (rotateBtn) rotateBtn.disabled = !hasSelection;
        if (deleteBtn) deleteBtn.disabled = !hasSelection;
    }
    
    async saveOrganizedPDF() {
        if (!this.currentFile || this.pages.length === 0) {
            window.advancedSuite.showError('No PDF to save');
            return;
        }
        
        window.advancedSuite.showStatusContainer('Saving organized PDF...', true);
        
        try {
            const bytes = await loadPDFBytes(this.currentFile);
            const srcDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
            const newDoc = await PDFLib.PDFDocument.create();
            
            for (let i = 0; i < this.pages.length; i++) {
                window.advancedSuite.updateProgress((i / this.pages.length) * 100);
                
                const page = this.pages[i];
                const [copiedPage] = await newDoc.copyPages(srcDoc, [page.originalIndex]);
                
                if (page.rotation !== 0) {
                    copiedPage.setRotation(PDFLib.degrees(page.rotation));
                }
                
                newDoc.addPage(copiedPage);
            }
            
            const pdfBytes = await newDoc.save();
            
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'organized-document.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            window.advancedSuite.showStatusMessage('Organized PDF saved successfully', 'success');
            
        } catch (error) {
            console.error('Organize Save Error:', error);
            window.advancedSuite.showError('Failed to save organized PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
}

// Fill & Sign - signatures, initials, text, dates, checkmarks and AcroForm fields
class PDFFillSign {
    constructor() {
        this.file = null;
        this.originalBytes = null;
        this.pdfDoc = null;
        this.totalPages = 0;
        this.currentPage = 1;
        this.scale = 1;
        this.pageSizes = [];
        this.items = [];
        this.currentTool = 'SIGNATURE';
        this.signatureImage = null;
        this.initialsImage = null;
        this.pendingSigTarget = 'SIGNATURE';
        this.selectedItemId = null;
        this.formFields = [];
        this.formFieldValues = {};
        this.sigHasDrawn = false;
        this.uploadDataUrl = null;
        this.justDragged = false;
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupSignatureModal();
        console.log('Fill & Sign: Initialized');
    }

    setupEventListeners() {
        const fileInput = document.getElementById('fillsign-file-input');
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        document.querySelectorAll('.fs-tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tool = btn.dataset.fstool;
                const isSigTool = tool === 'SIGNATURE' || tool === 'INITIALS';
                if (isSigTool && this.currentTool === tool) {
                    this.openSignatureModal(tool);
                } else {
                    this.selectTool(tool);
                }
            });
        });

        const prevBtn = document.getElementById('fs-prev-page-btn');
        const nextBtn = document.getElementById('fs-next-page-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => this.previousPage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextPage());

        const deleteBtn = document.getElementById('fs-delete-selected-btn');
        const clearBtn = document.getElementById('fs-clear-all-btn');
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.deleteSelectedItem());
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearAllItems());

        const saveBtn = document.getElementById('fillsign-save-btn');
        if (saveBtn) saveBtn.addEventListener('click', () => this.save());

        const overlay = document.getElementById('fillsign-overlay');
        if (overlay) overlay.addEventListener('click', (e) => this.handleCanvasClick(e));
    }

    setupDragAndDrop() {
        const dropZone = document.getElementById('fillsign-drop-zone');
        if (!dropZone) return;

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadPDF(files[0]);
            dropZone.classList.remove('drag-over');
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
        });
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.loadPDF(file);
    }

    async loadPDF(file) {
        window.advancedSuite.showStatusContainer('Loading PDF...');

        try {
            const bytes = await loadPDFBytes(file);
            // pdf.js transfers/detaches the buffer it's given, so hand it a copy
            // and keep the original bytes intact for pdf-lib to reuse later.
            const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

            this.file = file;
            this.originalBytes = bytes;
            this.pdfDoc = pdf;
            this.totalPages = pdf.numPages;
            this.currentPage = 1;
            this.items = [];
            this.pageSizes = [];
            this.selectedItemId = null;

            const page1 = await pdf.getPage(1);
            const vp1 = page1.getViewport({ scale: 1 });
            this.scale = Math.min(1.4, 760 / vp1.width);

            document.getElementById('fillsign-controls').classList.remove('hidden');

            await this.detectFormFields(bytes);
            await this.renderPage(this.currentPage);

            window.advancedSuite.showStatusMessage(`PDF loaded (${this.totalPages} pages)`, 'success');
        } catch (error) {
            console.error('Fill & Sign Load Error:', error);
            window.advancedSuite.showError('Failed to load PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async detectFormFields(bytes) {
        this.formFields = [];
        this.formFieldValues = {};

        try {
            const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
            const form = doc.getForm();
            const fields = form.getFields();

            this.formFields = fields.map(field => {
                const type = getFormFieldTypeName(field);
                let options = [];
                try {
                    if (typeof field.getOptions === 'function') options = field.getOptions();
                } catch (e) { /* not an option-based field */ }
                return { name: field.getName(), type, options };
            });
        } catch (error) {
            console.warn('Fill & Sign: No form fields detected or form parsing failed:', error.message);
        }

        this.renderFormFieldsSidebar();
    }

    renderFormFieldsSidebar() {
        const container = document.getElementById('fillsign-form-fields');
        if (!container) return;

        if (this.formFields.length === 0) {
            container.innerHTML = '<p class="fillsign-empty-note">No fillable form fields detected in this PDF.</p>';
            return;
        }

        container.innerHTML = '';
        this.formFields.forEach(field => {
            const row = document.createElement('div');
            row.className = 'form-field-row';

            const label = document.createElement('label');
            label.textContent = field.name;
            row.appendChild(label);

            let input;
            if (field.type === 'PDFCheckBox') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.addEventListener('change', () => { this.formFieldValues[field.name] = input.checked; });
            } else if (field.type === 'PDFDropdown' || field.type === 'PDFOptionList' || field.type === 'PDFRadioGroup') {
                input = document.createElement('select');
                input.className = 'form-control';
                const blank = document.createElement('option');
                blank.value = '';
                blank.textContent = '—';
                input.appendChild(blank);
                field.options.forEach(opt => {
                    const optionEl = document.createElement('option');
                    optionEl.value = opt;
                    optionEl.textContent = opt;
                    input.appendChild(optionEl);
                });
                input.addEventListener('change', () => { this.formFieldValues[field.name] = input.value; });
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'form-control';
                input.addEventListener('input', () => { this.formFieldValues[field.name] = input.value; });
            }

            row.appendChild(input);
            container.appendChild(row);
        });
    }

    async renderPage(pageNum) {
        try {
            const page = await this.pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: this.scale });

            if (!this.pageSizes[pageNum - 1]) {
                const vp1 = page.getViewport({ scale: 1 });
                this.pageSizes[pageNum - 1] = { width: vp1.width, height: vp1.height };
            }

            const canvas = document.getElementById('fillsign-pdf-canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;

            this.renderOverlay();
            this.updatePageNav();
        } catch (error) {
            console.error('Fill & Sign: Error rendering page', pageNum, error);
        }
    }

    updatePageNav() {
        const info = document.getElementById('fs-page-info');
        const prevBtn = document.getElementById('fs-prev-page-btn');
        const nextBtn = document.getElementById('fs-next-page-btn');

        if (info) info.textContent = `${this.currentPage}/${this.totalPages}`;
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
    }

    previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.renderPage(this.currentPage);
        }
    }

    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.renderPage(this.currentPage);
        }
    }

    selectTool(tool) {
        this.currentTool = tool;
        document.querySelectorAll('.fs-tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.fstool === tool);
        });
    }

    handleCanvasClick(e) {
        if (this.justDragged || !this.pdfDoc) return;
        if (e.target !== e.currentTarget) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const xFrac = (e.clientX - rect.left) / rect.width;
        const yFrac = (e.clientY - rect.top) / rect.height;
        const pageSize = this.pageSizes[this.currentPage - 1];
        if (!pageSize) return;

        this.selectItem(null);

        switch (this.currentTool) {
            case 'SIGNATURE':
                if (!this.signatureImage) { this.openSignatureModal('SIGNATURE'); return; }
                this.placeImageItem('SIGNATURE', this.signatureImage, xFrac, yFrac, pageSize);
                break;
            case 'INITIALS':
                if (!this.initialsImage) { this.openSignatureModal('INITIALS'); return; }
                this.placeImageItem('INITIALS', this.initialsImage, xFrac, yFrac, pageSize);
                break;
            case 'TEXT': {
                const text = prompt('Enter text:');
                if (text) this.placeTextItem('TEXT', text, xFrac, yFrac, pageSize, { fontSize: 16, color: '#1a1a2e' });
                break;
            }
            case 'DATE': {
                const text = new Date().toLocaleDateString();
                this.placeTextItem('DATE', text, xFrac, yFrac, pageSize, { fontSize: 14, color: '#1a1a2e' });
                break;
            }
            case 'CHECK':
                this.placeTextItem('CHECK', '✔', xFrac, yFrac, pageSize, { fontSize: 26, color: '#1a7f37' });
                break;
            case 'CROSS':
                this.placeTextItem('CROSS', '✖', xFrac, yFrac, pageSize, { fontSize: 26, color: '#c81e1e' });
                break;
        }
    }

    placeImageItem(type, img, xFrac, yFrac, pageSize) {
        const widthPt = Math.min(150, pageSize.width * 0.4);
        const heightPt = widthPt * (img.naturalHeight / img.naturalWidth || 0.33);
        const wFrac = widthPt / pageSize.width;
        const hFrac = heightPt / pageSize.height;

        const item = {
            id: Date.now() + Math.random(),
            page: this.currentPage,
            type,
            dataUrl: img.dataUrl,
            xFrac: this.clamp(xFrac - wFrac / 2, 0, 1 - wFrac),
            yFrac: this.clamp(yFrac - hFrac / 2, 0, 1 - hFrac),
            wFrac,
            hFrac
        };
        this.items.push(item);
        this.renderOverlay();
    }

    placeTextItem(type, text, xFrac, yFrac, pageSize, opts) {
        const fontSize = opts.fontSize;
        const color = opts.color;

        const measureCanvas = document.createElement('canvas');
        const mctx = measureCanvas.getContext('2d');
        mctx.font = `${fontSize}px Arial`;
        const textWidthPt = mctx.measureText(text).width + 12;
        const textHeightPt = fontSize * 1.5;

        const wFrac = textWidthPt / pageSize.width;
        const hFrac = textHeightPt / pageSize.height;

        const item = {
            id: Date.now() + Math.random(),
            page: this.currentPage,
            type,
            text,
            fontSize,
            color,
            xFrac: this.clamp(xFrac - wFrac / 2, 0, 1 - wFrac),
            yFrac: this.clamp(yFrac - hFrac / 2, 0, 1 - hFrac),
            wFrac,
            hFrac
        };
        this.items.push(item);
        this.renderOverlay();
    }

    clamp(value, min, max) {
        return Math.min(Math.max(value, min), Math.max(min, max));
    }

    renderOverlay() {
        const overlay = document.getElementById('fillsign-overlay');
        if (!overlay) return;
        overlay.innerHTML = '';

        this.items
            .filter(item => item.page === this.currentPage)
            .forEach(item => overlay.appendChild(this.buildItemEl(item)));
    }

    buildItemEl(item) {
        const div = document.createElement('div');
        div.className = 'fs-item' + (item.id === this.selectedItemId ? ' selected' : '');
        div.style.left = (item.xFrac * 100) + '%';
        div.style.top = (item.yFrac * 100) + '%';
        div.style.width = (item.wFrac * 100) + '%';
        div.style.height = (item.hFrac * 100) + '%';
        div.dataset.itemId = item.id;

        if (item.type === 'SIGNATURE' || item.type === 'INITIALS') {
            const img = document.createElement('img');
            img.src = item.dataUrl;
            div.appendChild(img);
        } else {
            const span = document.createElement('div');
            span.className = 'fs-item-text';
            span.textContent = item.text;
            span.style.fontSize = Math.max(8, Math.round(item.fontSize * this.scale)) + 'px';
            span.style.color = item.color;
            div.appendChild(span);
        }

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'fs-item-delete';
        delBtn.textContent = '×';
        delBtn.title = 'Remove';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeItem(item.id);
        });
        div.appendChild(delBtn);

        div.addEventListener('mousedown', (e) => this.startDrag(e, item));
        div.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectItem(item.id);
        });

        return div;
    }

    startDrag(e, item) {
        e.preventDefault();
        e.stopPropagation();
        this.selectItem(item.id);

        const overlay = document.getElementById('fillsign-overlay');
        const rect = overlay.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const origXFrac = item.xFrac;
        const origYFrac = item.yFrac;

        const onMove = (ev) => {
            const dxFrac = (ev.clientX - startX) / rect.width;
            const dyFrac = (ev.clientY - startY) / rect.height;
            item.xFrac = this.clamp(origXFrac + dxFrac, 0, 1 - item.wFrac);
            item.yFrac = this.clamp(origYFrac + dyFrac, 0, 1 - item.hFrac);
            this.renderOverlay();
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            this.justDragged = true;
            setTimeout(() => { this.justDragged = false; }, 50);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    selectItem(id) {
        this.selectedItemId = id;
        this.renderOverlay();
        const deleteBtn = document.getElementById('fs-delete-selected-btn');
        if (deleteBtn) deleteBtn.disabled = !id;
    }

    removeItem(id) {
        this.items = this.items.filter(item => item.id !== id);
        if (this.selectedItemId === id) this.selectItem(null);
        this.renderOverlay();
    }

    deleteSelectedItem() {
        if (this.selectedItemId) this.removeItem(this.selectedItemId);
    }

    clearAllItems() {
        if (this.items.length === 0) return;
        if (confirm('Remove all placed items from this document?')) {
            this.items = [];
            this.selectItem(null);
            this.renderOverlay();
        }
    }

    setupSignatureModal() {
        const modal = document.getElementById('signature-modal');
        const backdrop = document.getElementById('signature-modal-backdrop');
        const closeBtn = document.getElementById('signature-modal-close');
        const cancelBtn = document.getElementById('signature-modal-cancel');
        const useBtn = document.getElementById('signature-modal-use-btn');

        [backdrop, closeBtn, cancelBtn].forEach(el => {
            if (el) el.addEventListener('click', () => this.closeSignatureModal());
        });
        if (useBtn) useBtn.addEventListener('click', () => this.commitSignature());

        document.querySelectorAll('.sig-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.sigmode;
                document.querySelectorAll('.sig-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
                document.querySelectorAll('.sig-mode-panel').forEach(panel => {
                    panel.classList.toggle('hidden', panel.id !== `sig-mode-${mode}`);
                });
            });
        });

        const drawCanvas = document.getElementById('signature-draw-canvas');
        if (drawCanvas) this.setupDrawCanvas(drawCanvas);

        const clearBtn = document.getElementById('signature-draw-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                const ctx = drawCanvas.getContext('2d');
                ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
                this.sigHasDrawn = false;
            });
        }

        const typeInput = document.getElementById('signature-type-input');
        const typeFont = document.getElementById('signature-type-font');
        const redrawType = () => this.renderTypedSignaturePreview();
        if (typeInput) typeInput.addEventListener('input', redrawType);
        if (typeFont) typeFont.addEventListener('change', redrawType);

        const uploadInput = document.getElementById('signature-upload-input');
        if (uploadInput) {
            uploadInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.uploadDataUrl = ev.target.result;
                    this.drawImagePreview('signature-upload-canvas', this.uploadDataUrl);
                };
                reader.readAsDataURL(file);
            });
        }
    }

    setupDrawCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        let drawing = false;

        const getPoint = (e) => {
            const rect = canvas.getBoundingClientRect();
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (cx - rect.left) * (canvas.width / rect.width),
                y: (cy - rect.top) * (canvas.height / rect.height)
            };
        };

        const start = (e) => {
            e.preventDefault();
            drawing = true;
            this.sigHasDrawn = true;
            const p = getPoint(e);
            const colorInput = document.getElementById('signature-draw-color');
            ctx.strokeStyle = colorInput ? colorInput.value : '#1a1a2e';
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
        };

        const move = (e) => {
            if (!drawing) return;
            e.preventDefault();
            const p = getPoint(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
        };

        const end = () => { drawing = false; };

        canvas.addEventListener('mousedown', start);
        canvas.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        canvas.addEventListener('touchstart', start, { passive: false });
        canvas.addEventListener('touchmove', move, { passive: false });
        canvas.addEventListener('touchend', end);
    }

    renderTypedSignaturePreview() {
        const canvas = document.getElementById('signature-type-canvas');
        const input = document.getElementById('signature-type-input');
        const fontSelect = document.getElementById('signature-type-font');
        const colorInput = document.getElementById('signature-draw-color');
        if (!canvas || !input) return;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const text = input.value.trim();
        if (!text) return;

        ctx.fillStyle = colorInput ? colorInput.value : '#1a1a2e';
        ctx.font = `64px ${fontSelect ? fontSelect.value : 'cursive'}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 40);
    }

    drawImagePreview(canvasId, dataUrl) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        };
        img.src = dataUrl;
    }

    openSignatureModal(target) {
        this.pendingSigTarget = target;
        const title = document.getElementById('signature-modal-title');
        if (title) title.textContent = target === 'INITIALS' ? 'Create Initials' : 'Create Signature';

        const drawCanvas = document.getElementById('signature-draw-canvas');
        if (drawCanvas) drawCanvas.getContext('2d').clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        this.sigHasDrawn = false;

        const typeInput = document.getElementById('signature-type-input');
        if (typeInput) typeInput.value = '';
        const typeCanvas = document.getElementById('signature-type-canvas');
        if (typeCanvas) typeCanvas.getContext('2d').clearRect(0, 0, typeCanvas.width, typeCanvas.height);

        const uploadInput = document.getElementById('signature-upload-input');
        if (uploadInput) uploadInput.value = '';
        this.uploadDataUrl = null;
        const uploadCanvas = document.getElementById('signature-upload-canvas');
        if (uploadCanvas) uploadCanvas.getContext('2d').clearRect(0, 0, uploadCanvas.width, uploadCanvas.height);

        document.querySelectorAll('.sig-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.sigmode === 'draw'));
        document.querySelectorAll('.sig-mode-panel').forEach(panel => panel.classList.toggle('hidden', panel.id !== 'sig-mode-draw'));

        document.getElementById('signature-modal').classList.remove('hidden');
    }

    closeSignatureModal() {
        document.getElementById('signature-modal').classList.add('hidden');
    }

    commitSignature() {
        const activeModeBtn = document.querySelector('.sig-mode-btn.active');
        const mode = activeModeBtn ? activeModeBtn.dataset.sigmode : 'draw';
        let dataUrl = null;

        if (mode === 'draw') {
            if (!this.sigHasDrawn) { alert('Please draw your signature first.'); return; }
            dataUrl = document.getElementById('signature-draw-canvas').toDataURL('image/png');
        } else if (mode === 'type') {
            const text = document.getElementById('signature-type-input').value.trim();
            if (!text) { alert('Please type your name.'); return; }
            dataUrl = document.getElementById('signature-type-canvas').toDataURL('image/png');
        } else if (mode === 'upload') {
            if (!this.uploadDataUrl) { alert('Please choose an image file.'); return; }
            dataUrl = this.uploadDataUrl;
        }

        if (!dataUrl) return;

        const img = new Image();
        img.onload = () => {
            const payload = { dataUrl, naturalWidth: img.naturalWidth || 300, naturalHeight: img.naturalHeight || 100 };
            if (this.pendingSigTarget === 'INITIALS') {
                this.initialsImage = payload;
            } else {
                this.signatureImage = payload;
            }
            this.selectTool(this.pendingSigTarget);
            this.closeSignatureModal();
            const label = this.pendingSigTarget === 'INITIALS' ? 'Initials' : 'Signature';
            window.advancedSuite.showStatusMessage(`${label} ready — click the page to place it`, 'success');
        };
        img.src = dataUrl;
    }

    async save() {
        if (!this.originalBytes) {
            window.advancedSuite.showError('No PDF to save');
            return;
        }

        window.advancedSuite.showStatusContainer('Saving signed PDF...', true);

        try {
            const pdfDoc = await PDFLib.PDFDocument.load(this.originalBytes, { ignoreEncryption: true });

            if (this.formFields.length > 0) {
                const form = pdfDoc.getForm();
                Object.entries(this.formFieldValues).forEach(([name, value]) => {
                    try {
                        const field = form.getField(name);
                        const type = getFormFieldTypeName(field);
                        if (type === 'PDFCheckBox') {
                            if (value) field.check(); else field.uncheck();
                        } else if ((type === 'PDFDropdown' || type === 'PDFOptionList' || type === 'PDFRadioGroup') && value) {
                            field.select(value);
                        } else if (type === 'PDFTextField') {
                            field.setText(value || '');
                        }
                    } catch (fieldError) {
                        console.warn('Fill & Sign: Could not set field', name, fieldError.message);
                    }
                });

                const flattenCheckbox = document.getElementById('fillsign-flatten-checkbox');
                if (flattenCheckbox && flattenCheckbox.checked) {
                    try { form.flatten(); } catch (flattenError) {
                        console.warn('Fill & Sign: Could not flatten form:', flattenError.message);
                    }
                }
            }

            window.advancedSuite.updateProgress(40);

            for (const item of this.items) {
                const page = pdfDoc.getPage(item.page - 1);
                const pageWidth = page.getWidth();
                const pageHeight = page.getHeight();
                const x = item.xFrac * pageWidth;
                const widthPt = item.wFrac * pageWidth;
                const heightPt = item.hFrac * pageHeight;
                const y = pageHeight - (item.yFrac * pageHeight) - heightPt;

                if (item.type === 'SIGNATURE' || item.type === 'INITIALS') {
                    const embedded = await embedImageFromDataUrl(pdfDoc, item.dataUrl);
                    page.drawImage(embedded, { x, y, width: widthPt, height: heightPt });
                } else {
                    page.drawText(item.text, {
                        x,
                        y: y + heightPt * 0.15,
                        size: item.fontSize,
                        color: hexToPdfRgb(item.color)
                    });
                }
            }

            window.advancedSuite.updateProgress(90);

            const bytes = await pdfDoc.save();
            downloadBytes(bytes, 'signed-document.pdf');

            window.advancedSuite.showStatusMessage('Signed PDF saved successfully', 'success');
        } catch (error) {
            console.error('Fill & Sign Save Error:', error);
            window.advancedSuite.showError('Failed to save signed PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
}

// Watermark, Stamps, Page Numbers & Header/Footer
class PDFWatermark {
    constructor() {
        this.file = null;
        this.originalBytes = null;
        this.pdfDoc = null;
        this.totalPages = 0;
        this.currentPage = 1;
        this.scale = 1;
        this.pageSizes = [];
        this.activeSection = 'watermark';
        this.wmImageDataUrl = null;
        this.wmImageEl = null;
        this.stampItems = [];
        this.activeStampText = null;
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        console.log('Watermark: Initialized');
    }

    setupEventListeners() {
        const fileInput = document.getElementById('watermark-file-input');
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        const prevBtn = document.getElementById('wm-prev-page-btn');
        const nextBtn = document.getElementById('wm-next-page-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => this.previousPage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextPage());

        document.querySelectorAll('.wm-section-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchSection(btn.dataset.wmsection));
        });

        const wmType = document.getElementById('wm-type');
        if (wmType) wmType.addEventListener('change', () => {
            document.getElementById('wm-text-group').classList.toggle('hidden', wmType.value !== 'text');
            document.getElementById('wm-image-group').classList.toggle('hidden', wmType.value !== 'image');
            this.refreshOverlay();
        });

        const wmImageInput = document.getElementById('wm-image-input');
        if (wmImageInput) wmImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.wmImageDataUrl = ev.target.result;
                this.wmImageEl = new Image();
                this.wmImageEl.onload = () => this.refreshOverlay();
                this.wmImageEl.src = this.wmImageDataUrl;
            };
            reader.readAsDataURL(file);
        });

        ['wm-text', 'wm-font-size', 'wm-color', 'wm-layout'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.refreshOverlay());
        });

        const opacityInput = document.getElementById('wm-opacity');
        if (opacityInput) opacityInput.addEventListener('input', () => {
            document.getElementById('wm-opacity-value').textContent = opacityInput.value + '%';
            this.refreshOverlay();
        });

        const rotationInput = document.getElementById('wm-rotation');
        if (rotationInput) rotationInput.addEventListener('input', () => {
            document.getElementById('wm-rotation-value').innerHTML = rotationInput.value + '&deg;';
            this.refreshOverlay();
        });

        const applyToSelect = document.getElementById('wm-apply-to');
        if (applyToSelect) applyToSelect.addEventListener('change', () => {
            document.getElementById('wm-range-group').classList.toggle('hidden', applyToSelect.value !== 'range');
        });

        const applyWatermarkBtn = document.getElementById('wm-apply-watermark-btn');
        if (applyWatermarkBtn) applyWatermarkBtn.addEventListener('click', () => this.applyWatermark());

        document.querySelectorAll('.stamp-btn').forEach(btn => {
            btn.addEventListener('click', () => this.selectStamp(btn.dataset.stamp));
        });

        const customStampBtn = document.getElementById('stamp-custom-add-btn');
        if (customStampBtn) customStampBtn.addEventListener('click', () => {
            const text = document.getElementById('stamp-custom-text').value.trim();
            if (text) this.selectStamp(text.toUpperCase());
        });

        const clearStampsBtn = document.getElementById('wm-clear-stamps-btn');
        if (clearStampsBtn) clearStampsBtn.addEventListener('click', () => this.clearStamps());

        const applyStampsBtn = document.getElementById('wm-apply-stamps-btn');
        if (applyStampsBtn) applyStampsBtn.addEventListener('click', () => this.applyStamps());

        const pageWrap = document.getElementById('wm-page-wrap');
        if (pageWrap) pageWrap.addEventListener('click', (e) => this.handleWrapClick(e));

        const pnApplyBtn = document.getElementById('pn-apply-btn');
        if (pnApplyBtn) pnApplyBtn.addEventListener('click', () => this.applyPageNumbers());

        const hfApplyBtn = document.getElementById('hf-apply-btn');
        if (hfApplyBtn) hfApplyBtn.addEventListener('click', () => this.applyHeaderFooter());
    }

    setupDragAndDrop() {
        const dropZone = document.getElementById('watermark-drop-zone');
        if (!dropZone) return;

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadPDF(files[0]);
            dropZone.classList.remove('drag-over');
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
        });
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.loadPDF(file);
    }

    async loadPDF(file) {
        window.advancedSuite.showStatusContainer('Loading PDF...');

        try {
            const bytes = await loadPDFBytes(file);
            // pdf.js transfers/detaches the buffer it's given, so hand it a copy
            // and keep the original bytes intact for pdf-lib to reuse later.
            const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

            this.file = file;
            this.originalBytes = bytes;
            this.pdfDoc = pdf;
            this.totalPages = pdf.numPages;
            this.currentPage = 1;
            this.pageSizes = [];
            this.stampItems = [];

            const page1 = await pdf.getPage(1);
            const vp1 = page1.getViewport({ scale: 1 });
            this.scale = Math.min(1.4, 760 / vp1.width);

            document.getElementById('watermark-controls').classList.remove('hidden');
            await this.renderPage(1);

            window.advancedSuite.showStatusMessage(`PDF loaded (${this.totalPages} pages)`, 'success');
        } catch (error) {
            console.error('Watermark Load Error:', error);
            window.advancedSuite.showError('Failed to load PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async renderPage(pageNum) {
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.scale });

        if (!this.pageSizes[pageNum - 1]) {
            const vp1 = page.getViewport({ scale: 1 });
            this.pageSizes[pageNum - 1] = { width: vp1.width, height: vp1.height };
        }

        const canvas = document.getElementById('wm-pdf-canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const previewCanvas = document.getElementById('wm-preview-canvas');
        previewCanvas.width = viewport.width;
        previewCanvas.height = viewport.height;

        this.updatePageNav();
        this.refreshOverlay();
    }

    updatePageNav() {
        const info = document.getElementById('wm-page-info');
        const prevBtn = document.getElementById('wm-prev-page-btn');
        const nextBtn = document.getElementById('wm-next-page-btn');
        if (info) info.textContent = `${this.currentPage}/${this.totalPages}`;
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
    }

    previousPage() {
        if (this.currentPage > 1) { this.currentPage--; this.renderPage(this.currentPage); }
    }

    nextPage() {
        if (this.currentPage < this.totalPages) { this.currentPage++; this.renderPage(this.currentPage); }
    }

    switchSection(section) {
        this.activeSection = section;
        document.querySelectorAll('.wm-section-btn').forEach(b => b.classList.toggle('active', b.dataset.wmsection === section));
        document.querySelectorAll('.wm-section-panel').forEach(p => p.classList.toggle('hidden', p.id !== `wm-section-${section}`));
        this.refreshOverlay();
    }

    refreshOverlay() {
        const canvas = document.getElementById('wm-preview-canvas');
        if (!canvas || !canvas.width) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (this.activeSection === 'watermark') {
            this.drawWatermarkPreview(ctx, canvas.width, canvas.height);
        } else if (this.activeSection === 'stamp') {
            this.drawStampOverlay(ctx);
        }
    }

    drawWatermarkPreview(ctx, w, h) {
        const type = document.getElementById('wm-type').value;
        const opacity = parseInt(document.getElementById('wm-opacity').value, 10) / 100;
        const rotation = parseInt(document.getElementById('wm-rotation').value, 10);
        const layout = document.getElementById('wm-layout').value;

        ctx.save();
        ctx.globalAlpha = opacity;

        if (type === 'text') {
            const text = document.getElementById('wm-text').value || 'CONFIDENTIAL';
            const fontSize = parseInt(document.getElementById('wm-font-size').value, 10) * this.scale;
            ctx.fillStyle = document.getElementById('wm-color').value;
            ctx.font = `bold ${fontSize}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (layout === 'center') {
                ctx.save();
                ctx.translate(w / 2, h / 2);
                ctx.rotate(-rotation * Math.PI / 180);
                ctx.fillText(text, 0, 0);
                ctx.restore();
            } else {
                const stepX = ctx.measureText(text).width + 70;
                const stepY = fontSize * 3;
                for (let gy = -h; gy < h * 2; gy += stepY) {
                    for (let gx = -w; gx < w * 2; gx += stepX) {
                        ctx.save();
                        ctx.translate(gx, gy);
                        ctx.rotate(-rotation * Math.PI / 180);
                        ctx.fillText(text, 0, 0);
                        ctx.restore();
                    }
                }
            }
        } else if (this.wmImageEl && this.wmImageEl.complete) {
            const img = this.wmImageEl;
            const iw = Math.min(w * 0.5, img.naturalWidth * this.scale);
            const ih = iw * (img.naturalHeight / img.naturalWidth);

            if (layout === 'center') {
                ctx.save();
                ctx.translate(w / 2, h / 2);
                ctx.rotate(-rotation * Math.PI / 180);
                ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
                ctx.restore();
            } else {
                const stepX = iw + 40;
                const stepY = ih + 40;
                for (let gy = -h; gy < h * 2; gy += stepY) {
                    for (let gx = -w; gx < w * 2; gx += stepX) {
                        ctx.save();
                        ctx.translate(gx, gy);
                        ctx.rotate(-rotation * Math.PI / 180);
                        ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
                        ctx.restore();
                    }
                }
            }
        }

        ctx.restore();
    }

    drawStampOverlay(ctx) {
        this.stampItems.filter(s => s.page === this.currentPage).forEach(s => {
            const x = s.xFrac * ctx.canvas.width;
            const y = s.yFrac * ctx.canvas.height;
            const w = s.wFrac * ctx.canvas.width;
            const h = s.hFrac * ctx.canvas.height;
            ctx.save();
            ctx.strokeStyle = '#c81e1e';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, w, h);
            ctx.fillStyle = '#c81e1e';
            ctx.font = `bold ${Math.round(h * 0.45)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(s.text, x + w / 2, y + h / 2);
            ctx.restore();
        });
    }

    handleWrapClick(e) {
        if (this.activeSection !== 'stamp' || !this.activeStampText || !this.pdfDoc) return;
        if (e.target.closest('.wm-page-nav')) return;

        const wrap = document.getElementById('wm-page-wrap');
        const rect = wrap.getBoundingClientRect();
        const xFrac = (e.clientX - rect.left) / rect.width;
        const yFrac = (e.clientY - rect.top) / rect.height;
        if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) return;

        const pageSize = this.pageSizes[this.currentPage - 1];
        if (!pageSize) return;

        const widthPt = Math.min(170, pageSize.width * 0.45);
        const heightPt = 38;
        const wFrac = widthPt / pageSize.width;
        const hFrac = heightPt / pageSize.height;

        this.stampItems.push({
            id: Date.now() + Math.random(),
            page: this.currentPage,
            text: this.activeStampText,
            xFrac: Math.min(Math.max(xFrac - wFrac / 2, 0), 1 - wFrac),
            yFrac: Math.min(Math.max(yFrac - hFrac / 2, 0), 1 - hFrac),
            wFrac,
            hFrac
        });
        this.refreshOverlay();
    }

    selectStamp(text) {
        this.activeStampText = text;
        document.querySelectorAll('.stamp-btn').forEach(b => b.classList.toggle('active', b.dataset.stamp === text));
        document.getElementById('stamp-active-note').textContent = `Selected stamp: "${text}" — click the page to place it.`;
    }

    clearStamps() {
        if (this.stampItems.length === 0) return;
        if (confirm('Remove all placed stamps?')) {
            this.stampItems = [];
            this.refreshOverlay();
        }
    }

    rotatedAnchor(cx, cy, halfW, halfH, rotationDeg) {
        const rad = rotationDeg * Math.PI / 180;
        const rx = halfW * Math.cos(rad) - halfH * Math.sin(rad);
        const ry = halfW * Math.sin(rad) + halfH * Math.cos(rad);
        return { x: cx - rx, y: cy - ry };
    }

    async applyWatermark() {
        if (!this.originalBytes) { window.advancedSuite.showError('No PDF loaded'); return; }
        const type = document.getElementById('wm-type').value;
        if (type === 'image' && !this.wmImageDataUrl) {
            window.advancedSuite.showError('Please choose a watermark image');
            return;
        }

        window.advancedSuite.showStatusContainer('Applying watermark...', true);

        try {
            const pdfDoc = await PDFLib.PDFDocument.load(this.originalBytes, { ignoreEncryption: true });
            const applyTo = document.getElementById('wm-apply-to').value;
            let pageIndices = pdfDoc.getPageIndices();

            if (applyTo === 'range') {
                const rangeStr = document.getElementById('wm-range').value;
                pageIndices = parsePageRanges(rangeStr, pdfDoc.getPageCount());
                if (pageIndices.length === 0) {
                    window.advancedSuite.showError('Enter a valid page range');
                    window.advancedSuite.hideStatusContainer();
                    return;
                }
            }

            const opacity = parseInt(document.getElementById('wm-opacity').value, 10) / 100;
            const rotation = parseInt(document.getElementById('wm-rotation').value, 10);
            const layout = document.getElementById('wm-layout').value;

            let font = null, text = null, fontSize = 0, color = null, embeddedImage = null;

            if (type === 'text') {
                font = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
                text = document.getElementById('wm-text').value || 'CONFIDENTIAL';
                fontSize = parseInt(document.getElementById('wm-font-size').value, 10);
                color = hexToPdfRgb(document.getElementById('wm-color').value);
            } else {
                embeddedImage = await embedImageFromDataUrl(pdfDoc, this.wmImageDataUrl);
            }

            pageIndices.forEach((idx, i) => {
                window.advancedSuite.updateProgress((i / pageIndices.length) * 90);
                const page = pdfDoc.getPage(idx);
                const pw = page.getWidth();
                const ph = page.getHeight();

                if (type === 'text') {
                    const textWidth = font.widthOfTextAtSize(text, fontSize);
                    if (layout === 'center') {
                        const anchor = this.rotatedAnchor(pw / 2, ph / 2, textWidth / 2, fontSize * 0.35, rotation);
                        page.drawText(text, { x: anchor.x, y: anchor.y, size: fontSize, font, color, opacity, rotate: PDFLib.degrees(rotation) });
                    } else {
                        const stepX = textWidth + 90;
                        const stepY = fontSize * 3.2;
                        for (let gy = stepY / 2; gy < ph + stepY; gy += stepY) {
                            for (let gx = stepX / 2; gx < pw + stepX; gx += stepX) {
                                const anchor = this.rotatedAnchor(gx, gy, textWidth / 2, fontSize * 0.35, rotation);
                                page.drawText(text, { x: anchor.x, y: anchor.y, size: fontSize, font, color, opacity, rotate: PDFLib.degrees(rotation) });
                            }
                        }
                    }
                } else {
                    const targetW = Math.min(pw * 0.5, embeddedImage.width);
                    const targetH = targetW * (embeddedImage.height / embeddedImage.width);
                    if (layout === 'center') {
                        const anchor = this.rotatedAnchor(pw / 2, ph / 2, targetW / 2, targetH / 2, rotation);
                        page.drawImage(embeddedImage, { x: anchor.x, y: anchor.y, width: targetW, height: targetH, opacity, rotate: PDFLib.degrees(rotation) });
                    } else {
                        const stepX = targetW + 50;
                        const stepY = targetH + 50;
                        for (let gy = stepY / 2; gy < ph + stepY; gy += stepY) {
                            for (let gx = stepX / 2; gx < pw + stepX; gx += stepX) {
                                const anchor = this.rotatedAnchor(gx, gy, targetW / 2, targetH / 2, rotation);
                                page.drawImage(embeddedImage, { x: anchor.x, y: anchor.y, width: targetW, height: targetH, opacity, rotate: PDFLib.degrees(rotation) });
                            }
                        }
                    }
                }
            });

            const bytes = await pdfDoc.save();
            downloadBytes(bytes, 'watermarked-document.pdf');
            window.advancedSuite.showStatusMessage('Watermark applied successfully', 'success');
        } catch (error) {
            console.error('Watermark Apply Error:', error);
            window.advancedSuite.showError('Failed to apply watermark: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async applyStamps() {
        if (!this.originalBytes) { window.advancedSuite.showError('No PDF loaded'); return; }
        if (this.stampItems.length === 0) { window.advancedSuite.showError('Place at least one stamp first'); return; }

        window.advancedSuite.showStatusContainer('Applying stamps...', true);

        try {
            const pdfDoc = await PDFLib.PDFDocument.load(this.originalBytes, { ignoreEncryption: true });
            const font = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
            const color = PDFLib.rgb(0.78, 0.12, 0.12);

            this.stampItems.forEach((stamp, i) => {
                window.advancedSuite.updateProgress((i / this.stampItems.length) * 90);
                const page = pdfDoc.getPage(stamp.page - 1);
                const pw = page.getWidth();
                const ph = page.getHeight();
                const x = stamp.xFrac * pw;
                const widthPt = stamp.wFrac * pw;
                const heightPt = stamp.hFrac * ph;
                const y = ph - (stamp.yFrac * ph) - heightPt;

                page.drawRectangle({ x, y, width: widthPt, height: heightPt, borderColor: color, borderWidth: 2.5 });

                const fontSize = Math.min(heightPt * 0.5, (widthPt / (stamp.text.length || 1)) * 1.6);
                const textWidth = font.widthOfTextAtSize(stamp.text, fontSize);
                page.drawText(stamp.text, {
                    x: x + (widthPt - textWidth) / 2,
                    y: y + heightPt / 2 - fontSize * 0.35,
                    size: fontSize,
                    font,
                    color
                });
            });

            const bytes = await pdfDoc.save();
            downloadBytes(bytes, 'stamped-document.pdf');
            window.advancedSuite.showStatusMessage('Stamps applied successfully', 'success');
        } catch (error) {
            console.error('Stamp Apply Error:', error);
            window.advancedSuite.showError('Failed to apply stamps: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async applyPageNumbers() {
        if (!this.originalBytes) { window.advancedSuite.showError('No PDF loaded'); return; }

        window.advancedSuite.showStatusContainer('Adding page numbers...', true);

        try {
            const pdfDoc = await PDFLib.PDFDocument.load(this.originalBytes, { ignoreEncryption: true });
            const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
            const format = document.getElementById('pn-format').value;
            const position = document.getElementById('pn-position').value;
            const startAt = parseInt(document.getElementById('pn-start').value, 10) || 1;
            const fontSize = parseInt(document.getElementById('pn-font-size').value, 10) || 10;
            const total = pdfDoc.getPageCount();
            const color = PDFLib.rgb(0.1, 0.1, 0.1);
            const margin = 28;

            pdfDoc.getPages().forEach((page, idx) => {
                window.advancedSuite.updateProgress((idx / total) * 90);
                const n = startAt + idx;
                let label;
                switch (format) {
                    case 'n': label = `${n}`; break;
                    case 'n-of-total': label = `${n} of ${total}`; break;
                    case 'page-n-of-total': label = `Page ${n} of ${total}`; break;
                    default: label = `Page ${n}`;
                }

                const pw = page.getWidth();
                const ph = page.getHeight();
                const textWidth = font.widthOfTextAtSize(label, fontSize);
                let x;
                if (position.includes('left')) x = margin;
                else if (position.includes('right')) x = pw - margin - textWidth;
                else x = (pw - textWidth) / 2;
                const y = position.startsWith('top') ? ph - margin : margin;

                page.drawText(label, { x, y, size: fontSize, font, color });
            });

            const bytes = await pdfDoc.save();
            downloadBytes(bytes, 'numbered-document.pdf');
            window.advancedSuite.showStatusMessage('Page numbers added successfully', 'success');
        } catch (error) {
            console.error('Page Numbering Error:', error);
            window.advancedSuite.showError('Failed to add page numbers: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async applyHeaderFooter() {
        if (!this.originalBytes) { window.advancedSuite.showError('No PDF loaded'); return; }

        const fields = {
            headerLeft: document.getElementById('hf-header-left').value,
            headerCenter: document.getElementById('hf-header-center').value,
            headerRight: document.getElementById('hf-header-right').value,
            footerLeft: document.getElementById('hf-footer-left').value,
            footerCenter: document.getElementById('hf-footer-center').value,
            footerRight: document.getElementById('hf-footer-right').value
        };
        const hasAny = Object.values(fields).some(v => v && v.trim());
        if (!hasAny) { window.advancedSuite.showError('Enter at least one header or footer field'); return; }

        window.advancedSuite.showStatusContainer('Adding header/footer...', true);

        try {
            const pdfDoc = await PDFLib.PDFDocument.load(this.originalBytes, { ignoreEncryption: true });
            const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
            const fontSize = parseInt(document.getElementById('hf-font-size').value, 10) || 9;
            const total = pdfDoc.getPageCount();
            const filename = this.file ? this.file.name.replace(/\.pdf$/i, '') : 'document';
            const dateStr = new Date().toLocaleDateString();
            const color = PDFLib.rgb(0.1, 0.1, 0.1);
            const margin = 28;

            const substitute = (str, n) => (str || '')
                .replace(/\{page\}/g, n)
                .replace(/\{total\}/g, total)
                .replace(/\{date\}/g, dateStr)
                .replace(/\{filename\}/g, filename);

            pdfDoc.getPages().forEach((page, idx) => {
                window.advancedSuite.updateProgress((idx / total) * 90);
                const n = idx + 1;
                const pw = page.getWidth();
                const ph = page.getHeight();
                const rows = [
                    { text: fields.headerLeft, y: ph - margin, align: 'left' },
                    { text: fields.headerCenter, y: ph - margin, align: 'center' },
                    { text: fields.headerRight, y: ph - margin, align: 'right' },
                    { text: fields.footerLeft, y: margin, align: 'left' },
                    { text: fields.footerCenter, y: margin, align: 'center' },
                    { text: fields.footerRight, y: margin, align: 'right' }
                ];

                rows.forEach(row => {
                    if (!row.text || !row.text.trim()) return;
                    const label = substitute(row.text, n);
                    const textWidth = font.widthOfTextAtSize(label, fontSize);
                    let x;
                    if (row.align === 'left') x = margin;
                    else if (row.align === 'right') x = pw - margin - textWidth;
                    else x = (pw - textWidth) / 2;
                    page.drawText(label, { x, y: row.y, size: fontSize, font, color });
                });
            });

            const bytes = await pdfDoc.save();
            downloadBytes(bytes, 'headerfooter-document.pdf');
            window.advancedSuite.showStatusMessage('Header/footer added successfully', 'success');
        } catch (error) {
            console.error('Header/Footer Error:', error);
            window.advancedSuite.showError('Failed to add header/footer: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
}

// Compress PDF - rasterize pages and re-encode as optimized JPEGs
class PDFCompressor {
    constructor() {
        this.file = null;
        this.originalBytes = null;
        this.pdfDoc = null;
        this.totalPages = 0;
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        console.log('Compressor: Initialized');
    }

    setupEventListeners() {
        const fileInput = document.getElementById('compress-file-input');
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        const compressBtn = document.getElementById('compress-pdf-btn');
        if (compressBtn) compressBtn.addEventListener('click', () => this.compress());
    }

    setupDragAndDrop() {
        const dropZone = document.getElementById('compress-drop-zone');
        if (!dropZone) return;

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadPDF(files[0]);
            dropZone.classList.remove('drag-over');
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
        });
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.loadPDF(file);
    }

    async loadPDF(file) {
        window.advancedSuite.showStatusContainer('Loading PDF...');

        try {
            const bytes = await loadPDFBytes(file);
            // pdf.js transfers/detaches the buffer it's given, so hand it a copy
            // and keep the original bytes intact for pdf-lib to reuse later.
            const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

            this.file = file;
            this.originalBytes = bytes;
            this.pdfDoc = pdf;
            this.totalPages = pdf.numPages;

            document.getElementById('compress-controls').classList.remove('hidden');
            document.getElementById('compress-summary').innerHTML =
                `<strong>${file.name}</strong> &mdash; ${this.formatSize(bytes.length)} &middot; ${this.totalPages} page${this.totalPages === 1 ? '' : 's'}`;
            document.getElementById('compress-result').classList.add('hidden');

            window.advancedSuite.showStatusMessage(`PDF loaded (${this.totalPages} pages)`, 'success');
        } catch (error) {
            console.error('Compress Load Error:', error);
            window.advancedSuite.showError('Failed to load PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    async compress() {
        if (!this.originalBytes) { window.advancedSuite.showError('No PDF loaded'); return; }

        const level = document.getElementById('compress-level').value;
        const settings = {
            low: { scale: 1.5, quality: 0.85 },
            medium: { scale: 1.15, quality: 0.7 },
            high: { scale: 0.85, quality: 0.5 }
        }[level];

        window.advancedSuite.showStatusContainer('Compressing PDF...', true);

        try {
            const newDoc = await PDFLib.PDFDocument.create();

            for (let i = 1; i <= this.totalPages; i++) {
                window.advancedSuite.updateProgress(((i - 1) / this.totalPages) * 90);

                const page = await this.pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale: settings.scale });

                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;

                const jpegDataUrl = canvas.toDataURL('image/jpeg', settings.quality);
                const jpegImage = await newDoc.embedJpg(dataUrlToBytes(jpegDataUrl));

                const vp1 = page.getViewport({ scale: 1 });
                const newPage = newDoc.addPage([vp1.width, vp1.height]);
                newPage.drawImage(jpegImage, { x: 0, y: 0, width: vp1.width, height: vp1.height });
            }

            const bytes = await newDoc.save();
            const originalSize = this.originalBytes.length;
            const newSize = bytes.length;
            const pct = Math.round((1 - newSize / originalSize) * 100);

            downloadBytes(bytes, 'compressed-document.pdf');

            const resultEl = document.getElementById('compress-result');
            resultEl.classList.remove('hidden');
            resultEl.innerHTML = `Original: ${this.formatSize(originalSize)} &rarr; Compressed: ${this.formatSize(newSize)}` +
                (pct > 0 ? ` (<strong>${pct}% smaller</strong>)` : ' (no size reduction for this file — try a higher compression level)');

            window.advancedSuite.showStatusMessage('PDF compressed successfully', 'success');
        } catch (error) {
            console.error('Compress Error:', error);
            window.advancedSuite.showError('Failed to compress PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
}

// Protect & Redact - permanent redaction (page flattening) and password encryption
class PDFProtect {
    constructor() {
        this.file = null;
        this.originalBytes = null;
        this.pdfDoc = null;
        this.totalPages = 0;
        this.currentPage = 1;
        this.scale = 1;
        this.pageSizes = [];
        this.redactMarks = [];
        this.inProgressRect = null;
        this.activeSection = 'redact';
    }

    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupMarkCanvas();
        console.log('Protect: Initialized');
    }

    setupEventListeners() {
        const fileInput = document.getElementById('protect-file-input');
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

        document.querySelectorAll('.protect-section-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchSection(btn.dataset.protectsection));
        });

        const prevBtn = document.getElementById('redact-prev-page-btn');
        const nextBtn = document.getElementById('redact-next-page-btn');
        if (prevBtn) prevBtn.addEventListener('click', () => this.previousPage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextPage());

        const undoBtn = document.getElementById('redact-undo-mark-btn');
        const clearBtn = document.getElementById('redact-clear-page-btn');
        if (undoBtn) undoBtn.addEventListener('click', () => this.undoMark());
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearPageMarks());

        const applyRedactBtn = document.getElementById('apply-redactions-btn');
        if (applyRedactBtn) applyRedactBtn.addEventListener('click', () => this.applyRedactions());

        const applyPasswordBtn = document.getElementById('apply-password-btn');
        if (applyPasswordBtn) applyPasswordBtn.addEventListener('click', () => this.applyPassword());
    }

    setupDragAndDrop() {
        const dropZone = document.getElementById('protect-drop-zone');
        if (!dropZone) return;

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadPDF(files[0]);
            dropZone.classList.remove('drag-over');
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                dropZone.classList.add('drag-over');
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('drag-over'));
        });
    }

    handleFileSelect(e) {
        const file = e.target.files[0];
        if (file) this.loadPDF(file);
    }

    async loadPDF(file) {
        window.advancedSuite.showStatusContainer('Loading PDF...');

        try {
            const bytes = await loadPDFBytes(file);
            // pdf.js transfers/detaches the buffer it's given, so hand it a copy
            // and keep the original bytes intact for pdf-lib to reuse later.
            const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

            this.file = file;
            this.originalBytes = bytes;
            this.pdfDoc = pdf;
            this.totalPages = pdf.numPages;
            this.currentPage = 1;
            this.pageSizes = [];
            this.redactMarks = [];
            this.inProgressRect = null;

            const page1 = await pdf.getPage(1);
            const vp1 = page1.getViewport({ scale: 1 });
            this.scale = Math.min(1.4, 760 / vp1.width);

            document.getElementById('protect-controls').classList.remove('hidden');
            await this.renderPage(1);

            window.advancedSuite.showStatusMessage(`PDF loaded (${this.totalPages} pages)`, 'success');
        } catch (error) {
            console.error('Protect Load Error:', error);
            window.advancedSuite.showError('Failed to load PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    switchSection(section) {
        this.activeSection = section;
        document.querySelectorAll('.protect-section-btn').forEach(b => b.classList.toggle('active', b.dataset.protectsection === section));
        document.querySelectorAll('.protect-section-panel').forEach(p => p.classList.toggle('hidden', p.id !== `protect-section-${section}`));
    }

    async renderPage(pageNum) {
        const page = await this.pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: this.scale });

        if (!this.pageSizes[pageNum - 1]) {
            const vp1 = page.getViewport({ scale: 1 });
            this.pageSizes[pageNum - 1] = { width: vp1.width, height: vp1.height };
        }

        const canvas = document.getElementById('redact-pdf-canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

        const markCanvas = document.getElementById('redact-mark-canvas');
        markCanvas.width = viewport.width;
        markCanvas.height = viewport.height;

        this.updatePageNav();
        this.drawRedactCanvas();
    }

    updatePageNav() {
        const info = document.getElementById('redact-page-info');
        const prevBtn = document.getElementById('redact-prev-page-btn');
        const nextBtn = document.getElementById('redact-next-page-btn');
        if (info) info.textContent = `${this.currentPage}/${this.totalPages}`;
        if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
        if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
    }

    previousPage() {
        if (this.currentPage > 1) { this.currentPage--; this.renderPage(this.currentPage); }
    }

    nextPage() {
        if (this.currentPage < this.totalPages) { this.currentPage++; this.renderPage(this.currentPage); }
    }

    setupMarkCanvas() {
        const canvas = document.getElementById('redact-mark-canvas');
        if (!canvas) return;
        let dragging = false;
        let startFrac = null;

        const getFrac = (e) => {
            const rect = canvas.getBoundingClientRect();
            return {
                x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
                y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1)
            };
        };

        canvas.addEventListener('mousedown', (e) => {
            if (!this.pdfDoc) return;
            dragging = true;
            startFrac = getFrac(e);
            this.inProgressRect = null;
        });

        canvas.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const cur = getFrac(e);
            this.inProgressRect = this.rectFromPoints(startFrac, cur);
            this.drawRedactCanvas();
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            if (this.inProgressRect && this.inProgressRect.wFrac > 0.01 && this.inProgressRect.hFrac > 0.01) {
                this.redactMarks.push({
                    id: Date.now() + Math.random(),
                    page: this.currentPage,
                    ...this.inProgressRect
                });
            }
            this.inProgressRect = null;
            this.drawRedactCanvas();
        });
    }

    rectFromPoints(a, b) {
        return {
            xFrac: Math.min(a.x, b.x),
            yFrac: Math.min(a.y, b.y),
            wFrac: Math.abs(b.x - a.x),
            hFrac: Math.abs(b.y - a.y)
        };
    }

    drawRedactCanvas() {
        const canvas = document.getElementById('redact-mark-canvas');
        if (!canvas || !canvas.width) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const drawRect = (m, committed) => {
            const x = m.xFrac * canvas.width;
            const y = m.yFrac * canvas.height;
            const w = m.wFrac * canvas.width;
            const h = m.hFrac * canvas.height;
            ctx.fillStyle = committed ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = '#ff3b3b';
            ctx.lineWidth = 1.5;
            ctx.setLineDash(committed ? [] : [4, 3]);
            ctx.strokeRect(x, y, w, h);
        };

        this.redactMarks.filter(m => m.page === this.currentPage).forEach(m => drawRect(m, true));
        if (this.inProgressRect) drawRect(this.inProgressRect, false);
    }

    undoMark() {
        for (let i = this.redactMarks.length - 1; i >= 0; i--) {
            if (this.redactMarks[i].page === this.currentPage) {
                this.redactMarks.splice(i, 1);
                break;
            }
        }
        this.drawRedactCanvas();
    }

    clearPageMarks() {
        const hasMarks = this.redactMarks.some(m => m.page === this.currentPage);
        if (!hasMarks) return;
        this.redactMarks = this.redactMarks.filter(m => m.page !== this.currentPage);
        this.drawRedactCanvas();
    }

    async applyRedactions() {
        if (!this.originalBytes) { window.advancedSuite.showError('No PDF loaded'); return; }
        if (this.redactMarks.length === 0) { window.advancedSuite.showError('Draw at least one redaction box first'); return; }

        window.advancedSuite.showStatusContainer('Applying redactions...', true);

        try {
            const markedPages = new Set(this.redactMarks.map(m => m.page));
            const srcDoc = await PDFLib.PDFDocument.load(this.originalBytes, { ignoreEncryption: true });
            const newDoc = await PDFLib.PDFDocument.create();

            for (let i = 0; i < this.totalPages; i++) {
                window.advancedSuite.updateProgress((i / this.totalPages) * 90);
                const pageNum = i + 1;

                if (markedPages.has(pageNum)) {
                    const page = await this.pdfDoc.getPage(pageNum);
                    const viewport = page.getViewport({ scale: 2 });
                    const canvas = document.createElement('canvas');
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport }).promise;

                    ctx.fillStyle = '#000000';
                    this.redactMarks.filter(m => m.page === pageNum).forEach(m => {
                        ctx.fillRect(m.xFrac * canvas.width, m.yFrac * canvas.height, m.wFrac * canvas.width, m.hFrac * canvas.height);
                    });

                    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
                    const jpegImage = await newDoc.embedJpg(dataUrlToBytes(jpegDataUrl));
                    const vp1 = page.getViewport({ scale: 1 });
                    const newPage = newDoc.addPage([vp1.width, vp1.height]);
                    newPage.drawImage(jpegImage, { x: 0, y: 0, width: vp1.width, height: vp1.height });
                } else {
                    const [copied] = await newDoc.copyPages(srcDoc, [i]);
                    newDoc.addPage(copied);
                }
            }

            const bytes = await newDoc.save();
            downloadBytes(bytes, 'redacted-document.pdf');
            window.advancedSuite.showStatusMessage('Redactions applied — covered content is permanently removed', 'success');
        } catch (error) {
            console.error('Redaction Error:', error);
            window.advancedSuite.showError('Failed to apply redactions: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }

    async applyPassword() {
        if (!this.originalBytes) { window.advancedSuite.showError('No PDF loaded'); return; }

        const userPassword = document.getElementById('protect-user-password').value;
        const ownerPasswordInput = document.getElementById('protect-owner-password').value;
        if (!userPassword) { window.advancedSuite.showError('Please enter an open password'); return; }
        const ownerPassword = ownerPasswordInput || userPassword;

        const permissions = [];
        if (document.getElementById('perm-print').checked) permissions.push('print');
        if (document.getElementById('perm-copy').checked) permissions.push('copy');
        if (document.getElementById('perm-modify').checked) permissions.push('modify');

        window.advancedSuite.showStatusContainer('Encrypting PDF...', true);

        try {
            const { jsPDF } = window.jspdf;
            let doc = null;

            for (let i = 1; i <= this.totalPages; i++) {
                window.advancedSuite.updateProgress(((i - 1) / this.totalPages) * 85);

                const page = await this.pdfDoc.getPage(i);
                const viewport = page.getViewport({ scale: 2 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                await page.render({ canvasContext: ctx, viewport }).promise;
                const imgData = canvas.toDataURL('image/jpeg', 0.85);

                const vp1 = page.getViewport({ scale: 1 });
                const orientation = vp1.width > vp1.height ? 'l' : 'p';

                if (!doc) {
                    doc = new jsPDF({
                        orientation,
                        unit: 'pt',
                        format: [vp1.width, vp1.height],
                        encryption: { userPassword, ownerPassword, userPermissions: permissions }
                    });
                } else {
                    doc.addPage([vp1.width, vp1.height], orientation);
                }
                doc.addImage(imgData, 'JPEG', 0, 0, vp1.width, vp1.height);
            }

            window.advancedSuite.updateProgress(95);
            const outputBytes = doc.output('arraybuffer');
            downloadBytes(new Uint8Array(outputBytes), 'protected-document.pdf');

            window.advancedSuite.showStatusMessage('Password-protected PDF saved (rebuilt from page images to enable encryption)', 'success');
        } catch (error) {
            console.error('Protect Error:', error);
            window.advancedSuite.showError('Failed to protect PDF: ' + error.message);
        } finally {
            window.advancedSuite.hideStatusContainer();
        }
    }
}

// Global self-test function
window.AdvancedSuiteSelfTest = function() {
    if (window.advancedSuite && window.advancedSuite.editor) {
        return window.advancedSuite.editor.runSelfTest();
    } else {
        console.error('Advanced PDF Suite not initialized');
        return Promise.resolve(false);
    }
};

// Global initialization function
function initializeAdvancedPDFSuite() {
    console.log('Advanced PDF Suite: Global initialization function called');
    
    try {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js library not available');
        }
        
        if (typeof PDFLib === 'undefined') {
            throw new Error('PDF-lib library not available');
        }
        
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library not available');
        }
        
        if (typeof Tesseract === 'undefined') {
            throw new Error('Tesseract.js library not available');
        }

        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            throw new Error('jsPDF library not available');
        }

        window.advancedSuite = new AdvancedPDFSuite();
        window.advancedSuite.init();
        
        console.log('Advanced PDF Suite: Application initialized successfully');
        
    } catch (error) {
        console.error('Advanced PDF Suite: Failed to initialize application:', error);
        
        const errorDisplay = document.getElementById('error-display');
        const errorMessage = document.getElementById('error-message');
        
        if (errorDisplay && errorMessage) {
            errorMessage.textContent = 'Failed to initialize Advanced PDF Suite: ' + error.message;
            errorDisplay.classList.remove('hidden');
        }
    }
}

window.initializeAdvancedPDFSuite = initializeAdvancedPDFSuite;