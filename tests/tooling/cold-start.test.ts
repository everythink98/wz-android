import { describe, expect, it } from 'vitest';
import { startupEvents, timingSummary } from '../../scripts/check-cold-start.mjs';

describe('cold startup evidence', () => {
  it('parses only complete timing events with a process identity', () => {
    const event = {
      operation: 'startup-timing',
      buildId: 'a'.repeat(32),
      processSessionId: `process-${'b'.repeat(32)}`,
      state: 'page-ready',
      elapsedMs: 125
    };
    expect(startupEvents(`noise\nI WzStartup: ${JSON.stringify(event)}\nI WzStartup: {broken`)).toEqual([event]);
    expect(startupEvents(`I WzStartup: ${JSON.stringify({ ...event, elapsedMs: -1 })}`)).toEqual([]);
  });
  it('does not turn missing content into a zero-time success', () => {
    expect(timingSummary([undefined, 100, 200, 300, 400])).toEqual({ count: 4, median: 250, p90: 400, worst: 400 });
    expect(timingSummary([undefined])).toEqual({ count: 0 });
  });
});
