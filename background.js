// Background service worker (module)
// Handles Gemini API calls, tool execution, and message routing

const STATE = {
  apiKey: null,
  model: 'gemini-2.5-flash-lite',
  perSitePermissions: {},
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ask-gemini',
    title: 'Ask Gemini',
    contexts: ['selection', 'page']
  });
});

chrome.storage.sync.get(['geminiApiKey', 'geminiModel', 'perSitePermissions'], (res) => {
  STATE.apiKey = res.geminiApiKey || null;
  STATE.model = res.geminiModel || 'gemini-2.0-flash';
  STATE.perSitePermissions = res.perSitePermissions || {};
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    if (changes.geminiApiKey) STATE.apiKey = changes.geminiApiKey.newValue || null;
    if (changes.geminiModel) STATE.model = changes.geminiModel.newValue || 'gemini-2.0-flash';
    if (changes.perSitePermissions) STATE.perSitePermissions = changes.perSitePermissions.newValue || {};
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
        const tab = sender.tab;
        const origin = getOrigin(tab?.url || '*');
        await ensureSitePermission(origin);
        // Prefer tool-calling loop to match Claude-like behavior
        const result = await generateWithToolsLoop(msg.payload || {}, tab?.id);
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

async function generateContentOnce({ messages, system, tools, config }) {
  const model = STATE.model || 'gemini-2.0-flash';
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(STATE.apiKey)}`;
  const contents = [];
  if (system) contents.push({ role: 'user', parts: [{ text: `SYSTEM:${system}` }] });
  for (const m of messages || []) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  const body = { contents, tools, generationConfig: config };
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await resp.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text, raw: json };
}

// Tool execution via content script
async function executeTool(name, args, tabId) {
  return new Promise((resolve) => {
    const msg = { type: 'EXECUTE_TOOL', name, args };
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      resolve(res?.result ?? null);
    });
  });
}

function getToolDeclarations() {
  return [
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
          description: 'Extract concatenated text content from elements matching selector.',
          parameters: {
            type: 'object',
            properties: { selector: { type: 'string', description: 'CSS selector(s)' } },
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
        }
      ]
    }
  ];
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
    parts.push({ functionResponse: { name, response: result } });
  }
  return parts;
}

function safelyParseJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

async function generateWithToolsLoop({ messages = [], system, config }, tabId) {
  const model = STATE.model || 'gemini-2.0-flash';
  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(STATE.apiKey)}`;
  const tools = getToolDeclarations();
  const { contents, systemInstruction } = buildContentsFromMessages(messages, system);

  // Limit rounds to avoid infinite loops
  for (let round = 0; round < 5; round++) {
    const body = { contents, tools, generationConfig: config || { temperature: 0.7 }, systemInstruction };
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) {
      const text = await resp.text();
      return { error: `API error ${resp.status}: ${text}` };
    }
    const json = await resp.json();
    const candidate = json.candidates?.[0];
    const calls = getFunctionCallsFromCandidate(candidate);

    if (!calls.length) {
      const finalText = extractTextFromCandidate(candidate);
      return { text: finalText, raw: json };
    }

    // Execute all tool calls sequentially
    const nameToResultArray = [];
    for (const call of calls) {
      const result = await executeTool(call.name, call.args, tabId);
      nameToResultArray.push({ name: call.name, result });
    }

    // Append model functionCall content
    contents.push(candidate.content || candidate);
    // Append user functionResponse parts
    contents.push({ role: 'user', parts: makeFunctionResponseParts(nameToResultArray) });
  }
  return { error: 'Tool loop exceeded max rounds' };
}