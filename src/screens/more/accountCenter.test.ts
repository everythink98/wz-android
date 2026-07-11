import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CredentialSummaries } from '../../credentialVault';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../siteSessionState';
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
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: { site: 'nodeseek', status: 'expired', cookieSummary: [], isVerifying: false },
      linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: ['_t'], isVerifying: false },
      yaohuo: { site: 'yaohuo', status: 'verification-required', cookieSummary: [], isVerifying: false }
    }));

    const views = createSiteAccountViews(sessions, credentials);

    expect(views.map((view) => view.site)).toEqual(['nodeseek', 'linuxdo', 'yaohuo']);
    expect(views[0]).toMatchObject({ primaryAction: 'open-login-with-fill', primaryLabel: '重新登录并填入' });
    expect(views[1]).toMatchObject({ isLoggedIn: true, primaryAction: 'none', primaryLabel: '已登录' });
    expect(views[2]).toMatchObject({ primaryAction: 'open-login', primaryLabel: '去验证' });
    expect(accountCenterSummary(views)).toBe('待处理 2 · 网站登录 1/3 · 自动填入 1/3');
  });

  it('keeps the zero-attention count visible', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: { site: 'nodeseek', status: 'logged-in', cookieSummary: ['session'], isVerifying: false },
      linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: ['_t'], isVerifying: false },
      yaohuo: { site: 'yaohuo', status: 'logged-in', cookieSummary: ['ASP.NET_SessionId'], isVerifying: false }
    }));

    expect(accountCenterSummary(createSiteAccountViews(sessions, emptyCredentialSummaries()))).toBe(
      '待处理 0 · 网站登录 3/3 · 自动填入 0/3'
    );
  });

  it('keeps invalidated login information visible and actionable', () => {
    const credentials = emptyCredentialSummaries();
    credentials.nodeseek = {
      site: 'nodeseek',
      state: 'invalidated',
      hasCredential: false,
      protection: null
    };
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: { site: 'nodeseek', status: 'logged-in', cookieSummary: ['session'], isVerifying: false },
      linuxdo: { site: 'linuxdo', status: 'logged-in', cookieSummary: ['_t'], isVerifying: false },
      yaohuo: { site: 'yaohuo', status: 'logged-in', cookieSummary: ['ASP.NET_SessionId'], isVerifying: false }
    }));
    const views = createSiteAccountViews(sessions, credentials);

    expect(views[0].rowSummary).toContain('自动填入需重新设置');
    expect(accountCenterSummary(views)).toBe('待处理 1 · 网站登录 3/3 · 自动填入 0/3');
  });

  it('opens an identified logged-in account profile', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: ['session'],
        isVerifying: false,
        currentUser: { source: 'nodeseek', id: '7', username: 'alice', url: 'https://www.nodeseek.com/space/7', topics: [] }
      }
    }));

    expect(createSiteAccountViews(sessions, emptyCredentialSummaries())[0]).toMatchObject({
      identityLabel: 'alice',
      primaryAction: 'open-user',
      primaryLabel: '查看我的主页'
    });
  });

  it('uses the NodeSeek web user id only while the canonical session is logged in', () => {
    const loggedIn = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: { site: 'nodeseek', status: 'logged-in', cookieSummary: ['session'], isVerifying: false }
    }));
    const expired = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: { site: 'nodeseek', status: 'expired', cookieSummary: ['session'], isVerifying: false }
    }));

    expect(createSiteAccountViews(loggedIn, emptyCredentialSummaries(), 48872)[0].identityLabel).toBe('用户 48872');
    expect(createSiteAccountViews(expired, emptyCredentialSummaries(), 48872)[0].identityLabel).toBe('已失效');
  });

  it('uses one account center while retaining every existing site tool', () => {
    const more = readFileSync(path.join(process.cwd(), 'src/screens/MoreScreen.tsx'), 'utf8');
    const accountCenterPanel = readFileSync(path.join(process.cwd(), 'src/screens/more/AccountCenterPanel.tsx'), 'utf8');
    const panels = readFileSync(path.join(process.cwd(), 'src/screens/more/MorePanels.tsx'), 'utf8');
    const linuxDoModal = readFileSync(path.join(process.cwd(), 'src/app/LinuxDoVerifyModal.tsx'), 'utf8');

    expect(more).toContain('<AccountCenterPanel');
    expect(more).not.toContain('title="个人中心"');
    expect(more).not.toContain('title="账号与验证"');
    expect(`${more}${panels}${linuxDoModal}`).toContain('NodeSeek 签到');
    expect(`${more}${panels}${linuxDoModal}`).toContain('NodeImage API Key');
    expect(`${more}${panels}${linuxDoModal}`).toContain('linux.do 等级');
    expect(`${more}${panels}${linuxDoModal}`).toContain('检测登录');
    expect(`${more}${panels}${linuxDoModal}`).toContain('检测状态');
    expect(accountCenterPanel).toContain('检测或重新登录');
    expect(accountCenterPanel).not.toContain('管理网站登录');
    expect(`${more}${panels}${linuxDoModal}`).toContain('清除登录');
    expect(`${more}${panels}${linuxDoModal}`).toContain('刷新页面');
  });

  it('keeps More controls out of the Android Fabric animated-transform hit-testing path', () => {
    const appRoot = readFileSync(path.join(process.cwd(), 'src/app/AppRoot.tsx'), 'utf8');
    const appControls = readFileSync(path.join(process.cwd(), 'src/components/AppControls.tsx'), 'utf8');

    expect(appRoot).toContain('keyboardShouldPersistTaps="always"');
    expect(appRoot).not.toContain('decelerationRate={0}');
    expect(appControls).not.toContain('react-native-reanimated');
    expect(appControls).not.toContain('<Animated.View');
  });
});
