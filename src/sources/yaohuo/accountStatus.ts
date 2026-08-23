import { checkYaohuoLogin } from '@/sources/readGateway';
import { summarizeYaohuoCookieHeader } from './session';
import { errorMessage, isCanceledRequest } from '@/platform/network/errors';
import { REQUEST_CANCELED_MESSAGE, type Fetcher } from '@/platform/network/request';
import { managedCookieHeaderOrThrow, type ManagedCookieReadResult } from '@/platform/network/managedCookies';
import type { UserProfile } from '@/domain/forum/models';
import { parseHtml } from '@/domain/forum/html';
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
import { fetchYaohuoHtml } from './reader';
import { parseYaohuoUserProfileDocument } from './userParser';
import { parseYaohuoListDocument } from './feedParser';
import { YAOHUO_BASE_URL, yaohuoUserProfileTopicListUrlFromRoot } from './protocol';

export const YAOHUO_ACCOUNT_STATUS_URL = `${YAOHUO_BASE_URL}/wapindex.aspx?sid=-2`;

async function enrichYaohuoAccountName(user: UserProfile, fetcher: Fetcher, signal: AbortSignal) {
  if ((user.displayName || user.username).trim() !== user.id) return user;
  const profilePage = await fetchYaohuoHtml(
    `${YAOHUO_BASE_URL}/bbs/userinfo.aspx?touserid=${encodeURIComponent(user.id)}&siteid=1000`,
    fetcher,
    { signal, validateLogin: false }
  );
  const profileRoot = parseHtml(profilePage.html);
  const parsedProfile = parseYaohuoUserProfileDocument(profileRoot, { id: user.id, username: user.username });
  const profile = {
    ...parsedProfile,
    topics: []
  };
  if ((profile.displayName || profile.username).trim() !== user.id) return profile;

  const topicUrl = yaohuoUserProfileTopicListUrlFromRoot(profileRoot, user.id, profilePage.url);
  if (!topicUrl) return profile;
  const topicPage = await fetchYaohuoHtml(topicUrl, fetcher, { signal, validateLogin: false });
  const topicAuthor = parseYaohuoListDocument(parseHtml(topicPage.html), topicPage.html, {
    classId: '0',
    limit: 30,
    page: 1,
    url: topicPage.url
  }).items.find((topic) => topic.author && topic.author !== user.id)?.author;
  return topicAuthor ? { ...profile, username: topicAuthor, displayName: topicAuthor } : profile;
}

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
      currentUser = await enrichYaohuoAccountName(verifiedUser, diagnosticFetcher, signal);
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
