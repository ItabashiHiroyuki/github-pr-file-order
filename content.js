// Content script for GitHub PR pages

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'GET_FILES':
      getAllFiles().then(files => sendResponse({ files }));
      return true; // keep channel open for async response

    case 'PARSE_READING_ORDER':
      parseReadingOrder().then(guide => {
        // Return both `order` (for popup.js backward compat) and full `guide`
        sendResponse({ order: guide.fileOrder, guide });
      });
      return true; // keep channel open for async response

    case 'APPLY_ORDER':
      applyOrder(request.order).then(() => {
        showNotification(`Reordered ${request.order.length} files`);
        sendResponse({ success: true });
      });
      return true; // keep channel open for async

    case 'APPLY_GUIDE':
      if (request.guide && typeof window.applyReadingGuide === 'function') {
        window.applyReadingGuide(request.guide);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false });
      }
      return true;
  }
  return true;
});

// Strip Unicode control characters (e.g. U+200E left-to-right mark)
function cleanPath(str) {
  return str.replace(/[\u200E\u200F\u200B\u200C\u200D\uFEFF]/g, '').trim();
}

// Get file path from a diff section element
function getFilePathFromDiffElement(el) {
  // 1. Try data-file-path attribute (works on both old and new GitHub UI)
  const fpEl = el.querySelector('[data-file-path]');
  if (fpEl) return fpEl.getAttribute('data-file-path');

  // 2. Try aria-label on buttons (new UI: "Expand all lines: path/to/file")
  const expandBtn = el.querySelector('button[aria-label^="Expand all lines:"]');
  if (expandBtn) {
    const label = expandBtn.getAttribute('aria-label');
    const match = label.match(/^Expand all lines:\s*(.+)/);
    if (match) return match[1].trim();
  }

  // 3. Try link text containing file path (for new files)
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

  // Primary: use data-file-path elements.
  // In the 2025+ GitHub UI, data-file-path is on <copilot-diff-entry> which
  // WRAPS the div[id^="diff-"]. In older UI it was on a child element inside
  // the diff div. We handle both cases.
  document.querySelectorAll('[data-file-path]').forEach(el => {
    const path = el.getAttribute('data-file-path');
    if (!path || seen.has(path)) return;

    // New UI: el IS the copilot-diff-entry wrapper (parent of the diff div)
    if (el.tagName === 'COPILOT-DIFF-ENTRY') {
      seen.add(path);
      results.push({ path, element: el });
      return;
    }

    // Old UI: el is inside a diff div, navigate up
    const diffEl = el.closest('[id^="diff-"]');
    if (diffEl) {
      seen.add(path);
      results.push({ path, element: diffEl });
    }
  });

  // Fallback: old method using [id^="diff-"] directly
  if (results.length === 0) {
    document.querySelectorAll('[id^="diff-"]').forEach(el => {
      if (el.id === 'diff-comparison-viewer-container' || el.id === 'diff-file-tree-filter') return;

      const path = getFilePathFromDiffElement(el);
      if (path && !seen.has(path)) {
        seen.add(path);
        results.push({ path, element: el });
      }
    });
  }

  return results;
}

// Get list of files (synchronous, best-effort from DOM)
function getFileList() {
  // Try file tree sidebar first
  const treeNodes = document.querySelectorAll(
    '[data-tree-entry-type="file"][data-target="file-tree.fileTreeNode"]'
  );
  if (treeNodes.length > 0) {
    const paths = [];
    treeNodes.forEach(node => {
      const pathEl = node.querySelector('[data-filterable-item-text]');
      if (pathEl) {
        const path = pathEl.textContent.trim();
        if (path) paths.push(path);
      }
    });
    if (paths.length > 0) return paths;
  }

  // Fallback: diff elements in the DOM
  return getFileDiffElements().map(({ path }) => path);
}

