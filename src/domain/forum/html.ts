import { parse, HTMLElement, TextNode, type Node } from 'node-html-parser';

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

function htmlEntityCodePoint(entity: string, codePoint: number) {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return entity;
  }
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

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
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function decodeHtml(value: unknown) {
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (entity, name) => {
    const key = String(name).toLowerCase();
    if (key.startsWith('#x')) {
      return htmlEntityCodePoint(entity, Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith('#')) {
      return htmlEntityCodePoint(entity, Number.parseInt(key.slice(1), 10));
    }
    return NAMED_HTML_ENTITIES[key] || entity;
  });
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

export function escapeQuotedHtmlTagDelimiters(value: unknown) {
  let inTag = false;
  let quote = '';
  let result = '';
  for (const char of String(value || '')) {
    if (!inTag) {
      inTag = char === '<';
      result += char;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
        result += char;
      } else {
        result += char === '>' ? '&gt;' : char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      inTag = false;
    }
    result += char;
  }
  return result;
}

export function textContentFromHtml(value: unknown) {
  return decodeHtml(
    escapeQuotedHtmlTagDelimiters(value)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
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

export function isAllowedDataImageUrl(value: unknown) {
  return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[\s\S]+$/i.test(String(value || '').trim());
}

export function parsePositiveInteger(value: unknown) {
  const match = String(value || '')
    .replace(/,/g, '')
    .match(/\d+/);
  return match ? Number(match[0]) : 0;
}

export function sortTopicsByTime<T extends { lastReplyAt?: string; createdAt: string }>(items: T[]) {
  return items
    .map((item) => ({ item, time: Date.parse(item.lastReplyAt || item.createdAt || '') }))
    .sort((left, right) => right.time - left.time)
    .map(({ item }) => item);
}

export function sortTopicsByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return items
    .map((item) => ({ item, time: Date.parse(item.createdAt || '') }))
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
