import MarkdownIt from 'markdown-it';
import { NODESEEK_URL } from './appUrls';
import { sanitizeContentHtml } from './localHtml';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function nodeSeekMarkdownToHtml(markdown: unknown) {
  return sanitizeContentHtml(md.render(String(markdown || '')), NODESEEK_URL);
}
