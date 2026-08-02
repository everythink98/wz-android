import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import {
  cancelForumSourceQueries,
  commitChangedAccountStatusQuery,
  forumSessionEpochsAfterSourceChange,
  removeUnconfirmedForumSourceQueries,
  resetForumSourceQueries,
  siteSessionEventInvalidatesForumQueries
} from './sessionQueryOwnership';

describe('session query ownership', () => {
  it('invalidates forum queries only for definitive identity transitions', () => {
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'session-updated',
        loggedIn: true
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'login-detected'
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'login-expired'
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'cleared'
      })
    ).toBe(true);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'verification-started'
      })
    ).toBe(false);
    expect(
      siteSessionEventInvalidatesForumQueries({
        type: 'check-failed',
        message: 'offline'
      })
    ).toBe(false);
  });

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
  it('[REG-FEED-010] removes unconfirmed source data without touching account or safe aggregate queries', () => {
    const client = new QueryClient();
    const sourceFeed = ['forum', 'nodeseek', 'feed'] as const;
    const account = ['forum', 'nodeseek', 'account-status'] as const;
    const probe = ['forum', 'nodeseek', 'account-status-probe'] as const;
    const aggregate = ['forum', 'all', 'feed'] as const;
    const otherSource = ['forum', 'linuxdo', 'feed'] as const;
    client.setQueryData(sourceFeed, 'untrusted');
    client.setQueryData(account, 'canonical');
    client.setQueryData(probe, 'probe');
    client.setQueryData(aggregate, 'safe');
    client.setQueryData(otherSource, 'other');

    removeUnconfirmedForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(sourceFeed)).toBeUndefined();
    expect(client.getQueryData(account)).toBe('canonical');
    expect(client.getQueryData(probe)).toBe('probe');
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
  it('atomically seeds the changed account result under the incremented epoch', () => {
    const client = new QueryClient();
    const probeKey = ['forum', 'linuxdo', 'account-status-probe', { epoch: 4, generation: 9 }] as const;
    const account = {
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        currentUser: { id: '42', username: 'alice' }
      }
    };
    client.setQueryData(probeKey, account);

    const next = commitChangedAccountStatusQuery(
      'linuxdo',
      { ...initialForumSessionEpochs, linuxdo: 4 },
      probeKey,
      client
    );

    expect(next.linuxdo).toBe(5);
    expect(
      client.getQueryData(
        forumQueryKeys.accountStatus({
          sessionEpochs: next,
          source: 'linuxdo'
        })
      )
    ).toEqual(account);
    expect(client.getQueryData(probeKey)).toBeUndefined();
  });
});
