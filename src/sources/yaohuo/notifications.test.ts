import { describe, expect, it, vi } from 'vitest';

import { yaohuoNotificationAdapter } from './notifications';
import { sourceDiagnosticSummary } from '@/platform/diagnostics/sourceDiagnosticSummary';

function html(value: string) {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });
}

function messageListRow({
  id = '41',
  title = '消息',
  actor = '张三',
  actorId,
  unread = false,
  time = '2026/10/4 13:46',
  displayTime = '今天'
}: {
  id?: string;
  title?: string;
  actor?: string;
  actorId?: string;
  unread?: boolean;
  time?: string;
  displayTime?: string;
} = {}) {
  return `<ul class="msglist-rows"><li><a class="msglist-row${unread ? ' is-unread' : ''}" href="/bbs/messagelist_view.aspx?id=${id}" data-message-id="${id}">
    <span class="msglist-main"><span class="msglist-text">${title}</span><span class="msglist-meta">
    <span class="msglist-from">${actor}</span>${actorId === undefined ? '' : `<span class="msglist-uid">(${actorId})</span>`}
    <time class="msglist-time" title="${time}">${displayTime}</time></span></span>
  </a></li></ul>`;
}

describe('Yaohuo notifications', () => {
  it.each([false, true])(
    'reads the current inbox fields, unread state and pagination with unreadOnly=%s',
    async (unreadOnly) => {
      const page = await yaohuoNotificationAdapter.listPage({
        identityKey: 'yaohuo:7',
        userId: '7',
        unreadOnly,
        fetcher: async () =>
          html(`
        <div class="msglist-page has-unread">
          <ul class="msglist-rows">
            <li><a class="msglist-row is-unread" data-message-id="41" href="/bbs/messagelist_view.aspx?types=0&id=41&page=1">
              <span class="msglist-dot" aria-hidden="true"></span>
              <span class="msglist-main"><span class="msglist-text">回复通知</span><span class="msglist-meta">
                <span class="msglist-from">系统</span><time class="msglist-time" title="2026/10/4 13:46">今天</time>
              </span></span>
            </a></li>
            <li><a class="msglist-row" data-message-id="42" href="/bbs/messagelist_view.aspx?types=0&id=42&page=1">
              <span class="msglist-main"><span class="msglist-text">私信正文</span><span class="msglist-meta">
                <span class="msglist-from">张三</span><span class="msglist-uid">(9)</span>
                <time class="msglist-time" title="2026/10/3 21:30">昨天</time>
              </span></span>
            </a></li>
          </ul>
          <div class="showpage">第 1/2 页，共 30 条</div>
        </div>
      `)
      });
      expect(page).toMatchObject({ quality: 'complete', cursor: '2', hasMore: true });
      expect(page.items).toEqual([
        expect.objectContaining({
          id: '41',
          kind: 'system',
          actor: { name: '系统' },
          title: '回复通知',
          unread: true,
          createdAt: '2026-10-04T05:46:00.000Z'
        }),
        ...(unreadOnly
          ? []
          : [
              expect.objectContaining({
                id: '42',
                kind: 'private-message',
                actor: { name: '张三', id: '9' },
                title: '私信正文',
                unread: false,
                createdAt: '2026-10-03T13:30:00.000Z'
              })
            ])
      ]);
    }
  );

  it.each([10, 20])(
    'only reports an exact unread total when the final %i rows fit the scan budget',
    async (lastPageSize) => {
      const fetcher = vi.fn(async (url: string) => {
        const secondPage = new URL(url).searchParams.get('page') === '2';
        const count = secondPage ? lastPageSize : 50;
        const offset = secondPage ? 50 : 0;
        return html(
          Array.from({ length: count }, (_, index) =>
            messageListRow({ id: String(offset + index + 1), unread: true })
          ).join('') + `<div class="showpage">${secondPage ? 2 : 1}/2 页</div>`
        );
      });
      const result = yaohuoNotificationAdapter.readUnreadSnapshot({ fetcher, identityKey: 'yaohuo:7', userId: '7' });
      if (lastPageSize === 10) await expect(result).resolves.toMatchObject({ total: 60 });
      else await expect(result).rejects.toThrow('妖火未读数量尚未完整读取');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it('retains malformed-row evidence when valid rows are filtered as read', async () => {
    const page = await yaohuoNotificationAdapter.listPage({
      identityKey: 'yaohuo:7',
      userId: '7',
      unreadOnly: true,
      fetcher: async () =>
        html(messageListRow() + '<ul class="msglist-rows"><li><a class="msglist-row">损坏行</a></li></ul>')
    });
    expect(page.items).toEqual([]);
    expect(sourceDiagnosticSummary(page)).toMatchObject({
      candidateCount: 2,
      validCount: 1,
      filteredCount: 1,
      droppedCount: 1,
      hasDegradation: true,
      isParseEmpty: false
    });
  });
  it('exposes the original message categories and category query', async () => {
    await expect(yaohuoNotificationAdapter.getCategories({ identityKey: 'yaohuo:7', userId: '7' })).resolves.toEqual([
      { id: 'all', label: '收件箱' },
      { id: 'system', label: '系统' },
      { id: 'chat', label: '聊天' }
    ]);
    const fetcher = vi.fn(async (_input: string) =>
      html('<div class="msglist-page"><div class="msglist-empty">暂无消息</div></div>')
    );

    await yaohuoNotificationAdapter.listPage({
      categoryId: 'system',
      fetcher,
      identityKey: 'yaohuo:7',
      userId: '7'
    });

    const url = new URL(fetcher.mock.calls[0]?.[0] || '');
    expect(url.searchParams.get('types')).toBe('0');
    expect(url.searchParams.get('issystem')).toBe('1');
  });

  it('preserves an expired login response from the message list', async () => {
    const fetcher = vi.fn(async () => html('<p>身份失效了，请重新登录网站</p>'));

    await expect(
      yaohuoNotificationAdapter.listPage({ fetcher, identityKey: 'yaohuo:7', userId: '7' })
    ).rejects.toMatchObject({ source: 'yaohuo', loginRequired: true, reason: 'expired' });
  });

  it('rejects a message row without a valid detail target', async () => {
    const fetcher = vi.fn(async () => html(messageListRow({ id: 'bad' })));

    await expect(yaohuoNotificationAdapter.listPage({ fetcher, identityKey: 'yaohuo:7', userId: '7' })).rejects.toThrow(
      '妖火消息列表格式不正确'
    );
  });

  it('rejects an unrelated HTML page instead of treating it as an empty message list', async () => {
    const fetcher = vi.fn(async () => html('<html><body><div>普通页面</div></body></html>'));

    await expect(yaohuoNotificationAdapter.listPage({ fetcher, identityKey: 'yaohuo:7', userId: '7' })).rejects.toThrow(
      '妖火消息列表格式不正确'
    );
  });

  it('accepts an explicit empty message-list state', async () => {
    const fetcher = vi.fn(async () =>
      html('<div class="msglist-page"><div class="msglist-empty">暂无消息</div></div>')
    );

    await expect(
      yaohuoNotificationAdapter.listPage({ fetcher, identityKey: 'yaohuo:7', userId: '7' })
    ).resolves.toEqual({ quality: 'complete' as const, items: [], cursor: null, hasMore: false });
  });

  it('preserves relative display time when the original absolute timestamp is absent', async () => {
    const page = await yaohuoNotificationAdapter.listPage({
      identityKey: 'yaohuo:7',
      userId: '7',
      fetcher: async () => html(messageListRow({ time: '', displayTime: '昨天', actor: '张三' }))
    });
    expect(page.items[0]).toMatchObject({ actor: { name: '张三' }, createdAt: null, displayTime: '昨天' });
  });

  it.each([
    ['9', '9'],
    ['12', '12'],
    ['0', undefined],
    ['bad', undefined]
  ])('reads the sender identity from its original UID field %s', async (actorId, id) => {
    const page = await yaohuoNotificationAdapter.listPage({
      identityKey: 'yaohuo:7',
      userId: '7',
      fetcher: async () => html(messageListRow({ actorId }))
    });
    expect(page.items[0]?.actor).toEqual({ name: '张三', ...(id ? { id } : {}) });
  });

  it('separates the clicked body from the original recent chat bubbles', async () => {
    const calls: string[] = [];
    const listHtml = `
      ${messageListRow({ title: '回复内容', unread: true })}
      <div class="showpage">1/1 页</div>
    `;
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      calls.push(new URL(url).pathname);
      return new URL(url).pathname.endsWith('/messagelist_view.aspx')
        ? html(`
            <div class="content">
              <b>回复内容</b><br/>
              <b>发件人：</b><a href="/bbs/userinfo.aspx?touserid=9">张三</a><br/>
              <b>时间：</b>2026-08-02 10:30:00<br/>
              <b>内容：</b><span>点击的消息正文</span><br/>
              <a class="urlbtn" href="/bbs/messagelist_add.aspx?touserid=9">回复/转发</a>
              <a class="urlbtn" href="/bbs/messagelist_del.aspx?id=41">删除本条</a>
            </div>
            <div class="content">
              <div class="listmms the_user">
                <div class="info"><span class="u_name"><label>张三</label></span>2026-08-02 10:29:00</div>
                <div class="bubble"><div class="con">对方历史</div></div>
              </div>
              <div class="listmms the_me">
                <div class="info"><span class="u_name"><label>我</label></span>2026-08-02 10:30:00</div>
                <div class="bubble"><div class="con">我的历史</div></div>
              </div>
            </div>
          `)
        : html(listHtml);
    });
    const access = { fetcher, identityKey: 'yaohuo:7', userId: '7' };
    const item = (await yaohuoNotificationAdapter.listPage(access)).items[0]!;

    const detail = await yaohuoNotificationAdapter.loadDetail(item, access);
    const result = await yaohuoNotificationAdapter.markRead(item, detail, access);

    expect(calls).toEqual(['/bbs/messagelist.aspx', '/bbs/messagelist_view.aspx', '/bbs/messagelist.aspx']);
    expect(detail.notification.actor).toEqual({ name: '张三', id: '9' });
    expect(detail.contentHtml).toContain('点击的消息正文');
    expect(detail.contentHtml).not.toMatch(/回复\/转发|删除本条|对方历史|我的历史/);
    expect(detail.messages).toEqual([
      expect.objectContaining({ author: '张三', mine: false, contentHtml: '对方历史' }),
      expect.objectContaining({ author: '我', mine: true, contentHtml: '我的历史' })
    ]);
    expect(detail.reply).toEqual({ format: 'plain-text' });
    expect(detail.historyNotice).toBe('原站仅提供最近 20 条聊天记录。');
    expect(result).toEqual({ confirmed: false, message: '原站仍显示为未读，请稍后重试' });
  });

  it.each(['private-message', 'system'] as const)(
    'opens the current anchored %s body without mixing other messages or controls',
    async (kind) => {
      const actor = kind === 'system' ? '系统' : '张三';
      const body = '<b>目标正文</b><img src="/face.gif" onerror="bad()"/><a href="/bbs-321.html">查看主题帖</a>';
      const fetcher = vi.fn(async (url: string) =>
        new URL(url).pathname.endsWith('/messagelist_view.aspx')
          ? html(`
            <div class="msgview-page" data-message-id="41" data-partner-id="9" data-partner-name="张三">
              <div class="chat-list">
                <div class="chat-date" data-date="2026-10-03"><span>昨天</span></div>
                <div class="chat-msg chat-msg--in" data-message-id="40" data-date="2026-10-03">
                  <div class="chat-bubble bubble">${body}</div><div class="chat-time">09:30</div>
                </div>
                <div class="chat-msg chat-msg--${kind === 'system' ? 'notice' : 'in'} is-anchor" data-message-id="41" data-date="2026-10-04">
                  <div class="chat-bubble bubble">${kind === 'system' ? '回复时间：2026/10/4 13:46<br/>回复内容：<br/>' : ''}${body}</div>
                  <div class="chat-time">13:46</div>
                </div>
                <div class="chat-msg chat-msg--notice" data-message-id="42" data-date="2026-10-04">
                  <div class="chat-bubble bubble">邻近通知<a href="/bbs/book_re.aspx?id=321&tofloor=90">查看完整回复</a></div>
                  <div class="chat-time">13:47</div>
                </div>
                <div class="chat-msg chat-msg--out" data-message-id="43" data-date="2026-10-04">
                  <div class="chat-bubble bubble">自己的回复</div><div class="chat-time">13:40</div>
                </div>
              </div>
              <button class="msgview-more-btn">加载更早</button>
              <form class="msgview-composer" action="/bbs/messagelist_add.aspx"><textarea name="content">草稿</textarea></form>
            </div>`)
          : html(messageListRow({ actor, title: '目标消息' }))
      );
      const access = { fetcher, identityKey: 'yaohuo:7', userId: '7' };
      const item = (await yaohuoNotificationAdapter.listPage(access)).items[0]!;
      const detail = await yaohuoNotificationAdapter.loadDetail(item, access);
      expect(detail.contentHtml).toContain('目标正文');
      expect(detail.contentHtml).toContain('https://www.yaohuo.me/face.gif');
      expect(detail.contentHtml).toContain('https://www.yaohuo.me/bbs-321.html');
      expect(detail.contentHtml).not.toMatch(/邻近通知|自己的回复|加载更早|草稿|回复内容|回复时间|onerror/);
      if (kind === 'system') {
        expect(detail.notification.actor).toEqual({ name: '系统' });
        expect(detail).not.toHaveProperty('messages');
        expect(detail).not.toHaveProperty('reply');
      } else {
        expect(detail.notification.actor).toEqual({ name: '张三', id: '9' });
        expect(detail.messages?.map(({ id, author, mine, createdAt }) => ({ id, author, mine, createdAt }))).toEqual([
          { id: 'chat:40', author: '张三', mine: false, createdAt: '2026-10-03T01:30:00.000Z' },
          { id: 'chat:43', author: '我', mine: true, createdAt: '2026-10-04T05:40:00.000Z' },
          { id: 'chat:42', author: '系统', mine: false, createdAt: '2026-10-04T05:47:00.000Z' }
        ]);
        expect(detail.messages?.[0]?.contentHtml).toContain('目标正文');
        expect(detail.messages?.[2]?.contentHtml).toContain('tofloor=90');
        expect(detail.reply).toEqual({ format: 'plain-text' });
        expect(detail.historyNotice).toBe('仅展示原站当前返回的聊天记录。');
      }
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it.each([
    ['wrong page identity', '42', '41', 'is-anchor', '目标正文'],
    ['wrong anchor identity', '41', '42', 'is-anchor', '邻近正文'],
    ['missing anchor', '41', '41', '', '邻近正文'],
    ['empty body', '41', '41', 'is-anchor', '<script>bad()</script>']
  ])('rejects a current message page with %s', async (_case, pageId, anchorId, anchorClass, body) => {
    const access = {
      identityKey: 'yaohuo:7',
      userId: '7',
      fetcher: async (url: string) =>
        html(
          new URL(url).pathname.endsWith('/messagelist_view.aspx')
            ? `<div class="msgview-page" data-message-id="${pageId}"><div class="chat-list">
            <div class="chat-msg chat-msg--in ${anchorClass}" data-message-id="${anchorId}"><div class="chat-bubble">${body}</div></div>
          </div></div><div class="content"><b>内容：</b>不应回退到这个正文</div>`
            : messageListRow()
        )
    };
    const item = (await yaohuoNotificationAdapter.listPage(access)).items[0]!;
    await expect(yaohuoNotificationAdapter.loadDetail(item, access)).rejects.toThrow('妖火消息对应的正文未找到');
  });

  it('does not use a profile link in message content as the sender identity', async () => {
    const item = {
      source: 'yaohuo' as const,
      id: '41',
      kind: 'private-message' as const,
      actor: { name: '张三' },
      title: '回复内容',
      createdAt: null,
      unread: false,
      target: {
        type: 'message-detail' as const,
        messageId: '41',
        url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=41'
      }
    };
    const detail = await yaohuoNotificationAdapter.loadDetail(item, {
      identityKey: 'yaohuo:7',
      userId: '7',
      fetcher: async () =>
        html(`
        <div class="content">
          <b>发件人：</b>张三<br/>
          <b>内容：</b><span>转发名片</span><br/>
          <b>发件人：</b><a href="/bbs/userinfo.aspx?touserid=99">另一个用户</a>
        </div>
      `)
    });

    expect(detail.notification.actor).toEqual({ name: '张三' });
  });

  it('rechecks the exact Yaohuo category page after opening a detail', async () => {
    const listUrls: URL[] = [];
    const unreadHtml = `
      ${messageListRow({ title: '系统消息', actor: '系统', unread: true })}
      <div class="showpage">2/2 页</div>
    `;
    const readHtml = `
      ${messageListRow({ title: '系统消息', actor: '系统' })}
      <div class="showpage">2/2 页</div>
    `;
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/messagelist_view.aspx')) {
        return html('<div class="content"><b>内容：</b><span>系统正文</span></div>');
      }
      listUrls.push(url);
      const exactOrigin = url.searchParams.get('issystem') === '1' && url.searchParams.get('page') === '2';
      return html(
        listUrls.length === 1
          ? unreadHtml
          : exactOrigin
            ? readHtml
            : '<div class="msglist-page"><div class="msglist-empty">暂无消息</div></div>'
      );
    });
    const access = { fetcher, identityKey: 'yaohuo:7', userId: '7' };
    const item = (await yaohuoNotificationAdapter.listPage({ ...access, categoryId: 'system', cursor: '2' })).items[0]!;

    expect(item).toMatchObject({ remoteGroup: 'system', remoteCursor: '2' });
    const detail = await yaohuoNotificationAdapter.loadDetail(item, access);
    await expect(yaohuoNotificationAdapter.markRead(item, detail, access)).resolves.toEqual({ confirmed: true });
    expect(listUrls.map((url) => [url.searchParams.get('issystem'), url.searchParams.get('page')])).toEqual([
      ['1', '2'],
      ['1', '2']
    ]);
  });

  it('cleans, orders and de-duplicates chat; keeps row-level time; keeps topic links', async () => {
    const nativeDateParse = Date.parse.bind(Date);
    const dateParse = vi
      .spyOn(Date, 'parse')
      .mockImplementation((value) => (String(value).includes('/') ? Number.NaN : nativeDateParse(value)));
    const listHtml = `
      ${messageListRow({ title: '安全邮箱绑定功能已上线', actor: 'Clover', time: '2026/6/17 21:30' })}
      <div class="showpage">1/1 页</div>
    `;
    const fetcher = vi.fn(async (url: string) =>
      new URL(url).pathname.endsWith('/messagelist_view.aspx')
        ? html(`
            <div class="content">
              <b>安全邮箱绑定功能已上线</b><br/>
              <b>发件人：</b><a href="/bbs/userinfo.aspx?touserid=9">Clover</a><br/>
              <b>时间：</b>2026/6/17 21:30<br/>
              <b>内容：</b><span>安全邮箱绑定功能已上线，目前分批邀请测试中。</span><br/>
              <a href="/bbs/messagelist_add.aspx?touserid=9">回复/转发</a>
            </div>
            <div class="content">
              <div class="listmms the_user">
                <div class="info"><span class="u_name"><label>Clover</label></span></div>
                <div class="reply-meta">回复时间：2026/7/3 13:45:52</div>
                <div class="bubble"><div class="con">
                  回复内容：<br/>
                  <img src="/face.gif"/>阿根廷当然赢，但能赢几个是不确定的<br/>
                  <a href="/bbs-321.html">查看主题帖</a> |
                  <a href="/bbs/book_re.aspx?classid=177&id=321&tofloor=90&fromuserid=1000">查看完整回复</a>
                </div></div>
              </div>
              <div class="listmms the_user">
                <div class="info"><span class="u_name"><label>Clover</label></span>2026/6/17 21:30</div>
                <div class="bubble"><div class="con">安全邮箱绑定功能已上线，目前分批邀请测试中。</div></div>
              </div>
              <div class="listmms the_user">
                <div class="info"><span class="u_name"><label>Clover</label></span>2026/5/2 03:40</div>
                <div class="bubble"><div class="con">更早的一条消息</div></div>
              </div>
            </div>
          `)
        : html(listHtml)
    );
    try {
      const access = { fetcher, identityKey: 'yaohuo:7', userId: '7' };
      const item = (await yaohuoNotificationAdapter.listPage(access)).items[0]!;
      const detail = await yaohuoNotificationAdapter.loadDetail(item, access);

      expect(detail.messages).toHaveLength(2);
      expect(detail.messages?.map((message) => message.contentHtml)).toEqual([
        '更早的一条消息',
        expect.stringContaining('阿根廷当然赢，但能赢几个是不确定的')
      ]);
      expect(detail.messages?.map((message) => message.author)).toEqual(['Clover', 'Clover']);
      expect(detail.messages?.map((message) => message.createdAt)).toEqual([
        '2026-05-01T19:40:00.000Z',
        '2026-07-03T05:45:52.000Z'
      ]);
      expect(detail.messages?.[1]?.contentHtml).toContain('https://www.yaohuo.me/face.gif');
      expect(detail.messages?.[1]?.contentHtml).not.toMatch(/回复时间|回复内容/);
      expect(detail.messages?.[1]?.contentHtml).toContain('href="https://www.yaohuo.me/bbs-321.html"');
      expect(detail.messages?.[1]?.contentHtml).toContain(
        'href="https://www.yaohuo.me/bbs/book_re.aspx?classid=177&id=321&tofloor=90&fromuserid=1000"'
      );
    } finally {
      dateParse.mockRestore();
    }
  });

  it('keeps system-message details read-only', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <div class="content">
          <b>维护公告</b><br/>
          <b>内容：</b><span>今晚维护</span><br/>
          <form action="/bbs/messagelist_add.aspx"><textarea name="content"></textarea></form>
        </div>
      `)
    );
    const item = {
      source: 'yaohuo' as const,
      id: '42',
      kind: 'system' as const,
      actor: { name: '系统通知' },
      title: '维护公告',
      createdAt: null,
      unread: false,
      target: {
        type: 'message-detail' as const,
        messageId: '42',
        url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=42'
      }
    };

    const detail = await yaohuoNotificationAdapter.loadDetail(item, {
      fetcher,
      identityKey: 'yaohuo:7',
      userId: '7'
    });
    expect(detail.contentHtml).toContain('今晚维护');
    expect(detail).not.toHaveProperty('messages');
    expect(detail).not.toHaveProperty('reply');
    expect(detail).not.toHaveProperty('historyNotice');

    const replyFetcher = vi.fn();
    await expect(
      yaohuoNotificationAdapter.replyToConversation(item, '收到', {
        fetcher: replyFetcher,
        identityKey: 'yaohuo:7',
        userId: '7'
      })
    ).rejects.toThrow('妖火私信会话标识不正确');
    expect(replyFetcher).not.toHaveBeenCalled();
  });

  it('posts the original reply form fields with the AJAX acknowledgment request and preserves legacy confirmation', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? html('<div class="tip">发送信息成功！</div>')
        : html(`
            <form action="/bbs/messagelist_add.aspx" method="post">
              <input type="hidden" name="action" value="add" />
              <input type="hidden" name="classid" value="0" />
              <input type="hidden" name="siteid" value="1000" />
              <input type="hidden" name="types" value="0" />
              <input type="hidden" name="issystem" value="0" />
              <input type="hidden" name="toid" value="9" />
              <input type="hidden" name="title" value="回复内容" />
              <input type="hidden" name="touseridlist" value="9" />
              <textarea name="content"></textarea>
            </form>
          `)
    );
    const item = {
      source: 'yaohuo' as const,
      id: '41',
      kind: 'private-message' as const,
      actor: { name: '张三' },
      title: '回复内容',
      createdAt: null,
      unread: false,
      target: {
        type: 'message-detail' as const,
        messageId: '41',
        url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=41'
      }
    };

    await expect(
      yaohuoNotificationAdapter.replyToConversation(item, '  收到\n谢谢  ', {
        fetcher,
        identityKey: 'yaohuo:7',
        userId: '7'
      })
    ).resolves.toEqual({ confirmed: true, message: '发送信息成功！' });

    const [url, init] = fetcher.mock.calls[1] || [];
    expect(new URL(url || '').pathname).toBe('/bbs/messagelist_add.aspx');
    expect(init?.method).toBe('POST');
    expect(new URLSearchParams(String(init?.body))).toEqual(
      new URLSearchParams({
        action: 'add',
        classid: '0',
        siteid: '1000',
        types: '0',
        issystem: '0',
        toid: '9',
        title: '回复内容',
        touseridlist: '9',
        content: '收到\r\n谢谢',
        ajax: '1'
      })
    );
  });

  it('fails when the clicked message block is absent instead of showing another message', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <div class="content"><b>错误页</b><br/>登录状态已失效</div>
      `)
    );
    const item = {
      source: 'yaohuo' as const,
      id: '41',
      kind: 'private-message' as const,
      actor: { name: '张三' },
      title: '回复内容',
      createdAt: null,
      unread: true,
      target: {
        type: 'message-detail' as const,
        messageId: '41',
        url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=41'
      }
    };

    await expect(
      yaohuoNotificationAdapter.loadDetail(item, {
        fetcher,
        identityKey: 'yaohuo:7',
        userId: '7'
      })
    ).rejects.toThrow('妖火消息对应的正文未找到');
  });
});
