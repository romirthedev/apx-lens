// Gemini Lens - Side Panel Script

class GeminiLensSidePanel {
  constructor() {
    this.isInitialized = false;
    this.currentTabId = null;
    this.conversationHistory = [];
    this.isLoading = false;
    this.init();
  }

  async init() {
    if (this.isInitialized) return;
    
    await this.setupElements();
    this.setupEventListeners();
    await this.loadPageContext();
    await this.loadConversationHistory();
    this.isInitialized = true;
    
    console.log('Gemini Lens side panel initialized');
  }

  async setupElements() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve);
      });
    }

    this.elements = {
      pageTitle: document.getElementById('page-title'),
      pageUrl: document.getElementById('page-url'),
      chatContainer: document.getElementById('chat-container'),
      chatInput: document.getElementById('chat-input'),
      sendButton: document.getElementById('send-button'),
      clearButton: document.getElementById('clear-button'),
      loadingIndicator: document.getElementById('loading-indicator')
    };

    // Verify all elements exist
    for (const [key, element] of Object.entries(this.elements)) {
      if (!element) {
        console.warn(`Element not found: ${key}`);
      }
    }
  }

  setupEventListeners() {
    // Send button click
    if (this.elements.sendButton) {
      this.elements.sendButton.addEventListener('click', () => {
        this.handleSendMessage();
      });
    }

    // Enter key in input
    if (this.elements.chatInput) {
      this.elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleSendMessage();
        }
      });

      // Auto-resize textarea
      this.elements.chatInput.addEventListener('input', () => {
        this.autoResizeTextarea();
      });
    }

    // Clear conversation button
    if (this.elements.clearButton) {
      this.elements.clearButton.addEventListener('click', () => {
        this.clearConversation();
      });
    }

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleBackgroundMessage(request, sender, sendResponse);
      return true;
    });

    // Listen for tab changes
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabChange(activeInfo.tabId);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tabId === this.currentTabId) {
        this.loadPageContext();
      }
    });
  }

  async loadPageContext() {
    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;

      this.currentTabId = tab.id;

      // Update page info
      if (this.elements.pageTitle) {
        this.elements.pageTitle.textContent = tab.title || 'Unknown Page';
      }
      if (this.elements.pageUrl) {
        this.elements.pageUrl.textContent = tab.url || '';
        this.elements.pageUrl.href = tab.url || '#';
      }

      // Get page metadata from background script
      const response = await chrome.runtime.sendMessage({
        action: 'getPageMetadata',
        tabId: this.currentTabId
      });

      if (response && response.success) {
        // Update with more detailed info if available
        if (response.metadata.title && this.elements.pageTitle) {
          this.elements.pageTitle.textContent = response.metadata.title;
        }
      }
    } catch (error) {
      console.error('Error loading page context:', error);
    }
  }

  async loadConversationHistory() {
    try {
      if (!this.currentTabId) return;

      const response = await chrome.runtime.sendMessage({
        action: 'getConversationHistory',
        tabId: this.currentTabId
      });

      if (response && response.success && response.history) {
        this.conversationHistory = response.history;
        this.renderConversationHistory();
      }
    } catch (error) {
      console.error('Error loading conversation history:', error);
    }
  }

  renderConversationHistory() {
    if (!this.elements.chatContainer) return;

    this.elements.chatContainer.innerHTML = '';

    this.conversationHistory.forEach(message => {
      this.addMessageToChat(message.content, message.role, false);
    });

    this.scrollToBottom();
  }

  async handleSendMessage() {
    if (!this.elements.chatInput || this.isLoading) return;

    const message = this.elements.chatInput.value.trim();
    if (!message) return;

    // Clear input and add user message to chat
    this.elements.chatInput.value = '';
    this.autoResizeTextarea();
    this.addMessageToChat(message, 'user');

    // Show loading state
    this.setLoadingState(true);

    try {
      // Send message to background script
      const response = await chrome.runtime.sendMessage({
        action: 'chatWithGemini',
        message: message,
        tabId: this.currentTabId
      });

      if (response && response.success) {
        // Add Gemini's response to chat
        this.addMessageToChat(response.response, 'assistant');
        
        // Update conversation history
        this.conversationHistory.push(
          { role: 'user', content: message },
          { role: 'assistant', content: response.response }
        );
      } else {
        // Handle error
        const errorMessage = response?.error || 'Failed to get response from Gemini';
        this.addMessageToChat(`Error: ${errorMessage}`, 'error');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      this.addMessageToChat('Error: Failed to send message', 'error');
    } finally {
      this.setLoadingState(false);
    }
  }

  addMessageToChat(content, role, shouldScroll = true) {
    if (!this.elements.chatContainer) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // Handle different content types
    if (role === 'error') {
      contentDiv.textContent = content;
    } else {
      // Convert markdown-like formatting to HTML
      contentDiv.innerHTML = this.formatMessageContent(content);
    }

    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    timestampDiv.textContent = new Date().toLocaleTimeString();

    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timestampDiv);
    
    this.elements.chatContainer.appendChild(messageDiv);

    if (shouldScroll) {
      this.scrollToBottom();
    }
  }

  formatMessageContent(content) {
    // Basic markdown-like formatting
    let formatted = content
      // Bold text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic text
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Code blocks
      .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
      // Inline code
      .replace(/`(.*?)`/g, '<code>$1</code>')
      // Line breaks
      .replace(/\n/g, '<br>');

    return formatted;
  }

  setLoadingState(isLoading) {
    this.isLoading = isLoading;
    
    if (this.elements.sendButton) {
      this.elements.sendButton.disabled = isLoading;
      this.elements.sendButton.textContent = isLoading ? '...' : 'Send';
    }
    
    if (this.elements.chatInput) {
      this.elements.chatInput.disabled = isLoading;
    }

    if (this.elements.loadingIndicator) {
      this.elements.loadingIndicator.style.display = isLoading ? 'block' : 'none';
    }
  }

  autoResizeTextarea() {
    if (!this.elements.chatInput) return;
    
    this.elements.chatInput.style.height = 'auto';
    this.elements.chatInput.style.height = Math.min(this.elements.chatInput.scrollHeight, 120) + 'px';
  }

  scrollToBottom() {
    if (!this.elements.chatContainer) return;
    
    setTimeout(() => {
      this.elements.chatContainer.scrollTop = this.elements.chatContainer.scrollHeight;
    }, 100);
  }

  clearConversation() {
    if (!confirm('Are you sure you want to clear the conversation history?')) {
      return;
    }

    this.conversationHistory = [];
    
    if (this.elements.chatContainer) {
      this.elements.chatContainer.innerHTML = '';
    }

    // Clear history in background script
    if (this.currentTabId) {
      chrome.runtime.sendMessage({
        action: 'clearConversationHistory',
        tabId: this.currentTabId
      });
    }
  }

  handleTabChange(tabId) {
    if (this.currentTabId !== tabId) {
      this.currentTabId = tabId;
      this.loadPageContext();
      this.loadConversationHistory();
    }
  }

  handleBackgroundMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'updatePageContext':
        this.loadPageContext();
        sendResponse({ success: true });
        break;
        
      case 'addChatMessage':
        this.addMessageToChat(request.content, request.role);
        sendResponse({ success: true });
        break;
        
      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  }

  // Public methods for external use
  async analyzeCurrentPage() {
    if (!this.currentTabId) return;

    this.setLoadingState(true);
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'analyzeContent',
        tabId: this.currentTabId
      });

      if (response && response.success) {
        this.addMessageToChat('📊 Page Analysis:', 'system');
        this.addMessageToChat(response.analysis, 'assistant');
      } else {
        this.addMessageToChat('Error: Failed to analyze page', 'error');
      }
    } catch (error) {
      console.error('Error analyzing page:', error);
      this.addMessageToChat('Error: Failed to analyze page', 'error');
    } finally {
      this.setLoadingState(false);
    }
  }

  async summarizeCurrentPage() {
    if (!this.currentTabId) return;

    this.setLoadingState(true);
    
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'summarizeContent',
        tabId: this.currentTabId
      });

      if (response && response.success) {
        this.addMessageToChat('📝 Page Summary:', 'system');
        this.addMessageToChat(response.summary, 'assistant');
      } else {
        this.addMessageToChat('Error: Failed to summarize page', 'error');
      }
    } catch (error) {
      console.error('Error summarizing page:', error);
      this.addMessageToChat('Error: Failed to summarize page', 'error');
    } finally {
      this.setLoadingState(false);
    }
  }
}

// Initialize side panel when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.geminiLensSidePanel = new GeminiLensSidePanel();
  });
} else {
  window.geminiLensSidePanel = new GeminiLensSidePanel();
}

// Export for external access
window.GeminiLensSidePanel = GeminiLensSidePanel;