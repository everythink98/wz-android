import { describe, expect, it } from 'vitest';
import {
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
});
