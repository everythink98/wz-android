import type { SessionSource } from '@/domain/forum/sourceCatalog';
import { siteSessionStateFromEvents, type AccountStatusObservation } from '@/domain/session/siteSessionState';
import type { ManagedCookieReadResult } from '@/platform/network/managedCookies';
import type { Fetcher } from '@/platform/network/request';
import { readLinuxDoAccountStatus } from '@/sources/linuxdo/accountStatus';
import { readNodeSeekAccountStatus } from '@/sources/nodeseek/accountStatus';
import { readYaohuoAccountStatus } from '@/sources/yaohuo/accountStatus';
import { runForumSourceReadAttempt } from './forumSourceReadAttempt';

export function readAccountStatus(
  source: SessionSource,
  {
    fetcher,
    linuxDoUserAgent,
    nodeSeekUserAgent,
    readManagedCookieHeader,
    signal
  }: {
    fetcher: Fetcher;
    linuxDoUserAgent: string;
    nodeSeekUserAgent: string;
    readManagedCookieHeader: (exactUrl: string) => Promise<ManagedCookieReadResult>;
    signal: AbortSignal;
  }
): Promise<AccountStatusObservation> {
  const read = () => {
    switch (source) {
      case 'linuxdo':
        return runForumSourceReadAttempt(
          'linuxdo',
          fetcher,
          (scopedFetcher) =>
            readLinuxDoAccountStatus({
              fetcher: scopedFetcher,
              readManagedCookieHeader,
              signal,
              userAgent: linuxDoUserAgent
            }),
          () => !signal.aborted
        );
      case 'nodeseek':
        return runForumSourceReadAttempt(
          'nodeseek',
          fetcher,
          (scopedFetcher) =>
            readNodeSeekAccountStatus({
              fetcher: scopedFetcher,
              readManagedCookieHeader,
              signal,
              userAgent: nodeSeekUserAgent
            }),
          () => !signal.aborted
        );
      case 'yaohuo':
        return readYaohuoAccountStatus({ fetcher, readManagedCookieHeader, signal });
    }
  };
  return read().catch((error) => {
    if (!error || typeof error !== 'object' || (error as { reason?: unknown }).reason !== 'http-401') throw error;
    return {
      session: siteSessionStateFromEvents(source, [{ type: 'login-expired', message: '登录状态已失效' }])
    };
  });
}
