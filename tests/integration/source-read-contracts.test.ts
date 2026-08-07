import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { getCategories, getFeed } from '@/sources/feedRead';
import { searchTopics } from '@/sources/searchRead';
import { getReplies, getReply, getTopic } from '@/sources/sourceRead';
import { isLinuxDoCloudflareError } from '@/sources/errors';
import { browserFetchIntentFromInit, withBrowserFetchIntent } from '@/platform/network/browserFetchIntent';
import {
  createLinuxDoWebViewFallbackFetcher,
  LinuxDoHiddenBrowserFailureError
} from '@/sources/linuxdo/browserFallback';
import { getLinuxDoCurrentUserProfile, getLinuxDoUserProfile } from '@/sources/linuxdo/account';
import { searchLinuxDoSemantic, searchLinuxDoTags, searchLinuxDoUsers } from '@/sources/linuxdo/search';
import { splitDiscourseContentHtml } from '@/sources/discourse/content';
import { textContentFromHtml } from '@/domain/forum/html';
import { createNodeSeekWebViewFallbackFetcher, isNodeSeekBrowserFetchUrl } from '@/sources/nodeseek/browserFallback';
import {
  getNodeSeekCurrentUserProfile,
  getNodeSeekReplies,
  getNodeSeekTopic,
  getNodeSeekUserProfile,
  resolveNodeSeekUser
} from '@/sources/nodeseek/reader';
import { setRequestTimeoutsActive } from '@/platform/network/request';
import { sourceDiagnosticSummary } from '@/sources/diagnostics';
import { DEFAULT_SEARCH_FILTERS } from '@/domain/forum/searchFilters';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  setDiagnosticWriter,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';

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

