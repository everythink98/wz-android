import { describe, expect, it } from 'vitest';
import {
  buildReplyListItems,
  buildVirtualizedReplyItems,
  getReplyKey,
  topicListItemSpacing,
  type TopicReplyListItem
} from './replyListModel';
import { replyQuotedPostInstanceKey, topicOpeningPostAsReply } from '@/domain/forum/quotedPosts';
import type { Reply, TopicDetail } from '@/domain/forum/models';

const reply: Reply = {
  author: 'alice',
  contentHtml: '<p>Hello</p>',
  createdAt: '2026-07-03T00:00:00.000Z',
  floor: 2
};
const replyItem: TopicReplyListItem = {
  type: 'reply',
  key: 'reply-floor-2',
  reply,
  replyFloor: 2
};
const listCases: [string, boolean, TopicReplyListItem[], boolean, TopicReplyListItem[]][] = [
  ['visible replies', true, [replyItem], false, [{ type: 'replyControls', key: 'reply-controls' }, replyItem]],
  [
    'empty replies',
    true,
    [],
    false,
    [
      { type: 'replyControls', key: 'reply-controls' },
      { type: 'emptyReplies', key: 'empty-replies' }
    ]
  ],
  ['access notice', true, [replyItem], true, []]
];

describe('topic reply list model', () => {
  it('[REG-PERF-010] promotes a poll-only reply into a parent-list content row', () => {
    const poll = { name: 'choice', options: [{ id: 'yes', label: 'Yes' }] };
    const items = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [{ ...reply, contentHtml: '', polls: [poll] }],
      repliesByFloor: new Map(),
      source: 'linuxdo',
      topicId: '42'
    });

    expect(items.map((item) => item.type)).toEqual(['replyStart', 'replyContent', 'replyEnd']);
    expect(items[1]).toMatchObject({ content: { poll, type: 'poll' }, type: 'replyContent' });
  });

  it('[REG-PERF-010] promotes a giant nested reply body into bounded parent-list rows', () => {
    const imageReply: Reply = {
      ...reply,
      commentId: 863650,
      contentHtml: `<p>${Array.from(
        { length: 2000 },
        (_, index) => `<img src="https://img.example.com/${index}.jpg">`
      ).join('')}</p>`
    };
    const items = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [imageReply],
      repliesByFloor: new Map(),
      source: 'nodeseek',
      topicId: '863650'
    });

    expect(items[0]?.type).toBe('replyStart');
    expect(items.at(-1)?.type).toBe('replyEnd');
    const bodyRows = items.filter((item) => item.type === 'replyContent');
    expect(bodyRows).toHaveLength(500);
    expect(bodyRows.map((item) => (item.content.type === 'html' ? item.content.networkMediaCount : 0))).toEqual(
      Array.from({ length: 500 }, () => 4)
    );
    expect(
      bodyRows.every((item) => item.content.type === 'html' && (item.content.html.match(/<img\b/g) || []).length <= 4)
    ).toBe(true);
  });

  it('[REG-PERF-010] never combines independently safe body and signature media into one oversized reply cell', () => {
    const images = (prefix: string) =>
      Array.from({ length: 4 }, (_, index) => `<img src="https://img.example.com/${prefix}-${index}.jpg">`).join('');
    const mediaReply: Reply = {
      ...reply,
      commentId: 863652,
      contentHtml: `<p>${images('body')}</p>`,
      signatureHtml: `<p>${images('signature')}</p>`
    };

    const items = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [mediaReply],
      repliesByFloor: new Map(),
      source: 'nodeseek',
      topicId: '863652'
    });

    expect(items.map((item) => item.type)).toEqual(['replyStart', 'replyContent', 'replySignatureContent', 'replyEnd']);
    expect(items.find((item) => item.type === 'replyContent')?.content).toMatchObject({
      networkMediaCount: 4,
      type: 'html'
    });
    expect(items.find((item) => item.type === 'replySignatureContent')).toMatchObject({ networkMediaCount: 4 });
  });

  it('[REG-PERF-010] keeps a cheap body and short signature on the ordinary single-cell path', () => {
    const cheapReply: Reply = {
      ...reply,
      commentId: 863653,
      contentHtml: '<p>body <img src="https://img.example.com/body.jpg"></p>',
      signatureHtml: '<p>short signature</p>'
    };

    const items = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [cheapReply],
      repliesByFloor: new Map(),
      source: 'nodeseek',
      topicId: '863653'
    });

    expect(items).toEqual([
      expect.objectContaining({ networkMediaCount: 1, plannedRowCount: 2, reply: cheapReply, type: 'reply' })
    ]);
  });

  it.each([
    {
      body: `<p>${'<span></span>'.repeat(40)}</p>`,
      label: 'DOM-node',
      signature: `<p>${'<span></span>'.repeat(40)}</p>`
    },
    {
      body: `<p data-note="${'b'.repeat(9_000)}">body</p>`,
      label: 'serialized-size',
      signature: `<p data-note="${'s'.repeat(9_000)}">signature</p>`
    }
  ])('[REG-PERF-010] applies the combined $label budget before using one reply cell', ({ body, signature }) => {
    const combinedReply: Reply = {
      ...reply,
      commentId: 863654,
      contentHtml: body,
      signatureHtml: signature
    };

    const items = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [combinedReply],
      repliesByFloor: new Map(),
      source: 'nodeseek',
      topicId: '863654'
    });

    expect(items.map((item) => item.type)).toEqual(['replyStart', 'replyContent', 'replySignatureContent', 'replyEnd']);
  });

  it('[REG-PERF-010] combines sibling-region depth by maximum instead of summing independent trees', () => {
    const nested = (label: string) => `${'<span>'.repeat(38)}${label}${'</span>'.repeat(38)}`;
    const deepReply: Reply = {
      ...reply,
      commentId: 863655,
      contentHtml: nested('body'),
      signatureHtml: nested('signature')
    };

    const items = buildVirtualizedReplyItems({
      expandedQuotes: {},
      loadedQuotedReplies: {},
      loadingQuotedFloors: {},
      replies: [deepReply],
      repliesByFloor: new Map(),
      source: 'nodeseek',
      topicId: '863655'
    });

    expect(items).toEqual([expect.objectContaining({ reply: deepReply, type: 'reply' })]);
  });

  it('[REG-PERF-010] propagates planner groups through split reply body, signature, and quote rows', () => {
    const oversizedDetails = (prefix: string) =>
      `<details><summary>${prefix}</summary><p>${Array.from(
        { length: 9 },
        (_, index) => `<img src="https://img.example.com/${prefix}-${index}.jpg">`
      ).join('')}</p></details>`;
    const reference = { source: 'linuxdo' as const, topicId: 'quoted', postNumber: 2 };
    const owner: Reply = {
      ...reply,
      commentId: 90,
      contentHtml: oversizedDetails('body'),
      quotedPosts: [{ reference }],
      signatureHtml: oversizedDetails('signature')
    };
    const instanceKey = replyQuotedPostInstanceKey(getReplyKey(owner), reference);
    const items = buildVirtualizedReplyItems({
      expandedQuotes: { [instanceKey]: true },
      loadedQuotedReplies: {
        'linuxdo:quoted:2': { ...reply, contentHtml: oversizedDetails('quote'), floor: 2 }
      },
      loadingQuotedFloors: {},
      primedQuoteContentTokens: new Map([[instanceKey, 'unused']]),
      replies: [owner],
      repliesByFloor: new Map(),
      source: 'linuxdo',
      topicId: 'owner'
    });

    const body = items.filter(
      (item): item is Extract<TopicReplyListItem, { type: 'replyContent' }> =>
        item.type === 'replyContent' && item.content.type === 'html'
    );
    const signature = items.filter((item) => item.type === 'replySignatureContent');
    const quote = items.filter(
      (item): item is Extract<TopicReplyListItem, { type: 'replyQuoteContent' }> =>
        item.type === 'replyQuoteContent' && item.content.type === 'html'
    );

    expect(body).toHaveLength(3);
    expect(signature).toHaveLength(3);
    expect(signature).toEqual([
      expect.objectContaining({ continuation: 'first' }),
      expect.objectContaining({ continuation: 'middle' }),
      expect.objectContaining({ continuation: 'last' })
    ]);
    expect(quote).toHaveLength(2);
    expect(new Set(body.map((item) => item.content.type === 'html' && item.content.groupKey))).toEqual(
      new Set(['0:block-0'])
    );
    expect(new Set(signature.map((item) => item.groupKey))).toEqual(new Set(['block-0']));
    expect(new Set(quote.map((item) => item.content.type === 'html' && item.content.groupKey))).toEqual(
      new Set(['0:block-0'])
    );
  });

  it.each([
    {
      label: 'reply body',
      contentHtml: `<p data-oversized="${'x'.repeat(20_000)}">safe reply body</p>`,
      expectedBodyHtml: 'safe reply body',
      expectedSignatureHtml: '<p>safe signature</p>',
      signatureHtml: '<p>safe signature</p>'
    },
    {
      label: 'reply signature',
      contentHtml: '<p>safe reply body</p>',
      expectedBodyHtml: '<p>safe reply body</p>',
      expectedSignatureHtml: 'safe signature',
      signatureHtml: `<p data-oversized="${'x'.repeat(20_000)}">safe signature</p>`
    }
  ])(
    '[REG-PERF-010] renders planner output when an oversized $label attribute is rewritten',
    ({ contentHtml, expectedBodyHtml, expectedSignatureHtml, signatureHtml }) => {
      const unsafeReply: Reply = {
        ...reply,
        commentId: 863651,
        contentHtml,
        signatureHtml
      };

      const items = buildVirtualizedReplyItems({
        expandedQuotes: {},
        loadedQuotedReplies: {},
        loadingQuotedFloors: {},
        replies: [unsafeReply],
        repliesByFloor: new Map(),
        source: 'nodeseek',
        topicId: '863651'
      });

      expect(items.map((item) => item.type)).toEqual([
        'replyStart',
        'replyContent',
        'replySignatureContent',
        'replyEnd'
      ]);
      const body = items.find((item) => item.type === 'replyContent');
      const signature = items.find((item) => item.type === 'replySignatureContent');
      expect(body?.content).toMatchObject({ type: 'html', networkMediaCount: 0 });
      expect(body?.content.type === 'html' ? body.content.html : '').toContain(expectedBodyHtml);
      expect(body?.content.type === 'html' ? body.content.html : '').toContain('class="forum-reply-content"');
      expect(signature?.html).toContain(expectedSignatureHtml);
      expect(signature?.html).toContain('class="forum-reply-content"');
      expect(items.at(-1)).toMatchObject({ bodyVirtualized: true, signatureVirtualized: true });
    }
  );

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

  it.each(listCases)(
    'builds FlashList data for %s',
    (_label, canShowReplies, replyItems, topicShowsAccessNotice, expected) => {
      expect(buildReplyListItems({ canShowReplies, replyItems, topicShowsAccessNotice })).toEqual(expected);
    }
  );

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
      'replyContent',
      'replyEnd'
    ]);
    const content = expanded.find((item) => item.type === 'replyQuoteContent');
    expect(content).toMatchObject({ first: true, last: true, reference: secondReference });
    expect(expanded.slice(0, -1).map((item, index) => topicListItemSpacing(item, expanded[index + 1]))).toEqual([
      8, 12, 0, 0, 8
    ]);

    const collapsed = buildVirtualizedReplyItems({ ...common, expandedQuotes: {} });
    expect(collapsed.map((item) => item.type)).toEqual([
      'replyStart',
      'replyQuoteSummary',
      'replyQuoteSummary',
      'replyContent',
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
      contentHtml: Array.from({ length: 6 }, (_, index) => `<p>quote ${index} ${'safe text '.repeat(260)}</p>`).join('')
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
    expect(
      changed.filter((item) => item.type === 'replyQuoteContent' && item.instanceKey === firstInstanceKey)
    ).toHaveLength(2);
  });
});
