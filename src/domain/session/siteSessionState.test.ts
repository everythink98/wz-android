import { describe, expect, it } from 'vitest';
import {
  accountSessionAccess,
  accountSessionSnapshotFromEvent,
  accountSessionSnapshotFromObservation,
  createAccountSessionSnapshot,
  createAccountSessionViewModel,
  createSiteSessionViewModels,
  nodeSeekUserIdForSession,
  reduceSiteSessionState,
  createSiteSessionStates,
  isSiteLoggedIn,
  isSiteVerificationReady,
  siteSessionIdentityKey,
  type SiteSessionState
} from './siteSessionState';
import type { UserProfile } from '@/domain/forum/models';

describe('site session state', () => {
  it('[REG-ACCOUNT-042] keeps identity facts and trust in one normalized account snapshot', () => {
    const initial = createAccountSessionSnapshot('linuxdo');
    const confirmed = accountSessionSnapshotFromObservation(initial, {
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: ['_t'],
        isVerifying: false,
        currentUser: {
          source: 'linuxdo',
          id: '42',
          username: 'alice',
          url: 'https://linux.do/u/alice',
          topics: []
        }
      }
    });

    expect(createAccountSessionViewModel(confirmed)).toMatchObject({
      status: 'logged-in',
      identityTrust: 'confirmed',
      isLoggedIn: true,
      canWrite: true,
      currentUser: { id: '42' }
    });
    expect(accountSessionAccess(confirmed)).toEqual({
      authenticated: true,
      identityKey: 'linuxdo:42',
      identityTrust: 'confirmed',
      canWrite: true
    });

    const malformed = accountSessionSnapshotFromObservation(confirmed, {
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false
      }
    });
    expect(createAccountSessionViewModel(malformed)).toMatchObject({
      status: 'logged-in',
      identityTrust: 'unknown',
      isLoggedIn: true,
      canWrite: false,
      currentUser: { id: '42' }
    });

    const anonymous = accountSessionSnapshotFromObservation(confirmed, {
      session: {
        site: 'linuxdo',
        status: 'anonymous',
        cookieSummary: [],
        isVerifying: false
      }
    });
    expect(createAccountSessionViewModel(anonymous)).toMatchObject({
      status: 'anonymous',
      identityTrust: 'none',
      isLoggedIn: false,
      canWrite: false
    });
    expect(anonymous.currentUser).toBeUndefined();
  });

  it('keeps workflow and recovery events on the same account snapshot without revoking confirmed identity', () => {
    const confirmed = accountSessionSnapshotFromObservation(createAccountSessionSnapshot('linuxdo'), {
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: {
          source: 'linuxdo',
          id: '7',
          username: 'bob',
          url: 'https://www.linux.do/user/7',
          topics: []
        }
      }
    });

    const checking = accountSessionSnapshotFromEvent(confirmed, { type: 'authorization-started' });
    expect(checking).toMatchObject({
      status: 'logged-in',
      identityTrust: 'confirmed',
      isVerifying: true,
      currentUser: { id: '7' }
    });

    const recoveryFailed = accountSessionSnapshotFromEvent(confirmed, {
      type: 'recovery-failed',
      message: '原页面恢复失败'
    });
    expect(recoveryFailed).toMatchObject({
      status: 'logged-in',
      identityTrust: 'confirmed',
      currentUser: { id: '7' },
      lastError: '原页面恢复失败'
    });

    const revoked = accountSessionSnapshotFromEvent(confirmed, { type: 'cleared' });
    expect(revoked).toMatchObject({ status: 'anonymous', identityTrust: 'none' });
    expect(revoked.currentUser).toBeUndefined();
  });

  it('derives identity only from a confirmed logged-in user', () => {
    expect(
      siteSessionIdentityKey({ site: 'nodeseek', status: 'logged-in', currentUser: { id: '42' } as UserProfile })
    ).toBe('nodeseek:42');
    expect(siteSessionIdentityKey({ site: 'nodeseek', status: 'anonymous' })).toBe('nodeseek:anonymous');
  });

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
      type: 'cookie-loaded',
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

  it('distinguishes verified browser access from confirmed account login', () => {
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

  it('builds verified, logged-in, and expired UI labels from session status', () => {
    const viewModels = createSiteSessionViewModels(
      createSiteSessionStates({
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
      })
    );

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
    const viewModels = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'expired',
          cookieSummary: ['session'],
          isVerifying: false,
          lastError: 'NodeSeek 登录已失效'
        }
      })
    );

    expect(nodeSeekUserIdForSession(viewModels.nodeseek)).toBeNull();
    expect(
      nodeSeekUserIdForSession(
        createSiteSessionViewModels(
          createSiteSessionStates({
            nodeseek: {
              site: 'nodeseek',
              status: 'verification-required',
              cookieSummary: [],
              isVerifying: false,
              lastError: '需要验证'
            }
          })
        ).nodeseek
      )
    ).toBeNull();
    expect(nodeSeekUserIdForSession(createSiteSessionViewModels(createSiteSessionStates()).nodeseek)).toBeNull();
  });

  it('[REG-ACCOUNT-019] returns only the confirmed NodeSeek profile id as the session identity', () => {
    const view = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session'],
          isVerifying: false,
          currentUser: {
            source: 'nodeseek',
            id: '48872',
            username: '当前账号',
            url: 'https://www.nodeseek.com/space/48872',
            topics: []
          }
        }
      })
    ).nodeseek;

    expect(nodeSeekUserIdForSession(view)).toBe(48872);
    expect(
      nodeSeekUserIdForSession(
        createSiteSessionViewModels(
          createSiteSessionStates({
            nodeseek: {
              site: 'nodeseek',
              status: 'logged-in',
              cookieSummary: ['session'],
              isVerifying: false
            }
          })
        ).nodeseek
      )
    ).toBeNull();
  });

  it('moves observed login, verification status, expiry, and clearing through one reducer', () => {
    const initial = createSiteSessionStates();
    const loggedIn = {
      ...initial,
      linuxdo: reduceSiteSessionState(initial.linuxdo, {
        type: 'cookie-loaded',
        cookieSummary: ['cf_clearance', '_t', '_forum_session'],
        loggedIn: true,
        at: '2026-06-06T02:01:00.000Z'
      })
    };
    const verificationOnly = {
      ...loggedIn,
      linuxdo: reduceSiteSessionState(loggedIn.linuxdo, {
        type: 'cookie-loaded',
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

  it('[REG-ACCOUNT-039] keeps a confirmed identity while a challenged read recovery is retried', () => {
    const currentUser: UserProfile = {
      source: 'linuxdo',
      id: '42',
      username: 'alice',
      url: 'https://linux.do/u/alice',
      topics: []
    };
    const loggedIn = reduceSiteSessionState(createSiteSessionStates().linuxdo, {
      type: 'cookie-loaded',
      cookieSummary: ['cf_clearance', '_t'],
      loggedIn: true,
      currentUser,
      at: '2026-07-26T01:00:00.000Z'
    });

    const required = reduceSiteSessionState(loggedIn, {
      type: 'verification-required',
      message: '原页面仍需验证'
    });
    const verifying = reduceSiteSessionState(required, { type: 'verification-started' });

    expect(required).toMatchObject({
      status: 'logged-in',
      currentUser,
      isVerifying: false,
      lastError: '原页面仍需验证'
    });
    expect(verifying).toMatchObject({
      status: 'logged-in',
      currentUser,
      isVerifying: true
    });
  });

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    '[REG-ACCOUNT-023] keeps the confirmed %s identity when a read path only observes credentials',
    (site) => {
      const currentUser: UserProfile = {
        source: site,
        id: `${site}-user-id`,
        username: `${site}-user`,
        displayName: `${site} user`,
        url: `https://example.com/${site}`,
        topics: []
      };
      const loggedIn = reduceSiteSessionState(createSiteSessionStates()[site], {
        type: 'cookie-loaded',
        cookieSummary: ['confirmed-credential'],
        loggedIn: true,
        currentUser,
        at: '2026-07-23T01:00:00.000Z'
      });

      const observed = reduceSiteSessionState(loggedIn, {
        type: 'cookie-loaded',
        cookieSummary: ['refreshed-credential'],
        hasVerification: site === 'nodeseek' || site === 'linuxdo',
        at: '2026-07-23T01:05:00.000Z'
      });

      expect(observed).toMatchObject({
        status: 'logged-in',
        cookieSummary: ['refreshed-credential'],
        currentUser,
        lastVerifiedAt: '2026-07-23T01:00:00.000Z'
      });
    }
  );

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    '[REG-ACCOUNT-019] keeps %s explicitly expired when only unverified credentials are reloaded',
    (site) => {
      const expired = reduceSiteSessionState(createSiteSessionStates()[site], {
        type: 'login-expired',
        message: `${site} expired`
      });

      const reloaded = reduceSiteSessionState(expired, {
        type: 'cookie-loaded',
        cookieSummary: ['stale-credential'],
        hasVerification: site === 'nodeseek' || site === 'linuxdo',
        loggedIn: false,
        at: '2026-07-23T00:00:00.000Z'
      });

      expect(reloaded).toMatchObject({
        status: 'expired',
        lastError: `${site} expired`
      });
      expect(reloaded.currentUser).toBeUndefined();
    }
  );

  it('[REG-WRITE-022] removes write capability and current user after confirmed expiry', () => {
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

    expect(createSiteSessionViewModels(createSiteSessionStates({ yaohuo: loggedIn })).yaohuo.currentUser).toMatchObject(
      {
        source: 'yaohuo',
        id: '7',
        username: '火友'
      }
    );
    expect(refreshed.currentUser).toMatchObject({
      source: 'yaohuo',
      id: '7',
      username: '火友'
    });
    expect(cleared.currentUser).toBeUndefined();
    expect(expired.currentUser).toBeUndefined();
    expect(createSiteSessionViewModels(createSiteSessionStates({ yaohuo: expired })).yaohuo).toMatchObject({
      status: 'expired',
      canWrite: false
    });
  });
});
