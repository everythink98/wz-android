import { parseHtml } from './localHtml';
import type { TopicPoll } from './types';

export const DISCOURSE_POLL_PLACEHOLDER_TAG = 'forum-discourse-poll';

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
