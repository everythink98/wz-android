import type { Reply, TopicDetail } from './types';

type InteractionType = 'upvote' | 'like';
type InteractionMode = 'add' | 'toggle';

export type InteractionPatch = {
  commentId: number;
  type: InteractionType;
  mode: InteractionMode;
};

function nextCount(value: number | undefined, delta: number) {
  if (typeof value !== 'number') {
    return delta > 0 ? delta : undefined;
  }
  return Math.max(0, value + delta);
}

function positiveInteger(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function applyInteractionFields<T extends TopicDetail | Reply>(item: T, patch: InteractionPatch): T {
  if (item.commentId !== patch.commentId) {
    return item;
  }
  const activeField = patch.type === 'upvote' ? 'upvoted' : 'liked';
  const countField = patch.type === 'upvote' ? 'upvoteCount' : 'likeCount';
  const active = Boolean(item[activeField]);
  const nextActive = patch.mode === 'toggle' ? !active : true;
  const delta = nextActive === active ? 0 : nextActive ? 1 : -1;
  return {
    ...item,
    [activeField]: nextActive,
    [countField]: nextCount(item[countField], delta)
  };
}

export function applyInteractionToTopic<T extends TopicDetail | null>(topic: T, patch: InteractionPatch): T {
  return topic ? applyInteractionFields(topic, patch) as T : topic;
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
    bookmarkId: patch.bookmarked ? patch.bookmarkId ?? topic.bookmarkId : undefined
  } as T;
}

export function applyPollVoteToTopic<T extends TopicDetail | null>(
  topic: T,
  patch: { pollId?: string; pollName?: string; optionIds: string[] }
): T {
  if (!topic?.polls?.length) {
    return topic;
  }
  const selectedIds = new Set(patch.optionIds.map(String));
  return {
    ...topic,
    polls: topic.polls.map((poll) => {
      const matchesPoll = patch.pollId
        ? poll.id === patch.pollId
        : patch.pollName
          ? poll.name === patch.pollName
          : topic.polls!.length === 1;
      if (!matchesPoll) {
        return poll;
      }
      return {
        ...poll,
        voted: true,
        options: poll.options.map((option) => {
          const selected = selectedIds.has(option.id);
          const wasSelected = option.selected === true;
          return {
            ...option,
            selected,
            count: selected && !wasSelected ? nextCount(option.count, 1) : option.count
          };
        })
      };
    })
  } as T;
}

export function linuxDoBookmarkIdFromActionResult(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const nested = record.bookmark && typeof record.bookmark === 'object'
    ? record.bookmark as Record<string, unknown>
    : {};
  return positiveInteger(record.id)
    ?? positiveInteger(record.bookmark_id)
    ?? positiveInteger(nested.id);
}
