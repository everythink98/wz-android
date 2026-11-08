import MarkdownIt from 'markdown-it';
import { NODESEEK_URL } from '@/domain/forum/sourceUrls';
import { nodeSeekStickerForCode } from '@/domain/forum/nodeSeekStickers';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import { normalizeNodeSeekStardustMarkers } from './stardustMarkup';

export const MAX_NODESEEK_MARKDOWN_BYTES = 256 * 1024;
const OVERSIZED_MARKDOWN_NOTICE = '<p>内容过长，无法安全显示。</p>';
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});
md.linkify.set({ fuzzyLink: true, urlAuth: true });
Object.assign(md.options, { maxNesting: 100 });
md.core.ruler.after('inline', 'nodeseek-task-markers', ({ tokens, Token }) => {
  const lists: typeof tokens = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') lists[token.level] = token;
    const item = tokens[index - 2];
    if (
      token.type !== 'inline' ||
      tokens[index - 1]?.type !== 'paragraph_open' ||
      item?.type !== 'list_item_open' ||
      !/^\[[ xX]\] /.test(token.content) ||
      !token.children?.length
    )
      continue;

    const marker = new Token('html_inline', '', 0);
    marker.content = `<span class="task-list-marker">${token.content[1] === ' ' ? '☐' : '☑'}</span> `;
    token.children[0].content = token.children[0].content.slice(3);
    token.content = token.content.slice(3);
    token.children.unshift(marker);
    item.attrSet('class', 'task-list-item');
    lists[item.level - 1].attrSet('class', 'contains-task-list');
  }
});
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
  return sanitizeContentHtml(nodeSeekMarkdownCandidateHtml(markdown), NODESEEK_URL, normalizeNodeSeekStardustMarkers);
}
