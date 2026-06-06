import { describe, expect, it } from 'vitest';
import {
  applySiteSessionEvent,
  createSiteSessionViewModels,
  reduceSiteSessionState,
  reduceSiteSessionStates,
  createSiteSessionStates,
  deriveLinuxDoSessionState,
  deriveNodeSeekSessionState,
  deriveYaohuoSessionState,
  isSiteLoggedIn,
  isSiteVerificationReady,
  type SiteSessionState
} from './siteSessionState';

describe('site session state', () => {
  it('derives one canonical status per site from current cookie facts', () => {
    expect(deriveNodeSeekSessionState({
      hasCookie: true,
      hasLoginCookie: true,
      cookieNames: ['uid', 'session']
    })).toMatchObject({
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: ['uid', 'session'],
      isVerifying: false
    });

    expect(deriveLinuxDoSessionState({
      hasClearance: true,
      hasLogin: false,
      cookieNames: ['cf_clearance']
    })).toMatchObject({
      site: 'linuxdo',
      status: 'verified',
      cookieSummary: ['cf_clearance']
    });

    expect(deriveYaohuoSessionState({
      hasLoginCookie: false,
      cookieNames: []
    })).toMatchObject({
      site: 'yaohuo',
      status: 'anonymous',
      cookieSummary: []
    });
  });

  it('keeps verification and login transitions explicit', () => {
    const initial: SiteSessionState = {
      site: 'linuxdo',
      status: 'verified',
      cookieSummary: ['cf_clearance'],
      isVerifying: false,
      lastVerifiedAt: '2026-06-06T01:00:00.000Z'
    };

    const required = applySiteSessionEvent(initial, {
      type: 'verification-required',
      message: '需要验证',
      at: '2026-06-06T01:05:00.000Z'
    });
    expect(required).toMatchObject({
      status: 'verification-required',
      isVerifying: false,
      lastError: '需要验证'
    });

    const verifying = applySiteSessionEvent(required, {
      type: 'verification-started',
      at: '2026-06-06T01:06:00.000Z'
    });
    expect(verifying).toMatchObject({
      status: 'verifying',
      isVerifying: true
    });

    const verified = applySiteSessionEvent(verifying, {
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
      nodeseek: deriveNodeSeekSessionState({ hasCookie: true, hasLoginCookie: false, cookieNames: ['cf_clearance'] }),
      linuxdo: deriveLinuxDoSessionState({ hasClearance: true, hasLogin: true, cookieNames: ['cf_clearance', '_t'] }),
      yaohuo: deriveYaohuoSessionState({ hasLoginCookie: true, cookieNames: ['sidyaohuo'] })
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
      summaryLabel: '已验证 cf_clearance',
      isVerified: true,
      isLoggedIn: false,
      canWrite: false
    });
    expect(viewModels.linuxdo).toMatchObject({
      statusLabel: '已登录',
      summaryLabel: '已登录 cf_clearance、_t',
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

  it('moves login detection, verification success, expiry, and clearing through one reducer', () => {
    const initial = createSiteSessionStates();
    const loggedIn = reduceSiteSessionStates(initial, {
      site: 'linuxdo',
      type: 'login-detected',
      cookieSummary: ['cf_clearance', '_t', '_forum_session'],
      at: '2026-06-06T02:01:00.000Z'
    });
    const verificationOnly = reduceSiteSessionStates(loggedIn, {
      site: 'linuxdo',
      type: 'verification-succeeded',
      cookieSummary: ['cf_clearance'],
      loggedIn: false,
      at: '2026-06-06T02:02:00.000Z'
    });
    const expired = reduceSiteSessionStates(verificationOnly, {
      site: 'yaohuo',
      type: 'login-expired',
      message: '妖火登录已失效',
      at: '2026-06-06T02:03:00.000Z'
    });
    const cleared = reduceSiteSessionStates(expired, {
      site: 'linuxdo',
      type: 'cleared',
      at: '2026-06-06T02:04:00.000Z'
    });

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
});
