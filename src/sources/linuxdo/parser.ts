import type { TopicPoll } from '@/domain/forum/models';
import { FORUM_LINK_CARD_TAG, sanitizeContentHtml } from '@/domain/forum/html';
import {
  discourseContentNeedsCalloutNormalization,
  discoursePollPlaceholder,
  normalizeDiscourseCallouts
} from '@/sources/discourse/content';
import { LINUXDO_BASE_URL } from './protocol';

function escapeLinuxDoContentAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function redditSourceUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''), LINUXDO_BASE_URL);
    if (url.hostname.toLowerCase() !== 'embed.reddit.com') {
      return '';
    }
    url.protocol = 'https:';
    url.hostname = 'www.reddit.com';
    url.port = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function sanitizeLinuxDoContentHtml(html: unknown, polls: TopicPoll[] | undefined) {
  const pollNames = new Set((polls || []).map((poll) => poll.name).filter((name): name is string => Boolean(name)));
  const normalizeCallouts = discourseContentNeedsCalloutNormalization(html);
  return sanitizeContentHtml(html, LINUXDO_BASE_URL, (root) => {
    root.querySelectorAll('.poll').forEach((node) => {
      const name = String(node.getAttribute('data-poll-name') || '').trim();
      if (name && pollNames.has(name)) {
        node.replaceWith(discoursePollPlaceholder(name));
      }
    });
    root.querySelectorAll('iframe').forEach((node) => {
      const href = redditSourceUrl(node.getAttribute('src'));
      if (!href) {
        return;
      }
      node.replaceWith(
        `<${FORUM_LINK_CARD_TAG} href="${escapeLinuxDoContentAttribute(href)}" site="Reddit" title="Reddit 帖子" description="在 Reddit 中查看原帖"></${FORUM_LINK_CARD_TAG}>`
      );
    });
    if (normalizeCallouts) {
      normalizeDiscourseCallouts(root);
    }
  });
}
