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
 * @param {Element|null} link
 * @returns {boolean}
 */
function isFileTreeLink(link) {
  if (!link) return false;
  return Boolean(
    link.closest('nav[aria-label="File Tree"]') ||
    link.closest('[data-target="diff-layout.fileTreeContainer"]') ||
    link.closest('[data-target*="fileTree"]')
  );
}

/**
 * @returns {Element}
 */
function getDiffAreaElement() {
  return document.querySelector('[data-target="diff-layout.mainContainer"]') ||
    document.getElementById('files') ||
    document.querySelector('.diff-view') ||
    document.querySelector('main') ||
    document.body;
}

/**
 * @param {Element} link
 * @param {Element} diffArea
 * @returns {Element|null}
 */
function findFileEntryFromLink(link, diffArea) {
  if (!link) return null;

  var directEntry = link.closest('copilot-diff-entry, div[id^="diff-"]');
  if (directEntry) return directEntry;

  var semanticBlock = link.closest('details, section, article, li');
  if (semanticBlock && semanticBlock.querySelector('table')) {
    return semanticBlock;
  }

  var current = link.parentElement;
  var depth = 0;
  while (current && current !== diffArea && current !== document.body && depth < 14) {
    if (current.querySelector('td[data-line-number], button[data-line-number], table')) {
      return current;
    }
    current = current.parentElement;
    depth += 1;
  }

  current = link.parentElement;
  depth = 0;
  while (current && current !== diffArea && current !== document.body && depth < 8) {
    if (current.parentElement && current.parentElement !== diffArea && current.parentElement.children.length > 1) {
      return current.parentElement;
    }
    current = current.parentElement;
    depth += 1;
  }

  return null;
}

/**
 * @param {Element} entryEl
 * @param {'exact'|'basename'} matchKind
 * @param {string} normalizedPath
 * @param {Element|null} diffTableEl
 * @param {Element|null} headerEl
 * @returns {number}
 */
function scoreFallbackCandidate(entryEl, matchKind, normalizedPath, diffTableEl, headerEl) {
  var score = matchKind === 'exact' ? 100 : 10;

  if (entryEl.tagName === 'COPILOT-DIFF-ENTRY') score += 60;
  if (entryEl.matches && entryEl.matches('div[id^="diff-"]')) score += 50;
  if (diffTableEl) score += 15;
  if (headerEl) score += 5;

  var attrPath = normalizeGuidePath(entryEl.getAttribute ? entryEl.getAttribute('data-file-path') : '');
  if (attrPath && attrPath === normalizedPath) {
    score += 100;
  }

  return score;
}

/**
 * Find one fallback file entry by matching file path text in the diff area.
 * @param {string} filePath
 * @param {Set<Element>} usedEntries
 * @returns {{fileEntryEl: Element, headerEl: Element|null, diffTableEl: Element|null}|null}
 */
function findFallbackAnchorByText(filePath, usedEntries) {
  var normalizedPath = normalizeGuidePath(filePath);
  if (!normalizedPath) return null;

  var basename = normalizedPath.split('/').pop() || normalizedPath;
  var diffArea = getDiffAreaElement();
  var links = diffArea.querySelectorAll('a');

  var exactCandidates = [];
  var basenameCandidates = [];

  links.forEach(function (link) {
    if (isFileTreeLink(link)) return;

    var linkText = normalizeGuidePath((link.textContent || '').trim());
    if (!linkText) return;

    var matchKind = null;
    if (linkText === normalizedPath) {
      matchKind = 'exact';
    } else if (basename && linkText === basename) {
      matchKind = 'basename';
    }
    if (!matchKind) return;

    var fileEntryEl = findFileEntryFromLink(link, diffArea);
    if (!fileEntryEl) return;
    if (usedEntries.has(fileEntryEl)) return;

    var diffTableEl = fileEntryEl.querySelector('table');
    var headerEl = fileEntryEl.querySelector('.file-header, .js-file-header');
    if (!headerEl && fileEntryEl.tagName === 'COPILOT-DIFF-ENTRY') {
      headerEl = findCopilotHeader(fileEntryEl, normalizedPath);
    }
    if (!headerEl) {
      headerEl = link.closest('summary, header, div') || fileEntryEl.firstElementChild || null;
    }

    var candidate = {
      fileEntryEl: fileEntryEl,
      headerEl: headerEl || null,
      diffTableEl: diffTableEl || null,
      matchKind: matchKind,
      score: scoreFallbackCandidate(fileEntryEl, matchKind, normalizedPath, diffTableEl, headerEl)
    };

    if (matchKind === 'exact') {
      exactCandidates.push(candidate);
    } else {
      basenameCandidates.push(candidate);
    }
  });

  var candidates = exactCandidates.length > 0 ? exactCandidates : basenameCandidates;
  if (!candidates.length) return null;

  candidates.sort(function (a, b) { return b.score - a.score; });

  return {
    fileEntryEl: candidates[0].fileEntryEl,
    headerEl: candidates[0].headerEl,
    diffTableEl: candidates[0].diffTableEl
  };
}

