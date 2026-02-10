// Background service worker — handles fetch requests from content script.
// Runs in extension context (no page CSP restrictions).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FETCH_TEXT') {
    fetch(request.url, { credentials: 'include', redirect: 'follow' })
      .then(r => r.text())
      .then(text => sendResponse({ text }))
      .catch(err => sendResponse({ error: err.message }));
    return true; // keep channel open for async
  }
});
