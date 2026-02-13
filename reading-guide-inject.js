/**
 * @typedef {Object} GuideAnchor
 * @property {string} filePath
 * @property {Element} fileEntryEl
 * @property {Element|null} headerEl
 * @property {Element|null} diffTableEl
 */

/**
 * Normalize a file path using parser-provided helper when available.
 * @param {string} filePath
 * @returns {string}
 */
function normalizeGuidePath(filePath) {
  if (typeof window.normalizePath === 'function') {
    return window.normalizePath(filePath || '');
  }
  return String(filePath || '').trim();
}

/**
 * Resolve the side marker from comment data.
 * @param {string|null|undefined} side
 * @returns {'L'|'R'}
 */
function normalizeGuideSide(side) {
  return String(side || 'R').toUpperCase() === 'L' ? 'L' : 'R';
}

/**
 * Pick a likely header element for a copilot-diff-entry.
 * @param {Element} fileEntryEl
 * @param {string} filePath
 * @returns {Element|null}
 */
function findCopilotHeader(fileEntryEl, filePath) {
  if (!fileEntryEl) return null;

  var explicit = fileEntryEl.querySelector('.file-header, .js-file-header');
  if (explicit) return explicit;

  var normalized = normalizeGuidePath(filePath);
  var children = Array.from(fileEntryEl.children || []);
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var text = normalizeGuidePath(child.textContent || '');
    if (text && normalized && text.indexOf(normalized) !== -1) {
      return child;
    }
  }

  var descendantCandidates = Array.from(fileEntryEl.querySelectorAll('summary, header, div, h2, h3, h4'));
  for (var j = 0; j < descendantCandidates.length; j++) {
    var candidate = descendantCandidates[j];
    var candidateText = normalizeGuidePath(candidate.textContent || '');
    if (candidateText && normalized && candidateText.indexOf(normalized) !== -1) {
      return candidate;
    }
  }

  return fileEntryEl.firstElementChild || null;
}

/**
 * Build diff anchors for all files currently present in the DOM.
 * @returns {GuideAnchor[]}
 */
function buildGuideAnchors() {
  var anchors = [];
  var seen = new Set();
  var filePathEls = document.querySelectorAll('[data-file-path]');

  filePathEls.forEach(function (pathEl) {
    var filePath = pathEl.getAttribute('data-file-path');
    if (!filePath) return;

    var fileEntryEl = null;
    var headerEl = null;
    var diffTableEl = null;

    if (pathEl.tagName === 'COPILOT-DIFF-ENTRY') {
      fileEntryEl = pathEl;
      headerEl = findCopilotHeader(fileEntryEl, filePath);
      diffTableEl = fileEntryEl.querySelector('table');
    } else {
      var oldDiff = pathEl.closest('div[id^="diff-"]');
      if (!oldDiff) return;

      var ownerCopilot = oldDiff.closest('copilot-diff-entry');
      if (ownerCopilot && ownerCopilot.getAttribute('data-file-path')) {
        fileEntryEl = ownerCopilot;
        headerEl = findCopilotHeader(fileEntryEl, filePath);
        diffTableEl = fileEntryEl.querySelector('table');
      } else {
        fileEntryEl = oldDiff;
        headerEl = fileEntryEl.querySelector('.file-header, .js-file-header');
        diffTableEl = fileEntryEl.querySelector('table');
      }
    }

    if (!fileEntryEl) return;

    var key = normalizeGuidePath(filePath) + '::' + (fileEntryEl.id || 'no-id') + '::' + fileEntryEl.tagName;
    if (seen.has(key)) return;
    seen.add(key);

    anchors.push({
      filePath: filePath,
      fileEntryEl: fileEntryEl,
      headerEl: headerEl,
      diffTableEl: diffTableEl || null
    });
  });

  return anchors;
}

/**
 * Infer side (L/R) for a line-number cell in a row.
 * @param {Element} cell
 * @param {Element} row
 * @returns {'L'|'R'|null}
 */
function inferCellSide(cell, row) {
  if (!cell || !row) return null;

  var baseCell = cell.tagName === 'TD' ? cell : (cell.closest && cell.closest('td')) || cell;
  var classText = ((baseCell.className || '') + ' ' + (baseCell.getAttribute && baseCell.getAttribute('data-side') || '')).toLowerCase();
  if (classText.indexOf('left') !== -1 || classText.indexOf('deletion') !== -1 || classText.indexOf('old') !== -1) {
    return 'L';
  }
  if (classText.indexOf('right') !== -1 || classText.indexOf('addition') !== -1 || classText.indexOf('new') !== -1) {
    return 'R';
  }

  var lineCells = Array.from(row.querySelectorAll('td[data-line-number]'));
  if (lineCells.length >= 2) {
    if (lineCells[0] === baseCell) return 'L';
    if (lineCells[1] === baseCell) return 'R';
  }

  return null;
}

