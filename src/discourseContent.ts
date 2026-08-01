import { HTMLElement, TextNode, type Node } from 'node-html-parser';

import { absoluteUrl, decodeHtml, parseHtml, textContentFromHtml } from './localHtml';
import {
  discourseQuotedPostReferenceFromAttributes,
  quotedPostReferenceKey
} from './quotedPosts';
import type { DiscourseSource } from './sourceCatalog';
import type { QuotedPostMetadata, TopicPoll } from './types';

export const DISCOURSE_POLL_PLACEHOLDER_TAG = 'forum-discourse-poll';

export const DISCOURSE_CALLOUT_ATTRIBUTE = 'data-forum-callout';
export const DISCOURSE_CALLOUT_TYPE_ATTRIBUTE = 'data-forum-callout-type';
export const DISCOURSE_CALLOUT_FOLD_ATTRIBUTE = 'data-forum-callout-fold';
export const DISCOURSE_CALLOUT_TITLE_CLASS = 'forum-callout-title';
export const DISCOURSE_CALLOUT_CONTENT_CLASS = 'forum-callout-content';
export const DISCOURSE_CALLOUT_TONE_CLASS_PREFIX = 'forum-callout-tone-';

export type DiscourseCalloutType =
  | 'note'
  | 'abstract'
  | 'info'
  | 'todo'
  | 'tip'
  | 'success'
  | 'question'
  | 'warning'
  | 'failure'
  | 'danger'
  | 'bug'
  | 'example'
  | 'quote';

export type DiscourseCalloutFold = 'collapsed' | 'expanded';
export type DiscourseCalloutTone = 'primary' | 'success' | 'warning' | 'danger' | 'muted';

export type DiscourseCalloutDefinition = {
  title: string;
  tone: DiscourseCalloutTone;
  type: DiscourseCalloutType;
};

export function isDiscourseCalloutType(value: unknown): value is DiscourseCalloutType {
  const key = typeof value === 'string' ? value : '';
  return Boolean(key && DISCOURSE_CALLOUT_REGISTRY[key]?.type === key);
}

const callout = (
  type: DiscourseCalloutType,
  title: string,
  tone: DiscourseCalloutTone
): DiscourseCalloutDefinition => ({ type, title, tone });

export const DISCOURSE_CALLOUT_REGISTRY: Readonly<Record<string, DiscourseCalloutDefinition>> = {
  note: callout('note', 'Note', 'primary'),
  abstract: callout('abstract', 'Abstract', 'primary'),
  summary: callout('abstract', 'Summary', 'primary'),
  tldr: callout('abstract', 'TLDR', 'primary'),
  info: callout('info', 'Info', 'primary'),
  todo: callout('todo', 'Todo', 'primary'),
  tip: callout('tip', 'Tip', 'primary'),
  hint: callout('tip', 'Hint', 'primary'),
  important: callout('tip', 'Important', 'primary'),
  success: callout('success', 'Success', 'success'),
  check: callout('success', 'Check', 'success'),
  done: callout('success', 'Done', 'success'),
  question: callout('question', 'Question', 'warning'),
  help: callout('question', 'Help', 'warning'),
  faq: callout('question', 'FAQ', 'warning'),
  warning: callout('warning', 'Warning', 'warning'),
  caution: callout('warning', 'Caution', 'warning'),
  attention: callout('warning', 'Attention', 'warning'),
  failure: callout('failure', 'Failure', 'danger'),
  fail: callout('failure', 'Fail', 'danger'),
  missing: callout('failure', 'Missing', 'danger'),
  danger: callout('danger', 'Danger', 'danger'),
  error: callout('danger', 'Error', 'danger'),
  bug: callout('bug', 'Bug', 'danger'),
  example: callout('example', 'Example', 'primary'),
  quote: callout('quote', 'Quote', 'muted'),
  cite: callout('quote', 'Cite', 'muted')
};

const DEFAULT_CALLOUT = DISCOURSE_CALLOUT_REGISTRY.note;
const CALLOUT_MARKER = /^\s*\[!([^\]]+)\]([+-])?[ \t]*/i;
const MAX_CALLOUT_DEPTH = 100;

function isElementNode(node: Node): node is HTMLElement {
  return Boolean(node.rawTagName);
}

function isTextNode(node: Node): node is TextNode {
  return !node.rawTagName;
}

const VISIBLE_EMPTY_ELEMENTS = new Set(['audio', 'br', 'hr', 'iframe', 'img', 'input', 'svg', 'video']);

function nodeHasMeaningfulContent(node: Node): boolean {
  if (isTextNode(node)) {
    return Boolean(node.rawText.trim());
  }
  return VISIBLE_EMPTY_ELEMENTS.has(node.rawTagName.toLowerCase())
    || node.childNodes.some(nodeHasMeaningfulContent);
}

