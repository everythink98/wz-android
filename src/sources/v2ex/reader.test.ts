import { describe, expect, it, vi } from 'vitest';

describe('V2EX topic reader', () => {
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
