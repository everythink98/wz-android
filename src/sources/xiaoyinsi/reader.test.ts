import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getXiaoyinsiCategories,
  getXiaoyinsiEmojiUrls,
  getXiaoyinsiFeed,
  getXiaoyinsiReplies,
  getXiaoyinsiReply,
  getXiaoyinsiTopic,
  resetXiaoyinsiCategoryCacheForTests
} from './reader';
import { getXiaoyinsiCurrentUserProfile, getXiaoyinsiLevelProfile, getXiaoyinsiUserProfile } from './account';
import { searchXiaoyinsi, searchXiaoyinsiTags, searchXiaoyinsiUsers } from './search';
import { splitDiscourseContentHtml } from '@/sources/discourse/content';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const topic = {
  id: 42,
  slug: 'temple-topic',
  title: '小隐寺主题',
  created_at: '2026-07-01T00:00:00.000Z',
  bumped_at: '2026-07-01T01:00:00.000Z',
  posts_count: 3,
  views: 88,
  category_id: 5,
  has_accepted_answer: true,
  accepted_answers: [{ post_number: 2 }],
  slow_mode_seconds: 120,
  posters: [{ user_id: 7, description: 'Original Poster' }]
};

const posts = [
  {
    id: 100,
    post_number: 1,
    username: 'alice',
    avatar_template: '/user_avatar/forum.xiaoyinsi.com/alice/{size}/1_2.png',
    cooked: '<p>正文</p><div class="poll" data-poll-name="choice"></div>',
    created_at: '2026-07-01T00:00:00.000Z',
    like_count: 2,
    reactions: [{ id: 'heart', count: 2 }],
    bookmark_id: 9,
    actions_summary: [{ id: 2, acted: true, can_act: true }],
    polls_votes: { choice: ['a'] },
    polls: [
      {
        id: 1,
        name: 'choice',
        type: 'regular',
        status: 'open',
        voters: 3,
        options: [
          { id: 'a', html: '甲', votes: 2 },
          { id: 'b', html: '乙', votes: 1 }
        ]
      }
    ]
  },
  {
    id: 101,
    post_number: 2,
    username: 'bob',
    cooked:
      '<aside class="quote" data-topic="420" data-post="1" data-display-name="Alice Display"><blockquote>正文</blockquote></aside><p>回复</p>',
    raw: '回复',
    created_at: '2026-07-01T00:30:00.000Z',
    can_edit: true,
    can_delete: true,
    accepted_answer: true,
    hidden: true,
    post_folding_status: { status: 'folded' },
    post_type: 2,
    action_code: 'closed.enabled',
    reactions: [{ id: '+1', count: 3 }],
    actions_summary: [{ id: 2, acted: false, can_act: true }]
  },
  {
    id: 102,
    post_number: 3,
    username: 'carol',
    cooked: '<p>后续回复</p>',
    created_at: '2026-07-01T01:00:00.000Z'
  }
];

function postsForRequest(url: URL) {
  const includeRaw = url.searchParams.get('include_raw') === '1';
  return posts.map((post) => {
    const { raw: fixtureRaw, ...withoutRaw } = post as typeof post & { raw?: string };
    return includeRaw ? { ...withoutRaw, raw: fixtureRaw || `原始内容 ${post.id}` } : withoutRaw;
  });
}

