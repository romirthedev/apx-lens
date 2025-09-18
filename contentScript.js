// Content script: collects context and executes tools

function summarizeDocument() {
  const title = document.title || '';
  const sel = window.getSelection()?.toString().trim();
  const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
  const h1 = Array.from(document.querySelectorAll('h1')).map(h => h.textContent.trim()).slice(0,3);
  return {
    title,
    selection: sel,
    meta: metaDesc,
    h1,
    url: location.href,
    summary: [title, metaDesc, sel].filter(Boolean).join('\n')
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'COLLECT_PAGE_CONTEXT') {
    sendResponse(summarizeDocument());
  } else if (msg.type === 'REQUEST_SELECTION') {
    const sel = window.getSelection()?.toString().trim();
    chrome.runtime.sendMessage({ type: 'PREFILL_SELECTION', text: sel || '' });
  } else if (msg.type === 'EXECUTE_TOOL') {
    executeTool(msg.name, msg.args).then((result) => sendResponse({ result }));
    return true;
  }
});

async function executeTool(name, args) {
  switch (name) {
    case 'scrollTo': {
      const { y } = args || {}; window.scrollTo({ top: y || 0, behavior: 'smooth' }); return { ok: true };
    }
    case 'clickSelector': {
      const { selector } = args || {}; const el = document.querySelector(selector); el?.click(); return { ok: !!el };
    }
    case 'fillSelector': {
      const { selector, value } = args || {}; const el = document.querySelector(selector); if (el) { el.focus(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); } return { ok: !!el };
    }
    case 'extractText': {
      const { selector } = args || {}; const els = [...document.querySelectorAll(selector || 'p, h1, h2')].slice(0,50); return { text: els.map(e => e.textContent.trim()).join('\n') };
    }
    case 'navigate': {
      const { url } = args || {}; if (url) location.href = url; return { ok: true };
    }
    default:
      return { error: 'Unknown tool' };
  }
}