// Background service worker (module)
// Handles Gemini API calls, tool execution, and message routing

const STATE = {
  apiKey: null,
  model: 'gemini-2.5-flash-lite',
  perSitePermissions: {},
  autoApprove: true,
  maxToolRounds: 8,
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-gemini',
    title: 'Ask Gemini',
    contexts: ['selection', 'page']
  });
});

chrome.storage.sync.get(['geminiApiKey', 'geminiModel', 'perSitePermissions', 'autoApproveTools', 'maxToolRounds'], (res) => {
  STATE.apiKey = res.geminiApiKey || null;
  STATE.model = res.geminiModel || 'gemini-2.5-flash-lite';
  STATE.perSitePermissions = res.perSitePermissions || {};
  STATE.autoApprove = !!res.autoApproveTools;
  STATE.maxToolRounds = res.maxToolRounds || 15;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.geminiApiKey) STATE.apiKey = changes.geminiApiKey.newValue || null;
    if (changes.geminiModel) STATE.model = changes.geminiModel.newValue || 'gemini-2.5-flash-lite';
    if (changes.perSitePermissions) STATE.perSitePermissions = changes.perSitePermissions.newValue || {};
    if (changes.autoApproveTools) STATE.autoApprove = !!changes.autoApproveTools.newValue;
    if (changes.maxToolRounds) STATE.maxToolRounds = changes.maxToolRounds.newValue || 15;
  }
});

function getOrigin(url) {
  try { return new URL(url).origin; } catch { return '*'; }
}

function ensureSitePermission(origin) {
  const allowed = STATE.perSitePermissions[origin];
  if (allowed) return Promise.resolve(true);
  return new Promise((resolve) => {
    chrome.notifications?.create?.(
      '',
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon.svg'),
        title: 'Gemini needs permission',
        message: `Allow Gemini to read and assist on ${origin}?`
      },
      () => {}
    );
    // Fallback simple confirm via side panel prompt flow; here we auto-allow for MVP and rely on options page later
    STATE.perSitePermissions[origin] = true;
    chrome.storage.sync.set({ perSitePermissions: STATE.perSitePermissions });
    resolve(true);
  });
}

// Background-managed tool names
const BACKGROUND_TOOLS = new Set([
  'openNewTab',
  'closeCurrentTab',
  'switchToTabByTitle',
  'searchWeb',
  'listOpenTabs',
  // Google apps creation actions are background tools (they open new tabs)
  'gdocsCreateDocument',
  'gsheetsCreateSpreadsheet'
]);

// Messaging router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'OPEN_SIDE_PANEL': {
        if (sender.tab?.id) {
          await chrome.sidePanel.open({ tabId: sender.tab.id });
          await chrome.sidePanel.setOptions({ tabId: sender.tab.id, path: 'sidepanel.html' });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'ASK_GEMINI': {
        let tabId = sender.tab?.id;
        if (!tabId) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = activeTab?.id;
        }
        if (!tabId) {
          console.error("ASK_GEMINI: Could not determine active tabId.");
          chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', chunk: { text: "Error: Could not determine active tab for tool execution." } });
          chrome.runtime.sendMessage({ type: 'STREAM_DONE' });
          sendResponse({ ok: false, error: "Could not determine active tabId." });
          break;
        }
        const tab = sender.tab || (tabId ? await chrome.tabs.get(tabId) : undefined);
        const origin = getOrigin(tab?.url || '*');
        await ensureSitePermission(origin);
        // Prefer tool-calling loop to match Claude-like behavior
        const result = await generateWithToolsLoop(msg.payload || {}, tabId);
        if (result?.error) {
          chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', chunk: { text: `Error: ${result.error}` } });
          chrome.runtime.sendMessage({ type: 'STREAM_DONE' });
        } else {
          chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', chunk: { text: result.text || '' } });
          chrome.runtime.sendMessage({ type: 'STREAM_DONE' });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'EXECUTE_TOOL': {
        const result = await executeTool(msg.tool, msg.args, sender.tab?.id);
        sendResponse({ ok: true, result });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true; // keep port open for async
});

// Context menu -> open side panel and prefill with selection
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'ask-gemini' && tab?.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
    await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html' });
    chrome.runtime.sendMessage({ type: 'PREFILL_SELECTION', text: info.selectionText || '' });
  }
});

