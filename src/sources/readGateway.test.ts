import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));
vi.mock('@/platform/network/networkProxy', () => ({
  recoverReadNetworkRuntime: vi.fn()
}));

import { createReadGateway, getTopic } from './readGateway';
import type { Topic } from '@/domain/forum/models';

describe('source gateway reads', () => {
  it.each(['linuxdo', 'all'] as const)(
    'requests one account recheck for a parsed %s search login failure',
    async (source) => {
      const requestAccountRecheck = vi.fn();
      const onSessionExpired = vi.fn();
      const fetcher = vi.fn(async (input: string) =>
        input.includes('/session/csrf')
          ? new Response(JSON.stringify({ csrf: 'token' }))
          : new Response(JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }), { status: 403 })
      );
      const gateway = createReadGateway({
        fetcher,
        anonymousFetcher: fetcher,
        getEnabledSources: () => ['linuxdo'],
        nodeSeekUserAgent: () => 'test-agent',
        requestAccountRecheck,
        onSessionExpired,
        readSessionRuntimeSnapshot: (site) => ({
          source: site,
          authenticated: true,
          identityTrust: 'confirmed',
          identityKey: `${site}:7`,
          sessionEpoch: 4,
          authSurfaceOpen: false,
          sourceEnabled: true
        })
      });
      const read = gateway.searchTopics({ source, query: 'AI' });
      const expected = {
        kind: 'login-required',
        reason: 'account-recheck-required',
        message: '您需要登录才能执行此操作。'
      };
      if (source === 'all') await expect(read).resolves.toMatchObject({ errors: { linuxdo: expected } });
      else await expect(read).rejects.toMatchObject(expected);
      expect(requestAccountRecheck).toHaveBeenCalledTimes(1);
      expect(requestAccountRecheck).toHaveBeenCalledWith('linuxdo', 4, expect.stringMatching(/^trace-/));
      expect(onSessionExpired).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it('reads a partial yaohuo topic seed without duplicating the replies request', async () => {
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
});
