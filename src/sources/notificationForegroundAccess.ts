import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { NotificationAdapterAccess } from './notificationAdapter';
import type { SiteSessionViewModel } from '@/domain/session/siteSessionState';
import type { Fetcher } from '@/platform/network/request';

export async function readForegroundNotificationAccess({
  fetcher,
  session,
  source,
  userAgent
}: {
  fetcher: Fetcher;
  session: SiteSessionViewModel;
  source: NotificationSource;
  userAgent?: string;
}): Promise<NotificationAdapterAccess> {
  const userId = String(session.currentUser?.id || '').trim();
  const username = String(session.currentUser?.username || '').trim();
  if (!session.isLoggedIn || session.identityTrust !== 'confirmed' || !userId) {
    throw new Error('账号身份尚未确认');
  }
  return {
    fetcher,
    identityKey: `${source}:${userId}`,
    userId,
    ...(username ? { username } : {}),
    ...(userAgent ? { userAgent } : {})
  };
}
