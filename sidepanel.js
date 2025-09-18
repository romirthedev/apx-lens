// Side panel UI logic

const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const settingsBtn = document.getElementById('settingsBtn');

const hasChrome = typeof window !== 'undefined' && typeof chrome !== 'undefined' && !!chrome.runtime;

let port;

function appendMsg(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStreaming(role, on) {
  if (on) {
    const div = document.createElement('div');
    div.className = `msg ${role} streaming`;
    div.id = 'streaming';
    messagesEl.appendChild(div);
  } else {
    const div = document.getElementById('streaming');
    if (div) div.remove();
  }
}

function updateStreamingText(text) {
  const div = document.getElementById('streaming');
  if (div) div.textContent += text;
}

sendBtn.addEventListener('click', send);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

clearBtn.addEventListener('click', () => {
  messagesEl.innerHTML = '';
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
  appendMsg('user', text);
  inputEl.value = '';
  setStreaming('assistant', true);

  if (!hasChrome) {
    // Preview mode: simulate streamed response
    const demo = 'This is a preview of the Gemini side panel UI. In the extension, responses will stream here.';
    for (const ch of demo) {
      await new Promise(r => setTimeout(r, 12));
      updateStreamingText(ch);
    }
    const div = document.getElementById('streaming');
    if (div) div.id = '';
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_PAGE_CONTEXT' }, (ctx) => {
    const payload = { messages: [{ role: 'user', content: `${text}\n\nContext:${ctx?.summary || ''}` }] };
    chrome.runtime.sendMessage({ type: 'ASK_GEMINI', payload });
  });
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
      if (div) div.id = '';
    } else if (msg.type === 'PREFILL_SELECTION') {
      const text = msg.text || '';
      if (text) inputEl.value = `Summarize selection:\n\n${text}`;
    }
  });
}