import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: false, linkify: true });

export function renderMarkdown(input) {
  return DOMPurify.sanitize(md.render(String(input || '')));
}