/**
 * Pick the best-matching row from candidates by side preference.
 * @param {Array<{row: Element, cell: Element}>} candidates
 * @param {'L'|'R'} side
 * @returns {Element|null}
 */
function chooseCandidateRow(candidates, side) {
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0].row;

  var preferred = null;
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    var inferred = inferCellSide(candidate.cell, candidate.row);
    if (inferred === side) return candidate.row;
    if (!preferred && inferred === null) {
      preferred = candidate.row;
    }
  }

  return preferred || candidates[0].row;
}

/**
 * Find a diff row for the requested line/side in new or old GitHub UI.
 * @param {GuideAnchor} anchor
 * @param {number} lineNumber
 * @param {'L'|'R'} side
 * @returns {Element|null}
 */
function findDiffLine(anchor, lineNumber, side) {
  if (!anchor || !anchor.fileEntryEl || lineNumber == null) return null;

  var normalizedSide = normalizeGuideSide(side);
  var table = anchor.diffTableEl || anchor.fileEntryEl.querySelector('table');
  if (!table) return null;

  anchor.diffTableEl = table;

  var selector = 'td[data-line-number="' + lineNumber + '"], button[data-line-number="' + lineNumber + '"]';
  var cells = table.querySelectorAll(selector);
  var candidates = [];

  cells.forEach(function (cell) {
    var row = cell.closest('tr');
    if (row) {
      candidates.push({ row: row, cell: cell });
    }
  });

  if (anchor.fileEntryEl.tagName === 'COPILOT-DIFF-ENTRY') {
    return chooseCandidateRow(candidates, normalizedSide);
  }

  if (anchor.fileEntryEl.matches('div[id^="diff-"]')) {
    return chooseCandidateRow(candidates, normalizedSide);
  }

  return null;
}

/**
 * Compute an inline row key.
 * @param {string} filePath
 * @param {'L'|'R'} side
 * @param {number} line
 * @returns {string}
 */
function buildInlineKey(filePath, side, line) {
  return filePath + ':' + normalizeGuideSide(side) + String(line);
}

/**
 * Insert one inline reading guide row after a target diff row.
 * @param {GuideAnchor} anchor
 * @param {Element} targetRow
 * @param {{line: number, side: 'L'|'R', text: string}} comment
 */
function insertInlineGuideRow(anchor, targetRow, comment) {
  if (!anchor || !targetRow || !comment) return;

  var key = buildInlineKey(anchor.filePath, comment.side, comment.line);
  if (document.querySelector('[data-reading-guide-key="' + CSS.escape(key) + '"]')) {
    return;
  }

  var table = targetRow.closest('table') || anchor.diffTableEl;
  var tdCount = targetRow.querySelectorAll('td').length;
  if (!tdCount && table) {
    var rows = table.querySelectorAll('tr');
    var firstDataRow = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].querySelector('td')) {
        firstDataRow = rows[i];
        break;
      }
    }
    tdCount = firstDataRow ? firstDataRow.querySelectorAll('td').length : 1;
  }
  tdCount = tdCount || 1;

  var guideRow = document.createElement('tr');
  guideRow.className = 'reading-guide-row';
  guideRow.setAttribute('data-reading-guide-key', key);

  var guideCell = document.createElement('td');
  guideCell.className = 'reading-guide-inline';
  guideCell.setAttribute('colspan', String(tdCount));

  var content = document.createElement('div');
  content.className = 'reading-guide-content';

  var label = document.createElement('span');
  label.className = 'reading-guide-label';
  label.textContent = '📖 Reading Guide (' + normalizeGuideSide(comment.side) + String(comment.line) + ')';

  var text = document.createElement('span');
  text.className = 'reading-guide-text';
  text.innerHTML = String(comment.text || '');

  content.appendChild(label);
  content.appendChild(text);
  guideCell.appendChild(content);
  guideRow.appendChild(guideCell);

  var parent = targetRow.parentNode;
  if (!parent) return;
  parent.insertBefore(guideRow, targetRow.nextSibling);
}

