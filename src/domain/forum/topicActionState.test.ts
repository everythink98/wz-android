import { describe, expect, it } from 'vitest';

import type { Reply, TopicDetail } from './models';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyNodeSeekCollectionToTopic,
  applyPollVoteToTopic,
  discourseBookmarkIdFromActionResult,
  topicActionStateKey
} from './topicActionState';

const topic: TopicDetail = {
  source: 'linuxdo',
  id: '1',
  title: 'Topic',
  author: 'alice',
  url: 'https://linux.do/t/topic/1',
  createdAt: '2026-05-26T00:00:00.000Z',
  replyCount: 1,
  contentHtml: '<p>Topic</p>',
  replies: [],
  commentId: 101,
  likeCount: 2,
  liked: false,
  bookmarked: false
};

const reply: Reply = {
  author: 'bob',
  contentHtml: '<p>Reply</p>',
  createdAt: '2026-05-26T00:01:00.000Z',
  floor: 2,
  commentId: 202,
  likeCount: 3,
  liked: true
};

describe('topic action state patches', () => {
  it('adds and removes a linux.do topic like locally without replacing the whole topic', () => {
    const liked = applyInteractionToTopic(topic, {
      commentId: 101,
      type: 'like',
      mode: 'add'
    });
    const unliked = applyInteractionToTopic(liked, {
      commentId: 101,
      type: 'like',
      mode: 'remove'
    });

    expect(liked).toMatchObject({ liked: true, likeCount: 3 });
    expect(unliked).toMatchObject({ liked: false, likeCount: 2 });
  });

  it('updates linux.do visible heart reaction counts when likes change', () => {
    const liked = applyInteractionToTopic(
      {
        ...topic,
        likeCount: 173,
        reactionSummary: [
          { id: 'heart', count: 173 },
          { id: '+1', count: 27 }
        ]
      },
      {
        commentId: 101,
        type: 'like',
        mode: 'add',
        reactionId: 'heart'
      }
    );
    const unliked = applyInteractionToReplies(
      [
        {
          ...reply,
          liked: true,
          likeCount: 1,
          reactionSummary: [{ id: 'heart', count: 1 }]
        }
      ],
      {
        commentId: 202,
        type: 'like',
        mode: 'remove',
        reactionId: 'heart'
      }
    );

    expect(liked).toMatchObject({
      liked: true,
      likeCount: 174,
      reactionSummary: [
        { id: 'heart', count: 174 },
        { id: '+1', count: 27 }
      ]
    });
    expect(unliked[0]).toMatchObject({ liked: false, likeCount: 0 });
    expect(unliked[0]?.reactionSummary).toBeUndefined();
  });

  it('creates the linux.do visible heart reaction when the first like is added', () => {
    const liked = applyInteractionToTopic(
      {
        ...topic,
        likeCount: 0,
        reactionSummary: undefined
      },
      {
        commentId: 101,
        type: 'like',
        mode: 'add',
        reactionId: 'heart'
      }
    );

    expect(liked).toMatchObject({
      liked: true,
      likeCount: 1,
      reactionSummary: [{ id: 'heart', count: 1 }]
    });
  });

  it('adds NodeSeek reply interactions locally and does not double count repeated success', () => {
    const next = applyInteractionToReplies([reply], {
      commentId: 202,
      type: 'like',
      mode: 'add'
    });
    const repeated = applyInteractionToReplies(next, {
      commentId: 202,
      type: 'like',
      mode: 'add'
    });

    expect(next[0]).toMatchObject({ liked: true, likeCount: 3 });
    expect(repeated[0]).toMatchObject({ liked: true, likeCount: 3 });
  });

  it('adds and removes NodeSeek dislike state and count locally', () => {
    const disliked = applyInteractionToReplies(
      [
        {
          ...reply,
          disliked: false,
          dislikeCount: 1
        }
      ],
      {
        commentId: 202,
        type: 'dislike',
        mode: 'add'
      }
    );
    const undisliked = applyInteractionToReplies(disliked, {
      commentId: 202,
      type: 'dislike',
      mode: 'remove'
    });

    expect(disliked[0]).toMatchObject({ disliked: true, dislikeCount: 2 });
    expect(undisliked[0]).toMatchObject({ disliked: false, dislikeCount: 1 });
  });

  it('removes NodeSeek interactions locally without going below zero', () => {
    const next = applyInteractionToReplies(
      [
        {
          ...reply,
          liked: true,
          likeCount: 1
        }
      ],
      {
        commentId: 202,
        type: 'like',
        mode: 'remove'
      }
    );
    const repeated = applyInteractionToReplies(next, {
      commentId: 202,
      type: 'like',
      mode: 'remove'
    });

    expect(next[0]).toMatchObject({ liked: false, likeCount: 0 });
    expect(repeated[0]).toMatchObject({ liked: false, likeCount: 0 });
  });

  it('builds stable optimistic action keys for topic and reply actions', () => {
    expect(
      topicActionStateKey({
        topicKey: 'nodeseek:123',
        targetId: 202,
        action: 'like'
      })
    ).toBe('nodeseek:123:202:like');
  });

  it('patches NodeSeek original collection state locally', () => {
    const collected = applyNodeSeekCollectionToTopic(
      {
        ...topic,
        source: 'nodeseek',
        collected: false,
        collectionCount: 4
      },
      { collected: true }
    );
    const removed = applyNodeSeekCollectionToTopic(collected, { collected: false });

    expect(collected).toMatchObject({ collected: true, collectionCount: 5 });
    expect(removed).toMatchObject({ collected: false, collectionCount: 4 });
  });

  it('patches linux.do original bookmark state from the action result', () => {
    const bookmarked = applyBookmarkToTopic(topic, { bookmarked: true, bookmarkId: 88 });
    const removed = applyBookmarkToTopic(bookmarked, { bookmarked: false });
    const readdedWithoutId = applyBookmarkToTopic(bookmarked, { bookmarked: true });

    expect(bookmarked).toMatchObject({ bookmarked: true, bookmarkId: 88 });
    expect(removed).toMatchObject({ bookmarked: false });
    expect(removed?.bookmarkId).toBeUndefined();
    expect(readdedWithoutId).toMatchObject({ bookmarked: true });
    expect(readdedWithoutId?.bookmarkId).toBeUndefined();
  });

  it('reads bookmark ids from common Discourse response shapes', () => {
    expect(discourseBookmarkIdFromActionResult({ id: 88 })).toBe(88);
    expect(discourseBookmarkIdFromActionResult({ bookmark_id: 89 })).toBe(89);
    expect(discourseBookmarkIdFromActionResult({ bookmark: { id: 90 } })).toBe(90);
    expect(discourseBookmarkIdFromActionResult({ success: true })).toBeUndefined();
  });

  it('marks a submitted poll vote locally', () => {
    const next = applyPollVoteToTopic(
      {
        ...topic,
        source: 'yaohuo',
        polls: [
          {
            id: 'yaohuo-1',
            title: '投票',
            multiple: false,
            voted: false,
            options: [
              { id: '7', label: 'A', count: 1 },
              { id: '8', label: 'B' }
            ]
          }
        ]
      },
      {
        pollId: 'yaohuo-1',
        optionIds: ['8']
      }
    );

    expect(next?.polls).toEqual([
      {
        id: 'yaohuo-1',
        title: '投票',
        multiple: false,
        voted: true,
        options: [
          { id: '7', label: 'A', count: 1, selected: false },
          { id: '8', label: 'B', count: 1, selected: true }
        ]
      }
    ]);
  });

  it('[REG-WRITE-007] applies the authoritative server poll snapshot after a NodeSeek vote', () => {
    const next = applyPollVoteToTopic(
      {
        ...topic,
        source: 'nodeseek',
        polls: [
          {
            id: '2443',
            title: '投票',
            voted: false,
            options: [
              { id: '71', label: 'A' },
              { id: '72', label: 'B' }
            ]
          }
        ]
      },
      {
        pollId: '2443',
        optionIds: ['72'],
        confirmedPoll: {
          id: '2443',
          title: '投票',
          voted: true,
          options: [
            { id: '71', label: 'A', count: 2, selected: false },
            { id: '72', label: 'B', count: 6, selected: true }
          ]
        }
      }
    );

    expect(next?.polls?.[0]).toEqual({
      id: '2443',
      title: '投票',
      voted: true,
      options: [
        { id: '71', label: 'A', count: 2, selected: false },
        { id: '72', label: 'B', count: 6, selected: true }
      ]
    });
  });

  it('[REG-WRITE-007] does not invent a count when NodeSeek result refresh fails', () => {
    const next = applyPollVoteToTopic(
      {
        ...topic,
        source: 'nodeseek',
        polls: [
          {
            id: '2443',
            title: '投票',
            multiple: true,
            voted: false,
            options: [
              { id: '71', label: 'A', count: 2 },
              { id: '72', label: 'B' }
            ]
          }
        ]
      },
      {
        pollId: '2443',
        optionIds: ['71', '72'],
        preserveUnknownCounts: true
      }
    );

    expect(next?.polls?.[0]).toEqual({
      id: '2443',
      title: '投票',
      multiple: true,
      voted: true,
      options: [
        { id: '71', label: 'A', count: 3, selected: true },
        { id: '72', label: 'B', selected: true }
      ]
    });
  });

  it('[REG-WRITE-001] increments poll participants once after the first submitted vote', () => {
    const initial = {
      ...topic,
      polls: [
        {
          id: 'poll-1',
          title: '投票',
          participantCount: 4,
          voted: false,
          options: [
            { id: 'a', label: 'A', count: 2 },
            { id: 'b', label: 'B', count: 1 }
          ]
        }
      ]
    };
    const patch = { pollId: 'poll-1', optionIds: ['a'] };

    const afterFirstApply = applyPollVoteToTopic(initial, patch);
    const afterRepeatedApply = applyPollVoteToTopic(afterFirstApply, patch);

    expect(afterFirstApply?.polls?.[0]).toMatchObject({
      participantCount: 5,
      voted: true,
      options: [
        { id: 'a', count: 3, selected: true },
        { id: 'b', count: 1, selected: false }
      ]
    });
    expect(afterRepeatedApply?.polls?.[0]?.participantCount).toBe(5);
    expect(afterRepeatedApply?.polls?.[0]?.options[0]).toMatchObject({ id: 'a', count: 3 });
  });

  it('[REG-WRITE-001] increments multi-select participants once while incrementing every selected option', () => {
    const initial = {
      ...topic,
      polls: [
        {
          id: 'poll-multiple',
          title: '多选投票',
          participantCount: 8,
          multiple: true,
          voted: false,
          options: [
            { id: 'a', label: 'A', count: 3 },
            { id: 'b', label: 'B', count: 5 },
            { id: 'c', label: 'C', count: 2 }
          ]
        }
      ]
    };
    const patch = { pollId: 'poll-multiple', optionIds: ['a', 'c'] };

    const afterFirstApply = applyPollVoteToTopic(initial, patch);
    const afterRepeatedApply = applyPollVoteToTopic(afterFirstApply, patch);

    expect(afterFirstApply?.polls?.[0]).toMatchObject({
      participantCount: 9,
      voted: true,
      options: [
        { id: 'a', count: 4, selected: true },
        { id: 'b', count: 5, selected: false },
        { id: 'c', count: 3, selected: true }
      ]
    });
    expect(afterRepeatedApply?.polls?.[0]?.participantCount).toBe(9);
    expect(afterRepeatedApply?.polls?.[0]?.options).toMatchObject([
      { id: 'a', count: 4 },
      { id: 'b', count: 5 },
      { id: 'c', count: 3 }
    ]);
  });

  it('does not mark every anonymous poll as voted on multi-poll topics', () => {
    const next = applyPollVoteToTopic(
      {
        ...topic,
        polls: [
          {
            title: '投票 A',
            voted: false,
            options: [
              { id: '1', label: 'A1' },
              { id: '2', label: 'A2' }
            ]
          },
          {
            title: '投票 B',
            voted: false,
            options: [
              { id: '3', label: 'B1' },
              { id: '4', label: 'B2' }
            ]
          }
        ]
      },
      {
        optionIds: ['2']
      }
    );

    expect(next?.polls?.map((poll) => poll.voted)).toEqual([false, false]);
  });
});
