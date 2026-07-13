import { describe, expect, it } from 'vitest';
import { buildReplyListItems } from './topicScreenHelpers';
import type { Reply } from '../../types';

const reply: Reply = {
  author: 'alice',
  contentHtml: '<p>Hello</p>',
  createdAt: '2026-07-03T00:00:00.000Z',
  floor: 2
};
const listCases: Array<[string, boolean, Reply[], boolean, string[]]> = [
  ['visible replies', true, [reply], false, ['reply-floor-2']],
  ['empty replies', true, [], false, ['empty-replies']],
  ['access notice', true, [reply], true, []]
];

describe('topic screen helpers', () => {
  it.each(listCases)('builds FlashList data for %s', (_label, canShowReplies, replies, topicShowsAccessNotice, expectedKeys) => {
    expect(buildReplyListItems({ canShowReplies, replies, topicShowsAccessNotice }).map((item) => item.key)).toEqual(expectedKeys);
  });

  it('prefers native comment ids when duplicate floors are present', () => {
    const replies = [
      { ...reply, commentId: 101 },
      { ...reply, commentId: 102 }
    ];

    expect(buildReplyListItems({ canShowReplies: true, replies, topicShowsAccessNotice: false }).map((item) => item.key))
      .toEqual(['reply-comment-101', 'reply-comment-102']);
  });

  it('adds a deterministic collision suffix when neither reply has a native id', () => {
    const replies = [{ ...reply }, { ...reply }];

    expect(buildReplyListItems({ canShowReplies: true, replies, topicShowsAccessNotice: false }).map((item) => item.key))
      .toEqual(['reply-floor-2', 'reply-floor-2-duplicate-2']);
  });
});
