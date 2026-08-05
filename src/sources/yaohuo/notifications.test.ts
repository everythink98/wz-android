import { describe, expect, it, vi } from 'vitest';

import { yaohuoNotificationAdapter } from './notifications';

function html(value: string) {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });
}

describe('Yaohuo notifications', () => {
  it('[REG-NOTIFY-031] exposes the original message categories and category query', async () => {
    await expect(yaohuoNotificationAdapter.getCategories({ identityKey: 'yaohuo:7', userId: '7' })).resolves.toEqual([
      { id: 'all', label: '收件箱' },
      { id: 'system', label: '系统' },
      { id: 'chat', label: '聊天' }
    ]);
    const fetcher = vi.fn(async (_input: string) => html('<div class="tip">暂无消息</div>'));

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
    const fetcher = vi.fn(async () =>
      html('<div class="listmms"><a href="/bbs/messagelist_view.aspx?id=bad">损坏消息</a></div>')
    );

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
    const fetcher = vi.fn(async () => html('<div class="tip">暂无消息</div>'));

    await expect(
      yaohuoNotificationAdapter.listPage({ fetcher, identityKey: 'yaohuo:7', userId: '7' })
    ).resolves.toEqual({ items: [], cursor: null, hasMore: false });
  });

  it('[REG-NOTIFY-010] ignores the trailing delete action when parsing the list timestamp', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <div class="listmms">
          <a href="/bbs/messagelist_view.aspx?id=41">回复内容</a>
          来自张三 [2026-08-02 10:30]
          [<a href="/bbs/messagelist_del.aspx?id=41">删除</a>]
        </div>
      `)
    );

    const page = await yaohuoNotificationAdapter.listPage({
      fetcher,
      identityKey: 'yaohuo:7',
      userId: '7'
    });

    expect(page.items[0]).toMatchObject({
      id: '41',
      createdAt: '2026-08-02T02:30:00.000Z'
    });
    expect(page.items[0]?.displayTime).not.toBe('删除');
  });

  it('[REG-NOTIFY-010] separates an unbracketed timestamp from the actor name', async () => {
    const fetcher = vi.fn(async () =>
      html(`
        <div class="listmms">
          <a href="/bbs/messagelist_view.aspx?id=41">回复内容</a>
          来自 Clover 2026/7/3 13:46
          [<a href="/bbs/messagelist_del.aspx?id=41">删除</a>]
        </div>
      `)
    );

    const page = await yaohuoNotificationAdapter.listPage({
      fetcher,
      identityKey: 'yaohuo:7',
      userId: '7'
    });

    expect(page.items[0]).toMatchObject({
      actor: { name: 'Clover' },
      createdAt: '2026-07-03T05:46:00.000Z'
    });
  });

  it('parses chat and system rows, unread icons, and page count from the original HTML', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
      html(`
        <div class="listmms">
          <img src="/NetImages/new.gif">
          <a href="/bbs/messagelist_view.aspx?siteid=1000&id=41&classid=0">回复内容</a>
          来自张三 [2026-08-02 10:30]
        </div>
        <div class="listmms">
          <a href="/bbs/messagelist_view.aspx?siteid=1000&id=42&classid=0">维护公告</a>
          来自系统通知 [昨天]
        </div>
        <div class="showpage">1/2 页</div>
      `)
    );

    const page = await yaohuoNotificationAdapter.listPage({
      fetcher,
      identityKey: 'yaohuo:7',
      userId: '7'
    });

    expect(page).toMatchObject({ hasMore: true, cursor: '2' });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: '41',
        kind: 'private-message',
        unread: true,
        createdAt: '2026-08-02T02:30:00.000Z'
      }),
      expect.objectContaining({ id: '42', kind: 'system', unread: false, createdAt: null, displayTime: '昨天' })
    ]);
    expect(page.items[0]?.target).toEqual({
      type: 'message-detail',
      messageId: '41',
      url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=41'
    });
    expect(new URL(fetcher.mock.calls[0]?.[0] || '').searchParams.get('page')).toBe('1');
  });

  it('[REG-NOTIFY-010][REG-NOTIFY-031] separates the clicked body from the original recent chat bubbles', async () => {
    const calls: string[] = [];
    const listHtml = `
      <div class="listmms"><img src="/NetImages/new.gif"><a href="/bbs/messagelist_view.aspx?id=41&siteid=1000">回复内容</a>来自张三 [昨天]</div>
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

  it('[REG-NOTIFY-037] cleans, orders and de-duplicates chat; [REG-NOTIFY-042] keeps row-level time; [REG-NOTIFY-044] keeps topic links', async () => {
    const nativeDateParse = Date.parse.bind(Date);
    const dateParse = vi
      .spyOn(Date, 'parse')
      .mockImplementation((value) => (String(value).includes('/') ? Number.NaN : nativeDateParse(value)));
    const listHtml = `
      <div class="listmms"><a href="/bbs/messagelist_view.aspx?id=41">安全邮箱绑定功能已上线</a>来自 Clover 2026/6/17 21:30</div>
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

  it('[REG-NOTIFY-031] keeps system-message details read-only', async () => {
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

  it('[REG-NOTIFY-031] posts the original reply form fields and confirms only the exact success text', async () => {
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
        content: '收到\r\n谢谢'
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
