import {
  createForumTextIndex,
  escapeHtmlText,
  forumNodeText,
  isRecord,
  parseHtml,
  type ForumTextTape
} from '@/domain/forum/html';
import type { TopicPoll, TopicPollOption } from '@/domain/forum/models';
import { NODESEEK_POLL_PLACEHOLDER_TAG } from '@/domain/forum/topicContentSplit';
import type { HTMLElement, Node } from 'node-html-parser';
import { optionalBoolean, optionalInteger, optionalNonNegativeInteger } from './protocol';
import { NODESEEK_STARDUST_PLACEHOLDER_TAG } from './stardustMarkup';

export const NODESEEK_VOTE_API_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'x-dynamic-sign': 'a'.repeat(40)
} as const;
const NODESEEK_NON_POLL_CONTENT_TAGS = new Set([
  'img',
  'video',
  'audio',
  'table',
  'pre',
  'code',
  'svg',
  'canvas',
  'input',
  'textarea',
  'select',
  NODESEEK_STARDUST_PLACEHOLDER_TAG
]);
export function nodeSeekPollPlaceholderHtml(id: string) {
  return `<${NODESEEK_POLL_PLACEHOLDER_TAG} id="${encodeURIComponent(id)}"></${NODESEEK_POLL_PLACEHOLDER_TAG}>`;
}

type PollShellText = { length: number; prefix: string; last: string; parentheses: number };

function pollShellText(value: string): PollShellText {
  const text = value.replace(/\s/g, '');
  return {
    length: text.length,
    prefix: text.slice(0, 8),
    last: text.slice(-1),
    parentheses: text.match(/[()（）]/g)?.length || 0
  };
}

function pollMarkerShellIndex(root: HTMLElement) {
  const text = createForumTextIndex(root);
  const queries = new Map<ForumTextTape, (start: number, end: number) => PollShellText>();
  const leaves = new WeakMap<Node, PollShellText>();
  return (node: Node) => {
    let summary = leaves.get(node);
    if (!summary) {
      const segments = node.nodeType === 1 ? text.range(node as HTMLElement) : [];
      summary = pollShellText(node.nodeType === 1 ? '' : forumNodeText(node));
      for (const segment of segments) {
        let query = queries.get(segment.tape);
        if (!query) {
          const { text: source, nonWhitespacePrefix: counts } = segment.tape;
          const parentheses = new Uint32Array(source.length + 1);
          for (let index = 0; index < source.length; index++)
            parentheses[index + 1] = parentheses[index] + Number(/[()（）]/.test(source[index]));
          const character = (rank: number) => {
            let low = 0;
            let high = source.length;
            while (low < high) {
              const middle = (low + high) >>> 1;
              if (counts[middle + 1] < rank) low = middle + 1;
              else high = middle;
            }
            return source[low];
          };
          query = (start, end) => {
            const length = counts[end] - counts[start];
            let prefix = '';
            for (let offset = 1; offset <= Math.min(8, length); offset++) prefix += character(counts[start] + offset);
            return {
              length,
              prefix,
              last: length ? character(counts[end]) : '',
              parentheses: parentheses[end] - parentheses[start]
            };
          };
          queries.set(segment.tape, query);
        }
        const part = query(segment.start, segment.end);
        summary = {
          length: summary.length + part.length,
          prefix: (summary.prefix + part.prefix).slice(0, 8),
          last: part.last || summary.last,
          parentheses: summary.parentheses + part.parentheses
        };
      }
      leaves.set(node, summary);
    }
    let prefixLength = summary.prefix.startsWith('">') ? 2 : Number(summary.prefix.startsWith('>'));
    if (summary.prefix.slice(prefixLength).startsWith('提交投票')) prefixLength += 4;
    return (
      summary.length === prefixLength ||
      (summary.length >= prefixLength + 2 &&
        summary.parentheses === 2 &&
        /[（(]/.test(summary.prefix[prefixLength] || '') &&
        /[)）]/.test(summary.last))
    );
  };
}

type PollMarkupNode = {
  tag: string;
  paragraph: HTMLElement | null;
  div: HTMLElement | null;
  polls: number;
  protected: boolean;
  protectedChildren: boolean;
};
type PollSibling = {
  parent: HTMLElement;
  previous: Node | null;
  next: Node | null;
  previousElement: HTMLElement | null;
  nextElement: HTMLElement | null;
};

