import { decodeHTMLAttribute } from 'entities';
import { DecodingMode, EntityDecoder, htmlDecodeTree } from 'entities/decode';
import { parse, HTMLElement, TextNode, type Node } from 'node-html-parser';
import { htmlTagAttribute, transformHtmlSegments } from './htmlSegments';

export const FORUM_AUDIO_TAG = 'forum-audio';

export const FORUM_VIDEO_TAG = 'forum-video';

export const FORUM_VIDEO_STICKER_TAG = 'forum-video-sticker';

export const FORUM_LINK_CARD_TAG = 'forum-link-card';

export const FORUM_MATH_BLOCK_TAG = 'forum-math-block';

export const FORUM_MATH_INLINE_TAG = 'forum-math-inline';

export const FORUM_TERMINAL_REPORT_TAG = 'forum-terminal-report';

export const FORUM_TERMINAL_TAB_TAG = 'forum-terminal-tab';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function recordText(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
  }
  return '';
}

export function absoluteUrl(value: unknown, baseUrl: string) {
  const text = String(value || '').trim();
  if (!text) {
    return undefined;
  }
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return undefined;
  }
}

export function toIsoString(value: unknown, defaultTimezone = '') {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  let time = Number.NaN;
  if (typeof value === 'number') {
    time = value > 10_000_000_000 ? value : value * 1000;
  } else if (typeof value === 'string') {
    const text = value.trim();
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)
      ? `${text}Z`
      : text.replace(
          /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{2}:?\d{2})?$/,
          (_match, year, month, day, hour, minute, second = '', zone = '') =>
            `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}${second ? `:${second}` : ''}${zone || defaultTimezone}`
        );
    time = Date.parse(normalized);
  }
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function decodeHtmlAttribute(value: unknown) {
  const text = String(value || '');
  if (!text.includes('&')) return text;
  return decodeHTMLAttribute(text);
}

export function decodeHtml(value: unknown) {
  return decodeHtmlAttribute(value);
}

export type HtmlTextSegmentKind = 'text' | 'decoded-reference' | 'literal-reference';

export function visitDecodedHtmlText(
  source: string,
  visit: (text: string, start: number, end: number, kind: HtmlTextSegmentKind) => void
) {
  let amp = source.indexOf('&');
  let literalStart = 0;
  if (amp >= 0) {
    const completeName = /[A-Za-z][A-Za-z0-9]*;/y;
    let decodedReference = '';
    const decoder = new EntityDecoder(htmlDecodeTree, (codePoint) => {
      decodedReference += String.fromCodePoint(codePoint);
    });
    while (amp >= 0) {
      completeName.lastIndex = amp + 1;
      const named = completeName.test(source);
      decodedReference = '';
      // A complete name must match in full, while legacy semicolonless references remain valid.
      decoder.startEntity(named ? DecodingMode.Strict : DecodingMode.Legacy);
      const consumed = decoder.write(source, amp + 1);
      const referenceEnd = consumed < 0 ? amp + decoder.end() : amp + consumed;
      if (referenceEnd > amp || named) {
        if (literalStart < amp) visit(source.slice(literalStart, amp), literalStart, amp, 'text');
        if (referenceEnd > amp) {
          visit(decodedReference, amp, referenceEnd, 'decoded-reference');
          literalStart = referenceEnd;
        } else {
          literalStart = completeName.lastIndex;
          visit(source.slice(amp, literalStart), amp, literalStart, 'literal-reference');
        }
        amp = source.indexOf('&', literalStart);
      } else {
        amp = source.indexOf('&', amp + 1);
      }
    }
  }
  if (literalStart < source.length) visit(source.slice(literalStart), literalStart, source.length, 'text');
}

export function decodeHtmlEntities(value: unknown) {
  const text = String(value || '');
  if (!text.includes('&')) return text;
  let decoded = '';
  visitDecodedHtmlText(text, (part) => {
    decoded += part;
  });
  return decoded;
}

export interface HtmlAttributeReadableNode {
  attributes?: Record<string, string | undefined>;
  rawAttributes?: Record<string, string | null | undefined>;
  getAttribute?: (name: string) => string | undefined;
}

export interface HtmlAttributeWritableNode extends HtmlAttributeReadableNode {
  setAttribute?: (name: string, value: string) => void;
}

export function htmlElementAttribute(
  node: HtmlAttributeReadableNode | null | undefined,
  name: string
): string | undefined {
  if (!node) return undefined;
  const target = name.toLowerCase();
  if (node.rawAttributes) {
    for (const [key, rawValue] of Object.entries(node.rawAttributes)) {
      if (key.toLowerCase() === target) {
        return rawValue === null || rawValue === undefined ? '' : decodeHtmlAttribute(rawValue);
      }
    }
    return undefined;
  }
  if (node.attributes) {
    if (Object.prototype.hasOwnProperty.call(node.attributes, name)) {
      const value = node.attributes[name];
      return value === undefined ? undefined : String(value);
    }
    for (const [key, value] of Object.entries(node.attributes)) {
      if (key.toLowerCase() === target) {
        return value === undefined ? undefined : String(value);
      }
    }
  }
  return node.getAttribute?.(name);
}

