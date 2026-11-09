import { describe, expect, it } from 'vitest';
import { runReviewProofCheck } from '../../dev/review-remediation-proof/check';

describe('review proof check outcomes', () => {
  it('reports successful work without failure fields and preserves metrics', async () => {
    const metrics = { samples: [1, 2] };
    const result = await runReviewProofCheck(
      'successful check',
      async (markStage) => {
        markStage('last stage');
      },
      metrics
    );
    expect(result).toEqual({ name: 'successful check', passed: true, metrics });
  });

  it('reports a failed check with its last stage, original error stack and metrics', async () => {
    const error = new Error('failed work');
    const metrics = { processed: 3 };
    const result = await runReviewProofCheck(
      'failed check',
      async (markStage) => {
        markStage('prepare');
        markStage('verify');
        throw error;
      },
      metrics
    );
    expect(result).toEqual({
      name: 'failed check',
      passed: false,
      error: 'failed work',
      stack: error.stack,
      stage: 'verify',
      metrics
    });
  });

  it.each([undefined, null, 0, false, 'plain failure'])('preserves a non-Error failure of %s', async (failure) => {
    const result = await runReviewProofCheck('non-Error failure', async () => {
      throw failure;
    });
    expect(result).toEqual({ name: 'non-Error failure', passed: false, error: String(failure) });
  });

  it('keeps stages local when separate checks overlap', async () => {
    const firstError = new Error('first failed');
    let failFirst: () => void = () => {
      throw new Error('First check has not started');
    };
    const waiting = new Promise<void>((_resolve, reject) => {
      failFirst = () => reject(firstError);
    });
    const first = runReviewProofCheck('first', async (markStage) => {
      markStage('first waiting');
      await waiting;
    });
    const second = await runReviewProofCheck('second', async (markStage) => {
      markStage('second finished');
      throw new Error('second failed');
    });
    failFirst();
    expect(second).toMatchObject({ passed: false, stage: 'second finished' });
    expect(await first).toMatchObject({ passed: false, error: 'first failed', stage: 'first waiting' });
  });
});
