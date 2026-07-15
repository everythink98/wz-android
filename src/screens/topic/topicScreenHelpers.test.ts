import { describe, expect, it } from 'vitest';
import { buildReplyListItems, hasSameYaohuoTopicLayout, type TopicListItem } from './topicScreenHelpers';
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
});
