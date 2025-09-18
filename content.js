// Gemini Lens - Content Script

class GeminiLensContent {
  constructor() {
    this.isInitialized = false;
    this.pageContent = '';
    this.init();
  }

  init() {
    if (this.isInitialized) return;
    
    this.setupMessageListener();
    this.extractPageContent();
    this.isInitialized = true;
    
    console.log('Gemini Lens content script initialized');
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep the message channel open for async response
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'getPageContent':
          const content = await this.getPageContent();
          sendResponse({ success: true, content });
          break;

        case 'highlightText':
          this.highlightText(request.text);
          sendResponse({ success: true });
          break;

        case 'scrollToElement':
          this.scrollToElement(request.selector);
          sendResponse({ success: true });
          break;

        case 'extractSpecificContent':
          const specificContent = this.extractSpecificContent(request.selector);
          sendResponse({ success: true, content: specificContent });
          break;

        case 'getPageMetadata':
          const metadata = this.getPageMetadata();
          sendResponse({ success: true, metadata });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async getPageContent() {
    try {
      // If we already have content and the page hasn't changed significantly, return cached content
      if (this.pageContent && this.pageContent.length > 100) {
        return this.pageContent;
      }

      // Extract fresh content
      await this.extractPageContent();
      return this.pageContent;
    } catch (error) {
      console.error('Error getting page content:', error);
      return '';
    }
  }

  async extractPageContent() {
    try {
      // Wait for page to be fully loaded
      if (document.readyState !== 'complete') {
        await new Promise(resolve => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve, { once: true });
          }
        });
      }

      // Remove script and style elements
      const elementsToRemove = document.querySelectorAll('script, style, noscript, iframe');
      const tempContainer = document.cloneNode(true);
      const tempBody = tempContainer.querySelector('body');
      
      if (tempBody) {
        // Remove unwanted elements from the clone
        tempBody.querySelectorAll('script, style, noscript, iframe, nav, header, footer, .advertisement, .ads, .sidebar').forEach(el => {
          el.remove();
        });

        // Extract text content with some structure preservation
        let content = '';
        
        // Get title
        const title = document.title;
        if (title) {
          content += `Title: ${title}\n\n`;
        }

        // Get meta description
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription && metaDescription.content) {
          content += `Description: ${metaDescription.content}\n\n`;
        }

        // Get main content
        const mainContent = this.extractMainContent(tempBody);
        content += mainContent;

        // Clean up the content
        content = this.cleanContent(content);
        
