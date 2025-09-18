// APX Lens Content Script
// This script runs on every webpage and handles sidebar creation and page interaction

class APXLensSidebar {
    constructor() {
        this.sidebarElement = null;
        this.isOpen = false;
        this.messages = [];
        this.init();
    }

    init() {
        // Listen for messages from popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'openSidebar') {
                this.openSidebar();
                sendResponse({ success: true });
            } else if (request.action === 'captureAndAnalyze') {
                this.captureAndAnalyze();
                sendResponse({ success: true });
            }
        });

        // Create sidebar HTML structure
        this.createSidebar();
    }

    createSidebar() {
        if (this.sidebarElement) return;

        // Create sidebar container
        this.sidebarElement = document.createElement('div');
        this.sidebarElement.id = 'apx-lens-sidebar';
        this.sidebarElement.className = 'apx-sidebar-closed';
        
        this.sidebarElement.innerHTML = `
            <div class="apx-sidebar-content">
                <div class="apx-sidebar-header">
                    <div class="apx-sidebar-title">
                        <span class="apx-icon">🔍</span>
                        <h3>APX Lens</h3>
                    </div>
                    <button class="apx-close-btn" id="apx-close-sidebar">✕</button>
                </div>
                
                <div class="apx-chat-container">
                    <div class="apx-messages" id="apx-messages">
                        <div class="apx-message apx-assistant-message">
                            <div class="apx-message-content">
                                <span class="apx-assistant-icon">🤖</span>
                                <div class="apx-message-text">
                                    Hello! I'm your AI assistant. I can help you analyze this webpage, answer questions about its content, or assist with various tasks. How can I help you today?
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="apx-input-container">
                        <div class="apx-input-wrapper">
                            <textarea 
                                id="apx-chat-input" 
                                placeholder="Ask me anything about this page or request assistance..."
                                rows="1"
                            ></textarea>
                            <button id="apx-send-btn" class="apx-send-btn">
                                <span class="apx-send-icon">→</span>
                            </button>
                        </div>
                        <div class="apx-input-actions">
                            <button id="apx-capture-btn" class="apx-action-btn">
                                📄 Analyze Page
                            </button>
                            <button id="apx-screenshot-btn" class="apx-action-btn">
                                📸 Take Screenshot
                            </button>
                        </div>
                    </div>
                </div>
                
                <div class="apx-sidebar-footer">
                    <div class="apx-status" id="apx-status">Ready to assist</div>
                </div>
            </div>
        `;

        // Append to body
        document.body.appendChild(this.sidebarElement);

        // Set up event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close button
        const closeBtn = document.getElementById('apx-close-sidebar');
        closeBtn.addEventListener('click', () => this.closeSidebar());

        // Send button and input
        const sendBtn = document.getElementById('apx-send-btn');
        const chatInput = document.getElementById('apx-chat-input');
        
        sendBtn.addEventListener('click', () => this.sendMessage());
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        });

        // Action buttons
        const captureBtn = document.getElementById('apx-capture-btn');
        const screenshotBtn = document.getElementById('apx-screenshot-btn');
        
        captureBtn.addEventListener('click', () => this.capturePageContent());
        screenshotBtn.addEventListener('click', () => this.takeScreenshot());

        // Click outside to close (optional)
        document.addEventListener('click', (e) => {
            if (this.isOpen && !this.sidebarElement.contains(e.target)) {
                // Uncomment to enable click-outside-to-close
                // this.closeSidebar();
            }
        });
    }

    openSidebar() {
        if (!this.sidebarElement) this.createSidebar();
        
        this.sidebarElement.className = 'apx-sidebar-open';
        this.isOpen = true;
        
        // Focus on input
        setTimeout(() => {
            const input = document.getElementById('apx-chat-input');
            if (input) input.focus();
        }, 300);
    }

    closeSidebar() {
        if (!this.sidebarElement) return;
        
        this.sidebarElement.className = 'apx-sidebar-closed';
        this.isOpen = false;
    }

    sendMessage() {
        const input = document.getElementById('apx-chat-input');
        const message = input.value.trim();
        
        if (!message) return;

        // Add user message to chat
        this.addMessage(message, 'user');
        
        // Clear input
        input.value = '';
        input.style.height = 'auto';

        // Process the message
        this.processUserMessage(message);
    }

    addMessage(content, type = 'user') {
        const messagesContainer = document.getElementById('apx-messages');
        const messageElement = document.createElement('div');
        
        messageElement.className = `apx-message apx-${type}-message`;
        
        if (type === 'user') {
            messageElement.innerHTML = `
                <div class="apx-message-content">
                    <div class="apx-message-text">${this.escapeHtml(content)}</div>
                    <span class="apx-user-icon">👤</span>
                </div>
            `;
        } else {
            messageElement.innerHTML = `
                <div class="apx-message-content">
                    <span class="apx-assistant-icon">🤖</span>
                    <div class="apx-message-text">${content}</div>
                </div>
            `;
        }

        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        this.messages.push({ content, type, timestamp: Date.now() });
    }

    processUserMessage(message) {
        this.updateStatus('Processing your request...');

        // Simulate AI processing (replace with actual AI integration)
        setTimeout(() => {
            let response = this.generateResponse(message);
            this.addMessage(response, 'assistant');
            this.updateStatus('Ready to assist');
        }, 1000);
    }

    generateResponse(message) {
        // Simple response generation (replace with actual AI)
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('analyze') || lowerMessage.includes('page')) {
            return `I can see you're on "${document.title}". This page appears to be about ${this.getPageSummary()}. Would you like me to analyze specific elements or content?`;
        } else if (lowerMessage.includes('help')) {
            return "I can help you with:\n• Analyzing page content\n• Extracting information\n• Answering questions about what's on the page\n• Taking screenshots\n• Navigating and interacting with elements\n\nWhat would you like to do?";
        } else if (lowerMessage.includes('screenshot')) {
            this.takeScreenshot();
            return "I've captured a screenshot of the current page. You can use this to reference what's currently visible.";
        } else {
            return `I understand you said: "${message}". I'm analyzing the current page to provide the best assistance. This page has ${document.querySelectorAll('*').length} elements and the main content appears to be ${this.getContentType()}.`;
        }
    }

    captureAndAnalyze() {
        this.openSidebar();
        this.updateStatus('Analyzing page content...');
        
        setTimeout(() => {
            const analysis = this.analyzePageContent();
            this.addMessage(analysis, 'assistant');
            this.updateStatus('Analysis complete');
        }, 1500);
    }

    capturePageContent() {
        this.updateStatus('Capturing page content...');
        
        const content = {
            title: document.title,
            url: window.location.href,
            textContent: document.body.innerText.substring(0, 5000), // Limit to 5000 chars
            headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.textContent.trim()),
            links: Array.from(document.querySelectorAll('a')).slice(0, 10).map(a => ({
                text: a.textContent.trim(),
                href: a.href
            })),
            images: Array.from(document.querySelectorAll('img')).slice(0, 5).map(img => ({
                alt: img.alt,
                src: img.src
            }))
        };

        const summary = this.formatContentSummary(content);
        this.addMessage(summary, 'assistant');
        this.updateStatus('Content captured');
    }

    analyzePageContent() {
        const analysis = {
            pageType: this.getContentType(),
            wordCount: document.body.innerText.split(/\s+/).length,
            headingCount: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
            linkCount: document.querySelectorAll('a').length,
            imageCount: document.querySelectorAll('img').length,
            formCount: document.querySelectorAll('form').length
        };

        return `📊 **Page Analysis Complete**

**Page Title:** ${document.title}
**URL:** ${window.location.href}
**Content Type:** ${analysis.pageType}

**Content Statistics:**
• ${analysis.wordCount} words
• ${analysis.headingCount} headings
• ${analysis.linkCount} links
• ${analysis.imageCount} images
• ${analysis.formCount} forms

**Key Headings:**
${Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 5).map(h => `• ${h.textContent.trim()}`).join('\n')}

How can I help you interact with this content?`;
    }

    takeScreenshot() {
        this.updateStatus('Taking screenshot...');
        
        // Since content scripts can't directly take screenshots, we'll simulate this
        // In a real implementation, you'd use chrome.tabs.captureVisibleTab in background script
        setTimeout(() => {
            this.addMessage('📸 Screenshot captured! (Note: In a full implementation, this would capture the actual page screenshot using Chrome APIs)', 'assistant');
            this.updateStatus('Screenshot ready');
        }, 1000);
    }

    getPageSummary() {
        const title = document.title;
        const headings = Array.from(document.querySelectorAll('h1, h2')).slice(0, 3);
        const summary = headings.length > 0 ? headings.map(h => h.textContent.trim()).join(', ') : 'various content';
        return summary || title || 'this website';
    }

    getContentType() {
        if (document.querySelector('article')) return 'Article/Blog Post';
        if (document.querySelector('form')) return 'Form/Application';
        if (document.querySelector('.product, .item, .listing')) return 'E-commerce/Listing';
        if (document.querySelector('nav, .menu')) return 'Navigation/Portal';
        return 'General Website';
    }

    formatContentSummary(content) {
        return `📄 **Page Content Captured**

**Title:** ${content.title}
**URL:** ${content.url}

**Key Headings:**
${content.headings.slice(0, 5).map(h => `• ${h}`).join('\n') || '• No major headings found'}

**Top Links:**
${content.links.slice(0, 3).map(l => `• ${l.text} (${l.href})`).join('\n') || '• No links found'}

**Content Preview:**
${content.textContent.substring(0, 300)}...

I've captured the key information from this page. What would you like me to help you with?`;
    }

    updateStatus(message) {
        const statusElement = document.getElementById('apx-status');
        if (statusElement) {
            statusElement.textContent = message;
        }
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}

// Initialize the sidebar when the page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new APXLensSidebar();
    });
} else {
    new APXLensSidebar();
}