function pollMarkupSnapshot(root: HTMLElement) {
  const nodes = new Map<HTMLElement, PollMarkupNode>();
  const siblings = new Map<Node, PollSibling>();
  const pending: { node: HTMLElement; paragraph: HTMLElement | null; div: HTMLElement | null }[] = [
    { node: root, paragraph: null, div: null }
  ];
  while (pending.length) {
    const { node, paragraph, div } = pending.pop()!;
    const tag = String(node.rawTagName || '').toLowerCase();
    const record = {
      tag,
      paragraph: tag === 'p' ? node : paragraph,
      div: tag === 'div' ? node : div,
      polls: Number(tag === NODESEEK_POLL_PLACEHOLDER_TAG),
      protected: NODESEEK_NON_POLL_CONTENT_TAGS.has(tag),
      protectedChildren: false
    };
    nodes.set(node, record);
    let previous: Node | null = null;
    let previousElement: HTMLElement | null = null;
    for (const child of node.childNodes) {
      siblings.set(child, { parent: node, previous, next: null, previousElement, nextElement: null });
      if (previous) siblings.get(previous)!.next = child;
      if (child.nodeType === 1) {
        if (previousElement) siblings.get(previousElement)!.nextElement = child as HTMLElement;
        previousElement = child as HTMLElement;
      }
      previous = child;
    }
    for (let index = node.childNodes.length - 1; index >= 0; index--) {
      const child = node.childNodes[index];
      if (child.nodeType === 1)
        pending.push({ node: child as HTMLElement, paragraph: record.paragraph, div: record.div });
    }
  }
  for (const [node, record] of [...nodes].reverse()) {
    const parent = siblings.get(node)?.parent;
    const parentRecord = parent && nodes.get(parent);
    if (parentRecord) {
      parentRecord.polls += record.polls;
      parentRecord.protectedChildren ||= record.protected;
      parentRecord.protected ||= record.protected;
    }
  }
  const removed = new Set<Node>();
  const parents = new Set<HTMLElement>();
  function remove(node: Node) {
    if (removed.has(node)) return;
    const link = siblings.get(node);
    if (!link) return;
    if (link.previous) siblings.get(link.previous)!.next = link.next;
    if (link.next) siblings.get(link.next)!.previous = link.previous;
    if (node.nodeType === 1) {
      if (link.previousElement) siblings.get(link.previousElement)!.nextElement = link.nextElement;
      if (link.nextElement) siblings.get(link.nextElement)!.previousElement = link.previousElement;
    }
    removed.add(node);
    parents.add(link.parent);
    node.parentNode = null;
  }
  return {
    nodes,
    siblings,
    remove,
    flush() {
      for (const parent of parents) parent.childNodes = parent.childNodes.filter((child) => !removed.has(child));
    }
  };
}

function collapsePollMarkerContainers(
  root: HTMLElement,
  ids: ReadonlySet<string>,
  affectedContainers?: ReadonlySet<HTMLElement>
) {
  const { nodes, siblings } = pollMarkupSnapshot(root);
  const markerShell = pollMarkerShellIndex(root);
  const replacements = new Map<Node, HTMLElement>();
  const parents = new Set<HTMLElement>();
  for (const [element, record] of nodes) {
    if (record.tag !== NODESEEK_POLL_PLACEHOLDER_TAG) continue;
    const id = String(element.getAttribute('id') || '');
    if (!ids.has(id)) continue;
    const container = record.paragraph || record.div;
    const containerRecord = container && nodes.get(container);
    if (
      !container ||
      (affectedContainers && !affectedContainers.has(container)) ||
      !containerRecord ||
      containerRecord.polls !== 1 ||
      containerRecord.protectedChildren ||
      !markerShell(container)
    )
      continue;
    const parent = siblings.get(container)?.parent;
    if (!parent) continue;
    const replacement = parseHtml(nodeSeekPollPlaceholderHtml(id)).firstChild as HTMLElement;
    replacements.set(container, replacement);
    parents.add(parent);
    replacement.parentNode = parent;
    container.parentNode = null;
  }
  for (const parent of parents) parent.childNodes = parent.childNodes.map((child) => replacements.get(child) || child);
}

