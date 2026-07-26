import { absoluteUrl, parseHtml, textContentFromHtml } from './localHtml';
import type { QuotedAuthorReference, TopicPoll } from './types';

export const DISCOURSE_POLL_PLACEHOLDER_TAG = 'forum-discourse-poll';

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

function localDiscourseQuoteFloor(node: ReturnType<typeof parseHtml>, topicId?: string) {
  if (!/\bquote\b/i.test(String(node.getAttribute('class') || ''))) {
    return undefined;
  }
  const quoteTopicId = String(node.getAttribute('data-topic') || '');
  if (topicId && quoteTopicId && quoteTopicId !== topicId) {
    return undefined;
  }
  const floor = Number(node.getAttribute('data-post'));
  return Number.isFinite(floor) && floor > 0 ? floor : undefined;
}

export function discourseQuoteMetadata(html: string, topicId?: string) {
  const floors = new Set<number>();
  const authors: Record<number, QuotedAuthorReference> = {};
  const previews: Record<number, string> = {};
  const root = parseHtml(html);
  root.querySelectorAll('aside').forEach((node) => {
    const floor = localDiscourseQuoteFloor(node, topicId);
    if (!floor) {
      return;
    }
    floors.add(floor);
    const username = String(node.getAttribute('data-username') || '').trim();
    const label = username
      || String(node.getAttribute('data-display-name') || '').trim()
      || quotedAuthorLabelFromAvatarUrl(String(node.querySelector('.title img')?.getAttribute('src') || ''))
      || quotedAuthorLabelFromTitle(textContentFromHtml(node.querySelector('.title')?.toString() || ''));
    const preview = textContentFromHtml(node.querySelector('blockquote')?.toString() || '').replace(/\s+/g, ' ').trim();
    if (label) {
      authors[floor] = { label, ...(username ? { username } : {}) };
    }
    if (preview) {
      previews[floor] = preview;
    }
    node.remove();
  });
  return { html: root.toString(), floors: [...floors], authors, previews };
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