describe('xiaoyinsi adapter', () => {
  beforeEach(() => resetXiaoyinsiCategoryCacheForTests());

  it('drops feed topics when the original author identity is missing', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/latest.json') {
        return json({
          users: [],
          topic_list: {
            topics: [{ ...topic, posters: [], last_poster_username: 'last-replier' }]
          }
        });
      }
      return json({ categories: [{ id: 5, name: '生活' }] });
    });

    await expect(getXiaoyinsiFeed({ fetcher })).resolves.toMatchObject({ items: [] });
  });

  it('loads and absolutizes the site-owned Discourse emoji catalog', async () => {
    const fetcher = vi.fn(async (_input: string) =>
      json({
        'smileys_&_emotion': [{ name: 'heart', url: '/images/emoji/twitter/heart.png?v=15' }],
        'people_&_body': [{ name: '+1', url: '/images/emoji/twitter/+1.png?v=15' }]
      })
    );

    await expect(getXiaoyinsiEmojiUrls({ fetcher })).resolves.toEqual({
      heart: 'https://forum.xiaoyinsi.com/images/emoji/twitter/heart.png?v=15',
      '+1': 'https://forum.xiaoyinsi.com/images/emoji/twitter/+1.png?v=15'
    });
    expect(new URL(fetcher.mock.calls[0]?.[0] || '').pathname).toBe('/emojis.json');
  });

  it('[REG-XIAOYINSI-023] keeps feed, search, topic, replies, user and account reads alive with malformed avatars', async () => {
    const malformedAvatar = 'http://';
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/latest.json' || url.pathname === '/hot.json') {
        return json({
          users: [{ id: 7, username: 'alice', trust_level: 2, avatar_template: malformedAvatar }],
          topic_list: { topics: [topic], more_topics_url: '/latest?page=1' }
        });
      }
      if (url.pathname === '/site.json') {
        return json({
          categories: [
            { id: 1, name: '未分类', slug: '', topic_count: 0 },
            { id: 5, name: '生活', slug: 'life', topic_count: 12 }
          ]
        });
      }
      if (url.pathname === '/t/42.json') {
        return json({
          ...topic,
          details: { can_create_post: true },
          post_stream: {
            stream: [100, 101, 102],
            posts: postsForRequest(url).map((post) => ({ ...post, avatar_template: malformedAvatar }))
          }
        });
      }
      if (url.pathname === '/t/42/posts.json') {
        return json({
          post_stream: {
            posts: postsForRequest(url)
              .filter((post) => url.searchParams.getAll('post_ids[]').includes(String(post.id)))
              .map((post) => ({ ...post, avatar_template: malformedAvatar }))
          }
        });
      }
      if (url.pathname === '/search.json') {
        return json({
          topics: [topic],
          posts: [{ topic_id: 42, username: 'alice', blurb: '[!warning]- 命中正文' }],
          users: [{ id: 7, username: 'alice', avatar_template: malformedAvatar }],
          grouped_search_result: { more_full_page_results: true }
        });
      }
      if (url.pathname === '/u/alice/summary.json') {
        return json({
          user_summary: { topic_count: 1, reply_count: 1 },
          users: [{ id: 7, username: 'alice', name: 'Alice', trust_level: 2, avatar_template: malformedAvatar }],
          topics: [topic]
        });
      }
      if (url.pathname === '/topics/created-by/alice.json') {
        return json({
          users: [{ id: 7, username: 'alice', trust_level: 2, avatar_template: malformedAvatar }],
          topic_list: { topics: [topic] }
        });
      }
      if (url.pathname === '/user_actions.json') {
        return json({
          user_actions: [
            {
              id: 101,
              post_id: 101,
              topic_id: 42,
              title: '小隐寺主题',
              slug: 'temple-topic',
              post_number: 2,
              created_at: '2026-07-01T00:30:00.000Z',
              excerpt: '[!tip]+ 回复摘要'
            }
          ]
        });
      }
      if (url.pathname === '/session/current.json') {
        return json({
          current_user: { id: 7, username: 'alice', name: 'Alice', trust_level: 2, avatar_template: malformedAvatar }
        });
      }
      throw new Error(`unexpected ${input}`);
    });
    const credentials = { apiKey: 'secret-key', clientId: 'install-client' };

    const feed = await getXiaoyinsiFeed({ fetcher, credentials, limit: 1 });
    const categories = await getXiaoyinsiCategories({ fetcher, credentials });
    const detail = await getXiaoyinsiTopic('42', { fetcher, credentials });
    const replies = await getXiaoyinsiReplies('42', { fetcher, credentials, page: 2, limit: 1, offset: 1 });
    const reply = await getXiaoyinsiReply('42', 2, { fetcher, credentials });
    const search = await searchXiaoyinsi('正文', { fetcher, credentials });
    const profile = await getXiaoyinsiUserProfile('alice', 'alice', { fetcher, credentials });
    const current = await getXiaoyinsiCurrentUserProfile({ fetcher, credentials });

    expect(feed.items[0]).toMatchObject({
      source: 'xiaoyinsi',
      id: '42',
      author: 'alice',
      authorAvatar: undefined,
      category: '未分类'
    });
    expect(feed.nextPage).toBe(2);
    expect(categories.items[0]).toEqual({ source: 'xiaoyinsi', id: '5', name: '生活', slug: 'life', topicCount: 12 });
    expect(categories.items).toHaveLength(1);
    expect(detail).toMatchObject({
      source: 'xiaoyinsi',
      id: '42',
      category: '生活',
      authorAvatar: undefined,
      canCreatePost: true,
      liked: true,
      bookmarkId: 9,
      bookmarked: true,
      reactionSummary: [{ id: 'heart', count: 2 }],
      solved: true,
      acceptedAnswerFloor: 2,
      slowModeSeconds: 120
    });
    expect(detail.replies[0]).toMatchObject({
      author: 'bob',
      floor: 2,
      canEdit: true,
      canDelete: true,
      quotedPosts: [
        {
          reference: { source: 'xiaoyinsi', topicId: '420', postNumber: 1 },
          author: { label: 'Alice Display' },
          preview: '正文'
        }
      ],
      contentMarkdown: '回复',
      acceptedAnswer: true,
      hidden: true,
      folded: true,
      systemAction: true,
      actionCode: 'closed.enabled',
      reactionSummary: [{ id: '+1', count: 3 }]
    });
    expect(detail.replies[0].authorAvatar).toBeUndefined();
    expect(detail.replies[0].contentHtml).not.toContain('<aside');
    expect(splitDiscourseContentHtml(detail.contentHtml, detail.polls).map((part) => part.type)).toEqual([
      'html',
      'poll'
    ]);
    expect(replies).toMatchObject({ totalCount: 2 });
    expect(replies.items[0]).toMatchObject({
      author: 'carol',
      authorAvatar: undefined,
      floor: 3,
      contentMarkdown: '原始内容 102'
    });
    expect(reply).toMatchObject({ author: 'bob', authorAvatar: undefined, floor: 2, contentMarkdown: '回复' });
    expect(search).toMatchObject({ hasMore: true, nextPage: 2 });
    expect(search.items[0]).toMatchObject({ authorAvatar: undefined, category: '生活', excerpt: '命中正文' });
    expect(profile).toMatchObject({
      source: 'xiaoyinsi',
      username: 'alice',
      displayName: 'Alice',
      avatar: undefined,
      levelLabel: 'Lv2',
      hasMoreReplies: false
    });
    expect(profile.topics[0]).toMatchObject({
      author: 'alice',
      authorAvatar: undefined,
      authorLevelLabel: 'Lv2',
      category: '生活'
    });
    expect(profile.replies?.[0]).toMatchObject({ topicId: '42', floor: 2, excerpt: '回复摘要' });
    expect(current).toMatchObject({ source: 'xiaoyinsi', username: 'alice', displayName: 'Alice', avatar: undefined });

    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get('User-Api-Key')).toBe('secret-key');
      expect(new Headers(init?.headers).get('User-Api-Client-Id')).toBe('install-client');
    }
    const postReadUrls = fetcher.mock.calls
      .map(([input]) => new URL(input))
      .filter((url) => url.pathname === '/t/42.json' || url.pathname === '/t/42/posts.json');
    expect(postReadUrls.length).toBeGreaterThan(0);
    expect(postReadUrls.every((url) => url.searchParams.get('include_raw') === '1')).toBe(true);
  });

  it('[REG-XIAOYINSI-018][REG-SEARCH-013] keeps reply matches without claiming the reply author is the OP', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/search.json') {
        return json({
          topics: [topic, { ...topic, id: 43, posters: [], last_poster_username: 'last-replier' }],
          posts: [
            { topic_id: 42, post_number: 2, username: 'bob', blurb: '命中回复' },
            { topic_id: 43, post_number: 2, username: 'carol', blurb: '没有楼主身份' }
          ],
          users: [
            { id: 7, username: 'alice' },
            { id: 8, username: 'bob' }
          ],
          grouped_search_result: { more_full_page_results: false }
        });
      }
      if (url.pathname === '/site.json') {
        return json({ categories: [{ id: 5, name: '生活' }] });
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await searchXiaoyinsi('回复', { fetcher });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ author: 'alice', excerpt: '命中回复' });
    expect(result.items[1]).toMatchObject({ author: '', excerpt: '没有楼主身份' });
    expect(sourceDiagnosticSummary(result)).toMatchObject({
      candidateCount: 2,
      validCount: 2,
      droppedCount: 0,
      isExpectedEmpty: false,
      isParseEmpty: false
    });
  });

  it('[REG-XIAOYINSI-010] requests editable raw Markdown only for the independent User API session', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/t/42.json') {
        return json({
          ...topic,
          post_stream: { stream: [100, 101], posts: postsForRequest(url).slice(0, 2) }
        });
      }
      if (url.pathname === '/site.json') {
        return json({ categories: [{ id: 5, name: '生活' }] });
      }
      throw new Error(`unexpected ${input}`);
    });

    const anonymous = await getXiaoyinsiTopic('42', { fetcher });
    const anonymousTopicRequest = new URL(fetcher.mock.calls[0]?.[0] || 'https://invalid.local');

    expect(anonymousTopicRequest.searchParams.has('include_raw')).toBe(false);
    expect(anonymous.replies[0]?.contentMarkdown).toBeUndefined();
  });

  it('[REG-XIAOYINSI-008] advances the raw reply cursor past deleted embedded posts', async () => {
    const fourthPost = {
      id: 103,
      post_number: 4,
      username: 'dave',
      cooked: '<p>第四层</p>',
      created_at: '2026-07-01T01:30:00.000Z'
    };
    const requestedPostIds: string[][] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/t/42.json') {
        return json({
          ...topic,
          posts_count: 4,
          post_stream: {
            stream: [100, 101, 102, 103],
            posts: [posts[0], { ...posts[1], deleted_at: '2026-07-01T00:45:00.000Z' }, posts[2]]
          }
        });
      }
      if (url.pathname === '/site.json') {
        return json({ categories: [{ id: 5, name: '生活', slug: 'life' }] });
      }
      if (url.pathname === '/t/42/posts.json') {
        const ids = url.searchParams.getAll('post_ids[]');
        requestedPostIds.push(ids);
        return json({
          post_stream: {
            posts: [posts[2], fourthPost].filter((post) => ids.includes(String(post.id)))
          }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const detail = await getXiaoyinsiTopic('42', { fetcher, replyLimit: 2 });
    const next = await getXiaoyinsiReplies('42', {
      fetcher,
      limit: 1,
      offset: detail.replyNextOffset
    });

    expect(detail.replies.map((reply) => reply.floor)).toEqual([3]);
    expect(detail.replyNextOffset).toBe(2);
    expect(requestedPostIds).toEqual([['103']]);
    expect(next.items[0]).toMatchObject({ floor: 4, author: 'dave' });
  });

  it('[REG-TOPIC-062] opens a distant reply through one authenticated near-post window', async () => {
    const stream = Array.from({ length: 120 }, (_, index) => 1000 + index);
    const nearPosts = Array.from({ length: 20 }, (_, index) => ({
      id: stream[80 + index],
      post_number: 81 + index,
      username: `user-${81 + index}`,
      cooked: `<p>reply ${81 + index}</p>`,
      created_at: '2026-07-01T00:00:00.000Z'
    }));
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      expect(url.pathname).toBe('/t/42/90.json');
      expect(new Headers(init?.headers).get('User-Api-Key')).toBe('secret-key');
      expect(new Headers(init?.headers).get('User-Api-Client-Id')).toBe('install-client');
      return json({ post_stream: { stream, posts: nearPosts } });
    });

    const result = await getXiaoyinsiReplies('42', {
      fetcher,
      credentials: { apiKey: 'secret-key', clientId: 'install-client' },
      targetFloor: 90,
      limit: 30
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      currentPage: 3,
      currentOffset: 79,
      previousPage: 2,
      previousOffset: 49,
      nextPage: 4,
      nextOffset: 99,
      totalCount: 119
    });
    expect(result.items.find((reply) => reply.floor === 90)?.author).toBe('user-90');
  });

  it('[REG-XIAOYINSI-016] loads 小隐寺 tag candidates without the unsupported limit parameter', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/tags/filter/search') {
        if (url.searchParams.has('limit')) {
          return json({ failed: 'FAILED', errors: ['Limit 无效'] }, 400);
        }
        return json({
          results: [
            { name: '公告', count: 12 },
            { name: '反馈', count: 8 },
            { name: '闲聊', count: 4 }
          ]
        });
      }
      if (url.pathname === '/u/search/users') {
        return json({ users: [{ id: 7, username: 'alice', name: 'Alice', avatar_template: '/avatar/{size}.png' }] });
      }
      throw new Error(`unexpected ${input}`);
    });
    const credentials = { apiKey: 'secret-key', clientId: 'install-client' };

    expect(
      await searchXiaoyinsiTags({
        fetcher,
        credentials,
        query: '公',
        categoryId: '5',
        selectedTags: ['反馈'],
        limit: 2
      })
    ).toEqual([
      { name: '公告', topicCount: 12 },
      { name: '反馈', topicCount: 8 }
    ]);
    expect(await searchXiaoyinsiUsers({ fetcher, credentials, term: 'ali', categoryId: '5' })).toEqual([
      {
        id: '7',
        username: 'alice',
        displayName: 'Alice',
        avatar: 'https://forum.xiaoyinsi.com/avatar/96.png'
      }
    ]);

    const [tagRequest, userRequest] = fetcher.mock.calls.map(([input]) => new URL(input));
    expect(tagRequest.searchParams.get('q')).toBe('公');
    expect(tagRequest.searchParams.has('limit')).toBe(false);
    expect(tagRequest.searchParams.get('categoryId')).toBe('5');
    expect(tagRequest.searchParams.getAll('selected_tags[]')).toEqual(['反馈']);
    expect(userRequest.searchParams.get('term')).toBe('ali');
    expect(userRequest.searchParams.get('category_id')).toBe('5');
  });

  it('maps 小隐寺 new-content filters to the Discourse new feed subsets', async () => {
    const fetcher = vi.fn(async (_input: string) => json({ topic_list: { topics: [] } }));

    await getXiaoyinsiFeed({ fetcher, feedFilter: 'latest', page: 2, category: '5' });
    await getXiaoyinsiFeed({ fetcher, feedFilter: 'hot' });
    await getXiaoyinsiFeed({ fetcher, feedFilter: 'new-all' });
    await getXiaoyinsiFeed({ fetcher, feedFilter: 'new-topics' });
    await getXiaoyinsiFeed({ fetcher, feedFilter: 'new-replies' });

    const requests = fetcher.mock.calls.map(([input]) => new URL(input));
    expect(requests.map((url) => url.pathname)).toEqual([
      '/latest.json',
      '/hot.json',
      '/new.json',
      '/new.json',
      '/new.json'
    ]);
    expect(Object.fromEntries(requests[0].searchParams)).toEqual({ page: '1', category: '5' });
    expect(requests[2].searchParams.get('subset')).toBeNull();
    expect(requests[3].searchParams.get('subset')).toBe('topics');
    expect(requests[4].searchParams.get('subset')).toBe('replies');
  });

  it('keeps anonymous reads free of User API headers', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => json({ topic_list: { topics: [] } }));
    await getXiaoyinsiFeed({ fetcher });
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.has('User-Api-Key')).toBe(false);
    expect(headers.has('User-Api-Client-Id')).toBe(false);
  });

  it('keeps feed topics when the optional category lookup fails', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (new URL(input).pathname === '/site.json') {
        throw new Error('category service unavailable');
      }
      return json({
        users: [{ id: 7, username: 'alice' }],
        topic_list: { topics: [topic] }
      });
    });

    const feed = await getXiaoyinsiFeed({ fetcher });

    expect(feed.items[0]).toMatchObject({ id: '42', categoryId: '5', category: '未分类' });
  });

  it('[REG-XIAOYINSI-024] publishes the public feed before the optional category request settles', async () => {
    let resolveCategories!: (response: Response) => void;
    const categoryResponse = new Promise<Response>((resolve) => {
      resolveCategories = resolve;
    });
    const isolatedTopic = { ...topic, category_id: 987654 };
    const fetcher = vi.fn((input: string) => {
      if (new URL(input).pathname === '/site.json') {
        return categoryResponse;
      }
      return Promise.resolve(json({ users: [{ id: 7, username: 'alice' }], topic_list: { topics: [isolatedTopic] } }));
    });
    let settled = false;
    const feedPromise = getXiaoyinsiFeed({ fetcher }).then((result) => {
      settled = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledBeforeCategories = settled;
    resolveCategories(json({ categories: [{ id: 987654, name: '独立分类' }] }));
    const feed = await feedPromise;

    expect(settledBeforeCategories).toBe(true);
    expect(feed.items[0]).toMatchObject({ categoryId: '987654', category: '未分类' });
  });

  it('[REG-XIAOYINSI-024] shares category lookup work and reuses the successful cache', async () => {
    let resolveCategories!: (response: Response) => void;
    const categoryResponse = new Promise<Response>((resolve) => {
      resolveCategories = resolve;
    });
    const isolatedTopic = { ...topic, category_id: 876543 };
    const fetcher = vi.fn((input: string) => {
      if (new URL(input).pathname === '/site.json') return categoryResponse;
      return Promise.resolve(json({ users: [{ id: 7, username: 'alice' }], topic_list: { topics: [isolatedTopic] } }));
    });

    await Promise.all([getXiaoyinsiFeed({ fetcher }), getXiaoyinsiFeed({ fetcher })]);
    const categoriesPromise = getXiaoyinsiCategories({ fetcher });
    expect(fetcher.mock.calls.filter(([input]) => new URL(input).pathname === '/site.json')).toHaveLength(1);
    resolveCategories(json({ categories: [{ id: 876543, name: '缓存分类' }] }));
    await categoriesPromise;

    await expect(getXiaoyinsiFeed({ fetcher })).resolves.toMatchObject({
      items: [expect.objectContaining({ category: '缓存分类' })]
    });
    expect(fetcher.mock.calls.filter(([input]) => new URL(input).pathname === '/site.json')).toHaveLength(1);
  });

  it('[REG-XIAOYINSI-024] retries category lookup after a failed background request', async () => {
    let categoryAttempts = 0;
    const isolatedTopic = { ...topic, category_id: 765432 };
    const fetcher = vi.fn((input: string) => {
      if (new URL(input).pathname === '/site.json') {
        categoryAttempts += 1;
        return categoryAttempts === 1
          ? Promise.reject(new Error('category service unavailable'))
          : Promise.resolve(json({ categories: [{ id: 765432, name: '重试分类' }] }));
      }
      return Promise.resolve(json({ users: [{ id: 7, username: 'alice' }], topic_list: { topics: [isolatedTopic] } }));
    });

    await getXiaoyinsiFeed({ fetcher });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await getXiaoyinsiFeed({ fetcher });
    await getXiaoyinsiCategories({ fetcher });

    expect(categoryAttempts).toBe(2);
    await expect(getXiaoyinsiFeed({ fetcher })).resolves.toMatchObject({
      items: [expect.objectContaining({ category: '重试分类' })]
    });
  });

  it('[REG-XIAOYINSI-004] uses the created-by endpoint for authored topics and preserves its pagination', async () => {
    const activityTopic = { ...topic, id: 99, title: '只是互动过的主题' };
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/u/alice/summary.json') {
        return json({
          user_summary: { topic_count: 2, user: { id: 7, username: 'alice', name: 'Alice' } },
          topics: [activityTopic]
        });
      }
      if (url.pathname === '/topics/created-by/alice.json') {
        if (url.searchParams.get('page') === '1') {
          return json({
            users: [{ id: 7, username: 'alice' }],
            topic_list: { topics: [{ ...topic, id: 43, title: '第二页主题' }] }
          });
        }
        return json({
          users: [{ id: 7, username: 'alice' }],
          topic_list: { topics: [topic], more_topics_url: '/topics/created-by/alice?page=1' }
        });
      }
      if (url.pathname === '/site.json') {
        return json({ categories: [{ id: 5, name: '生活' }] });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getXiaoyinsiUserProfile('alice', 'alice', { fetcher, cursorType: 'topics' });
    const nextProfile = await getXiaoyinsiUserProfile('alice', 'alice', {
      fetcher,
      cursorType: 'topics',
      cursor: profile.nextTopicsCursor || undefined
    });

    expect(profile.topics).toEqual([expect.objectContaining({ id: '42', author: 'alice', category: '生活' })]);
    expect(profile).toMatchObject({ hasMoreTopics: true, nextTopicsCursor: '1' });
    expect(nextProfile.topics).toEqual([expect.objectContaining({ id: '43', author: 'alice' })]);
    expect(nextProfile).toMatchObject({ hasMoreTopics: false, nextTopicsCursor: null });
  });

  it('REG-USER-005 preserves explicit zero statistics for a new Xiaoyinsi user', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/u/newbie/summary.json') {
        return json({
          user_summary: {
            topic_count: 0,
            reply_count: 0,
            post_count: 0,
            user: { id: 7, username: 'newbie', name: 'Newbie' }
          }
        });
      }
      if (url.pathname === '/topics/created-by/newbie.json') {
        return json({ topic_list: { topics: [] } });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getXiaoyinsiUserProfile('newbie', 'newbie', {
      cursorType: 'topics',
      fetcher
    });

    expect(profile).toMatchObject({ topicCount: 0, replyCount: 0, postCount: 0 });
  });

  it('requires both credentials before reading the current identity', async () => {
    await expect(getXiaoyinsiCurrentUserProfile({ credentials: { apiKey: 'key', clientId: '' } })).rejects.toThrow(
      '请先授权小隐寺'
    );
  });

  it('[REG-ACCOUNT-019] distinguishes an explicit anonymous Xiaoyinsi session from malformed success data', async () => {
    const credentials = { apiKey: 'key', clientId: 'client' };
    await expect(
      getXiaoyinsiCurrentUserProfile({
        credentials,
        fetcher: async () => json({ current_user: null })
      })
    ).rejects.toMatchObject({
      source: 'xiaoyinsi',
      kind: 'login-expired',
      loginRequired: true,
      reason: 'expired'
    });

    for (const payload of [{}, { current_user: {} }]) {
      const error = await getXiaoyinsiCurrentUserProfile({
        credentials,
        fetcher: async () => json(payload)
      }).catch((caught) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toMatchObject({ loginRequired: true });
    }
  });

  it('[REG-ACCOUNT-025] types only a Discourse JSON invalid-access response as expired User API authorization', async () => {
    const credentials = { apiKey: 'expired-key', clientId: 'client' };

    await expect(
      getXiaoyinsiCurrentUserProfile({
        credentials,
        fetcher: async () =>
          json(
            {
              errors: ['Invalid Access'],
              error_type: 'invalid_access'
            },
            403
          )
      })
    ).rejects.toMatchObject({
      source: 'xiaoyinsi',
      kind: 'login-expired',
      loginRequired: true,
      reason: 'expired'
    });
  });

  it.each([401, 404])('[REG-ACCOUNT-025] keeps Xiaoyinsi current-session HTTP %i unknown', async (status) => {
    const failure = await getXiaoyinsiCurrentUserProfile({
      credentials: { apiKey: 'candidate-key', clientId: 'client' },
      fetcher: async () => json({ errors: [`HTTP ${status}`] }, status)
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toMatchObject({ loginRequired: true });
  });

  it('[REG-ACCOUNT-025] keeps a non-JSON Xiaoyinsi 403 unknown', async () => {
    const failure = await getXiaoyinsiCurrentUserProfile({
      credentials: { apiKey: 'candidate-key', clientId: 'client' },
      fetcher: async () =>
        new Response('<title>request rejected</title>', {
          status: 403,
          headers: { 'content-type': 'text/html' }
        })
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toMatchObject({ loginRequired: true });
  });

  it('[REG-ACCOUNT-025] keeps an unrelated Xiaoyinsi JSON 403 unknown', async () => {
    const failure = await getXiaoyinsiCurrentUserProfile({
      credentials: { apiKey: 'candidate-key', clientId: 'client' },
      fetcher: async () =>
        json(
          {
            errors: ['request rejected'],
            error_type: 'custom_rejection'
          },
          403
        )
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toMatchObject({ loginRequired: true });
  });

  it('[REG-XIAOYINSI-013] reads the current account level and activity through the independent User API session', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/session/current.json') {
        return json({ current_user: { id: 7, username: 'alice', name: 'Alice', trust_level: 1 } });
      }
      if (url.pathname === '/u/alice/summary.json') {
        return json({
          user_summary: {
            days_visited: 12,
            likes_given: 4,
            likes_received: 3,
            post_count: 8,
            topic_count: 2,
            topics_entered: 40,
            posts_read_count: 180,
            time_read: 7200
          },
          users: [{ id: 7, username: 'alice', name: 'Alice', trust_level: 1 }]
        });
      }
      throw new Error(`unexpected ${input}`);
    });
    const profile = await getXiaoyinsiLevelProfile({
      credentials: { apiKey: 'secret-key', clientId: 'install-client' },
      fetcher
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 1,
      targetLevel: 2,
      activity: {
        daysVisited: 12,
        topicsEntered: 40,
        postsReadCount: 180,
        timeRead: 7200,
        likesGiven: 4,
        likesReceived: 3,
        postCount: 8,
        topicCount: 2
      }
    });
    expect(fetcher.mock.calls.map(([input]) => new URL(input).pathname)).toEqual([
      '/session/current.json',
      '/u/alice/summary.json'
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get('User-Api-Key')).toBe('secret-key');
      expect(new Headers(init?.headers).get('User-Api-Client-Id')).toBe('install-client');
    }
  });
});
