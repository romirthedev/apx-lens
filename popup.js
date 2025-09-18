// Gemini Lens - Popup Script

class GeminiLensPopup {
  constructor() {
    this.apiKey = '';
    this.autoMode = false;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.updateUI();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['apiKey', 'autoMode']);
      this.apiKey = result.apiKey || '';
      this.autoMode = result.autoMode || false;
      
      // Update UI elements
      document.getElementById('apiKey').value = this.apiKey;
      document.getElementById('autoMode').checked = this.autoMode;
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.sync.set({
        apiKey: this.apiKey,
        autoMode: this.autoMode
      });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  setupEventListeners() {
    // Open side panel button
    document.getElementById('openSidePanel').addEventListener('click', () => {
      this.openSidePanel();
    });

    // Analyze page button
    document.getElementById('analyzePageBtn').addEventListener('click', () => {
      this.analyzePage();
    });

    // Summarize button
    document.getElementById('summarizeBtn').addEventListener('click', () => {
      this.summarizePage();
    });

    // API key input
    const apiKeyInput = document.getElementById('apiKey');
    apiKeyInput.addEventListener('input', (e) => {
      this.apiKey = e.target.value;
      this.saveSettings();
      this.updateStatus();
    });

    // Toggle API key visibility
    document.getElementById('toggleApiKey').addEventListener('click', () => {
      this.toggleApiKeyVisibility();
    });

    // Auto mode toggle
    document.getElementById('autoMode').addEventListener('change', (e) => {
      this.autoMode = e.target.checked;
      this.saveSettings();
    });

    // Footer links
    document.getElementById('helpLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openHelp();
    });

    document.getElementById('settingsLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openSettings();
    });

    document.getElementById('aboutLink').addEventListener('click', (e) => {
      e.preventDefault();
      this.openAbout();
    });
  }

  async openSidePanel() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } catch (error) {
      console.error('Error opening side panel:', error);
      this.showNotification('Failed to open side panel', 'error');
    }
  }

  async analyzePage() {
    if (!this.validateApiKey()) return;

    try {
      this.setButtonLoading('analyzePageBtn', true);
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Send message to content script to get page content
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'getPageContent'
      });

      if (response && response.content) {
        // Send to background script for analysis
        const result = await chrome.runtime.sendMessage({
          action: 'analyzeContent',
          content: response.content,
          url: tab.url,
          title: tab.title
        });

        if (result.success) {
          this.showNotification('Page analyzed successfully!', 'success');
          this.openSidePanel();
        } else {
          this.showNotification(result.error || 'Analysis failed', 'error');
        }
      } else {
        this.showNotification('Could not extract page content', 'error');
      }
    } catch (error) {
      console.error('Error analyzing page:', error);
      this.showNotification('Failed to analyze page', 'error');
    } finally {
      this.setButtonLoading('analyzePageBtn', false);
    }
  }

  async summarizePage() {
    if (!this.validateApiKey()) return;

    try {
      this.setButtonLoading('summarizeBtn', true);
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Send message to content script to get page content
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'getPageContent'
      });

      if (response && response.content) {
        // Send to background script for summarization
        const result = await chrome.runtime.sendMessage({
          action: 'summarizeContent',
          content: response.content,
          url: tab.url,
          title: tab.title
        });

        if (result.success) {
          this.showNotification('Page summarized successfully!', 'success');
          this.openSidePanel();
        } else {
          this.showNotification(result.error || 'Summarization failed', 'error');
        }
      } else {
        this.showNotification('Could not extract page content', 'error');
      }
    } catch (error) {
      console.error('Error summarizing page:', error);
      this.showNotification('Failed to summarize page', 'error');
    } finally {
      this.setButtonLoading('summarizeBtn', false);
    }
  }

  validateApiKey() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      this.showNotification('Please enter your Gemini API key first', 'warning');
      document.getElementById('apiKey').focus();
      return false;
    }
    return true;
  }

  toggleApiKeyVisibility() {
    const input = document.getElementById('apiKey');
    const button = document.getElementById('toggleApiKey');
    
    if (input.type === 'password') {
      input.type = 'text';
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C7 20 2.73 16.39 1 12A18.45 18.45 0 0 1 5.06 5.06M9.9 4.24A9.12 9.12 0 0 1 12 4C17 4 21.27 7.61 23 12A18.5 18.5 0 0 1 19.42 16.42" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M1 1L23 23" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10.58 10.58A3 3 0 1 0 13.42 13.42" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
    } else {
      input.type = 'password';
      button.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
        </svg>
      `;
    }
  }

  setButtonLoading(buttonId, loading) {
    const button = document.getElementById(buttonId);
    if (loading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  updateStatus() {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    if (this.apiKey && this.apiKey.trim() !== '') {
      statusDot.style.background = 'var(--success)';
      statusText.textContent = 'Ready';
    } else {
      statusDot.style.background = 'var(--warning)';
      statusText.textContent = 'API Key Required';
    }
  }

  updateUI() {
    this.updateStatus();
  }

  showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    
    // Add styles
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      border-radius: 8px;
      color: white;
      font-size: 14px;
      font-weight: 500;
      z-index: 1000;
      animation: slideIn 0.3s ease;
      max-width: 300px;
      word-wrap: break-word;
    `;
    
    // Set background color based on type
    switch (type) {
      case 'success':
        notification.style.background = 'var(--success)';
        break;
      case 'error':
        notification.style.background = 'var(--error)';
        break;
      case 'warning':
        notification.style.background = 'var(--warning)';
        break;
      default:
        notification.style.background = 'var(--primary-blue)';
    }
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  openHelp() {
    chrome.tabs.create({
      url: 'https://github.com/your-username/gemini-lens#help'
    });
  }

  openSettings() {
    // Focus on settings section
    document.querySelector('.settings-section').scrollIntoView({ behavior: 'smooth' });
  }

  openAbout() {
    chrome.tabs.create({
      url: 'https://github.com/your-username/gemini-lens'
    });
  }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new GeminiLensPopup();
});