import { describe, expect, it } from 'vitest';
import type { Reply, TopicDetail } from '../types';
import { createTopicImageDeriver } from '../topicDerivedData';
import {
  actionUpdateClosesReplyComposer,
  filterTopicSessionReplies,
  replyContentAfterComposerClose,
  replyComposerAfterSuccessfulSubmission,
  topicDetailAfterActionUpdate,
  topicRepliesAfterActionUpdate
} from './useTopicSessionController';

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
  liked: false
};

const reply: Reply = {
  author: 'bob',
  contentHtml: '<p>Reply</p>',
  createdAt: '2026-05-26T00:01:00.000Z',
  floor: 2,
  commentId: 202,
  likeCount: 3,
  liked: false
};

describe('topic session controller helpers', () => {
  it('applies author, image, newest and comment-query reply filters', () => {
    const topicReplies: Reply[] = [
      { author: 'alice', contentHtml: '<p>first answer</p>', createdAt: '2026-05-26T00:01:00.000Z', floor: 1 },
      { author: 'bob', contentHtml: '<p>second needle</p><img src="https://img.example.com/2.png">', createdAt: '2026-05-26T00:02:00.000Z', floor: 2 },
      { author: 'alice', contentHtml: '<p>third needle</p>', createdAt: '2026-05-26T00:03:00.000Z', floor: 3 }
    ];
    const topicDetail = { ...topic, replyCount: topicReplies.length, replies: topicReplies };
    const topicImageDeriver = createTopicImageDeriver();
    const filter = (replyFilter: 'all' | 'author' | 'images' | 'newest', commentQuery = '') => filterTopicSessionReplies({
      commentQuery,
      inlineSizedImageUrls: {},
      replyFilter,
      topicDetail,
      topicImageDeriver,
      topicReplies
    }).map((item) => item.floor);

    expect(filter('all')).toEqual([1, 2, 3]);
    expect(filter('author')).toEqual([1, 3]);
    expect(filter('images')).toEqual([2]);
    expect(filter('newest')).toEqual([3, 2, 1]);
    expect(filter('all', 'needle')).toEqual([2, 3]);
    expect(filter('author', 'needle')).toEqual([3]);
  });

  it('clears edited reply text when closing edit mode without dropping normal drafts', () => {
    expect(replyContentAfterComposerClose('普通草稿', null)).toBe('普通草稿');
    expect(replyContentAfterComposerClose('旧回复内容', {
      commentId: 9,
      contentMarkdown: '旧回复内容'
    })).toBe('');
  });

  it('clears all composer state after a successful reply action', () => {
    expect(replyComposerAfterSuccessfulSubmission()).toEqual({
      replyComposerOpen: false,
      replyContent: '',
      replyEditTarget: null,
      replyFace: '',
      replyTarget: null
    });
  });

  it('applies one interaction update to the matching topic or reply state', () => {
    const topicUpdate = {
      type: 'interaction' as const,
      patch: { commentId: 101, type: 'like' as const, mode: 'add' as const, reactionId: 'heart' }
    };
    const replyUpdate = {
      type: 'interaction' as const,
      patch: { commentId: 202, type: 'like' as const, mode: 'add' as const, reactionId: 'heart' }
    };

    expect(topicDetailAfterActionUpdate(topic, topicUpdate)).toMatchObject({ liked: true, likeCount: 3 });
    expect(topicRepliesAfterActionUpdate([reply], replyUpdate)[0]).toMatchObject({ liked: true, likeCount: 4 });
  });

  it('removes a deleted reply and closes a composer that targets it', () => {
    const update = { type: 'reply-deleted' as const, reply };

    expect(topicRepliesAfterActionUpdate([reply], update)).toEqual([]);
    expect(actionUpdateClosesReplyComposer(update, {
      replyTarget: { floor: 2, author: reply.author, commentId: reply.commentId },
      replyEditTarget: null
    })).toBe(true);
    expect(actionUpdateClosesReplyComposer(update, {
      replyTarget: { floor: 3, author: 'carol', commentId: 303 },
      replyEditTarget: null
    })).toBe(false);
  });

  it('applies collection and bookmark updates only to topic detail', () => {
    const replies = [reply];
    const collected = topicDetailAfterActionUpdate({ ...topic, collected: false, collectionCount: 2 }, {
      type: 'collection',
      collected: true
    });
    const bookmarked = topicDetailAfterActionUpdate(topic, {
      type: 'bookmark',
      bookmarked: true,
      bookmarkId: 9
    });

    expect(collected).toMatchObject({ collected: true, collectionCount: 3 });
    expect(bookmarked).toMatchObject({ bookmarked: true, bookmarkId: 9 });
    expect(topicRepliesAfterActionUpdate(replies, { type: 'bookmark', bookmarked: true })).toBe(replies);
  });

  it('applies a poll vote to polls embedded in topic detail and replies', () => {
    const poll = {
      id: 'poll-1',
      title: '投票',
      voted: false,
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
    };
    const update = { type: 'poll-vote' as const, patch: { pollId: 'poll-1', optionIds: ['b'] } };
    const detail = topicDetailAfterActionUpdate({ ...topic, polls: [poll] }, update);
    const replies = topicRepliesAfterActionUpdate([{ ...reply, polls: [poll] }], update);

    expect(detail?.polls?.[0]).toMatchObject({ voted: true, options: [{ selected: false }, { selected: true }] });
    expect(replies[0]?.polls?.[0]?.voted).toBe(true);
  });
});
