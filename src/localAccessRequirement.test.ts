import { describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';

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

import { getLinuxDoFeed, getLinuxDoTopic } from './localLinuxdo';
import { getNodeSeekFeed, getNodeSeekTopic } from './localNodeseek';
import { getV2exFeed, getV2exTopic } from './localV2ex';
import { accessRequirementFromObject, accessRequirementFromText } from './localHtml';
import { parseYaohuoListHtml, parseYaohuoTopicHtml } from './localYaohuo';

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' }
  });
}

describe('Android local access requirement detection', () => {
  it('does not treat ordinary linux.do notification level fields as access requirements', () => {
    expect(accessRequirementFromObject({
      id: 1,
      name: '公开分类',
      notification_level: 1
    })).toBeUndefined();
  });

  it('keeps explicit access requirement text detection', () => {
    expect(accessRequirementFromText('需要 trust level 2 才可查看')).toMatchObject({
      type: 'level',
      label: '需等级'
    });
    expect(accessRequirementFromText('查看本帖需要Lv2，您的权限不足')).toMatchObject({
      type: 'level',
      label: '需等级',
      detail: '查看本帖需要Lv2，您的权限不足'
    });
    expect(accessRequirementFromText('This topic is private.')).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
    expect(accessRequirementFromText('当前用户组不可查看该主题')).toMatchObject({
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
  });

  it('detects explicit access requirement object fields', () => {
    expect(accessRequirementFromObject({ access_requirement: 'login' })).toMatchObject({
      type: 'login',
      label: '需登录'
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
  });

  it('does not mark readable linux.do feed topics as requiring a level', async () => {
    const fetcher = vi.fn(async () => json({
      categories: [{
        id: 12,
        name: '开发调优',
        notification_level: 1
      }],
      topic_list: {
        topics: [{
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
        }]
      },
      users: []
    }));

    const feed = await getLinuxDoFeed({ fetcher, limit: 1 });

    expect(feed.items[0]).toMatchObject({ id: '123', title: '公开可读主题' });
    expect(feed.items[0].accessRequirement).toBeUndefined();
  });

  it('keeps linux.do category access requirements on list topics', async () => {
    const fetcher = vi.fn(async () => json({
      categories: [{
        id: 12,
        name: 'Lv2 分类',
        required_trust_level: 2
      }],
      topic_list: {
        topics: [{
          id: 123,
          title: 'linux.do 限制主题',
          slug: 'restricted-topic',
          category_id: 12,
          created_at: '2026-05-22T00:00:00.000Z',
          bumped_at: '2026-05-22T01:00:00.000Z',
          posts_count: 2,
          views: 10,
          last_poster_username: 'alice'
        }]
      },
      users: []
    }));

    const feed = await getLinuxDoFeed({ fetcher, limit: 1 });

    expect(feed.items[0].accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv2'
    });
  });

  it('does not mark readable linux.do topic detail as requiring a level', async () => {
    const fetcher = vi.fn(async () => json({
      id: 123,
      title: '公开可读主题',
      slug: 'public-topic',
      category_id: 12,
      created_at: '2026-05-22T00:00:00.000Z',
      bumped_at: '2026-05-22T01:00:00.000Z',
      posts_count: 2,
      views: 10,
      notification_level: 1,
      categories: [{
        id: 12,
        name: '开发调优',
        notification_level: 1
      }],
      post_stream: {
        stream: [1, 2],
        posts: [{
          id: 1,
          username: 'alice',
          cooked: '<p>正文</p>',
          created_at: '2026-05-22T00:00:00.000Z',
          post_number: 1
        }, {
          id: 2,
          username: 'bob',
          cooked: '<p>回复</p>',
          created_at: '2026-05-22T00:01:00.000Z',
          post_number: 2
        }]
      }
    }));

    const topic = await getLinuxDoTopic('123', { fetcher });

    expect(topic).toMatchObject({ id: '123', title: '公开可读主题' });
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('turns linux.do permission errors into restricted topic details', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      errors: ['You are not permitted to view this topic.']
    }), {
      status: 403,
      headers: { 'content-type': 'application/json' }
    }));

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

  it('does not mark readable NodeSeek body text as an access requirement', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 101,
        title: '登录教程',
        op: { name: 'alice' },
        comments: [{
          commentId: 1,
          poster: { name: 'alice' },
          markdown: '这篇公开内容说明需要登录后才能同步某个外部服务。',
          time: { createdDate: '2026-05-22T00:00:00.000Z' }
        }]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>${payload}</script>`, {
      headers: { 'content-type': 'text/html' }
    }));

    const topic = await getNodeSeekTopic('101', { fetcher });

    expect(topic.contentHtml).toContain('登录');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not mark readable yaohuo body text as an access requirement', () => {
    const topic = parseYaohuoTopicHtml(`
      <div class="content">[标题] 登录教程 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="bbscontent"><!--listS--><p>公开说明：需要登录后才能使用另一个网站。</p><!--listE--></div>
    `, { id: '1', url: 'https://yaohuo.me/bbs-1.html' });

    expect(topic.contentHtml).toContain('登录');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('keeps access requirement text from yaohuo topic details', () => {
    const topic = parseYaohuoTopicHtml(`
      <div class="content">[标题] 妖火限制主题 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="bbscontent"><!--listS--><p>该内容需要等级达到 6 级后查看</p><!--listE--></div>
    `, { id: '2', url: 'https://yaohuo.me/bbs-2.html' });

    expect(topic.accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('keeps yaohuo login requirement text without marking login tutorials', () => {
    const topic = parseYaohuoTopicHtml(`
      <div class="content">[标题] 妖火登录限制主题 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="bbscontent"><!--listS--><p>未登录用户无法查看该内容</p><!--listE--></div>
    `, { id: '3', url: 'https://yaohuo.me/bbs-3.html' });

    expect(topic.accessRequirement).toMatchObject({
      type: 'login',
      label: '需登录'
    });
  });

  it('keeps access requirement text from compact yaohuo list rows', () => {
    const feed = parseYaohuoListHtml(`
      <div class="list">
        <a href="/bbs-1539321.html">妖火限制主题</a>
        <span>需要等级 6 级后查看</span>
      </div>
    `, { classId: '201' });

    expect(feed.items[0].accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('does not copy one compact yaohuo row access requirement to sibling topics', () => {
    const feed = parseYaohuoListHtml(`
      <div class="list">
        <div><a href="/bbs-1539321.html">妖火公开主题</a></div>
        <div><a href="/bbs-1539322.html">妖火限制主题</a><span>需要等级 6 级后查看</span></div>
      </div>
    `, { classId: '201' });

    expect(feed.items[0].accessRequirement).toBeUndefined();
    expect(feed.items[1].accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('keeps yaohuo detail access requirements outside the main content block', () => {
    const topic = parseYaohuoTopicHtml(`
      <div class="content">[标题] 妖火外层限制主题 (阅1) [时间] 2026-05-20 10:00</div>
      <div class="subtitle"><a href="/userinfo.aspx">alice</a></div>
      <div class="notice">当前用户组不可查看该主题</div>
    `, { id: '4', url: 'https://yaohuo.me/bbs-4.html' });

    expect(topic.accessRequirement).toMatchObject({
      type: 'permission',
      label: '需权限'
    });
  });

  it('keeps access requirement text from NodeSeek HTML list fallback rows', async () => {
    const fetcher = vi.fn(async () => new Response(`
      <div>
        <a href="/post-102-1">受限主题</a>
        <span>需要登录后查看</span>
      </div>
    `, { headers: { 'content-type': 'text/html' } }));

    const feed = await getNodeSeekFeed({ fetcher });

    expect(feed.items[0].accessRequirement).toMatchObject({
      type: 'login',
      label: '需登录'
    });
  });

  it('keeps NodeSeek list read-level requirements from embedded homepage data', async () => {
    const payload = Buffer.from(JSON.stringify({
      topicList: [
        {
          postId: 760813,
          title: '求新闻类app分流域名合集',
          readLevel: 2,
          op: { name: '江shan-123', userId: 13510 },
          category: { key: 'inside', name: '内版' },
          time: { createdDate: '2026-06-04T06:58:05Z' }
        }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>${payload}</script>`, {
      headers: { 'content-type': 'text/html' }
    }));

    const feed = await getNodeSeekFeed({ fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '760813',
      categoryId: 'inside',
      accessRequirement: {
        type: 'level',
        label: '需等级',
        detail: 'Lv2'
      }
    });
  });

  it('keeps NodeSeek list read-level requirements from embedded category data', async () => {
    const payload = Buffer.from(JSON.stringify({
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
    })).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>${payload}</script>`, {
      headers: { 'content-type': 'text/html' }
    }));

    const feed = await getNodeSeekFeed({ fetcher, category: 'inside' });

    expect(feed.items[0]).toMatchObject({
      id: '760813',
      categoryId: 'inside',
      accessRequirement: {
        type: 'level',
        label: '需等级',
        detail: 'Lv2'
      }
    });
  });

  it('marks NodeSeek inside-category list topics as requiring Lv2 when no explicit level field is present', async () => {
    const payload = Buffer.from(JSON.stringify({
      topicList: [
        {
          postId: 760813,
          title: '求新闻类app分流域名合集',
          op: { name: '江shan-123', userId: 13510 },
          category: { key: 'inside', name: '内版' },
          time: { createdDate: '2026-06-04T06:58:05Z' }
        }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async () => new Response(`<script>${payload}</script>`, {
      headers: { 'content-type': 'text/html' }
    }));

    const feed = await getNodeSeekFeed({ fetcher, category: 'inside' });

    expect(feed.items[0].accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv2'
    });
  });

  it('keeps access requirement text from V2EX HTML list rows', async () => {
    const fetcher = vi.fn(async () => new Response(`
      <div class="cell">
        <a class="topic-link" href="/t/202#reply1">受限主题</a>
        <a class="node" href="/go/create">分享创造</a>
        <a href="/member/bob">bob</a>
        <span title="2026-05-20 10:00:00"></span>
        <span>permission denied</span>
      </div>
    `, { headers: { 'content-type': 'text/html' } }));

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
        return json([{
          id: 202,
          title: '受限主题',
          member: { username: 'alice' },
          node: { name: 'qna', title: '问与答' },
          created: 1780558980,
          replies: 0,
          content_rendered: ''
        }]);
      }
      if (url.includes('/api/replies/show.json')) {
        return json([]);
      }
      return new Response('<html><body><div class="box">This topic is private.</div></body></html>', {
        headers: { 'content-type': 'text/html' }
      });
    });

    const topic = await getV2exTopic('202', { fetcher });

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
        return json([{
          id: 203,
          title: '公开空正文主题',
          member: { username: 'alice' },
          node: { name: 'qna', title: '问与答' },
          created: 1780558980,
          replies: 0,
          content_rendered: ''
        }]);
      }
      if (url.includes('/api/replies/show.json')) {
        return json([]);
      }
      return new Response(`
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
      `, {
        headers: { 'content-type': 'text/html' }
      });
    });

    const topic = await getV2exTopic('203', { fetcher });

    expect(topic.accessRequirement).toBeUndefined();
  });
});
