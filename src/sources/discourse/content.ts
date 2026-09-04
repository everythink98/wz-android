import { HTMLElement, TextNode, type Node } from 'node-html-parser';

import { absoluteUrl, decodeHtml } from '@/domain/forum/html';
import { discourseQuotedPostMetadataFromNode, quotedPostReferenceKey } from '@/domain/forum/quotedPosts';
import type { DiscourseSource } from '@/domain/forum/sourceCatalog';
import type { QuotedPostMetadata } from '@/domain/forum/models';
import {
  DISCOURSE_CALLOUT_ATTRIBUTE,
  DISCOURSE_CALLOUT_CONTENT_CLASS,
  DISCOURSE_CALLOUT_FOLD_ATTRIBUTE,
  DISCOURSE_CALLOUT_REGISTRY,
  DISCOURSE_CALLOUT_TITLE_CLASS,
  DISCOURSE_CALLOUT_TONE_CLASS_PREFIX,
  DISCOURSE_CALLOUT_TYPE_ATTRIBUTE
} from '@/domain/forum/callouts';

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
  return VISIBLE_EMPTY_ELEMENTS.has(node.rawTagName.toLowerCase()) || node.childNodes.some(nodeHasMeaningfulContent);
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
    fold: match[2] === '-' ? ('collapsed' as const) : match[2] === '+' ? ('expanded' as const) : undefined,
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
  if (parent && parent !== paragraph && !parent.rawText.trim() && !parent.querySelector('img,svg,video')) {
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
    const classAttributeNames = Object.keys(node.attributes).filter((name) => name.toLowerCase() === 'class');
    const className = classAttributeNames.map((name) => String(node.attributes[name] || '')).join(' ');
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
  const paragraphBody =
    title.separated && title.after.some(nodeHasMeaningfulContent)
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

export function discourseQuoteMetadataFromRoot(root: HTMLElement, source: DiscourseSource, topicId?: string) {
  const quotedPosts = new Map<string, QuotedPostMetadata>();
  root.querySelectorAll('aside').forEach((node) => {
    const metadata = discourseQuotedPostMetadataFromNode(node, source, topicId);
    if (!metadata) return;
    const key = quotedPostReferenceKey(metadata.reference);
    quotedPosts.set(key, {
      ...quotedPosts.get(key),
      ...metadata
    });
    node.remove();
  });
  return [...quotedPosts.values()];
}
