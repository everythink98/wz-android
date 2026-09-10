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
import { LINUXDO_BASE_URL } from './protocol';

export const LINUXDO_ACCOUNT_STATUS_URL = `${LINUXDO_BASE_URL}/session/current.json`;

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
    markDiagnosticStage(trace, 'credential', {
      source: 'linuxdo',
      hasCredential: Boolean(cookieHeader),
      hasLoginCookie: cookieHeader.split(';').some((part) => /^_t=.+/.test(part.trim())),
      hasVerificationCookie: cookieSummary.hasClearance
    });
    const currentUser = await getCurrentUserProfile({
      source: 'linuxdo',
      fetcher: withDiagnosticFetcher(trace, fetcher),
      discourseAuth: { userAgent },
      signal
    });
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    finishDiagnosticTrace(trace, 'success', { source: 'linuxdo', state: 'confirmed', accountEvidence: 'current-user' });
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
      const evidence = (error as { accountEvidence?: unknown }).accountEvidence;
      finishDiagnosticTrace(trace, 'success', {
        source: 'linuxdo',
        state: 'expired',
        reason: 'login_required',
        ...(evidence === 'session-404' || evidence === 'null-user' ? { accountEvidence: evidence } : {})
      });
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
