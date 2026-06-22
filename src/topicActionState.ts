import type { Reply, TopicDetail } from './types';

export type InteractionType = 'upvote' | 'like' | 'dislike';
type InteractionMode = 'add' | 'remove';
type ActionOperation = 'add' | 'remove';
export type TopicActionStateKind = InteractionType | 'collection' | 'bookmark';

export type OptimisticActionState = {
  confirmed: boolean;
  displayed: boolean;
  desired: boolean;
  inFlight: boolean;
  inFlightTarget?: boolean;
  ownerKey?: string;
};

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
  const next = current.map((reaction, reactionIndex) => (
    reactionIndex === index
      ? { ...reaction, count: Math.max(0, reaction.count + delta) }
      : reaction
  )).filter((reaction) => reaction.count > 0);
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
    ...(patch.type === 'like' && patch.reactionId ? { reactionSummary: nextReactionSummary(item, patch.reactionId, delta) } : {})
  };
}

export function applyInteractionToTopic<T extends TopicDetail | null>(topic: T, patch: InteractionPatch): T {
  return topic ? applyInteractionFields(topic, patch) as T : topic;
}

export function applyInteractionToReplies(replies: Reply[], patch: InteractionPatch) {
  return replies.map((reply) => applyInteractionFields(reply, patch));
}

export function beginOptimisticAction(
  current: OptimisticActionState | undefined,
  confirmedActive: boolean
): { state: OptimisticActionState; request: ActionOperation | null } {
  const base = current || {
    confirmed: confirmedActive,
    displayed: confirmedActive,
    desired: confirmedActive,
    inFlight: false
  };
  const desired = !base.displayed;
  const state = {
    ...base,
    displayed: desired,
    desired
  };
  if (base.inFlight) {
    return { state, request: null };
  }
  return {
    state: {
      ...state,
      inFlight: true,
      inFlightTarget: desired
    },
    request: desired ? 'add' : 'remove'
  };
}

export function completeOptimisticAction(
  current: OptimisticActionState,
  success: boolean
): { state: OptimisticActionState; request: ActionOperation | null } {
  if (!current.inFlight || typeof current.inFlightTarget !== 'boolean') {
    return { state: current, request: null };
  }
  if (!success) {
    return {
      state: {
        confirmed: current.confirmed,
        displayed: current.confirmed,
        desired: current.confirmed,
        inFlight: false
      },
      request: null
    };
  }
  const confirmed = current.inFlightTarget;
  if (current.desired !== confirmed) {
    return {
      state: {
        confirmed,
        displayed: current.desired,
        desired: current.desired,
        inFlight: true,
        inFlightTarget: current.desired
      },
      request: current.desired ? 'add' : 'remove'
    };
  }
  return {
    state: {
      confirmed,
      displayed: confirmed,
      desired: confirmed,
      inFlight: false
    },
    request: null
  };
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

function applyPollVoteToPolls(
  polls: TopicDetail['polls'],
  patch: { pollId?: string; pollName?: string; pollPostId?: string; optionIds: string[] }
) {
  if (!polls?.length) {
    return polls;
  }
  const selectedIds = new Set(patch.optionIds.map(String));
  return polls.map((poll) => {
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
  });
}

export function applyPollVoteToTopic<T extends TopicDetail | null>(
  topic: T,
  patch: { pollId?: string; pollName?: string; pollPostId?: string; optionIds: string[] }
): T {
  if (!topic?.polls?.length) {
    return topic;
  }
  return {
    ...topic,
    polls: applyPollVoteToPolls(topic.polls, patch)
  } as T;
}

export function applyPollVoteToReplies(
  replies: Reply[],
  patch: { pollId?: string; pollName?: string; pollPostId?: string; optionIds: string[] }
) {
  return replies.map((reply) => {
    const polls = applyPollVoteToPolls(reply.polls, patch);
    return polls === reply.polls ? reply : { ...reply, polls };
  });
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
