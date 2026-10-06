import { afterEach, describe, expect, it, vi } from 'vitest';
import * as forumText from '@/domain/forum/text';
import { createReplySearchCache, filterRepliesByQuery } from './model/replySearch';
import type { Reply, TopicDetail } from '@/domain/forum/models';
import { prepareReplyContent } from '@/domain/forum/topicContentSplit';
import type { ReplyEditTarget, ReplyTarget } from './model/types';
import { filterTopicSessionReplies, transitionReplyComposer } from './useTopicSessionController';

const topic: TopicDetail = {
  source: 'linuxdo',
  id: '1',
  title: 'Topic',
  author: 'alice',
  url: 'https://linux.do/t/topic/1',
  createdAt: '2026-05-26T00:00:00.000Z',
  replyCount: 1,
  contentHtml: '<p>Topic</p>',
  replies: []
};

afterEach(() => vi.restoreAllMocks());

describe('route-local reply search reuse', () => {
  const reply = (contentHtml: string, floor = 1): Reply => ({ author: 'alice', contentHtml, createdAt: '', floor });

  it('normalizes each unchanged body once across cold and warm query sequences', () => {
    const replies = Array.from({ length: 1000 }, (_, index) => reply(`<p>Needle VPS &amp; 😀 ${index}</p>`, index));
    Object.freeze(replies);
    const queries = ['needle', 'vps', 'missing', 'needle vps', 'VPS', 'needle 9', 'vps 1', '2', 'needle 3'];
    const expected = queries.map((query) => filterRepliesByQuery(replies, query));
    const normalize = vi.spyOn(forumText, 'stripHtml');
    const cache = createReplySearchCache();
    for (let round = 0; round < 2; round++) {
      queries.forEach((query, index) => {
        const actual = filterRepliesByQuery(replies, query, cache);
        expect(actual).toEqual(expected[index]);
        expect(actual.every((item, position) => item === expected[index][position])).toBe(true);
      });
    }
    expect(normalize).toHaveBeenCalledTimes(replies.length);
    for (const query of ['', '   ', '-ignored']) expect(filterRepliesByQuery(replies, query, cache)).toBe(replies);
    expect(normalize).toHaveBeenCalledTimes(replies.length);
  });

  it('invalidates changed bodies and releases removed replies without caching visibility', () => {
    const first = reply('<p>Needle</p>');
    const removed = reply('<p>VPS</p>', 2);
    const normalize = vi.spyOn(forumText, 'stripHtml');
    const cache = createReplySearchCache();
    const run = (replies: Reply[], query: string, replyFilter: 'all' | 'author' = 'all') =>
      filterTopicSessionReplies({
        topicReplies: replies,
        topicDetail: topic,
        source: 'linuxdo',
        commentQuery: query,
        replyFilter,
        searchCache: cache
      });
    expect(run([first, removed], 'needle')).toEqual([first]);
    expect(normalize).toHaveBeenCalledTimes(2);
    first.contentHtml = '<p>Changed &amp; 😀</p>';
    expect(run([first, removed], 'changed')).toEqual([first]);
    expect(normalize).toHaveBeenCalledTimes(3);
    run([first], 'changed');
    run([first, removed], 'vps');
    expect(normalize).toHaveBeenCalledTimes(4);
    first.author = 'bob';
    expect(run([first, removed], 'changed', 'author')).toEqual([]);
    expect(normalize).toHaveBeenCalledTimes(4);
    const clone = { ...first };
    run([clone], 'changed');
    expect(normalize).toHaveBeenCalledTimes(5);
    cache.clear();
    run([clone], 'changed');
    expect(normalize).toHaveBeenCalledTimes(6);
  });

  it('evicts the oldest of 4096 entries without promoting cache hits', () => {
    const cache = createReplySearchCache();
    const normalize = vi.spyOn(forumText, 'stripHtml');
    const replies = Array.from({ length: 4097 }, (_, index) => reply(`<p>${index}</p>`, index));
    replies.slice(0, 4096).forEach(cache.text);
    cache.text(replies[0]);
    expect(normalize).toHaveBeenCalledTimes(4096);
    cache.text(replies[4096]);
    cache.text(replies[4095]);
    expect(normalize).toHaveBeenCalledTimes(4097);
    cache.text(replies[0]);
    expect(normalize).toHaveBeenCalledTimes(4098);
  });

  it('bounds retained HTML plus text to UTF-16 units and bypasses oversized bodies', () => {
    const cache = createReplySearchCache();
    const normalize = vi.spyOn(forumText, 'stripHtml');
    const replies = [reply('a'.repeat(512 * 1024)), reply('b'.repeat(512 * 1024)), reply('c'.repeat(512 * 1024))];
    replies.forEach(cache.text);
    cache.text(replies[1]);
    cache.text(replies[2]);
    expect(normalize).toHaveBeenCalledTimes(3);
    const oversized = reply(`<p>${'😀'.repeat(512 * 1024)}</p>`);
    cache.text(oversized);
    cache.text(oversized);
    cache.text(replies[1]);
    expect(normalize).toHaveBeenCalledTimes(5);
    cache.text(replies[0]);
    expect(normalize).toHaveBeenCalledTimes(6);
    replies[0].contentHtml = 'small';
    cache.text(replies[0]);
    cache.text(replies[1]);
    cache.text(replies[0]);
    expect(normalize).toHaveBeenCalledTimes(8);
  });
});

