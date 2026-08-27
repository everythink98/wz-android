import { decodeHtml, escapeHtmlText, isRecord, parseHtml } from '@/domain/forum/html';
import type { TopicPoll, TopicPollOption } from '@/domain/forum/models';
import { NODESEEK_POLL_PLACEHOLDER_TAG } from '@/domain/forum/topicContentSplit';
import type { HTMLElement } from 'node-html-parser';
import { optionalBoolean, optionalInteger, optionalNonNegativeInteger } from './protocol';
import { NODESEEK_STARDUST_PLACEHOLDER_TAG } from './stardustMarkup';

export const NODESEEK_VOTE_API_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'x-dynamic-sign': 'a'.repeat(40)
} as const;
const NODESEEK_NON_POLL_CONTENT_SELECTOR = `img, video, audio, table, pre, code, svg, canvas, input, textarea, select, ${NODESEEK_STARDUST_PLACEHOLDER_TAG}`;
export function nodeSeekPollPlaceholderHtml(id: string) {
  return `<${NODESEEK_POLL_PLACEHOLDER_TAG} id="${encodeURIComponent(id)}"></${NODESEEK_POLL_PLACEHOLDER_TAG}>`;
}

function isNodeSeekPollMarkerShellText(value: string) {
  const text = decodeHtml(value).replace(/\s/g, '');
  return /^(?:"?>)?(?:提交投票)?(?:[（(][^()（）]*[)）])?$/.test(text);
}

export function normalizeNodeSeekPollPlaceholderNodes(root: HTMLElement, pollIds: Iterable<string>) {
  const placeholderIds = new Set(pollIds);
  if (!placeholderIds.size) {
    return;
  }
  root.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).forEach((element) => {
    const id = String(element.getAttribute('id') || '');
    if (!placeholderIds.has(id)) {
      return;
    }
    const nearestDiv = element.closest('div');
    const container =
      element.closest('p') ||
      (nearestDiv?.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).length === 1 ? nearestDiv : null);
    const containerHasOtherContent = Boolean(container?.querySelector(NODESEEK_NON_POLL_CONTENT_SELECTOR));
    if (
      container &&
      container.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).length === 1 &&
      !containerHasOtherContent &&
      isNodeSeekPollMarkerShellText(container.textContent || '')
    ) {
      container.replaceWith(nodeSeekPollPlaceholderHtml(id));
    }
  });
  root.querySelectorAll('p, div').forEach((element) => {
    if (
      !isNodeSeekPollMarkerShellText(element.textContent || '') ||
      element.querySelector(NODESEEK_NON_POLL_CONTENT_SELECTOR)
    ) {
      return;
    }
    const adjacentPollId = [element.previousElementSibling, element.nextElementSibling]
      .find((sibling) => String(sibling?.rawTagName || '').toLowerCase() === NODESEEK_POLL_PLACEHOLDER_TAG)
      ?.getAttribute('id');
    if (placeholderIds.has(String(adjacentPollId || ''))) {
      element.remove();
    }
  });
  const seen = new Set<string>();
  root.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).forEach((element) => {
    const id = String(element.getAttribute('id') || '');
    if (!placeholderIds.has(id)) {
      return;
    }
    const adjacentPrefix = element.previousSibling;
    if (
      adjacentPrefix &&
      String((adjacentPrefix as HTMLElement).rawTagName || '').toLowerCase() !== NODESEEK_POLL_PLACEHOLDER_TAG &&
      isNodeSeekPollMarkerShellText(adjacentPrefix.textContent || '') &&
      !(adjacentPrefix as HTMLElement).querySelector?.(NODESEEK_NON_POLL_CONTENT_SELECTOR)
    ) {
      adjacentPrefix.remove();
    }
    const anchor = element.closest('p') || element;
    const previous = anchor.previousElementSibling;
    if (
      previous &&
      String(previous.rawTagName || '').toLowerCase() !== NODESEEK_POLL_PLACEHOLDER_TAG &&
      isNodeSeekPollMarkerShellText(previous.textContent || '') &&
      !previous.querySelector(NODESEEK_NON_POLL_CONTENT_SELECTOR)
    ) {
      previous.remove();
    }
    if (seen.has(id)) {
      element.remove();
      return;
    }
    seen.add(id);
  });
}

function normalizeVoteTextNode(
  parent: HTMLElement,
  childIndex: number,
  pollIds: ReadonlySet<string>,
  discoveredIds: Set<string>
) {
  const child = parent.childNodes[childIndex];
  if (!child || child.nodeType !== 3) return 0;
  const text = child.text;
  const discovered = [...text.matchAll(/nsapp:\/\/vote\?id=(\d+)/gi)];
  discovered.forEach((match) => discoveredIds.add(match[1]));
  const matches = discovered.filter((match) => pollIds.has(match[1]));
  if (!matches.length) return 0;
  let cursor = 0;
  const replacementHtml = matches
    .map((match) => {
      const start = match.index;
      const prefix = escapeHtmlText(text.slice(cursor, start));
      cursor = start + match[0].length;
      return `${prefix}${nodeSeekPollPlaceholderHtml(match[1])}`;
    })
    .join('');
  const replacement = parseHtml(`${replacementHtml}${escapeHtmlText(text.slice(cursor))}`).childNodes;
  replacement.forEach((node) => {
    node.parentNode = parent;
  });
  parent.childNodes.splice(childIndex, 1, ...replacement);
  return replacement.length - 1;
}

export function normalizeNodeSeekVoteMarkers(root: HTMLElement, pollIds: Iterable<string>) {
  const loadedIds = new Set([...pollIds].filter((id) => /^\d+$/.test(id)));
  const discoveredIds = new Set<string>();
  const visit = (element: HTMLElement) => {
    const tag = String(element.rawTagName || '').toLowerCase();
    if (tag === 'pre' || tag === 'code') return;
    if (tag === 'a') {
      const text = decodeHtml(element.textContent || '').trim();
      const id = text.match(/^nsapp:\/\/vote\?id=(\d+)$/i)?.[1];
      if (id) {
        discoveredIds.add(id);
        element.replaceWith(loadedIds.has(id) ? nodeSeekPollPlaceholderHtml(id) : escapeHtmlText(text));
      }
      return;
    }
    for (let index = 0; index < element.childNodes.length; index += 1) {
      const child = element.childNodes[index];
      if (child?.nodeType === 1) visit(child as HTMLElement);
      else index += normalizeVoteTextNode(element, index, loadedIds, discoveredIds);
    }
  };
  visit(root);
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
