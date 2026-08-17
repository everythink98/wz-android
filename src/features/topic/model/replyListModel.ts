import type { QuotedPostMetadata, QuotedPostReference, Reply, Source } from '@/domain/forum/models';
import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import { replyKey } from '@/domain/forum/feed';
import {
  canCoalesceForumContentRows,
  requirePreparedForumContent,
  type CompiledForumContent,
  type CompiledForumContentRow,
  type ForumContentCompileRole
} from '@/domain/forum/topicContentSplit';
import { quotedPostsForSource, replyForQuotedPost, replyQuotedPostInstanceKey } from '@/domain/forum/quotedPosts';
import { stableTextHash } from './contentIdentity';

export type ReplyQuoteContent = Exclude<CompiledForumContentRow, { type: 'quote' }>;
export type ReplyRenderableContent = Exclude<ReplyQuoteContent, { type: 'poll' }>;

export type TopicReplyListItem =
  | { type: 'replyControls'; key: string }
  | { type: 'replyWindowStart'; key: string }
  | { type: 'emptyReplies'; key: string }
  | {
      type: 'reply';
      key: string;
      reply: Reply;
      replyFloor: number;
      bodyContent?: ReplyRenderableContent;
      networkMediaCount?: number;
      plannedRowCount?: number;
      signatureContent?: ReplyRenderableContent;
    }
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
  | {
      type: 'replyContent';
      key: string;
      reply: Reply;
      replyFloor: number;
      content: ReplyQuoteContent;
      first: boolean;
      last: boolean;
    }
  | {
      type: 'replySignatureContent';
      key: string;
      reply: Reply;
      replyFloor: number;
      content: ReplyRenderableContent;
      first: boolean;
      last: boolean;
    }
  | {
      type: 'replyEnd';
      key: string;
      reply: Reply;
      replyFloor: number;
      bodyVirtualized?: boolean;
      signatureVirtualized?: boolean;
    };

export const getReplyKey = replyKey;

type QuotedPostContentRow = { content: ReplyQuoteContent; key: string };
type QuotedPostContentEntry = { rows: QuotedPostContentRow[]; token: string };
const quotedPostContentCache = new WeakMap<Reply, Map<Source, QuotedPostContentEntry>>();

type ReplyBodyContentEntry = {
  compilation: CompiledForumContent;
  rows: QuotedPostContentRow[];
};
const replyBodyContentCache = new WeakMap<Reply, Map<string, ReplyBodyContentEntry>>();

type PlannedReplyContentEntry = {
  bodyRows: QuotedPostContentRow[];
  canMaterializeInOneCell: boolean;
  previewImages: readonly ForumImagePreviewDescriptor[];
  signatureRows: { content: ReplyRenderableContent; key: string }[];
};
const plannedReplyContentCache = new WeakMap<Reply, Map<Source, PlannedReplyContentEntry>>();

function replyRowsFromCompilation(compilation: CompiledForumContent): QuotedPostContentRow[] {
  return compilation.rows.flatMap<QuotedPostContentRow>((row) => {
    if (row.type === 'poll') {
      return [
        {
          content: row,
          key: `poll:${row.keySuffix}:${row.poll.name || row.poll.id || stableTextHash(JSON.stringify(row.poll))}`
        }
      ];
    }
    if (row.type === 'quote') return [];
    return [
      {
        content: row,
        key: `${row.type}:${row.semanticId}:${row.segmentIndex}`
      }
    ];
  });
}

function replyBodyContent(reply: Reply, source: Source, role: ForumContentCompileRole = 'reply') {
  const cacheKey = `${source}:${role}`;
  const cached = replyBodyContentCache.get(reply)?.get(cacheKey);
  if (cached) return cached;
  const compilation = requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
    polls: reply.polls,
    role,
    source
  });
  const entry = { compilation, rows: replyRowsFromCompilation(compilation) };
  const sourceCache = replyBodyContentCache.get(reply) || new Map<string, ReplyBodyContentEntry>();
  sourceCache.set(cacheKey, entry);
  replyBodyContentCache.set(reply, sourceCache);
  return entry;
}

