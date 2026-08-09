import type { SessionSource } from '@/domain/forum/sourceCatalog';
import type { XiaoyinsiAuthorizationReadResult } from '@/domain/session/accountCenter';
import type { AccountStatusObservation } from '@/domain/session/siteSessionState';
import type { DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import type { ManagedCookieReadResult } from '@/platform/network/managedCookies';
import type { Fetcher } from '@/platform/network/request';
import { readLinuxDoAccountStatus } from '@/sources/linuxdo/accountStatus';
import { readNodeSeekAccountStatus } from '@/sources/nodeseek/accountStatus';
import { readXiaoyinsiAccountStatus } from '@/sources/xiaoyinsi/accountStatus';
import { readYaohuoAccountStatus } from '@/sources/yaohuo/accountStatus';
import { runForumSourceReadAttempt } from './forumSourceReadAttempt';

export function readAccountStatus(
  source: SessionSource,
  {
    fetcher,
    linuxDoUserAgent,
    nodeSeekUserAgent,
    readManagedCookieHeader,
    readXiaoyinsiAuthorization,
    signal
  }: {
    fetcher: Fetcher;
    linuxDoUserAgent: string;
    nodeSeekUserAgent: string;
    readManagedCookieHeader: (exactUrl: string) => Promise<ManagedCookieReadResult>;
    readXiaoyinsiAuthorization: (
      trace?: DiagnosticTrace,
      options?: { signal?: AbortSignal }
    ) => Promise<XiaoyinsiAuthorizationReadResult>;
    signal: AbortSignal;
  }
): Promise<AccountStatusObservation> {
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
    case 'xiaoyinsi':
      return readXiaoyinsiAccountStatus({ readAuthorization: readXiaoyinsiAuthorization, signal });
    case 'yaohuo':
      return readYaohuoAccountStatus({ fetcher, readManagedCookieHeader, signal });
  }
}
