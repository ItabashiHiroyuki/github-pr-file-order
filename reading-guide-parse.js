/**
 * @typedef {{line: number|null, side: 'L'|'R', text: string}} ReadingGuideComment
 * @typedef {{fileOrder: string[], comments: Map<string, ReadingGuideComment[]>}} ReadingGuide
 */

/**
 * Parse a Reading Order markdown table from PR description HTML.
 *
 * @param {string} html
 * @returns {ReadingGuide}
 */
function parseReadingGuide(html) {
  const result = createEmptyGuide();
  const scope = getReadingOrderScope(html);
  const table = scope ? findTableInScope(scope.nodes) : null;

  Object.defineProperty(result, '__tableFound', {
    value: Boolean(table),
    enumerable: false,
    configurable: true
  });

  if (!table) {
    return result;
  }

  const rows = Array.from(table.querySelectorAll('tr'));
  for (const row of rows) {
    const cells = Array.from(row.children).filter(function (child) {
      return child.tagName === 'TD' || child.tagName === 'TH';
    });

    if (cells.length < 1) continue;

    // Skip header rows and markdown separator-like rows.
    if (cells.some(function (cell) { return cell.tagName === 'TH'; })) continue;
    if (isHeaderLikeRow(cells)) continue;
    if (isSeparatorLikeRow(cells)) continue;

    const fileCell = cells[0];
    const codeEl = fileCell.querySelector('code');
    if (!codeEl) continue;

    const filePath = (codeEl.textContent || '').trim();
    if (!filePath) continue;

    if (!result.comments.has(filePath)) {
      result.comments.set(filePath, []);
    }
    if (!result.fileOrder.includes(filePath)) {
      result.fileOrder.push(filePath);
    }

    const lineCellText = cells[1] ? cells[1].textContent : '';
    const parsedLine = parseLineCell(lineCellText || '');

    const commentHtml = cells.length >= 3
      ? cells.slice(2).map(function (cell) { return cell.innerHTML; }).join(' | ')
      : '';

    result.comments.get(filePath).push({
      line: parsedLine.line,
      side: parsedLine.side,
      text: sanitizeComment(commentHtml)
    });
  }

  return result;
}

/**
 * Parse legacy Reading Order format by collecting file paths from <code> tags
 * after the Reading Order heading.
 *
 * @param {string} html
 * @returns {ReadingGuide}
 */
function parseReadingOrderLegacy(html) {
  const result = createEmptyGuide();
  const scope = getReadingOrderScope(html);
  if (!scope) return result;

  const seen = new Set();

  for (const node of scope.nodes) {
    const codeNodes = [];

    if (node.tagName === 'CODE') {
      codeNodes.push(node);
    }

    node.querySelectorAll('code').forEach(function (codeEl) {
      codeNodes.push(codeEl);
    });

    for (const codeEl of codeNodes) {
      const raw = (codeEl.textContent || '').trim();
      if (!raw) continue;
      if (!looksLikeFilePath(raw)) continue;
      if (seen.has(raw)) continue;

      seen.add(raw);
      result.fileOrder.push(raw);
    }
  }

  return result;
}

/**
 * Sanitize comment HTML using a strict whitelist.
 * Allowed tags: strong, code, em, a, br
 * Allowed attrs: href on a (javascript: is rejected)
 *
 * @param {string} html
 * @returns {string}
 */
function sanitizeComment(html) {
  if (!html) return '';

  const parser = new DOMParser();
  const doc = parser.parseFromString('<div id="reading-guide-sanitize-root"></div>', 'text/html');
  const root = doc.getElementById('reading-guide-sanitize-root');
  root.innerHTML = html;

  var allowedTags = new Set(['STRONG', 'CODE', 'EM', 'A', 'BR']);
  var walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  var elements = [];
  var current = walker.nextNode();

  while (current) {
    elements.push(current);
    current = walker.nextNode();
  }

  for (const el of elements) {
    if (!el.parentNode) continue;

    if (!allowedTags.has(el.tagName)) {
      unwrapElement(el);
      continue;
    }

    if (el.tagName === 'A') {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name !== 'href') {
          el.removeAttribute(attr.name);
        }
      }

      const href = el.getAttribute('href') || '';
      if (isJavascriptHref(href)) {
        el.removeAttribute('href');
      }
      continue;
    }

    // Remove all attributes from non-anchor allowed tags.
    for (const attr of Array.from(el.attributes)) {
      el.removeAttribute(attr.name);
    }
  }

  return root.innerHTML;
}

/**
 * Normalize a file path for matching.
 *
 * @param {string} rawPath
 * @returns {string}
 */
function normalizePath(rawPath) {
  if (rawPath == null) return '';

  var path = decodeHtmlEntities(String(rawPath));

  // Strip invisible Unicode control characters used in GitHub text.
  path = path.replace(/[\u200E\u200F\u200B\u200C\u200D\uFEFF]/g, '');
  path = path.replace(/^(?:\.\/)+/, '');

  // If rename format is used, keep the new path side.
  var renameParts = path.split(/\s(?:→|->)\s/);
  if (renameParts.length > 1) {
    path = renameParts[renameParts.length - 1];
  }

  path = path.trim();
  path = path.replace(/^(?:\.\/)+/, '');

  return path.trim();
}

/**
 * Parse Reading Guide from HTML with table-first and legacy fallback behavior.
 *
 * @param {string} html
 * @returns {ReadingGuide}
 */
function parseReadingGuideFromHTML(html) {
  var parsed = parseReadingGuide(html);
  var useLegacyFallback = !parsed.__tableFound;
  var guide = useLegacyFallback ? parseReadingOrderLegacy(html) : parsed;

  return normalizeGuideResult(guide);
}

