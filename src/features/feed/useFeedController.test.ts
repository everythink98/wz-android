import { describe, expect, it } from 'vitest';
import { feedOutcomeKind } from './useFeedController';
import type { SourceErrors } from '@/domain/forum/models';

describe('feedOutcomeKind', () => {
  it.each([
    { expected: 'data', itemCount: 1, errors: {} },
    { expected: 'empty', itemCount: 0, errors: {} },
    { expected: 'partial', itemCount: 1, errors: { v2ex: { kind: 'ordinary', message: 'timeout' } } },
    { expected: 'error', itemCount: 0, errors: { v2ex: { kind: 'ordinary', message: 'timeout' } } },
    { expected: 'error', itemCount: 0, errors: { v2ex: { kind: 'permission-denied', message: 'forbidden' } } },
    { expected: 'partial', itemCount: 1, errors: { v2ex: { kind: 'permission-denied', message: 'forbidden' } } },
    { expected: 'auth', itemCount: 1, errors: { nodeseek: { kind: 'verification-required', message: 'verify' } } },
    { expected: 'auth', itemCount: 0, errors: { linuxdo: { kind: 'login-expired', message: 'login' } } }
  ] satisfies { expected: string; itemCount: number; errors: SourceErrors }[])(
    'classifies $expected without depending on live data',
    ({ expected, itemCount, errors }) => {
      expect(feedOutcomeKind(itemCount, errors)).toBe(expected);
    }
  );
});