describe('topic local session helpers', () => {
  it('does not convert reply bodies excluded by the author filter', () => {
    let excludedReads = 0;
    const included: Reply = { author: 'alice', contentHtml: '<p>Needle VPS</p>', createdAt: '', floor: 1 };
    const excluded: Reply = {
      author: 'bob',
      get contentHtml() {
        excludedReads += 1;
        return '<p>Needle VPS</p>';
      },
      createdAt: '',
      floor: 2
    };
    expect(
      filterTopicSessionReplies({
        commentQuery: 'NEEDLE vps',
        replyFilter: 'author',
        source: 'linuxdo',
        topicDetail: topic,
        topicReplies: [included, excluded]
      })
    ).toEqual([included]);
    expect(excludedReads).toBe(0);
  });

  it('filters replies by author, images, and text', () => {
    const replies: Reply[] = [
      { author: 'alice', contentHtml: '<p>first</p>', createdAt: '', floor: 1 },
      { author: 'bob', contentHtml: '<p>needle</p><img src="https://img/2.png">', createdAt: '', floor: 2 },
      { author: 'alice', contentHtml: '<p>third needle</p>', createdAt: '', floor: 3 }
    ].map((reply) => prepareReplyContent(reply, 'linuxdo'));
    const filter = (replyFilter: 'all' | 'author' | 'images', commentQuery = '') =>
      filterTopicSessionReplies({
        commentQuery,
        replyFilter,
        source: 'linuxdo',
        topicDetail: { ...topic, replies },
        topicReplies: replies
      }).map(({ floor }) => floor);

    expect(filter('author')).toEqual([1, 3]);
    expect(filter('images')).toEqual([2]);
    expect(filter('all', 'needle')).toEqual([2, 3]);
    expect(filter('images', 'Needle')).toEqual([2]);
    expect(filter('author', 'Needle')).toEqual([3]);
  });

  const floorTarget: ReplyTarget = { floor: 3, author: 'bob', authorId: '7' };
  const editTarget: ReplyEditTarget = {
    commentId: 9,
    contentMarkdown: '旧回复',
    topicId: '1',
    ticket: { source: 'linuxdo', identityKey: 'linuxdo:alice', sessionEpoch: 1 }
  };

  it.each([
    {
      label: 'opens a normal draft',
      state: { intent: { kind: 'closed' as const }, content: '普通草稿', face: '旧表情' },
      event: { type: 'open' as const },
      expected: { intent: { kind: 'new' as const }, content: '普通草稿', face: '' }
    },
    {
      label: 'targets a floor',
      state: { intent: { kind: 'new' as const }, content: '楼层草稿', face: '旧表情' },
      event: { type: 'reply-to-floor' as const, target: floorTarget },
      expected: { intent: { kind: 'floor' as const, target: floorTarget }, content: '楼层草稿', face: '' }
    },
    {
      label: 'starts an edit from the server markdown',
      state: { intent: { kind: 'floor' as const, target: floorTarget }, content: '楼层草稿', face: '旧表情' },
      event: { type: 'edit' as const, target: editTarget },
      expected: { intent: { kind: 'edit' as const, target: editTarget }, content: '旧回复', face: '' }
    },
    {
      label: 'keeps a normal draft on close',
      state: { intent: { kind: 'new' as const }, content: '普通草稿', face: '旧表情' },
      event: { type: 'close' as const },
      expected: { intent: { kind: 'closed' as const }, content: '普通草稿', face: '' }
    },
    {
      label: 'keeps a floor draft on close',
      state: { intent: { kind: 'floor' as const, target: floorTarget }, content: '楼层草稿', face: '旧表情' },
      event: { type: 'close' as const },
      expected: { intent: { kind: 'closed' as const }, content: '楼层草稿', face: '' }
    },
    {
      label: 'clears an edit draft on cancel',
      state: { intent: { kind: 'edit' as const, target: editTarget }, content: '改写中', face: '旧表情' },
      event: { type: 'close' as const },
      expected: { intent: { kind: 'closed' as const }, content: '', face: '' }
    },
    {
      label: 'preserves the draft when a stale edit detaches',
      state: { intent: { kind: 'edit' as const, target: editTarget }, content: '权限失效时保留', face: '旧表情' },
      event: { type: 'detach-edit' as const },
      expected: { intent: { kind: 'closed' as const }, content: '权限失效时保留', face: '' }
    },
    {
      label: 'resets after a successful submission',
      state: { intent: { kind: 'floor' as const, target: floorTarget }, content: '已提交', face: '表情' },
      event: { type: 'complete-submission' as const },
      expected: { intent: { kind: 'closed' as const }, content: '', face: '' }
    },
    {
      label: 'changes draft content',
      state: { intent: { kind: 'new' as const }, content: '旧草稿', face: '' },
      event: { type: 'change-content' as const, content: '新草稿' },
      expected: { intent: { kind: 'new' as const }, content: '新草稿', face: '' }
    },
    {
      label: 'changes the selected face',
      state: { intent: { kind: 'new' as const }, content: '草稿', face: '' },
      event: { type: 'change-face' as const, face: '踩' },
      expected: { intent: { kind: 'new' as const }, content: '草稿', face: '踩' }
    },
    {
      label: 'appends uploaded markup',
      state: { intent: { kind: 'new' as const }, content: '草稿', face: '' },
      event: { type: 'append-markup' as const, markup: '![图](https://img/1.png)' },
      expected: { intent: { kind: 'new' as const }, content: '草稿\n![图](https://img/1.png)', face: '' }
    }
  ])('$label', ({ state, event, expected }) => {
    expect(transitionReplyComposer(state, event)).toEqual(expected);
  });
});
