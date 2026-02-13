/**
 * Safe markdown renderer for news content.
 * Supports: headings, bold, italic, links, images, bullet/numbered lists, paragraphs.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (trimmed.startsWith('/')) return true;
  const lower = trimmed.toLowerCase();
  return lower.startsWith('https://') || lower.startsWith('http://');
}

function renderInline(markdownText) {
  let html = escapeHtml(markdownText);

  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (full, alt, url) => {
    if (!isSafeUrl(url)) return full;
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt || '')}" loading="lazy">`;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (full, text, url) => {
    if (!isSafeUrl(url)) return text;
    const external = url.startsWith('http://') || url.startsWith('https://');
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(url)}"${attrs}>${text}</a>`;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return html;
}

export function renderMarkdown(markdown = '') {
  const lines = String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const blocks = [];
  let paragraphLines = [];
  let listType = null;
  let listItems = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    blocks.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
    paragraphLines = [];
  }

  function flushList() {
    if (!listType || !listItems.length) return;
    blocks.push(`<${listType}>${listItems.map(item => `<li>${item}</li>`).join('')}</${listType}>`);
    listType = null;
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(renderInline(unorderedMatch[1]));
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(renderInline(orderedMatch[1]));
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join('');
}