function firstMeaningfulNode(nodes: Node[]) {
  return nodes.find(nodeHasMeaningfulContent);
}

function markerTextNode(paragraph: HTMLElement) {
  const first = firstMeaningfulNode(paragraph.childNodes);
  if (!first) {
    return undefined;
  }
  if (isTextNode(first)) {
    return first;
  }
  if (first.rawTagName.toLowerCase() === 'br') {
    return undefined;
  }
  const nested = firstMeaningfulNode(first.childNodes);
  return nested && isTextNode(nested) ? nested : undefined;
}

function calloutMarker(blockquote: HTMLElement) {
  const paragraph = blockquote.firstElementChild;
  if (!paragraph || paragraph.rawTagName.toLowerCase() !== 'p') {
    return undefined;
  }
  const paragraphIndex = blockquote.childNodes.indexOf(paragraph);
  if (blockquote.childNodes.slice(0, paragraphIndex).some((node) => node.rawText.trim())) {
    return undefined;
  }
  const textNode = markerTextNode(paragraph);
  const rawMatch = textNode?.rawText.match(CALLOUT_MARKER);
  const match = rawMatch || textNode?.text.match(CALLOUT_MARKER);
  if (!textNode || !match) {
    return undefined;
  }
  const key = match[1].trim().toLowerCase();
  return {
    definition: Object.prototype.hasOwnProperty.call(DISCOURSE_CALLOUT_REGISTRY, key)
      ? DISCOURSE_CALLOUT_REGISTRY[key]
      : DEFAULT_CALLOUT,
    fold: match[2] === '-' ? 'collapsed' as const : match[2] === '+' ? 'expanded' as const : undefined,
    match,
    paragraph,
    rawMatch,
    textNode
  };
}

type InlineSplit = {
  after: Node[];
  before: Node[];
  separated: boolean;
};

function splitInlineNode(node: Node): InlineSplit {
  if (isTextNode(node)) {
    const separator = node.rawText.search(/[\r\n]/);
    if (separator < 0) {
      return { before: [node], after: [], separated: false };
    }
    const before = node.rawText.slice(0, separator);
    const after = node.rawText.slice(separator).replace(/^[\r\n]+/, '');
    node.rawText = before;
    return {
      before: before ? [node] : [],
      after: after ? [new TextNode(after)] : [],
      separated: true
    };
  }
  const element = node as HTMLElement;
  if (element.rawTagName.toLowerCase() === 'br') {
    return { before: [], after: [], separated: true };
  }
  const split = splitInlineNodes([...element.childNodes]);
  if (!split.separated) {
    return { before: [element], after: [], separated: false };
  }
  element.set_content(split.before);
  const afterElement = new HTMLElement(element.rawTagName, {}, element.rawAttrs);
  afterElement.set_content(split.after);
  return {
    before: split.before.some(nodeHasMeaningfulContent) ? [element] : [],
    after: split.after.some(nodeHasMeaningfulContent) ? [afterElement] : [],
    separated: true
  };
}

function splitInlineNodes(nodes: Node[]): InlineSplit {
  const before: Node[] = [];
  const after: Node[] = [];
  let separated = false;
  for (const node of nodes) {
    if (separated) {
      after.push(node);
      continue;
    }
    const split = splitInlineNode(node);
    before.push(...split.before);
    if (split.separated) {
      separated = true;
      after.push(...split.after);
    }
  }
  return { before, after, separated };
}

function removeEmptyMarkerWrapper(textNode: TextNode, paragraph: HTMLElement) {
  if (textNode.rawText) {
    return;
  }
  const parent = textNode.parentNode;
  textNode.remove();
  if (parent !== paragraph && !parent.rawText.trim() && !parent.querySelector('img,svg,video')) {
    parent.remove();
  }
}

function calloutDepth(blockquote: HTMLElement) {
  let depth = 1;
  let parent = blockquote.parentNode;
  while (parent) {
    if (parent.rawTagName?.toLowerCase() === 'blockquote' && calloutMarker(parent)) {
      depth += 1;
      if (depth > MAX_CALLOUT_DEPTH) {
        return depth;
      }
    }
    parent = parent.parentNode;
  }
  return depth;
}

function stripForgedCalloutSemantics(root: HTMLElement) {
  const visit = (node: HTMLElement) => {
    Object.keys(node.attributes).forEach((name) => {
      if (name.toLowerCase().startsWith('data-forum-callout')) {
        node.removeAttribute(name);
      }
    });
    const classAttributeNames = Object.keys(node.attributes)
      .filter((name) => name.toLowerCase() === 'class');
    const className = classAttributeNames
      .map((name) => String(node.attributes[name] || ''))
      .join(' ');
    if (className) {
      const next = className
        .split(/\s+/)
        .filter((name) => name && !name.toLowerCase().startsWith('forum-callout-'))
        .join(' ');
      classAttributeNames.forEach((name) => node.removeAttribute(name));
      if (next) {
        node.setAttribute('class', next);
      }
    }
    node.children.forEach(visit);
  };
  root.children.forEach(visit);
}

