import { describe, expect, it, vi } from 'vitest';

import { yaohuoNotificationAdapter } from './notifications';

function html(value: string) {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });
}

describe('Yaohuo notifications', () => {
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

  it('[REG-NOTIFY-010] parses the official detail content without exposing write actions or chat history', async () => {
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
              <div class="listmms the_me"><div class="con">历史聊天</div></div>
            </div>
          `)
        : html(listHtml);
    });
    const access = { fetcher, identityKey: 'yaohuo:7', userId: '7' };
    const item = (await yaohuoNotificationAdapter.listPage(access)).items[0]!;

    const detail = await yaohuoNotificationAdapter.loadDetail(item, access);
    const result = await yaohuoNotificationAdapter.markRead(item, detail, access);

    expect(calls).toEqual(['/bbs/messagelist.aspx', '/bbs/messagelist_view.aspx', '/bbs/messagelist.aspx']);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages?.[0]).toMatchObject({ mine: false });
    expect(detail.messages?.[0]?.contentHtml).toContain('点击的消息正文');
    expect(detail.messages?.[0]?.contentHtml).not.toMatch(/回复\/转发|删除本条|历史聊天/);
    expect(result).toEqual({ confirmed: false, message: '原站仍显示为未读，请稍后重试' });
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
