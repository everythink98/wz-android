import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, jest } from '@jest/globals';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { accountQueryKeys, forumQueryKeys } from '@/platform/query/serverState';
import { cleanupContentSourceQueries } from '@/app/useContentSourceQueryCleanup';

function pendingRead(onAbort: () => void) {
  return ({ signal }: { signal: AbortSignal }) =>
    new Promise<string>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          onAbort();
          reject(new DOMException('aborted', 'AbortError'));
        },
        { once: true }
      );
    });
}

describe('content source query cleanup', () => {
  it('removes only disabled business queries and the previous aggregate snapshot', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const disabledTopic = forumQueryKeys.topic({
      source: 'nodeseek',
      topicId: 'disabled',
      scope: initialForumSessionEpochs
    });
    const disabledNotifications = forumQueryKeys.notifications('nodeseek');
    const enabledTopic = forumQueryKeys.topic({
      source: 'v2ex',
      topicId: 'enabled',
      scope: initialForumSessionEpochs
    });
    const oldAllFeed = forumQueryKeys.feed({
      enabledSourcesKey: 'v2ex,nodeseek',
      scope: initialForumSessionEpochs,
      source: 'all'
    });
    const oldAllCategories = forumQueryKeys.categories('all', initialForumSessionEpochs, 'v2ex,nodeseek');
    const newAllFeed = forumQueryKeys.feed({
      enabledSourcesKey: 'v2ex',
      scope: initialForumSessionEpochs,
      source: 'all'
    });
    const accountStatus = accountQueryKeys.snapshot('nodeseek');
    const disabledAbort = jest.fn();
    const enabledAbort = jest.fn();
    const oldAllAbort = jest.fn();
    const newAllAbort = jest.fn();
    const pendingReads = [
      client.fetchQuery({ queryKey: disabledTopic, queryFn: pendingRead(disabledAbort) }).catch(() => undefined),
      client.fetchQuery({ queryKey: enabledTopic, queryFn: pendingRead(enabledAbort) }).catch(() => undefined),
      client.fetchQuery({ queryKey: oldAllFeed, queryFn: pendingRead(oldAllAbort) }).catch(() => undefined),
      client.fetchQuery({ queryKey: newAllFeed, queryFn: pendingRead(newAllAbort) }).catch(() => undefined)
    ];
    client.setQueryData(disabledNotifications, 'disabled notifications');
    client.setQueryData(oldAllCategories, 'old categories');
    client.setQueryData(accountStatus, 'canonical account');
    await Promise.resolve();

    cleanupContentSourceQueries(
      client,
      { enabledSources: ['v2ex', 'nodeseek'], enabledSourcesKey: 'v2ex,nodeseek' },
      { enabledSources: ['v2ex'], enabledSourcesKey: 'v2ex' }
    );
    await Promise.resolve();

    expect(disabledAbort).toHaveBeenCalledTimes(1);
    expect(oldAllAbort).toHaveBeenCalledTimes(1);
    expect(enabledAbort).not.toHaveBeenCalled();
    expect(newAllAbort).not.toHaveBeenCalled();
    expect(client.getQueryData(disabledTopic)).toBeUndefined();
    expect(client.getQueryData(disabledNotifications)).toBeUndefined();
    expect(client.getQueryData(oldAllFeed)).toBeUndefined();
    expect(client.getQueryData(oldAllCategories)).toBeUndefined();
    expect(client.getQueryState(enabledTopic)?.fetchStatus).toBe('fetching');
    expect(client.getQueryState(newAllFeed)?.fetchStatus).toBe('fetching');
    expect(client.getQueryData(accountStatus)).toBe('canonical account');
    await client.cancelQueries();
    await Promise.all(pendingReads);
    client.clear();
  });

  it('leaves queries untouched when only source order changes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const sourceKey = forumQueryKeys.topic({
      source: 'v2ex',
      topicId: 'ordered',
      scope: initialForumSessionEpochs
    });
    const abort = jest.fn();
    const read = client.fetchQuery({ queryKey: sourceKey, queryFn: pendingRead(abort) }).catch(() => undefined);
    await Promise.resolve();

    cleanupContentSourceQueries(
      client,
      { enabledSources: ['v2ex', 'nodeseek'], enabledSourcesKey: 'v2ex,nodeseek' },
      { enabledSources: ['nodeseek', 'v2ex'], enabledSourcesKey: 'v2ex,nodeseek' }
    );
    await Promise.resolve();

    expect(abort).not.toHaveBeenCalled();
    expect(client.getQueryState(sourceKey)?.fetchStatus).toBe('fetching');
    await client.cancelQueries();
    await read;
    client.clear();
  });

  it('enabling a source removes only the previous aggregate snapshot', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const v2exTopic = forumQueryKeys.topic({
      source: 'v2ex',
      topicId: 'warm-v2ex',
      scope: initialForumSessionEpochs
    });
    const nodeSeekTopic = forumQueryKeys.topic({
      source: 'nodeseek',
      topicId: 'warm-nodeseek',
      scope: initialForumSessionEpochs
    });
    const oldAllFeed = forumQueryKeys.feed({
      enabledSourcesKey: 'v2ex',
      scope: initialForumSessionEpochs,
      source: 'all'
    });
    const newAllFeed = forumQueryKeys.feed({
      enabledSourcesKey: 'v2ex,nodeseek',
      scope: initialForumSessionEpochs,
      source: 'all'
    });
    const accountStatus = accountQueryKeys.snapshot('nodeseek');
    const v2exAbort = jest.fn();
    const nodeSeekAbort = jest.fn();
    const oldAllAbort = jest.fn();
    const newAllAbort = jest.fn();
    client.setQueryData(v2exTopic, 'warm v2ex');
    client.setQueryData(nodeSeekTopic, 'warm nodeseek');
    client.setQueryData(oldAllFeed, 'old all');
    client.setQueryData(newAllFeed, 'new all');
    client.setQueryData(accountStatus, 'canonical account');
    const pendingReads = [
      client.fetchQuery({ queryKey: v2exTopic, queryFn: pendingRead(v2exAbort), staleTime: 0 }).catch(() => undefined),
      client
        .fetchQuery({ queryKey: nodeSeekTopic, queryFn: pendingRead(nodeSeekAbort), staleTime: 0 })
        .catch(() => undefined),
      client
        .fetchQuery({ queryKey: oldAllFeed, queryFn: pendingRead(oldAllAbort), staleTime: 0 })
        .catch(() => undefined),
      client
        .fetchQuery({ queryKey: newAllFeed, queryFn: pendingRead(newAllAbort), staleTime: 0 })
        .catch(() => undefined)
    ];
    await Promise.resolve();

    cleanupContentSourceQueries(
      client,
      { enabledSources: ['v2ex'], enabledSourcesKey: 'v2ex' },
      { enabledSources: ['v2ex', 'nodeseek'], enabledSourcesKey: 'v2ex,nodeseek' }
    );
    await Promise.resolve();

    expect(oldAllAbort).toHaveBeenCalledTimes(1);
    expect(v2exAbort).not.toHaveBeenCalled();
    expect(nodeSeekAbort).not.toHaveBeenCalled();
    expect(newAllAbort).not.toHaveBeenCalled();
    expect(client.getQueryData(oldAllFeed)).toBeUndefined();
    expect(client.getQueryData(v2exTopic)).toBe('warm v2ex');
    expect(client.getQueryData(nodeSeekTopic)).toBe('warm nodeseek');
    expect(client.getQueryData(newAllFeed)).toBe('new all');
    expect(client.getQueryData(accountStatus)).toBe('canonical account');
    await client.cancelQueries();
    await Promise.all(pendingReads);
    client.clear();
  });
});