function stripCalloutTitleInlineStyles(nodes: Node[]) {
  const visit = (node: Node) => {
    if (!isElementNode(node)) {
      return;
    }
    Object.keys(node.attributes)
      .filter((name) => name.toLowerCase() === 'style')
      .forEach((name) => node.removeAttribute(name));
    node.childNodes.forEach(visit);
  };
  nodes.forEach(visit);
}

function normalizeCallout(blockquote: HTMLElement) {
  const marker = calloutMarker(blockquote);
  if (!marker || calloutDepth(blockquote) > MAX_CALLOUT_DEPTH) {
    return;
  }
  if (marker.rawMatch) {
    marker.textNode.rawText = marker.textNode.rawText.slice(marker.rawMatch[0].length);
  } else {
    marker.textNode.textContent = marker.textNode.text.slice(marker.match[0].length);
  }
  removeEmptyMarkerWrapper(marker.textNode, marker.paragraph);
  marker.paragraph.childNodes
    .filter((node) => isElementNode(node) && !nodeHasMeaningfulContent(node))
    .forEach((node) => node.remove());
  const title = splitInlineNodes([...marker.paragraph.childNodes]);
  const paragraphIndex = blockquote.childNodes.indexOf(marker.paragraph);
  const remaining = blockquote.childNodes.slice(paragraphIndex + 1);
  const paragraphBody = title.separated && title.after.some(nodeHasMeaningfulContent)
    ? marker.paragraph.set_content(title.after)
    : undefined;
  if (!paragraphBody) {
    marker.paragraph.set_content([]);
  }
  const bodyNodes: Node[] = [...(paragraphBody ? [paragraphBody] : []), ...remaining];
  const titleNodes = title.before.some(nodeHasMeaningfulContent)
    ? title.before
    : [new TextNode(marker.definition.title)];
  stripCalloutTitleInlineStyles(titleNodes);

  blockquote.set_content([]);
  const titleElement = new HTMLElement('div', {
    class: `${DISCOURSE_CALLOUT_TITLE_CLASS} ${DISCOURSE_CALLOUT_TONE_CLASS_PREFIX}${marker.definition.tone}`
  });
  titleElement.set_content(titleNodes);
  const calloutNodes: Node[] = [titleElement];
  if (bodyNodes.some(nodeHasMeaningfulContent)) {
    const contentElement = new HTMLElement('div', { class: DISCOURSE_CALLOUT_CONTENT_CLASS });
    contentElement.set_content(bodyNodes);
    calloutNodes.push(contentElement);
  }
  blockquote.set_content(calloutNodes);
  blockquote.setAttribute(DISCOURSE_CALLOUT_ATTRIBUTE, 'true');
  blockquote.setAttribute(DISCOURSE_CALLOUT_TYPE_ATTRIBUTE, marker.definition.type);
  if (marker.fold) {
    blockquote.setAttribute(DISCOURSE_CALLOUT_FOLD_ATTRIBUTE, marker.fold);
  }
}

export function discourseContentNeedsCalloutNormalization(html: unknown) {
  if (typeof html !== 'string') {
    return false;
  }
  const decoded = decodeHtml(html);
  return decoded.includes('[!') || /data-forum-callout|forum-callout-/i.test(decoded);
}

export function normalizeDiscourseCallouts(root: HTMLElement) {
  stripForgedCalloutSemantics(root);
  root.querySelectorAll('blockquote').reverse().forEach(normalizeCallout);
}

export function stripDiscourseCalloutMarkersFromExcerpt(value: unknown) {
  return String(value || '').replace(/\[![^\]]+\][+-]?[ \t]*/gim, '');
}

export function discourseAvatarUrl(value: unknown, baseUrl: string) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const url = absoluteUrl(value.replace('{size}', '96'), baseUrl);
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

function quotedAuthorLabelFromTitle(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.match(/^([^:：]{1,64})\s*[:：]/)?.[1]?.trim()
    || text.match(/([^:：\s]{1,64})\s*[:：]\s*$/)?.[1]?.trim()
    || '';
}

