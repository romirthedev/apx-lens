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
    const u = new URL(href, location.href);
    // Google search redirect
    if ((u.hostname.includes('google.') || u.hostname === 'www.google.com') && u.pathname === '/url') {
      for (const key of ['q', 'url', 'u']) {
        const v = u.searchParams.get(key);
        if (v) return v;
      }
    }
    // Bing ad/redirect
    if (u.hostname.includes('bing.com') && (u.pathname === '/aclk' || u.pathname === '/ck/a')) {
      const v = u.searchParams.get('u');
      if (v) return v;
    }
    // DuckDuckGo redirect
    if (u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/l')) {
      const v = u.searchParams.get('uddg');
      if (v) return decodeURIComponent(v);
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
    case 'autoExtractAfterNavigation': {
      // Automated workflow: wait for page load, then extract content (more robust, site-agnostic)
      const { userQuery, method = 'clean' } = args || {};
      try {
        // Wait for page to be ready
        await new Promise(resolve => {
          if (document.readyState === 'complete') {
            resolve();
          } else {
            window.addEventListener('load', resolve, { once: true });
          }
        });

        // Initial settle for dynamic content
        await new Promise(resolve => setTimeout(resolve, 1200));

        // Nudge lazy loaders: small scroll down/up
        try {
          const half = Math.max(200, Math.floor(window.innerHeight * 0.5));
          window.scrollBy({ top: half, behavior: 'auto' });
          await new Promise(r => setTimeout(r, 400));
          window.scrollTo({ top: 0, behavior: 'auto' });
          await new Promise(r => setTimeout(r, 400));
        } catch {}

        // Compute lightweight relevance features
        const pageTitle = (document.title || '').toLowerCase();
        const pageTextSample = (document.body.textContent || '').toLowerCase().slice(0, 1500);
        const queryWords = (userQuery || '')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(w => w && w.length > 2 && !['the','and','for','with','from','this','that','what','when','where','best','top','list','site','page','info'].includes(w));
        let relevanceScore = 0;
        for (const w of queryWords) {
          if (pageTitle.includes(w)) relevanceScore += 2;
          if (pageTextSample.includes(w)) relevanceScore += 1;
        }

        // Helper: extract by method with better cleaning
        const extractByMethod = (kind) => {
          if (kind === 'text') {
            return (document.body.innerText || document.body.textContent || '');
          }
          if (kind === 'html') {
            return (document.body.innerHTML || '');
          }
          if (kind === 'full') {
            return (document.documentElement.outerHTML || '');
          }
          if (kind === 'structured') {
            try {
              const structured = {
                title: document.title || '',
                headings: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
                  .map(h => (h.innerText || h.textContent || '').trim())
                  .filter(Boolean),
                paragraphs: Array.from(document.querySelectorAll('article p, main p, [role="main"] p, p'))
                  .map(p => (p.innerText || p.textContent || '').trim())
                  .filter(Boolean),
                lists: Array.from(document.querySelectorAll('ul, ol')).map(list =>
                  Array.from(list.querySelectorAll('li')).map(li => (li.innerText || li.textContent || '').trim()).filter(Boolean)
                ).filter(list => list.length > 0)
              };
              return JSON.stringify(structured, null, 2);
            } catch {
              // Fallback to text if structured fails
              return (document.body.innerText || document.body.textContent || '');
            }
          }
          // Default: clean
          try {
            const tempDoc = document.cloneNode(true);
            const tempBody = tempDoc.body;
            // Remove common boilerplate and non-content regions
            const removeSelectors = [
              'script', 'style', 'nav', 'header', 'footer', 'aside', '[role="navigation"]', '[aria-label*="navigation"]',
              '.ad', '.ads', '.advertisement', '.sponsored', '.promo',
              '.sidebar', '.menu', '.navigation', '.breadcrumb', '.breadcrumbs', '.pagination',
              '.cookie', '.cookie-consent', '.gdpr', '#cookie', '#cookies', '[aria-label*="cookie"]',
              '.banner', '#banner', '.toast', '.snackbar', '.modal', '.overlay', '.backdrop', '[role="dialog"]',
              '.subscribe', '.newsletter', '.paywall', '.meteredContent',
              '.share', '.social', '.social-share', '.sticky', '.sticky-header', '.sticky-footer',
              '#header', '#footer', '#nav', '#sidebar',
              // site-specific nuisances
              '.Disclosure', '.consent', '.consent-banner'
            ].join(',');
            try { tempBody.querySelectorAll(removeSelectors).forEach(el => el.remove()); } catch {}
            const text = (tempBody.innerText || tempBody.textContent || '');
            // Normalize whitespace
            return text.replace(/\n{3,}/g, '\n\n').replace(/\s{3,}/g, ' ').trim();
          } catch {
            return (document.body.innerText || document.body.textContent || '');
          }
        };

        // 1) Primary extraction
        let usedMethod = method;
        let content = extractByMethod(method);

        // 2) Fallbacks for thin pages or heavy JS sites
        if (!content || content.trim().length < 600) {
          // Try structured summary for better recall, then plain text
          const structured = extractByMethod('structured');
          if (structured && structured.trim().length > content.trim().length) {
            usedMethod = `${method}+structured`;
            content = structured;
          }
        }
        if (!content || content.trim().length < 600) {
          const plain = extractByMethod('text');
          if (plain && plain.trim().length > content.trim().length) {
            usedMethod = `${usedMethod}+text`;
            content = plain;
          }
        }
        if (!content || content.trim().length < 600) {
          // Mini scroll pass to trigger lazy loading, then recapture
          if ((document.body.scrollHeight || 0) > (window.innerHeight * 1.5)) {
            const step = Math.max(300, Math.floor(window.innerHeight * 0.5));
            for (let i = 0; i < 4; i++) {
              window.scrollBy({ top: step, behavior: 'auto' });
              await new Promise(r => setTimeout(r, 500));
              window.dispatchEvent(new Event('scroll'));
              await new Promise(r => setTimeout(r, 200));
            }
            await new Promise(r => setTimeout(r, 400));
            window.scrollTo({ top: 0, behavior: 'auto' });
            await new Promise(r => setTimeout(r, 300));
            const rescanned = extractByMethod('text');
            if (rescanned && rescanned.trim().length > content.trim().length) {
              usedMethod = `${usedMethod}+scroll`;
              content = rescanned;
            }
          }
        }

        const finalContent = (content || '').trim();

        // Re-evaluate lightweight relevance after extraction; only fail if clearly off and content is tiny
        if (queryWords.length > 0 && relevanceScore === 0 && finalContent.length < 400) {
          return {
            success: false,
            error: `Page might be irrelevant to: "${userQuery}". Title: "${document.title}"`,
            title: document.title,
            url: location.href
          };
        }

        return {
          success: true,
          content: finalContent,
          method: usedMethod,
          title: document.title,
          url: location.href,
          relevanceScore
        };
      } catch (e) {
        return {
          success: false,
          error: String(e?.message || e),
          title: document.title,
          url: location.href
        };
      }
    }
    case 'getAllContent': {
      try {
        const { method = 'text' } = args || {};
        
        switch (method) {
          case 'text':
            // Simple text extraction - gets all visible text from the page
            return { content: document.body.innerText || document.body.textContent || '' };
            
          case 'html':
            // Raw HTML content for AI processing
            return { content: document.body.innerHTML || '' };
            
          case 'full':
            // Complete page HTML including head
            return { content: document.documentElement.outerHTML || '' };
            
          case 'clean':
            // Clean text with basic filtering
            const cleanText = (document.body.innerText || document.body.textContent || '')
              .replace(/\n{3,}/g, '\n\n') // Normalize line breaks
              .replace(/\s{3,}/g, ' ')   // Normalize spaces
              .trim();
            return { content: cleanText };
            
          case 'structured':
            // Extract structured content (headings, paragraphs, lists)
            const structured = [];
            const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre');
            elements.forEach(el => {
              if (isVisible(el)) {
                const text = (el.innerText || el.textContent || '').trim();
                if (text.length > 5) {
                  structured.push({
                    tag: el.tagName.toLowerCase(),
                    text: text
                  });
                }
              }
            });
            return { content: structured };
            
          default:
            return { content: document.body.innerText || document.body.textContent || '' };
        }
      } catch (e) {
        console.error('getAllContent error:', e);
        return { content: '', error: String(e?.message || e) };
      }
    }
    case 'extractText': {
      try {
        const { selector, scroll = false } = args || {};
        let allText = [];
        let lastScrollHeight = -1;
        let scrollCount = 0;
        const MAX_SCROLLS = 15; // Increased scroll limit for better coverage
        let stableScrollCount = 0; // Track consecutive scrolls with no new content
        const MAX_STABLE_SCROLLS = 4; // Stop if no new content after 4 scrolls
        const SCROLL_STEP = Math.max(300, window.innerHeight * 0.3); // Smaller scroll steps

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
               '.table-row', '.ranking-row', '.school-row',
               // General article/docs/wiki/content regions
               '#mw-content-text', 'article', '.article', '.content__body', '[itemprop="articleBody"]',
               '.markdown', '.prose', '.wiki-content', '.post', '.entry-content', '.post-content', '.doc', '.docs-content'
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
          
          // Check if we got new content and extract incrementally
          const previousLength = allText.join('\n').length;
          if (currentText && !allText.some(existing => existing.includes(currentText.substring(0, 100)))) {
            allText.push(currentText);
            stableScrollCount = 0; // Reset stable count when we get new content
            
            // Log progress for debugging
            console.log(`Extracted ${currentText.length} chars, total: ${allText.join('\n').length} chars`);
          } else {
            stableScrollCount++;
          }

          if (scroll && stableScrollCount < MAX_STABLE_SCROLLS) {
            lastScrollHeight = document.body.scrollHeight;
            
            // Gradual scrolling strategy - small incremental scrolls
            const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const maxScroll = document.body.scrollHeight - window.innerHeight;
            
            if (currentScrollTop < maxScroll) {
              // Scroll by small increments to capture content gradually
              window.scrollBy({ top: SCROLL_STEP, behavior: 'smooth' });
              
              // Shorter wait time for more responsive scrolling
              await new Promise(resolve => setTimeout(resolve, 800));
              
              // Trigger lazy loading
              window.dispatchEvent(new Event('scroll'));
              await new Promise(resolve => setTimeout(resolve, 300));
            } else {
              // If we've reached the bottom, try a final scroll to ensure we got everything
              window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            scrollCount++;
          }

          // Check if we have found target content (like rankings, lists, etc.)
          if (scroll && currentText) {
            const fullText = allText.join('\n');
            const hasRankingContent = /(?:top\s+\d+|#\d+|rank|ranking|\d+\.|\d+\)|first|second|third|\d+th|best\s+\d+)/i.test(fullText);
            const hasListContent = /(?:university|college|school|institution)/i.test(fullText);
            const hasMultipleEntries = (fullText.match(/(?:university|college)/gi) || []).length >= 3;
            const contentLength = fullText.length;
            
            // Stop scrolling if we found substantial ranking/list content
            if ((hasRankingContent && hasListContent && hasMultipleEntries && contentLength > 800) || contentLength > 4000) {
              console.log('Found target content, stopping scroll. Content length:', contentLength);
              break;
            }
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
      let scrollAttempts = 0;
      const MAX_SCROLL_ATTEMPTS = 3;
      
      const extractResults = () => {
        const currentResults = [];
        if (host.includes('google.')) {
          const seen = new Set();
          const add = (title, href) => {
            if (!title || !href) return;
            href = decodeGoogleRedirect(href);
            // Skip Google internal links
            try {
              const abs = new URL(href, location.href);
              if (/^https?:\/\/(?:www\.)?google\./i.test(abs.href)) return;
              if (seen.has(abs.href)) return;
              seen.add(abs.href);
              currentResults.push({ title: String(title).trim(), href: abs.href });
            } catch {
              // If URL construction fails, skip
            }
          };
          // Primary: headline anchors
          const h3Links = document.querySelectorAll('#search a h3, a h3');
          for (const h3 of h3Links) {
            const a = h3.closest('a');
            if (!a || !isVisible(a)) continue;
            add(h3.textContent || a.title || a.href, a.href);
            if (currentResults.length >= 10) break;
          }
          // Fallback: visible anchors inside search region
          if (currentResults.length < 5) {
            const anchors = document.querySelectorAll('#search a[href]:not([href^="#"])');
            for (const a of anchors) {
              if (!isVisible(a)) continue;
              let title = a.querySelector('h3')?.textContent || a.textContent || '';
              title = title.trim();
              if (!title) continue;
              const href = a.href || '';
              // Skip ad/Google links
              if (/googleadservices|\/aclk|\/imgres|\/search\?|\/maps\//i.test(href)) continue;
              add(title, href);
              if (currentResults.length >= 10) break;
            }
          }
        } else if (host.includes('bing.com')) {
          const nodes = document.querySelectorAll('li.b_algo h2 a, li.b_algo a.title');
          for (const a of nodes) {
            if (!isVisible(a)) continue;
            currentResults.push({ title: (a.textContent || '').trim(), href: a.href });
            if (currentResults.length >= 10) break;
          }
          if (currentResults.length < 3) {
            const anchors = document.querySelectorAll('#b_content a[href]');
            for (const a of anchors) {
              if (!isVisible(a)) continue;
              const title = (a.textContent || '').trim();
              if (!title) continue;
              currentResults.push({ title, href: a.href });
              if (currentResults.length >= 10) break;
            }
          }
        } else if (host.includes('duckduckgo.com')) {
          const nodes = document.querySelectorAll('a.result__a, article a[data-testid="result-title-a"]');
          for (const a of nodes) {
            if (!isVisible(a)) continue;
            currentResults.push({ title: (a.textContent || '').trim(), href: a.href });
            if (currentResults.length >= 10) break;
          }
        } else {
          // Generic: collect all visible links
          const nodes = document.querySelectorAll('a[href]');
          for (const a of nodes) {
            if (!isVisible(a)) continue;
            const title = (a.textContent || '').trim();
            if (!title) continue;
            currentResults.push({ title, href: a.href });
            if (currentResults.length >= 10) break;
          }
        }
        return currentResults;
      };
      
      try {
        // Initial extraction
        results.push(...extractResults());
        
        // If we have few results, try scrolling to load more
        while (results.length < 5 && scrollAttempts < MAX_SCROLL_ATTEMPTS) {
          const initialHeight = document.body.scrollHeight;
          
          // Scroll down to potentially load more results
          window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Trigger scroll events for lazy loading
          window.dispatchEvent(new Event('scroll'));
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Extract new results
          const newResults = extractResults();
          const existingHrefs = new Set(results.map(r => r.href));
          const uniqueNewResults = newResults.filter(r => !existingHrefs.has(r.href));
          
          results.push(...uniqueNewResults);
          scrollAttempts++;
          
          // If page didn't grow, no point in continuing
          if (document.body.scrollHeight <= initialHeight) {
            break;
          }
        }
        
        // Scroll back to top for better UX
        if (scrollAttempts > 0) {
          window.scrollTo({ top: 0, behavior: 'smooth' });
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (e) {
        console.warn('getSearchResults error:', e);
      }
      
      // Remove duplicates and limit results
      const uniqueResults = [];
      const seenHrefs = new Set();
      for (const result of results) {
        if (!seenHrefs.has(result.href)) {
          seenHrefs.add(result.href);
          uniqueResults.push(result);
          if (uniqueResults.length >= 10) break;
        }
      }
      
      return { items: uniqueResults };
    }
    case 'clickSearchResultByDomain': {
      const { domain } = args || {};
      if (!domain) return { ok: false, error: 'Missing domain parameter' };
      const host = hostname();
      const normDomain = String(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').toLowerCase();
      const isMatch = (href) => {
        try {
          const u = new URL(decodeGoogleRedirect(href), location.href);
          const h = u.hostname.replace(/^www\./, '').toLowerCase();
          return h === normDomain || h.endsWith('.' + normDomain) || h.includes(normDomain);
        } catch { return false; }
      };
      let candidates = [];
      if (host.includes('google.')) {
        // Prioritize main search result links first
        const mainResults = Array.from(document.querySelectorAll('#search a[href]:has(h3), #search a[href] h3'));
        const otherLinks = Array.from(document.querySelectorAll('#search a[href]'));
        candidates = [...mainResults.map(el => el.tagName === 'H3' ? el.closest('a') : el).filter(Boolean), ...otherLinks];
      } else if (host.includes('bing.com')) {
        // Prioritize main result links
        const mainResults = Array.from(document.querySelectorAll('li.b_algo h2 a, li.b_algo a.title'));
        const otherLinks = Array.from(document.querySelectorAll('#b_content a[href]'));
        candidates = [...mainResults, ...otherLinks];
      } else if (host.includes('duckduckgo.com')) {
        // Prioritize main result links
        const mainResults = Array.from(document.querySelectorAll('a.result__a, article a[data-testid="result-title-a"]'));
        const otherLinks = Array.from(document.querySelectorAll('a[href]'));
        candidates = [...mainResults, ...otherLinks];
      } else {
        candidates = Array.from(document.querySelectorAll('a[href]'));
      }
      
      // Debug info: collect available domains and find best match
      const availableDomains = new Set();
      const matchingLinks = [];
      
      for (const a of candidates) {
        const href = a.href;
        if (!href) continue;
        if (!isVisible(a)) continue;
        // Skip ads, internal Google links, and other non-content links
        if (/googleadservices|\/aclk|\/imgres|\/search\?|\/maps\/|google\.com\/url|accounts\.google|support\.google|policies\.google/i.test(href)) continue;
        // Skip Bing ads and internal links
        if (/\/ck\/a|\/aclk|bing\.com\/search|bing\.com\/images/i.test(href)) continue;
        // Skip very short link text that's likely navigation
        const linkText = (a.textContent || '').trim();
        if (linkText.length < 3) continue;
        
        try {
          const u = new URL(decodeGoogleRedirect(href), location.href);
          const h = u.hostname.replace(/^www\./, '').toLowerCase();
          availableDomains.add(h);
          if (isMatch(href)) {
            // Score links based on relevance and position
            const linkText = (a.textContent || '').toLowerCase();
            const urlPath = u.pathname.toLowerCase();
            let score = 0;
            
            // HIGHEST priority: Main search result links (h3 headlines, etc.)
            if (host.includes('google.') && a.querySelector('h3')) score += 100;
            if (host.includes('bing.') && a.closest('li.b_algo')) score += 100;
            if (host.includes('duckduckgo.') && (a.classList.contains('result__a') || a.getAttribute('data-testid') === 'result-title-a')) score += 100;
            
            // High priority for main content areas
            const isInMainContent = a.closest('#search, #b_content, .results, main, article');
            if (isInMainContent) score += 50;
            
            // Very high priority for first few search results
            const searchResultIndex = candidates.indexOf(a);
            if (searchResultIndex >= 0 && searchResultIndex < 5) {
              score += (50 - searchResultIndex * 10); // First result gets +50, second +40, etc.
            }
            
            // Higher score for more specific paths (not just homepage)
            if (urlPath !== '/' && urlPath !== '') score += 10;
            
            // Higher score for links with substantial text content
            if (linkText.length > 20) score += 10;
            if (linkText.length > 50) score += 5;
            
            // Lower score for navigation/utility links
            if (/home|about|contact|news|blog|login|signup|privacy|terms/i.test(urlPath)) score -= 20;
            if (/home|about|contact|news|blog|login|signup|privacy|terms/i.test(linkText)) score -= 20;
            
            // Lower score for very short link text (likely navigation)
            if (linkText.length < 10) score -= 10;
            
            matchingLinks.push({ element: a, score, href: decodeGoogleRedirect(href), text: linkText });
          }
        } catch { /* skip invalid URLs */ }
      }
      
      // Sort by score (highest first) and pick the best match
      matchingLinks.sort((a, b) => b.score - a.score);
      const target = matchingLinks.length > 0 ? matchingLinks[0].element : null;
      
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
      
      // Provide helpful error with available domains
      const availableList = Array.from(availableDomains).slice(0, 10).join(', ');
      return { 
        ok: false, 
        error: `No result found for domain '${domain}'. Available domains: ${availableList || 'none found'}`,
        availableDomains: Array.from(availableDomains)
      };
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