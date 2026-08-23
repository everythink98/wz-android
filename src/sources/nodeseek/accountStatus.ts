import { getCurrentUserProfile } from '@/sources/readGateway';
import { summarizeNodeSeekCookieHeader } from './session';
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
import { NODESEEK_BASE_URL } from './protocol';

export const NODESEEK_ACCOUNT_STATUS_URL = `${NODESEEK_BASE_URL}/`;

export async function readNodeSeekAccountStatus({
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
  const trace = beginDiagnosticTrace('session', 'refresh', { source: 'nodeseek' });
  let cookieSummary: string[] = [];
  try {
    const cookieHeader = managedCookieHeaderOrThrow(await readManagedCookieHeader(NODESEEK_ACCOUNT_STATUS_URL));
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    const summary = summarizeNodeSeekCookieHeader(cookieHeader);
    cookieSummary = summary.names;
    markDiagnosticStage(trace, 'credential', { source: 'nodeseek', hasCredential: summary.count > 0 });
    const currentUser = await getCurrentUserProfile({
      source: 'nodeseek',
      nodeSeekAuthenticated: true,
      fetcher: withDiagnosticFetcher(trace, fetcher),
      nodeSeekUserAgent: userAgent,
      signal
    });
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    finishDiagnosticTrace(trace, 'success', { source: 'nodeseek' });
    return {
      session: siteSessionStateFromEvents('nodeseek', [
        {
          type: 'cookie-loaded',
          cookieSummary,
          hasVerification: summary.count > 0,
          loggedIn: Boolean(currentUser),
          currentUser,
          at: new Date().toISOString()
        }
      ])
    };
  } catch (error) {
    const canceled = signal.aborted || isCanceledRequest(error);
    const sourceError = canceled ? undefined : sourceErrorFromUnknown('nodeseek', error);
    if (sourceError?.kind === 'login-expired') {
      finishDiagnosticTrace(trace, 'success', { source: 'nodeseek', reason: 'expired' });
      return {
        session: siteSessionStateFromEvents('nodeseek', [
          {
            type: 'cookie-loaded',
            cookieSummary,
            hasVerification: cookieSummary.length > 0,
            loggedIn: false,
            currentUser: null,
            at: new Date().toISOString()
          }
        ])
      };
    }
    finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
      source: 'nodeseek',
      reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
    });
    throw error;
  }
}
