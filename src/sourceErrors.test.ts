import { describe, expect, it } from 'vitest';
import { linuxDoVerificationNavigationMessage, nodeSeekVerificationNavigationMessage, sourceErrorFromUnknown, sourceErrorKind } from './sourceErrors';

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

  it('auto-opens linux.do verification only for the single-source feed', () => {
    const errors = {
      linuxdo: {
        message: 'linux.do 需要验证',
        reason: 'cloudflare',
        verificationRequired: true
      }
    };

    expect(linuxDoVerificationNavigationMessage('all', errors)).toBe('');
    expect(linuxDoVerificationNavigationMessage('linuxdo', errors)).toBe('linux.do 需要验证');
    expect(linuxDoVerificationNavigationMessage('nodeseek', errors)).toBe('');
  });

  it('does not auto-open linux.do verification for ordinary single-source errors', () => {
    const errors = {
      linuxdo: sourceErrorFromUnknown('linuxdo', new Error('linux.do 网络失败'))
    };

    expect(linuxDoVerificationNavigationMessage('linuxdo', errors)).toBe('');
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
