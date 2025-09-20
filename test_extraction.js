// Test script for US News Computer Science rankings extraction
// This simulates the full user interaction flow to identify issues

const API_KEY = 'AIzaSyDiL-HkS2BuIqHVAcDCsLCKgUf6BevQywM';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.0-flash-exp';

// System prompt from sidepanel.js
const SYSTEM_PROMPT = [
  'You are a helpful, concise assistant embedded in a Chrome extension side panel.',
  'Always aim to complete the real-world task end-to-end using tools when needed.',
  'If the user asks to find/collect information on the web: 1) perform a search, 2) choose the user-specified site or the most relevant reputable result, 3) open it, 4) wait for the page to be ready if needed, 5) extract the requested information, 6) summarize it clearly in the chat, and include the source URL.',
  'Do not stop after the search. Continue with navigation and extraction steps until the information is obtained or blocked by a limitation.',
  'Use available browser tools when beneficial: searchWeb, listOpenTabs, openNewTab, switchToTabByTitle, closeCurrentTab; and page tools: waitForSelector, clickSelector, clickLinkByText, fillSelector, insertText, pressKey, focusSelector, selectOption, scrollTo, navigate, extractText, getLinksOnPage, getSearchResults, clickSearchResultByDomain.',
  'Operate safely: ask for approval when prompted, use minimal precise actions, and be transparent about what you did and any limitations. If an action fails, explain and suggest alternatives.',
  'Format equations and key expressions using LaTeX: use $...$ for inline math and $$...$$ or \\[...\\] for display math. Avoid full LaTeX document preambles; write concise text with math where helpful.'
].join('\n');

// Tool declarations (simplified version)
const TOOLS = {
  functionDeclarations: [
    {
      name: 'searchWeb',
      description: 'Open a search results page in a new tab (default Google). Returns newTabId.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          engine: { type: 'string', description: 'google|bing|duckduckgo', enum: ['google','bing','duckduckgo'] }
        },
        required: ['query']
      }
    },
    {
      name: 'getSearchResults',
      description: 'Parse the current search results page (Google/Bing/DuckDuckGo) and return the top organic results (title and href). Falls back to visible links if structure not recognized.',
      parameters: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'clickSearchResultByDomain',
      description: 'On a search results page, open the first organic result whose domain matches the provided domain (e.g., usnews.com). Decodes redirects and waits for navigation.',
      parameters: { type: 'object', properties: { domain: { type: 'string' } }, required: ['domain'] }
    },
    {
      name: 'waitForSelector',
      description: 'Wait until a selector exists in the DOM or timeout.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          timeoutMs: { type: 'number', description: 'Max wait time in ms (default 8000)' }
        },
        required: ['selector']
      }
    },
    {
      name: 'extractText',
      description: 'Extract concatenated text content from elements matching selector.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string', description: 'CSS selector(s)' } },
        required: []
      }
    }
  ]
};

class ExtensionTester {
  constructor() {
    this.conversationHistory = [];
    this.currentTabId = null;
    this.stepResults = [];
  }

