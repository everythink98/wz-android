import { describe, expect, it, vi } from 'vitest';
import { getCategories, getFeed, getReplies, getTopic, searchTopics } from './forumApi';

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
        return html(`<script>${nodeSeekTopicPayload}</script>`);
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
    expect(replies.items[0]).toMatchObject({ author: 'bob', floor: 1 });
    expect(search.items[0].id).toBe('101');
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(/\/api\/|10\.0\.2\.2|127\.0\.0\.1:3000/);
  });

  it('reads V2EX public JSON, HTML pages, topic detail, and SOV2EX search directly', async () => {
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
});