/**
 * Insert a header banner for comments that cannot be shown inline.
 * @param {GuideAnchor} anchor
 * @param {Array<{line: number|null, side: 'L'|'R', text: string, unfound?: boolean}>} bannerComments
 */
function injectHeaderBanner(anchor, bannerComments) {
  if (!anchor || !anchor.fileEntryEl || !Array.isArray(bannerComments) || bannerComments.length === 0) {
    return;
  }

  var bannerKey = anchor.filePath + ':banner';
  if (document.querySelector('[data-reading-guide-key="' + CSS.escape(bannerKey) + '"]')) {
    return;
  }

  var banner = document.createElement('div');
  banner.className = 'reading-guide-banner';
  banner.setAttribute('data-reading-guide-key', bannerKey);

  var content = document.createElement('div');
  content.className = 'reading-guide-content';

  var label = document.createElement('span');
  label.className = 'reading-guide-label';
  label.textContent = '📖 Reading Guide';
  content.appendChild(label);

  bannerComments.forEach(function (comment) {
    if (comment.text) {
      var text = document.createElement('div');
      text.className = 'reading-guide-text';
      text.innerHTML = String(comment.text);
      content.appendChild(text);
    }

    if (comment.unfound && comment.line != null) {
      var fallback = document.createElement('div');
      fallback.className = 'reading-guide-text reading-guide-fallback';
      fallback.textContent =
        normalizeGuideSide(comment.side) +
        String(comment.line) +
        ': この行はdiffに表示されていません';
      content.appendChild(fallback);
    }
  });

  banner.appendChild(content);

  if (anchor.headerEl && anchor.headerEl.insertAdjacentElement) {
    anchor.headerEl.insertAdjacentElement('afterend', banner);
    return;
  }

  if (anchor.fileEntryEl.firstChild) {
    anchor.fileEntryEl.insertBefore(banner, anchor.fileEntryEl.firstChild.nextSibling);
  } else {
    anchor.fileEntryEl.appendChild(banner);
  }
}

/**
 * Insert all reading guide comments inline when line anchors are found.
 * Falls back to per-file header banners for comments without visible anchors.
 * @param {{fileOrder: string[], comments: Map<string, Array<{line: number|null, side: 'L'|'R', text: string}>>}} guide
 * @param {GuideAnchor[]} anchors
 */
function injectInlineComments(guide, anchors) {
  if (!guide || !guide.comments || !anchors || anchors.length === 0) return;

  var anchorByPath = new Map();
  anchors.forEach(function (anchor) {
    anchorByPath.set(normalizeGuidePath(anchor.filePath), anchor);
  });

  var commentEntries = guide.comments instanceof Map
    ? Array.from(guide.comments.entries())
    : Object.entries(guide.comments);

  commentEntries.forEach(function (entry) {
    var filePath = entry[0];
    var comments = entry[1];
    if (!Array.isArray(comments) || comments.length === 0) return;

    var anchor = anchorByPath.get(normalizeGuidePath(filePath));
    if (!anchor) return;

    var bannerComments = [];

    comments.forEach(function (rawComment) {
      if (!rawComment) return;

      var comment = {
        line: rawComment.line == null ? null : Number(rawComment.line),
        side: normalizeGuideSide(rawComment.side),
        text: String(rawComment.text || '')
      };

      if (comment.line == null || Number.isNaN(comment.line)) {
        bannerComments.push(comment);
        return;
      }

      var targetRow = findDiffLine(anchor, comment.line, comment.side);
      if (targetRow) {
        insertInlineGuideRow(anchor, targetRow, comment);
      } else {
        comment.unfound = true;
        bannerComments.push(comment);
      }
    });

    if (bannerComments.length > 0) {
      injectHeaderBanner(anchor, bannerComments);
    }
  });
}

/**
 * Remove all currently injected reading guide DOM nodes.
 */
function removeExistingGuides() {
  document.querySelectorAll('[data-reading-guide-key]').forEach(function (el) {
    el.remove();
  });
}

/**
 * Main entry point for rendering reading guide comments on the current PR diff page.
 * @param {{fileOrder: string[], comments: Map<string, Array<{line: number|null, side: 'L'|'R', text: string}>>}} guide
 */
function applyReadingGuide(guide) {
  removeExistingGuides();
  var anchors = buildGuideAnchors();
  injectInlineComments(guide, anchors);
}

window.applyReadingGuide = applyReadingGuide;
window.removeExistingGuides = removeExistingGuides;
