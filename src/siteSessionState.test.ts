import { describe, expect, it } from 'vitest';
import {
  createSiteSessionViewModels,
  applyDevAnonymousOverrides,
  nodeSeekUserIdForSession,
  reduceSiteSessionState,
  createSiteSessionStates,
  isDevAnonymousSource,
  isSiteLoggedIn,
  isSiteVerificationReady,
  type SiteSessionState
} from './siteSessionState';
import type { UserProfile } from './types';

describe('site session state', () => {
  it('keeps verification and login transitions explicit', () => {
    const initial: SiteSessionState = {
      site: 'linuxdo',
      status: 'verified',
      cookieSummary: ['cf_clearance'],
      isVerifying: false,
      lastVerifiedAt: '2026-06-06T01:00:00.000Z'
    };

    const required = reduceSiteSessionState(initial, {
      type: 'verification-required',
      message: '需要验证',
      at: '2026-06-06T01:05:00.000Z'
    });
    expect(required).toMatchObject({
      status: 'verification-required',
      isVerifying: false,
      lastError: '需要验证'
    });

    const verifying = reduceSiteSessionState(required, {
      type: 'verification-started',
      at: '2026-06-06T01:06:00.000Z'
    });
    expect(verifying).toMatchObject({
      status: 'verifying',
      isVerifying: true
    });

    const verified = reduceSiteSessionState(verifying, {
      type: 'verification-succeeded',
      cookieSummary: ['cf_clearance', '_t'],
      loggedIn: true,
      at: '2026-06-06T01:07:00.000Z'
    });
    expect(verified).toMatchObject({
      status: 'logged-in',
      isVerifying: false,
      cookieSummary: ['cf_clearance', '_t'],
      lastVerifiedAt: '2026-06-06T01:07:00.000Z',
      lastError: undefined
    });
  });

  it('keeps site capabilities derived from canonical status instead of scattered booleans', () => {
    const states = createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'verified',
        cookieSummary: ['cf_clearance'],
        isVerifying: false
      },
      linuxdo: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: ['cf_clearance', '_t'],
        isVerifying: false
      },
      yaohuo: {
        site: 'yaohuo',
        status: 'logged-in',
        cookieSummary: ['sidyaohuo'],
        isVerifying: false
      }
    });

    expect(isSiteVerificationReady(states.nodeseek)).toBe(true);
    expect(isSiteLoggedIn(states.nodeseek)).toBe(false);
    expect(isSiteLoggedIn(states.linuxdo)).toBe(true);
    expect(isSiteLoggedIn(states.yaohuo)).toBe(true);
  });

  it('loads cookies without turning Cloudflare-only cookies into login', () => {
    const state = reduceSiteSessionState(createSiteSessionStates().nodeseek, {
      type: 'cookie-loaded',
      cookieSummary: ['cf_clearance'],
      hasVerification: true,
      loggedIn: false,
      at: '2026-06-06T02:00:00.000Z'
    });

    expect(state).toMatchObject({
      site: 'nodeseek',
      status: 'verified',
      cookieSummary: ['cf_clearance'],
      isVerifying: false,
      lastVerifiedAt: '2026-06-06T02:00:00.000Z'
    });
    expect(isSiteVerificationReady(state)).toBe(true);
    expect(isSiteLoggedIn(state)).toBe(false);
  });

  it('loads saved yaohuo session cookies without treating them as logged in', () => {
    const state = reduceSiteSessionState(createSiteSessionStates().yaohuo, {
      type: 'cookie-loaded',
      cookieSummary: ['ASP.NET_SessionId', 'GUID'],
      hasVerification: false,
      loggedIn: false,
      at: '2026-06-06T02:00:00.000Z'
    });
    const viewModel = createSiteSessionViewModels(createSiteSessionStates({ yaohuo: state })).yaohuo;

    expect(state).toMatchObject({
      site: 'yaohuo',
      status: 'anonymous',
      cookieSummary: ['ASP.NET_SessionId', 'GUID'],
      isVerifying: false
    });
    expect(viewModel).toMatchObject({
      statusLabel: '未登录',
      summaryLabel: '未登录',
      isLoggedIn: false,
      canWrite: false
    });
  });

  it('builds UI view models from canonical session state without separate login booleans', () => {
    const viewModels = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'verified',
        cookieSummary: ['cf_clearance'],
        isVerifying: false
      },
      linuxdo: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: ['cf_clearance', '_t'],
        isVerifying: false
      },
      yaohuo: {
        site: 'yaohuo',
        status: 'expired',
        cookieSummary: ['sidyaohuo'],
        isVerifying: false,
        lastError: '妖火登录已失效'
      }
    }));

    expect(viewModels.nodeseek).toMatchObject({
      statusLabel: '已验证',
      summaryLabel: '已验证',
      cookieSummary: ['cf_clearance'],
      isVerified: true,
      isLoggedIn: false,
      canWrite: false
    });
    expect(viewModels.linuxdo).toMatchObject({
      statusLabel: '已登录',
      summaryLabel: '已登录',
      cookieSummary: ['cf_clearance', '_t'],
      isVerified: true,
      isLoggedIn: true,
      canWrite: true
    });
    expect(viewModels.yaohuo).toMatchObject({
      statusLabel: '已失效',
      summaryLabel: '已失效',
      isVerified: false,
      isLoggedIn: false,
      canWrite: false,
      lastError: '妖火登录已失效'
    });
  });

  it('does not describe expired or verification-required NodeSeek sessions as saved', () => {
    const viewModels = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'expired',
        cookieSummary: ['session'],
        isVerifying: false,
        lastError: 'NodeSeek 登录已失效'
      }
    }));

    expect(nodeSeekUserIdForSession(viewModels.nodeseek, null)).toBeNull();
    expect(nodeSeekUserIdForSession(viewModels.nodeseek, 123)).toBeNull();
    expect(nodeSeekUserIdForSession(createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'verification-required',
        cookieSummary: [],
        isVerifying: false,
        lastError: '需要验证'
      }
    })).nodeseek, 123)).toBeNull();
    expect(nodeSeekUserIdForSession(createSiteSessionViewModels(createSiteSessionStates()).nodeseek, 123)).toBeNull();
  });

  it('moves login detection, verification success, expiry, and clearing through one reducer', () => {
    const initial = createSiteSessionStates();
    const loggedIn = {
      ...initial,
      linuxdo: reduceSiteSessionState(initial.linuxdo, {
        type: 'login-detected',
        cookieSummary: ['cf_clearance', '_t', '_forum_session'],
        at: '2026-06-06T02:01:00.000Z'
      })
    };
    const verificationOnly = {
      ...loggedIn,
      linuxdo: reduceSiteSessionState(loggedIn.linuxdo, {
        type: 'verification-succeeded',
        cookieSummary: ['cf_clearance'],
        loggedIn: false,
        at: '2026-06-06T02:02:00.000Z'
      })
    };
    const expired = {
      ...verificationOnly,
      yaohuo: reduceSiteSessionState(verificationOnly.yaohuo, {
        type: 'login-expired',
        message: '妖火登录已失效',
        at: '2026-06-06T02:03:00.000Z'
      })
    };
    const cleared = {
      ...expired,
      linuxdo: reduceSiteSessionState(expired.linuxdo, {
        type: 'cleared',
        at: '2026-06-06T02:04:00.000Z'
      })
    };

    expect(loggedIn.linuxdo).toMatchObject({
      status: 'logged-in',
      cookieSummary: ['cf_clearance', '_t', '_forum_session'],
      lastVerifiedAt: '2026-06-06T02:01:00.000Z'
    });
    expect(verificationOnly.linuxdo).toMatchObject({
      status: 'verified',
      cookieSummary: ['cf_clearance'],
      lastVerifiedAt: '2026-06-06T02:02:00.000Z'
    });
    expect(expired.yaohuo).toMatchObject({
      status: 'expired',
      lastError: '妖火登录已失效'
    });
    expect(cleared.linuxdo).toMatchObject({
      status: 'anonymous',
      cookieSummary: []
    });
    expect(cleared.nodeseek).toBe(initial.nodeseek);
  });

  it('keeps the previous session when an account check fails', () => {
    const initial: SiteSessionState = {
      site: 'linuxdo',
      status: 'logged-in',
      cookieSummary: ['cf_clearance', '_t'],
      isVerifying: false,
      lastVerifiedAt: '2026-06-06T02:01:00.000Z'
    };

    const checked = reduceSiteSessionState(initial, {
      type: 'check-failed',
      message: '网络错误'
    });

    expect(checked).toMatchObject({
      status: 'logged-in',
      cookieSummary: ['cf_clearance', '_t'],
      lastVerifiedAt: '2026-06-06T02:01:00.000Z',
      lastError: '网络错误'
    });
  });

  it('attaches current user identity only while the site is logged in', () => {
    const currentUser: UserProfile = {
      source: 'yaohuo',
      id: '7',
      username: '火友',
      displayName: '火友',
      url: 'https://yaohuo.me/bbs/userinfo.aspx?touserid=7',
      topics: []
    };

    const loggedIn = reduceSiteSessionState(createSiteSessionStates().yaohuo, {
      type: 'cookie-loaded',
      cookieSummary: ['sidyaohuo'],
      loggedIn: true,
      currentUser,
      at: '2026-06-06T02:00:00.000Z'
    });
    const expired = reduceSiteSessionState(loggedIn, {
      type: 'login-expired',
      message: '妖火登录已失效'
    });
    const refreshed = reduceSiteSessionState(loggedIn, {
      type: 'cookie-loaded',
      cookieSummary: ['sidyaohuo'],
      loggedIn: true
    });
    const cleared = reduceSiteSessionState(refreshed, {
      type: 'cookie-loaded',
      cookieSummary: ['sidyaohuo'],
      loggedIn: true,
      currentUser: null
    });

    expect(createSiteSessionViewModels(createSiteSessionStates({ yaohuo: loggedIn })).yaohuo.currentUser).toMatchObject({
      source: 'yaohuo',
      id: '7',
      username: '火友'
    });
    expect(refreshed.currentUser).toMatchObject({
      source: 'yaohuo',
      id: '7',
      username: '火友'
    });
    expect(cleared.currentUser).toBeUndefined();
    expect(expired.currentUser).toBeUndefined();
  });

  it('applies temporary anonymous overrides without mutating saved session state', () => {
    const states = createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: ['session'],
        isVerifying: false
      },
      linuxdo: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: ['cf_clearance', '_t'],
        isVerifying: false
      },
      yaohuo: {
        site: 'yaohuo',
        status: 'logged-in',
        cookieSummary: ['sidyaohuo'],
        isVerifying: false
      }
    });

    const effective = applyDevAnonymousOverrides(states, { nodeseek: true, linuxdo: true });

    expect(effective.nodeseek).toMatchObject({ status: 'anonymous', cookieSummary: [] });
    expect(effective.linuxdo).toMatchObject({ status: 'anonymous', cookieSummary: [] });
    expect(effective.yaohuo).toBe(states.yaohuo);
    expect(states.nodeseek).toMatchObject({ status: 'logged-in', cookieSummary: ['session'] });
    expect(createSiteSessionViewModels(effective).linuxdo).toMatchObject({
      summaryLabel: '匿名可用',
      canWrite: false
    });
  });

  it('matches temporary anonymous overrides only for all or the selected source', () => {
    expect(isDevAnonymousSource('all', 'nodeseek', { nodeseek: true })).toBe(true);
    expect(isDevAnonymousSource('nodeseek', 'nodeseek', { nodeseek: true })).toBe(true);
    expect(isDevAnonymousSource('yaohuo', 'nodeseek', { nodeseek: true })).toBe(false);
    expect(isDevAnonymousSource('nodeseek', 'nodeseek', { nodeseek: false })).toBe(false);
  });
});
