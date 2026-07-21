import {
  clearLinuxDoAccess,
  clearLinuxDoAccessForGeneration,
  currentLinuxDoAccessGeneration,
  parseLinuxDoDocumentCookie,
  summarizeLinuxDoCookies
} from '../linuxdoCookieBridge';
import { errorMessage } from '../appUtils';
import type { SiteSessionEvent } from '../siteSessionState';

export function isNodeSeekLoginRequiredError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { source?: unknown }).source === 'nodeseek'
    && (error as { loginRequired?: unknown }).loginRequired
  );
}

export async function clearExpiredLinuxDoLogin({
  error,
  generation,
  cookieHeader,
  resetLinuxDoLevelState,
  updateLinuxDoSession
}: {
  error: unknown;
  generation?: number;
  cookieHeader?: string;
  resetLinuxDoLevelState: () => void;
  updateLinuxDoSession: (event: SiteSessionEvent) => void;
}) {
  const isCurrent = () => generation === undefined || currentLinuxDoAccessGeneration() === generation;
  if (!isCurrent()) return false;
  let remainingAccess: Awaited<ReturnType<typeof clearLinuxDoAccess>>;
  try {
    remainingAccess = generation === undefined
      ? await clearLinuxDoAccess()
      : await clearLinuxDoAccessForGeneration(generation, cookieHeader);
  } catch (cleanupError) {
    if (!isCurrent()) return false;
    updateLinuxDoSession({
      type: 'login-expired',
      message: `${errorMessage(error)} 本机 Cookie 清理未完成，请重试。`
    });
    resetLinuxDoLevelState();
    throw cleanupError;
  }
  if (!isCurrent()) return false;
  const summary = summarizeLinuxDoCookies(parseLinuxDoDocumentCookie(remainingAccess?.cookieHeader || ''));
  updateLinuxDoSession(remainingAccess?.cookieHeader
    ? {
      type: 'session-updated',
      cookieSummary: summary.names,
      hasVerification: summary.hasClearance,
      loggedIn: false,
      at: new Date().toISOString()
    }
    : { type: 'login-expired', message: errorMessage(error) });
  resetLinuxDoLevelState();
  return true;
}

export async function shareTopicWithClipboardFallback({
  copy,
  notify,
  share
}: {
  copy: () => Promise<void>;
  notify: (message: string) => void;
  share: () => Promise<void>;
}) {
  try {
    await share();
    return true;
  } catch {
    try {
      await copy();
      notify('链接已复制');
      return true;
    } catch {
      notify('分享失败，且无法复制链接，请重试。');
      return false;
    }
  }
}
