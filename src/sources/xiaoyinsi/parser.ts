import type { HTMLElement } from 'node-html-parser';
import type { QuotedPostMetadata, TopicPoll } from '@/domain/forum/models';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import { discoursePollPlaceholder, prepareSanitizedForumContent } from '@/domain/forum/topicContentSplit';
import {
  discourseContentNeedsCalloutNormalization,
  discourseQuoteMetadataFromRoot,
  normalizeDiscourseCallouts
} from '@/sources/discourse/content';
import { XIAOYINSI_BASE_URL } from './protocol';

function xiaoyinsiContentTransform(html: unknown, polls?: TopicPoll[]) {
  const names = new Set((polls || []).map((poll) => poll.name).filter((name): name is string => Boolean(name)));
  const normalizeCallouts = discourseContentNeedsCalloutNormalization(html);
  return (root: HTMLElement) => {
    root.querySelectorAll('.poll').forEach((node) => {
      const name = String(node.getAttribute('data-poll-name') || '').trim();
      if (name && names.has(name)) {
        node.replaceWith(discoursePollPlaceholder(name));
      }
    });
    if (normalizeCallouts) {
      normalizeDiscourseCallouts(root);
    }
  };
}

export function sanitizeXiaoyinsiContentHtml(html: unknown, polls?: TopicPoll[]) {
  return sanitizeContentHtml(html, XIAOYINSI_BASE_URL, xiaoyinsiContentTransform(html, polls));
}

export function prepareXiaoyinsiContent(
  html: unknown,
  polls: TopicPoll[] | undefined,
  { role, topicId }: { role: 'opening' | 'reply'; topicId?: string }
) {
  let quotedPosts: QuotedPostMetadata[] = [];
  const preparedContent = prepareSanitizedForumContent(html, {
    baseUrl: XIAOYINSI_BASE_URL,
    polls,
    role,
    source: 'xiaoyinsi',
    topicId,
    transformRoot: xiaoyinsiContentTransform(html, polls),
    ...(role === 'reply'
      ? {
          afterSanitizeRoot: (root) => {
            quotedPosts = discourseQuoteMetadataFromRoot(root, 'xiaoyinsi', topicId);
          }
        }
      : {})
  });
  return { preparedContent, quotedPosts };
}