// Fetch complete file list by parsing the /files page HTML.
// The server-rendered HTML always contains the full file-tree,
// even when the live DOM hasn't lazy-loaded all diff entries yet.
async function fetchFileListFromHTML() {
  const urlMatch = window.location.href.match(/github\.com\/([^/]+\/[^/]+\/pull\/\d+)/);
  if (!urlMatch) {
    console.warn('PR File Order: URL does not match PR pattern:', window.location.href);
    return [];
  }

  const filesUrl = `https://github.com/${urlMatch[1]}/files`;
  console.log('PR File Order: fetching', filesUrl);
  const response = await fetch(filesUrl);
  const html = await response.text();
  console.log('PR File Order: fetched HTML, length:', html.length);

  // Parse file paths from raw HTML using regex.
  // DOMParser doesn't work here because GitHub renders the file tree
  // client-side — the server HTML contains the markup but DOMParser
  // doesn't execute the custom element upgrade.
  // The file tree items have: data-filterable-item-text>FULL/PATH<
  const matches = [...html.matchAll(/data-filterable-item-text[^>]*>\s*([^\s<][^<]*?)\s*</g)];
  const seen = new Set();
  const paths = [];
  for (const m of matches) {
    const path = m[1].trim();
    // Filter: must look like a file path (has extension or slash)
    if (path && !seen.has(path) && (path.includes('/') || /\.\w+$/.test(path))) {
      seen.add(path);
      paths.push(path);
    }
  }
  console.log('PR File Order: files from HTML regex:', paths.length);
  if (paths.length > 0) return paths;

  // Fallback: data-file-path="..." in raw HTML
  const fpMatches = [...html.matchAll(/data-file-path="([^"]+)"/g)];
  const fpPaths = [...new Set(fpMatches.map(m => m[1]))];
  console.log('PR File Order: files from data-file-path regex:', fpPaths.length);
  return fpPaths;
}

// Get complete file list. Uses the .diff URL via the background service worker
// to bypass CSP restrictions. This is the most reliable method as it works
// for any repo type (public/private) and doesn't depend on DOM state.
async function getAllFiles() {
  // First try DOM (might already have everything)
  const domFiles = getFileList();
  console.log('PR File Order: DOM files:', domFiles.length);

  // Fetch .diff via background service worker for the complete list
  try {
    const diffFiles = await fetchFileListFromDiff();
    console.log('PR File Order: .diff files:', diffFiles.length);
    if (diffFiles.length > 0) return diffFiles;
  } catch (e) {
    console.warn('PR File Order: .diff fetch failed:', e.message);
  }

  return domFiles;
}

// Fetch complete file list by parsing the PR .diff via background service worker
async function fetchFileListFromDiff() {
  const urlMatch = window.location.href.match(/github\.com\/([^/]+\/[^/]+\/pull\/\d+)/);
  if (!urlMatch) return [];

  const diffUrl = `https://github.com/${urlMatch[1]}.diff`;
  const response = await chrome.runtime.sendMessage({ type: 'FETCH_TEXT', url: diffUrl });

  if (response.error) throw new Error(response.error);

  const files = [];
  const seen = new Set();
  const regex = /^diff --git a\/(.+) b\//gm;
  let match;
  while ((match = regex.exec(response.text)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      files.push(match[1]);
    }
  }
  return files;
}