function plannedReplyContent(reply: Reply, source: Source): PlannedReplyContentEntry {
  const cached = plannedReplyContentCache.get(reply)?.get(source);
  if (cached) return cached;
  const body = replyBodyContent(reply, source);
  const signature = requirePreparedForumContent(reply.preparedSignature, reply.signatureHtml, {
    role: 'signature',
    source
  });
  const bodyRows = body.rows;
  const signatureRows = signature.rows.flatMap((row) =>
    row.type !== 'poll' && row.type !== 'quote'
      ? [
          {
            content: row,
            key: `signature:${row.type}:${row.semanticId}:${row.segmentIndex}`
          }
        ]
      : []
  );
  const entry = {
    bodyRows,
    canMaterializeInOneCell: canCoalesceForumContentRows([
      body.compilation.materializationBudget,
      signature.materializationBudget
    ]),
    previewImages: [...body.compilation.previewImages, ...signature.previewImages],
    signatureRows
  };
  const sourceCache = plannedReplyContentCache.get(reply) || new Map<Source, PlannedReplyContentEntry>();
  sourceCache.set(source, entry);
  plannedReplyContentCache.set(reply, sourceCache);
  return entry;
}

export function imagePreviewDescriptorsForReplies(replies: readonly Reply[], source: Source) {
  return replies.flatMap((reply) => plannedReplyContent(reply, source).previewImages);
}

function quotedPostContent(reply: Reply, source: Source): QuotedPostContentEntry {
  const cached = quotedPostContentCache.get(reply)?.get(source);
  if (cached) return cached;
  const content = replyBodyContent(reply, source, 'quoted-reply').rows;
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
    const ownContent = !reply.systemAction && source ? plannedReplyContent(reply, source) : undefined;
    const bodyRows = ownContent?.bodyRows || [];
    const signatureRows = ownContent?.signatureRows || [];
    const virtualizesOwnContent =
      bodyRows.some((item) => item.content.type === 'poll') ||
      bodyRows.length > 1 ||
      signatureRows.length > 1 ||
      Boolean(ownContent && !ownContent.canMaterializeInOneCell);
    if (!quotes.length && !virtualizesOwnContent) {
      return [
        {
          type: 'reply' as const,
          key,
          reply,
          replyFloor,
          bodyContent: bodyRows[0]?.content.type !== 'poll' ? bodyRows[0]?.content : undefined,
          networkMediaCount:
            bodyRows.reduce((total, item) => total + item.content.networkMediaCount, 0) +
            signatureRows.reduce((total, item) => total + item.content.networkMediaCount, 0),
          plannedRowCount: bodyRows.length + signatureRows.length,
          signatureContent: signatureRows[0]?.content
        }
      ];
    }

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
    bodyRows.forEach((item, index) => {
      rows.push({
        type: 'replyContent',
        key: `${key}:body:${item.key}`,
        reply,
        replyFloor,
        content: item.content,
        first: index === 0,
        last: index === bodyRows.length - 1
      });
    });
    signatureRows.forEach((item, index) => {
      rows.push({
        type: 'replySignatureContent',
        key: `${key}:${item.key}`,
        reply,
        replyFloor,
        content: item.content,
        first: index === 0,
        last: index === signatureRows.length - 1
      });
    });
    rows.push({
      type: 'replyEnd',
      key: `${key}:body`,
      reply,
      replyFloor,
      bodyVirtualized: bodyRows.length > 0,
      signatureVirtualized: signatureRows.length > 0
    });
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
    if (trailing.type === 'replyContent' || trailing.type === 'replySignatureContent') return 0;
    if (trailing.type === 'replyQuoteSummary') return 12;
    if (trailing.type === 'replyEnd') return 8;
  }
  if (leading.type === 'replyContent') {
    if (trailing.type === 'replyContent' || trailing.type === 'replySignatureContent') return 0;
    if (trailing.type === 'replyEnd') return 8;
  }
  if (leading.type === 'replySignatureContent') {
    if (trailing.type === 'replySignatureContent') return 0;
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
