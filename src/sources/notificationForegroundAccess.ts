import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { NotificationAdapterAccess } from './notificationAdapter';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import type { Fetcher } from '@/platform/network/request';
import { xiaoyinsiCredentialsHaveScope, type XiaoyinsiApiCredentials } from '@/sources/xiaoyinsi/credentials';

export async function readForegroundNotificationAccess({
  fetcher,
  loadXiaoyinsiCredentials,
  session,
  source,
  userAgent
}: {
  fetcher: Fetcher;
  loadXiaoyinsiCredentials?: () => Promise<XiaoyinsiApiCredentials | undefined>;
  session: SiteSessionViewModel;
  source: NotificationSource;
  userAgent?: string;
}): Promise<NotificationAdapterAccess> {
  const userId = String(session.currentUser?.id || '').trim();
  const username = String(session.currentUser?.username || '').trim();
  if (!session.isLoggedIn || session.identityTrust !== 'confirmed' || !userId) {
    throw new Error('账号身份尚未确认');
  }
  const xiaoyinsiCredentials = source === 'xiaoyinsi' ? await loadXiaoyinsiCredentials?.() : undefined;
  if (source === 'xiaoyinsi' && !xiaoyinsiCredentialsHaveScope(xiaoyinsiCredentials, 'notifications')) {
    throw new Error('小隐寺需要升级授权后才能读取消息');
  }
  return {
    fetcher,
    identityKey: `${source}:${userId}`,
    userId,
    ...(username ? { username } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(xiaoyinsiCredentials ? { xiaoyinsiCredentials } : {})
  };
}