/**
 * Build diff anchors for files currently present in the DOM.
 * @param {string[]=} filePaths
 * @returns {GuideAnchor[]}
 */
function buildGuideAnchors(filePaths) {
  var anchors = [];
  var seen = new Set();
  var anchorByPath = new Map();
  var filePathEls = document.querySelectorAll('[data-file-path]');

  /**
   * @param {string} filePath
   * @param {Element|null} fileEntryEl
   * @param {Element|null} headerEl
   * @param {Element|null} diffTableEl
   * @returns {boolean}
   */
  function pushAnchor(filePath, fileEntryEl, headerEl, diffTableEl) {
    if (!filePath || !fileEntryEl) return false;

    var normalizedPath = normalizeGuidePath(filePath);
    if (!normalizedPath) return false;

    var key = normalizedPath + '::' + (fileEntryEl.id || 'no-id') + '::' + fileEntryEl.tagName;
    if (seen.has(key)) return false;
    seen.add(key);

    var anchor = {
      filePath: filePath,
      fileEntryEl: fileEntryEl,
      headerEl: headerEl || null,
      diffTableEl: diffTableEl || null
    };

    anchors.push(anchor);
    if (!anchorByPath.has(normalizedPath)) {
      anchorByPath.set(normalizedPath, anchor);
    }

    return true;
  }

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

    pushAnchor(filePath, fileEntryEl, headerEl, diffTableEl);
  });

  if (Array.isArray(filePaths) && filePaths.length > 0) {
    var usedEntries = new Set();
    anchors.forEach(function (anchor) {
      usedEntries.add(anchor.fileEntryEl);
    });

    filePaths.forEach(function (path) {
      var normalizedPath = normalizeGuidePath(path);
      if (!normalizedPath) return;
      if (anchorByPath.has(normalizedPath)) return;

      var fallback = findFallbackAnchorByText(path, usedEntries);
      if (!fallback) return;

      var added = pushAnchor(path, fallback.fileEntryEl, fallback.headerEl, fallback.diffTableEl);
      if (!added) return;

      usedEntries.add(fallback.fileEntryEl);
    });
  }

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
 * @param {{line: number, side: 'L'|'R', text: string, isFileLevel?: boolean}} comment
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
  label.textContent = comment.isFileLevel
    ? '📖 Reading Guide'
    : '📖 Reading Guide (' + normalizeGuideSide(comment.side) + String(comment.line) + ')';

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

    var normalizedFilePath = normalizeGuidePath(filePath);
    var anchor = anchorByPath.get(normalizedFilePath);
    if (!anchor) return;

    var bannerComments = [];

    comments.forEach(function (rawComment) {
      if (!rawComment) return;

      var comment = {
        line: rawComment.line == null ? null : Number(rawComment.line),
        side: normalizeGuideSide(rawComment.side),
        text: String(rawComment.text || ''),
        isFileLevel: false
      };

      if (comment.line == null || Number.isNaN(comment.line)) {
        comment.line = 1;
        comment.isFileLevel = true;
      }

      var targetRow = findDiffLine(anchor, comment.line, comment.side);
      if (targetRow) {
        insertInlineGuideRow(anchor, targetRow, comment);
      } else {
        if (!comment.isFileLevel) {
          comment.unfound = true;
        }
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
  var anchorTargets = guide && Array.isArray(guide.fileOrder) ? guide.fileOrder : undefined;
  var anchors = buildGuideAnchors(anchorTargets);
  injectInlineComments(guide, anchors);
}

window.applyReadingGuide = applyReadingGuide;
window.removeExistingGuides = removeExistingGuides;
