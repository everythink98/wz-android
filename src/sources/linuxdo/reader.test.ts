import { jsonResponse } from '../../../tests/helpers/jsonResponse';
import { describe, expect, it, vi } from 'vitest';

import { sanitizeLinuxDoContentHtml } from './parser';
import { requirePreparedForumContent } from '@/domain/forum/topicContentSplit';
import { RequestTimeoutError, type Fetcher } from '@/platform/network/request';
import { createLinuxDoWebViewFallbackFetcher } from './browserFallback';
import {
  categoryMapForTopics,
  getLinuxDoCategories,
  getLinuxDoFeed,
  getLinuxDoReplies,
  getLinuxDoReply,
  getLinuxDoTopic
} from './reader';

function topic(index: number) {
  return {
    id: index,
    slug: `topic-${index}`,
    title: `Topic ${index}`,
    created_at: '2026-08-15T00:00:00.000Z',
    posts_count: 1
  };
}

const deletedReply = {
  id: 2,
  username: 'wmuj',
  cooked: '<p>（帖子已被作者删除）</p>',
  created_at: '2026-08-31T00:01:00.000Z',
  post_number: 2,
  user_deleted: true,
  deleted_at: null
};

function deletedReplyTopic() {
  return {
    id: 2835903,
    title: '作者删除回复占位',
    slug: 'deleted-reply-placeholder',
    created_at: '2026-08-31T00:00:00.000Z',
    bumped_at: '2026-08-31T00:02:00.000Z',
    posts_count: 3,
    categories: [],
    post_stream: {
      stream: [1, 2, 3],
      posts: [
        {
          id: 1,
          username: 'alice',
          cooked: '<p>主楼</p>',
          created_at: '2026-08-31T00:00:00.000Z',
          post_number: 1
        },
        deletedReply,
        {
          id: 3,
          username: 'bob',
          cooked: '<p>后续回复</p>',
          created_at: '2026-08-31T00:02:00.000Z',
          post_number: 3
        }
      ]
    }
  };
}

function deletedReplyFetcher() {
  return vi.fn(async (input: string) =>
    jsonResponse(
      new URL(input).pathname.endsWith('/posts.json')
        ? { post_stream: { posts: [deletedReply, deletedReplyTopic().post_stream.posts[2]] } }
        : deletedReplyTopic()
    )
  );
}

