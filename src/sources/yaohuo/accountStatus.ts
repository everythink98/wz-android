import { checkYaohuoLogin, getUserProfile } from '@/sources/readGateway';
import { summarizeYaohuoCookieHeader } from './session';
import { errorMessage, isCanceledRequest } from '@/platform/network/errors';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import { managedCookieHeaderOrThrow, type ManagedCookieReadResult } from '@/platform/network/managedCookies';
import {
  siteSessionStateFromEvents,
  type AccountStatusObservation,
  type SiteSessionEvent
} from '@/domain/session/siteSessionState';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  withDiagnosticFetcher
} from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';

export const YAOHUO_ACCOUNT_STATUS_URL = 'https://www.yaohuo.me/wapindex.aspx?sid=-2';

export async function readYaohuoAccountStatus({
  fetcher,
  readManagedCookieHeader,
  signal
}: {
  fetcher: Fetcher;
  readManagedCookieHeader: (exactUrl: string) => Promise<ManagedCookieReadResult>;
  signal: AbortSignal;
}): Promise<AccountStatusObservation> {
  const trace = beginDiagnosticTrace('session', 'refresh', { source: 'yaohuo' });
  try {
    const cookieHeader = managedCookieHeaderOrThrow(await readManagedCookieHeader(YAOHUO_ACCOUNT_STATUS_URL));
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    const cookieSummary = summarizeYaohuoCookieHeader(cookieHeader).names;
    const diagnosticFetcher = withDiagnosticFetcher(trace, fetcher);
    markDiagnosticStage(trace, 'credential', { source: 'yaohuo', hasCredential: Boolean(cookieHeader) });
    const check = await checkYaohuoLogin({ yaohuoFetcher: diagnosticFetcher, signal });
    const expired = 'reason' in check && check.reason === 'expired';
    if (!check.ok && !expired) throw new Error(check.message || '妖火登录状态暂时无法确认。');
    if (expired) {
      if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
      finishDiagnosticTrace(trace, 'success', { source: 'yaohuo' });
      return {
        session: siteSessionStateFromEvents('yaohuo', [
          {
            type: 'cookie-loaded',
            cookieSummary,
            hasVerification: false,
            loggedIn: false,
            currentUser: null,
            at: new Date().toISOString()
          }
        ])
      };
    }
    const verifiedUser = 'currentUser' in check ? check.currentUser : undefined;
    if (!verifiedUser) throw new Error('妖火登录状态暂时无法确认。');
    let currentUser = verifiedUser;
    let profileError: unknown;
    try {
      currentUser = await getUserProfile({
        source: 'yaohuo',
        id: verifiedUser.id,
        username: verifiedUser.username,
        fetcher: diagnosticFetcher,
        signal
      });
    } catch (error) {
      if (signal.aborted || isCanceledRequest(error)) throw error;
      profileError = error;
    }
    if (signal.aborted) throw new Error(REQUEST_CANCELED_MESSAGE);
    finishDiagnosticTrace(trace, profileError ? 'partial' : 'success', {
      source: 'yaohuo',
      ...(profileError ? { reason: normalizeDiagnosticReason(profileError) } : {})
    });
    const events: SiteSessionEvent[] = [
      {
        type: 'cookie-loaded',
        cookieSummary,
        hasVerification: false,
        loggedIn: true,
        currentUser,
        at: new Date().toISOString()
      }
    ];
    if (profileError) events.push({ type: 'check-failed', message: errorMessage(profileError) });
    return {
      failed: Boolean(profileError),
      session: siteSessionStateFromEvents('yaohuo', events)
    };
  } catch (error) {
    const canceled = signal.aborted || isCanceledRequest(error);
    finishDiagnosticTrace(trace, canceled ? 'canceled' : 'failure', {
      source: 'yaohuo',
      reason: canceled ? 'canceled' : normalizeDiagnosticReason(error)
    });
    throw error;
  }
}