// Parse Reading Order from PR description.
// Returns { fileOrder: string[], comments: Map } using the new table-aware parser.
// Falls back to legacy list format if no table is found.
async function parseReadingOrder() {
  const urlMatch = window.location.href.match(/github\.com\/([^/]+\/[^/]+\/pull\/\d+)/);
  if (!urlMatch) return { fileOrder: [], comments: new Map() };

  // Fetch PR conversation page via background service worker
  const prUrl = `https://github.com/${urlMatch[1]}`;
  let html;
  try {
    const bgResponse = await chrome.runtime.sendMessage({ type: 'FETCH_TEXT', url: prUrl });
    if (bgResponse.error) throw new Error(bgResponse.error);
    html = bgResponse.text;
  } catch (e) {
    // Fallback to direct fetch
    const response = await fetch(prUrl);
    html = await response.text();
  }

  // Use the new parser (table-first, legacy fallback)
  if (typeof window.parseReadingGuideFromHTML === 'function') {
    const guide = window.parseReadingGuideFromHTML(html);
    console.log('PR File Order: parsed reading guide:', guide.fileOrder.length, 'files,',
      guide.comments.size, 'files with comments');
    return guide;
  }

  // Fallback: old regex-based parsing (should not reach here if parse.js is loaded)
  console.warn('PR File Order: parseReadingGuideFromHTML not available, using fallback');
  const roMatch = html.match(/[Rr]eading\s*[Oo]rder/);
  if (!roMatch) {
    console.log('PR File Order: no "Reading Order" found in PR description');
    return { fileOrder: [], comments: new Map() };
  }

  const afterRO = html.substring(roMatch.index);
  const codeMatches = [...afterRO.matchAll(/<code[^>]*>([^<]+)<\/code>/g)];
  const files = [];
  const seen = new Set();

  for (const m of codeMatches) {
    const text = m[1].trim();
    if (text && (text.includes('/') || /\.\w+$/.test(text)) && !seen.has(text)) {
      if (text.includes(' ') || text.startsWith('http')) continue;
      seen.add(text);
      files.push(text);
    }
  }

  console.log('PR File Order: parsed reading order (legacy):', files.length, 'files');
  return { fileOrder: files, comments: new Map() };
}

// Compute SHA-256 hash of a string (GitHub uses this for diff element IDs)
async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Find the nearest common ancestor of multiple elements
function findCommonAncestor(elements) {
  if (elements.length === 0) return null;
  if (elements.length === 1) return elements[0].parentNode;

  let ancestor = elements[0].parentNode;
  while (ancestor) {
    if (elements.every(el => ancestor.contains(el))) return ancestor;
    ancestor = ancestor.parentNode;
  }
  return document.body;
}

