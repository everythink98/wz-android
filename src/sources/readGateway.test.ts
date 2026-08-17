import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));
vi.mock('@/platform/network/networkProxy', () => ({
  recoverReadNetworkRuntime: vi.fn()
}));

import { getFeed, getReplies, getReply, getTopic, getUserProfile, searchTopics } from './readGateway';
import type { Topic } from '@/domain/forum/models';
import type { PreparedRepliesResponse, PreparedReply, PreparedTopicDetail } from '@/domain/forum/topicContentSplit';

describe('source gateway reads', () => {
  it('[REG-PERF-010] exposes prepared content at every Topic cache boundary', () => {
    expectTypeOf<Awaited<ReturnType<typeof getTopic>>>().toEqualTypeOf<PreparedTopicDetail>();
    expectTypeOf<Awaited<ReturnType<typeof getReplies>>>().toEqualTypeOf<PreparedRepliesResponse>();
    expectTypeOf<Awaited<ReturnType<typeof getReply>>>().toEqualTypeOf<PreparedReply>();
  });

  it('reads the yaohuo feed through the shared getFeed interface', async () => {
    const fetcher = vi.fn(
      async () => new Response('<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>')
    );

    const result = await getFeed({
      source: 'yaohuo',
      category: '177',
      page: 2,
      limit: 30,
      fetcher
    });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2&siteid=1000',
      expect.objectContaining({ credentials: 'include' })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('searches yaohuo through the shared searchTopics interface', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<div class="listdata"><a href="/bbs-321.html">茶馆搜索结果</a>/alice/阅1/05-20 10:00</div>')
    );

    const result = await searchTopics({
      source: 'yaohuo',
      query: '茶馆',
      page: 2,
      limit: 30,
      filter: { source: 'yaohuo', category: '177' },
      fetcher
    });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '321', categoryId: '177' });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('classid=177'),
      expect.objectContaining({ credentials: 'include' })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('[REG-TOPIC-077] reads a partial yaohuo topic seed without duplicating the replies request', async () => {
    const topic: Topic = {
      source: 'yaohuo',
      id: '123',
      title: '妖火帖子',
      author: 'alice',
      url: 'https://www.yaohuo.me/bbs-123.html',
      createdAt: '2026-05-20T00:00:00.000Z',
      replyCount: 1,
      categoryId: '177'
    };
    const fetcher = vi.fn(async (input: string) =>
      input.includes('book_re.aspx')
        ? new Response(
            '<input name="page" value="1" /><div class="line1">[沙发] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>'
          )
        : new Response(
            '<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>更多回帖(1)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'
          )
    );

    const detail = await getTopic({
      source: 'yaohuo',
      id: topic.id,
      topic,
      fetcher
    });

    expect(detail).toMatchObject({ source: 'yaohuo', id: '123', contentHtml: '<p>body</p>' });
    expect(detail).toMatchObject({ replies: [], replyCompleteness: 'partial', replyHasMore: true });
    expect(detail.preparedContent).toMatchObject({
      contentHtml: '<p>body</p>',
      contentPlan: { rows: [expect.objectContaining({ type: 'richText' })] }
    });
    expect(fetcher).not.toHaveBeenCalledWith(expect.stringContaining('book_re.aspx'), expect.anything());
  });

  it('reads yaohuo replies through the shared getReplies interface', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<div class="line1">[61楼] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>')
    );

    const result = await getReplies({
      source: 'yaohuo',
      id: '123',
      categoryId: '177',
      order: 'oldest',
      position: { kind: 'cursor', page: 3, offset: null },
      limit: 30,
      fetcher
    });

    expect(result.items[0]).toMatchObject({ author: 'bob', floor: 61 });
    expect(result.items[0]?.preparedContent).toMatchObject({
      contentPlan: { rows: [expect.objectContaining({ type: 'richText' })] }
    });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=3',
      expect.objectContaining({ credentials: 'include' })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('[REG-NOTIFY-046] forwards a Yaohuo target floor through the shared getReplies interface', async () => {
    const fetcher = vi.fn(
      async () => new Response('<input name="page" value="16" /><div class="line1">[90楼] 目标回复</div>')
    );

    await getReplies({
      source: 'yaohuo',
      id: '1560939',
      categoryId: '177',
      order: 'oldest',
      position: { kind: 'target', target: { floor: 90 } },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re.aspx?id=1560939&classid=177&tofloor=90',
      expect.any(Object)
    );
  });

  it('reads a yaohuo user through the shared getUserProfile interface', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('<div class="content">昵称:火友<br/>1万妖晶2级等级7年注册时长<br/>发帖:3<br/>回帖:9</div>')
    );

    const profile = await getUserProfile({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      fetcher
    });

    expect(profile).toMatchObject({ source: 'yaohuo', id: '7', username: '火友', levelLabel: '2级' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000',
      expect.objectContaining({ credentials: 'include' })
    );
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });

  it('[REG-ACCOUNT-029] lets the native cookie jar decide yaohuo access instead of preflighting a Cookie snapshot', async () => {
    const fetcher = vi.fn(async () => new Response('<form action="/login.aspx"></form>'));

    await expect(
      getUserProfile({
        source: 'yaohuo',
        id: '7',
        fetcher
      })
    ).resolves.toMatchObject({ source: 'yaohuo', id: '7' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]?.[1]?.headers).not.toHaveProperty('Cookie');
  });
});
