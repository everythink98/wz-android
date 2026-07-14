import { describe, expect, it } from 'vitest';
import { buildReplyListItems, type TopicListItem } from './topicScreenHelpers';
import type { Reply } from '../../types';

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
});
