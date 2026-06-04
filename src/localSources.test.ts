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
import { createLinuxDoWebViewFallbackFetcher } from './linuxdoFetchFallback';
import { createNodeSeekWebViewFallbackFetcher } from './nodeseekFetchFallback';
import { getNodeSeekReplies, getNodeSeekTopic } from './localNodeseek';
import { clearV2exCacheForTest } from './localV2ex';
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
            poster: { name: 'alice', uid: 9891, isOp: true, info: '楼主', avatar: '/avatar/9891.png', profile: '/space/9891' },
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
            poster: { name: 'bob', uid: 42, avatar: '/avatar/42.png', profile: '/space/42' },
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
    expect(topic.replies[0]).toMatchObject({
      author: 'bob',
      authorId: '42',
      authorUrl: 'https://www.nodeseek.com/space/42',
      floor: 15,
      hot: true,
      pinned: true,
      upvoteCount: 0,
      likeCount: 2,
      dislikeCount: 1,
      disliked: true
    });
    expect(topic.replies[0]).toHaveProperty('signatureHtml', expect.stringContaining('<strong>内容</strong>'));
    expect(topic.replies[1]).toMatchObject({
      author: 'alice',
      authorId: '9891',
      floor: 1,
      isOp: true
    });
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
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/vote/info/2443')) {
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
    expect(topic.contentHtml.trim()).toBe('');
  });

  it('keeps NodeSeek detail metadata from rendered HTML fallback', async () => {
    const fetcher = vi.fn(async () => html(`
      <h1>Rendered NodeSeek detail</h1>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/9891" class="author-name">alice</a><span class="is-poster">楼主</span></div>
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
          <div class="author-info"><a href="/space/42" class="author-name">bob</a></div>
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
      upvoteCount: 1,
      likeCount: 0,
      dislikeCount: 0,
      collectionCount: 4
    });
    expect(topic.replies[0]).toMatchObject({
      author: 'bob',
      authorId: '42',
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
          cooked: '<p>投票正文</p>',
          created_at: '2026-06-03T00:00:00.000Z',
          post_number: 1,
          polls: [{
            id: 88,
            name: 'poll',
            title: '选择方向',
            type: 'multiple',
            status: 'open',
            public: true,
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
      min: 2,
      max: 3,
      voted: true,
      options: [
        { id: 'a1', label: '方案 A', count: 0, selected: false },
        { id: 'b2', label: '方案 B', count: 4, selected: true },
        { id: 'c3', label: '方案 C', selected: false }
      ]
    }]);
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
            cooked: '<p>回复投票</p>',
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
      boostCount: 1
    });
    expect(topic.replies[0]).toMatchObject({
      acceptedAnswer: true,
      wiki: true,
      hidden: true,
      folded: true,
      needsApproval: true,
      systemAction: true,
      actionCode: 'closed.enabled',
      reactionSummary: [{ id: 'distorted_face', count: 3 }],
      boostCount: 2
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

    expect(topic.boostCount).toBe(4);
    expect(topic.replies[0].boostCount).toBe(5);
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
    expect(fetcher.mock.calls[0][0]).toContain('order=created');
    expect(fetcher.mock.calls[0][0]).toContain('ascending=false');
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
        id: 4,
        name: '开发调优',
        slug: 'dev',
        description_text: '只用于原站说明',
        parent_category_id: 2,
        topic_count: 88
      }]
    }));

    const categories = await getCategories({ source: 'linuxdo', fetcher, nocache: true });

    expect(categories.items).toHaveLength(1);
    expect(categories.items[0]).toEqual({
      source: 'linuxdo',
      id: '4',
      name: '开发调优',
      slug: 'dev'
    });
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

  it('keeps linux.do quote author names from quote markup', async () => {
    const fetcher = vi.fn(async () => json({
      id: 910,
      title: 'linux.do quoted author',
      created_at: '2026-05-20T00:00:00.000Z',
      post_stream: {
        stream: [1, 2],
        posts: [
          { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
          {
            id: 2,
            post_number: 2,
            username: 'bob',
            cooked: '<aside data-post="1" class="quote" data-topic="910" data-username="alice"><blockquote><p>Original text</p></blockquote></aside><p>Reply</p>',
            created_at: '2026-05-20T00:02:00.000Z'
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '910', fetcher });

    expect(topic.replies[0].quotedFloors).toEqual([1]);
    expect(topic.replies[0].quotedAuthors).toEqual({ 1: 'alice' });
  });

  it('removes native linux.do quote markup after extracting same-topic quoted floors', async () => {
    const fetcher = vi.fn(async () => json({
      id: 912,
      title: 'linux.do quoted markup',
      created_at: '2026-05-20T00:00:00.000Z',
      post_stream: {
        stream: [1, 2],
        posts: [
          { id: 1, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: '2026-05-20T00:00:00.000Z' },
          {
            id: 2,
            post_number: 2,
            username: 'bob',
            cooked: '<aside data-post="1" class="quote" data-topic="912" data-username="alice"><blockquote><p>Original text</p></blockquote></aside><p>Reply</p>',
            created_at: '2026-05-20T00:02:00.000Z'
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '912', fetcher });

    expect(topic.replies[0].quotedFloors).toEqual([1]);
    expect(topic.replies[0].quotedAuthors).toEqual({ 1: 'alice' });
    expect(topic.replies[0].contentHtml).toBe('<p>Reply</p>');
  });

  it('keeps linux.do quote author names from quote avatar URLs', async () => {
    const fetcher = vi.fn(async () => json({
      id: 911,
      title: 'linux.do quoted author avatar',
      created_at: '2026-05-20T00:00:00.000Z',
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
    const fetcher = vi.fn(async () => json({
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
            actions_summary: [{ id: 2, acted: true }]
          },
          {
            id: 1002,
            post_number: 2,
            username: 'bob',
            cooked: '<p>reply</p>',
            created_at: '2026-05-20T00:01:00.000Z',
            like_count: 1,
            actions_summary: [{ id: 2, acted: false }]
          }
        ]
      }
    }));

    const topic = await getTopic({ source: 'linuxdo', id: '900', fetcher });

    expect(topic).toMatchObject({
      commentId: 1001,
      liked: true,
      likeCount: 3,
      bookmarked: true,
      bookmarkId: 700
    });
    expect(topic.replies[0]).toMatchObject({
      commentId: 1002,
      liked: false,
      likeCount: 1
    });
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

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['606']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?q=GPT');
    expect(calls).not.toContain('keyword=GPT');
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

    const search = await searchTopics({ source: 'nodeseek', query: 'xyz', fetcher });

    expect(search.items).toEqual([]);
    const callUrls = fetcher.mock.calls.map((call) => call[0]);
    expect(callUrls).toContain('https://www.nodeseek.com/search?q=xyz');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
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

    await expect(searchTopics({ source: 'nodeseek', query: 'failure', fetcher })).rejects.toThrow('NodeSeek search failed');
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

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher });

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

    const first = await searchTopics({ source: 'nodeseek', query: 'GPT', limit: 1, fetcher });
    const second = await searchTopics({ source: 'nodeseek', query: 'GPT', page: first.nextPage ?? 2, limit: 1, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['202']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['203']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.nodeseek.com/search?q=GPT&page=2');
  });

  it('falls back to latest linux.do topics when anonymous search returns an empty 200 response', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/search.json')) {
        return json({ topics: [], posts: [] });
      }
      if (input.includes('linux.do/latest.json')) {
        return json({
          topic_list: {
            topics: [{
              id: 404,
              title: 'linux fallback keyword',
              slug: 'linux-fallback-keyword',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }]
          },
          users: []
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({ source: 'linuxdo', query: 'fallback keyword', fetcher });

    expect(search.items.map((item) => item.id)).toEqual(['404']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://linux.do/search.json');
    expect(calls).toContain('https://linux.do/latest.json');
  });

  it('passes linux.do search pages through and exposes more results', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      const page = url.searchParams.get('page') || '1';
      expect(url.searchParams.get('type_filter')).toBe('topic');
      return json({
        grouped_search_result: { more_full_page_results: page === '1' },
        topics: [{
          id: page === '1' ? 501 : 502,
          title: `linux page ${page} keyword`,
          slug: `linux-page-${page}`,
          created_at: '2026-05-21T00:00:00.000Z',
          bumped_at: '2026-05-21T00:00:00.000Z',
          posts_count: 1
        }],
        users: []
      });
    });

    const first = await searchTopics({ source: 'linuxdo', query: 'keyword', limit: 1, fetcher });
    const second = await searchTopics({ source: 'linuxdo', query: 'keyword', page: first.nextPage ?? 2, limit: 1, fetcher });

    expect(first.items.map((item) => item.id)).toEqual(['501']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['502']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('page=2');
  });

  it('uses Discourse latest-topic search ordering for linux.do searches', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      expect(url.pathname).toBe('/search.json');
      expect(url.searchParams.get('q')).toBe('keyword order:latest_topic');
      expect(url.searchParams.get('type_filter')).toBe('topic');
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
  });

  it('maps linux.do search result category ids through site categories', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/search.json')) {
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

  it('orders linux.do search results by creation time newest first', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/search.json')) {
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

    expect(search.items.map((item) => item.id)).toEqual(['802', '801']);
  });

  it('sends saved linux.do login cookies when searching', async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(JSON.stringify({
      cookieHeader: 'cf_clearance=clearance; _t=login; _forum_session=session',
      savedAt: '2026-05-26T00:00:00.000Z',
      source: 'webview',
      userAgent: 'LinuxDo WebView UA'
    }));
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/search.json')) {
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
    const [input, init] = fetcher.mock.calls[0];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/search.json');
    expect(url.searchParams.get('q')).toBe('keyword order:latest_topic');
    expect(url.searchParams.get('type_filter')).toBe('topic');
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        Cookie: 'cf_clearance=clearance; _t=login; _forum_session=session',
        'User-Agent': 'LinuxDo WebView UA'
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

  it('retries NodeSeek through the WebView fallback only after Cloudflare', async () => {
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
    clearV2exCacheForTest();
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
    clearV2exCacheForTest();
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

  it('uses the V2EX topic reply badge instead of vote counts in HTML lists', async () => {
    clearV2exCacheForTest();
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
    clearV2exCacheForTest();
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
    clearV2exCacheForTest();
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

  it('falls back to V2EX origin HTML replies when the public replies API times out', async () => {
    clearV2exCacheForTest();
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
    clearV2exCacheForTest();
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

  it('does not add unsupported sort parameters to NodeSeek searches', async () => {
    const fetcher = vi.fn(async () => html('<ul class="post-list"></ul>'));

    await searchTopics({ source: 'nodeseek', query: 'GPT', sort: 'time', fetcher });

    expect(fetcher.mock.calls.length).toBeGreaterThan(0);
    const calls = fetcher.mock.calls as unknown as Array<[string, unknown?]>;
    const url = new URL(calls[0]?.[0] || '');
    expect(url.searchParams.get('q')).toBe('GPT');
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
