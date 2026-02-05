// Content script for GitHub PR pages

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'GET_FILES':
      sendResponse({ files: getFileList() });
      break;

    case 'PARSE_READING_ORDER':
      sendResponse({ order: parseReadingOrder() });
      break;

    case 'APPLY_ORDER':
      applyOrder(request.order);
      sendResponse({ success: true });
      break;
  }
  return true;
});

// Get list of files from the Files changed tab
function getFileList() {
  const files = [];

  // Try different selectors for GitHub's file list
  // The structure can vary between different GitHub versions
  const fileElements = document.querySelectorAll('[data-file-path]');

  if (fileElements.length > 0) {
    fileElements.forEach(el => {
      const path = el.getAttribute('data-file-path');
      if (path && !files.includes(path)) {
        files.push(path);
      }
    });
  }

  // Alternative: copilot-diff-entry elements
  if (files.length === 0) {
    const diffEntries = document.querySelectorAll('copilot-diff-entry');
    diffEntries.forEach(el => {
      const path = el.getAttribute('data-file-path');
      if (path && !files.includes(path)) {
        files.push(path);
      }
    });
  }

  // Alternative: file headers with aria-label
  if (files.length === 0) {
    const fileHeaders = document.querySelectorAll('.file-header[data-path]');
    fileHeaders.forEach(el => {
      const path = el.getAttribute('data-path');
      if (path && !files.includes(path)) {
        files.push(path);
      }
    });
  }

  return files;
}

// Parse Reading Order from PR description
function parseReadingOrder() {
  // Find PR description body
  const prBody = document.querySelector('.js-comment-body');
  if (!prBody) return [];

  const text = prBody.innerText || prBody.textContent;

  // Find "## Reading Order" section
  const readingOrderMatch = text.match(/##\s*Reading\s*Order\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!readingOrderMatch) return [];

  const section = readingOrderMatch[1];

  // Extract file paths from numbered list or bullet points
  const lines = section.split('\n');
  const files = [];

  for (const line of lines) {
    // Match patterns like:
    // 1. path/to/file.ts
    // - path/to/file.ts
    // * path/to/file.ts
    // path/to/file.ts
    const match = line.match(/^[\s]*(?:\d+\.|[-*])?\s*`?([^\s`]+\.[a-z]+)`?\s*$/i);
    if (match) {
      files.push(match[1]);
    }
  }

  return files;
}

// Apply custom order to the file list DOM
function applyOrder(order) {
  // Find the container for file diffs
  const container = document.querySelector('#files');
  if (!container) {
    console.warn('PR File Order: Could not find files container');
    return;
  }

  // Get all file diff elements
  const fileElements = [];

  // Try different selectors
  const selectors = [
    'copilot-diff-entry',
    '.file[data-file-path]',
    'div[data-file-path]'
  ];

  for (const selector of selectors) {
    const elements = container.querySelectorAll(selector);
    if (elements.length > 0) {
      elements.forEach(el => {
        const path = el.getAttribute('data-file-path');
        if (path) {
          fileElements.push({ path, element: el });
        }
      });
      break;
    }
  }

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
