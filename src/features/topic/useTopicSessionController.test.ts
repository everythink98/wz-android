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
  it('matches the linux.do original poster by account when different people share a display name', () => {
    const owner = { author: '新昵称', authorId: 'alice', contentHtml: '', createdAt: '' };
    const other = { ...owner, author: '旧昵称', authorId: 'bob' };
    expect(
      filterTopicSessionReplies({
        topicDetail: { ...topic, author: '旧昵称', authorId: 'alice' },
        topicReplies: [other, owner],
        source: 'linuxdo',
        replyFilter: 'author',
        commentQuery: ''
      })
    ).toEqual([owner]);
  });
  it('uses trusted profile usernames for older replies and never attributes a nickname alone to the original poster', () => {
    const sameName = { author: '同名', contentHtml: '', createdAt: '' };
    const owner = { ...sameName, author: '新昵称', authorUrl: 'https://linux.do/u/Alice' };
    const replies = [owner, { ...sameName, authorUrl: 'https://linux.do/u/bob' }, sameName];
    const byAuthor = (detail: TopicDetail) =>
      filterTopicSessionReplies({
        topicDetail: detail,
        topicReplies: replies,
        source: 'linuxdo',
        replyFilter: 'author',
        commentQuery: ''
      });
    expect(byAuthor({ ...topic, author: '同名', authorUrl: 'https://linux.do/u/alice' })).toEqual([owner]);
    expect(byAuthor({ ...topic, author: '同名' })).toEqual([]);
  });
  it.each(['nodeseek', 'yaohuo'] as const)('matches the %s original poster by user ID before nickname', (source) => {
    const owner = { author: '新昵称', authorId: '1001', contentHtml: '', createdAt: '' };
    const other = { ...owner, author: '旧昵称', authorId: '2001' };
    const legacy = { author: '旧昵称', contentHtml: '', createdAt: '' };
    expect(
      filterTopicSessionReplies({
        topicDetail: { ...topic, source, author: '旧昵称', authorId: '1001' },
        topicReplies: [other, owner, legacy],
        source,
        replyFilter: 'author',
        commentQuery: ''
      })
    ).toEqual([owner, legacy]);
  });
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
    const included: Reply = {
      author: 'alice',
      authorId: 'alice',
      contentHtml: '<p>Needle VPS</p>',
      createdAt: '',
      floor: 1
    };
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
        topicDetail: { ...topic, authorId: 'alice' },
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
    ].map((reply) => prepareReplyContent({ ...reply, authorId: reply.author }, 'linuxdo'));
    const filter = (replyFilter: 'all' | 'author' | 'images', commentQuery = '') =>
      filterTopicSessionReplies({
        commentQuery,
        replyFilter,
        source: 'linuxdo',
        topicDetail: { ...topic, authorId: 'alice', replies },
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

  const initial = {
    scope: 'linuxdo:1:alice',
    mode: { kind: 'reply', intent: { kind: 'closed' } },
    reply: { content: 'reply draft', face: 'face', polls: [] }
  } satisfies Parameters<typeof transitionReplyComposer>[0];

  it('keeps an existing draft when a floor reply is opened and closed', () => {
    const target = transitionReplyComposer(initial, { type: 'reply-to-floor', target: floorTarget });
    expect(target.mode).toEqual({ kind: 'reply', intent: { kind: 'floor', target: floorTarget } });
    expect(transitionReplyComposer(target, { type: 'close' }).reply).toEqual(initial.reply);
  });

  it('initializes edits from the published text and releases unmodified edits', () => {
    const target = transitionReplyComposer(initial, { type: 'edit', target: editTarget });
    expect(target.mode).toMatchObject({ kind: 'edit', draft: { content: editTarget.contentMarkdown } });
    expect(transitionReplyComposer(target, { type: 'detach-edit', target: editTarget })).toEqual(initial);
  });

  it('uses only the submitted draft slot when settling a reply', () => {
    const editing = transitionReplyComposer(initial, { type: 'edit', target: editTarget });
    expect(transitionReplyComposer(editing, { type: 'complete-submission' })).toEqual(initial);
    expect(transitionReplyComposer(initial, { type: 'complete-submission' }).reply).toEqual({
      content: '',
      face: '',
      polls: []
    });
  });
  it('recovers poll choices even when the last confirmed edit text still matches the published reply', () => {
    const editing = transitionReplyComposer(initial, { type: 'edit', target: editTarget });
    const updated = transitionReplyComposer(editing, {
      type: 'update',
      owner: { scope: initial.scope, edit: editTarget },
      update: (draft) => ({
        ...draft,
        polls: [
          {
            localId: 'draft_1',
            fingerprint: 'fp',
            title: '投票题目',
            multiple: true,
            isPublic: false,
            options: ['甲', '乙']
          }
        ]
      })
    });
    const result = transitionReplyComposer(updated, { type: 'detach-edit', target: editTarget });
    expect(result.mode).toMatchObject({ kind: 'recovery', content: expect.stringContaining('投票题目') });
    if (result.mode.kind === 'recovery') expect(result.mode.content).toContain('乙');
  });
});