export function htmlElementAttributes(
  node: HtmlAttributeReadableNode | null | undefined
): Record<string, string | undefined> {
  if (!node) return {};
  if (node.rawAttributes) {
    const result: Record<string, string | undefined> = {};
    for (const [key, rawValue] of Object.entries(node.rawAttributes)) {
      const lower = key.toLowerCase();
      if (!(lower in result)) {
        result[lower] = rawValue === null || rawValue === undefined ? '' : decodeHtmlAttribute(rawValue);
      }
    }
    return result;
  }
  return node.attributes ? { ...node.attributes } : {};
}

export function setHtmlElementAttribute(
  node: HtmlAttributeWritableNode | null | undefined,
  name: string,
  value: string
) {
  if (!node) return;
  const stringValue = String(value);
  if (typeof node.setAttribute === 'function') {
    node.setAttribute(name, node.rawAttributes ? escapeHtmlAttribute(stringValue) : stringValue);
    return;
  }
  if (node.attributes) {
    node.attributes[name] = stringValue;
  }
}

export function escapeHtmlText(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeHtmlAttribute(value: unknown) {
  return escapeHtmlText(value).replace(/"/g, '&quot;');
}

export function escapeHtmlFully(value: unknown) {
  return escapeHtmlAttribute(value).replace(/'/g, '&#39;');
}

function escapeLiteralHtmlLessThan(text: string) {
  return text.replace(/</g, '&lt;');
}

function preserveForumHtmlText(text: string) {
  if (!text.includes('&')) return escapeLiteralHtmlLessThan(text);
  let html = '';
  visitDecodedHtmlText(text, (part, start, end, kind) => {
    if (kind === 'literal-reference') html += escapeHtmlText(part);
    else if (kind === 'decoded-reference') html += text.slice(start, end);
    else html += escapeLiteralHtmlLessThan(part);
  });
  return html;
}

function preserveHtmlTagAttributes(tag: string, trailingUnquotedValueStart?: number) {
  if (trailingUnquotedValueStart !== undefined) {
    // The DOM parser treats the last slash as a self-closing delimiter even inside an unquoted value.
    const opening = tag.slice(0, trailingUnquotedValueStart).replace(/>/g, '&gt;');
    return `${opening}"${tag.slice(trailingUnquotedValueStart, -1)}">`;
  }
  if (tag.startsWith('<!--') || tag.startsWith('</') || tag.indexOf('>') === tag.length - 1) return tag;
  return `${tag.slice(0, -1).replace(/>/g, '&gt;')}>`;
}

export function escapeQuotedHtmlTagDelimiters(value: unknown) {
  return transformHtmlSegments(
    String(value || ''),
    preserveForumHtmlText,
    preserveHtmlTagAttributes,
    escapeLiteralHtmlLessThan
  );
}

export function normalizeForumMarkupForSanitization(value: unknown) {
  return transformHtmlSegments(
    String(value || ''),
    preserveForumHtmlText,
    (tag, trailingUnquotedValueStart) =>
      tag.startsWith('<![') || /^<\/?(?:script|style)(?=[\s/>])/i.test(tag)
        ? ''
        : preserveHtmlTagAttributes(tag, trailingUnquotedValueStart),
    () => ''
  );
}

const HTML_TEXT_BLOCK_BOUNDARY =
  /^(?:address|article|aside|blockquote|br|caption|dd|details|dialog|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hgroup|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/;

export function textContentFromHtml(
  value: unknown,
  options?: { includeImageAlt?: boolean; preserveInlineText?: boolean }
) {
  const includeImageAlt = options?.includeImageAlt === true;
  const preserveInlineText = options?.preserveInlineText === true;
  const inlineSeparator = preserveInlineText ? '' : ' ';
  return transformHtmlSegments(
    String(value || ''),
    (segment) => decodeHtmlEntities(segment),
    (tag) => {
      const tagMatch = tag.match(/^<(\/?)([A-Za-z][A-Za-z0-9:-]*)/);
      if (!tagMatch) return inlineSeparator;
      const closing = tagMatch[1] === '/';
      const name = tagMatch[2].toLowerCase();
      if (includeImageAlt && !closing && name === 'img') {
        const alt = htmlTagAttribute(tag, 'alt');
        return alt !== undefined ? decodeHtmlAttribute(alt) : inlineSeparator;
      }
      return preserveInlineText && !HTML_TEXT_BLOCK_BOUNDARY.test(name) ? '' : ' ';
    },
    () => ''
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function textExcerptFromPlainText(value: unknown, maxLength = 120) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function textExcerpt(value: unknown, maxLength = 120) {
  return textExcerptFromPlainText(textContentFromHtml(value), maxLength);
}

const HTML_BLOCK_TEXT_ELEMENTS = {
  script: true,
  noscript: true,
  style: true
};

export function parseHtml(value: unknown) {
  return parse(String(value || ''), {
    blockTextElements: {
      ...HTML_BLOCK_TEXT_ELEMENTS,
      pre: true
    }
  });
}

export function parseForumContentHtml(value: unknown) {
  return parse(String(value || ''), { blockTextElements: HTML_BLOCK_TEXT_ELEMENTS });
}

// Reuse the node's native parser options without copying or replacing its existing siblings.
export function forumElementReplacementNodes(node: HTMLElement, html: string): Node[] {
  const previous = node.childNodes;
  try {
    node.childNodes = [];
    node.set_content(html);
    if (node.childNodes.length === 1 && node.childNodes[0] instanceof TextNode && !node.childNodes[0].rawText) {
      return [new TextNode(html)];
    }
    return node.childNodes.length ? node.childNodes : [new TextNode(html)];
  } finally {
    node.childNodes = previous;
  }
}

// A cleanup phase consumes each selected subtree, then rewrites each affected sibling array once.
export function transformForumElements(
  root: HTMLElement,
  selected: readonly HTMLElement[],
  transform: (node: HTMLElement) => Node[] | undefined
) {
  if (!selected.length) return;
  const candidates = new Set(selected);
  const replacements = new Map<HTMLElement, Map<Node, Node[]>>();
  const pending: Node[] = [...root.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (!(node instanceof HTMLElement)) continue;
    const content = candidates.has(node) ? transform(node) : undefined;
    if (content !== undefined && node.parentNode) {
      const parent = node.parentNode;
      let changes = replacements.get(parent);
      if (!changes) {
        changes = new Map();
        replacements.set(parent, changes);
      }
      changes.set(node, content);
      continue;
    }
    for (let index = node.childNodes.length - 1; index >= 0; index--) pending.push(node.childNodes[index]);
  }
  for (const [parent, changes] of replacements) {
    parent.childNodes = parent.childNodes.flatMap((node) => {
      const content = changes.get(node);
      if (content === undefined) return [node];
      node.parentNode = null;
      for (const replacement of content) replacement.parentNode = parent;
      return content;
    });
  }
}

export function hasRenderableHtmlContent(value: unknown, parsedRoot?: ReturnType<typeof parseHtml>) {
  if (parsedRoot ? elementText(parsedRoot) : textContentFromHtml(value)) {
    return true;
  }
  try {
    return Boolean(
      (parsedRoot || parseHtml(value)).querySelector(
        `img, iframe, audio, video, ${FORUM_AUDIO_TAG}, ${FORUM_VIDEO_TAG}, ${FORUM_VIDEO_STICKER_TAG}, ${FORUM_LINK_CARD_TAG}, ${FORUM_TERMINAL_REPORT_TAG}`
      )
    );
  } catch {
    return new RegExp(
      `<(?:img|iframe|audio|video|${FORUM_AUDIO_TAG}|${FORUM_VIDEO_TAG}|${FORUM_VIDEO_STICKER_TAG}|${FORUM_LINK_CARD_TAG}|${FORUM_TERMINAL_REPORT_TAG})\\b`,
      'i'
    ).test(String(value || ''));
  }
}

export function parseDataImageUrl(value: unknown): { base64: string; extension: string } | null {
  const match =
    typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp|avif);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  const type = match[1].toLowerCase();
  return { base64: match[2].trim(), extension: type === 'jpeg' ? 'jpg' : type };
}

export function isAllowedDataImageUrl(value: unknown) {
  return parseDataImageUrl(value) !== null;
}

export function parsePositiveInteger(value: unknown) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function topicSortTime(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

export function sortTopicsByTime<T extends { lastReplyAt?: string; createdAt: string }>(items: T[]) {
  return items
    .map((item) => ({ item, time: topicSortTime(item.lastReplyAt || item.createdAt) }))
    .sort((left, right) => right.time - left.time)
    .map(({ item }) => item);
}

export function sortTopicsByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return items
    .map((item) => ({ item, time: topicSortTime(item.createdAt) }))
    .sort((left, right) => right.time - left.time)
    .map(({ item }) => item);
}

function visitForumText(
  root: Node,
  visit: (node: Node, exit: boolean, text: string, excluded: boolean) => void,
  excludedElements?: ReadonlySet<HTMLElement>,
  inheritedExclusion = false
) {
  const pending: { node: Node; exit: boolean; excluded: boolean }[] = [
    { node: root, exit: false, excluded: inheritedExclusion }
  ];
  while (pending.length) {
    const entry = pending.pop()!;
    const { node, exit } = entry;
    const excluded = entry.excluded || (node instanceof HTMLElement && Boolean(excludedElements?.has(node)));
    const text = !exit && !excluded && node instanceof TextNode ? node.text : '';
    const lineBreak = node instanceof HTMLElement && /^br$/i.test(node.rawTagName);
    visit(node, exit, lineBreak && !exit && !excluded ? '\n' : text, excluded);
    if (!exit && node instanceof HTMLElement) {
      pending.push({ node, exit: true, excluded });
      if (!lineBreak || excluded) {
        for (let index = node.childNodes.length - 1; index >= 0; index--)
          pending.push({ node: node.childNodes[index], exit: false, excluded });
      }
    }
  }
}

// Decode each text leaf once; adjoining elements cannot complete each other's entities.
export function forumNodeText(node: Node | null | undefined) {
  if (!node) return '';
  const parts: string[] = [];
  visitForumText(node, (_node, exit, text) => {
    if (!exit && text) parts.push(text);
  });
  return parts.join('');
}

export function elementText(element: HTMLElement | null | undefined) {
  return forumNodeText(element).replace(/\s+/g, ' ').trim();
}

export type ForumTextTape = { readonly text: string; readonly nonWhitespacePrefix: Uint32Array };
export type ForumTextSegment = { readonly tape: ForumTextTape; readonly start: number; readonly end: number };

// The tape is immutable for one cleanup phase, including separately queried children inserted beneath br.
function createForumTextSnapshot(
  root: HTMLElement,
  excludedElements?: ReadonlySet<HTMLElement>,
  inheritedExclusion = false
) {
  const intervals = new Map<HTMLElement, { start: number; end: number }>();
  const excludedNodes = new WeakSet<HTMLElement>();
  const parts: string[] = [];
  const branches: Node[] = [root];
  let length = 0;
  while (branches.length) {
    visitForumText(
      branches.pop()!,
      (node, exit, text, excluded) => {
        if (node instanceof HTMLElement) {
          if (exit) intervals.get(node)!.end = length;
          else {
            intervals.set(node, { start: length, end: length });
            if (excluded) excludedNodes.add(node);
            if (!excluded && /^br$/i.test(node.rawTagName))
              for (let index = node.childNodes.length - 1; index >= 0; index--) branches.push(node.childNodes[index]);
          }
        }
        if (!exit && text) {
          parts.push(text);
          length += text.length;
        }
      },
      excludedElements,
      inheritedExclusion
    );
  }
  const text = parts.join('');
  const nonWhitespacePrefix = new Uint32Array(text.length + 1);
  for (let offset = 0; offset < text.length; offset++)
    nonWhitespacePrefix[offset + 1] = nonWhitespacePrefix[offset] + Number(!/\s/.test(text[offset]));
  const tape: ForumTextTape = { text, nonWhitespacePrefix };
  return {
    nodes: intervals.keys(),
    excludes: (node: HTMLElement) => excludedNodes.has(node),
    range(node: HTMLElement): ForumTextSegment[] {
      const interval = intervals.get(node);
      if (!interval) throw new Error('Node is not registered in this text snapshot');
      return interval.start === interval.end ? [] : [{ tape, ...interval }];
    }
  };
}

export function createForumTextIndex(root: HTMLElement, excludedElements?: ReadonlySet<HTMLElement>) {
  const snapshots = new WeakMap<HTMLElement, ReturnType<typeof createForumTextSnapshot>>();
  function register(branch: HTMLElement, inheritedExclusion = false) {
    const snapshot = createForumTextSnapshot(branch, excludedElements, inheritedExclusion);
    for (const node of snapshot.nodes) snapshots.set(node, snapshot);
    return snapshot;
  }
  register(root);
  function range(node: HTMLElement): ForumTextSegment[] {
    let snapshot = snapshots.get(node);
    if (!snapshot) {
      let branch = node;
      let inheritedExclusion = false;
      while (true) {
        const parent = branch.parentNode;
        if (!parent) break;
        const parentSnapshot = snapshots.get(parent);
        if (parentSnapshot) {
          inheritedExclusion = parentSnapshot.excludes(parent);
          break;
        }
        branch = parent;
      }
      snapshot = register(branch, inheritedExclusion);
    }
    return snapshot.range(node);
  }
  return {
    range,
    hasText(node: HTMLElement) {
      return range(node).some(
        ({ tape, start, end }) => tape.nonWhitespacePrefix[end] > tape.nonWhitespacePrefix[start]
      );
    }
  };
}

export function nodeTagName(node: unknown) {
  const record = node as { rawTagName?: unknown; tagName?: unknown };
  return String(record.rawTagName || record.tagName || '').toLowerCase();
}
