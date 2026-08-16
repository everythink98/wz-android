import MarkdownIt from 'markdown-it';
import { NODESEEK_URL } from '@/domain/forum/sourceUrls';
import { nodeSeekStickerForCode } from '@/domain/forum/nodeSeekStickers';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';

export const MAX_NODESEEK_MARKDOWN_BYTES = 256 * 1024;
const OVERSIZED_MARKDOWN_NOTICE = '<p>内容过长，无法安全显示。</p>';
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});
Object.assign(md.options, { maxNesting: 100 });
const defaultTextRenderer = md.renderer.rules.text;
md.renderer.rules.text = (tokens, index, options, env, renderer) => {
  const rendered = defaultTextRenderer
    ? defaultTextRenderer(tokens, index, options, env, renderer)
    : md.utils.escapeHtml(tokens[index]?.content || '');
  return rendered.replace(/:[a-z]+\d+:/g, (code) => {
    const sticker = nodeSeekStickerForCode(code);
    return sticker ? `<img class="sticker" src="${sticker.imageUrl}" alt="${sticker.label}">` : code;
  });
};

export function nodeSeekMarkdownCandidateHtml(markdown: unknown) {
  const input = String(markdown || '');
  const oversized =
    input.length > MAX_NODESEEK_MARKDOWN_BYTES ||
    new TextEncoder().encode(input).byteLength > MAX_NODESEEK_MARKDOWN_BYTES;
  return oversized ? OVERSIZED_MARKDOWN_NOTICE : md.render(input);
}

export function nodeSeekMarkdownToHtml(markdown: unknown) {
  return sanitizeContentHtml(nodeSeekMarkdownCandidateHtml(markdown), NODESEEK_URL);
}
