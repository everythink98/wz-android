import type { Reply } from '@/domain/forum/models';
import { searchTerms, stripHtml } from '@/domain/forum/text';

export function filterRepliesByQuery(replies: Reply[], query: string) {
  const terms = searchTerms(query).map((term) => term.toLowerCase());
  if (terms.length === 0) return replies;
  return replies.filter((reply) => {
    const text = stripHtml(reply.contentHtml).toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
