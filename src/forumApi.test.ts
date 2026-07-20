import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getCategories, getCurrentUserProfile, getFeed, getReplies, getReply, getTopic, getUserProfile, searchTopics } from './forumApi';
import { browserFetchIntentFromInit } from './browserFetchIntent';
import { sourceDiagnosticSummary } from './sourceAdapterDiagnostics';
import * as SecureStore from 'expo-secure-store';

const nodeSeekPayload = Buffer.from(JSON.stringify({
  rotateTopics: [{ postId: 1, titleText: 'NodeSeek', titleLink: '/post-1-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:00:00.000Z' } }],
  allCategory: [{ key: 'tech', cn_text: '技术' }]
})).toString('base64');

describe('Android local forum facade', () => {
  beforeEach(() => {
    vi.mocked(SecureStore.getItemAsync).mockReset();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  });

  function mockStoredLinuxDoLoginAccess() {
    vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key: string) => (
      key === 'linuxdo-clearance'
        ? JSON.stringify({
          cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
          savedAt: '2026-05-26T00:00:00.000Z',
          source: 'webview',
          userAgent: 'LinuxDo WebView UA'
        })
        : null
    ));
  }

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
    const nodeSeekFeedCall = (fetcher.mock.calls as unknown as Array<[string, RequestInit?]>)
      .find(([input]) => input.includes('nodeseek.com/categories/tech/page-2'));
    expect(browserFetchIntentFromInit(nodeSeekFeedCall?.[1])).toMatchObject({
      owner: 'feed',
      priority: 'background',
      cancelable: true
    });
  });

  it('passes no-cache through NodeSeek topic and reply reads', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 101,
        title: 'NodeSeek topic',
        comments: [
          { commentId: 100, poster: { name: 'alice' }, markdown: '正文' },
          { commentId: 101, poster: { name: 'bob' }, markdown: '回复' }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>${payload}</script>`));

    await getTopic({ source: 'nodeseek', id: '101', fetcher, nocache: true });
    await getReplies({ source: 'nodeseek', id: '101', page: 1, fetcher, nocache: true });

    const calls = fetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
    for (const [, init] of calls) {
      expect(init?.headers).toMatchObject({
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      });
      expect(browserFetchIntentFromInit(init)).toMatchObject({
        owner: 'topic',
        priority: 'foreground',
        cancelable: true
      });
    }
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

  it('does not return a different linux.do post when the quoted floor is missing', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/t/42.json')) {
        return new Response(JSON.stringify({
          id: 42,
          title: 'linux.do',
          created_at: '2026-05-20T00:00:00.000Z',
          post_stream: {
            stream: [100, 101],
            posts: []
          }
        }));
      }
      return new Response(JSON.stringify({
        post_stream: {
          posts: [{ id: 101, post_number: 99, username: 'wrong', cooked: '<p>wrong</p>', created_at: '2026-05-20T00:01:00.000Z' }]
        }
      }));
    });

    await expect(getReply({ source: 'linuxdo', id: '42', floor: 2, fetcher })).rejects.toThrow('引用楼层未找到');
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

  it('includes the registered yaohuo adapter in authenticated aggregate search', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('yaohuo.me')) {
        return new Response('<div class="listdata"><a href="/bbs-321.html">妖火聚合结果</a>/alice/阅1/05-20 10:00</div>');
      }
      throw new Error('other source unavailable');
    });

    const result = await searchTopics({
      source: 'all',
      query: '妖火聚合',
      yaohuoCookie: 'sidyaohuo=secret',
      fetcher
    });

    expect(result.items).toEqual([
      expect.objectContaining({ source: 'yaohuo', id: '321', title: '妖火聚合结果' })
    ]);
  });

  it('routes user profile reads to each public source site', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872, readme: 'bio', rank: 6, avatar: '/avatar/48872.png' } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, discussions: [{ post_id: 101, title: 'NodeSeek topic', rank: 0, tag_name: 'daily', tag_cn_text: '日常', text: 'NodeSeek topic excerpt' }] }));
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, comments: [{ post_id: 101, title: 'NodeSeek topic', floor_id: 2, text: 'NodeSeek reply' }] }));
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(JSON.stringify({
          user_summary: {
            user: { id: 7, username: 'alice', name: 'Alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png' },
            topic_count: 2,
            post_count: 8
          },
          users: [{ id: 7, username: 'alice', trust_level: 2 }],
          topics: [{ id: 42, title: 'linux topic', slug: 'linux-topic', created_at: '2026-05-20T00:00:00.000Z', posts_count: 1 }]
        }));
      }
      if (input.includes('linux.do/user_actions.json') && input.includes('username=alice') && input.includes('filter=5')) {
        return new Response(JSON.stringify({
          user_actions: [{
            excerpt: 'linux reply excerpt',
            created_at: '2026-05-20T01:00:00.000Z',
            slug: 'linux-topic',
            topic_id: 42,
            post_number: 3,
            post_id: 1003,
            title: 'linux topic',
            category_id: 1
          }]
        }));
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ id: 9, username: 'neo', avatar_large: '//cdn.v2ex.com/avatar.png', tagline: 'hello', pro: 1 }));
      }
      if (input.includes('v2ex.com/member/neo/topics')) {
        return new Response('<div class="cell item"><a class="topic-link" href="/t/121">V2EX topic</a><a class="node" href="/go/create">分享创造</a><span title="2026-05-20 10:00:00"></span></div>');
      }
      if (input.includes('v2ex.com/member/neo/replies')) {
        return new Response(`
          <div class="cell ps_container"><a href="?p=1">1</a><a href="?p=2">2</a></div>
          <div class="dock_area">5 月 20 日回复了 alice 创建的主题 › 分享创造 › <a href="/t/121#reply4">V2EX topic</a></div>
        `);
      }
      if (input.includes('yaohuo.me')) {
        if (input.includes('book_re_my.aspx')) {
          return new Response('<div>火友 (7) #2 妖火回复内容。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div><a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7&page=2">下一页</a>');
        }
        return new Response('<div class="content">昵称:火友<br/>1万妖晶2级等级7年注册时长<br/>发帖:3<br/>回帖:9 <a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复(9)</a></div><div class="listdata"><a href="/bbs-66.html?classid=177">妖火主题</a>/火友/阅1/2026-05-20 10:30</div>');
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
    expect(sourceDiagnosticSummary(nodeseek)).toMatchObject({ parserVariant: 'api-user', partialErrorCount: 0 });
    expect(sourceDiagnosticSummary(linuxdo)).toMatchObject({ parserVariant: 'discourse-user', partialErrorCount: 0 });
    expect(sourceDiagnosticSummary(v2ex)).toMatchObject({ parserVariant: 'api-user', partialErrorCount: 0 });
    expect(sourceDiagnosticSummary(yaohuo)).toMatchObject({ parserVariant: 'html-user', partialErrorCount: 0 });
    expect(nodeseek.levelLabel).toBe('Lv6');
    expect(linuxdo.levelLabel).toBe('Lv2');
    expect(linuxdo.topics[0].authorLevelLabel).toBe('Lv2');
    expect(v2ex.levelLabel).toBe('Pro');
    expect(yaohuo.levelLabel).toBe('2级');
    expect(yaohuo.topics[0].authorLevelLabel).toBe('2级');
    expect(nodeseek.topics[0]).toMatchObject({
      source: 'nodeseek',
      id: '101',
      title: 'NodeSeek topic',
      author: '我是ikun',
      authorId: '48872',
      authorAvatar: 'https://www.nodeseek.com/avatar/48872.png',
      authorUrl: 'https://www.nodeseek.com/space/48872',
      categoryId: 'daily',
      category: '日常',
      url: 'https://www.nodeseek.com/post-101-1',
      replyCount: 0,
      excerpt: 'NodeSeek topic excerpt'
    });
    expect(linuxdo.topics[0]).toMatchObject({
      source: 'linuxdo',
      id: '42',
      title: 'linux topic',
      author: 'alice',
      authorId: 'alice',
      authorAvatar: 'https://linux.do/user_avatar/linux.do/alice/96/1_2.png',
      authorUrl: 'https://linux.do/u/alice',
      url: 'https://linux.do/t/linux-topic/42',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 0
    });
    expect(v2ex.topics[0]).toMatchObject({
      source: 'v2ex',
      id: '121',
      title: 'V2EX topic',
      author: 'neo',
      authorId: 'neo',
      authorAvatar: 'https://cdn.v2ex.com/avatar.png',
      authorUrl: 'https://www.v2ex.com/member/neo',
      category: '分享创造',
      url: 'https://www.v2ex.com/t/121',
      createdAt: '2026-05-20T02:00:00.000Z',
      replyCount: 0
    });
    expect(yaohuo.topics[0]).toMatchObject({
      source: 'yaohuo',
      id: '66',
      title: '妖火主题',
      author: '火友',
      authorId: '7',
      authorUrl: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7',
      categoryId: '177',
      category: '妖火茶馆',
      url: 'https://www.yaohuo.me/bbs-66.html?classid=177',
      createdAt: '2026-05-20T02:30:00.000Z',
      displayTimeText: '2026-05-20 10:30',
      replyCount: 0
    });
    expect(nodeseek.replies?.[0]).toMatchObject({
      source: 'nodeseek',
      id: '101:2:NodeSeek reply',
      topicId: '101',
      topicTitle: 'NodeSeek topic',
      topicUrl: 'https://www.nodeseek.com/post-101-1',
      url: 'https://www.nodeseek.com/post-101-1',
      author: '我是ikun',
      authorId: '48872',
      authorAvatar: 'https://www.nodeseek.com/avatar/48872.png',
      authorUrl: 'https://www.nodeseek.com/space/48872',
      floor: 2,
      excerpt: 'NodeSeek reply'
    });
    expect(linuxdo.replies?.[0]).toMatchObject({
      source: 'linuxdo',
      id: '1003',
      topicId: '42',
      topicTitle: 'linux topic',
      topicUrl: 'https://linux.do/t/linux-topic/42',
      url: 'https://linux.do/t/linux-topic/42/3',
      author: 'alice',
      authorId: 'alice',
      authorAvatar: 'https://linux.do/user_avatar/linux.do/alice/96/1_2.png',
      authorUrl: 'https://linux.do/u/alice',
      categoryId: '1',
      floor: 3,
      excerpt: 'linux reply excerpt',
      createdAt: '2026-05-20T01:00:00.000Z'
    });
    expect(v2ex.replies?.[0]).toMatchObject({
      source: 'v2ex',
      id: '121:4',
      topicId: '121',
      topicTitle: 'V2EX topic',
      topicUrl: 'https://www.v2ex.com/t/121',
      url: 'https://www.v2ex.com/t/121#reply4',
      author: 'neo',
      authorId: 'neo',
      authorUrl: 'https://www.v2ex.com/member/neo',
      category: '分享创造',
      floor: 4,
      createdAt: '2026-05-20T00:00:00.000Z',
      displayTimeText: '5 月 20 日'
    });
    expect(yaohuo.replies?.[0]).toMatchObject({
      source: 'yaohuo',
      id: '66:2:2026-05-20T02:30:00.000Z',
      topicId: '66',
      topicTitle: '查看原帖',
      topicUrl: 'https://www.yaohuo.me/bbs-66.html',
      url: 'https://www.yaohuo.me/bbs-66.html',
      author: '火友',
      authorId: '7',
      authorUrl: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7',
      floor: 2,
      excerpt: '妖火回复内容。',
      createdAt: '2026-05-20T02:30:00.000Z',
      displayTimeText: '2026-05-20 10:30'
    });
    expect(yaohuo.nextRepliesCursor).toContain('page=2');
  });

  it('keeps four-site user subrequest degradation out of the response while exposing a safe summary', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/1?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: 'node', member_id: 1 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions')) {
        return new Response(JSON.stringify({ success: true, discussions: [] }));
      }
      if (input.includes('nodeseek.com/api/content/list-comments')) {
        throw new Error('comments unavailable');
      }
      if (input.includes('linux.do/u/linux/summary.json')) {
        return new Response(JSON.stringify({ user_summary: { user: { username: 'linux' } }, topics: [] }));
      }
      if (input.includes('linux.do/user_actions.json')) {
        throw new Error('actions unavailable');
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ username: 'v2' }));
      }
      if (input.includes('v2ex.com/member/v2/topics')) {
        return new Response('<div class="empty-state">empty</div>');
      }
      if (input.includes('v2ex.com/feed/member/v2.xml')) {
        return new Response('');
      }
      if (input.includes('v2ex.com/member/v2/replies')) {
        throw new Error('replies unavailable');
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response('<div class="content">昵称:火友 <a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复</a></div>');
      }
      if (input.includes('book_re_my.aspx')) {
        throw new Error('activity unavailable');
      }
      throw new Error(`unexpected ${input}`);
    });

    const profiles = await Promise.all([
      getUserProfile({ source: 'nodeseek', id: '1', fetcher }),
      getUserProfile({ source: 'linuxdo', id: 'linux', fetcher }),
      getUserProfile({ source: 'v2ex', id: 'v2', fetcher }),
      getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher, yaohuoCookie: 'sid=ok' })
    ]);

    expect(profiles.map((profile) => sourceDiagnosticSummary(profile)?.partialErrorCount)).toEqual([1, 1, 1, 1]);
    expect(profiles.every((profile) => sourceDiagnosticSummary(profile)?.hasDegradation)).toBe(true);
    expect(profiles.every((profile) => !('diagnostic' in profile))).toBe(true);
  });

  it('loads user replies from each source reply cursor', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=2')) {
        return new Response(JSON.stringify({ success: true, comments: [{ post_id: 102, title: 'NodeSeek next', floor_id: 5, text: 'next reply' }] }));
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(JSON.stringify({ user_summary: { user: { username: 'alice' } } }));
      }
      if (input.includes('linux.do/user_actions.json') && input.includes('offset=30')) {
        return new Response(JSON.stringify({ user_actions: [{ excerpt: 'linux next', created_at: '2026-05-21T01:00:00.000Z', slug: 'next', topic_id: 43, post_number: 4, post_id: 1004, title: 'linux next' }] }));
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ username: 'neo' }));
      }
      if (input.includes('v2ex.com/member/neo/replies?p=2')) {
        return new Response('<div class="dock_area">2 分钟前回复了 bob 创建的主题 › 问与答 › <a href="/t/122#reply8">V2EX next</a></div>');
      }
      if (input.includes('yaohuo.me/bbs/book_re_my.aspx') && input.includes('page=2')) {
        return new Response('<div>火友 (7) #3 妖火下一页。 2026-05-21 10:30 <a href="/bbs-67.html">查看</a></div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', cursor: '2', cursorType: 'replies', fetcher })).resolves.toMatchObject({
      replies: [{ topicId: '102', floor: 5 }],
      nextRepliesCursor: '3'
    });
    await expect(getUserProfile({ source: 'linuxdo', id: 'alice', username: 'alice', cursor: '30', cursorType: 'replies', fetcher })).resolves.toMatchObject({
      replies: [{ topicId: '43', floor: 4 }],
      nextRepliesCursor: '60'
    });
    await expect(getUserProfile({ source: 'v2ex', id: 'neo', username: 'neo', cursor: '2', cursorType: 'replies', fetcher })).resolves.toMatchObject({
      replies: [{ topicId: '122', floor: 8, author: 'neo', authorId: 'neo', authorUrl: 'https://www.v2ex.com/member/neo', displayTimeText: '2 分钟前' }]
    });
    await expect(getUserProfile({ source: 'yaohuo', id: '7', username: '火友', cursor: 'https://www.yaohuo.me/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7&page=2', cursorType: 'replies', fetcher, yaohuoCookie: 'sid=ok' })).resolves.toMatchObject({
      replies: [{ topicId: '67', floor: 3 }],
      hasMoreReplies: false
    });
  });

  it('reads current logged-in users for account status without V2EX', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/api/account/getInfo?readme=1') {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872, avatar: '/avatar/48872.png' } }));
      }
      if (input === 'https://www.nodeseek.com/') {
        return new Response('<a href="/space/48872"><img src="/avatar/48872.png" alt="我是ikun" /></a>');
      }
      if (input === 'https://linux.do/session/current.json') {
        return new Response(JSON.stringify({
          current_user: {
            username: 'alice',
            name: 'Alice',
            avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png',
            trust_level: 2
          }
        }));
      }
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response('<div class="top">欢迎 <a href="/bbs/userinfo.aspx?touserid=7">火友</a></div>');
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response('<div>昵称：火友</div><div>主题 0 回复 0</div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=ok' });
    const linuxdo = await getCurrentUserProfile({
      source: 'linuxdo',
      fetcher,
      discourseAuth: { linuxdo: { cookieHeader: '_t=ok' } }
    });
    const yaohuo = await getCurrentUserProfile({ source: 'yaohuo', fetcher, yaohuoCookie: 'sidyaohuo=ok' });

    expect(nodeseek).toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '我是ikun',
      url: 'https://www.nodeseek.com/space/48872',
      topics: []
    });
    expect(linuxdo).toMatchObject({
      source: 'linuxdo',
      id: 'alice',
      username: 'alice',
      displayName: 'Alice',
      levelLabel: 'Lv2',
      topics: []
    });
    expect(yaohuo).toMatchObject({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7',
      topics: []
    });
    expect(() => getCurrentUserProfile({ source: 'v2ex', fetcher })).toThrow('V2EX 不支持当前登录身份读取');
  });

  it('falls back to the latest dynamic NodeSeek login id only when current account reading fails', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/api/account/getInfo?readme=1') {
        return new Response('{}');
      }
      if (input === 'https://www.nodeseek.com/') {
        return new Response('<div>NodeSeek</div>');
      }
      if (input === 'https://www.nodeseek.com/api/account/getInfo/15105?readme=1') {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '备用用户', member_id: 15105 } }));
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=ok' })).rejects.toThrow('无法读取当前 NodeSeek 用户身份');
    await expect(getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=ok', nodeSeekUserId: 15105 })).resolves.toMatchObject({
      source: 'nodeseek',
      id: '15105',
      username: '备用用户',
      topics: []
    });
  });

  it('does not read the fallback NodeSeek id when the current account endpoint succeeds', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/api/account/getInfo?readme=1') {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '当前账号', member_id: 48872 } }));
      }
      if (input === 'https://www.nodeseek.com/api/account/getInfo/15105?readme=1') {
        throw new Error('stale fallback id should not be requested');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({
      source: 'nodeseek',
      fetcher,
      nodeSeekCookie: 'session=ok',
      nodeSeekUserId: 15105
    })).resolves.toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '当前账号',
      topics: []
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reads the current NodeSeek account from settings when the home page has no user link', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/api/account/getInfo?readme=1') {
        return new Response('{}');
      }
      if (input === 'https://www.nodeseek.com/') {
        return new Response('<div>NodeSeek</div>');
      }
      if (input === 'https://www.nodeseek.com/setting') {
        return new Response('<main>UID: 15105 <a href="/space/15105">新账号</a></main>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=ok' })).resolves.toMatchObject({
      source: 'nodeseek',
      id: '15105',
      username: '新账号',
      topics: []
    });
  });

  it('reads the current NodeSeek account from embedded page config', async () => {
    const payload = Buffer.from(JSON.stringify({
      user: {
        member_id: 48872,
        member_name: '凡想世界',
        avatar: '/avatar/48872.png'
      }
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/api/account/getInfo?readme=1') {
        return new Response('{}');
      }
      if (input === 'https://www.nodeseek.com/') {
        return new Response(`<script id="temp-script">${payload}</script>`);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=ok' })).resolves.toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '凡想世界',
      topics: []
    });
  });

  it('does not read the current NodeSeek account from sign-out-adjacent post author links', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.nodeseek.com/api/account/getInfo?readme=1') {
        return new Response('{}');
      }
      if (input === 'https://www.nodeseek.com/') {
        return new Response(`
          <a href="/space/4706">帖子作者</a>
          <a href="/setting"></a>
          <a href="/api/account/signOut"></a>
        `);
      }
      if (input === 'https://www.nodeseek.com/setting') {
        return new Response('<main>设置页面</main>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'nodeseek', fetcher, nodeSeekCookie: 'session=ok' })).rejects.toThrow('无法读取当前 NodeSeek 用户身份');
  });

  it('reads the current yaohuo account name from the signed-in user topic list when the profile only exposes an id', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/wapindex.aspx?sid=-2') {
        return new Response('<div class="top"><a href="/bbs/userinfo.aspx?touserid=45245">我的地盘</a> <a href="/bbs/logout.aspx">退出</a></div>');
      }
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=45245&siteid=1000') {
        return new Response(`
          <div class="content">用户:45245人气值1空间人气1今日人气留言板</div>
          <div class="content">
            <a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=45245&type=pub">贴子(1)</a>
            <a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=45245">回复(1)</a>
          </div>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=45245&type=pub') {
        return new Response('<div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=177&id=1">主题</a>/流金岁月/阅1/2026-05-20 10:00</div>');
      }
      if (input === 'https://www.yaohuo.me/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=45245') {
        return new Response('<div>45245 #71 阿根廷没问题。 2026-07-03 13:45 <a href="/bbs-66.html">查看</a></div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getCurrentUserProfile({ source: 'yaohuo', fetcher, yaohuoCookie: 'sidyaohuo=ok' })).resolves.toMatchObject({
      source: 'yaohuo',
      id: '45245',
      username: '流金岁月',
      displayName: '流金岁月',
      topics: [],
      replies: [{
        author: '流金岁月',
        authorId: '45245',
        floor: 71,
        excerpt: '阿根廷没问题。',
        displayTimeText: '2026-07-03 13:45'
      }]
    });
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

  it('reads yaohuo user topics from the profile post list link instead of activity links', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response(`
          <div class="content">昵称:火友<br/><a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub">贴子(2)</a>.<a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复(9)</a></div>
          <div class="title"><b>=TA的动态=</b><a href="/bbs/book_list_log.aspx?action=my&siteid=1000&classid=0&touserid=7">更多&gt;&gt;</a></div>
          <div class="content">6小时前正在论坛查询标题:<a href="/bbs/book_list_log.aspx?action=my&siteid=1000&classid=0&touserid=7&page=2">查看更多动态</a></div>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub') {
        return new Response(`
          <div class="listdata"><a href="/bbs-66.html?classid=177">妖火第一页</a>/火友/阅1/2026-05-20 10:00</div>
          <div class="listdata"><a href="/bbs-67.html?classid=177">妖火第二页</a>/火友/阅1/2026-05-21 10:00</div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher, yaohuoCookie: 'sid=ok' });

    expect(profile.topicCount).toBe(2);
    expect(profile.topics.map((topic) => topic.id)).toEqual(['67', '66']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub');
    expect(calls).not.toContain('book_list_log.aspx');
  });

  it('returns a yaohuo user profile topic cursor when more pages remain', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => `
      <div class="listdata"><a href="/bbs-${100 + index}.html?classid=177">妖火第${index}条</a>/火友/阅1/2026-05-20 10:${String(index).padStart(2, '0')}</div>
    `).join('');
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000') {
        return new Response(`
          <div class="content">昵称:火友<br/><a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub">贴子(31)</a>.<a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复(9)</a></div>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub') {
        return new Response(`
          ${rows}
          <a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub&page=2">下一页</a>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7') {
        return new Response('');
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher, yaohuoCookie: 'sid=ok' });

    expect(profile.topics).toHaveLength(30);
    expect(profile).toMatchObject({
      hasMoreTopics: true,
      nextTopicsCursor: 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub&page=2'
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps yaohuo user profile names out of activity text and reads the real post list', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=36925&siteid=1000') {
        return new Response(`
          <div class="content">用户:369256小时前正在论坛查询标题:醒图7小时前<a href="/bbs/book_list_log.aspx?action=my&siteid=1000&classid=0&touserid=36925&page=2">查看更多动态</a>人气值4,443空间人气6今日人气留言板</div>
          <div class="content"><b>昵称:</b>李慕婉o<br/><a href="/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=36925&type=pub">贴子(1659)</a>.<a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=36925">回复(222)</a></div>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=36925&type=pub') {
        return new Response(`
          <div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=201&id=1540797">Hypic醒图国际版 v8.7.0 免登录使用所有特权</a>/李慕婉o/阅1/2026-05-28 23:31</div>
          <div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=201&id=1540798">第二个帖子</a>/李慕婉o/阅1/2026-05-28 23:32</div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({ source: 'yaohuo', id: '36925', username: '李慕婉o', fetcher, yaohuoCookie: 'sid=ok' });

    expect(profile.displayName).toBe('李慕婉o');
    expect(profile.topicCount).toBe(1659);
    expect(profile.replyCount).toBe(222);
    expect(profile.topics[0]).toMatchObject({
      id: '1540798',
      author: '李慕婉o'
    });
    expect(profile.topics.map((topic) => topic.id)).toEqual(['1540798', '1540797']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=36925&type=pub');
    expect(calls).not.toContain('book_list_log.aspx');
  });

  it('reads yaohuo user topics from the current profile post link and keeps pagination', async () => {
    const firstRows = Array.from({ length: 15 }, (_, index) => `
      <div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=201&id=${1540797 + index}">妖火资源 ${index}</a>/李慕婉o/阅1/2026-05-28 23:${String(index).padStart(2, '0')}</div>
    `).join('');
    const secondRows = Array.from({ length: 15 }, (_, index) => `
      <div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=201&id=${1540812 + index}">妖火资源 ${index + 15}</a>/李慕婉o/阅1/2026-05-29 00:${String(index).padStart(2, '0')}</div>
    `).join('');
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=36925&siteid=1000') {
        return new Response(`
          <div class="uinfo">
            <div class="username">李慕婉o</div>
            <a class="uinfo-stat posts" href="/bbs/book_list_search.aspx?action=search&key=36925&type=pub">
              <div class="label">帖子</div><div class="value">1659</div>
            </a>
            <a class="uinfo-stat replies" href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=36925">
              <div class="label">回复</div><div class="value">222</div>
            </a>
          </div>
          <div class="content">用户:369256小时前正在论坛查询标题:醒图7小时前<a href="/bbs/book_list_log.aspx?action=my&siteid=1000&classid=0&touserid=36925&page=2">查看更多动态</a></div>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&key=36925&type=pub') {
        return new Response(`
          ${firstRows}
          <a href="/bbs/book_list_search.aspx?action=search&siteid=1000&classid=0&type=pub&key=36925&getTotal=1659&page=2">下一页</a>
        `);
      }
      if (input === 'https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&siteid=1000&classid=0&type=pub&key=36925&getTotal=1659&page=2') {
        return new Response(`
          ${secondRows}
          <a href="/bbs/book_list_search.aspx?action=search&siteid=1000&classid=0&type=pub&key=36925&getTotal=1659&page=3">下一页</a>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({ source: 'yaohuo', id: '36925', username: '李慕婉o', fetcher, yaohuoCookie: 'sid=ok' });

    expect(profile.displayName).toBe('李慕婉o');
    expect(profile.topicCount).toBe(1659);
    expect(profile.replyCount).toBe(222);
    expect(profile.topics).toHaveLength(30);
    expect(profile.topics[0]).toMatchObject({ id: '1540826', author: '李慕婉o' });
    expect(profile).toMatchObject({
      hasMoreTopics: true,
      nextTopicsCursor: 'https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&siteid=1000&classid=0&type=pub&key=36925&getTotal=1659&page=3'
    });
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&key=36925&type=pub');
    expect(calls).not.toContain('book_list_log.aspx');
  });

  it('loads yaohuo user profile topics from the next topic cursor', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub&page=2') {
        return new Response(`
          <div class="listdata"><a href="/bbs-130.html?classid=177">妖火下一页</a>/火友/阅1/2026-05-21 10:00</div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      fetcher,
      yaohuoCookie: 'sid=ok',
      cursor: 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub&page=2'
    });

    expect(profile.topics.map((topic) => topic.id)).toEqual(['130']);
    expect(profile.hasMoreTopics).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not send yaohuo cookies to an off-site user topic cursor', async () => {
    const fetcher = vi.fn(async () => new Response(''));

    await expect(getUserProfile({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      fetcher,
      yaohuoCookie: 'sid=ok',
      cursor: 'https://evil.example/bbs/book_list.aspx?page=2'
    })).rejects.toThrow('妖火链接不属于 www.yaohuo.me');

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads V2EX user topics from the public member page and orders them newest first', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ id: 683966, username: 'haonanaaaaaa', avatar_large: 'https://cdn.v2ex.com/avatar.png' }));
      }
      if (input === 'https://www.v2ex.com/member/haonanaaaaaa/topics') {
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
        return new Response('<h1>haonanaaaaaa</h1>');
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
      if (input === 'https://www.v2ex.com/member/neo/topics') {
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

  it('[REG-WRITE-007] keeps untimed NodeSeek profile reads free of vote-only headers', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, discussions: [{ post_id: 101, title: 'NodeSeek topic', rank: 0 }] }));
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, comments: [] }));
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
    expect(calls).toContain('list-comments');
    expect(fetcher.mock.calls.every(([, init]) => (
      new Headers(init?.headers).get('x-dynamic-sign') === null
    ))).toBe(true);
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
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=1')) {
        return new Response(JSON.stringify({ success: true, comments: [] }));
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
    expect(calls).toContain('list-comments');
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
    mockStoredLinuxDoLoginAccess();
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
      if (input.includes('linux.do/session/csrf.json')) {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }));
      }
      if (input.includes('linux.do/search?')) {
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
    mockStoredLinuxDoLoginAccess();
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
      if (input.includes('linux.do/session/csrf.json')) {
        return new Response(JSON.stringify({ csrf: 'csrf-token' }));
      }
      if (input.includes('linux.do/search?')) {
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
      if (input === 'https://www.v2ex.com/?tab=all') {
        return new Response(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/401#reply0">V2EX topic</a></span>
            <span class="topic_info"><a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp; <strong><a href="/member/neo">neo</a></strong> &nbsp;•&nbsp; <span title="2026-05-18 08:00:00 +08:00"></span></span>
          </div>
        `);
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

  it('keeps only yaohuo categories and user profiles on the shared forum facade', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('unexpected fetch');
    });

    const categories = await getCategories({ source: 'yaohuo', fetcher });

    await expect(getFeed({ source: 'yaohuo', fetcher })).rejects.toThrow('来源不支持');
    expect(() => getTopic({ source: 'yaohuo', id: '1', fetcher })).toThrow('来源不支持');
    expect(() => getReplies({ source: 'yaohuo', id: '1', page: 1, fetcher })).toThrow('来源不支持');
    await expect(searchTopics({ source: 'yaohuo', query: 'test', fetcher })).rejects.toThrow('来源不支持');
    expect(categories.items[0]).toMatchObject({ source: 'yaohuo' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps overflow items available when paginating the aggregated Android feed', async () => {
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
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['301', '300']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['299', '298']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not over-fetch linux.do pages for the first aggregated Android feed page', async () => {
    const nodeSeekPage = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 30 }, (_item, index) => ({
        postId: 600 - index,
        titleText: `NodeSeek ${index}`,
        titleLink: `/post-${600 - index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-20T00:${String(59 - index).padStart(2, '0')}:00.000Z` }
      }))
    })).toString('base64');
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
        return new Response(JSON.stringify({
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
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    await getFeed({ source: 'all', limit: 30, fetcher });

    const linuxDoCalls = fetcher.mock.calls.map((call) => call[0]).filter((input) => input.includes('linux.do/latest.json'));
    expect(linuxDoCalls.length).toBeLessThanOrEqual(2);
    expect(linuxDoCalls.join('\n')).not.toContain('page=2');
  });

  it('refills an exhausted source in the aggregated Android feed even when other source buffers can fill the page', async () => {
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
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(first.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:501', 'nodeseek:400']);
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:500', 'nodeseek:399']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not skip V2EX recent page one in the aggregated Android feed', async () => {
    const nodeSeekPage = Buffer.from(JSON.stringify({
      rotateTopics: Array.from({ length: 30 }, (_item, index) => ({
        postId: 900 - index,
        titleText: `NodeSeek ${index}`,
        titleLink: `/post-${900 - index}-1`,
        op: { name: 'alice' },
        time: { createdDate: `2026-05-19T00:${String(59 - index).padStart(2, '0')}:00.000Z` }
      }))
    })).toString('base64');
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
        return new Response(Array.from({ length: 20 }, (_unused, index) => item(800 - index, `all ${index}`, `2026-05-20 00:${String(59 - index).padStart(2, '0')}:00 +08:00`, 'cell item')).join('') + '<a href="/recent">更多新主题</a>');
      }
      if (input === 'https://www.v2ex.com/recent?p=1') {
        return new Response(Array.from({ length: 20 }, (_unused, index) => item(700 - index, `recent p1 ${index}`, `2026-05-20 00:${String(39 - index).padStart(2, '0')}:00`)).join('') + '<a href="/recent?p=2">下一页</a>');
      }
      if (input === 'https://www.v2ex.com/recent?p=2') {
        return new Response(Array.from({ length: 20 }, (_unused, index) => item(600 - index, `recent p2 ${index}`, `2026-05-19 23:${String(59 - index).padStart(2, '0')}:00`)).join(''));
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'all', limit: 30, fetcher });
    await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 30, fetcher });

    const calls = fetcher.mock.calls.map((call) => call[0]);
    expect(calls.indexOf('https://www.v2ex.com/recent?p=1')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('https://www.v2ex.com/recent?p=2')).toBeGreaterThan(calls.indexOf('https://www.v2ex.com/recent?p=1'));
  });

  it('retries a failed source on the next aggregated Android feed page', async () => {
    const nodeSeekPage = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 700, titleText: 'NodeSeek recovered', titleLink: '/post-700-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T00:03:00.000Z' } }
      ]
    })).toString('base64');
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
        return new Response(JSON.stringify({
          topic_list: {
            topics: [{
              id: 710,
              title: 'linux.do topic',
              slug: 'linux-do-topic',
              created_at: '2026-05-20T00:02:00.000Z',
              posts_count: 1
            }]
          },
          categories: []
        }), {
          headers: { 'content-type': 'application/json' }
        });
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
    const second = await getFeed({ source: 'all', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 2, fetcher });

    expect(JSON.stringify(first.errors?.nodeseek)).toContain('NodeSeek temporary failure');
    expect(first.nextCursor).toBeTruthy();
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toContain('nodeseek:700');
    expect(nodeSeekCalls).toBe(2);
  });

  it('[REG-SOURCE-001] skips an unavailable aggregate source and retries its original page after credentials recover', async () => {
    const nodeSeekPage = Buffer.from(JSON.stringify({
      rotateTopics: [{
        postId: 730,
        titleText: 'NodeSeek credential recovered',
        titleLink: '/post-730-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-20T00:03:00.000Z' }
      }]
    })).toString('base64');
    let nodeSeekCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        nodeSeekCalls += 1;
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(JSON.stringify({
          topic_list: {
            topics: [{
              id: 740,
              title: 'linux.do available topic',
              slug: 'linux-do-available-topic',
              created_at: '2026-05-20T00:02:00.000Z',
              posts_count: 1
            }]
          },
          categories: []
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input.includes('xiaoyinsi.com')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] }, categories: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('');
    });

    const first = await getFeed({
      source: 'all',
      limit: 2,
      unavailableSources: ['nodeseek'],
      fetcher
    });
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => `${item.source}:${item.id}`)).toEqual(['linuxdo:740']);
    expect(first.errors.nodeseek).toBeTruthy();
    expect(first.nextCursor).toBeTruthy();
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toEqual(['nodeseek:730']);
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
    expect(Object.keys(result.errors || {})).toEqual(['nodeseek', 'linuxdo', 'v2ex', 'xiaoyinsi']);
  });
});
