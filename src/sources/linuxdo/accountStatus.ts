import { getCurrentUserProfile } from '@/sources/readGateway';
import { summarizeLinuxDoCookieHeader } from './session';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
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

export const LINUXDO_ACCOUNT_STATUS_URL = 'https://linux.do/session/current.json';

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
  let cookieSummary: ReturnType<typeof summarizeLinuxDoCookieHeader> = {
    hasClearance: false,
    hasSessionCandidate: false,
    names: []
  };
  try {
    const cookieHeader = managedCookieHeaderOrThrow(await readManagedCookieHeader(LINUXDO_ACCOUNT_STATUS_URL));
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    cookieSummary = summarizeLinuxDoCookieHeader(cookieHeader);
    markDiagnosticStage(trace, 'credential', { source: 'linuxdo', hasCredential: Boolean(cookieHeader) });
    const currentUser = await getCurrentUserProfile({
      source: 'linuxdo',
      fetcher: withDiagnosticFetcher(trace, fetcher),
      discourseAuth: { linuxdo: { userAgent } },
      signal
    });
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    finishDiagnosticTrace(trace, 'success', { source: 'linuxdo' });
    return {
      session: siteSessionStateFromEvents('linuxdo', [
        {
          type: 'cookie-loaded',
          cookieSummary: cookieSummary.names,
          hasVerification: cookieSummary.hasClearance,
          loggedIn: true,
          currentUser,
          at: new Date().toISOString()
        }
      ])
    };
  } catch (error) {
    const canceled = signal.aborted || isCanceledRequest(error);
    const sourceError = canceled ? undefined : sourceErrorFromUnknown('linuxdo', error);
    if (sourceError?.kind === 'login-expired') {
      finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', reason: 'expired' });
      return {
        session: siteSessionStateFromEvents('linuxdo', [
          {
            type: 'cookie-loaded',
            cookieSummary: cookieSummary.names,
            hasVerification: cookieSummary.hasClearance,
            loggedIn: false,
            currentUser: null,
            at: new Date().toISOString()
          }
        ])
      };
    }
    finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
      source: 'linuxdo',
      reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
    });
    throw error;
  }
}
