import type { Source } from './types';

export type SessionSite = Extract<Source, 'nodeseek' | 'linuxdo' | 'yaohuo'>;
export type SiteSessionStatus = 'anonymous' | 'verified' | 'logged-in' | 'verification-required' | 'verifying' | 'expired';

export type SiteSessionState = {
  site: SessionSite;
  status: SiteSessionStatus;
  cookieSummary: string[];
  isVerifying: boolean;
  lastVerifiedAt?: string;
  lastError?: string;
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
  lastVerifiedAt?: string;
  lastError?: string;
};
export type SiteSessionViewModels = Record<SessionSite, SiteSessionViewModel>;

export type SiteSessionEvent =
  | { type: 'cookie-loaded'; cookieSummary?: string[]; hasVerification?: boolean; loggedIn?: boolean; at?: string }
  | { type: 'login-detected'; cookieSummary?: string[]; at?: string }
  | { type: 'verification-required'; message?: string; at?: string }
  | { type: 'verification-started'; at?: string }
  | { type: 'verification-succeeded'; cookieSummary?: string[]; loggedIn?: boolean; at: string }
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

export function deriveNodeSeekSessionState({
  hasCookie,
  hasLoginCookie,
  cookieNames = []
}: {
  hasCookie: boolean;
  hasLoginCookie: boolean;
  cookieNames?: string[];
}): SiteSessionState {
  return createSiteState('nodeseek', hasLoginCookie ? 'logged-in' : hasCookie ? 'verified' : 'anonymous', cookieNames);
}

export function deriveLinuxDoSessionState({
  hasClearance,
  hasLogin,
  cookieNames = []
}: {
  hasClearance: boolean;
  hasLogin: boolean;
  cookieNames?: string[];
}): SiteSessionState {
  return createSiteState('linuxdo', hasLogin ? 'logged-in' : hasClearance ? 'verified' : 'anonymous', cookieNames);
}

export function deriveYaohuoSessionState({
  hasLoginCookie,
  cookieNames = []
}: {
  hasLoginCookie: boolean;
  cookieNames?: string[];
}): SiteSessionState {
  return createSiteState('yaohuo', hasLoginCookie ? 'logged-in' : 'anonymous', cookieNames);
}

export function createSiteSessionStates(states?: Partial<SiteSessionStates>): SiteSessionStates {
  return {
    nodeseek: states?.nodeseek || createSiteState('nodeseek', 'anonymous'),
    linuxdo: states?.linuxdo || createSiteState('linuxdo', 'anonymous'),
    yaohuo: states?.yaohuo || createSiteState('yaohuo', 'anonymous')
  };
}

function stateWithCookieFacts(state: SiteSessionState, {
  cookieSummary,
  hasVerification,
  loggedIn,
  at
}: {
  cookieSummary?: string[];
  hasVerification?: boolean;
  loggedIn?: boolean;
  at?: string;
}) {
  const nextCookieSummary = cleanCookieSummary(cookieSummary || state.cookieSummary);
  const status: SiteSessionStatus = loggedIn ? 'logged-in' : (hasVerification ?? nextCookieSummary.length > 0) ? 'verified' : 'anonymous';
  return {
    ...state,
    status,
    cookieSummary: nextCookieSummary,
    isVerifying: false,
    lastVerifiedAt: status === 'anonymous' ? state.lastVerifiedAt : at || state.lastVerifiedAt,
    lastError: undefined
  };
}

export function reduceSiteSessionState(state: SiteSessionState, event: SiteSessionEvent): SiteSessionState {
  if (event.type === 'cookie-loaded') {
    return stateWithCookieFacts(state, event);
  }
  if (event.type === 'login-detected') {
    return {
      ...state,
      status: 'logged-in',
      cookieSummary: cleanCookieSummary(event.cookieSummary || state.cookieSummary),
      isVerifying: false,
      lastVerifiedAt: event.at || state.lastVerifiedAt,
      lastError: undefined
    };
  }
  if (event.type === 'verification-required') {
    return {
      ...state,
      status: 'verification-required',
      isVerifying: false,
      ...(event.message ? { lastError: event.message } : {})
    };
  }
  if (event.type === 'verification-started') {
    return {
      ...state,
      status: 'verifying',
      isVerifying: true
    };
  }
  if (event.type === 'verification-succeeded') {
    return {
      ...state,
      status: event.loggedIn ? 'logged-in' : 'verified',
      cookieSummary: cleanCookieSummary(event.cookieSummary || state.cookieSummary),
      isVerifying: false,
      lastVerifiedAt: event.at,
      lastError: undefined
    };
  }
  if (event.type === 'login-expired') {
    return {
      ...state,
      status: 'expired',
      isVerifying: false,
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

export function reduceSiteSessionStates(states: SiteSessionStates, event: ScopedSiteSessionEvent): SiteSessionStates {
  return {
    ...states,
    [event.site]: reduceSiteSessionState(states[event.site], event)
  };
}

export function applySiteSessionEvent(state: SiteSessionState, event: SiteSessionEvent): SiteSessionState {
  return reduceSiteSessionState(state, event);
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
  if (!state.cookieSummary.length) {
    return statusLabel;
  }
  return `${statusLabel} ${state.cookieSummary.join('、')}`;
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
    ...(state.lastVerifiedAt ? { lastVerifiedAt: state.lastVerifiedAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {})
  };
}

export function createSiteSessionViewModels(states: SiteSessionStates): SiteSessionViewModels {
  return {
    nodeseek: createSiteSessionViewModel(states.nodeseek),
    linuxdo: createSiteSessionViewModel(states.linuxdo),
    yaohuo: createSiteSessionViewModel(states.yaohuo)
  };
}
