// Content script: collects context and executes tools

console.log("Content script loaded.");

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
    console.log("Content script received COLLECT_PAGE_CONTEXT");
    sendResponse(summarizeDocument());
  } else if (msg.type === 'REQUEST_SELECTION') {
    const sel = window.getSelection()?.toString().trim();
    chrome.runtime.sendMessage({ type: 'PREFILL_SELECTION', text: sel || '' });
  } else if (msg.type === 'EXECUTE_TOOL') {
    console.log("Content script received EXECUTE_TOOL", msg.name, msg.args);
    executeTool(msg.name, msg.args)
      .then((result) => sendResponse({ result }))
      .catch((e) => {
        console.error('EXECUTE_TOOL error', e);
        sendResponse({ result: { error: String(e?.message || e) } });
      });
    return true;
  }
});

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function dispatchInputEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function waitForSelector(selector, timeoutMs = 8000) {
  const existing = document.querySelector(selector);
  if (existing) return existing;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Timeout waiting for selector'));
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
  });
}

function hostname() {
  try { return location.hostname; } catch { return ''; }
}

function decodeGoogleRedirect(href) {
  try {
    const u = new URL(href);
    if ((u.hostname.includes('google.') || u.hostname === 'www.google.com') && u.pathname === '/url') {
      const q = u.searchParams.get('q');
      if (q) return q;
    }
  } catch {}
  return href;
}

function collectWithSelectorAll(selector, anchorFrom) {
  const items = [];
  const nodes = document.querySelectorAll(selector);
  for (const n of nodes) {
    let a = n;
    if (anchorFrom) {
      a = n.closest(anchorFrom) || n;
    }
    if (a && a.tagName !== 'A') a = a.querySelector('a');
    if (!a || !a.href) continue;
    if (!isVisible(a)) continue;
    const title = (n.textContent || a.textContent || '').trim();
    let href = a.href;
    href = decodeGoogleRedirect(href);
    items.push({ title, href });
  }
  return items;
}

