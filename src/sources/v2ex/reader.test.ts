import { describe, expect, it, vi } from 'vitest';

describe('V2EX topic reader', () => {
  it.each(['target', 'newest'] as const)(
    'retains the existing linked-page request boundary for %s reads',
    async (mode) => {
      const pages: number[] = [];
      const fetcher = vi.fn(async (input: string) => {
        const url = new URL(input);
        if (url.pathname !== '/t/555') throw new Error('Unexpected API fallback');
        const page = Number(url.searchParams.get('p') || 1);
        pages.push(page);
        return new Response(
          `<a href="/t/555?p=${page + 1}">下一页</a>` +
            `<div id="r_${page}"><span class="no">${(page - 1) * 100 + 1}</span>` +
            '<strong><a href="/member/alice">alice</a></strong><div class="reply_content">reply</div></div>'
        );
      });
      const { getV2exReplies } = await import('./reader');
      if (mode === 'target') {
        await expect(
          getV2exReplies('555', {
            fetcher,
            position: { kind: 'target', target: { floor: 9999999 } }
          })
        ).rejects.toThrow('目标楼层未找到');
        expect(pages).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
      } else {
        await expect(getV2exReplies('555', { fetcher, order: 'newest' })).resolves.toMatchObject({
          currentPage: 101,
          items: [{ floor: 10001 }]
        });
        expect(pages).toEqual(Array.from({ length: 101 }, (_, index) => index + 1));
      }
    }
  );

  it.each([false, true])(
    'uses only a complete origin count/floor contract as the watermark (conflict: %s)',
    async (conflict) => {
      const html =
        `<script type="application/ld+json">{"commentCount":${conflict ? 1 : 2}}</script>` +
        [1, 2]
          .map(
            (floor) =>
              `<div id="r_${floor}"><span class="no">${floor}</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">reply</div></div>`
          )
          .join('');
      const fetcher = vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('/api/topics/show.json')
          ? new Response(
              JSON.stringify([
                {
                  id: 555,
                  title: 'topic',
                  member: { username: 'alice' },
                  node: { name: 'qna' },
                  replies: 2,
                  content_rendered: '<p>body</p>'
                }
              ])
            )
          : new Response(html)
      );
      const { getV2exTopic } = await import('./reader');
      const detail = await getV2exTopic('555', { fetcher });
      expect(detail.replyWatermark).toBe(conflict ? undefined : 2);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );
  it.each(['initial', 'cursor'] as const)('keeps an ambiguous identity unlocatable in the %s window', async (entry) => {
    const html = [
      [101, 'alice', 6],
      [101, 'alice', 7],
      [102, 'bob', 7],
      [103, 'charlie', 9]
    ]
      .map(
        ([id, author, floor]) =>
          `<div id="r_${id}"><span class="no">${floor}</span><strong><a href="/member/${author}">${author}</a></strong><div class="reply_content">${author} body</div></div>`
      )
      .join('');
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/topics/show.json')
        ? new Response(
            JSON.stringify([
              {
                id: 555,
                title: 'topic',
                member: { username: 'alice' },
                node: { name: 'qna' },
                replies: 3,
                content_rendered: '<p>opening</p>'
              }
            ])
          )
        : new Response(html)
    );
    const { getV2exReplies, getV2exTopic } = await import('./reader');
    const { findReplyLocation } = await import('@/domain/forum/replyLocation');
    const replies =
      entry === 'initial'
        ? (await getV2exTopic('555', { fetcher })).replies
        : (await getV2exReplies('555', { fetcher, position: { kind: 'cursor', page: 1, offset: null } })).items;
    expect(replies).toHaveLength(3);
    expect(replies[0].contentHtml).toContain('alice body');
    expect(findReplyLocation(replies, { floor: 6, expectedAuthorUsername: 'alice' })).toBeUndefined();
    expect(findReplyLocation(replies, { commentId: 101 })).toBeUndefined();
    expect(findReplyLocation(replies, { floor: 7, expectedAuthorUsername: 'bob' })).toBeUndefined();
    expect(findReplyLocation(replies, { commentId: 102 })?.author).toBe('bob');
    expect(findReplyLocation(replies, { floor: 9 })?.author).toBe('charlie');
  });

  it.each(['author', 'floor'] as const)(
    'rejects conflicting %s metadata before reply ID deduplication',
    async (conflict) => {
      const fetcher = vi.fn(
        async () =>
          new Response(
            [
              '<div id="r_101"><span class="no">6</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">reply</div></div>',
              `<div id="r_101"><span class="no">${conflict === 'floor' ? 7 : 6}</span><strong><a href="/member/${conflict === 'author' ? 'bob' : 'alice'}">${conflict === 'author' ? 'bob' : 'alice'}</a></strong><div class="reply_content">reply</div></div>`
            ].join('')
          )
      );
      const { getV2exReplies } = await import('./reader');
      await expect(
        getV2exReplies('555', {
          fetcher,
          position: { kind: 'target', target: { floor: 6, expectedAuthorUsername: 'alice' } }
        })
      ).rejects.toThrow('目标楼层');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it('still deduplicates identical reply identities for an exact location', async () => {
    const reply =
      '<div id="r_101"><span class="no">6</span><strong><a href="/member/alice">alice</a></strong><div class="reply_content">reply</div></div>';
    const { getV2exReplies } = await import('./reader');
    const result = await getV2exReplies('555', {
      fetcher: async () => new Response(reply.repeat(2)),
      position: { kind: 'target', target: { floor: 6, expectedAuthorUsername: 'alice' } }
    });
    expect(result.items).toHaveLength(1);
  });

  it('uses the known page for an explicit floor and validates its author before returning a window', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const page = Number(new URL(String(input)).searchParams.get('p') || 1);
      return new Response(
        `<a href="/t/555?p=2">2</a><a href="/t/555?p=3">3</a>` +
          `<div id="r_${page}"><span class="no">${page === 3 ? 205 : 1}</span>` +
          `<strong><a href="/member/alice">alice</a></strong><div class="reply_content">reply</div></div>`
      );
    });
    const { getV2exReplies } = await import('./reader');
    const result = await getV2exReplies('555', {
      fetcher,
      position: { kind: 'target', target: { floor: 205, expectedAuthorUsername: 'ALICE' } }
    });
    expect(result).toMatchObject({ currentPage: 3, previousPage: 2, items: [{ floor: 205, author: 'alice' }] });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://www.v2ex.com/t/555',
      'https://www.v2ex.com/t/555?p=3'
    ]);
    await expect(
      getV2exReplies('555', {
        fetcher,
        position: { kind: 'target', target: { floor: 205, expectedAuthorUsername: 'bob' } }
      })
    ).rejects.toThrow('目标楼层');
  });
  it('prepares opening and HTML reply content for the shared renderer', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/topics/show.json')
        ? new Response(
            JSON.stringify([
              {
                id: 505,
                title: 'Prepared topic',
                member: { username: 'alice' },
                node: { name: 'qna', title: 'Questions' },
                created: 1780558980,
                replies: 1,
                content_rendered: '<p>正文</p>'
              }
            ]),
            { headers: { 'content-type': 'application/json' } }
          )
        : new Response(
            '<html><body><div id="r_2"><span class="no">1</span><strong><a href="/member/bob">bob</a></strong><div class="reply_content"><p>回复</p></div></div></body></html>',
            { headers: { 'content-type': 'text/html' } }
          )
    );
    const [{ getV2exTopic }, { requirePreparedForumContent }] = await Promise.all([
      import('./reader'),
      import('@/domain/forum/topicContentSplit')
    ]);

    const topic = await getV2exTopic('505', { fetcher });
    const reply = topic.replies[0];

    expect(
      requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
        role: 'opening',
        source: 'v2ex',
        topicId: topic.id
      }).rows
    ).not.toHaveLength(0);
    expect(
      requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
        role: 'reply',
        source: 'v2ex'
      }).rows
    ).not.toHaveLength(0);
  });

  it('projects a private topic page as an access notice', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/topics/show.json')
        ? new Response(
            JSON.stringify([
              {
                id: 404,
                title: 'Private topic',
                member: { username: 'alice' },
                node: { name: 'qna', title: 'Questions' },
                created: 1780558980,
                replies: 0,
                content_rendered: ''
              }
            ]),
            { headers: { 'content-type': 'application/json' } }
          )
        : new Response('<html><body><div id="Main">This topic is private.</div></body></html>', {
            headers: { 'content-type': 'text/html' }
          })
    );
    const { getV2exTopic } = await import('./reader');

    await expect(getV2exTopic('404', { fetcher })).resolves.toMatchObject({
      accessRequirement: { type: 'permission' }
    });
  });
});

