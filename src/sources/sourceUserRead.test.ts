import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { getUserProfile } from './sourceRead';
import { sourceDiagnosticSummary } from './diagnostics';

describe('source user read', () => {
  it('routes user profile reads to each public source site', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(
          JSON.stringify({
            success: true,
            detail: { member_name: '我是ikun', member_id: 48872, readme: 'bio', rank: 6, avatar: '/avatar/48872.png' }
          })
        );
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(
          JSON.stringify({
            success: true,
            discussions: [
              {
                post_id: 101,
                title: 'NodeSeek topic',
                rank: 0,
                tag_name: 'daily',
                tag_cn_text: '日常',
                text: 'NodeSeek topic excerpt'
              }
            ]
          })
        );
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=1')) {
        return new Response(
          JSON.stringify({
            success: true,
            comments: [{ post_id: 101, title: 'NodeSeek topic', floor_id: 2, text: 'NodeSeek reply' }]
          })
        );
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(
          JSON.stringify({
            user_summary: {
              user: {
                id: 7,
                username: 'alice',
                name: 'Alice',
                avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png'
              },
              topic_count: 2,
              post_count: 8
            },
            users: [{ id: 7, username: 'alice', trust_level: 2 }],
            topics: [
              {
                id: 42,
                title: 'linux topic',
                slug: 'linux-topic',
                created_at: '2026-05-20T00:00:00.000Z',
                posts_count: 1
              }
            ]
          })
        );
      }
      if (input.includes('linux.do/topics/created-by/alice.json?page=0&per_page=30')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 42,
                  title: 'linux topic',
                  slug: 'linux-topic',
                  created_at: '2026-05-20T00:00:00.000Z',
                  posts_count: 1
                },
                {
                  id: 41,
                  title: 'linux older topic',
                  slug: 'linux-older-topic',
                  created_at: '2026-05-19T00:00:00.000Z',
                  posts_count: 1
                }
              ]
            }
          })
        );
      }
      if (
        input.includes('linux.do/user_actions.json') &&
        input.includes('username=alice') &&
        input.includes('filter=5') &&
        input.includes('limit=31')
      ) {
        return new Response(
          JSON.stringify({
            user_actions: [
              {
                excerpt: 'linux reply excerpt',
                created_at: '2026-05-20T01:00:00.000Z',
                slug: 'linux-topic',
                topic_id: 42,
                post_number: 3,
                post_id: 1003,
                title: 'linux topic',
                category_id: 1
              }
            ]
          })
        );
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(
          JSON.stringify({
            id: 9,
            username: 'neo',
            avatar_large: '//cdn.v2ex.com/avatar.png',
            tagline: 'hello',
            pro: 1
          })
        );
      }
      if (input.includes('v2ex.com/member/neo/topics')) {
        return new Response(
          '<div class="cell item"><a class="topic-link" href="/t/121">V2EX topic</a><a class="node" href="/go/create">分享创造</a><span title="2026-05-20 10:00:00"></span></div>'
        );
      }
      if (input.includes('v2ex.com/member/neo/replies')) {
        return new Response(`
          <div class="cell ps_container"><a href="?p=1">1</a><a href="?p=2">2</a></div>
          <div class="dock_area">5 月 20 日回复了 alice 创建的主题 › 分享创造 › <a href="/t/121#reply4">V2EX topic</a></div>
        `);
      }
      if (input.includes('yaohuo.me')) {
        if (input.includes('book_re_my.aspx')) {
          return new Response(
            '<div>火友 (7) #2 妖火回复内容。 2026-05-20 10:30 <a href="/bbs-66.html">查看</a></div><a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7&page=2">下一页</a>'
          );
        }
        return new Response(
          '<div class="content">昵称:火友<br/>1万妖晶2级等级7年注册时长<br/>发帖:3<br/>回帖:9 <a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复(9)</a></div><div class="listdata"><a href="/bbs-66.html?classid=177">妖火主题</a>/火友/阅1/2026-05-20 10:30</div>'
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const nodeseek = await getUserProfile({ source: 'nodeseek', id: '48872', username: '我是ikun', fetcher });
    const linuxdo = await getUserProfile({ source: 'linuxdo', id: 'alice', username: 'alice', fetcher });
    const v2ex = await getUserProfile({ source: 'v2ex', id: 'neo', username: 'neo', fetcher });
    const yaohuo = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher });

    expect(nodeseek).toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '我是ikun',
      url: 'https://www.nodeseek.com/space/48872'
    });
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
      if (input.includes('linux.do/topics/created-by/linux.json?page=0&per_page=30')) {
        return new Response(JSON.stringify({ topic_list: { topics: [] } }));
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
        return new Response(
          '<div class="content">昵称:火友 <a href="/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7">回复</a></div>'
        );
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
      getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher })
    ]);

    expect(profiles.map((profile) => sourceDiagnosticSummary(profile)?.partialErrorCount)).toEqual([1, 1, 1, 1]);
    expect(profiles.every((profile) => sourceDiagnosticSummary(profile)?.hasDegradation)).toBe(true);
    expect(profiles.every((profile) => !('diagnostic' in profile))).toBe(true);
  });

  it('loads user replies from each source reply cursor', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(
          JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872, nComment: 16 } })
        );
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=2')) {
        return new Response(
          JSON.stringify({
            success: true,
            comments: [{ post_id: 102, title: 'NodeSeek next', floor_id: 5, text: 'next reply' }]
          })
        );
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(JSON.stringify({ user_summary: { user: { username: 'alice' }, reply_count: 31 } }));
      }
      if (input.includes('linux.do/user_actions.json') && input.includes('offset=30') && input.includes('limit=31')) {
        return new Response(
          JSON.stringify({
            user_actions: [
              {
                excerpt: 'linux next',
                created_at: '2026-05-21T01:00:00.000Z',
                slug: 'next',
                topic_id: 43,
                post_number: 4,
                post_id: 1004,
                title: 'linux next'
              }
            ]
          })
        );
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(JSON.stringify({ username: 'neo' }));
      }
      if (input.includes('v2ex.com/member/neo/replies?p=2')) {
        return new Response(
          '<div class="dock_area">2 分钟前回复了 bob 创建的主题 › 问与答 › <a href="/t/122#reply8">V2EX next</a></div>'
        );
      }
      if (input.includes('yaohuo.me/bbs/book_re_my.aspx') && input.includes('page=2')) {
        return new Response('<div>火友 (7) #3 妖火下一页。 2026-05-21 10:30 <a href="/bbs-67.html">查看</a></div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(
      getUserProfile({
        source: 'nodeseek',
        id: '48872',
        username: '我是ikun',
        cursor: '2',
        cursorType: 'replies',
        fetcher
      })
    ).resolves.toMatchObject({
      replies: [{ topicId: '102', floor: 5 }],
      hasMoreReplies: false,
      nextRepliesCursor: null
    });
    await expect(
      getUserProfile({
        source: 'linuxdo',
        id: 'alice',
        username: 'alice',
        cursor: '30',
        cursorType: 'replies',
        fetcher
      })
    ).resolves.toMatchObject({
      replies: [{ topicId: '43', floor: 4 }],
      hasMoreReplies: false,
      nextRepliesCursor: null
    });
    await expect(
      getUserProfile({ source: 'v2ex', id: 'neo', username: 'neo', cursor: '2', cursorType: 'replies', fetcher })
    ).resolves.toMatchObject({
      replies: [
        {
          topicId: '122',
          floor: 8,
          author: 'neo',
          authorId: 'neo',
          authorUrl: 'https://www.v2ex.com/member/neo',
          displayTimeText: '2 分钟前'
        }
      ]
    });
    await expect(
      getUserProfile({
        source: 'yaohuo',
        id: '7',
        username: '火友',
        cursor: 'https://www.yaohuo.me/bbs/book_re_my.aspx?action=class&siteid=1000&classid=0&touserid=7&page=2',
        cursorType: 'replies',
        fetcher
      })
    ).resolves.toMatchObject({
      replies: [{ topicId: '67', floor: 3 }],
      hasMoreReplies: false
    });
  });

  it('reads user profile topic times from all four Android sources', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(
          JSON.stringify({
            success: true,
            discussions: [
              {
                post_id: 101,
                title: 'NodeSeek topic',
                rank: 0,
                created_at: '2026-05-22T16:06:25.000Z'
              }
            ]
          })
        );
      }
      if (input.includes('nodeseek.com/api/content/list-comments?uid=48872&page=1')) {
        return new Response(
          JSON.stringify({ success: true, comments: [{ post_id: 101, floor_id: 2, text: 'NodeSeek reply' }] })
        );
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(
          JSON.stringify({
            user_summary: {
              user: {
                id: 7,
                username: 'alice',
                name: 'Alice',
                avatar_template: '/user_avatar/linux.do/alice/{size}/1_2.png'
              }
            },
            topics: [
              {
                id: 42,
                title: 'linux topic',
                slug: 'linux-topic',
                created_at: '2026-05-20T00:00:00.000Z',
                bumped_at: '2026-05-20T01:00:00.000Z',
                posts_count: 2
              }
            ]
          })
        );
      }
      if (input.includes('linux.do/topics/created-by/alice.json?page=0&per_page=30')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 42,
                  title: 'linux topic',
                  slug: 'linux-topic',
                  created_at: '2026-05-20T00:00:00.000Z',
                  bumped_at: '2026-05-20T01:00:00.000Z',
                  posts_count: 2
                }
              ]
            }
          })
        );
      }
      if (input.includes('linux.do/user_actions.json') && input.includes('limit=31')) {
        return new Response(JSON.stringify({ user_actions: [] }));
      }
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(
          JSON.stringify({ id: 9, username: 'neo', avatar_large: '//cdn.v2ex.com/avatar.png', tagline: 'hello' })
        );
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
    const yaohuo = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher });

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
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain(
      'nodeseek.com/api/content/list-discussions?uid=48872&page=1'
    );
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

    const profile = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher });

    expect(profile.topicCount).toBe(2);
    expect(profile.topics.map((topic) => topic.id)).toEqual(['67', '66']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain(
      'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub'
    );
    expect(calls).not.toContain('book_list_log.aspx');
  });

  it('returns a yaohuo user profile topic cursor when more pages remain', async () => {
    const rows = Array.from(
      { length: 30 },
      (_, index) => `
      <div class="listdata"><a href="/bbs-${100 + index}.html?classid=177">妖火第${index}条</a>/火友/阅1/2026-05-20 10:${String(index).padStart(2, '0')}</div>
    `
    ).join('');
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

    const profile = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher });

    expect(profile.topics).toHaveLength(30);
    expect(profile).toMatchObject({
      hasMoreTopics: true,
      nextTopicsCursor:
        'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub&page=2'
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

    const profile = await getUserProfile({ source: 'yaohuo', id: '36925', username: '李慕婉o', fetcher });

    expect(profile.displayName).toBe('李慕婉o');
    expect(profile.topicCount).toBe(1659);
    expect(profile.replyCount).toBe(222);
    expect(profile.topics[0]).toMatchObject({
      id: '1540798',
      author: '李慕婉o'
    });
    expect(profile.topics.map((topic) => topic.id)).toEqual(['1540798', '1540797']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain(
      'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=36925&type=pub'
    );
    expect(calls).not.toContain('book_list_log.aspx');
  });

  it('reads yaohuo user topics from the current profile post link and keeps pagination', async () => {
    const firstRows = Array.from(
      { length: 15 },
      (_, index) => `
      <div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=201&id=${1540797 + index}">妖火资源 ${index}</a>/李慕婉o/阅1/2026-05-28 23:${String(index).padStart(2, '0')}</div>
    `
    ).join('');
    const secondRows = Array.from(
      { length: 15 },
      (_, index) => `
      <div class="listdata"><a href="/bbs/book_view.aspx?siteid=1000&classid=201&id=${1540812 + index}">妖火资源 ${index + 15}</a>/李慕婉o/阅1/2026-05-29 00:${String(index).padStart(2, '0')}</div>
    `
    ).join('');
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
      if (
        input ===
        'https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&siteid=1000&classid=0&type=pub&key=36925&getTotal=1659&page=2'
      ) {
        return new Response(`
          ${secondRows}
          <a href="/bbs/book_list_search.aspx?action=search&siteid=1000&classid=0&type=pub&key=36925&getTotal=1659&page=3">下一页</a>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getUserProfile({ source: 'yaohuo', id: '36925', username: '李慕婉o', fetcher });

    expect(profile.displayName).toBe('李慕婉o');
    expect(profile.topicCount).toBe(1659);
    expect(profile.replyCount).toBe(222);
    expect(profile.topics).toHaveLength(30);
    expect(profile.topics[0]).toMatchObject({ id: '1540826', author: '李慕婉o' });
    expect(profile).toMatchObject({
      hasMoreTopics: true,
      nextTopicsCursor:
        'https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&siteid=1000&classid=0&type=pub&key=36925&getTotal=1659&page=3'
    });
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.yaohuo.me/bbs/book_list_search.aspx?action=search&key=36925&type=pub');
    expect(calls).not.toContain('book_list_log.aspx');
  });

  it('loads yaohuo user profile topics from the next topic cursor', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (
        input === 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub&page=2'
      ) {
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
      cursor: 'https://www.yaohuo.me/bbs/book_list.aspx?action=search&siteid=1000&classid=0&key=7&type=pub&page=2'
    });

    expect(profile.topics.map((topic) => topic.id)).toEqual(['130']);
    expect(profile.hasMoreTopics).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not send yaohuo cookies to an off-site user topic cursor', async () => {
    const fetcher = vi.fn(async () => new Response(''));

    await expect(
      getUserProfile({
        source: 'yaohuo',
        id: '7',
        username: '火友',
        fetcher,
        cursor: 'https://evil.example/bbs/book_list.aspx?page=2'
      })
    ).rejects.toThrow('妖火链接不属于 www.yaohuo.me');

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads V2EX user topics from the public member page and orders them newest first', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('v2ex.com/api/members/show.json')) {
        return new Response(
          JSON.stringify({ id: 683966, username: 'haonanaaaaaa', avatar_large: 'https://cdn.v2ex.com/avatar.png' })
        );
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
        return new Response(
          JSON.stringify({ id: 683966, username: 'haonanaaaaaa', avatar_large: 'https://cdn.v2ex.com/avatar.png' })
        );
      }
      if (input === 'https://www.v2ex.com/member/haonanaaaaaa') {
        return new Response('<h1>haonanaaaaaa</h1>');
      }
      if (input === 'https://www.v2ex.com/member/haonanaaaaaa/topics') {
        return new Response('<h1>haonanaaaaaa</h1>');
      }
      if (input === 'https://www.v2ex.com/feed/member/haonanaaaaaa.xml') {
        return new Response(
          `<?xml version="1.0" encoding="utf-8"?>
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
          </feed>`,
          {
            headers: { 'content-type': 'application/atom+xml' }
          }
        );
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
        return new Response(
          JSON.stringify({
            success: true,
            discussions: [
              { post_id: 101, title: 'NodeSeek older', time: { createdDate: '2026-05-20T00:00:00.000Z' } },
              { post_id: 102, title: 'NodeSeek newer', time: { createdDate: '2026-05-22T00:00:00.000Z' } }
            ]
          })
        );
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(
          JSON.stringify({
            user_summary: {
              user: { id: 7, username: 'alice', name: 'Alice' }
            },
            topics: [
              {
                id: 41,
                title: 'linux older',
                slug: 'linux-older',
                created_at: '2026-05-20T00:00:00.000Z',
                bumped_at: '2026-05-23T00:00:00.000Z',
                posts_count: 2
              },
              {
                id: 42,
                title: 'linux newer',
                slug: 'linux-newer',
                created_at: '2026-05-22T00:00:00.000Z',
                posts_count: 1
              }
            ]
          })
        );
      }
      if (input.includes('linux.do/topics/created-by/alice.json?page=0&per_page=30')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 41,
                  title: 'linux older',
                  slug: 'linux-older',
                  created_at: '2026-05-20T00:00:00.000Z',
                  bumped_at: '2026-05-23T00:00:00.000Z',
                  posts_count: 2
                },
                {
                  id: 42,
                  title: 'linux newer',
                  slug: 'linux-newer',
                  created_at: '2026-05-22T00:00:00.000Z',
                  posts_count: 1
                }
              ]
            }
          })
        );
      }
      if (input.includes('linux.do/user_actions.json') && input.includes('limit=31')) {
        return new Response(JSON.stringify({ user_actions: [] }));
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
    const yaohuo = await getUserProfile({ source: 'yaohuo', id: '7', username: '火友', fetcher });

    expect(nodeseek.topics.map((topic) => topic.id)).toEqual(['102', '101']);
    expect(linuxdo.topics.map((topic) => topic.id)).toEqual(['42', '41']);
    expect(v2ex.topics.map((topic) => topic.id)).toEqual(['122', '121']);
    expect(yaohuo.topics.map((topic) => topic.id)).toEqual(['67', '66']);
  });

  it('keeps untimed NodeSeek profile reads free of vote-only headers', async () => {
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.includes('nodeseek.com/api/account/getInfo/48872?readme=1')) {
        return new Response(JSON.stringify({ success: true, detail: { member_name: '我是ikun', member_id: 48872 } }));
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=48872&page=1')) {
        return new Response(
          JSON.stringify({ success: true, discussions: [{ post_id: 101, title: 'NodeSeek topic', rank: 0 }] })
        );
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
    expect(fetcher.mock.calls.every(([, init]) => new Headers(init?.headers).get('x-dynamic-sign') === null)).toBe(
      true
    );
  });

  it('reads NodeSeek user profile JSON when hidden WebView wraps it in an HTML document', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com/api/account/getInfo/15105?readme=1')) {
        return new Response(
          '<html><body><pre>{"success":true,"detail":{"member_name":"Bugs","member_id":15105}}</pre></body></html>',
          {
            headers: { 'content-type': 'text/html' }
          }
        );
      }
      if (input.includes('nodeseek.com/api/content/list-discussions?uid=15105&page=1')) {
        return new Response(
          '<html><body>{"success":true,"discussions":[{"post_id":746779,"title":"NodeSeek topic","time":{"createdDate":"2026-05-25T03:34:00.000Z"}}]}</body></html>',
          {
            headers: { 'content-type': 'text/html' }
          }
        );
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
        return new Response(
          JSON.stringify({
            success: true,
            discussions: [
              {
                post_id: 101,
                title: 'NodeSeek topic',
                rank: 0,
                time: { createdDate: '2026-05-22T16:06:25.000Z' }
              }
            ]
          })
        );
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
        return new Response(
          JSON.stringify({
            success: true,
            discussions: [
              { post_id: 101, title: 'NodeSeek first' },
              { post_id: 102, title: 'NodeSeek second' }
            ]
          })
        );
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
        return new Response(
          JSON.stringify({
            success: true,
            discussions: [
              { post_id: 101, title: 'NodeSeek older', time: { createdDate: '2026-05-20T00:00:00.000Z' } },
              { post_id: 102, title: 'NodeSeek untimed first' },
              { post_id: 103, title: 'NodeSeek newer', time: { createdDate: '2026-05-22T00:00:00.000Z' } },
              { post_id: 104, title: 'NodeSeek untimed second' }
            ]
          })
        );
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
        return new Response(
          JSON.stringify({
            categories: [{ id: 4, name: '开发调优' }]
          })
        );
      }
      if (input.includes('linux.do/u/alice/summary.json')) {
        return new Response(
          JSON.stringify({
            user_summary: {
              user: { id: 7, username: 'alice', name: 'Alice' }
            },
            topics: [
              {
                id: 42,
                title: 'linux topic',
                slug: 'linux-topic',
                category_id: 4,
                created_at: '2026-05-20T00:00:00.000Z',
                posts_count: 1
              }
            ]
          })
        );
      }
      if (input.includes('linux.do/topics/created-by/alice.json?page=0&per_page=30')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 42,
                  title: 'linux topic',
                  slug: 'linux-topic',
                  category_id: 4,
                  created_at: '2026-05-20T00:00:00.000Z',
                  posts_count: 1
                }
              ]
            }
          })
        );
      }
      if (input.includes('linux.do/user_actions.json') && input.includes('limit=31')) {
        return new Response(JSON.stringify({ user_actions: [] }));
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
});
