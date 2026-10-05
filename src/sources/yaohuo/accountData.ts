import type { YaohuoAccountOverview } from '@/domain/forum/accountData';
import { absoluteUrl, elementText, parseHtml } from '@/domain/forum/html';
import type { Fetcher } from '@/platform/network/request';
import { fetchYaohuoHtml, type DirectRequestOptions } from './reader';
import { parseYaohuoUserProfileDocument } from './userParser';
import { YAOHUO_BASE_URL } from './protocol';

function countText(value: string) {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^\d+$/.test(normalized)) return undefined;
  const count = Number(normalized);
  return Number.isSafeInteger(count) ? count : undefined;
}

export async function getYaohuoAccountOverview(
  options: DirectRequestOptions & { userId: string; fetcher?: Fetcher }
): Promise<YaohuoAccountOverview> {
  if (!/^\d+$/.test(options.userId)) throw new Error('妖火账号数据需要数字用户 ID');
  const page = await fetchYaohuoHtml(`${YAOHUO_BASE_URL}/myfile.aspx`, options.fetcher, options);
  const root = parseHtml(page.html);
  const account = root.querySelector('.myfile-page');
  const id = elementText(account?.querySelector('.chip-id')).match(/^ID\s*[:：]\s*(\d+)$/i)?.[1];
  if (!account || id !== options.userId) throw new Error('妖火账号资料身份不匹配');
  const nickname = elementText(account.querySelector('.user-nickname'));
  const parsed = parseYaohuoUserProfileDocument(root, { id, username: nickname || id });
  const { topics: _topics, ...profile } = parsed;
  const statValue = (label: string) => {
    const item = account
      .querySelectorAll('.myfile-stats-grid .stat-item')
      .find((row) => elementText(row.querySelector('.stat-label')) === label);
    return countText(elementText(item?.querySelector('.stat-value')));
  };
  const infoValue = (label: string) =>
    account
      .querySelectorAll('.info-row')
      .find((row) => elementText(row.querySelector('.info-label')) === label)
      ?.querySelector('.info-value');
  const topicCount = statValue('帖子');
  const replyCount = statValue('回复');
  const levelLabel = elementText(account.querySelector('.progress-level')) || profile.levelLabel;
  return {
    source: 'yaohuo',
    userId: id,
    profile: {
      ...profile,
      avatar: absoluteUrl(account.querySelector('img.avatar')?.getAttribute('src'), YAOHUO_BASE_URL),
      topicCount,
      replyCount,
      postCount: topicCount !== undefined && replyCount !== undefined ? topicCount + replyCount : undefined,
      ...(levelLabel ? { levelLabel } : {})
    },
    crystals: countText(elementText(infoValue('我的妖晶')?.querySelector('.info-value-number'))),
    experience: countText(elementText(account.querySelector('.progress-label')).replace(/^经验值\s*[:：]\s*/, '')),
    memberLabel: elementText(infoValue('我的身份')?.querySelector('.current-identity')) || undefined,
    memberExpiresAt: elementText(infoValue('有效期至')?.querySelector('.ExpirationDate')) || undefined
  };
}
