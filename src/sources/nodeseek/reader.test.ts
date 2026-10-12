import { describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '@/platform/network/request';
import { withHtmlDecodedInputBudget, withHtmlWorkBudget } from '../../../tests/helpers/htmlWorkBudget';

describe('NodeSeek reader', () => {
  it('keeps an escaped permission example literal after reading a rendered feed row', async () => {
    const [
      { parseHtml },
      { nodeSeekAccessRequirementFromListRow, parseNodeSeekPageDocument },
      { parseNodeSeekSearchTopics }
    ] = await Promise.all([import('@/domain/forum/html'), import('./protocol'), import('./feedParser')]);
    const row = parseHtml('<div><a>sample</a><span>&amp;#30331;录后可查看</span></div>').querySelector('div')!;
    expect(nodeSeekAccessRequirementFromListRow(row, 'sample')).toBeUndefined();
    const restricted = parseHtml('<div><a>sample</a><span>登录后可查看</span></div>').querySelector('div')!;
    expect(nodeSeekAccessRequirementFromListRow(restricted, 'sample')?.type).toBe('login');
    const search = parseNodeSeekSearchTopics(
      parseNodeSeekPageDocument('<div><a href="/post-1-1">sample</a><span>&amp;#32; &lt;x&gt;</span></div>')
    );
    expect(search.items[0].excerpt).toContain('&#32; <x>');
  });
  it.each([128, 512])('reads deep rendered permissions without revisiting text (%i layers)', async (depth) => {
    const [
      { parseHtml },
      { nodeSeekAccessRequirementFromListRow, parseNodeSeekPageDocument, isNodeSeekChallengeResponse }
    ] = await Promise.all([import('@/domain/forum/html'), import('./protocol')]);
    const samples = [
      { body: `${'<span>'.repeat(depth)}${'&amp;'.repeat(depth)}&amp;#30331;录后可查看${'</span>'.repeat(depth)}` },
      {
        body: `${'<span>'.repeat(depth)}${'&amp;'.repeat(depth)}登录后可查看${'</span>'.repeat(depth)}`,
        type: 'login'
      },
      { body: `${'<span>&amp;ordinary'.repeat(depth)}tail${'</span>'.repeat(depth)}` }
    ];
    for (const { body, type } of samples) {
      const rowHtml = `<div><a>sample</a>${body}</div>`;
      const row = parseHtml(rowHtml).querySelector('div')!;
      const noticeHtml = `<title>Just a moment</title>${body.replaceAll('<span>', '<span class="notice">')}`;
      const document = parseNodeSeekPageDocument(noticeHtml);
      const checks = [
        {
          html: rowHtml,
          root: row,
          read: () => nodeSeekAccessRequirementFromListRow(row, 'sample')?.type,
          expected: type
        },
        {
          html: noticeHtml,
          root: document.root,
          read: () =>
            isNodeSeekChallengeResponse(
              { status: 200, headers: new Headers({ 'content-type': 'text/html' }) },
              noticeHtml,
              'https://www.nodeseek.com/post-42-1',
              document
            ),
          expected: type !== 'login'
        }
      ];
      for (const { html, root, read, expected } of checks) {
        const nativeExec = RegExp.prototype.exec;
        let regexInputWork = 0;
        const exec = vi.spyOn(RegExp.prototype, 'exec').mockImplementation(function (this: RegExp, input: string) {
          const cursor = this.global || this.sticky ? this.lastIndex : 0;
          const result = nativeExec.call(this, input);
          regexInputWork += Math.max(
            1,
            (this.global || this.sticky ? (result ? result.index + result[0].length : input.length) : input.length) -
              cursor
          );
          return result;
        });
        try {
          const { result } = withHtmlDecodedInputBudget(html.length * 2, () =>
            withHtmlWorkBudget(depth * 128 + 1000, () => read(), root)
          );
          expect(result.result).toBe(expected);
        } finally {
          exec.mockRestore();
        }
        // Cursor spans measure input scanned, not regex engine instructions or backtracking.
        expect(regexInputWork).toBeLessThanOrEqual(html.length * 32);
      }
    }
    const row = parseHtml(
      '<div><a>sample</a><span>登录后可查看</span><span>需要等级 Lv2 才能查看</span></div>'
    ).querySelector('div')!;
    expect(nodeSeekAccessRequirementFromListRow(row, 'sample')?.type).toBe('login');
    const split = parseHtml('<div><a>sample</a><span>登录后</span><span>可查看</span></div>').querySelector('div')!;
    expect(nodeSeekAccessRequirementFromListRow(split, 'sample')?.type).toBe('login');
    const title = 'ordinary'.repeat(20);
    const nested = parseHtml(`<div><a>${title}</a><span>需要${title}等级 Lv2 才能查看</span></div>`).querySelector(
      'div'
    )!;
    expect(nodeSeekAccessRequirementFromListRow(nested, title)?.type).toBe('level');
  });
  it.each([false, true])(
    'publishes a reply watermark only for a proven terminal window (has next: %s)',
    async (hasNext) => {
      const page = `<a class="post-title" href="/post-42-1">Watermark</a>
      <div class="content-item" data-comment-id="1"><a href="/space/1">alice</a><article class="post-content">opening</article></div>
      <li id="7" class="content-item" data-comment-id="2"><a href="/space/2">bob</a><a class="floor-link">#7</a><div class="post-content">reply</div></li>
      ${hasNext ? '<div class="nsk-pager"><a href="/post-42-2">2</a></div>' : ''}`;
      const fetcher = vi.fn<Fetcher>(async (input) => {
        const response = new Response(page);
        Object.defineProperty(response, 'url', { value: String(input) });
        return response;
      });
      const { getNodeSeekTopic, getNodeSeekReplies } = await import('./reader');
      const detail = await getNodeSeekTopic('42', { fetcher });
      expect(detail.replyWatermark).toBe(hasNext ? undefined : 7);
      const replies = await getNodeSeekReplies('42', { fetcher, order: 'oldest', position: { kind: 'start' } });
      expect(replies.replyWatermark).toBe(hasNext ? undefined : 7);
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );
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
