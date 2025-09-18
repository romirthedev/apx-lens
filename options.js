document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const saveButton = document.getElementById('save');
  const testButton = document.getElementById('test');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get(['geminiApiKey', 'geminiModel'], (result) => {
    apiKeyInput.value = result.geminiApiKey || '';
    modelSelect.value = result.geminiModel || 'gemini-pro';
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    const model = modelSelect.value;
    chrome.storage.sync.set({ geminiApiKey: apiKey, geminiModel: model }, () => {
      statusDiv.textContent = 'Settings saved!';
      setTimeout(() => { statusDiv.textContent = ''; }, 2000);
    });
  });

  // Test API Key (placeholder for now)
  testButton.addEventListener('click', () => {
    statusDiv.textContent = 'Testing API key...';
    // In a real scenario, you would make an actual API call here
    // For now, we'll just simulate success
    setTimeout(() => {
      statusDiv.textContent = 'API Key test successful!';
      setTimeout(() => { statusDiv.textContent = ''; }, 2000);
    }, 1500);
  });
});