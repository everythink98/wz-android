import { describe, expect, it } from 'vitest';

import { beijingClock, beijingDateToIso, mostRecentBeijingDateToIso } from './beijingDate';

describe('Beijing calendar helpers', () => {
  it('converts strict Beijing calendar values to UTC', () => {
    expect(beijingDateToIso(2010, 4, 27, 0, 0)).toBe('2010-04-26T16:00:00.000Z');
    expect(beijingDateToIso(2024, 2, 29, 23, 59)).toBe('2024-02-29T15:59:00.000Z');
  });

  it('rejects calendar overflow instead of normalizing it into another date', () => {
    expect(beijingDateToIso(2026, 2, 29, 0, 0)).toBe('');
    expect(beijingDateToIso(2026, 13, 1, 0, 0)).toBe('');
    expect(beijingDateToIso(2026, 1, 1, 24, 0)).toBe('');
  });

  it('uses the most recent occurrence for dates without a year', () => {
    const nowMs = Date.parse('2026-01-02T04:00:00.000Z');

    expect(beijingClock(nowMs)).toEqual({ year: 2026, month: 1, day: 2, nowMs });
    expect(mostRecentBeijingDateToIso(12, 31, 0, 0, nowMs)).toBe('2025-12-30T16:00:00.000Z');
    expect(mostRecentBeijingDateToIso(1, 2, 0, 0, nowMs)).toBe('2026-01-01T16:00:00.000Z');
  });
});