function htmlAt(value: string, url: string) {
  const response = html(value);
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

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

function testLinuxDoAccess() {
  return { authenticated: true, userAgent: 'LinuxDo WebView UA' };
}

function testLinuxDoDiscourseAuth() {
  return { linuxdo: testLinuxDoAccess() };
}

describe('Android local sources', () => {
  afterEach(() => {
    setDiagnosticWriter(null);
  });

  it('reads NodeSeek feed, categories, topic, replies, and search without project server endpoints', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-101-2')) {
        return htmlAt(`<script>${nodeSeekReplyPagePayload}</script>`, input);
      }
      if (input.includes('/post-101-1')) {
        return html(`<script>${nodeSeekTopicPayload}</script>`);
      }
      return html(`<script>${nodeSeekPayload}</script>`);
    });

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
    const search = await searchTopics({ source: 'nodeseek', query: 'NodeSeek', fetcher });

    expect(feed.items[0]).toMatchObject({ source: 'nodeseek', id: '101', categoryId: 'tech' });
    expect(categories.items).toEqual([{ source: 'nodeseek', id: 'tech', name: '技术' }]);
    expect(topic.contentHtml).toContain('<strong>内容</strong>');
    expect(topic.lastReplyAt).toBe('2026-05-20T00:01:00.000Z');
    expect(replies.items[0]).toMatchObject({ author: 'bob', floor: 1 });
    expect(search.items[0].id).toBe('101');
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(/\/api\/|10\.0\.2\.2|127\.0\.0\.1:3000/);
  });

  it('[REG-TOPIC-062] reads a distant NodeSeek floor from one exact page window', async () => {
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

  it('[REG-NOTIFY-047] keeps commentId authoritative when the NodeSeek floor is missing or wrong', async () => {
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

  it('[REG-TOPIC-067] keeps the authoritative NodeSeek count when rendered rows are also present', async () => {
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

  it('[REG-TOPIC-067] derives adjacent cursors from complete compact NodeSeek windows without a pager', async () => {
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

  it('reads linux.do author trust levels from list and topic post data', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/latest.json')) {
        return json({
          topic_list: {
            topics: [
              {
                id: 42,
                title: 'linux.do list topic',
                slug: 'linux-list-topic',
                created_at: '2026-05-20T00:00:00.000Z',
                posts_count: 1,
                posters: [{ user_id: 7, description: 'Original Poster' }],
                notification_level: 1
              }
            ]
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
              {
                id: 100,
                post_number: 1,
                username: 'alice',
                trust_level: 4,
                cooked: '<p>body</p>',
                created_at: '2026-05-20T00:00:00.000Z'
              },
              {
                id: 101,
                post_number: 2,
                username: 'bob',
                trust_level: 2,
                cooked: '<p>reply</p>',
                created_at: '2026-05-20T00:01:00.000Z'
              }
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

  it('reads V2EX Pro labels from the topic API and origin reply badges', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 810,
            title: 'V2EX Pro topic',
            url: 'https://www.v2ex.com/t/810',
            created: 1780000000,
            replies: 1,
            member: { username: 'neo', pro: 1 },
            content_rendered: '<p>detail body</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          {
            id: 7001,
            member: { username: 'alice', pro: true },
            content_rendered: '<p>first reply</p>',
            created: 1780000100
          }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/810') {
        return html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":1}
            ]}
          </script>
          <div id="r_7001" class="cell">
            <img class="avatar" src="//cdn.v2ex.com/alice.png" />
            <span class="no">1</span>
            <strong><a href="/member/alice" class="dark">alice</a></strong>
            <div class="badges"><div class="badge pro">PRO</div></div>
            <div class="reply_content">first reply</div>
          </div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '810', fetcher });

    expect(topic.authorLevelLabel).toBe('Pro');
    expect(topic.replies[0].authorLevelLabel).toBe('Pro');
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=810&page=1'
    );
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

  it('[REG-WRITE-007] hides NodeSeek vote counts until the current user has voted', async () => {
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

  it('[REG-WRITE-007] keeps failed NodeSeek vote markers and reports a partial topic', async () => {
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

  it('[REG-WRITE-010] removes an adjacent NodeSeek poll marker leak without splitting the surrounding paragraph', async () => {
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
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-723704-2')) {
        return htmlAt(`<script>${pageTwoPayload}</script>`, input);
      }
      return html(`
        <script>${pageOnePayload}</script>
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          <a href="/post-723704-2" rel="next">2</a>
        </div>
      `);
    });

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

  it('[REG-TOPIC-036] continues rendered NodeSeek floors from the page offset when floor markers are missing', async () => {
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

  it('[REG-TOPIC-060] keeps the identified first reply on rendered NodeSeek later pages', async () => {
    const fetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-852804-3">NodeSeek topic</a>
      <li id="21" data-comment-id="11640077" class="content-item">
        <a class="floor-link">#21</a>
        <a href="/space/1" class="author-name">first reply</a>
        <article class="post-content"><p>第 21 楼</p></article>
      </li>
      <li id="22" data-comment-id="11640171" class="content-item">
        <a class="floor-link">#22</a>
        <a href="/space/2" class="author-name">second reply</a>
        <article class="post-content"><p>第 22 楼</p></article>
      </li>
    `)
    );

    const replies = await getNodeSeekReplies('852804', {
      fetcher,
      order: 'oldest',
      position: { kind: 'cursor', page: 3, offset: null },
      limit: 10
    });

    expect(replies.items.map((item) => [item.floor, item.commentId])).toEqual([
      [21, 11640077],
      [22, 11640171]
    ]);
  });

  it('[REG-TOPIC-067] reads the real NodeSeek tail window before its adjacent older window', async () => {
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

  it('[REG-TOPIC-070] excludes out-of-page featured copies from ordered NodeSeek reply windows', async () => {
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

  it('[REG-TOPIC-070] rejects an ordinary NodeSeek outlier after the requested page is fully confirmed', async () => {
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

  it.each(['oldest', 'newest'] as const)(
    '[REG-TOPIC-068] follows both NodeSeek edges from a centered %s window',
    async (order) => {
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
    }
  );

  it.each([
    {
      name: 'resolved to a different page',
      resolvedPage: 3,
      floors: Array.from({ length: 10 }, (_, index) => index + 21),
      message: '未确认请求的回复页'
    },
    {
      name: 'missing a middle floor',
      resolvedPage: 4,
      floors: [31, 32, 33, 34, 35, 37, 38, 39, 40],
      message: '回复窗口不完整'
    }
  ])('[REG-TOPIC-068] classifies a NodeSeek adjacent cursor $name', async ({ resolvedPage, floors, message }) => {
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
    expect((error as Error).message).toContain(message);
    expect((error as { reason?: unknown }).reason).toBeUndefined();
  });

  it('[REG-TOPIC-068] accepts an origin-confirmed adjacent page even when the previous reply count is stale', async () => {
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

  it('[REG-TOPIC-068] follows the real full-page boundary shape without refetching a stale count first', async () => {
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

  it('[REG-TOPIC-068] does not fabricate a NodeSeek reply total or fetch the tail just to count it', async () => {
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

  it('[REG-TOPIC-068] discovers the confirmed NodeSeek newest tail even when the supplied reply count is stale', async () => {
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

  it('[REG-TOPIC-068] does not invent a reply cursor from an inline same-topic quote link', async () => {
    const replies = await getNodeSeekReplies('861053', {
      fetcher: vi.fn(async () =>
        htmlAt(
          `
            <a class="post-title" href="/post-861053-1">NodeSeek topic</a>
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

  it('[REG-TOPIC-068] does not treat an unconfirmed adjacent page as a stale reply count', async () => {
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

  it('[REG-TOPIC-067][REG-TOPIC-068] accepts a self-proving NodeSeek tail when the supplied count is stale', async () => {
    const requestedPages: number[] = [];
    const tail = await getNodeSeekReplies('852806', {
      fetcher: vi.fn(async (input: string) => {
        const page = Number(input.match(/post-852806-(\d+)/)?.[1] || 1);
        requestedPages.push(page);
        const floors = page === 1 ? Array.from({ length: 10 }, (_, index) => index + 1) : [41, 42, 43, 44];
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

    expect(requestedPages).toEqual([1, 5]);
    expect(tail.items.map((reply) => reply.floor)).toEqual([44, 43, 42, 41]);
    expect(tail).toMatchObject({ currentPage: 5, hasMore: true, nextPage: 4 });
    expect(tail).not.toHaveProperty('totalCount');
  });

  it('[REG-TOPIC-067] rejects a NodeSeek tail with a missing middle floor', async () => {
    const error = await getNodeSeekReplies('852806', {
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
    }).then(
      () => null,
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('回复窗口不完整');
    expect((error as { reason?: unknown }).reason).toBeUndefined();
  });

  it('[REG-TOPIC-067][REG-TOPIC-068] follows a newer NodeSeek pager cursor before accepting the tail', async () => {
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

  it.each([
    { name: 'a different resolved page', resolvedPage: 4 },
    { name: 'only locally inferred floors', resolvedPage: 5 }
  ])('[REG-TOPIC-067] rejects a NodeSeek tail with $name', async ({ resolvedPage }) => {
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
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-723704-2')) {
        return html(`<script>${pageTwoPayload}</script>`);
      }
      return html(`
        <script>${pageOnePayload}</script>
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          <a href="/post-723704-2" rel="next">2</a>
        </div>
      `);
    });

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
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/post-723704-2')) {
        return html(`<script>${pageTwoPayload}</script>`);
      }
      return html(`
        <script>${pageOnePayload}</script>
        <div class="nsk-pager" role="navigation" aria-label="pagination">
          <a href="/post-723704-2" rel="next">2</a>
        </div>
      `);
    });

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

  it('renders NodeSeek plain code reports as terminal blocks', async () => {
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
    expect(topic.contentHtml).toContain('forum-terminal-code');
    expect(topic.contentHtml).toContain('IP质量体检报告(Lite)');
    expect(topic.contentHtml).toContain('A&nbsp;Bench&nbsp;Script&nbsp;By&nbsp;spiritlhl');
    expect(topic.contentHtml).not.toContain('<pre');
    expect(topic.contentHtml).not.toContain('<code');
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

  it('[REG-TOPIC-067][REG-TOPIC-068][REG-TOPIC-073] renders the available linux.do subset when hydration omits one stream post', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        return json({
          post_stream: {
            posts: [
              {
                id: 32,
                post_number: 32,
                username: 'reply 32',
                cooked: '<p>32</p>',
                created_at: '2026-05-20T00:32:00.000Z'
              }
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

    const replies = await getReplies({
      source: 'linuxdo',
      id: '42',
      order: 'oldest',
      position: { kind: 'cursor', page: 16, offset: 30 },
      limit: 2,
      fetcher
    });
    expect(replies.items.map((reply) => reply.floor)).toEqual([32]);
    expect(replies).toMatchObject({
      currentPage: 16,
      currentOffset: 30,
      nextPage: 17,
      nextOffset: 32,
      hasMore: true,
      totalCount: 39
    });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://linux.do/t/42.json',
      expect.stringContaining('https://linux.do/t/42/posts.json')
    ]);
  });

  it('maps linux.do Discourse polls from topic JSON', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 42,
        title: 'linux.do poll topic',
        slug: 'linux-poll-topic',
        created_at: '2026-06-03T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1001],
          posts: [
            {
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
              polls: [
                {
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
                }
              ],
              polls_votes: {
                poll: ['b2']
              }
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.polls).toEqual([
      {
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
      }
    ]);
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

  it('[REG-PERF-008] lets a queued Back cancellation win before Topic DOM parsing', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () =>
      json({
        id: 44,
        title: 'cancel before parse',
        slug: 'cancel-before-parse',
        created_at: '2026-06-03T00:00:00.000Z',
        posts_count: 1,
        post_stream: {
          stream: [1001],
          posts: [
            {
              id: 1001,
              username: 'alice',
              cooked: '<p>ordinary safe body</p>',
              created_at: '2026-06-03T00:00:00.000Z',
              post_number: 1
            }
          ]
        }
      })
    );

    const pending = getTopic({ source: 'linuxdo', id: '44', fetcher, signal: controller.signal });
    setTimeout(() => controller.abort(), 0);

    await expect(pending).rejects.toThrow('请求已取消');
  });

  it('maps linux.do Discourse polls from reply posts', async () => {
    const fetcher = vi.fn(async () =>
      json({
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
              cooked:
                '<p>回复投票前</p><div class="poll" data-poll-name="reply-poll"><p>原始回复选项</p></div><p>回复投票后</p>',
              created_at: '2026-06-03T00:01:00.000Z',
              post_number: 2,
              polls: [
                {
                  id: 89,
                  name: 'reply-poll',
                  title: '回复里的评分',
                  type: 'number',
                  status: 'open',
                  options: [
                    { id: '1', html: '1 分', votes: 2 },
                    { id: '2', html: '2 分', votes: 3 }
                  ]
                }
              ]
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '43', fetcher });

    expect(topic.replies[0].polls).toEqual([
      {
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
      }
    ]);
    expect(topic.replies[0].contentHtml).not.toContain('原始回复选项');
    expect(
      splitDiscourseContentHtml(topic.replies[0].contentHtml, topic.replies[0].polls).map((part) => part.type)
    ).toEqual(['html', 'poll', 'html']);
  });

  it('keeps linux.do tags and topic status markers from Discourse lists', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: [
            {
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
              tags: [{ name: '人工智能' }, { name: '快问快答' }]
            }
          ]
        },
        categories: [{ id: 4, name: '开发调优' }]
      })
    );

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
            posts: [
              {
                id: 19367641,
                post_number: 1,
                username: 'chancat',
                cooked: '<p>body</p>',
                created_at: '2026-06-20T11:15:45.437Z'
              }
            ]
          }
        });
      }
      return json({
        topic_list: {
          topics: [
            {
              id: 2438917,
              title: rawTitle,
              unicode_title: displayTitle,
              slug: 'topic',
              created_at: '2026-06-20T11:15:45.437Z',
              bumped_at: '2026-06-20T11:15:45.437Z',
              posts_count: 1
            }
          ]
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
            posts: [
              {
                id: 19367642,
                post_number: 1,
                username: 'chancat',
                cooked: '<p>body</p>',
                created_at: '2026-06-20T11:15:45.437Z'
              }
            ]
          }
        });
      }
      return json({
        topic_list: {
          topics: [
            {
              id: 2438918,
              title: '&#129765;完辣，ai又来抢饭碗啦，装机仔下岗',
              slug: 'topic',
              created_at: '2026-06-20T11:15:45.437Z',
              bumped_at: '2026-06-20T11:15:45.437Z',
              posts_count: 1
            }
          ]
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
    const fetcher = vi.fn(async () =>
      json({
        id: 407,
        title: 'linux.do accepted answer topic',
        slug: 'linux-accepted-answer-topic',
        created_at: '2026-06-04T00:00:00.000Z',
        posts_count: 2,
        closed: true,
        pinned: true,
        slow_mode_seconds: 120,
        tags: [{ name: '人工智能' }],
        accepted_answers: [
          {
            id: 2002,
            post_number: 2,
            username: 'bob'
          }
        ],
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
      })
    );

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
    const fetcher = vi.fn(async () =>
      json({
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
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '408', fetcher });

    expect(topic.siteExtension).toEqual({ source: 'linuxdo', boostCount: 4 });
    expect(topic.replies[0].siteExtension).toEqual({ source: 'linuxdo', boostCount: 5 });
  });

  it('requests linux.do latest feed by creation time', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: []
        },
        users: []
      })
    );

    await getFeed({ source: 'linuxdo', limit: 2, fetcher });

    expect((fetcher.mock.calls as unknown as [string][])[0]?.[0]).toBe(
      'https://linux.do/latest.json?order=created&ascending=false'
    );
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
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: [
            {
              id: 500,
              title: 'linux.do filtered topic',
              slug: 'linux-filtered-topic',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ]
        },
        users: []
      })
    );

    for (const item of cases) {
      await getFeed({ source: 'linuxdo', category: '11', feedFilter: item.filter, limit: 1, fetcher });
    }

    const urls = (fetcher.mock.calls as unknown as [string][]).map(([input]) => new URL(input));
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
          categories: [{ id: 4, name: '开发调优' }]
        });
      }
      return json({
        topic_list: {
          topics: [
            {
              id: 404,
              title: 'linux.do mapped category',
              slug: 'mapped-category',
              category_id: 4,
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ]
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
          categories: [{ id: 4, name: '开发调优' }]
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
    const fetcher = vi.fn(async () =>
      json({
        topic_list: {
          topics: [
            {
              id: 405,
              title: 'linux.do uncategorized',
              slug: 'uncategorized',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ]
        },
        users: []
      })
    );

    const feed = await getFeed({ source: 'linuxdo', limit: 1, fetcher });

    expect(feed.items[0]).toMatchObject({
      categoryId: undefined,
      category: '未分类'
    });
  });

  it('does not expose linux.do uncategorized as a category tab option', async () => {
    const fetcher = vi.fn(async () =>
      json({
        categories: [
          {
            id: 1,
            name: '未分类',
            slug: 'uncategorized'
          },
          {
            id: 2,
            name: '技术',
            slug: 'tech'
          },
          {
            id: 4,
            name: '开发调优',
            slug: 'dev',
            description_text: '只用于原站说明',
            parent_category_id: 2,
            topic_count: 88,
            read_restricted: true
          }
        ]
      })
    );

    const categories = await getCategories({ source: 'linuxdo', fetcher });

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
    const fetcher = vi.fn(async () =>
      json({
        user_summary: {
          topic_count: 0,
          reply_count: 0,
          post_count: 0,
          user: { id: 7, username: 'newbie', name: 'Newbie' }
        },
        topics: []
      })
    );

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

  it('[REG-TOPIC-039] resolves the exact NodeSeek username from the complete candidate list', async () => {
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

  it('[REG-TOPIC-039] rejects a known logged-out username resolution before transport', async () => {
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

  it('[REG-TOPIC-039] accepts one unique case-insensitive NodeSeek username match', async () => {
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

  it('[REG-TOPIC-039] prefers a strict NodeSeek username match over case-insensitive alternatives', async () => {
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

  it('[REG-TOPIC-039] rejects ambiguous case-insensitive NodeSeek username matches', async () => {
    const fetcher = vi.fn(async () =>
      json({
        success: true,
        memberList: [
          { member_id: 7, member_name: 'ALICE' },
          { member_id: 8, member_name: 'alice' }
        ]
      })
    );

    await expect(
      resolveNodeSeekUser('Alice', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名解析失败');
  });

  it('[REG-TOPIC-039] rejects conflicting strict NodeSeek username matches', async () => {
    const fetcher = vi.fn(async () =>
      json({
        success: true,
        memberList: [
          { member_id: 7, member_name: 'Alice' },
          { member_id: 8, member_name: 'Alice' }
        ]
      })
    );

    await expect(
      resolveNodeSeekUser('Alice', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名解析失败');
  });

  it('[REG-TOPIC-039] encodes a Unicode NodeSeek username in the resolver path', async () => {
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

  it('[REG-TOPIC-039] rejects a non-numeric NodeSeek profile id before transport', async () => {
    const fetcher = vi.fn();

    await expect(getNodeSeekUserProfile('alice', { fetcher })).rejects.toThrow('数字用户 ID');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-039] rejects a NodeSeek profile response for a different canonical UID', async () => {
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

  it('[REG-TOPIC-039] rejects an unsuccessful NodeSeek username response even if it contains candidates', async () => {
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

  it('[REG-TOPIC-039] surfaces NodeSeek username lookup rate limiting without selecting a fallback user', async () => {
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
  ])('[REG-TOPIC-039] rejects %s when resolving a NodeSeek username', async (_label, payload) => {
    const fetcher = vi.fn(async () => json(payload));

    await expect(
      resolveNodeSeekUser('alice', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名解析失败');
  });

  it('[REG-TOPIC-039] cancels NodeSeek username resolution through its AbortSignal', async () => {
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

  it('[REG-TOPIC-039] rejects an empty NodeSeek username before transport', async () => {
    const fetcher = vi.fn();

    await expect(
      resolveNodeSeekUser('   ', {
        authenticated: true,
        fetcher
      })
    ).rejects.toThrow('用户名不能为空');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-062] opens a linux.do reply near-post as one anchored window', async () => {
    const stream = Array.from({ length: 120 }, (_, index) => 1000 + index);
    const posts = Array.from({ length: 20 }, (_, index) => {
      const floor = 81 + index;
      return {
        id: stream[floor - 1],
        post_number: floor,
        username: floor === 90 ? 'target' : `user-${floor}`,
        cooked: `<p>reply ${floor}</p>`,
        created_at: '2026-08-05T00:00:00.000Z',
        can_edit: false
      };
    });
    const fetcher = vi.fn(async (input: string) => {
      expect(new URL(input).pathname).toBe('/t/900/90.json');
      return json({ chunk_size: 20, post_stream: { posts, stream } });
    });

    const replies = await getReplies({
      source: 'linuxdo',
      id: '900',
      order: 'oldest',
      position: { kind: 'target', target: { floor: 90 } },
      limit: 30,
      discourseAuth: testLinuxDoDiscourseAuth(),
      fetcher
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(replies).toMatchObject({
      currentPage: 3,
      currentOffset: 79,
      previousPage: 2,
      previousOffset: 49,
      hasMore: true,
      nextPage: 4,
      nextOffset: 99,
      totalCount: 119
    });
    expect(replies.items).toContainEqual(expect.objectContaining({ floor: 90, author: 'target' }));
  });

  it('[REG-TOPIC-067] reads only the linux.do stream tail IDs and then the adjacent older IDs', async () => {
    const stream = Array.from({ length: 46 }, (_, index) => 1000 + index);
    const requestedPostIds: string[][] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/t/901.json') {
        return json({ post_stream: { stream, posts: [] } });
      }
      if (url.pathname === '/t/901/posts.json') {
        const ids = url.searchParams.getAll('post_ids[]');
        requestedPostIds.push(ids);
        return json({
          post_stream: {
            posts: ids.map((id) => ({
              id: Number(id),
              post_number: Number(id) - 999,
              username: `user-${id}`,
              cooked: `<p>${id}</p>`,
              created_at: '2026-08-05T00:00:00.000Z'
            }))
          }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const tail = await getReplies({
      source: 'linuxdo',
      id: '901',
      order: 'newest',
      position: { kind: 'start' },
      limit: 10,
      discourseAuth: testLinuxDoDiscourseAuth(),
      fetcher
    });
    const older = await getReplies({
      source: 'linuxdo',
      id: '901',
      order: 'newest',
      position: { kind: 'cursor', page: tail.nextPage!, offset: tail.nextOffset ?? null },
      limit: 10,
      discourseAuth: testLinuxDoDiscourseAuth(),
      fetcher
    });

    expect(requestedPostIds).toEqual([
      ['1041', '1042', '1043', '1044', '1045'],
      ['1031', '1032', '1033', '1034', '1035', '1036', '1037', '1038', '1039', '1040']
    ]);
    expect(tail.items.map((reply) => reply.floor)).toEqual([46, 45, 44, 43, 42]);
    expect(tail).toMatchObject({ currentPage: 5, previousPage: null, nextPage: 4, nextOffset: 30 });
    expect(older.items.map((reply) => reply.floor)).toEqual([41, 40, 39, 38, 37, 36, 35, 34, 33, 32]);
  });

  it('[REG-TOPIC-024] resolves later linux.do reply pages from the current server stream', async () => {
    let topicJsonCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/posts.json')) {
        if (!input.includes('40') || !input.includes('50')) {
          throw new Error(`stale reply stream request: ${input}`);
        }
        return json({
          post_stream: {
            posts: [
              {
                id: 40,
                post_number: 4,
                username: 'reply 4',
                cooked: '<p>4</p>',
                created_at: '2026-05-20T00:04:00.000Z'
              },
              {
                id: 50,
                post_number: 5,
                username: 'reply 5',
                cooked: '<p>5</p>',
                created_at: '2026-05-20T00:05:00.000Z'
              }
            ]
          }
        });
      }
      topicJsonCalls += 1;
      return json({
        id: 900,
        title: 'linux.do topic',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 5,
        post_stream: {
          stream: topicJsonCalls === 1 ? [1, 2, 3, 4, 5] : [1, 2, 3, 40, 50],
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
      order: 'oldest',
      position: {
        kind: 'cursor',
        page: topic.replyNextPage ?? 2,
        offset: topic.replyNextOffset ?? null
      },
      limit: 2,
      fetcher
    });

    expect(replies.items.map((item) => item.floor)).toEqual([4, 5]);
    expect(fetcher.mock.calls.filter((call) => String(call[0]).includes('/t/900.json'))).toHaveLength(2);
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
            posts: [
              {
                id: 11,
                post_number: 1,
                username: 'alice',
                cooked: '<p>Complete cross-topic first paragraph.</p><p>Complete cross-topic second paragraph.</p>',
                created_at: '2026-05-20T00:00:00.000Z'
              }
            ]
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
          posts: [
            {
              id: 1,
              post_number: 1,
              username: 'bob',
              cooked:
                '<aside data-post="1" class="quote" data-topic="920" data-username="alice"><blockquote><p>Short cross-topic preview.</p></blockquote></aside><p>Topic body</p>',
              created_at: '2026-05-20T00:00:00.000Z'
            }
          ]
        }
      });
    });

    const topic = await getTopic({ source: 'linuxdo', id: '910', fetcher });
    const completePost = await getReply({ source: 'linuxdo', id: '920', floor: 1, fetcher });

    expect(topic.contentHtml).toContain('data-topic="920"');
    expect(topic.contentHtml).toContain('Short cross-topic preview.');
    expect(topic.contentHtml).not.toContain('Complete cross-topic second paragraph.');
    expect(completePost.contentHtml).toBe(
      '<p>Complete cross-topic first paragraph.</p><p>Complete cross-topic second paragraph.</p>'
    );
  });

  it('keeps a linux.do reply quote preview and loads the same-topic complete post separately', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 910,
        title: 'linux.do quoted author',
        created_at: '2026-05-20T00:00:00.000Z',
        posts_count: 2,
        post_stream: {
          stream: [1, 2],
          posts: [
            {
              id: 1,
              post_number: 1,
              username: 'alice',
              cooked: '<p>Complete post first paragraph.</p><p>Complete post second paragraph.</p>',
              created_at: '2026-05-20T00:00:00.000Z'
            },
            {
              id: 2,
              post_number: 2,
              username: 'bob',
              cooked:
                '<aside data-post="1" class="quote" data-topic="910" data-username="alice"><blockquote><p>Short preview.</p></blockquote></aside><p>Reply</p>',
              created_at: '2026-05-20T00:02:00.000Z'
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '910', fetcher });
    const completePost = await getReply({ source: 'linuxdo', id: '910', floor: 1, fetcher });

    expect(topic.replies[0]).toMatchObject({
      quotedPosts: [
        {
          reference: { source: 'linuxdo', topicId: '910', postNumber: 1 },
          author: { label: 'alice', username: 'alice' },
          preview: 'Short preview.'
        }
      ],
      contentHtml: '<p>Reply</p>'
    });
    expect(completePost.contentHtml).toBe(
      '<p>Complete post first paragraph.</p><p>Complete post second paragraph.</p>'
    );
  });

  it('[REG-TOPIC-053] keeps a linux.do reply quote target topic instead of treating it as a local floor', async () => {
    const fetcher = vi.fn(async () =>
      json({
        id: 2685882,
        title: 'Topic with cross-topic reply quote',
        created_at: '2026-07-31T00:00:00.000Z',
        posts_count: 2,
        post_stream: {
          stream: [1, 2],
          posts: [
            {
              id: 1,
              post_number: 7,
              username: 'local',
              cooked: '<p>Wrong local floor.</p>',
              created_at: '2026-07-31T00:00:00.000Z'
            },
            {
              id: 2,
              post_number: 8,
              username: 'bob',
              cooked:
                '<aside data-post="7" class="quote" data-topic="2679944" data-username="alice"><div class="title"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/2679944/7">Referenced topic</a></div></div><blockquote><p>Cross-topic preview.</p></blockquote></aside><p>Reply body.</p>',
              created_at: '2026-07-31T00:02:00.000Z'
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '2685882', fetcher });

    expect(topic.replies[0]).toMatchObject({
      floor: 8,
      contentHtml: '<p>Reply body.</p>',
      quotedPosts: [
        {
          reference: { source: 'linuxdo', topicId: '2679944', postNumber: 7 },
          author: { label: 'alice', username: 'alice' },
          preview: 'Cross-topic preview.',
          topicTitle: 'Referenced topic',
          topicUrl: 'https://linux.do/t/topic/2679944/7'
        }
      ]
    });
  });

  it('keeps linux.do reply quote author names from quote avatar URLs', async () => {
    const fetcher = vi.fn(async () =>
      json({
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
              cooked:
                '<aside data-post="1" class="quote" data-topic="911"><div class="title"><img alt="" width="24" height="24" src="https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png" class="avatar"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/911/1">Quoted topic</a></div></div><blockquote><p>Original text</p></blockquote></aside><p>Reply</p>',
              created_at: '2026-05-20T00:02:00.000Z'
            }
          ]
        }
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '911', fetcher });

    expect(topic.replies[0].quotedPosts).toEqual([
      {
        reference: { source: 'linuxdo', topicId: '911', postNumber: 1 },
        author: { label: 'alice' },
        preview: 'Original text',
        topicTitle: 'Quoted topic',
        topicUrl: 'https://linux.do/t/topic/911/1'
      }
    ]);
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
    const replies = await getReplies({
      source: 'linuxdo',
      id: '9901',
      order: 'oldest',
      position: { kind: 'start' },
      limit: 30,
      fetcher
    });

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
    const fetcher = vi.fn(async () =>
      json({
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
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '902', fetcher });

    expect(topic).toMatchObject({ commentId: 2101, canLike: false });
    expect(topic.replies[0]).toMatchObject({ commentId: 2102, canLike: false });
    expect(topic.replies[1]).toMatchObject({ commentId: 2103, canLike: true });
  });

  it('omits linux.do replies that the original site marks as deleted', async () => {
    const fetcher = vi.fn(async () =>
      json({
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
      })
    );

    const topic = await getTopic({ source: 'linuxdo', id: '901', fetcher });

    expect(topic.replies).toHaveLength(1);
    expect(topic.replies[0]).toMatchObject({
      commentId: 2002,
      contentHtml: expect.stringContaining('visible reply')
    });
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

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekAuthenticated: true });

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

    const search = await searchTopics({ source: 'nodeseek', query: 'AI', fetcher, nodeSeekAuthenticated: true });

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

    const search = await searchTopics({
      source: 'nodeseek',
      query: '安卓手机免',
      fetcher,
      nodeSeekAuthenticated: true
    });

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
    const second = await searchTopics({
      source: 'nodeseek',
      query: 'codex',
      page: first.nextPage ?? 2,
      limit: 1,
      fetcher
    });
    const third = await searchTopics({
      source: 'nodeseek',
      query: 'codex',
      page: second.nextPage ?? 3,
      limit: 1,
      fetcher
    });

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
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=xyz')) {
        return html('<ul class="post-list"></ul>');
      }
      return html(`<script>${latestPayload}</script>`);
    });

    const search = await searchTopics({ source: 'nodeseek', query: 'xyz', fetcher, nodeSeekAuthenticated: true });

    expect(search.items).toEqual([]);
    const callUrls = fetcher.mock.calls.map((call) => call[0]);
    expect(callUrls).toContain('https://www.nodeseek.com/search?q=xyz');
    expect(callUrls).not.toContain('https://www.nodeseek.com/');
  });

  it('REG-SEARCH-018 keeps empty NodeSeek search pages empty when shell links and embedded topics remain', async () => {
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
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/search?') && input.includes('q=retry')) {
        return html('<main><form action="/search"><input name="q" value="retry" /></form></main>');
      }
      throw new Error(`unexpected ${input}`);
    });

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

    const search = await searchTopics({ source: 'nodeseek', query: 'GPT', fetcher, nodeSeekAuthenticated: true });

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

  it('[REG-SEARCH-021] uses Google for anonymous and newly expired linux.do searches', async () => {
    let expiredResponse = new Response('', { status: 401 });
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname === 'linux.do') return expiredResponse.clone();
      expect(url.hostname).toBe('www.google.com');
      expect(url.pathname).toBe('/search');
      expect(url.searchParams.get('q')).toBe('site:linux.do codex');
      expect(JSON.stringify(init?.headers || {})).not.toContain('Cookie');
      return html(`
          <html>
            <head><title>site:linux.do codex - Google Search</title></head>
            <body>
            <a href="https://linux.do/t/topic/1424130"><span>https://linux.do</span><h3>Codex CLI 讨论</h3></a>
            <a href="/url?q=https%3A%2F%2Flinux.do%2Ft%2Ftopic%2F1577485&amp;sa=U"><h3>Codex 镜像讨论</h3></a>
            <a href="/url?url=https%3A%2F%2Flinux.do%2Ft%2Ftopic%2F1577486&amp;sa=U"><h3>Codex 另一条讨论</h3></a>
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

    const loggedInSearch = () =>
      searchTopics({
        source: 'linuxdo',
        query: 'codex',
        fetcher,
        discourseAuth: testLinuxDoDiscourseAuth(),
        linuxDoAuthenticated: true
      });
    expect((await loggedInSearch()).items.map((item) => item.id)).toEqual(['1424130', '1577485', '1577486']);
    expiredResponse = html('<main>You need to log in to search.</main>');
    expect((await loggedInSearch()).items.map((item) => item.id)).toEqual(['1424130', '1577485', '1577486']);
  });

  it('[REG-SEARCH-022] rejects linux.do Google candidates whose only text is a URL or breadcrumb', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <html>
          <head><title>site:linux.do codex - Google Search</title></head>
          <body>
            <a href="https://linux.do/t/topic/1424130"><span>https://linux.do/t/topic/1424130</span></a>
            <a href="https://linux.do/t/topic/1577485"><span>linux.do › t › topic › 1577485</span></a>
          </body>
        </html>
      `)
    );

    const search = await searchTopics({ source: 'linuxdo', query: 'codex', fetcher });

    expect(search.items).toEqual([]);
    expect(search.errors.linuxdo).toMatchObject({
      message: 'Google 搜索结果缺少可确认的标题',
      reason: 'parse_empty'
    });
    expect(sourceDiagnosticSummary(search)).toMatchObject({
      candidateCount: 2,
      validCount: 0,
      missingTitleCount: 2,
      isExpectedEmpty: false,
      isParseEmpty: true
    });
  });

  it('[REG-SEARCH-022] keeps valid linux.do Google titles and counts missing titles before dropping them', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <html>
          <head><title>site:linux.do codex - Google Search</title></head>
          <body>
            <a href="https://linux.do/t/topic/1424130"><span>linux.do</span><h3>Codex CLI 讨论</h3></a>
            <a href="https://linux.do/t/topic/1424130"><span>重复链接不能重复计数</span></a>
            <a href="https://linux.do/t/topic/1577485"><span>linux.do › t › topic › 1577485</span></a>
            <a aria-label="Codex 可访问标题" href="https://linux.do/t/topic/1577486">
              <span>https://linux.do/t/topic/1577486</span>
            </a>
          </body>
        </html>
      `)
    );

    const search = await searchTopics({ source: 'linuxdo', query: 'codex', fetcher });

    expect(search.items.map((item) => [item.id, item.title])).toEqual([
      ['1424130', 'Codex CLI 讨论'],
      ['1577486', 'Codex 可访问标题']
    ]);
    expect(sourceDiagnosticSummary(search)).toMatchObject({
      candidateCount: 3,
      validCount: 2,
      droppedCount: 1,
      missingTitleCount: 1,
      isExpectedEmpty: false,
      isParseEmpty: false
    });
  });

  it('[REG-SEARCH-022] distinguishes an explicit empty Google page from unsupported markup', async () => {
    const explicitEmpty = vi.fn(async () =>
      html(`
        <html>
          <head><title>site:linux.do no-match - Google Search</title></head>
          <body><p>找不到和您的查询相符的内容</p></body>
        </html>
      `)
    );
    const empty = await searchTopics({ source: 'linuxdo', query: 'no-match', fetcher: explicitEmpty });

    expect(empty.items).toEqual([]);
    expect(sourceDiagnosticSummary(empty)).toMatchObject({ isExpectedEmpty: true, isParseEmpty: false });

    const unsupported = vi.fn(async () =>
      html(`
        <html>
          <head><title>site:linux.do codex - Google Search</title></head>
          <body><main>Google result markup changed</main></body>
        </html>
      `)
    );
    const changed = await searchTopics({ source: 'linuxdo', query: 'codex', fetcher: unsupported });
    expect(changed.items).toEqual([]);
    expect(changed.errors.linuxdo).toMatchObject({
      message: 'Google 搜索结果结构已变化',
      reason: 'parse_empty'
    });
    expect(sourceDiagnosticSummary(changed)).toMatchObject({ isExpectedEmpty: false, isParseEmpty: true });
  });

  it('[REG-LINUXDO-005] ignores supplied login access until the account session is confirmed', async () => {
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      expect(url.hostname).toBe('www.google.com');
      expect(JSON.stringify(init?.headers || {})).not.toContain('Cookie');
      return html(`
        <html>
          <head><title>site:linux.do codex - Google Search</title></head>
          <body><a href="https://linux.do/t/topic/1424130"><h3>Anonymous result</h3></a></body>
        </html>
      `);
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'codex',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: false
    });

    expect(search.items.map((item) => item.id)).toEqual(['1424130']);
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
              <a href="https://linux.do/t/topic/1424130"><h3>linux.do first page codex</h3></a>
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
              <a href="https://linux.do/t/topic/1577485"><h3>linux.do second page codex</h3></a>
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
              <a href="https://linux.do/t/topic/1577486"><h3>linux.do third page codex</h3></a>
            </body>
          </html>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await searchTopics({ source: 'linuxdo', query: 'codex', limit: 1, fetcher });
    const second = await searchTopics({
      source: 'linuxdo',
      query: 'codex',
      page: first.nextPage ?? 2,
      limit: 1,
      fetcher
    });
    const third = await searchTopics({
      source: 'linuxdo',
      query: 'codex',
      page: second.nextPage ?? 3,
      limit: 1,
      fetcher
    });

    expect(first.items.map((item) => item.id)).toEqual(['1424130']);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['1577485']);
    expect(second.nextPage).toBe(3);
    expect(third.items.map((item) => item.id)).toEqual(['1577486']);
    expect(third.hasMore).toBe(false);
    expect(fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('start'))).toEqual([
      null,
      '10',
      '20'
    ]);
  });

  it('keeps empty linux.do search responses empty instead of falling back to latest topics', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/session/csrf.json')) {
        return json({ csrf: 'csrf-token' });
      }
      if (input.includes('linux.do/search?')) {
        return json({ topics: [], posts: [] });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'fallback keyword',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(search.items).toEqual([]);
    const calls = fetcher.mock.calls.map((call) => call[0]).join('\n');
    expect(calls).toContain('https://linux.do/search');
    expect(calls).not.toContain('https://linux.do/latest.json');
  });

  it('REG-SEARCH-003 maps Discourse first-post authors and paginates results', async () => {
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
          post_number: 1,
          username: `author-${id}`,
          avatar_template: `/user_avatar/linux.do/author-${id}/{size}/1.png`,
          blurb: `matching post ${id}`
        })),
        users: []
      });
    });

    const first = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      limit: 1,
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });
    const second = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      page: first.nextPage ?? 2,
      limit: 1,
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(first.items).toEqual([
      expect.objectContaining({
        id: '501',
        author: 'author-501',
        authorAvatar: 'https://linux.do/user_avatar/linux.do/author-501/96/1.png'
      })
    ]);
    expect(first.hasMore).toBe(true);
    expect(first.nextPage).toBe(2);
    expect(second.items.map((item) => item.id)).toEqual(['502']);
    const searchCalls = fetcher.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => url.pathname === '/search');
    expect(searchCalls.map((url) => url.searchParams.get('page'))).toEqual(['1', '1']);
  });

  it('[REG-VERIFICATION-002] does not treat Cloudflare marker text inside Discourse JSON as a challenge', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/session/csrf.json') {
        return json({ csrf: 'csrf-token' });
      }
      expect(url.pathname).toBe('/search');
      return json({
        grouped_search_result: { more_full_page_results: false },
        topics: [
          {
            id: 506,
            title: 'cf-turnstile integration notes',
            slug: 'cf-turnstile-integration-notes',
            created_at: '2026-05-21T00:00:00.000Z',
            bumped_at: '2026-05-21T00:00:00.000Z',
            posts_count: 1
          }
        ],
        posts: [
          {
            id: 1506,
            topic_id: 506,
            post_number: 1,
            username: 'author-506',
            blurb: 'ordinary discussion about challenge-platform behavior'
          }
        ],
        users: []
      });
    });

    const result = await searchTopics({
      source: 'linuxdo',
      query: 'cf-turnstile',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: '506',
        title: 'cf-turnstile integration notes'
      })
    ]);
  });

  it('[REG-SEARCH-013] keeps linux.do reply matches without claiming the reply author is the OP', async () => {
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname === '/session/csrf.json') {
        return json({ csrf: 'csrf-token' });
      }
      if (url.pathname === '/search') {
        return json({
          grouped_search_result: { more_full_page_results: false },
          topics: [
            {
              id: 504,
              title: 'reply-only match',
              slug: 'reply-only-match',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:01:00.000Z',
              posts_count: 2,
              posters: [],
              last_poster_username: 'last-replier'
            },
            {
              id: 505,
              title: 'reply match with topic creator',
              slug: 'reply-match-with-topic-creator',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:01:00.000Z',
              posts_count: 2,
              posters: [],
              last_poster_username: 'another-last-replier',
              details: {
                created_by: {
                  username: 'topic-owner',
                  avatar_template: '/user_avatar/linux.do/topic-owner/{size}/1.png'
                }
              }
            }
          ],
          posts: [
            {
              topic_id: 504,
              post_number: 2,
              username: 'reply-author',
              avatar_template: '/user_avatar/linux.do/reply-author/{size}/1.png',
              blurb: 'matching reply'
            },
            {
              topic_id: 505,
              post_number: 2,
              username: 'another-reply-author',
              avatar_template: '/user_avatar/linux.do/another-reply-author/{size}/1.png',
              blurb: 'another matching reply'
            }
          ],
          users: []
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'reply-only',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(search.items).toEqual([
      expect.objectContaining({
        id: '504',
        author: '',
        excerpt: 'matching reply'
      }),
      expect.objectContaining({
        id: '505',
        author: 'topic-owner',
        excerpt: 'another matching reply'
      })
    ]);
    expect(sourceDiagnosticSummary(search)).toMatchObject({
      candidateCount: 2,
      validCount: 2,
      droppedCount: 0,
      isParseEmpty: false
    });
  });

  it('keeps official linux.do search results even when they do not contain the full query text', async () => {
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
          posts: [{ topic_id: 902, blurb: '官方搜索认为这个话题相关。' }],
          users: []
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: '安卓手机免',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['901', '902']);
  });

  it('matches the official linux.do search request from the logged-in page', async () => {
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
        topics: [
          {
            id: 605,
            title: 'linux latest keyword',
            slug: 'linux-latest-keyword',
            created_at: '2026-05-21T00:00:00.000Z',
            bumped_at: '2026-05-21T00:00:00.000Z',
            posts_count: 1
          }
        ],
        users: []
      });
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['605']);
    const calls = fetcher.mock.calls.map((call) => String(call[0])).join('\n');
    expect(calls).toContain('https://linux.do/search');
    expect(calls).not.toContain('https://linux.do/discourse-ai/embeddings/semantic-search');
    const searchCall = fetcher.mock.calls.find((call) => new URL(String(call[0])).pathname === '/search');
    const init = searchCall?.[1];
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Discourse-Present': 'true',
          Referer: 'https://linux.do/search?expanded=true&q=keyword',
          'X-CSRF-Token': 'csrf-token',
          'X-Requested-With': 'XMLHttpRequest'
        })
      })
    );
  });

  it('maps linux.do search result category ids through site categories', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('linux.do/search?')) {
        return json({
          topics: [
            {
              id: 701,
              title: 'linux category keyword',
              slug: 'linux-category-keyword',
              category_id: 4,
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ],
          users: []
        });
      }
      if (input.includes('linux.do/site.json')) {
        return json({
          categories: [
            {
              id: 4,
              name: '开发调优',
              slug: 'dev'
            }
          ]
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(search.items[0]).toMatchObject({
      id: '701',
      categoryId: '4',
      category: '开发调优'
    });
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://linux.do/site.json');
  });

  it('keeps linux.do search results in the official relevance order', async () => {
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

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['801', '802']);
  });

  it('sends gateway-supplied linux.do login access when searching', async () => {
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/session/csrf.json')) {
        return json({ csrf: 'csrf-token' });
      }
      if (input.includes('/search?')) {
        return json({
          topics: [
            {
              id: 601,
              title: 'linux logged in keyword',
              slug: 'linux-logged-in-keyword',
              created_at: '2026-05-21T00:00:00.000Z',
              bumped_at: '2026-05-21T00:00:00.000Z',
              posts_count: 1
            }
          ],
          users: []
        });
      }
      throw new Error(`unexpected ${input} ${JSON.stringify(init)}`);
    });

    const search = await searchTopics({
      source: 'linuxdo',
      query: 'keyword',
      fetcher,
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true
    });

    expect(search.items.map((item) => item.id)).toEqual(['601']);
    const [input, init] = fetcher.mock.calls.find((call) => new URL(String(call[0])).pathname === '/search') || [];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/search');
    expect(url.searchParams.get('q')).toBe('keyword');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('type_filter')).toBe(false);
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Discourse-Logged-In': 'true',
          Referer: 'https://linux.do/search?expanded=true&q=keyword',
          'User-Agent': 'LinuxDo WebView UA',
          'X-CSRF-Token': 'csrf-token',
          'X-Requested-With': 'XMLHttpRequest'
        })
      })
    );
    expect(init?.headers).not.toHaveProperty('Cookie');
  });

  it('[REG-ACCOUNT-029] lets the native jar attach NodeSeek cookies when reading the Android feed', async () => {
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

  it('[REG-SOURCE-005] marks visible NodeSeek reads ahead of background account refresh', async () => {
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

  it('[REG-SOURCE-005] marks visible linux.do reads ahead of background account refresh', async () => {
    const visibleFetcher = vi.fn(async (input: string) =>
      new URL(input).pathname === '/site.json' ? json({ categories: [] }) : json({ topic_list: { topics: [] } })
    );
    const accountFetcher = vi.fn(async () =>
      json({
        current_user: { id: 42, username: 'alice', name: 'Alice' }
      })
    );

    await getFeed({ source: 'linuxdo', fetcher: visibleFetcher });
    await getCategories({ source: 'linuxdo', fetcher: visibleFetcher });
    await getLinuxDoCurrentUserProfile({ fetcher: accountFetcher });

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

  it('[REG-ACCOUNT-037] uses rendered NodeSeek guest controls for account probes', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743010-1">Public topic</a></div>
        </li>
      </ul>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <header>
        <a class="btn" href="/signIn.html">登录</a>
        <a class="btn" href="/register.html">注册</a>
      </header>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await expect(getNodeSeekCurrentUserProfile({ fetcher })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-ACCOUNT-037] accepts only the bridged explicit-null NodeSeek account state as anonymous', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743010-1">Public topic</a></div>
        </li>
      </ul>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <meta name="nodeseekAccountState" content="anonymous">
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await expect(getNodeSeekCurrentUserProfile({ fetcher })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('[REG-ACCOUNT-037] keeps explicit direct NodeSeek account evidence on the fast path', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <header>
        <a class="btn" href="/signIn.html">登录</a>
        <a class="btn" href="/register.html">注册</a>
      </header>
    `)
    );
    const webViewFetcher = vi.fn(async () => {
      throw new Error('WebView should not run for explicit direct identity evidence');
    });
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await expect(getNodeSeekCurrentUserProfile({ fetcher })).rejects.toMatchObject({
      loginRequired: true,
      reason: 'expired'
    });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).not.toHaveBeenCalled();
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

  it('uses normal fetch for NodeSeek when the HTML is already readable', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743010-1">NodeSeek normal detail</a>
      <div class="content-item">
        <article class="post-content"><p>正常正文</p></article>
      </div>
    `)
    );
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

  it('[REG-TEST-003] keeps WebView fallback disabled when the runtime disallows it', async () => {
    const direct = new Response('<html><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    });
    const webViewFetcher = vi.fn(async () => new Response('private'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      allowWebViewFallback: () => false,
      defaultFetcher: vi.fn(async () => direct),
      webViewFetcher
    });

    await expect(fetcher('https://www.nodeseek.com/api/topics')).resolves.toBe(direct);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable NodeSeek lists that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743013-1">NodeSeek direct list row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743014-1">NodeSeek WebView list row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await getFeed({ source: 'nodeseek', fetcher });

    expect(result.items.map((item) => item.title)).toEqual(['NodeSeek direct list row']);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable NodeSeek details that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <div class="cf-turnstile"></div>
      <a class="post-title" href="/post-743015-1">NodeSeek direct detail</a>
      <div class="content-item">
        <article class="post-content"><p>直接正文讨论“正在进行安全验证”提示</p></article>
      </div>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743015-1">NodeSeek WebView detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743015', fetcher });

    expect(topic.title).toBe('NodeSeek direct detail');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses normal fetch for readable embedded NodeSeek details that include challenge scripts', async () => {
    const directPayload = Buffer.from(
      JSON.stringify({
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
      })
    ).toString('base64');
    const normalFetcher = vi.fn(async () =>
      html(`
      <script>${directPayload}</script>
      <div class="cf-turnstile"></div>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743016-1">NodeSeek WebView embedded detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743016', fetcher });

    expect(topic.title).toBe('NodeSeek direct embedded detail');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-002] does not send NodeSeek JSON business responses to the verification WebView', async () => {
    const normalFetcher = vi.fn(async () =>
      json({
        ok: true,
        message: 'ordinary API data mentioning cf-turnstile and challenge-platform'
      })
    );
    const webViewFetcher = vi.fn(async () => json({ ok: false, message: 'unexpected fallback' }));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://www.nodeseek.com/api/account/status');

    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-002] does not treat plain Cloudflare discussion text as a NodeSeek challenge page', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <html><body><article>
        Ordinary documentation mentioning cf-turnstile and challenge-platform.
      </article></body></html>
    `)
    );
    const webViewFetcher = vi.fn(async () => html('<html>unexpected fallback</html>'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://www.nodeseek.com/help/cloudflare');

    await expect(response.text()).resolves.toContain('Ordinary documentation');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-VERIFICATION-002] does not treat Chinese verification discussion text as a NodeSeek challenge page', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <html><body><article>
        普通文档讨论“正在进行安全验证”和“安全服务防护恶意自动程序”的提示文案。
      </article></body></html>
    `)
    );
    const webViewFetcher = vi.fn(async () => html('<html>unexpected fallback</html>'));
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const response = await fetcher('https://www.nodeseek.com/help/security-copy');

    await expect(response.text()).resolves.toContain('普通文档');
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('retries NodeSeek through the WebView fallback only after Cloudflare', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743011-1">NodeSeek fallback detail</a>
      <div class="content-item">
        <article class="post-content"><p>兜底正文</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'nodeseek', id: '743011', fetcher });

    expect(topic.title).toBe('NodeSeek fallback detail');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/post-743011-1');
    const events = lines.map((line) => JSON.parse(line)).filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'nodeseek', reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', status: 403, reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', status: 200 }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', channel: 'webview' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/743011|post-|https?:|cf-turnstile/);
  });

  it('[REG-SOURCE-006] starts the caller timeout handoff when NodeSeek enters the WebView fallback', async () => {
    vi.useFakeTimers();
    let resolveFallback: ((response: Response) => void) | undefined;
    try {
      const normalFetcher = vi.fn(
        async () =>
          new Response('<html><div class="cf-turnstile"></div></html>', {
            status: 403,
            headers: { 'cf-mitigated': 'challenge' }
          })
      );
      const webViewFetcher = vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFallback = resolve;
          })
      );
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher: normalFetcher,
        webViewFetcher
      });

      const topicPromise = getTopic({
        source: 'nodeseek',
        id: '743023',
        fetcher,
        timeoutMs: 100
      });
      let outcome: { topic?: Awaited<typeof topicPromise>; error?: unknown } | undefined;
      void topicPromise.then(
        (topic) => {
          outcome = { topic };
        },
        (error) => {
          outcome = { error };
        }
      );

      await vi.advanceTimersByTimeAsync(200);
      expect(webViewFetcher).toHaveBeenCalledTimes(1);
      expect(outcome).toBeUndefined();

      resolveFallback?.(
        html(`
        <a class="post-title" href="/post-743023-1">NodeSeek queued fallback detail</a>
        <div class="content-item">
          <article class="post-content"><p>fallback timeout starts after dispatch</p></article>
        </div>
      `)
      );
      await expect(topicPromise).resolves.toMatchObject({
        title: 'NodeSeek queued fallback detail'
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('keeps NodeSeek direct and WebView fallback stages on the caller trace', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const trace = beginDiagnosticTrace('topic', 'open');
    const fallbackFetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: async () =>
        new Response('<html><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        }),
      webViewFetcher: async () =>
        html(`
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
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'transport', channel: 'direct', state: 'fallback' }),
        expect.objectContaining({ phase: 'transport', channel: 'webview', state: 'finish' })
      ])
    );
  });

  it('keeps NodeSeek edit metadata when replies use the WebView fallback', async () => {
    const payload = Buffer.from(
      JSON.stringify({
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
      })
    ).toString('base64');
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`<script id="temp-script" type="application/json">${payload}</script>`)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

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
      contentMarkdown: 'Bd',
      canEdit: true,
      canLike: false
    });
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('retries NodeSeek topic details through the WebView fallback when normal fetch stalls', async () => {
    vi.useFakeTimers();
    try {
      const normalFetcher = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
              },
              { once: true }
            );
          })
      );
      const webViewFetcher = vi.fn(async () =>
        html(`
        <a class="post-title" href="/post-743012-1">NodeSeek slow fallback detail</a>
        <div class="content-item">
          <article class="post-content"><p>慢请求兜底正文</p></article>
        </div>
      `)
      );
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
      const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
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
      text: () =>
        new Promise<string>((resolve) => {
          resolveChallengeBody = resolve;
        })
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
        (topic) => {
          outcome = { topic };
        },
        (error) => {
          outcome = { error };
        }
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
      const webViewFetcher = vi.fn(async () =>
        html(`
        <ul class="post-list">
          <li class="post-list-item">
            <div class="post-title"><a href="/post-743018-1">NodeSeek slow fallback list row</a></div>
            <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
          </li>
        </ul>
      `)
      );
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
      const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
      expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/?sortBy=postTime');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-NODESEEK-004] recovers after the configured qualified fallback threshold and resets on direct success', async () => {
    vi.useFakeTimers();
    try {
      let directMode: 'hang' | 'success' = 'hang';
      const defaultFetcher = vi.fn(() =>
        directMode === 'success'
          ? Promise.resolve(html('<html>direct success</html>'))
          : new Promise<Response>(() => undefined)
      );
      const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
      const fetcher = createNodeSeekWebViewFallbackFetcher({
        defaultFetcher,
        webViewFetcher: vi.fn(async () => html('<html>webview success</html>')),
        recoveryThreshold: 2,
        recoverReadChannel
      });

      const firstFallback = fetcher('https://www.nodeseek.com/first');
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(firstFallback).resolves.toBeInstanceOf(Response);
      expect(recoverReadChannel).not.toHaveBeenCalled();

      const secondFallback = fetcher('https://www.nodeseek.com/second');
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(secondFallback).resolves.toBeInstanceOf(Response);
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);

      directMode = 'success';
      await expect(fetcher('https://www.nodeseek.com/direct')).resolves.toBeInstanceOf(Response);
      directMode = 'hang';
      const afterReset = fetcher('https://www.nodeseek.com/after-reset');
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(afterReset).resolves.toBeInstanceOf(Response);
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-NODESEEK-004] preserves a successful WebView result when native recovery fails', async () => {
    const recoverReadChannel = vi.fn(async () => {
      throw new Error('native recovery unavailable');
    });
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => html('<html>usable fallback</html>')),
      recoveryThreshold: 1,
      recoverReadChannel
    });

    const response = await fetcher('https://www.nodeseek.com/read');

    await expect(response.text()).resolves.toContain('usable fallback');
    expect(recoverReadChannel).toHaveBeenCalledTimes(1);
  });

  it('[REG-NODESEEK-004] excludes writes, Cloudflare and unsuccessful WebView results from recovery counting', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 2 }));
    const cloudflare = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(
        async () =>
          new Response('<div class="cf-turnstile"></div>', {
            status: 403,
            headers: { 'cf-mitigated': 'challenge' }
          })
      ),
      webViewFetcher: vi.fn(async () => html('<html>verified</html>')),
      recoveryThreshold: 1,
      recoverReadChannel
    });
    const failedFallback = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => new Response('unavailable', { status: 503 })),
      recoveryThreshold: 1,
      recoverReadChannel
    });

    await cloudflare('https://www.nodeseek.com/challenge');
    await failedFallback('https://www.nodeseek.com/read');
    await expect(failedFallback('https://www.nodeseek.com/write', { method: 'POST', body: 'value' })).rejects.toThrow(
      'Network request failed'
    );

    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-006] keeps repeated NodeSeek direct failures isolated from shared proxy state', async () => {
    vi.useFakeTimers();
    try {
      const linuxDoPending = Promise.withResolvers<Response>();
      const sharedDefaultFetcher = vi.fn((input: string | URL | Request) =>
        String(input).startsWith('https://linux.do/') ? linuxDoPending.promise : new Promise<Response>(() => undefined)
      );
      const linuxDoRequest = sharedDefaultFetcher('https://linux.do/latest.json').then((response) => response.text());
      const legacyGlobalRecovery = vi.fn(() => {
        linuxDoPending.reject(new Error('shared OkHttp dispatcher was cancelled'));
      });
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
      const options = {
        defaultFetcher: sharedDefaultFetcher,
        webViewFetcher,
        recoverNodeSeekNetwork: legacyGlobalRecovery
      } as Parameters<typeof createNodeSeekWebViewFallbackFetcher>[0] & {
        recoverNodeSeekNetwork: () => void;
      };
      const fetcher = createNodeSeekWebViewFallbackFetcher(options);

      const feedPromise = getFeed({ source: 'nodeseek', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(feedPromise).resolves.toMatchObject({
        items: [expect.objectContaining({ title: 'NodeSeek first slow fallback' })]
      });
      const topicPromise = getTopic({ source: 'nodeseek', id: '743020', fetcher });
      await vi.advanceTimersByTimeAsync(8_000);
      await expect(topicPromise).resolves.toMatchObject({
        title: 'NodeSeek second slow fallback'
      });
      expect(webViewFetcher).toHaveBeenCalledTimes(2);
      expect(legacyGlobalRecovery).not.toHaveBeenCalled();

      linuxDoPending.resolve(json({ topic_list: { topics: [] } }));
      await expect(linuxDoRequest).resolves.toBe('{"topic_list":{"topics":[]}}');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('falls back independently for repeated NodeSeek Cloudflare challenge responses', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <a class="post-title" href="/post-743021-1">NodeSeek Cloudflare fallback detail</a>
      <div class="content-item">
        <article class="post-content"><p>cloudflare fallback body</p></article>
      </div>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    await getTopic({ source: 'nodeseek', id: '743021', fetcher });
    await getTopic({ source: 'nodeseek', id: '743021', fetcher });

    expect(webViewFetcher).toHaveBeenCalledTimes(2);
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

    const aiSearch = await searchTopics({ source: 'nodeseek', query: 'ai', fetcher, nodeSeekAuthenticated: true });
    const codexSearch = await searchTopics({
      source: 'nodeseek',
      query: 'codex',
      fetcher,
      nodeSeekAuthenticated: true
    });

    expect(aiSearch.items.map((item) => item.id)).toEqual(['809']);
    expect(codexSearch.items.map((item) => item.id)).toEqual(['810']);
    expect(normalFetcher).toHaveBeenCalledTimes(2);
    expect(webViewFetcher).not.toHaveBeenCalled();
    const normalCalls = normalFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(normalCalls[0]?.[0]).toBe('https://www.nodeseek.com/search?q=ai');
    expect(normalCalls[1]?.[0]).toBe('https://www.nodeseek.com/search?q=codex');
  });

  it('uses direct fetch for empty NodeSeek search pages that include challenge scripts', async () => {
    const normalFetcher = vi.fn(async () =>
      html(`
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
      <form action="/search"><input name="q" value="missing"></form>
      <div class="post-list"></div>
      <div class="empty-state">没有找到相关内容</div>
    `)
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743017-1">NodeSeek WebView search row</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'missing', fetcher, nodeSeekAuthenticated: true });

    expect(result.items).toEqual([]);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('uses the NodeSeek WebView fallback when soft challenge markers have no readable content', async () => {
    const normalFetcher = vi.fn(async () =>
      html('<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>')
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-743018-1">soft challenge WebView search result</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'soft', fetcher, nodeSeekAuthenticated: true });

    expect(result.items.map((item) => item.id)).toEqual(['743018']);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the NodeSeek WebView fallback for search only after Cloudflare', async () => {
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><title>Just a moment...</title><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      html(`
      <ul class="post-list">
        <li class="post-list-item">
          <div class="post-title"><a href="/post-811-1">cf WebView search result</a></div>
          <div class="post-info"><time datetime="2026-05-21T00:00:00.000Z"></time></div>
        </li>
      </ul>
    `)
    );
    const fetcher = createNodeSeekWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const result = await searchTopics({ source: 'nodeseek', query: 'cf', fetcher, nodeSeekAuthenticated: true });

    expect(result.items.map((item) => item.id)).toEqual(['811']);
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(webViewCalls[0]?.[0]).toBe('https://www.nodeseek.com/search?q=cf');
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

  it('reads V2EX public JSON, HTML pages, topic detail, and SOV2EX search directly', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://www.v2ex.com/?tab=all') {
        return html(
          '<div class="cell item"><a href="/member/neo"><img class="avatar" src="//cdn.v2ex.com/a.png" alt="neo"></a><span class="item_title"><a class="topic-link" href="/t/121#reply3">V2EX latest</a></span><span class="topic_info"><a class="node" href="/go/create">分享创造</a> &nbsp;•&nbsp; <strong><a href="/member/neo">neo</a></strong> &nbsp;•&nbsp; <span title="2026-05-28 20:35:00 +08:00"></span></span><td width="70" align="right"><a href="/t/121#reply3" class="count_livid">3</a></td></div><a href="/recent">更多新主题</a>'
        );
      }
      if (input.includes('/api/topics/latest.json')) {
        return json([
          {
            id: 121,
            title: 'V2EX latest',
            url: 'https://www.v2ex.com/t/121',
            created: 1780000000,
            last_touched: 1780000100,
            replies: 3,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo', avatar_normal: '//cdn.v2ex.com/a.png' },
            content: 'latest body'
          }
        ]);
      }
      if (input.includes('/recent?p=2')) {
        return html(
          '<div class="cell"><a class="topic-link" href="/t/122#reply1">V2EX page 2</a><a class="node" href="/go/create">分享创造</a><a href="/member/bob">bob</a><span title="2026-05-20 10:00:00"></span><a class="count_livid">1</a></div><a href="/recent?p=3">下一页</a>'
        );
      }
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 121,
            title: 'V2EX detail',
            url: 'https://www.v2ex.com/t/121',
            created: 1780000000,
            replies: 1,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' },
            content_rendered: '<p>detail</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([{ member: { username: 'bob' }, content_rendered: '<p>reply</p>', created: 1780000200 }]);
      }
      if (input.includes('sov2ex.com')) {
        return json({
          hits: {
            hits: [
              {
                _source: { id: 121, title: 'V2EX search', member: 'neo', created: '2026-05-20T00:00:00', replies: 1 },
                highlight: { title: ['V2EX search'] }
              }
            ]
          }
        });
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
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).not.toMatch(
      /\/api\/feed|http:\/\/10\.0\.2\.2|http:\/\/127\.0\.0\.1:3000/
    );
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
        return json([
          {
            id: 701,
            title: 'Fresh V2EX topic',
            url: 'https://www.v2ex.com/t/701',
            created: 1780000500,
            last_touched: 1780000000,
            replies: 0,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' }
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      if (input === 'https://www.v2ex.com/t/701') {
        return html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":0}
            ]}
          </script>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '701', fetcher });

    expect(topic).toMatchObject({
      createdAt: '2026-05-28T20:35:00.000Z',
      lastReplyAt: '2026-05-28T20:35:00.000Z',
      replyCount: 0,
      replies: [],
      replyHasMore: false,
      replyNextPage: null
    });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=701&page=1'
    );
  });

  it('enriches V2EX topic details from the origin HTML without login-only actions', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 810,
            title: 'V2EX enriched detail',
            url: 'https://www.v2ex.com/t/810',
            created: 1780000000,
            last_touched: 1780000200,
            replies: 1,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          { id: 7001, member: { username: 'alice' }, content_rendered: '<p>first reply</p>', created: 1780000100 },
          {
            id: 7002,
            member: { username: 'neo' },
            content_rendered: '@<a href="/member/alice">alice</a> answer',
            created: 1780000200
          }
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
          <div id="r_7001" class="cell"><img class="avatar" src="//cdn.v2ex.com/alice.png"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><span class="ago" title="2026-05-28 10:01:40 +08:00">1h ago</span><div class="reply_content">first reply</div></div>
          <div id="r_7002" class="cell"><img class="avatar" src="//cdn.v2ex.com/neo.png"><span class="no">2</span><strong><a href="/member/neo">neo</a></strong><span class="ago" title="2026-05-28 10:03:20 +08:00">1h ago</span><span class="small fade"><img src="/static/img/heart_20250818.png" alt="heart"> 2</span><div class="reply_content">@<a href="/member/alice">alice</a> answer</div></div>
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
      replyTarget: { author: { name: 'alice', username: 'alice' } },
      thanksCount: 2
    });
  });

  it('[REG-TOPIC-069] trusts a complete V2EX origin reply snapshot over stale public JSON caches', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 817,
            title: 'V2EX active reply race',
            url: 'https://www.v2ex.com/t/817',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          { id: 8201, member: { username: 'alice' }, content_rendered: '<p>first stale reply</p>' },
          { id: 8202, member: { username: 'bob' }, content_rendered: '<p>second stale reply</p>' }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/817') {
        return html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":3}
            ]}
          </script>
          <div id="r_8201" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first current reply</div></div>
          <div id="r_8202" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second current reply</div></div>
          <div id="r_8203" class="cell"><span class="no">3</span><strong><a href="/member/carol">carol</a></strong><div class="reply_content">third current reply</div></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '817', fetcher });

    expect(topic.replyCount).toBe(3);
    expect(topic.replies.map(({ commentId, floor }) => [commentId, floor])).toEqual([
      [8201, 1],
      [8202, 2],
      [8203, 3]
    ]);
    expect(sourceDiagnosticSummary(topic)).toMatchObject({ parserVariant: 'html-topic', partialErrorCount: 0 });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=817&page=1'
    );
  });

  it('[REG-TOPIC-071] resolves query-relative same-topic V2EX pages into one complete reply collection', async () => {
    const rows = (firstFloor: number, lastFloor: number) =>
      Array.from({ length: lastFloor - firstFloor + 1 }, (_, index) => firstFloor + index)
        .map(
          (floor) => `
            <div id="r_${90000 + floor}" class="cell">
              <span class="no">${floor}</span>
              <strong><a href="/member/user-${floor}">user-${floor}</a></strong>
              <div class="reply_content">reply ${floor}</div>
            </div>
          `
        )
        .join('');
    let replyApiCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 1231874,
            title: 'V2EX paged replies',
            url: 'https://www.v2ex.com/t/1231874',
            created: 1780000000,
            replies: 107,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        replyApiCalls += 1;
        throw new Error('public replies API must not run');
      }
      if (input === 'https://www.v2ex.com/t/1231874') {
        return html(`
          <script type="application/ld+json">{"commentCount":107,"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":107}]}</script>
          ${rows(1, 100)}
          <a href="?p=2">2</a>
        `);
      }
      if (input === 'https://www.v2ex.com/t/1231874?p=2') {
        return html(`
          <script type="application/ld+json">{"commentCount":107,"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":107}]}</script>
          ${rows(101, 107)}
          <a href="?p=1">1</a>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '1231874', fetcher });

    expect(topic.replyCount).toBe(107);
    expect(topic.replies).toHaveLength(107);
    expect(topic.replies.map(({ floor }) => floor)).toEqual(Array.from({ length: 107 }, (_, index) => index + 1));
    expect(topic).toMatchObject({ replyHasMore: false, replyNextPage: null });
    expect(replyApiCalls).toBe(0);
    expect(fetcher.mock.calls.map(([input]) => input)).toContain('https://www.v2ex.com/t/1231874?p=2');
  });

  it.each([
    {
      name: 'a changed reply declaration on page two',
      firstLink: '/t/1231875?p=2',
      secondCount: 108,
      secondFloors: Array.from({ length: 7 }, (_, index) => index + 101),
      expectedPageCalls: 1
    },
    {
      name: 'a missing floor after the explicit links are exhausted',
      firstLink: '/t/1231875?p=2',
      secondCount: 107,
      secondFloors: [101, 102, 103, 104, 106, 107],
      expectedPageCalls: 1
    },
    {
      name: 'an external pagination link',
      firstLink: 'https://example.com/t/1231875?p=2',
      secondCount: 107,
      secondFloors: Array.from({ length: 7 }, (_, index) => index + 101),
      expectedPageCalls: 0
    }
  ])('[REG-TOPIC-071] rejects $name without using the replies API', async (scenario) => {
    const rows = (floors: number[]) =>
      floors
        .map(
          (floor) => `
            <div id="r_${91000 + floor}" class="cell">
              <span class="no">${floor}</span>
              <strong><a href="/member/user-${floor}">user-${floor}</a></strong>
              <div class="reply_content">reply ${floor}</div>
            </div>
          `
        )
        .join('');
    let replyApiCalls = 0;
    let pageCalls = 0;
    const declaration = (count: number) => `
      <script type="application/ld+json">{"commentCount":${count},"interactionStatistic":[{"interactionType":"https://schema.org/ReplyAction","userInteractionCount":${count}}]}</script>
    `;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 1231875,
            title: 'V2EX invalid paged replies',
            url: 'https://www.v2ex.com/t/1231875',
            created: 1780000000,
            replies: 107,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        replyApiCalls += 1;
        return json([]);
      }
      if (input === 'https://www.v2ex.com/t/1231875') {
        return html(`
          ${declaration(107)}
          ${rows(Array.from({ length: 100 }, (_, index) => index + 1))}
          <a href="${scenario.firstLink}">2</a>
        `);
      }
      if (input === 'https://www.v2ex.com/t/1231875?p=2') {
        pageCalls += 1;
        return html(`${declaration(scenario.secondCount)}${rows(scenario.secondFloors)}`);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getTopic({ source: 'v2ex', id: '1231875', fetcher })).rejects.toThrow(
      'V2EX 回复总数已变化，无法确认完整集合'
    );
    expect(replyApiCalls).toBe(0);
    expect(pageCalls).toBe(scenario.expectedPageCalls);
  });

  it('[REG-TOPIC-067][REG-TOPIC-069] rejects extra malformed V2EX reply nodes hidden by normalization', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 820,
            title: 'V2EX malformed reply node',
            url: 'https://www.v2ex.com/t/820',
            created: 1780000000,
            replies: 1,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([{ id: 7501, member: { username: 'alice' }, content_rendered: '<p>first</p>' }]);
      }
      if (input === 'https://www.v2ex.com/t/820') {
        return html(`
          <script type="application/ld+json">
            {"commentCount":1,"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":1}
            ]}
          </script>
          <div id="r_7501" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_7502" class="cell"><span class="no">2</span></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getTopic({ source: 'v2ex', id: '820', fetcher })).rejects.toThrow('回复总数已变化');
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=820&page=1'
    );
  });

  it('[REG-TOPIC-069] accepts a self-consistent V2EX commentCount-only reply snapshot', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 821,
            title: 'V2EX commentCount reply snapshot',
            url: 'https://www.v2ex.com/t/821',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        throw new Error('public replies API must not run');
      }
      if (input === 'https://www.v2ex.com/t/821') {
        return html(`
          <script type="application/ld+json">{"commentCount":"3"}</script>
          <div id="r_7601" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_7602" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
          <div id="r_7603" class="cell"><span class="no">3</span><strong><a href="/member/carol">carol</a></strong><div class="reply_content">third</div></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '821', fetcher });

    expect(topic.replyCount).toBe(3);
    expect(topic.replies.map(({ floor }) => floor)).toEqual([1, 2, 3]);
    expect(sourceDiagnosticSummary(topic)).toMatchObject({ parserVariant: 'html-topic' });
  });

  it('[REG-TOPIC-067][REG-TOPIC-069] rejects conflicting V2EX reply declarations', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 822,
            title: 'V2EX conflicting reply declarations',
            url: 'https://www.v2ex.com/t/822',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      if (input === 'https://www.v2ex.com/t/822') {
        return html(`
          <script type="application/ld+json">
            {"commentCount":3,"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":2}
            ]}
          </script>
          <div id="r_7701" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_7702" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getTopic({ source: 'v2ex', id: '822', fetcher })).rejects.toThrow('回复总数已变化');
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=822&page=1'
    );
  });

  it('[REG-TOPIC-067] rejects a V2EX reply collection shorter than the authoritative topic count', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 816,
            title: 'V2EX reply race',
            url: 'https://www.v2ex.com/t/816',
            created: 1780000000,
            replies: 3,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          { id: 8101, member: { username: 'alice' }, content_rendered: '<p>first</p>', created: 1780000100 },
          { id: 8102, member: { username: 'bob' }, content_rendered: '<p>second</p>', created: 1780000200 }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/816') {
        return html(`
          <script type="application/ld+json">
            {"interactionStatistic":[
              {"interactionType":"https://schema.org/ReplyAction","userInteractionCount":3}
            ]}
          </script>
          <div id="r_8101" class="cell"><span class="no">1</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">first</div></div>
          <div id="r_8102" class="cell"><span class="no">2</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content">second</div></div>
        `);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getTopic({ source: 'v2ex', id: '816', fetcher })).rejects.toThrow('回复总数已变化');
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=816&page=1'
    );
  });

  it('REG-TOPIC-016 keeps the V2EX thanks count when an icon attribute contains a quoted greater-than sign', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 815,
            title: 'V2EX quoted icon attribute',
            url: 'https://www.v2ex.com/t/815',
            created: 1780000000,
            replies: 1,
            member: { username: 'neo' }
          }
        ]);
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
        return json([
          {
            id: 814,
            title: 'V2EX malformed reply target',
            url: 'https://www.v2ex.com/t/814',
            created: 1780000000,
            replies: 1,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      if (input === 'https://www.v2ex.com/t/814') {
        return html(
          '<div id="r_8001" class="cell"><span class="no">1</span><div class="reply_content">@<a href="/member/%E0%A4%A">bad</a> reply</div></div>'
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '814', fetcher });

    expect(topic.replies[0]).toMatchObject({ commentId: 8001, floor: 1 });
    expect(topic.replies[0].replyTarget).toBeUndefined();
  });

  it('uses a complete legacy V2EX HTML reply collection without the replies API', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 811,
            title: 'V2EX fallback detail',
            url: 'https://www.v2ex.com/t/811',
            created: 1780000000,
            replies: 2,
            node: { name: 'create', title: '分享创造' },
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ]);
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
      replyTarget: { author: { name: 'alice', username: 'alice' } },
      thanksCount: 3
    });
    expect(sourceDiagnosticSummary(topic)).toMatchObject({
      parserVariant: 'html-topic-fallback',
      partialErrorCount: 0
    });
    expect(fetcher.mock.calls.map(([input]) => input)).not.toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=811&page=1'
    );
  });

  it('[REG-TOPIC-069] falls back to the V2EX replies API only after the origin HTML request fails', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 812,
            title: 'V2EX API fallback detail',
            url: 'https://www.v2ex.com/t/812',
            created: 1780000000,
            replies: 2,
            member: { username: 'neo' },
            content_rendered: '<p>detail body</p>'
          }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/812') {
        throw new Error('origin HTML unavailable');
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          {
            id: 7201,
            member: { username: 'alice' },
            content_rendered: '<p>first API reply</p>',
            created: 1780000100
          },
          {
            id: 7202,
            member: { username: 'bob' },
            content_rendered: '<p>second API reply</p>',
            created: 1780000200
          }
        ]);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '812', fetcher });

    expect(topic.replyCount).toBe(2);
    expect(topic.replies.map(({ author, commentId, floor }) => ({ author, commentId, floor }))).toEqual([
      { author: 'alice', commentId: 7201, floor: 1 },
      { author: 'bob', commentId: 7202, floor: 2 }
    ]);
    expect(sourceDiagnosticSummary(topic)).toMatchObject({
      parserVariant: 'api-topic-fallback',
      partialErrorCount: 1
    });
    expect(fetcher.mock.calls.map(([input]) => input)).toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=812&page=1'
    );
  });

  it('[REG-TOPIC-069] confirms an empty V2EX API fallback after the origin HTML request fails', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 818,
            title: 'V2EX empty API fallback',
            url: 'https://www.v2ex.com/t/818',
            created: 1780000000,
            replies: 0,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/818') {
        throw new Error('origin HTML unavailable');
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '818', fetcher });

    expect(topic).toMatchObject({ replyCount: 0, replies: [], replyHasMore: false, replyNextPage: null });
    expect(sourceDiagnosticSummary(topic)).toMatchObject({
      parserVariant: 'api-topic-fallback',
      partialErrorCount: 1
    });
    expect(fetcher.mock.calls.map(([input]) => input)).toContain(
      'https://www.v2ex.com/api/replies/show.json?topic_id=818&page=1'
    );
  });

  it('[REG-TOPIC-067][REG-TOPIC-069] rejects a nonempty V2EX API fallback against a zero topic count', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 823,
            title: 'V2EX stale zero topic count',
            url: 'https://www.v2ex.com/t/823',
            created: 1780000000,
            replies: 0,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/823') {
        throw new Error('origin HTML unavailable');
      }
      if (input.includes('/api/replies/show.json')) {
        return json([{ id: 7801, member: { username: 'alice' }, content_rendered: '<p>newer reply</p>' }]);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getTopic({ source: 'v2ex', id: '823', fetcher })).rejects.toThrow('回复总数已变化');
  });

  it('[REG-TOPIC-069] selects a matching empty V2EX API fallback over unproven HTML rows', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 819,
            title: 'V2EX empty API fallback with legacy HTML',
            url: 'https://www.v2ex.com/t/819',
            created: 1780000000,
            replies: 0,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/819') {
        return html(`
          <div id="r_7401" class="cell">
            <span class="no">1</span>
            <strong><a href="/member/alice">alice</a></strong>
            <div class="reply_content">unproven HTML reply</div>
          </div>
        `);
      }
      if (input.includes('/api/replies/show.json')) {
        return json([]);
      }
      throw new Error(`unexpected ${input}`);
    });

    const topic = await getTopic({ source: 'v2ex', id: '819', fetcher });

    expect(topic).toMatchObject({ replyCount: 0, replies: [], replyHasMore: false, replyNextPage: null });
    expect(sourceDiagnosticSummary(topic)).toMatchObject({
      parserVariant: 'api-topic-fallback',
      partialErrorCount: 0
    });
  });

  it('[REG-TOPIC-067][REG-TOPIC-069] rejects an incomplete V2EX replies API fallback', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json')) {
        return json([
          {
            id: 813,
            title: 'V2EX incomplete API fallback',
            url: 'https://www.v2ex.com/t/813',
            created: 1780000000,
            replies: 3,
            member: { username: 'neo' }
          }
        ]);
      }
      if (input === 'https://www.v2ex.com/t/813') {
        throw new Error('origin HTML unavailable');
      }
      if (input.includes('/api/replies/show.json')) {
        return json([
          { id: 7301, member: { username: 'alice' }, content_rendered: '<p>first</p>' },
          { id: 7302, member: { username: 'bob' }, content_rendered: '<p>second</p>' }
        ]);
      }
      throw new Error(`unexpected ${input}`);
    });

    await expect(getTopic({ source: 'v2ex', id: '813', fetcher })).rejects.toThrow('回复总数已变化');
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
        return html(
          `${Array.from({ length: 20 }, (_, index) => item(900 - index, `all ${index}`, `2026-05-20 00:${String(59 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent">更多新主题</a>`
        );
      }
      if (input === 'https://www.v2ex.com/recent?p=1') {
        return html(
          `${Array.from({ length: 20 }, (_, index) => item(850 - index, `recent p1 ${index}`, `2026-05-20 00:${String(39 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent?p=2">下一页</a>`
        );
      }
      if (input === 'https://www.v2ex.com/recent?p=2') {
        return html(
          `${Array.from({ length: 20 }, (_, index) => item(800 - index, `recent p2 ${index}`, `2026-05-19 23:${String(59 - index).padStart(2, '0')}:00`)).join('')}<a href="/recent?p=3">下一页</a>`
        );
      }
      if (input === 'https://www.v2ex.com/recent?p=3') {
        return html(
          Array.from({ length: 20 }, (_, index) =>
            item(700 - index, `recent p3 ${index}`, `2026-05-19 22:${String(59 - index).padStart(2, '0')}:00`)
          ).join('')
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'v2ex', limit: 30, fetcher });
    const second = await getFeed({
      source: 'v2ex',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 30,
      fetcher
    });

    expect(first.items).toHaveLength(20);
    expect(second.items.map((topic) => topic.id).slice(0, 3)).toEqual(['850', '849', '848']);
    expect(fetcher.mock.calls.map((call) => call[0])).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('reads V2EX search hits when SOV2EX returns a top-level hits array', async () => {
    const fetcher = vi.fn(async () =>
      json({
        total: 1,
        hits: [
          {
            _source: {
              id: 934576,
              title: 'GPT search result',
              member: 'neo',
              created: '2026-05-20T00:00:00',
              replies: 2
            },
            highlight: { title: ['GPT search result'] }
          }
        ]
      })
    );

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
          hits: [
            {
              _source: {
                id: from === '0' ? 934576 : 934577,
                title: from === '0' ? 'GPT first V2EX result' : 'GPT second V2EX result',
                member: 'neo',
                created: '2026-05-20T00:00:00',
                replies: 2
              }
            }
          ]
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
    const calls = fetcher.mock.calls as unknown as [string, unknown?][];
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

    const url = new URL((fetcher.mock.calls as unknown as [string][])[0]?.[0] || '');
    expect(url.searchParams.get('sort')).toBe('created');
    expect(url.searchParams.get('order')).toBe('0');
    expect(url.searchParams.get('node')).toBe('qna');
    expect(url.searchParams.get('username')).toBe('neo');
    expect(url.searchParams.get('operator')).toBe('and');
    expect(url.searchParams.get('gte')).toBe(String(Math.floor(new Date('2026-06-04T02:00:00.000Z').getTime() / 1000)));
  });

  it('passes linux.do site filters through Discourse search syntax', async () => {
    const fetcher = vi.fn(async (input: string) =>
      input.includes('/session/csrf.json') ? json({ csrf: 'csrf-token' }) : json({ topics: [], posts: [] })
    );

    await searchTopics({
      source: 'linuxdo',
      query: 'AI',
      discourseAuth: testLinuxDoDiscourseAuth(),
      linuxDoAuthenticated: true,
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

    const url = new URL(
      (fetcher.mock.calls as unknown as [string][]).find((call) => new URL(call[0]).pathname === '/search')?.[0] || ''
    );
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

  it('tags linux.do Cloudflare topic errors so the app can open verification', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );

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
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const normalFetcher = vi.fn(
      async () =>
        new Response('<html><div class="cf-turnstile"></div></html>', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
    const webViewFetcher = vi.fn(async () =>
      json({
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
      })
    );
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const topic = await getTopic({ source: 'linuxdo', id: '42', fetcher });

    expect(topic.title).toBe('linux.do WebView fallback topic');
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(webViewCalls[0]?.[0]).toBe('https://linux.do/t/42.json');
    const events = lines.map((line) => JSON.parse(line)).filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', source: 'linuxdo', reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', status: 403, reason: 'verification_required' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', status: 200 }),
      expect.objectContaining({ phase: 'finish', outcome: 'success', channel: 'webview' })
    ]);
    expect(JSON.stringify(events)).not.toMatch(/\/t\/42|https?:|cf-turnstile/);
  });

  it('[REG-LINUXDO-008] recovers a stalled read channel at eight seconds and retries only once', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    try {
      const defaultFetcher = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      );
      const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 4 }));
      const fetcher = createLinuxDoWebViewFallbackFetcher({
        defaultFetcher,
        recoverReadChannel,
        webViewFetcher: vi.fn() as never
      });
      const request = fetcher('https://linux.do/latest.json', { signal: controller.signal });

      await vi.advanceTimersByTimeAsync(8_000);
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);
      expect(defaultFetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(defaultFetcher).toHaveBeenCalledTimes(2);
      controller.abort();

      await expect(request).rejects.toBeTruthy();
    } finally {
      controller.abort();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-LINUXDO-008] returns the single retry response after read-channel recovery', async () => {
    vi.useFakeTimers();
    try {
      const defaultFetcher = vi
        .fn<(input: string, init?: RequestInit) => Promise<Response>>()
        .mockImplementationOnce(() => new Promise<Response>(() => undefined))
        .mockResolvedValueOnce(json({ topic_list: { topics: [] } }));
      const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 5 }));
      const fetcher = createLinuxDoWebViewFallbackFetcher({
        defaultFetcher,
        recoverReadChannel,
        webViewFetcher: vi.fn() as never
      });
      const request = fetcher('https://linux.do/latest.json');

      await vi.advanceTimersByTimeAsync(8_000);

      await expect(request).resolves.toMatchObject({ status: 200 });
      expect(defaultFetcher).toHaveBeenCalledTimes(2);
      expect(recoverReadChannel).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-LINUXDO-008] excludes cancellation, writes, HTTP failures and Cloudflare from channel recovery', async () => {
    const recoverReadChannel = vi.fn(async () => ({ ok: true, generation: 6 }));
    const controller = new AbortController();
    const canceledFetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      ),
      recoverReadChannel,
      webViewFetcher: vi.fn() as never
    });
    const responseFetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async (input: string) =>
        input.endsWith('/challenge')
          ? new Response('<div class="cf-turnstile"></div>', {
              status: 403,
              headers: { 'cf-mitigated': 'challenge' }
            })
          : new Response('ordinary failure', { status: 429 })
      ),
      recoverReadChannel,
      webViewFetcher: vi.fn(async () => html('<html>verified</html>'))
    });
    const canceled = canceledFetcher('https://linux.do/latest.json', { signal: controller.signal });
    controller.abort();

    await expect(canceled).rejects.toBeTruthy();
    await responseFetcher('https://linux.do/challenge');
    await responseFetcher('https://linux.do/rate-limited');
    await responseFetcher('https://linux.do/posts', { method: 'POST', body: 'value' });

    expect(recoverReadChannel).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-007] settles the canonical Account probe through one hidden read after a direct network error', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const normalFetcher = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const webViewFetcher = vi.fn(async () =>
      json({
        current_user: {
          id: 42,
          username: 'alice',
          name: 'Alice'
        }
      })
    );
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: normalFetcher,
      webViewFetcher
    });

    const currentUser = await getLinuxDoCurrentUserProfile({ fetcher });

    expect(currentUser).toMatchObject({ source: 'linuxdo', username: 'alice' });
    expect(normalFetcher).toHaveBeenCalledTimes(1);
    expect(webViewFetcher).toHaveBeenCalledTimes(1);
    const webViewCalls = webViewFetcher.mock.calls as unknown as [string, RequestInit?][];
    expect(browserFetchIntentFromInit(webViewCalls[0]?.[1])).toEqual({
      owner: 'account',
      priority: 'background'
    });
    const events = lines.map((line) => JSON.parse(line)).filter(({ operation }) => operation === 'transport-fallback');
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent', channel: 'direct', owner: 'account', reason: 'network_error' }),
      expect.objectContaining({ phase: 'transport', channel: 'direct', owner: 'account', reason: 'network_error' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', owner: 'account', state: 'start' }),
      expect.objectContaining({ phase: 'transport', channel: 'webview', owner: 'account', status: 200 }),
      expect.objectContaining({ phase: 'finish', channel: 'webview', owner: 'account', outcome: 'success' })
    ]);
    expect(
      JSON.stringify(events, (key, value) =>
        ['time', 'appSessionId', 'traceId', 'durationMs'].includes(key) ? undefined : value
      )
    ).not.toMatch(/session\/current|https?:|cookie|alice|42/iu);
  });

  it('[REG-LINUXDO-007] preserves trusted CF evidence returned by the hidden Account probe', async () => {
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(
        async () =>
          new Response('<div class="cf-turnstile"></div>', {
            status: 403,
            headers: { 'cf-mitigated': 'challenge' }
          })
      )
    });

    const error = await getLinuxDoCurrentUserProfile({ fetcher }).catch((caught) => caught);

    expect(isLinuxDoCloudflareError(error)).toBe(true);
  });

  it('[REG-LINUXDO-007] keeps an ordinary hidden Account failure ordinary', async () => {
    const hiddenError = new Error('hidden renderer unavailable');
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw new TypeError('Network request failed');
      }),
      webViewFetcher: vi.fn(async () => {
        throw hiddenError;
      })
    });

    await expect(getLinuxDoCurrentUserProfile({ fetcher })).rejects.toBe(hiddenError);
  });

  it.each([
    [
      'timeout',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'background' } as const,
      new Error('请求超时'),
      'GET'
    ],
    [
      'cancel',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'background' } as const,
      new Error('请求已取消'),
      'GET'
    ],
    [
      'foreground Account',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'foreground' } as const,
      new TypeError('Network request failed'),
      'GET'
    ],
    [
      'topic owner',
      'https://linux.do/session/current.json',
      { owner: 'topic', priority: 'foreground' } as const,
      new TypeError('Network request failed'),
      'GET'
    ],
    [
      'other URL',
      'https://linux.do/latest.json',
      { owner: 'account', priority: 'background' } as const,
      new TypeError('Network request failed'),
      'GET'
    ],
    [
      'write',
      'https://linux.do/session/current.json',
      { owner: 'account', priority: 'background' } as const,
      new TypeError('Network request failed'),
      'POST'
    ]
  ])('[REG-LINUXDO-007] does not use Account fallback for %s', async (_case, url, intent, directError, method) => {
    const webViewFetcher = vi.fn();
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      defaultFetcher: vi.fn(async () => {
        throw directError;
      }),
      webViewFetcher: webViewFetcher as never
    });

    await expect(fetcher(url, withBrowserFetchIntent({ method }, intent))).rejects.toBe(directError);
    expect(webViewFetcher).not.toHaveBeenCalled();
  });

  it('[REG-TEST-003] keeps linux.do WebView fallback disabled when the runtime disallows it', async () => {
    const direct = new Response('challenge', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge' }
    });
    const webViewFetcher = vi.fn(async () => new Response('private'));
    const fetcher = createLinuxDoWebViewFallbackFetcher({
      allowWebViewFallback: () => false,
      defaultFetcher: vi.fn(async () => direct),
      webViewFetcher
    });

    await expect(fetcher('https://linux.do/latest.json')).resolves.toBe(direct);
    expect(webViewFetcher).not.toHaveBeenCalled();
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
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
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
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
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
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
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
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
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
    const normalFetcher = vi.fn(
      async () =>
        new Response('challenge', {
          status: 429,
          headers: { 'cf-mitigated': 'challenge' }
        })
    );
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
    const fetcher = vi.fn(
      async () =>
        new Response('<html>upstream unavailable</html>', {
          status: 503,
          headers: { 'content-type': 'text/html' }
        })
    );

    await expect(getFeed({ source: 'linuxdo', fetcher })).rejects.toThrow('HTTP 503');
  });

  it('reports malformed linux.do JSON with a readable message', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<html>not json</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        })
    );

    await expect(getFeed({ source: 'linuxdo', fetcher })).rejects.toThrow('linux.do 返回内容格式不正确');
  });

  it('loads selectable linux.do tags with category and current selections', async () => {
    const fetcher = vi.fn(async () =>
      json({
        results: [
          { id: '人工智能', name: '人工智能', count: 12 },
          { id: '快问快答', name: '快问快答', count: 3 }
        ]
      })
    );

    const tags = await searchLinuxDoTags({
      query: '人',
      categoryId: '4',
      selectedTags: ['快问快答'],
      limit: 20,
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(tags).toEqual([
      { name: '人工智能', topicCount: 12 },
      { name: '快问快答', topicCount: 3 }
    ]);
    const url = new URL(String((fetcher.mock.calls as unknown as [string][])[0]?.[0]));
    expect(url.pathname).toBe('/tags/filter/search');
    expect(url.searchParams.get('q')).toBe('人');
    expect(url.searchParams.get('categoryId')).toBe('4');
    expect(url.searchParams.getAll('selected_tags[]')).toEqual(['快问快答']);
    expect(url.searchParams.get('limit')).toBe('8');
    expect(url.searchParams.has('filterForInput')).toBe(false);
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Discourse-Logged-In': 'true',
          'User-Agent': 'LinuxDo WebView UA'
        })
      })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('loads selectable linux.do authors without groups', async () => {
    const fetcher = vi.fn(async () =>
      json({
        users: [
          { id: 7, username: 'alice', name: 'Alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' }
        ],
        groups: [{ id: 2, name: 'staff' }]
      })
    );

    const users = await searchLinuxDoUsers({
      term: 'ali',
      categoryId: '4',
      limit: 20,
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(users).toEqual([
      {
        id: '7',
        username: 'alice',
        displayName: 'Alice',
        avatar: 'https://linux.do/user_avatar/linux.do/alice/96/1.png'
      }
    ]);
    const url = new URL(String((fetcher.mock.calls as unknown as [string][])[0]?.[0]));
    expect(url.pathname).toBe('/u/search/users');
    expect(url.searchParams.get('term')).toBe('ali');
    expect(url.searchParams.get('include_groups')).toBe('false');
    expect(url.searchParams.get('category_id')).toBe('4');
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('loads linux.do semantic results with an AI marker', async () => {
    const fetcher = vi.fn(async () =>
      json({
        topics: [
          {
            id: 88,
            title: 'AI semantic result',
            slug: 'ai-semantic-result',
            created_at: '2026-07-17T00:00:00.000Z',
            bumped_at: '2026-07-17T00:00:00.000Z',
            posts_count: 2
          }
        ],
        posts: [{ topic_id: 88, blurb: '[!important]+ semantic match' }],
        users: []
      })
    );

    const result = await searchLinuxDoSemantic('AI tags:人工智能', {
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(result.items).toEqual([
      expect.objectContaining({ id: '88', excerpt: 'semantic match', isAiGenerated: true })
    ]);
    expect(result.hasMore).toBe(false);
    expect(result.nextPage).toBeNull();
    const url = new URL(String((fetcher.mock.calls as unknown as [string][])[0]?.[0]));
    expect(url.pathname).toBe('/discourse-ai/embeddings/semantic-search');
    expect(url.searchParams.get('q')).toBe('AI tags:人工智能');
  });

  it('keeps a zero-result linux.do semantic response distinct from an API failure', async () => {
    const fetcher = vi.fn(async () => json({ topics: [], posts: [], users: [] }));

    const result = await searchLinuxDoSemantic('nothing', {
      fetcher,
      linuxDoAccess: testLinuxDoAccess()
    });

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual({});
    expect(result.hasMore).toBe(false);
  });

  it.each([403, 404, 429])('preserves HTTP %s from the linux.do semantic endpoint', async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [`HTTP ${status}`] }), {
          status,
          headers: { 'content-type': 'application/json' }
        })
    );

    await expect(
      searchLinuxDoSemantic('AI', {
        fetcher,
        linuxDoAccess: testLinuxDoAccess()
      })
    ).rejects.toMatchObject({ status });
  });

  it('preserves a network failure from the linux.do semantic endpoint', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(
      searchLinuxDoSemantic('AI', {
        fetcher,
        linuxDoAccess: testLinuxDoAccess()
      })
    ).rejects.toThrow('network down');
  });
});
