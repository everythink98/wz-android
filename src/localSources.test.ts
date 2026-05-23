import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import { getCategories, getFeed, getReplies, getTopic, searchTopics } from './forumApi';
import { isLinuxDoCloudflareError } from './appUtils';
import { getNodeSeekReplies, getNodeSeekTopic } from './localNodeseek';
import { clearV2exCacheForTest } from './localV2ex';

const nodeSeekPayload = Buffer.from(JSON.stringify({
  rotateTopics: [{
    postId: 101,
    titleText: 'NodeSeek topic',
    titleLink: '/post-101-1',
    op: { name: 'alice', avatar: '/avatar.png' },
    category: { key: 'tech', name: '技术' },
    time: { createdDate: '2026-05-20T00:00:00.000Z' },
    updatedDate: '2026-05-20T01:00:00.000Z',
    comments: 2,
    views: '1.2k',
    content: 'NodeSeek body'
  }],
  allCategory: [
    { key: 'tech', cn_text: '技术' },
    { key: 'admin', cn_text: '管理', adminOnly: true }
  ]
})).toString('base64');

const nodeSeekTopicPayload = Buffer.from(JSON.stringify({
  postData: {
    postId: 101,
    title: 'NodeSeek topic',
    op: { name: 'alice' },
    category: { key: 'tech', name: '技术' },
    comments: [
      {
        commentId: 1,
        poster: { name: 'alice' },
        markdown: '正文 **内容**',
        time: { createdDate: '2026-05-20T00:00:00.000Z' }
      },
      {
        commentId: 2,
        poster: { name: 'bob' },
        markdown: '回复内容',
        time: { createdDate: '2026-05-20T00:01:00.000Z' }
      }
    ]
  }
})).toString('base64');

const nodeSeekReplyPagePayload = Buffer.from(JSON.stringify({
  postData: {
    postId: 101,
    title: 'NodeSeek topic',
    comments: [
      {
        commentId: 2,
        poster: { name: 'bob' },
        markdown: '回复内容',
        time: { createdDate: '2026-05-20T00:01:00.000Z' }
      }
    ]
  }
})).toString('base64');

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });
}

function html(value: string) {
  return new Response(value, {
    headers: { 'content-type': 'text/html' }
  });
}