export function normalizeNodeSeekPollPlaceholderNodes(root: HTMLElement, pollIds: Iterable<string>) {
  const placeholderIds = new Set(pollIds);
  if (!placeholderIds.size) {
    return;
  }
  collapsePollMarkerContainers(root, placeholderIds);
  let snapshot = pollMarkupSnapshot(root);
  let markerShell = pollMarkerShellIndex(root);
  const deferredShells = new Set<Node>();
  for (const [element, record] of snapshot.nodes) {
    if (element === root || (record.tag !== 'p' && record.tag !== 'div')) continue;
    const link = snapshot.siblings.get(element)!;
    const adjacentPoll = [link.previousElement, link.nextElement].find(
      (sibling) => sibling && snapshot.nodes.get(sibling)?.tag === NODESEEK_POLL_PLACEHOLDER_TAG
    );
    if (
      adjacentPoll &&
      placeholderIds.has(String(adjacentPoll.getAttribute('id') || '')) &&
      !record.protectedChildren &&
      markerShell(element)
    ) {
      if (record.polls) deferredShells.add(element);
      else snapshot.remove(element);
    }
  }
  snapshot.flush();
  snapshot = pollMarkupSnapshot(root);
  markerShell = pollMarkerShellIndex(root);
  const seen = new Set<string>();
  const deduplicatedContainers = new Set<HTMLElement>();
  for (const [element, record] of snapshot.nodes) {
    if (record.tag !== NODESEEK_POLL_PLACEHOLDER_TAG) continue;
    const id = String(element.getAttribute('id') || '');
    if (!placeholderIds.has(id)) {
      continue;
    }
    const adjacentPrefix = snapshot.siblings.get(element)?.previous;
    if (
      adjacentPrefix &&
      snapshot.nodes.get(adjacentPrefix as HTMLElement)?.tag !== NODESEEK_POLL_PLACEHOLDER_TAG &&
      !snapshot.nodes.get(adjacentPrefix as HTMLElement)?.protectedChildren &&
      markerShell(adjacentPrefix)
    ) {
      if (snapshot.nodes.get(adjacentPrefix as HTMLElement)?.polls) deferredShells.add(adjacentPrefix);
      else snapshot.remove(adjacentPrefix);
    }
    const anchor = record.paragraph || element;
    const previousElement = snapshot.siblings.get(anchor)?.previousElement;
    // Deferred shells must expose the same preceding element as immediate removal did.
    const previous =
      previousElement === adjacentPrefix && adjacentPrefix && deferredShells.has(adjacentPrefix)
        ? snapshot.siblings.get(adjacentPrefix)?.previousElement
        : previousElement;
    if (
      previous &&
      snapshot.nodes.get(previous)?.tag !== NODESEEK_POLL_PLACEHOLDER_TAG &&
      !snapshot.nodes.get(previous)?.protectedChildren &&
      markerShell(previous)
    ) {
      if (snapshot.nodes.get(previous)?.polls) deferredShells.add(previous);
      else snapshot.remove(previous);
    }
    if (seen.has(id)) {
      const container = record.paragraph || record.div;
      if (container) deduplicatedContainers.add(container);
      snapshot.remove(element);
      continue;
    }
    seen.add(id);
  }
  snapshot.flush();
  if (deferredShells.size) {
    snapshot = pollMarkupSnapshot(root);
    markerShell = pollMarkerShellIndex(root);
    for (const node of deferredShells) {
      const record = snapshot.nodes.get(node as HTMLElement);
      if (record && !record.polls && !record.protectedChildren && markerShell(node)) snapshot.remove(node);
    }
    snapshot.flush();
  }
  // Deduplication can leave a single empty-text poll inside a paragraph; lift it before shell cleanup.
  if (deduplicatedContainers.size) collapsePollMarkerContainers(root, placeholderIds, deduplicatedContainers);
}

function normalizeVoteTextNode(child: Node, pollIds: ReadonlySet<string>, discoveredIds: Set<string>) {
  const text = child.text;
  const discovered = [...text.matchAll(/nsapp:\/\/vote\?id=(\d+)/gi)];
  discovered.forEach((match) => discoveredIds.add(match[1]));
  const matches = discovered.filter((match) => pollIds.has(match[1]));
  if (!matches.length) return null;
  let cursor = 0;
  const replacementHtml = matches
    .map((match) => {
      const start = match.index;
      const prefix = escapeHtmlText(text.slice(cursor, start));
      cursor = start + match[0].length;
      return `${prefix}${nodeSeekPollPlaceholderHtml(match[1])}`;
    })
    .join('');
  return parseHtml(`${replacementHtml}${escapeHtmlText(text.slice(cursor))}`).childNodes;
}