async function executeTool(name, args) {
  switch (name) {
    case 'scrollTo': {
      const { y } = args || {}; window.scrollTo({ top: y || 0, behavior: 'smooth' }); return { ok: true };
    }
    case 'clickSelector': {
      const { selector } = args || {}; const el = document.querySelector(selector); el?.click(); return { ok: !!el };
    }
    case 'fillSelector': {
      const { selector, value } = args || {};
      const el = document.querySelector(selector);
      if (el) {
        el.focus();
        if ('value' in el) {
          el.value = value;
          dispatchInputEvents(el);
        } else if (el.isContentEditable) {
          // Insert text into contenteditable
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) sel.deleteFromDocument();
          document.execCommand('insertText', false, value);
          dispatchInputEvents(el);
        } else {
          // Fallback innerText
          el.textContent = value;
          dispatchInputEvents(el);
        }
      }
      return { ok: !!el };
    }
    case 'extractText': {
      try {
        const { selector, scroll = false } = args || {};
        let allText = [];
        let lastScrollHeight = -1;
        let scrollCount = 0;
        const MAX_SCROLLS = 10; // Increased scroll limit for better coverage
        let stableScrollCount = 0; // Track consecutive scrolls with no new content
        const MAX_STABLE_SCROLLS = 3; // Stop if no new content after 3 scrolls

        do {
          // Wait for any pending network requests on first iteration
          if (scrollCount === 0) {
            // Wait for initial page load to settle
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Set up mutation observer to detect dynamic content
            let newContentDetected = false;
            const observer = new MutationObserver((mutations) => {
              mutations.forEach((mutation) => {
                if (mutation.addedNodes.length > 0) {
                  mutation.addedNodes.forEach((node) => {
                    if (node.nodeType === Node.ELEMENT_NODE && 
                        (node.textContent || '').trim().length > 20) {
                      newContentDetected = true;
                    }
                  });
                }
              });
            });
            
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: false
            });
            
            // Trigger any click-to-load or hover-to-load content
            const loadTriggers = document.querySelectorAll('[data-load], .load-more, .show-more, [onclick*="load"]');
            loadTriggers.forEach(trigger => {
              if (isVisible(trigger)) {
                try {
                  trigger.click();
                } catch (e) {
                  // Ignore click errors
                }
              }
            });
            
            // Wait after triggering load actions
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // If new content was detected, wait a bit more
            if (newContentDetected) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            observer.disconnect();
          }
          
          // Enhanced selector strategy with better fallbacks
          let currentText = '';
          
          // Strategy 1: Use provided selector or intelligent defaults
          if (selector) {
            const nodes = [...document.querySelectorAll(selector)].filter(isVisible);
            currentText = nodes.map(e => (e.innerText || e.textContent || '').trim()).filter(Boolean).join('\n');
          } else {
            // Strategy 2: Try semantic content containers first
            const semanticSelectors = [
              'article',
              'main', 
              '[role="main"]',
              '.content',
              '.post-content',
              '.entry-content',
              '.article-content',
              '#content',
              '#main-content'
            ];
            
            for (const sel of semanticSelectors) {
              const container = document.querySelector(sel);
              if (container && isVisible(container)) {
                const text = (container.innerText || container.textContent || '').trim();
                if (text && text.length > currentText.length) {
                  currentText = text;
                  break;
                }
              }
            }
          }

          // Strategy 3: Comprehensive fallback - collect all meaningful content
          if (!currentText || currentText.length < 300) {
            const contentSelectors = [
              'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
              'li', 'blockquote', 'pre', 'code',
              '.text', '.description', '.summary',
              '[class*="content"]', '[class*="text"]',
              'div:not([class*="nav"]):not([class*="menu"]):not([class*="header"]):not([class*="footer"])'
            ];
            
            const nodes = [];
            for (const sel of contentSelectors) {
              const elements = Array.from(document.querySelectorAll(sel))
                .filter(el => {
                  if (!isVisible(el)) return false;
                  const text = (el.innerText || el.textContent || '').trim();
                  return text.length > 10 && text.length < 2000; // Reasonable text length
                });
              nodes.push(...elements);
            }
            
            // Remove duplicates and nested elements
            const uniqueNodes = nodes.filter((node, index) => {
              // Check if this node is contained within any previous node
              for (let i = 0; i < index; i++) {
                if (nodes[i].contains(node)) return false;
              }
              return true;
            });
            
            const fallbackText = uniqueNodes
              .map(e => (e.innerText || e.textContent || '').trim())
              .filter(text => text.length > 10)
              .join('\n');
              
            if (fallbackText && fallbackText.length > currentText.length) {
              currentText = fallbackText;
            }
          }

          // Strategy 4: Advanced dynamic content detection
          if (!currentText || currentText.length < 200) {
            // Wait for potential dynamic content
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Try to trigger any lazy loading
            const lazyElements = document.querySelectorAll('[data-lazy], [loading="lazy"], .lazy');
            lazyElements.forEach(el => {
              try {
                el.scrollIntoView({ behavior: 'auto', block: 'center' });
              } catch {}
            });
            
            // Wait again after triggering lazy loading
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Look for dynamically loaded content containers
             const dynamicSelectors = [
               '[data-testid]', '[data-cy]', '[data-qa]', '[data-track]',
               '.ranking', '.rank', '.university', '.school', '.college',
               '.list-item', '.item', '.entry', '.result',
               '[class*="rank"]', '[class*="list"]', '[class*="item"]', '[class*="result"]',
               '[class*="university"]', '[class*="college"]', '[class*="school"]',
               '[id*="rank"]', '[id*="list"]', '[id*="content"]', '[id*="result"]',
               // US News specific selectors
               '.DetailCard', '.RankingsCard', '.SearchResult',
               '[data-testid*="rank"]', '[data-testid*="school"]', '[data-testid*="university"]',
               // Generic ranking site patterns
               'tr[data-row]', 'li[data-item]', 'div[data-entry]',
               '.table-row', '.ranking-row', '.school-row'
             ];
            
            for (const sel of dynamicSelectors) {
              const elements = Array.from(document.querySelectorAll(sel))
                .filter(el => isVisible(el) && (el.innerText || el.textContent || '').trim().length > 5);
              if (elements.length > 0) {
                const dynamicText = elements
                  .map(e => (e.innerText || e.textContent || '').trim())
                  .filter(text => text.length > 5)
                  .join('\n');
                if (dynamicText.length > currentText.length) {
                  currentText = dynamicText;
                  break;
                }
              }
            }
          }
          
          // Strategy 5: Shadow DOM and iframe extraction
           if (!currentText || currentText.length < 200) {
             let shadowText = '';
             
             // Extract from shadow DOM
             const shadowHosts = document.querySelectorAll('*');
             shadowHosts.forEach(host => {
               if (host.shadowRoot) {
                 const shadowContent = host.shadowRoot.textContent || '';
                 if (shadowContent.trim().length > 20) {
                   shadowText += shadowContent + '\n';
                 }
               }
             });
             
             // Extract from iframes (same-origin only)
             const iframes = document.querySelectorAll('iframe');
             iframes.forEach(iframe => {
               try {
                 const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
                 if (iframeDoc) {
                   const iframeText = iframeDoc.body?.textContent || iframeDoc.body?.innerText || '';
                   if (iframeText.trim().length > 20) {
                     shadowText += iframeText + '\n';
                   }
                 }
               } catch (e) {
                 // Cross-origin iframe, skip
               }
             });
             
             if (shadowText.trim().length > currentText.length) {
               currentText = shadowText.trim();
             }
           }
           
           // Strategy 6: React/Vue.js application data extraction
            if (!currentText || currentText.length < 200) {
              let appText = '';
              
              // Look for React/Vue data attributes and components
              const reactSelectors = [
                '[data-reactroot]',
                '[data-react-helmet]',
                '.react-component',
                '[data-testid]',
                '[data-cy]',
                '[data-qa]'
              ];
              
              reactSelectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                  if (isVisible(el)) {
                    const text = el.textContent || el.innerText || '';
                    if (text.trim().length > 20) {
                      appText += text + '\n';
                    }
                  }
                });
              });
              
              // Look for Vue.js apps
              const vueApps = document.querySelectorAll('[data-v-], .vue-component, #app, #root');
              vueApps.forEach(app => {
                if (isVisible(app)) {
                  const text = app.textContent || app.innerText || '';
                  if (text.trim().length > 20) {
                    appText += text + '\n';
                  }
                }
              });
              
              if (appText.trim().length > currentText.length) {
                currentText = appText.trim();
              }
            }
            
            // Strategy 7: Last resort - get all visible text from body
            if (!currentText || currentText.length < 200) {
              const bodyText = document.body.innerText || document.body.textContent || '';
              if (bodyText.trim().length > currentText.length) {
                // Filter out navigation and UI text
                const lines = bodyText.split('\n')
                  .map(line => line.trim())
                  .filter(line => {
                    if (line.length < 10) return false;
                    // Skip common navigation patterns
                    const navPatterns = /^(home|about|contact|menu|search|login|register|sign in|sign up)$/i;
                    return !navPatterns.test(line);
                  });
                currentText = lines.join('\n');
              }
            }
          
          // Check if we got new content
          const previousLength = allText.join('\n').length;
          if (currentText && !allText.some(existing => existing.includes(currentText.substring(0, 100)))) {
            allText.push(currentText);
            stableScrollCount = 0; // Reset stable count when we get new content
          } else {
            stableScrollCount++;
          }

          if (scroll && stableScrollCount < MAX_STABLE_SCROLLS) {
            lastScrollHeight = document.body.scrollHeight;
            
            // Try different scroll strategies
            if (scrollCount % 2 === 0) {
              // Scroll to bottom
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            } else {
              // Scroll by viewport height
              window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
            }
            
            // Wait longer for dynamic content to load
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Trigger any lazy loading by dispatching scroll events
            window.dispatchEvent(new Event('scroll'));
            await new Promise(resolve => setTimeout(resolve, 500));
            
            scrollCount++;
          }

        } while (scroll && 
                 scrollCount < MAX_SCROLLS && 
                 stableScrollCount < MAX_STABLE_SCROLLS && 
                 (document.body.scrollHeight > lastScrollHeight || scrollCount < 3));

        // Clean up and deduplicate the final text
        const finalText = allText
          .filter(Boolean)
          .join('\n')
          .replace(/\n{3,}/g, '\n\n') // Normalize excessive line breaks
          .trim();

        return { text: finalText };
      } catch (e) {
        console.error('extractText error:', e);
        return { text: '', error: String(e?.message || e) };
      }
    }
    case 'navigate': {
      const { url } = args || {}; if (url) location.href = url; return { ok: true };
    }
    case 'waitForSelector': {
      const { selector, timeoutMs } = args || {};
      try {
        const el = await waitForSelector(selector, typeof timeoutMs === 'number' ? timeoutMs : 8000);
        return { ok: !!el };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case 'clickLinkByText': {
      const { text } = args || {};
      const q = (text || '').toLowerCase();
      const links = Array.from(document.querySelectorAll('a'))
        .filter(a => isVisible(a) && (a.textContent || '').toLowerCase().includes(q));
      const el = links[0];
      if (el) {
        // Decode Google redirect URLs before clicking
        const decodedHref = decodeGoogleRedirect(el.href);
        if (decodedHref !== el.href) {
          // If it's a Google redirect, navigate directly to the decoded URL
          location.href = decodedHref;
          return { ok: true, href: decodedHref, text: el.textContent?.trim() || null };
        } else {
          // Normal click for non-redirect links
          el.click();
        }
      }
      return { ok: !!el, href: el?.href || null, text: el?.textContent?.trim() || null };
    }
    case 'pressKey': {
      const { key } = args || {};
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      return { ok: true };
    }
    case 'focusSelector': {
      const { selector } = args || {}; const el = document.querySelector(selector); el?.focus(); return { ok: !!el };
    }
    case 'selectOption': {
      const { selector, value } = args || {}; const el = document.querySelector(selector);
      if (el && 'value' in el) { el.value = value; dispatchInputEvents(el); return { ok: true }; } return { ok: false };
    }
    case 'insertText': {
      const { selector, value } = args || {};
      let el = document.querySelector(selector);
      if (!el) return { ok: false };
      el.focus();
      if (el.isContentEditable) {
        document.execCommand('insertText', false, value);
      } else if ('value' in el) {
        el.value += value;
      } else {
        el.textContent += value;
      }
      dispatchInputEvents(el);
      return { ok: true };
    }
    case 'getLinksOnPage': {
      const host = hostname();
      if (host.includes('google.')) {
        return { items: collectWithSelectorAll('a h3', 'a') };
      }
      return { items: collectWithSelectorAll('a') };
    }
    case 'getSearchResults': {
      const results = [];
      const host = hostname();
      try {
        if (host.includes('google.')) {
          const seen = new Set();
          const add = (title, href) => {
            if (!title || !href) return;
            href = decodeGoogleRedirect(href);
            // Skip Google internal links
            if (/^https?:\/\/(?:www\.)?google\./i.test(href)) return;
            if (seen.has(href)) return;
            seen.add(href);
            results.push({ title: String(title).trim(), href });
          };
          // Primary: headline anchors
          const h3Links = document.querySelectorAll('#search a h3, a h3');
          for (const h3 of h3Links) {
            const a = h3.closest('a');
            if (!a || !isVisible(a)) continue;
            add(h3.textContent || a.title || a.href, a.href);
            if (results.length >= 10) break;
          }
          // Fallback: visible anchors inside search region
          if (results.length < 5) {
            const anchors = document.querySelectorAll('#search a[href]:not([href^="#"])');
            for (const a of anchors) {
              if (!isVisible(a)) continue;
              let title = a.querySelector('h3')?.textContent || a.textContent || '';
              title = title.trim();
              if (!title) continue;
              // Skip ad/Google links
              const href = a.getAttribute('href') || '';
              if (/googleadservices|\/aclk|\/imgres|\/search\?|\/maps\//i.test(href)) continue;
              add(title, href);
              if (results.length >= 10) break;
            }
          }
        } else if (host.includes('bing.com')) {
          const nodes = document.querySelectorAll('li.b_algo h2 a, li.b_algo a.title');
          for (const a of nodes) {
            if (!isVisible(a)) continue;
            results.push({ title: (a.textContent || '').trim(), href: a.href });
            if (results.length >= 10) break;
          }
          if (results.length < 3) {
            const anchors = document.querySelectorAll('#b_content a[href]');
            for (const a of anchors) {
              if (!isVisible(a)) continue;
              const title = (a.textContent || '').trim();
              if (!title) continue;
              results.push({ title, href: a.href });
              if (results.length >= 10) break;
            }
          }
        } else if (host.includes('duckduckgo.com')) {
          const nodes = document.querySelectorAll('a.result__a, article a[data-testid="result-title-a"]');
          for (const a of nodes) {
            if (!isVisible(a)) continue;
            results.push({ title: (a.textContent || '').trim(), href: a.href });
            if (results.length >= 10) break;
          }
        } else {
          // Generic: collect all visible links
          const nodes = document.querySelectorAll('a[href]');
          for (const a of nodes) {
            if (!isVisible(a)) continue;
            const title = (a.textContent || '').trim();
            if (!title) continue;
            results.push({ title, href: a.href });
            if (results.length >= 10) break;
          }
        }
      } catch (e) {
        console.warn('getSearchResults error:', e);
      }
      return { items: results };
    }
    case 'clickSearchResultByDomain': {
      const { domain } = args || {};
      if (!domain) return { ok: false, error: 'Missing domain' };
      const host = hostname();
      const normDomain = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
      const isMatch = (href) => {
        try {
          const u = new URL(decodeGoogleRedirect(href));
          const h = u.hostname.replace(/^www\./, '').toLowerCase();
          return h === normDomain || h.endsWith('.' + normDomain) || h.includes(normDomain);
        } catch { return false; }
      };
      let candidates = [];
      if (host.includes('google.')) {
        candidates = Array.from(document.querySelectorAll('#search a[href], a[href]'));
      } else if (host.includes('bing.com')) {
        candidates = Array.from(document.querySelectorAll('li.b_algo h2 a, a[href]'));
      } else if (host.includes('duckduckgo.com')) {
        candidates = Array.from(document.querySelectorAll('a.result__a, a[href]'));
      } else {
        candidates = Array.from(document.querySelectorAll('a[href]'));
      }
      let target = null;
      for (const a of candidates) {
        const href = a.getAttribute('href');
        if (!href) continue;
        if (!isVisible(a)) continue;
        if (/googleadservices|\/aclk/i.test(href)) continue;
        if (isMatch(href)) { target = a; break; }
      }
      if (target) {
        const decodedHref = decodeGoogleRedirect(target.href);
        if (decodedHref !== target.href) {
          location.href = decodedHref;
          return { ok: true, href: decodedHref, text: target.textContent?.trim() || null };
        } else {
          target.click();
          return { ok: true, href: target.href, text: target.textContent?.trim() || null };
        }
      }
      return { ok: false };
    }
    // Google Docs/Sheets helpers
    case 'gdocsInsertText': {
      const { text } = args || {}; const editor = document.querySelector('[contenteditable="true"]');
      if (!editor) return { ok: false };
      editor.focus(); document.execCommand('insertText', false, text || ''); return { ok: true };
    }
    case 'gdocsBoldSelection': {
      document.execCommand('bold'); return { ok: true };
    }
    case 'gsheetsSetCell': {
      const { value } = args || {}; const cell = document.querySelector('[contenteditable="true"]'); if (!cell) return { ok: false };
      cell.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, value || ''); return { ok: true };
    }
    default:
      return { error: 'Unknown tool' };
  }
}

// Remove duplicate cases appended outside executeTool — no code here