import type { Reply } from '@/domain/forum/models';
import { searchTerms, stripHtml } from '@/domain/forum/text';

export function createReplyTextIndex(replies: Reply[]) {
  return new Map(replies.map((reply) => [reply, stripHtml(reply.contentHtml).toLowerCase()]));
}

export function createReplyTextIndexForQuery(replies: Reply[], query: string) {
  return searchTerms(query).length > 0 ? createReplyTextIndex(replies) : undefined;
}

export function filterRepliesByQuery(replies: Reply[], query: string, textIndex?: Map<Reply, string>) {
  const terms = searchTerms(query);
  if (terms.length === 0) return replies;
  return replies.filter((reply) => {
    const text = textIndex?.get(reply) ?? stripHtml(reply.contentHtml).toLowerCase();
    return terms.every((term) => text.includes(term.toLowerCase()));
  });
}
