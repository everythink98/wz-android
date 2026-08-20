import { describe, expect, it } from 'vitest';
import type { CredentialSummaries } from '@/platform/storage/credentialVault';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import { accountCenterSummary, createSiteAccountViews } from './accountCenter';

function emptyCredentialSummaries(): CredentialSummaries {
  return {
    nodeseek: { site: 'nodeseek', state: 'missing', hasCredential: false, protection: null },
    linuxdo: { site: 'linuxdo', state: 'missing', hasCredential: false, protection: null },
    yaohuo: { site: 'yaohuo', state: 'missing', hasCredential: false, protection: null }
  };
}

describe('account center view', () => {
  it('orders all sites and maps the primary action from session and credential state', () => {
    const credentials = emptyCredentialSummaries();
    credentials.nodeseek = { site: 'nodeseek', state: 'saved', hasCredential: true, protection: 'biometric' };
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: { site: 'nodeseek', status: 'expired', cookieSummary: [], isVerifying: false },
        linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: ['_t'], isVerifying: false },
        yaohuo: { site: 'yaohuo', status: 'verification-required', cookieSummary: [], isVerifying: false }
      })
    );

    const views = createSiteAccountViews(sessions, credentials);

    expect(views.map((view) => view.site)).toEqual(['nodeseek', 'linuxdo', 'yaohuo']);
    expect(views[0]).toMatchObject({ primaryAction: 'open-login-with-fill', primaryLabel: '重新登录并填入' });
    expect(views[1]).toMatchObject({ isLoggedIn: true, primaryAction: 'none', primaryLabel: '已登录' });
    expect(views[2]).toMatchObject({ primaryAction: 'open-login', primaryLabel: '去验证' });
    expect(accountCenterSummary(views)).toBe('待处理 2 · 网站登录 1/3 · 自动填入 1/3');
  });

  it('keeps the zero-attention count visible', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: { site: 'nodeseek', status: 'logged-in', cookieSummary: ['session'], isVerifying: false },
        linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: ['_t'], isVerifying: false },
        yaohuo: { site: 'yaohuo', status: 'logged-in', cookieSummary: ['ASP.NET_SessionId'], isVerifying: false }
      })
    );

    expect(accountCenterSummary(createSiteAccountViews(sessions, emptyCredentialSummaries()))).toBe(
      '待处理 0 · 网站登录 3/3 · 自动填入 0/3'
    );
  });

  it('opens the identified linux.do account profile after login', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        linuxdo: {
          site: 'linuxdo',
          status: 'logged-in',
          cookieSummary: [],
          isVerifying: false,
          currentUser: {
            source: 'linuxdo',
            id: 'alice',
            username: 'alice',
            displayName: 'Alice',
            url: '',
            topics: []
          }
        }
      })
    );

    expect(
      createSiteAccountViews(sessions, emptyCredentialSummaries()).find((view) => view.site === 'linuxdo')
    ).toMatchObject({
      primaryAction: 'open-user',
      primaryLabel: '查看我的主页'
    });
  });

  it('keeps invalidated login information visible and actionable', () => {
    const credentials = emptyCredentialSummaries();
    credentials.nodeseek = {
      site: 'nodeseek',
      state: 'invalidated',
      hasCredential: false,
      protection: null
    };
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: { site: 'nodeseek', status: 'logged-in', cookieSummary: ['session'], isVerifying: false },
        linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: ['_t'], isVerifying: false },
        yaohuo: { site: 'yaohuo', status: 'logged-in', cookieSummary: ['ASP.NET_SessionId'], isVerifying: false }
      })
    );
    const views = createSiteAccountViews(sessions, credentials);

    expect(views[0].rowSummary).toContain('自动填入需重新设置');
    expect(accountCenterSummary(views)).toBe('待处理 1 · 网站登录 3/3 · 自动填入 0/3');
  });

  it('opens an identified logged-in account profile', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session'],
          isVerifying: false,
          currentUser: {
            source: 'nodeseek',
            id: '7',
            username: 'alice',
            url: 'https://www.nodeseek.com/space/7',
            topics: []
          }
        }
      })
    );

    expect(createSiteAccountViews(sessions, emptyCredentialSummaries())[0]).toMatchObject({
      identityLabel: 'alice',
      primaryAction: 'open-user',
      primaryLabel: '查看我的主页'
    });
  });

  it('[REG-ACCOUNT-041] keeps a last-known profile while counting terminal unknown as awaiting reconciliation', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session'],
          isVerifying: false,
          currentUser: {
            source: 'nodeseek',
            id: '7',
            username: 'alice',
            url: 'https://www.nodeseek.com/space/7',
            topics: []
          }
        }
      })
    );
    sessions.nodeseek = {
      ...sessions.nodeseek,
      canWrite: false,
      identityTrust: 'unknown',
      summaryLabel: '本次核对失败，可重试'
    };

    const views = createSiteAccountViews(sessions, emptyCredentialSummaries());

    expect(views[0]).toMatchObject({
      identityTrust: 'unknown',
      identityLabel: 'alice',
      needsAttention: true,
      primaryAction: 'open-user',
      user: { id: '7' }
    });
    expect(accountCenterSummary(views)).toBe('待核对 1 · 待处理 0 · 网站登录 0/3 · 自动填入 0/3');
  });

  it('[REG-ACCOUNT-041] derives account summary denominators from the enabled account capability subset', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: ['_t'], isVerifying: false }
      })
    );
    const enabledViews = createSiteAccountViews(sessions, emptyCredentialSummaries()).filter((view) =>
      ['linuxdo', 'yaohuo'].includes(view.site)
    );

    expect(accountCenterSummary(enabledViews)).toBe('待处理 0 · 网站登录 1/2 · 自动填入 0/2');
  });

  it('uses the NodeSeek web user id only while the canonical session is logged in', () => {
    const loggedIn = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: { site: 'nodeseek', status: 'logged-in', cookieSummary: ['session'], isVerifying: false }
      })
    );
    const expired = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: { site: 'nodeseek', status: 'expired', cookieSummary: ['session'], isVerifying: false }
      })
    );

    expect(createSiteAccountViews(loggedIn, emptyCredentialSummaries(), 48872)[0].identityLabel).toBe('用户 48872');
    expect(createSiteAccountViews(expired, emptyCredentialSummaries(), 48872)[0].identityLabel).toBe('已失效');
  });
});
