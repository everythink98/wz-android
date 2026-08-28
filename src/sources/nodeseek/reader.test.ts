import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@/platform/network/request';

describe('NodeSeek reader', () => {
  it('refuses anonymous adapter search without a transport call', async () => {
    const fetcher = vi.fn<Fetcher>();
    const { searchNodeSeek } = await import('./reader');

    await expect(searchNodeSeek('Search', { fetcher })).rejects.toMatchObject({
      kind: 'login-required',
      source: 'nodeseek'
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prepares nested pre code markup as code text through the production plan', async () => {
    const expectedCode = 'LAX.AN5.Pro.TINY\n1C2G\n20GB\n1T\n$88.88';
    const page = [
      '<html><head><title>Nested code topic</title></head><body>',
      '<a class="post-title" href="/post-879597-1">Nested code topic</a>',
      '<div class="content-item" data-comment-id="879597">',
      '<div class="author-info"><a class="author-name" href="/space/1">alice</a></div>',
      '<time datetime="2026-08-18T00:00:00.000Z"></time>',
      `<article class="post-content"><pre><code>${expectedCode}</code></pre></article>`,
      '</div></body></html>'
    ].join('');
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const response = new Response(page, { headers: { 'content-type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: String(input) });
      return response;
    });

    const [{ getNodeSeekTopic }, { requirePreparedForumContent }] = await Promise.all([
      import('./reader'),
      import('@/domain/forum/topicContentSplit')
    ]);
    const topic = await getNodeSeekTopic('879597', { fetcher });
    const plan = requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
      polls: topic.polls,
      role: 'opening',
      source: 'nodeseek',
      topicId: topic.id
    });

    expect(topic.contentHtml).toContain(`<pre><code>${expectedCode}</code></pre>`);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({
      copyText: expectedCode,
      runs: [{ text: expectedCode }],
      text: expectedCode,
      type: 'codeBlock'
    });
  });

  it('assigns NodeSeek polls to their content owner and normalizes reply markers in place', async () => {
    const openingPollMarker = 'nsapp://vote?id=100';
    const replyPollMarker = 'nsapp://vote?id=200';
    const stardustMarker = 'nsapp://stardust-receive?member_id=42&ref_id=7&description=Pay&diff=5&onetime=false';
    const page = [
      '<html><head><title>Owned polls</title></head><body>',
      '<a class="post-title" href="/post-128-1">Owned polls</a>',
      '<div class="content-item" data-comment-id="1"><a href="/space/1">alice</a>',
      `<article class="post-content"><p>主题前 <a href="${openingPollMarker}">${openingPollMarker}</a> 主题后</p></article></div>`,
      '<li class="content-item" data-comment-id="2"><a href="/space/2">bob</a><span class="floor">1楼</span>',
      `<div class="post-content"><p>评论前 <a href="/jump/vote">${replyPollMarker}</a> 中间 `,
      `<a href="/jump/stardust">${stardustMarker}</a> 评论后</p></div></li>`,
      '<li class="content-item" data-comment-id="3"><a href="/space/3">carol</a><span class="floor">2楼</span>',
      `<div class="post-content"><p>重复引用 <a href="${replyPollMarker}">${replyPollMarker}</a></p></div></li>`,
      '</body></html>'
    ].join('');
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const url = String(input);
      const pollId = url.match(/\/api\/vote\/info\/(\d+)/)?.[1];
      const response = new Response(
        pollId ? JSON.stringify({ id: pollId, items: [{ id: `${pollId}-a`, text: `选项 ${pollId}` }] }) : page,
        { headers: { 'content-type': pollId ? 'application/json' : 'text/html' } }
      );
      Object.defineProperty(response, 'url', { value: url });
      return response;
    });

    const [{ getNodeSeekTopic }, { requirePreparedForumContent }] = await Promise.all([
      import('./reader'),
      import('@/domain/forum/topicContentSplit')
    ]);
    const topic = await getNodeSeekTopic('128', { fetcher });
    const reply = topic.replies[0];
    const openingRows = requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
      polls: topic.polls,
      role: 'opening',
      source: 'nodeseek',
      topicId: topic.id
    }).rows;
    const replyRows = requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
      polls: reply.polls,
      role: 'reply',
      source: 'nodeseek'
    }).rows;

    expect(topic.polls?.map(({ id }) => id)).toEqual(['100']);
    expect(reply.polls?.map(({ id }) => id)).toEqual(['200']);
    expect(topic.replies[1]?.polls?.map(({ id }) => id)).toEqual(['200']);
    expect(openingRows.filter((row) => row.type === 'poll').map((row) => row.poll.id)).toEqual(['100']);
    expect(replyRows.map((row) => row.type)).toEqual(['richText', 'poll', 'richText']);
    expect(replyRows.some((row) => 'html' in row && row.html.includes('<forum-nodeseek-stardust'))).toBe(true);
    expect(reply.contentHtml).toContain('<forum-nodeseek-stardust member-id="42"');
    expect(reply.contentHtml).not.toContain('nsapp://');
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/api/vote/info/100'))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/api/vote/info/200'))).toHaveLength(1);
  });

  it('leaves code and href-only vote markers inert without fetching fake polls', async () => {
    const codeMarker = 'nsapp://vote?id=99';
    const hrefOnlyMarker = 'nsapp://vote?id=100';
    const page = [
      '<html><head><title>Inert polls</title></head><body>',
      '<a class="post-title" href="/post-129-1">Inert polls</a>',
      '<div class="content-item" data-comment-id="1"><a href="/space/1">alice</a>',
      `<article class="post-content"><pre><code>${codeMarker}</code></pre>`,
      `<p><a href="${hrefOnlyMarker}">普通链接</a></p></article></div>`,
      '</body></html>'
    ].join('');
    const fetcher = vi.fn<Fetcher>(async (input) => {
      const response = new Response(page, { headers: { 'content-type': 'text/html' } });
      Object.defineProperty(response, 'url', { value: String(input) });
      return response;
    });

    const { getNodeSeekTopic } = await import('./reader');
    const topic = await getNodeSeekTopic('129', { fetcher });

    expect(fetcher.mock.calls.filter(([input]) => String(input).includes('/api/vote/info/'))).toHaveLength(0);
    expect(topic.polls).toBeUndefined();
    expect(topic.contentHtml).toContain(`<code>${codeMarker}</code>`);
    expect(topic.contentHtml).toContain('普通链接');
  });
});
