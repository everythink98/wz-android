import { describe, expect, it } from 'vitest';
import { createSiteSessionStates, createSiteSessionViewModels, nodeSeekUserIdForSession } from './siteSessionState';
import { authActionMessageForSource } from './siteSessionPrompts';

describe('account session labels', () => {
  it('uses readable account summaries instead of cookie names', () => {
    const sessions = createSiteSessionViewModels(
      createSiteSessionStates({
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
      })
    );

    expect(nodeSeekUserIdForSession(sessions.nodeseek, 48872)).toBe(48872);
    expect(sessions.linuxdo.summaryLabel).toBe('匿名可用');
    expect(sessions.yaohuo.summaryLabel).toBe('已失效');
    expect(
      Object.values(sessions)
        .map((item) => item.summaryLabel)
        .join(' ')
    ).not.toContain('sidyaohuo');
  });

  it('describes interaction limits from structured session state', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates());

    expect(authActionMessageForSource('linuxdo', sessions)).toBe('匿名可阅读，登录后才能互动。');
  });
});
