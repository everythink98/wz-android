import { describe, expect, it, vi } from 'vitest';

describe('V2EX topic reader', () => {
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
