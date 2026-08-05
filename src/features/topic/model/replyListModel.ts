import type { QuotedPostMetadata, QuotedPostReference, Reply, Source, TopicPoll } from '@/domain/forum/models';
import { replyKey } from '@/domain/forum/feed';
import { splitTopicContentHtml } from '@/domain/forum/topicContentSplit';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { quotedPostsForSource, replyForQuotedPost, replyQuotedPostInstanceKey } from '@/domain/forum/quotedPosts';
import { splitDiscourseContentHtml } from '@/sources/discourse/content';
import { stableTextHash } from './contentIdentity';

export type ReplyQuoteContent = { type: 'html'; html: string } | { type: 'poll'; poll: TopicPoll };

export type TopicReplyListItem =
  | { type: 'replyControls'; key: string }
  | { type: 'replyWindowStart'; key: string }
  | { type: 'emptyReplies'; key: string }
  | { type: 'reply'; key: string; reply: Reply; replyFloor: number }
  | { type: 'replyStart'; key: string; reply: Reply; replyFloor: number }
  | {
      type: 'replyQuoteSummary';
      key: string;
      reply: Reply;
      replyFloor: number;
      quote: QuotedPostMetadata;
      quotedReply?: Reply;
      expanded: boolean;
      loading: boolean;
      hasContent: boolean;
    }
  | {
      type: 'replyQuoteContent';
      key: string;
      contentToken: string;
      reply: Reply;
      replyFloor: number;
      instanceKey: string;
      measureForMaterialization: boolean;
      reference: QuotedPostReference;
      content: ReplyQuoteContent;
      first: boolean;
      last: boolean;
    }
  | { type: 'replyEnd'; key: string; reply: Reply; replyFloor: number };

export const getReplyKey = replyKey;

type QuotedPostContentRow = { content: ReplyQuoteContent; key: string };
type QuotedPostContentEntry = { rows: QuotedPostContentRow[]; token: string };
const quotedPostContentCache = new WeakMap<Reply, Map<Source, QuotedPostContentEntry>>();

function quotedPostContent(reply: Reply, source: Source): QuotedPostContentEntry {
  const cached = quotedPostContentCache.get(reply)?.get(source);
  if (cached) return cached;
  const parts = isDiscourseSource(source)
    ? splitDiscourseContentHtml(reply.contentHtml, reply.polls)
    : [{ type: 'html' as const, html: reply.contentHtml }];
  const content = parts.flatMap<QuotedPostContentRow>((part, partIndex) =>
    part.type === 'poll'
      ? [
          {
            content: { type: 'poll', poll: part.poll },
            key: `poll:${partIndex}:${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`
          }
        ]
      : splitTopicContentHtml(part.html).map((html, chunkIndex) => ({
          content: { type: 'html', html },
          key: `html:${partIndex}:${chunkIndex}:${stableTextHash(html)}`
        }))
  );
  const entry = {
    rows: content,
    token: `${source}:${reply.contentHtml.length}:${content.map((item) => item.key).join('|')}`
  };
  const sourceCache = quotedPostContentCache.get(reply) || new Map<Source, QuotedPostContentEntry>();
  sourceCache.set(source, entry);
  quotedPostContentCache.set(reply, sourceCache);
  return entry;
}

export function buildVirtualizedReplyItems({
  expandedQuotes,
  loadedQuotedReplies,
  loadingQuotedFloors,
  primedQuoteContentTokens,
  replies,
  repliesByFloor,
  source,
  topicId
}: {
  expandedQuotes: Record<string, boolean>;
  loadedQuotedReplies: Record<string, Reply>;
  loadingQuotedFloors: Record<string, boolean>;
  primedQuoteContentTokens?: ReadonlyMap<string, string>;
  replies: Reply[];
  repliesByFloor: Map<number, Reply>;
  source: Source | undefined;
  topicId: string | undefined;
}): TopicReplyListItem[] {
  return replies.flatMap((reply) => {
    const key = getReplyKey(reply);
    const replyFloor = reply.floor ?? 0;
    const quotes = reply.systemAction ? [] : quotedPostsForSource(reply, source);
    if (!quotes.length) return [{ type: 'reply' as const, key, reply, replyFloor }];

    const rows: TopicReplyListItem[] = [{ type: 'replyStart', key, reply, replyFloor }];
    quotes.forEach((quote) => {
      const instanceKey = replyQuotedPostInstanceKey(key, quote.reference);
      const expanded = Boolean(expandedQuotes[instanceKey]);
      const quotedReply = replyForQuotedPost(quote.reference, source, topicId, repliesByFloor, loadedQuotedReplies);
      const contentEntry = expanded && quotedReply ? quotedPostContent(quotedReply, quote.reference.source) : undefined;
      const content = contentEntry?.rows || [];
      const fullyMaterialized =
        !contentEntry || content.length <= 2 || primedQuoteContentTokens?.get(instanceKey) === contentEntry.token;
      const visibleContent = fullyMaterialized ? content : content.slice(0, 2);
      rows.push({
        type: 'replyQuoteSummary',
        key: instanceKey,
        reply,
        replyFloor,
        quote,
        quotedReply,
        expanded,
        loading: Boolean(loadingQuotedFloors[instanceKey]),
        hasContent: content.length > 0
      });
      visibleContent.forEach((item, index) => {
        rows.push({
          type: 'replyQuoteContent',
          key: `${instanceKey}:body:${item.key}`,
          contentToken: contentEntry!.token,
          reply,
          replyFloor,
          instanceKey,
          measureForMaterialization: !fullyMaterialized,
          reference: quote.reference,
          content: item.content,
          first: index === 0,
          last: index === visibleContent.length - 1
        });
      });
    });
    rows.push({ type: 'replyEnd', key: `${key}:body`, reply, replyFloor });
    return rows;
  });
}

export function topicListItemSpacing(leading: TopicReplyListItem, trailing: TopicReplyListItem) {
  if (leading.type === 'replyStart' && trailing.type === 'replyQuoteSummary') return 8;
  if (leading.type === 'replyQuoteSummary') {
    if (leading.hasContent && trailing.type === 'replyQuoteContent') return 0;
    if (trailing.type === 'replyQuoteSummary') return 12;
    if (trailing.type === 'replyEnd') return 8;
  }
  if (leading.type === 'replyQuoteContent') {
    if (trailing.type === 'replyQuoteContent') return 0;
    if (trailing.type === 'replyQuoteSummary') return 12;
    if (trailing.type === 'replyEnd') return 8;
  }
  return 10;
}

export function buildReplyListItems({
  canShowReplies,
  showWindowStart = false,
  replyItems,
  topicShowsAccessNotice
}: {
  canShowReplies: boolean;
  showWindowStart?: boolean;
  replyItems: TopicReplyListItem[];
  topicShowsAccessNotice: boolean;
}): TopicReplyListItem[] {
  if (!canShowReplies || topicShowsAccessNotice) return [];
  return [
    { type: 'replyControls', key: 'reply-controls' },
    ...(showWindowStart ? ([{ type: 'replyWindowStart', key: 'reply-window-start' }] as const) : []),
    ...(replyItems.length
      ? replyItems
      : ([{ type: 'emptyReplies', key: 'empty-replies' }] satisfies TopicReplyListItem[]))
  ];
}
