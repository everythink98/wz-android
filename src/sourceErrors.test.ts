import { describe, expect, it } from 'vitest';
import { nodeSeekVerificationNavigationMessage } from './sourceErrors';

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
});
