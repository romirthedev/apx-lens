document.getElementById('openPanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html' });
  window.close();
});
document.getElementById('askSelection').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.sidePanel.open({ tabId: tab.id });
  await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidepanel.html' });
  chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_SELECTION' });
  window.close();
});