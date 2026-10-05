import { describe, expect, it } from 'vitest';
import type { NodeSeekCreditEntry } from '@/domain/forum/accountData';
import { creditDayKey, summarizeCredits } from './nodeSeekCredits';

const now = new Date(2026, 9, 2, 12);
function entry(day: number, change: number, reason = '回帖奖励'): NodeSeekCreditEntry {
  return { change, balance: 100, reason, createdAt: new Date(2026, 9, day, 9).toISOString() };
}

describe('chicken-leg daily summaries', () => {
  it('never marks changed page sets complete even when the final page is loaded', () => {
    const result = summarizeCredits({
      entries: [entry(2, 5), entry(1, 2)],
      hasMore: false,
      loaded: true,
      consistent: false,
      now
    });
    expect(result.today).toMatchObject({ income: 5, complete: false });
    expect(result.days.every((day) => !day.complete)).toBe(true);
    expect(result.days.flatMap((day) => day.entries)).toHaveLength(2);
  });

  it('keeps unordered amounts but does not claim completeness before the final page', () => {
    const entries = [entry(2, 5), entry(1, 2), entry(2, 3)];
    const partial = summarizeCredits({ entries, hasMore: true, loaded: true, now });
    expect(partial.ordered).toBe(false);
    expect(partial.today).toMatchObject({ income: 8, complete: false });
    expect(partial.days.every((day) => !day.complete)).toBe(true);
    expect(summarizeCredits({ entries, hasMore: false, loaded: true, now }).today).toMatchObject({
      income: 8,
      complete: true
    });
  });

  it('sums numeric changes, keeps spending positive, and never parses the amount from a reason', () => {
    const result = summarizeCredits({
      entries: [entry(2, 5, '签到收益999个鸡腿'), entry(2, 12), entry(2, -7), entry(2, 0)],
      hasMore: false,
      loaded: true,
      now
    });
    expect(result.today).toMatchObject({
      day: '2026-10-02',
      income: 17,
      expense: 7,
      net: 10,
      attendanceIncome: 5,
      complete: true
    });
  });

  it('withholds the boundary day total until an older day or the end is loaded', () => {
    const incomplete = summarizeCredits({ entries: [entry(2, 5)], hasMore: true, loaded: true, now });
    expect(incomplete.today.complete).toBe(false);
    const result = summarizeCredits({ entries: [entry(2, 5), entry(1, -3)], hasMore: true, loaded: true, now });
    expect(result.today.complete).toBe(true);
    expect(result.days.map((day) => [day.day, day.complete])).toEqual([
      ['2026-10-02', true],
      ['2026-10-01', false]
    ]);
    expect(summarizeCredits({ entries: [entry(1, -3)], hasMore: false, loaded: true, now }).days[0].complete).toBe(
      true
    );
  });

  it('distinguishes unread data from a fully loaded empty day', () => {
    expect(summarizeCredits({ entries: [], hasMore: false, loaded: false, now }).today.complete).toBe(false);
    expect(summarizeCredits({ entries: [], hasMore: false, loaded: true, now }).today).toMatchObject({
      income: 0,
      expense: 0,
      net: 0,
      complete: true
    });
    expect(summarizeCredits({ entries: [entry(1, 3)], hasMore: true, loaded: true, now }).today).toMatchObject({
      income: 0,
      complete: true
    });
  });

  it('groups records by the device calendar boundary rather than their UTC date', () => {
    const before = new Date(2026, 9, 1, 23, 59);
    const after = new Date(2026, 9, 2, 0, 0);
    expect(creditDayKey(before)).toBe('2026-10-01');
    const result = summarizeCredits({
      entries: [
        { ...entry(2, 1), createdAt: after.toISOString() },
        { ...entry(1, 2), createdAt: before.toISOString() }
      ],
      hasMore: false,
      loaded: true,
      now
    });
    expect(result.days.map((day) => [day.day, day.income])).toEqual([
      ['2026-10-02', 1],
      ['2026-10-01', 2]
    ]);
  });

  it('preserves amounts and day completeness across 100 pages containing 2000 records', () => {
    const pages: NodeSeekCreditEntry[][] = Array.from({ length: 100 }, (_, page) =>
      Array.from({ length: 20 }, (_, position) => {
        const index = page * 20 + position;
        const day = index < 1000 ? 2 : 1;
        const pattern = index % 4;
        const change = pattern === 0 ? 5 : pattern === 1 ? -3 : pattern === 2 ? 0 : 2;
        return {
          ...entry(day, change, pattern === 0 ? '签到收益999个鸡腿' : '回帖奖励'),
          createdAt: new Date(new Date(2026, 9, day, 11).getTime() - (index % 1000) * 1000).toISOString()
        };
      })
    );

    for (let loadedPages = 1; loadedPages <= pages.length; loadedPages++) {
      const entries = pages.slice(0, loadedPages).flat();
      const summary = summarizeCredits({ entries, hasMore: loadedPages < pages.length, loaded: true, now });
      const todayPages = Math.min(loadedPages, 50);
      expect(summary.ordered).toBe(true);
      expect(summary.today).toMatchObject({
        income: todayPages * 35,
        expense: todayPages * 15,
        net: todayPages * 20,
        attendanceIncome: todayPages * 25,
        complete: loadedPages > 50
      });
      expect(summary.days).toHaveLength(loadedPages > 50 ? 2 : 1);
      if (loadedPages > 50) {
        const olderPages = loadedPages - 50;
        expect(summary.days[1]).toMatchObject({
          day: '2026-10-01',
          income: olderPages * 35,
          expense: olderPages * 15,
          net: olderPages * 20,
          attendanceIncome: olderPages * 25,
          complete: loadedPages === pages.length
        });
      }
      expect(summary.days.flatMap((day) => day.entries)).toEqual(entries);
    }

    const entries = pages.flat();
    expect(entries.filter((item) => item.change === 0)).toHaveLength(500);
    const inconsistent = summarizeCredits({ entries, hasMore: false, loaded: true, consistent: false, now });
    expect(inconsistent.today).toMatchObject({ income: 1750, expense: 750, net: 1000, complete: false });
    expect(inconsistent.days.every((day) => !day.complete)).toBe(true);
    expect(inconsistent.days.flatMap((day) => day.entries)).toEqual(entries);

    // Observe warmed host JS derivation only; this does not measure Android frames or impose a time limit.
    const timings: number[] = [];
    for (let sample = 0; sample < 8; sample++) {
      const started = performance.now();
      summarizeCredits({ entries: pages.flat(), hasMore: false, loaded: true, now });
      if (sample > 0) timings.push(performance.now() - started);
    }
    timings.sort((left, right) => left - right);
    process.stdout.write(
      `PERF ${JSON.stringify({ name: 'credits.daily-summary.2000', pages: pages.length, records: entries.length, samples: timings.length, medianMs: Number(timings[3]!.toFixed(3)), p95Ms: Number(timings[6]!.toFixed(3)) })}\n`
    );
  });
});
