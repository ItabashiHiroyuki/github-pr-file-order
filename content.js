// Content script for GitHub PR pages

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'GET_FILES':
      sendResponse({ files: getFileList() });
      break;

    case 'PARSE_READING_ORDER':
      parseReadingOrder().then(order => sendResponse({ order }));
      return true; // keep channel open for async response

    case 'APPLY_ORDER':
      applyOrder(request.order);
      sendResponse({ success: true });
      break;
  }
  return true;
});

// Strip Unicode control characters (e.g. U+200E left-to-right mark)
function cleanPath(str) {
  return str.replace(/[\u200E\u200F\u200B\u200C\u200D\uFEFF]/g, '').trim();
}

// Get file path from a diff section element
function getFilePathFromDiffElement(el) {
  // 1. Try data-file-path attribute
  const fpEl = el.querySelector('[data-file-path]');
  if (fpEl) return fpEl.getAttribute('data-file-path');

  // 2. Try link text containing file path (for new files)
  const links = el.querySelectorAll('a');
  for (const a of links) {
    const text = cleanPath(a.textContent);
    if (text.includes('/') && /\.\w+$/.test(text)) {
      return text;
    }
  }

  return null;
}

// Get all diff section elements with their file paths
function getFileDiffElements() {
  const results = [];
  const seen = new Set();

  document.querySelectorAll('[id^="diff-"]').forEach(el => {
    // Skip non-file elements
    if (el.id === 'diff-comparison-viewer-container' || el.id === 'diff-file-tree-filter') return;

    const path = getFilePathFromDiffElement(el);
    if (path && !seen.has(path)) {
      seen.add(path);
      results.push({ path, element: el });
    }
  });

  return results;
}

// Get list of files from the Files changed tab
function getFileList() {
  return getFileDiffElements().map(({ path }) => path);
}

// Parse Reading Order from PR description (fetches PR page)
async function parseReadingOrder() {
  const urlMatch = window.location.href.match(/github\.com\/([^/]+\/[^/]+\/pull\/\d+)/);
  if (!urlMatch) return [];

  // Fetch PR conversation page to get description
  const prUrl = `https://github.com/${urlMatch[1]}`;
  const response = await fetch(prUrl);
  const html = await response.text();

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Find PR description body
  const prBody = doc.querySelector('.js-comment-body');
  if (!prBody) return [];

  // Find "Reading Order" heading (h2) and collect file paths from the following list
  const headings = prBody.querySelectorAll('h2, h3');
  let readingOrderHeading = null;

  for (const h of headings) {
    if (/reading\s*order/i.test(h.textContent)) {
      readingOrderHeading = h;
      break;
    }
  }

  if (!readingOrderHeading) return [];

  // Collect list items after the heading
  const files = [];
  let sibling = readingOrderHeading.nextElementSibling;

  while (sibling) {
    // Stop at the next heading
    if (/^H[1-6]$/.test(sibling.tagName)) break;

    // Extract file paths from <li> elements in <ol> or <ul>
    if (sibling.tagName === 'OL' || sibling.tagName === 'UL') {
      const items = sibling.querySelectorAll('li');
      for (const li of items) {
        // Try <code> tag first (backtick-wrapped paths)
        const code = li.querySelector('code');
        const text = code ? code.textContent.trim() : li.textContent.trim();

        // Extract file path
        const match = text.match(/^([^\s]+\.\w+)/);
        if (match) {
          files.push(match[1]);
        }
      }
    }

    sibling = sibling.nextElementSibling;
  }

  return files;
}

// Apply custom order to the file list DOM
function applyOrder(order) {
  const fileElements = getFileDiffElements();

  if (fileElements.length === 0) {
    console.warn('PR File Order: No file elements found');
    return;
  }

  // Create a map for quick lookup
  const elementMap = new Map();
  fileElements.forEach(({ path, element }) => {
    elementMap.set(path, element);
  });

  // Create ordered array
  const orderedElements = [];

  // Add files in specified order
  for (const path of order) {
    const element = elementMap.get(path);
    if (element) {
      orderedElements.push(element);
      elementMap.delete(path);
    }
  }

  // Add any remaining files (not in order list)
  elementMap.forEach(element => {
    orderedElements.push(element);
  });

  // Reorder DOM
  const parent = fileElements[0].element.parentNode;

  orderedElements.forEach(element => {
    parent.appendChild(element);
  });

  // Show notification
  showNotification(`Reordered ${orderedElements.length} files`);
}

// Show a temporary notification
function showNotification(message) {
  const existing = document.querySelector('.pr-file-order-notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = 'pr-file-order-notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

// Auto-apply saved order on page load
async function autoApplyOrder() {
  const match = window.location.href.match(/github\.com\/([^/]+\/[^/]+\/pull\/\d+)/);
  if (!match) return;

  const prKey = match[1];
  const result = await chrome.storage.local.get(prKey);
  const savedOrder = result[prKey];

  if (savedOrder?.length) {
    // Wait for GitHub to finish loading files
    await waitForFiles();
    applyOrder(savedOrder);
  }
}

// Wait for file elements to be loaded
function waitForFiles(timeout = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();

    const check = () => {
      const files = getFileList();
      if (files.length > 0) {
        resolve(files);
      } else if (Date.now() - start > timeout) {
        resolve([]);
      } else {
        setTimeout(check, 200);
      }
    };

    check();
  });
}

// Run auto-apply when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoApplyOrder);
} else {
  autoApplyOrder();
}

// Also handle GitHub's SPA navigation
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      const filesContainer = document.querySelector('#files');
      if (filesContainer) {
        autoApplyOrder();
        break;
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
