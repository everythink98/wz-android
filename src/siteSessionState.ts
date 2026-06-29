import type { FeedSource, Source, UserProfile } from './types';

export type SessionSite = Extract<Source, 'nodeseek' | 'linuxdo' | 'yaohuo'>;
export type SiteSessionStatus = 'anonymous' | 'verified' | 'logged-in' | 'verification-required' | 'verifying' | 'expired';

export type SiteSessionState = {
  site: SessionSite;
  status: SiteSessionStatus;
  cookieSummary: string[];
  isVerifying: boolean;
  currentUser?: UserProfile;
  lastVerifiedAt?: string;
  lastError?: string;
};

export type SiteSessionStates = Record<SessionSite, SiteSessionState>;
export type DevAnonymousOverrides = Partial<Record<SessionSite, boolean>>;
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
  currentUser?: UserProfile;
  lastVerifiedAt?: string;
  lastError?: string;
};
export type SiteSessionViewModels = Record<SessionSite, SiteSessionViewModel>;

export type SiteSessionEvent =
  | { type: 'cookie-loaded'; cookieSummary?: string[]; hasVerification?: boolean; loggedIn?: boolean; currentUser?: UserProfile | null; at?: string }
  | { type: 'login-detected'; cookieSummary?: string[]; currentUser?: UserProfile | null; at?: string }
  | { type: 'verification-required'; message?: string; at?: string }
  | { type: 'verification-started'; at?: string }
  | { type: 'verification-succeeded'; cookieSummary?: string[]; loggedIn?: boolean; currentUser?: UserProfile | null; at: string }
  | { type: 'login-expired'; message?: string; at?: string }
  | { type: 'check-failed'; message: string; at?: string }
  | { type: 'cleared'; at?: string };
export type ScopedSiteSessionEvent = SiteSessionEvent & { site: SessionSite };

function cleanCookieSummary(cookieSummary: string[] = []) {
  return cookieSummary.map((item) => item.trim()).filter(Boolean);
}

function createSiteState(site: SessionSite, status: SiteSessionStatus, cookieSummary: string[] = [], lastVerifiedAt?: string): SiteSessionState {
  return {
    site,
    status,
    cookieSummary: cleanCookieSummary(cookieSummary),
    isVerifying: status === 'verifying',
    ...(lastVerifiedAt ? { lastVerifiedAt } : {})
  };
}

export function createSiteSessionStates(states?: Partial<SiteSessionStates>): SiteSessionStates {
  return {
    nodeseek: states?.nodeseek || createSiteState('nodeseek', 'anonymous'),
    linuxdo: states?.linuxdo || createSiteState('linuxdo', 'anonymous'),
    yaohuo: states?.yaohuo || createSiteState('yaohuo', 'anonymous')
  };
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

export function applyDevAnonymousOverrides(states: SiteSessionStates, overrides: DevAnonymousOverrides = {}): SiteSessionStates {
  if (!overrides.nodeseek && !overrides.linuxdo && !overrides.yaohuo) {
    return states;
  }
  return {
    nodeseek: overrides.nodeseek ? createSiteState('nodeseek', 'anonymous') : states.nodeseek,
    linuxdo: overrides.linuxdo ? createSiteState('linuxdo', 'anonymous') : states.linuxdo,
    yaohuo: overrides.yaohuo ? createSiteState('yaohuo', 'anonymous') : states.yaohuo
  };
}

export function isDevAnonymousSource(source: FeedSource, site: SessionSite, overrides: DevAnonymousOverrides = {}) {
  return Boolean(overrides[site] && (source === 'all' || source === site));
}

function stateWithCookieFacts(state: SiteSessionState, event: {
  cookieSummary?: string[];
  hasVerification?: boolean;
  loggedIn?: boolean;
  currentUser?: UserProfile | null;
  at?: string;
}) {
  const { cookieSummary, hasVerification, loggedIn, currentUser, at } = event;
  const nextCookieSummary = cleanCookieSummary(cookieSummary || state.cookieSummary);
  const status: SiteSessionStatus = loggedIn ? 'logged-in' : (hasVerification ?? nextCookieSummary.length > 0) ? 'verified' : 'anonymous';
  const currentUserProvided = Object.prototype.hasOwnProperty.call(event, 'currentUser');
  const nextCurrentUser = currentUserProvided ? currentUserForSite(state.site, currentUser, loggedIn) : loggedIn ? state.currentUser : undefined;
  return {
    ...state,
    status,
    cookieSummary: nextCookieSummary,
    isVerifying: false,
    currentUser: nextCurrentUser,
    lastVerifiedAt: status === 'anonymous' ? state.lastVerifiedAt : at || state.lastVerifiedAt,
    lastError: undefined
  };
}

export function reduceSiteSessionState(state: SiteSessionState, event: SiteSessionEvent): SiteSessionState {
  if (event.type === 'cookie-loaded') {
    return stateWithCookieFacts(state, event);
  }
  if (event.type === 'login-detected') {
    const currentUser = currentUserForSite(state.site, event.currentUser, true);
    return {
      ...state,
      status: 'logged-in',
      cookieSummary: cleanCookieSummary(event.cookieSummary || state.cookieSummary),
      isVerifying: false,
      currentUser,
      lastVerifiedAt: event.at || state.lastVerifiedAt,
      lastError: undefined
    };
  }
  if (event.type === 'verification-required') {
    return {
      ...state,
      status: 'verification-required',
      isVerifying: false,
      currentUser: undefined,
      ...(event.message ? { lastError: event.message } : {})
    };
  }
  if (event.type === 'verification-started') {
    return {
      ...state,
      status: 'verifying',
      isVerifying: true,
      currentUser: undefined
    };
  }
  if (event.type === 'verification-succeeded') {
    const currentUser = currentUserForSite(state.site, event.currentUser, event.loggedIn);
    return {
      ...state,
      status: event.loggedIn ? 'logged-in' : 'verified',
      cookieSummary: cleanCookieSummary(event.cookieSummary || state.cookieSummary),
      isVerifying: false,
      currentUser,
      lastVerifiedAt: event.at,
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
    ...(state.currentUser ? { currentUser: state.currentUser } : {}),
    ...(state.lastVerifiedAt ? { lastVerifiedAt: state.lastVerifiedAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {})
  };
}

export function nodeSeekLoginStateLabel(state: SiteSessionViewModel, webLoginUserId: number | null) {
  if (webLoginUserId) {
    return `网页已确认登录：用户 ${webLoginUserId}`;
  }
  return state.summaryLabel;
}

export function createSiteSessionViewModels(states: SiteSessionStates): SiteSessionViewModels {
  return {
    nodeseek: createSiteSessionViewModel(states.nodeseek),
    linuxdo: createSiteSessionViewModel(states.linuxdo),
    yaohuo: createSiteSessionViewModel(states.yaohuo)
  };
}
