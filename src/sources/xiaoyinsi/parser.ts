import type { TopicPoll } from '@/domain/forum/models';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import {
  discourseContentNeedsCalloutNormalization,
  discoursePollPlaceholder,
  normalizeDiscourseCallouts
} from '@/sources/discourse/content';
import { XIAOYINSI_BASE_URL } from './protocol';

export function sanitizeXiaoyinsiContentHtml(html: unknown, polls?: TopicPoll[]) {
  const names = new Set((polls || []).map((poll) => poll.name).filter((name): name is string => Boolean(name)));
  const normalizeCallouts = discourseContentNeedsCalloutNormalization(html);
  return sanitizeContentHtml(html, XIAOYINSI_BASE_URL, (root) => {
    root.querySelectorAll('.poll').forEach((node) => {
      const name = String(node.getAttribute('data-poll-name') || '').trim();
      if (name && names.has(name)) {
        node.replaceWith(discoursePollPlaceholder(name));
      }
    });
    if (normalizeCallouts) {
      normalizeDiscourseCallouts(root);
    }
  });
}
