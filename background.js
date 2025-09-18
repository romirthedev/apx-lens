// APX Lens Background Script (Service Worker)

// Installation event
chrome.runtime.onInstalled.addListener((details) => {
    console.log('APX Lens extension installed:', details);
    
    // Set default settings
    chrome.storage.sync.set({
        'apx-settings': {
            theme: 'auto',
            sidebarPosition: 'right',
            autoAnalyze: false,
            shortcuts: {
                openSidebar: 'Ctrl+Shift+A',
                capturePage: 'Ctrl+Shift+C'
            }
        }
    });
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
    try {
        // Try to send message to content script first
        await chrome.tabs.sendMessage(tab.id, { action: 'openSidebar' });
    } catch (error) {
        console.log('Content script not ready, injecting...');
        
        // Inject content script if not already present
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['content-script.js']
            });
            
            // Wait a bit for script to initialize, then try again
            setTimeout(async () => {
                try {
                    await chrome.tabs.sendMessage(tab.id, { action: 'openSidebar' });
                } catch (retryError) {
                    console.error('Failed to open sidebar:', retryError);
                }
            }, 100);
        } catch (injectError) {
            console.error('Failed to inject content script:', injectError);
        }
    }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'captureScreenshot') {
        captureScreenshot(sender.tab.id)
            .then(dataUrl => sendResponse({ success: true, dataUrl }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
    
    if (request.action === 'getTabInfo') {
        chrome.tabs.get(sender.tab.id, (tab) => {
            sendResponse({
                success: true,
                tabInfo: {
                    title: tab.title,
                    url: tab.url,
                    favIconUrl: tab.favIconUrl
                }
            });
        });
        return true; // Will respond asynchronously
    }
});

// Function to capture screenshot
async function captureScreenshot(tabId) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: 'png',
            quality: 90
        });
        return dataUrl;
    } catch (error) {
        console.error('Screenshot capture failed:', error);
        throw error;
    }
}

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    switch (command) {
        case 'open-sidebar':
            try {
                await chrome.tabs.sendMessage(tab.id, { action: 'openSidebar' });
            } catch (error) {
                console.error('Failed to open sidebar via shortcut:', error);
            }
            break;
            
        case 'capture-page':
            try {
                await chrome.tabs.sendMessage(tab.id, { action: 'captureAndAnalyze' });
            } catch (error) {
                console.error('Failed to capture page via shortcut:', error);
            }
            break;
    }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Re-inject content script on navigation if needed
    if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
        // Optional: Auto-inject content script on page load
        // This ensures the extension works even if user navigates to new pages
    }
});

// Handle context menus (right-click options)
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'apx-analyze-selection',
        title: 'Analyze with APX Lens',
        contexts: ['selection']
    });
    
    chrome.contextMenus.create({
        id: 'apx-analyze-page',
        title: 'Open APX Lens',
        contexts: ['page']
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    switch (info.menuItemId) {
        case 'apx-analyze-selection':
            try {
                await chrome.tabs.sendMessage(tab.id, { 
                    action: 'analyzeSelection',
                    selectedText: info.selectionText 
                });
            } catch (error) {
                console.error('Failed to analyze selection:', error);
            }
            break;
            
        case 'apx-analyze-page':
            try {
                await chrome.tabs.sendMessage(tab.id, { action: 'openSidebar' });
            } catch (error) {
                console.error('Failed to open sidebar from context menu:', error);
            }
            break;
    }
});

// Utility function to check if content script is injected
async function isContentScriptInjected(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        return true;
    } catch (error) {
        return false;
    }
}

// Storage change listener for settings updates
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes['apx-settings']) {
        console.log('APX Lens settings updated:', changes['apx-settings'].newValue);
        
        // Broadcast settings update to all content scripts
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                if (tab.url && !tab.url.startsWith('chrome://')) {
                    chrome.tabs.sendMessage(tab.id, {
                        action: 'settingsUpdated',
                        settings: changes['apx-settings'].newValue
                    }).catch(() => {
                        // Ignore errors for tabs without content script
                    });
                }
            });
        });
    }
});

console.log('APX Lens background script loaded');