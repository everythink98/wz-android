import type { QuotedPostMetadata, QuotedPostReference, Reply, Source, TopicDetail } from './models';
import type { DiscourseSource } from './sourceCatalog';
import { textContentFromHtml } from './html';

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

const MAX_QUOTED_POST_PREVIEW_CHARACTERS = 320;

export function boundedQuotedPostPreview(value: string | undefined) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  const characters: string[] = [];
  let truncated = false;
  for (const character of normalized) {
    if (characters.length >= MAX_QUOTED_POST_PREVIEW_CHARACTERS) {
      truncated = true;
      break;
    }
    characters.push(character);
  }
  if (!truncated) return normalized;
  return `${characters
    .slice(0, MAX_QUOTED_POST_PREVIEW_CHARACTERS - 1)
    .join('')
    .trimEnd()}…`;
}

export type DiscourseQuoteNode = {
  getAttribute?: (name: string) => string | undefined;
  querySelector?: (selector: string) => DiscourseQuoteNode | null;
  text?: string;
  toString?: () => string;
};

function discourseQuoteNodeAttribute(node: DiscourseQuoteNode | null | undefined, name: string) {
  return String(node?.getAttribute?.(name) || '').trim();
}

function discourseQuoteNodeText(node: DiscourseQuoteNode | null | undefined) {
  return textContentFromHtml(node?.toString?.() || node?.text || '');
}

function quotedAuthorLabelFromTitle(value: string) {
  return (
    value.match(/^([^:：]{1,64})\s*[:：]/)?.[1]?.trim() ||
    value.match(/([^:：\s]{1,64})\s*[:：]\s*$/)?.[1]?.trim() ||
    ''
  );
}

function quotedAuthorLabelFromAvatarUrl(value: string) {
  const match =
    value.match(/(?:^|\/)user_avatar\/(?:[^/?#]+\/)?([^/?#]+)\/\d+(?:\/|$)/i) ||
    value.match(/(?:^|\/)letter_avatar\/([^/?#]+)\/\d+(?:\/|$)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

export function discourseQuotedPostMetadataFromNode(
  node: DiscourseQuoteNode,
  source: DiscourseSource,
  topicId?: string
): QuotedPostMetadata | null {
  if (!/\bquote\b/i.test(discourseQuoteNodeAttribute(node, 'class'))) return null;
  const reference = discourseQuotedPostReferenceFromAttributes(
    source,
    {
      'data-post': discourseQuoteNodeAttribute(node, 'data-post'),
      'data-topic': discourseQuoteNodeAttribute(node, 'data-topic')
    },
    topicId
  );
  if (!reference) return null;
  const title = node.querySelector?.('.title');
  const username = discourseQuoteNodeAttribute(node, 'data-username');
  const label =
    username ||
    discourseQuoteNodeAttribute(node, 'data-display-name') ||
    quotedAuthorLabelFromAvatarUrl(discourseQuoteNodeAttribute(title?.querySelector?.('img'), 'src')) ||
    quotedAuthorLabelFromTitle(discourseQuoteNodeText(title));
  const preview = boundedQuotedPostPreview(
    discourseQuoteNodeText(node.querySelector?.('blockquote')).replace(/\[![^\]]+\][+-]?[ \t]*/gim, '')
  );
  const topicLink = node.querySelector?.('.quote-title__text-content a') || title?.querySelector?.('a');
  const topicTitle = discourseQuoteNodeText(topicLink);
  const topicUrl = discourseQuoteNodeAttribute(topicLink, 'href');
  return {
    reference,
    ...(label ? { author: { label, ...(username ? { username } : {}) } } : {}),
    ...(preview ? { preview } : {}),
    ...(topicTitle ? { topicTitle } : {}),
    ...(topicUrl ? { topicUrl } : {})
  };
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
