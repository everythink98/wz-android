import { sessionSources, type SessionSource } from '@/domain/forum/sourceCatalog';
import type { UserProfile } from '@/domain/forum/models';

export type SessionSite = SessionSource;
export { sessionSources };
export type IdentityTrust = 'confirmed' | 'unknown' | 'none';
export type SiteSessionStatus =
  'anonymous' | 'verified' | 'logged-in' | 'verification-required' | 'verifying' | 'authorizing' | 'expired';

export type SiteSessionState = {
  site: SessionSite;
  status: SiteSessionStatus;
  cookieSummary: string[];
  isVerifying: boolean;
  currentUser?: UserProfile;
  lastVerifiedAt?: string;
  lastError?: string;
};

export type AccountStatusObservation = {
  failed?: boolean;
  session: SiteSessionState;
};

export type AccountSessionSnapshot = SiteSessionState & {
  identityTrust: IdentityTrust;
};

export type SiteSessionStates = Record<SessionSite, SiteSessionState>;
export type SiteSessionViewModel = {
  site: SessionSite;
  status: SiteSessionStatus;
  statusLabel: string;
  summaryLabel: string;
  cookieSummary: string[];
  isVerified: boolean;
  isLoggedIn: boolean;
  isVerifying: boolean;
  canWrite: boolean;
  identityTrust: IdentityTrust;
  currentUser?: UserProfile;
  lastVerifiedAt?: string;
  lastError?: string;
};
export type SiteSessionViewModels = Record<SessionSite, SiteSessionViewModel>;

export type SiteSessionEvent =
  | {
      type: 'cookie-loaded';
      cookieSummary?: string[];
      hasVerification?: boolean;
      loggedIn?: boolean;
      currentUser?: UserProfile | null;
      at?: string;
    }
  | {
      type: 'session-updated';
      cookieSummary?: string[];
      hasVerification?: boolean;
      loggedIn?: boolean;
      currentUser?: UserProfile | null;
      recoveryQueryKey?: readonly unknown[];
      at?: string;
    }
  | { type: 'verification-required'; message?: string; at?: string }
  | { type: 'verification-started'; at?: string }
  | { type: 'authorization-started'; at?: string }
  | { type: 'login-expired'; message?: string; recoveryQueryKey?: readonly unknown[]; at?: string }
  | { type: 'check-failed'; message: string; at?: string }
  | { type: 'recovery-failed'; message: string; at?: string }
  | { type: 'cleared'; recoveryQueryKey?: readonly unknown[]; at?: string };
export type ScopedSiteSessionEvent = SiteSessionEvent & { site: SessionSite };

export function siteSessionIdentityKey(session: Pick<SiteSessionState, 'currentUser' | 'site' | 'status'>) {
  return session.status === 'logged-in' && session.currentUser?.id
    ? `${session.site}:${session.currentUser.id}`
    : `${session.site}:anonymous`;
}

function cleanCookieSummary(cookieSummary: string[] = []) {
  return cookieSummary.map((item) => item.trim()).filter(Boolean);
}

function createSiteState(
  site: SessionSite,
  status: SiteSessionStatus,
  cookieSummary: string[] = [],
  lastVerifiedAt?: string
): SiteSessionState {
  return {
    site,
    status,
    cookieSummary: cleanCookieSummary(cookieSummary),
    isVerifying: status === 'verifying' || status === 'authorizing',
    ...(lastVerifiedAt ? { lastVerifiedAt } : {})
  };
}

export function createSiteSessionStates(states?: Partial<SiteSessionStates>): SiteSessionStates {
  return Object.fromEntries(
    sessionSources.map((site) => [site, states?.[site] || createSiteState(site, 'anonymous')])
  ) as SiteSessionStates;
}

export function createAccountSessionSnapshot(site: SessionSite): AccountSessionSnapshot {
  return {
    ...createSiteState(site, 'anonymous'),
    identityTrust: 'unknown'
  };
}

function hasValidAccountUser(session: Pick<SiteSessionState, 'currentUser' | 'site' | 'status'>) {
  return Boolean(
    session.status === 'logged-in' &&
    session.currentUser?.source === session.site &&
    typeof session.currentUser.id === 'string' &&
    session.currentUser.id.trim()
  );
}

export function accountSessionIdentityKey(session: Pick<AccountSessionSnapshot, 'currentUser' | 'site' | 'status'>) {
  return hasValidAccountUser(session)
    ? `${session.site}:${session.currentUser!.id.trim()}`
    : `${session.site}:anonymous`;
}

