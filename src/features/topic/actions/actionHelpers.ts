import type { ReplyEditTarget, ReplyRefreshTarget } from '../model/types';
import { nodeSeekMarkdownToHtml } from '@/sources/nodeseek/markdown';
import { extractNodeSeekVoteIds, prepareNodeSeekForumContent } from '@/sources/nodeseek/topicParser';
import { sourceSupportsTopicAction } from '@/domain/forum/sourceCatalog';
import type { Reply, Source, Topic, TopicDetail, TopicPoll, UserIdentity } from '@/domain/forum/models';
import { findReplyLocation } from '@/domain/forum/replyLocation';
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query';
import type { ReplyPage, ReplyPageParam } from '../model/replyPagination';

type TopicActionTopic = Topic | TopicDetail;

export const YAOHUO_DEFAULT_CLASS_ID = '177';

export function currentTopicActionTopic(topicDetail: TopicDetail | null, selectedTopic: Topic | null) {
  return topicDetail || selectedTopic;
}

export function isNodeSeekActionTopic(
  topic: TopicActionTopic | null
): topic is TopicActionTopic & { source: 'nodeseek' } {
  return topic?.source === 'nodeseek';
}

export function isYaohuoActionTopic(topic: TopicActionTopic | null): topic is TopicActionTopic & { source: 'yaohuo' } {
  return topic?.source === 'yaohuo';
}

export function canSubmitReplyToTopic(topic: TopicActionTopic | null): topic is TopicActionTopic {
  return Boolean(topic && sourceSupportsTopicAction(topic.source, 'reply'));
}

export function canVotePollOnTopic(topic: TopicActionTopic | null): topic is TopicActionTopic {
  return Boolean(topic && sourceSupportsTopicAction(topic.source, 'vote'));
}

export function topicReplyActionKey(topicKey: string) {
  return `reply:${topicKey}`;
}

export function topicEditReplyActionKey(topicKey: string, commentId: string | number) {
  return `edit-reply:${topicKey}:${commentId}`;
}

export function matchesReplyRefreshTarget(reply: Reply, target: ReplyRefreshTarget) {
  return target.kind === 'comment-id' ? reply.commentId === target.commentId : reply.deletePath === target.deletePath;
}

export function removeRepliesForRefresh(replies: Reply[], target?: ReplyRefreshTarget) {
  return target ? replies.filter((reply) => !matchesReplyRefreshTarget(reply, target)) : replies;
}

export function replaceConfirmedReplyBody(replies: Reply[], commentId: number, body: Reply, submittedMarkdown: string) {
  const existing = findReplyLocation(replies, { commentId });
  if (!existing) return replies;
  return replies.map((reply) =>
    reply === existing
      ? {
          ...reply,
          contentHtml: body.contentHtml,
          contentMarkdown: body.contentMarkdown ?? submittedMarkdown,
          preparedContent: body.preparedContent,
          quotedPosts: body.quotedPosts
        }
      : reply
  );
}

export function updateConfirmedReplyCaches(
  queryClient: QueryClient,
  keys: readonly QueryKey[],
  update: (replies: Reply[]) => Reply[],
  quotedReplyKey?: QueryKey
) {
  for (const queryKey of keys) {
    const state = queryClient.getQueryState<InfiniteData<ReplyPage, ReplyPageParam>>(queryKey);
    if (!state?.data) continue;
    const { data, dataUpdatedAt, isInvalidated } = state;
    const pages = data.pages.map((page) => {
      const items = update(page.items);
      return items === page.items ? page : { ...page, items };
    });
    if (pages.every((page, index) => page === data.pages[index])) continue;
    queryClient.setQueryData(queryKey, { ...data, pages }, { updatedAt: dataUpdatedAt });
    if (isInvalidated) void queryClient.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
  }
  if (!quotedReplyKey) return;
  const quote = queryClient.getQueryState<Reply>(quotedReplyKey);
  if (!quote?.data) return;
  const [reply] = update([quote.data]);
  if (reply === quote.data) return;
  queryClient.setQueryData(quotedReplyKey, reply, { updatedAt: quote.dataUpdatedAt });
  if (quote.isInvalidated)
    void queryClient.invalidateQueries({ queryKey: quotedReplyKey, exact: true, refetchType: 'none' });
}

export function yaohuoFavoriteActionKey(topicKey: string) {
  return `yaohuo-favorite:${topicKey}`;
}

export function topicPollVoteActionKey(topicKey: string, poll: Pick<TopicPoll, 'id' | 'name' | 'postId'>) {
  return `vote:${topicKey}:${poll.id || poll.name || poll.postId || 'poll'}`;
}

export function applyEditedReplyContent(
  replies: Reply[],
  edit: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'>,
  source: Source
) {
  if (source !== 'nodeseek') {
    return replies;
  }
  const contentMarkdown = edit.contentMarkdown.trim();
  if (!contentMarkdown) {
    return replies;
  }
  let changed = false;
  const contentHtml = nodeSeekMarkdownToHtml(contentMarkdown);
  const pollIds = new Set(extractNodeSeekVoteIds(contentHtml));
  const next = replies.map((reply) => {
    if (reply.commentId !== edit.commentId) {
      return reply;
    }
    changed = true;
    const polls = reply.polls?.filter((poll) => poll.id && pollIds.has(poll.id));
    const preparedContent = prepareNodeSeekForumContent(contentHtml, { polls, role: 'reply' });
    return {
      ...reply,
      contentHtml: preparedContent.contentHtml,
      contentMarkdown,
      polls,
      preparedContent
    };
  });
  return changed ? next : replies;
}

export function shouldApplyEditedReplyFallback(
  replies: Reply[],
  edit: Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'> | undefined,
  source: Source
): edit is Pick<ReplyEditTarget, 'commentId' | 'contentMarkdown'> {
  return (
    source === 'nodeseek' &&
    Boolean(edit?.contentMarkdown.trim()) &&
    !replies.some((reply) => reply.commentId === edit?.commentId)
  );
}

export function markCurrentNodeSeekOwnRepliesUnlikable(
  replies: Reply[],
  currentUser: UserIdentity | undefined,
  currentUserId?: number | null
) {
  const cleanCurrentUserId =
    positiveId(currentUserId) || (currentUser?.source === 'nodeseek' ? String(currentUser.id || '').trim() : '');
  if (!cleanCurrentUserId) {
    return replies;
  }
  let changed = false;
  const next = replies.map((reply) => {
    if (!isCurrentNodeSeekReply(reply, currentUser, cleanCurrentUserId)) {
      return reply;
    }
    const canEdit = Boolean(reply.commentId && reply.contentMarkdown);
    if (reply.canLike === false && reply.canEdit === canEdit) {
      return reply;
    }
    changed = true;
    if (canEdit) {
      return { ...reply, canEdit: true, canLike: false };
    }
    const nextReply = { ...reply };
    delete nextReply.canEdit;
    return { ...nextReply, canLike: false };
  });
  return changed ? next : replies;
}

function isCurrentNodeSeekReply(reply: Reply, currentUser: UserIdentity | undefined, currentUserId: string) {
  if (currentUser && currentUser.source !== 'nodeseek') {
    return false;
  }
  const replyAuthorId = String(reply.authorId || '').trim();
  return Boolean(replyAuthorId && currentUserId && replyAuthorId === currentUserId);
}

function positiveId(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? String(number) : '';
}
