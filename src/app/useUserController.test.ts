import { describe, expect, it } from 'vitest';
import { userSourceRecoveryTarget } from './useUserController';

describe('user source recovery routing', () => {
  it('routes Yaohuo verification errors back to the in-app login and verification surface', () => {
    expect(userSourceRecoveryTarget('yaohuo', {
      kind: 'verification-required',
      message: '妖火需要完成访问验证'
    })).toBe('yaohuo-login');
  });

  it('does not treat an ordinary Yaohuo failure as a login recovery event', () => {
    expect(userSourceRecoveryTarget('yaohuo', {
      kind: 'ordinary',
      message: '请求超时'
    })).toBeNull();
  });
});
