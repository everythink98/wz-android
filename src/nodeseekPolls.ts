import { decodeHtml, isRecord, parseHtml } from './localHtml';
import type { TopicPoll, TopicPollOption } from './types';

export const NODESEEK_VOTE_API_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'x-dynamic-sign': 'a'.repeat(40)
} as const;
export const NODESEEK_POLL_PLACEHOLDER_TAG = 'forum-nodeseek-poll';

export function nodeSeekPollPlaceholderHtml(id: string) {
  return `<${NODESEEK_POLL_PLACEHOLDER_TAG} id="${encodeURIComponent(id)}"></${NODESEEK_POLL_PLACEHOLDER_TAG}>`;
}

function optionalInteger(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  const match = String(value).replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function optionalBoolean(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export function normalizeNodeSeekVoteInfo(value: unknown, fallbackId: string): TopicPoll | null {
  const source = isRecord(value) && isRecord(value.vote)
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
  const itemValues = Array.isArray(source.items)
    ? source.items
    : Array.isArray(source.options)
      ? source.options
      : [];
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
    title: String(source.title || '').trim() || undefined,
    public: optionalBoolean(source.isPublic ?? source.public),
    closed: optionalBoolean(source.locked ?? source.closed),
    multiple: optionalBoolean(source.multiple),
    voted,
    options
  };
}

export function stripLoadedNodeSeekVoteMarkers(html: string, pollIds: Array<string | undefined>) {
  const ids = [...new Set(pollIds.filter((id): id is string => /^\d+$/.test(id || '')))];
  if (!ids.length) {
    return html;
  }
  const marker = 'nsapp:\\/\\/vote\\?id=(' + ids.join('|') + ')';
  let cleaned = html
    .replace(new RegExp(`<(p|div)\\b[^>]*>\\s*(?:(?:&quot;|")?\\s*(?:&gt;|>)\\s*)?(?:提交投票\\s*)?${marker}(?:\\s*[（(][^<)）]*[)）])?\\s*<\\/\\1>`, 'gi'), (_match, _tag, id: string) => nodeSeekPollPlaceholderHtml(id))
    .replace(new RegExp(marker, 'gi'), (_match, id: string) => nodeSeekPollPlaceholderHtml(id));
  const placeholderIds = new Set(ids.filter((id) => cleaned.includes(nodeSeekPollPlaceholderHtml(id))));
  if (!placeholderIds.size) {
    return cleaned;
  }
  const root = parseHtml(`<body>${cleaned}</body>`);
  root.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).forEach((element) => {
    const id = String(element.getAttribute('id') || '');
    if (!placeholderIds.has(id)) {
      return;
    }
    const nearestDiv = element.closest('div');
    const container = element.closest('p')
      || (nearestDiv?.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).length === 1 ? nearestDiv : null);
    const markerPrefix = decodeHtml(container?.textContent || '').replace(/\s/g, '');
    const containerHasOtherContent = Boolean(container?.querySelector('img, video, audio, table, pre, code, svg, canvas, input, textarea, select'));
    if (container && container.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).length === 1
      && !containerHasOtherContent && (!markerPrefix || /^"?>$/.test(markerPrefix))) {
      container.replaceWith(nodeSeekPollPlaceholderHtml(id));
    }
  });
  const seen = new Set<string>();
  root.querySelectorAll(NODESEEK_POLL_PLACEHOLDER_TAG).forEach((element) => {
    const id = String(element.getAttribute('id') || '');
    if (!placeholderIds.has(id)) {
      return;
    }
    const anchor = element.closest('p') || element;
    const previous = anchor.previousElementSibling;
    const previousPrefix = decodeHtml(previous?.textContent || '').replace(/\s/g, '');
    if (previous && /^"?>$/.test(previousPrefix)
      && !previous.querySelector('img, video, audio, table, pre, code, svg, canvas, input, textarea, select')) {
      previous.remove();
    }
    if (seen.has(id)) {
      element.remove();
      return;
    }
    seen.add(id);
  });
  return root.querySelector('body')?.innerHTML || cleaned;
}

export function splitNodeSeekContentHtml(html: string | undefined, polls: TopicPoll[] | undefined) {
  const clean = String(html || '').trim();
  const pollList = polls || [];
  if (!clean) {
    return pollList.map((poll) => ({ type: 'poll' as const, poll }));
  }
  const pollsById = new Map(pollList.flatMap((poll) => poll.id ? [[encodeURIComponent(poll.id), poll] as const] : []));
  const matchedPolls = new Set<TopicPoll>();
  const parts: Array<{ type: 'html'; html: string } | { type: 'poll'; poll: TopicPoll }> = [];
  const pattern = new RegExp(`<${NODESEEK_POLL_PLACEHOLDER_TAG}\\b[^>]*\\bid=["']([^"']+)["'][^>]*>\\s*<\\/${NODESEEK_POLL_PLACEHOLDER_TAG}\\s*>`, 'gi');
  let offset = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean))) {
    const before = clean.slice(offset, match.index).trim();
    if (before) {
      parts.push({ type: 'html', html: before });
    }
    const poll = pollsById.get(match[1] || '');
    if (poll && !matchedPolls.has(poll)) {
      parts.push({ type: 'poll', poll });
      matchedPolls.add(poll);
    }
    offset = pattern.lastIndex;
  }
  const after = clean.slice(offset).trim();
  if (after) {
    parts.push({ type: 'html', html: after });
  }
  for (const poll of pollList) {
    if (!matchedPolls.has(poll)) {
      parts.push({ type: 'poll', poll });
    }
  }
  return parts;
}
