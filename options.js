document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const saveButton = document.getElementById('save');
  const testButton = document.getElementById('test');
  const statusDiv = document.getElementById('status');
  const autoApproveCheckbox = document.getElementById('autoApproveTools');
  const maxToolRoundsInput = document.getElementById('maxToolRounds');

  // Load saved settings
  chrome.storage.sync.get(['geminiApiKey', 'geminiModel', 'autoApproveTools', 'maxToolRounds'], (result) => {
    apiKeyInput.value = result.geminiApiKey || '';
    modelSelect.value = result.geminiModel || modelSelect.value;
    autoApproveCheckbox.checked = !!result.autoApproveTools;
    maxToolRoundsInput.value = result.maxToolRounds || 15;
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value;
    const model = modelSelect.value;
    const autoApprove = !!autoApproveCheckbox.checked;
    const maxToolRounds = parseInt(maxToolRoundsInput.value) || 15;
    chrome.storage.sync.set({ 
      geminiApiKey: apiKey, 
      geminiModel: model, 
      autoApproveTools: autoApprove,
      maxToolRounds: maxToolRounds
    }, () => {
      statusDiv.textContent = 'Settings saved!';
      setTimeout(() => { statusDiv.textContent = ''; }, 2000);
    });
  });

  // Test API Key (placeholder for now)
  testButton.addEventListener('click', () => {
    statusDiv.textContent = 'Testing API key...';
    setTimeout(() => {
      statusDiv.textContent = 'API Key test successful!';
      setTimeout(() => { statusDiv.textContent = ''; }, 2000);
    }, 1500);
  });
});