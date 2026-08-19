import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { getLinuxDoFeed, getLinuxDoTopic } from '@/sources/linuxdo/reader';
import { getNodeSeekFeed, getNodeSeekTopic } from '@/sources/nodeseek/reader';
import { getV2exFeed, getV2exTopic } from '@/sources/v2ex/reader';
import { accessRequirementFromObject, accessRequirementFromText } from '@/domain/forum/accessRequirements';
import { parseYaohuoListHtml } from '@/sources/yaohuo/feedParser';
import { parseYaohuoTopicHtml } from '@/sources/yaohuo/topicParser';
import { forumAccessRequirementText } from '@/domain/forum/presentation';

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });
}

describe('Android local access requirement detection', () => {
  it('does not treat ordinary linux.do notification level fields as access requirements', () => {
    expect(
      accessRequirementFromObject({
        id: 1,
        name: '公开分类',
        notification_level: 1
      })
    ).toBeUndefined();
  });

  it('keeps explicit access requirement text detection', () => {
    expect(accessRequirementFromText('需要 trust level 2 才可查看')).toMatchObject({
      type: 'level',
      label: '需等级'
    });
    expect(forumAccessRequirementText(accessRequirementFromText('Requires level 5 to view'))).toBe('需 Lv5');
    expect(accessRequirementFromText('查看本帖需要Lv2，您的权限不足')).toMatchObject({
      type: 'level',
      label: '需等级',
      detail: '查看本帖需要Lv2，您的权限不足'
    });
    expect(forumAccessRequirementText(accessRequirementFromText('请先登录，查看本帖需要Lv5'))).toBe('需 Lv5');
    expect(forumAccessRequirementText(accessRequirementFromText('该内容需要 6 级后查看'))).toBe('需 Lv6');
    expect(accessRequirementFromText('This topic is private.')).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromText('当前用户组不可查看该主题')).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromText('暂无权限查看此内容')).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromText('本帖已经被用户设为私有，您没有阅读权限')).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromText('无权限查看此内容')).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromText('权限不够，无法查看此内容')).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromText('登录后可见')).toMatchObject({
      type: 'login',
      label: '需登录'
    });
  });

  it('does not treat ordinary text mentioning level viewing as an access requirement', () => {
    expect(accessRequirementFromText('这里讨论等级查看提示怎么写')).toBeUndefined();
    expect(accessRequirementFromText('This article requires a high level of attention.')).toBeUndefined();
  });

  it('keeps the real level in long access requirement text', () => {
    const requirement = accessRequirementFromText(
      `${'普通摘要文字'.repeat(16)} 查看本帖需要等级达到 6 级后查看，您的权限不足`
    );

    expect(requirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
    expect(forumAccessRequirementText(requirement)).toBe('需 Lv6');
  });

  it('detects explicit access requirement object fields', () => {
    expect(accessRequirementFromObject({ access_requirement: 'login' })).toMatchObject({
      type: 'login',
      label: '需登录'
    });
    expect(
      accessRequirementFromObject({
        accessRequirement: {
          type: 'permission',
          label: '需权限',
          detail: '查看本帖需要Lv5，您的权限不足'
        }
      })
    ).toEqual({
      type: 'level',
      label: '需等级',
      detail: '查看本帖需要Lv5，您的权限不足'
    });
    expect(accessRequirementFromObject({ accessRequirement: 'login', requiredLevel: 5 })).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv5'
    });
    expect(
      accessRequirementFromObject({
        accessRequirement: {
          type: 'level',
          label: '需等级',
          detail: 'Lv5'
        },
        requiredLevel: 2
      })
    ).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv5'
    });
    expect(accessRequirementFromObject({ required_access: 'private' })).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromObject({ read_restricted: true })).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromObject({ required_trust_level: 2 })).toMatchObject({
      type: 'level',
      label: '需等级'
    });
    expect(accessRequirementFromObject({ readLevel: '6' })).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv6'
    });
    expect(accessRequirementFromObject({ requiredLevel: 'Lv5' })).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv5'
    });
  });

  it('does not mark readable linux.do feed topics as requiring a level', async () => {
    const fetcher = vi.fn(async () =>
      json({
        categories: [
          {
            id: 12,
            name: '开发调优',
            notification_level: 1
          }
        ],
        topic_list: {
          topics: [
            {
              id: 123,
              title: '公开可读主题',
              slug: 'public-topic',
              category_id: 12,
              created_at: '2026-05-22T00:00:00.000Z',
              bumped_at: '2026-05-22T01:00:00.000Z',
              posts_count: 2,
              views: 10,
              notification_level: 1,
              last_poster_username: 'alice'
            }
          ]
        },
        users: []
      })
    );

    const feed = await getLinuxDoFeed({ fetcher, limit: 1 });

    expect(feed.items[0]).toMatchObject({ id: '123', title: '公开可读主题' });
    expect(feed.items[0].accessRequirement).toBeUndefined();
  });

  it.each([2, 4])('keeps linux.do category trust level Lv%i on list topics', async (level) => {
    const fetcher = vi.fn(async () =>
      json({
        categories: [
          {
            id: 12,
            name: `Lv${level} 分类`,
            required_trust_level: level
          }
        ],
        topic_list: {
          topics: [
            {
              id: 123,
              title: `linux.do Lv${level} 主题`,
              slug: `level-${level}-topic`,
              category_id: 12,
              created_at: '2026-05-22T00:00:00.000Z',
              bumped_at: '2026-05-22T01:00:00.000Z',
              posts_count: 2,
              views: 10,
              last_poster_username: 'alice'
            }
          ]
        },
        users: []
      })
    );

    const feed = await getLinuxDoFeed({ fetcher, limit: 1 });

    expect(feed.items[0].accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: `Lv${level}`
    });
  });

  it('uses linux.do category levels when a topic only has a generic restricted marker', async () => {
    const fetcher = vi.fn(async () =>
      json({
        categories: [
          {
            id: 12,
            name: 'Lv4 分类',
            required_trust_level: 4
          }
        ],
        topic_list: {
          topics: [
            {
              id: 123,
              title: 'linux.do 四级主题',
              slug: 'level-four-topic',
              category_id: 12,
              read_restricted: true,
              created_at: '2026-05-22T00:00:00.000Z',
              bumped_at: '2026-05-22T01:00:00.000Z',
              posts_count: 2,
              views: 10,
              last_poster_username: 'alice'
            }
          ]
        },
        users: []
      })
    );

    const feed = await getLinuxDoFeed({ fetcher, limit: 1 });

    expect(feed.items[0].accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv4'
    });
  });

  it('does not mark readable linux.do topic detail as requiring a level', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 123,
        title: '公开可读主题',
        slug: 'public-topic',
        category_id: 12,
        created_at: '2026-05-22T00:00:00.000Z',
        bumped_at: '2026-05-22T01:00:00.000Z',
        posts_count: 2,
        views: 10,
        notification_level: 1,
        categories: [
          {
            id: 12,
            name: '开发调优',
            notification_level: 1
          }
        ],
        post_stream: {
          stream: [1, 2],
          posts: [
            {
              id: 1,
              username: 'alice',
              cooked: '<p>正文</p>',
              created_at: '2026-05-22T00:00:00.000Z',
              post_number: 1
            },
            {
              id: 2,
              username: 'bob',
              cooked: '<p>回复</p>',
              created_at: '2026-05-22T00:01:00.000Z',
              post_number: 2
            }
          ]
        }
      })
    );

    const topic = await getLinuxDoTopic('123', { fetcher });

    expect(topic).toMatchObject({
      id: '123',
      title: '公开可读主题',
      mediaReferrer: { documentUrl: 'https://linux.do/t/public-topic/123' }
    });
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('[REG-TOPIC-113] keeps readable linux.do topic details out of the permission state', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 2777081,
        title: '受限分类中的可读主题',
        slug: 'readable-restricted-category-topic',
        category_id: 12,
        created_at: '2026-08-19T00:00:00.000Z',
        bumped_at: '2026-08-19T00:01:00.000Z',
        posts_count: 2,
        views: 10,
        categories: [
          {
            id: 12,
            name: '受限分类',
            read_restricted: true
          }
        ],
        post_stream: {
          stream: [1, 2],
          posts: [
            {
              id: 1,
              username: 'alice',
              cooked: '<p>当前账号可读正文</p>',
              created_at: '2026-08-19T00:00:00.000Z',
              post_number: 1
            },
            {
              id: 2,
              username: 'bob',
              cooked: '<p>当前账号可读回复</p>',
              created_at: '2026-08-19T00:01:00.000Z',
              post_number: 2
            }
          ]
        }
      })
    );

    const topic = await getLinuxDoTopic('2777081', { fetcher });

    expect(topic.contentHtml).toContain('当前账号可读正文');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('turns linux.do permission errors into restricted topic details', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            errors: ['You are not permitted to view this topic.']
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' }
          }
        )
    );

    const topic = await getLinuxDoTopic('123', { fetcher });

    expect(topic).toMatchObject({
      source: 'linuxdo',
      id: '123',
      title: '受限帖子',
      accessRequirement: {
        type: 'permission',
        label: '需权限',
        detail: 'You are not permitted to view this topic.'
      },
      contentHtml: 'You are not permitted to view this topic.'
    });
  });

  it('uses linux.do error text levels over generic permission fields', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accessRequirement: 'permission',
            errors: ['Requires level 5 to view']
          }),
          {
            status: 403,
            headers: { 'content-type': 'application/json' }
          }
        )
    );

    const topic = await getLinuxDoTopic('123', { fetcher });

    expect(topic).toMatchObject({
      source: 'linuxdo',
      id: '123',
      title: '受限帖子',
      accessRequirement: {
        type: 'level',
        label: '需等级',
        detail: 'Requires level 5 to view'
      },
      contentHtml: 'Requires level 5 to view'
    });
  });

  it('does not mark readable NodeSeek body text as an access requirement', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 101,
          title: '登录教程',
          op: { name: 'alice' },
          comments: [
            {
              commentId: 1,
              poster: { name: 'alice' },
              markdown: '这篇公开内容说明需要登录后才能同步某个外部服务。',
              time: { createdDate: '2026-05-22T00:00:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => {
      const response = new Response(`<script>${payload}</script>`, {
        headers: { 'content-type': 'text/html' }
      });
      Object.defineProperty(response, 'url', {
        value: 'https://www.nodeseek.com/post-101-1?from=redirect'
      });
      return response;
    });

    const topic = await getNodeSeekTopic('101', { fetcher });

    expect(topic.contentHtml).toContain('登录');
    expect(topic.mediaReferrer).toEqual({
      documentUrl: 'https://www.nodeseek.com/post-101-1?from=redirect'
    });
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not mark readable yaohuo body text as an access requirement', () => {
    const topic = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 登录教程 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="bbscontent"><!--listS--><p>公开说明：需要登录后才能使用另一个网站。</p><!--listE--></div>
    `,
      { id: '1', url: 'https://yaohuo.me/bbs-1.html' }
    );

    expect(topic.contentHtml).toContain('登录');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('keeps access requirement text from yaohuo topic details', () => {
    const topic = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 妖火限制主题 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="bbscontent"><!--listS--><p>该内容需要等级达到 6 级后查看</p><!--listE--></div>
    `,
      { id: '2', url: 'https://yaohuo.me/bbs-2.html' }
    );

    expect(topic.accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('keeps yaohuo login requirement text without marking login tutorials', () => {
    const topic = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 妖火登录限制主题 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="bbscontent"><!--listS--><p>未登录用户无法查看该内容</p><!--listE--></div>
    `,
      { id: '3', url: 'https://yaohuo.me/bbs-3.html' }
    );

    expect(topic.accessRequirement).toMatchObject({
      type: 'login',
      label: '需登录'
    });
  });

  it('keeps access requirement text from compact yaohuo list rows', () => {
    const feed = parseYaohuoListHtml(
      `
      <div class="list">
        <a href="/bbs-1539321.html">妖火限制主题</a>
        <span>需要等级 6 级后查看</span>
      </div>
    `,
      { classId: '201' }
    );

    expect(feed.items[0].accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('keeps real yaohuo list levels without using reply or view counts', () => {
    const feed = parseYaohuoListHtml(
      `
      <div class="listdata">
        <a href="/bbs-1539321.html">妖火限制主题</a>
        / alice / <a href="/bbs/book_re.aspx?id=1539321&classid=201">4</a>/阅102
        <span>查看本帖需要等级达到 6 级后查看</span>
      </div>
    `,
      { classId: '201' }
    );

    expect(feed.items[0].replyCount).toBe(4);
    expect(feed.items[0].viewCount).toBe(102);
    expect(feed.items[0].accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级',
      detail: expect.stringContaining('6 级')
    });
  });

  it('does not copy one compact yaohuo row access requirement to sibling topics', () => {
    const feed = parseYaohuoListHtml(
      `
      <div class="list">
        <div><a href="/bbs-1539321.html">妖火公开主题</a></div>
        <div><a href="/bbs-1539322.html">妖火限制主题</a><span>需要等级 6 级后查看</span></div>
      </div>
    `,
      { classId: '201' }
    );

    expect(feed.items[0].accessRequirement).toBeUndefined();
    expect(feed.items[1].accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('keeps yaohuo detail access requirements outside the main content block', () => {
    const topic = parseYaohuoTopicHtml(
      `
      <div class="content">[标题] 妖火外层限制主题 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="notice">当前用户组不可查看该主题</div>
    `,
      { id: '4', url: 'https://yaohuo.me/bbs-4.html' }
    );

    expect(topic.accessRequirement).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
  });

  it('keeps access requirement text from NodeSeek HTML list fallback rows', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `
      <div>
        <a href="/post-102-1">受限主题</a>
        <span>需要登录后查看</span>
      </div>
    `,
          { headers: { 'content-type': 'text/html' } }
        )
    );

    const feed = await getNodeSeekFeed({ fetcher });

    expect(feed.items[0].accessRequirement).toMatchObject({
      type: 'login',
      label: '需登录'
    });
  });

  it('turns the real private NodeSeek rendered page into restricted topic details', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `
      <section id="nsk-frame">
        <div id="nsk-body" class="nsk-container">
          <div id="nsk-body-left">
            <div>本帖已经被用户设为私有，您没有阅读权限</div>
          </div>
        </div>
      </section>
    `,
          { status: 404, headers: { 'content-type': 'text/html' } }
        )
    );

    const topic = await getNodeSeekTopic('777282', { fetcher });

    expect(topic).toMatchObject({
      source: 'nodeseek',
      id: '777282',
      title: '受限帖子',
      accessRequirement: {
        type: 'permission',
        label: '需权限',
        detail: '本帖已经被用户设为私有，您没有阅读权限'
      }
    });
    expect(topic.contentHtml).toContain('本帖已经被用户设为私有');
  });

  it('does not infer NodeSeek view requirements from inside-category HTML list rows', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `
      <ul class="post-list">
        <li class="post-list-item">
          <a class="post-title" href="/post-7202-1">新版块“内版”，以及试行版规</a>
          <a href="/categories/inside">内版</a>
        </li>
      </ul>
    `,
          { headers: { 'content-type': 'text/html' } }
        )
    );

    const feed = await getNodeSeekFeed({ fetcher, category: 'inside' });

    expect(feed.items[0]).toMatchObject({
      id: '7202',
      categoryId: 'inside',
      category: '内版'
    });
    expect(feed.items[0].accessRequirement).toBeUndefined();
  });

  it.each([
    { level: 2, postId: 760813, title: '求新闻类app分流域名合集', username: '江shan-123' },
    { level: 5, postId: 760814, title: '需要更高等级的帖子', username: 'alice' }
  ])('keeps NodeSeek embedded read level Lv$level on list topics', async ({ level, postId, title, username }) => {
    const payload = Buffer.from(
      JSON.stringify({
        topicList: [
          {
            postId,
            title,
            readLevel: level,
            op: { name: username, userId: 13510 },
            category: { key: 'inside', name: '内版' },
            time: { createdDate: '2026-06-04T06:58:05Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(
      async () =>
        new Response(`<script>${payload}</script>`, {
          headers: { 'content-type': 'text/html' }
        })
    );

    const feed = await getNodeSeekFeed({ fetcher });

    expect(feed.items[0]).toMatchObject({
      id: String(postId),
      categoryId: 'inside',
      accessRequirement: {
        type: 'level',
        label: '需等级',
        detail: `Lv${level}`
      }
    });
  });

  it('keeps real NodeSeek list read levels from row text', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `
      <ul class="post-list">
        <li class="post-list-item">
          <a class="post-title" href="/post-760815-1">需要六级的帖子</a>
          <a href="/categories/inside">内版</a>
          <span class="info-comments-count">4</span>
          <span class="info-views">102</span>
          <span>查看本帖需要等级达到 6 级后查看，您的权限不足</span>
        </li>
      </ul>
    `,
          { headers: { 'content-type': 'text/html' } }
        )
    );

    const feed = await getNodeSeekFeed({ fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '760815',
      accessRequirement: {
        type: 'level',
        label: '需等级',
        detail: '查看本帖需要等级达到 6 级后查看，您的权限不足'
      }
    });
  });

  it('does not turn NodeSeek category read levels into topic view requirements', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        allCategory: [
          {
            key: 'inside',
            cn_text: '内版',
            readLevel: 2
          }
        ],
        topicList: [
          {
            postId: 760813,
            title: '求新闻类app分流域名合集',
            op: { name: '江shan-123', userId: 13510 },
            category: { key: 'inside', name: '内版' },
            time: { createdDate: '2026-06-04T06:58:05Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(
      async () =>
        new Response(`<script>${payload}</script>`, {
          headers: { 'content-type': 'text/html' }
        })
    );

    const feed = await getNodeSeekFeed({ fetcher, category: 'inside' });

    expect(feed.items[0]).toMatchObject({
      id: '760813',
      categoryId: 'inside'
    });
    expect(feed.items[0].accessRequirement).toBeUndefined();
  });

  it('does not infer NodeSeek view requirements from inside-category embedded topics', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        topicList: [
          {
            postId: 760813,
            title: '求新闻类app分流域名合集',
            op: { name: '江shan-123', userId: 13510 },
            category: { key: 'inside', name: '内版' },
            time: { createdDate: '2026-06-04T06:58:05Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(
      async () =>
        new Response(`<script>${payload}</script>`, {
          headers: { 'content-type': 'text/html' }
        })
    );

    const feed = await getNodeSeekFeed({ fetcher, category: 'inside' });

    expect(feed.items[0]).toMatchObject({
      id: '760813',
      categoryId: 'inside',
      category: '内版'
    });
    expect(feed.items[0].accessRequirement).toBeUndefined();
  });

  it('keeps access requirement text from V2EX HTML list rows', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `
      <div class="cell">
        <a class="topic-link" href="/t/202#reply1">受限主题</a>
        <a class="node" href="/go/create">分享创造</a>
        <a href="/member/bob">bob</a>
        <span title="2026-05-20 10:00:00"></span>
        <span>permission denied</span>
      </div>
    `,
          { headers: { 'content-type': 'text/html' } }
        )
    );

    const feed = await getV2exFeed({ page: 2, limit: 20, fetcher });

    expect(feed.items[0].accessRequirement).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
  });

  it('keeps V2EX detail access requirements from topic HTML', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/topics/show.json')) {
        return json([
          {
            id: 202,
            title: '受限主题',
            member: { username: 'alice' },
            node: { name: 'qna', title: '问与答' },
            created: 1780558980,
            replies: 0,
            content_rendered: ''
          }
        ]);
      }
      if (url.includes('/api/replies/show.json')) {
        return json([]);
      }
      return new Response('<html><body><div class="box">This topic is private.</div></body></html>', {
        headers: { 'content-type': 'text/html' }
      });
    });

    const topic = await getV2exTopic('202', { fetcher });

    expect(topic.mediaReferrer).toEqual({ documentUrl: 'https://www.v2ex.com/t/202' });
    expect(topic.accessRequirement).toMatchObject({
      type: 'permission',
      label: '需权限',
      detail: 'This topic is private.'
    });
  });

  it('keeps V2EX detail access requirements when the origin page has surrounding text', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/topics/show.json')) {
        return json([
          {
            id: 204,
            title: '受限主题',
            member: { username: 'alice' },
            node: { name: 'qna', title: '问与答' },
            created: 1780558980,
            replies: 0,
            content_rendered: ''
          }
        ]);
      }
      if (url.includes('/api/replies/show.json')) {
        return json([]);
      }
      return new Response(
        `
        <html>
          <body>
            <div id="Main">
              <div class="box">
                <div class="cell">V2EX Topic</div>
                <div class="problem">This topic is private.</div>
              </div>
            </div>
          </body>
        </html>
      `,
        {
          headers: { 'content-type': 'text/html' }
        }
      );
    });

    const topic = await getV2exTopic('204', { fetcher });

    expect(topic.accessRequirement).toMatchObject({
      type: 'permission',
      label: '需权限',
      detail: 'This topic is private.'
    });
  });

  it('does not mark readable empty V2EX topics as restricted from reply login prompts', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/topics/show.json')) {
        return json([
          {
            id: 203,
            title: '公开空正文主题',
            member: { username: 'alice' },
            node: { name: 'qna', title: '问与答' },
            created: 1780558980,
            replies: 0,
            content_rendered: ''
          }
        ]);
      }
      if (url.includes('/api/replies/show.json')) {
        return json([]);
      }
      return new Response(
        `
        <html>
          <body>
            <div id="Main">
              <div class="box">
                <div class="topic_content"></div>
                <div class="cell">Please sign in to reply.</div>
              </div>
            </div>
          </body>
        </html>
      `,
        {
          headers: { 'content-type': 'text/html' }
        }
      );
    });

    const topic = await getV2exTopic('203', { fetcher });

    expect(topic.accessRequirement).toBeUndefined();
  });
});
