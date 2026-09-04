import { projectTestAccountSessions, testAccountUser } from '../../../tests/helpers/accountSessions';
import { describe, expect, it } from 'vitest';
import { createSiteSessionStates } from './siteSessionState';

describe('account session labels', () => {
  it('uses readable account summaries instead of cookie names', () => {
    const sessions = projectTestAccountSessions(
      createSiteSessionStates({
        nodeseek: {
          currentUser: testAccountUser('nodeseek'),
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

    expect(sessions.linuxdo.summaryLabel).toBe('匿名可用');
    expect(sessions.yaohuo.summaryLabel).toBe('已失效');
    expect(
      Object.values(sessions)
        .map((item) => item.summaryLabel)
        .join(' ')
    ).not.toContain('sidyaohuo');
  });
});
