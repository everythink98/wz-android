import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { accountQueryKeys } from '@/platform/query/serverState';
import {
  cancelForumSourceQueries,
  forumSessionEpochsAfterSourceChange,
  removeUnconfirmedForumSourceQueries,
  resetForumSourceQueries
} from './sessionQueryOwnership';

describe('session query ownership', () => {
  it('increments only the changed source epoch', () => {
    expect(
      forumSessionEpochsAfterSourceChange({ ...initialForumSessionEpochs, linuxdo: 2, nodeseek: 3 }, 'linuxdo')
    ).toEqual({
      ...initialForumSessionEpochs,
      linuxdo: 3,
      nodeseek: 3
    });
  });

  it('removes source and all queries without touching another source', async () => {
    const client = new QueryClient();
    client.setQueryData(['forum', 'linuxdo', 'feed'], 'linux');
    client.setQueryData(['forum', 'all', 'feed'], 'all');
    client.setQueryData(['forum', 'nodeseek', 'feed'], 'node');

    resetForumSourceQueries('linuxdo', client);
    await Promise.resolve();

    expect(client.getQueryData(['forum', 'linuxdo', 'feed'])).toBeUndefined();
    expect(client.getQueryData(['forum', 'all', 'feed'])).toBeUndefined();
    expect(client.getQueryData(['forum', 'nodeseek', 'feed'])).toBe('node');
  });

  it('[REG-ACCOUNT-031] cancels dirty-source and aggregate reads without evicting their last trusted data', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const sourceKey = ['forum', 'nodeseek', 'topic', { topicId: '1' }] as const;
    const aggregateKey = ['forum', 'all', 'feed', { page: 1 }] as const;
    const otherKey = ['forum', 'linuxdo', 'topic', { topicId: '2' }] as const;
    const sourceAbort = vi.fn();
    const aggregateAbort = vi.fn();
    const otherAbort = vi.fn();
    const pendingRead =
      (onAbort: () => void) =>
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              onAbort();
              reject(new Error('aborted'));
            },
            { once: true }
          );
        });

    client.setQueryData(sourceKey, 'trusted NodeSeek topic');
    client.setQueryData(aggregateKey, 'trusted aggregate');
    client.setQueryData(otherKey, 'trusted linux.do topic');
    void client.fetchQuery({ queryKey: sourceKey, queryFn: pendingRead(sourceAbort), staleTime: 0 });
    void client.fetchQuery({ queryKey: aggregateKey, queryFn: pendingRead(aggregateAbort), staleTime: 0 });
    void client.fetchQuery({ queryKey: otherKey, queryFn: pendingRead(otherAbort), staleTime: 0 });
    await Promise.resolve();

    await cancelForumSourceQueries('nodeseek', client);

    expect(sourceAbort).toHaveBeenCalledTimes(1);
    expect(aggregateAbort).toHaveBeenCalledTimes(1);
    expect(otherAbort).not.toHaveBeenCalled();
    expect(client.getQueryData(sourceKey)).toBe('trusted NodeSeek topic');
    expect(client.getQueryData(aggregateKey)).toBe('trusted aggregate');
    expect(client.getQueryData(otherKey)).toBe('trusted linux.do topic');
    await client.cancelQueries();
  });
  it('[REG-SOURCE-010] cancels only the disabled source when aggregate ownership has already changed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sourceKey = ['forum', 'nodeseek', 'feed'] as const;
    const aggregateKey = ['forum', 'all', 'feed'] as const;
    const sourceAbort = vi.fn();
    const aggregateAbort = vi.fn();
    const pendingRead =
      (onAbort: () => void) =>
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            onAbort();
            reject(new Error('aborted'));
          });
        });
    void client.fetchQuery({ queryKey: sourceKey, queryFn: pendingRead(sourceAbort) }).catch(() => undefined);
    void client.fetchQuery({ queryKey: aggregateKey, queryFn: pendingRead(aggregateAbort) }).catch(() => undefined);
    await Promise.resolve();

    await cancelForumSourceQueries('nodeseek', client, false);

    expect(sourceAbort).toHaveBeenCalledOnce();
    expect(aggregateAbort).not.toHaveBeenCalled();
    await client.cancelQueries();
  });
  it('[REG-FEED-010] removes unconfirmed source data without touching account or safe aggregate queries', () => {
    const client = new QueryClient();
    const sourceFeed = ['forum', 'nodeseek', 'feed'] as const;
    const account = accountQueryKeys.snapshot('nodeseek');
    const aggregate = ['forum', 'all', 'feed'] as const;
    const otherSource = ['forum', 'linuxdo', 'feed'] as const;
    client.setQueryData(sourceFeed, 'untrusted');
    client.setQueryData(account, 'canonical');
    client.setQueryData(aggregate, 'safe');
    client.setQueryData(otherSource, 'other');

    removeUnconfirmedForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(sourceFeed)).toBeUndefined();
    expect(client.getQueryData(account)).toBe('canonical');
    expect(client.getQueryData(aggregate)).toBe('safe');
    expect(client.getQueryData(otherSource)).toBe('other');
  });
  it('preserves only the exact active recovery query when requested', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const recoveryKey = ['forum', 'linuxdo', 'level', { epoch: 0 }] as const;
    client.setQueryData(recoveryKey, { username: 'alice' });
    client.setQueryData(['forum', 'linuxdo', 'feed'], ['old']);
    const observer = new QueryObserver(client, {
      queryKey: recoveryKey,
      queryFn: async () => ({ username: 'alice' })
    });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      expect(resetForumSourceQueries('linuxdo', client, recoveryKey)).toBe(true);
      expect(client.getQueryData(recoveryKey)).toEqual({ username: 'alice' });
      expect(client.getQueryData(['forum', 'linuxdo', 'feed'])).toBeUndefined();
    } finally {
      unsubscribe();
    }
  });
  it('[REG-ACCOUNT-042] keeps the canonical account snapshot outside the changing forum epoch', () => {
    const before = accountQueryKeys.snapshot('linuxdo');
    const nextEpochs = forumSessionEpochsAfterSourceChange({ ...initialForumSessionEpochs, linuxdo: 4 }, 'linuxdo');
    const after = accountQueryKeys.snapshot('linuxdo');

    expect(before).toEqual(['account', 'linuxdo', 'snapshot']);
    expect(after).toEqual(before);
    expect(nextEpochs.linuxdo).toBe(5);
  });
  it('[REG-ACCOUNT-042] resets changed forum content without moving the canonical account snapshot', () => {
    const client = new QueryClient();
    const accountKey = accountQueryKeys.snapshot('linuxdo');
    const account = {
      site: 'linuxdo',
      status: 'logged-in',
      cookieSummary: [],
      isVerifying: false,
      identityTrust: 'confirmed'
    };
    client.setQueryData(accountKey, account);
    client.setQueryData(['forum', 'linuxdo', 'topic'], 'old content');

    resetForumSourceQueries('linuxdo', client);

    expect(client.getQueryData(accountKey)).toEqual(account);
    expect(client.getQueryData(['forum', 'linuxdo', 'topic'])).toBeUndefined();
  });
});
