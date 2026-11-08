import * as SecureStore from 'expo-secure-store';
import type { NotificationAdapterAccess } from './notificationAdapter';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import { getCurrentUserIdentity } from './sourceRead';
import {
  LINUXDO_USER_AGENT_STORAGE_KEY,
  sanitizeWebViewUserAgent,
  NODESEEK_USER_AGENT_STORAGE_KEY
} from '@/platform/android/userAgent';
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
  const nodeSeekUserAgent = sanitizeWebViewUserAgent(nodeSeekUserAgentValue || undefined);
  const linuxDoUserAgent = sanitizeWebViewUserAgent(linuxDoUserAgentValue || undefined);
  await assertCurrent();
  const profile = await getCurrentUserIdentity({
    source,
    fetcher: withFetchGuard(fetch, assertCurrent),
    nodeSeekAuthenticated: source === 'nodeseek',
    nodeSeekUserAgent: nodeSeekUserAgent || undefined,
    discourseAuth: source === 'linuxdo' ? { authenticated: true, userAgent: linuxDoUserAgent || undefined } : undefined,
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
    ...(source === 'linuxdo' && linuxDoUserAgent ? { userAgent: linuxDoUserAgent } : {})
  };
}
