import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

import { getCategories, getFeed } from './feedRead';
import { getReplies, getTopic } from './sourceRead';
import { searchTopics } from './searchRead';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';

const nodeSeekPayload = Buffer.from(
  JSON.stringify({
    rotateTopics: [
      {
        postId: 1,
        titleText: 'NodeSeek',
        titleLink: '/post-1-1',
        op: { name: 'alice' },
        time: { createdDate: '2026-05-20T00:00:00.000Z' }
      }
    ],
    allCategory: [{ key: 'tech', cn_text: '技术' }]
  })
).toString('base64');

describe('feed read', () => {
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
    const nodeSeekFeedCall = (fetcher.mock.calls as unknown as [string, RequestInit?][]).find(([input]) =>
      input.includes('nodeseek.com/categories/tech/page-2')
    );
    expect(browserFetchIntentFromInit(nodeSeekFeedCall?.[1])).toMatchObject({
      owner: 'feed',
      priority: 'foreground'
    });
  });

  it('keeps all-source Android feed balanced across local source adapters', async () => {
    const manyNodeSeekTopics = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 4 }, (_, index) => ({
          postId: 200 + index,
          titleText: `NodeSeek ${index}`,
          titleLink: `/post-${200 + index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
        }))
      })
    ).toString('base64');
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        return new Response(`<script>${manyNodeSeekTopics}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 301,
                  title: 'linux.do topic',
                  slug: 'linux-topic',
                  created_at: '2026-05-19T00:00:00.000Z',
                  bumped_at: '2026-05-19T00:00:00.000Z',
                  posts_count: 1
                }
              ]
            },
            users: []
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
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
        return new Response(
          JSON.stringify([
            {
              id: 401,
              title: 'V2EX topic',
              url: 'https://www.v2ex.com/t/401',
              created: '2026-05-18T00:00:00.000Z',
              replies: 0,
              node: { name: 'create', title: '分享创造' },
              member: { username: 'neo' }
            }
          ]),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
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
    const manyNodeSeekTopics = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 4 }, (_, index) => ({
          postId: 100 + index,
          titleText: `NodeSeek ${index + 1}`,
          titleLink: `/post-${100 + index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-20T00:0${index}:00.000Z` }
        }))
      })
    ).toString('base64');
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
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => item.id)).toEqual(['103', '102']);
    expect(second.items.map((item) => item.id)).toEqual(['101', '100']);
    expect(second.items.every((item) => item.source === 'nodeseek')).toBe(true);
  });

  it('keeps NodeSeek next pages available in the aggregated Android feed when the first source page is shorter than the aggregate fetch window', async () => {
    const pageOne = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 201,
            titleText: 'NodeSeek page 1 newer',
            titleLink: '/post-201-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:01:00.000Z' }
          },
          {
            postId: 200,
            titleText: 'NodeSeek page 1 older',
            titleLink: '/post-200-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    const pageTwo = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 199,
            titleText: 'NodeSeek page 2 newer',
            titleLink: '/post-199-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:01:00.000Z' }
          },
          {
            postId: 198,
            titleText: 'NodeSeek page 2 older',
            titleLink: '/post-198-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
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
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

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
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => item.id)).toEqual(['301', '300']);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((item) => item.id)).toEqual(['299', '298']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not over-fetch linux.do pages for the first aggregated Android feed page', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 30 }, (_item, index) => ({
          postId: 600 - index,
          titleText: `NodeSeek ${index}`,
          titleLink: `/post-${600 - index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-20T00:${String(59 - index).padStart(2, '0')}:00.000Z` }
        }))
      })
    ).toString('base64');
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
        return new Response(
          JSON.stringify({
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
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    await getFeed({ source: 'all', limit: 30, fetcher });

    const linuxDoCalls = fetcher.mock.calls
      .map((call) => call[0])
      .filter((input) => input.includes('linux.do/latest.json'));
    expect(linuxDoCalls.length).toBeLessThanOrEqual(2);
    expect(linuxDoCalls.join('\n')).not.toContain('page=2');
  });

  it('refills an exhausted source in the aggregated Android feed even when other source buffers can fill the page', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 400,
            titleText: 'NodeSeek newest',
            titleLink: '/post-400-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:04:30.000Z' }
          },
          {
            postId: 399,
            titleText: 'NodeSeek buffered newer',
            titleLink: '/post-399-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:03:00.000Z' }
          },
          {
            postId: 398,
            titleText: 'NodeSeek buffered older',
            titleLink: '/post-398-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:01:00.000Z' }
          },
          {
            postId: 397,
            titleText: 'NodeSeek buffered oldest',
            titleLink: '/post-397-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-19T00:00:00.000Z' }
          }
        ]
      })
    ).toString('base64');
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
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(first.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:501', 'nodeseek:400']);
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toEqual(['v2ex:500', 'nodeseek:399']);
    expect(fetcher.mock.calls.map((call) => call[0]).join('\n')).toContain('https://www.v2ex.com/recent?p=1');
  });

  it('does not skip V2EX recent page one in the aggregated Android feed', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: Array.from({ length: 30 }, (_item, index) => ({
          postId: 900 - index,
          titleText: `NodeSeek ${index}`,
          titleLink: `/post-${900 - index}-1`,
          op: { name: 'alice' },
          time: { createdDate: `2026-05-19T00:${String(59 - index).padStart(2, '0')}:00.000Z` }
        }))
      })
    ).toString('base64');
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
        return new Response(
          Array.from({ length: 20 }, (_unused, index) =>
            item(
              800 - index,
              `all ${index}`,
              `2026-05-20 00:${String(59 - index).padStart(2, '0')}:00 +08:00`,
              'cell item'
            )
          ).join('') + '<a href="/recent">更多新主题</a>'
        );
      }
      if (input === 'https://www.v2ex.com/recent?p=1') {
        return new Response(
          Array.from({ length: 20 }, (_unused, index) =>
            item(700 - index, `recent p1 ${index}`, `2026-05-20 00:${String(39 - index).padStart(2, '0')}:00`)
          ).join('') + '<a href="/recent?p=2">下一页</a>'
        );
      }
      if (input === 'https://www.v2ex.com/recent?p=2') {
        return new Response(
          Array.from({ length: 20 }, (_unused, index) =>
            item(600 - index, `recent p2 ${index}`, `2026-05-19 23:${String(59 - index).padStart(2, '0')}:00`)
          ).join('')
        );
      }
      throw new Error(`unexpected ${input}`);
    });

    const first = await getFeed({ source: 'all', limit: 30, fetcher });
    await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 30,
      fetcher
    });

    const calls = fetcher.mock.calls.map((call) => call[0]);
    expect(calls.indexOf('https://www.v2ex.com/recent?p=1')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('https://www.v2ex.com/recent?p=2')).toBeGreaterThan(
      calls.indexOf('https://www.v2ex.com/recent?p=1')
    );
  });

  it('retries a failed source on the next aggregated Android feed page', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 700,
            titleText: 'NodeSeek recovered',
            titleLink: '/post-700-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:03:00.000Z' }
          }
        ]
      })
    ).toString('base64');
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
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 710,
                  title: 'linux.do topic',
                  slug: 'linux-do-topic',
                  created_at: '2026-05-20T00:02:00.000Z',
                  posts_count: 1
                }
              ]
            },
            categories: []
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
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
    const second = await getFeed({
      source: 'all',
      page: first.nextPage ?? 2,
      cursor: first.nextCursor ?? undefined,
      limit: 2,
      fetcher
    });

    expect(JSON.stringify(first.errors?.nodeseek)).toContain('NodeSeek temporary failure');
    expect(first.nextCursor).toBeTruthy();
    expect(second.items.map((item) => `${item.source}:${item.id}`)).toContain('nodeseek:700');
    expect(nodeSeekCalls).toBe(2);
  });

  it('[REG-SOURCE-001] skips an unavailable aggregate source and retries its original page after credentials recover', async () => {
    const nodeSeekPage = Buffer.from(
      JSON.stringify({
        rotateTopics: [
          {
            postId: 730,
            titleText: 'NodeSeek credential recovered',
            titleLink: '/post-730-1',
            op: { name: 'alice' },
            time: { createdDate: '2026-05-20T00:03:00.000Z' }
          }
        ]
      })
    ).toString('base64');
    let nodeSeekCalls = 0;
    const fetcher = vi.fn(async (input: string) => {
      if (input.includes('nodeseek.com')) {
        nodeSeekCalls += 1;
        return new Response(`<script>${nodeSeekPage}</script>`);
      }
      if (input.includes('linux.do')) {
        return new Response(
          JSON.stringify({
            topic_list: {
              topics: [
                {
                  id: 740,
                  title: 'linux.do available topic',
                  slug: 'linux-do-available-topic',
                  created_at: '2026-05-20T00:02:00.000Z',
                  posts_count: 1
                }
              ]
            },
            categories: []
          }),
          {
            headers: { 'content-type': 'application/json' }
          }
        );
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
    expect(Object.keys(result.errors || {})).toEqual(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo', 'xiaoyinsi']);
  });

  it('[REG-FEED-014] publishes feed and categories after the active five-second source budget', async () => {
    vi.useFakeTimers();
    const hangingAborts = vi.fn();
    const fetcher = vi.fn((input: string, init?: RequestInit) => {
      if (input.includes('nodeseek.com')) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              hangingAborts();
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      }
      if (input === 'https://www.v2ex.com/?tab=all') {
        return Promise.resolve(
          new Response(
            '<div class="cell item"><a class="topic-link" href="/t/901#reply0">V2EX ready</a><a class="node" href="/go/create">分享创造</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>'
          )
        );
      }
      if (input.includes('/api/topics/latest.json')) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                id: 901,
                title: 'V2EX ready',
                url: 'https://www.v2ex.com/t/901',
                created: '2026-05-20T00:00:00.000Z',
                replies: 0,
                node: { name: 'create', title: '分享创造' },
                member: { username: 'neo' }
              }
            ]),
            { headers: { 'content-type': 'application/json' } }
          )
        );
      }
      return Promise.reject(new Error(`unexpected ${input}`));
    });
    const unavailableSources = ['linuxdo', 'yaohuo', 'xiaoyinsi'] as const;
    const feedController = new AbortController();
    const categoryController = new AbortController();
    let feedResult: Awaited<ReturnType<typeof getFeed>> | undefined;
    let categoryResult: Awaited<ReturnType<typeof getCategories>> | undefined;
    const feedPromise = getFeed({
      source: 'all',
      limit: 2,
      fetcher,
      signal: feedController.signal,
      unavailableSources
    }).then((result) => {
      feedResult = result;
    });
    const categoryPromise = getCategories({
      source: 'all',
      fetcher,
      signal: categoryController.signal,
      unavailableSources
    }).then((result) => {
      categoryResult = result;
    });

    try {
      await vi.advanceTimersByTimeAsync(5_000);
      await Promise.resolve();
      const feedAtBudget = feedResult;
      const categoriesAtBudget = categoryResult;
      if (!feedAtBudget) feedController.abort();
      if (!categoriesAtBudget) categoryController.abort();
      await Promise.allSettled([feedPromise, categoryPromise]);

      expect(feedAtBudget?.items).toEqual([expect.objectContaining({ source: 'v2ex', id: '901' })]);
      expect(feedAtBudget?.errors.nodeseek).toBeTruthy();
      expect(feedAtBudget?.nextCursor).toBeTruthy();
      expect(categoriesAtBudget?.items).toEqual([expect.objectContaining({ source: 'v2ex', id: 'create' })]);
      expect(categoriesAtBudget?.errors.nodeseek).toBeTruthy();
      expect(hangingAborts).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[REG-FEED-014] propagates parent cancellation instead of publishing a partial aggregate', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true
          });
        })
    );
    const request = getFeed({
      source: 'all',
      fetcher,
      signal: controller.signal,
      unavailableSources: ['linuxdo', 'yaohuo', 'xiaoyinsi']
    });

    await Promise.resolve();
    controller.abort();

    await expect(request).rejects.toThrow('请求已取消');
  });

  it('[REG-FEED-014] keeps a timed-out source retryable when every completed source is empty', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((input: string, init?: RequestInit) => {
        if (input.includes('nodeseek.com')) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          });
        }
        if (input.includes('/api/topics/latest.json')) {
          return Promise.resolve(new Response('[]', { headers: { 'content-type': 'application/json' } }));
        }
        if (input === 'https://www.v2ex.com/?tab=all') {
          return Promise.resolve(new Response('<div id="Main"></div>'));
        }
        return Promise.reject(new Error(`unexpected ${input}`));
      });
      const request = getFeed({
        source: 'all',
        fetcher,
        unavailableSources: ['linuxdo', 'yaohuo', 'xiaoyinsi']
      });

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(request).resolves.toMatchObject({
        items: [],
        errors: { nodeseek: expect.anything() },
        hasMore: true,
        nextCursor: expect.any(String)
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('[REG-FEED-014] preserves the current page and opaque source cursor when every source times out', async () => {
    vi.useFakeTimers();
    const sourceCursor = 'opaque-v2ex-seen-ids';
    const cursor = encodeURIComponent(
      JSON.stringify({
        nextPages: { nodeseek: 2, linuxdo: 2, v2ex: 2, yaohuo: 2, xiaoyinsi: 2 },
        sourceCursors: { v2ex: sourceCursor }
      })
    );
    try {
      const fetcher = vi.fn(
        (_input: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
              once: true
            });
          })
      );
      const request = getFeed({ source: 'all', page: 2, cursor, fetcher });

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await request;
      const retryCursor = JSON.parse(decodeURIComponent(result.nextCursor || '')) as {
        nextPages: Record<string, number>;
        sourceCursors: Record<string, string>;
      };

      expect(result.hasMore).toBe(true);
      expect(retryCursor.nextPages).toEqual({ nodeseek: 2, linuxdo: 2, v2ex: 2, yaohuo: 2, xiaoyinsi: 2 });
      expect(retryCursor.sourceCursors.v2ex).toBe(sourceCursor);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
