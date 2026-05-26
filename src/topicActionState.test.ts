import { describe, expect, it } from 'vitest';

import type { Reply, TopicDetail } from './types';
import {
  applyBookmarkToTopic,
  applyInteractionToReplies,
  applyInteractionToTopic,
  applyVoteOptionToTopic,
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

  it('increments a submitted Yaohuo vote option locally', () => {
    const next = applyVoteOptionToTopic({
      ...topic,
      source: 'yaohuo',
      voteOptions: [
        { id: '7', label: 'A', count: 1 },
        { id: '8', label: 'B' }
      ]
    }, '8');

    expect(next?.voteOptions).toEqual([
      { id: '7', label: 'A', count: 1 },
      { id: '8', label: 'B', count: 1 }
    ]);
  });
});
