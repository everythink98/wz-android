import {
  escapeHtmlText,
  parseForumContentHtml,
  visitDecodedHtmlText,
  type HtmlTextSegmentKind
} from '@/domain/forum/html';
import { escapeSearchTerm, searchTerms, transformHtmlSegments } from '@/domain/forum/text';

const MAX_HIGHLIGHTED_HTML_CHARS = 16_384;
const MAX_HIGHLIGHTED_DOM_NODES = 80;
const HIGHLIGHT_MARKUP_CHARS = '<mark></mark>'.length;
const MAX_DOM_NODE_GROWTH_PER_HIGHLIGHT = 3;

interface HighlightPart {
  text: string;
  highlighted: boolean;
}

interface DecodedTextSpans {
  decoded: string;
  starts: number[];
  ends: number[];
  kinds: HtmlTextSegmentKind[];
  delimiterEscapeOverhead: number;
}

function htmlDomNodeCount(html: string) {
  try {
    const body = parseForumContentHtml(`<body>${html}</body>`).querySelector('body');
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

function isInsideSurrogatePair(text: string, offset: number) {
  if (offset <= 0 || offset >= text.length) return false;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff;
}

function escapeHtmlDelimiters(text: string) {
  if (!text.includes('<') && !text.includes('>')) return text;
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countDelimiterEscapeOverhead(text: string) {
  let extra = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 60 || code === 62) extra += 3;
  }
  return extra;
}

function decodeHtmlTextWithSpans(source: string): DecodedTextSpans {
  let decoded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  const kinds: HtmlTextSegmentKind[] = [];
  let delimiterEscapeOverhead = 0;
  visitDecodedHtmlText(source, (part, start, end, kind) => {
    decoded += part;
    if (kind === 'text') delimiterEscapeOverhead += countDelimiterEscapeOverhead(part);
    if (kind === 'literal-reference') delimiterEscapeOverhead += 4;
    for (let offset = 0; offset < part.length; offset += 1) {
      starts.push(kind === 'text' ? start + offset : start);
      ends.push(kind === 'text' ? start + offset + 1 : end);
      kinds.push(kind);
    }
  });
  return { decoded, starts, ends, kinds, delimiterEscapeOverhead };
}

function emitDecodedRange(source: string, spans: DecodedTextSpans, from: number, to: number) {
  const { decoded, starts, ends, kinds } = spans;
  let output = '';
  let index = from;
  while (index < to) {
    if (kinds[index] !== 'text') {
      const spanStart = starts[index];
      const spanEnd = ends[index];
      let groupEnd = index + 1;
      while (groupEnd < to && starts[groupEnd] === spanStart && ends[groupEnd] === spanEnd) {
        groupEnd += 1;
      }
      const splitBefore = index > 0 && starts[index - 1] === spanStart && ends[index - 1] === spanEnd;
      const splitAfter = groupEnd < decoded.length && starts[groupEnd] === spanStart && ends[groupEnd] === spanEnd;
      output +=
        splitBefore || splitAfter || kinds[index] === 'literal-reference'
          ? escapeHtmlText(decoded.slice(index, groupEnd))
          : source.slice(spanStart, spanEnd);
      index = groupEnd;
      continue;
    }
    const ch = decoded[index];
    if (ch === '<') output += '&lt;';
    else if (ch === '>') output += '&gt;';
    else output += ch;
    index += 1;
  }
  return output;
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
  let remainingChars = Math.max(0, MAX_HIGHLIGHTED_HTML_CHARS - html.length);
  const serializedCapacity = Math.floor(remainingChars / HIGHLIGHT_MARKUP_CHARS);
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
    (text) => {
      if (!text || remainingHighlights <= 0) return text;
      if (!text.includes('&')) {
        pattern.lastIndex = 0;
        let output = '';
        let lastEnd = 0;
        let matched = false;
        let escapeOverhead: number | undefined;
        for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
          const value = match[0];
          if (!value) {
            pattern.lastIndex += 1;
            continue;
          }
          const start = match.index;
          const end = start + value.length;
          if (isInsideSurrogatePair(text, start) || isInsideSurrogatePair(text, end)) {
            continue;
          }
          const firstMatchCost = matched ? 0 : (escapeOverhead ??= countDelimiterEscapeOverhead(text));
          const neededChars = HIGHLIGHT_MARKUP_CHARS + firstMatchCost;
          if (remainingHighlights <= 0 || remainingChars < neededChars) break;
          remainingHighlights -= 1;
          remainingChars -= neededChars;
          matched = true;
          output += escapeHtmlDelimiters(text.slice(lastEnd, start));
          output += `<mark>${escapeHtmlDelimiters(value)}</mark>`;
          lastEnd = end;
        }
        if (!matched) return text;
        return output + escapeHtmlDelimiters(text.slice(lastEnd));
      }

      const spans = decodeHtmlTextWithSpans(text);
      const { decoded } = spans;
      pattern.lastIndex = 0;
      let output = '';
      let lastEnd = 0;
      let matched = false;
      for (let match = pattern.exec(decoded); match; match = pattern.exec(decoded)) {
        const value = match[0];
        if (!value) {
          pattern.lastIndex += 1;
          continue;
        }
        const start = match.index;
        const end = start + value.length;
        if (isInsideSurrogatePair(decoded, start) || isInsideSurrogatePair(decoded, end)) {
          continue;
        }
        const firstMatchCost = matched ? 0 : spans.delimiterEscapeOverhead;
        const neededChars = HIGHLIGHT_MARKUP_CHARS + firstMatchCost;
        if (remainingHighlights <= 0 || remainingChars < neededChars) break;
        remainingHighlights -= 1;
        remainingChars -= neededChars;
        matched = true;
        output += emitDecodedRange(text, spans, lastEnd, start);
        output += `<mark>${emitDecodedRange(text, spans, start, end)}</mark>`;
        lastEnd = end;
      }
      if (!matched) return text;
      return output + emitDecodedRange(text, spans, lastEnd, decoded.length);
    },
    (tag) => tag,
    (rawText) => rawText
  );
}
