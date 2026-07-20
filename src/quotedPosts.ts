import type { Reply, Source } from './types';
import type { DiscourseSource } from './sourceCatalog';

export interface QuotedPostReference {
  source: Source;
  topicId: string;
  postNumber: number;
}

export interface ToggleTopicBodyQuoteOptions {
  instanceKey: string;
  reference: QuotedPostReference;
  quotedPost?: Reply;
}

export interface ToggleReplyQuoteOptions {
  replyFloor: number;
  quotedFloor: number;
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

export function replyQuotedPostInstanceKey(replyFloor: number, reference: QuotedPostReference) {
  return `reply:${replyFloor}:${quotedPostReferenceKey(reference)}`;
}

export function topicQuotedPostInstanceKey(ownerTopicId: string, reference: QuotedPostReference) {
  return `topic:${ownerTopicId}:${quotedPostReferenceKey(reference)}`;
}
