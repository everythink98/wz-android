import type { QuotedPostMetadata, QuotedPostReference, Reply, Source, TopicDetail } from './models';
import type { DiscourseSource } from './sourceCatalog';

export type { QuotedPostReference } from './models';

export interface ToggleTopicBodyQuoteOptions {
  instanceKey: string;
  prefetch?: boolean;
  reference: QuotedPostReference;
  quotedPost?: Reply;
}

export interface ToggleReplyQuoteOptions {
  replyKey: string;
  reference: QuotedPostReference;
  quotedReply?: Reply;
}

function positivePostNumber(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function quotedPostReferenceFromReply(
  source: Source | undefined,
  topicId: string | undefined,
  postNumber: number | undefined
): QuotedPostReference | null {
  const normalizedTopicId = String(topicId || '').trim();
  const normalizedPostNumber = positivePostNumber(postNumber);
  return source && normalizedTopicId && normalizedPostNumber
    ? { source, topicId: normalizedTopicId, postNumber: normalizedPostNumber }
    : null;
}

export function discourseQuotedPostReferenceFromAttributes(
  source: DiscourseSource,
  attributes: Record<string, string | undefined>,
  fallbackTopicId?: string
): QuotedPostReference | null {
  return quotedPostReferenceFromReply(
    source,
    attributes['data-topic'] || fallbackTopicId,
    positivePostNumber(attributes['data-post']) || undefined
  );
}

export function quotedPostReferenceKey(reference: QuotedPostReference) {
  return `${reference.source}:${reference.topicId}:${reference.postNumber}`;
}

export function quotedPostsForSource(reply: Pick<Reply, 'quotedPosts'>, source: Source | undefined) {
  const unique = new Map<string, QuotedPostMetadata>();
  (reply.quotedPosts || []).forEach((quote) => {
    if (quote.reference.source === source) {
      unique.set(quotedPostReferenceKey(quote.reference), quote);
    }
  });
  return [...unique.values()];
}

export function replyForQuotedPost(
  reference: QuotedPostReference,
  source: Source | undefined,
  topicId: string | undefined,
  repliesByFloor: Map<number, Reply>,
  loadedQuotedReplies: Record<string, Reply>
) {
  return reference.source === source && reference.topicId === topicId
    ? repliesByFloor.get(reference.postNumber) || loadedQuotedReplies[quotedPostReferenceKey(reference)]
    : loadedQuotedReplies[quotedPostReferenceKey(reference)];
}

export function replyQuotedPostInstanceKey(replyKey: string, reference: QuotedPostReference) {
  return `reply:${replyKey}:${quotedPostReferenceKey(reference)}`;
}

export function topicQuotedPostInstanceKey(ownerTopicId: string, reference: QuotedPostReference) {
  return `topic:${ownerTopicId}:${quotedPostReferenceKey(reference)}`;
}

export function topicOpeningPostAsReply(topic: TopicDetail): Reply {
  return {
    author: topic.author,
    authorId: topic.authorId,
    authorAvatar: topic.authorAvatar,
    authorLevelLabel: topic.authorLevelLabel,
    authorUrl: topic.authorUrl,
    contentHtml: topic.contentHtml,
    createdAt: topic.createdAt,
    floor: 1,
    commentId: topic.commentId,
    polls: topic.polls
  };
}
