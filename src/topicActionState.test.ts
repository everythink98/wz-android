import { describe, expect, it } from 'vitest';

import type { Reply, TopicDetail } from './types';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyNodeSeekCollectionToTopic,
  applyPollVoteToTopic,
  linuxDoBookmarkIdFromActionResult
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
  it('toggles a linux.do topic like locally without replacing the whole topic', () => {
    const liked = applyInteractionToTopic(topic, {
      commentId: 101,
      type: 'like',
      mode: 'toggle'
    });
    const unliked = applyInteractionToTopic(liked, {
      commentId: 101,
      type: 'like',
      mode: 'toggle'
    });

    expect(liked).toMatchObject({ liked: true, likeCount: 3 });
    expect(unliked).toMatchObject({ liked: false, likeCount: 2 });
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

  it('toggles NodeSeek dislike state and count locally', () => {
    const disliked = applyInteractionToReplies([{
      ...reply,
      disliked: false,
      dislikeCount: 1
    }], {
      commentId: 202,
      type: 'dislike',
      mode: 'toggle'
    });
    const undisliked = applyInteractionToReplies(disliked, {
      commentId: 202,
      type: 'dislike',
      mode: 'toggle'
    });

    expect(disliked[0]).toMatchObject({ disliked: true, dislikeCount: 2 });
    expect(undisliked[0]).toMatchObject({ disliked: false, dislikeCount: 1 });
  });

  it('patches NodeSeek original collection state locally', () => {
    const collected = applyNodeSeekCollectionToTopic({
      ...topic,
      source: 'nodeseek',
      collected: false,
      collectionCount: 4
    }, { collected: true });
    const removed = applyNodeSeekCollectionToTopic(collected, { collected: false });

    expect(collected).toMatchObject({ collected: true, collectionCount: 5 });
    expect(removed).toMatchObject({ collected: false, collectionCount: 4 });
  });

  it('patches linux.do original bookmark state from the action result', () => {
    const bookmarked = applyBookmarkToTopic(topic, { bookmarked: true, bookmarkId: 88 });
    const removed = applyBookmarkToTopic(bookmarked, { bookmarked: false });

    expect(bookmarked).toMatchObject({ bookmarked: true, bookmarkId: 88 });
    expect(removed).toMatchObject({ bookmarked: false });
    expect(removed?.bookmarkId).toBeUndefined();
  });

  it('reads linux.do bookmark ids from common Discourse response shapes', () => {
    expect(linuxDoBookmarkIdFromActionResult({ id: 88 })).toBe(88);
    expect(linuxDoBookmarkIdFromActionResult({ bookmark_id: 89 })).toBe(89);
    expect(linuxDoBookmarkIdFromActionResult({ bookmark: { id: 90 } })).toBe(90);
    expect(linuxDoBookmarkIdFromActionResult({ success: true })).toBeUndefined();
  });

  it('marks a submitted poll vote locally', () => {
    const next = applyPollVoteToTopic({
      ...topic,
      source: 'yaohuo',
      polls: [{
        id: 'yaohuo-1',
        title: '投票',
        multiple: false,
        voted: false,
        options: [
          { id: '7', label: 'A', count: 1 },
          { id: '8', label: 'B' }
        ]
      }]
    }, {
      pollId: 'yaohuo-1',
      optionIds: ['8']
    });

    expect(next?.polls).toEqual([{
      id: 'yaohuo-1',
      title: '投票',
      multiple: false,
      voted: true,
      options: [
        { id: '7', label: 'A', count: 1, selected: false },
        { id: '8', label: 'B', count: 1, selected: true }
      ]
    }]);
  });

  it('does not mark every anonymous poll as voted on multi-poll topics', () => {
    const next = applyPollVoteToTopic({
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
    }, {
      optionIds: ['2']
    });

    expect(next?.polls?.map((poll) => poll.voted)).toEqual([false, false]);
  });
});
