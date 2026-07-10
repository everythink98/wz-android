import { describe, expect, it } from 'vitest';
import {
  applyDevAnonymousOverrides,
  createSiteSessionStates,
  createSiteSessionViewModels,
  nodeSeekLoginStateLabel
} from './siteSessionState';
import { authActionMessageForSource } from './siteSessionPrompts';

describe('account session labels', () => {
  it('uses readable account summaries instead of cookie names', () => {
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

    expect(nodeSeekLoginStateLabel(sessions.nodeseek, 48872)).toBe('网页已确认登录：用户 48872');
    expect(sessions.linuxdo.summaryLabel).toBe('匿名可用');
    expect(sessions.yaohuo.summaryLabel).toBe('已失效');
    expect(Object.values(sessions).map((item) => item.summaryLabel).join(' ')).not.toContain('sidyaohuo');
  });

  it('applies temporary anonymous controls without deleting saved sessions', () => {
    const saved = createSiteSessionStates({
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
      }
    });

    const effective = applyDevAnonymousOverrides(saved, { nodeseek: true, linuxdo: true });

    expect(createSiteSessionViewModels(effective).nodeseek.summaryLabel).toBe('未登录');
    expect(createSiteSessionViewModels(effective).linuxdo.summaryLabel).toBe('匿名可用');
    expect(saved.nodeseek.status).toBe('logged-in');
    expect(saved.linuxdo.cookieSummary).toEqual(['cf_clearance', '_t']);
  });

  it('describes interaction limits from structured session state', () => {
    const sessions = createSiteSessionViewModels(createSiteSessionStates());

    expect(authActionMessageForSource('linuxdo', sessions)).toBe('匿名可阅读，登录后才能互动。');
  });
});
