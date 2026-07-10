import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import { getFeed, getReplies, getTopic, getUserProfile, searchTopics } from './sourceGateway';
import type { Topic } from '../types';

describe('source gateway reads', () => {
  it('reads the yaohuo feed through the shared getFeed interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="listdata"><a href="/bbs-123.html">妖火主题</a>/alice/阅1/05-20 10:00</div>'
    ));

    const result = await getFeed({
      source: 'yaohuo',
      category: '177',
      page: 2,
      limit: 30,
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '123', title: '妖火主题' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_list.aspx?action=new&classid=177&page=2&siteid=1000',
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('searches yaohuo through the shared searchTopics interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="listdata"><a href="/bbs-321.html">茶馆搜索结果</a>/alice/阅1/05-20 10:00</div>'
    ));

    const result = await searchTopics({
      source: 'yaohuo',
      query: '茶馆',
      page: 2,
      limit: 30,
      filter: { source: 'yaohuo', category: '177' },
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(result.items[0]).toMatchObject({ source: 'yaohuo', id: '321', categoryId: '177' });
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('classid=177'),
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('reads a yaohuo topic through the shared getTopic interface', async () => {
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
    const fetcher = vi.fn(async (input: string) => input.includes('book_re.aspx')
      ? new Response('<div class="line1">[沙发] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>')
      : new Response('<div class="content">[标题] 妖火帖子 (阅1) [时间] 2026-05-20 10:00</div><div class="subtitle"><a href="/userinfo.aspx">alice</a></div><div class="bbscontent"><!--listS--><p>body</p><!--listE--></div>更多回帖(1)<a href="/bbs/book_list.aspx?classid=177">妖火茶馆</a>'));

    const detail = await getTopic({
      source: 'yaohuo',
      id: topic.id,
      topic,
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(detail).toMatchObject({ source: 'yaohuo', id: '123', contentHtml: '<p>body</p>' });
    expect(detail.replies[0]).toMatchObject({ author: 'bob', floor: 1 });
  });

  it('reads yaohuo replies through the shared getReplies interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="line1">[61楼] 回复内容 <a href="/userinfo.aspx?touserid=1">bob</a> 05-20 10:01</div>'
    ));

    const result = await getReplies({
      source: 'yaohuo',
      id: '123',
      categoryId: '177',
      page: 3,
      limit: 30,
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(result.items[0]).toMatchObject({ author: 'bob', floor: 61 });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/book_re.aspx?id=123&classid=177&page=3',
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('reads a yaohuo user through the shared getUserProfile interface', async () => {
    const fetcher = vi.fn(async () => new Response(
      '<div class="content">昵称:火友<br/>1万妖晶2级等级7年注册时长<br/>发帖:3<br/>回帖:9</div>'
    ));

    const profile = await getUserProfile({
      source: 'yaohuo',
      id: '7',
      username: '火友',
      fetcher,
      yaohuoCookie: 'sidyaohuo=secret'
    });

    expect(profile).toMatchObject({ source: 'yaohuo', id: '7', username: '火友', levelLabel: '2级' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7&siteid=1000',
      expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'sidyaohuo=secret' }) })
    );
  });

  it('classifies a missing yaohuo credential before reading a user profile', async () => {
    await expect(getUserProfile({
      source: 'yaohuo',
      id: '7'
    })).rejects.toMatchObject({
      source: 'yaohuo',
      loginRequired: true,
      reason: 'missing_cookie'
    });
  });
});
