import type { QuotedPostMetadata, TopicPoll } from '@/domain/forum/models';
import type { HTMLElement } from 'node-html-parser';
import {
  escapeHtmlAttribute,
  escapeHtmlText,
  FORUM_LINK_CARD_TAG,
  FORUM_MATH_BLOCK_TAG,
  FORUM_MATH_INLINE_TAG,
  hasRenderableHtmlContent,
  forumNodeText,
  parseForumContentHtml,
  transformForumElements
} from '@/domain/forum/html';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import { discoursePollPlaceholder, prepareSanitizedForumContent } from '@/domain/forum/topicContentSplit';
import {
  discourseContentNeedsCalloutNormalization,
  discourseQuoteMetadataFromRoot,
  normalizeDiscourseCallouts
} from '@/sources/discourse/content';
import { LINUXDO_BASE_URL } from './protocol';
import { normalizeDiscoursePolicyMarkup } from '@/sources/discourse/policy';

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

function linuxDoContentTransform(html: unknown, polls: TopicPoll[] | undefined) {
  const pollNames = new Set((polls || []).map((poll) => poll.name).filter((name): name is string => Boolean(name)));
  const normalizeCallouts = discourseContentNeedsCalloutNormalization(html);
  return (root: HTMLElement) => {
    normalizeDiscoursePolicyMarkup(root);
    for (const [selector, tagName] of [
      ['div.math', FORUM_MATH_BLOCK_TAG],
      ['span.math', FORUM_MATH_INLINE_TAG]
    ] as const) {
      transformForumElements(root, root.querySelectorAll(selector), (node) => {
        const source = forumNodeText(node).trim();
        return source ? parseForumContentHtml(`<${tagName}>${escapeHtmlText(source)}</${tagName}>`).childNodes : [];
      });
    }
    transformForumElements(root, root.querySelectorAll('.poll'), (node) => {
      const name = String(node.getAttribute('data-poll-name') || '').trim();
      if (name && pollNames.has(name)) {
        return parseForumContentHtml(discoursePollPlaceholder(name)).childNodes;
      }
    });
    transformForumElements(root, root.querySelectorAll('iframe'), (node) => {
      const href = redditSourceUrl(node.getAttribute('src'));
      if (!href) {
        return;
      }
      return parseForumContentHtml(
        `<${FORUM_LINK_CARD_TAG} href="${escapeHtmlAttribute(href)}" site="Reddit" title="Reddit 帖子" description="在 Reddit 中查看原帖"></${FORUM_LINK_CARD_TAG}>`
      ).childNodes;
    });
    if (normalizeCallouts) {
      normalizeDiscourseCallouts(root);
    }
  };
}

export function sanitizeLinuxDoContentHtml(html: unknown, polls: TopicPoll[] | undefined) {
  return sanitizeContentHtml(html, LINUXDO_BASE_URL, linuxDoContentTransform(html, polls));
}

export function prepareLinuxDoContent(
  html: unknown,
  polls: TopicPoll[] | undefined,
  {
    checkRenderability = false,
    role,
    topicId
  }: { checkRenderability?: boolean; role: 'opening' | 'reply'; topicId?: string }
) {
  let quotedPosts: QuotedPostMetadata[] = [];
  let hasRenderableContent = false;
  const preparedContent = prepareSanitizedForumContent(html, {
    baseUrl: LINUXDO_BASE_URL,
    polls,
    role,
    source: 'linuxdo',
    topicId,
    transformRoot: linuxDoContentTransform(html, polls),
    afterSanitizeRoot: (root) => {
      if (checkRenderability) hasRenderableContent = hasRenderableHtmlContent('', root);
      if (role === 'reply') quotedPosts = discourseQuoteMetadataFromRoot(root, 'linuxdo', topicId);
    }
  });
  return { hasRenderableContent, preparedContent, quotedPosts };
}
