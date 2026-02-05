// State
let files = [];
let currentPrKey = null;

// DOM Elements
const fileList = document.getElementById('file-list');
const emptyState = document.getElementById('empty-state');
const parseBtn = document.getElementById('parse-btn');
const resetBtn = document.getElementById('reset-btn');
const applyBtn = document.getElementById('apply-btn');

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes('github.com') || !tab.url.includes('/pull/')) {
    showEmptyState('Open a GitHub PR page to use this extension.');
    return;
  }

  // Extract PR key (owner/repo/pull/number)
  const match = tab.url.match(/github\.com\/([^/]+\/[^/]+\/pull\/\d+)/);
  if (!match) {
    showEmptyState('Could not detect PR.');
    return;
  }

  currentPrKey = match[1];

  // Get files from content script
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_FILES' });

  if (!response?.files?.length) {
    showEmptyState('No files found. Make sure you\'re on the "Files changed" tab.');
    return;
  }

  // Load saved order or use current order
  const savedOrder = await loadOrder(currentPrKey);
  if (savedOrder?.length) {
    // Merge: saved order first, then any new files
    const savedSet = new Set(savedOrder);
    const newFiles = response.files.filter(f => !savedSet.has(f));
    files = [...savedOrder.filter(f => response.files.includes(f)), ...newFiles];
  } else {
    files = response.files;
  }

  renderFileList();
}

function showEmptyState(message) {
  fileList.style.display = 'none';
  emptyState.style.display = 'block';
  emptyState.textContent = message;
  parseBtn.disabled = true;
  resetBtn.disabled = true;
  applyBtn.disabled = true;
}

function renderFileList() {
  if (!files.length) {
    showEmptyState('No files found.');
    return;
  }

  fileList.style.display = 'block';
  emptyState.style.display = 'none';
  fileList.innerHTML = '';

  files.forEach((file, index) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.file = file;

    // Split path and filename
    const lastSlash = file.lastIndexOf('/');
    const path = lastSlash > 0 ? file.substring(0, lastSlash + 1) : '';
    const name = lastSlash > 0 ? file.substring(lastSlash + 1) : file;

    li.innerHTML = `
      <span class="drag-handle">⋮⋮</span>
      <span class="order-number">${index + 1}</span>
      <span class="file-name">
        <span class="path">${path}</span><span class="name">${name}</span>
      </span>
    `;

    // Drag events
    li.addEventListener('dragstart', handleDragStart);
    li.addEventListener('dragend', handleDragEnd);
    li.addEventListener('dragover', handleDragOver);
    li.addEventListener('drop', handleDrop);
    li.addEventListener('dragleave', handleDragLeave);

    fileList.appendChild(li);
  });
}

// Drag and Drop handlers
let draggedItem = null;

function handleDragStart(e) {
  draggedItem = this;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragEnd() {
  this.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  draggedItem = null;
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  if (this !== draggedItem) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave() {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');

  if (this === draggedItem) return;

  const fromFile = draggedItem.dataset.file;
  const toFile = this.dataset.file;

  const fromIndex = files.indexOf(fromFile);
  const toIndex = files.indexOf(toFile);

  // Reorder
  files.splice(fromIndex, 1);
  files.splice(toIndex, 0, fromFile);

  // Save and re-render
  saveOrder(currentPrKey, files);
  renderFileList();
}

// Parse Reading Order from PR description
parseBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'PARSE_READING_ORDER' });

  if (response?.order?.length) {
    // Filter to only include files that exist in the PR
    const existingFiles = new Set(files);
    const orderedFiles = response.order.filter(f => existingFiles.has(f));
    const remainingFiles = files.filter(f => !response.order.includes(f));

    files = [...orderedFiles, ...remainingFiles];
    saveOrder(currentPrKey, files);
    renderFileList();
  } else {
    alert('No "## Reading Order" section found in PR description.');
  }
});

// Reset to alphabetical order
resetBtn.addEventListener('click', () => {
  files.sort();
  saveOrder(currentPrKey, files);
  renderFileList();
});

// Apply order to GitHub
applyBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.tabs.sendMessage(tab.id, { type: 'APPLY_ORDER', order: files });
  window.close();
});

// Storage helpers
async function saveOrder(prKey, order) {
  await chrome.storage.local.set({ [prKey]: order });
}

async function loadOrder(prKey) {
  const result = await chrome.storage.local.get(prKey);
  return result[prKey] || null;
}
