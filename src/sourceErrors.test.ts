import { describe, expect, it } from 'vitest';
import { nodeSeekVerificationNavigationMessage, sourceErrorFromUnknown, sourceErrorKind } from './sourceErrors';

describe('source error navigation helpers', () => {
  it('does not auto-open verification for aggregated feed errors', () => {
    const errors = {
      nodeseek: {
        message: 'NodeSeek 需要验证',
        reason: 'cloudflare',
        verificationRequired: true
      }
    };

    expect(nodeSeekVerificationNavigationMessage('all', errors)).toBe('');
    expect(nodeSeekVerificationNavigationMessage('nodeseek', errors)).toBe('NodeSeek 需要验证');
  });

  it('classifies login, verification, and permission failures without flattening them', () => {
    const expired = Object.assign(new Error('妖火登录已失效，请重新登录。'), {
      loginRequired: true,
      reason: 'expired'
    });
    const verification = Object.assign(new Error('NodeSeek 需要完成 Cloudflare 验证'), {
      source: 'nodeseek',
      reason: 'cloudflare'
    });
    const permission = Object.assign(new Error('权限不足'), {
      status: 403
    });

    expect(sourceErrorFromUnknown('yaohuo', expired)).toMatchObject({
      kind: 'login-expired',
      loginRequired: true
    });
    expect(sourceErrorFromUnknown('nodeseek', verification)).toMatchObject({
      kind: 'verification-required',
      verificationRequired: true
    });
    expect(sourceErrorFromUnknown('linuxdo', permission)).toMatchObject({
      kind: 'permission-denied'
    });
    expect(sourceErrorKind(sourceErrorFromUnknown('v2ex', new Error('network')))).toBe('ordinary');
  });
});
