import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { getCategories, getFeed } from './feedRead';
import { mergeTopics } from '@/domain/forum/feed';
import type { FeedResponse } from '@/domain/forum/models';
import { accessRequirementLevelValue } from '@/domain/forum/presentation';
import { getReplies, getTopic } from './sourceRead';
import { searchTopics } from './searchRead';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import type { Fetcher } from '@/platform/network/request';
import { registerForumReadResponseEvidence } from './forumSourceReadAttempt';
import { beginDiagnosticTrace, setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';
import { getDefaultAndroidWebViewUserAgent } from '@/platform/android/androidWebViewUserAgent';
import * as v2exReader from '@/sources/v2ex/reader';

it('fills aggregate pages with unique candidates and merges access before buffering the remainder', async () => {
  const buffered = Array.from({ length: 20 }, (_, index) => ({
    source: 'linuxdo',
    id: String(index + 1),
    title: `Buffered ${index + 1}`,
    url: `https://linux.do/t/topic/${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 1, 60 - index)).toISOString()
  }));
  const topics = Array.from({ length: 30 }, (_, index) => ({
    id: index === 0 ? 1 : 100 + index,
    title: `Incoming ${index}`,
    slug: 'topic',
    created_at: new Date(Date.UTC(2026, 9, 1, 0, 0, 30 - index)).toISOString(),
    posts_count: 1,
    ...(index === 0 ? { required_trust_level: 3 } : {})
  }));
  const fetcher = vi.fn(
    async () =>
      new Response(JSON.stringify({ topic_list: { topics }, categories: [], users: [] }), {
        headers: { 'content-type': 'application/json' }
      })
  );
  const cursor = encodeURIComponent(JSON.stringify({ buffers: { linuxdo: buffered }, nextPages: { linuxdo: 2 } }));
  const first = await getFeed({ source: 'all', page: 2, cursor, limit: 30, includedSources: ['linuxdo'], fetcher });

  expect(first.items).toHaveLength(30);
  expect(mergeTopics([], first.items)).toHaveLength(30);
  expect(first.items.map((item) => item.id)).toEqual([
    ...buffered.map((item) => item.id),
    ...Array.from({ length: 10 }, (_, index) => String(101 + index))
  ]);
  expect(first.items[0].accessRequirement).toMatchObject({ type: 'level', label: '需等级' });
  expect(accessRequirementLevelValue(first.items[0].accessRequirement)).toBe(3);
  const second = await getFeed({
    source: 'all',
    page: 3,
    cursor: first.nextCursor ?? undefined,
    limit: 30,
    includedSources: ['linuxdo'],
    fetcher
  });
  expect(second.items.map((item) => item.id)).toEqual(Array.from({ length: 19 }, (_, index) => String(111 + index)));
  expect(second.hasMore).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

const nodeSeekPayload = Buffer.from(
  JSON.stringify({
    rotateTopics: [
      {
        postId: 1,
        titleText: 'NodeSeek',
        titleLink: '/post-1-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-20T00:00:00.000Z' }
      }
    ],
    allCategory: [{ key: 'tech', cn_text: '技术' }]
  })
).toString('base64');

describe('feed read', () => {
  const nodeSeekRow = (id: number, date: string, pinned = false) => `
    <li class="post-list-item"><div class="post-title"><a href="/post-${id}-1">Topic ${id}</a>${
      pinned ? '<span title="置顶"><svg class="pined"><use href="#pin" /></svg></span>' : ''
    }</div><span class="info-last-comment-time"><time datetime="${date}"></time></span></li>`;

  it('excludes pinned topics from the aggregate preview and page while keeping them in the source feed', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          new URL(url).hostname === 'www.v2ex.com'
            ? `<div class="cell item"><a class="topic-link" href="/t/1">V2EX 1</a></div>
         <div class="cell item"><a class="topic-link" href="/t/6">V2EX 6</a></div>`
            : nodeSeekRow(1, '2026-03-01T00:00:00Z', true) +
                nodeSeekRow(2, '2026-02-01T00:00:00Z', true) +
                nodeSeekRow(1, '2026-10-01T00:00:00Z') +
                nodeSeekRow(3, '2026-09-01T00:00:00Z') +
                nodeSeekRow(4, '2026-08-01T00:00:00Z')
        )
    );
    const onProgress = vi.fn<(response: FeedResponse) => void>();
    const result = await getFeed({
      source: 'all',
      includedSources: ['nodeseek', 'v2ex'],
      limit: 4,
      fetcher,
      onProgress
    });
    expect(
      onProgress.mock.lastCall?.[0].items.filter((item) => item.source === 'nodeseek').map((item) => item.id)
    ).toEqual(['3', '4']);
    expect(result.items.filter((item) => item.source === 'nodeseek').map((item) => item.id)).toEqual(['3', '4']);
    expect(result.items.filter((item) => item.source === 'v2ex').map((item) => item.id)).toEqual(['1', '6']);
    expect(result.hasMore).toBe(false);

    const singleSource = await getFeed({ source: 'nodeseek', limit: 5, fetcher });
    expect(singleSource.items.filter((item) => item.pinned).map((item) => item.id)).toEqual(['1', '2']);
  });

  it('keeps the next page available when the aggregate first page contains only pinned topics', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          new URL(url).pathname === '/recent'
            ? '<div class="cell item"><a class="topic-link" href="/t/3">Regular topic</a></div>'
            : [1, 2]
                .map(
                  (id) => `<div class="cell item" style="background-image: url(/corner_star.png)">
                  <a class="topic-link" href="/t/${id}">Pinned topic ${id}</a></div>`
                )
                .join('')
        )
    );
    const options = { source: 'all', includedSources: ['v2ex'], limit: 1, fetcher } satisfies Parameters<
      typeof getFeed
    >[0];
    const onProgress = vi.fn();
    const first = await getFeed({ ...options, onProgress });
    expect(first).toMatchObject({ items: [], errors: {}, hasMore: true, nextPage: 2 });
    expect(onProgress).not.toHaveBeenCalled();
    expect(sourceDiagnosticSummary(first)).toMatchObject({ isExpectedEmpty: true, isParseEmpty: false });

    const second = await getFeed({ ...options, page: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items.map(({ id }) => id)).toEqual(['3']);
  });

  it('refills the aggregate buffer and drops topics pinned in the cursor or the next source page', async () => {
    const oldPin = {
      source: 'nodeseek',
      id: '99',
      title: 'Old pin',
      url: 'https://www.nodeseek.com/post-99-1',
      createdAt: '',
      pinned: true
    };
    const cachedTopic = {
      ...oldPin,
      id: '1',
      title: 'Cached topic',
      url: 'https://www.nodeseek.com/post-1-1',
      pinned: false
    };
    const cursor = encodeURIComponent(
      JSON.stringify({ buffers: { nodeseek: [oldPin, cachedTopic] }, nextPages: { nodeseek: 2 } })
    );
    const fetcher = vi.fn(
      async () => new Response(nodeSeekRow(1, '2026-10-01T00:00:00Z', true) + nodeSeekRow(2, '2026-09-01T00:00:00Z'))
    );
    const result = await getFeed({ source: 'all', includedSources: ['nodeseek'], page: 2, cursor, limit: 2, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.items.map(({ id }) => id)).toEqual(['2']);
    expect(result.hasMore).toBe(false);
  });

  it('excludes a known pinned topic when it returns without its badge on a later source page', async () => {
    const fetcher = vi.fn(
      async (url: string) =>
        new Response(
          new URL(url).pathname === '/page-2'
            ? nodeSeekRow(1, '2026-10-01T00:00:00Z') + nodeSeekRow(3, '2026-08-01T00:00:00Z')
            : nodeSeekRow(1, '2026-10-01T00:00:00Z', true) +
                nodeSeekRow(2, '2026-09-01T00:00:00Z') +
                '<a href="/page-2">下一页</a>'
        )
    );
    const options = { source: 'all', includedSources: ['nodeseek'], limit: 2, fetcher } satisfies Parameters<
      typeof getFeed
    >[0];
    const first = await getFeed(options);
    expect(first.items.map(({ id }) => id)).toEqual(['2']);
    expect(first.hasMore).toBe(true);

    const second = await getFeed({ ...options, page: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items.map(({ id }) => id)).toEqual(['3']);
    expect(second.hasMore).toBe(false);

    fetcher.mockResolvedValueOnce(new Response(nodeSeekRow(1, '2026-10-01T00:00:00Z')));
    const refreshed = await getFeed(options);
    expect(refreshed.items.map(({ id }) => id)).toEqual(['1']);
  });

  it.each([
    { hasMore: false, nextPage: 3 },
    { hasMore: true, nextPage: 2, nextCursor: 'same' }
  ])('stops a source whose adapter has no advancing position %j', async (answer) => {
    const adapter = vi.spyOn(v2exReader, 'getV2exFeed').mockResolvedValueOnce({ items: [], errors: {}, ...answer });
    try {
      const cursor = encodeURIComponent(JSON.stringify({ nextPages: { v2ex: 2 }, sourceCursors: { v2ex: 'same' } }));
      const result = await getFeed({ source: 'all', includedSources: ['v2ex'], page: 2, cursor, fetcher: vi.fn() });
      expect(result).toMatchObject({ hasMore: false, nextPage: null, nextCursor: undefined });
      expect(adapter).toHaveBeenCalledTimes(1);
    } finally {
      adapter.mockRestore();
    }
  });

  it('drains buffered rows and keeps a new opaque position on the same upstream page', async () => {
    const topic = (id: string) => ({
      source: 'v2ex' as const,
      id,
      title: id,
      author: 'tester',
      url: `https://www.v2ex.com/t/${id}`,
      createdAt: ''
    });
    const adapter = vi
      .spyOn(v2exReader, 'getV2exFeed')
      .mockResolvedValueOnce({ items: [topic('3')], errors: {}, hasMore: true, nextPage: 2, nextCursor: 'new' })
      .mockResolvedValueOnce({ items: [], errors: {}, hasMore: false, nextPage: null });
    try {
      let cursor = encodeURIComponent(
        JSON.stringify({
          buffers: { v2ex: [topic('1'), topic('2')] },
          nextPages: { v2ex: 2 },
          sourceCursors: { v2ex: 'old' }
        })
      );
      const ids = [];
      for (const page of [2, 3, 4, 5]) {
        const result = await getFeed({
          source: 'all',
          includedSources: ['v2ex'],
          page,
          cursor,
          limit: 1,
          fetcher: vi.fn()
        });
        ids.push(...result.items.map((item) => item.id));
        if (page <= 3) expect(adapter).not.toHaveBeenCalled();
        if (page === 5) expect(result.hasMore).toBe(false);
        cursor = result.nextCursor ?? '';
      }
      expect(ids).toEqual(['1', '2', '3']);
      expect(adapter.mock.calls.map(([options]) => [options?.page, options?.cursor])).toEqual([
        [2, 'old'],
        [2, 'new']
      ]);
    } finally {
      adapter.mockRestore();
    }
  });

  it('drains cached topics without promising another page for an unusable source cursor', async () => {
    const item = { source: 'v2ex', id: '1', title: '缓存主题', url: 'https://www.v2ex.com/t/1', createdAt: '' };
    const cursor = encodeURIComponent(JSON.stringify({ buffers: { v2ex: [item] }, sourceCursors: { v2ex: 'orphan' } }));
    const fetcher = vi.fn();
    const result = await getFeed({ source: 'all', includedSources: ['v2ex'], page: 2, cursor, fetcher });
    expect(result.items).toEqual([item]);
    expect(result).toMatchObject({ hasMore: false, nextPage: null, nextCursor: undefined });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps valid cached topics when a source buffer includes an invalid row or another site', async () => {
    const item = { source: 'v2ex', id: '1', title: '缓存主题', url: 'https://www.v2ex.com/t/1', createdAt: '' };
    const rows = [item, { ...item, source: 'yaohuo', id: '2' }, { ...item, id: '3', url: 42 }];
    const cursor = encodeURIComponent(JSON.stringify({ buffers: { v2ex: rows } }));
    const fetcher = vi.fn();
    const result = await getFeed({ source: 'all', includedSources: ['v2ex'], page: 2, cursor, fetcher });
    expect(result.items).toEqual([item]);
    expect(result.hasMore).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('shows completed sources while a cold connection is still reading, then keeps visible posts in order', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const progress = vi.fn();
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('nodeseek.com')) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 6_000);
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true }
          );
        });
        return new Response(`<script id="__NODESEEK_DATA__" type="application/json">${nodeSeekPayload}</script>`);
      }
      return new Response(
        [901, 902, 903]
          .map(
            (id) =>
              `<div class="cell item"><a class="topic-link" href="/t/${id}#reply0">Ready ${id}</a><a class="node" href="/go/create">create</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>`
          )
          .join('')
      );
    });
    const request = getFeed({
      source: 'all',
      limit: 2,
      includedSources: ['nodeseek', 'v2ex'],
      fetcher,
      signal: controller.signal,
      onProgress: progress
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(progress).toHaveBeenCalledWith(
        expect.objectContaining({ items: [expect.objectContaining({ id: '901' })] })
      );
      await vi.advanceTimersByTimeAsync(6_000);
      const result = await request;
      expect(result.errors).toEqual({});
      expect(result.items.map((item) => item.id)).toEqual(['901', '1']);
      expect(
        progress.mock.calls
          .flatMap(([value]) => value.items)
          .every((item) => result.items.some((final) => final.id === item.id))
      ).toBe(true);
    } finally {
      controller.abort();
      await request.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it('drains a producer cursor to completion without reading its buffered page again', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.includes('linux.do')
        ? new Response(
            JSON.stringify({
              topic_list: {
                topics: [1, 2, 3].map((id) => ({
                  id,
                  title: `Producer ${id}`,
                  slug: 'producer',
                  created_at: `2026-05-20T00:00:0${4 - id}Z`,
                  posts_count: 1
                }))
              },
              categories: [],
              users: []
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        : new Response('<div id="Main"></div>')
    );
    const options = { source: 'all' as const, includedSources: ['linuxdo', 'v2ex'] as const, limit: 2, fetcher };
    const first = await getFeed(options);
    const wire = JSON.parse(decodeURIComponent(first.nextCursor || ''));
    expect(first.items.map((topic) => topic.id)).toEqual(['1', '2']);
    expect(Object.keys(wire)).toEqual(['buffers', 'nextPages', 'sourceCursors']);
    expect(wire.buffers.linuxdo.map((topic: { id: string }) => topic.id)).toEqual(['3']);
    expect(wire.nextPages).toEqual({});
    expect(wire.sourceCursors).toEqual({});
    const firstPageRequests = fetcher.mock.calls.length;

    const second = await getFeed({ ...options, page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined });

    expect(second.items.map((topic) => topic.id)).toEqual(['3']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: undefined, nextPage: null });
    expect(fetcher).toHaveBeenCalledTimes(firstPageRequests);
  });

  it.each(['buffer-only', 'next-page', 'retry'] as const)(
    'keeps the continuation wire and transport policy for %s pages',
    async (mode) => {
      const buffered = Array.from({ length: mode === 'retry' ? 1 : 2 }, (_, index) => ({
        source: 'linuxdo',
        id: String(index + 1),
        title: `Buffered ${index}`,
        url: `https://linux.do/t/topic/${index + 1}`,
        createdAt: index === 0 ? '2026-05-20T00:00:00Z' : ''
      }));
      const cursor = encodeURIComponent(
        JSON.stringify({
          buffers: { linuxdo: buffered },
          nextPages: { linuxdo: 5 },
          sourceCursors: { linuxdo: 'provider-cursor' }
        })
      );
      const fetcher = vi.fn(async () => {
        if (mode === 'retry') throw new Error('temporary failure');
        return new Response('{"topic_list":{"topics":[]}}', { headers: { 'content-type': 'application/json' } });
      });
      const response = await getFeed({
        source: 'all',
        includedSources: ['linuxdo'],
        page: 2,
        cursor,
        limit: mode === 'next-page' ? 3 : 2,
        fetcher
      });

      expect(response.items.map((topic) => topic.id)).toEqual(buffered.map((topic) => topic.id));
      expect(fetcher).toHaveBeenCalledTimes(mode === 'buffer-only' ? 0 : 1);
      if (mode === 'next-page') expect(response.hasMore).toBe(false);
      else
        expect(JSON.parse(decodeURIComponent(response.nextCursor || ''))).toEqual({
          buffers: {},
          nextPages: { linuxdo: 5 },
          sourceCursors: { linuxdo: 'provider-cursor' }
        });
    }
  );

  it('keeps a ready source when another provider identity fails before transport', async () => {
    vi.mocked(getDefaultAndroidWebViewUserAgent).mockRejectedValueOnce(new Error('provider unavailable'));
    const fetcher = vi.fn(
      async (_input: string) => new Response(JSON.stringify([{ node: { name: 'tech', title: 'Tech' } }]))
    );
    const response = await getCategories({ source: 'all', includedSources: ['nodeseek', 'v2ex'], fetcher });
    expect(response.errors?.nodeseek).toBeTruthy();
    expect(response.items.some((item) => item.source === 'v2ex')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain('v2ex.com');
  });

  it('prepares missing identities independently before starting their aggregate request budgets', async () => {
    vi.useFakeTimers();
    let ready!: (value: string) => void;
    const provider = new Promise<string>((resolve) => {
      ready = resolve;
    });
    vi.mocked(getDefaultAndroidWebViewUserAgent).mockReturnValue(provider);
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.includes('nodeseek.com')) return new Response(`<script>${nodeSeekPayload}</script>`);
      if (input.includes('v2ex.com')) return new Response(JSON.stringify([{ node: { name: 'tech', title: 'Tech' } }]));
      return new Response(JSON.stringify({ category_list: { categories: [{ id: 1, name: 'Linux', slug: 'linux' }] } }));
    });
    try {
      const result = getCategories({
        source: 'all',
        includedSources: ['nodeseek', 'v2ex', 'linuxdo'],
        discourseAuth: { userAgent: 'saved-linuxdo-identity' },
        fetcher
      });
      await vi.advanceTimersByTimeAsync(6_000);
      expect(fetcher.mock.calls.some(([input]) => input.includes('v2ex.com'))).toBe(true);
      const linuxDoCall = fetcher.mock.calls.find(([input]) => input.includes('linux.do'));
      expect(new Headers(linuxDoCall?.[1]?.headers).get('User-Agent')).toBe('saved-linuxdo-identity');
      expect(fetcher.mock.calls.some(([input]) => input.includes('nodeseek.com'))).toBe(false);
      ready('native-provider-user-agent');
      const response = await result;
      expect(response.errors).toEqual({});
      const nodeSeekCall = fetcher.mock.calls.find(([input]) => input.includes('nodeseek.com'));
      expect(new Headers(nodeSeekCall?.[1]?.headers).get('User-Agent')).toBe('native-provider-user-agent');
    } finally {
      vi.mocked(getDefaultAndroidWebViewUserAgent).mockResolvedValue('native-provider-user-agent');
      vi.useRealTimers();
    }
  });

  it('routes feed and categories to public source sites, not the project server', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPayload}</script>`);
      }
      return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
        headers: { 'content-type': 'application/json' }
      });
    });

    await getFeed({ source: 'nodeseek', page: 2, category: 'tech', feedFilter: 'replyTime', fetcher });
    await getCategories({ source: 'all', fetcher });

    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/categories/tech/page-2?sortBy=postTime');
    expect(calls).not.toContain('https://www.nodeseek.com/categories/tech/page-2?sortBy=replyTime');
    expect(calls).not.toMatch(/127\.0\.0\.1:3000|10\.0\.2\.2|\/api\/feed|\/api\/categories/);
    const nodeSeekFeedCall = (fetcher.mock.calls as unknown as [string, RequestInit?][]).find(([input]) =>
      input.includes('nodeseek.com/categories/tech/page-2')
    );
    expect(browserFetchIntentFromInit(nodeSeekFeedCall?.[1])).toMatchObject({
      owner: 'feed',
      priority: 'foreground'
    });
  });

  it('keeps all-source Android feed balanced across local source adapters', async () => {
    const manyNodeSeekTopics = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 4 }, (_, index) => ({
          postId: 200 + index,
          titleText: `NodeSeek ${index}`,
          titleLink: `/post-${200 + index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
        }))
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 301,
                  title: 'linux.do topic',
                  slug: 'linux-topic',
                  created_at: '2026-05-19T00:00:00.000Z',
                  bumped_at: '2026-05-19T00:00:00.000Z',
                  posts_count: 1
                }
              ]
            },
            users: []
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/401#reply0">V2EX topic</a></span>
            <span class="topic_info"><a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp; <strong><a href="/member/neo">neo</a></strong> &nbsp;•&nbsp; <span title="2026-05-18 08:00:00 +08:00"></span></span>
          </div>
        `);
      }
      if (input.includes('/api/topics/latest.json')) {
        return new Response(
          JSON.stringify([
            {
              id: 401,
              title: 'V2EX topic',
              url: 'https://www.v2ex.com/t/401',
              created: '2026-05-18T00:00:00.000Z',
              replies: 0,
              node: { name: 'create', title: '分享创造' },
              member: { username: 'neo' }
            }
          ]),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      if (input.includes('/recent?p=1')) {
        return new Response('');
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await getFeed({ source: 'all', limit: 3, fetcher });

    expect(result.items.map((item) => item.source)).toEqual(['nodeseek', 'linuxdo', 'v2ex']);
  });

  it.each([
    ['feed', (fetcher: Fetcher, signal: AbortSignal) => getFeed({ source: 'all', limit: 5, fetcher, signal })],
    ['categories', (fetcher: Fetcher, signal: AbortSignal) => getCategories({ source: 'all', fetcher, signal })]
  ])('discards a parsed child fallback when the outer aggregate %s read is aborted', async (_entry, startRead) => {
    const controller = new AbortController();
    const nodeSeekBodyRead = Promise.withResolvers<void>();
    const recoverReadChannel = vi.fn(async () => undefined);
    const fetcher: Fetcher = async (input, init) => {
      const url = String(input);
      if (url.includes('nodeseek.com')) {
        const response = new Response(`<script>${nodeSeekPayload}</script>`);
        const readText = response.text.bind(response);
        vi.spyOn(response, 'text').mockImplementation(async () => {
          const text = await readText();
          nodeSeekBodyRead.resolve();
          return text;
        });
        registerForumReadResponseEvidence(init, response, {
          commit: recoverReadChannel,
          kind: 'fallback',
          ordinal: 1,
          source: 'nodeseek'
        });
        return response;
      }
      if (url.includes('linux.do')) {
        return new Promise<Response>(() => undefined);
      }
      throw new Error('other source unavailable');
    };
    const read = startRead(fetcher, controller.signal);
    await nodeSeekBodyRead.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();

    await expect(read).rejects.toThrow('请求已取消');
    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('routes Yaohuo reads through the shared entry points while preserving its page size and search semantics', async () => {
    const list = Array.from(
      { length: 31 },
      (_, index) =>
        `<div class="listdata"><a href="/bbs-${index + 1}.html">test ${index}${index === 0 ? ' excluded' : ''}</a>/alice/阅1/05-20 10:00</div>`
    ).join('');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('book_list.aspx')) return new Response(list);
      if (input.includes('favlist.aspx')) return new Response('');
      if (input.includes('book_re.aspx'))
        return new Response('<title>查看回复</title><div>您查看的楼层不存在。</div><a href="/bbs-1.html">返回主题</a>');
      if (input.endsWith('/bbs-1.html'))
        return new Response(
          '<div class="content">[标题] topic</div><div class="bbscontent">正文</div><div class="view-no-reply-tip"><span class="view-no-reply-text">暂无回复，快抢沙发哦</span></div>'
        );
      throw new Error(`unexpected ${input}`);
    });
    const categories = await getCategories({ source: 'yaohuo', fetcher });
    expect(categories.items[0]).toMatchObject({ source: 'yaohuo' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => getTopic({ source: 'yaohuo', id: '1', fetcher })).toThrow('妖火详情需要主题上下文');
    const feed = await getFeed({ source: 'yaohuo', fetcher });
    expect(feed.items).toHaveLength(30);
    const search = await searchTopics({
      source: 'yaohuo',
      query: 'test -excluded',
      filter: { source: 'yaohuo', category: '177' },
      fetcher
    });
    expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('key')).toBe('test');
    expect(search.items.map((item) => item.title)).toEqual(Array.from({ length: 29 }, (_, i) => `test ${i + 1}`));
    expect(search.items[0]).toMatchObject({ categoryId: '177' });
    await expect(getTopic({ source: 'yaohuo', id: '1', topic: feed.items[0], fetcher })).resolves.toMatchObject({
      id: '1',
      contentHtml: expect.stringContaining('正文')
    });
    await expect(
      getReplies({
        source: 'yaohuo',
        id: '1',
        categoryId: '177',
        order: 'oldest',
        position: { kind: 'start' },
        replyCount: 0,
        fetcher
      })
    ).resolves.toMatchObject({ items: [], hasMore: false });
    const replyUrl = new URL(fetcher.mock.calls.at(-1)![0]);
    expect(replyUrl.searchParams.get('id')).toBe('1');
    expect(replyUrl.searchParams.get('classid')).toBe('177');
  });

  it('keeps overflow items available when paginating the aggregated Android feed', async () => {
    const manyNodeSeekTopics = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 4 }, (_, index) => ({
          postId: 100 + index,
          titleText: `NodeSeek ${index + 1}`,
          titleLink: `/post-${100 + index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
        }))
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/page-2')) {
        return new Response('<script></script>');
      }
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      return new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' }
      });
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => item.id)).toEqual(['103', '102']);
    expect(second.items.map((item) => item.id)).toEqual(['101', '100']);
    expect(second.items.every((item) => item.source === 'nodeseek')).toBe(true);
  });

  it('keeps NodeSeek next pages available in the aggregated Android feed when the first source page is shorter than the aggregate fetch window', async () => {
    const pageOne = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 201,
            titleText: 'NodeSeek page 1 newer',
            titleLink: '/post-201-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:01:00.000Z' }
          },
          {
            postId: 200,
            titleText: 'NodeSeek page 1 older',
            titleLink: '/post-200-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const pageTwo = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 199,
            titleText: 'NodeSeek page 2 newer',
            titleLink: '/post-199-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:01:00.000Z' }
          },
          {
            postId: 198,
            titleText: 'NodeSeek page 2 older',
            titleLink: '/post-198-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/page-2')) {
        return new Response(`<script>${pageTwo}</script>`);
      }
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${pageOne}</script><a href="/page-2">下一页</a>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' }
      });
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => item.id)).toEqual(['201', '200']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['199', '198']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.nodeseek.com/page-2');
  });

  it('keeps V2EX next pages available in the aggregated Android feed after the all tab', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response('<script></script>');
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response(`
          <div class="cell item"><a class="topic-link" href="/t/301#reply0">V2EX all newer</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:01:00 +08:00"></span></div>
          <div class="cell item"><a class="topic-link" href="/t/300#reply0">V2EX all older</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>
          <a href="/recent">更多新主题</a>
        `);
      }
      if (input.includes('/recent?p=1')) {
        return new Response(`
          <div class="cell"><a class="topic-link" href="/t/301#reply1">V2EX latest newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:01:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/300#reply1">V2EX latest older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:00:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/299#reply1">V2EX html newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-19 00:01:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/298#reply1">V2EX html older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-19 00:00:00"></span></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => item.id)).toEqual(['301', '300']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['299', '298']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not over-fetch linux.do pages for the first aggregated Android feed page', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 30 }, (_item, index) => ({
          postId: 600 - index,
          titleText: `NodeSeek ${index}`,
          titleLink: `/post-${600 - index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-20T00:${String(59 - index).padStart(2, '0')}:00.000Z` }
        }))
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response('');
      }
      if (input.includes('linux.do/latest.json')) {
        const page = Number(new URL(input).searchParams.get('page') || '0');
        const baseId = 500 - page * 30;
        return new Response(
          JSON.stringify({
            topic_list: {
              more_topics_url: '/latest.json?page=next',
              topics: Array.from({ length: 30 }, (_item, index) => ({
                id: baseId - index,
                title: `linux.do ${page}-${index}`,
                slug: `linux-do-${page}-${index}`,
                created_at: `2026-05-20T00:${String(29 - index).padStart(2, '0')}:00.000Z`,
                posts_count: 1
              }))
            },
            categories: []
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    await getFeed({ source: 'all', limit: 30, fetcher });

    const linuxDoCalls = fetcher.mock.calls
      .map((call) => call[0])
      .filter((input) => input.includes('linux.do/latest.json'));
    expect(linuxDoCalls.length).toBeLessThanOrEqual(2);
    expect(linuxDoCalls.join('\n')).not.toContain('page=2');
  });

  it('refills an exhausted source in the aggregated Android feed even when other source buffers can fill the page', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 400,
            titleText: 'NodeSeek newest',
            titleLink: '/post-400-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:04:30.000Z' }
          },
          {
            postId: 399,
            titleText: 'NodeSeek buffered newer',
            titleLink: '/post-399-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:03:00.000Z' }
          },
          {
            postId: 398,
            titleText: 'NodeSeek buffered older',
            titleLink: '/post-398-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:01:00.000Z' }
          },
          {
            postId: 397,
            titleText: 'NodeSeek buffered oldest',
            titleLink: '/post-397-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response(`
          <div class="cell item"><a class="topic-link" href="/t/501#reply0">V2EX all newest</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:05:00 +08:00"></span></div>
          <div class="cell item"><a class="topic-link" href="/t/500#reply0">V2EX all older</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:04:00 +08:00"></span></div>
          <a href="/recent">更多新主题</a>
        `);
      }
      if (input.includes('/recent?p=1')) {
        return new Response(`
          <div class="cell"><a class="topic-link" href="/t/501#reply1">V2EX latest newest</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:05:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/500#reply1">V2EX latest older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:04:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/499#reply1">V2EX html newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:03:30"></span></div>
          <div class="cell"><a class="topic-link" href="/t/498#reply1">V2EX html older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:02:00"></span></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:501', 'nodeseek:400']);
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:500', 'nodeseek:399']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not skip V2EX recent page one in the aggregated Android feed', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 30 }, (_item, index) => ({
          postId: 900 - index,
          titleText: `NodeSeek ${index}`,
          titleLink: `/post-${900 - index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-19T00:${String(59 - index).padStart(2, '0')}:00.000Z` }
        }))
      })
    ).toString('base64');
    const item = (id: number, title: string, time: string, className = 'cell') => `
      <div class="${className}">
        <a class="topic-link" href="/t/${id}#reply0">${title}</a>
        <a class="node" href="/go/create">分享创造</a>
        <a href="/member/neo">neo</a>
        <span title="${time}"></span>
      </div>
    `;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response(
          Array.from({ length: 20 }, (_unused, index) =>
            item(
              800 - index,
              `all ${index}`,
              `2026-05-20 00:${String(59 - index).padStart(2, '0')}:00 +08:00`,
              'cell item'
            )
          ).join('') + '<a href="/recent">更多新主题</a>'
        );
      }
      if (input === 'https://www.v2ex.com/recent?p=1') {
        return new Response(
          Array.from({ length: 20 }, (_unused, index) =>
            item(700 - index, `recent p1 ${index}`, `2026-05-20 00:${String(39 - index).padStart(2, '0')}:00`)
          ).join('') + '<a href="/recent?p=2">下一页</a>'
        );
      }
      if (input === 'https://www.v2ex.com/recent?p=2') {
        return new Response(
          Array.from({ length: 20 }, (_unused, index) =>
            item(600 - index, `recent p2 ${index}`, `2026-05-19 23:${String(59 - index).padStart(2, '0')}:00`)
          ).join('')
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'all', limit: 30, fetcher });
    await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 30,
      fetcher
    });

    const calls = fetcher.mock.calls.map((call) => call[0]);
    expect(calls.indexOf('https://www.v2ex.com/recent?p=1')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('https://www.v2ex.com/recent?p=2')).toBeGreaterThan(
      calls.indexOf('https://www.v2ex.com/recent?p=1')
    );
  });

  it('retries a failed source on the next aggregated Android feed page', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 700,
            titleText: 'NodeSeek recovered',
            titleLink: '/post-700-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:03:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    let nodeSeekCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        nodeSeekCalls += 1;
        if (nodeSeekCalls === 1) {
          throw new Error('NodeSeek temporary failure');
        }
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 710,
                  title: 'linux.do topic',
                  slug: 'linux-do-topic',
                  created_at: '2026-05-20T00:02:00.000Z',
                  posts_count: 1
                }
              ]
            },
            categories: []
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response(`
          <div class="cell item"><a class="topic-link" href="/t/720#reply0">V2EX topic</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:01:00 +08:00"></span></div>
        `);
      }
      return new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' }
      });
    });

    const first = await getFeed({ source: 'all', limit: 2, fetcher });
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(JSON.stringify(first.errors?.nodeseek)).toContain('NodeSeek temporary failure');
    expect(first.nextCursor).toBeTruthy();
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toContain('nodeseek:700');
    expect(nodeSeekCalls).toBe(2);
  });

  it('ends the current aggregate plan without blocked sources and reads them on a fresh plan', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 730,
            titleText: 'NodeSeek credential recovered',
            titleLink: '/post-730-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:03:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    let nodeSeekCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        nodeSeekCalls += 1;
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 740,
                  title: 'linux.do available topic',
                  slug: 'linux-do-available-topic',
                  created_at: '2026-05-20T00:02:00.000Z',
                  posts_count: 1
                }
              ]
            },
            categories: []
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      return new Response('');
    });

    const first = await getFeed({
      source: 'all',
      limit: 2,
      includedSources: ['nodeseek', 'linuxdo'],
      unavailableSources: ['nodeseek'],
      fetcher
    });
    const second = await getFeed({
      source: 'all',
      limit: 2,
      includedSources: ['nodeseek', 'linuxdo'],
      fetcher
    });

    expect(first.items.map((item) => `${item.source}:${item.id}`)).toEqual(['linuxdo:740']);
    expect(first).toMatchObject({ errors: {}, hasMore: false, nextPage: null, nextCursor: undefined });
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toEqual(['nodeseek:730', 'linuxdo:740']);
    expect(nodeSeekCalls).toBe(1);
  });

  it('does not create an empty retry cursor when all aggregated Android feed sources fail', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('temporary failure');
    });

    const result = await getFeed({ source: 'all', limit: 2, fetcher });

    expect(result.items).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
    expect(Object.keys(result.errors || {})).toEqual(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo']);
  });

  it('preserves every source cursor when buffered content settles an otherwise failed page', async () => {
    const sourceCursor = 'opaque-v2ex-cursor';
    const cursor = encodeURIComponent(
      JSON.stringify({
        buffers: {
          v2ex: [
            {
              source: 'v2ex',
              id: 'buffered',
              title: 'Buffered topic',
              author: 'alice',
              url: 'https://www.v2ex.com/t/buffered',
              createdAt: '2026-08-06T00:00:00.000Z',
              replyCount: 0
            }
          ]
        },
        nextPages: { nodeseek: 2, linuxdo: 2, v2ex: 2, yaohuo: 2 },
        sourceCursors: { v2ex: sourceCursor }
      })
    );
    const fetcher = vi.fn(async () => {
      throw new Error('temporary failure');
    });

    const result = await getFeed({ source: 'all', page: 2, cursor, limit: 2, fetcher });
    const retryCursor = JSON.parse(decodeURIComponent(result.nextCursor || '')) as {
      nextPages: Record<string, number>;
      sourceCursors: Record<string, string>;
    };

    expect(result.items.map((item) => item.id)).toEqual(['buffered']);
    expect(retryCursor.nextPages).toEqual({ nodeseek: 2, linuxdo: 2, v2ex: 2, yaohuo: 2 });
    expect(retryCursor.sourceCursors.v2ex).toBe(sourceCursor);
  });

  it('bounds hanging feed sources without delaying completed posts and keeps the shorter catalog budget', async () => {
    vi.useFakeTimers();
    const diagnosticEvents: Record<string, unknown>[] = [];
    setDiagnosticWriter((line) => {
      diagnosticEvents.push(JSON.parse(line) as Record<string, unknown>);
    });
    const diagnosticTrace = beginDiagnosticTrace('feed', 'load', { source: 'all' });
    const hangingAborts = vi.fn();
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      if (input.includes('nodeseek.com')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              hangingAborts();
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return Promise.resolve(
          new Response(
            '<div class="cell item"><a class="topic-link" href="/t/901#reply0">V2EX ready</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>'
          )
        );
      }
      if (input.includes('/api/topics/latest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 901,
                title: 'V2EX ready',
                url: 'https://www.v2ex.com/t/901',
                created: '2026-05-20T00:00:00.000Z',
                replies: 0,
                node: { name: 'create', title: '分享创造' },
                member: { username: 'neo' }
              }
            ]),
            { headers: { 'content-type': 'application/json' } }
          )
        );
      }
      return Promise.reject(new Error(`unexpected ${input}`));
    });
    const unavailableSources = ['linuxdo', 'yaohuo'] as const;
    const feedController = new AbortController();
    const categoryController = new AbortController();
    let feedResult: Awaited<ReturnType<typeof getFeed>> | undefined;
    let categoryResult: Awaited<ReturnType<typeof getCategories>> | undefined;
    const onProgress = vi.fn();
    const feedPromise = getFeed({
      source: 'all',
      limit: 2,
      diagnosticTrace,
      fetcher,
      signal: feedController.signal,
      unavailableSources,
      onProgress
    }).then((result) => {
      feedResult = result;
    });
    const categoryPromise = getCategories({
      source: 'all',
      fetcher,
      signal: categoryController.signal,
      unavailableSources
    }).then((result) => {
      categoryResult = result;
    });

    try {
      await vi.advanceTimersByTimeAsync(4_999);
      expect(feedResult).toBeUndefined();
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ items: [expect.objectContaining({ id: '901' })] })
      );
      await vi.advanceTimersByTimeAsync(1);
      expect(categoryResult?.errors.nodeseek).toBeTruthy();
      expect(feedResult).toBeUndefined();
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      const feedAtBudget = feedResult;
      const categoriesAtBudget = categoryResult;
      if (!feedAtBudget) feedController.abort();
      if (!categoriesAtBudget) categoryController.abort();
      await Promise.allSettled([feedPromise, categoryPromise]);

      expect(feedAtBudget?.items).toEqual([expect.objectContaining({ source: 'v2ex', id: '901' })]);
      expect(feedAtBudget?.errors.nodeseek).toBeTruthy();
      expect(feedAtBudget?.nextCursor).toBeTruthy();
      expect(categoriesAtBudget?.items).toEqual([expect.objectContaining({ source: 'v2ex', id: 'create' })]);
      expect(categoriesAtBudget?.errors.nodeseek).toBeTruthy();
      expect(hangingAborts).toHaveBeenCalledTimes(2);
      const childTerminals = diagnosticEvents.filter(
        (event) => event.phase === 'transport' && typeof event.latencyMs === 'number' && event.source !== 'all'
      );
      expect(childTerminals).toHaveLength(2);
      expect(childTerminals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source: 'nodeseek', state: 'timeout', latencyMs: 15_000 }),
          expect.objectContaining({ source: 'v2ex', state: 'success' })
        ])
      );
      expect(new Set(childTerminals.map((event) => event.source)).size).toBe(2);
    } finally {
      setDiagnosticWriter(null);
      vi.useRealTimers();
    }
  });

  it('propagates parent cancellation instead of publishing a partial aggregate', async () => {
    const controller = new AbortController();
    const diagnosticEvents: Record<string, unknown>[] = [];
    setDiagnosticWriter((line) => {
      diagnosticEvents.push(JSON.parse(line) as Record<string, unknown>);
    });
    const diagnosticTrace = beginDiagnosticTrace('feed', 'load', { source: 'all' });
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return Promise.resolve(
          new Response(
            '<div class="cell item"><a class="topic-link" href="/t/901#reply0">V2EX ready</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>'
          )
        );
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true
        });
      });
    });
    const request = getFeed({
      source: 'all',
      diagnosticTrace,
      fetcher,
      signal: controller.signal,
      unavailableSources: ['linuxdo', 'yaohuo']
    });

    try {
      await vi.waitFor(() =>
        expect(diagnosticEvents).toContainEqual(
          expect.objectContaining({ phase: 'transport', source: 'v2ex', state: 'success' })
        )
      );
      controller.abort();
      await expect(request).rejects.toThrow('请求已取消');
      expect(
        diagnosticEvents.filter(
          (event) => event.phase === 'transport' && event.state === 'canceled' && event.source !== 'all'
        )
      ).toEqual([expect.objectContaining({ source: 'nodeseek', reason: 'canceled' })]);
    } finally {
      controller.abort();
      await request.catch(() => undefined);
      setDiagnosticWriter(null);
    }
  });

  it('keeps a timed-out source retryable when every completed source is empty', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((input: string, init?: RequestInit) => {
        if (input.includes('nodeseek.com')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          });
        }
        if (input.includes('/api/topics/latest.json')) {
          return Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } }));
        }
        if (input === 'https://www.v2ex.com/?tab=all') {
          return Promise.resolve(new Response('<div id="Main"></div>'));
        }
        return Promise.reject(new Error(`unexpected ${input}`));
      });
      const request = getFeed({
        source: 'all',
        fetcher,
        unavailableSources: ['linuxdo', 'yaohuo']
      });

      await vi.advanceTimersByTimeAsync(15_000);

      await expect(request).resolves.toMatchObject({
        items: [],
        errors: { nodeseek: expect.anything() },
        hasMore: true,
        nextCursor: expect.any(String)
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('preserves the current page and opaque source cursor when every source times out', async () => {
    vi.useFakeTimers();
    const sourceCursor = 'opaque-v2ex-seen-ids';
    const cursor = encodeURIComponent(
      JSON.stringify({
        nextPages: { nodeseek: 2, linuxdo: 2, v2ex: 2, yaohuo: 2 },
        sourceCursors: { v2ex: sourceCursor }
      })
    );
    try {
      const fetcher = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      );
      const request = getFeed({ source: 'all', page: 2, cursor, fetcher });

      await vi.advanceTimersByTimeAsync(15_000);
      const result = await request;
      const retryCursor = JSON.parse(decodeURIComponent(result.nextCursor || '')) as {
        nextPages: Record<string, number>;
        sourceCursors: Record<string, string>;
      };

      expect(result.hasMore).toBe(true);
      expect(retryCursor.nextPages).toEqual({ nodeseek: 2, linuxdo: 2, v2ex: 2, yaohuo: 2 });
      expect(retryCursor.sourceCursors.v2ex).toBe(sourceCursor);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('confines aggregate feed and cursor retries to the included source snapshot', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response(
          '<div class="cell item"><a class="topic-link" href="/t/401#reply0">V2EX topic</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>'
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await getFeed({ source: 'all', includedSources: ['v2ex'], fetcher });
    expect(result.items.map((item) => item.source)).toEqual(['v2ex']);
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual(['https://www.v2ex.com/?tab=all']);

    const oldCursor = encodeURIComponent(
      JSON.stringify({
        nextPages: { nodeseek: 2, v2ex: 2 },
        sourceCursors: { nodeseek: 'stale-node-cursor', v2ex: 'current-v2ex-cursor' }
      })
    );
    const retry = await getFeed({
      source: 'all',
      cursor: oldCursor,
      fetcher: vi.fn(async () => {
        throw new Error('temporary failure');
      }),
      includedSources: ['v2ex'],
      page: 2
    });
    const retryCursor = JSON.parse(decodeURIComponent(retry.nextCursor || '')) as Record<
      string,
      Record<string, unknown>
    >;

    expect(retryCursor.nextPages).toEqual({ v2ex: 2 });
    expect(retryCursor.sourceCursors).toEqual({ v2ex: 'current-v2ex-cursor' });
  });

  it('discards blocked source buffers and cursors without consuming a transport or another page', async () => {
    const fetcher = vi.fn();
    const cursor = encodeURIComponent(
      JSON.stringify({
        buffers: {
          yaohuo: [
            {
              source: 'yaohuo',
              id: '1',
              title: 'old private topic',
              url: 'https://yaohuo.me/bbs-1.html',
              createdAt: '2026-09-20T00:00:00Z'
            }
          ]
        },
        nextPages: { yaohuo: 2 },
        sourceCursors: { yaohuo: 'old-private-cursor' }
      })
    );

    await expect(
      getFeed({ source: 'all', page: 2, cursor, includedSources: ['yaohuo'], unavailableSources: ['yaohuo'], fetcher })
    ).resolves.toMatchObject({
      items: [],
      errors: {},
      hasMore: false,
      nextPage: null,
      nextCursor: undefined
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns stable empty all-source feed and categories without transport', async () => {
    const fetcher = vi.fn();

    await expect(getFeed({ source: 'all', fetcher, includedSources: [] })).resolves.toEqual({
      errors: {},
      hasMore: false,
      items: [],
      nextCursor: undefined,
      nextPage: null
    });
    await expect(getCategories({ source: 'all', fetcher, includedSources: [] })).resolves.toEqual({
      items: [],
      errors: {}
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('confines aggregate categories to the included source snapshot', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/api/topics/latest.json') {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              node: { name: 'create', title: '分享创造' }
            }
          ]),
          { headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await getCategories({ source: 'all', fetcher, includedSources: ['v2ex'] });

    expect(result.items).toEqual([{ source: 'v2ex', id: 'create', name: '分享创造' }]);
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual(['https://www.v2ex.com/api/topics/latest.json']);
  });
});