describe('linux.do reader', () => {
  it.each([
    ['opening', false],
    ['reply', false],
    ['opening', true]
  ] as const)(
    'prepares a deeply nested %s while retaining code, media, and surrounding text (deleted: %s)',
    async (role, userDeleted) => {
      const cooked =
        '<p>before</p><pre><code>' +
        '<span>'.repeat(2048) +
        '&lt;safe&gt;\ncode' +
        '</span>'.repeat(2048) +
        '</code></pre><img src="/proof.png"><p>after</p>';
      const post = {
        id: role === 'opening' ? 1 : 2,
        username: 'alice',
        cooked,
        created_at: '2026-10-10T00:00:00.000Z',
        post_number: role === 'opening' ? 1 : 2,
        user_deleted: userDeleted,
        deleted_at: null
      };
      const posts = role === 'opening' ? [post] : [{ ...post, id: 1, post_number: 1, cooked: '<p>opening</p>' }, post];
      const fetcher = vi.fn(async () =>
        jsonResponse({
          id: 1,
          title: 'Synthetic depth',
          slug: 'synthetic',
          created_at: post.created_at,
          posts_count: posts.length,
          categories: [],
          post_stream: { stream: posts.map((entry) => entry.id), posts }
        })
      );

      const detail = await getLinuxDoTopic('1', { fetcher });
      const prepared = role === 'opening' ? detail : detail.replies[0];
      expect(prepared).toBeDefined();
      if (!prepared) throw new Error('Expected the deeply nested post to remain readable');
      const plan = requirePreparedForumContent(prepared.preparedContent, prepared.contentHtml, {
        role,
        source: 'linuxdo',
        topicId: '1'
      });

      expect(plan.rows.filter((row) => row.type === 'codeBlock').map((row) => row.text)).toEqual(['<safe>\ncode']);
      expect(plan.previewImages.map((image) => image.source)).toEqual(['https://linux.do/proof.png']);
      expect(prepared.contentHtml).toMatch(/before[\s\S]*&lt;safe&gt;[\s\S]*code[\s\S]*after/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps the declaration while removing site-injected policy controls and user statistics', () => {
    const html = sanitizeLinuxDoContentHtml(
      '<p>原始公告</p><div class="policy"><div class="policy-body"><p>请确认已知晓</p></div><div class="policy-footer"><button>已阅读</button><span>私密用户列表</span></div><span class="policy-preview">PREVIEW</span></div><p>后续说明</p>',
      undefined
    );
    expect(html).toContain('请确认已知晓');
    expect(html).toContain('原始公告');
    expect(html).toContain('后续说明');
    expect(html).not.toMatch(/已阅读|私密用户列表|PREVIEW/);
  });
  it('keeps policy state on the opening, replies and an exact notification post read', async () => {
    const data = deletedReplyTopic();
    const policyFields = {
      cooked: '<div class="policy" data-accept="已阅读" data-revoke="取消确认">我已知晓此更新内容</div>',
      policy_accepted: false,
      policy_revoked: false,
      policy_can_accept: true,
      policy_can_revoke: false
    };
    data.post_stream.posts = data.post_stream.posts.map((post) => ({ ...post, ...policyFields }));
    const fetcher = vi.fn(async () => jsonResponse(data));
    const detail = await getLinuxDoTopic('2835903', { fetcher });
    expect(detail.policy).toMatchObject({ postId: '1', canAccept: true, accepted: false });
    expect(detail.replies[0]?.policy).toMatchObject({ postId: '2', canAccept: true, accepted: false });
    await expect(getLinuxDoReply('2835903', 2, { fetcher })).resolves.toMatchObject({
      policy: { postId: '2', accepted: false }
    });
  });

  it('locates a quoted post by its floor when the stream has a deleted gap', async () => {
    const posts = Array.from({ length: 30 }, (_, index) => ({
      ...deletedReply,
      id: 1001 + index,
      post_number: index + 1,
      cooked: `<p>floor ${index + 1}</p>`,
      user_deleted: false
    })).filter((post) => post.post_number !== 5);
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      const selected =
        url.pathname === '/t/42/25.json'
          ? posts.filter((post) => post.post_number >= 24 && post.post_number <= 26)
          : url.pathname.endsWith('/posts.json')
            ? posts.filter((post) => url.searchParams.getAll('post_ids[]').includes(String(post.id)))
            : posts.slice(0, 20);
      return jsonResponse({ id: 42, post_stream: { stream: posts.map((post) => post.id), posts: selected } });
    });
    await expect(getLinuxDoReply('42', 25, { fetcher })).resolves.toMatchObject({ commentId: 1025, floor: 25 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe('/t/42/25.json');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Discourse-Track-View')).toBe(false);
  });

  it('registers only an explicit topic entry and retains server reading evidence', async () => {
    const data = {
      ...deletedReplyTopic(),
      highest_post_number: 3,
      last_read_post_number: 2,
      unread_posts: 0
    };
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(data));
    const detail = await getLinuxDoTopic('2835903', { fetcher, trackVisit: true, trackView: true });
    const [url, init] = fetcher.mock.calls[0];
    expect(new URL(url).searchParams.get('track_visit')).toBe('true');
    expect(new Headers(init?.headers).get('Discourse-Track-View')).toBe('1');
    expect(new Headers(init?.headers).get('Discourse-Track-View-Topic-Id')).toBe('2835903');
    expect(detail).toMatchObject({ reading: { lastReadPostNumber: 2, highestPostNumber: 3, unreadPosts: 0 } });
    fetcher.mockClear();
    await getLinuxDoReplies('2835903', {
      fetcher,
      order: 'oldest',
      position: { kind: 'target', target: { floor: 3 } }
    });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('Discourse-Track-View')).toBe(false);
    fetcher.mockImplementation(async () => jsonResponse({ ...data, archetype: 'private_message' }));
    const privateTopic = await getLinuxDoTopic('2835903', { fetcher });
    expect(privateTopic.isPrivateMessage).toBe(true);
    expect(privateTopic.reading).toBeUndefined();
  });

  it('keeps an author-deleted reply in initial, stream, target, and direct reads', async () => {
    const fetcher = deletedReplyFetcher();

    const topic = await getLinuxDoTopic('2835903', { fetcher, replyLimit: 2 });
    const stream = await getLinuxDoReplies('2835903', {
      fetcher,
      limit: 2,
      order: 'oldest',
      position: { kind: 'start' }
    });
    const target = await getLinuxDoReplies('2835903', {
      fetcher,
      limit: 2,
      order: 'oldest',
      position: { kind: 'target', target: { floor: 2 } }
    });
    const direct = await getLinuxDoReply('2835903', 2, { fetcher });

    for (const reply of [topic.replies[0], stream.items[0], target.items[0], direct]) {
      expect(reply).toMatchObject({
        author: 'wmuj',
        commentId: 2,
        floor: 2,
        contentHtml: expect.stringContaining('帖子已被作者删除')
      });
    }
    expect(topic.replyCompleteness).toBe('complete');
    expect(stream).toMatchObject({ completeness: 'complete', currentOffset: 0, totalCount: 2 });
  });

  it('returns an empty partial window when every author-deleted reply normalizes away', async () => {
    const emptyDeletedReply = { ...deletedReply, cooked: '' };
    const fetcher = vi.fn(async (input: string) =>
      jsonResponse(
        new URL(input).pathname.endsWith('/posts.json')
          ? { post_stream: { posts: [emptyDeletedReply] } }
          : {
              id: 2835903,
              post_stream: { stream: [1, 2], posts: [] },
              posts_count: 2
            }
      )
    );

    await expect(
      getLinuxDoReplies('2835903', {
        fetcher,
        limit: 10,
        order: 'oldest',
        position: { kind: 'start' }
      })
    ).resolves.toMatchObject({ completeness: 'partial', items: [], totalCount: 1 });
  });

  it('keeps an author-deleted opening and its reply renderable', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: 2780439,
        title: '发个红包，爱你们各位佬',
        slug: 'prepared-topic',
        created_at: '2026-08-15T00:00:00.000Z',
        bumped_at: '2026-08-15T00:01:00.000Z',
        posts_count: 2,
        categories: [],
        post_stream: {
          stream: [1, 2],
          posts: [
            {
              id: 1,
              username: 'alice',
              cooked: '<p>（话题已被作者删除）</p>',
              created_at: '2026-08-15T00:00:00.000Z',
              post_number: 1,
              user_deleted: true,
              deleted_at: null
            },
            {
              id: 2,
              username: 'bob',
              cooked: '<p>回复</p>',
              created_at: '2026-08-15T00:01:00.000Z',
              post_number: 2
            }
          ]
        }
      })
    );

    const topic = await getLinuxDoTopic('2780439', { fetcher });
    const reply = topic.replies[0];

    expect(topic).toMatchObject({
      id: '2780439',
      title: '发个红包，爱你们各位佬',
      contentHtml: expect.stringContaining('话题已被作者删除')
    });
    expect(
      requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
        role: 'opening',
        source: 'linuxdo',
        topicId: topic.id
      }).rows
    ).not.toHaveLength(0);
    expect(
      requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
        role: 'reply',
        source: 'linuxdo'
      }).rows
    ).not.toHaveLength(0);
  });
  it('rejects an author-deleted opening without renderable content', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: 2780439,
        title: '发个红包，爱你们各位佬',
        slug: 'deleted-topic',
        created_at: '2026-08-15T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1],
          posts: [
            {
              id: 1,
              username: 'alice',
              cooked: '',
              created_at: '2026-08-15T00:00:00.000Z',
              post_number: 1,
              user_deleted: true,
              deleted_at: null
            }
          ]
        }
      })
    );
    await expect(getLinuxDoTopic('2780439', { fetcher })).rejects.toThrow('linux.do 主题正文解析失败');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('prepares a media-only author-deleted opening', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        id: 2780439,
        title: '发个红包，爱你们各位佬',
        slug: 'deleted-topic',
        created_at: '2026-08-15T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1],
          posts: [
            {
              id: 1,
              username: 'alice',
              cooked: '<img src="https://cdn.example/deleted.webp">',
              created_at: '2026-08-15T00:00:00.000Z',
              post_number: 1,
              user_deleted: true,
              deleted_at: null
            }
          ]
        }
      })
    );

    const topic = await getLinuxDoTopic('2780439', { fetcher });
    const plan = requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
      role: 'opening',
      source: 'linuxdo',
      topicId: topic.id
    });

    expect(plan.previewImages).toEqual([expect.objectContaining({ source: 'https://cdn.example/deleted.webp' })]);
    expect(plan.rows.some((row) => row.networkMediaCount > 0)).toBe(true);
  });

  it('trusts the server cursor instead of probing one extra list page', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        topic_list: {
          topics: Array.from({ length: 30 }, (_, index) => topic(index + 1)),
          more_topics_url: '/latest?order=created&page=1'
        }
      })
    );

    const result = await getLinuxDoFeed({ fetcher, limit: 30 });

    expect(result.items).toHaveLength(30);
    expect(result).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('continues a nonempty malformed feed page and retains overflow from the final upstream window', async () => {
    const fetcher = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page') || '0');
      return jsonResponse({
        topic_list: {
          topics: page === 0 ? [{}] : page === 1 ? [topic(1)] : [topic(2), topic(3)],
          more_topics_url: page < 2 ? '/latest?page=next' : null
        }
      });
    });
    const result = await getLinuxDoFeed({ fetcher, limit: 2 });
    expect(result.items.map(({ id }) => id)).toEqual(['1', '2']);
    expect(result).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(fetcher.mock.calls.map(([url]) => new URL(url).searchParams.get('page'))).toEqual([null, '1', '2']);
  });

  it('stops an empty raw feed window even when the server advertises more topics', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ topic_list: { topics: [], more_topics_url: '/latest?page=next' } })
    );
    await expect(getLinuxDoFeed({ fetcher, limit: 2 })).resolves.toMatchObject({
      items: [],
      hasMore: false,
      nextPage: null
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('shares one category request across catalog and feed in the same read scope', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.includes('/site.json')
        ? jsonResponse({ category_list: { categories: [{ id: 5, name: 'Performance', slug: 'performance' }] } })
        : jsonResponse({
            topic_list: {
              topics: [{ ...topic(1), category_id: 5 }]
            }
          })
    );

    const [categories, feed] = await Promise.all([
      getLinuxDoCategories({ linuxDoAccess: { categoryCacheScope: 'public:omit' }, fetcher }),
      getLinuxDoFeed({ linuxDoAccess: { categoryCacheScope: 'public:omit' }, fetcher, limit: 1 })
    ]);
    const cachedCategories = await getLinuxDoCategories({
      linuxDoAccess: { categoryCacheScope: 'public:omit' },
      fetcher
    });

    expect(categories.items).toEqual([expect.objectContaining({ id: '5', name: 'Performance' })]);
    expect(cachedCategories.items).toEqual(categories.items);
    expect(feed.items).toEqual([expect.objectContaining({ category: 'Performance' })]);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/site.json'))).toHaveLength(1);
  });

  it('replaces category metadata when the read scope changes', async () => {
    let siteRequest = 0;
    const fetcher = vi.fn(async () => {
      siteRequest += 1;
      return jsonResponse({
        category_list: {
          categories: [{ id: 5, name: siteRequest === 1 ? 'Account A' : 'Account B', slug: 'private' }]
        }
      });
    });

    const accountA = await getLinuxDoCategories({ linuxDoAccess: { categoryCacheScope: 'authenticated:1' }, fetcher });
    const accountB = await getLinuxDoCategories({ linuxDoAccess: { categoryCacheScope: 'authenticated:2' }, fetcher });

    expect(accountA.items[0]?.name).toBe('Account A');
    expect(accountB.items[0]?.name).toBe('Account B');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('linux.do catalog ownership', () => {
  const catalog = (name: string) => ({ categories: [{ id: 5, name, slug: 'catalog' }] });

  it.each(['direct', 'fallback'] as const)(
    'bounds shared category enrichment to five seconds across %s transport while another reader remains active',
    async (transport) => {
      vi.useFakeTimers();
      const siteResponse = Promise.withResolvers<Response>();
      const browserResponse = Promise.withResolvers<Response>();
      const transportAborts = vi.fn();
      const waitForResponse = (response: Promise<Response>, signal?: AbortSignal | null) =>
        new Promise<Response>((resolve, reject) => {
          response.then(resolve, reject);
          signal?.addEventListener(
            'abort',
            () => {
              transportAborts();
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      const native = vi.fn<Fetcher>((input, init) =>
        new URL(input).pathname === '/site.json'
          ? waitForResponse(siteResponse.promise, init?.signal)
          : Promise.resolve(jsonResponse({ topic_list: { topics: [{ ...topic(1), category_id: 5 }] } }))
      );
      const browser = vi.fn<Fetcher>((_input, init) => waitForResponse(browserResponse.promise, init?.signal));
      const fetcher = createLinuxDoWebViewFallbackFetcher({ defaultFetcher: native, webViewFetcher: browser });
      const first = new AbortController();
      const options = { fetcher, linuxDoAccess: { categoryCacheScope: `shared-budget:${transport}` } };
      const categories = getLinuxDoCategories({ ...options, signal: first.signal });
      const canceledCategory = expect(categories).rejects.toThrow('请求已取消');
      const survivingCategories = getLinuxDoCategories(options);
      const timedOutCategory = expect(survivingCategories).rejects.toBeInstanceOf(RequestTimeoutError);
      let feedResult: Awaited<ReturnType<typeof getLinuxDoFeed>> | undefined;
      const feed = getLinuxDoFeed({ ...options, limit: 1 }).then((result) => {
        feedResult = result;
        return result;
      });
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(native.mock.calls.filter(([input]) => new URL(input).pathname === '/site.json')).toHaveLength(1);
        first.abort();
        await canceledCategory;
        expect(transportAborts).not.toHaveBeenCalled();
        expect(feedResult).toBeUndefined();

        await vi.advanceTimersByTimeAsync(4_000);
        if (transport === 'fallback') {
          siteResponse.resolve(
            new Response('<html>Checking your browser</html>', {
              status: 403,
              headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }
            })
          );
          await vi.advanceTimersByTimeAsync(0);
          expect(browser).toHaveBeenCalledTimes(1);
        }
        await vi.advanceTimersByTimeAsync(999);
        expect(transportAborts).not.toHaveBeenCalled();
        expect(feedResult).toBeUndefined();

        await vi.advanceTimersByTimeAsync(1);
        expect(transportAborts).toHaveBeenCalledTimes(1);
        await timedOutCategory;
        await expect(feed).resolves.toMatchObject({ items: [{ id: '1', title: 'Topic 1' }], errors: {} });
        expect(browser).toHaveBeenCalledTimes(transport === 'fallback' ? 1 : 0);
      } finally {
        siteResponse.resolve(jsonResponse(catalog('cleanup')));
        browserResponse.resolve(jsonResponse(catalog('cleanup')));
        await Promise.allSettled([categories, survivingCategories, timedOutCategory, feed]);
        vi.useRealTimers();
      }
    }
  );

  it.each([null, false])('does not retain a falsy catalog document (%s) as a successful cache entry', async (data) => {
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(jsonResponse(data))
      .mockResolvedValue(jsonResponse(catalog('retry')));
    const options = { fetcher, linuxDoAccess: { categoryCacheScope: `falsy-document:${data}` } };
    await getLinuxDoCategories(options).catch(() => undefined);
    expect((await getLinuxDoCategories(options)).items[0]?.name).toBe('retry');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)(
    'keeps the newer A request when the old A request %s after a scope round trip',
    async (outcome) => {
      const pending = Array.from({ length: 3 }, () => Promise.withResolvers<Response>());
      let request = 0;
      const fetcher = vi.fn<Fetcher>(() => pending[request++]!.promise);
      const read = (scope: string) => getLinuxDoCategories({ fetcher, linuxDoAccess: { categoryCacheScope: scope } });
      const scopeA = `round-trip:${outcome}:A`;
      const oldA = read(scopeA).catch((error: unknown) => error);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      const oldB = read(`round-trip:${outcome}:B`);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      const currentA = read(scopeA);
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
      const anotherA = read(` ${scopeA} `);
      try {
        if (outcome === 'resolve') pending[0]!.resolve(jsonResponse(catalog('old A')));
        else pending[0]!.reject(new Error('old A failed'));
        await oldA;
        pending[1]!.resolve(jsonResponse(catalog('old B')));
        await oldB;
        const lastA = read(scopeA);
        pending[2]!.resolve(jsonResponse(catalog('current A')));
        const results = await Promise.all([currentA, anotherA, lastA]);
        expect(results.map((result) => result.items[0]?.name)).toEqual(['current A', 'current A', 'current A']);
        expect((await read(scopeA)).items[0]?.name).toBe('current A');
        expect(fetcher).toHaveBeenCalledTimes(3);
      } finally {
        for (const request of pending) request.resolve(jsonResponse(catalog('cleanup')));
        await Promise.allSettled([oldA, oldB, currentA, anotherA]);
      }
    }
  );

  it('lets one category waiter cancel without aborting the shared request or the remaining waiter', async () => {
    const pending = Promise.withResolvers<Response>();
    const fetcher = vi.fn<Fetcher>(async () => pending.promise);
    const first = new AbortController();
    const options = { fetcher, linuxDoAccess: { categoryCacheScope: 'waiter-cancel' } };
    const canceled = getLinuxDoCategories({ ...options, signal: first.signal });
    const rejected = expect(canceled).rejects.toThrow('请求已取消');
    const survivor = getLinuxDoCategories({ ...options, signal: new AbortController().signal });
    try {
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      first.abort();
      await rejected;
      expect(fetcher.mock.calls[0]![1]?.signal?.aborted).toBe(false);
      pending.resolve(jsonResponse(catalog('survived')));
      expect((await survivor).items[0]?.name).toBe('survived');
      expect((await getLinuxDoCategories(options)).items[0]?.name).toBe('survived');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      pending.resolve(jsonResponse(catalog('cleanup')));
      await Promise.allSettled([canceled, survivor]);
    }
  });

  it('releases a failed shared category request so a later call can retry and cache its success', async () => {
    const pending = Promise.withResolvers<Response>();
    const failure = new Error('catalog unavailable');
    const fetcher = vi
      .fn<Fetcher>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(jsonResponse(catalog('retry')));
    const options = { fetcher, linuxDoAccess: { categoryCacheScope: 'failed-shared' } };
    const first = getLinuxDoCategories(options);
    const second = getLinuxDoCategories(options);
    const rejected = Promise.all([expect(first).rejects.toBe(failure), expect(second).rejects.toBe(failure)]);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    pending.reject(failure);
    await rejected;
    await expect(getLinuxDoCategories(options)).resolves.toMatchObject({ items: [{ name: 'retry' }] });
    await expect(getLinuxDoCategories(options)).resolves.toMatchObject({ items: [{ name: 'retry' }] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a scoped catalog for null or whitespace scopes', async () => {
    let request = 0;
    const fetcher = vi.fn<Fetcher>().mockImplementation(async () => jsonResponse(catalog(`request ${++request}`)));
    await getLinuxDoCategories({ fetcher, linuxDoAccess: { categoryCacheScope: 'private-catalog' } });
    expect((await getLinuxDoCategories({ fetcher })).items[0]?.name).toBe('request 2');
    expect((await getLinuxDoCategories({ fetcher, linuxDoAccess: { categoryCacheScope: '  ' } })).items[0]?.name).toBe(
      'request 3'
    );
    expect(
      (await getLinuxDoCategories({ fetcher, linuxDoAccess: { categoryCacheScope: 'private-catalog' } })).items[0]?.name
    ).toBe('request 4');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('keeps inline category metadata ahead of caller metadata and a ready cached catalog', async () => {
    const fetcher = vi.fn<Fetcher>(async () => jsonResponse(catalog('cached')));
    const options = { fetcher, linuxDoAccess: { categoryCacheScope: 'map-precedence' } };
    await getLinuxDoCategories(options);
    const supplied = new Map([['5', { name: 'supplied' }]]);
    expect((await categoryMapForTopics({}, [{ category_id: 5 }], supplied, options)).get('5')?.name).toBe('supplied');
    expect(
      (await categoryMapForTopics(catalog('inline'), [{ category_id: 5 }], supplied, options)).get('5')?.name
    ).toBe('inline');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('linux.do successful emoji cache', () => {
  it('keeps concurrent initial emoji reads separate and retains another read success after a late failure', async () => {
    vi.resetModules();
    const { getLinuxDoEmojiUrls } = await import('./reader');
    const pending = Promise.withResolvers<Response>();
    const failure = new Error('old emoji request failed');
    const fetcher = vi
      .fn<Fetcher>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(jsonResponse({}));
    const first = getLinuxDoEmojiUrls({ fetcher });
    const rejected = expect(first).rejects.toBe(failure);
    try {
      const second = await getLinuxDoEmojiUrls({ fetcher });
      expect(fetcher).toHaveBeenCalledTimes(2);
      pending.reject(failure);
      await rejected;
      expect(await getLinuxDoEmojiUrls({ fetcher })).toBe(second);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      pending.reject(failure);
      await Promise.allSettled([first]);
    }
  });

  it('retries a failed emoji request and then reuses the exact successful map', async () => {
    vi.resetModules();
    const { getLinuxDoEmojiUrls } = await import('./reader');
    const failure = new Error('emoji unavailable');
    const fetcher = vi
      .fn<Fetcher>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(jsonResponse({ standard: [{ name: 'heart', url: '/heart.png' }] }));
    await expect(getLinuxDoEmojiUrls({ fetcher })).rejects.toBe(failure);
    const result = await getLinuxDoEmojiUrls({ fetcher });
    expect(result).toEqual({ heart: 'https://linux.do/heart.png' });
    await expect(getLinuxDoEmojiUrls({ fetcher })).resolves.toBe(result);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caches an empty successful emoji map without treating it as a failed request', async () => {
    vi.resetModules();
    const { getLinuxDoEmojiUrls } = await import('./reader');
    const fetcher = vi.fn<Fetcher>(async () => jsonResponse({}));
    const result = await getLinuxDoEmojiUrls({ fetcher });
    expect(result).toEqual({});
    expect(await getLinuxDoEmojiUrls({ fetcher })).toBe(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
