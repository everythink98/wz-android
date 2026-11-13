import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { describe, expect, it, jest } from '@jest/globals';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { accountQueryKeys, forumQueryKeys } from '@/platform/query/serverState';
import { cleanupContentSourceQueries, useContentSourceQueryCleanup } from '@/app/useContentSourceQueryCleanup';
import { canonicalEnabledSourcesKey } from '@/domain/reader/contentSourcePreferences';
import type { Source } from '@/domain/forum/models';

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
  it('keeps initial caches and advances the previous scope through disable and reenable', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const sources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'] as const;
    const allKey = canonicalEnabledSourcesKey(sources.map((source) => ({ source, enabled: true })));
    const disabledKey = canonicalEnabledSourcesKey(
      sources.map((source) => ({ source, enabled: source !== 'linuxdo' }))
    );
    const linuxDo = forumQueryKeys.topic({
      source: 'linuxdo',
      topicId: 'scope-hook',
      scope: initialForumSessionEpochs
    });
    const v2ex = forumQueryKeys.topic({ source: 'v2ex', topicId: 'scope-hook', scope: initialForumSessionEpochs });
    const allFeed = forumQueryKeys.feed({ source: 'all', scope: initialForumSessionEpochs, enabledSourcesKey: allKey });
    const disabledFeed = forumQueryKeys.feed({
      source: 'all',
      scope: initialForumSessionEpochs,
      enabledSourcesKey: disabledKey
    });
    client.setQueryData(linuxDo, 'linuxdo cached');
    client.setQueryData(v2ex, 'v2ex retained');
    client.setQueryData(allFeed, 'initial aggregate');
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    type Props = { sources: readonly Source[]; scopeKey: string };
    const hook = await renderHook((props: Props) => useContentSourceQueryCleanup(props.sources, props.scopeKey), {
      initialProps: { sources, scopeKey: allKey },
      wrapper: Wrapper
    });
    try {
      expect(client.getQueryData(linuxDo)).toBe('linuxdo cached');
      expect(client.getQueryData(allFeed)).toBe('initial aggregate');
      await hook.rerender({ sources: sources.filter((source) => source !== 'linuxdo'), scopeKey: disabledKey });
      expect(client.getQueryData(linuxDo)).toBeUndefined();
      expect(client.getQueryData(allFeed)).toBeUndefined();
      expect(client.getQueryData(v2ex)).toBe('v2ex retained');
      client.setQueryData(disabledFeed, 'previous disabled aggregate');
      client.setQueryData(allFeed, 'reenabled aggregate');
      await hook.rerender({ sources, scopeKey: allKey });
      expect(client.getQueryData(disabledFeed)).toBeUndefined();
      expect(client.getQueryData(allFeed)).toBe('reenabled aggregate');
      expect(client.getQueryData(v2ex)).toBe('v2ex retained');
    } finally {
      await hook.unmount();
      client.clear();
    }
  });

  it('bounds cached queries and pending reads across repeated source disable and enable cycles', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
    const sources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'] as const;
    const allSources = {
      enabledSources: sources,
      enabledSourcesKey: canonicalEnabledSourcesKey(sources.map((source) => ({ source, enabled: true })))
    };
    const siteCaches = sources.map((source) => ({
      source,
      accountKey: accountQueryKeys.snapshot(source),
      entries: Array.from({ length: 100 }, (_, index) => ({
        key: forumQueryKeys.topic({ source, topicId: `pressure-${index}`, scope: initialForumSessionEpochs }),
        data: `${source} cached topic ${index}`
      }))
    }));
    const aggregateKeys = (enabledSourcesKey: string) => [
      forumQueryKeys.feed({ source: 'all', scope: initialForumSessionEpochs, enabledSourcesKey }),
      forumQueryKeys.categories('all', initialForumSessionEpochs, enabledSourcesKey)
    ];
    const fullAggregate = aggregateKeys(allSources.enabledSourcesKey);
    let pendingReads: Promise<unknown>[] = [];
    try {
      for (let round = 0; round < 20; round++) {
        const disabled = siteCaches[round % sources.length];
        const nextSources = {
          enabledSources: sources.filter((source) => source !== disabled.source),
          enabledSourcesKey: canonicalEnabledSourcesKey(
            sources.map((source) => ({ source, enabled: source !== disabled.source }))
          )
        };
        const nextAggregate = aggregateKeys(nextSources.enabledSourcesKey);
        siteCaches.forEach(({ source, accountKey, entries }) => {
          client.setQueryData(accountKey, `${source} canonical account`);
          entries.forEach(({ key, data }) => client.setQueryData(key, data));
        });
        fullAggregate.forEach((key) => client.setQueryData(key, 'all sources'));
        nextAggregate.forEach((key) => client.setQueryData(key, 'next sources'));
        const sourceReads = siteCaches.flatMap(({ source, entries }) =>
          entries.slice(0, 2).map(({ key }) => ({ source, key, abort: jest.fn() }))
        );
        const previousAggregateAbort = jest.fn();
        const nextAggregateAbort = jest.fn();
        const reads = [
          ...sourceReads,
          { key: fullAggregate[0], abort: previousAggregateAbort },
          { key: nextAggregate[0], abort: nextAggregateAbort }
        ];
        pendingReads = reads.map(({ key, abort }) =>
          client.query({ queryKey: key, queryFn: pendingRead(abort), staleTime: 0 }).catch(() => undefined)
        );
        await Promise.resolve();
        expect(client.isFetching()).toBe(10);
        expect(client.getQueryCache().getAll()).toHaveLength(408);

        const beforeReorder = client.getQueryCache().getAll();
        cleanupContentSourceQueries(client, allSources, {
          ...allSources,
          enabledSources: [...sources].reverse()
        });
        expect(client.getQueryCache().getAll()).toEqual(beforeReorder);
        reads.forEach(({ abort }) => expect(abort).not.toHaveBeenCalled());

        cleanupContentSourceQueries(client, allSources, nextSources);
        await Promise.resolve();
        siteCaches.forEach(({ source, accountKey, entries }) => {
          expect(client.getQueryData(accountKey)).toBe(`${source} canonical account`);
          entries.forEach(({ key, data }) => {
            expect(client.getQueryData(key)).toBe(source === disabled.source ? undefined : data);
          });
        });
        sourceReads.forEach(({ source, key, abort }) => {
          expect(abort).toHaveBeenCalledTimes(source === disabled.source ? 1 : 0);
          if (source !== disabled.source) expect(client.getQueryState(key)?.fetchStatus).toBe('fetching');
        });
        fullAggregate.forEach((key) => expect(client.getQueryData(key)).toBeUndefined());
        nextAggregate.forEach((key) => expect(client.getQueryData(key)).toBe('next sources'));
        expect(previousAggregateAbort).toHaveBeenCalledTimes(1);
        expect(nextAggregateAbort).not.toHaveBeenCalled();
        expect(client.getQueryCache().getAll()).toHaveLength(306);

        cleanupContentSourceQueries(client, nextSources, allSources);
        await Promise.resolve();
        expect(nextAggregateAbort).toHaveBeenCalledTimes(1);
        nextAggregate.forEach((key) => expect(client.getQueryData(key)).toBeUndefined());
        sourceReads.forEach(({ source, abort }) => {
          expect(abort).toHaveBeenCalledTimes(source === disabled.source ? 1 : 0);
        });
        expect(client.isFetching()).toBe(6);
        expect(client.getQueryCache().getAll()).toHaveLength(304);
        disabled.entries.forEach(({ key, data }) => client.setQueryData(key, data));
        fullAggregate.forEach((key) => client.setQueryData(key, 'all sources'));
        await client.cancelQueries();
        await Promise.all(pendingReads);
        reads.forEach(({ abort }) => expect(abort).toHaveBeenCalledTimes(1));
        siteCaches.forEach(({ source, accountKey, entries }) => {
          expect(client.getQueryData(accountKey)).toBe(`${source} canonical account`);
          entries.forEach(({ key, data }) => expect(client.getQueryData(key)).toBe(data));
        });
        expect(client.isFetching()).toBe(0);
        expect(client.getQueryCache().getAll()).toHaveLength(406);
      }
    } finally {
      await client.cancelQueries();
      await Promise.all(pendingReads);
      client.clear();
    }
  });

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
      client.query({ queryKey: disabledTopic, queryFn: pendingRead(disabledAbort) }).catch(() => undefined),
      client.query({ queryKey: enabledTopic, queryFn: pendingRead(enabledAbort) }).catch(() => undefined),
      client.query({ queryKey: oldAllFeed, queryFn: pendingRead(oldAllAbort) }).catch(() => undefined),
      client.query({ queryKey: newAllFeed, queryFn: pendingRead(newAllAbort) }).catch(() => undefined)
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
    const read = client.query({ queryKey: sourceKey, queryFn: pendingRead(abort) }).catch(() => undefined);
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
      client.query({ queryKey: v2exTopic, queryFn: pendingRead(v2exAbort), staleTime: 0 }).catch(() => undefined),
      client
        .query({ queryKey: nodeSeekTopic, queryFn: pendingRead(nodeSeekAbort), staleTime: 0 })
        .catch(() => undefined),
      client.query({ queryKey: oldAllFeed, queryFn: pendingRead(oldAllAbort), staleTime: 0 }).catch(() => undefined),
      client.query({ queryKey: newAllFeed, queryFn: pendingRead(newAllAbort), staleTime: 0 }).catch(() => undefined)
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