/**
 * @param {string} value
 * @returns {{line: number|null, side: 'L'|'R'}}
 */
function parseLineCell(value) {
  var trimmed = (value || '').trim();
  if (!trimmed) {
    return { line: null, side: 'R' };
  }

  var match = trimmed.match(/^([LRlr])?\s*(\d+)$/);
  if (!match) {
    return { line: null, side: 'R' };
  }

  var side = match[1] ? match[1].toUpperCase() : 'R';
  return {
    line: Number(match[2]),
    side: side === 'L' ? 'L' : 'R'
  };
}

/**
 * @param {Element[]} cells
 * @returns {boolean}
 */
function isHeaderLikeRow(cells) {
  if (cells.length < 3) return false;
  var col1 = (cells[0].textContent || '').trim().toLowerCase();
  var col2 = (cells[1].textContent || '').trim().toLowerCase();
  var col3 = (cells[2].textContent || '').trim().toLowerCase();
  return col1 === 'file' && col2 === 'line' && col3 === 'comment';
}

/**
 * @param {Element[]} cells
 * @returns {boolean}
 */
function isSeparatorLikeRow(cells) {
  if (cells.length === 0) return false;
  return cells.every(function (cell) {
    var text = (cell.textContent || '').trim();
    return /^:?-{2,}:?$/.test(text);
  });
}

/**
 * @param {string} html
 * @returns {{heading: Element, nodes: Element[]}|null}
 */
function getReadingOrderScope(html) {
  var doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  var headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
  var readingHeading = null;

  for (const heading of headings) {
    if (/reading\s*order/i.test(heading.textContent || '')) {
      readingHeading = heading;
      break;
    }
  }

  if (!readingHeading) {
    return null;
  }

  var startLevel = parseHeadingLevel(readingHeading);
  var scopeNodes = [];
  var node = readingHeading.nextElementSibling;

  while (node) {
    if (isHeadingElement(node)) {
      var nextLevel = parseHeadingLevel(node);
      if (nextLevel <= startLevel) {
        break;
      }
    }

    scopeNodes.push(node);
    node = node.nextElementSibling;
  }

  return {
    heading: readingHeading,
    nodes: scopeNodes
  };
}

/**
 * @param {Element[]} nodes
 * @returns {HTMLTableElement|null}
 */
function findTableInScope(nodes) {
  for (const node of nodes) {
    if (node.tagName === 'TABLE') {
      return /** @type {HTMLTableElement} */ (node);
    }
    var nestedTable = node.querySelector('table');
    if (nestedTable) {
      return nestedTable;
    }
  }
  return null;
}

/**
 * @param {Element} element
 * @returns {boolean}
 */
function isHeadingElement(element) {
  return /^H[1-6]$/.test(element.tagName);
}

/**
 * @param {Element} heading
 * @returns {number}
 */
function parseHeadingLevel(heading) {
  var match = heading.tagName.match(/^H([1-6])$/);
  return match ? Number(match[1]) : 6;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeFilePath(value) {
  if (!value) return false;
  var text = value.trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text)) return false;

  if (text.includes('→')) {
    text = text.split('→').pop().trim();
  } else if (/\s->\s/.test(text)) {
    text = text.split(/\s->\s/).pop().trim();
  }

  return text.includes('/') || /\.[A-Za-z0-9_-]+$/.test(text);
}

/**
 * @param {Element} el
 */
function unwrapElement(el) {
  var parent = el.parentNode;
  if (!parent) return;

  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

/**
 * @param {string} href
 * @returns {boolean}
 */
function isJavascriptHref(href) {
  var normalized = String(href || '').replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, '').toLowerCase();
  return normalized.startsWith('javascript:');
}

/**
 * @param {string} value
 * @returns {string}
 */
function decodeHtmlEntities(value) {
  if (!value) return '';
  var doc = new DOMParser().parseFromString('<!doctype html><html><body></body></html>', 'text/html');
  var textarea = doc.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

/**
 * @returns {ReadingGuide}
 */
function createEmptyGuide() {
  return {
    fileOrder: [],
    comments: new Map()
  };
}

/**
 * @param {ReadingGuide} guide
 * @returns {ReadingGuide}
 */
function normalizeGuideResult(guide) {
  var normalizedOrder = [];
  var seen = new Set();

  for (const rawPath of guide.fileOrder || []) {
    var normalizedPath = normalizePath(rawPath);
    if (!normalizedPath || seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    normalizedOrder.push(normalizedPath);
  }

  var normalizedComments = new Map();
  if (guide.comments instanceof Map) {
    for (const entry of guide.comments.entries()) {
      var sourcePath = normalizePath(entry[0]);
      if (!sourcePath) continue;

      if (!normalizedComments.has(sourcePath)) {
        normalizedComments.set(sourcePath, []);
      }

      var targetList = normalizedComments.get(sourcePath);
      var sourceList = Array.isArray(entry[1]) ? entry[1] : [];
      for (const comment of sourceList) {
        if (!comment || typeof comment !== 'object') continue;

        targetList.push({
          line: typeof comment.line === 'number' ? comment.line : null,
          side: comment.side === 'L' ? 'L' : 'R',
          text: typeof comment.text === 'string' ? comment.text : ''
        });
      }
    }
  }

  for (const filePath of normalizedOrder) {
    if (!normalizedComments.has(filePath)) {
      normalizedComments.set(filePath, []);
    }
  }

  return {
    fileOrder: normalizedOrder,
    comments: normalizedComments
  };
}

window.parseReadingGuideFromHTML = parseReadingGuideFromHTML;
window.sanitizeComment = sanitizeComment;
window.normalizePath = normalizePath;