export function normalizeNodeSeekVoteMarkers(root: HTMLElement, pollIds: Iterable<string>) {
  const loadedIds = new Set([...pollIds].filter((id) => /^\d+$/.test(id)));
  const discoveredIds = new Set<string>();
  const pending = [{ element: root, index: 0, replacements: new Map<Node, Node[]>() }];
  while (pending.length) {
    const frame = pending.at(-1)!;
    const { element } = frame;
    if (frame.index === 0) {
      const tag = String(element.rawTagName || '').toLowerCase();
      if (tag === 'pre' || tag === 'code') {
        pending.pop();
        continue;
      }
      if (tag === 'a') {
        const text = forumNodeText(element).trim();
        const id = text.match(/^nsapp:\/\/vote\?id=(\d+)$/i)?.[1];
        if (id) {
          discoveredIds.add(id);
          const replacement = parseHtml(
            loadedIds.has(id) ? nodeSeekPollPlaceholderHtml(id) : escapeHtmlText(text)
          ).childNodes;
          const parent = pending.at(-2);
          if (parent) parent.replacements.set(element, replacement);
          else element.replaceWith(...replacement);
        }
        pending.pop();
        continue;
      }
    }
    if (frame.index >= element.childNodes.length) {
      if (frame.replacements.size) {
        element.childNodes = element.childNodes.flatMap((child) => {
          const replacement = frame.replacements.get(child);
          if (!replacement) return [child];
          if (child.nodeType === 1) child.parentNode = null;
          for (const node of replacement) node.parentNode = element;
          return replacement;
        });
      }
      pending.pop();
      continue;
    }
    const index = frame.index++;
    const child = element.childNodes[index];
    if (child?.nodeType === 1)
      pending.push({ element: child as HTMLElement, index: 0, replacements: new Map<Node, Node[]>() });
    else if (child?.nodeType === 3) {
      const replacement = normalizeVoteTextNode(child, loadedIds, discoveredIds);
      if (replacement) frame.replacements.set(child, replacement);
    }
  }
  if (loadedIds.size) normalizeNodeSeekPollPlaceholderNodes(root, loadedIds);
  return [...discoveredIds];
}

export function normalizeNodeSeekVoteInfo(value: unknown, fallbackId: string): TopicPoll | null {
  const source =
    isRecord(value) && isRecord(value.vote)
      ? value.vote
      : isRecord(value) && isRecord(value.detail)
        ? value.detail
        : isRecord(value)
          ? value
          : null;
  if (!source) {
    return null;
  }
  const pollId = String(source.id || source.voteId || fallbackId).trim();
  const itemValues = Array.isArray(source.items) ? source.items : Array.isArray(source.options) ? source.options : [];
  const rawOptions = itemValues
    .filter(isRecord)
    .map((item) => ({
      count: optionalInteger(item.count ?? item.votes),
      id: String(item.vote_item_id || item.id || item.itemId || '').trim(),
      label: String(item.text || item.label || item.name || item.title || '').trim(),
      selected: optionalBoolean(item.voted ?? item.selected) === true
    }))
    .filter((item) => item.id && item.label);
  const voted = optionalBoolean(source.voted) === true || rawOptions.some((option) => option.selected);
  const ownerId = optionalNonNegativeInteger(source.uid);
  const options = rawOptions.map((option): TopicPollOption => ({
    id: option.id,
    label: option.label,
    ...(voted && option.count !== undefined ? { count: option.count } : {}),
    selected: option.selected
  }));
  if (!pollId || !options.length) {
    return null;
  }
  return {
    id: pollId,
    ...(ownerId && ownerId > 0 ? { ownerId: String(ownerId) } : {}),
    title: String(source.title || '').trim() || undefined,
    public: optionalBoolean(source.isPublic ?? source.public),
    closed: optionalBoolean(source.locked ?? source.closed),
    multiple: optionalBoolean(source.multiple),
    voted,
    options
  };
}
