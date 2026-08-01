import MarkdownIt from 'markdown-it';
import { NODESEEK_URL } from './appUrls';
import { sanitizeContentHtml } from './localHtml';

export const MAX_NODESEEK_MARKDOWN_BYTES = 256 * 1024;
const OVERSIZED_MARKDOWN_NOTICE = '<p>内容过长，无法安全显示。</p>';
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});
Object.assign(md.options, { maxNesting: 100 });

export function nodeSeekMarkdownToHtml(markdown: unknown) {
  const input = String(markdown || '');
  const oversized = input.length > MAX_NODESEEK_MARKDOWN_BYTES
    || new TextEncoder().encode(input).byteLength > MAX_NODESEEK_MARKDOWN_BYTES;
  return sanitizeContentHtml(
    oversized ? OVERSIZED_MARKDOWN_NOTICE : md.render(input),
    NODESEEK_URL
  );
}
