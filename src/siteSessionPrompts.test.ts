import { describe, expect, it } from 'vitest';
import { authActionMessageForSource, authNoticeForMessage, authNoticeForSource, searchSessionNoticeItems } from './siteSessionPrompts';
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
      message: '已通过访问验证，登录后可使用完整能力。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('linuxdo', sessions, 'search')).toEqual({
      message: '匿名可阅读，登录后才能互动。',
      tone: 'neutral'
    });
    expect(authNoticeForSource('yaohuo', sessions, 'search')).toEqual({
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
      { source: 'nodeseek', label: 'NodeSeek', notice: { message: '已登录搜索。', tone: 'neutral' } },
      { source: 'linuxdo', label: 'linux.do', notice: { message: '匿名可阅读，登录后才能互动。', tone: 'neutral' } },
      { source: 'yaohuo', label: '妖火', notice: { message: '妖火登录已失效，请重新登录。', tone: 'danger' } }
    ]);
    expect(searchSessionNoticeItems('nodeseek', sessions)).toEqual([
      { source: 'nodeseek', label: 'NodeSeek', notice: { message: '已登录搜索。', tone: 'neutral' } }
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
      message: '妖火需要登录后使用此功能。',
      tone: 'warning'
    });
    expect(authNoticeForSource('v2ex', sessions, 'read')).toBeNull();
  });

  it('classifies existing detail and user messages into notice tones', () => {
    expect(authNoticeForMessage('妖火需要登录后使用此功能。')).toEqual({
      message: '妖火需要登录后使用此功能。',
      tone: 'warning'
    });
    expect(authNoticeForMessage('linux.do 登录已失效，请重新登录。')).toEqual({
      message: 'linux.do 登录已失效，请重新登录。',
      tone: 'danger'
    });
    expect(authNoticeForMessage('读取失败，请稍后重试。')).toBeNull();
  });
});
