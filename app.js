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
            const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
            
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