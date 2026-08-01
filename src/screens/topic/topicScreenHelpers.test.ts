import { describe, expect, it } from 'vitest';
import { buildReplyListItems, buildVirtualizedReplyItems, getReplyKey, hasSameYaohuoTopicLayout, topicListItemSpacing, type TopicListItem } from './topicScreenHelpers';
import { replyQuotedPostInstanceKey, topicOpeningPostAsReply } from '../../quotedPosts';
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

  it('[REG-TOPIC-054] keeps multiple quote rows ordered and removes only collapsed content', () => {
    const firstReference = { source: 'linuxdo' as const, topicId: '100', postNumber: 1 };
    const secondReference = { source: 'linuxdo' as const, topicId: '200', postNumber: 2 };
    const quotingReply: Reply = {
      ...reply,
      floor: 3,
      quotedPosts: [
        { reference: firstReference, preview: 'first preview' },
        { reference: secondReference, preview: 'second preview' }
      ]
    };
    const quotedReply: Reply = {
      ...reply,
      contentHtml: '<p>first chunk</p><p>second chunk</p>',
      floor: 2
    };
    const common = {
      loadedQuotedReplies: { 'linuxdo:200:2': quotedReply },
      loadingQuotedFloors: {},
      replies: [quotingReply],
      repliesByFloor: new Map<number, Reply>(),
      source: 'linuxdo' as const,
      topicId: '300'
    };
    const secondInstanceKey = replyQuotedPostInstanceKey(getReplyKey(quotingReply), secondReference);
    const expanded = buildVirtualizedReplyItems({
      ...common,
      expandedQuotes: { [secondInstanceKey]: true }
    });

    expect(expanded.map((item) => item.type)).toEqual([
      'replyStart',
      'replyQuoteSummary',
      'replyQuoteSummary',
      'replyQuoteContent',
      'replyEnd'
    ]);
    const content = expanded.find((item) => item.type === 'replyQuoteContent');
    expect(content).toMatchObject({ first: true, last: true, reference: secondReference });
    expect(expanded.slice(0, -1).map((item, index) => topicListItemSpacing(item, expanded[index + 1]))).toEqual([
      8,
      12,
      0,
      8
    ]);

    const collapsed = buildVirtualizedReplyItems({ ...common, expandedQuotes: {} });
    expect(collapsed.map((item) => item.type)).toEqual([
      'replyStart',
      'replyQuoteSummary',
      'replyQuoteSummary',
      'replyEnd'
    ]);
    expect(collapsed[1].key).toBe(expanded[1].key);
    expect(collapsed[2].key).toBe(expanded[2].key);

    const expandedAgain = buildVirtualizedReplyItems({
      ...common,
      expandedQuotes: { [secondInstanceKey]: true }
    });
    expect(expandedAgain.find((item) => item.type === 'replyQuoteContent')?.content).toBe(content?.content);
  });

  it('[REG-TOPIC-028][REG-TOPIC-054] binds quote rows and expansion to the reply entity', () => {
    const reference = { source: 'linuxdo' as const, topicId: '200', postNumber: 2 };
    const first: Reply = { ...reply, commentId: 101, floor: 68, quotedPosts: [{ reference }] };
    const second: Reply = { ...reply, commentId: 202, floor: 68, quotedPosts: [{ reference }] };
    const firstInstanceKey = replyQuotedPostInstanceKey(getReplyKey(first), reference);
    const items = buildVirtualizedReplyItems({
      expandedQuotes: { [firstInstanceKey]: true },
      loadedQuotedReplies: { 'linuxdo:200:2': { ...reply, floor: 2 } },
      loadingQuotedFloors: {},
      replies: [first, second],
      repliesByFloor: new Map<number, Reply>(),
      source: 'linuxdo',
      topicId: '300'
    });
    const summaries = items.filter((item) => item.type === 'replyQuoteSummary');

    expect(summaries.map((item) => item.key)).toEqual([
      firstInstanceKey,
      replyQuotedPostInstanceKey(getReplyKey(second), reference)
    ]);
    expect(summaries.map((item) => item.expanded)).toEqual([true, false]);
    expect(items.filter((item) => item.type === 'replyQuoteContent')).toHaveLength(1);
  });

  it('[REG-TOPIC-055] materializes two cold quote rows before the measured instance expands fully', () => {
    const reference = { source: 'linuxdo' as const, topicId: '342888', postNumber: 1 };
    const first: Reply = { ...reply, commentId: 301, quotedPosts: [{ reference }] };
    const second: Reply = { ...reply, commentId: 302, quotedPosts: [{ reference }] };
    const quotedReply: Reply = {
      ...reply,
      floor: 1,
      contentHtml: Array.from(
        { length: 6 },
        (_, index) => `<p>quote ${index} ${'safe text '.repeat(260)}</p>`
      ).join('')
    };
    const firstInstanceKey = replyQuotedPostInstanceKey(getReplyKey(first), reference);
    const secondInstanceKey = replyQuotedPostInstanceKey(getReplyKey(second), reference);
    const common = {
      expandedQuotes: { [firstInstanceKey]: true, [secondInstanceKey]: true },
      loadedQuotedReplies: { 'linuxdo:342888:1': quotedReply },
      loadingQuotedFloors: {},
      replies: [first, second],
      repliesByFloor: new Map<number, Reply>(),
      source: 'linuxdo' as const,
      topicId: '2685882'
    };
    const cold = buildVirtualizedReplyItems({
      ...common,
      primedQuoteContentTokens: new Map<string, string>()
    });
    const coldRows = cold.filter((item) => item.type === 'replyQuoteContent');

    expect(coldRows).toHaveLength(4);
    expect(coldRows.filter((item) => item.instanceKey === firstInstanceKey)).toHaveLength(2);
    expect(coldRows.filter((item) => item.instanceKey === secondInstanceKey)).toHaveLength(2);
    expect(coldRows.every((item) => item.measureForMaterialization)).toBe(true);
    const contentToken = coldRows[0]?.contentToken;
    expect(contentToken).toBeTruthy();

    const primed = buildVirtualizedReplyItems({
      ...common,
      primedQuoteContentTokens: new Map([[firstInstanceKey, contentToken!]])
    });
    const primedRows = primed.filter((item) => item.type === 'replyQuoteContent');
    const firstRows = primedRows.filter((item) => item.instanceKey === firstInstanceKey);
    const secondRows = primedRows.filter((item) => item.instanceKey === secondInstanceKey);

    expect(firstRows).toHaveLength(6);
    expect(firstRows.every((item) => !item.measureForMaterialization)).toBe(true);
    expect(firstRows.slice(0, 2).map((item) => item.key)).toEqual(
      coldRows.filter((item) => item.instanceKey === firstInstanceKey).map((item) => item.key)
    );
    expect(secondRows).toHaveLength(2);

    const changed = buildVirtualizedReplyItems({
      ...common,
      loadedQuotedReplies: {
        'linuxdo:342888:1': { ...quotedReply, contentHtml: `${quotedReply.contentHtml}<p>changed</p>` }
      },
      primedQuoteContentTokens: new Map([[firstInstanceKey, contentToken!]])
    });
    expect(changed.filter((item) => item.type === 'replyQuoteContent' && item.instanceKey === firstInstanceKey)).toHaveLength(2);
  });
});
