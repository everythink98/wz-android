import { escapeSearchTerm, searchTerms, transformHtmlSegments } from '@/domain/forum/text';
import { parseHtml } from '@/domain/forum/html';

const MAX_HIGHLIGHTED_HTML_CHARS = 16_384;
const MAX_HIGHLIGHTED_DOM_NODES = 80;
const HIGHLIGHT_MARKUP_CHARS = '<mark></mark>'.length;
const MAX_DOM_NODE_GROWTH_PER_HIGHLIGHT = 3;

export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

function htmlDomNodeCount(html: string) {
  try {
    const body = parseHtml(`<body>${html}</body>`).querySelector('body');
    const pending = [...(body?.childNodes || [])];
    let count = 0;
    while (pending.length) {
      const current = pending.pop()!;
      count += 1;
      pending.push(...(current.childNodes || []));
    }
    return count;
  } catch {
    return MAX_HIGHLIGHTED_DOM_NODES;
  }
}

export function highlightTextParts(text: string, query: string): HighlightPart[] {
  const terms = searchTerms(query);
  if (!text || terms.length === 0) {
    return [{ text, highlighted: false }];
  }
  const pattern = new RegExp(`(${terms.map(escapeSearchTerm).join('|')})`, 'gi');
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({
      text: part,
      highlighted: terms.some((term) => term.toLowerCase() === part.toLowerCase())
    }));
}

export function highlightHtml(html: string, query: string) {
  const terms = searchTerms(query);
  if (!html || terms.length === 0) {
    return html;
  }
  const serializedCapacity = Math.floor(Math.max(0, MAX_HIGHLIGHTED_HTML_CHARS - html.length) / HIGHLIGHT_MARKUP_CHARS);
  const domCapacity = Math.floor(
    Math.max(0, MAX_HIGHLIGHTED_DOM_NODES - htmlDomNodeCount(html)) / MAX_DOM_NODE_GROWTH_PER_HIGHLIGHT
  );
  let remainingHighlights = Math.min(serializedCapacity, domCapacity);
  if (remainingHighlights <= 0) {
    return html;
  }
  const pattern = new RegExp(`(${terms.map(escapeSearchTerm).join('|')})`, 'gi');
  return transformHtmlSegments(
    html,
    (text) =>
      text.replace(pattern, (match) => {
        if (remainingHighlights <= 0) return match;
        remainingHighlights -= 1;
        return `<mark>${match}</mark>`;
      }),
    (tag) => tag
  );
}