function quotedAuthorLabelFromAvatarUrl(value: string) {
  const match = value.trim().match(/(?:^|\/)user_avatar\/(?:[^/?#]+\/)?([^/?#]+)\/\d+(?:\/|$)/i)
    || value.trim().match(/(?:^|\/)letter_avatar\/([^/?#]+)\/\d+(?:\/|$)/i);
  if (!match) {
    return '';
  }
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

function discourseQuoteReference(
  node: ReturnType<typeof parseHtml>,
  source: DiscourseSource,
  topicId?: string
) {
  if (!/\bquote\b/i.test(String(node.getAttribute('class') || ''))) {
    return null;
  }
  return discourseQuotedPostReferenceFromAttributes(source, {
    'data-post': node.getAttribute('data-post'),
    'data-topic': node.getAttribute('data-topic')
  }, topicId);
}

export function discourseQuoteMetadata(html: string, source: DiscourseSource, topicId?: string) {
  const quotedPosts = new Map<string, QuotedPostMetadata>();
  const root = parseHtml(html);
  root.querySelectorAll('aside').forEach((node) => {
    const reference = discourseQuoteReference(node, source, topicId);
    if (!reference) {
      return;
    }
    const username = String(node.getAttribute('data-username') || '').trim();
    const label = username
      || String(node.getAttribute('data-display-name') || '').trim()
      || quotedAuthorLabelFromAvatarUrl(String(node.querySelector('.title img')?.getAttribute('src') || ''))
      || quotedAuthorLabelFromTitle(textContentFromHtml(node.querySelector('.title')?.toString() || ''));
    const preview = stripDiscourseCalloutMarkersFromExcerpt(
      textContentFromHtml(node.querySelector('blockquote')?.toString() || '')
    ).replace(/\s+/g, ' ').trim();
    const topicLink = node.querySelector('.quote-title__text-content a') || node.querySelector('.title a');
    const topicTitle = textContentFromHtml(topicLink?.toString() || '').replace(/\s+/g, ' ').trim();
    const topicUrl = String(topicLink?.getAttribute('href') || '').trim();
    const key = quotedPostReferenceKey(reference);
    quotedPosts.set(key, {
      ...quotedPosts.get(key),
      reference,
      ...(label ? { author: { label, ...(username ? { username } : {}) } } : {}),
      ...(preview ? { preview } : {}),
      ...(topicTitle ? { topicTitle } : {}),
      ...(topicUrl ? { topicUrl } : {})
    });
    node.remove();
  });
  return { html: root.toString(), quotedPosts: [...quotedPosts.values()] };
}

export type DiscourseContentPart =
  | { type: 'html'; html: string }
  | { type: 'poll'; poll: TopicPoll };

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function discoursePollPlaceholder(name: string) {
  return `<${DISCOURSE_POLL_PLACEHOLDER_TAG} name="${escapeAttribute(name)}"></${DISCOURSE_POLL_PLACEHOLDER_TAG}>`;
}

function contentTagName(node: unknown) {
  const value = node as { rawTagName?: unknown; tagName?: unknown };
  return String(value.rawTagName || value.tagName || '').toLowerCase();
}

export function splitDiscourseContentHtml(
  html: string | undefined,
  polls: TopicPoll[] | undefined
): DiscourseContentPart[] {
  const clean = String(html || '').trim();
  const pollList = polls || [];
  if (!clean) {
    return pollList.map((poll) => ({ type: 'poll', poll }));
  }
  if (!new RegExp(`<${DISCOURSE_POLL_PLACEHOLDER_TAG}\\b`, 'i').test(clean)) {
    return [
      { type: 'html', html: clean },
      ...pollList.map((poll) => ({ type: 'poll' as const, poll }))
    ];
  }
  const pollsByName = new Map(pollList.flatMap((poll) => poll.name ? [[poll.name, poll] as const] : []));
  const matchedPolls = new Set<TopicPoll>();
  const parts: DiscourseContentPart[] = [];
  let currentHtml = '';
  const pushHtml = () => {
    const value = currentHtml.trim();
    if (value) {
      parts.push({ type: 'html', html: value });
    }
    currentHtml = '';
  };
  try {
    const nodes = parseHtml(`<body>${clean}</body>`).querySelector('body')?.childNodes || [];
    for (const node of nodes) {
      if (contentTagName(node) === DISCOURSE_POLL_PLACEHOLDER_TAG) {
        const name = String((node as unknown as { getAttribute?: (key: string) => string | undefined }).getAttribute?.('name') || '').trim();
        const poll = pollsByName.get(name);
        if (poll) {
          pushHtml();
          parts.push({ type: 'poll', poll });
          matchedPolls.add(poll);
        }
        continue;
      }
      currentHtml += node.toString();
    }
    pushHtml();
  } catch {
    const placeholder = new RegExp(`<${DISCOURSE_POLL_PLACEHOLDER_TAG}\\b[^>]*>\\s*</${DISCOURSE_POLL_PLACEHOLDER_TAG}\\s*>`, 'gi');
    const fallback = clean.replace(placeholder, '').trim();
    if (fallback) {
      parts.push({ type: 'html', html: fallback });
    }
  }
  pollList.filter((poll) => !matchedPolls.has(poll)).forEach((poll) => parts.push({ type: 'poll', poll }));
  return parts;
}
