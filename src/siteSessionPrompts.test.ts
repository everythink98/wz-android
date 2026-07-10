import { describe, expect, it } from 'vitest';
import { authActionMessageForSource, authNoticeForSource, authNoticeForSourceError, searchSessionNoticeItems, searchSessionNoticeLightTone } from './siteSessionPrompts';
import { createSiteSessionViewModels, createSiteSessionStates } from './siteSessionState';

describe('site session prompts', () => {
  it('uses site-specific search hints instead of one generic login prompt', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
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
    }));

    expect(authNoticeForSource('nodeseek', sessions, 'search')).toEqual({
      kind: 'verified',
      message: '已通过访问验证，登录后可使用完整能力。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('linuxdo', sessions, 'search')).toEqual({
      kind: 'anonymous',
      message: '未登录搜索使用 Google，结果可能不完整。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('yaohuo', sessions, 'search')).toEqual({
      kind: 'login-expired',
      message: '妖火登录已失效，请重新登录。',
      tone: 'danger'
    });
    expect(authNoticeForSource('v2ex', sessions, 'search')).toBeNull();
  });

  it('builds compact search session notices for the active search source', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
      nodeseek: {
        site: 'nodeseek',
        status: 'logged-in',
        cookieSummary: ['session'],
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
    }));

    expect(searchSessionNoticeItems('all', sessions)).toEqual([
      { source: 'nodeseek', label: 'NodeSeek', notice: { kind: 'logged-in', message: '已登录搜索。', tone: 'neutral' } },
      { source: 'linuxdo', label: 'linux.do', notice: { kind: 'anonymous', message: '未登录搜索使用 Google，结果可能不完整。', tone: 'neutral' } },
      { source: 'yaohuo', label: '妖火', notice: { kind: 'login-expired', message: '妖火登录已失效，请重新登录。', tone: 'danger' } }
    ]);
    expect(searchSessionNoticeItems('nodeseek', sessions)).toEqual([
      { source: 'nodeseek', label: 'NodeSeek', notice: { kind: 'logged-in', message: '已登录搜索。', tone: 'neutral' } }
    ]);
    expect(searchSessionNoticeItems('v2ex', sessions)).toEqual([]);
  });

  it('uses action messages that match the source capability', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates());

    expect(authActionMessageForSource('nodeseek', sessions)).toBe('请先在“更多”里登录并检测 NodeSeek Cookie。');
    expect(authActionMessageForSource('linuxdo', sessions)).toBe('匿名可阅读，登录后才能互动。');
    expect(authActionMessageForSource('yaohuo', sessions)).toBe('妖火需要登录后使用此功能。');
    expect(authActionMessageForSource('v2ex', sessions)).toBe('');
  });

  it('uses read messages that keep V2EX out of login-specific copy', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates({
      yaohuo: {
        site: 'yaohuo',
        status: 'anonymous',
        cookieSummary: [],
        isVerifying: false
      }
    }));

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

  it('uses separate light colors for login status without changing copy tones', () => {
    expect(searchSessionNoticeLightTone({ kind: 'logged-in', message: '任意文案', tone: 'neutral' })).toBe('success');
    expect(searchSessionNoticeLightTone({ kind: 'anonymous', message: '任意文案', tone: 'neutral' })).toBe('neutral');
    expect(searchSessionNoticeLightTone({ kind: 'verification-required', message: '任意文案', tone: 'warning' })).toBe('warning');
    expect(searchSessionNoticeLightTone({ kind: 'login-required', message: '任意文案', tone: 'warning' })).toBe('danger');
    expect(searchSessionNoticeLightTone({ kind: 'login-expired', message: '任意文案', tone: 'danger' })).toBe('danger');
  });
});
