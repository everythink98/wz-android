import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getCategories, getFeed, getReplies, getReply, getTopic, searchTopics } from './forumApi';
import { isLinuxDoCloudflareError } from './appUtils';
import { createLinuxDoWebViewFallbackFetcher, LinuxDoHiddenBrowserFailureError } from './linuxdoFetchFallback';
import { getLinuxDoUserProfile, searchLinuxDoSemantic, searchLinuxDoTags, searchLinuxDoUsers } from './localLinuxdo';
import { splitDiscourseContentHtml } from './discourseContent';
import { textContentFromHtml } from './localHtml';
import { createNodeSeekWebViewFallbackFetcher, isNodeSeekBrowserFetchUrl } from './nodeseekFetchFallback';
import { getNodeSeekReplies, getNodeSeekTopic, getNodeSeekUserProfile } from './localNodeseek';
import { setRequestTimeoutsActive } from './request';
import { sourceDiagnosticSummary } from './sourceAdapterDiagnostics';
import { DEFAULT_SEARCH_FILTERS } from './searchFilters';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from './diagnostics';
import * as SecureStore from 'expo-secure-store';

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

function mockStoredLinuxDoLoginAccess(cookieHeader = 'cf_clearance=clearance; _t=login; _forum_session=session') {
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async (key: string) => (
    key === 'linuxdo-clearance'
      ? JSON.stringify({
        cookieHeader,
        savedAt: '2026-05-26T00:00:00.000Z',
        source: 'webview',
        userAgent: 'LinuxDo WebView UA'
      })
      : null
  ));
}

