// Direct Chrome Extension Test Script
// This tests the actual extension functionality without external API calls

// Test configuration
const TEST_CONFIG = {
  query: "US News Computer Science rankings",
  targetDomain: "usnews.com",
  expectedSelectors: [
    ".ranking-item",
    ".school-name", 
    ".ranking-list",
    "[data-testid='ranking-item']",
    ".university-name",
    "h3", "h2", "h1"
  ]
};

class ExtensionFlowTester {
  constructor() {
    this.results = [];
    this.currentStep = 0;
  }

  log(step, data, success = true) {
    const timestamp = new Date().toISOString();
    const result = {
      step: ++this.currentStep,
      timestamp,
      action: step,
      data,
      success,
      url: window.location.href
    };
    this.results.push(result);
    console.log(`[${this.currentStep}] ${step}:`, success ? '✅' : '❌', data);
    return result;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Test the searchWeb tool
  async testSearchWeb() {
    try {
      this.log('TESTING_SEARCH_WEB', { query: TEST_CONFIG.query });
      
      // Simulate sending message to background script
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'executeTool',
          tool: 'searchWeb',
          args: { query: TEST_CONFIG.query, engine: 'google' }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      this.log('SEARCH_WEB_RESULT', response, response?.ok);
      return response;
    } catch (error) {
      this.log('SEARCH_WEB_ERROR', { error: error.message }, false);
      throw error;
    }
  }

  // Test the getSearchResults tool
  async testGetSearchResults() {
    try {
      this.log('TESTING_GET_SEARCH_RESULTS', {});
      
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'executeTool',
          tool: 'getSearchResults',
          args: {}
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      this.log('GET_SEARCH_RESULTS', response, response?.items?.length > 0);
      return response;
    } catch (error) {
      this.log('GET_SEARCH_RESULTS_ERROR', { error: error.message }, false);
      throw error;
    }
  }

  // Test the clickSearchResultByDomain tool
  async testClickSearchResultByDomain() {
    try {
      this.log('TESTING_CLICK_SEARCH_RESULT_BY_DOMAIN', { domain: TEST_CONFIG.targetDomain });
      
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'executeTool',
          tool: 'clickSearchResultByDomain',
          args: { domain: TEST_CONFIG.targetDomain }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      this.log('CLICK_SEARCH_RESULT_RESULT', response, response?.ok);
      return response;
    } catch (error) {
      this.log('CLICK_SEARCH_RESULT_ERROR', { error: error.message }, false);
      throw error;
    }
  }

  // Test waitForSelector tool
  async testWaitForSelector(selector) {
    try {
      this.log('TESTING_WAIT_FOR_SELECTOR', { selector });
      
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'executeTool',
          tool: 'waitForSelector',
          args: { selector, timeoutMs: 5000 }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      this.log('WAIT_FOR_SELECTOR_RESULT', { selector, response }, response?.ok);
      return response;
    } catch (error) {
      this.log('WAIT_FOR_SELECTOR_ERROR', { selector, error: error.message }, false);
      throw error;
    }
  }

  // Test extractText tool
  async testExtractText(selector = '') {
    try {
      this.log('TESTING_EXTRACT_TEXT', { selector });
      
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'executeTool',
          tool: 'extractText',
          args: { selector }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      const hasText = response?.text && response.text.length > 100;
      this.log('EXTRACT_TEXT_RESULT', { 
        selector, 
        textLength: response?.text?.length || 0,
        preview: response?.text?.substring(0, 200) + '...' || 'No text'
      }, hasText);
      return response;
    } catch (error) {
      this.log('EXTRACT_TEXT_ERROR', { selector, error: error.message }, false);
      throw error;
    }
  }

  // Test the full flow
  async runFullFlow() {
    console.log('🚀 Starting Extension Flow Test');
    console.log('=' .repeat(60));
    
    try {
      // Step 1: Search for US News CS rankings
      const searchResult = await this.testSearchWeb();
      if (!searchResult?.ok) {
        throw new Error('Search failed');
      }
      
      await this.delay(2000); // Wait for search page to load
      
      // Step 2: Get search results
      const searchResults = await this.testGetSearchResults();
      if (!searchResults?.items?.length) {
        throw new Error('No search results found');
      }
      
      // Step 3: Click on US News result
      const clickResult = await this.testClickSearchResultByDomain();
      if (!clickResult?.ok) {
        throw new Error('Failed to click US News result');
      }
      
      await this.delay(3000); // Wait for US News page to load
      
      // Step 4: Test various selectors to find rankings
      let extractSuccess = false;
      for (const selector of TEST_CONFIG.expectedSelectors) {
        try {
          // First wait for the selector
          const waitResult = await this.testWaitForSelector(selector);
          if (waitResult?.ok) {
            // Then try to extract text
            const extractResult = await this.testExtractText(selector);
            if (extractResult?.text && extractResult.text.length > 100) {
              extractSuccess = true;
              this.log('SUCCESSFUL_EXTRACTION', {
                selector,
                textLength: extractResult.text.length,
                containsRankings: extractResult.text.includes('MIT') || extractResult.text.includes('Stanford')
              });
              break;
            }
          }
        } catch (error) {
          this.log('SELECTOR_FAILED', { selector, error: error.message }, false);
        }
        
        await this.delay(500);
      }
      
      // Step 5: Fallback - try extracting without selector
      if (!extractSuccess) {
        this.log('TRYING_FALLBACK_EXTRACTION', {});
        const fallbackResult = await this.testExtractText();
        if (fallbackResult?.text) {
          extractSuccess = true;
          this.log('FALLBACK_EXTRACTION_SUCCESS', {
            textLength: fallbackResult.text.length,
            containsRankings: fallbackResult.text.includes('MIT') || fallbackResult.text.includes('Stanford')
          });
        }
      }
      
      this.log('FLOW_COMPLETED', { success: extractSuccess }, extractSuccess);
      
    } catch (error) {
      this.log('FLOW_ERROR', { error: error.message, stack: error.stack }, false);
    }
    
    // Print summary
    console.log('\n' + '=' .repeat(60));
    console.log('📊 Test Results Summary:');
    console.log(`Total steps: ${this.results.length}`);
    console.log(`Successful steps: ${this.results.filter(r => r.success).length}`);
    console.log(`Failed steps: ${this.results.filter(r => !r.success).length}`);
    
    console.log('\n📝 Detailed Results:');
    this.results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} [${result.step}] ${result.action}`);
      if (!result.success || result.action.includes('ERROR')) {
        console.log(`   Error: ${JSON.stringify(result.data)}`);
      }
    });
    
    return this.results;
  }

  // Test individual components
  async testCurrentPage() {
    console.log('🔍 Testing Current Page Capabilities');
    console.log('Current URL:', window.location.href);
    
    // Test if we can extract any text
    const extractResult = await this.testExtractText();
    
    // Test if we can find common selectors
    const commonSelectors = ['h1', 'h2', 'h3', '.title', '#content', 'main', 'article'];
    for (const selector of commonSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        this.log('SELECTOR_TEST', {
          selector,
          found: elements.length,
          hasText: elements.length > 0 && elements[0].textContent.trim().length > 0
        }, elements.length > 0);
      } catch (error) {
        this.log('SELECTOR_ERROR', { selector, error: error.message }, false);
      }
    }
    
    return this.results;
  }
}

// Make it available globally
window.ExtensionFlowTester = ExtensionFlowTester;

// Auto-run if in extension context
if (typeof chrome !== 'undefined' && chrome.runtime) {
  console.log('🎯 Extension context detected. Test functions available:');
  console.log('- window.runFullFlowTest() - Test complete flow');
  console.log('- window.testCurrentPage() - Test current page only');
  
  window.runFullFlowTest = async function() {
    const tester = new ExtensionFlowTester();
    return await tester.runFullFlow();
  };
  
  window.testCurrentPage = async function() {
    const tester = new ExtensionFlowTester();
    return await tester.testCurrentPage();
  };
  
} else {
  console.log('⚠️  Not in extension context. Load this in the extension sidepanel or content script.');
}