// Simple Gemini REST client with streaming support
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function* generateContentStream({ messages, system, tools, config }) {
  if (!STATE.apiKey) {
    yield { error: 'Missing API key. Set it in options.' };
    return;
  }
  const model = STATE.model || 'gemini-2.0-flash';
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(STATE.apiKey)}`;

  const contents = [];
  for (const m of messages || []) {
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }

  const body = {
    contents,
    tools,
    systemInstruction: system ? { role: 'user', parts: [{ text: system }] } : undefined,
    generationConfig: config || { temperature: 0.7, topP: 0.95 },
    safetySettings: [
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
    ]
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    yield { error: `API error ${resp.status}: ${text}` };
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) yield { text };
        const toolReqs = json.candidates?.[0]?.content?.parts?.filter(p => p.functionCall);
        if (toolReqs && toolReqs.length) yield { toolCalls: toolReqs.map(p => p.functionCall) };
      } catch {}
    }
  }
}


async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['contentScript.js'],
    });
  } catch (e) {
    console.error("Failed to inject content script", e);
  }
}

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
      clearTimeout(timer);
    };
    const onUpdated = (id, info, tab) => {
      if (id === tabId && info.status === 'complete') {
        cleanup();
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Immediate check in case it's already complete
    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab && tab.status === 'complete') {
        cleanup();
        resolve(true);
      }
    });
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
  });
}

async function waitForUrlChange(tabId, { previousUrl, targetUrl, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => {
      if (done) return;
      done = true;
      try { chrome.tabs.onUpdated.removeListener(onUpdated); } catch {}
      clearTimeout(timer);
    };
    const normalize = (u) => {
      try { const x = new URL(u); x.hash = ''; return x.toString(); } catch { return u || ''; }
    };
    const prev = normalize(previousUrl);
    const target = targetUrl ? normalize(targetUrl) : null;
    const onUpdated = (id, info, tab) => {
      if (id !== tabId || !info.url) return;
      const now = normalize(info.url);
      if (target) {
        // More flexible URL matching - check if URLs are similar or if it's a redirect
        try {
          const targetHost = new URL(target).hostname;
          if (now.startsWith(target) || target.startsWith(now) || 
              now.includes(targetHost) || new URL(now).hostname === targetHost) { 
            cleanup(); resolve(true); 
          }
        } catch {
          // Fallback to simple string matching if URL parsing fails
          if (now.startsWith(target) || target.startsWith(now)) {
            cleanup(); resolve(true);
          }
        }
      } else {
        if (now && now !== prev) { cleanup(); resolve(true); }
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
  });
}

// Tool execution via content script
async function extractTextAllFrames(tabId, selector) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (selector) => {
        function isVisible(el) {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        
        let text = '';
        
        // Strategy 1: Use provided selector
        if (selector) {
          const nodes = Array.from(document.querySelectorAll(selector)).filter(isVisible);
          text = nodes.map(e => (e.innerText || e.textContent || '').trim()).filter(Boolean).join('\n');
        }
        
        // Strategy 2: Try semantic containers
        if (!text || text.length < 300) {
          const semanticSelectors = [
            'article', 'main', '[role="main"]',
            '.content', '.post-content', '.entry-content', '.article-content',
            '#content', '#main-content'
          ];
          
          for (const sel of semanticSelectors) {
            const container = document.querySelector(sel);
            if (container && isVisible(container)) {
              const containerText = (container.innerText || container.textContent || '').trim();
              if (containerText && containerText.length > text.length) {
                text = containerText;
                break;
              }
            }
          }
        }
        
        // Strategy 3: Comprehensive content extraction
        if (!text || text.length < 300) {
          const contentSelectors = [
            'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'li', 'blockquote', 'pre', 'code',
            '.text', '.description', '.summary',
            '[class*="content"]', '[class*="text"]'
          ];
          
          const nodes = [];
          for (const sel of contentSelectors) {
            const elements = Array.from(document.querySelectorAll(sel))
              .filter(el => {
                if (!isVisible(el)) return false;
                const elText = (el.innerText || el.textContent || '').trim();
                return elText.length > 10 && elText.length < 2000;
              })
              .slice(0, 100); // Limit to prevent performance issues
            nodes.push(...elements);
          }
          
          // Remove nested elements
          const uniqueNodes = nodes.filter((node, index) => {
            for (let i = 0; i < index; i++) {
              if (nodes[i].contains(node)) return false;
            }
            return true;
          });
          
          const fallbackText = uniqueNodes
            .map(e => (e.innerText || e.textContent || '').trim())
            .filter(t => t.length > 10)
            .join('\n');
            
          if (fallbackText && fallbackText.length > text.length) {
            text = fallbackText;
          }
        }
        
        // Strategy 4: Last resort - body text with filtering
        if (!text || text.length < 200) {
          const bodyText = document.body.innerText || document.body.textContent || '';
          if (bodyText.trim().length > text.length) {
            const lines = bodyText.split('\n')
              .map(line => line.trim())
              .filter(line => {
                if (line.length < 10) return false;
                const navPatterns = /^(home|about|contact|menu|search|login|register|sign in|sign up|navigation|header|footer)$/i;
                return !navPatterns.test(line);
              });
            const filteredText = lines.join('\n');
            if (filteredText.length > text.length) {
              text = filteredText;
            }
          }
        }
        
        return { text: text.replace(/\n{3,}/g, '\n\n').trim() };
      },
      args: [selector]
    });
    
    // Combine results from all frames, keeping the longest/best content
    let best = '';
    const allTexts = [];
    
    for (const r of results || []) {
      const frameText = r?.result?.text || '';
      if (frameText && frameText.length > 50) {
        allTexts.push(frameText);
        if (frameText.length > best.length) {
          best = frameText;
        }
      }
    }
    
    // If we have multiple substantial texts from different frames, combine them
    if (allTexts.length > 1) {
      const combinedText = allTexts.join('\n\n---\n\n');
      if (combinedText.length > best.length * 1.2) {
        best = combinedText;
      }
    }
    
    return { text: best };
  } catch (e) {
    console.warn('extractTextAllFrames failed:', e);
    return { text: '' };
  }
}
async function executeTool(name, args, tabId) {
  if (!tabId) {
    console.error("executeTool: Missing tabId, cannot execute tool.");
    return { error: "Missing tabId for tool execution." };
  }
  if (BACKGROUND_TOOLS.has(name)) {
    return await handleBackgroundTool(name, args, tabId);
  }
  await ensureContentScript(tabId);
  // Capture current URL in case of SPA navigation
  let beforeUrl = null;
  try {
    const t = await chrome.tabs.get(tabId);
    beforeUrl = t?.url || null;
  } catch {}
  const result = await new Promise((resolve) => {
    const msg = { type: 'EXECUTE_TOOL', name, args };
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      resolve(res?.result ?? null);
    });
  });
  // Enhanced fallback: if extractText returned little or nothing, try multiple strategies
  if (name === 'extractText') {
    const currentText = result?.text || '';
    if (!currentText || currentText.length < 300) {
      // Strategy 1: Try all-frames extraction
      const fallback = await extractTextAllFrames(tabId, args?.selector);
      if ((fallback?.text || '').length > currentText.length) {
        return { text: fallback.text };
      }
      
      // Strategy 2: If still insufficient, try with scroll enabled
      if ((!args?.scroll) && (!fallback?.text || fallback.text.length < 500)) {
        const scrollResult = await new Promise((resolve) => {
          const msg = { type: 'EXECUTE_TOOL', name: 'extractText', args: { ...args, scroll: true } };
          chrome.tabs.sendMessage(tabId, msg, (res) => {
            resolve(res?.result ?? null);
          });
        });
        
        if (scrollResult?.text && scrollResult.text.length > Math.max(currentText.length, fallback?.text?.length || 0)) {
          return { text: scrollResult.text };
        }
      }
      
      // Strategy 3: Try different selectors as last resort
      if (!fallback?.text || fallback.text.length < 200) {
        const alternativeSelectors = [
          'body *:not(script):not(style):not(nav):not(header):not(footer)',
          '[class*="content"], [id*="content"], [class*="text"], [id*="text"]',
          'div, p, span, article, section'
        ];
        
        for (const altSelector of alternativeSelectors) {
          const altResult = await extractTextAllFrames(tabId, altSelector);
          if (altResult?.text && altResult.text.length > Math.max(currentText.length, fallback?.text?.length || 0)) {
            return { text: altResult.text };
          }
        }
      }
    }
  }
  // If this action likely triggered navigation, wait for load or URL change and re-inject
  try {
    if (name === 'navigate' && result?.ok) {
      const target = args?.url;
      const changed = await waitForUrlChange(tabId, { previousUrl: beforeUrl, targetUrl: target, timeoutMs: 20000 });
      if (!changed) await waitForTabComplete(tabId, 20000);
      // Additional wait for dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 2000));
      await ensureContentScript(tabId);
    }
    if (name === 'clickLinkByText' && result?.href && !String(result.href).startsWith('#') && !String(result.href).startsWith('javascript:')) {
      const changed = await waitForUrlChange(tabId, { previousUrl: beforeUrl, targetUrl: result.href, timeoutMs: 20000 });
      if (!changed) await waitForTabComplete(tabId, 20000);
      await ensureContentScript(tabId);
    }
    if (name === 'clickSearchResultByDomain' && result?.href && !String(result.href).startsWith('#') && !String(result.href).startsWith('javascript:')) {
      const changed = await waitForUrlChange(tabId, { previousUrl: beforeUrl, targetUrl: result.href, timeoutMs: 20000 });
      if (!changed) await waitForTabComplete(tabId, 20000);
      // brief delay for dynamic content
      await new Promise(resolve => setTimeout(resolve, 1500));
      await ensureContentScript(tabId);
    }
  } catch (e) {
    console.warn('Post-tool navigation handling error:', e);
  }
  return result;
}

// Background tool handlers
async function handleBackgroundTool(name, args, tabId) {
  switch (name) {
    case 'openNewTab': {
      const url = args?.url;
      if (!url) return { error: 'Missing url' };
      const tab = await chrome.tabs.create({ url, active: true });
      await waitForTabComplete(tab.id, 20000);
      await ensureContentScript(tab.id);
      return { ok: true, newTabId: tab.id };
    }
    case 'closeCurrentTab': {
      if (!tabId) return { error: 'Missing tabId' };
      try {
        await chrome.tabs.remove(tabId);
        return { ok: true, closedTabId: tabId };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    }
    case 'switchToTabByTitle': {
      const q = (args?.query || '').toLowerCase();
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const match = tabs.find(t => (t.title || '').toLowerCase().includes(q));
      if (!match?.id) return { error: 'No matching tab' };
      await chrome.tabs.update(match.id, { active: true });
      await ensureContentScript(match.id);
      return { ok: true, newTabId: match.id };
    }
    case 'searchWeb': {
      const query = args?.query;
      const engine = (args?.engine || 'google').toLowerCase();
      if (!query) return { error: 'Missing query' };
      const map = {
        google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
        bing: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
        duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
      };
      const url = (map[engine] || map.google)(query);
      const tab = await chrome.tabs.create({ url, active: true });
      await waitForTabComplete(tab.id, 20000);
      await ensureContentScript(tab.id);
      return { ok: true, newTabId: tab.id };
    }
    case 'listOpenTabs': {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return { tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url })) };
    }
    case 'gdocsCreateDocument': {
      const tab = await chrome.tabs.create({ url: 'https://docs.new', active: true });
      await waitForTabComplete(tab.id, 30000);
      await ensureContentScript(tab.id);
      return { ok: true, newTabId: tab.id };
    }
    case 'gsheetsCreateSpreadsheet': {
      const tab = await chrome.tabs.create({ url: 'https://sheets.new', active: true });
      await waitForTabComplete(tab.id, 30000);
      await ensureContentScript(tab.id);
      return { ok: true, newTabId: tab.id };
    }
    default:
      return { error: 'Unknown background tool' };
  }
}

function getToolDeclarations() {
  const base = [
    {
      functionDeclarations: [
        {
          name: 'scrollTo',
          description: 'Scroll the page to a vertical position in pixels.',
          parameters: {
            type: 'object',
            properties: { y: { type: 'number', description: 'Vertical position in pixels' } },
            required: ['y']
          }
        },
        {
          name: 'clickSelector',
          description: 'Click the first element matching a CSS selector.',
          parameters: {
            type: 'object',
            properties: { selector: { type: 'string', description: 'CSS selector' } },
            required: ['selector']
          }
        },
        {
          name: 'fillSelector',
          description: 'Type text into an input/textarea matching a CSS selector.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string', description: 'CSS selector' },
              value: { type: 'string', description: 'Text to fill' }
            },
            required: ['selector', 'value']
          }
        },
        {
          name: 'extractText',
          description: 'Extract concatenated text content from elements matching selector. For comprehensive content extraction (like rankings, lists, articles), use scroll=true to capture all content beyond the visible viewport.',
          parameters: {
            type: 'object',
            properties: { 
              selector: { type: 'string', description: 'CSS selector(s)' },
              scroll: { type: 'boolean', description: 'Whether to scroll through the page to capture all content (recommended for rankings, lists, full articles)' }
            },
            required: []
          }
        },
        {
          name: 'autoExtractAfterNavigation',
          description: 'Automated workflow: waits for page load, validates relevance to user query, then extracts content. Use this after clicking a search result.',
          parameters: {
            type: 'object',
            properties: {
              userQuery: {
                type: 'string',
                description: 'The original user query to validate page relevance'
              },
              method: {
                type: 'string',
                enum: ['clean', 'text', 'html', 'full', 'structured'],
                description: 'Extraction method: clean (default, removes ads/nav), text (plain text), html (body HTML), full (entire page), structured (JSON format)'
              }
            },
            required: ['userQuery']
          }
        },
        {
          name: 'getAllContent',
          description: 'Simple and fast way to get all content from the current website. Much easier than extractText for getting complete page content.',
          parameters: {
            type: 'object',
            properties: {
              method: {
                type: 'string',
                description: 'Extraction method: "text" (simple text), "html" (raw HTML), "full" (complete page HTML), "clean" (cleaned text), "structured" (headings/paragraphs)',
                enum: ['text', 'html', 'full', 'clean', 'structured']
              }
            },
            required: []
          }
        },
        {
          name: 'navigate',
          description: 'Navigate the current tab to a new URL.',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: 'Absolute URL to navigate to' } },
            required: ['url']
          }
        },
        // New page automation helpers (content-script)
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
          name: 'clickLinkByText',
          description: 'Click the first link whose visible text contains the given text.',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string', description: 'Case-insensitive substring to match' } },
            required: ['text']
          }
        },
        {
          name: 'pressKey',
          description: 'Press a keyboard key on the active element (e.g., Enter).',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Key value (e.g., Enter, Escape)' },
              ctrl: { type: 'boolean' },
              meta: { type: 'boolean' },
              alt: { type: 'boolean' },
              shift: { type: 'boolean' }
            },
            required: ['key']
          }
        },
        {
          name: 'focusSelector',
          description: 'Focus an element matched by selector.',
          parameters: {
            type: 'object',
            properties: { selector: { type: 'string' } },
            required: ['selector']
          }
        },
        {
          name: 'selectOption',
          description: 'Choose an option in a <select> by value or label.',
          parameters: {
            type: 'object',
            properties: {
              selector: { type: 'string' },
              value: { type: 'string', description: 'Option value' },
              label: { type: 'string', description: 'Option label text' }
            },
            required: ['selector']
          }
        },
        {
          name: 'insertText',
          description: 'Insert text at the current cursor position or active input/textarea/contenteditable.',
          parameters: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text']
          }
        },
        {
          name: 'getLinksOnPage',
          description: 'Return a list of visible links (text and href) on the current page.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'getSearchResults',
          description: 'Parse the current search results page (Google/Bing/DuckDuckGo) and return the top organic results (title and href). Falls back to visible links if structure not recognized.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'clickSearchResultByDomain',
          description: 'CRITICAL: On a search results page, click the first organic result whose domain matches the provided domain. ONLY use domains that appear in the search results from getSearchResults. Examples: usnews.com, wikipedia.org, cnn.com. This prevents random navigation by ensuring you click actual search results.',
          parameters: { 
            type: 'object', 
            properties: { 
              domain: { 
                type: 'string',
                description: 'Domain name that MUST be from the search results (e.g., usnews.com, wikipedia.org). Use getSearchResults first to see available domains.'
              } 
            }, 
            required: ['domain'] 
          }
        },
        // Background-managed (browser) tools
        {
          name: 'openNewTab',
          description: 'Open a new tab with the given URL and activate it. Returns the newTabId.',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string' } },
            required: ['url']
          }
        },
        {
          name: 'closeCurrentTab',
          description: 'Close the current tab executing the conversation.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'switchToTabByTitle',
          description: 'Activate a tab in the current window by matching a substring of its title (case-insensitive). Returns newTabId.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'Substring to match in the tab title' } },
            required: ['query']
          }
        },
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
          name: 'listOpenTabs',
          description: 'List the open tabs in the current window (id, title, url).',
          parameters: { type: 'object', properties: {}, required: [] }
        }
      ]
    }
  ];
  const gtools = [
    {
      functionDeclarations: [
        {
          name: 'gdocsCreateDocument',
          description: 'Open a new Google Doc (docs.new) in a new tab and focus it.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'gdocsInsertText',
          description: 'Type text into the current Google Docs editor at the cursor position.',
          parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
        },
        {
          name: 'gdocsBoldSelection',
          description: 'Toggle bold on the current selection in Google Docs.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'gsheetsCreateSpreadsheet',
          description: 'Open a new Google Sheet (sheets.new) in a new tab and focus it.',
          parameters: { type: 'object', properties: {}, required: [] }
        },
        {
          name: 'gsheetsSetCell',
          description: 'Set the value of the current cell (or a specified cell A1) in Google Sheets.',
          parameters: { type: 'object', properties: { value: { type: 'string' }, a1: { type: 'string', description: 'Optional A1 address (e.g., A1, B2)' } }, required: ['value'] }
        }
      ]
    }
  ];
  return base.concat(gtools);
}


function buildContentsFromMessages(messages = [], system) {
  const contents = [];
  for (const m of messages) {
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }
  const systemInstruction = system
    ? { role: 'user', parts: [{ text: system }] }
    : undefined;
  return { contents, systemInstruction };
}

function extractTextFromCandidate(candidate) {
  if (!candidate) return '';
  const parts = candidate.content?.parts || candidate.parts || [];
  let out = '';
  for (const p of parts) if (p.text) out += p.text;
  return out;
}

function getFunctionCallsFromCandidate(candidate) {
  const parts = candidate?.content?.parts || candidate?.parts || [];
  const calls = [];
  for (const p of parts) {
    if (p.functionCall) {
      const name = p.functionCall.name;
      const args = typeof p.functionCall.args === 'string' ? safelyParseJSON(p.functionCall.args) : (p.functionCall.args || {});
      calls.push({ name, args });
    }
  }
  return calls;
}

function makeFunctionResponseParts(nameToResultArray) {
  const parts = [];
  for (const { name, result } of nameToResultArray) {
    const safe = truncateDeep(result, { maxChars: 2000, maxArray: 30, maxKeys: 30 });
    parts.push({ functionResponse: { name, response: safe } });
  }
  return parts;
}

function safelyParseJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

// Deeply truncate large tool results to keep context within budget
function truncateDeep(value, { maxChars = 1500, maxArray = 50, maxKeys = 50 } = {}) {
  const seen = new WeakSet();
  function trunc(v) {
    if (v == null) return v;
    if (typeof v === 'string') {
      return v.length > maxChars ? v.slice(0, maxChars) + `… [truncated ${v.length - maxChars} chars]` : v;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'function') return '[function]';
    if (typeof v === 'object') {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (Array.isArray(v)) {
        const out = v.slice(0, maxArray).map(trunc);
        if (v.length > maxArray) out.push(`… [${v.length - maxArray} more items truncated]`);
        return out;
      }
      const keys = Object.keys(v).slice(0, maxKeys);
      const out = {};
      for (const k of keys) out[k] = trunc(v[k]);
      if (Object.keys(v).length > maxKeys) out.__truncated__ = `… [${Object.keys(v).length - maxKeys} more keys truncated]`;
      return out;
    }
    return String(v);
  }
  return trunc(value);
}

function waitForMessageOnce(predicate, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('Timed out waiting for response'));
    }, timeoutMs);
    function handler(msg, sender) {
      try {
        if (predicate(msg, sender)) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(handler);
          resolve(msg);
        }
      } catch (e) {
        // ignore
      }
    }
    chrome.runtime.onMessage.addListener(handler);
  });
}

// Limit total characters sent to Gemini to decrease likelihood of 500 INTERNAL errors
function estimateContentChars(contents = []) {
  let sum = 0;
  for (const c of contents) {
    const parts = c.parts || c.content?.parts || [];
    for (const p of parts) if (typeof p.text === 'string') sum += p.text.length;
  }
  return sum;
}

function trimContents(contents = [], maxChars = 12000) {
  if (estimateContentChars(contents) <= maxChars) return contents;
  const kept = [];
  // Keep most recent messages first while staying under limit
  for (let i = contents.length - 1; i >= 0; i--) {
    kept.unshift(contents[i]);
    if (estimateContentChars(kept) > maxChars) {
      kept.shift();
      break;
    }
  }
  return kept;
}

async function summarizeHistoryText(headContents) {
  try {
    const sys = 'You are a concise conversation summarizer. Summarize the following chat history into <= 10 bullet points, preserving key decisions, URLs, and user preferences. Avoid repetition. Max 1200 characters.';
    // Flatten to plain text for summarization
    const text = headContents
      .map(c => {
        const role = c.role || 'user';
        const parts = c.parts || c.content?.parts || [];
        const t = parts.map(p => p.text).filter(Boolean).join('\n');
        return `${role.toUpperCase()}: ${t}`;
      })
      .join('\n\n');
    const res = await generateContentOnce({
      messages: [{ role: 'user', content: text }],
      system: sys,
      config: { temperature: 0.2, topP: 0.9, maxOutputTokens: 320 }
    });
    return (res?.text || '').slice(0, 1200);
  } catch (e) {
    return 'Summary unavailable due to error.';
  }
}

async function compressIfNeeded(contents, maxChars = 12000) {
  if (estimateContentChars(contents) <= maxChars) return contents;
  let tailCount = Math.min(contents.length, 8);
  while (tailCount > 2) {
    const head = contents.slice(0, contents.length - tailCount);
    const tail = contents.slice(contents.length - tailCount);
    const summary = await summarizeHistoryText(head);
    const newContents = [
      { role: 'user', parts: [{ text: `Conversation summary (compressed):\n${summary}` }] },
      ...tail
    ];
    if (estimateContentChars(newContents) <= maxChars) return newContents;
    tailCount -= 2; // keep fewer tail messages and retry
  }
  // As last resort, hard trim
  return trimContents(contents, maxChars);
}

// Simple Gemini REST client one-shot (retry-enabled)
async function generateContentOnce({ messages, system, tools, config }) {
  const model = STATE.model || 'gemini-2.0-flash';
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(STATE.apiKey)}`;
  const contents = [];
  if (system) contents.push({ role: 'user', parts: [{ text: `SYSTEM:${system}` }] });
  for (const m of messages || []) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  const body = { contents, tools, generationConfig: config };
  const resp = await fetchWithRetry(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { retries: 2, baseDelay: 600 });
  if (!resp.ok) {
    const text = await resp.text();
    return { text: '', raw: { error: `API error ${resp.status}: ${text}` } };
  }
  const json = await resp.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text, raw: json };
}

