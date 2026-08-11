import * as SecureStore from 'expo-secure-store';
import type { NotificationAdapterAccess } from './notificationAdapter';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { getCurrentUserProfile } from './sourceRead';
import { loadXiaoyinsiCredentials } from '@/sources/xiaoyinsi/auth';
import { xiaoyinsiCredentialsHaveScope } from '@/sources/xiaoyinsi/credentials';
import { LINUXDO_USER_AGENT_STORAGE_KEY, sanitizeLinuxDoUserAgent } from '@/platform/android/linuxDoUserAgent';
import { NODESEEK_USER_AGENT_STORAGE_KEY, sanitizeNodeSeekUserAgent } from '@/platform/android/nodeSeekUserAgent';
import { withFetchGuard } from '@/platform/network/request';

export async function probeBackgroundNotificationAccess(
  source: NotificationSource,
  signal: AbortSignal,
  assertCurrent: () => Promise<void>
): Promise<NotificationAdapterAccess | null> {
  const [nodeSeekUserAgentValue, linuxDoUserAgentValue] = await Promise.all([
    source === 'nodeseek' ? SecureStore.getItemAsync(NODESEEK_USER_AGENT_STORAGE_KEY) : null,
    source === 'linuxdo' ? SecureStore.getItemAsync(LINUXDO_USER_AGENT_STORAGE_KEY) : null
  ]);
  const nodeSeekUserAgent = sanitizeNodeSeekUserAgent(nodeSeekUserAgentValue || undefined);
  const linuxDoUserAgent = sanitizeLinuxDoUserAgent(linuxDoUserAgentValue || undefined);
  const xiaoyinsiCredentials = source === 'xiaoyinsi' ? await loadXiaoyinsiCredentials() : undefined;
  if (source === 'xiaoyinsi' && !xiaoyinsiCredentialsHaveScope(xiaoyinsiCredentials, 'notifications')) return null;
  await assertCurrent();
  const profile = await getCurrentUserProfile({
    source,
    fetcher: withFetchGuard(fetch, assertCurrent),
    nodeSeekAuthenticated: source === 'nodeseek',
    nodeSeekUserAgent: nodeSeekUserAgent || undefined,
    discourseAuth:
      source === 'linuxdo'
        ? { linuxdo: { authenticated: true, userAgent: linuxDoUserAgent || undefined } }
        : source === 'xiaoyinsi' && xiaoyinsiCredentials
          ? { xiaoyinsi: xiaoyinsiCredentials }
          : undefined,
    signal,
    timeoutMs: 0
  });
  const userId = profile.id.trim();
  const username = profile.username.trim();
  if (!userId) return null;
  return {
    fetcher: fetch,
    identityKey: `${source}:${userId}`,
    userId,
    ...(username ? { username } : {}),
    signal,
    timeoutMs: 0,
    ...(source === 'nodeseek' && nodeSeekUserAgent ? { userAgent: nodeSeekUserAgent } : {}),
    ...(source === 'linuxdo' && linuxDoUserAgent ? { userAgent: linuxDoUserAgent } : {}),
    ...(source === 'xiaoyinsi' && xiaoyinsiCredentials ? { xiaoyinsiCredentials } : {})
  };
}