describe('V2EX feed continuation', () => {
  const row = (id: number) =>
    `<div class="cell item"><a class="topic-link" href="/t/${id}#reply0">Topic ${id}</a><a class="node" href="/go/create">create</a><a href="/member/neo">neo</a><span title="2026-05-20 00:00:00 +08:00"></span></div>`;

  const recentFeed = (recentPages: number[]) => async (input: string) => {
    const url = new URL(input);
    const page = Number(url.searchParams.get('p') || 1);
    const rows = Array.from({ length: 20 }, (_, index) => row((page - 1) * 20 + index + 1)).join('');
    if (url.searchParams.get('tab') === 'all') return new Response(rows + '<a href="/recent">more</a>');
    recentPages.push(page);
    return new Response(rows + (page < 20 ? `<a href="/recent?p=${page + 1}">next</a>` : ''));
  };
  it('keeps overflow on a latest feed page when the site supplies more rows than the app requests', async () => {
    const { getV2exFeed } = await import('./reader');
    const fetcher = vi.fn(async (input: string) => {
      const page = new URL(input).searchParams.get('p');
      if (page === '1') return new Response(row(1) + row(2) + row(3) + '<a href="/recent?p=2">next</a>');
      if (page === '2') return new Response(row(4) + row(5));
      throw new Error('Unexpected fixture page');
    });
    const options = { fetcher, feedFilter: 'latest' as const, limit: 2 };
    let page = await getV2exFeed(options);
    const ids = page.items.map((item) => item.id);
    for (let index = 0; index < 4 && page.hasMore; index++) {
      page = await getV2exFeed({ ...options, page: page.nextPage!, cursor: page.nextCursor });
      ids.push(...page.items.map((item) => item.id));
    }
    expect(ids).toEqual(['1', '2', '3', '4', '5']);
    expect(page.hasMore).toBe(false);
  });

  it('continues beyond the seen window to the last topic without rescanning earlier pages', async () => {
    const { getV2exFeed } = await import('./reader');
    const recentPages: number[] = [];
    const fetcher = recentFeed(recentPages);
    const ids: string[] = [];
    let result = await getV2exFeed({ fetcher });
    ids.push(...result.items.map((item) => item.id));
    for (let page = 2; page <= 15 && result.hasMore; page++) {
      result = await getV2exFeed({ fetcher, page, cursor: result.nextCursor });
      ids.push(...result.items.map((item) => item.id));
    }
    expect(result.hasMore).toBe(false);
    expect(ids).toEqual(Array.from({ length: 400 }, (_, index) => String(index + 1)));
    expect(recentPages).toEqual([...recentPages].sort((a, b) => a - b));
  });

  it('resumes an older full cursor after its last returned topic', async () => {
    const { getV2exFeed } = await import('./reader');
    const result = await getV2exFeed({
      page: 9,
      cursor: encodeURIComponent(JSON.stringify({ seenIds: Array.from({ length: 200 }, (_, i) => String(i + 31)) })),
      fetcher: recentFeed([])
    });
    expect(result.items.map((item) => item.id)).toEqual(Array.from({ length: 30 }, (_, index) => String(index + 231)));
  });

  it('accepts a legacy cursor and retains at most 200 distinct seen identities', async () => {
    const { getV2exFeed } = await import('./reader');
    const fetcher = vi.fn(
      async () =>
        new Response(Array.from({ length: 205 }, (_, index) => row(index + 1)).join('') + '<a href="/recent">more</a>')
    );
    const result = await getV2exFeed({
      limit: 205,
      cursor: encodeURIComponent(JSON.stringify({ seenIds: ['0'] })),
      fetcher
    });
    expect(result.nextCursor).toBeTruthy();
    expect(JSON.parse(decodeURIComponent(result.nextCursor!))).toMatchObject({
      seenIds: Array.from({ length: 200 }, (_, index) => String(index + 6))
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fills a continuation page with distinct unseen topic identities across overlapping upstream pages', async () => {
    const { getV2exFeed } = await import('./reader');
    const fetcher = vi.fn(async (input: string) => {
      const page = new URL(input).searchParams.get('p');
      if (page === '1') return new Response(row(1) + row(2) + '<a href="/recent?p=2">next</a>');
      if (page === '2') return new Response(row(2) + row(3));
      throw new Error('Unexpected local fixture request ' + input);
    });
    const result = await getV2exFeed({
      page: 2,
      limit: 2,
      cursor: encodeURIComponent(JSON.stringify({ seenIds: ['1'] })),
      fetcher
    });
    expect(result.items.map((item) => item.id)).toEqual(['2', '3']);
    expect(result.hasMore).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects repeated recent pages without exhausting the cursor, then retries it', async () => {
    const { getV2exFeed } = await import('./reader');
    let repeated = true;
    const recentPages: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.searchParams.get('tab') === 'all') return new Response(row(1) + row(2) + '<a href="/recent">more</a>');
      const page = Number(url.searchParams.get('p'));
      recentPages.push(page);
      if (page > 3) throw new Error('Unexpected fixture page');
      const items = repeated || page === 1 ? row(1) + row(2) : row(2) + row(3) + row(4);
      return new Response(items + `<a href="/recent?p=${page + 1}">next</a>`);
    });
    const first = await getV2exFeed({ fetcher, limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['1', '2']);
    const next = { fetcher, limit: 2, page: first.nextPage!, cursor: first.nextCursor };
    await expect(getV2exFeed(next)).rejects.toThrow('V2EX 返回重复的列表');
    expect(recentPages).toEqual([1, 2]);

    repeated = false;
    recentPages.length = 0;
    const retried = await getV2exFeed(next);
    expect(recentPages).toEqual([1, 2]);
    expect(retried.items.map((item) => item.id)).toEqual(['3', '4']);
    expect(retried.nextCursor).toBeTruthy();
  });

  it('shares one deadline across recent pages even when each request completes within it', async () => {
    const { getV2exFeed } = await import('./reader');
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(async (input: string) => {
        const page = Number(new URL(input).searchParams.get('p'));
        if (page > 2) throw new Error('Unexpected fixture page');
        const response = new Response();
        vi.spyOn(response, 'text').mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return row(page) + `<a href="/recent?p=${page + 1}">next</a>`;
        });
        return response;
      });
      const result = getV2exFeed({
        page: 2,
        limit: 2,
        cursor: encodeURIComponent(JSON.stringify({ seenIds: ['1', '2'] })),
        timeoutMs: 50,
        fetcher
      });
      const settlement = result.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(60);
      expect(await settlement).toMatchObject({ name: 'RequestTimeoutError' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the caller cancel non-progressing seen pages without dispatching another page', async () => {
    const { getV2exFeed } = await import('./reader');
    const controller = new AbortController();
    const fetcher = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get('p'));
      if (page === 4) controller.abort();
      return new Response(row(page) + `<a href="/recent?p=${page + 1}">next</a>`);
    });
    await expect(
      getV2exFeed({
        page: 2,
        limit: 2,
        cursor: encodeURIComponent(JSON.stringify({ seenIds: ['1', '2', '3', '4'] })),
        signal: controller.signal,
        fetcher
      })
    ).rejects.toMatchObject({ name: 'RequestCanceledError' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('keeps the first topic payload and stronger access evidence from overlapping continuation rows', async () => {
    const { getV2exFeed } = await import('./reader');
    const fetcher = vi.fn(async (input: string) => {
      if (new URL(input).searchParams.get('p') === '1') {
        return new Response(row(1) + row(2) + '<a href="/recent?p=2">next</a>');
      }
      return new Response(
        row(2).replace('Topic 2', 'Updated title').replace('</div>', '<span>This topic is private.</span></div>') +
          row(3)
      );
    });
    const result = await getV2exFeed({
      page: 2,
      limit: 2,
      cursor: encodeURIComponent(JSON.stringify({ seenIds: ['1'] })),
      fetcher
    });
    expect(result.items.map((item) => item.id)).toEqual(['2', '3']);
    expect(result.items[0]).toMatchObject({
      title: 'Topic 2',
      accessRequirement: { type: 'permission' }
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('preserves verbatim plain text and Markdown summaries in V2EX API and search while extracting HTML content_rendered once', async () => {
    const [{ getV2exTopic }, { searchV2ex }] = await Promise.all([import('./reader'), import('./search')]);

    const topicFetcher = vi.fn(async (input: string) => {
      if (input.includes('/api/topics/show.json?id=801')) {
        return new Response(
          JSON.stringify([
            {
              id: 801,
              title: 'Plain V2EX topic',
              member: { username: 'alice' },
              node: { name: 'qna', title: '问与答' },
              created: 1780000000,
              replies: 0,
              content: 'How to type &copy; &amp; &#128; in Markdown',
              content_rendered: '<p>How to type &amp;copy; &amp;amp; &amp;#128; in Markdown</p>'
            }
          ])
        );
      }
      if (input.includes('/api/topics/show.json?id=802')) {
        return new Response(
          JSON.stringify([
            {
              id: 802,
              title: 'Rendered-only V2EX topic',
              member: { username: 'bob' },
              node: { name: 'qna', title: '问与答' },
              created: 1780000000,
              replies: 0,
              content: '',
              content_rendered: '<p>&amp;copy; &#128; &#0; &#x1F600 &Lt; &Gt; &unknownref;</p>'
            }
          ])
        );
      }
      if (input.includes('/api/replies/show.json')) {
        return new Response(JSON.stringify([]));
      }
      return new Response('<html><body></body></html>');
    });
    const plainTopic = await getV2exTopic('801', { fetcher: topicFetcher });
    const renderedTopic = await getV2exTopic('802', { fetcher: topicFetcher });
    expect(plainTopic.excerpt).toBe('How to type &copy; &amp; &#128; in Markdown');
    expect(renderedTopic.excerpt).toBe('&copy; € \uFFFD 😀 ≪ ≫ &unknownref;');

    const searchFetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            total: 2,
            hits: [
              {
                _source: {
                  id: 803,
                  title: 'V2EX search plain content',
                  member: 'alice',
                  created: '2026-08-15T00:00:00',
                  replies: 1,
                  content: 'How to type &copy; &amp; &#128; in V2EX'
                }
              },
              {
                _source: {
                  id: 804,
                  title: 'V2EX search highlighted content',
                  member: 'bob',
                  created: '2026-08-15T00:00:00',
                  replies: 1,
                  content: 'fallback'
                },
                highlight: { content: ['How to type <em>&copy;</em> and &#128; in V2EX'] }
              }
            ]
          })
        )
    );
    const search = await searchV2ex('copy', { fetcher: searchFetcher });
    expect(search.items[0]?.excerpt).toBe('How to type &copy; &amp; &#128; in V2EX');
    expect(search.items[1]?.excerpt).toBe('How to type &copy; and &#128; in V2EX');
  });
});