        this.pageContent = content;
      } else {
        // Fallback: just get the text content
        this.pageContent = document.body ? document.body.innerText : '';
      }
    } catch (error) {
      console.error('Error extracting page content:', error);
      this.pageContent = document.body ? document.body.innerText : '';
    }
  }

  extractMainContent(container) {
    let content = '';
    
    // Try to find main content areas
    const mainSelectors = [
      'main',
      'article',
      '[role="main"]',
      '.main-content',
      '.content',
      '.post-content',
      '.entry-content',
      '#content',
      '#main'
    ];

    let mainElement = null;
    for (const selector of mainSelectors) {
      mainElement = container.querySelector(selector);
      if (mainElement) break;
    }

    // If no main content area found, use the body
    if (!mainElement) {
      mainElement = container;
    }

    // Extract headings and paragraphs with structure
    const elements = mainElement.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, code');
    
    elements.forEach(element => {
      const tagName = element.tagName.toLowerCase();
      const text = element.innerText.trim();
      
      if (text) {
        switch (tagName) {
          case 'h1':
            content += `\n# ${text}\n`;
            break;
          case 'h2':
            content += `\n## ${text}\n`;
            break;
          case 'h3':
            content += `\n### ${text}\n`;
            break;
          case 'h4':
          case 'h5':
          case 'h6':
            content += `\n#### ${text}\n`;
            break;
          case 'blockquote':
            content += `\n> ${text}\n`;
            break;
          case 'pre':
          case 'code':
            content += `\n\`\`\`\n${text}\n\`\`\`\n`;
            break;
          case 'li':
            content += `- ${text}\n`;
            break;
          default:
            content += `${text}\n\n`;
        }
      }
    });

    return content;
  }

  cleanContent(content) {
    // Remove excessive whitespace and empty lines
    content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
    content = content.replace(/^\s+|\s+$/g, '');
    
    // Limit content length to prevent API issues
    const maxLength = 8000; // Reasonable limit for API calls
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '\n\n[Content truncated...]';
    }
    
    return content;
  }

  extractSpecificContent(selector) {
    try {
      const elements = document.querySelectorAll(selector);
      let content = '';
      
      elements.forEach(element => {
        content += element.innerText.trim() + '\n\n';
      });
      
      return this.cleanContent(content);
    } catch (error) {
      console.error('Error extracting specific content:', error);
      return '';
    }
  }

  getPageMetadata() {
    try {
      const metadata = {
        title: document.title,
        url: window.location.href,
        domain: window.location.hostname,
        description: '',
        keywords: '',
        author: '',
        publishDate: '',
        language: document.documentElement.lang || 'en'
      };

      // Get meta description
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        metadata.description = metaDescription.content;
      }

      // Get meta keywords
      const metaKeywords = document.querySelector('meta[name="keywords"]');
      if (metaKeywords) {
        metadata.keywords = metaKeywords.content;
      }

      // Get author
      const metaAuthor = document.querySelector('meta[name="author"]');
      if (metaAuthor) {
        metadata.author = metaAuthor.content;
      }

      // Try to get publish date from various sources
      const dateSelectors = [
        'meta[property="article:published_time"]',
        'meta[name="publish_date"]',
        'meta[name="date"]',
        'time[datetime]',
        '.publish-date',
        '.date'
      ];

      for (const selector of dateSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          metadata.publishDate = element.getAttribute('content') || element.getAttribute('datetime') || element.innerText;
          break;
        }
      }

      return metadata;
    } catch (error) {
      console.error('Error getting page metadata:', error);
      return {
        title: document.title,
        url: window.location.href,
        domain: window.location.hostname
      };
    }
  }

  highlightText(text) {
    try {
      // Remove existing highlights
      this.removeHighlights();
      
      if (!text || text.trim() === '') return;

      // Create a tree walker to find text nodes
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const textNodes = [];
      let node;
      while (node = walker.nextNode()) {
        if (node.nodeValue.toLowerCase().includes(text.toLowerCase())) {
          textNodes.push(node);
        }
      }

      // Highlight matching text
      textNodes.forEach(textNode => {
        const parent = textNode.parentNode;
        if (parent && parent.tagName !== 'SCRIPT' && parent.tagName !== 'STYLE') {
          const regex = new RegExp(`(${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
          const highlightedHTML = textNode.nodeValue.replace(regex, '<mark class="gemini-lens-highlight">$1</mark>');
          
          if (highlightedHTML !== textNode.nodeValue) {
            const wrapper = document.createElement('span');
            wrapper.innerHTML = highlightedHTML;
            parent.replaceChild(wrapper, textNode);
          }
        }
      });

      // Add CSS for highlights if not already added
      this.addHighlightStyles();
    } catch (error) {
      console.error('Error highlighting text:', error);
    }
  }

  removeHighlights() {
    try {
      const highlights = document.querySelectorAll('.gemini-lens-highlight');
      highlights.forEach(highlight => {
        const parent = highlight.parentNode;
        parent.replaceChild(document.createTextNode(highlight.textContent), highlight);
        parent.normalize();
      });
    } catch (error) {
      console.error('Error removing highlights:', error);
    }
  }

  addHighlightStyles() {
    if (document.getElementById('gemini-lens-highlight-styles')) return;

    const style = document.createElement('style');
    style.id = 'gemini-lens-highlight-styles';
    style.textContent = `
      .gemini-lens-highlight {
        background-color: #0ea5e9 !important;
        color: white !important;
        padding: 2px 4px !important;
        border-radius: 3px !important;
        font-weight: bold !important;
        animation: gemini-lens-highlight-pulse 2s ease-in-out;
      }
      
      @keyframes gemini-lens-highlight-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
    `;
    document.head.appendChild(style);
  }

  scrollToElement(selector) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add a temporary highlight to the element
        element.style.outline = '3px solid #0ea5e9';
        element.style.outlineOffset = '2px';
        
        setTimeout(() => {
          element.style.outline = '';
          element.style.outlineOffset = '';
        }, 3000);
      }
    } catch (error) {
      console.error('Error scrolling to element:', error);
    }
  }
}

// Initialize content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new GeminiLensContent();
  });
} else {
  new GeminiLensContent();
}