export function accountSessionAccess(snapshot: AccountSessionSnapshot) {
  const identityKey = accountSessionIdentityKey(snapshot);
  const authenticated = identityKey !== `${snapshot.site}:anonymous`;
  const identityTrust =
    (snapshot.identityTrust === 'confirmed' && !authenticated) || (snapshot.identityTrust === 'none' && authenticated)
      ? ('unknown' as const)
      : snapshot.identityTrust;
  return {
    authenticated,
    identityKey,
    identityTrust,
    canWrite: authenticated && identityTrust === 'confirmed'
  };
}

export function accountSessionSnapshotFromObservation(
  previous: AccountSessionSnapshot,
  observation: AccountStatusObservation
): AccountSessionSnapshot {
  const session = observation.session;
  if (session.site !== previous.site || (session.status === 'logged-in' && !hasValidAccountUser(session))) {
    return {
      ...previous,
      isVerifying: false,
      identityTrust: 'unknown',
      lastError: session.lastError || '账号状态缺少有效的当前用户'
    };
  }
  if (session.status === 'logged-in') {
    return { ...session, identityTrust: 'confirmed' };
  }
  if (session.status === 'anonymous' || session.status === 'verified' || session.status === 'expired') {
    return { ...session, currentUser: undefined, identityTrust: 'none' };
  }
  return { ...session, identityTrust: 'unknown' };
}

export function accountSessionSnapshotFromEvent(
  previous: AccountSessionSnapshot,
  event: SiteSessionEvent
): AccountSessionSnapshot {
  if (event.type === 'authorization-started' || event.type === 'verification-started') {
    return { ...previous, isVerifying: true, lastError: undefined };
  }
  if (event.type === 'verification-required') {
    return {
      ...previous,
      isVerifying: false,
      ...(event.message ? { lastError: event.message } : {})
    };
  }
  if (event.type === 'check-failed') {
    return { ...previous, isVerifying: false, identityTrust: 'unknown', lastError: event.message };
  }
  if (event.type === 'recovery-failed') {
    return { ...previous, isVerifying: false, lastError: event.message };
  }
  if ((event.type === 'cookie-loaded' || event.type === 'session-updated') && event.loggedIn === undefined) {
    return {
      ...reduceSiteSessionState(previous, { ...event, type: 'cookie-loaded' }),
      identityTrust: previous.identityTrust
    };
  }
  const session = reduceSiteSessionState(previous, event);
  return accountSessionSnapshotFromObservation(previous, { session });
}

export function siteSessionStateFromEvents(site: SessionSite, events: SiteSessionEvent[]) {
  return events.reduce<SiteSessionState>(reduceSiteSessionState, createSiteSessionStates()[site]);
}

function currentUserForSite(site: SessionSite, currentUser: UserProfile | null | undefined, loggedIn?: boolean) {
  if (!loggedIn || !currentUser || currentUser.source !== site || !currentUser.id || !currentUser.username) {
    return undefined;
  }
  return {
    ...currentUser,
    topics: []
  };
}

function stateWithCookieFacts(
  state: SiteSessionState,
  event: {
    cookieSummary?: string[];
    hasVerification?: boolean;
    loggedIn?: boolean;
    currentUser?: UserProfile | null;
    at?: string;
  }
) {
  const { cookieSummary, hasVerification, loggedIn, currentUser, at } = event;
  const nextCookieSummary = cleanCookieSummary(cookieSummary || state.cookieSummary);
  const status: SiteSessionStatus = loggedIn
    ? 'logged-in'
    : state.status === 'expired'
      ? 'expired'
      : (hasVerification ?? nextCookieSummary.length > 0)
        ? 'verified'
        : 'anonymous';
  const currentUserProvided = Object.prototype.hasOwnProperty.call(event, 'currentUser');
  const nextCurrentUser = currentUserProvided
    ? currentUserForSite(state.site, currentUser, loggedIn)
    : loggedIn
      ? state.currentUser
      : undefined;
  return {
    ...state,
    status,
    cookieSummary: nextCookieSummary,
    isVerifying: false,
    currentUser: nextCurrentUser,
    lastVerifiedAt: status === 'anonymous' || status === 'expired' ? state.lastVerifiedAt : at || state.lastVerifiedAt,
    ...(status === 'expired' ? { lastError: state.lastError } : { lastError: undefined })
  };
}

function stateWithObservedCredentials(
  state: SiteSessionState,
  event: {
    cookieSummary?: string[];
    hasVerification?: boolean;
    at?: string;
  }
) {
  if (state.status !== 'anonymous' && state.status !== 'verified') {
    return {
      ...state,
      cookieSummary: cleanCookieSummary(event.cookieSummary || state.cookieSummary)
    };
  }
  return stateWithCookieFacts(state, {
    ...event,
    loggedIn: false
  });
}

