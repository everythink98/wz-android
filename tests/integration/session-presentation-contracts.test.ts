import { describe, expect, it } from 'vitest';
import type { CredentialSummaries } from '@/platform/storage/credentialVault';
import { createSiteAccountViews } from '@/features/more/accountCenter';
import {
  authActionMessageForSource,
  authNoticeForSource,
  authNoticeForSourceError
} from '@/domain/session/siteSessionPrompts';
import { createSiteSessionViewModels, createSiteSessionStates } from '@/domain/session/siteSessionState';

function emptyCredentialSummaries(): CredentialSummaries {
  return {
    nodeseek: { site: 'nodeseek', state: 'missing', hasCredential: false, protection: null },
    linuxdo: { site: 'linuxdo', state: 'missing', hasCredential: false, protection: null },
    yaohuo: { site: 'yaohuo', state: 'missing', hasCredential: false, protection: null }
  };
}

describe('site session prompts', () => {
  it('keeps a confirmed identity available while its account check is running', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session'],
          isVerifying: true
        }
      })
    );

    expect(authNoticeForSource('nodeseek', sessions, 'search')).toEqual({
      kind: 'logged-in',
      message: '已登录搜索。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('nodeseek', sessions, 'read')).toEqual({
      kind: 'logged-in',
      message: 'NodeSeek 已登录。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('nodeseek', sessions, 'action')).toEqual({
      kind: 'logged-in',
      message: 'NodeSeek 已登录。',
      tone: 'neutral'
    });
  });

  it('presents terminal unknown as retryable without losing public lanes', () => {
    const confirmed = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: ['session'],
          isVerifying: false
        },
        yaohuo: {
          site: 'yaohuo',
          status: 'logged-in',
          cookieSummary: ['sid'],
          isVerifying: false
        }
      })
    );
    const sessions = {
      ...confirmed,
      nodeseek: { ...confirmed.nodeseek, canWrite: false, identityTrust: 'unknown' as const },
      yaohuo: { ...confirmed.yaohuo, canWrite: false, identityTrust: 'unknown' as const }
    };

    expect(authNoticeForSource('nodeseek', sessions, 'search')).toEqual({
      kind: 'identity-unavailable',
      message: 'NodeSeek 账号状态暂不可确认，本次使用 Google 搜索页面；可在账号中心重试核对。',
      tone: 'warning'
    });
    expect(authNoticeForSource('nodeseek', sessions, 'read')).toEqual({
      kind: 'identity-unavailable',
      message: 'NodeSeek 账号状态暂不可确认，本次使用匿名读取；写入暂不可用，可在账号中心重试核对。',
      tone: 'warning'
    });
    expect(authNoticeForSource('nodeseek', sessions, 'action')).toEqual({
      kind: 'identity-unavailable',
      message: 'NodeSeek 账号状态暂不可确认，写入暂不可用，可在账号中心重试核对。',
      tone: 'warning'
    });
    expect(authNoticeForSource('yaohuo', sessions, 'read')).toEqual({
      kind: 'identity-unavailable',
      message: '妖火账号状态暂不可确认，暂不能读取或写入，可在账号中心重试核对。',
      tone: 'warning'
    });
  });

  it('explains the external NodeSeek search without showing a logged-in notice', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates());
    const prompt = authNoticeForSource('nodeseek', sessions, 'search');

    expect(prompt).toEqual({
      kind: 'login-required',
      message: '未登录搜索将在 Google 页面打开。',
      tone: 'warning'
    });
  });

  it('projects one expired NodeSeek session consistently into More, Search, and Topic permissions', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'expired',
          cookieSummary: ['cf_clearance'],
          isVerifying: false
        },
        linuxdo: {
          site: 'linuxdo',
          status: 'logged-in',
          cookieSummary: ['_t'],
          isVerifying: false
        },
        yaohuo: {
          site: 'yaohuo',
          status: 'logged-in',
          cookieSummary: ['sid'],
          isVerifying: false
        }
      })
    );
    const nodeSeekAccount = createSiteAccountViews(sessions, emptyCredentialSummaries()).find(
      (view) => view.site === 'nodeseek'
    );
    const searchNotice = authNoticeForSource('nodeseek', sessions, 'search');

    expect(nodeSeekAccount).toMatchObject({ isLoggedIn: false, statusLabel: '已失效' });
    expect(searchNotice).toEqual({
      kind: 'login-expired',
      message: 'NodeSeek 登录已失效；搜索将在 Google 页面打开。',
      tone: 'danger'
    });
    expect(sessions.nodeseek.canWrite).toBe(false);
    expect([sessions.linuxdo.canWrite, sessions.yaohuo.canWrite]).toEqual([true, true]);
  });

  it('uses site-specific search hints instead of one generic login prompt', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'verified',
          cookieSummary: ['cf_clearance'],
          isVerifying: false
        },
        linuxdo: {
          site: 'linuxdo',
          status: 'anonymous',
          cookieSummary: [],
          isVerifying: false
        },
        yaohuo: {
          site: 'yaohuo',
          status: 'expired',
          cookieSummary: ['sidyaohuo'],
          isVerifying: false
        }
      })
    );

    expect(authNoticeForSource('nodeseek', sessions, 'search')).toEqual({
      kind: 'verified',
      message: '未登录搜索将在 Google 页面打开。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('linuxdo', sessions, 'search')).toEqual({
      kind: 'anonymous',
      message: '未登录搜索将在 Google 页面打开。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('yaohuo', sessions, 'search')).toEqual({
      kind: 'login-expired',
      message: '妖火登录已失效，请重新登录。',
      tone: 'danger'
    });
    expect(authNoticeForSource('v2ex', sessions, 'search')).toBeNull();
  });

  it('uses action messages that match the source capability', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates());

    expect(authActionMessageForSource('nodeseek', sessions)).toBe('请先在“更多”里登录并检测 NodeSeek Cookie。');
    expect(authActionMessageForSource('linuxdo', sessions)).toBe('匿名可阅读，登录后才能互动。');
    expect(authActionMessageForSource('yaohuo', sessions)).toBe('妖火需要登录后使用此功能。');
    expect(authActionMessageForSource('v2ex', sessions)).toBe('');
  });

  it('uses read messages that keep V2EX out of login-specific copy', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
        yaohuo: {
          site: 'yaohuo',
          status: 'anonymous',
          cookieSummary: [],
          isVerifying: false
        }
      })
    );

    expect(authNoticeForSource('yaohuo', sessions, 'read')).toEqual({
      kind: 'login-required',
      message: '妖火需要登录后使用此功能。',
      tone: 'warning'
    });
    expect(authNoticeForSource('v2ex', sessions, 'read')).toBeNull();
  });

  it('classifies source errors by kind independently from display copy', () => {
    expect(authNoticeForSourceError({ kind: 'login-expired', message: '会话不可继续' })).toEqual({
      kind: 'login-expired',
      message: '会话不可继续',
      tone: 'danger'
    });
    expect(authNoticeForSourceError({ kind: 'verification-required', message: '站点要求额外操作' })).toEqual({
      kind: 'verification-required',
      message: '站点要求额外操作',
      tone: 'warning'
    });
    expect(authNoticeForSourceError({ kind: 'ordinary', message: '登录两个字不代表登录错误' })).toBeNull();
  });
});
