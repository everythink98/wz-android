import { describe, expect, it } from 'vitest';
import { nextPageCursor } from '@/domain/forum/pagination';
import { userSourceRecoveryTarget } from './useUserController';

describe('user query helpers', () => {
  it('keeps an undisplayed cursor reachable and rejects a repeated cursor', () => {
    expect(nextPageCursor(true, 'cursor-2', 'cursor-1')).toBe('cursor-2');
    expect(nextPageCursor(true, 'cursor-1', 'cursor-1')).toBeUndefined();
    expect(nextPageCursor(false, 'cursor-2', 'cursor-1')).toBeUndefined();
  });

  it('routes verification and login recovery by source', () => {
    expect(
      userSourceRecoveryTarget('linuxdo', {
        kind: 'verification-required',
        message: '需要验证'
      })
    ).toBe('linuxdo-verification');
    expect(
      userSourceRecoveryTarget('yaohuo', {
        kind: 'login-expired',
        message: '登录失效'
      })
    ).toBe('yaohuo-login');
    expect(
      userSourceRecoveryTarget('yaohuo', {
        kind: 'ordinary',
        message: '请求超时'
      })
    ).toBeNull();
  });
});