export function reduceSiteSessionState(state: SiteSessionState, event: SiteSessionEvent): SiteSessionState {
  if (event.type === 'cookie-loaded' && event.loggedIn === undefined) {
    return stateWithObservedCredentials(state, event);
  }
  if (event.type === 'cookie-loaded' || event.type === 'session-updated') {
    return stateWithCookieFacts(state, event);
  }
  if (event.type === 'verification-required') {
    if (state.status === 'logged-in') {
      return {
        ...state,
        isVerifying: false,
        ...(event.message ? { lastError: event.message } : {})
      };
    }
    return {
      ...state,
      status: 'verification-required',
      isVerifying: false,
      currentUser: undefined,
      ...(event.message ? { lastError: event.message } : {})
    };
  }
  if (event.type === 'verification-started') {
    if (state.status === 'logged-in') {
      return {
        ...state,
        isVerifying: true
      };
    }
    return {
      ...state,
      status: 'verifying',
      isVerifying: true,
      currentUser: undefined
    };
  }
  if (event.type === 'authorization-started') {
    return {
      ...state,
      status: 'authorizing',
      isVerifying: true,
      currentUser: undefined,
      lastError: undefined
    };
  }
  if (event.type === 'login-expired') {
    return {
      ...state,
      status: 'expired',
      isVerifying: false,
      currentUser: undefined,
      ...(event.message ? { lastError: event.message } : {})
    };
  }
  if (event.type === 'check-failed') {
    return {
      ...state,
      status: state.status === 'authorizing' ? 'anonymous' : state.status,
      isVerifying: false,
      ...(state.status === 'authorizing' ? { currentUser: undefined } : {}),
      lastError: event.message
    };
  }
  if (event.type === 'recovery-failed') {
    return {
      ...state,
      isVerifying: false,
      lastError: event.message
    };
  }
  return createSiteState(state.site, 'anonymous');
}

export function isSiteVerificationReady(state: SiteSessionState) {
  return state.status === 'verified' || state.status === 'logged-in';
}

export function isSiteLoggedIn(state: SiteSessionState) {
  return state.status === 'logged-in';
}

function siteStatusLabel(state: SiteSessionState) {
  if (state.status === 'logged-in') {
    return '已登录';
  }
  if (state.status === 'verified') {
    return '已验证';
  }
  if (state.status === 'verifying') {
    return '验证中';
  }
  if (state.status === 'authorizing') {
    return '授权中';
  }
  if (state.status === 'verification-required') {
    return '需要验证';
  }
  if (state.status === 'expired') {
    return '已失效';
  }
  return '未登录';
}

function siteSummaryLabel(state: SiteSessionState) {
  const statusLabel = siteStatusLabel(state);
  if (state.status === 'anonymous') {
    return state.site === 'linuxdo' ? '匿名可用' : '未登录';
  }
  if (state.status === 'expired') {
    return '已失效';
  }
  if (state.status === 'verification-required') {
    return state.lastError || '需要验证';
  }
  return statusLabel;
}

export function createSiteSessionViewModel(state: SiteSessionState): SiteSessionViewModel {
  const isLoggedIn = isSiteLoggedIn(state);
  const isVerified = isSiteVerificationReady(state);
  return {
    site: state.site,
    status: state.status,
    statusLabel: siteStatusLabel(state),
    summaryLabel: siteSummaryLabel(state),
    cookieSummary: state.cookieSummary,
    isVerified,
    isLoggedIn,
    isVerifying: state.isVerifying,
    canWrite: isLoggedIn,
    identityTrust: isLoggedIn ? 'confirmed' : 'none',
    ...(state.currentUser ? { currentUser: state.currentUser } : {}),
    ...(state.lastVerifiedAt ? { lastVerifiedAt: state.lastVerifiedAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {})
  };
}

export function createAccountSessionViewModel(snapshot: AccountSessionSnapshot): SiteSessionViewModel {
  const base = createSiteSessionViewModel(snapshot);
  const access = accountSessionAccess(snapshot);
  return {
    ...base,
    identityTrust: access.identityTrust,
    canWrite: access.canWrite,
    summaryLabel:
      access.identityTrust === 'unknown'
        ? snapshot.lastError
          ? '本次核对失败，可重试'
          : '账号状态尚未核对'
        : base.summaryLabel
  };
}

export function nodeSeekUserIdForSession(state: SiteSessionViewModel) {
  if (!state.isLoggedIn) {
    return null;
  }
  const currentUserId = Number(state.currentUser?.id);
  return Number.isInteger(currentUserId) && currentUserId > 0 ? currentUserId : null;
}

export function createSiteSessionViewModels(states: SiteSessionStates): SiteSessionViewModels {
  return Object.fromEntries(
    sessionSources.map((site) => [site, createSiteSessionViewModel(states[site])])
  ) as SiteSessionViewModels;
}
