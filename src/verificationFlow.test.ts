import { describe, expect, it } from 'vitest';
import {
  createVerificationSessionTracker,
  isFinalVerificationFlowResult,
  verificationFlowFailed,
  verificationFlowStale,
  type VerificationFlowResult
} from './verificationFlow';

describe('verification flow result', () => {
  it('keeps verification flow exits explicit', () => {
    const results: VerificationFlowResult[] = [
      { status: 'success', retryOriginalRequest: true, cookieSummary: ['cf_clearance'] },
      { status: 'closed', retryOriginalRequest: false },
      verificationFlowFailed('重试仍失败'),
      verificationFlowStale()
    ];

    expect(results.map((result) => result.status)).toEqual(['success', 'closed', 'failed', 'stale']);
    expect(results.map(isFinalVerificationFlowResult)).toEqual([true, true, true, false]);
    expect(results[0]).toMatchObject({
      retryOriginalRequest: true,
      cookieSummary: ['cf_clearance']
    });
    expect(results[2]).toMatchObject({
      retryOriginalRequest: false,
      message: '重试仍失败'
    });
  });

  it('marks old WebView verification results stale after a newer session starts or closes', () => {
    const tracker = createVerificationSessionTracker();
    const first = tracker.start();
    const second = tracker.start();

    expect(tracker.resultFor(first, { status: 'success', retryOriginalRequest: true })).toEqual(verificationFlowStale());
    expect(tracker.resultFor(second, { status: 'success', retryOriginalRequest: true })).toMatchObject({
      status: 'success',
      retryOriginalRequest: true
    });

    tracker.close(second);

    expect(tracker.resultFor(second, { status: 'success', retryOriginalRequest: true })).toEqual(verificationFlowStale());
  });
});
