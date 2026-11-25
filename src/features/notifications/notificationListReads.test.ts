import { describe, expect, it } from 'vitest';
import { createNotificationListReads, type NotificationListReadFilter } from './notificationListReads';

describe('notification list read manager', () => {
  const aggregateFilter: NotificationListReadFilter = {
    source: 'all',
    categoryId: '',
    unreadOnly: false,
    queryKey: ['forum', 'all', 'notifications', 'list', { identityKey: 'ns:1|ld:2', unreadOnly: false }]
  };

  const accessFor = (
    identityKey: string,
    sessionEpoch = 0,
    overrides: Partial<{
      focused: boolean;
      appFocused: boolean;
      ready: boolean;
      queryKey: readonly unknown[] | null;
      enabled: boolean;
      active: boolean;
    }> = {}
  ) => ({
    focused: true,
    appFocused: true,
    ready: true,
    queryKey: aggregateFilter.queryKey,
    enabled: true,
    active: true,
    identityKey,
    sessionEpoch,
    ...overrides
  });

  it('preserves linuxdo backfill commit ownership when a newer 60s aggregate poll skips linuxdo', () => {
    const reads = createNotificationListReads();
    const backfill = reads.beginSourceRetry({
      source: 'linuxdo',
      authority: { identityKey: 'linuxdo:2', sessionEpoch: 0 },
      filter: aggregateFilter,
      pageIndex: 0,
      cursor: undefined
    });
    const poll = reads.beginQueryRead({
      mode: 'full-chain',
      signal: new AbortController().signal,
      filter: aggregateFilter,
      requestedSources: ['nodeseek'],
      sourceAuthorities: { nodeseek: { identityKey: 'nodeseek:1', sessionEpoch: 0 } },
      cursor: {}
    });

    expect(poll.seq).toBeGreaterThan(backfill.seq);
    expect(poll.requestedSources).toEqual(['nodeseek']);
    expect(backfill.signal.aborted).toBe(false);
    expect(reads.ownsSourceRead(backfill, 'linuxdo', accessFor('linuxdo:2'))).toBe(true);
    expect(reads.ownsSourceRead(poll, 'nodeseek', accessFor('nodeseek:1'))).toBe(true);
    expect(reads.ownsSourceRead(poll, 'linuxdo', accessFor('linuxdo:2'))).toBe(false);
  });

  it('supersedes an older read for the same source regardless of read kind and aborts older retries', () => {
    const reads = createNotificationListReads();
    const olderAggregate = reads.beginQueryRead({
      mode: 'full-chain',
      signal: new AbortController().signal,
      filter: aggregateFilter,
      requestedSources: ['nodeseek', 'linuxdo'],
      sourceAuthorities: {
        nodeseek: { identityKey: 'nodeseek:1', sessionEpoch: 0 },
        linuxdo: { identityKey: 'linuxdo:2', sessionEpoch: 0 }
      },
      cursor: {}
    });
    const newerRetry = reads.beginSourceRetry({
      source: 'linuxdo',
      authority: { identityKey: 'linuxdo:2', sessionEpoch: 0 },
      filter: aggregateFilter,
      pageIndex: 0,
      cursor: undefined
    });

    expect(reads.ownsSourceRead(olderAggregate, 'nodeseek', accessFor('nodeseek:1'))).toBe(true);
    expect(reads.ownsSourceRead(olderAggregate, 'linuxdo', accessFor('linuxdo:2'))).toBe(false);
    expect(reads.ownsSourceRead(newerRetry, 'linuxdo', accessFor('linuxdo:2'))).toBe(true);

    const newerRefresh = reads.beginQueryRead({
      mode: 'full-chain',
      signal: new AbortController().signal,
      filter: aggregateFilter,
      requestedSources: ['nodeseek', 'linuxdo'],
      sourceAuthorities: {
        nodeseek: { identityKey: 'nodeseek:1', sessionEpoch: 0 },
        linuxdo: { identityKey: 'linuxdo:2', sessionEpoch: 0 }
      },
      cursor: {}
    });

    expect(newerRetry.signal.aborted).toBe(true);
    expect(reads.ownsSourceRead(newerRetry, 'linuxdo', accessFor('linuxdo:2'))).toBe(false);
    expect(reads.ownsSourceRead(newerRefresh, 'linuxdo', accessFor('linuxdo:2'))).toBe(true);
  });

  it('rejects old commits after blur, background, account switch, session epoch bump, or scope invalidation', () => {
    const reads = createNotificationListReads();
    const retry = reads.beginSourceRetry({
      source: 'linuxdo',
      authority: { identityKey: 'linuxdo:2', sessionEpoch: 0 },
      filter: aggregateFilter,
      pageIndex: 2,
      cursor: 'ld-3'
    });

    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2', 0, { focused: false }))).toBe(false);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2', 0, { appFocused: false }))).toBe(false);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:9', 0))).toBe(false);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2', 1))).toBe(false);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2', 0, { queryKey: ['other'] }))).toBe(false);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2', 0, { active: false }))).toBe(false);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2', 0, { enabled: false }))).toBe(false);

    reads.invalidateScope();
    expect(retry.signal.aborted).toBe(true);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2', 0))).toBe(false);
  });

  it('rejects an aborted Query read even while its list scope is still current', () => {
    const reads = createNotificationListReads();
    const controller = new AbortController();
    const access = accessFor('linuxdo:2');
    const ticket = reads.beginQueryRead({
      mode: 'full-chain',
      signal: controller.signal,
      filter: aggregateFilter,
      requestedSources: ['linuxdo'],
      sourceAuthorities: { linuxdo: { identityKey: 'linuxdo:2', sessionEpoch: 0 } },
      cursor: {}
    });

    expect(reads.ownsSourceRead(ticket, 'linuxdo', access)).toBe(true);
    controller.abort();
    expect(reads.isScopeCurrent(ticket, access)).toBe(false);
    expect(reads.ownsSourceRead(ticket, 'linuxdo', access)).toBe(false);
  });

  it('keeps one sequence across a refresh and leaves newer retries and different pagination cursors intact', () => {
    const reads = createNotificationListReads();
    const signal = new AbortController().signal;
    const authority = { identityKey: 'linuxdo:2', sessionEpoch: 0 };
    const query = (cursor: string | undefined, mode: 'full-chain' | 'pagination', operationSignal: AbortSignal) =>
      reads.beginQueryRead({
        mode,
        signal: operationSignal,
        filter: aggregateFilter,
        requestedSources: ['linuxdo'],
        sourceAuthorities: { linuxdo: authority },
        cursor: cursor ? { allCursors: { linuxdo: cursor } } : {}
      });

    const refreshHead = query(undefined, 'full-chain', signal);
    const retry = reads.beginSourceRetry({
      source: 'linuxdo',
      authority,
      filter: aggregateFilter,
      pageIndex: 1,
      cursor: 'page-two'
    });
    const refreshTail = query('page-two', 'full-chain', signal);
    const unrelatedPage = query('page-three', 'pagination', new AbortController().signal);

    expect(refreshTail.seq).toBe(refreshHead.seq);
    expect(retry.signal.aborted).toBe(false);
    expect(reads.ownsSourceRead(retry, 'linuxdo', accessFor('linuxdo:2'))).toBe(true);
    expect(reads.ownsSourceRead(refreshTail, 'linuxdo', accessFor('linuxdo:2'))).toBe(false);
    expect(reads.ownsSourceRead(unrelatedPage, 'linuxdo', accessFor('linuxdo:2'))).toBe(true);
  });
});
