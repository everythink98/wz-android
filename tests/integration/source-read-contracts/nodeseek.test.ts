import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCategories, getFeed } from '@/sources/feedRead';
import { searchTopics } from '@/sources/searchRead';
import { getReplies, getTopic } from '@/sources/sourceRead';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import { textContentFromHtml } from '@/domain/forum/html';
import { requirePreparedForumContent } from '@/domain/forum/topicContentSplit';
import {
  getNodeSeekCurrentUserProfile,
  getNodeSeekReplies,
  getNodeSeekTopic,
  getNodeSeekUserProfile,
  resolveNodeSeekUser
} from '@/sources/nodeseek/reader';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({ NativeModules: {} }));

import { html, htmlAt, json, routeFetcher } from './fixtures';

const nodeSeekPayload = Buffer.from(
  JSON.stringify({
    rotateTopics: [
      {
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
      }
    ],
    allCategory: [
      { key: 'tech', cn_text: '技术' },
      { key: 'admin', cn_text: '管理', adminOnly: true }
    ]
  })
).toString('base64');

const nodeSeekTopicPayload = Buffer.from(
  JSON.stringify({
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
  })
).toString('base64');

const nodeSeekReplyPagePayload = Buffer.from(
  JSON.stringify({
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
  })
).toString('base64');

function nodeSeekStaleCountPage(page: 1 | 2) {
  const floors = page === 1 ? Array.from({ length: 10 }, (_, index) => index + 1) : [11, 12, 13, 14];
  const comments = [
    ...(page === 1
      ? [
          {
            commentId: 11739860,
            floorIndex: 0,
            poster: { name: 'op' },
            markdown: 'opening post',
            time: { createdDate: '2026-08-06T13:49:00.000Z' }
          }
        ]
      : []),
    ...floors.map((floor) => ({
      commentId: 11739860 + floor,
      floorIndex: floor,
      poster: { name: `user-${floor}` },
      markdown: `reply ${floor}`,
      time: { createdDate: `2026-08-06T14:${String(floor).padStart(2, '0')}:00.000Z` }
    }))
  ];
  const payload = Buffer.from(
    JSON.stringify({
      postData: {
        postId: 861053,
        postPage: page,
        postPageCount: 2,
        title: 'NodeSeek topic',
        op: { name: 'op' },
        comments
      }
    })
  ).toString('base64');
  return htmlAt(
    `
      <script>${payload}</script>
      <a class="post-title" href="/post-861053-${page}">NodeSeek topic</a>
      <div class="nsk-pager" role="navigation" aria-label="pagination">
        ${page === 1 ? '<a href="/post-861053-2" rel="next">2</a>' : '<a href="/post-861053-1" rel="prev">1</a>'}
      </div>
    `,
    `https://www.nodeseek.com/post-861053-${page}`
  );
}

