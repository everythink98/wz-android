import { getCurrentUserIdentity } from '@/sources/sourceRead';
import type { UserIdentity } from '@/domain/forum/models';
import { LinuxDoLoggedOutError } from './account';
import { summarizeLinuxDoCookieHeader } from './session';
import { isCanceledRequest } from '@/platform/network/errors';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import { managedCookieHeaderOrThrow, type ManagedCookieReadResult } from '@/platform/network/managedCookies';
import { siteSessionStateFromEvents, type AccountStatusObservation } from '@/domain/session/siteSessionState';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { LINUXDO_BASE_URL } from './protocol';

export const LINUXDO_ACCOUNT_STATUS_URL = `${LINUXDO_BASE_URL}/session/current.json`;

function loginCookies(header: string) {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^_t=.+/.test(part))
    .join(';');
}

export async function readLinuxDoAccountStatus({
  fetcher,
  readManagedCookieHeader,
  signal,
  userAgent
}: {
  fetcher: Fetcher;
  readManagedCookieHeader: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  signal: AbortSignal;
  userAgent: string;
}): Promise<AccountStatusObservation> {
  const trace = beginDiagnosticTrace('session', 'refresh', { source: 'linuxdo' });
  const readHeader = async () => {
    const header = managedCookieHeaderOrThrow(await readManagedCookieHeader(LINUXDO_ACCOUNT_STATUS_URL));
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    return header;
  };
  try {
    let header = await readHeader();
    markDiagnosticStage(trace, 'credential', {
      source: 'linuxdo',
      hasCredential: Boolean(header),
      hasLoginCookie: Boolean(loginCookies(header)),
      hasVerificationCookie: summarizeLinuxDoCookieHeader(header).hasClearance
    });
    let currentUser: UserIdentity | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        currentUser = await getCurrentUserIdentity({
          source: 'linuxdo',
          fetcher: withDiagnosticFetcher(trace, fetcher),
          discourseAuth: { userAgent },
          signal
        });
        if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
        finishDiagnosticTrace(trace, 'success', {
          source: 'linuxdo',
          state: 'confirmed',
          accountEvidence: 'current-user'
        });
      } catch (error) {
        if (signal.aborted || !(error instanceof LinuxDoLoggedOutError)) throw error;
        const previousLogin = loginCookies(header);
        header = await readHeader();
        const latestLogin = loginCookies(header);
        if (latestLogin && latestLogin !== previousLogin) {
          if (attempt > 0) throw new Error('linux.do 登录凭据已更新，请重新核对账号');
          continue;
        }
        finishDiagnosticTrace(trace, 'success', {
          source: 'linuxdo',
          state: 'expired',
          reason: 'login_required',
          accountEvidence: error.accountEvidence
        });
      }
      break;
    }
    const cookieSummary = summarizeLinuxDoCookieHeader(header);
    return {
      session: siteSessionStateFromEvents('linuxdo', [
        {
          type: 'cookie-loaded',
          cookieSummary: cookieSummary.names,
          hasVerification: cookieSummary.hasClearance,
          loggedIn: currentUser !== null,
          currentUser,
          at: new Date().toISOString()
        }
      ])
    };
  } catch (error) {
    const canceled = signal.aborted || isCanceledRequest(error);
    finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
      source: 'linuxdo',
      reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
    });
    throw error;
  }
}