// Inject or update a <style> element with CSS rules for ordering.
// Using a <style> tag instead of inline styles so the ordering survives
// React re-renders that replace DOM elements.
function injectOrderStyles(css) {
  let styleEl = document.getElementById('pr-file-order-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'pr-file-order-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

// Track the last applied order and guide so we can re-apply when new files appear
let lastAppliedOrder = null;
let lastAppliedGuide = null;
let lastKnownFileCount = 0;

// Apply custom order to the file list DOM
// Uses CSS order property via <style> injection to avoid breaking
// GitHub's lazy-loading / content-visibility and to survive React re-renders.
// Precomputes SHA-256 diff IDs for ALL files so rules apply even before
// files are loaded into the DOM.
async function applyOrder(order) {
  lastAppliedOrder = order;
  await regenerateOrderCSS();
}

// (Re)generate CSS rules for ALL files in the order.
// Supports both new UI (copilot-diff-entry) and old UI (div[id^="diff-"]).
async function regenerateOrderCSS() {
  const order = lastAppliedOrder;
  if (!order) return;

  const fileElements = getFileDiffElements();
  if (fileElements.length === 0) {
    console.warn('PR File Order: No file elements found');
    return;
  }

  lastKnownFileCount = fileElements.length;

  const isNewUI = fileElements[0].element.tagName === 'COPILOT-DIFF-ENTRY';

  let css = '';

  if (isNewUI) {
    // New UI (2025+): files are <copilot-diff-entry> elements spread across
    // multiple .js-diff-progressive-container divs inside #files.
    // Use display:contents on the intermediate containers so all entries
    // become direct flex items of #files.
    const filesContainer = document.getElementById('files');
    if (filesContainer) {
      filesContainer.setAttribute('data-pr-file-order', '');
    }

    css += '#files[data-pr-file-order] { display: flex !important; flex-direction: column !important; }\n';
    css += '#files[data-pr-file-order] > .js-diff-progressive-container { display: contents !important; }\n';
    css += '#files[data-pr-file-order] > :not(.js-diff-progressive-container) { order: -1 !important; }\n';
    css += '#files[data-pr-file-order] copilot-diff-entry { display: block !important; order: 99999 !important; }\n';

    for (let i = 0; i < order.length; i++) {
      // Escape for CSS attribute value (inside double quotes): only " and \ need escaping
      const escaped = order[i].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      // Include #files to match specificity of the default rule above
      css += `#files copilot-diff-entry[data-file-path="${escaped}"] { order: ${i} !important; }\n`;
    }
  } else {
    // Old UI: diff elements are direct siblings or wrapped in divs.
    const firstEl = fileElements[0].element;
    const allSameParent = fileElements.length === 1 ||
      fileElements.every(({ element }) => element.parentNode === firstEl.parentNode);

    const flexContainer = allSameParent
      ? firstEl.parentNode
      : findCommonAncestor(fileElements.map(({ element }) => element));

    flexContainer.setAttribute('data-pr-file-order', '');

    css += '[data-pr-file-order] { display: flex !important; flex-direction: column !important; }\n';
    css += '[data-pr-file-order] > * { order: 99999 !important; }\n';

    for (let i = 0; i < order.length; i++) {
      const hash = await sha256(order[i]);
      const diffId = `diff-${hash}`;

      if (allSameParent) {
        css += `#${CSS.escape(diffId)} { order: ${i} !important; }\n`;
      } else {
        css += `[data-pr-file-order] > :has(#${CSS.escape(diffId)}) { order: ${i} !important; }\n`;
      }
    }
  }

  injectOrderStyles(css);
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

// Auto-apply order on page load: saved order first, then try parsing from PR
async function autoApplyOrder() {
  const match = window.location.href.match(/github\.com\/([^/]+\/[^/]+\/pull\/\d+)/);
  if (!match) return;

  await waitForFiles();

  const prKey = match[1];
  const result = await chrome.storage.local.get(prKey);
  const savedOrder = result[prKey];

  if (savedOrder?.length) {
    applyOrder(savedOrder);
    // Still parse guide for inline comments (saved order doesn't include comments)
    parseReadingOrder().then(guide => {
      if (guide?.comments?.size > 0 && typeof window.applyReadingGuide === 'function') {
        lastAppliedGuide = guide;
        window.applyReadingGuide(guide);
      }
    });
    return;
  }

  // No saved order — try parsing Reading Order from PR description
  const guide = await parseReadingOrder();
  if (guide?.fileOrder?.length) {
    await chrome.storage.local.set({ [prKey]: guide.fileOrder });
    applyOrder(guide.fileOrder);

    // Also inject inline reading guide comments if available
    if (guide.comments && guide.comments.size > 0 && typeof window.applyReadingGuide === 'function') {
      lastAppliedGuide = guide;
      window.applyReadingGuide(guide);
    }
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

// Also handle GitHub's SPA navigation and lazy-loaded files
let lastUrl = location.href;
let fileCheckTimer = null;
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastAppliedOrder = null;
    lastAppliedGuide = null;
    lastKnownFileCount = 0;
    autoApplyOrder();
    return;
  }

  // When new files lazy-load or diff rows expand, regenerate CSS rules and re-inject guide.
  // Debounce to avoid excessive checks.
  if (!lastAppliedOrder && !lastAppliedGuide) return;
  if (fileCheckTimer) clearTimeout(fileCheckTimer);
  fileCheckTimer = setTimeout(() => {
    const currentCount = document.querySelectorAll('[data-file-path]').length;
    const fileCountChanged = currentCount !== lastKnownFileCount;

    if (fileCountChanged && lastAppliedOrder) {
      regenerateOrderCSS();
    }

    // Re-inject reading guide when new files appear OR diff rows expand (Expand button).
    // We always re-inject on any mutation because expanded rows reveal new line numbers
    // that may match guide comments. removeExistingGuides() + re-inject is cheap.
    if (lastAppliedGuide && typeof window.applyReadingGuide === 'function') {
      window.applyReadingGuide(lastAppliedGuide);
    }
  }, 300);
});

observer.observe(document.body, { childList: true, subtree: true });