  log(step, data) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, step, data };
    this.stepResults.push(logEntry);
    console.log(`[${timestamp}] ${step}:`, JSON.stringify(data, null, 2));
  }

  async makeGeminiRequest(messages, tools = null) {
    const url = `${API_BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;
    
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const payload = {
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192
      }
    };

    if (tools) {
      payload.tools = [tools];
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      this.log('GEMINI_RESPONSE', data);
      return data;
    } catch (error) {
      this.log('GEMINI_ERROR', { error: error.message });
      throw error;
    }
  }

  // Mock tool execution functions
  async mockSearchWeb(args) {
    this.log('TOOL_CALL', { name: 'searchWeb', args });
    // Simulate opening Google search
    this.currentTabId = 'mock-tab-123';
    return { ok: true, newTabId: this.currentTabId };
  }

  async mockGetSearchResults(args) {
    this.log('TOOL_CALL', { name: 'getSearchResults', args });
    // Mock search results that would appear for "US News Computer Science rankings"
    return {
      items: [
        {
          title: "Best Computer Science Programs - US News Rankings",
          href: "https://www.usnews.com/best-graduate-schools/top-science-schools/computer-science-rankings"
        },
        {
          title: "2024 Best Computer Science Colleges - US News",
          href: "https://www.usnews.com/best-colleges/rankings/engineering-doctorate-computer"
        },
        {
          title: "Top Computer Science Schools 2024 | US News Education",
          href: "https://www.usnews.com/education/best-graduate-schools/top-science-schools/computer-science-rankings"
        }
      ]
    };
  }

  async mockClickSearchResultByDomain(args) {
    this.log('TOOL_CALL', { name: 'clickSearchResultByDomain', args });
    if (args.domain === 'usnews.com') {
      return {
        ok: true,
        href: "https://www.usnews.com/best-graduate-schools/top-science-schools/computer-science-rankings",
        text: "Best Computer Science Programs - US News Rankings"
      };
    }
    return { ok: false };
  }

  async mockWaitForSelector(args) {
    this.log('TOOL_CALL', { name: 'waitForSelector', args });
    // Simulate successful wait
    return { ok: true };
  }

  async mockExtractText(args) {
    this.log('TOOL_CALL', { name: 'extractText', args });
    // Mock extracted text from US News CS rankings page
    const mockRankingsText = `
2024 Best Computer Science Programs

1. Massachusetts Institute of Technology
Cambridge, MA
Overall Score: 5.0

2. Stanford University
Stanford, CA
Overall Score: 4.9

3. Carnegie Mellon University
Pittsburgh, PA
Overall Score: 4.8

4. University of California--Berkeley
Berkeley, CA
Overall Score: 4.7

5. Harvard University
Cambridge, MA
Overall Score: 4.6

6. Princeton University
Princeton, NJ
Overall Score: 4.5

7. University of Washington
Seattle, WA
Overall Score: 4.4

8. Georgia Institute of Technology
Atlanta, GA
Overall Score: 4.3

9. University of Illinois--Urbana-Champaign
Urbana, IL
Overall Score: 4.2

10. California Institute of Technology
Pasadena, CA
Overall Score: 4.1

These rankings are based on expert opinions about program quality and statistical indicators that measure the quality of a school's faculty.
    `.trim();
    
    return { text: mockRankingsText };
  }

  async executeTool(name, args) {
    switch (name) {
      case 'searchWeb':
        return await this.mockSearchWeb(args);
      case 'getSearchResults':
        return await this.mockGetSearchResults(args);
      case 'clickSearchResultByDomain':
        return await this.mockClickSearchResultByDomain(args);
      case 'waitForSelector':
        return await this.mockWaitForSelector(args);
      case 'extractText':
        return await this.mockExtractText(args);
      default:
        this.log('UNKNOWN_TOOL', { name, args });
        return { error: `Unknown tool: ${name}` };
    }
  }

  extractFunctionCalls(candidate) {
    const calls = [];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.functionCall) {
          calls.push({
            name: part.functionCall.name,
            args: part.functionCall.args || {}
          });
        }
      }
    }
    return calls;
  }

  async runFullTest() {
    console.log('🚀 Starting US News Computer Science Rankings Extraction Test');
    console.log('=' .repeat(60));

    try {
      // Step 1: Initial user request
      const userMessage = "Extract the top 10 Computer Science universities from US News";
      this.conversationHistory.push({ role: 'user', content: userMessage });
      this.log('USER_REQUEST', { message: userMessage });

      let round = 1;
      const maxRounds = 10;

      while (round <= maxRounds) {
        console.log(`\n--- Round ${round} ---`);
        
        // Make request to Gemini with tools
        const response = await this.makeGeminiRequest(this.conversationHistory, TOOLS);
        
        if (!response.candidates || response.candidates.length === 0) {
          this.log('NO_CANDIDATES', response);
          break;
        }

        const candidate = response.candidates[0];
        
        // Check for function calls
        const functionCalls = this.extractFunctionCalls(candidate);
        
        if (functionCalls.length > 0) {
          this.log('FUNCTION_CALLS_DETECTED', functionCalls);
          
          // Execute each function call
          const functionResults = [];
          for (const call of functionCalls) {
            try {
              const result = await this.executeTool(call.name, call.args);
              functionResults.push({
                name: call.name,
                result: result
              });
              this.log('TOOL_RESULT', { tool: call.name, result });
            } catch (error) {
              this.log('TOOL_ERROR', { tool: call.name, error: error.message });
              functionResults.push({
                name: call.name,
                result: { error: error.message }
              });
            }
          }
          
          // Add function response to conversation
          const functionResponseParts = functionResults.map(fr => ({
            functionResponse: {
              name: fr.name,
              response: fr.result
            }
          }));
          
          this.conversationHistory.push({
            role: 'assistant',
            content: '', // Function calls don't have text content
            functionCalls: functionCalls
          });
          
          this.conversationHistory.push({
            role: 'user',
            content: '', // Function responses don't have text content  
            functionResponses: functionResults
          });
          
        } else {
          // Regular text response
          const text = candidate.content?.parts?.[0]?.text || '';
          this.log('TEXT_RESPONSE', { text });
          this.conversationHistory.push({ role: 'assistant', content: text });
          
          // If we got a final answer, we're done
          if (text.includes('Computer Science') && (text.includes('MIT') || text.includes('Stanford'))) {
            console.log('\n✅ SUCCESS: Got final rankings!');
            break;
          }
        }
        
        round++;
      }
      
      if (round > maxRounds) {
        console.log('\n⚠️  Reached maximum rounds without completion');
      }
      
    } catch (error) {
      this.log('TEST_ERROR', { error: error.message, stack: error.stack });
      console.error('❌ Test failed:', error);
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('📊 Test Summary:');
    console.log(`Total steps: ${this.stepResults.length}`);
    console.log(`Conversation length: ${this.conversationHistory.length}`);
    
    // Print final conversation
    console.log('\n📝 Final Conversation:');
    this.conversationHistory.forEach((msg, i) => {
      console.log(`${i + 1}. [${msg.role}] ${msg.content || '[Function call/response]'}`);
    });
    
    return this.stepResults;
  }
}

// Run the test
if (typeof window === 'undefined') {
  // Node.js environment
  const tester = new ExtensionTester();
  tester.runFullTest().then(results => {
    console.log('\n🏁 Test completed. Results saved to stepResults.');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Test crashed:', error);
    process.exit(1);
  });
} else {
  // Browser environment
  window.runExtractionTest = async function() {
    const tester = new ExtensionTester();
    return await tester.runFullTest();
  };
  console.log('Test loaded. Run window.runExtractionTest() to start.');
}