import type { Reply, Source, TopicDetail, TopicPoll } from './models';
import { prepareReplyContent, prepareTopicContent } from './topicContentSplit';

export type InteractionType = 'upvote' | 'like' | 'dislike';
type InteractionMode = 'add' | 'remove';
export type TopicActionStateKind = InteractionType | 'collection' | 'bookmark';

type InteractionPatch = {
  commentId: number;
  type: InteractionType;
  mode: InteractionMode;
  reactionId?: string;
};

export function topicActionStateKey({
  topicKey,
  targetId,
  action
}: {
  topicKey: string;
  targetId: string | number;
  action: TopicActionStateKind;
}) {
  return `${topicKey}:${targetId}:${action}`;
}

function nextCount(value: number | undefined, delta: number) {
  if (typeof value !== 'number') {
    return delta > 0 ? delta : undefined;
  }
  return Math.max(0, value + delta);
}

function nextReactionSummary<T extends TopicDetail | Reply>(item: T, reactionId: string | undefined, delta: number) {
  if (!reactionId || delta === 0) {
    return item.reactionSummary;
  }
  const current = item.reactionSummary || [];
  const index = current.findIndex((reaction) => reaction.id === reactionId);
  if (index < 0) {
    return delta > 0 ? [...current, { id: reactionId, count: delta }] : item.reactionSummary;
  }
  const next = current
    .map((reaction, reactionIndex) =>
      reactionIndex === index ? { ...reaction, count: Math.max(0, reaction.count + delta) } : reaction
    )
    .filter((reaction) => reaction.count > 0);
  return next.length ? next : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function applyInteractionFields<T extends TopicDetail | Reply>(item: T, patch: InteractionPatch): T {
  if (item.commentId !== patch.commentId) {
    return item;
  }
  const fieldMap = {
    upvote: ['upvoted', 'upvoteCount'],
    like: ['liked', 'likeCount'],
    dislike: ['disliked', 'dislikeCount']
  } as const;
  const [activeField, countField] = fieldMap[patch.type];
  const active = Boolean(item[activeField]);
  const nextActive = patch.mode === 'add';
  const delta = nextActive === active ? 0 : nextActive ? 1 : -1;
  return {
    ...item,
    [activeField]: nextActive,
    [countField]: nextCount(item[countField], delta),
    ...(patch.type === 'like' && patch.reactionId
      ? { reactionSummary: nextReactionSummary(item, patch.reactionId, delta) }
      : {})
  };
}

export function applyInteractionToTopic<T extends TopicDetail | null>(topic: T, patch: InteractionPatch): T {
  return topic ? (applyInteractionFields(topic, patch) as T) : topic;
}

export function applyInteractionToReplies(replies: Reply[], patch: InteractionPatch) {
  return replies.map((reply) => applyInteractionFields(reply, patch));
}

export function applyBookmarkToTopic<T extends TopicDetail | null>(
  topic: T,
  patch: { bookmarked: boolean; bookmarkId?: number }
): T {
  if (!topic) {
    return topic;
  }
  return {
    ...topic,
    bookmarked: patch.bookmarked,
    bookmarkId: patch.bookmarked ? patch.bookmarkId : undefined
  } as T;
}

export function applyNodeSeekCollectionToTopic<T extends TopicDetail | null>(
  topic: T,
  patch: { collected: boolean }
): T {
  if (!topic) {
    return topic;
  }
  const active = Boolean(topic.collected);
  const delta = patch.collected === active ? 0 : patch.collected ? 1 : -1;
  return {
    ...topic,
    collected: patch.collected,
    collectionCount: nextCount(topic.collectionCount, delta)
  } as T;
}

type PollVotePatch = {
  pollId?: string;
  pollName?: string;
  pollPostId?: string;
  optionIds: string[];
  confirmedPoll?: TopicPoll;
  preserveUnknownCounts?: boolean;
};

function applyPollVoteToPolls(polls: TopicDetail['polls'], patch: PollVotePatch) {
  if (!polls?.length) {
    return polls;
  }
  const selectedIds = new Set(patch.optionIds.map(String));
  const next = polls.map((poll) => {
    if (patch.pollPostId && poll.postId !== patch.pollPostId) {
      return poll;
    }
    const matchesPoll = patch.pollId
      ? poll.id === patch.pollId
      : patch.pollName
        ? poll.name === patch.pollName
        : polls.length === 1;
    if (!matchesPoll) {
      return poll;
    }
    if (patch.confirmedPoll) {
      return {
        ...poll,
        ...patch.confirmedPoll
      };
    }
    const participantCount =
      typeof poll.participantCount === 'number' && !poll.voted
        ? nextCount(poll.participantCount, 1)
        : poll.participantCount;
    return {
      ...poll,
      ...(participantCount !== undefined ? { participantCount } : {}),
      voted: true,
      options: poll.options.map((option) => {
        const selected = selectedIds.has(option.id);
        const wasSelected = option.selected === true;
        const nextOption = {
          ...option,
          selected
        };
        if (selected && !wasSelected) {
          if (typeof option.count === 'number') {
            nextOption.count = nextCount(option.count, 1);
          } else if (!patch.preserveUnknownCounts) {
            nextOption.count = 1;
          }
        }
        return nextOption;
      })
    };
  });
  return next.every((poll, index) => poll === polls[index]) ? polls : next;
}

export function applyPollVoteToTopic<T extends TopicDetail | null>(topic: T, patch: PollVotePatch): T {
  if (!topic?.polls?.length) {
    return topic;
  }
  const polls = applyPollVoteToPolls(topic.polls, patch);
  if (polls === topic.polls) return topic;
  return prepareTopicContent({
    ...topic,
    polls
  }) as T;
}

export function applyPollVoteToReplies(replies: Reply[], patch: PollVotePatch, source: Source) {
  return replies.map((reply) => {
    const polls = applyPollVoteToPolls(reply.polls, patch);
    return polls === reply.polls ? reply : prepareReplyContent({ ...reply, polls }, source);
  });
}

export function discourseBookmarkIdFromActionResult(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const nested =
    record.bookmark && typeof record.bookmark === 'object' ? (record.bookmark as Record<string, unknown>) : {};
  return positiveInteger(record.id) ?? positiveInteger(record.bookmark_id) ?? positiveInteger(nested.id);
}