describe('Android local sources', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('reads NodeSeek feed, categories, topic, replies, and search without project server endpoints', async () => {
    const fetcher = routeFetcher([
      ['/post-101-2', (input) => htmlAt(`<script>${nodeSeekReplyPagePayload}</script>`, input)],
      ['/post-101-1', html(`<script>${nodeSeekTopicPayload}</script>`)],
      [/.*/, html(`<script>${nodeSeekPayload}</script>`)]
    ]);

    const feed = await getFeed({ source: 'nodeseek', fetcher });
    const categories = await getCategories({ source: 'nodeseek', fetcher });
    const topic = await getTopic({ source: 'nodeseek', id: '101', fetcher });
    const replies = await getReplies({
      source: 'nodeseek',
      id: '101',
      order: 'oldest',
      position: { kind: 'cursor', page: 2, offset: 0 },
      fetcher
    });
    const search = await searchTopics({ source: 'nodeseek', query: 'NodeSeek', fetcher, nodeSeekAuthenticated: true });

    expect(feed.items[0]).toMatchObject({ source: 'nodeseek', id: '101', categoryId: 'tech' });
    expect(categories.items).toEqual([{ source: 'nodeseek', id: 'tech', name: '技术' }]);
    expect(topic.contentHtml).toContain('<strong>内容</strong>');
    expect(topic.lastReplyAt).toBe('2026-05-20T00:01:00.000Z');
    expect(replies.items[0]).toMatchObject({ author: 'bob', floor: 1 });
    expect(search.items[0].id).toBe('101');
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(/\/api\/|10\.0\.2\.2|127\.0\.0\.1:3000/);
  });

  it('reads a distant NodeSeek floor from one exact page window', async () => {
    const payload = (floor: number) =>
      Buffer.from(
        JSON.stringify({
          postData: {
            postId: 999,
            title: 'Anchored topic',
            comments: [
              {
                commentId: floor,
                floorIndex: floor,
                poster: { name: floor === 155 ? 'target' : 'next' },
                markdown: `reply ${floor}`,
                time: { createdDate: '2026-08-05T00:00:00.000Z' }
              }
            ]
          }
        })
      ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-999-(\d+)/)?.[1]);
      expect([16, 17]).toContain(page);
      return htmlAt(
        `<script>${payload(page === 16 ? 155 : 165)}</script>
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          <a href="/post-999-${page + 1}" rel="next">下一页</a>
        </div>`,
        input
      );
    });

    const replies = await getReplies({
      source: 'nodeseek',
      id: '999',
      order: 'oldest',
      position: { kind: 'target', target: { floor: 155, pageHint: 16 } },
      limit: 10,
      fillPages: true,
      fetcher
    });
    const repliesWithoutHint = await getReplies({
      source: 'nodeseek',
      id: '999',
      order: 'oldest',
      position: { kind: 'target', target: { floor: 155 } },
      limit: 10,
      fillPages: true,
      fetcher
    });
    const next = await getReplies({
      source: 'nodeseek',
      id: '999',
      order: 'oldest',
      position: { kind: 'cursor', page: replies.nextPage!, offset: replies.nextOffset ?? null },
      limit: 30,
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(replies).toMatchObject({
      currentPage: 16,
      currentOffset: 150,
      previousPage: 15,
      previousOffset: 140,
      nextPage: 17,
      nextOffset: 160
    });
    expect(replies.items).toContainEqual(expect.objectContaining({ floor: 155, commentId: 155 }));
    expect(repliesWithoutHint).toMatchObject({ currentPage: 16, currentOffset: 150 });
    expect(next).toMatchObject({ currentPage: 17, currentOffset: 160, nextPage: 18, nextOffset: 170 });
  });

  it('keeps commentId authoritative when the NodeSeek floor is missing or wrong', async () => {
    const requestedPages: number[] = [];
    const payload = (page: number) =>
      Buffer.from(
        JSON.stringify({
          postData: {
            postId: 999,
            postPage: page,
            postPageCount: 3,
            title: 'Comment identity topic',
            replyCount: 30,
            comments:
              page === 1
                ? [
                    {
                      commentId: 1,
                      floorIndex: 0,
                      poster: { name: 'author' },
                      markdown: 'opening',
                      time: { createdDate: '2026-08-05T00:00:00.000Z' }
                    },
                    {
                      commentId: 11,
                      floorIndex: 5,
                      poster: { name: 'decoy-1' },
                      markdown: 'decoy 1',
                      time: { createdDate: '2026-08-05T00:01:00.000Z' }
                    }
                  ]
                : [
                    {
                      commentId: page === 3 ? 31 : 21,
                      floorIndex: page === 3 ? 25 : 15,
                      poster: { name: page === 3 ? 'target' : 'decoy-2' },
                      markdown: page === 3 ? 'target reply' : 'decoy 2',
                      time: { createdDate: '2026-08-05T00:02:00.000Z' }
                    }
                  ]
          }
        })
      ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-999-(\d+)/)?.[1]) || 1;
      requestedPages.push(page);
      const response = html(
        `<script>${payload(page)}</script>${page < 3 ? `<a href="/post-999-${page + 1}">下一页</a>` : ''}`
      );
      Object.defineProperty(response, 'url', { value: `https://www.nodeseek.com/post-999-${page}` });
      return response;
    });
    const load = (targetReply: { commentId: number; floor?: number }) =>
      getReplies({
        source: 'nodeseek',
        id: '999',
        order: 'oldest',
        position: { kind: 'target', target: targetReply },
        replyCount: 30,
        limit: 30,
        fetcher
      });

    const withoutFloor = await load({ commentId: 31 });
    expect(withoutFloor).toMatchObject({ currentPage: 3, items: [expect.objectContaining({ commentId: 31 })] });
    expect(requestedPages).toEqual([1, 2, 3]);

    requestedPages.length = 0;
    const wrongFloor = await load({ commentId: 31, floor: 15 });
    expect(wrongFloor).toMatchObject({ currentPage: 3, items: [expect.objectContaining({ commentId: 31 })] });
    expect(requestedPages).toEqual([2, 1, 3]);
  });

  it('converts NodeSeek Bilibili image syntax into embeddable player HTML', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 102,
          title: 'NodeSeek video topic',
          op: { name: 'alice' },
          comments: [
            {
              commentId: 1,
              poster: { name: 'alice' },
              markdown: '![image](https://www.bilibili.com/video/BV1GUdgBdESz/?p=2)',
              time: { createdDate: '2026-05-20T00:00:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('102', { fetcher });

    expect(topic.contentHtml).toContain('<iframe');
    expect(topic.contentHtml).toContain('https://player.bilibili.com/player.html?bvid=BV1GUdgBdESz&p=2');
    expect(topic.contentHtml).not.toContain('<img');
  });

  it('does not infer a NodeSeek next page when the list exactly reaches the limit', async () => {
    const exactPagePayload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 201,
            titleText: 'NodeSeek one',
            titleLink: '/post-201-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:01:00.000Z' }
          },
          {
            postId: 200,
            titleText: 'NodeSeek two',
            titleLink: '/post-200-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${exactPagePayload}</script>`));

    const feed = await getFeed({ source: 'nodeseek', limit: 2, fetcher });

    expect(feed.items).toHaveLength(2);
    expect(feed.hasMore).toBe(false);
    expect(feed.nextPage).toBeNull();
  });

  it('shows NodeSeek embedded list comments as replies excluding the original post', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 202,
            titleText: 'NodeSeek no replies',
            titleLink: '/post-202-1',
            op: { name: 'alice' },
            comments: 1
          },
          { postId: 203, titleText: 'NodeSeek replies', titleLink: '/post-203-1', op: { name: 'bob' }, comments: 4 }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const feed = await getFeed({ source: 'nodeseek', fetcher });

    expect(feed.items.map((item) => item.replyCount)).toEqual([0, 3]);
  });

  it('keeps NodeSeek detail reply metadata from embedded comments', async () => {
    const payload = Buffer.from(
      JSON.stringify({
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
              poster: {
                name: 'alice',
                uid: 9891,
                isOp: true,
                info: '楼主',
                avatar: '/avatar/9891.png',
                profile: '/space/9891',
                roles: [{ name: 'admin', display_text: '管理' }]
              },
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
              poster: {
                name: 'bob',
                uid: 42,
                isMe: true,
                avatar: '/avatar/42.png',
                profile: '/space/42',
                roles: [{ name: 'active', display_text: '活跃' }]
              },
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
              poster: {
                name: 'alice',
                uid: 9891,
                isOp: true,
                info: '楼主',
                avatar: '/avatar/9891.png',
                profile: '/space/9891'
              },
              markdown: '楼主回复',
              time: { createdDate: '2026-05-20T00:01:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
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
    expect(topic).not.toHaveProperty('currentUser');
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
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 207,
          postPage: 1,
          postPageCount: 2,
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
      })
    ).toString('base64');
    const pageTwoPayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 207,
          postPage: 2,
          postPageCount: 2,
          title: 'NodeSeek embedded reply count',
          replyCount: 12,
          comments: [11, 12].map((floor) => ({
            commentId: floor + 1,
            floorIndex: floor,
            poster: { name: `user-${floor}` },
            markdown: `回复 ${floor}`
          }))
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-207-(\d+)/)?.[1] || 1);
      const response = html(`<script>${page === 2 ? pageTwoPayload : payload}</script>`);
      Object.defineProperty(response, 'url', { value: `https://www.nodeseek.com/post-207-${page}` });
      return response;
    });

    const topic = await getNodeSeekTopic('207', { fetcher });
    const remaining = await getNodeSeekReplies('207', {
      fetcher,
      order: 'oldest',
      position: {
        kind: 'cursor',
        page: topic.replyNextPage ?? 2,
        offset: topic.replyNextOffset ?? null
      },
      replyCount: topic.replyCount,
      limit: 30
    });

    expect(topic.replies).toHaveLength(10);
    expect(topic.replyCount).toBe(12);
    expect(topic).toMatchObject({ replyHasMore: true, replyNextPage: 2, replyNextOffset: 10 });
    expect(remaining.items.map(({ floor }) => floor)).toEqual([11, 12]);
    expect(remaining.hasMore).toBe(false);
  });

  it('keeps the authoritative NodeSeek count when rendered rows are also present', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 209,
          postPage: 1,
          postPageCount: 5,
          title: 'NodeSeek mixed reply count',
          op: { name: 'alice' },
          replyCount: 45,
          comments: [
            { commentId: 1, floorIndex: 0, poster: { name: 'alice' }, markdown: '正文' },
            ...Array.from({ length: 10 }, (_, index) => ({
              commentId: index + 2,
              floorIndex: index + 1,
              poster: { name: `user-${index + 1}` },
              markdown: `回复 ${index + 1}`
            }))
          ]
        }
      })
    ).toString('base64');
    const requestedPages: number[] = [];
    const rows = (floors: number[]) =>
      floors
        .map(
          (floor) => `
            <li id="${floor}" data-comment-id="${1000 + floor}" class="content-item">
              <a class="floor-link">#${floor}</a>
              <a href="/space/${floor}" class="author-name">user-${floor}</a>
              <article class="post-content"><p>reply ${floor}</p></article>
            </li>
          `
        )
        .join('');
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-209-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      if (page === 5) {
        return html(
          `<a class="post-title" href="/post-209-5">NodeSeek mixed reply count</a>${rows([41, 42, 43, 44, 45])}`
        );
      }
      return html(`
        <script>${payload}</script>
        <a class="post-title" href="/post-209-1">NodeSeek mixed reply count</a>
        <div id="0" data-comment-id="1" class="content-item">
          <a href="/space/1" class="author-name">alice</a>
          <article class="post-content"><p>正文</p></article>
        </div>
        ${rows(Array.from({ length: 10 }, (_, index) => index + 1))}
        <a href="/post-209-2">2</a>
      `);
    });

    const topic = await getNodeSeekTopic('209', { fetcher });
    const tail = await getNodeSeekReplies('209', {
      fetcher,
      order: 'newest',
      position: { kind: 'start' },
      replyCount: topic.replyCount,
      limit: 10
    });

    expect(topic.replyCount).toBe(45);
    expect(requestedPages).toEqual([1, 1, 5]);
    expect(tail.items.map(({ floor }) => floor)).toEqual([45, 44, 43, 42, 41]);
  });

  it('derives adjacent cursors from complete compact NodeSeek windows without a pager', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-210-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      const floors =
        page === 1
          ? Array.from({ length: 10 }, (_, index) => index + 1)
          : page === 2
            ? Array.from({ length: 10 }, (_, index) => index + 11)
            : [21, 22, 23, 24, 25];
      const comments = floors.map((floor) => ({
        commentId: 1000 + floor,
        floorIndex: floor,
        poster: { name: `user-${floor}` },
        markdown: `回复 ${floor}`
      }));
      const payload = Buffer.from(
        JSON.stringify({
          postData: {
            postId: 210,
            postPage: page,
            postPageCount: 3,
            title: 'NodeSeek compact windows',
            replyCount: 25,
            comments:
              page === 1
                ? [{ commentId: 1, floorIndex: 0, poster: { name: 'alice' }, markdown: '正文' }, ...comments]
                : comments
          }
        })
      ).toString('base64');
      const response = html(`<script>${payload}</script>`);
      Object.defineProperty(response, 'url', { value: `https://www.nodeseek.com/post-210-${page}` });
      return response;
    });

    const topic = await getNodeSeekTopic('210', { fetcher });
    const second = await getNodeSeekReplies('210', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: topic.replyNextPage!, offset: topic.replyNextOffset ?? null },
      replyCount: topic.replyCount,
      limit: 30
    });
    const third = await getNodeSeekReplies('210', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: second.nextPage!, offset: second.nextOffset ?? null },
      replyCount: topic.replyCount,
      limit: 30
    });

    expect(requestedPages).toEqual([1, 2, 3]);
    expect(topic).toMatchObject({ replyHasMore: true, replyNextPage: 2, replyNextOffset: 10 });
    expect(second.items.map(({ floor }) => floor)).toEqual(Array.from({ length: 10 }, (_, index) => index + 11));
    expect(second).toMatchObject({ hasMore: true, nextPage: 3, nextOffset: 20 });
    expect(third.items.map(({ floor }) => floor)).toEqual([21, 22, 23, 24, 25]);
    expect(third.hasMore).toBe(false);
  });

  it('does not use NodeSeek rendered pager page numbers as replyCount', async () => {
    const replies = Array.from(
      { length: 10 },
      (_, index) => `
      <li id="${index + 1}" data-comment-id="${index + 2}" class="content-item">
        <div class="author-info"><a href="/space/${index + 2}" class="author-name">user-${index + 1}</a></div>
        <time datetime="2026-05-20T00:01:00.000Z"></time>
        <article class="post-content"><p>回复 ${index + 1}</p></article>
      </li>
    `
    ).join('');
    const fetcher = vi.fn(async () =>
      html(`
      <h1>NodeSeek rendered reply count</h1>
      <div class="nsk-pager post-top-pager">12</div>
      <div id="0" data-comment-id="1" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-05-20T00:00:00.000Z"></time>
        <article class="post-content"><p>正文</p></article>
      </div>
      <ul>${replies}</ul>
    `)
    );

    const topic = await getNodeSeekTopic('208', { fetcher });

    expect(topic.replies).toHaveLength(10);
    expect(topic).not.toHaveProperty('replyCount');
  });

  it('uses rendered NodeSeek html for display and markdown only for editing', async () => {
    const payload = Buffer.from(
      JSON.stringify({
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
      })
    ).toString('base64');
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
    const payload = Buffer.from(
      JSON.stringify({
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
              markdown:
                '![xhj032](https://www.nodeseek.com/static/image/smiley/xhj032.png)\n\n[@电动面包](https://www.nodeseek.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85) [#4](https://www.nodeseek.com/post-793572-1#4) 后续正文',
              time: { createdDate: '2026-05-20T00:02:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const topic = await getNodeSeekTopic('206', { fetcher });

    expect(topic.contentHtml).toContain('<a href="https://www.nodeseek.com/post-1">正文链接</a>');
    expect(topic.contentHtml).not.toContain('&lt;p');
    expect(topic.replies[0].contentHtml).toContain('<a href="https://www.nodeseek.com/post-2">回复链接</a>');
    expect(topic.replies[0].contentHtml).not.toContain('&lt;p');
    expect(topic.replies[0]).not.toHaveProperty('contentMarkdown');
    expect(topic.replies[1].contentHtml).toContain('src="https://www.nodeseek.com/static/image/smiley/xhj032.png"');
    expect(topic.replies[1].contentHtml).toContain(
      '<a href="https://www.nodeseek.com/member?t=%E7%94%B5%E5%8A%A8%E9%9D%A2%E5%8C%85">@电动面包</a>'
    );
    expect(topic.replies[1].contentHtml).toContain('<a href="https://www.nodeseek.com/post-793572-1#4">#4</a>');
    expect(topic.replies[1].contentHtml).not.toContain('plain rendered fallback');
  });

  it('loads NodeSeek vote info from nsapp vote links in topic content', async () => {
    const payload = Buffer.from(
      JSON.stringify({
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
      })
    ).toString('base64');
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

    expect(topic.polls).toEqual([
      {
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
      }
    ]);
    expect(topic.contentHtml).not.toContain('nsapp://vote?id=2443');
    expect(topic.contentHtml).not.toContain('提交投票');
    expect(topic.contentHtml).toContain('<forum-nodeseek-poll id="2443"></forum-nodeseek-poll>');
  });

  it('hides NodeSeek vote counts until the current user has voted', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 759903,
          title: 'NodeSeek unvoted poll topic',
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
      })
    ).toString('base64');
    const fetcher = routeFetcher([
      [
        '/api/vote/info/2443',
        json({
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
        })
      ],
      [/.*/, html(`<script>${payload}</script>`)]
    ]);

    const topic = await getNodeSeekTopic('759903', { fetcher });

    expect(topic.polls).toEqual([
      {
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
      }
    ]);
  });

  it('keeps failed NodeSeek vote markers and reports a partial topic', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 759903,
          title: 'NodeSeek partial poll topic',
          op: { name: 'alice' },
          comments: [
            {
              commentId: 10,
              poster: { name: 'alice' },
              markdown:
                '提交投票 nsapp://vote?id=2443\n\n提交投票 nsapp://vote?id=2444\n\n提交投票 nsapp://vote?id=2445',
              time: { createdDate: '2026-06-03T00:00:00.000Z' }
            }
          ]
        }
      })
    ).toString('base64');
    const fetcher = routeFetcher([
      [
        '/api/vote/info/2443',
        json({
          vote: {
            id: 2443,
            title: '可用投票',
            items: [{ vote_item_id: 71, text: '选项 A', voted: false }]
          }
        })
      ],
      ['/api/vote/info/2444', new Response(JSON.stringify({ success: false }), { status: 403 })],
      ['/api/vote/info/2445', json({ success: false })],
      [/.*/, html(`<script>${payload}</script>`)]
    ]);

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
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getNodeSeekTopic('759903', { fetcher });

    expect(topic.polls).toEqual([
      {
        id: '2443',
        title: '常用系统',
        multiple: false,
        voted: true,
        options: [
          { id: '71', label: 'Debian', count: 13, selected: false },
          { id: '72', label: 'ArchLinux', count: 5, selected: true }
        ]
      }
    ]);
    expect(topic.contentHtml).not.toContain('<form');
    expect(topic.contentHtml).not.toContain('Debian');
    expect(topic.contentHtml).toContain('<forum-nodeseek-poll id="2443"></forum-nodeseek-poll>');
  });

  it('maps hydrated NodeSeek embedded vote panels from the rendered page', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getNodeSeekTopic('759903', { fetcher });

    expect(topic.polls).toEqual([
      {
        id: '2443',
        title: '常用系统',
        multiple: false,
        public: true,
        voted: true,
        options: [
          { id: '71', label: 'Debian', count: 13, selected: false },
          { id: '72', label: 'ArchLinux', count: 5, selected: true }
        ]
      }
    ]);
    expect(topic.contentHtml).not.toContain('pure-form');
    expect(topic.contentHtml).not.toContain('vote-panel');
    expect(topic.contentHtml).not.toContain('embed-vote');
    expect(topic.contentHtml.trim()).toBe('<forum-nodeseek-poll id="2443"></forum-nodeseek-poll>');
  });

  it('prepares poll and Stardust markers in a targeted reply window', async () => {
    const vote = 'nsapp://vote?id=3028';
    const stardust = 'nsapp://stardust-receive?member_id=42&ref_id=7&description=Pay&diff=5&onetime=false';
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/vote/info/3028')) {
        return json({
          vote: {
            id: 3028,
            title: '评论投票',
            items: [{ vote_item_id: 1, text: '选项 A', voted: false }]
          }
        });
      }
      return htmlAt(
        `<a class="post-title" href="/post-856117-3">NodeSeek topic</a>
        <li id="25" data-comment-id="50025" class="content-item">
          <a class="floor-link">#25</a>
          <a href="/space/42" class="author-name">alice</a>
          <article class="post-content"><p>前</p><a href="/jump/vote">${vote}</a><p>中</p><a href="/jump/stardust">${stardust}</a><p>后</p></article>
        </li>`,
        'https://www.nodeseek.com/post-856117-3'
      );
    });

    const result = await getNodeSeekReplies('856117', {
      fetcher,
      limit: 10,
      order: 'oldest',
      position: { kind: 'target', target: { floor: 25, pageHint: 3 } },
      replyCount: 30
    });
    const reply = result.items[0];
    const rows = requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
      polls: reply.polls,
      role: 'reply',
      source: 'nodeseek'
    }).rows;

    expect(reply.polls?.map(({ id }) => id)).toEqual(['3028']);
    expect(rows.map(({ type }) => type)).toEqual(['richText', 'poll', 'richText']);
    expect(reply.contentHtml).toContain('forum-nodeseek-stardust');
    expect(reply.contentHtml).not.toContain('nsapp://');
  });

  it('removes an adjacent NodeSeek poll marker leak without splitting the surrounding paragraph', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

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
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

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
    const payload = Buffer.from(
      JSON.stringify({
        postData: { postId: 723704, title: 'NodeSeek topic', comments }
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => htmlAt(`<script>${payload}</script>`, input));

    const topic = await getNodeSeekTopic('723704', { fetcher, replyLimit: 30 });
    const replies = await getNodeSeekReplies('723704', {
      fetcher,
      order: 'oldest',
      position: {
        kind: 'cursor',
        page: topic.replyNextPage ?? 1,
        offset: topic.replyNextOffset ?? null
      },
      limit: 20
    });

    expect(topic.replyNextPage).toBe(1);
    expect(topic.replyNextOffset).toBe(30);
    expect(replies.items.map((item) => item.author)).toEqual(['reply 31', 'reply 32']);
    expect(replies.hasMore).toBe(false);
  });

  it('keeps NodeSeek reply pagination open when page one links to another reply page', async () => {
    const pageOnePayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 723704,
          title: 'NodeSeek topic',
          comments: [
            { floorIndex: 0, poster: { name: 'alice' }, markdown: '正文' },
            ...Array.from({ length: 10 }, (_, index) => ({
              floorIndex: index + 1,
              poster: { name: `reply ${index + 1}` },
              markdown: `回复 ${index + 1}`
            }))
          ]
        }
      })
    ).toString('base64');
    const pageTwoPayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 723704,
          title: 'NodeSeek topic',
          comments: [
            { floorIndex: 11, poster: { name: 'reply 11' }, markdown: '回复 11' },
            { floorIndex: 12, poster: { name: 'reply 12' }, markdown: '回复 12' }
          ]
        }
      })
    ).toString('base64');
    const fetcher = routeFetcher([
      ['/post-723704-2', (input) => htmlAt(`<script>${pageTwoPayload}</script>`, input)],
      [
        /.*/,
        html(`
        <script>${pageOnePayload}</script>
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          <a href="/post-723704-2" rel="next">2</a>
        </div>
      `)
      ]
    ]);

    const topic = await getNodeSeekTopic('723704', { fetcher, replyLimit: 30 });
    const replies = await getNodeSeekReplies('723704', {
      fetcher,
      order: 'oldest',
      position: {
        kind: 'cursor',
        page: topic.replyNextPage ?? 1,
        offset: topic.replyNextOffset ?? null
      },
      limit: 20
    });

    expect(topic.replyHasMore).toBe(true);
    expect(topic.replyNextPage).toBe(2);
    expect(topic.replyNextOffset).toBe(10);
    expect(replies.items.map((item) => item.author)).toEqual(['reply 11', 'reply 12']);
    expect(replies.items.map((item) => item.floor)).toEqual([11, 12]);
  });

  it('continues rendered NodeSeek floors from the page offset when floor markers are missing', async () => {
    const fetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-723704-2">NodeSeek topic</a>
      <div class="content-item">
        <a href="/space/1" class="author-name">alice</a>
        <article class="post-content"><p>正文</p></article>
      </div>
      <li data-comment-id="201" class="content-item">
        <a href="/space/2" class="author-name">bob</a>
        <article class="post-content"><p>回复 31</p></article>
      </li>
      <li data-comment-id="202" class="content-item">
        <a href="/space/3" class="author-name">carol</a>
        <article class="post-content"><p>回复 32</p></article>
      </li>
    `)
    );

    const replies = await getNodeSeekReplies('723704', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: 2, offset: 30 },
      limit: 30
    });

    expect(replies.items.map((item) => item.floor)).toEqual([31, 32]);
    expect(sourceDiagnosticSummary(replies)?.missingFloorCount).toBe(2);
  });

  it('reads a hinted NodeSeek post-write window with one list request', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      requestedPages.push(Number(input.match(/post-852804-(\d+)/)?.[1] || 1));
      return html(`
      <a class="post-title" href="/post-852804-440">NodeSeek topic</a>
      <li id="4391" data-comment-id="11640077" class="content-item">
        <a class="floor-link">#4391</a>
        <a href="/space/1" class="author-name">first reply</a>
        <article class="post-content"><p>第 4391 楼</p></article>
      </li>
      <li id="4392" data-comment-id="11640171" class="content-item">
        <a class="floor-link">#4392</a>
        <a href="/space/2" class="author-name">second reply</a>
        <article class="post-content"><p>第 4392 楼</p></article>
      </li>
    `);
    });

    const replies = await getNodeSeekReplies('852804', {
      fetcher,
      order: 'newest',
      position: { kind: 'cursor', page: 440, offset: 4390 },
      limit: 10
    });

    expect(requestedPages).toEqual([440]);
    expect(replies.items.map((item) => [item.floor, item.commentId])).toEqual([
      [4392, 11640171],
      [4391, 11640077]
    ]);
  });

  it('reads the real NodeSeek tail window before its adjacent older window', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-852805-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      const firstFloor = (page - 1) * 10 + 1;
      const replies = Array.from({ length: page === 5 ? 5 : 10 }, (_, index) => {
        const floor = firstFloor + index;
        return `
          <li id="${floor}" data-comment-id="${10000 + floor}" class="content-item">
            <a class="floor-link">#${floor}</a>
            <a href="/space/${floor}" class="author-name">user-${floor}</a>
            <article class="post-content"><p>reply ${floor}</p></article>
          </li>
        `;
      }).join('');
      return html(
        `<a class="post-title" href="/post-852805-${page}">NodeSeek topic</a>${replies}
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          ${page < 5 ? `<a href="/post-852805-${page + 1}" rel="next">${page + 1}</a>` : ''}
          ${page < 5 ? '<a href="/post-852805-5">5</a>' : ''}
        </div>`
      );
    });

    const tail = await getNodeSeekReplies('852805', {
      fetcher,
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45,
      limit: 10
    });
    const older = await getNodeSeekReplies('852805', {
      fetcher,
      order: 'newest',
      position: { kind: 'cursor', page: tail.nextPage!, offset: tail.nextOffset ?? null },
      replyCount: 45,
      limit: 10
    });

    expect(requestedPages).toEqual([1, 5, 4]);
    expect(requestedPages).not.toEqual(expect.arrayContaining([2, 3]));
    expect(tail.items.map((reply) => reply.floor)).toEqual([45, 44, 43, 42, 41]);
    expect(tail).toMatchObject({ currentPage: 5, hasMore: true, nextPage: 4 });
    expect(older.items.map((reply) => reply.floor)).toEqual([40, 39, 38, 37, 36, 35, 34, 33, 32, 31]);
    expect(older).toMatchObject({ currentPage: 4, previousPage: 5, nextPage: 3 });
  });

  it('excludes out-of-page featured copies from ordered NodeSeek reply windows', async () => {
    const requestedPages: number[] = [];
    const row = (floor: number, featured = '') => `
      <li id="${floor}" data-comment-id="${80000 + floor}" class="content-item">
        <div class="floor-link-wrapper">${featured}<a class="floor-link">#${floor}</a></div>
        <a href="/space/${floor}" class="author-name">user-${floor}</a>
        <article class="post-content"><p>reply ${floor}</p></article>
      </li>
    `;
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-832584-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      const rows =
        page === 1
          ? [
              row(44, '<div class="hot-badge"></div>'),
              row(9, '<div class="hot-badge"></div>'),
              row(83, '<div class="pinned-badge"></div>'),
              row(117, '<div class="hot-badge"></div>'),
              ...Array.from({ length: 8 }, (_, index) => row(index + 1)),
              row(10)
            ].join('')
          : Array.from({ length: page === 44 ? 4 : 10 }, (_, index) => row((page - 1) * 10 + index + 1)).join('');
      return htmlAt(
        `
          <a class="post-title" href="/post-832584-${page}">NodeSeek featured replies</a>
          ${
            page === 1
              ? '<div id="0" data-comment-id="80000" class="content-item"><a href="/space/0" class="author-name">op</a><article class="post-content"><p>opening post</p></article></div>'
              : ''
          }
          ${rows}
          <div class="nsk-pager" role="navigation" aria-label="pagination">
            ${page > 1 ? `<a href="/post-832584-${page - 1}" rel="prev">${page - 1}</a>` : ''}
            ${page < 44 ? `<a href="/post-832584-${page + 1}" rel="next">${page + 1}</a>` : ''}
            ${page < 44 ? '<a href="/post-832584-44">44</a>' : ''}
          </div>
        `,
        `https://www.nodeseek.com/post-832584-${page}`
      );
    });

    const tail = await getNodeSeekReplies('832584', {
      fetcher,
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 434,
      limit: 10
    });
    const older = await getNodeSeekReplies('832584', {
      fetcher,
      order: 'newest',
      position: { kind: 'cursor', page: tail.nextPage!, offset: tail.nextOffset ?? null },
      replyCount: 434,
      limit: 10
    });

    expect(requestedPages).toEqual([1, 44, 43]);
    expect(tail.items.map((reply) => reply.floor)).toEqual([434, 433, 432, 431]);
    expect(older.items.map((reply) => reply.floor)).toEqual([430, 429, 428, 427, 426, 425, 424, 423, 422, 421]);
  });

  it('rejects an ordinary NodeSeek outlier after the requested page is fully confirmed', async () => {
    const rows = [...Array.from({ length: 10 }, (_, index) => index + 1), 44]
      .map(
        (floor) => `
          <li id="${floor}" data-comment-id="${81000 + floor}" class="content-item">
            <a class="floor-link">#${floor}</a>
            <a href="/space/${floor}" class="author-name">user-${floor}</a>
            <article class="post-content"><p>reply ${floor}</p></article>
          </li>
        `
      )
      .join('');
    const fetcher = vi.fn(async () =>
      htmlAt(
        `
          <a class="post-title" href="/post-832585-1">NodeSeek wrong-page reply</a>
          <div id="0" data-comment-id="81000" class="content-item"><a href="/space/0" class="author-name">op</a><article class="post-content"><p>opening post</p></article></div>
          ${rows}
        `,
        'https://www.nodeseek.com/post-832585-1'
      )
    );

    await expect(
      getNodeSeekReplies('832585', {
        fetcher,
        order: 'oldest',
        position: { kind: 'cursor', page: 1, offset: 0 },
        replyCount: 10,
        limit: 10
      })
    ).rejects.toThrow('NodeSeek 原站未确认请求的回复页');
  });

  it.each(['oldest', 'newest'] as const)('follows both NodeSeek edges from a centered %s window', async (order) => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-852809-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      const firstFloor = (page - 1) * 10 + 1;
      const rows = Array.from({ length: 10 }, (_, index) => {
        const floor = firstFloor + index;
        return `
            <li id="${floor}" data-comment-id="${50000 + floor}" class="content-item">
              <a class="floor-link">#${floor}</a>
              <a href="/space/${floor}" class="author-name">user-${floor}</a>
              <article class="post-content"><p>reply ${floor}</p></article>
            </li>
          `;
      }).join('');
      return htmlAt(
        `<a class="post-title" href="/post-852809-${page}">NodeSeek topic</a>${rows}
          <div class="nsk-pager" role="navigation" aria-label="pagination">
            ${page > 1 ? `<a href="/post-852809-${page - 1}" rel="prev">${page - 1}</a>` : ''}
            ${page < 5 ? `<a href="/post-852809-${page + 1}" rel="next">${page + 1}</a>` : ''}
          </div>`,
        `https://www.nodeseek.com/post-852809-${page}`
      );
    });

    const center = await getNodeSeekReplies('852809', {
      fetcher,
      order,
      position: { kind: 'target', target: { floor: 25, pageHint: 3 } },
      replyCount: 50,
      limit: 10
    });
    const previous = await getNodeSeekReplies('852809', {
      fetcher,
      order,
      position: { kind: 'cursor', page: center.previousPage!, offset: center.previousOffset ?? null },
      replyCount: 50,
      limit: 10
    });
    const next = await getNodeSeekReplies('852809', {
      fetcher,
      order,
      position: { kind: 'cursor', page: center.nextPage!, offset: center.nextOffset ?? null },
      replyCount: 50,
      limit: 10
    });

    expect(center.currentPage).toBe(3);
    expect(previous.currentPage).toBe(order === 'oldest' ? 2 : 4);
    expect(next.currentPage).toBe(order === 'oldest' ? 4 : 2);
    expect(requestedPages).toEqual(order === 'oldest' ? [3, 2, 4] : [3, 4, 2]);
    expect(new Set([...previous.items, ...center.items, ...next.items].map((reply) => reply.floor)).size).toBe(30);
  });

  it('classifies a NodeSeek adjacent cursor resolved to a different page', async () => {
    const resolvedPage = 3;
    const floors = Array.from({ length: 10 }, (_, index) => index + 21);
    const fetcher = vi.fn(async (input: string) => {
      const requestedPage = Number(input.match(/post-852808-(\d+)/)?.[1] || 1);
      const responsePage = requestedPage === 4 ? resolvedPage : requestedPage;
      const responseFloors =
        requestedPage === 1
          ? Array.from({ length: 10 }, (_, index) => index + 1)
          : requestedPage === 4
            ? floors
            : [41, 42, 43, 44, 45];
      const response = html(`
        <a class="post-title" href="/post-852808-${responsePage}">NodeSeek topic</a>
        ${responseFloors
          .map((floor) => {
            return `
            <li id="${floor}" data-comment-id="${40000 + floor}" class="content-item">
              <a class="floor-link">#${floor}</a>
              <a href="/space/${floor}" class="author-name">user-${floor}</a>
              <article class="post-content"><p>reply ${floor}</p></article>
            </li>
          `;
          })
          .join('')}
        ${requestedPage === 1 ? '<div class="nsk-pager"><a href="/post-852808-5" rel="next">5</a></div>' : ''}
      `);
      Object.defineProperty(response, 'url', {
        value: `https://www.nodeseek.com/post-852808-${responsePage}`
      });
      return response;
    });

    const tail = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45,
      limit: 10
    });

    const error = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'newest',
      position: { kind: 'cursor', page: tail.nextPage!, offset: tail.nextOffset ?? null },
      replyCount: 45,
      limit: 10
    }).then(
      () => null,
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('未确认请求的回复页');
    expect((error as { reason?: unknown }).reason).toBeUndefined();
  });

  it('keeps a confirmed sparse NodeSeek ordinary cursor window', async () => {
    const floors = [31, 32, 33, 34, 35, 37, 38, 39, 40];
    const fetcher = vi.fn(async () =>
      htmlAt(
        `
          <a class="post-title" href="/post-852808-4">NodeSeek topic</a>
          ${floors
            .map(
              (floor) => `
                <li id="${floor}" data-comment-id="${40000 + floor}" class="content-item">
                  <a class="floor-link">#${floor}</a>
                  <a href="/space/${floor}" class="author-name">user-${floor}</a>
                  <article class="post-content"><p>reply ${floor}</p></article>
                </li>
              `
            )
            .join('')}
          <div class="nsk-pager"><a href="/post-852808-5" rel="next">5</a></div>
        `,
        'https://www.nodeseek.com/post-852808-4'
      )
    );

    const result = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: 4, offset: 30 },
      limit: 10
    });

    expect(result.items.map((reply) => reply.floor)).toEqual(floors);
    expect(result).toMatchObject({ currentPage: 4, completeness: 'partial' });
  });

  it('preserves empty records from the embedded NodeSeek comment collection', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 852808,
          postPage: 1,
          title: 'NodeSeek topic',
          comments: [
            { commentId: 1, poster: { name: 'op' }, markdown: 'body' },
            { commentId: 2, floorIndex: 1, poster: { name: 'first' }, markdown: 'first' },
            {},
            { commentId: 4, poster: {}, markdown: '' }
          ]
        }
      })
    ).toString('base64');
    const response = htmlAt(`<script>${payload}</script>`, 'https://www.nodeseek.com/post-852808-1');

    const result = await getNodeSeekReplies('852808', {
      fetcher: vi.fn(async () => response),
      order: 'oldest',
      position: { kind: 'start' },
      limit: 10
    });

    expect(result.items.map(({ commentId, floor }) => ({ commentId, floor }))).toEqual([
      { commentId: 2, floor: 1 },
      { commentId: undefined, floor: 2 },
      { commentId: 4, floor: 3 }
    ]);
    expect(result).toMatchObject({ completeness: 'partial' });
  });

  it('preserves partial evidence for an exact NodeSeek target window', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 852808,
          postPage: 1,
          title: 'NodeSeek topic',
          comments: [
            { commentId: 1, poster: { name: 'op' }, markdown: 'body' },
            { commentId: 40031, floorIndex: 31, poster: { name: 'target' }, markdown: 'target' },
            null
          ]
        }
      })
    ).toString('base64');

    const result = await getNodeSeekReplies('852808', {
      fetcher: vi.fn(async () => htmlAt(`<script>${payload}</script>`, 'https://www.nodeseek.com/post-852808-1')),
      order: 'oldest',
      position: { kind: 'target', target: { commentId: 40031, floor: 31, pageHint: 1 } },
      limit: 10
    });

    expect(result.items).toEqual([expect.objectContaining({ commentId: 40031, floor: 31 })]);
    expect(result).toMatchObject({ currentPage: 1, completeness: 'partial' });
  });

  it('keeps a complete exact NodeSeek tail window out of partial status', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 852808,
          postPage: 2,
          postPageCount: 2,
          title: 'NodeSeek topic',
          comments: Array.from({ length: 6 }, (_, index) => ({
            commentId: 40011 + index,
            floorIndex: 11 + index,
            poster: { name: `user-${11 + index}` },
            markdown: `reply ${11 + index}`
          }))
        }
      })
    ).toString('base64');

    const result = await getNodeSeekReplies('852808', {
      fetcher: vi.fn(async () => htmlAt(`<script>${payload}</script>`, 'https://www.nodeseek.com/post-852808-2')),
      order: 'oldest',
      position: { kind: 'target', target: { commentId: 40016, floor: 16, pageHint: 2 } },
      limit: 10
    });

    expect(result.items.map(({ commentId, floor }) => ({ commentId, floor }))).toEqual(
      Array.from({ length: 6 }, (_, index) => ({ commentId: 40011 + index, floor: 11 + index }))
    );
    expect(result).toMatchObject({ currentPage: 2, completeness: 'complete' });
  });

  it('rejects an explicit wrong NodeSeek topic identity before projecting replies', async () => {
    const response = htmlAt(
      `<a class="post-title" href="/post-999999-1">Wrong topic</a>
       <li class="content-item"><article class="post-content"><p>body</p></article></li>
       <li id="1" data-comment-id="40031" class="content-item">
         <a class="floor-link">#1</a><a href="/space/1" class="author-name">user-1</a>
         <article class="post-content"><p>reply</p></article>
       </li>`,
      'https://www.nodeseek.com/post-999999-1'
    );

    await expect(
      getNodeSeekReplies('852808', {
        fetcher: vi.fn(async () => response),
        order: 'oldest',
        position: { kind: 'start' },
        limit: 10
      })
    ).rejects.toThrow('主题身份不一致');
  });

  it('deduplicates duplicate ordinary NodeSeek reply identifiers', async () => {
    const row = `
      <li id="31" data-comment-id="40031" class="content-item">
        <a class="floor-link">#31</a>
        <a href="/space/31" class="author-name">user-31</a>
        <article class="post-content"><p>reply 31</p></article>
      </li>
    `;
    const fetcher = vi.fn(async () =>
      htmlAt(
        `<a class="post-title" href="/post-852808-4">NodeSeek topic</a>${row}${row}`,
        'https://www.nodeseek.com/post-852808-4'
      )
    );

    const result = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: 4, offset: 30 },
      limit: 10
    });

    expect(result.items.map((reply) => reply.commentId)).toEqual([40031]);
    expect(result).toMatchObject({ completeness: 'partial' });
  });

  it('keeps one ordinary NodeSeek row when a featured copy repeats its location', async () => {
    const row = (featured = '') => `
      <li id="31" data-comment-id="40031" class="content-item">
        <div class="floor-link-wrapper">${featured}<a class="floor-link">#31</a></div>
        <a href="/space/31" class="author-name">user-31</a>
        <article class="post-content"><p>reply 31</p></article>
      </li>
    `;
    const result = await getNodeSeekReplies('852808', {
      fetcher: vi.fn(async () =>
        htmlAt(
          `<a class="post-title" href="/post-852808-4">NodeSeek topic</a>${row(
            '<div class="hot-badge"></div>'
          )}${row()}`,
          'https://www.nodeseek.com/post-852808-4'
        )
      ),
      order: 'oldest',
      position: { kind: 'cursor', page: 4, offset: 30 },
      limit: 10
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ commentId: 40031, floor: 31, hot: undefined, pinned: undefined });
  });

  it('rejects a floor-only NodeSeek exact target backed only by a synthesized floor', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 852808,
          title: 'NodeSeek topic',
          comments: [{ commentId: 40031, poster: { name: 'user-31' }, markdown: '' }]
        }
      })
    ).toString('base64');

    await expect(
      getNodeSeekReplies('852808', {
        fetcher: vi.fn(async () =>
          htmlAt(
            `<script>${payload}</script><a class="post-title" href="/post-852808-4">NodeSeek topic</a>`,
            'https://www.nodeseek.com/post-852808-4'
          )
        ),
        order: 'oldest',
        position: { kind: 'target', target: { floor: 31, pageHint: 4 } },
        limit: 10
      })
    ).rejects.toThrow('目标楼层未找到');
  });

  it('keeps an author-only first NodeSeek reply on a later page', async () => {
    const result = await getNodeSeekReplies('852808', {
      fetcher: vi.fn(async () =>
        htmlAt(
          `<a class="post-title" href="/post-852808-2">NodeSeek topic</a>
           <li class="content-item"><a href="/space/11" class="author-name">user-11</a><article class="post-content"></article></li>`,
          'https://www.nodeseek.com/post-852808-2'
        )
      ),
      order: 'oldest',
      position: { kind: 'cursor', page: 2, offset: 10 },
      limit: 10
    });

    expect(result.items).toEqual([expect.objectContaining({ author: 'user-11', floor: 11 })]);
    expect(result).toMatchObject({ completeness: 'partial' });
  });

  it('advances a NodeSeek origin page by consumed collection rows', async () => {
    const embedded = (page: number) => {
      const comments =
        page === 1
          ? [
              { commentId: 1, floorIndex: 0, poster: { name: 'op' }, markdown: 'topic' },
              ...Array.from({ length: 10 }, (_, index) =>
                index === 4
                  ? {}
                  : {
                      commentId: 40001 + index,
                      floorIndex: index + 1,
                      poster: { name: `user-${index + 1}` },
                      markdown: `reply ${index + 1}`
                    }
              )
            ]
          : [{ commentId: 40011, poster: { name: 'user-11' }, markdown: 'reply 11' }];
      return Buffer.from(JSON.stringify({ postData: { postId: 852808, title: 'NodeSeek topic', comments } })).toString(
        'base64'
      );
    };
    const fetcher = vi.fn(async (input: string) => {
      const page = input.includes('/post-852808-2') ? 2 : 1;
      return htmlAt(
        `<script>${embedded(page)}</script><a class="post-title" href="/post-852808-${page}">NodeSeek topic</a>${
          page === 1 ? '<div class="nsk-pager"><a href="/post-852808-2" rel="next">2</a></div>' : ''
        }`,
        `https://www.nodeseek.com/post-852808-${page}`
      );
    });

    const first = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 10
    });
    const second = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: first.nextPage!, offset: first.nextOffset ?? null },
      limit: 10
    });

    expect(first).toMatchObject({ completeness: 'partial', nextPage: 2, nextOffset: 10 });
    expect(second.items).toEqual([expect.objectContaining({ commentId: 40011, floor: 11 })]);
  });

  it('rejects an empty NodeSeek ordinary cursor window', async () => {
    const payload = Buffer.from(
      JSON.stringify({ postData: { postId: 852808, title: 'NodeSeek topic', comments: [] } })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      htmlAt(
        `<script>${payload}</script><a class="post-title" href="/post-852808-4">NodeSeek topic</a>`,
        'https://www.nodeseek.com/post-852808-4'
      )
    );

    await expect(
      getNodeSeekReplies('852808', {
        fetcher,
        order: 'oldest',
        position: { kind: 'cursor', page: 4, offset: 30 },
        limit: 10
      })
    ).rejects.toThrow('回复窗口为空');
  });

  it('keeps an empty record selected by the embedded NodeSeek comment collection', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 852808,
          postPage: 1,
          replyCount: 5,
          title: 'NodeSeek topic',
          comments: [{ commentId: 1, poster: { name: 'op' }, markdown: 'body' }, {}]
        }
      })
    ).toString('base64');

    const result = await getNodeSeekReplies('852808', {
      fetcher: vi.fn(async () => htmlAt(`<script>${payload}</script>`, 'https://www.nodeseek.com/post-852808-1')),
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: 5,
      limit: 10
    });

    expect(result.items).toEqual([expect.objectContaining({ author: '', contentHtml: '', floor: 1 })]);
    expect(result).toMatchObject({ completeness: 'partial' });
  });

  it('rejects an empty oldest NodeSeek start window with a continuation', async () => {
    const payload = Buffer.from(
      JSON.stringify({ postData: { postId: 852808, title: 'NodeSeek topic', comments: [] } })
    ).toString('base64');

    await expect(
      getNodeSeekReplies('852808', {
        fetcher: vi.fn(async () =>
          htmlAt(
            `<script>${payload}</script>
             <a class="post-title" href="/post-852808-1">NodeSeek topic</a>
             <div class="nsk-pager"><a href="/post-852808-2" rel="next">2</a></div>`,
            'https://www.nodeseek.com/post-852808-1'
          )
        ),
        order: 'oldest',
        position: { kind: 'start' },
        limit: 10
      })
    ).rejects.toThrow('回复窗口为空');
  });

  it('rejects an empty oldest NodeSeek page before filling from its continuation', async () => {
    const payload = (comments: unknown[]) =>
      Buffer.from(JSON.stringify({ postData: { postId: 852808, title: 'NodeSeek topic', comments } })).toString(
        'base64'
      );

    await expect(
      getNodeSeekReplies('852808', {
        fetcher: vi.fn(async (input: string) =>
          input.includes('/post-852808-2')
            ? htmlAt(
                `<script>${payload([
                  { commentId: 40011, floorIndex: 11, poster: { name: 'user-11' }, markdown: 'reply 11' }
                ])}</script><a class="post-title" href="/post-852808-2">NodeSeek topic</a>`,
                'https://www.nodeseek.com/post-852808-2'
              )
            : htmlAt(
                `<script>${payload([])}</script>
                 <a class="post-title" href="/post-852808-1">NodeSeek topic</a>
                 <div class="nsk-pager"><a href="/post-852808-2" rel="next">2</a></div>`,
                'https://www.nodeseek.com/post-852808-1'
              )
        ),
        order: 'oldest',
        position: { kind: 'start' },
        limit: 20,
        fillPages: true
      })
    ).rejects.toThrow('回复窗口为空');
  });

  it('rejects an empty first NodeSeek reply window without an authoritative zero count', async () => {
    const payload = Buffer.from(
      JSON.stringify({ postData: { postId: 852808, title: 'NodeSeek topic', comments: [] } })
    ).toString('base64');
    await expect(
      getNodeSeekReplies('852808', {
        fetcher: vi.fn(async () =>
          htmlAt(
            `<script>${payload}</script><a class="post-title" href="/post-852808-1">NodeSeek topic</a>`,
            'https://www.nodeseek.com/post-852808-1'
          )
        ),
        order: 'oldest',
        position: { kind: 'start' },
        limit: 10
      })
    ).rejects.toThrow('回复窗口为空');
  });

  it('accepts an origin-confirmed adjacent page even when the previous reply count is stale', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <a class="post-title" href="/post-852808-4">NodeSeek topic</a>
        ${Array.from(
          { length: 10 },
          (_, index) => `
            <li id="${index + 31}" data-comment-id="${40031 + index}" class="content-item">
              <a class="floor-link">#${index + 31}</a>
              <a href="/space/${index + 31}" class="author-name">user-${index + 31}</a>
              <article class="post-content"><p>reply ${index + 31}</p></article>
            </li>
          `
        ).join('')}
      `)
    );

    const adjacent = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'newest',
      position: { kind: 'cursor', page: 4, offset: 30 },
      replyCount: 35,
      limit: 10
    });

    expect(adjacent.items.map((reply) => reply.floor)).toEqual([40, 39, 38, 37, 36, 35, 34, 33, 32, 31]);
    expect(adjacent).toMatchObject({ currentPage: 4, previousPage: null, hasMore: true, nextPage: 3 });
  });

  it('follows the real full-page boundary shape without refetching a stale count first', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-861053-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      const floors = page === 1 ? Array.from({ length: 10 }, (_, index) => index + 1) : [11, 12, 13, 14];
      return htmlAt(
        `
          <a class="post-title" href="/post-861053-1">NodeSeek topic</a>
          ${
            page === 1
              ? '<div id="0" data-comment-id="11740000" class="content-item"><a href="/space/0" class="author-name">op</a><article class="post-content"><p>opening post</p></article></div>'
              : ''
          }
          <div class="nsk-pager post-top-pager" role="navigation" aria-label="pagination">
            ${
              page === 1
                ? '<span class="pager-pos pager-cur">1</span><a href="/post-861053-2" rel="next" class="pager-next">2</a>'
                : '<a href="/post-861053-1" rel="prev" class="pager-prev">1</a><span class="pager-pos pager-cur">2</span>'
            }
          </div>
          ${floors
            .map(
              (floor) => `
                <li id="${floor}" data-comment-id="${11740000 + floor}" class="content-item">
                  <a class="floor-link">#${floor}</a>
                  <a href="/space/${floor}" class="author-name">user-${floor}</a>
                  <article class="post-content"><p>reply ${floor}</p></article>
                </li>
              `
            )
            .join('')}
        `,
        `https://www.nodeseek.com/post-861053-${page}`
      );
    });

    const first = await getNodeSeekReplies('861053', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: 10,
      limit: 10
    });
    const second = await getNodeSeekReplies('861053', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: first.nextPage!, offset: first.nextOffset ?? null },
      replyCount: 10,
      limit: 10
    });

    expect(requestedPages).toEqual([1, 2]);
    expect(first).toMatchObject({ hasMore: true, nextPage: 2, nextOffset: 10 });
    expect(second.items.map((reply) => reply.floor)).toEqual([11, 12, 13, 14]);
    expect(second).toMatchObject({ currentPage: 2, hasMore: false, nextPage: null });
  });

  it('does not fabricate a NodeSeek reply total or fetch the tail just to count it', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-861053-(\d+)/)?.[1] || 1) as 1 | 2;
      requestedPages.push(page);
      return nodeSeekStaleCountPage(page);
    });

    const topic = await getNodeSeekTopic('861053', { fetcher, replyLimit: 10 });

    expect(requestedPages).toEqual([1]);
    expect(topic.replies.map((reply) => reply.floor)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
    expect(topic).not.toHaveProperty('replyCount');
    expect(topic).toMatchObject({ replyHasMore: true, replyNextPage: 2, replyNextOffset: 10 });
  });

  it('discovers the confirmed NodeSeek newest tail even when the supplied reply count is stale', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-861053-(\d+)/)?.[1] || 1) as 1 | 2;
      requestedPages.push(page);
      return nodeSeekStaleCountPage(page);
    });

    const tail = await getNodeSeekReplies('861053', {
      fetcher,
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 10,
      limit: 10
    });

    expect(requestedPages).toEqual([1, 2]);
    expect(tail.items.map((reply) => reply.floor)).toEqual([14, 13, 12, 11]);
    expect(tail).toMatchObject({ currentPage: 2, hasMore: true, nextPage: 1, nextOffset: 0 });
    expect(tail).not.toHaveProperty('totalCount');
  });

  it('does not invent a reply cursor from an inline same-topic quote link', async () => {
    const replies = await getNodeSeekReplies('861053', {
      fetcher: vi.fn(async () =>
        htmlAt(
          `
            <a class="post-title" href="/post-861053-1">NodeSeek topic</a>
            <li class="content-item">
              <article class="post-content"><p>topic body</p></article>
            </li>
            <li id="1" data-comment-id="11740001" class="content-item">
              <a class="floor-link">#1</a>
              <a href="/space/1" class="author-name">user-1</a>
              <article class="post-content"><a href="/post-861053-2#11">quoted floor</a></article>
            </li>
          `,
          'https://www.nodeseek.com/post-861053-1'
        )
      ),
      order: 'oldest',
      position: { kind: 'start' },
      replyCount: 1,
      limit: 10
    });

    expect(replies).toMatchObject({ hasMore: false, nextPage: null, nextOffset: null });
  });

  it('does not treat an unconfirmed adjacent page as a stale reply count', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <h1>NodeSeek topic</h1>
        ${Array.from(
          { length: 10 },
          (_, index) => `
            <li id="${index + 31}" data-comment-id="${40031 + index}" class="content-item">
              <a class="floor-link">#${index + 31}</a>
              <a href="/space/${index + 31}" class="author-name">user-${index + 31}</a>
              <article class="post-content"><p>reply ${index + 31}</p></article>
            </li>
          `
        ).join('')}
      `)
    );

    const error = await getNodeSeekReplies('852808', {
      fetcher,
      order: 'newest',
      position: { kind: 'cursor', page: 4, offset: 30 },
      replyCount: 35,
      limit: 10
    }).then(
      () => null,
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('未确认请求的回复页');
    expect((error as { reason?: unknown }).reason).toBeUndefined();
  });

  it('accepts a self-proving NodeSeek tail when the supplied count is stale', async () => {
    const requestedPages: number[] = [];
    const tail = await getNodeSeekReplies('852806', {
      fetcher: vi.fn(async (input: string) => {
        const page = Number(input.match(/post-852806-(\d+)/)?.[1] || 1);
        requestedPages.push(page);
        const floors = page === 1 ? Array.from({ length: 10 }, (_, index) => index + 1) : [4391, 4392, 4393, 4394];
        return html(`
          <a class="post-title" href="/post-852806-${page}">NodeSeek topic</a>
          ${floors
            .map(
              (floor) => `
                <li id="${floor}" data-comment-id="${20000 + floor}" class="content-item">
                  <a class="floor-link">#${floor}</a>
                  <a href="/space/${floor}" class="author-name">user-${floor}</a>
                  <article class="post-content"><p>reply ${floor}</p></article>
                </li>
              `
            )
            .join('')}
          ${page === 1 ? '<div class="nsk-pager"><a href="/post-852806-440" rel="next">440</a></div>' : ''}
        `);
      }),
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45,
      limit: 10
    });

    expect(requestedPages).toEqual([1, 440]);
    expect(tail.items.map((reply) => reply.floor)).toEqual([4394, 4393, 4392, 4391]);
    expect(tail).toMatchObject({ currentPage: 440, hasMore: true, nextPage: 439 });
    expect(tail).not.toHaveProperty('totalCount');
  });

  it('keeps a confirmed sparse NodeSeek newest tail', async () => {
    const tail = await getNodeSeekReplies('852806', {
      fetcher: vi.fn(async (input: string) => {
        const page = Number(input.match(/post-852806-(\d+)/)?.[1] || 1);
        const floors = page === 1 ? Array.from({ length: 10 }, (_, index) => index + 1) : [41, 42, 43, 45];
        return html(`
          <a class="post-title" href="/post-852806-${page}">NodeSeek topic</a>
          ${floors
            .map(
              (floor) => `
                <li id="${floor}" data-comment-id="${20000 + floor}" class="content-item">
                  <a class="floor-link">#${floor}</a>
                  <a href="/space/${floor}" class="author-name">user-${floor}</a>
                  <article class="post-content"><p>reply ${floor}</p></article>
                </li>
              `
            )
            .join('')}
          ${page === 1 ? '<div class="nsk-pager"><a href="/post-852806-5" rel="next">5</a></div>' : ''}
        `);
      }),
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45,
      limit: 10
    });

    expect(tail.items.map((reply) => reply.floor)).toEqual([45, 43, 42, 41]);
    expect(tail).toMatchObject({ currentPage: 5, completeness: 'partial' });
  });

  it('follows a newer NodeSeek pager cursor before accepting the tail', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-852806-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      const floors = page === 1 ? Array.from({ length: 10 }, (_, index) => index + 1) : [51, 52];
      return html(`
        <a class="post-title" href="/post-852806-${page}">NodeSeek topic</a>
        ${floors
          .map(
            (floor) => `
              <li id="${floor}" data-comment-id="${20000 + floor}" class="content-item">
                <a class="floor-link">#${floor}</a>
                <a href="/space/${floor}" class="author-name">user-${floor}</a>
                <article class="post-content"><p>reply ${floor}</p></article>
              </li>
            `
          )
          .join('')}
        ${
          page === 1
            ? '<div class="nsk-pager" role="navigation" aria-label="pagination"><a href="/post-852806-6" rel="next">6</a></div>'
            : ''
        }
      `);
    });

    const tail = await getNodeSeekReplies('852806', {
      fetcher,
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45,
      limit: 10
    });

    expect(requestedPages).toEqual([1, 6]);
    expect(tail.items.map((reply) => reply.floor)).toEqual([52, 51]);
    expect(tail).toMatchObject({ currentPage: 6, hasMore: true, nextPage: 5 });
    expect(tail).not.toHaveProperty('totalCount');
  });

  it('stops after one NodeSeek tail jump instead of crawling a next-only pager', async () => {
    const requestedPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-852806-(\d+)/)?.[1] || 1);
      requestedPages.push(page);
      const firstFloor = (page - 1) * 10 + 1;
      return html(`
        <a class="post-title" href="/post-852806-${page}">NodeSeek topic</a>
        ${Array.from(
          { length: 10 },
          (_, index) => `
            <li id="${firstFloor + index}" data-comment-id="${20000 + firstFloor + index}" class="content-item">
              <a class="floor-link">#${firstFloor + index}</a>
              <a href="/space/${firstFloor + index}" class="author-name">user-${firstFloor + index}</a>
              <article class="post-content"><p>reply ${firstFloor + index}</p></article>
            </li>
          `
        ).join('')}
        ${page < 3 ? `<div class="nsk-pager"><a href="/post-852806-${page + 1}" rel="next">${page + 1}</a></div>` : ''}
      `);
    });

    await expect(
      getNodeSeekReplies('852806', {
        fetcher,
        order: 'newest',
        position: { kind: 'start' },
        replyCount: 10,
        limit: 10
      })
    ).rejects.toThrow('NodeSeek 原站无法确认最新窗口');

    expect(requestedPages).toEqual([1, 2]);
  });

  it('rejects a NodeSeek tail with a different resolved page', async () => {
    const resolvedPage = 4;
    const response = html(`
      <a class="post-title" href="/post-852807-${resolvedPage}">NodeSeek topic</a>
      ${Array.from(
        { length: 5 },
        (_, index) => `
          <li data-comment-id="${30000 + index}" class="content-item">
            <a href="/space/${index + 1}" class="author-name">user-${index + 1}</a>
            <article class="post-content"><p>reply ${index + 1}</p></article>
          </li>
        `
      ).join('')}
    `);
    Object.defineProperty(response, 'url', {
      value: `https://www.nodeseek.com/post-852807-${resolvedPage}`
    });

    const error = await getNodeSeekReplies('852807', {
      fetcher: vi.fn(async () => response),
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45,
      limit: 10
    }).then(
      () => null,
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as { reason?: unknown }).reason).toBeUndefined();
  });

  it('keeps a confirmed NodeSeek tail with locally inferred floors', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(input.match(/post-852807-(\d+)/)?.[1] || 1);
      const response = html(`
        <a class="post-title" href="/post-852807-${page}">NodeSeek topic</a>
        ${
          page === 1
            ? `<li class="content-item"><article class="post-content"><p>body</p></article></li>
               <li id="1" data-comment-id="29999" class="content-item">
                 <a class="floor-link">#1</a><a href="/space/1" class="author-name">user-1</a>
                 <article class="post-content"><p>reply 1</p></article>
               </li>`
            : Array.from(
                { length: 5 },
                (_, index) => `
                  <li data-comment-id="${30000 + index}" class="content-item">
                    <a href="/space/${index + 1}" class="author-name">user-${index + 1}</a>
                    <article class="post-content"><p>reply ${index + 1}</p></article>
                  </li>
                `
              ).join('')
        }
        ${page === 1 ? '<div class="nsk-pager"><a href="/post-852807-5" rel="next">5</a></div>' : ''}
      `);
      Object.defineProperty(response, 'url', { value: `https://www.nodeseek.com/post-852807-${page}` });
      return response;
    });

    const result = await getNodeSeekReplies('852807', {
      fetcher,
      order: 'newest',
      position: { kind: 'start' },
      replyCount: 45,
      limit: 10
    });

    expect(result.items.map(({ commentId }) => commentId)).toEqual([30004, 30003, 30002, 30001, 30000]);
    expect(result).toMatchObject({ currentPage: 5, completeness: 'partial' });
  });

  it('does not fill normal NodeSeek replies from following origin pages', async () => {
    const pageOnePayload = Buffer.from(
      JSON.stringify({
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
      })
    ).toString('base64');
    const pageTwoPayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 723704,
          title: 'NodeSeek topic',
          comments: [
            { poster: { name: 'reply 11' }, markdown: '回复 11' },
            { poster: { name: 'reply 12' }, markdown: '回复 12' }
          ]
        }
      })
    ).toString('base64');
    const fetcher = routeFetcher([
      ['/post-723704-2', html(`<script>${pageTwoPayload}</script>`)],
      [
        /.*/,
        html(`
        <script>${pageOnePayload}</script>
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          <a href="/post-723704-2" rel="next">2</a>
        </div>
      `)
      ]
    ]);

    const replies = await getNodeSeekReplies('723704', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30
    });

    expect(replies.items.map((item) => item.author)).toEqual(
      Array.from({ length: 10 }, (_, index) => `reply ${index + 1}`)
    );
    expect(replies.hasMore).toBe(true);
    expect(replies.nextPage).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fills NodeSeek replies from following origin pages only when requested', async () => {
    const pageOnePayload = Buffer.from(
      JSON.stringify({
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
      })
    ).toString('base64');
    const pageTwoPayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 723704,
          title: 'NodeSeek topic',
          comments: [
            { poster: { name: 'reply 11' }, markdown: '回复 11' },
            { poster: { name: 'reply 12' }, markdown: '回复 12' }
          ]
        }
      })
    ).toString('base64');
    const fetcher = routeFetcher([
      ['/post-723704-2', html(`<script>${pageTwoPayload}</script>`)],
      [
        /.*/,
        html(`
        <script>${pageOnePayload}</script>
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          <a href="/post-723704-2" rel="next">2</a>
        </div>
      `)
      ]
    ]);

    const replies = await getNodeSeekReplies('723704', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30,
      fillPages: true
    });

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
    const stalePayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 723705,
          title: 'stale embedded title',
          comments: [
            { commentId: 100, poster: { name: 'alice' }, content: '<p>stale body</p>', markdown: 'stale body' },
            {
              commentId: 101,
              poster: { name: 'bob', isMe: true },
              content: '<p>stale reply</p>',
              markdown: 'editable reply markdown'
            }
          ]
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

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
    const fetcher = vi.fn(async () =>
      html(`
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
                 <p>终端之外的说明</p>
                 <table><tbody><tr><td>套餐</td><td>Lite</td></tr></tbody></table>
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
    `)
    );

    const topic = await getNodeSeekTopic('812712', { fetcher });
    const compiled = requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
      polls: topic.polls,
      role: 'opening',
      source: 'nodeseek',
      topicId: topic.id
    });
    const report = compiled.rows.find((row) => row.type === 'terminalReportHeader');
    const terminalRows = compiled.rows.filter((row) =>
      row.ancestorFrames.some((frame) => frame.kind === 'terminalTab')
    );
    const terminalCodeRows = terminalRows.filter((row) => row.type === 'codeBlock');

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
    expect(topic.contentHtml).toMatch(
      /硬件质量体检报告<\/span><br\s*\/?><span style="color: #00ff00; background-color: #000087">KVM&nbsp;虚拟机/
    );
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
    expect(report?.tabs.map((tab) => tab.title)).toEqual(['💻基本信息', '🎬IP质量', '🌐网络质量', '📍回程路由']);
    expect(
      new Set(
        terminalRows.flatMap((row) =>
          row.ancestorFrames.flatMap((frame) => (frame.kind === 'terminalTab' ? [frame.tabId] : []))
        )
      )
    ).toEqual(new Set(report?.tabs.map((tab) => tab.id)));
    expect(terminalCodeRows.map((row) => row.text).join('\n')).toContain('KVM 虚拟机');
    expect(terminalCodeRows.map((row) => row.text).join('\n')).toContain('IP质量检测完成');
    expect(terminalCodeRows.every((row) => row.variant === 'terminal')).toBe(true);
    expect(terminalRows.find((row) => row.type === 'richText' && row.html.includes('终端之外的说明'))).toBeTruthy();
    expect(terminalRows.find((row) => row.type === 'table' && row.html.includes('Lite'))).toBeTruthy();
    expect(
      terminalCodeRows.some((row) =>
        row.runs.some((run) => run.style?.color === '#00ff00' && run.style.backgroundColor === '#000087')
      )
    ).toBe(true);
    expect(
      terminalRows.some((row) => 'html' in row && row.html.includes('https://i.111666.best/image/network.webp'))
    ).toBe(true);
    expect(compiled.rows.every((row) => !('html' in row) || !row.html.includes('<forum-terminal-report'))).toBe(true);
    expect(
      compiled.rows.some(
        (row) =>
          'html' in row &&
          row.html.includes('HardwareQuality') &&
          row.ancestorFrames.every((frame) => frame.kind !== 'terminalTab')
      )
    ).toBe(true);
  });

  it('cleans NodeSeek ansi code reports without showing source markup', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

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

  it('preserves NodeSeek plain code reports for typed code rendering', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getNodeSeekTopic('814058', { fetcher });

    expect(topic.contentHtml).toContain('买不起溢价的特价机');
    expect(topic.contentHtml).toContain('<pre><code>');
    expect(topic.contentHtml).toContain('IP质量体检报告(Lite)');
    expect(topic.contentHtml).toContain('A Bench Script By spiritlhl');
    expect(topic.contentHtml).not.toContain('forum-terminal-code');
  });

  it('keeps embedded NodeSeek replies when only the topic body is rendered', async () => {
    const embeddedPayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 723707,
          title: 'embedded title',
          comments: [
            { commentId: 100, poster: { name: 'alice' }, content: '<p>embedded body</p>', markdown: 'embedded body' },
            {
              commentId: 101,
              poster: { name: 'bob' },
              content: '<p>embedded reply</p>',
              markdown: 'embedded reply markdown'
            }
          ]
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      html(`
      <script>${embeddedPayload}</script>
      <a class="post-title" href="/post-723707-1">Rendered topic body</a>
      <div id="0" data-comment-id="100" class="content-item">
        <div class="author-info"><a href="/space/1" class="author-name">alice</a></div>
        <time datetime="2026-05-22T15:55:11.000Z"></time>
        <article class="post-content"><p>fresh rendered body</p></article>
      </div>
    `)
    );

    const topic = await getNodeSeekTopic('723707', { fetcher });
    const replies = await getNodeSeekReplies('723707', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30
    });

    expect(topic.contentHtml).toContain('fresh rendered body');
    expect(topic.replies.map((item) => item.author)).toEqual(['bob']);
    expect(replies.items.map((item) => item.author)).toEqual(['bob']);
  });

  it('prefers rendered NodeSeek replies over stale embedded postData when refreshing replies', async () => {
    const stalePayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 723706,
          title: 'NodeSeek topic',
          comments: [
            { commentId: 100, poster: { name: 'alice' }, markdown: '正文' },
            { commentId: 101, poster: { name: 'old reply' }, markdown: '旧回复' }
          ]
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const replies = await getNodeSeekReplies('723706', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30
    });

    expect(replies.items.map((item) => item.author)).toEqual(['new reply']);
    expect(replies.items[0]).toMatchObject({
      commentId: 102,
      contentHtml: expect.stringContaining('新回复')
    });
    expect(replies.items[0]).not.toHaveProperty('contentMarkdown');
  });

  it('keeps NodeSeek edit metadata when refreshing rendered replies', async () => {
    const payload = Buffer.from(
      JSON.stringify({
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
      })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const replies = await getNodeSeekReplies('806638', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30
    });

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

  it('preserves explicit zero statistics for a new NodeSeek user', async () => {
    const fetcher = routeFetcher([
      [
        '/api/account/getInfo/7',
        json({
          success: true,
          detail: { member_id: 7, member_name: 'newbie', nPost: 0, nComment: 0 }
        })
      ],
      ['/api/content/list-discussions', json({ discussions: [] })],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const profile = await getNodeSeekUserProfile('7', { cursorType: 'topics', fetcher });

    expect(profile).toMatchObject({ topicCount: 0, replyCount: 0, postCount: 0 });
  });

  it('stops NodeSeek user topics when the known total fits on the current page', async () => {
    const fetcher = routeFetcher([
      [
        '/api/account/getInfo/7',
        json({
          success: true,
          detail: { member_id: 7, member_name: 'newbie', nPost: 1, nComment: 0 }
        })
      ],
      ['/api/content/list-discussions', json({ discussions: [{ post_id: 101, title: 'Only topic' }] })]
    ]);

    const profile = await getNodeSeekUserProfile('7', { cursorType: 'topics', fetcher });

    expect(profile).toMatchObject({
      hasMoreTopics: false,
      nextTopicsCursor: null
    });
  });

  it('stops NodeSeek user replies when the known total fits on the current page', async () => {
    const fetcher = routeFetcher([
      [
        '/api/account/getInfo/7',
        json({
          success: true,
          detail: { member_id: 7, member_name: 'newbie', nPost: 0, nComment: 1 }
        })
      ],
      ['/api/content/list-comments', json({ comments: [{ post_id: 101, title: 'Only reply topic', floor_id: 1 }] })]
    ]);

    const profile = await getNodeSeekUserProfile('7', { cursorType: 'replies', fetcher });

    expect(profile).toMatchObject({
      hasMoreReplies: false,
      nextRepliesCursor: null
    });
  });

  it('continues and then stops NodeSeek user topics from the known total', async () => {
    const fetcher = routeFetcher([
      [
        '/api/account/getInfo/7',
        json({
          success: true,
          detail: { member_id: 7, member_name: 'member', nPost: 16, nComment: 0 }
        })
      ],
      [
        '/api/content/list-discussions',
        (input) => {
          const page = Number(new URL(input).searchParams.get('page'));
          const length = page === 1 ? 15 : 1;
          return json({
            discussions: Array.from({ length }, (_, index) => ({
              post_id: (page - 1) * 15 + index + 1,
              title: `Topic ${(page - 1) * 15 + index + 1}`
            }))
          });
        }
      ]
    ]);

    const first = await getNodeSeekUserProfile('7', { cursorType: 'topics', fetcher });
    const second = await getNodeSeekUserProfile('7', { cursor: '2', cursorType: 'topics', fetcher });

    expect(first).toMatchObject({ hasMoreTopics: true, nextTopicsCursor: '2' });
    expect(second).toMatchObject({ hasMoreTopics: false, nextTopicsCursor: null });
  });

  it('continues and then stops NodeSeek user replies from the known total', async () => {
    const fetcher = routeFetcher([
      [
        '/api/account/getInfo/7',
        json({
          success: true,
          detail: { member_id: 7, member_name: 'member', nPost: 0, nComment: 16 }
        })
      ],
      [
        '/api/content/list-comments',
        (input) => {
          const page = Number(new URL(input).searchParams.get('page'));
          const length = page === 1 ? 15 : 1;
          return json({
            comments: Array.from({ length }, (_, index) => ({
              post_id: (page - 1) * 15 + index + 1,
              title: `Reply topic ${(page - 1) * 15 + index + 1}`,
              floor_id: index + 1
            }))
          });
        }
      ]
    ]);

    const first = await getNodeSeekUserProfile('7', { cursorType: 'replies', fetcher });
    const second = await getNodeSeekUserProfile('7', { cursor: '2', cursorType: 'replies', fetcher });

    expect(first).toMatchObject({ hasMoreReplies: true, nextRepliesCursor: '2' });
    expect(second).toMatchObject({ hasMoreReplies: false, nextRepliesCursor: null });
  });

  it.each([
    [14, false, null],
    [15, true, '2']
  ])(
    'falls back to the raw NodeSeek topic page size when the total is absent: %i rows',
    async (length, hasMore, cursor) => {
      const fetcher = routeFetcher([
        ['/api/account/getInfo/7', json({ success: true, detail: { member_id: 7, member_name: 'member' } })],
        [
          '/api/content/list-discussions',
          json({
            discussions: Array.from({ length }, (_, index) => ({ post_id: index + 1, title: `Topic ${index + 1}` }))
          })
        ]
      ]);

      const profile = await getNodeSeekUserProfile('7', { cursorType: 'topics', fetcher });

      expect(profile).toMatchObject({ hasMoreTopics: hasMore, nextTopicsCursor: cursor });
    }
  );

  it.each([
    [14, false, null],
    [15, true, '2']
  ])(
    'falls back to the raw NodeSeek reply page size when the total is absent: %i rows',
    async (length, hasMore, cursor) => {
      const fetcher = routeFetcher([
        ['/api/account/getInfo/7', json({ success: true, detail: { member_id: 7, member_name: 'member' } })],
        [
          '/api/content/list-comments',
          json({
            comments: Array.from({ length }, (_, index) => ({
              post_id: index + 1,
              title: `Reply topic ${index + 1}`,
              floor_id: index + 1
            }))
          })
        ]
      ]);

      const profile = await getNodeSeekUserProfile('7', { cursorType: 'replies', fetcher });

      expect(profile).toMatchObject({ hasMoreReplies: hasMore, nextRepliesCursor: cursor });
    }
  );

  it('does not continue from full NodeSeek user pages with no parseable rows', async () => {
    const profileData = json({ success: true, detail: { member_id: 7, member_name: 'member' } });
    const topicsFetcher = routeFetcher([
      ['/api/account/getInfo/7', profileData],
      ['/api/content/list-discussions', json({ discussions: Array.from({ length: 15 }, () => ({})) })]
    ]);
    const repliesFetcher = routeFetcher([
      ['/api/account/getInfo/7', profileData],
      ['/api/content/list-comments', json({ comments: Array.from({ length: 15 }, () => ({})) })]
    ]);

    const topics = await getNodeSeekUserProfile('7', { cursorType: 'topics', fetcher: topicsFetcher });
    const replies = await getNodeSeekUserProfile('7', { cursorType: 'replies', fetcher: repliesFetcher });

    expect(topics).toMatchObject({ topics: [], hasMoreTopics: false, nextTopicsCursor: null });
    expect(replies).toMatchObject({ replies: [], hasMoreReplies: false, nextRepliesCursor: null });
  });

  it('resolves the exact NodeSeek username from the complete candidate list', async () => {
    const signal = new AbortController().signal;
    const memberList = [
      ...Array.from({ length: 40 }, (_, index) => ({
        member_id: index + 1,
        member_name: `xy-${index}`
      })),
      { member_id: 8052, member_name: 'xy' }
    ];
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => json({ success: true, memberList }));

    const user = await resolveNodeSeekUser('xy', {
      authenticated: true,
      fetcher,
      nodeSeekUserAgent: 'NodeSeek WebView UA',
      signal
    });

    expect(user).toEqual({
      source: 'nodeseek',
      id: '8052',
      username: 'xy',
      displayName: 'xy',
      url: 'https://www.nodeseek.com/space/8052'
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.nodeseek.com/api/account/find/xy',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ 'User-Agent': 'NodeSeek WebView UA' })
      })
    );
    expect(browserFetchIntentFromInit(fetcher.mock.calls[0]?.[1])).toEqual({ owner: 'user', priority: 'foreground' });
  });

  it('rejects a known logged-out username resolution before transport', async () => {
    const fetcher = vi.fn();

    await expect(
      resolveNodeSeekUser('alice', {
        authenticated: false,
        fetcher
      })
    ).rejects.toMatchObject({
      source: 'nodeseek',
      loginRequired: true
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts one unique case-insensitive NodeSeek username match', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) =>
      json({
        success: true,
        memberList: [
          { member_id: 7, member_name: 'ALIce' },
          { member_id: 8, member_name: 'alice-other' }
        ]
      })
    );

    await expect(
      resolveNodeSeekUser('  Alice  ', {
        authenticated: true,
        fetcher
      })
    ).resolves.toMatchObject({
      id: '7',
      username: 'ALIce',
      url: 'https://www.nodeseek.com/space/7'
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://www.nodeseek.com/api/account/find/Alice');
  });

  it('prefers a strict NodeSeek username match over case-insensitive alternatives', async () => {
    const fetcher = vi.fn(async () =>
      json({
        success: true,
        memberList: [
          { member_id: 7, member_name: 'ALICE' },
          { member_id: 8, member_name: 'Alice' }
        ]
      })
    );

    await expect(
      resolveNodeSeekUser('Alice', {
        authenticated: true,
        fetcher
      })
    ).resolves.toMatchObject({ id: '8', username: 'Alice' });
  });

  it.each([
    {
      label: 'ambiguous case-insensitive',
      memberList: [
        { member_id: 7, member_name: 'ALICE' },
        { member_id: 8, member_name: 'alice' }
      ]
    },
    {
      label: 'conflicting strict',
      memberList: [
        { member_id: 7, member_name: 'Alice' },
        { member_id: 8, member_name: 'Alice' }
      ]
    }
  ])('rejects $label NodeSeek username matches', async ({ memberList }) => {
    const fetcher = vi.fn(async () =>
      json({
        success: true,
        memberList
      })
    );

    await expect(
      resolveNodeSeekUser('Alice', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名解析失败');
  });

  it('encodes a Unicode NodeSeek username in the resolver path', async () => {
    const fetcher = vi.fn(async (_input: string) =>
      json({
        success: true,
        memberList: [{ member_id: 1414, member_name: '男朋友' }]
      })
    );

    await expect(
      resolveNodeSeekUser('男朋友', {
        authenticated: true,
        fetcher
      })
    ).resolves.toMatchObject({ id: '1414', username: '男朋友' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://www.nodeseek.com/api/account/find/${encodeURIComponent('男朋友')}`
    );
  });

  it('rejects a non-numeric NodeSeek profile id before transport', async () => {
    const fetcher = vi.fn();

    await expect(getNodeSeekUserProfile('alice', { fetcher })).rejects.toThrow('数字用户 ID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a NodeSeek profile response for a different canonical UID', async () => {
    const fetcher = vi.fn(async () =>
      json({
        success: true,
        detail: { member_id: 8, member_name: 'alice' }
      })
    );

    await expect(
      getNodeSeekUserProfile('7', {
        cursorType: 'topics',
        fetcher
      })
    ).rejects.toThrow('身份不匹配');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsuccessful NodeSeek username response even if it contains candidates', async () => {
    const fetcher = vi.fn(async () =>
      json({
        success: false,
        memberList: [{ member_id: 7, member_name: 'alice' }]
      })
    );

    await expect(
      resolveNodeSeekUser('alice', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名解析失败');
  });

  it('surfaces NodeSeek username lookup rate limiting without selecting a fallback user', async () => {
    const fetcher = vi.fn(async () => new Response('rate limited', { status: 429 }));

    await expect(
      resolveNodeSeekUser('alice', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('HTTP 429');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no exact match', { success: true, memberList: [{ member_id: 7, member_name: 'alice-other' }] }],
    ['invalid member id', { success: true, memberList: [{ member_id: 'not-numeric', member_name: 'alice' }] }],
    ['invalid candidate payload', { success: true, memberList: {} }]
  ])('rejects %s when resolving a NodeSeek username', async (_label, payload) => {
    const fetcher = vi.fn(async () => json(payload));

    await expect(
      resolveNodeSeekUser('alice', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名解析失败');
  });

  it('cancels NodeSeek username resolution through its AbortSignal', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true }
          );
        })
    );

    const pending = resolveNodeSeekUser('alice', {
      authenticated: true,
      fetcher,
      signal: controller.signal
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(pending).rejects.toThrow('请求已取消');
  });

  it('rejects an empty NodeSeek username before transport', async () => {
    const fetcher = vi.fn();

    await expect(
      resolveNodeSeekUser('   ', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名不能为空');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses NodeSeek updatedDate as last reply time when embedded topic comments are empty', async () => {
    const emptyTopicPayload = Buffer.from(
      JSON.stringify({
        postData: {
          postId: 101,
          title: 'NodeSeek topic',
          op: { name: 'alice' },
          createdDate: '2026-05-20T00:00:00.000Z',
          updatedDate: '2026-05-20T01:00:00.000Z',
          comments: []
        }
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${emptyTopicPayload}</script>`));

    const topic = await getTopic({ source: 'nodeseek', id: '101', fetcher });

    expect(topic.createdAt).toBe('2026-05-20T00:00:00.000Z');
    expect(topic.lastReplyAt).toBe('2026-05-20T01:00:00.000Z');
  });

  it('searches NodeSeek through its site search instead of filtering the latest Android feed', async () => {
    const fetcher = routeFetcher([
      [
        (input) => input.includes('/search?') && input.includes('q=GPT'),
        html(`
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
        `)
      ],
      [/.*/, html('<ul class="post-list"><li><a href="/post-101-1">latest only</a></li></ul>')]
    ]);

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekAuthenticated: true });

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
    const fetcher = routeFetcher([
      [
        (input) => input.includes('/search?') && input.includes('q=GPT'),
        html(`
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
        `)
      ],
      [(input) => input.includes('/search?') && input.includes('keyword=GPT'), html('<div>搜索词太短😭</div>')],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekAuthenticated: true });

    expect(search.items.map((item) => item.id)).toEqual(['606']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?q=GPT');
    expect(calls).not.toContain('keyword=GPT');
  });

  it('keeps NodeSeek site search enabled for short AI terms', async () => {
    const fetcher = routeFetcher([
      [
        (input) => input.includes('/search?') && input.includes('q=AI'),
        html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-808-1">AI current search result</a></div>
              <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
            </li>
          </ul>
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({ source: 'nodeseek', query: 'AI', fetcher, nodeSeekAuthenticated: true });

    expect(search.items.map((item) => item.id)).toEqual(['808']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?q=AI');
  });

  it('keeps official NodeSeek search results even when they do not contain the full query text', async () => {
    const fetcher = routeFetcher([
      [
        (input) => input.includes('/search?') && input.includes('q=%E5%AE%89%E5%8D%93%E6%89%8B%E6%9C%BA%E5%85%8D'),
        html(`
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
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({
      source: 'nodeseek',
      query: '安卓手机免',
      fetcher,
      nodeSeekAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['701', '702']);
  });

  it('refuses anonymous NodeSeek adapter search without transport', async () => {
    const fetcher = vi.fn();

    await expect(searchTopics({ source: 'nodeseek', query: 'codex', fetcher })).rejects.toMatchObject({
      kind: 'login-required',
      source: 'nodeseek'
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps empty NodeSeek site search results empty instead of filtering the latest feed', async () => {
    const latestPayload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 303,
            titleText: 'xyz latest incidental match',
            titleLink: '/post-303-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-21T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = routeFetcher([
      [(input) => input.includes('/search?') && input.includes('q=xyz'), html('<ul class="post-list"></ul>')],
      [/.*/, html(`<script>${latestPayload}</script>`)]
    ]);

    const search = await searchTopics({ source: 'nodeseek', query: 'xyz', fetcher, nodeSeekAuthenticated: true });

    expect(search.items).toEqual([]);
    const callUrls = fetcher.mock.calls.map((call) => call[0]);
    expect(callUrls).toContain('https://www.nodeseek.com/search?q=xyz');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
  });

  it('keeps empty NodeSeek search pages empty when shell links and embedded topics remain', async () => {
    const stalePayload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 305,
            titleText: 'stale shell result',
            titleLink: '/post-305-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-21T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      html(`
      <script>${stalePayload}</script>
      <form action="/search"><input name="q" value="missing" /></form>
      <ul class="post-list"></ul>
      <footer>
        <a href="/post-301-1">shell link one</a>
        <a href="/post-302-1">shell link two</a>
        <a href="/post-303-1">shell link three</a>
      </footer>
    `)
    );

    const search = await searchTopics({ source: 'nodeseek', query: 'missing', fetcher, nodeSeekAuthenticated: true });

    expect(search.items).toEqual([]);
    expect(sourceDiagnosticSummary(search)).toMatchObject({
      parserVariant: 'rendered-search',
      candidateCount: 0,
      validCount: 0,
      droppedCount: 0,
      isExpectedEmpty: true,
      isParseEmpty: false
    });
  });

  it('surfaces incomplete NodeSeek search pages as a retryable failure', async () => {
    const fetcher = routeFetcher([
      [
        (input) => input.includes('/search?') && input.includes('q=retry'),
        html('<main><form action="/search"><input name="q" value="retry" /></form></main>')
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    await expect(
      searchTopics({ source: 'nodeseek', query: 'retry', fetcher, nodeSeekAuthenticated: true })
    ).rejects.toThrow('NodeSeek 搜索页结果没有加载完成，请重试');
  });

  it('surfaces NodeSeek site search failures instead of filtering the latest feed', async () => {
    const latestPayload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 304,
            titleText: 'failure latest incidental match',
            titleLink: '/post-304-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-21T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=failure')) {
        throw new Error('NodeSeek search failed');
      }
      return html(`<script>${latestPayload}</script>`);
    });

    await expect(
      searchTopics({ source: 'nodeseek', query: 'failure', fetcher, nodeSeekAuthenticated: true })
    ).rejects.toThrow('NodeSeek search failed');
    const callUrls = fetcher.mock.calls.map((call) => call[0]);
    expect(callUrls).toContain('https://www.nodeseek.com/search?q=failure');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
  });

  it('does not request another NodeSeek search page when no next link exists', async () => {
    const fetcher = routeFetcher([
      [
        (input) => input.includes('/search?') && input.includes('page=2'),
        html('<ul class="post-list"><li><a href="/post-909-1">GPT unrelated second page</a></li></ul>')
      ],
      [
        (input) => input.includes('/search?') && input.includes('q=GPT'),
        html(`
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
        `)
      ],
      [
        /.*/,
        (input) => {
          throw new Error(`unexpected ${input}`);
        }
      ]
    ]);

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekAuthenticated: true });

    expect(search.items.map((item) => item.id)).toEqual(['202']);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://www.nodeseek.com/search?q=GPT');
    expect(calls).not.toContain('page=2');
  });

  it('reports and reads the next NodeSeek search page', async () => {
    const fetcher = routeFetcher([
      [
        (input) => input.includes('/search?') && input.includes('page=2'),
        html(`
          <ul class="post-list">
            <li class="post-list-item">
              <div class="post-title"><a href="/post-203-1">GPT second page result</a></div>
              <div class="post-info"><time datetime="2026-05-20T00:00:00.000Z"></time></div>
            </li>
          </ul>
        `)
      ],
      [
        /.*/,
        html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-202-1">GPT first page result</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
        <a rel="next" href="/search?q=GPT&page=2">Next</a>
      `)
      ]
    ]);

    const first = await searchTopics({
      source: 'nodeseek',
      query: 'GPT',
      limit: 1,
      fetcher,
      nodeSeekAuthenticated: true
    });
    const second = await searchTopics({
      source: 'nodeseek',
      query: 'GPT',
      page: first.nextPage ?? 2,
      limit: 1,
      fetcher,
      nodeSeekAuthenticated: true
    });

    expect(first.items.map((item) => item.id)).toEqual(['202']);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['203']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain(
      'https://www.nodeseek.com/search?q=GPT&page=2'
    );
  });

  it('prefers rendered NodeSeek search rows over stale embedded shell topics', async () => {
    const staleEmbeddedPayload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 201,
            titleText: 'stale search page one',
            titleLink: '/post-201-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T02:00:00.000Z' }
          },
          {
            postId: 200,
            titleText: 'stale search page one older',
            titleLink: '/post-200-1',
            op: { name: 'bob' },
            time: { createdDate: '2026-05-20T01:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const search = await searchTopics({
      source: 'nodeseek',
      query: 'GPT',
      page: 2,
      limit: 2,
      fetcher,
      nodeSeekAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['199', '198']);
  });

  it('lets the native jar attach NodeSeek cookies when reading the Android feed', async () => {
    const fetcher = vi.fn(async () => html(`<script>${nodeSeekPayload}</script>`));

    await getFeed({
      source: 'nodeseek',
      fetcher,
      nodeSeekUserAgent: 'NodeSeek WebView UA'
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://www.nodeseek.com/?sortBy=postTime',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'NodeSeek WebView UA'
        })
      })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit?][])[0]?.[1]?.headers).not.toHaveProperty('cookie');
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

  it('marks visible NodeSeek reads ahead of background account refresh', async () => {
    const accountPayload = Buffer.from(
      JSON.stringify({
        user: { uid: 42, username: 'alice' }
      })
    ).toString('base64');
    const visibleFetcher = vi.fn(async () => html(`<script>${nodeSeekPayload}</script>`));
    const accountFetcher = vi.fn(async () => html(`<script>${accountPayload}</script>`));

    await getFeed({ source: 'nodeseek', fetcher: visibleFetcher });
    await getCategories({ source: 'nodeseek', fetcher: visibleFetcher });
    await getNodeSeekCurrentUserProfile({ fetcher: accountFetcher });

    const visibleIntents = (visibleFetcher.mock.calls as unknown as [string, RequestInit?][]).map(([, init]) =>
      browserFetchIntentFromInit(init)
    );
    const accountIntent = browserFetchIntentFromInit(
      (accountFetcher.mock.calls as unknown as [string, RequestInit?][])[0]?.[1]
    );

    expect(visibleIntents).toEqual([
      { owner: 'feed', priority: 'foreground' },
      { owner: 'feed', priority: 'foreground' }
    ]);
    expect(accountIntent).toEqual({ owner: 'account', priority: 'background' });
  });

  it('reports NodeSeek Cloudflare HTML as a verification requirement', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
        })
    );

    await expect(getFeed({ source: 'nodeseek', fetcher })).rejects.toMatchObject({
      source: 'nodeseek',
      reason: 'cloudflare',
      message: 'NodeSeek 需要完成 Cloudflare 验证'
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/?sortBy=postTime', expect.any(Object));
  });

  it('reports Chinese NodeSeek Cloudflare HTML as a verification requirement', async () => {
    const fetcher = vi.fn(async () =>
      html('<html><title>请稍候…</title><body>正在进行安全验证。本网站使用安全服务防护恶意自动程序。</body></html>')
    );

    await expect(getFeed({ source: 'nodeseek', fetcher })).rejects.toMatchObject({
      source: 'nodeseek',
      reason: 'cloudflare',
      message: 'NodeSeek 需要完成 Cloudflare 验证'
    });
  });

  it('reads rendered NodeSeek WebView rows without picking footer post links', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

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
    const payload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 201,
            titleText: 'Newer post first',
            titleLink: '/post-201-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T02:00:00.000Z' },
            updatedDate: '2026-05-20T02:00:00.000Z'
          },
          {
            postId: 200,
            titleText: 'Older post with newer reply',
            titleLink: '/post-200-1',
            op: { name: 'bob' },
            time: { createdDate: '2026-05-20T01:00:00.000Z' },
            updatedDate: '2026-05-20T03:00:00.000Z'
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async () => html(`<script>${payload}</script>`));

    const feed = await getFeed({ source: 'nodeseek', limit: 2, fetcher });

    expect(feed.items.map((item) => item.id)).toEqual(['201', '200']);
  });

  it('prefers rendered NodeSeek list rows over stale embedded shell topics', async () => {
    const staleEmbeddedPayload = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 201,
            titleText: 'stale page one',
            titleLink: '/post-201-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T02:00:00.000Z' }
          },
          {
            postId: 200,
            titleText: 'stale page one older',
            titleLink: '/post-200-1',
            op: { name: 'bob' },
            time: { createdDate: '2026-05-20T01:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const feed = await getFeed({ source: 'nodeseek', page: 2, limit: 2, fetcher });

    expect(feed.items.map((item) => item.id)).toEqual(['199', '198']);
  });

  it('reads rendered NodeSeek category links when embedded category data is absent', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const categories = await getCategories({ source: 'nodeseek', fetcher });

    expect(categories.items).toEqual([
      { source: 'nodeseek', id: 'daily', name: '日常' },
      { source: 'nodeseek', id: 'tech', name: '技术' }
    ]);
  });

  it('reads rendered NodeSeek topic pages when embedded postData is absent', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743001', fetcher });

    expect(topic).toMatchObject({
      source: 'nodeseek',
      id: '743001',
      title: 'cloudflare果然挂了',
      author: 'alice',
      categoryId: 'daily',
      category: '日常',
      createdAt: '2026-05-22T16:00:00.000Z'
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
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '797740', fetcher });

    expect(topic.replies[0].contentHtml).toContain('<forum-video-sticker');
    expect(topic.replies[0].contentHtml).toContain('src="https://www.nodeseek.com/static/image/sticker/emoji/35.webm"');
    expect(topic.replies[0].contentHtml).toContain(
      'data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/35.png"'
    );
    expect(topic.replies[0].contentHtml).toContain('class="sticker"');
    expect(topic.replies[0].contentHtml).not.toContain('<video');
    expect(topic.replies[1].contentHtml).toContain('src="https://www.nodeseek.com/static/image/sticker/ac/01.png"');
    expect(topic.replies[1].contentHtml).toContain('class="sticker"');
  });

  it('reads rendered NodeSeek topic title from meta fallback', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743012', fetcher });

    expect(topic.title).toBe('NodeSeek meta title');
    expect(topic.contentHtml).toContain('meta fallback 正文');
  });

  it('reads rendered NodeSeek topic bodies from content containers inside topic rows', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743019', fetcher });

    expect(topic.title).toBe('NodeSeek content container title');
    expect(topic.contentHtml).toContain('content 容器正文');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not treat readable NodeSeek content containers as restricted because of page notices', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743021', fetcher });

    expect(topic.title).toBe('NodeSeek content container title');
    expect(topic.contentHtml).toContain('content 容器正文可正常阅读');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('shows NodeSeek restricted topic notices instead of a parse failure', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743013', fetcher });

    expect(topic.title).toBe('受限帖子');
    expect(topic.contentHtml).toContain('权限不足，需要等级 2 才能查看该主题。');
    expect(topic.accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('reads NodeSeek restricted notices wrapped in rendered topic containers', async () => {
    const fetcher = vi.fn(async () =>
      html(`
      <html>
        <head><title>NodeSeek</title></head>
        <body>
          <div class="content-item">
            <div class="notice">登录后才能查看该主题。</div>
          </div>
        </body>
      </html>
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743018', fetcher });

    expect(topic.title).toBe('受限帖子');
    expect(topic.contentHtml).toContain('登录后才能查看该主题。');
    expect(topic.accessRequirement).toMatchObject({
      type: 'login',
      label: '需登录'
    });
  });

  it('reads NodeSeek restricted notices when an empty body placeholder is present', async () => {
    const fetcher = vi.fn(async () =>
      html(`
      <html>
        <head><title>NodeSeek</title></head>
        <body>
          <div class="post-detail">
            <div class="post-content"></div>
            <div class="notice">权限不足，需要等级 3 才能查看该主题。</div>
          </div>
        </body>
      </html>
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743020', fetcher });

    expect(topic.title).toBe('受限帖子');
    expect(topic.contentHtml).toContain('权限不足，需要等级 3 才能查看该主题。');
    expect(topic.accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('does not parse non-topic NodeSeek shell pages as restricted topics', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    await expect(getTopic({ source: 'nodeseek', id: '743016', fetcher })).rejects.toThrow('NodeSeek 主题解析失败');
  });

  it('does not parse generic NodeSeek content containers as topic body', async () => {
    const fetcher = vi.fn(async () =>
      html(`
      <html>
        <head><title>NodeSeek error</title></head>
        <body>
          <div class="content">临时错误页，不是主题正文。</div>
        </body>
      </html>
    `)
    );

    await expect(getTopic({ source: 'nodeseek', id: '743017', fetcher })).rejects.toThrow('NodeSeek 主题解析失败');
  });

  it('does not mark normal NodeSeek body text as access restricted', async () => {
    const fetcher = vi.fn(async () =>
      html(`
      <main>
        <article class="post-detail">
          <h1 class="post-title">NodeSeek normal permission discussion</h1>
          <div class="post-content"><p>这里讨论等级查看和登录提示文案，但帖子本身可以正常阅读。</p></div>
        </article>
      </main>
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743014', fetcher });

    expect(topic.title).toBe('NodeSeek normal permission discussion');
    expect(topic.contentHtml).toContain('帖子本身可以正常阅读');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not mark normal NodeSeek topics as restricted because of page notices', async () => {
    const fetcher = vi.fn(async () =>
      html(`
      <main>
        <div class="notice">请登录后回复该主题。</div>
        <article class="post-detail">
          <h1 class="post-title">NodeSeek topic with login notice</h1>
          <div class="post-content"><p>正文可以正常阅读。</p></div>
        </article>
      </main>
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743015', fetcher });

    expect(topic.title).toBe('NodeSeek topic with login notice');
    expect(topic.contentHtml).toContain('正文可以正常阅读');
    expect(topic.accessRequirement).toBeUndefined();
  });

  it('does not treat rendered NodeSeek category links as topic authors', async () => {
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

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
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const topic = await getTopic({ source: 'nodeseek', id: '743001', fetcher });

    expect(topic).toMatchObject({
      title: '【求助】Claude使用Google pay绑定国内visa信用卡订阅有风险吗？',
      author: '我是ikun',
      authorAvatar: 'https://www.nodeseek.com/avatar/48872.png',
      commentId: 10232616,
      categoryId: 'daily'
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
    const fetcher = vi.fn(async () =>
      html(`
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
    `)
    );

    const replies = await getNodeSeekReplies('743003', {
      fetcher,
      order: 'oldest',
      position: { kind: 'start' },
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
      nodeSeekAuthenticated: true
    });

    expect(fetcher.mock.calls.length).toBeGreaterThan(0);
    const calls = fetcher.mock.calls as unknown as [string, unknown?][];
    const url = new URL(calls[0]?.[0] || '');
    expect(url.searchParams.get('q')).toBe('GPT');
    expect(url.searchParams.get('category')).toBe('tech');
    expect(url.searchParams.get('sortBy')).toBe('postTime');
    expect(url.searchParams.has('sort')).toBe(false);
    expect(url.searchParams.has('order')).toBe(false);
  });
});
