// Gemini Lens - Background Script

class GeminiLensBackground {
  constructor() {
    this.apiKey = '';
    this.conversations = new Map();
    this.init();
  }

  init() {
    this.setupEventListeners();
    this.loadSettings();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['apiKey']);
      this.apiKey = result.apiKey || '';
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  setupEventListeners() {
    // Handle messages from popup and content scripts
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep the message channel open for async response
    });

    // Handle extension installation
    chrome.runtime.onInstalled.addListener(() => {
      console.log('Gemini Lens extension installed');
    });

    // Handle tab updates for auto-analysis
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        await this.handleTabUpdate(tabId, tab);
      }
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      await this.loadSettings(); // Ensure we have the latest API key

      switch (request.action) {
        case 'analyzeContent':
          const analysisResult = await this.analyzeContent(request.content, request.url, request.title);
          sendResponse(analysisResult);
          break;

        case 'summarizeContent':
          const summaryResult = await this.summarizeContent(request.content, request.url, request.title);
          sendResponse(summaryResult);
          break;

        case 'chatMessage':
          const chatResult = await this.handleChatMessage(request.message, request.context, request.conversationId);
          sendResponse(chatResult);
          break;

        case 'getConversation':
          const conversation = this.conversations.get(request.conversationId) || [];
          sendResponse({ success: true, conversation });
          break;

        case 'clearConversation':
          this.conversations.delete(request.conversationId);
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleTabUpdate(tabId, tab) {
    try {
      const settings = await chrome.storage.sync.get(['autoMode']);
      if (!settings.autoMode) return;

      // Auto-analyze page if enabled
      // This could be implemented to automatically analyze pages
      console.log('Tab updated:', tab.url);
    } catch (error) {
      console.error('Error handling tab update:', error);
    }
  }

  async analyzeContent(content, url, title) {
    if (!this.apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    try {
      const prompt = `Please analyze the following web page content and provide key insights:

Page Title: ${title}
Page URL: ${url}

Content:
${content}

Please provide:
1. A brief summary of the main topic
2. Key points and insights
3. Important information or data mentioned
4. Any actionable items or recommendations

Keep your analysis concise but comprehensive.`;

      const response = await this.callGeminiAPI(prompt);
      
      if (response.success) {
        // Store the analysis in conversation history
        const conversationId = this.generateConversationId(url);
        this.addToConversation(conversationId, {
          type: 'analysis',
          content: response.content,
          timestamp: Date.now(),
          url,
          title
        });
      }

      return response;
    } catch (error) {
      console.error('Error analyzing content:', error);
      return { success: false, error: error.message };
    }
  }

  async summarizeContent(content, url, title) {
    if (!this.apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    try {
      const prompt = `Please provide a concise summary of the following web page:

Page Title: ${title}
Page URL: ${url}

Content:
${content}

Provide a clear, well-structured summary that captures the main points and essential information. Keep it informative but concise.`;

      const response = await this.callGeminiAPI(prompt);
      
      if (response.success) {
        // Store the summary in conversation history
        const conversationId = this.generateConversationId(url);
        this.addToConversation(conversationId, {
          type: 'summary',
          content: response.content,
          timestamp: Date.now(),
          url,
          title
        });
      }

      return response;
    } catch (error) {
      console.error('Error summarizing content:', error);
      return { success: false, error: error.message };
    }
  }

  async handleChatMessage(message, context, conversationId) {
    if (!this.apiKey) {
      return { success: false, error: 'API key not configured' };
    }

    try {
      // Build conversation history
      const conversation = this.conversations.get(conversationId) || [];
      let prompt = '';

      // Add context if provided
      if (context && context.url) {
        prompt += `Context: I'm currently viewing a web page titled "${context.title}" at ${context.url}.\n\n`;
        if (context.content) {
          prompt += `Page content summary:\n${context.content.substring(0, 1000)}...\n\n`;
        }
      }

      // Add conversation history
      if (conversation.length > 0) {
        prompt += 'Previous conversation:\n';
        conversation.slice(-5).forEach(msg => { // Last 5 messages for context
          if (msg.type === 'user') {
            prompt += `User: ${msg.content}\n`;
          } else if (msg.type === 'assistant') {
            prompt += `Assistant: ${msg.content}\n`;
          }
        });
        prompt += '\n';
      }

      prompt += `User: ${message}\n\nPlease provide a helpful and accurate response.`;

      const response = await this.callGeminiAPI(prompt);
      
      if (response.success) {
        // Add both user message and assistant response to conversation
        this.addToConversation(conversationId, {
          type: 'user',
          content: message,
          timestamp: Date.now()
        });
        
        this.addToConversation(conversationId, {
          type: 'assistant',
          content: response.content,
          timestamp: Date.now()
        });
      }

      return response;
    } catch (error) {
      console.error('Error handling chat message:', error);
      return { success: false, error: error.message };
    }
  }

  async callGeminiAPI(prompt) {
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + this.apiKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 2048,
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_MEDIUM_AND_ABOVE'
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const content = data.candidates[0].content.parts[0].text;
        return { success: true, content };
      } else {
        throw new Error('Invalid response format from Gemini API');
      }
    } catch (error) {
      console.error('Gemini API call failed:', error);
      
      // Provide more specific error messages
      let errorMessage = error.message;
      if (error.message.includes('API_KEY_INVALID')) {
        errorMessage = 'Invalid API key. Please check your Gemini API key in settings.';
      } else if (error.message.includes('QUOTA_EXCEEDED')) {
        errorMessage = 'API quota exceeded. Please check your Gemini API usage limits.';
      } else if (error.message.includes('403')) {
        errorMessage = 'Access denied. Please verify your API key has the necessary permissions.';
      } else if (error.message.includes('429')) {
        errorMessage = 'Rate limit exceeded. Please wait a moment before trying again.';
      }
      
      return { success: false, error: errorMessage };
    }
  }

  generateConversationId(url) {
    // Generate a conversation ID based on the URL
    return btoa(url).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  }

  addToConversation(conversationId, message) {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, []);
    }
    
    const conversation = this.conversations.get(conversationId);
    conversation.push(message);
    
    // Keep only the last 50 messages to prevent memory issues
    if (conversation.length > 50) {
      conversation.splice(0, conversation.length - 50);
    }
  }
}

// Initialize the background script
new GeminiLensBackground();