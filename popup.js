document.addEventListener('DOMContentLoaded', function() {
    const openSidebarBtn = document.getElementById('openSidebar');
    const captureContentBtn = document.getElementById('captureContent');
    const statusElement = document.getElementById('status');

    // Function to update status
    function updateStatus(message) {
        statusElement.textContent = message;
    }

    // Function to add loading state
    function setLoading(button, isLoading) {
        if (isLoading) {
            button.classList.add('loading');
        } else {
            button.classList.remove('loading');
        }
    }

    // Open AI Chat Sidebar
    openSidebarBtn.addEventListener('click', async function() {
        setLoading(openSidebarBtn, true);
        updateStatus('Opening AI chat...');

        try {
            // Get the active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Send message to content script to open sidebar
            await chrome.tabs.sendMessage(tab.id, { 
                action: 'openSidebar' 
            });
            
            updateStatus('AI chat opened');
            window.close(); // Close the popup
        } catch (error) {
            console.error('Error opening sidebar:', error);
            updateStatus('Error opening chat');
        } finally {
            setLoading(openSidebarBtn, false);
        }
    });

    // Capture and Analyze Page Content
    captureContentBtn.addEventListener('click', async function() {
        setLoading(captureContentBtn, true);
        updateStatus('Analyzing page...');

        try {
            // Get the active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Send message to content script to capture content and open sidebar with analysis
            await chrome.tabs.sendMessage(tab.id, { 
                action: 'captureAndAnalyze' 
            });
            
            updateStatus('Page analysis started');
            window.close(); // Close the popup
        } catch (error) {
            console.error('Error capturing content:', error);
            updateStatus('Error analyzing page');
        } finally {
            setLoading(captureContentBtn, false);
        }
    });

    // Initialize status
    updateStatus('Ready to assist');
});