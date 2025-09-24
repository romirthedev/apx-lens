// Side panel UI logic

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const settingsBtn = document.getElementById('settingsBtn');

const hasChrome = typeof window !== 'undefined' && typeof chrome !== 'undefined' && !!chrome.runtime;

// Conversation memory (kept in the side panel only)
const chatHistory = []; // array of { role: 'user'|'assistant', content: string }
let streamingAccumulator = '';
let pendingUserText = null;

// Clear, intelligent system prompt to guide the model
const SYSTEM_PROMPT = [
  'You are a helpful, concise assistant embedded in a Chrome extension side panel.',
  'Always aim to complete the real-world task end-to-end using tools when needed.',
  'HYBRID WORKFLOW (AI + Automation):',
  'PHASE 1 - AI SEARCH DECISION:',
  '1. Use searchWeb to search for information',
  '2. Use getSearchResults to get available search results',
  '3. Use clickSearchResultByDomain to navigate to the most relevant result',
  '',
  'PHASE 2 - AUTOMATED EXTRACTION:',
  '4. Use autoExtractAfterNavigation with the original user query - this will:',
  '   - Automatically wait for page load',
  '   - Validate the page is relevant to the user\'s query',
  '   - Extract content automatically',
  '   - Return error if page seems irrelevant',
  '5. If autoExtractAfterNavigation fails, you may use getAllContent or extractText as fallback',
  '6. Analyze the extracted content and provide a comprehensive response',
  '',
  'ABSOLUTE RULE: Once clickSearchResultByDomain returns ok:true, immediately use autoExtractAfterNavigation. Do NOT use searchWeb, getSearchResults, or clickSearchResultByDomain again.',
  '',
  'AUTOMATION BENEFITS:',
  '- Prevents wrong navigation decisions after reaching correct site',
  '- Automatically validates page relevance',
  '- Handles timing and page load issues',
  '- Reduces AI decision points that can go wrong',
  'If a tool fails, analyze the error and try alternative approaches rather than repeating the exact same sequence.',
  'IMPORTANT: When extracting rankings, lists, or comprehensive content, prefer getAllContent with method="clean" or "structured" for fast results. Use extractText with scroll=true only for complex sites that need scrolling to capture all content beyond the visible viewport.',
  'Use available browser tools when beneficial: searchWeb, listOpenTabs, openNewTab, switchToTabByTitle, closeCurrentTab; and page tools: waitForSelector, clickSelector, clickLinkByText, fillSelector, insertText, pressKey, focusSelector, selectOption, scrollTo, navigate, extractText, getAllContent, getLinksOnPage, getSearchResults, clickSearchResultByDomain.',
  'CONTENT EXTRACTION: Always try getAllContent FIRST as it is faster and simpler:',
  '- getAllContent: PREFERRED method - fast extraction with method="clean" (removes ads/nav), "text" (plain text), "structured" (organized), or "html" (raw HTML).',
  '- extractText: Use ONLY when getAllContent fails or for complex sites requiring scrolling and advanced selectors.',
  'Operate safely: ask for approval when prompted, use minimal precise actions, and be transparent about what you did and any limitations. If an action fails, explain and suggest alternatives.',
  'Format equations and key expressions using LaTeX: use $...$ for inline math and $$...$$ or \\[...\\] for display math. Avoid full LaTeX document preambles; write concise text with math where helpful.'
].join('\n');

let port;

// Render text with inline/display LaTeX using KaTeX, preserving surrounding text
function renderWithKaTeXInline(container, text) {
  let idx = 0;
  const re = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([^\)]+?\\\)|\$[^$\n]+?\$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > idx) {
      container.appendChild(document.createTextNode(text.slice(idx, m.index)));
    }
    const token = m[0];
    let display = false;
    let math = '';
    if (token.startsWith('$$')) { display = true; math = token.slice(2, -2); }
    else if (token.startsWith('\\[')) { display = true; math = token.slice(2, -2); }
    else if (token.startsWith('\\(')) { display = false; math = token.slice(2, -2); }
    else if (token.startsWith('$')) { display = false; math = token.slice(1, -1); }
    const span = document.createElement('span');
    try {
      window.katex?.render(math, span, { throwOnError: false, displayMode: display });
    } catch (e) {
      span.textContent = token; // fallback to raw token
    }
    container.appendChild(span);
    idx = m.index + token.length;
  }
  if (idx < text.length) {
    container.appendChild(document.createTextNode(text.slice(idx)));
  }
}

function renderMathOrText(container, text) {
  if (!text) {
    container.textContent = '';
    return;
  }
  const hasMath = /\$\$[\s\S]+?\$\$|\\\[[\s\S]*?\\\]|\\\([^\)]*?\\\)|\$[^$\n]+\$/.test(text);
  if (window.katex && hasMath) {
    // Split into paragraphs by blank lines to preserve layout
    const paragraphs = text.split(/\n{2,}/);
    for (const para of paragraphs) {
      const div = document.createElement('div');
      renderWithKaTeXInline(div, para);
      container.appendChild(div);
    }
  } else {
    container.textContent = text;
  }
}

function appendMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  renderMathOrText(div, text);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStreaming(role, on) {
  if (on) {
    const div = document.createElement('div');
    div.className = `msg ${role} streaming`;
    div.id = 'streaming';
    div.innerHTML = '<span class="status-indicator">✨ AI is thinking...</span>';
    messagesEl.appendChild(div);
  } else {
    const div = document.getElementById('streaming');
    if (div) div.remove();
  }
}

function updateStreamingText(text) {
  streamingAccumulator += text;
  const div = document.getElementById('streaming');
  if (div) {
    // Clear status indicator and show actual text
    const statusIndicator = div.querySelector('.status-indicator');
    if (statusIndicator) {
      statusIndicator.remove();
    }
    div.textContent += text; // stream raw; final render happens on STREAM_DONE
  }
}

function updateStatusIndicator(status) {
  const div = document.getElementById('streaming');
  if (div) {
    const statusIndicator = div.querySelector('.status-indicator');
    if (statusIndicator) {
      statusIndicator.textContent = status;
    }
  }
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

settingsBtn.addEventListener('click', () => {
  if (hasChrome) {
    chrome.runtime.openOptionsPage();
  } else {
    // preview fallback
    window.location.href = 'options.html';
  }
});

async function send() {
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  pendingUserText = text;
  appendMsg('user', text);
  setStreaming('assistant', true);

  // Build conversation with last few turns
  const baseHistory = chatHistory.slice(-8);
  const messages = [...baseHistory, { role: 'user', content: text }];

  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
        // Proceed without page context on restricted pages
        const payload = { messages, system: SYSTEM_PROMPT };
        chrome.runtime.sendMessage({ type: 'ASK_GEMINI', payload });
        return;
      }
      // Try to collect page context and include it
      chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_PAGE_CONTEXT' }, (ctx) => {
        let err = chrome.runtime.lastError;
        if (err) {
          appendMsg('assistant', "Heads up: I can't read this page due to browser restrictions. I'll answer without page context. Try on a regular website (https://...) for full functionality.");
        }
        const withContext = ctx ? [{ role: 'user', content: `Page context (may be partial or outdated):\n${JSON.stringify(ctx)}` }] : [];
        const payload = { messages: [...withContext, ...messages], system: SYSTEM_PROMPT };
        chrome.runtime.sendMessage({ type: 'ASK_GEMINI', payload, tabId: tab.id });
      });
    });
  } catch (e) {
    appendMsg('assistant', "Unable to detect the active tab. I'll answer without page context.");
    const baseHistory = chatHistory.slice(-8);
    const messages = [...baseHistory, { role: 'user', content: text }];
    const payload = { messages, system: SYSTEM_PROMPT };
    chrome.runtime.sendMessage({ type: 'ASK_GEMINI', payload });
  }
}

if (hasChrome) {
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === 'STREAM_UPDATE') {
      if (msg.chunk?.text) {
        updateStreamingText(msg.chunk.text);
      }
      if (msg.chunk?.toolCalls) {
        // For MVP, display tool calls; execution roundtrip from background->content will update
        appendMsg('assistant', `Requested tool calls: ${JSON.stringify(msg.chunk.toolCalls)}`);
      }
    } else if (msg.type === 'STREAM_DONE') {
      const div = document.getElementById('streaming');
      if (div) {
        // Re-render the final assistant message with KaTeX support
        div.classList.remove('streaming');
        div.id = '';
        div.textContent = '';
        renderMathOrText(div, streamingAccumulator);
      }
      // finalize turn into chat history
      if (pendingUserText) chatHistory.push({ role: 'user', content: pendingUserText });
      if (streamingAccumulator) chatHistory.push({ role: 'assistant', content: streamingAccumulator });
      pendingUserText = null;
      streamingAccumulator = '';
    } else if (msg.type === 'PREFILL_SELECTION') {
      const text = msg.text || '';
      if (text) inputEl.value = `Summarize selection:\n\n${text}`;
    } else if (msg.type === 'TOOL_STATUS_UPDATE') {
      updateStatusIndicator(msg.status);
    }
  });
}

// Tool approval modal elements
const toolApproval = document.getElementById('toolApproval');
const toolList = document.getElementById('toolList');
const approveTools = document.getElementById('approveTools');
const declineTools = document.getElementById('declineTools');
let pendingApproval = null;

if (hasChrome) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'REQUEST_TOOL_APPROVAL') {
      pendingApproval = { id: msg.id, calls: msg.calls };
      // Populate list
      toolList.innerHTML = '';
      for (const call of msg.calls) {
        const li = document.createElement('li');
        li.textContent = `${call.name}(${JSON.stringify(call.args)})`;
        toolList.appendChild(li);
      }
      toolApproval.hidden = false;
    }
  });
}

approveTools?.addEventListener('click', () => {
  if (!pendingApproval) return;
  chrome.runtime.sendMessage({ type: 'TOOL_APPROVAL_RESPONSE', id: pendingApproval.id, approved: true });
  toolApproval.hidden = true;
  pendingApproval = null;
});

declineTools?.addEventListener('click', () => {
  if (!pendingApproval) return;
  chrome.runtime.sendMessage({ type: 'TOOL_APPROVAL_RESPONSE', id: pendingApproval.id, approved: false });
  toolApproval.hidden = true;
  pendingApproval = null;
});