import type {
  AccessRequirement,
  QuotedPostMetadata,
  QuotedPostReference,
  Reply,
  Source,
  Topic,
  TopicDetail,
  TopicPoll
} from '@/domain/forum/models';
import { accessRequirementFromNoticeText, textContentFromHtml } from '@/domain/forum/html';
import { replyKey } from '@/feedLogic';
import { splitDiscourseContentHtml } from '@/discourseContent';
import { splitTopicContentHtml } from '@/domain/forum/topicContentSplit';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { quotedPostsForSource, replyForQuotedPost, replyQuotedPostInstanceKey } from '@/domain/forum/quotedPosts';

export type ReplyQuoteContent = { type: 'html'; html: string } | { type: 'poll'; poll: TopicPoll };

export type TopicListItem =
  | { type: 'replyControls'; key: string }
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

function stableTextHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function slowModeLabel(seconds: number) {
  return seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

const getReplyKey = replyKey;
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
            content: { type: 'poll' as const, poll: part.poll },
            key: `poll:${partIndex}:${part.poll.name || part.poll.id || stableTextHash(JSON.stringify(part.poll))}`
          }
        ]
      : splitTopicContentHtml(part.html).map((html, chunkIndex) => ({
          content: { type: 'html' as const, html },
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
}): TopicListItem[] {
  return replies.flatMap((reply) => {
    const key = getReplyKey(reply);
    const replyFloor = reply.floor ?? 0;
    const quotes = reply.systemAction ? [] : quotedPostsForSource(reply, source);
    if (!quotes.length) {
      return [{ type: 'reply' as const, key, reply, replyFloor }];
    }

    const rows: TopicListItem[] = [{ type: 'replyStart', key, reply, replyFloor }];
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

export function topicListItemSpacing(leading: TopicListItem, trailing: TopicListItem) {
  if (leading.type === 'replyStart' && trailing.type === 'replyQuoteSummary') {
    return 8;
  }
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

export function topicStatusBadges(
  item: Pick<Topic, 'acceptedAnswerFloor' | 'archived' | 'closed' | 'pinned' | 'slowModeSeconds' | 'solved'>
) {
  const badges: { label: string; tone: 'success' | 'accent' | 'danger' | 'neutral' | 'warning' }[] = [];
  if (item.solved) {
    badges.push({ label: '已解决', tone: 'success' });
  }
  if (item.acceptedAnswerFloor) {
    badges.push({ label: `采纳 #${item.acceptedAnswerFloor}`, tone: 'success' });
  }
  if (item.pinned) {
    badges.push({ label: '置顶', tone: 'accent' });
  }
  if (item.closed) {
    badges.push({ label: '已关闭', tone: 'danger' });
  }
  if (item.archived) {
    badges.push({ label: '已归档', tone: 'neutral' });
  }
  if (item.slowModeSeconds) {
    badges.push({ label: `慢速 ${slowModeLabel(item.slowModeSeconds)}`, tone: 'warning' });
  }
  return badges;
}

export function readableTopicError(message: string) {
  if (/upstream unavailable/i.test(message)) {
    return '来源暂时不可用，请稍后重试';
  }
  if (/^HTTP 5\d\d$/i.test(message)) {
    return `来源暂时不可用（${message}）`;
  }
  return message;
}

export function isAccessNoticeHtml(html: string, accessRequirement?: AccessRequirement) {
  if (!accessRequirement) {
    return false;
  }
  const text = textContentFromHtml(html);
  return !text || Boolean(accessRequirementFromNoticeText(text));
}

export function buildReplyListItems({
  canShowReplies,
  replyItems,
  topicShowsAccessNotice
}: {
  canShowReplies: boolean;
  replyItems: TopicListItem[];
  topicShowsAccessNotice: boolean;
}): TopicListItem[] {
  if (!canShowReplies || topicShowsAccessNotice) {
    return [];
  }
  return [
    { type: 'replyControls', key: 'reply-controls' },
    ...(replyItems.length ? replyItems : [{ type: 'emptyReplies', key: 'empty-replies' } as TopicListItem])
  ];
}

export function hasSameYaohuoTopicLayout(previous: TopicDetail | null, current: TopicDetail | null) {
  if (
    !previous ||
    !current ||
    previous.source !== 'yaohuo' ||
    current.source !== 'yaohuo' ||
    previous.id !== current.id
  ) {
    return false;
  }
  const previousRecord = previous as unknown as Record<string, unknown>;
  const currentRecord = current as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousRecord), ...Object.keys(currentRecord)]);
  for (const key of keys) {
    if (key === 'bookmarked' || key === 'bookmarkId') {
      continue;
    }
    if (!Object.is(previousRecord[key], currentRecord[key])) {
      return false;
    }
  }
  return true;
}

export { getReplyKey, stableTextHash };