describe('Android local sources', () => {
  it('reads NodeSeek feed, categories, topic, replies, and search without project server endpoints', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-101-2')) {
        return html(`<script>${nodeSeekReplyPagePayload}</script>`);
      }
      if (input.includes('/post-101-1')) {
        return html(`<script>${nodeSeekTopicPayload}</script>`);
      }
      return html(`<script>${nodeSeekPayload}</script>`);
    });

    const feed = await getFeed({ source: 'nodeseek', fetcher });
    const categories = await getCategories({ source: 'nodeseek', fetcher, nocache: true });
    const topic = await getTopic({ source: 'nodeseek', id: '101', fetcher });
    const replies = await getReplies({ source: 'nodeseek', id: '101', page: 2, offset: 0, fetcher });
    const search = await searchTopics({ source: 'nodeseek', query: 'NodeSeek', fetcher });

    expect(feed.items[0]).toMatchObject({ source: 'nodeseek', id: '101', categoryId: 'tech' });
    expect(categories.items).toEqual([{ source: 'nodeseek', id: 'tech', name: '技术' }]);
    expect(topic.contentHtml).toContain('<strong>内容</strong>');
    expect(topic.lastReplyAt).toBe('2026-05-20T00:01:00.000Z');
    expect(replies.items[0]).toMatchObject({ author: 'bob', floor: 1 });
    expect(search.items[0].id).toBe('101');
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(/\/api\/|10\.0\.2\.2|127\.0\.0\.1:3000/);
  });

  it('does not infer a NodeSeek next page when the list exactly reaches the limit', async () => {
    const exactPagePayload = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 201, titleText: 'NodeSeek one', titleLink: '/post-201-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:01:00.000Z' } },
        { postId: 200, titleText: 'NodeSeek two', titleLink: '/post-200-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:00:00.000Z' } }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${exactPagePayload}</script>`));

    const feed = await getFeed({ source: 'nodeseek', limit: 2, fetcher });

    expect(feed.items).toHaveLength(2);
    expect(feed.hasMore).toBe(false);
    expect(feed.nextPage).toBeNull();
  });

  it('continues NodeSeek replies from page one when the first page has more embedded replies', async () => {
    const comments = [
      { poster: { name: 'alice' }, markdown: '正文' },
      ...Array.from({ length: 32 }, (_, index) => ({
        poster: { name: `reply ${index + 1}` },
        markdown: `回复 ${index + 1}`,
        time: { createdDate: `2026-05-20T00:${String(index + 1).padStart(2, '0')}:00.000Z` }
      }))
    ];
    const payload = Buffer.from(JSON.stringify({
      postData: { postId: 723704, title: 'NodeSeek topic', comments }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('723704', { fetcher, replyLimit: 30 });
    const replies = await getNodeSeekReplies('723704', {
      fetcher,
      page: topic.replyNextPage ?? 1,
      offset: topic.replyNextOffset,
      limit: 20
    });

    expect(topic.replyNextPage).toBe(1);
    expect(topic.replyNextOffset).toBe(30);
    expect(replies.items.map((item) => item.author)).toEqual(['reply 31', 'reply 32']);
    expect(replies.hasMore).toBe(false);
  });

  it('keeps NodeSeek reply pagination open when page one links to another reply page', async () => {
    const pageOnePayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723704,
        title: 'NodeSeek topic',
        comments: [
          { poster: { name: 'alice' }, markdown: '正文' },
          { poster: { name: 'reply 1' }, markdown: '回复 1' }
        ]
      }
    })).toString('base64');
    const pageTwoPayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723704,
        title: 'NodeSeek topic',
        comments: [
          { poster: { name: 'reply 2' }, markdown: '回复 2' },
          { poster: { name: 'reply 3' }, markdown: '回复 3' }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-723704-2')) {
        return html(`<script>${pageTwoPayload}</script>`);
      }
      return html(`<script>${pageOnePayload}</script><a href="/post-723704-2">2</a>`);
    });

    const topic = await getNodeSeekTopic('723704', { fetcher, replyLimit: 30 });
    const replies = await getNodeSeekReplies('723704', {
      fetcher,
      page: topic.replyNextPage ?? 1,
      offset: topic.replyNextOffset,
      limit: 20
    });

    expect(topic.replyHasMore).toBe(true);
    expect(topic.replyNextPage).toBe(2);
    expect(topic.replyNextOffset).toBe(1);
    expect(replies.items.map((item) => item.author)).toEqual(['reply 2', 'reply 3']);
    expect(replies.items.map((item) => item.floor)).toEqual([2, 3]);
  });

  it('uses the linux.do reply offset as the fallback floor on later reply pages', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        return json({
          post_stream: {
            posts: [
              { id: 32, username: 'reply 31', cooked: '<p>31</p>', created_at: '2026-05-20T00:31:00.000Z' },
              { id: 33, username: 'reply 32', cooked: '<p>32</p>', created_at: '2026-05-20T00:32:00.000Z' }
            ]
          }
        });
      }
      return json({
        id: 42,
        title: 'linux.do topic',
        created_at: '2026-05-20T00:00:00.000Z',
        post_stream: {
          stream: Array.from({ length: 40 }, (_, index) => index + 1),
          posts: [{ id: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' }]
        }
      });
    });

    const replies = await getReplies({ source: 'linuxdo', id: '42', page: 2, offset: 30, limit: 2, fetcher });

    expect(replies.items.map((item) => item.floor)).toEqual([32, 33]);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://linux.do/t/42.json',
      expect.stringContaining('https://linux.do/t/42/posts.json')
    ]);
  });

  it('stops linux.do feed pagination when an empty page still advertises more topics', async () => {
    const fetcher = vi.fn(async () => {
      if (fetcher.mock.calls.length > 1) {
        throw new Error('unexpected second linux.do feed request');
      }
      return json({
        topic_list: {
          topics: [],
          more_topics_url: '/latest.json?page=1'
        },
        users: []
      });
    });

    const feed = await getFeed({ source: 'linuxdo', limit: 2, fetcher });

    expect(feed).toMatchObject({ items: [], hasMore: false, nextPage: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reuses the cached linux.do reply stream after reading topic details', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        return json({
          post_stream: {
            posts: [
              { id: 4, username: 'reply 4', cooked: '<p>4</p>', created_at: '2026-05-20T00:04:00.000Z' },
              { id: 5, username: 'reply 5', cooked: '<p>5</p>', created_at: '2026-05-20T00:05:00.000Z' }
            ]
          }
        });
      }
      return json({
        id: 900,
        title: 'linux.do cached topic',
        created_at: '2026-05-20T00:00:00.000Z',
        post_stream: {
          stream: [1, 2, 3, 4, 5],
          posts: [
            { id: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
            { id: 2, username: 'reply 2', cooked: '<p>2</p>', created_at: '2026-05-20T00:02:00.000Z' },
            { id: 3, username: 'reply 3', cooked: '<p>3</p>', created_at: '2026-05-20T00:03:00.000Z' }
          ]
        }
      });
    });

    const topic = await getTopic({ source: 'linuxdo', id: '900', fetcher, nocache: true });
    const replies = await getReplies({
      source: 'linuxdo',
      id: '900',
      page: topic.replyNextPage ?? 2,
      offset: topic.replyNextOffset,
      limit: 2,
      fetcher
    });

    expect(replies.items.map((item) => item.floor)).toEqual([4, 5]);
    expect(fetcher.mock.calls.filter((call) => String(call[0]).includes('/t/900.json'))).toHaveLength(1);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/t/900/posts.json');
  });

  it('evicts least recently used linux.do reply streams after the cache limit', async () => {
    const topicJsonCalls: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        return json({
          post_stream: {
            posts: [
              { id: 2, username: 'reply 2', cooked: '<p>2</p>', created_at: '2026-05-20T00:02:00.000Z' }
            ]
          }
        });
      }
      const id = String(input).match(/\/t\/(\d+)\.json/)?.[1] || '0';
      topicJsonCalls.push(id);
      return json({
        id: Number(id),
        title: `linux.do cached topic ${id}`,
        created_at: '2026-05-20T00:00:00.000Z',
        post_stream: {
          stream: [1, 2],
          posts: [
            { id: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' }
          ]
        }
      });
    });

    for (let id = 8000; id < 8100; id += 1) {
      await getTopic({ source: 'linuxdo', id: String(id), fetcher, nocache: true });
    }
    await getReplies({ source: 'linuxdo', id: '8000', page: 2, offset: 0, limit: 1, fetcher });

    topicJsonCalls.length = 0;
    await getTopic({ source: 'linuxdo', id: '8100', fetcher, nocache: true });
    await getReplies({ source: 'linuxdo', id: '8001', page: 2, offset: 0, limit: 1, fetcher });
    await getReplies({ source: 'linuxdo', id: '8000', page: 2, offset: 0, limit: 1, fetcher });

    expect(topicJsonCalls.filter((id) => id === '8001')).toHaveLength(1);
    expect(topicJsonCalls.filter((id) => id === '8000')).toHaveLength(0);
  });

  it('uses NodeSeek updatedDate as last reply time when embedded topic comments are empty', async () => {
    const emptyTopicPayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 101,
        title: 'NodeSeek topic',
        op: { name: 'alice' },
        createdDate: '2026-05-20T00:00:00.000Z',
        updatedDate: '2026-05-20T01:00:00.000Z',
        comments: []
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${emptyTopicPayload}</script>`));

    const topic = await getTopic({ source: 'nodeseek', id: '101', fetcher });

    expect(topic.createdAt).toBe('2026-05-20T00:00:00.000Z');
    expect(topic.lastReplyAt).toBe('2026-05-20T01:00:00.000Z');
  });

  it('searches NodeSeek through its site search instead of filtering the latest Android feed', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('keyword=GPT')) {
        return html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-202-1">GPT 全站旧帖</a></div>
              <div class="post-info">
                <span class="info-author"><a href="/space/2">bob</a></span>
                <span class="info-comments-count">4</span>
                <span class="info-views">99</span>
                <a href="/categories/tech">技术</a>
                <time datetime="2026-05-21T00:00:00.000Z"></time>
              </div>
            </li>
          </ul>
        `);
      }
      return html('<ul class="post-list"><li><a href="/post-101-1">latest only</a></li></ul>');
    });

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher });

    expect(search.items).toHaveLength(1);
    expect(search.items[0]).toMatchObject({
      source: 'nodeseek',
      id: '202',
      title: 'GPT 全站旧帖',
      categoryId: 'tech',
      category: '技术'
    });
    const callUrls = fetcher.mock.calls.map((call) => call[0]);
    const calls = callUrls.join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?keyword=GPT');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
    expect(calls).not.toMatch(/\/api\/search|10\.0\.2\.2|127\.0\.0\.1:3000/);
  });

  it('sends saved NodeSeek verification cookies when reading the Android feed', async () => {
    const fetcher = vi.fn(async () => html(`<script>${nodeSeekPayload}</script>`));

    await getFeed({
      source: 'nodeseek',
      fetcher,
      nodeSeekCookie: 'cf_clearance=clearance',
      nodeSeekUserAgent: 'NodeSeek WebView UA'
    });

    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/', expect.objectContaining({
      headers: expect.objectContaining({
        cookie: 'cf_clearance=clearance',
        'User-Agent': 'NodeSeek WebView UA'
      })
    }));
  });

  it('reports NodeSeek Cloudflare HTML as a verification requirement', async () => {
    const fetcher = vi.fn(async () => new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
    }));

    await expect(getFeed({ source: 'nodeseek', fetcher })).rejects.toMatchObject({
      source: 'nodeseek',
      reason: 'cloudflare',
      message: 'NodeSeek 需要完成 Cloudflare 验证'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/', expect.any(Object));
  });

  it('reports Chinese NodeSeek Cloudflare HTML as a verification requirement', async () => {
    const fetcher = vi.fn(async () => html('<html><title>请稍候…</title><body>正在进行安全验证。本网站使用安全服务防护恶意自动程序。</body></html>'));

    await expect(getFeed({ source: 'nodeseek', fetcher })).rejects.toMatchObject({
      source: 'nodeseek',
      reason: 'cloudflare',
      message: 'NodeSeek 需要完成 Cloudflare 验证'
    });
  });

  it('reads rendered NodeSeek WebView rows without picking footer post links', async () => {
    const fetcher = vi.fn(async () => html(`
      <ul>
        <li class="post-list-item">
          <a href="/space/48872"><img src="/avatar/48872.png" alt="我是ikun"></a>
          <div class="post-list-content">
            <div class="post-title"><a href="/post-743001-1">【求助】Claude使用Google pay绑定国内visa信用卡订阅有风险吗？</a></div>
            <div class="post-info">
              <span class="info-item info-author"><a href="/space/48872">我是ikun</a></span>
              <span class="info-item info-views"><span title="64 views">64</span></span>
              <span title="2 comments" class="info-item info-comments-count"><span title="3 comments">2</span></span>
              <a href="/post-743001-1#2" class="info-item info-last-comment-time">
                <time title="2026-05-23 00:06:25" datetime="2026-05-22T16:06:25.000Z">3min ago</time>
              </a>
              <a href="/categories/daily" class="info-item">日常</a>
            </div>
          </div>
        </li>
      </ul>
      <footer><a href="/post-6800-1"><li>Premium Provider</li></a></footer>
    `));

    const feed = await getFeed({ source: 'nodeseek', fetcher });

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({
      id: '743001',
      title: '【求助】Claude使用Google pay绑定国内visa信用卡订阅有风险吗？',
      author: '我是ikun',
      replyCount: 2,
      viewCount: 64,
      categoryId: 'daily',
      category: '日常',
      lastReplyAt: '2026-05-22T16:06:25.000Z'
    });
  });

  it('reads rendered NodeSeek category links when embedded category data is absent', async () => {
    const fetcher = vi.fn(async () => html(`
      <nav>
        <a href="/categories/daily">日常</a>
        <a href="/categories/tech">技术</a>
      </nav>
      <ul>
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743001-1">NodeSeek topic</a></div>
          <a href="/categories/daily">日常</a>
        </li>
      </ul>
    `));

    const categories = await getCategories({ source: 'nodeseek', fetcher });

    expect(categories.items).toEqual([
      { source: 'nodeseek', id: 'daily', name: '日常' },
      { source: 'nodeseek', id: 'tech', name: '技术' }
    ]);
  });

  it('reads rendered NodeSeek topic pages when embedded postData is absent', async () => {
    const fetcher = vi.fn(async () => html(`
      <main>
        <article class="post-detail">
          <h1 class="post-title">cloudflare果然挂了</h1>
          <div class="post-info">
            <span class="info-author"><a href="/space/1">alice</a></span>
            <a href="/categories/daily">日常</a>
            <time datetime="2026-05-22T16:00:00.000Z">2026-05-23 00:00:00</time>
          </div>
          <div class="post-content"><p>正文提到了 Cloudflare，但这是普通正文。</p></div>
        </article>
        <section class="comment-list">
          <div class="comment-item" id="comment-200">
            <a href="/space/2" class="comment-author">bob</a>
            <time datetime="2026-05-22T16:01:00.000Z"></time>
            <div class="comment-content"><p>回复内容</p></div>
          </div>
        </section>
      </main>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743001', fetcher });

    expect(topic).toMatchObject({
      source: 'nodeseek',
      id: '743001',
      title: 'cloudflare果然挂了',
      author: 'alice',
      categoryId: 'daily',
      category: '日常',
      createdAt: '2026-05-22T16:00:00.000Z',
      replyCount: 1
    });
    expect(topic.contentHtml).toContain('正文提到了 Cloudflare');
    expect(topic.accessRequirement).toBeUndefined();
    expect(topic.replies[0]).toMatchObject({
      author: 'bob',
      floor: 1,
      commentId: 200,
      contentHtml: expect.stringContaining('回复内容')
    });
  });

  it('reads rendered NodeSeek content-item authors and replies', async () => {
    const fetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743001-1">【求助】Claude使用Google pay绑定国内visa信用卡订阅有风险吗？</a>
      <div id="0" data-comment-id="10232616" class="content-item">
        <div class="author-info"><a href="/space/48872" class="author-name">我是ikun</a><span class="is-poster">楼主</span></div>
        <span class="date-created"><time datetime="2026-05-22T15:55:11.000Z">1h ago</time></span>
        <span class="content-category">in <a href="/categories/daily">日常</a></span>
        <a href="#0" class="floor-link">#0</a>
        <article class="post-content"><p>如题，希望有经验的朋友分享一下，感谢</p></article>
      </div>
      <li id="1" data-comment-id="10232667" class="content-item">
        <div class="author-info"><a href="/space/26953" class="author-name">纳西妲</a></div>
        <span class="date-created"><time datetime="2026-05-22T15:59:06.000Z">1h ago</time></span>
        <a href="#1" class="floor-link">#1</a>
        <article class="post-content"><p>都用 Google Pay 了肯定没风险</p></article>
      </li>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743001', fetcher });

    expect(topic).toMatchObject({
      title: '【求助】Claude使用Google pay绑定国内visa信用卡订阅有风险吗？',
      author: '我是ikun',
      commentId: 10232616,
      categoryId: 'daily',
      replyCount: 1
    });
    expect(topic.replies[0]).toMatchObject({
      author: '纳西妲',
      floor: 1,
      commentId: 10232667,
      contentHtml: expect.stringContaining('都用 Google Pay')
    });
  });

  it('reads V2EX public JSON, HTML pages, topic detail, and SOV2EX search directly', async () => {
    clearV2exCacheForTest();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/latest.json')) {
        return json([{
          id: 121,
          title: 'V2EX latest',
          url: 'https://www.v2ex.com/t/121',
          created: 1780000000,
          last_touched: 1780000100,
          replies: 3,
          node: { name: 'create', title: '分享创造' },
          member: { username: 'neo', avatar_normal: '//cdn.v2ex.com/a.png' },
          content: 'latest body'
        }]);
      }
      if (input.includes('/recent?p=2')) {
        return html('<div class="cell"><a class="topic-link" href="/t/122#reply1">V2EX page 2</a><a class="node" href="/go/create">分享创造</a><a href="/member/bob">bob</a><span title="2026-05-20 10:00:00"></span><a class="count_livid">1</a></div><a href="/recent?p=3">下一页</a>');
      }
      if (input.includes('/api/topics/show.json')) {
        return json([{
          id: 121,
          title: 'V2EX detail',
          url: 'https://www.v2ex.com/t/121',
          created: 1780000000,
          replies: 1,
          node: { name: 'create', title: '分享创造' },
          member: { username: 'neo' },
          content_rendered: '<p>detail</p>'
        }]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([{ member: { username: 'bob' }, content_rendered: '<p>reply</p>', created: 1780000200 }]);
      }
      if (input.includes('sov2ex.com')) {
        return json({ hits: { hits: [{ _source: { id: 121, title: 'V2EX search', member: 'neo', created: '2026-05-20T00:00:00', replies: 1 }, highlight: { title: ['V2EX search'] } }] } });
      }
      return json({});
    });

    const first = await getFeed({ source: 'v2ex', fetcher });
    const second = await getFeed({ source: 'v2ex', page: 2, fetcher });
    const topic = await getTopic({ source: 'v2ex', id: '121', fetcher });
    const search = await searchTopics({ source: 'v2ex', query: 'V2EX', fetcher });

    expect(first.items[0]).toMatchObject({ id: '121', categoryId: 'create' });
    expect(second.items[0]).toMatchObject({ id: '122', author: 'bob' });
    expect(topic.replies[0]).toMatchObject({ author: 'bob', floor: 1 });
    expect(search.items[0]).toMatchObject({ id: '121', title: 'V2EX search' });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(/\/api\/feed|http:\/\/10\.0\.2\.2|http:\/\/127\.0\.0\.1:3000/);
  });

  it('keeps V2EX feed pagination open when latest JSON is shorter than the app page', async () => {
    clearV2exCacheForTest();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/latest.json')) {
        return json([
          { id: 501, title: 'V2EX latest newer', url: 'https://www.v2ex.com/t/501', created: 1780000500, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } },
          { id: 500, title: 'V2EX latest older', url: 'https://www.v2ex.com/t/500', created: 1780000400, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } }
        ]);
      }
      if (input.includes('/recent?p=1')) {
        return html(`
          <div class="cell"><a class="topic-link" href="/t/501#reply1">V2EX latest newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:05:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/500#reply1">V2EX latest older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:04:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/499#reply1">V2EX html newer</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:03:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/498#reply1">V2EX html older</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:02:00"></span></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'v2ex', limit: 3, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['501', '500', '499']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('reads V2EX search hits when SOV2EX returns a top-level hits array', async () => {
    const fetcher = vi.fn(async () => json({
      total: 1,
      hits: [{
        _source: { id: 934576, title: 'GPT search result', member: 'neo', created: '2026-05-20T00:00:00', replies: 2 },
        highlight: { title: ['GPT search result'] }
      }]
    }));

    const search = await searchTopics({ source: 'v2ex', query: 'gpt', fetcher });

    expect(search.items[0]).toMatchObject({ source: 'v2ex', id: '934576', title: 'GPT search result' });
  });

  it('tags linux.do Cloudflare topic errors so the app can open verification', async () => {
    const fetcher = vi.fn(async () => new Response('<html><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    }));

    const error = await getTopic({ source: 'linuxdo', id: '123', fetcher }).catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
    expect(error).toMatchObject({
      message: 'linux.do 需要完成 Cloudflare 验证',
      source: 'linuxdo',
      reason: 'cloudflare'
    });
  });

  it('reports non-JSON linux.do HTTP errors with the HTTP status', async () => {
    const fetcher = vi.fn(async () => new Response('<html>upstream unavailable</html>', {
      status: 503,
      headers: { 'content-type': 'text/html' }
    }));

    await expect(getFeed({ source: 'linuxdo', fetcher })).rejects.toThrow('HTTP 503');
  });

  it('reports malformed linux.do JSON with a readable message', async () => {
    const fetcher = vi.fn(async () => new Response('<html>not json</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' }
    }));

    await expect(getFeed({ source: 'linuxdo', fetcher })).rejects.toThrow('linux.do 返回内容格式不正确');
  });
});
