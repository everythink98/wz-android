import { describe, expect, it, vi } from 'vitest';
import { getYaohuoAccountOverview } from './accountData';

function accountHtml(id = '123', value = '11,234') {
  return `<div class="myfile-page">
    <section><div class="myfile-user-info">
      <div class="user-brief"><img class="avatar" src="/avatar/123.png">
        <span class="user-nickname">测试用户</span><span class="chip chip-id">ID:<span class="gap-2px"></span>${id}</span>
      </div>
      <div class="myfile-stats-grid">
        <a href="/bbs/book_list.aspx" class="stat-item"><div class="stat-value">5</div><div class="stat-label">帖子</div></a>
        <a href="/bbs/book_re_my.aspx" class="stat-item"><div class="stat-value">91</div><div class="stat-label">回复</div></a>
      </div>
      <div class="myfile-progress"><span class="progress-label">经验值:<span class="gap-2px"></span>1,234</span><span class="progress-level">2级</span></div>
    </div></section>
    <section><div class="info-row"><div class="info-label">我的妖晶</div><div class="info-value"><span class="info-value-number">${value}</span><a href="/bbs/banklist.aspx">明细</a></div></div></section>
    <section><div class="info-row"><div class="info-label">我的身份</div><div class="info-value"><span class="current-identity">普通会员</span></div></div>
      <div class="info-row"><div class="info-label">有效期至</div><div class="info-value"><span class="ExpirationDate">无期限</span></div></div></section>
  </div>`;
}

describe('Yaohuo current account overview', () => {
  it('reads the explicit current UID and modern myfile statistics without needing legacy account navigation', async () => {
    const fetcher = vi.fn(async () => new Response(accountHtml()));
    expect(await getYaohuoAccountOverview({ userId: '123', fetcher })).toMatchObject({
      source: 'yaohuo',
      userId: '123',
      crystals: 11234,
      experience: 1234,
      memberLabel: '普通会员',
      memberExpiresAt: '无期限',
      profile: {
        id: '123',
        username: '测试用户',
        avatar: 'https://www.yaohuo.me/avatar/123.png',
        topicCount: 5,
        replyCount: 91,
        postCount: 96,
        levelLabel: '2级'
      }
    });
    expect(fetcher).toHaveBeenCalledWith('https://www.yaohuo.me/myfile.aspx', expect.any(Object));
  });

  it('preserves zero crystals, leaves unknown numbers absent, and rejects mismatched self identity', async () => {
    expect(
      await getYaohuoAccountOverview({ userId: '123', fetcher: async () => new Response(accountHtml('123', '0')) })
    ).toMatchObject({ crystals: 0 });
    expect(
      (await getYaohuoAccountOverview({ userId: '123', fetcher: async () => new Response(accountHtml('123', '未知')) }))
        .crystals
    ).toBeUndefined();
    await expect(
      getYaohuoAccountOverview({ userId: '124', fetcher: async () => new Response(accountHtml()) })
    ).rejects.toThrow('身份不匹配');
    await expect(
      getYaohuoAccountOverview({ userId: '123', fetcher: async () => new Response('<p>ID:123</p>') })
    ).rejects.toThrow('身份不匹配');
  });
});