async function requestToolApproval(calls, tabId) {
  if (STATE.autoApprove) return true;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  chrome.runtime.sendMessage({ type: 'REQUEST_TOOL_APPROVAL', id, calls });
  try {
    const res = await waitForMessageOnce((msg) => msg?.type === 'TOOL_APPROVAL_RESPONSE' && msg?.id === id);
    return !!res.approved;
  } catch (e) {
    return false;
  }
}

// Simple fetch with retry/backoff for transient Gemini errors
async function fetchWithRetry(url, options, { retries = 3, baseDelay = 500 } = {}) {
  let attempt = 0;
  let lastErr = null;
  while (attempt <= retries) {
    try {
      const resp = await fetch(url, options);
      if (resp.ok) return resp;
      if ([500, 503, 504].includes(resp.status)) {
        // transient; retry
      } else {
        return resp; // non-retryable
      }
    } catch (e) {
      lastErr = e;
      // network error; retry
    }
    const jitter = Math.random() * 100;
    const delay = baseDelay * Math.pow(2, attempt) + jitter;
    await new Promise(r => setTimeout(r, delay));
    attempt++;
  }
  if (lastErr) throw lastErr;
  // fallback: final fetch without retry to return error body
  return fetch(url, options);
}

async function generateWithToolsLoop({ messages = [], system, config }, tabId) {
  const tools = getToolDeclarations();
  let { contents, systemInstruction } = buildContentsFromMessages(messages, system);
  let currentTabId = tabId;

  // Preferred + fallbacks to mitigate INTERNAL(500)
  const preferred = STATE.model || 'gemini-2.0-flash';
  const fallbackList = Array.from(new Set([
    preferred,
    'gemini-2.5-flash',
    'gemini-1.5-flash'
  ]));

  // New: configurable max rounds and loop detection
  const maxRounds = (config && typeof config.maxToolRounds === 'number') ? config.maxToolRounds : STATE.maxToolRounds;
  let lastCallSignature = null;
  let repeatCount = 0;

  // Limit rounds to avoid infinite loops
  for (let round = 0; round < maxRounds; round++) {
    // Compress if too large: summarize older history and keep latest turns
    contents = await compressIfNeeded(contents, 10000);

    const bodyBase = { tools, generationConfig: { temperature: 0.6, topP: 0.95, maxOutputTokens: 1024, ...(config || {}) }, systemInstruction };

    let json = null;
    let usedModel = null;

    // Try preferred model; on 500 switch to fallback
    for (const mdl of fallbackList) {
      const url = `${API_BASE}/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(STATE.apiKey)}`;
      const body = { ...bodyBase, contents };
      let resp;
      try {
        resp = await fetchWithRetry(
          url,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
          { retries: 2, baseDelay: 700 }
        );
      } catch (e) {
        chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', chunk: { text: `Network error on ${mdl}; trying a fallback model...` } });
        continue;
      }

      if (!resp.ok) {
        const status = resp.status;
        const text = await resp.text();
        if (status === 500) {
          chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', chunk: { text: `Model ${mdl} returned 500 INTERNAL; retrying with a fallback model...` } });
          continue; // try next model
        }
        return { error: `API error ${status}: ${text}` };
      }
      // Success
      json = await resp.json();
      usedModel = mdl;
      break;
    }

    if (!json) {
      return { error: 'All model attempts failed (500 or network). Please retry shortly.' };
    }

    const candidate = json.candidates?.[0];
    const calls = getFunctionCallsFromCandidate(candidate);

    // Detect repeated tool plans and try to force final answer
  // But allow legitimate workflow retries (search → click → extract)
  const callSignature = JSON.stringify(calls.map(c => ({ name: c.name, args: c.args })));
  const isLegitimateWorkflow = calls.some(c => 
    ['searchWeb', 'getSearchResults', 'clickSearchResultByDomain', 'extractText', 'waitForSelector'].includes(c.name)
  );
  
  if (calls.length > 0 && callSignature === lastCallSignature) {
    repeatCount++;
  } else {
    repeatCount = 0;
    lastCallSignature = callSignature;
  }

  // Only force final answer for non-workflow repeats or excessive repeats
  if (repeatCount >= (isLegitimateWorkflow ? 4 : 2)) {
    // We've seen the same tool plan too many times; force a final natural-language answer
    chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', chunk: { text: 'Detected repeated tool plan; forcing a final answer without tools...' } });
      contents.push(candidate.content || candidate);
      contents.push({ role: 'user', parts: [{ text: 'Stop calling tools. Provide the final answer concisely based on the gathered data.' }] });

      const bodyBaseNoTools = { generationConfig: { temperature: 0.5, topP: 0.9, maxOutputTokens: 1024, ...(config || {}) }, systemInstruction };
      let finalJson = null;
      let finalModel = null;
      for (const mdl of fallbackList) {
        const url = `${API_BASE}/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(STATE.apiKey)}`;
        try {
          const resp = await fetchWithRetry(
            url,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bodyBaseNoTools, contents }) },
            { retries: 1, baseDelay: 500 }
          );
          if (!resp.ok) continue;
          finalJson = await resp.json();
          finalModel = mdl;
          break;
        } catch (e) {
          // continue
        }
      }
      if (finalJson) {
        const finalText = extractTextFromCandidate(finalJson.candidates?.[0]);
        return { text: finalText, raw: { model: finalModel, ...finalJson } };
      }
      // If we couldn't get a final answer, continue loop to avoid deadlock
    }

    if (!calls.length) {
      const finalText = extractTextFromCandidate(candidate);
      return { text: finalText, raw: { model: usedModel, ...json } };
    }

    // Ask user approval before executing tools
    const approved = await requestToolApproval(calls, currentTabId);
    if (!approved) {
      return { error: 'User declined requested actions.' };
    }

    // Execute all tool calls sequentially
    const nameToResultArray = [];
    for (const call of calls) {
      // Send status update for current tool
      chrome.runtime.sendMessage({ type: 'TOOL_STATUS_UPDATE', status: `🔧 Executing ${call.name}...` });
      const result = await executeTool(call.name, call.args, currentTabId);
      if (result && (result.newTabId || result.switchedTabId)) {
        currentTabId = result.newTabId || result.switchedTabId;
      }
      nameToResultArray.push({ name: call.name, result });
    }

    // Append model functionCall content
    contents.push(candidate.content || candidate);
    // Append user functionResponse parts (already truncated)
    contents.push({ role: 'user', parts: makeFunctionResponseParts(nameToResultArray) });
  }

  // Before erroring, try one final text-only answer
  chrome.runtime.sendMessage({ type: 'STREAM_UPDATE', chunk: { text: 'Reached max tool rounds; producing a final answer without tools...' } });
  const bodyBaseNoTools = { generationConfig: { temperature: 0.5, topP: 0.9, maxOutputTokens: 1024, ...(config || {}) }, systemInstruction };
  let finalJson = null;
  let finalModel = null;
  for (const mdl of fallbackList) {
    const url = `${API_BASE}/models/${encodeURIComponent(mdl)}:generateContent?key=${encodeURIComponent(STATE.apiKey)}`;
    try {
      const resp = await fetchWithRetry(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bodyBaseNoTools, contents }) },
        { retries: 1, baseDelay: 500 }
      );
      if (!resp.ok) continue;
      finalJson = await resp.json();
      finalModel = mdl;
      break;
    } catch (e) {
      // continue
    }
  }
  if (finalJson) {
    const finalText = extractTextFromCandidate(finalJson.candidates?.[0]);
    return { text: finalText, raw: { model: finalModel, ...finalJson } };
  }

  return { error: 'Tool loop exceeded max rounds' };
}

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({
    tabId: tab.id
  });
});