import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));
vi.mock('@/platform/network/networkProxy', () => ({
  recoverReadNetworkRuntime: vi.fn()
}));

import { getTopic } from './readGateway';
import type { Topic } from '@/domain/forum/models';

describe('source gateway reads', () => {
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
