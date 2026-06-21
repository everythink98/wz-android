import { describe, expect, it } from 'vitest';
import {
  formatSourceErrorMessages,
  nodeSeekVerificationErrorMessage,
  sourceErrorFromUnknown,
  sourceErrorMessage,
  sourceErrorRequiresVerification
} from './sourceErrors';

describe('source errors', () => {
  it('keeps verification requirements as structured data', () => {
    const error = Object.assign(new Error('需要完成验证'), {
      source: 'nodeseek',
      reason: 'cloudflare'
    });
    const sourceError = sourceErrorFromUnknown('nodeseek', error);

    expect(sourceErrorMessage(sourceError)).toBe('需要完成验证');
    expect(sourceErrorRequiresVerification(sourceError)).toBe(true);
  });

  it('does not infer verification requirements from display text', () => {
    expect(sourceErrorRequiresVerification('Cloudflare 验证')).toBe(false);
  });

  it('formats source errors with caller-provided labels', () => {
    expect(formatSourceErrorMessages({
      v2ex: 'V2EX 失败',
      yaohuo: { message: '妖火失败' }
    }, (source) => `label:${source}`)).toBe('label:v2ex：V2EX 失败；label:yaohuo：妖火失败');
  });

  it('returns only structured NodeSeek verification messages', () => {
    expect(nodeSeekVerificationErrorMessage({
      nodeseek: { message: '需要验证', verificationRequired: true }
    })).toBe('需要验证');
    expect(nodeSeekVerificationErrorMessage({
      nodeseek: 'Cloudflare 验证'
    })).toBe('');
  });
});
