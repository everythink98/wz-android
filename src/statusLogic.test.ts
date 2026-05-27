import { describe, expect, it } from 'vitest';
import { buildLocalStatusResult } from './statusLogic';

describe('Android local status logic', () => {
  it('syncs account state from real login checks', () => {
    const result = buildLocalStatusResult({
      sourceChecks: {
        nodeseek: { ok: true },
        v2ex: { ok: true },
        linuxdo: { ok: true },
        yaohuo: { ok: false, message: '妖火登录已失效，请重新登录。' }
      },
      linuxDoAccess: {
        hasClearance: true,
        loggedIn: true,
        savedAt: '2026-05-27T00:00:00.000Z'
      },
      linuxDoLogin: {
        ok: false,
        loginRequired: true,
        message: 'linux.do 登录已失效，请重新登录'
      }
    });

    expect(result.hasYaohuoLogin).toBe(false);
    expect(result.hasLinuxDoLogin).toBe(false);
    expect(result.hasLinuxDoClearance).toBe(true);
    expect(result.details).toContainEqual({
      label: 'linux.do 登录',
      ok: false,
      message: 'linux.do 登录已失效，请重新登录'
    });
    expect(result.summary).toContain('妖火 不可用');
    expect(result.summary).toContain('linux.do：已验证');
  });

  it('keeps saved linux.do login state when the login check is blocked by verification', () => {
    const result = buildLocalStatusResult({
      sourceChecks: {
        nodeseek: { ok: true },
        v2ex: { ok: true },
        linuxdo: { ok: true },
        yaohuo: { ok: true, message: '登录可用' }
      },
      linuxDoAccess: {
        hasClearance: true,
        loggedIn: true,
        savedAt: '2026-05-27T00:00:00.000Z'
      },
      linuxDoLogin: {
        ok: false,
        message: 'linux.do 需要完成 Cloudflare 验证'
      }
    });

    expect(result.hasLinuxDoLogin).toBe(true);
    expect(result.details).toContainEqual({
      label: 'linux.do 登录',
      ok: false,
      message: 'linux.do 需要完成 Cloudflare 验证'
    });
  });
});
