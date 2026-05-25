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

import { getCategories, getFeed, getReply, getUserProfile, parseYaohuoFeedHtml, parseYaohuoLoginHtml, searchTopics } from './forumApi';
import { clearV2exCacheForTest } from './localV2ex';

const nodeSeekPayload = Buffer.from(JSON.stringify({
  rotateTopics: [{ postId: 1, titleText: 'NodeSeek', titleLink: '/post-1-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:00:00.000Z' } }],
  allCategory: [{ key: 'tech', cn_text: '技术' }]
})).toString('base64');

describe('Android local forum facade', () => {
  it('routes feed and categories to public source sites, not the project server', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPayload}</script>`);
      }
      return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
        headers: { 'content-type': 'application/json' }
      });
    });

    await getFeed({ source: 'nodeseek', page: 2, category: 'tech', fetcher });
    await getCategories({ source: 'all', fetcher });

    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/categories/tech/page-2?sortBy=postTime');
    expect(calls).not.toMatch(/127\.0\.0\.1:3000|10\.0\.2\.2|\/api\/feed|\/api\/categories/);
  });

  it('uses local yaohuo HTML parsing without posting HTML to a parser endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ items: [], errors: {} })));

    const result = await parseYaohuoFeedHtml({
      html: '<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>',
      category: '177',
      page: 1,
      fetcher
    });
    const login = await parseYaohuoLoginHtml({ html: '<html>首页</html>', url: 'https://yaohuo.me/wapindex.aspx?sid=-2', fetcher });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
    expect(login.loginRequired).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps yaohuo verification and login-expired detection local', async () => {
    await expect(parseYaohuoFeedHtml({
      html: '<script>window.CAPTCHA_CONFIG={}</script>',
      url: 'https://yaohuo.me/bbs/book_list.aspx'
    })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'verification'
    });
  });

  it('keeps single quoted-floor reads on linux.do public JSON endpoints', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/t/42.json')) {
        return new Response(JSON.stringify({
          id: 42,
          title: 'linux.do',
          created_at: '2026-05-20T00:00:00.000Z',
          post_stream: {
            stream: [100, 101],
            posts: [{ id: 101, post_number: 2, username: 'bob', cooked: '<p>quoted</p>', created_at: '2026-05-20T00:01:00.000Z' }]
          }
        }));
      }
      return new Response(JSON.stringify({ post_stream: { posts: [] } }));
    });

    const reply = await getReply({ source: 'linuxdo', id: '42', floor: 2, fetcher });

    expect(reply).toMatchObject({ author: 'bob', floor: 2 });
    expect(fetcher.mock.calls[0][0]).toBe('https://linux.do/t/42.json');
  });

  it('returns per-source errors for aggregated search instead of failing other sources', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPayload}</script>`);
      }
      throw new Error('upstream down');
    });

    const result = await searchTopics({ source: 'all', query: 'NodeSeek', fetcher });

    expect(result.items[0]).toMatchObject({ source: 'nodeseek', id: '1' });
    expect(result.errors.linuxdo).toBeTruthy();
    expect(result.errors.v2ex).toBeTruthy();
  });

  it('routes user profile reads to each public source site', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872, readme: 'bio' } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, discussions: [{ post_id: 101, title: 'NodeSeek topic', rank: 0 }] }));
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, comments: [{ post_id: 101, floor_id: 2, text: 'NodeSeek reply' }] }));
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(JSON.stringify({
          user_summary: {
            user: { id: 7, username: 'alice', name: 'Alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png' },
            topic_count: 2,
            post_count: 8
          },
          topics: [{ id: 42, title: 'linux topic', slug: 'linux-topic', created_at: '2026-05-20T00:00:00.000Z', posts_count: 1 }]
        }));
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ id: 9, username: 'neo', avatar_large: '//cdn.v2ex.com/avatar.png', tagline: 'hello' }));
      }
      if (input.includes('v2ex.com/member/neo')) {
        return new Response('<div class="cell item"><a class="topic-link" href="/t/121">V2EX topic</a><a class="node" href="/go/create">分享创造</a><span title="2026-05-20 10:00:00"></span></div>');
      }
      if (input.includes('yaohuo.me')) {
        return new Response('<div class="content">昵称:火友<br/>发帖:3<br/>回帖:9</div><a href="/bbs-66.html">妖火主题</a>');
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });
    const linuxdo = await getUserProfile({ source: 'linuxdo', id: 'alice', username: 'alice', fetcher });
    const v2ex = await getUserProfile({ source: 'v2ex', id: 'neo', username: 'neo', fetcher });
    const yaohuo = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher, yaohuoCookie: 'sid=ok' });

    expect(nodeseek).toMatchObject({ source: 'nodeseek', id: '48872', username: '我是ikun', url: 'https://www.nodeseek.com/space/48872' });
    expect(linuxdo).toMatchObject({ source: 'linuxdo', id: 'alice', username: 'alice', postCount: 8, topicCount: 2 });
    expect(v2ex).toMatchObject({ source: 'v2ex', id: 'neo', username: 'neo', bio: 'hello' });
    expect(yaohuo).toMatchObject({ source: 'yaohuo', id: '7', username: '火友', postCount: 12 });
  });

  it('reads user profile topic times from all four Android sources', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({
          success: true,
          discussions: [{
            post_id: 101,
            title: 'NodeSeek topic',
            rank: 0,
            created_at: '2026-05-22T16:06:25.000Z'
          }]
        }));
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, comments: [{ post_id: 101, floor_id: 2, text: 'NodeSeek reply' }] }));
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(JSON.stringify({
          user_summary: {
            user: { id: 7, username: 'alice', name: 'Alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png' }
          },
          topics: [{
            id: 42,
            title: 'linux topic',
            slug: 'linux-topic',
            created_at: '2026-05-20T00:00:00.000Z',
            bumped_at: '2026-05-20T01:00:00.000Z',
            posts_count: 2
          }]
        }));
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ id: 9, username: 'neo', avatar_large: '//cdn.v2ex.com/avatar.png', tagline: 'hello' }));
      }
      if (input.includes('v2ex.com/member/neo/topics')) {
        return new Response(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/121#reply4">V2EX topic</a></span>
            <span class="topic_info"><a class="node" href="/go/create">分享创造</a> · <strong><a href="/member/neo">neo</a></strong> · <span title="2026-05-20 10:00:00 +08:00">1 day ago</span></span>
            <a class="count_livid" href="/t/121#reply4">4</a>
          </div>
        `);
      }
      if (input.includes('v2ex.com/member/neo')) {
        return new Response('<h1>neo</h1><a href="/member/neo/topics">More topics by neo</a>');
      }
      if (input.includes('yaohuo.me')) {
        return new Response(`
          <div class="content">昵称:火友<br/>发帖:3<br/>回帖:9</div>
          <div class="listdata"><a href="/bbs-66.html?classid=177">妖火主题</a>/火友/阅1/2026-05-20 10:00</div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });
    const linuxdo = await getUserProfile({ source: 'linuxdo', id: 'alice', username: 'alice', fetcher });
    const v2ex = await getUserProfile({ source: 'v2ex', id: 'neo', username: 'neo', fetcher });
    const yaohuo = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher, yaohuoCookie: 'sid=ok' });

    expect(nodeseek.topics[0]).toMatchObject({
      id: '101',
      createdAt: '2026-05-22T16:06:25.000Z',
      lastReplyAt: '2026-05-22T16:06:25.000Z'
    });
    expect(nodeseek.topics).toHaveLength(1);
    expect(linuxdo.topics[0]).toMatchObject({
      id: '42',
      createdAt: '2026-05-20T00:00:00.000Z',
      lastReplyAt: '2026-05-20T01:00:00.000Z'
    });
    expect(v2ex.topics[0]).toMatchObject({
      id: '121',
      createdAt: '2026-05-20T02:00:00.000Z',
      lastReplyAt: '2026-05-20T02:00:00.000Z'
    });
    expect(yaohuo.topics[0]).toMatchObject({
      id: '66',
      createdAt: '2026-05-20T02:00:00.000Z',
      lastReplyAt: '2026-05-20T02:00:00.000Z'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/member/neo/topics');
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('nodeseek.com/api/content/list-discussions?uid=48872&page=1');
  });

  it('reads V2EX user topics from the public member page and orders them newest first', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ id: 683966, username: 'haonanaaaaaa', avatar_large: 'https://cdn.v2ex.com/avatar.png' }));
      }
      if (input === 'https://www.v2ex.com/member/haonanaaaaaa') {
        return new Response(`
          <div class="cell item">
            <span class="item_title"><a href="/t/1214608#reply177" class="topic-link">大家都用的什么代理软件</a></span>
            <span class="topic_info"><a class="node" href="/go/survey">调查</a> · <strong><a href="/member/haonanaaaaaa">haonanaaaaaa</a></strong> · <span title="2026-05-25 02:10:57 +08:00">10h ago</span></span>
            <a href="/t/1214608#reply177" class="count_livid">177</a>
          </div>
          <div class="cell item">
            <span class="item_title"><a href="/t/1212849#reply55" class="topic-link">Gemini 要重新做教育认证了</a></span>
            <span class="topic_info"><a class="node" href="/go/programmer">程序员</a> · <strong><a href="/member/haonanaaaaaa">haonanaaaaaa</a></strong> · <span title="2026-05-25 12:28:22 +08:00">31 mins ago</span></span>
            <a href="/t/1212849#reply55" class="count_livid">55</a>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({ source: 'v2ex', id: 'haonanaaaaaa', username: 'haonanaaaaaa', fetcher });

    expect(profile.topics.map((topic) => topic.id)).toEqual(['1212849', '1214608']);
  });

  it('falls back to the V2EX member Atom feed when the public member page has no topic links', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ id: 683966, username: 'haonanaaaaaa', avatar_large: 'https://cdn.v2ex.com/avatar.png' }));
      }
      if (input === 'https://www.v2ex.com/member/haonanaaaaaa') {
        return new Response('<h1>haonanaaaaaa</h1><a href="/member/haonanaaaaaa/topics">More topics by haonanaaaaaa</a>');
      }
      if (input === 'https://www.v2ex.com/member/haonanaaaaaa/topics') {
        return new Response('<h1>haonanaaaaaa</h1>');
      }
      if (input === 'https://www.v2ex.com/feed/member/haonanaaaaaa.xml') {
        return new Response(`<?xml version="1.0" encoding="utf-8"?>
          <feed xmlns="http://www.w3.org/2005/Atom">
            <entry>
              <title>[调查] 大家都用的什么代理软件</title>
              <link rel="alternate" type="text/html" href="https://www.v2ex.com/t/1214608#reply177" />
              <published>2026-05-22T02:02:38Z</published>
              <updated>2026-05-23T19:31:33Z</updated>
              <author><name>haonanaaaaaa</name><uri>https://www.v2ex.com/member/haonanaaaaaa</uri></author>
              <content type="html">&lt;p&gt;代理软件讨论&lt;/p&gt;</content>
            </entry>
            <entry>
              <title>[程序员] Gemini 要重新做教育认证了</title>
              <link rel="alternate" type="text/html" href="https://www.v2ex.com/t/1212849#reply55" />
              <published>2026-05-15T01:02:35Z</published>
              <updated>2026-05-21T01:39:01Z</updated>
              <author><name>haonanaaaaaa</name><uri>https://www.v2ex.com/member/haonanaaaaaa</uri></author>
              <content type="html">&lt;p&gt;教育认证提醒&lt;/p&gt;</content>
            </entry>
          </feed>`, {
          headers: { 'content-type': 'application/atom+xml' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({ source: 'v2ex', id: 'haonanaaaaaa', username: 'haonanaaaaaa', fetcher });

    expect(profile.topics.map((topic) => topic.id)).toEqual(['1214608', '1212849']);
    expect(profile.topics[0]).toMatchObject({
      category: '调查',
      title: '大家都用的什么代理软件',
      excerpt: '代理软件讨论'
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toContain('https://www.v2ex.com/feed/member/haonanaaaaaa.xml');
  });

  it('orders all user profile topic lists by created time newest first', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({
          success: true,
          discussions: [
            { post_id: 101, title: 'NodeSeek older', time: { createdDate: '2026-05-20T00:00:00.000Z' } },
            { post_id: 102, title: 'NodeSeek newer', time: { createdDate: '2026-05-22T00:00:00.000Z' } }
          ]
        }));
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(JSON.stringify({
          user_summary: {
            user: { id: 7, username: 'alice', name: 'Alice' }
          },
          topics: [
            { id: 41, title: 'linux older', slug: 'linux-older', created_at: '2026-05-20T00:00:00.000Z', bumped_at: '2026-05-23T00:00:00.000Z', posts_count: 2 },
            { id: 42, title: 'linux newer', slug: 'linux-newer', created_at: '2026-05-22T00:00:00.000Z', posts_count: 1 }
          ]
        }));
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ id: 9, username: 'neo' }));
      }
      if (input === 'https://www.v2ex.com/member/neo') {
        return new Response(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/121#reply4">V2EX older</a></span>
            <span class="topic_info"><a class="node" href="/go/create">分享创造</a> · <strong><a href="/member/neo">neo</a></strong> · <span title="2026-05-20 10:00:00 +08:00">older</span></span>
          </div>
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/122#reply4">V2EX newer</a></span>
            <span class="topic_info"><a class="node" href="/go/create">分享创造</a> · <strong><a href="/member/neo">neo</a></strong> · <span title="2026-05-22 10:00:00 +08:00">newer</span></span>
          </div>
        `);
      }
      if (input.includes('yaohuo.me')) {
        return new Response(`
          <div class="content">昵称:火友<br/>发帖:3<br/>回帖:9</div>
          <div class="listdata"><a href="/bbs-66.html?classid=177">妖火 older</a>/火友/阅1/2026-05-20 10:00</div>
          <div class="listdata"><a href="/bbs-67.html?classid=177">妖火 newer</a>/火友/阅1/2026-05-22 10:00</div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });
    const linuxdo = await getUserProfile({ source: 'linuxdo', id: 'alice', username: 'alice', fetcher });
    const v2ex = await getUserProfile({ source: 'v2ex', id: 'neo', username: 'neo', fetcher });
    const yaohuo = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher, yaohuoCookie: 'sid=ok' });

    expect(nodeseek.topics.map((topic) => topic.id)).toEqual(['102', '101']);
    expect(linuxdo.topics.map((topic) => topic.id)).toEqual(['42', '41']);
    expect(v2ex.topics.map((topic) => topic.id)).toEqual(['122', '121']);
    expect(yaohuo.topics.map((topic) => topic.id)).toEqual(['67', '66']);
  });

  it('keeps untimed NodeSeek user profile posts untimed without opening topic details', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, discussions: [{ post_id: 101, title: 'NodeSeek topic', rank: 0 }] }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');

    expect(nodeseek.topics[0]).toMatchObject({
      id: '101'
    });
    expect(nodeseek.topics[0].createdAt).toBe('');
    expect(nodeseek.topics[0].lastReplyAt).toBe('');
    expect(calls).not.toContain('nodeseek.com/post-101-1');
    expect(calls).not.toContain('list-comments');
  });

  it('reads NodeSeek user profile JSON when hidden WebView wraps it in an HTML document', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/15105?readme=1')) {
        return new Response('<html><body><pre>{"success":true,"detail":{"member_name":"Bugs","member_id":15105}}</pre></body></html>', {
          headers: { 'content-type': 'text/html' }
        });
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=15105&page=1')) {
        return new Response('<html><body>{"success":true,"discussions":[{"post_id":746779,"title":"NodeSeek topic","time":{"createdDate":"2026-05-25T03:34:00.000Z"}}]}</body></html>', {
          headers: { 'content-type': 'text/html' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '15105', username: 'Bugs', fetcher });

    expect(nodeseek).toMatchObject({
      source: 'nodeseek',
      id: '15105',
      username: 'Bugs'
    });
    expect(nodeseek.topics[0]).toMatchObject({
      id: '746779',
      createdAt: '2026-05-25T03:34:00.000Z'
    });
  });

  it('reads NodeSeek user profile post times directly from nested discussion time', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({
          success: true,
          discussions: [{
            post_id: 101,
            title: 'NodeSeek topic',
            rank: 0,
            time: { createdDate: '2026-05-22T16:06:25.000Z' }
          }]
        }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');

    expect(nodeseek.topics[0]).toMatchObject({
      id: '101',
      createdAt: '2026-05-22T16:06:25.000Z',
      lastReplyAt: '2026-05-22T16:06:25.000Z'
    });
    expect(calls).not.toContain('nodeseek.com/post-101-1');
    expect(calls).not.toContain('list-comments');
  });

  it('keeps untimed NodeSeek user profile posts in their original list order', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({
          success: true,
          discussions: [
            { post_id: 101, title: 'NodeSeek first' },
            { post_id: 102, title: 'NodeSeek second' }
          ]
        }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });

    expect(nodeseek.topics.map((topic) => topic.id)).toEqual(['101', '102']);
    expect(nodeseek.topics.every((topic) => topic.createdAt === '' && topic.lastReplyAt === '')).toBe(true);
  });

  it('sorts timed NodeSeek user profile posts while preserving untimed post order', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({
          success: true,
          discussions: [
            { post_id: 101, title: 'NodeSeek older', time: { createdDate: '2026-05-20T00:00:00.000Z' } },
            { post_id: 102, title: 'NodeSeek untimed first' },
            { post_id: 103, title: 'NodeSeek newer', time: { createdDate: '2026-05-22T00:00:00.000Z' } },
            { post_id: 104, title: 'NodeSeek untimed second' }
          ]
        }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });

    expect(nodeseek.topics.map((topic) => topic.id)).toEqual(['103', '101', '102', '104']);
    expect(nodeseek.topics.slice(2).map((topic) => topic.createdAt)).toEqual(['', '']);
  });

  it('maps linux.do user profile topic categories through site categories', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/site.json')) {
        return new Response(JSON.stringify({
          categories: [{ id: 4, name: '开发调优' }]
        }));
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(JSON.stringify({
          user_summary: {
            user: { id: 7, username: 'alice', name: 'Alice' }
          },
          topics: [{
            id: 42,
            title: 'linux topic',
            slug: 'linux-topic',
            category_id: 4,
            created_at: '2026-05-20T00:00:00.000Z',
            posts_count: 1
          }]
        }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const linuxdo = await getUserProfile({ source: 'linuxdo', id: 'alice', username: 'alice', fetcher });

    expect(linuxdo.topics[0]).toMatchObject({
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('orders all-source Android search by time without using the project search endpoint', async () => {
    const manyNodeSeekTopics = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 4 }, (_, index) => ({
        postId: 100 + index,
        titleText: `match NodeSeek ${index}`,
        titleLink: `/post-${100 + index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
      }))
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do/search.json')) {
        return new Response(JSON.stringify({
          topics: [{
            id: 201,
            title: 'match linux.do',
            created_at: '2026-05-19T00:00:00.000Z',
            posts_count: 1
          }],
          posts: []
        }));
      }
      if (input.includes('sov2ex.com')) {
        return new Response(JSON.stringify({
          hits: [{
            _source: {
              id: 301,
              title: 'match V2EX',
              member: 'neo',
              created: '2026-05-18T00:00:00.000Z',
              replies: 0
            }
          }]
        }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await searchTopics({ source: 'all', query: 'match', limit: 6, fetcher });

    expect(result.items.map((item) => item.source)).toEqual(['nodeseek', 'nodeseek', 'nodeseek', 'nodeseek', 'linuxdo', 'v2ex']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).not.toMatch(/127\.0\.0\.1(?::3000)?\/api\/search|10\.0\.2\.2(?::3000)?\/api\/search|localhost(?::3000)?\/api\/search/);
    expect(calls).not.toMatch(/127\.0\.0\.1(?::3000)?\/api\/yaohuo\/parse\/search|10\.0\.2\.2(?::3000)?\/api\/yaohuo\/parse\/search|localhost(?::3000)?\/api\/yaohuo\/parse\/search/);
  });

  it('orders all-source Android search by topic creation time newest first', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${Buffer.from(JSON.stringify({
          rotateTopics: [{
            postId: 100,
            titleText: 'match NodeSeek older',
            titleLink: '/post-100-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:00:00.000Z' }
          }]
        })).toString('base64')}</script>`);
      }
      if (input.includes('linux.do/search.json')) {
        return new Response(JSON.stringify({
          topics: [{
            id: 201,
            title: 'match linux.do newest',
            created_at: '2026-05-21T00:00:00.000Z',
            bumped_at: '2026-05-18T00:00:00.000Z',
            posts_count: 1
          }],
          posts: []
        }));
      }
      if (input.includes('sov2ex.com')) {
        return new Response(JSON.stringify({
          hits: [{
            _source: {
              id: 301,
              title: 'match V2EX middle',
              member: 'neo',
              created: '2026-05-20T00:00:00.000Z',
              replies: 0
            }
          }]
        }));
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await searchTopics({ source: 'all', query: 'match', limit: 3, fetcher });

    expect(result.items.map((item) => item.source)).toEqual(['linuxdo', 'v2ex', 'nodeseek']);
  });

  it('keeps all-source Android feed balanced across local source adapters', async () => {
    clearV2exCacheForTest();
    const manyNodeSeekTopics = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 4 }, (_, index) => ({
        postId: 200 + index,
        titleText: `NodeSeek ${index}`,
        titleLink: `/post-${200 + index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
      }))
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({
          topic_list: {
            topics: [{
              id: 301,
              title: 'linux.do topic',
              slug: 'linux-topic',
              created_at: '2026-05-19T00:00:00.000Z',
              bumped_at: '2026-05-19T00:00:00.000Z',
              posts_count: 1
            }]
          },
          users: []
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/topics/latest.json')) {
        return new Response(JSON.stringify([{
          id: 401,
          title: 'V2EX topic',
          url: 'https://www.v2ex.com/t/401',
          created: '2026-05-18T00:00:00.000Z',
          replies: 0,
          node: { name: 'create', title: '分享创造' },
          member: { username: 'neo' }
        }]), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/recent?p=1')) {
        return new Response('');
      }
      throw new Error(`unexpected ${input}`);
    });

    const result = await getFeed({ source: 'all', limit: 3, fetcher });

    expect(result.items.map((item) => item.source)).toEqual(['nodeseek', 'linuxdo', 'v2ex']);
  });

  it('keeps yaohuo facade fallbacks local without fetching', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('unexpected fetch');
    });

    const feed = await getFeed({ source: 'yaohuo', fetcher });
    const categories = await getCategories({ source: 'yaohuo', fetcher });
    const search = await searchTopics({ source: 'yaohuo', query: 'test', fetcher });

    expect(feed).toMatchObject({ items: [], hasMore: false, nextPage: null });
    expect(feed.errors.yaohuo).toBe('请先登录妖火');
    expect(categories.items[0]).toMatchObject({ source: 'yaohuo' });
    expect(search).toMatchObject({ items: [] });
    expect(search.errors.yaohuo).toBe('请先登录妖火');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps overflow items available when paginating the aggregated Android feed', async () => {
    clearV2exCacheForTest();
    const manyNodeSeekTopics = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 4 }, (_, index) => ({
        postId: 100 + index,
        titleText: `NodeSeek ${index + 1}`,
        titleLink: `/post-${100 + index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
      }))
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/page-2')) {
        return new Response('<script></script>');
      }
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
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
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['103', '102']);
    expect(second.items.map((item) => item.id)).toEqual(['101', '100']);
    expect(second.items.every((item) => item.source === 'nodeseek')).toBe(true);
  });

  it('keeps NodeSeek next pages available in the aggregated Android feed when the first source page is shorter than the aggregate fetch window', async () => {
    clearV2exCacheForTest();
    const pageOne = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 201, titleText: 'NodeSeek page 1 newer', titleLink: '/post-201-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:01:00.000Z' } },
        { postId: 200, titleText: 'NodeSeek page 1 older', titleLink: '/post-200-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:00:00.000Z' } }
      ]
    })).toString('base64');
    const pageTwo = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 199, titleText: 'NodeSeek page 2 newer', titleLink: '/post-199-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:01:00.000Z' } },
        { postId: 198, titleText: 'NodeSeek page 2 older', titleLink: '/post-198-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:00:00.000Z' } }
      ]
    })).toString('base64');
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
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['201', '200']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['199', '198']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.nodeseek.com/page-2');
  });

  it('keeps V2EX next pages available in the aggregated Android feed when latest JSON exactly fills one app page', async () => {
    clearV2exCacheForTest();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response('<script></script>');
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/topics/latest.json')) {
        return new Response(JSON.stringify([
          { id: 301, title: 'V2EX latest newer', url: 'https://www.v2ex.com/t/301', created: 1780000100, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } },
          { id: 300, title: 'V2EX latest older', url: 'https://www.v2ex.com/t/300', created: 1780000000, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } }
        ]));
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
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['301', '300']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['299', '298']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('refills an exhausted source in the aggregated Android feed even when other source buffers can fill the page', async () => {
    clearV2exCacheForTest();
    const nodeSeekPage = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 400, titleText: 'NodeSeek newest', titleLink: '/post-400-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:04:30.000Z' } },
        { postId: 399, titleText: 'NodeSeek buffered newer', titleLink: '/post-399-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:03:00.000Z' } },
        { postId: 398, titleText: 'NodeSeek buffered older', titleLink: '/post-398-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:01:00.000Z' } },
        { postId: 397, titleText: 'NodeSeek buffered oldest', titleLink: '/post-397-1', op: { name: 'alice' }, time: { createdDate: '2026-05-19T00:00:00.000Z' } }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('/api/topics/latest.json')) {
        return new Response(JSON.stringify([
          { id: 501, title: 'V2EX latest newest', url: 'https://www.v2ex.com/t/501', created: 1780000500, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } },
          { id: 500, title: 'V2EX latest older', url: 'https://www.v2ex.com/t/500', created: 1780000400, replies: 0, node: { name: 'create', title: '分享创造' }, member: { username: 'neo' } }
        ]));
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
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:501', 'nodeseek:400']);
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:500', 'nodeseek:399']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });
});
