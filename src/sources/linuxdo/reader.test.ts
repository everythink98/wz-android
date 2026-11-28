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
  getLinuxDoTopic,
  hasTrustedLinuxDoFeedReading,
  isExplicitlyUnseenLinuxDoTopic,
  linuxDoTopicRequiresReadingConfirmation
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

it('keeps the publication time unknown for a restricted topic with no source timestamp', async () => {
  const detail = await getLinuxDoTopic('123', {
    fetcher: async () => new Response(JSON.stringify({ errors: ['当前用户组不可查看该主题'] }), { status: 403 })
  });
  expect(detail.accessRequirement?.type).toBe('permission');
  expect(detail.createdAt).toBe('');
  expect(detail.lastReplyAt).toBeUndefined();
});

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
    [{ id: 7, name: 'Sub', slug: 'child', parent_category_id: 4 }, 'in:pinned =category:parent:child'],
    [{ id: 7, name: 'Missing' }, undefined]
  ] as const)('scopes pinned lookups to the known category path', async (category, expected) => {
    const queries: (string | null)[] = [];
    await getLinuxDoFeed({
      category: '7',
      limit: 1,
      linuxDoAccess: { authenticated: true, userAgent: 'fixture' },
      fetcher: async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/filter.json')) queries.push(url.searchParams.get('q'));
        return jsonResponse({
          categories: [{ id: 4, name: 'Parent', slug: 'parent' }, category],
          topic_list: { topics: [{ ...topic(1), category_id: 7 }] }
        });
      }
    });
    expect(queries).toEqual(expected ? [expected] : []);
  });

  it('reuses embedded reply bodies and reads only missing IDs with their editable raw content', async () => {
    const topic = deletedReplyTopic();
    const editable = topic.post_stream.posts.map((post) => ({
      ...post,
      user_deleted: false,
      can_edit: true,
      raw: `raw-${post.id}`
    }));
    const calls: string[] = [];
    const ids: string[][] = [];
    const fetcher: Fetcher = async (input) => {
      const url = new URL(input);
      calls.push(url.pathname);
      const rows = url.pathname.endsWith('/posts.json')
        ? editable.filter((post) => url.searchParams.getAll('post_ids[]').includes(String(post.id)))
        : editable.slice(0, 2);
      if (url.pathname.endsWith('/posts.json')) ids.push(url.searchParams.getAll('post_ids[]'));
      const posts = rows.map(({ raw, ...rest }) => ({
        ...rest,
        ...(url.searchParams.get('include_raw') === 'true' ? { raw } : {})
      }));
      return jsonResponse({ ...topic, post_stream: { stream: topic.post_stream.stream, posts } });
    };
    const options = { fetcher, linuxDoAccess: { authenticated: true, userAgent: 'fixture' } };
    const value = await getLinuxDoReplies('2835903', {
      ...options,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 2
    });
    expect(value.items.map((item) => item.contentMarkdown)).toEqual(['raw-2', 'raw-3']);
    expect(ids).toEqual([['3']]);
    expect(calls).toEqual(['/t/2835903.json', '/t/2835903/posts.json']);
    calls.length = 0;
    const detail = await getLinuxDoTopic('2835903', options);
    expect(detail.replies.map((item) => item.contentMarkdown)).toEqual(['raw-2']);
    expect(calls).toEqual(['/t/2835903.json']);
  });

  it('refetches an embedded reply whose floor is missing from the topic response', async () => {
    const topic = deletedReplyTopic();
    const fetcher: Fetcher = async (input) => {
      if (new URL(input).pathname.endsWith('/posts.json'))
        return jsonResponse({ post_stream: { posts: [deletedReply] } });
      return jsonResponse({
        ...topic,
        post_stream: { stream: [1, 2], posts: [topic.post_stream.posts[0], { ...deletedReply, post_number: null }] }
      });
    };
    const page = await getLinuxDoReplies('2835903', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 1
    });
    expect(page.items.map((reply) => reply.floor)).toEqual([2]);
  });

  it('finishes repeated unusable activity pages and keeps other valid rows', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/filter.json')) return jsonResponse({ topic_list: { topics: [] } });
      const page = Number(url.searchParams.get('page') || 0);
      if (page > 2) throw new Error('stuck on invalid pages');
      return jsonResponse({
        topic_list: { topics: page ? [{ id: 27 }] : [topic(1)], more_topics_url: '/latest?page=again' }
      });
    });
    const page = await getLinuxDoFeed({
      fetcher,
      limit: 3,
      linuxDoAccess: { authenticated: true, userAgent: 'fixture' }
    });
    expect(page.items.map((item) => item.id)).toEqual(['1']);
    expect(page.hasMore).toBe(false);
  });

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

  it('includes the latest list pins in their original scope without shifting the created-order pages', async () => {
    const pin = (id: number, category_id: number, global: boolean, unpinned = false) => ({
      ...topic(id),
      category_id,
      pinned: !unpinned,
      unpinned,
      pinned_globally: global
    });
    const regular = Array.from({ length: 30 }, (_, index) => topic(index + 1));
    const fetcher = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams;
      const category = params.get('category');
      return jsonResponse({
        categories: [
          { id: 2, name: '公告' },
          { id: 4, name: '技术' }
        ],
        topic_list: {
          topics: params.has('order')
            ? params.has('page')
              ? [topic(31), topic(32)]
              : regular
            : category
              ? [pin(72, 4, false), pin(74, 2, false)]
              : [pin(71, 2, true), pin(73, 2, true, true), pin(72, 4, false)],
          more_topics_url: params.has('page') ? null : '/latest?page=1'
        }
      });
    });
    const site = await getLinuxDoFeed({ fetcher });
    const category = await getLinuxDoFeed({ fetcher, category: '4' });
    const next = await getLinuxDoFeed({ fetcher, page: 2 });

    expect(site.items.map(({ id }) => id)).toEqual(['71', ...regular.map(({ id }) => String(id))]);
    expect(site.items[0]?.pinned).toBe(true);
    expect(category.items.map(({ id }) => id)).toEqual(['72', ...regular.map(({ id }) => String(id))]);
    expect(category.items[0]?.pinned).toBe(true);
    expect(next.items.map(({ id }) => id)).toEqual(['31', '32']);
    expect(
      fetcher.mock.calls
        .map(([url]) => new URL(url).searchParams)
        .filter((params) => !params.has('order'))
        .map((params) => params.get('category'))
    ).toEqual([null, '4']);
  });

  it('reads guest announcements even when the main latest request took longer than the pin timeout', async () => {
    let now = 100;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const fetcher = vi.fn(async (input: string) => {
        if (new URL(input).searchParams.has('order')) {
          now += 2_000;
          return jsonResponse({ topic_list: { topics: [topic(1)] } });
        }
        return jsonResponse({ topic_list: { topics: [{ ...topic(71), pinned: true, pinned_globally: true }] } });
      });
      const latest = await getLinuxDoFeed({ fetcher });
      expect(latest.items.map(({ id }) => id)).toEqual(['71', '1']);
    } finally {
      clock.mockRestore();
    }
  });

  it('starts the signed-in pin index before latest settles and normalizes it with the latest catalog', async () => {
    const latest = Promise.withResolvers<Response>();
    const paths: string[] = [];
    const fetcher: Fetcher = async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === '/latest.json') return latest.promise;
      if (path !== '/filter.json') throw new Error(`Unexpected request: ${path}`);
      return jsonResponse({
        topic_list: {
          topics: [{ ...topic(71), category_id: 2, pinned_globally: true, pinned: false, unpinned: true }]
        }
      });
    };
    const feed = getLinuxDoFeed({ fetcher, linuxDoAccess: { authenticated: true } });
    try {
      await vi.waitFor(() => expect(paths).toEqual(['/latest.json', '/filter.json']));
    } finally {
      latest.resolve(jsonResponse({ categories: [{ id: 2, name: '公告' }], topic_list: { topics: [topic(1)] } }));
      await feed;
    }
    expect((await feed).items.map(({ id, pinned, category }) => [id, pinned, category])).toEqual([
      ['71', true, '公告'],
      ['1', undefined, '未分类']
    ]);
  });

  it('uses the category supplied by the pin index when latest has no row in that category', async () => {
    const fetcher = vi.fn<Fetcher>(async (input) => {
      if (new URL(input).pathname === '/filter.json') {
        return jsonResponse({
          categories: [{ id: 8, name: '社区公告' }],
          topic_list: { topics: [{ ...topic(71), category_id: 8, pinned_globally: true, pinned: true }] }
        });
      }
      return jsonResponse({ topic_list: { topics: [topic(1)] } });
    });
    const feed = await getLinuxDoFeed({ fetcher, linuxDoAccess: { authenticated: true, userAgent: 'fixture' } });
    expect(feed.items.find((row) => row.id === '71')?.category).toBe('社区公告');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cancels a speculative pin index when the signed-in latest request fails', async () => {
    const latest = Promise.withResolvers<Response>();
    const pinStarted = Promise.withResolvers<AbortSignal>();
    const fetcher: Fetcher = async (input, init) => {
      if (new URL(String(input)).pathname === '/latest.json') return latest.promise;
      const signal = init!.signal!;
      pinStarted.resolve(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    };
    const feed = getLinuxDoFeed({ fetcher, linuxDoAccess: { authenticated: true } });
    const failed = expect(feed).rejects.toThrow('HTTP 502');
    const pinSignal = await pinStarted.promise;
    latest.resolve(new Response(null, { status: 502 }));
    await failed;
    expect(pinSignal.aborted).toBe(true);
  });

  it('shows active announcements omitted from a signed-in latest page after reading them', async () => {
    const globalPin = { ...topic(71), category_id: 2, pinned_globally: true, pinned: false, unpinned: true };
    const localPin = { ...topic(72), category_id: 4, pinned_globally: false, pinned: false, unpinned: true };
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json') {
        expect(new Headers(init?.headers).get('Discourse-Logged-In')).toBe('true');
        expect(url.searchParams.get('q')).toContain('in:pinned');
        const next = url.searchParams.has('page');
        return jsonResponse({
          topic_list: {
            topics: next ? [localPin, globalPin] : [localPin],
            more_topics_url: next ? null : '/filter?q=in%3Apinned&page=1'
          }
        });
      }
      return jsonResponse({
        categories: [
          { id: 2, name: '公告' },
          { id: 4, name: '技术', slug: 'dev' }
        ],
        topic_list: { topics: [topic(1), topic(2)] }
      });
    });
    const options = { fetcher, linuxDoAccess: { authenticated: true } };
    const site = await getLinuxDoFeed(options);
    expect(site.items.map(({ id, pinned }) => [id, Boolean(pinned)])).toEqual([
      ['71', true],
      ['1', false],
      ['2', false]
    ]);
    const category = await getLinuxDoFeed({ ...options, category: '4' });
    expect(category.items.map(({ id }) => id)).toEqual(['72', '1', '2']);
    expect(category.items[0]?.pinned).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => new URL(url).searchParams.get('q') === 'in:pinned =category:dev')).toBe(
      true
    );
  });

  it('trusts the server cursor instead of probing one extra list page', async () => {
    const fetcher = vi.fn(async (_url: string) =>
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
    expect(fetcher.mock.calls.map(([url]) => new URL(url).searchParams.has('page'))).toEqual([false, false]);
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

  it('bounds repeated single-topic feed pages and returns only the unique topic without paging forever', async () => {
    const requestedPages: (string | null)[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      requestedPages.push(url.searchParams.get('page'));
      return jsonResponse({
        topic_list: {
          topics: [topic(1)],
          more_topics_url: '/latest?order=created&page=1'
        }
      });
    });

    const result = await getLinuxDoFeed({ fetcher, limit: 30 });

    expect(requestedPages).toEqual([null, '1']);
    expect(result.items.map((item) => item.id)).toEqual(['1']);
    expect(result).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('continues past consecutive full-page replays when the upstream page number keeps advancing', async () => {
    const requestedPages: (string | null)[] = [];
    const pageRows = [topic(1), topic(2), topic(3)];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const page = url.searchParams.get('page');
      requestedPages.push(page);
      return jsonResponse({
        topic_list: {
          topics: page === '3' ? [topic(4), topic(5), topic(6)] : pageRows,
          more_topics_url: page === '3' ? null : `/latest?order=created&page=${Number(page || 0) + 1}`
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 3 });
    expect(requestedPages).toEqual([null]);
    expect(first.items.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(first).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(first.nextCursor).toBeTruthy();

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 3, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1', '2', '3']);
    expect(second.items.map((item) => item.id)).toEqual(['4', '5', '6']);
    expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('bounds consecutive invalid feed pages and preserves already fetched valid topics', async () => {
    const requestedPages: (string | null)[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const page = Number(pageParam || 0);
      if (page > 2) throw new Error('exceeded invalid page bound');
      return jsonResponse({
        topic_list: {
          topics: page === 0 ? [topic(1)] : page === 1 ? [{ id: 91 }] : [{}],
          more_topics_url: '/latest?page=next'
        }
      });
    });

    const result = await getLinuxDoFeed({ fetcher, limit: 3 });

    expect(requestedPages).toEqual([null, '1', '2']);
    expect(result.items.map((item) => item.id)).toEqual(['1']);
    expect(result).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('paginates short pages with reused more_topics_url without duplicates or lost overflow items', async () => {
    const requestedPages: (string | null)[] = [];
    const pages = new Map<number, ReturnType<typeof topic>[]>([
      [0, [topic(1), topic(2)]],
      [1, [topic(3), topic(4)]],
      [2, [topic(5), topic(6)]]
    ]);
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const page = Number(pageParam || 0);
      return jsonResponse({
        topic_list: {
          topics: pages.get(page) ?? [],
          more_topics_url: page < 2 ? '/latest?page=next' : null
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 3 });
    expect(requestedPages).toEqual([null, '1']);
    expect(first.items.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(first).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(first.nextCursor).toBeTruthy();

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 3, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1', '2']);
    expect(second.items.map((item) => item.id)).toEqual(['4', '5', '6']);
    expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('stops cleanly when the final non-empty page points to its own position', async () => {
    const requestedPages: (string | null)[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const page = Number(pageParam || 0);
      return jsonResponse({
        topic_list: {
          topics: page === 0 ? [topic(1), topic(2)] : [topic(3)],
          more_topics_url: '/latest?order=created&page=1'
        }
      });
    });

    const result = await getLinuxDoFeed({ fetcher, limit: 5 });

    expect(requestedPages).toEqual([null, '1']);
    expect(result.items.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(result).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it.each([undefined, '2'] as const)(
    'reads a legacy plain page-number entry (%s) and transitions to the structured cursor',
    async (legacyCursor) => {
      const requestedPages: (string | null)[] = [];
      const fetcher = vi.fn(async (input: string) => {
        const url = new URL(input);
        const pageParam = url.searchParams.get('page');
        requestedPages.push(pageParam);
        const page = Number(pageParam || 0);
        return jsonResponse({
          topic_list: {
            topics:
              page === 1
                ? Array.from({ length: 30 }, (_, index) => topic(31 + index))
                : page === 2
                  ? [topic(61), topic(62)]
                  : [],
            more_topics_url: page === 1 ? '/latest?order=created&page=2' : null
          }
        });
      });

      const first = await getLinuxDoFeed({ fetcher, page: 2, cursor: legacyCursor, limit: 30 });
      expect(requestedPages).toEqual(['1']);
      expect(first.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(31 + index)));
      expect(first).toMatchObject({ hasMore: true, nextPage: 3 });
      expect(first.nextCursor).toBeTruthy();
      expect(first.nextCursor).not.toBe('2');

      requestedPages.length = 0;
      const second = await getLinuxDoFeed({ fetcher, page: first.nextPage!, cursor: first.nextCursor, limit: 30 });
      expect(requestedPages).toEqual(['2']);
      expect(second.items.map((item) => item.id)).toEqual(['61', '62']);
      expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
    }
  );

  it('marks explicitly unseen feed topics only for authenticated reads without last_read_post_number or private messages', async () => {
    const rows = [
      { ...topic(1), unseen: true, highest_post_number: 3 },
      { ...topic(2), unseen: false, highest_post_number: 3 },
      { ...topic(3), unseen: 'true', highest_post_number: 3 },
      { ...topic(4), unseen: true, last_read_post_number: 2, highest_post_number: 3 },
      { ...topic(5), unseen: true, archetype: 'private_message', highest_post_number: 3 }
    ];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json' || !url.searchParams.has('order')) {
        return jsonResponse({ topic_list: { topics: [] } });
      }
      return jsonResponse({ topic_list: { topics: rows } });
    });

    const authenticated = await getLinuxDoFeed({
      fetcher,
      limit: 10,
      linuxDoAccess: { authenticated: true, userAgent: 'fixture' }
    });
    expect(authenticated.items.map((item) => [item.id, isExplicitlyUnseenLinuxDoTopic(item)])).toEqual([
      ['1', true],
      ['2', false],
      ['3', false],
      ['4', false],
      ['5', false]
    ]);

    const anonymous = await getLinuxDoFeed({ fetcher, limit: 10 });
    expect(anonymous.items.every((item) => !isExplicitlyUnseenLinuxDoTopic(item))).toBe(true);
  });

  it('does not mark unseen feed topics as backfill-exempt when reading floor is malformed, highest floor is missing, or unread flags conflict', async () => {
    const rows = [
      { ...topic(1), unseen: true, highest_post_number: 17 },
      { ...topic(2), unseen: true, last_read_post_number: '7', highest_post_number: 17 },
      { ...topic(3), unseen: true, last_read_post_number: -1, highest_post_number: 17 },
      { ...topic(4), unseen: true },
      { ...topic(5), unseen: true, highest_post_number: 0 },
      { ...topic(6), unseen: true, highest_post_number: '17' },
      { ...topic(7), unseen: true, highest_post_number: 17, unread_posts: 2 },
      { ...topic(8), unseen: true, highest_post_number: 17, unread: true }
    ];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json' || !url.searchParams.has('order')) {
        return jsonResponse({ topic_list: { topics: [] } });
      }
      return jsonResponse({ topic_list: { topics: rows } });
    });

    const authenticated = await getLinuxDoFeed({
      fetcher,
      limit: 10,
      linuxDoAccess: { authenticated: true, userAgent: 'fixture' }
    });
    expect(authenticated.items.map((item) => [item.id, isExplicitlyUnseenLinuxDoTopic(item)])).toEqual([
      ['1', true],
      ['2', false],
      ['3', false],
      ['4', false],
      ['5', false],
      ['6', false],
      ['7', false],
      ['8', false]
    ]);
  });

  it('reaches regular topics on page 3 after two upstream pages filled with 60 pre-registered pinned announcements', async () => {
    const pinRow = (id: number) => ({
      ...topic(id),
      category_id: 2,
      pinned: true,
      pinned_globally: true
    });
    const pinnedFirst30 = Array.from({ length: 30 }, (_, index) => pinRow(index + 1));
    const pinnedSecond30 = Array.from({ length: 30 }, (_, index) => pinRow(index + 31));
    const page0Regular = Array.from({ length: 30 }, (_, index) => topic(101 + index));
    const page3Regular = Array.from({ length: 5 }, (_, index) => topic(131 + index));
    const requestedPages: (string | null)[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json') {
        const filterPage = Number(url.searchParams.get('page') || 0);
        return jsonResponse({
          categories: [{ id: 2, name: '公告', slug: 'announcements' }],
          topic_list: {
            topics: filterPage === 0 ? pinnedFirst30 : pinnedSecond30,
            more_topics_url: filterPage === 0 ? '/filter?q=in%3Apinned&page=1' : null
          }
        });
      }
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      const topics =
        upstreamPage === 0
          ? pinnedFirst30
          : upstreamPage === 1
            ? pinnedSecond30
            : upstreamPage === 2
              ? page0Regular
              : upstreamPage === 3
                ? page3Regular
                : [];
      return jsonResponse({
        categories: [{ id: 2, name: '公告', slug: 'announcements' }],
        topic_list: {
          topics,
          more_topics_url: upstreamPage < 3 ? `/latest?order=created&page=${upstreamPage + 1}` : null
        }
      });
    });

    const access = { authenticated: true, userAgent: 'fixture' };
    const first = await getLinuxDoFeed({ fetcher, limit: 30, linuxDoAccess: access });
    expect(requestedPages).toEqual([null, '1', '2']);
    expect(first.items).toHaveLength(90);
    expect(first).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(first.nextCursor).toBeTruthy();

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({
      fetcher,
      limit: 30,
      page: first.nextPage!,
      cursor: first.nextCursor,
      linuxDoAccess: access
    });
    expect(requestedPages).toEqual(['3']);
    expect(second.items.map((item) => item.id)).toEqual(['131', '132', '133', '134', '135']);
    expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('propagates newly pinned state and newly added trust-level requirements when a seen topic reappears on a later page', async () => {
    const requestedPages: (string | null)[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      if (upstreamPage === 0) {
        return jsonResponse({
          topic_list: {
            topics: [topic(1), topic(2)],
            more_topics_url: '/latest?order=created&page=1'
          }
        });
      }
      if (upstreamPage === 1) {
        return jsonResponse({
          topic_list: {
            topics: [
              { ...topic(1), pinned: true, pinned_globally: true },
              { ...topic(2), required_trust_level: 3 },
              topic(3),
              topic(4)
            ],
            more_topics_url: '/latest?order=created&page=2'
          }
        });
      }
      return jsonResponse({
        topic_list: {
          topics: [
            { ...topic(1), pinned: true, pinned_globally: true },
            { ...topic(2), required_trust_level: 3 }
          ],
          more_topics_url: '/latest?order=created&page=1'
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['1', '2']);
    expect(first.hasMore).toBe(true);

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 2, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1']);
    expect(second.items.map((item) => item.id)).toEqual(['3', '4']);
    expect(second.topicUpdates?.map((item) => item.id)).toEqual(['1', '2']);
    expect(second.topicUpdates?.find((item) => item.id === '1')?.pinned).toBe(true);
    expect(second.topicUpdates?.find((item) => item.id === '2')?.accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv3'
    });

    requestedPages.length = 0;
    const third = await getLinuxDoFeed({ fetcher, limit: 2, page: second.nextPage!, cursor: second.nextCursor });
    expect(requestedPages).toEqual(['2']);
    expect(third.items).toEqual([]);
    expect(third).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('delivers previously unseen topics that shift ahead of the cursor anchor without duplicating consumed items', async () => {
    const page0 = Array.from({ length: 20 }, (_, index) => topic(index + 1));
    const initialPage1 = Array.from({ length: 30 }, (_, index) => topic(index + 21));
    const shiftedPage1 = [
      ...Array.from({ length: 10 }, (_, index) => topic(index + 21)),
      topic(32),
      topic(31),
      ...Array.from({ length: 18 }, (_, index) => topic(index + 33))
    ];
    let page1Reads = 0;
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const upstreamPage = Number(url.searchParams.get('page') || 0);
      if (upstreamPage === 0) {
        return jsonResponse({
          topic_list: { topics: page0, more_topics_url: '/latest?order=created&page=1' }
        });
      }
      page1Reads += 1;
      return jsonResponse({
        topic_list: { topics: page1Reads === 1 ? initialPage1 : shiftedPage1, more_topics_url: null }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 30 });
    expect(first.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 1)));
    expect(first).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(first.nextCursor).toBeTruthy();

    const second = await getLinuxDoFeed({ fetcher, limit: 30, page: first.nextPage!, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual([
      '32',
      '31',
      ...Array.from({ length: 18 }, (_, index) => String(index + 33))
    ]);
    const combined = [...first.items, ...second.items].map((item) => item.id);
    expect(combined).toHaveLength(50);
    expect(new Set(combined).size).toBe(50);
    expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('delivers an unseen topic shifted to the top of a single re-read page ahead of already consumed items', async () => {
    const initialPage0 = Array.from({ length: 50 }, (_, index) => topic(index + 1));
    const shiftedPage0 = [
      topic(32),
      ...Array.from({ length: 30 }, (_, index) => topic(index + 1)),
      topic(31),
      ...Array.from({ length: 18 }, (_, index) => topic(index + 33))
    ];
    let page0Reads = 0;
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      page0Reads += 1;
      return jsonResponse({
        topic_list: { topics: page0Reads === 1 ? initialPage0 : shiftedPage0, more_topics_url: null }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 30 });
    expect(first.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 1)));
    expect(first).toMatchObject({ hasMore: true, nextPage: 2 });

    const second = await getLinuxDoFeed({ fetcher, limit: 30, page: first.nextPage!, cursor: first.nextCursor });
    expect(second.items.map((item) => item.id)).toEqual([
      '32',
      '31',
      ...Array.from({ length: 18 }, (_, index) => String(index + 33))
    ]);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(50);
    expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('continues past consecutive distinct already-seen overlap pages to deliver later unseen topics', async () => {
    const requestedPages: (string | null)[] = [];
    const pages = new Map<number, ReturnType<typeof topic>[]>([
      [0, [topic(1), topic(2), topic(3)]],
      [1, [topic(4), topic(5), topic(6)]],
      [2, [topic(1), topic(2), topic(3)]],
      [3, [topic(4), topic(5), topic(6)]],
      [4, [topic(7), topic(8), topic(9)]]
    ]);
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      return jsonResponse({
        topic_list: {
          topics: pages.get(upstreamPage) ?? [],
          more_topics_url: upstreamPage < 4 ? `/latest?order=created&page=${upstreamPage + 1}` : null
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 6 });
    expect(requestedPages).toEqual([null, '1']);
    expect(first.items.map((item) => item.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(first).toMatchObject({ hasMore: true, nextPage: 2 });

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 6, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['2', '3', '4']);
    expect(second.items.map((item) => item.id)).toEqual(['7', '8', '9']);
    expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('returns a manually continuable cursor under a finite scan bound when upstream keeps returning distinct already-seen subsets', async () => {
    const requestedPages: (string | null)[] = [];
    const page0 = Array.from({ length: 20 }, (_, index) => topic(index + 1));
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      if (upstreamPage > 10) throw new Error('exceeded distinct seen-overlap scan bound');
      if (upstreamPage === 0) {
        return jsonResponse({
          topic_list: { topics: page0, more_topics_url: '/latest?order=created&page=1' }
        });
      }
      const start = (upstreamPage - 1) * 2 + 1;
      return jsonResponse({
        topic_list: {
          topics: [topic(start), topic(start + 1)],
          more_topics_url: `/latest?order=created&page=${upstreamPage + 1}`
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 20 });
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 20, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(second.items).toEqual([]);
    expect(second).toMatchObject({ hasMore: true, nextPage: 3 });
    expect(second.nextCursor).toBeTruthy();
  });

  it('continues past reordered already-seen overlap subsets without falsely terminating before unseen topics', async () => {
    const requestedPages: (string | null)[] = [];
    const pages = new Map<number, ReturnType<typeof topic>[]>([
      [0, [topic(1), topic(2), topic(3), topic(4)]],
      [1, [topic(1), topic(2)]],
      [2, [topic(3), topic(4)]],
      [3, [topic(2), topic(1)]],
      [4, [topic(5), topic(6)]]
    ]);
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      return jsonResponse({
        topic_list: {
          topics: pages.get(upstreamPage) ?? [],
          more_topics_url: upstreamPage < 4 ? `/latest?order=created&page=${upstreamPage + 1}` : null
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 4 });
    expect(first.items.map((item) => item.id)).toEqual(['1', '2', '3', '4']);

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 4, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1', '2', '3', '4']);
    expect(second.items.map((item) => item.id)).toEqual(['5', '6']);
    expect(second).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('merges pinned state, access requirements, and valid-over-missing reading while sending conflicting duplicate reading to confirmation', async () => {
    const rows = [
      { ...topic(10), unseen: true, highest_post_number: 5 },
      { ...topic(11), unseen: true, highest_post_number: 4 },
      {
        ...topic(12),
        pinned: true,
        pinned_globally: true,
        required_trust_level: 3,
        last_read_post_number: 9,
        highest_post_number: 10
      },
      { ...topic(13), unseen: true, highest_post_number: 6 },
      { ...topic(14), highest_post_number: 5 },
      {
        ...topic(10),
        pinned: true,
        pinned_globally: true,
        required_trust_level: 3,
        last_read_post_number: 7,
        highest_post_number: 12
      },
      { ...topic(11), unseen: false, highest_post_number: 4 },
      { ...topic(12), unseen: true, highest_post_number: 14 },
      { ...topic(13), unseen: true, highest_post_number: 6 },
      { ...topic(14), last_read_post_number: 7, highest_post_number: 11 }
    ];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json' || !url.searchParams.has('order')) {
        return jsonResponse({ topic_list: { topics: [] } });
      }
      return jsonResponse({ topic_list: { topics: rows } });
    });

    const result = await getLinuxDoFeed({
      fetcher,
      limit: 10,
      linuxDoAccess: { authenticated: true, userAgent: 'fixture' }
    });

    expect(result.items.map((item) => item.id)).toEqual(['10', '11', '12', '13', '14']);
    const [t10, t11, t12, t13, t14] = result.items;
    expect(t10).toMatchObject({
      id: '10',
      pinned: true,
      accessRequirement: { type: 'level', label: '需等级', detail: 'Lv3' },
      reading: { topicId: '10', highestPostNumber: 12, readPostNumbers: [] }
    });
    expect(t10?.reading?.lastReadPostNumber).toBeUndefined();
    expect(isExplicitlyUnseenLinuxDoTopic(t10)).toBe(false);
    expect(linuxDoTopicRequiresReadingConfirmation(t10)).toBe(true);
    expect(isExplicitlyUnseenLinuxDoTopic(t11)).toBe(false);
    expect(linuxDoTopicRequiresReadingConfirmation(t11)).toBe(true);
    expect(t12).toMatchObject({
      id: '12',
      pinned: true,
      accessRequirement: { type: 'level', label: '需等级', detail: 'Lv3' },
      reading: { topicId: '12', highestPostNumber: 14, readPostNumbers: [] }
    });
    expect(t12?.reading?.lastReadPostNumber).toBeUndefined();
    expect(isExplicitlyUnseenLinuxDoTopic(t12)).toBe(false);
    expect(linuxDoTopicRequiresReadingConfirmation(t12)).toBe(true);
    expect(isExplicitlyUnseenLinuxDoTopic(t13)).toBe(true);
    expect(linuxDoTopicRequiresReadingConfirmation(t13)).toBe(false);
    expect(t14?.reading).toEqual({
      topicId: '14',
      lastReadPostNumber: 7,
      highestPostNumber: 11,
      readPostNumbers: []
    });
    expect(linuxDoTopicRequiresReadingConfirmation(t14)).toBe(false);
  });

  it('delivers 90 unique topics across 1-30 -> 31-60 -> 1-30 -> 16-30 -> 61-90 without losing page 4', async () => {
    const requestedPages: (string | null)[] = [];
    const pages = new Map<number, ReturnType<typeof topic>[]>([
      [0, Array.from({ length: 30 }, (_, index) => topic(index + 1))],
      [1, Array.from({ length: 30 }, (_, index) => topic(index + 31))],
      [2, Array.from({ length: 30 }, (_, index) => topic(index + 1))],
      [3, Array.from({ length: 15 }, (_, index) => topic(index + 16))],
      [4, Array.from({ length: 30 }, (_, index) => topic(index + 61))]
    ]);
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      return jsonResponse({
        topic_list: {
          topics: pages.get(upstreamPage) ?? [],
          more_topics_url: upstreamPage < 4 ? `/latest?order=created&page=${upstreamPage + 1}` : null
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 30 });
    expect(requestedPages).toEqual([null]);
    expect(first.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 1)));
    expect(first).toMatchObject({ hasMore: true, nextPage: 2 });

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 30, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1']);
    expect(second.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 31)));
    expect(second).toMatchObject({ hasMore: true, nextPage: 3 });

    requestedPages.length = 0;
    const third = await getLinuxDoFeed({ fetcher, limit: 30, page: second.nextPage!, cursor: second.nextCursor });
    expect(requestedPages).toEqual(['2', '3', '4']);
    expect(third.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 61)));
    expect(third).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });

    const allIds = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(allIds).toHaveLength(90);
    expect(new Set(allIds).size).toBe(90);
  });

  it.each(['advancing-url', 'wrapping-url'] as const)(
    'preserves all 240 unique topics on an 8-page loop (%s) and stops automatic serial reads',
    async (mode) => {
      const requestedPages: (string | null)[] = [];
      const pages = Array.from({ length: 8 }, (_, pageIndex) =>
        Array.from({ length: 30 }, (_, offset) => topic(pageIndex * 30 + offset + 1))
      );
      const fetcher = vi.fn(async (input: string) => {
        const url = new URL(input);
        if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
        const pageParam = url.searchParams.get('page');
        requestedPages.push(pageParam);
        const upstreamPage = Number(pageParam || 0);
        if (upstreamPage > 13) throw new Error('infinite 8-page loop');
        const nextUrl =
          mode === 'wrapping-url' && upstreamPage === 7
            ? '/latest?order=created&page=0'
            : `/latest?order=created&page=${upstreamPage + 1}`;
        return jsonResponse({
          topic_list: {
            topics: upstreamPage < 8 ? pages[upstreamPage]! : [...pages[upstreamPage % 8]!].reverse(),
            more_topics_url: nextUrl
          }
        });
      });

      const collected: string[] = [];
      let page = 1;
      let cursor: string | null | undefined = undefined;
      let hasMore = true;
      let manualContinuation = false;
      let calls = 0;
      while (hasMore && !manualContinuation && calls < 12) {
        calls += 1;
        const result = await getLinuxDoFeed({ fetcher, limit: 30, page, cursor });
        collected.push(...result.items.map((item) => item.id));
        hasMore = Boolean(result.hasMore);
        manualContinuation = result.manualContinuation === true;
        page = result.nextPage ?? page + 1;
        cursor = result.nextCursor;
      }

      expect(collected).toHaveLength(240);
      expect(new Set(collected).size).toBe(240);
      if (mode === 'wrapping-url') {
        expect(hasMore).toBe(false);
        expect(cursor).toBeNull();
        expect(requestedPages).toEqual([null, '1', '2', '3', '4', '5', '6', '7']);
      } else {
        expect(hasMore).toBe(true);
        expect(manualContinuation).toBe(true);
        expect(cursor).toBeTruthy();
        expect(requestedPages).toEqual([null, ...Array.from({ length: 13 }, (_, index) => String(index + 1))]);
      }
    }
  );

  it('returns a manually continuable cursor when the overlap scan budget is exhausted on strictly advancing pages', async () => {
    const requestedPages: (string | null)[] = [];
    const page0 = Array.from({ length: 30 }, (_, index) => topic(index + 1));
    const page7 = Array.from({ length: 30 }, (_, index) => topic(index + 31));
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      if (upstreamPage === 0) {
        return jsonResponse({ topic_list: { topics: page0, more_topics_url: '/latest?order=created&page=1' } });
      }
      if (upstreamPage >= 1 && upstreamPage <= 6) {
        const start = (upstreamPage - 1) * 5 + 1;
        return jsonResponse({
          topic_list: {
            topics: Array.from({ length: 5 }, (_, index) => topic(start + index)),
            more_topics_url: `/latest?order=created&page=${upstreamPage + 1}`
          }
        });
      }
      return jsonResponse({
        topic_list: {
          topics: upstreamPage === 7 ? page7 : [],
          more_topics_url: null
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 30 });
    expect(requestedPages).toEqual([null]);
    expect(first.items).toHaveLength(30);

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 30, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(second.items).toEqual([]);
    expect(second).toMatchObject({ hasMore: true, manualContinuation: true, nextPage: 3 });
    expect(second.nextCursor).toBeTruthy();
    expect(second.nextCursor).not.toBe(first.nextCursor);

    requestedPages.length = 0;
    const third = await getLinuxDoFeed({ fetcher, limit: 30, page: second.nextPage!, cursor: second.nextCursor });
    expect(requestedPages).toEqual(['7']);
    expect(third.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 31)));
    expect(third).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
  });

  it('rejects cross-site, malformed, wrong-path, and non-advancing more_topics_url continuations', async () => {
    for (const badUrl of [
      'https://evil.example/latest?order=created&page=1',
      '//evil.example/latest?order=created&page=1',
      'javascript:alert(1)',
      '/t/123?page=1',
      '/latest?order=created&page=0',
      '/latest?order=created'
    ]) {
      const fetcher = vi.fn(async (input: string) => {
        const url = new URL(input);
        if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
        return jsonResponse({
          topic_list: {
            topics: [topic(1), topic(2)],
            more_topics_url: badUrl
          }
        });
      });

      const result = await getLinuxDoFeed({ fetcher, limit: 2 });
      expect(result.items.map((item) => item.id)).toEqual(['1', '2']);
      expect(result).toMatchObject({ hasMore: false, nextPage: null, nextCursor: null });
    }
  });

  it('restarts bound cursors from page 0 on account switch, session change, or filter mismatch while keeping legacy JSON cursors continuable', async () => {
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json' || (url.pathname === '/latest.json' && !url.searchParams.has('order'))) {
        return jsonResponse({ topic_list: { topics: [] } });
      }
      requestedUrls.push(`${url.pathname}${url.search}`);
      const upstreamPage = Number(url.searchParams.get('page') || 0);
      return jsonResponse({
        topic_list: {
          topics: [topic(upstreamPage * 10 + 1), topic(upstreamPage * 10 + 2)],
          more_topics_url: upstreamPage < 2 ? `${url.pathname.replace('.json', '')}?page=${upstreamPage + 1}` : null
        }
      });
    });

    const aliceAccess = {
      authenticated: true,
      identityKey: 'linuxdo:alice',
      sessionEpoch: 1,
      categoryCacheScope: 'authenticated:1',
      readingScope: 'authenticated:1:linuxdo:alice:alice',
      userAgent: 'fixture'
    };
    const first = await getLinuxDoFeed({ fetcher, limit: 2, linuxDoAccess: aliceAccess });
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();

    requestedUrls.length = 0;
    const afterAccountSwitch = await getLinuxDoFeed({
      fetcher,
      limit: 2,
      page: 2,
      cursor: first.nextCursor,
      linuxDoAccess: { ...aliceAccess, identityKey: 'linuxdo:bob', readingScope: 'authenticated:1:linuxdo:bob:bob' }
    });
    expect(requestedUrls).toEqual(['/latest.json?order=created&ascending=false']);
    expect(afterAccountSwitch.items.map((item) => item.id)).toEqual(['1', '2']);

    requestedUrls.length = 0;
    const afterSessionChange = await getLinuxDoFeed({
      fetcher,
      limit: 2,
      page: 2,
      cursor: first.nextCursor,
      linuxDoAccess: { ...aliceAccess, sessionEpoch: 2, categoryCacheScope: 'authenticated:2' }
    });
    expect(requestedUrls).toEqual(['/latest.json?order=created&ascending=false']);
    expect(afterSessionChange.items.map((item) => item.id)).toEqual(['1', '2']);

    requestedUrls.length = 0;
    const afterFilterChange = await getLinuxDoFeed({
      fetcher,
      limit: 2,
      page: 2,
      cursor: first.nextCursor,
      linuxDoFilter: 'hot',
      linuxDoAccess: aliceAccess
    });
    expect(requestedUrls).toEqual(['/hot.json']);
    expect(afterFilterChange.items.map((item) => item.id)).toEqual(['1', '2']);

    requestedUrls.length = 0;
    const afterCategoryChange = await getLinuxDoFeed({
      fetcher,
      limit: 2,
      page: 2,
      cursor: first.nextCursor,
      category: '4',
      linuxDoAccess: aliceAccess
    });
    expect(requestedUrls).toEqual(['/latest.json?order=created&ascending=false&category=4']);
    expect(afterCategoryChange.items.map((item) => item.id)).toEqual(['1', '2']);

    requestedUrls.length = 0;
    const legacyJsonCursor = encodeURIComponent(
      JSON.stringify({ page: 2, offset: 1, firstId: '12', seenIds: ['1', '2', '11'] })
    );
    const fromLegacyJson = await getLinuxDoFeed({
      fetcher,
      limit: 2,
      page: 2,
      cursor: legacyJsonCursor,
      linuxDoAccess: aliceAccess
    });
    expect(requestedUrls).toEqual([
      '/latest.json?order=created&ascending=false&page=1',
      '/latest.json?order=created&ascending=false&page=2'
    ]);
    expect(fromLegacyJson.items.map((item) => item.id)).toEqual(['12', '21']);
  });

  it('reports seen-topic metadata updates via topicUpdates without consuming the 30-topic quota or issuing extra paging requests', async () => {
    const requestedPages: (string | null)[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      if (upstreamPage === 0) {
        return jsonResponse({
          topic_list: {
            topics: Array.from({ length: 30 }, (_, index) => topic(index + 1)),
            more_topics_url: '/latest?order=created&page=1'
          }
        });
      }
      return jsonResponse({
        topic_list: {
          topics: [
            { ...topic(1), pinned: true, pinned_globally: true },
            { ...topic(2), required_trust_level: 3 },
            ...Array.from({ length: 30 }, (_, index) => topic(index + 31))
          ],
          more_topics_url: '/latest?order=created&page=2'
        }
      });
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 30 });
    expect(requestedPages).toEqual([null]);
    expect(first.items).toHaveLength(30);

    requestedPages.length = 0;
    const second = await getLinuxDoFeed({ fetcher, limit: 30, page: first.nextPage!, cursor: first.nextCursor });
    expect(requestedPages).toEqual(['1']);
    expect(second.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 31)));
    const updates = (second as { topicUpdates?: { id: string; pinned?: boolean; accessRequirement?: unknown }[] })
      .topicUpdates;
    expect(updates?.map((item) => item.id)).toEqual(['1', '2']);
    expect(updates?.find((item) => item.id === '1')?.pinned).toBe(true);
    expect(updates?.find((item) => item.id === '2')?.accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv3'
    });
  });

  it('aborts cleanly during multi-page overlap scanning without issuing further requests', async () => {
    const controller = new AbortController();
    const requestedPages: (string | null)[] = [];
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (!url.searchParams.has('order')) return jsonResponse({ topic_list: { topics: [] } });
      const pageParam = url.searchParams.get('page');
      requestedPages.push(pageParam);
      const upstreamPage = Number(pageParam || 0);
      if (upstreamPage === 0) {
        return jsonResponse({
          topic_list: { topics: [topic(1), topic(2)], more_topics_url: '/latest?order=created&page=1' }
        });
      }
      if (upstreamPage === 1) {
        controller.abort();
        return jsonResponse({
          topic_list: { topics: [topic(1)], more_topics_url: '/latest?order=created&page=2' }
        });
      }
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      throw new Error('should not fetch page 2 after abort');
    });

    const first = await getLinuxDoFeed({ fetcher, limit: 2 });
    requestedPages.length = 0;
    await expect(
      getLinuxDoFeed({ fetcher, limit: 2, page: first.nextPage!, cursor: first.nextCursor, signal: controller.signal })
    ).rejects.toThrow('请求已取消');
    expect(requestedPages).toEqual(['1']);
  });

  it('omits readingById from encoded cursors and preserves 7->2, 7->0, 7->null, and missing reading updates in observation order', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json' || !url.searchParams.has('order')) {
        return jsonResponse({ topic_list: { topics: [] } });
      }
      const upstreamPage = Number(url.searchParams.get('page') || 0);
      if (upstreamPage === 0) {
        return jsonResponse({
          topic_list: {
            topics: [
              { ...topic(1), last_read_post_number: 7, highest_post_number: 12 },
              { ...topic(2), last_read_post_number: 7, highest_post_number: 12 },
              { ...topic(3), last_read_post_number: 7, highest_post_number: 12 },
              { ...topic(4), last_read_post_number: 7, highest_post_number: 12 }
            ],
            more_topics_url: '/latest?order=created&page=1'
          }
        });
      }
      return jsonResponse({
        topic_list: {
          topics: [
            { ...topic(1), last_read_post_number: 2, highest_post_number: 12 },
            { ...topic(2), last_read_post_number: 0, highest_post_number: 12 },
            { ...topic(3), last_read_post_number: null, highest_post_number: 12 },
            { ...topic(4), highest_post_number: 15 },
            { ...topic(5), unseen: true, highest_post_number: 6 }
          ],
          more_topics_url: null
        }
      });
    });

    const access = { authenticated: true, identityKey: 'linuxdo:alice', sessionEpoch: 1, userAgent: 'fixture' };
    const first = await getLinuxDoFeed({ fetcher, limit: 4, linuxDoAccess: access });
    expect(first.nextCursor).toBeTruthy();
    const decodedCursor = JSON.parse(decodeURIComponent(first.nextCursor!)) as Record<string, unknown>;
    expect(decodedCursor).not.toHaveProperty('readingById');

    const second = await getLinuxDoFeed({
      fetcher,
      limit: 4,
      page: first.nextPage!,
      cursor: first.nextCursor,
      linuxDoAccess: access
    });
    expect(second.items.map((item) => item.id)).toEqual(['5']);
    const updates = (second as { topicUpdates?: { id: string; reading?: Record<string, unknown> }[] }).topicUpdates;
    expect(updates?.find((item) => item.id === '1')?.reading?.lastReadPostNumber).toBe(2);
    expect(updates?.find((item) => item.id === '2')?.reading?.lastReadPostNumber).toBe(0);
    expect(updates?.find((item) => item.id === '3')?.reading?.lastReadPostNumber).toBeNull();
    expect(updates?.find((item) => item.id === '4')?.reading).toEqual({
      topicId: '4',
      highestPostNumber: 15,
      readPostNumbers: []
    });
  });

  it('keeps the later pin index reading when a pinned topic also appears on the first latest page', async () => {
    const pinned = { ...topic(1), pinned: true, pinned_globally: true, highest_post_number: 12, unseen: false };
    const fetcher = vi.fn(async (input: string) => {
      const pinIndex = new URL(input).pathname === '/filter.json';
      return jsonResponse({
        topic_list: {
          topics: [{ ...pinned, last_read_post_number: pinIndex ? 2 : 7 }]
        }
      });
    });
    const result = await getLinuxDoFeed({
      fetcher,
      limit: 2,
      linuxDoAccess: { authenticated: true, readingScope: 'fixture-reading', userAgent: 'fixture' }
    });

    expect(result.items.map((item) => item.id)).toEqual(['1']);
    expect(result.items[0]?.reading?.lastReadPostNumber).toBe(2);
    expect(hasTrustedLinuxDoFeedReading(result.items[0], 'fixture-reading')).toBe(true);
  });

  it('invalidates an earlier reading when the later feed window supplies the same floor with conflicting evidence', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json') return jsonResponse({ topic_list: { topics: [] } });
      const first = !url.searchParams.has('page');
      return jsonResponse({
        topic_list: {
          topics: [{ ...topic(1), unseen: !first, last_read_post_number: 7, highest_post_number: 12 }],
          more_topics_url: first ? '/latest?order=created&page=1' : null
        }
      });
    });
    const result = await getLinuxDoFeed({
      fetcher,
      limit: 2,
      linuxDoAccess: { authenticated: true, readingScope: 'fixture-reading', userAgent: 'fixture' }
    });
    expect(result.items.map((item) => item.id)).toEqual(['1']);
    expect(hasTrustedLinuxDoFeedReading(result.items[0], 'fixture-reading')).toBe(false);
  });

  it('prefers valid reading fields over missing fields and flags conflicting same-response duplicate rows for backfill confirmation', async () => {
    const rows = [
      { ...topic(10), highest_post_number: 5 },
      { ...topic(10), last_read_post_number: 7, highest_post_number: 12 },
      { ...topic(11), last_read_post_number: 7, highest_post_number: 10 },
      { ...topic(11), last_read_post_number: 2, highest_post_number: 10 },
      { ...topic(12), last_read_post_number: 7, highest_post_number: 10 },
      { ...topic(12), last_read_post_number: 0, highest_post_number: 10 },
      { ...topic(13), last_read_post_number: 7, highest_post_number: 10 },
      { ...topic(13), last_read_post_number: null, highest_post_number: 10 },
      { ...topic(14), unseen: true, highest_post_number: 5 },
      { ...topic(14), last_read_post_number: 7, highest_post_number: 12 },
      { ...topic(15), unseen: true, highest_post_number: 6 },
      { ...topic(15), unseen: true, highest_post_number: 6 }
    ];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/filter.json' || !url.searchParams.has('order')) {
        return jsonResponse({ topic_list: { topics: [] } });
      }
      return jsonResponse({ topic_list: { topics: rows } });
    });

    const result = await getLinuxDoFeed({
      fetcher,
      limit: 10,
      linuxDoAccess: { authenticated: true, userAgent: 'fixture' }
    });

    expect(result.items.map((item) => item.id)).toEqual(['10', '11', '12', '13', '14', '15']);
    expect(result.items[0]?.reading).toMatchObject({ lastReadPostNumber: 7, highestPostNumber: 12 });
    expect(result.items[1]?.reading?.lastReadPostNumber).toBeUndefined();
    expect(result.items[2]?.reading?.lastReadPostNumber).toBeUndefined();
    expect(result.items[3]?.reading?.lastReadPostNumber).toBeUndefined();
    expect(result.items[4]?.reading?.lastReadPostNumber).toBeUndefined();
    expect(isExplicitlyUnseenLinuxDoTopic(result.items[4])).toBe(false);
    expect(isExplicitlyUnseenLinuxDoTopic(result.items[5])).toBe(true);
  });

  it('keeps the created-order feed usable when the optional pin read fails', async () => {
    const fetcher = vi.fn(async (url: string) =>
      new URL(url).searchParams.has('order')
        ? jsonResponse({ topic_list: { topics: [topic(1)] } })
        : new Response(null, { status: 503 })
    );

    await expect(getLinuxDoFeed({ fetcher })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: '1' })],
      errors: {},
      hasMore: false
    });
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

  it.each(['', 'null'])('retries an emoji response with a missing catalog document (%j)', async (body) => {
    vi.resetModules();
    const { getLinuxDoEmojiUrls } = await import('./reader');
    const fetcher = vi
      .fn<Fetcher>()
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockResolvedValue(jsonResponse({ standard: [{ name: 'heart', url: '/heart.png' }] }));
    await expect(getLinuxDoEmojiUrls({ fetcher })).rejects.toThrow('格式不正确');
    await expect(getLinuxDoEmojiUrls({ fetcher })).resolves.toEqual({ heart: 'https://linux.do/heart.png' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