describe('Android local sources', () => {
  beforeEach(() => {
    vi.mocked(SecureStore.getItemAsync).mockReset();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  });

  afterEach(() => {
    setDiagnosticWriter(null);
  });

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

  it('converts NodeSeek Bilibili image syntax into embeddable player HTML', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 102,
        title: 'NodeSeek video topic',
        op: { name: 'alice' },
        comments: [{
          commentId: 1,
          poster: { name: 'alice' },
          markdown: '![image](https://www.bilibili.com/video/BV1GUdgBdESz/?p=2)',
          time: { createdDate: '2026-05-20T00:00:00.000Z' }
        }]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('102', { fetcher });

    expect(topic.contentHtml).toContain('<iframe');
    expect(topic.contentHtml).toContain('https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz&p=2');
    expect(topic.contentHtml).not.toContain('<img');
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

  it('shows NodeSeek embedded list comments as replies excluding the original post', async () => {
    const payload = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 202, titleText: 'NodeSeek no replies', titleLink: '/post-202-1', op: { name: 'alice' }, comments: 1 },
        { postId: 203, titleText: 'NodeSeek replies', titleLink: '/post-203-1', op: { name: 'bob' }, comments: 4 }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const feed = await getFeed({ source: 'nodeseek', fetcher });

    expect(feed.items.map((item) => item.replyCount)).toEqual([0, 3]);
  });

  it('keeps NodeSeek detail reply metadata from embedded comments', async () => {
    const payload = Buffer.from(JSON.stringify({
      user: {
        member_id: 48872,
        member_name: '凡想世界',
        avatar: '/avatar/48872.png'
      },
      postData: {
        postId: 204,
        title: 'NodeSeek detail metadata',
        views: '2.2k',
        collectionCount: 4,
        collected: false,
        locked: 0,
        op: { uid: 9891, name: 'alice' },
        category: 'daily',
        categoryWord: '日常',
        categoryLink: '/categories/daily',
        comments: [
          {
            commentId: 10,
            floorIndex: 0,
            poster: { name: 'alice', uid: 9891, isOp: true, info: '楼主', avatar: '/avatar/9891.png', profile: '/space/9891', roles: [{ name: 'admin', display_text: '管理' }] },
            markdown: '正文',
            time: { createdDate: '2026-05-20T00:00:00.000Z' },
            upvoteCount: 1,
            likeCount: 0,
            dislikeCount: 0
          },
          {
            commentId: 12,
            floorIndex: 15,
            hot: true,
            pined: true,
            poster: { name: 'bob', uid: 42, isMe: true, avatar: '/avatar/42.png', profile: '/space/42', roles: [{ name: 'active', display_text: '活跃' }] },
            markdown: '热门回复',
            signature: '签名 **内容**',
            time: { createdDate: '2026-05-20T00:15:00.000Z' },
            upvoteCount: 0,
            likeCount: 2,
            dislikeCount: 1,
            disliked: true
          },
          {
            commentId: 11,
            floorIndex: 1,
            poster: { name: 'alice', uid: 9891, isOp: true, info: '楼主', avatar: '/avatar/9891.png', profile: '/space/9891' },
            markdown: '楼主回复',
            time: { createdDate: '2026-05-20T00:01:00.000Z' }
          }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('204', { fetcher });

    expect(topic).toMatchObject({
      categoryId: 'daily',
      category: '日常',
      collectionCount: 4,
      collected: false,
      locked: false
    });
    expect(topic.authorId).toBe('9891');
    expect(topic.authorLevelLabel).toBe('管理');
    expect(topic.currentUser).toMatchObject({
      source: 'nodeseek',
      id: '48872',
      username: '凡想世界',
      url: 'https://www.nodeseek.com/space/48872'
    });
    expect(topic.replies[0]).toMatchObject({
      author: 'bob',
      authorId: '42',
      authorLevelLabel: '活跃',
      authorUrl: 'https://www.nodeseek.com/space/42',
      floor: 15,
      hot: true,
      pinned: true,
      upvoteCount: 0,
      likeCount: 2,
      dislikeCount: 1,
      disliked: true,
      canLike: false,
      canEdit: true,
      contentMarkdown: '热门回复'
    });
    expect(topic.replies[0]).not.toHaveProperty('canDelete');
    expect(topic.replies[0]).toHaveProperty('signatureHtml', expect.stringContaining('<strong>内容</strong>'));
    expect(topic.replies[1]).toMatchObject({
      author: 'alice',
      authorId: '9891',
      floor: 1,
      isOp: true
    });
  });

  it('uses NodeSeek embedded replyCount when the first page only has 10 replies', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 207,
        title: 'NodeSeek embedded reply count',
        op: { name: 'alice' },
        replyCount: 12,
        comments: [
          {
            commentId: 1,
            poster: { name: 'alice' },
            markdown: '正文',
            time: { createdDate: '2026-05-20T00:00:00.000Z' }
          },
          ...Array.from({ length: 10 }, (_, index) => ({
            commentId: index + 2,
            floorIndex: index + 1,
            poster: { name: `user-${index + 1}` },
            markdown: `回复 ${index + 1}`,
            time: { createdDate: '2026-05-20T00:01:00.000Z' }
          }))
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('207', { fetcher });

    expect(topic.replies).toHaveLength(10);
    expect(topic.replyCount).toBe(12);
  });

  it('does not use NodeSeek rendered pager page numbers as replyCount', async () => {
    const replies = Array.from({ length: 10 }, (_, index) => `
      <li id="${index + 1}" data-comment-id="${index + 2}" class="content-item">
        <div class="author-info"><a href="/space/${index + 2}" class="author-name">user-${index + 1}</a></div>
        <time datetime="2026-05-20T00:01:00.000Z"></time>
        <article class="post-content"><p>回复 ${index + 1}</p></article>
      </li>
    `).join('');
    const fetcher = vi.fn(async () => html(`
      <h1>NodeSeek rendered reply count</h1>
      <div class="nsk-pager post-top-pager">12</div>
      <div id="0" data-comment-id="1" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-05-20T00:00:00.000Z"></time>
        <article class="post-content"><p>正文</p></article>
      </div>
      <ul>${replies}</ul>
    `));

    const topic = await getNodeSeekTopic('208', { fetcher });

    expect(topic.replies).toHaveLength(10);
    expect(topic.replyCount).toBe(10);
  });

  it('uses rendered NodeSeek html for display and markdown only for editing', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 205,
        title: 'NodeSeek rendered content',
        op: { uid: 9891, name: 'alice' },
        category: 'daily',
        categoryWord: '日常',
        comments: [
          {
            commentId: 20,
            poster: { name: 'alice', uid: 9891, isOp: true },
            markdown: '[Markdown 正文](/markdown-post-1)',
            content: '<p><a href="/post-1">正文链接</a></p>',
            time: { createdDate: '2026-05-20T00:00:00.000Z' }
          },
          {
            commentId: 21,
            poster: { name: 'bob', uid: 42, isMe: true },
            markdown: '[Markdown 回复](/markdown-post-2)',
            content: '<p><a href="/post-2">回复链接</a></p>',
            signature: '<p><a href="/space/42">个人签名</a></p>',
            time: { createdDate: '2026-05-20T00:01:00.000Z' }
          }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('205', { fetcher });

    expect(topic.contentHtml).toContain('<a href="https://www.nodeseek.com/post-1">正文链接</a>');
    expect(topic.contentHtml).not.toContain('Markdown 正文');
    expect(topic.contentHtml).not.toContain('&lt;p');
    expect(topic.replies[0]).toMatchObject({
      contentMarkdown: '[Markdown 回复](/markdown-post-2)',
      signatureHtml: expect.stringContaining('<a href="https://www.nodeseek.com/space/42">个人签名</a>')
    });
    expect(topic.replies[0].contentHtml).toContain('<a href="https://www.nodeseek.com/post-2">回复链接</a>');
    expect(topic.replies[0].contentHtml).not.toContain('Markdown 回复');
    expect(topic.replies[0].contentHtml).not.toContain('&lt;p');
    expect(topic.replies[0].signatureHtml).not.toContain('&lt;p');
  });

  it('does not escape rendered NodeSeek html even when it arrives in markdown fields', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 206,
        title: 'NodeSeek html markdown fields',
        op: { uid: 9891, name: 'alice' },
        comments: [
          {
            commentId: 30,
            poster: { name: 'alice', uid: 9891 },
            markdown: '<p><a href="/post-1">正文链接</a></p>',
            time: { createdDate: '2026-05-20T00:00:00.000Z' }
          },
          {
            commentId: 31,
            poster: { name: 'bob', uid: 42, isMe: true },
            markdown: '<p><a href="/post-2">回复链接</a></p>',
            time: { createdDate: '2026-05-20T00:01:00.000Z' }
          },
          {
            commentId: 32,
            poster: { name: 'carol', uid: 43 },
            content: 'plain rendered fallback',
            markdown: '![xhj032](https://www.nodeseek.com/static/image/smiley/xhj032.png)\n\n[@电动面包](https://www.nodeseek.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85) [#4](https://www.nodeseek.com/post-793572-1#4) 后续正文',
            time: { createdDate: '2026-05-20T00:02:00.000Z' }
          }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('206', { fetcher });

    expect(topic.contentHtml).toContain('<a href="https://www.nodeseek.com/post-1">正文链接</a>');
    expect(topic.contentHtml).not.toContain('&lt;p');
    expect(topic.replies[0].contentHtml).toContain('<a href="https://www.nodeseek.com/post-2">回复链接</a>');
    expect(topic.replies[0].contentHtml).not.toContain('&lt;p');
    expect(topic.replies[0]).not.toHaveProperty('contentMarkdown');
    expect(topic.replies[1].contentHtml).toContain('src="https://www.nodeseek.com/static/image/smiley/xhj032.png"');
    expect(topic.replies[1].contentHtml).toContain('<a href="https://www.nodeseek.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85">@电动面包</a>');
    expect(topic.replies[1].contentHtml).toContain('<a href="https://www.nodeseek.com/post-793572-1#4">#4</a>');
    expect(topic.replies[1].contentHtml).not.toContain('plain rendered fallback');
  });

  it('reads linux.do author trust levels from list and topic post data', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/latest.json')) {
        return json({
          topic_list: {
            topics: [{
              id: 42,
              title: 'linux.do list topic',
              slug: 'linux-list-topic',
              created_at: '2026-05-20T00:00:00.000Z',
              posts_count: 1,
              posters: [{ user_id: 7, description: 'Original Poster' }],
              notification_level: 1
            }]
          },
          users: [{ id: 7, username: 'alice', trust_level: 4 }]
        });
      }
      if (input.includes('/t/42.json')) {
        return json({
          id: 42,
          title: 'linux.do detail topic',
          slug: 'linux-detail-topic',
          created_at: '2026-05-20T00:00:00.000Z',
          posts_count: 2,
          notification_level: 1,
          post_stream: {
            posts: [
              { id: 100, post_number: 1, username: 'alice', trust_level: 4, cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
              { id: 101, post_number: 2, username: 'bob', trust_level: 2, cooked: '<p>reply</p>', created_at: '2026-05-20T00:01:00.000Z' }
            ]
          }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const feed = await getFeed({ source: 'linuxdo', fetcher });
    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(feed.items[0].authorLevelLabel).toBe('Lv4');
    expect(topic.authorLevelLabel).toBe('Lv4');
    expect(topic.replies[0].authorLevelLabel).toBe('Lv2');
  });

  it('reads V2EX Pro labels from topic and reply API members', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([{
          id: 810,
          title: 'V2EX Pro topic',
          url: 'https://www.v2ex.com/t/810',
          created: 1780000000,
          replies: 1,
          member: { username: 'neo', pro: 1 },
          content_rendered: '<p>detail body</p>'
        }]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          { id: 7001, member: { username: 'alice', pro: true }, content_rendered: '<p>first reply</p>', created: 1780000100 }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/810') {
        return html('');
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '810', fetcher });

    expect(topic.authorLevelLabel).toBe('Pro');
    expect(topic.replies[0].authorLevelLabel).toBe('Pro');
  });

  it('loads NodeSeek vote info from nsapp vote links in topic content', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 759903,
        title: 'NodeSeek poll topic',
        op: { name: 'alice' },
        comments: [
          {
            commentId: 10,
            poster: { name: 'alice' },
            markdown: '提交投票 nsapp://vote?id=2443',
            time: { createdDate: '2026-06-03T00:00:00.000Z' }
          }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/api/vote/info/2443')) {
        if (new Headers(init?.headers).get('x-dynamic-sign') !== 'a'.repeat(40)) {
          return new Response(JSON.stringify({ success: false }), { status: 403 });
        }
        return json({
          vote: {
            id: 2443,
            title: '公开投票',
            isPublic: true,
            locked: false,
            multiple: true,
            items: [
              { vote_item_id: 71, text: '选项 A', count: 2, voted: false },
              { vote_item_id: 72, text: '选项 B', count: 5, voted: true }
            ]
          }
        });
      }
      return html(`<script>${payload}</script>`);
    });

    const topic = await getNodeSeekTopic('759903', { fetcher });

    const voteRequest = fetcher.mock.calls.find(([input]) => input.includes('/api/vote/info/2443'));
    expect(new Headers(voteRequest?.[1]?.headers).get('x-dynamic-sign')).toBe('a'.repeat(40));

    expect(topic.polls).toEqual([{
      id: '2443',
      title: '公开投票',
      public: true,
      closed: false,
      multiple: true,
      voted: true,
      options: [
        { id: '71', label: '选项 A', count: 2, selected: false },
        { id: '72', label: '选项 B', count: 5, selected: true }
      ]
    }]);
    expect(topic.contentHtml).not.toContain('nsapp://vote?id=2443');
    expect(topic.contentHtml).not.toContain('提交投票');
    expect(topic.contentHtml).toContain('<forum-nodeseek-poll id="2443"></forum-nodeseek-poll>');
  });

  it('[REG-WRITE-007] hides NodeSeek vote counts until the current user has voted', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 759903,
        title: 'NodeSeek unvoted poll topic',
        op: { name: 'alice' },
        comments: [{
          commentId: 10,
          poster: { name: 'alice' },
          markdown: '提交投票 nsapp://vote?id=2443',
          time: { createdDate: '2026-06-03T00:00:00.000Z' }
        }]
      }
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/vote/info/2443')) {
        return json({
          vote: {
            id: 2443,
            title: '未投票时隐藏结果',
            isPublic: false,
            locked: true,
            multiple: true,
            voted: false,
            items: [
              { vote_item_id: 71, text: '选项 A', count: 2, voted: false },
              { vote_item_id: 72, text: '选项 B', count: 5, voted: false }
            ]
          }
        });
      }
      return html(`<script>${payload}</script>`);
    });

    const topic = await getNodeSeekTopic('759903', { fetcher });

    expect(topic.polls).toEqual([{
      id: '2443',
      title: '未投票时隐藏结果',
      public: false,
      closed: true,
      multiple: true,
      voted: false,
      options: [
        { id: '71', label: '选项 A', selected: false },
        { id: '72', label: '选项 B', selected: false }
      ]
    }]);
  });

  it('[REG-WRITE-007] keeps failed NodeSeek vote markers and reports a partial topic', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 759903,
        title: 'NodeSeek partial poll topic',
        op: { name: 'alice' },
        comments: [{
          commentId: 10,
          poster: { name: 'alice' },
          markdown: '提交投票 nsapp://vote?id=2443\n\n提交投票 nsapp://vote?id=2444\n\n提交投票 nsapp://vote?id=2445',
          time: { createdDate: '2026-06-03T00:00:00.000Z' }
        }]
      }
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/vote/info/2443')) {
        return json({
          vote: {
            id: 2443,
            title: '可用投票',
            items: [{ vote_item_id: 71, text: '选项 A', voted: false }]
          }
        });
      }
      if (input.includes('/api/vote/info/2444')) {
        return new Response(JSON.stringify({ success: false }), { status: 403 });
      }
      if (input.includes('/api/vote/info/2445')) {
        return json({ success: false });
      }
      return html(`<script>${payload}</script>`);
    });

    const topic = await getNodeSeekTopic('759903', { fetcher });

    expect(topic.polls?.map((poll) => poll.id)).toEqual(['2443']);
    expect(topic.contentHtml).not.toContain('nsapp://vote?id=2443');
    expect(topic.contentHtml).toContain('nsapp://vote?id=2444');
    expect(topic.contentHtml).toContain('nsapp://vote?id=2445');
    expect(sourceDiagnosticSummary(topic)).toMatchObject({
      partialErrorCount: 2,
      hasDegradation: true
    });
  });

  it('maps rendered NodeSeek vote forms to unified polls and removes the raw form from content', async () => {
    const fetcher = vi.fn(async () => html(`
      <h1>Rendered NodeSeek poll topic</h1>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/9891" class="author-name">alice</a></div>
        <span class="content-category"><a href="/categories/daily">日常</a></span>
        <time datetime="2026-06-03T00:00:00.000Z"></time>
        <article class="post-content">
          <form class="vote-form" data-vote-id="2443">
            <div class="vote-title">常用系统</div>
            <label><input type="radio" name="ids" value="71">Debian <span class="vote-count">13 票</span></label>
            <label><input type="radio" name="ids" value="72" checked>ArchLinux <span class="vote-count">5 票</span></label>
          </form>
        </article>
      </div>
    `));

    const topic = await getNodeSeekTopic('759903', { fetcher });

    expect(topic.polls).toEqual([{
      id: '2443',
      title: '常用系统',
      multiple: false,
      voted: true,
      options: [
        { id: '71', label: 'Debian', count: 13, selected: false },
        { id: '72', label: 'ArchLinux', count: 5, selected: true }
      ]
    }]);
    expect(topic.contentHtml).not.toContain('<form');
    expect(topic.contentHtml).not.toContain('Debian');
    expect(topic.contentHtml).toContain('<forum-nodeseek-poll id="2443"></forum-nodeseek-poll>');
  });

  it('maps hydrated NodeSeek embedded vote panels from the rendered page', async () => {
    const fetcher = vi.fn(async () => html(`
      <h1>Rendered NodeSeek embedded poll topic</h1>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/9891" class="author-name">alice</a></div>
        <time datetime="2026-06-03T00:00:00.000Z"></time>
        <article class="post-content">
          <p></p>
          <div class="vote-panel">
            <div class="embed-vote">
              <form class="pure-form">
                <h2>常用系统</h2>
                <fieldset class="vote-stat-wrapper">
                  <div class="vote-stat not-voted">
                    <input id="vote-item-2443-71" name="vote-item" type="radio" value="71">
                    <label for="vote-item-2443-71" class="pure-checkbox">
                      <div class="vote-item-text">Debian</div>
                      <span class="vote-count">13 票</span>
                    </label>
                  </div>
                  <div class="vote-stat not-voted">
                    <input id="vote-item-2443-72" name="vote-item" type="radio" value="72">
                    <label for="vote-item-2443-72" class="pure-checkbox selected">
                      <div class="vote-item-text">ArchLinux</div>
                      <span class="vote-count">5 票</span>
                    </label>
                  </div>
                </fieldset>
                <div>nsapp://vote?id=2443 (公开投票)</div>
              </form>
            </div>
          </div>
          <p>&quot;&gt;</p>
          <p><span>nsapp://vote?id=2443</span></p>
        </article>
      </div>
    `));

    const topic = await getNodeSeekTopic('759903', { fetcher });

    expect(topic.polls).toEqual([{
      id: '2443',
      title: '常用系统',
      multiple: false,
      public: true,
      voted: true,
      options: [
        { id: '71', label: 'Debian', count: 13, selected: false },
        { id: '72', label: 'ArchLinux', count: 5, selected: true }
      ]
    }]);
    expect(topic.contentHtml).not.toContain('pure-form');
    expect(topic.contentHtml).not.toContain('vote-panel');
    expect(topic.contentHtml).not.toContain('embed-vote');
    expect(topic.contentHtml.trim()).toBe('<forum-nodeseek-poll id="2443"></forum-nodeseek-poll>');
  });

  it('[REG-WRITE-010] removes an adjacent NodeSeek poll marker leak without splitting the surrounding paragraph', async () => {
    const fetcher = vi.fn(async () => html(`
      <h1>NodeSeek mixed poll paragraph</h1>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/9891" class="author-name">alice</a></div>
        <time datetime="2026-07-13T00:00:00.000Z"></time>
        <article class="post-content">
          <p>投票前正文 1 &gt; 0<br>
            &quot;&gt;<div class="vote-panel">
              <div class="embed-vote">
                <form class="pure-form">
                  <h2>原位投票</h2>
                  <fieldset class="vote-stat-wrapper">
                    <div class="vote-stat not-voted">
                      <input id="vote-item-2674-12308" name="vote-item" type="radio" value="12308">
                      <label for="vote-item-2674-12308" class="pure-checkbox">
                        <div class="vote-item-text">选项 A</div>
                      </label>
                    </div>
                  </fieldset>
                  <div>nsapp://vote?id=2674 (匿名投票)</div>
                </form>
              </div>
            </div><br>
            投票后正文 <img class="sticker" src="/static/image/sticker/ac/2007.png" alt="ac2007"><br>
            正文结尾
          </p>
        </article>
      </div>
    `));

    const topic = await getNodeSeekTopic('819647', { fetcher });
    const placeholder = '<forum-nodeseek-poll id="2674"></forum-nodeseek-poll>';
    const beforeIndex = topic.contentHtml.indexOf('投票前正文');
    const pollIndex = topic.contentHtml.indexOf(placeholder);
    const afterIndex = topic.contentHtml.indexOf('投票后正文');

    expect(topic.contentHtml).not.toContain('&quot;&gt;');
    expect(textContentFromHtml(topic.contentHtml)).not.toContain('\">');
    expect(topic.contentHtml).toContain('1 &gt; 0');
    expect(topic.contentHtml.match(/<forum-nodeseek-poll\b/g)).toHaveLength(1);
    expect(topic.contentHtml).toMatch(/^<p>[\s\S]*<\/p>$/);
    expect(pollIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(pollIndex);
    expect(topic.contentHtml).toContain('class="sticker"');
  });

  it('keeps NodeSeek detail metadata from rendered HTML fallback', async () => {
    const fetcher = vi.fn(async () => html(`
      <h1>Rendered NodeSeek detail</h1>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/9891" class="author-name">alice</a><span class="is-poster">楼主</span><span class="nsk-badge role-tag role-admin"><span>管理</span></span></div>
        <span class="content-category"><a href="/categories/daily">日常</a></span>
        <time datetime="2026-05-20T00:00:00.000Z"></time>
        <article class="post-content"><p>正文</p></article>
        <div class="comment-menu">
          <div title="点赞" class="menu-item"><span>1</span></div>
          <div title="加鸡腿" class="menu-item"><span>0</span></div>
          <div title="反对" class="menu-item"><span>0</span></div>
          <div title="收藏" class="menu-item"><span>4</span></div>
        </div>
      </div>
      <ul>
        <li id="15" data-comment-id="102" class="content-item">
          <div class="author-info"><a href="/space/42" class="author-name">bob</a><span class="nsk-badge role-tag role-active"><span>活跃</span></span></div>
          <time datetime="2026-05-20T00:15:00.000Z"></time>
          <div class="floor-link-wrapper"><div class="hot-badge"></div><a class="floor-link" href="#15">#15</a></div>
          <article class="post-content"><p>热门回复</p></article>
          <div class="signature"><p>签名内容</p></div>
          <div class="comment-menu">
            <div title="点赞" class="menu-item"><span>0</span></div>
            <div title="加鸡腿" class="menu-item"><span>2</span></div>
            <div title="反对" class="menu-item"><span>1</span></div>
          </div>
        </li>
        <li id="1" data-comment-id="101" class="content-item">
          <div class="author-info"><a href="/space/9891" class="author-name">alice</a><span class="is-poster">楼主</span></div>
          <time datetime="2026-05-20T00:01:00.000Z"></time>
          <a class="floor-link" href="#1">#1</a>
          <article class="post-content"><p>楼主回复</p></article>
          <div class="comment-menu">
            <div title="点赞" class="menu-item"><span>0</span></div>
            <div title="加鸡腿" class="menu-item"><span>0</span></div>
            <div title="反对" class="menu-item"><span>0</span></div>
          </div>
        </li>
      </ul>
    `));

    const topic = await getNodeSeekTopic('205', { fetcher });

    expect(topic).toMatchObject({
      categoryId: 'daily',
      category: '日常',
      authorLevelLabel: '管理',
      upvoteCount: 1,
      likeCount: 0,
      dislikeCount: 0,
      collectionCount: 4
    });
    expect(topic.replies[0]).toMatchObject({
      author: 'bob',
      authorId: '42',
      authorLevelLabel: '活跃',
      floor: 15,
      hot: true,
      upvoteCount: 0,
      likeCount: 2,
      dislikeCount: 1
    });
    expect(topic.replies[0]).toHaveProperty('signatureHtml', expect.stringContaining('签名内容'));
    expect(topic.replies[1]).toMatchObject({
      author: 'alice',
      floor: 1,
      isOp: true
    });
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

  it('does not fill normal NodeSeek replies from following origin pages', async () => {
    const pageOnePayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723704,
        title: 'NodeSeek topic',
        comments: [
          { poster: { name: 'alice' }, markdown: '正文' },
          ...Array.from({ length: 10 }, (_, index) => ({
            poster: { name: `reply ${index + 1}` },
            markdown: `回复 ${index + 1}`
          }))
        ]
      }
    })).toString('base64');
    const pageTwoPayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723704,
        title: 'NodeSeek topic',
        comments: [
          { poster: { name: 'reply 11' }, markdown: '回复 11' },
          { poster: { name: 'reply 12' }, markdown: '回复 12' }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-723704-2')) {
        return html(`<script>${pageTwoPayload}</script>`);
      }
      return html(`<script>${pageOnePayload}</script><a href="/post-723704-2">2</a>`);
    });

    const replies = await getNodeSeekReplies('723704', { fetcher, page: 1, offset: 0, limit: 30 });

    expect(replies.items.map((item) => item.author)).toEqual(Array.from({ length: 10 }, (_, index) => `reply ${index + 1}`));
    expect(replies.hasMore).toBe(true);
    expect(replies.nextPage).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fills NodeSeek replies from following origin pages only when requested', async () => {
    const pageOnePayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723704,
        title: 'NodeSeek topic',
        comments: [
          { poster: { name: 'alice' }, markdown: '正文' },
          ...Array.from({ length: 10 }, (_, index) => ({
            poster: { name: `reply ${index + 1}` },
            markdown: `回复 ${index + 1}`
          }))
        ]
      }
    })).toString('base64');
    const pageTwoPayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723704,
        title: 'NodeSeek topic',
        comments: [
          { poster: { name: 'reply 11' }, markdown: '回复 11' },
          { poster: { name: 'reply 12' }, markdown: '回复 12' }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-723704-2')) {
        return html(`<script>${pageTwoPayload}</script>`);
      }
      return html(`<script>${pageOnePayload}</script><a href="/post-723704-2">2</a>`);
    });

    const replies = await getNodeSeekReplies('723704', { fetcher, page: 1, offset: 0, limit: 30, fillPages: true });

    expect(replies.items.map((item) => item.author)).toEqual([
      ...Array.from({ length: 10 }, (_, index) => `reply ${index + 1}`),
      'reply 11',
      'reply 12'
    ]);
    expect(replies.items.at(-1)).toMatchObject({ floor: 12, contentHtml: expect.stringContaining('回复 12') });
    expect(replies.hasMore).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('prefers rendered NodeSeek topic content over stale embedded postData while keeping edit metadata', async () => {
    const stalePayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723705,
        title: 'stale embedded title',
        comments: [
          { commentId: 100, poster: { name: 'alice' }, content: '<p>stale body</p>', markdown: 'stale body' },
          { commentId: 101, poster: { name: 'bob', isMe: true }, content: '<p>stale reply</p>', markdown: 'editable reply markdown' }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`
      <script>${stalePayload}</script>
      <a class="post-title" href="/post-723705-1">Rendered topic title</a>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-05-22T15:55:11.000Z"></time>
        <article class="post-content"><p>fresh rendered body</p></article>
      </div>
      <li id="1" data-comment-id="101" class="content-item">
        <div class="author-info"><a href="/space/2" class="author-name">bob</a></div>
        <time datetime="2026-05-22T15:59:06.000Z"></time>
        <article class="post-content"><p>fresh rendered reply</p></article>
      </li>
    `));

    const topic = await getNodeSeekTopic('723705', { fetcher });

    expect(topic.title).toBe('Rendered topic title');
    expect(topic.contentHtml).toContain('fresh rendered body');
    expect(topic.contentHtml).not.toContain('stale body');
    expect(topic.replies[0]).toMatchObject({
      commentId: 101,
      contentHtml: expect.stringContaining('fresh rendered reply'),
      contentMarkdown: 'editable reply markdown',
      canEdit: true
    });
  });

  it('turns NodeSeek magic tabs into readable mixed report tabs', async () => {
    const fetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-812712-1">[NQ] ZOUTER HK BGP Global - Lite新款 留档</a>
      <div id="0" data-comment-id="812712" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-07-08T11:47:31.000Z"></time>
        <article class="post-content">
          <div class="nsk-magic-tabs enabled">
            <div class="nsk-magic-tab-title is-active"><span class="emoji">💻</span>基本信息</div>
            <div class="nsk-magic-tab-body">
              <div class="terminal-container embedMode">
                <div class="xterm-rows">
                  <div class="xterm-row"><span style="color: rgb(34, 211, 238)">硬件质量体检报告</span></div>
                  <div class="xterm-row"><span class="xterm-fg-46 xterm-bg-18">KVM 虚拟机</span></div>
                  <div class="xterm-row"><span>https://github.com/xykt/HardwareQuality</span></div>
                </div>
              </div>
            </div>
            <div class="nsk-magic-tab-title"><span class="emoji">🎬</span>IP质量</div>
            <div class="nsk-magic-tab-body">
              <div class="terminal-container embedMode">
                <div class="xterm-rows">
                  <div class="xterm-row"><span style="color: #34d399">IP质量检测完成</span></div>
                  <div class="xterm-row"><span>报告链接：https://Report.Check.Place/ip/A19T91XBU.svg</span></div>
                </div>
              </div>
            </div>
            <div class="nsk-magic-tab-title"><span class="emoji">🌐</span>网络质量</div>
            <div class="nsk-magic-tab-body"><p><img src="https://i.111666.best/image/network.webp" alt="网络质量报告" /></p></div>
            <div class="nsk-magic-tab-title"><span class="emoji">📍</span>回程路由</div>
            <div class="nsk-magic-tab-body"><p><img src="https://i.111666.best/image/route.webp" alt="回程路由报告" /></p></div>
          </div>
          <p>项目地址 <a href="https://github.com/xykt/HardwareQuality">HardwareQuality</a></p>
        </article>
      </div>
    `));

    const topic = await getNodeSeekTopic('812712', { fetcher });

    expect(topic.contentHtml).toContain('<forum-terminal-report>');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="💻基本信息">');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="🎬IP质量">');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="🌐网络质量">');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="📍回程路由">');
    expect(topic.contentHtml).not.toContain('forum-terminal-section');
    expect(topic.contentHtml).toContain('💻基本信息');
    expect(topic.contentHtml).toContain('🎬IP质量');
    expect(topic.contentHtml).toContain('🌐网络质量');
    expect(topic.contentHtml).toContain('📍回程路由');
    expect(topic.contentHtml).toMatch(/💻基本信息[\s\S]*🎬IP质量[\s\S]*🌐网络质量[\s\S]*📍回程路由/);
    expect(topic.contentHtml).toContain('KVM');
    expect(topic.contentHtml).toContain('IP质量检测完成');
    expect(topic.contentHtml).toContain('color: rgb(34, 211, 238)');
    expect(topic.contentHtml).toContain('color: #00ff00; background-color: #000087');
    expect(topic.contentHtml).toContain('color: #34d399');
    expect(topic.contentHtml).toMatch(/硬件质量体检报告<\/span><br\s*\/?><span style="color: #00ff00; background-color: #000087">KVM&nbsp;虚拟机/);
    expect(topic.contentHtml).toContain('https://i.111666.best/image/network.webp');
    expect(topic.contentHtml).toContain('https://i.111666.best/image/route.webp');
    expect(topic.contentHtml).toContain('alt="网络质量报告"');
    expect(topic.contentHtml).toContain('alt="回程路由报告"');
    expect(topic.contentHtml).toContain('https://github.com/xykt/HardwareQuality');
    expect(topic.contentHtml).toContain('href="https://github.com/xykt/HardwareQuality"');
    expect(topic.contentHtml).not.toContain('terminal-container');
    expect(topic.contentHtml).not.toContain('\u001b[36m');
    expect(topic.contentHtml).not.toContain('\u001b[32m');
    expect(topic.contentHtml).not.toContain('\u001b[0m');
    expect(topic.contentHtml).not.toContain('[36m');
    expect(topic.contentHtml).not.toContain('[32m');
    expect(topic.contentHtml).not.toContain('[0m');
  });

  it('cleans NodeSeek ansi code reports without showing source markup', async () => {
    const fetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-812712-1">[NQ] ZOUTER HK BGP Global - Lite新款 留档</a>
      <div id="0" data-comment-id="812712" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-07-08T11:47:31.000Z"></time>
        <article class="post-content">
          <p>💻基本信息</p>
          <pre><code class="language-ansi"><span data-ansicode="27"></span>[36m硬件质量体检报告<span data-ansicode="27"></span>[0m
<span data-ansicode="27"></span>[32mKVM 虚拟机<span data-ansicode="27"></span>[0m
报告链接：https://Report.Check.Place/hardware/3TKDAONLE.svg</code></pre>
          <p>🎬IP质量</p>
          <pre><code class="language-ansi">\u001b[32mIP质量检测完成\u001b[0m</code></pre>
          <p>🌐网络质量</p>
          <pre><code class="language-ansi">联通 上海 \u001b[36m18ms\u001b[0m</code></pre>
          <p>📍回程路由</p>
          <pre><code class="language-ansi">线路 \u001b[38;5;46;48;5;18mCMIN2\u001b[0m</code></pre>
        </article>
      </div>
    `));

    const topic = await getNodeSeekTopic('812712', { fetcher });

    expect(topic.contentHtml).toContain('<forum-terminal-report>');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="💻基本信息">');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="🎬IP质量">');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="🌐网络质量">');
    expect(topic.contentHtml).toContain('<forum-terminal-tab title="📍回程路由">');
    expect(topic.contentHtml).toContain('forum-terminal-code');
    expect(topic.contentHtml).toContain('💻基本信息');
    expect(topic.contentHtml).toContain('🎬IP质量');
    expect(topic.contentHtml).toContain('🌐网络质量');
    expect(topic.contentHtml).toContain('📍回程路由');
    expect(topic.contentHtml).toMatch(/💻基本信息[\s\S]*🎬IP质量[\s\S]*🌐网络质量[\s\S]*📍回程路由/);
    expect(topic.contentHtml).toContain('硬件质量体检报告');
    expect(topic.contentHtml).toContain('IP质量检测完成');
    expect(topic.contentHtml).toContain('联通');
    expect(topic.contentHtml).toContain('CMIN2');
    expect(topic.contentHtml).toContain('color: rgb(0, 255, 0); background-color: rgb(0, 0, 135)');
    expect(topic.contentHtml).toContain('https://Report.Check.Place/hardware/3TKDAONLE.svg');
    expect(topic.contentHtml).not.toContain('language-ansi');
    expect(topic.contentHtml).not.toContain('data-ansicode');
    expect(topic.contentHtml).not.toContain('<code');
    expect(topic.contentHtml).not.toContain('[36m');
    expect(topic.contentHtml).not.toContain('[32m');
    expect(topic.contentHtml).not.toContain('[0m');
  });

  it('renders NodeSeek plain code reports as terminal blocks', async () => {
    const fetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-814058-1">[留一下档🫠]LAX.AS3.Pro.TINY</a>
      <div id="0" data-comment-id="814058" class="content-item">
        <div class="author-info"><a href="/space/79544498" class="author-name">79544498</a></div>
        <time datetime="2026-07-09T08:57:00.000Z"></time>
        <article class="post-content">
          <p>买不起溢价的特价机 凑合着用了 等黑五看看😢😢</p>
          <pre><code>########################################################################
                   IP质量体检报告(Lite)：179.255.*.*
                   https://github.com/xykt/IPQuality
########################################################################</code></pre>
          <pre><code>-----------------------A Bench Script By spiritlhl-----------------------
                   测评频道: https://t.me/+UHVoo2U4VyA5NTQ1
------------------------基础信息查询--感谢所有开源项目------------------</code></pre>
        </article>
      </div>
    `));

    const topic = await getNodeSeekTopic('814058', { fetcher });

    expect(topic.contentHtml).toContain('买不起溢价的特价机');
    expect(topic.contentHtml).toContain('forum-terminal-code');
    expect(topic.contentHtml).toContain('IP质量体检报告(Lite)');
    expect(topic.contentHtml).toContain('A&nbsp;Bench&nbsp;Script&nbsp;By&nbsp;spiritlhl');
    expect(topic.contentHtml).not.toContain('<pre');
    expect(topic.contentHtml).not.toContain('<code');
  });

  it('keeps embedded NodeSeek replies when only the topic body is rendered', async () => {
    const embeddedPayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723707,
        title: 'embedded title',
        comments: [
          { commentId: 100, poster: { name: 'alice' }, content: '<p>embedded body</p>', markdown: 'embedded body' },
          { commentId: 101, poster: { name: 'bob' }, content: '<p>embedded reply</p>', markdown: 'embedded reply markdown' }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`
      <script>${embeddedPayload}</script>
      <a class="post-title" href="/post-723707-1">Rendered topic body</a>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-05-22T15:55:11.000Z"></time>
        <article class="post-content"><p>fresh rendered body</p></article>
      </div>
    `));

    const topic = await getNodeSeekTopic('723707', { fetcher });
    const replies = await getNodeSeekReplies('723707', { fetcher, page: 1, offset: 0, limit: 30 });

    expect(topic.contentHtml).toContain('fresh rendered body');
    expect(topic.replies.map((item) => item.author)).toEqual(['bob']);
    expect(replies.items.map((item) => item.author)).toEqual(['bob']);
  });

  it('prefers rendered NodeSeek replies over stale embedded postData when refreshing replies', async () => {
    const stalePayload = Buffer.from(JSON.stringify({
      postData: {
        postId: 723706,
        title: 'NodeSeek topic',
        comments: [
          { commentId: 100, poster: { name: 'alice' }, markdown: '正文' },
          { commentId: 101, poster: { name: 'old reply' }, markdown: '旧回复' }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`
      <script>${stalePayload}</script>
      <a class="post-title" href="/post-723706-1">Rendered replies</a>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-05-22T15:55:11.000Z"></time>
        <article class="post-content"><p>正文</p></article>
      </div>
      <li id="1" data-comment-id="102" class="content-item">
        <div class="author-info"><a href="/space/2" class="author-name">new reply</a></div>
        <time datetime="2026-05-22T15:59:06.000Z"></time>
        <article class="post-content"><p>新回复</p></article>
      </li>
    `));

    const replies = await getNodeSeekReplies('723706', { fetcher, page: 1, offset: 0, limit: 30 });

    expect(replies.items.map((item) => item.author)).toEqual(['new reply']);
    expect(replies.items[0]).toMatchObject({
      commentId: 102,
      contentHtml: expect.stringContaining('新回复')
    });
    expect(replies.items[0]).not.toHaveProperty('contentMarkdown');
  });

  it('keeps NodeSeek edit metadata when refreshing rendered replies', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 806638,
        title: 'NodeSeek reply refresh metadata',
        comments: [
          {
            commentId: 100,
            floorIndex: 0,
            poster: { name: 'gijia', uid: 18478, profile: '/space/18478' },
            markdown: '论坛邮箱！',
            time: { createdDate: '2026-07-04T06:06:00.000Z' }
          },
          {
            commentId: 812345,
            floorIndex: 12,
            poster: { name: '凡想世界', uid: 54874, isMe: true, profile: '/space/54874' },
            markdown: 'Bd',
            time: { createdDate: '2026-07-04T06:34:00.000Z' }
          }
        ]
      }
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`
      <script>${payload}</script>
      <a class="post-title" href="/post-806638-1">NodeSeek reply refresh metadata</a>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/18478" class="author-name">gijia</a></div>
        <time datetime="2026-07-04T06:06:00.000Z"></time>
        <article class="post-content"><p>论坛邮箱！</p></article>
      </div>
      <div id="12" data-comment-id="812345" class="content-item">
        <div class="author-info"><a href="/space/54874" class="author-name">凡想世界</a></div>
        <time datetime="2026-07-04T06:34:00.000Z"></time>
        <article class="post-content"><p>Bd</p></article>
      </div>
    `));

    const replies = await getNodeSeekReplies('806638', { fetcher, page: 1, offset: 0, limit: 30 });

    expect(replies.items[0]).toMatchObject({
      author: '凡想世界',
      authorId: '54874',
      commentId: 812345,
      floor: 12,
      contentHtml: expect.stringContaining('Bd'),
      contentMarkdown: 'Bd',
      canEdit: true,
      canLike: false
    });
  });

  it('drops linux.do replies that omit their required server floor', async () => {
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

    expect(replies.items).toEqual([]);
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://linux.do/t/42.json',
      expect.stringContaining('https://linux.do/t/42/posts.json')
    ]);
  });

  it('maps linux.do Discourse polls from topic JSON', async () => {
    const fetcher = vi.fn(async () => json({
      id: 42,
      title: 'linux.do poll topic',
      slug: 'linux-poll-topic',
      created_at: '2026-06-03T00:00:00.000Z',
      posts_count: 1,
      post_stream: {
        stream: [1001],
        posts: [{
          id: 1001,
          username: 'alice',
          cooked: [
            '<p>投票前</p>',
            '<div class="poll" data-poll-name="poll"><ul><li>原始方案 A</li><li>原始方案 B</li></ul><div class="poll-info">0 投票人</div></div>',
            '<p>投票后</p>',
            '<iframe src="https://embed.reddit.com/r/OpenAI/comments/abc123/topic/?embed=true"></iframe>'
          ].join(''),
          created_at: '2026-06-03T00:00:00.000Z',
          post_number: 1,
          polls: [{
            id: 88,
            name: 'poll',
            title: '选择方向',
            type: 'multiple',
            status: 'open',
            public: true,
            voters: 2,
            min: 2,
            max: 3,
            options: [
              { id: 'a1', html: '方案 A', votes: 0 },
              { id: 'b2', html: '方案 B', votes: 4 },
              { id: 'c3', html: '方案 C', votes: null }
            ]
          }],
          polls_votes: {
            poll: ['b2']
          }
        }]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.polls).toEqual([{
      id: '88',
      name: 'poll',
      postId: '1001',
      title: '选择方向',
      public: true,
      closed: false,
      multiple: true,
      participantCount: 2,
      min: 2,
      max: 3,
      voted: true,
      options: [
        { id: 'a1', label: '方案 A', count: 0, selected: false },
        { id: 'b2', label: '方案 B', count: 4, selected: true },
        { id: 'c3', label: '方案 C', selected: false }
      ]
    }]);
    expect(topic.contentHtml).toContain('<forum-discourse-poll name="poll"></forum-discourse-poll>');
    expect(topic.contentHtml).not.toContain('原始方案 A');
    expect(topic.contentHtml).not.toContain('0 投票人');
    expect(topic.contentHtml).toContain('<forum-link-card');
    expect(topic.contentHtml).toContain('href="https://www.reddit.com/r/OpenAI/comments/abc123/topic/"');
    expect(topic.contentHtml).not.toContain('嵌入内容 · embed.reddit.com');
    expect(splitDiscourseContentHtml(topic.contentHtml, topic.polls).map((part) => part.type)).toEqual([
      'html',
      'poll',
      'html'
    ]);
  });

  it('maps linux.do Discourse polls from reply posts', async () => {
    const fetcher = vi.fn(async () => json({
      id: 43,
      title: 'linux.do reply poll topic',
      slug: 'linux-reply-poll-topic',
      created_at: '2026-06-03T00:00:00.000Z',
      posts_count: 2,
      post_stream: {
        stream: [1001, 1002],
        posts: [
          {
            id: 1001,
            username: 'alice',
            cooked: '<p>正文</p>',
            created_at: '2026-06-03T00:00:00.000Z',
            post_number: 1
          },
          {
            id: 1002,
            username: 'bob',
            cooked: '<p>回复投票前</p><div class="poll" data-poll-name="reply-poll"><p>原始回复选项</p></div><p>回复投票后</p>',
            created_at: '2026-06-03T00:01:00.000Z',
            post_number: 2,
            polls: [{
              id: 89,
              name: 'reply-poll',
              title: '回复里的评分',
              type: 'number',
              status: 'open',
              options: [
                { id: '1', html: '1 分', votes: 2 },
                { id: '2', html: '2 分', votes: 3 }
              ]
            }]
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '43', fetcher });

    expect(topic.replies[0].polls).toEqual([{
      id: '89',
      name: 'reply-poll',
      postId: '1002',
      title: '回复里的评分',
      type: 'number',
      closed: false,
      multiple: false,
      readonly: true,
      voted: false,
      options: [
        { id: '1', label: '1 分', count: 2, selected: false },
        { id: '2', label: '2 分', count: 3, selected: false }
      ]
    }]);
    expect(topic.replies[0].contentHtml).not.toContain('原始回复选项');
    expect(splitDiscourseContentHtml(topic.replies[0].contentHtml, topic.replies[0].polls).map((part) => part.type)).toEqual([
      'html',
      'poll',
      'html'
    ]);
  });

  it('keeps linux.do tags and topic status markers from Discourse lists', async () => {
    const fetcher = vi.fn(async () => json({
      topic_list: {
        topics: [{
          id: 406,
          title: 'linux.do solved tagged topic',
          slug: 'linux-status-topic',
          category_id: 4,
          created_at: '2026-06-04T00:00:00.000Z',
          bumped_at: '2026-06-04T00:10:00.000Z',
          posts_count: 2,
          closed: true,
          archived: true,
          pinned: true,
          slow_mode_seconds: 300,
          has_accepted_answer: true,
          tags: [
            { name: '人工智能' },
            { name: '快问快答' }
          ]
        }]
      },
      categories: [
        { id: 4, name: '开发调优' }
      ]
    }));

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '406',
      tags: ['人工智能', '快问快答'],
      closed: true,
      archived: true,
      pinned: true,
      solved: true,
      slowModeSeconds: 300
    });
  });

  it('uses linux.do unicode titles from Discourse JSON across lists and detail', async () => {
    const displayTitle = '🫥完辣，ai又来抢饭碗啦，装机仔下岗';
    const rawTitle = ':dotted_line_face:完辣，ai又来抢饭碗啦，装机仔下岗';
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/t/2438917.json')) {
        return json({
          id: 2438917,
          title: rawTitle,
          unicode_title: displayTitle,
          slug: 'topic',
          created_at: '2026-06-20T11:15:45.437Z',
          posts_count: 1,
          post_stream: {
            stream: [19367641],
            posts: [{
              id: 19367641,
              post_number: 1,
              username: 'chancat',
              cooked: '<p>body</p>',
              created_at: '2026-06-20T11:15:45.437Z'
            }]
          }
        });
      }
      return json({
        topic_list: {
          topics: [{
            id: 2438917,
            title: rawTitle,
            unicode_title: displayTitle,
            slug: 'topic',
            created_at: '2026-06-20T11:15:45.437Z',
            bumped_at: '2026-06-20T11:15:45.437Z',
            posts_count: 1
          }]
        },
        users: []
      });
    });

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });
    const topic = await getTopic({ source: 'linuxdo', id: '2438917', fetcher });

    expect(feed.items[0].title).toBe(displayTitle);
    expect(topic.title).toBe(displayTitle);
  });

  it('decodes linux.do numeric title entities when unicode_title is missing', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/t/2438918.json')) {
        return json({
          id: 2438918,
          title: '&#129765;完辣，ai又来抢饭碗啦，装机仔下岗',
          slug: 'topic',
          created_at: '2026-06-20T11:15:45.437Z',
          posts_count: 1,
          post_stream: {
            stream: [19367642],
            posts: [{
              id: 19367642,
              post_number: 1,
              username: 'chancat',
              cooked: '<p>body</p>',
              created_at: '2026-06-20T11:15:45.437Z'
            }]
          }
        });
      }
      return json({
        topic_list: {
          topics: [{
            id: 2438918,
            title: '&#129765;完辣，ai又来抢饭碗啦，装机仔下岗',
            slug: 'topic',
            created_at: '2026-06-20T11:15:45.437Z',
            bumped_at: '2026-06-20T11:15:45.437Z',
            posts_count: 1
          }]
        },
        users: []
      });
    });

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });
    const topic = await getTopic({ source: 'linuxdo', id: '2438918', fetcher });

    expect(feed.items[0].title).toBe('🫥完辣，ai又来抢饭碗啦，装机仔下岗');
    expect(topic.title).toBe('🫥完辣，ai又来抢饭碗啦，装机仔下岗');
  });

  it('keeps linux.do accepted answers and special reply markers from topic JSON', async () => {
    const fetcher = vi.fn(async () => json({
      id: 407,
      title: 'linux.do accepted answer topic',
      slug: 'linux-accepted-answer-topic',
      created_at: '2026-06-04T00:00:00.000Z',
      posts_count: 2,
      closed: true,
      pinned: true,
      slow_mode_seconds: 120,
      tags: [{ name: '人工智能' }],
      accepted_answers: [{
        id: 2002,
        post_number: 2,
        username: 'bob'
      }],
      post_stream: {
        stream: [2001, 2002],
        posts: [
          {
            id: 2001,
            post_number: 1,
            username: 'alice',
            cooked: '<p>body</p>',
            created_at: '2026-06-04T00:00:00.000Z',
            reactions: [
              { id: 'heart', count: 2 },
              { id: 'laughing', count: 1 }
            ],
            boosts: [{ id: 7 }]
          },
          {
            id: 2002,
            post_number: 2,
            username: 'bob',
            cooked: '<p>answer</p>',
            created_at: '2026-06-04T00:02:00.000Z',
            accepted_answer: true,
            wiki: true,
            hidden: true,
            post_type: 2,
            action_code: 'closed.enabled',
            needs_category_expert_approval: true,
            post_folding_status: { status: 'folded' },
            reactions: [{ id: 'distorted_face', count: 3 }],
            boosts: [{ id: 9 }, { id: 10 }]
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '407', fetcher });

    expect(topic).toMatchObject({
      tags: ['人工智能'],
      closed: true,
      pinned: true,
      solved: true,
      acceptedAnswerFloor: 2,
      slowModeSeconds: 120,
      reactionSummary: [
        { id: 'heart', count: 2 },
        { id: 'laughing', count: 1 }
      ],
      siteExtension: { source: 'linuxdo', boostCount: 1 }
    });
    expect(topic.replies[0]).toMatchObject({
      acceptedAnswer: true,
      wiki: true,
      hidden: true,
      folded: true,
      systemAction: true,
      actionCode: 'closed.enabled',
      reactionSummary: [{ id: 'distorted_face', count: 3 }],
      siteExtension: { source: 'linuxdo', boostCount: 2, needsApproval: true }
    });
  });

  it('uses linux.do boost_count when the boosts array is empty', async () => {
    const fetcher = vi.fn(async () => json({
      id: 408,
      title: 'linux.do boost fallback topic',
      slug: 'linux-boost-fallback-topic',
      created_at: '2026-06-04T00:00:00.000Z',
      posts_count: 2,
      post_stream: {
        stream: [2011, 2012],
        posts: [
          {
            id: 2011,
            post_number: 1,
            username: 'alice',
            cooked: '<p>body</p>',
            created_at: '2026-06-04T00:00:00.000Z',
            boosts: [],
            boost_count: 4
          },
          {
            id: 2012,
            post_number: 2,
            username: 'bob',
            cooked: '<p>reply</p>',
            created_at: '2026-06-04T00:02:00.000Z',
            boosts: [],
            boost_count: 5
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '408', fetcher });

    expect(topic.siteExtension).toEqual({ source: 'linuxdo', boostCount: 4 });
    expect(topic.replies[0].siteExtension).toEqual({ source: 'linuxdo', boostCount: 5 });
  });

  it('requests linux.do latest feed by creation time', async () => {
    const fetcher = vi.fn(async () => json({
      topic_list: {
        topics: []
      },
      users: []
    }));

    await getFeed({ source: 'linuxdo', limit: 2, fetcher });

    expect((fetcher.mock.calls as unknown as Array<[string]>)[0]?.[0]).toBe('https://linux.do/latest.json?order=created&ascending=false');
  });

  it('stops linux.do feed pagination when an empty page still advertises more topics', async () => {
    const fetcher = vi.fn(async (_input: string) => {
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

  it('requests linux.do feed filters with category scoped to the same list', async () => {
    const cases = [
      { filter: 'latest', path: '/latest.json', subset: null, order: 'created', ascending: 'false' },
      { filter: 'hot', path: '/hot.json', subset: null, order: null, ascending: null },
      { filter: 'new-all', path: '/new.json', subset: null, order: null, ascending: null },
      { filter: 'new-topics', path: '/new.json', subset: 'topics', order: null, ascending: null },
      { filter: 'new-replies', path: '/new.json', subset: 'replies', order: null, ascending: null }
    ] as const;
    const fetcher = vi.fn(async () => json({
      topic_list: {
        topics: [{
          id: 500,
          title: 'linux.do filtered topic',
          slug: 'linux-filtered-topic',
          created_at: '2026-05-21T00:00:00.000Z',
          bumped_at: '2026-05-21T00:00:00.000Z',
          posts_count: 1
        }]
      },
      users: []
    }));

    for (const item of cases) {
      await getFeed({ source: 'linuxdo', category: '11', feedFilter: item.filter, limit: 1, fetcher });
    }

    const urls = (fetcher.mock.calls as unknown as Array<[string]>).map(([input]) => new URL(input));
    expect(urls.map((url) => url.pathname)).toEqual(cases.map((item) => item.path));
    urls.forEach((url, index) => {
      expect(url.searchParams.get('category')).toBe('11');
      expect(url.searchParams.get('subset')).toBe(cases[index].subset);
      expect(url.searchParams.get('order')).toBe(cases[index].order ?? null);
      expect(url.searchParams.get('ascending')).toBe(cases[index].ascending ?? null);
    });
  });

  it('maps linux.do feed category ids through site categories before showing rows', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/site.json')) {
        return json({
          categories: [
            { id: 4, name: '开发调优' }
          ]
        });
      }
      return json({
        topic_list: {
          topics: [{
            id: 404,
            title: 'linux.do mapped category',
            slug: 'mapped-category',
            category_id: 4,
            created_at: '2026-05-21T00:00:00.000Z',
            bumped_at: '2026-05-21T00:00:00.000Z',
            posts_count: 1
          }]
        },
        users: []
      });
    });

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('maps linux.do topic category ids through site categories before showing details', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/site.json')) {
        return json({
          categories: [
            { id: 4, name: '开发调优' }
          ]
        });
      }
      return json({
        id: 404,
        title: 'linux.do mapped detail category',
        slug: 'mapped-detail-category',
        category_id: 4,
        created_at: '2026-05-21T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-21T00:00:00.000Z' }
          ]
        }
      });
    });

    const topic = await getTopic({ source: 'linuxdo', id: '404', fetcher });

    expect(topic).toMatchObject({
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('labels linux.do feed topics without a category as uncategorized', async () => {
    const fetcher = vi.fn(async () => json({
      topic_list: {
        topics: [{
          id: 405,
          title: 'linux.do uncategorized',
          slug: 'uncategorized',
          created_at: '2026-05-21T00:00:00.000Z',
          bumped_at: '2026-05-21T00:00:00.000Z',
          posts_count: 1
        }]
      },
      users: []
    }));

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      categoryId: undefined,
      category: '未分类'
    });
  });

  it('does not expose linux.do uncategorized as a category tab option', async () => {
    const fetcher = vi.fn(async () => json({
      categories: [{
        id: 1,
        name: '未分类',
        slug: 'uncategorized'
      }, {
        id: 2,
        name: '技术',
        slug: 'tech'
      }, {
        id: 4,
        name: '开发调优',
        slug: 'dev',
        description_text: '只用于原站说明',
        parent_category_id: 2,
        topic_count: 88,
        read_restricted: true
      }]
    }));

    const categories = await getCategories({ source: 'linuxdo', fetcher, nocache: true });

    expect(categories.items).toHaveLength(2);
    expect(categories.items.find((category) => category.id === '4')).toEqual({
      source: 'linuxdo',
      id: '4',
      name: '开发调优',
      slug: 'dev',
      parentId: '2',
      parentSlug: 'tech',
      topicCount: 88,
      readRestricted: true
    });
  });

  it('REG-USER-005 preserves explicit zero statistics for a new linux.do user', async () => {
    const fetcher = vi.fn(async () => json({
      user_summary: {
        topic_count: 0,
        reply_count: 0,
        post_count: 0,
        user: { id: 7, username: 'newbie', name: 'Newbie' }
      },
      topics: []
    }));

    const profile = await getLinuxDoUserProfile('newbie', 'newbie', {
      cursorType: 'topics',
      fetcher
    });

    expect(profile).toMatchObject({ topicCount: 0, replyCount: 0, postCount: 0 });
  });

  it('REG-USER-005 preserves explicit zero statistics for a new NodeSeek user', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/account/getInfo/7')) {
        return json({
          success: true,
          detail: { member_id: 7, member_name: 'newbie', nPost: 0, nComment: 0 }
        });
      }
      if (input.includes('/api/content/list-discussions')) {
        return json({ discussions: [] });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getNodeSeekUserProfile('7', { cursorType: 'topics', fetcher });

    expect(profile).toMatchObject({ topicCount: 0, replyCount: 0, postCount: 0 });
  });

  it('reuses the cached linux.do reply stream after reading topic details', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        return json({
          post_stream: {
            posts: [
              { id: 4, post_number: 4, username: 'reply 4', cooked: '<p>4</p>', created_at: '2026-05-20T00:04:00.000Z' },
              { id: 5, post_number: 5, username: 'reply 5', cooked: '<p>5</p>', created_at: '2026-05-20T00:05:00.000Z' }
            ]
          }
        });
      }
      return json({
        id: 900,
        title: 'linux.do cached topic',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 5,
        post_stream: {
          stream: [1, 2, 3, 4, 5],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
            { id: 2, post_number: 2, username: 'reply 2', cooked: '<p>2</p>', created_at: '2026-05-20T00:02:00.000Z' },
            { id: 3, post_number: 3, username: 'reply 3', cooked: '<p>3</p>', created_at: '2026-05-20T00:03:00.000Z' }
          ]
        }
      });
    });

    const topic = await getTopic({ source: 'linuxdo', id: '900', fetcher });
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

  it('keeps a linux.do topic-body quote preview and loads its cross-topic complete post separately', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (String(input).includes('/t/920.json')) {
        return json({
          id: 920,
          title: 'Referenced topic',
          created_at: '2026-05-20T00:00:00.000Z',
          posts_count: 1,
          post_stream: {
            stream: [11],
            posts: [{
              id: 11,
              post_number: 1,
              username: 'alice',
              cooked: '<p>Complete cross-topic first paragraph.</p><p>Complete cross-topic second paragraph.</p>',
              created_at: '2026-05-20T00:00:00.000Z'
            }]
          }
        });
      }
      return json({
        id: 910,
        title: 'Topic with external quote',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1],
          posts: [{
            id: 1,
            post_number: 1,
            username: 'bob',
            cooked: '<aside data-post="1" class="quote" data-topic="920" data-username="alice"><blockquote><p>Short cross-topic preview.</p></blockquote></aside><p>Topic body</p>',
            created_at: '2026-05-20T00:00:00.000Z'
          }]
        }
      });
    });

    const topic = await getTopic({ source: 'linuxdo', id: '910', fetcher });
    const completePost = await getReply({ source: 'linuxdo', id: '920', floor: 1, fetcher });

    expect(topic.contentHtml).toContain('data-topic="920"');
    expect(topic.contentHtml).toContain('Short cross-topic preview.');
    expect(topic.contentHtml).not.toContain('Complete cross-topic second paragraph.');
    expect(completePost.contentHtml).toBe('<p>Complete cross-topic first paragraph.</p><p>Complete cross-topic second paragraph.</p>');
  });

  it('keeps a linux.do reply quote preview and loads the same-topic complete post separately', async () => {
    const fetcher = vi.fn(async () => json({
      id: 910,
      title: 'linux.do quoted author',
      created_at: '2026-05-20T00:00:00.000Z',
      posts_count: 2,
      post_stream: {
        stream: [1, 2],
        posts: [
          { id: 1, post_number: 1, username: 'alice', cooked: '<p>Complete post first paragraph.</p><p>Complete post second paragraph.</p>', created_at: '2026-05-20T00:00:00.000Z' },
          {
            id: 2,
            post_number: 2,
            username: 'bob',
            cooked: '<aside data-post="1" class="quote" data-topic="910" data-username="alice"><blockquote><p>Short preview.</p></blockquote></aside><p>Reply</p>',
            created_at: '2026-05-20T00:02:00.000Z'
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '910', fetcher });
    const completePost = await getReply({ source: 'linuxdo', id: '910', floor: 1, fetcher });

    expect(topic.replies[0]).toMatchObject({
      quotedFloors: [1],
      quotedAuthors: { 1: 'alice' },
      quotedPreviews: { 1: 'Short preview.' },
      contentHtml: '<p>Reply</p>'
    });
    expect(completePost.contentHtml).toBe('<p>Complete post first paragraph.</p><p>Complete post second paragraph.</p>');
  });

  it('keeps linux.do reply quote author names from quote avatar URLs', async () => {
    const fetcher = vi.fn(async () => json({
      id: 911,
      title: 'linux.do quoted author avatar',
      created_at: '2026-05-20T00:00:00.000Z',
      posts_count: 2,
      post_stream: {
        stream: [1, 2],
        posts: [
          { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
          {
            id: 2,
            post_number: 2,
            username: 'bob',
            cooked: '<aside data-post="1" class="quote" data-topic="911"><div class="title"><img alt="" width="24" height="24" src="https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png" class="avatar"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/911/1">Quoted topic</a></div></div><blockquote><p>Original text</p></blockquote></aside><p>Reply</p>',
            created_at: '2026-05-20T00:02:00.000Z'
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '911', fetcher });

    expect(topic.replies[0].quotedFloors).toEqual([1]);
    expect(topic.replies[0].quotedAuthors).toEqual({ 1: 'alice' });
  });

  it('refreshes linux.do reply stream when reloading the first reply page', async () => {
    let topicJsonCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (String(input).includes('/posts.json')) {
        const url = new URL(String(input));
        const postIds = url.searchParams.getAll('post_ids[]');
        return json({
          post_stream: {
            posts: postIds.map((id) => ({
              id: Number(id),
              post_number: Number(id),
              username: `reply ${id}`,
              cooked: `<p>${id}</p>`,
              created_at: `2026-05-20T00:0${id}:00.000Z`
            }))
          }
        });
      }
      topicJsonCalls += 1;
      return json({
        id: 9901,
        title: 'linux.do refresh replies',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: topicJsonCalls === 1 ? 2 : 3,
        post_stream: {
          stream: topicJsonCalls === 1 ? [1, 2] : [1, 2, 3],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
            { id: 2, post_number: 2, username: 'reply 2', cooked: '<p>2</p>', created_at: '2026-05-20T00:02:00.000Z' }
          ]
        }
      });
    });

    await getTopic({ source: 'linuxdo', id: '9901', fetcher });
    const replies = await getReplies({ source: 'linuxdo', id: '9901', page: 1, offset: 0, limit: 30, fetcher });

    expect(replies.items.map((item) => item.floor)).toEqual([2, 3]);
    expect(fetcher.mock.calls.filter((call) => String(call[0]).includes('/t/9901.json'))).toHaveLength(2);
  });

  it('maps linux.do logged-in post state onto topic and reply actions', async () => {
    const fetcher = vi.fn(async (url) => {
      if (String(url).includes('/posts/1002.json')) {
        return json({
          id: 1002,
          post_number: 2,
          username: 'bob',
          cooked: '<p>reply</p>',
          raw: 'reply raw',
          created_at: '2026-05-20T00:01:00.000Z',
          can_edit: true,
          can_delete: true
        });
      }
      return json({
      id: 900,
      title: 'linux.do logged in topic',
      slug: 'linux-do-logged-in-topic',
      created_at: '2026-05-20T00:00:00.000Z',
      posts_count: 2,
      views: 10,
      bookmarked: true,
      bookmark_id: 700,
      post_stream: {
        stream: [1001, 1002],
        posts: [
          {
            id: 1001,
            post_number: 1,
            username: 'alice',
            cooked: '<p>topic</p>',
            created_at: '2026-05-20T00:00:00.000Z',
            like_count: 3,
            actions_summary: [{ id: 2, acted: true, can_act: false }]
          },
          {
            id: 1002,
            post_number: 2,
            username: 'bob',
            cooked: '<p>reply</p>',
            created_at: '2026-05-20T00:01:00.000Z',
            can_edit: true,
            like_count: 1,
            can_delete: true,
            actions_summary: [{ id: 2, acted: false, can_act: true }]
          }
        ]
      }
    });
    });

    const topic = await getTopic({ source: 'linuxdo', id: '900', fetcher });

    expect(topic).toMatchObject({
      commentId: 1001,
      liked: true,
      likeCount: 3,
      canLike: false,
      bookmarked: true,
      bookmarkId: 700
    });
    expect(topic.replies[0]).toMatchObject({
      commentId: 1002,
      liked: false,
      likeCount: 1,
      canLike: true,
      canDelete: true,
      canEdit: true,
      contentMarkdown: 'reply raw'
    });
  });

  it('marks own linux.do posts unlikable while keeping other posts likable', async () => {
    const fetcher = vi.fn(async () => json({
      id: 902,
      title: 'linux.do own post like permissions',
      slug: 'linux-do-own-post-like-permissions',
      created_at: '2026-05-20T00:00:00.000Z',
      posts_count: 3,
      views: 10,
      post_stream: {
        stream: [2101, 2102, 2103],
        posts: [
          {
            id: 2101,
            post_number: 1,
            username: 'everythink',
            cooked: '<p>topic</p>',
            created_at: '2026-05-20T00:00:00.000Z',
            yours: true,
            actions_summary: [{ id: 2, acted: false, can_act: true }]
          },
          {
            id: 2102,
            post_number: 2,
            username: 'everythink',
            cooked: '<p>own reply</p>',
            created_at: '2026-05-20T00:01:00.000Z',
            yours: true,
            actions_summary: [{ id: 2, acted: false, can_act: true }]
          },
          {
            id: 2103,
            post_number: 3,
            username: 'alice',
            cooked: '<p>other reply</p>',
            created_at: '2026-05-20T00:02:00.000Z',
            actions_summary: [{ id: 2, acted: false, can_act: true }]
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '902', fetcher });

    expect(topic).toMatchObject({ commentId: 2101, canLike: false });
    expect(topic.replies[0]).toMatchObject({ commentId: 2102, canLike: false });
    expect(topic.replies[1]).toMatchObject({ commentId: 2103, canLike: true });
  });

  it('omits linux.do replies that the original site marks as deleted', async () => {
    const fetcher = vi.fn(async () => json({
      id: 901,
      title: 'linux.do deleted reply topic',
      slug: 'linux-do-deleted-reply-topic',
      created_at: '2026-05-20T00:00:00.000Z',
      posts_count: 3,
      views: 10,
      post_stream: {
        stream: [2001, 2002, 2003],
        posts: [
          {
            id: 2001,
            post_number: 1,
            username: 'alice',
            cooked: '<p>topic</p>',
            created_at: '2026-05-20T00:00:00.000Z'
          },
          {
            id: 2002,
            post_number: 2,
            username: 'bob',
            cooked: '<p>visible reply</p>',
            created_at: '2026-05-20T00:01:00.000Z'
          },
          {
            id: 2003,
            post_number: 3,
            username: 'everythink',
            cooked: '<p>(帖子已被作者删除)</p>',
            created_at: '2026-05-20T00:02:00.000Z',
            deleted_at: '2026-05-20T00:03:00.000Z',
            user_deleted: true
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '901', fetcher });

    expect(topic.replies).toHaveLength(1);
    expect(topic.replies[0]).toMatchObject({
      commentId: 2002,
      contentHtml: expect.stringContaining('visible reply')
    });
  });

  it('evicts least recently used linux.do reply streams after the cache limit', async () => {
    const topicJsonCalls: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        return json({
          post_stream: {
            posts: [
              { id: 2, post_number: 2, username: 'reply 2', cooked: '<p>2</p>', created_at: '2026-05-20T00:02:00.000Z' }
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
        posts_count: 2,
        post_stream: {
          stream: [1, 2],
          posts: [
            { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' }
          ]
        }
      });
    });

    for (let id = 8000; id < 8100; id += 1) {
      await getTopic({ source: 'linuxdo', id: String(id), fetcher });
    }
    await getReplies({ source: 'linuxdo', id: '8000', page: 2, offset: 0, limit: 1, fetcher });

    topicJsonCalls.length = 0;
    await getTopic({ source: 'linuxdo', id: '8100', fetcher });
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
      if (input.includes('/search?') && input.includes('q=GPT')) {
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

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekCookie: 'session=login' });

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
    expect(calls).toContain('https://www.nodeseek.com/search?q=GPT');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
    expect(calls).not.toMatch(/\/api\/search|10\.0\.2\.2|127\.0\.0\.1:3000/);
  });

  it('uses the current NodeSeek q search parameter for short terms like GPT', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=GPT')) {
        return html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-606-1">GPT current search result</a></div>
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
      if (input.includes('/search?') && input.includes('keyword=GPT')) {
        return html('<div>搜索词太短😭</div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekCookie: 'session=login' });

    expect(search.items.map((item) => item.id)).toEqual(['606']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?q=GPT');
    expect(calls).not.toContain('keyword=GPT');
  });

  it('keeps NodeSeek site search enabled for short AI terms', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=AI')) {
        return html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-808-1">AI current search result</a></div>
              <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
            </li>
          </ul>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'nodeseek', query: 'AI', fetcher, nodeSeekCookie: 'session=login' });

    expect(search.items.map((item) => item.id)).toEqual(['808']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?q=AI');
  });

  it('keeps official NodeSeek search results even when they do not contain the full query text', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=%E5%AE%89%E5%8D%93%E6%89%8B%E6%9C%BA%E5%85%8D')) {
        return html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-701-1">安卓手机免 root 教程</a></div>
              <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
            </li>
            <li class="post-list-item">
              <div class="post-title"><a href="/post-702-1">怎么把别的手机短信转发过来？</a></div>
              <div class="post-info"><time datetime="2026-05-22T00:00:00.000Z"></time></div>
            </li>
          </ul>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'nodeseek', query: '安卓手机免', fetcher, nodeSeekCookie: 'session=login' });

    expect(search.items.map((item) => item.id)).toEqual(['701', '702']);
  });

  it('keeps NodeSeek search usable when anonymous search falls back to Google results', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'www.google.com' && url.searchParams.get('q') === 'site:nodeseek.com codex') {
        return html(`
          <html>
            <head><title>site:nodeseek.com codex - Google Search</title></head>
            <body>
              <a href="https://www.nodeseek.com/post-861593-1"><span>https://www.nodeseek.com</span><h3>claude code 好用 还是 codex 好用 。我小白想试下水</h3></a>
              <a href="/url?q=https%3A%2F%2Fwww.nodeseek.com%2Fpost-861594-1&amp;sa=U">Codex 镜像讨论</a>
            </body>
          </html>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'nodeseek', query: 'codex', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['861593', '861594']);
    expect(search.items[0]).toMatchObject({
      source: 'nodeseek',
      title: 'claude code 好用 还是 codex 好用 。我小白想试下水',
      url: 'https://www.nodeseek.com/post-861593-1'
    });
    expect(search.items[1]?.url).toBe('https://www.nodeseek.com/post-861594-1');
  });

  it('allows only NodeSeek-scoped Google search pages in the hidden NodeSeek browser fetcher', () => {
    expect(isNodeSeekBrowserFetchUrl('https://www.nodeseek.com/search?q=codex')).toBe(true);
    expect(isNodeSeekBrowserFetchUrl('https://www.google.com/search?q=site%3Anodeseek.com+codex')).toBe(true);
    expect(isNodeSeekBrowserFetchUrl('https://www.google.com/search?q=codex')).toBe(false);
    expect(isNodeSeekBrowserFetchUrl('https://example.com/search?q=site%3Anodeseek.com+codex')).toBe(false);
  });

  it('loads more NodeSeek Google fallback search pages by Google start offset', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'www.google.com' && !url.searchParams.has('start')) {
        return html(`
          <html>
            <head><title>site:nodeseek.com codex - Google Search</title></head>
            <body>
              <a href="https://www.nodeseek.com/post-861593-1">NodeSeek first page codex</a>
              <a rel="next" href="/search?q=site%3Anodeseek.com+codex&start=10">Next</a>
            </body>
          </html>
        `);
      }
      if (url.hostname === 'www.google.com' && url.searchParams.get('start') === '10') {
        return html(`
          <html>
            <head><title>site:nodeseek.com codex - Google Search</title></head>
            <body>
              <a href="https://www.nodeseek.com/post-861594-1">NodeSeek second page codex</a>
              <a rel="next" href="/search?q=site%3Anodeseek.com+codex&start=20">Next</a>
            </body>
          </html>
        `);
      }
      if (url.hostname === 'www.google.com' && url.searchParams.get('start') === '20') {
        return html(`
          <html>
            <head><title>site:nodeseek.com codex - Google Search</title></head>
            <body>
              <a href="https://www.nodeseek.com/post-861595-1">NodeSeek third page codex</a>
            </body>
          </html>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await searchTopics({ source: 'nodeseek', query: 'codex', limit: 1, fetcher });
    const second = await searchTopics({ source: 'nodeseek', query: 'codex', page: first.nextPage ?? 2, limit: 1, fetcher });
    const third = await searchTopics({ source: 'nodeseek', query: 'codex', page: second.nextPage ?? 3, limit: 1, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['861593']);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['861594']);
    expect(second.nextPage).toBe(3);
    expect(third.items.map((item) => item.id)).toEqual(['861595']);
    expect(third.hasMore).toBe(false);
    const googleStarts = fetcher.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.hostname === 'www.google.com')
      .map((url) => url.searchParams.get('start'));
    expect(googleStarts).toEqual([null, '10', '20']);
  });

  it('keeps empty NodeSeek site search results empty instead of filtering the latest feed', async () => {
    const latestPayload = Buffer.from(JSON.stringify({
      rotateTopics: [{
        postId: 303,
        titleText: 'xyz latest incidental match',
        titleLink: '/post-303-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-21T00:00:00.000Z' }
      }]
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=xyz')) {
        return html('<ul class="post-list"></ul>');
      }
      return html(`<script>${latestPayload}</script>`);
    });

    const search = await searchTopics({ source: 'nodeseek', query: 'xyz', fetcher, nodeSeekCookie: 'session=login' });

    expect(search.items).toEqual([]);
    const callUrls = fetcher.mock.calls.map((call) => call[0]);
    expect(callUrls).toContain('https://www.nodeseek.com/search?q=xyz');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
  });

  it('keeps empty NodeSeek search pages empty when they include stale embedded shell topics', async () => {
    const stalePayload = Buffer.from(JSON.stringify({
      rotateTopics: [{
        postId: 305,
        titleText: 'stale shell result',
        titleLink: '/post-305-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-21T00:00:00.000Z' }
      }]
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`
      <script>${stalePayload}</script>
      <form action="/search"><input name="q" value="missing" /></form>
      <ul class="post-list"></ul>
      <div class="empty-state">没有找到相关内容</div>
    `));

    const search = await searchTopics({ source: 'nodeseek', query: 'missing', fetcher, nodeSeekCookie: 'session=login' });

    expect(search.items).toEqual([]);
  });

  it('surfaces incomplete NodeSeek search pages as a retryable failure', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=retry')) {
        return html('<main><form action="/search"><input name="q" value="retry" /></form></main>');
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(searchTopics({ source: 'nodeseek', query: 'retry', fetcher, nodeSeekCookie: 'session=login' })).rejects.toThrow('NodeSeek 搜索页结果没有加载完成，请重试');
  });

  it('surfaces NodeSeek site search failures instead of filtering the latest feed', async () => {
    const latestPayload = Buffer.from(JSON.stringify({
      rotateTopics: [{
        postId: 304,
        titleText: 'failure latest incidental match',
        titleLink: '/post-304-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-21T00:00:00.000Z' }
      }]
    })).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=failure')) {
        throw new Error('NodeSeek search failed');
      }
      return html(`<script>${latestPayload}</script>`);
    });

    await expect(searchTopics({ source: 'nodeseek', query: 'failure', fetcher, nodeSeekCookie: 'session=login' })).rejects.toThrow('NodeSeek search failed');
    const callUrls = fetcher.mock.calls.map((call) => call[0]);
    expect(callUrls).toContain('https://www.nodeseek.com/search?q=failure');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
  });

  it('does not request another NodeSeek search page when no next link exists', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('page=2')) {
        return html('<ul class="post-list"><li><a href="/post-909-1">GPT unrelated second page</a></li></ul>');
      }
      if (input.includes('/search?') && input.includes('q=GPT')) {
        return html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-202-1">GPT single page result</a></div>
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
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekCookie: 'session=login' });

    expect(search.items.map((item) => item.id)).toEqual(['202']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?q=GPT');
    expect(calls).not.toContain('page=2');
  });

  it('reports and reads the next NodeSeek search page', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('page=2')) {
        return html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-203-1">GPT second page result</a></div>
              <div class="post-info"><time datetime="2026-05-20T00:00:00.000Z"></time></div>
            </li>
          </ul>
        `);
      }
      return html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-202-1">GPT first page result</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
        <a rel="next" href="/search?q=GPT&page=2">Next</a>
      `);
    });

    const first = await searchTopics({ source: 'nodeseek', query: 'GPT', limit: 1, fetcher, nodeSeekCookie: 'session=login' });
    const second = await searchTopics({ source: 'nodeseek', query: 'GPT', page: first.nextPage ?? 2, limit: 1, fetcher, nodeSeekCookie: 'session=login' });

    expect(first.items.map((item) => item.id)).toEqual(['202']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['203']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.nodeseek.com/search?q=GPT&page=2');
  });

  it('prefers rendered NodeSeek search rows over stale embedded shell topics', async () => {
    const staleEmbeddedPayload = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 201, titleText: 'stale search page one', titleLink: '/post-201-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T02:00:00.000Z' } },
        { postId: 200, titleText: 'stale search page one older', titleLink: '/post-200-1', op: { name: 'bob' }, time: { createdDate: '2026-05-20T01:00:00.000Z' } }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`
      <script>${staleEmbeddedPayload}</script>
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-199-1">Rendered search page two newer</a></div>
          <div class="post-info">
            <a href="/space/1" class="info-author">carol</a>
            <time datetime="2026-05-19T02:00:00.000Z"></time>
          </div>
        </li>
        <li class="post-list-item">
          <div class="post-title"><a href="/post-198-1">Rendered search page two older</a></div>
          <div class="post-info">
            <a href="/space/2" class="info-author">dave</a>
            <time datetime="2026-05-19T01:00:00.000Z"></time>
          </div>
        </li>
      </ul>
    `));

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', page: 2, limit: 2, fetcher, nodeSeekCookie: 'session=login' });

    expect(search.items.map((item) => item.id)).toEqual(['199', '198']);
  });

  it('uses Google results for anonymous linux.do search inside the app', async () => {
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      expect(url.hostname).toBe('www.google.com');
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe('site:linux.do codex');
      expect(JSON.stringify(init?.headers || {})).not.toContain('Cookie');
      return html(`
          <html>
            <head><title>site:linux.do codex - Google Search</title></head>
            <body>
            <a href="https://linux.do/t/topic/1424130"><span>https://linux.do</span><h3>Codex CLI 讨论</h3></a>
            <a href="/url?q=https%3A%2F%2Flinux.do%2Ft%2Ftopic%2F1577485&amp;sa=U">Codex 镜像讨论</a>
            <a href="/url?url=https%3A%2F%2Flinux.do%2Ft%2Ftopic%2F1577486&amp;sa=U">Codex 另一条讨论</a>
            <a href="https://linux.do/about">linux.do about</a>
            <a href="https://example.com/t/topic/999">外站结果</a>
          </body>
        </html>
      `);
    });

    const search = await searchTopics({ source: 'linuxdo', query: 'codex', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['1424130', '1577485', '1577486']);
    expect(search.items[0]).toMatchObject({
      source: 'linuxdo',
      title: 'Codex CLI 讨论',
      url: 'https://linux.do/t/1424130'
    });
    expect(fetcher.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('https://linux.do/search');
  });

  it('loads more anonymous linux.do Google search pages by Google start offset', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.hostname === 'www.google.com' && !url.searchParams.has('start')) {
        return html(`
          <html>
            <head><title>site:linux.do codex - Google Search</title></head>
            <body>
              <a href="https://linux.do/t/topic/1424130">linux.do first page codex</a>
              <a rel="next" href="/search?q=site%3Alinux.do+codex&start=10">Next</a>
            </body>
          </html>
        `);
      }
      if (url.hostname === 'www.google.com' && url.searchParams.get('start') === '10') {
        return html(`
          <html>
            <head><title>site:linux.do codex - Google Search</title></head>
            <body>
              <a href="https://linux.do/t/topic/1577485">linux.do second page codex</a>
              <a rel="next" href="/search?q=site%3Alinux.do+codex&start=20">Next</a>
            </body>
          </html>
        `);
      }
      if (url.hostname === 'www.google.com' && url.searchParams.get('start') === '20') {
        return html(`
          <html>
            <head><title>site:linux.do codex - Google Search</title></head>
            <body>
              <a href="https://linux.do/t/topic/1577486">linux.do third page codex</a>
            </body>
          </html>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await searchTopics({ source: 'linuxdo', query: 'codex', limit: 1, fetcher });
    const second = await searchTopics({ source: 'linuxdo', query: 'codex', page: first.nextPage ?? 2, limit: 1, fetcher });
    const third = await searchTopics({ source: 'linuxdo', query: 'codex', page: second.nextPage ?? 3, limit: 1, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['1424130']);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['1577485']);
    expect(second.nextPage).toBe(3);
    expect(third.items.map((item) => item.id)).toEqual(['1577486']);
    expect(third.hasMore).toBe(false);
    expect(fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('start'))).toEqual([null, '10', '20']);
  });

  it('keeps empty linux.do search responses empty instead of falling back to latest topics', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/session/csrf.json')) {
        return json({ csrf: 'csrf-token' });
      }
      if (input.includes('linux.do/search?')) {
        return json({ topics: [], posts: [] });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'linuxdo', query: 'fallback keyword', fetcher });

    expect(search.items).toEqual([]);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://linux.do/search');
    expect(calls).not.toContain('https://linux.do/latest.json');
  });

  it('REG-SEARCH-003 maps Discourse search post authors and paginates results', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe('keyword');
      expect(url.searchParams.get('page')).toBe('1');
      expect(url.searchParams.has('type_filter')).toBe(false);
      return json({
        grouped_search_result: { more_full_page_results: false },
        topics: [501, 502, 503].map((id) => ({
          id,
          title: `linux result ${id} keyword`,
          slug: `linux-result-${id}`,
          created_at: '2026-05-21T00:00:00.000Z',
          bumped_at: '2026-05-21T00:00:00.000Z',
          posts_count: 1
        })),
        posts: [501, 502, 503].map((id) => ({
          id: id + 1000,
          topic_id: id,
          username: `author-${id}`,
          avatar_template: `/user_avatar/linux.do/author-${id}/{size}/1.png`,
          blurb: `matching post ${id}`
        })),
        users: []
      });
    });

    const first = await searchTopics({ source: 'linuxdo', query: 'keyword', limit: 1, fetcher });
    const second = await searchTopics({ source: 'linuxdo', query: 'keyword', page: first.nextPage ?? 2, limit: 1, fetcher });

    expect(first.items).toEqual([expect.objectContaining({
      id: '501',
      author: 'author-501',
      authorAvatar: 'https://linux.do/user_avatar/linux.do/author-501/96/1.png'
    })]);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['502']);
    const searchCalls = fetcher.mock.calls.map((call) => new URL(String(call[0]))).filter((url) => url.pathname === '/search');
    expect(searchCalls.map((url) => url.searchParams.get('page'))).toEqual(['1', '1']);
  });

  it('keeps official linux.do search results even when they do not contain the full query text', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/search?')) {
        return json({
          grouped_search_result: { more_full_page_results: false },
          topics: [
            {
              id: 901,
              title: '国产安卓手机免root跳过原生esim认证申请giffgaff卡',
              slug: 'android-esim-giffgaff',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            },
            {
              id: 902,
              title: '怎么把别的手机收的短信转发到我的手机上？',
              slug: 'sms-forward',
              created_at: '2026-05-20T00:00:00.000Z',
              bumped_at: '2026-05-20T00:00:00.000Z',
              posts_count: 1
            }
          ],
          posts: [
            { topic_id: 902, blurb: '官方搜索认为这个话题相关。' }
          ],
          users: []
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'linuxdo', query: '安卓手机免', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['901', '902']);
  });

  it('matches the official linux.do search request from the logged-in page', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async (input: string, _init?: RequestInit) => {
      const url = new URL(input);
      if (url.pathname === '/session/csrf.json') {
        return json({ csrf: 'csrf-token' });
      }
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe('keyword');
      expect(url.searchParams.get('page')).toBe('1');
      expect(url.searchParams.has('type_filter')).toBe(false);
      return json({
        topics: [{
          id: 605,
          title: 'linux latest keyword',
          slug: 'linux-latest-keyword',
          created_at: '2026-05-21T00:00:00.000Z',
          bumped_at: '2026-05-21T00:00:00.000Z',
          posts_count: 1
        }],
        users: []
      });
    });

    const search = await searchTopics({ source: 'linuxdo', query: 'keyword', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['605']);
    const calls = fetcher.mock.calls.map((call) => String(call[0])).join('\n');
    expect(calls).toContain('https://linux.do/search');
    expect(calls).not.toContain('https://linux.do/discourse-ai/embeddings/semantic-search');
    const searchCall = fetcher.mock.calls.find((call) => new URL(String(call[0])).pathname === '/search');
    const init = searchCall?.[1];
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Discourse-Present': 'true',
        Referer: 'https://linux.do/search?expanded=true&q=keyword',
        'X-CSRF-Token': 'csrf-token',
        'X-Requested-With': 'XMLHttpRequest'
      })
    }));
  });

  it('maps linux.do search result category ids through site categories', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/search?')) {
        return json({
          topics: [{
            id: 701,
            title: 'linux category keyword',
            slug: 'linux-category-keyword',
            category_id: 4,
            created_at: '2026-05-21T00:00:00.000Z',
            bumped_at: '2026-05-21T00:00:00.000Z',
            posts_count: 1
          }],
          users: []
        });
      }
      if (input.includes('linux.do/site.json')) {
        return json({
          categories: [{
            id: 4,
            name: '开发调优',
            slug: 'dev'
          }]
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'linuxdo', query: 'keyword', fetcher });

    expect(search.items[0]).toMatchObject({
      id: '701',
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('keeps linux.do search results in the official relevance order', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/search?')) {
        return json({
          topics: [
            {
              id: 801,
              title: 'linux older keyword',
              slug: 'linux-older-keyword',
              created_at: '2026-05-20T00:00:00.000Z',
              bumped_at: '2026-05-28T00:00:00.000Z',
              posts_count: 1
            },
            {
              id: 802,
              title: 'linux newer keyword',
              slug: 'linux-newer-keyword',
              created_at: '2026-05-22T00:00:00.000Z',
              bumped_at: '2026-05-22T00:00:00.000Z',
              posts_count: 1
            }
          ],
          users: []
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'linuxdo', query: 'keyword', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['801', '802']);
  });

  it('sends saved linux.do login cookies when searching', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(JSON.stringify({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      savedAt: '2026-05-26T00:00:00.000Z',
      source: 'webview',
      userAgent: 'LinuxDo WebView UA'
    }));
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/session/csrf.json')) {
        return json({ csrf: 'csrf-token' });
      }
      if (input.includes('/search?')) {
        return json({
          topics: [{
            id: 601,
            title: 'linux logged in keyword',
            slug: 'linux-logged-in-keyword',
            created_at: '2026-05-21T00:00:00.000Z',
            bumped_at: '2026-05-21T00:00:00.000Z',
            posts_count: 1
          }],
          users: []
        });
      }
      throw new Error(`unexpected ${input} ${JSON.stringify(init)}`);
    });

    const search = await searchTopics({ source: 'linuxdo', query: 'keyword', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['601']);
    const [input, init] = fetcher.mock.calls.find((call) => new URL(String(call[0])).pathname === '/search') || [];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('keyword');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('type_filter')).toBe(false);
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Cookie: 'cf_clearance=clearance; _t=login; _forum_session=session',
        'Discourse-Logged-In': 'true',
        Referer: 'https://linux.do/search?expanded=true&q=keyword',
        'User-Agent': 'LinuxDo WebView UA',
        'X-CSRF-Token': 'csrf-token',
        'X-Requested-With': 'XMLHttpRequest'
      })
    }));
  });

  it('sends saved NodeSeek verification cookies when reading the Android feed', async () => {
    const fetcher = vi.fn(async () => html(`<script>${nodeSeekPayload}</script>`));

    await getFeed({
      source: 'nodeseek',
      fetcher,
      nodeSeekCookie: 'cf_clearance=clearance',
      nodeSeekUserAgent: 'NodeSeek WebView UA'
    });

    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/?sortBy=postTime', expect.objectContaining({
      headers: expect.objectContaining({
        cookie: 'cf_clearance=clearance',
        'User-Agent': 'NodeSeek WebView UA'
      })
    }));
  });

  it('reads the NodeSeek feed by latest replies when requested', async () => {
    const fetcher = vi.fn(async () => html(`<script>${nodeSeekPayload}</script>`));

    await getFeed({
      source: 'nodeseek',
      feedFilter: 'replyTime',
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/?sortBy=replyTime', expect.any(Object));
  });

  it('sends no-cache headers when refreshing the NodeSeek Android feed', async () => {
    const fetcher = vi.fn(async () => html(`<script>${nodeSeekPayload}</script>`));

    await getFeed({
      source: 'nodeseek',
      fetcher,
      nocache: true
    });

    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/?sortBy=postTime', expect.objectContaining({
      headers: expect.objectContaining({
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
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
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/?sortBy=postTime', expect.any(Object));
  });

  it('reports Chinese NodeSeek Cloudflare HTML as a verification requirement', async () => {
    const fetcher = vi.fn(async () => html('<html><title>请稍候…</title><body>正在进行安全验证。本网站使用安全服务防护恶意自动程序。</body></html>'));

    await expect(getFeed({ source: 'nodeseek', fetcher })).rejects.toMatchObject({
      source: 'nodeseek',
      reason: 'cloudflare',
      message: 'NodeSeek 需要完成 Cloudflare 验证'
    });
  });

  it('uses normal fetch for NodeSeek when the HTML is already readable', async () => {
    const normalFetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743010-1">NodeSeek normal detail</a>
      <div class="content-item">
        <article class="post-content"><p>正常正文</p></article>
      </div>
    `));
    const webViewFetcher = vi.fn(async () => html('<html>webview fallback should not be used</html>'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743010', fetcher });

    expect(topic.title).toBe('NodeSeek normal detail');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable NodeSeek lists that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () => html(`
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743013-1">NodeSeek direct list row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `));
    const webViewFetcher = vi.fn(async () => html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743014-1">NodeSeek WebView list row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await getFeed({ source: 'nodeseek', fetcher });

    expect(result.items.map((item) => item.title)).toEqual(['NodeSeek direct list row']);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable NodeSeek details that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () => html(`
      <div class="cf-turnstile"></div>
      <a class="post-title" href="/post-743015-1">NodeSeek direct detail</a>
      <div class="content-item">
        <article class="post-content"><p>直接正文</p></article>
      </div>
    `));
    const webViewFetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743015-1">NodeSeek WebView detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743015', fetcher });

    expect(topic.title).toBe('NodeSeek direct detail');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable embedded NodeSeek details that include challenge scripts', async () => {
    const directPayload = Buffer.from(JSON.stringify({
      postData: {
        title: 'NodeSeek direct embedded detail',
        op: { name: 'alice' },
        comments: [
          {
            commentId: 1,
            poster: { name: 'alice' },
            markdown: '直接嵌入正文',
            time: { createdDate: '2026-05-21T00:00:00.000Z' }
          }
        ]
      }
    })).toString('base64');
    const normalFetcher = vi.fn(async () => html(`
      <script>${directPayload}</script>
      <div class="cf-turnstile"></div>
    `));
    const webViewFetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743016-1">NodeSeek WebView embedded detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743016', fetcher });

    expect(topic.title).toBe('NodeSeek direct embedded detail');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('retries NodeSeek through the WebView fallback only after Cloudflare', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const normalFetcher = vi.fn(async () => new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743011-1">NodeSeek fallback detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743011', fetcher });

    expect(topic.title).toBe('NodeSeek fallback detail');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/post-743011-1');
    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'nodeseek', reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', status: 403, reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', status: 200 }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', channel: 'webview' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/743011|post-|https?:|cf-turnstile/);
  });

  it('keeps NodeSeek direct and WebView fallback stages on the caller trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const trace = beginDiagnosticTrace('topic', 'open');
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: async () => new Response('<html><div class="cf-turnstile"></div></html>', {
        status: 403,
        headers: { 'cf-mitigated': 'challenge' }
      }),
      webViewFetcher: async () => html(`
        <a class="post-title" href="/post-743019-1">NodeSeek shared trace detail</a>
        <div class="content-item"><article class="post-content"><p>正文</p></article></div>
      `)
    });

    const topic = await getTopic({
      source: 'nodeseek',
      id: '743019',
      fetcher: withDiagnosticFetcher(trace, fallbackFetcher)
    });
    finishDiagnosticTrace(trace, 'success');

    expect(topic.title).toBe('NodeSeek shared trace detail');
    const events = lines.map((line) => JSON.parse(line));
    expect(new Set(events.map((event) => event.traceId))).toEqual(new Set([trace.traceId]));
    expect(events.filter((event) => event.phase === 'intent')).toHaveLength(1);
    expect(events.filter((event) => event.phase === 'finish')).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'transport', channel: 'direct', state: 'fallback' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', state: 'finish' })
    ]));
  });

  it('keeps NodeSeek edit metadata when replies use the WebView fallback', async () => {
    const payload = Buffer.from(JSON.stringify({
      postData: {
        postId: 806638,
        comments: [
          {
            commentId: 100,
            floorIndex: 0,
            poster: { name: 'gijia', uid: 18478 },
            markdown: '论坛邮箱！',
            time: { createdDate: '2026-07-04T06:06:00.000Z' }
          },
          {
            commentId: 812345,
            floorIndex: 12,
            poster: { name: '凡想世界', uid: 54874, isMe: true },
            markdown: 'Bd',
            time: { createdDate: '2026-07-04T06:34:00.000Z' }
          }
        ]
      }
    })).toString('base64');
    const normalFetcher = vi.fn(async () => new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => html(`<script id="temp-script" type="application/json">${payload}</script>`));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const replies = await getNodeSeekReplies('806638', { fetcher, page: 1, offset: 0, limit: 30 });

    expect(replies.items[0]).toMatchObject({
      author: '凡想世界',
      authorId: '54874',
      commentId: 812345,
      floor: 12,
      contentMarkdown: 'Bd',
      canEdit: true,
      canLike: false
    });
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('retries NodeSeek topic details through the WebView fallback when normal fetch stalls', async () => {
    vi.useFakeTimers();
    try {
      const normalFetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      }));
      const webViewFetcher = vi.fn(async () => html(`
        <a class="post-title" href="/post-743012-1">NodeSeek slow fallback detail</a>
        <div class="content-item">
          <article class="post-content"><p>慢请求兜底正文</p></article>
        </div>
      `));
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher: normalFetcher,
        webViewFetcher
      });

      const topicPromise = getTopic({ source: 'nodeseek', id: '743012', fetcher });
      await vi.advanceTimersByTimeAsync(8000);
      const topic = await topicPromise;

      expect(topic.title).toBe('NodeSeek slow fallback detail');
      expect(normalFetcher).toHaveBeenCalledTimes(1);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      const webViewCalls = webViewFetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
      expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/post-743012-1');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('REG-TOPIC-021 keeps a completed NodeSeek direct response alive across a short background pause', async () => {
    vi.useFakeTimers();
    const directHtml = `
      <a class="post-title" href="/post-743022-1">NodeSeek background detail</a>
      <div class="content-item">
        <article class="post-content"><p>后台正文</p></article>
      </div>
    `;
    let resolveChallengeBody: ((value: string) => void) | undefined;
    const response = html(directHtml);
    vi.spyOn(response, 'clone').mockReturnValue({
      text: () => new Promise<string>((resolve) => { resolveChallengeBody = resolve; })
    } as Response);
    const normalFetcher = vi.fn(async () => response);
    const webViewFetcher = vi.fn(async () => html('<html>offline fallback must not run</html>'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({ defaultFetcher: normalFetcher, webViewFetcher });

    try {
      const topicPromise = getTopic({
        source: 'nodeseek',
        id: '743022',
        fetcher,
        timeoutMs: 30_000
      });
      let outcome: { topic?: Awaited<typeof topicPromise>; error?: unknown } | undefined;
      void topicPromise.then(
        (topic) => { outcome = { topic }; },
        (error) => { outcome = { error }; }
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(resolveChallengeBody).toBeTypeOf('function');

      setRequestTimeoutsActive(false);
      await vi.advanceTimersByTimeAsync(35_000);
      expect(outcome).toBeUndefined();

      setRequestTimeoutsActive(true);
      resolveChallengeBody?.(directHtml);
      const topic = await topicPromise;

      expect(topic.title).toBe('NodeSeek background detail');
      expect(webViewFetcher).not.toHaveBeenCalled();
    } finally {
      setRequestTimeoutsActive(true);
      resolveChallengeBody?.(directHtml);
      await vi.advanceTimersByTimeAsync(0);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('retries NodeSeek feed through the WebView fallback when normal fetch stalls', async () => {
    vi.useFakeTimers();
    try {
      const normalFetcher = vi.fn(() => new Promise<Response>(() => undefined));
      const webViewFetcher = vi.fn(async () => html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-743018-1">NodeSeek slow fallback list row</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `));
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher: normalFetcher,
        webViewFetcher
      });

      const feedPromise = getFeed({ source: 'nodeseek', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      const feed = await feedPromise;

      expect(feed.items.map((item) => item.title)).toEqual(['NodeSeek slow fallback list row']);
      expect(normalFetcher).toHaveBeenCalledTimes(1);
      const webViewCalls = webViewFetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
      expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/?sortBy=postTime');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('recovers the NodeSeek direct channel after repeated direct timeouts with successful WebView fallbacks', async () => {
    vi.useFakeTimers();
    try {
      const normalFetcher = vi.fn(() => new Promise<Response>(() => undefined));
      const webViewFetcher = vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname === '/') {
          return html(`
            <ul class="post-list">
              <li class="post-list-item">
                <div class="post-title"><a href="/post-743019-1">NodeSeek first slow fallback</a></div>
                <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
              </li>
            </ul>
          `);
        }
        return html(`
          <a class="post-title" href="/post-743020-1">NodeSeek second slow fallback</a>
          <div class="content-item">
            <article class="post-content"><p>second fallback body</p></article>
          </div>
        `);
      });
      const recoverNodeSeekNetwork = vi.fn(async () => undefined);
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher: normalFetcher,
        webViewFetcher,
        recoverNodeSeekNetwork
      });

      const feedPromise = getFeed({ source: 'nodeseek', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(feedPromise).resolves.toMatchObject({
        items: [expect.objectContaining({ title: 'NodeSeek first slow fallback' })]
      });
      expect(recoverNodeSeekNetwork).not.toHaveBeenCalled();

      const topicPromise = getTopic({ source: 'nodeseek', id: '743020', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(topicPromise).resolves.toMatchObject({
        title: 'NodeSeek second slow fallback'
      });

      expect(recoverNodeSeekNetwork).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not recover the NodeSeek direct channel when Cloudflare causes the WebView fallback', async () => {
    const normalFetcher = vi.fn(async () => new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743021-1">NodeSeek Cloudflare fallback detail</a>
      <div class="content-item">
        <article class="post-content"><p>cloudflare fallback body</p></article>
      </div>
    `));
    const recoverNodeSeekNetwork = vi.fn(async () => undefined);
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher,
      recoverNodeSeekNetwork
    });

    await getTopic({ source: 'nodeseek', id: '743021', fetcher });
    await getTopic({ source: 'nodeseek', id: '743021', fetcher });

    expect(webViewFetcher).toHaveBeenCalledTimes(2);
    expect(recoverNodeSeekNetwork).not.toHaveBeenCalled();
  });

  it('uses direct fetch for readable NodeSeek search pages', async () => {
    const webViewFetcher = vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get('q') || '';
      const id = query.toLowerCase() === 'ai' ? '809' : '810';
      return html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-${id}-1">${query} WebView search result</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `);
    });
    const normalFetcher = vi.fn(async (input: string) => {
      const query = new URL(input).searchParams.get('q') || '';
      const id = query.toLowerCase() === 'ai' ? '809' : '810';
      return html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-${id}-1">${query} direct search result</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `);
    });
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const aiSearch = await searchTopics({ source: 'nodeseek', query: 'ai', fetcher, nodeSeekCookie: 'session=login' });
    const codexSearch = await searchTopics({ source: 'nodeseek', query: 'codex', fetcher, nodeSeekCookie: 'session=login' });

    expect(aiSearch.items.map((item) => item.id)).toEqual(['809']);
    expect(codexSearch.items.map((item) => item.id)).toEqual(['810']);
    expect(normalFetcher).toHaveBeenCalledTimes(2);
    expect(webViewFetcher).not.toHaveBeenCalled();
    const normalCalls = normalFetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(normalCalls[0]?.[0]).toBe('https://www.nodeseek.com/search?q=ai');
    expect(normalCalls[1]?.[0]).toBe('https://www.nodeseek.com/search?q=codex');
  });

  it('uses direct fetch for empty NodeSeek search pages that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () => html(`
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      <form action="/search"><input name="q" value="missing"></form>
      <div class="post-list"></div>
      <div class="empty-state">没有找到相关内容</div>
    `));
    const webViewFetcher = vi.fn(async () => html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743017-1">NodeSeek WebView search row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'missing', fetcher, nodeSeekCookie: 'session=login' });

    expect(result.items).toEqual([]);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses the NodeSeek WebView fallback when soft challenge markers have no readable content', async () => {
    const normalFetcher = vi.fn(async () => html('<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>'));
    const webViewFetcher = vi.fn(async () => html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743018-1">soft challenge WebView search result</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'soft', fetcher, nodeSeekCookie: 'session=login' });

    expect(result.items.map((item) => item.id)).toEqual(['743018']);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the NodeSeek WebView fallback for search only after Cloudflare', async () => {
    const normalFetcher = vi.fn(async () => new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-811-1">cf WebView search result</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'cf', fetcher, nodeSeekCookie: 'session=login' });

    expect(result.items.map((item) => item.id)).toEqual(['811']);
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/search?q=cf');
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

  it('keeps NodeSeek feed in the origin post-time order', async () => {
    const payload = Buffer.from(JSON.stringify({
      rotateTopics: [{
        postId: 201,
        titleText: 'Newer post first',
        titleLink: '/post-201-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-20T02:00:00.000Z' },
        updatedDate: '2026-05-20T02:00:00.000Z'
      }, {
        postId: 200,
        titleText: 'Older post with newer reply',
        titleLink: '/post-200-1',
        op: { name: 'bob' },
        time: { createdDate: '2026-05-20T01:00:00.000Z' },
        updatedDate: '2026-05-20T03:00:00.000Z'
      }]
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const feed = await getFeed({ source: 'nodeseek', limit: 2, fetcher });

    expect(feed.items.map((item) => item.id)).toEqual(['201', '200']);
  });

  it('prefers rendered NodeSeek list rows over stale embedded shell topics', async () => {
    const staleEmbeddedPayload = Buffer.from(JSON.stringify({
      rotateTopics: [
        { postId: 201, titleText: 'stale page one', titleLink: '/post-201-1', op: { name: 'alice' }, time: { createdDate: '2026-05-20T02:00:00.000Z' } },
        { postId: 200, titleText: 'stale page one older', titleLink: '/post-200-1', op: { name: 'bob' }, time: { createdDate: '2026-05-20T01:00:00.000Z' } }
      ]
    })).toString('base64');
    const fetcher = vi.fn(async () => html(`
      <script>${staleEmbeddedPayload}</script>
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-199-1">Rendered page two newer</a></div>
          <div class="post-info">
            <a href="/space/1" class="info-author">carol</a>
            <time datetime="2026-05-19T02:00:00.000Z"></time>
          </div>
        </li>
        <li class="post-list-item">
          <div class="post-title"><a href="/post-198-1">Rendered page two older</a></div>
          <div class="post-info">
            <a href="/space/2" class="info-author">dave</a>
            <time datetime="2026-05-19T01:00:00.000Z"></time>
          </div>
        </li>
      </ul>
    `));

    const feed = await getFeed({ source: 'nodeseek', page: 2, limit: 2, fetcher });

    expect(feed.items.map((item) => item.id)).toEqual(['199', '198']);
  });

  it('reads rendered NodeSeek category links when embedded category data is absent', async () => {
    const fetcher = vi.fn(async () => html(`
      <nav>
        <a href="/categories/daily">日常</a>
        <a href="/categories/%E0%A4%A">坏分类</a>
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

  it('keeps rendered NodeSeek image and video stickers in replies', async () => {
    const fetcher = vi.fn(async () => html(`
      <main>
        <article class="post-detail">
          <h1 class="post-title">sticker topic</h1>
          <div class="post-info">
            <span class="info-author"><a href="/space/1">alice</a></span>
            <time datetime="2026-05-22T16:00:00.000Z"></time>
          </div>
          <div class="post-content"><p>正文</p></div>
        </article>
        <section class="comment-list">
          <div class="comment-item" id="comment-201">
            <a href="/space/2" class="comment-author">BettyFord</a>
            <time datetime="2026-05-22T16:01:00.000Z"></time>
            <div class="comment-content">
              <p><video autoplay="" loop="" muted="" playsinline="" class="sticker" width="100" height="100">
                <source src="/static/image/sticker/emoji/35.webm" type="video/webm">
                <source src="/static/image/sticker/emoji/35.mov" type="video/mp4">
              </video></p>
            </div>
          </div>
          <div class="comment-item" id="comment-202">
            <a href="/space/3" class="comment-author">7olove</a>
            <time datetime="2026-05-22T16:02:00.000Z"></time>
            <div class="comment-content"><p><img class="sticker" src="/static/image/sticker/ac/01.png" loading="lazy" alt="ac01"> 拉段了吗</p></div>
          </div>
        </section>
      </main>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '797740', fetcher });

    expect(topic.replies[0].contentHtml).toContain('<forum-video-sticker');
    expect(topic.replies[0].contentHtml).toContain('src="https://www.nodeseek.com/static/image/sticker/emoji/35.webm"');
    expect(topic.replies[0].contentHtml).toContain('data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/35.png"');
    expect(topic.replies[0].contentHtml).toContain('class="sticker"');
    expect(topic.replies[0].contentHtml).not.toContain('<video');
    expect(topic.replies[1].contentHtml).toContain('src="https://www.nodeseek.com/static/image/sticker/ac/01.png"');
    expect(topic.replies[1].contentHtml).toContain('class="sticker"');
  });

  it('reads rendered NodeSeek topic title from meta fallback', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head>
          <meta property="og:title" content="NodeSeek meta title" />
        </head>
        <body>
          <div id="0" class="content-item">
            <article class="post-content"><p>meta fallback 正文</p></article>
          </div>
        </body>
      </html>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743012', fetcher });

    expect(topic.title).toBe('NodeSeek meta title');
    expect(topic.contentHtml).toContain('meta fallback 正文');
  });

  it('reads rendered NodeSeek topic bodies from content containers inside topic rows', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head>
          <meta property="og:title" content="NodeSeek content container title" />
        </head>
        <body>
          <div id="0" class="content-item">
            <div class="content"><p>content 容器正文</p></div>
          </div>
        </body>
      </html>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743019', fetcher });

    expect(topic.title).toBe('NodeSeek content container title');
    expect(topic.contentHtml).toContain('content 容器正文');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not treat readable NodeSeek content containers as restricted because of page notices', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head>
          <meta property="og:title" content="NodeSeek content container title" />
        </head>
        <body>
          <div class="notice">登录后才能回复该主题。</div>
          <div id="0" class="content-item">
            <div class="content"><p>content 容器正文可正常阅读</p></div>
          </div>
        </body>
      </html>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743021', fetcher });

    expect(topic.title).toBe('NodeSeek content container title');
    expect(topic.contentHtml).toContain('content 容器正文可正常阅读');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('shows NodeSeek restricted topic notices instead of a parse failure', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head><title>NodeSeek</title></head>
        <body>
          <div id="nsk-body">
            <div id="nsk-body-left">
              <p>权限不足，需要等级 2 才能查看该主题。</p>
            </div>
          </div>
        </body>
      </html>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743013', fetcher });

    expect(topic.title).toBe('受限帖子');
    expect(topic.contentHtml).toContain('权限不足，需要等级 2 才能查看该主题。');
    expect(topic.accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('reads NodeSeek restricted notices wrapped in rendered topic containers', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head><title>NodeSeek</title></head>
        <body>
          <div class="content-item">
            <div class="notice">登录后才能查看该主题。</div>
          </div>
        </body>
      </html>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743018', fetcher });

    expect(topic.title).toBe('受限帖子');
    expect(topic.contentHtml).toContain('登录后才能查看该主题。');
    expect(topic.accessRequirement).toMatchObject({
      type: 'login',
      label: '需登录'
    });
  });

  it('reads NodeSeek restricted notices when an empty body placeholder is present', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head><title>NodeSeek</title></head>
        <body>
          <div class="post-detail">
            <div class="post-content"></div>
            <div class="notice">权限不足，需要等级 3 才能查看该主题。</div>
          </div>
        </body>
      </html>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743020', fetcher });

    expect(topic.title).toBe('受限帖子');
    expect(topic.contentHtml).toContain('权限不足，需要等级 3 才能查看该主题。');
    expect(topic.accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('does not parse non-topic NodeSeek shell pages as restricted topics', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head><title>NodeSeek maintenance</title></head>
        <body>
          <div id="nsk-body">
            <div id="nsk-body-left">
              <p>页面暂时无法显示，请稍后重试。</p>
            </div>
          </div>
        </body>
      </html>
    `));

    await expect(getTopic({ source: 'nodeseek', id: '743016', fetcher })).rejects.toThrow('NodeSeek 主题解析失败');
  });

  it('does not parse generic NodeSeek content containers as topic body', async () => {
    const fetcher = vi.fn(async () => html(`
      <html>
        <head><title>NodeSeek error</title></head>
        <body>
          <div class="content">临时错误页，不是主题正文。</div>
        </body>
      </html>
    `));

    await expect(getTopic({ source: 'nodeseek', id: '743017', fetcher })).rejects.toThrow('NodeSeek 主题解析失败');
  });

  it('does not mark normal NodeSeek body text as access restricted', async () => {
    const fetcher = vi.fn(async () => html(`
      <main>
        <article class="post-detail">
          <h1 class="post-title">NodeSeek normal permission discussion</h1>
          <div class="post-content"><p>这里讨论等级查看和登录提示文案，但帖子本身可以正常阅读。</p></div>
        </article>
      </main>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743014', fetcher });

    expect(topic.title).toBe('NodeSeek normal permission discussion');
    expect(topic.contentHtml).toContain('帖子本身可以正常阅读');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not mark normal NodeSeek topics as restricted because of page notices', async () => {
    const fetcher = vi.fn(async () => html(`
      <main>
        <div class="notice">请登录后回复该主题。</div>
        <article class="post-detail">
          <h1 class="post-title">NodeSeek topic with login notice</h1>
          <div class="post-content"><p>正文可以正常阅读。</p></div>
        </article>
      </main>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743015', fetcher });

    expect(topic.title).toBe('NodeSeek topic with login notice');
    expect(topic.contentHtml).toContain('正文可以正常阅读');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not treat rendered NodeSeek category links as topic authors', async () => {
    const fetcher = vi.fn(async () => html(`
      <main>
        <article class="post-detail">
          <h1 class="post-title">NodeSeek category author regression</h1>
          <div class="post-info">
            <a href="/categories/bug">Bugs</a>
            <time datetime="2026-05-25T03:34:00.000Z">2026-05-25 11:34</time>
          </div>
          <div class="post-content"><p>body</p></div>
        </article>
      </main>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743002', fetcher });

    expect(topic).toMatchObject({
      categoryId: 'bug',
      category: 'Bugs'
    });
    expect(topic.author).toBe('');
    expect(topic.authorId).toBeUndefined();
    expect(topic.authorUrl).toBeUndefined();
  });

  it('reads rendered NodeSeek content-item authors and replies', async () => {
    const fetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743001-1">【求助】Claude使用Google pay绑定国内visa信用卡订阅有风险吗？</a>
      <div id="0" data-comment-id="10232616" class="content-item">
        <div class="author-info"><a href="/space/48872"><img src="/avatar/48872.png" alt="我是ikun"></a><a href="/space/48872" class="author-name">我是ikun</a><span class="is-poster">楼主</span></div>
        <span class="date-created"><time datetime="2026-05-22T15:55:11.000Z">1h ago</time></span>
        <span class="content-category">in <a href="/categories/daily">日常</a></span>
        <a href="#0" class="floor-link">#0</a>
        <article class="post-content"><p>如题，希望有经验的朋友分享一下，感谢</p></article>
      </div>
      <li id="1" data-comment-id="10232667" class="content-item">
        <div class="author-info"><a href="/space/26953"><img src="/avatar/26953.png" alt="纳西妲"></a><a href="/space/26953" class="author-name">纳西妲</a></div>
        <span class="date-created"><time datetime="2026-05-22T15:59:06.000Z">1h ago</time></span>
        <a href="#1" class="floor-link">#1</a>
        <article class="post-content"><p>都用 Google Pay 了肯定没风险</p></article>
      </li>
    `));

    const topic = await getTopic({ source: 'nodeseek', id: '743001', fetcher });

    expect(topic).toMatchObject({
      title: '【求助】Claude使用Google pay绑定国内visa信用卡订阅有风险吗？',
      author: '我是ikun',
      authorAvatar: 'https://www.nodeseek.com/avatar/48872.png',
      commentId: 10232616,
      categoryId: 'daily',
      replyCount: 1
    });
    expect(topic.replies[0]).toMatchObject({
      author: '纳西妲',
      authorAvatar: 'https://www.nodeseek.com/avatar/26953.png',
      floor: 1,
      commentId: 10232667,
      contentHtml: expect.stringContaining('都用 Google Pay')
    });
  });

  it('refreshes NodeSeek replies from rendered topic HTML when embedded postData is absent', async () => {
    const fetcher = vi.fn(async () => html(`
      <a class="post-title" href="/post-743003-1">NodeSeek rendered replies</a>
      <div id="0" data-comment-id="10232700" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-05-22T15:55:11.000Z"></time>
        <article class="post-content"><p>正文</p></article>
      </div>
      <li id="1" data-comment-id="10232701" class="content-item">
        <div class="author-info"><a href="/space/2" class="author-name">bob</a></div>
        <time datetime="2026-05-22T15:59:06.000Z"></time>
        <article class="post-content"><p>旧回复</p></article>
      </li>
      <li id="2" data-comment-id="10232702" class="content-item">
        <div class="author-info"><a href="/space/3" class="author-name">carol</a></div>
        <time datetime="2026-05-22T16:01:06.000Z"></time>
        <article class="post-content"><p>新增回复</p></article>
      </li>
    `));

    const replies = await getNodeSeekReplies('743003', {
      fetcher,
      page: 1,
      offset: 0,
      limit: 30
    });

    expect(replies.items).toHaveLength(2);
    expect(replies.items.map((item) => item.author)).toEqual(['bob', 'carol']);
    expect(replies.items.map((item) => item.floor)).toEqual([1, 2]);
    expect(replies.items[1]).toMatchObject({
      commentId: 10232702,
      contentHtml: expect.stringContaining('新增回复')
    });
    expect(replies.hasMore).toBe(false);
    expect(replies.nextPage).toBeNull();
    expect(replies.nextOffset).toBeNull();
  });

  it('reads V2EX public JSON, HTML pages, topic detail, and SOV2EX search directly', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return html('<div class="cell item"><a href="/member/neo"><img class="avatar" src="//cdn.v2ex.com/a.png" alt="neo"></a><span class="item_title"><a class="topic-link" href="/t/121#reply3">V2EX latest</a></span><span class="topic_info"><a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp; <strong><a href="/member/neo">neo</a></strong> &nbsp;•&nbsp; <span title="2026-05-28 20:35:00 +08:00"></span></span><td width="70" align="right"><a href="/t/121#reply3" class="count_livid">3</a></td></div><a href="/recent">更多新主题</a>');
      }
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

  it('reads the V2EX all feed from the origin all tab instead of the latest API', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return html(`
          <div class="cell item">
            <a href="/member/alice"><img class="avatar" src="//cdn.v2ex.com/a.png" alt="alice"></a>
            <span class="item_title"><a class="topic-link" href="/t/801#reply2">V2EX all active topic</a></span>
            <span class="topic_info">
              <a class="node" href="/go/qna">问与答</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:30:00 +08:00">Just Now</span> &nbsp;•&nbsp;
              Lastly replied by <strong><a href="/member/bob">bob</a></strong>
            </span>
            <td width="70" align="right"><a href="/t/801#reply2" class="count_livid">2</a></td>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const feed = await getFeed({ source: 'v2ex', limit: 1, fetcher });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://www.v2ex.com/?tab=all']);
    expect(feed.items[0]).toMatchObject({
      id: '801',
      title: 'V2EX all active topic',
      author: 'alice',
      categoryId: 'qna',
      replyCount: 2,
      lastReplyAt: '2026-05-29T00:30:00.000Z'
    });
  });

  it('reads the V2EX latest feed from the origin recent page', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/recent?p=1') {
        return html(`
          <div class="cell">
            <span class="item_title"><a class="topic-link" href="/t/821#reply0">V2EX recent topic</a></span>
            <span class="topic_info">
              <a class="node" href="/go/qna">问与答</a> &nbsp;•&nbsp;
              <a href="/member/alice">alice</a> &nbsp;•&nbsp;
              <span title="2026-05-29 09:30:00">Just Now</span>
            </span>
          </div>
          <a href="/recent?p=2">下一页</a>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const feed = await getFeed({ source: 'v2ex', feedFilter: 'latest', limit: 1, fetcher });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://www.v2ex.com/recent?p=1']);
    expect(feed.items[0]).toMatchObject({
      id: '821',
      title: 'V2EX recent topic'
    });
    expect(feed.hasMore).toBe(true);
    expect(feed.nextPage).toBe(2);
  });

  it('reads the V2EX hot feed as a finite origin tab', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=hot') {
        return html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/822#reply8">V2EX hot topic</a></span>
            <span class="topic_info">
              <a class="node" href="/go/qna">问与答</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 10:30:00 +08:00">Just Now</span>
            </span>
            <td width="70" align="right"><a href="/t/822#reply8" class="count_livid">8</a></td>
          </div>
          <a href="/recent">更多新主题</a>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const feed = await getFeed({ source: 'v2ex', feedFilter: 'hot', limit: 1, fetcher });

    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(['https://www.v2ex.com/?tab=hot']);
    expect(feed.items[0]).toMatchObject({
      id: '822',
      title: 'V2EX hot topic',
      replyCount: 8
    });
    expect(feed.hasMore).toBe(false);
    expect(feed.nextPage).toBeNull();
  });

  it('ignores malformed V2EX node links without dropping the topic', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/813#reply0">V2EX malformed node</a></span>
            <span class="topic_info">
              <a class="node" href="/go/%E0%A4%A">坏节点</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:30:00 +08:00">Just Now</span>
            </span>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const feed = await getFeed({ source: 'v2ex', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '813',
      title: 'V2EX malformed node',
      category: '坏节点'
    });
    expect(feed.items[0].categoryId).toBeUndefined();
  });

  it('treats V2EX HTML times without a zone as China time', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/812#reply0">V2EX unzoned time</a></span>
            <span class="topic_info">
              <a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:30:00">Just Now</span>
            </span>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const feed = await getFeed({ source: 'v2ex', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '812',
      lastReplyAt: '2026-05-29T00:30:00.000Z'
    });
  });

  it('uses the V2EX topic reply badge instead of vote counts in HTML lists', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/go/create?p=1')) {
        return html(`
          <div class="cell item">
            <span class="item_title"><a class="topic-link" href="/t/802#reply357">V2EX voted topic</a></span>
            <span class="topic_info">
              <div class="votes"><a class="count_orange">1</a></div>
              <a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp;
              <strong><a href="/member/alice">alice</a></strong> &nbsp;•&nbsp;
              <span title="2026-05-29 08:20:00 +08:00">10 mins ago</span>
            </span>
            <td width="70" align="right"><a href="/t/802#reply357" class="count_livid">357</a></td>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const feed = await getFeed({ source: 'v2ex', category: 'create', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      id: '802',
      replyCount: 357
    });
  });

  it('does not let stale V2EX last_touched predate topic creation on Android', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([{
          id: 701,
          title: 'Fresh V2EX topic',
          url: 'https://www.v2ex.com/t/701',
          created: 1780000500,
          last_touched: 1780000000,
          replies: 0,
          node: { name: 'create', title: '分享创造' },
          member: { username: 'neo' }
        }]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '701', fetcher });

    expect(topic).toMatchObject({
      createdAt: '2026-05-28T20:35:00.000Z',
      lastReplyAt: '2026-05-28T20:35:00.000Z',
      replyCount: 0
    });
  });

  it('enriches V2EX topic details from the origin HTML without login-only actions', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([{
          id: 810,
          title: 'V2EX enriched detail',
          url: 'https://www.v2ex.com/t/810',
          created: 1780000000,
          last_touched: 1780000200,
          replies: 1,
          node: { name: 'create', title: '分享创造' },
          member: { username: 'neo' },
          content_rendered: '<p>detail body</p>'
        }]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          { id: 7001, member: { username: 'alice' }, content_rendered: '<p>first reply</p>', created: 1780000100 },
          { id: 7002, member: { username: 'neo' }, content_rendered: '@<a href="/member/alice">alice</a> answer', created: 1780000200 }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/810') {
        return html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ViewAction","userInteractionCount":743},
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":2}
            ]}
          </script>
          <div id="topic_810_votes" class="votes">
            <a href="javascript:" onclick="upVoteTopic(810);" class="vote">▲ 27</a>
            <a href="javascript:" onclick="downVoteTopic(810);" class="vote">▼</a>
          </div>
          <a href="/tag/开户" class="tag">开户</a>
          <a href="/tag/券商" class="tag"><span></span> 券商</a>
          <div class="subtle">
            <span class="fade">Supplement 1 &nbsp;·&nbsp; <span title="2026-05-28 10:24:10 +08:00">23h ago</span></span>
            <div class="topic_content"><p>补充正文 <img src="/supplement.svg" /></p></div>
          </div>
          <div id="r_7001" class="cell"><span class="no">1</span><span class="ago" title="2026-05-28 10:01:40 +08:00">1h ago</span><div class="reply_content">first reply</div></div>
          <div id="r_7002" class="cell"><span class="no">2</span><span class="ago" title="2026-05-28 10:03:20 +08:00">1h ago</span><span class="small fade"><img src="/static/img/heart_20250818.png" alt="heart"> 2</span><div class="reply_content">@<a href="/member/alice">alice</a> answer</div></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '810', fetcher });

    expect(topic.replyCount).toBe(2);
    expect(topic.viewCount).toBe(743);
    expect(topic.upvoteCount).toBe(27);
    expect(topic.tags).toEqual(['开户', '券商']);
    expect(topic.contentHtml).toContain('补充 1');
    expect(topic.contentHtml).toContain('补充正文');
    expect(topic.contentHtml).toContain('https://www.v2ex.com/supplement.svg');
    expect(topic.replies[0]).toMatchObject({ commentId: 7001, floor: 1 });
    expect(topic.replies[1]).toMatchObject({
      author: 'neo',
      commentId: 7002,
      floor: 2,
      replyTargetAuthor: 'alice',
      thanksCount: 2
    });
  });

  it('REG-TOPIC-016 keeps the V2EX thanks count when an icon attribute contains a quoted greater-than sign', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([{
          id: 815,
          title: 'V2EX quoted icon attribute',
          url: 'https://www.v2ex.com/t/815',
          created: 1780000000,
          replies: 1,
          member: { username: 'neo' }
        }]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      if (input === 'https://www.v2ex.com/t/815') {
        return html(`
          <div id="r_8015" class="cell">
            <span class="no">1</span>
            <span class="small fade"><img title="1 > 0" src="/static/img/heart.png"> 2</span>
            <div class="reply_content">reply</div>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '815', fetcher });

    expect(topic.replies[0]).toMatchObject({ commentId: 8015, thanksCount: 2 });
  });

  it('ignores malformed V2EX reply target links without dropping replies', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([{
          id: 814,
          title: 'V2EX malformed reply target',
          url: 'https://www.v2ex.com/t/814',
          created: 1780000000,
          replies: 1,
          member: { username: 'neo' }
        }]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      if (input === 'https://www.v2ex.com/t/814') {
        return html('<div id="r_8001" class="cell"><span class="no">1</span><div class="reply_content">@<a href="/member/%E0%A4%A">bad</a> reply</div></div>');
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '814', fetcher });

    expect(topic.replies[0]).toMatchObject({ commentId: 8001, floor: 1 });
    expect(topic.replies[0].replyTargetAuthor).toBeUndefined();
  });

  it('falls back to V2EX origin HTML replies when the public replies API times out', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([{
          id: 811,
          title: 'V2EX fallback detail',
          url: 'https://www.v2ex.com/t/811',
          created: 1780000000,
          replies: 2,
          node: { name: 'create', title: '分享创造' },
          member: { username: 'neo' },
          content_rendered: '<p>detail body</p>'
        }]);
      }
      if (input.includes('/api/replies/show.json')) {
        throw new Error('请求超时，请稍后重试');
      }
      if (input === 'https://www.v2ex.com/t/811') {
        return html(`
          <div id="r_7101" class="cell">
            <img class="avatar" src="//cdn.v2ex.com/a.png" />
            <span class="no">1</span>
            <strong><a href="/member/alice" class="dark">alice</a></strong>
            <span class="ago" title="2026-05-28 10:01:40 +08:00">1h ago</span>
            <div class="reply_content">first html reply</div>
          </div>
          <div id="r_7102" class="cell">
            <img class="avatar" src="//cdn.v2ex.com/b.png" />
            <span class="no">2</span>
            <strong><a href="/member/bob" class="dark">bob</a></strong>
            <span class="ago" title="2026-05-28 10:03:20 +08:00">1h ago</span>
            <span class="small">3 thanks</span>
            <div class="reply_content">@<a href="/member/alice">alice</a> second html reply</div>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '811', fetcher });

    expect(topic.replyCount).toBe(2);
    expect(topic.replies).toHaveLength(2);
    expect(topic.replies[0]).toMatchObject({
      author: 'alice',
      authorAvatar: 'https://cdn.v2ex.com/a.png',
      commentId: 7101,
      contentHtml: expect.stringContaining('first html reply'),
      floor: 1
    });
    expect(topic.replies[1]).toMatchObject({
      author: 'bob',
      commentId: 7102,
      floor: 2,
      replyTargetAuthor: 'alice',
      thanksCount: 3
    });
  });

  it('keeps V2EX all feed pagination open through the recent HTML list', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return html(`
          <div class="cell item"><a class="topic-link" href="/t/501#reply0">V2EX all first</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:05:00 +08:00"></span></div>
          <div class="cell item"><a class="topic-link" href="/t/500#reply0">V2EX all second</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:04:00 +08:00"></span></div>
          <div class="cell item"><a class="topic-link" href="/t/499#reply0">V2EX all third</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:03:00 +08:00"></span></div>
          <a href="/recent">更多新主题</a>
        `);
      }
      if (input.includes('/recent?p=1')) {
        return html(`
          <div class="cell"><a class="topic-link" href="/t/501#reply1">V2EX all first duplicate</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:05:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/500#reply1">V2EX all second duplicate</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:04:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/499#reply1">V2EX all third duplicate</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:03:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/498#reply1">V2EX recent first</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:02:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/497#reply1">V2EX recent second</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:01:00"></span></div>
          <div class="cell"><a class="topic-link" href="/t/496#reply1">V2EX recent third</a><a class="node" href="/go/create">分享创造</a><a href="/member/neo">neo</a><span title="2026-05-20 00:00:00"></span></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'v2ex', limit: 3, fetcher });
    const second = await getFeed({ source: 'v2ex', page: first.nextPage ?? 2, limit: 3, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['501', '500', '499']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['498', '497', '496']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not skip V2EX recent items after the all tab default page', async () => {
    const item = (id: number, title: string, time: string) => `
      <div class="cell item">
        <a class="topic-link" href="/t/${id}#reply0">${title}</a>
        <a class="node" href="/go/create">分享创造</a>
        <strong><a href="/member/neo">neo</a></strong>
        <span title="${time} +08:00"></span>
      </div>
    `;
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return html(`${Array.from({ length: 20 }, (_, index) => item(900 - index, `all ${index}`, `2026-05-20 00:${String(59 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent">更多新主题</a>`);
      }
      if (input === 'https://www.v2ex.com/recent?p=1') {
        return html(`${Array.from({ length: 20 }, (_, index) => item(850 - index, `recent p1 ${index}`, `2026-05-20 00:${String(39 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent?p=2">下一页</a>`);
      }
      if (input === 'https://www.v2ex.com/recent?p=2') {
        return html(`${Array.from({ length: 20 }, (_, index) => item(800 - index, `recent p2 ${index}`, `2026-05-19 23:${String(59 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent?p=3">下一页</a>`);
      }
      if (input === 'https://www.v2ex.com/recent?p=3') {
        return html(Array.from({ length: 20 }, (_, index) => item(700 - index, `recent p3 ${index}`, `2026-05-19 22:${String(59 - index).padStart(2, '0')}:00`)).join(''));
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'v2ex', limit: 30, fetcher });
    const second = await getFeed({ source: 'v2ex', page: first.nextPage ?? 2, cursor: first.nextCursor ?? undefined, limit: 30, fetcher });

    expect(first.items).toHaveLength(20);
    expect(second.items.map((topic) => topic.id).slice(0, 3)).toEqual(['850', '849', '848']);
    expect(fetcher.mock.calls.map((call) => call[0])).toContain('https://www.v2ex.com/recent?p=1');
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

  it('passes V2EX search pages through SOV2EX offsets', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      const from = url.searchParams.get('from');
      return json({
        hits: {
          total: { value: 2 },
          hits: [{
            _source: {
              id: from === '0' ? 934576 : 934577,
              title: from === '0' ? 'GPT first V2EX result' : 'GPT second V2EX result',
              member: 'neo',
              created: '2026-05-20T00:00:00',
              replies: 2
            }
          }]
        }
      });
    });

    const first = await searchTopics({ source: 'v2ex', query: 'gpt', limit: 1, fetcher });
    const second = await searchTopics({ source: 'v2ex', query: 'gpt', page: first.nextPage ?? 2, limit: 1, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['934576']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['934577']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('from=1');
    expect(calls).toContain('sort=sumup');
    expect(calls).toContain('version=1.0.1');
  });

  it('passes V2EX relevance and time sorting through real SOV2EX parameters', async () => {
    const fetcher = vi.fn(async () => json({ hits: [] }));

    await searchTopics({ source: 'v2ex', query: 'gpt', sort: 'relevance', fetcher });
    await searchTopics({ source: 'v2ex', query: 'gpt', sort: 'time', fetcher });

    expect(fetcher.mock.calls.length).toBe(2);
    const calls = fetcher.mock.calls as unknown as Array<[string, unknown?]>;
    const relevanceCall = calls[0];
    const timeCall = calls[1];
    expect(relevanceCall).toBeTruthy();
    expect(timeCall).toBeTruthy();
    const relevanceUrl = new URL(relevanceCall?.[0] || '');
    const timeUrl = new URL(timeCall?.[0] || '');
    expect(relevanceUrl.searchParams.get('sort')).toBe('sumup');
    expect(relevanceUrl.searchParams.get('order')).toBeNull();
    expect(timeUrl.searchParams.get('sort')).toBe('created');
    expect(timeUrl.searchParams.get('order')).toBe('0');
  });

  it('passes V2EX site filters through real SOV2EX parameters', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T10:00:00+08:00'));
    const fetcher = vi.fn(async () => json({ hits: [] }));
    try {
      await searchTopics({
        source: 'v2ex',
        query: 'gpt',
        filter: {
          source: 'v2ex',
          sort: 'time',
          node: 'qna',
          username: 'neo',
          operator: 'and',
          timeRange: 'week'
        },
        fetcher
      });
    } finally {
      vi.useRealTimers();
    }

    const url = new URL((fetcher.mock.calls as unknown as Array<[string]>)[0]?.[0] || '');
    expect(url.searchParams.get('sort')).toBe('created');
    expect(url.searchParams.get('order')).toBe('0');
    expect(url.searchParams.get('node')).toBe('qna');
    expect(url.searchParams.get('username')).toBe('neo');
    expect(url.searchParams.get('operator')).toBe('and');
    expect(url.searchParams.get('gte')).toBe(String(Math.floor(new Date('2026-06-04T02:00:00.000Z').getTime() / 1000)));
  });

  it('passes linux.do site filters through Discourse search syntax', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async (input: string) => (
      input.includes('/session/csrf.json') ? json({ csrf: 'csrf-token' }) : json({ topics: [], posts: [] })
    ));

    await searchTopics({
      source: 'linuxdo',
      query: 'AI',
      categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
      filter: {
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        scope: 'title',
        category: '4',
        tags: ['人工智能'],
        username: 'alice',
        timeRange: 'all',
        order: 'latest'
      },
      fetcher
    });

    const url = new URL((fetcher.mock.calls as unknown as Array<[string]>).find((call) => new URL(call[0]).pathname === '/search')?.[0] || '');
    expect(url.searchParams.get('q')).toBe('AI in:title category:4 tags:人工智能 @alice order:latest');
  });

  it('passes NodeSeek real post/comment sort parameters through site search', async () => {
    const fetcher = vi.fn(async () => html('<ul class="post-list"></ul>'));

    await searchTopics({
      source: 'nodeseek',
      query: 'GPT',
      filter: {
        source: 'nodeseek',
        category: 'tech',
        sort: 'postTime'
      },
      fetcher,
      nodeSeekCookie: 'session=login'
    });

    expect(fetcher.mock.calls.length).toBeGreaterThan(0);
    const calls = fetcher.mock.calls as unknown as Array<[string, unknown?]>;
    const url = new URL(calls[0]?.[0] || '');
    expect(url.searchParams.get('q')).toBe('GPT');
    expect(url.searchParams.get('category')).toBe('tech');
    expect(url.searchParams.get('sortBy')).toBe('postTime');
    expect(url.searchParams.has('sort')).toBe(false);
    expect(url.searchParams.has('order')).toBe(false);
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

  it('retries a linux.do JSON read once through the WebView fallback after Cloudflare', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const normalFetcher = vi.fn(async () => new Response('<html><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => json({
      id: 42,
      title: 'linux.do WebView fallback topic',
      created_at: '2026-05-21T00:00:00.000Z',
      posts_count: 1,
      post_stream: {
        stream: [1],
        posts: [
          { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-21T00:00:00.000Z' }
        ]
      }
    }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.title).toBe('linux.do WebView fallback topic');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(webViewCalls[0]?.[0]).toBe('https://linux.do/t/42.json');
    const events = lines
      .map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'linuxdo', reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', status: 403, reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', status: 200 }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', channel: 'webview' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/\/t\/42|https?:|cf-turnstile/);
  });

  it('REG-LINUXDO-001 preserves an ordinary linux.do 429 without opening the WebView fallback', async () => {
    const normalFetcher = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher: webViewFetcher as never
    });

    const response = await fetcher('https://linux.do/latest.json');

    expect(response.status).toBe(429);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('REG-LINUXDO-001 keeps a confirmed direct challenge typed when the hidden renderer cannot inspect it', async () => {
    const normalFetcher = vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => {
      throw new Error('linux.do 页面读取进程已停止');
    });
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const error = await fetcher('https://linux.do/latest.json').catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
  });

  it('REG-LINUXDO-001 keeps a confirmed direct challenge typed after an explicit renderer failure', async () => {
    const normalFetcher = vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => {
      throw new LinuxDoHiddenBrowserFailureError('renderer', 'renderer stopped');
    });
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const error = await fetcher('https://linux.do/latest.json').catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
  });

  it('REG-LINUXDO-001 preserves an explicit hidden-browser size failure', async () => {
    const normalFetcher = vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => {
      throw new LinuxDoHiddenBrowserFailureError('content-too-large', 'response exceeds bridge limit');
    });
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const error = await fetcher('https://linux.do/latest.json').catch((caught) => caught);

    expect(error).toBeInstanceOf(LinuxDoHiddenBrowserFailureError);
    expect(error).toMatchObject({ reason: 'content-too-large' });
    expect(isLinuxDoCloudflareError(error)).toBe(false);
  });

  it('REG-LINUXDO-001 preserves a final ordinary 429 returned by the hidden WebView', async () => {
    const normalFetcher = vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => new Response('rate limited', { status: 429 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://linux.do/latest.json');

    expect(response.status).toBe(429);
    expect(await response.text()).toBe('rate limited');
  });

  it('REG-LINUXDO-002 never replays a linux.do write through the hidden WebView', async () => {
    const normalFetcher = vi.fn(async () => new Response('challenge', {
      status: 429,
      headers: { 'cf-mitigated': 'challenge' }
    }));
    const webViewFetcher = vi.fn(async () => new Response('unexpected replay', { status: 200 }));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://linux.do/posts', {
      method: 'POST',
      body: JSON.stringify({ raw: 'reply' })
    });

    expect(response.status).toBe(429);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('does not read ordinary linux.do JSON twice before handing it to callers', async () => {
    const response = json({
      id: 42,
      title: 'ordinary linux.do topic',
      created_at: '2026-05-21T00:00:00.000Z',
      posts_count: 1,
      post_stream: {
        stream: [1],
        posts: [
          { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-21T00:00:00.000Z' }
        ]
      }
    });
    response.clone = vi.fn(() => {
      throw new Error('ordinary response should not be cloned');
    });
    const normalFetcher = vi.fn(async () => response);
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher: webViewFetcher as unknown as typeof normalFetcher
    });

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.title).toBe('ordinary linux.do topic');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
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

  it('loads selectable linux.do tags with category and current selections', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async () => json({
      results: [
        { id: '人工智能', name: '人工智能', count: 12 },
        { id: '快问快答', name: '快问快答', count: 3 }
      ]
    }));

    const tags = await searchLinuxDoTags({
      query: '人',
      categoryId: '4',
      selectedTags: ['快问快答'],
      limit: 20,
      fetcher
    });

    expect(tags).toEqual([
      { name: '人工智能', topicCount: 12 },
      { name: '快问快答', topicCount: 3 }
    ]);
    const url = new URL(String((fetcher.mock.calls as unknown as Array<[string]>)[0]?.[0]));
    expect(url.pathname).toBe('/tags/filter/search');
    expect(url.searchParams.get('q')).toBe('人');
    expect(url.searchParams.get('categoryId')).toBe('4');
    expect(url.searchParams.getAll('selected_tags[]')).toEqual(['快问快答']);
    expect(url.searchParams.get('limit')).toBe('8');
    expect(url.searchParams.has('filterForInput')).toBe(false);
    expect((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Cookie: 'cf_clearance=clearance; _t=login; _forum_session=session',
        'Discourse-Logged-In': 'true',
        'User-Agent': 'LinuxDo WebView UA'
      })
    }));
  });

  it('loads selectable linux.do authors without groups', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async () => json({
      users: [{ id: 7, username: 'alice', name: 'Alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' }],
      groups: [{ id: 2, name: 'staff' }]
    }));

    const users = await searchLinuxDoUsers({ term: 'ali', categoryId: '4', limit: 20, fetcher });

    expect(users).toEqual([{
      id: '7',
      username: 'alice',
      displayName: 'Alice',
      avatar: 'https://linux.do/user_avatar/linux.do/alice/96/1.png'
    }]);
    const url = new URL(String((fetcher.mock.calls as unknown as Array<[string]>)[0]?.[0]));
    expect(url.pathname).toBe('/u/search/users');
    expect(url.searchParams.get('term')).toBe('ali');
    expect(url.searchParams.get('include_groups')).toBe('false');
    expect(url.searchParams.get('category_id')).toBe('4');
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('loads linux.do semantic results with an AI marker', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async () => json({
      topics: [{
        id: 88,
        title: 'AI semantic result',
        slug: 'ai-semantic-result',
        created_at: '2026-07-17T00:00:00.000Z',
        bumped_at: '2026-07-17T00:00:00.000Z',
        posts_count: 2
      }],
      posts: [{ topic_id: 88, blurb: 'semantic match' }],
      users: []
    }));

    const result = await searchLinuxDoSemantic('AI tags:人工智能', { fetcher });

    expect(result.items).toEqual([expect.objectContaining({ id: '88', isAiGenerated: true })]);
    expect(result.hasMore).toBe(false);
    expect(result.nextPage).toBeNull();
    const url = new URL(String((fetcher.mock.calls as unknown as Array<[string]>)[0]?.[0]));
    expect(url.pathname).toBe('/discourse-ai/embeddings/semantic-search');
    expect(url.searchParams.get('q')).toBe('AI tags:人工智能');
  });

  it('keeps a zero-result linux.do semantic response distinct from an API failure', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async () => json({ topics: [], posts: [], users: [] }));

    const result = await searchLinuxDoSemantic('nothing', { fetcher });

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual({});
    expect(result.hasMore).toBe(false);
  });

  it.each([403, 404, 429])('preserves HTTP %s from the linux.do semantic endpoint', async (status) => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ errors: [`HTTP ${status}`] }), {
      status,
      headers: { 'content-type': 'application/json' }
    }));

    await expect(searchLinuxDoSemantic('AI', { fetcher })).rejects.toMatchObject({ status });
  });

  it('preserves a network failure from the linux.do semantic endpoint', async () => {
    mockStoredLinuxDoLoginAccess();
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(searchLinuxDoSemantic('AI', { fetcher })).rejects.toThrow('network down');
  });
});
