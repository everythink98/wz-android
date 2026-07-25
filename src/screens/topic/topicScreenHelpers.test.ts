import { describe, expect, it } from 'vitest';
import { buildReplyListItems, getReplyKey, hasSameYaohuoTopicLayout, topicOpeningPostAsReply, type TopicListItem } from './topicScreenHelpers';
import type { Reply, TopicDetail } from '../../types';

const reply: Reply = {
  author: 'alice',
  contentHtml: '<p>Hello</p>',
  createdAt: '2026-07-03T00:00:00.000Z',
  floor: 2
};
const replyItem: TopicListItem = {
  type: 'reply',
  key: 'reply-floor-2',
  reply,
  replyFloor: 2
};
const listCases: Array<[string, boolean, TopicListItem[], boolean, TopicListItem[]]> = [
  ['visible replies', true, [replyItem], false, [{ type: 'replyControls', key: 'reply-controls' }, replyItem]],
  ['empty replies', true, [], false, [{ type: 'replyControls', key: 'reply-controls' }, { type: 'emptyReplies', key: 'empty-replies' }]],
  ['access notice', true, [replyItem], true, []]
];

describe('topic screen helpers', () => {
  it('REG-TOPIC-028 keeps replies with the same display floor as distinct list items', () => {
    const imageReply: Reply = {
      ...reply,
      commentId: 17900145,
      floor: 68,
      contentHtml: '<p>image reply</p><img src="https://example.com/tall.jpg" />'
    };
    const textReply: Reply = {
      ...reply,
      commentId: 17900159,
      floor: 68,
      contentHtml: '<p>text reply</p>'
    };

    expect(getReplyKey(imageReply)).not.toBe(getReplyKey(textReply));
  });

  it('keeps the same reply identity when its display floor changes', () => {
    const original: Reply = { ...reply, commentId: 17900159, floor: 68 };

    expect(getReplyKey({ ...original, floor: 69 })).toBe(getReplyKey(original));
  });

  it('falls back to the display floor when a source has no comment id', () => {
    const withoutCommentId: Reply = { ...reply, floor: 68 };

    expect(getReplyKey({ ...withoutCommentId, contentHtml: '<p>refreshed</p>' })).toBe(getReplyKey(withoutCommentId));
  });

  it.each(listCases)('builds FlashList data for %s', (_label, canShowReplies, replyItems, topicShowsAccessNotice, expected) => {
    expect(buildReplyListItems({ canShowReplies, replyItems, topicShowsAccessNotice })).toEqual(expected);
  });

  it('[REG-WRITE-005] ignores yaohuo bookmark fields when comparing topic layout', () => {
    const detail: TopicDetail = {
      source: 'yaohuo',
      id: '123',
      title: 'topic',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-123.html',
      createdAt: '2026-07-15T00:00:00.000Z',
      replyCount: 0,
      contentHtml: '<p>body</p>',
      replies: [],
      bookmarked: false
    };

    expect(hasSameYaohuoTopicLayout(detail, { ...detail, bookmarked: true, bookmarkId: 987 })).toBe(true);
    expect(hasSameYaohuoTopicLayout(detail, { ...detail, bookmarked: false, bookmarkId: undefined })).toBe(true);
    expect(hasSameYaohuoTopicLayout(detail, { ...detail, title: 'changed' })).toBe(false);
  });

  it('reuses the already-loaded opening post when a reply quotes floor 1', () => {
    const topic: TopicDetail = {
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/topic/42',
      createdAt: '2026-07-03T00:00:00.000Z',
      replyCount: 1,
      contentHtml: '<p>Complete opening post.</p>',
      replies: [],
      polls: [{ id: 'poll', title: 'Poll', options: [{ id: 'yes', label: 'Yes' }] }]
    };

    expect(topicOpeningPostAsReply(topic)).toMatchObject({
      author: 'alice',
      contentHtml: '<p>Complete opening post.</p>',
      floor: 1,
      polls: topic.polls
    });
  });
});
