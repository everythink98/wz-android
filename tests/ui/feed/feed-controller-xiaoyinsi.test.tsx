import { afterEach } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { useLayoutEffect } from 'react';
import { useFeedController } from '@/features/feed/useFeedController';
import { useForumCatalogRuntime } from '@/app/useForumCatalogRuntime';
import { createEmptyReaderData, topicKey } from '@/domain/reader/readerData';
import { canonicalEnabledSourcesKey, projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import type { ReadGateway } from '@/sources/readGateway';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { resetForumSourceQueries } from '@/features/account/sessionQueryOwnership';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { sessionSources, sourceValues, type SessionSource, type Source } from '@/domain/forum/sourceCatalog';
import type { Category, SourceErrors, Topic } from '@/domain/forum/models';
import { forumReadPlanScopesKey, resolveForumReadPlan, type ForumReadOperation } from '@/domain/forum/readPlan';
import { isSessionSource } from '@/domain/forum/sourceCatalog';
import { QueryTestWrapper } from '../QueryTestWrapper';

function renderHook<Result>(callback: () => Result) {
  appQueryClient.clear();
  return renderNativeHook(callback, { wrapper: QueryTestWrapper });
}

const defaultEnabledSourcesKey = canonicalEnabledSourcesKey(createEmptyReaderData().settings.contentSources);

type FeedRuntimeOptions = Omit<Parameters<typeof useFeedController>[0], 'catalogCategories'> & {
  catalogActive?: boolean;
  identityBarriers?: readonly SessionSource[];
};

function testReadPlan(
  source: Source,
  operation: ForumReadOperation,
  enabled: boolean,
  identityBarriers: readonly SessionSource[] = [],
  sessionEpochs: ForumSessionEpochs = initialForumSessionEpochs
) {
  return resolveForumReadPlan(
    source,
    operation,
    enabled,
    isSessionSource(source)
      ? {
          source,
          authenticated: !identityBarriers.includes(source),
          authSurfaceOpen: false,
          identityKey: `${source}:test`,
          identityTrust: identityBarriers.includes(source) ? 'pending' : 'confirmed',
          sessionEpoch: sessionEpochs[source],
          sourceEnabled: enabled
        }
      : undefined
  );
}

function aggregateReadPlanScope(
  operation: ForumReadOperation,
  enabledSources: readonly Source[] = sourceValues,
  identityBarriers: readonly SessionSource[] = [],
  sessionEpochs: ForumSessionEpochs = initialForumSessionEpochs
) {
  return forumReadPlanScopesKey(
    enabledSources.map(
      (source) => [source, testReadPlan(source, operation, true, identityBarriers, sessionEpochs).cacheScope] as const
    )
  );
}

function useFeedRuntime({ catalogActive, ...options }: FeedRuntimeOptions) {
  const sourceProjection = projectContentSourcePreferences(options.readerData.settings.contentSources);
  const enabledSources = new Set(sourceProjection.enabledSources);
  const readGateway = {
    ...options.readGateway,
    getReadPlan: (source: Source, operation: ForumReadOperation) =>
      testReadPlan(source, operation, enabledSources.has(source), options.identityBarriers, options.sessionEpochs)
  } as ReadGateway;
  const catalog = useForumCatalogRuntime({
    active: (catalogActive ?? options.active) && !options.linuxDoVerificationActive,
    enabledFeedSources: sourceProjection.feedSources,
    enabledSourcesKey: canonicalEnabledSourcesKey(options.readerData.settings.contentSources),
    notify: options.notify,
    readGateway,
    sessionEpochs: options.sessionEpochs
  });
  return useFeedController({ ...options, readGateway, catalogCategories: catalog.categories });
}

function readerDataWithEnabledSources(enabledSources: readonly Source[]) {
  const data = createEmptyReaderData();
  const enabled = new Set(enabledSources);
  return {
    ...data,
    settings: {
      ...data.settings,
      contentSources: [
        ...enabledSources.map((source) => ({ source, enabled: true })),
        ...sourceValues.filter((source) => !enabled.has(source)).map((source) => ({ source, enabled: false }))
      ]
    }
  };
}

describe('小隐寺 Feed controller', () => {
  afterEach(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it('[REG-PROXY-012] keeps the current Feed loading until the runtime recovery replay succeeds', async () => {
    const topic: Topic = {
      source: 'v2ex',
      id: 'runtime-recovered',
      title: '重建后的列表',
      author: 'alice',
      url: 'https://www.v2ex.com/t/runtime-recovered',
      createdAt: '2026-08-14T00:00:00.000Z',
      replyCount: 0
    };
    const recoveredFeed = Promise.withResolvers<{
      items: Topic[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const getFeed = jest.fn(async ({ source }: { source: string }) =>
      source === 'v2ex' ? recoveredFeed.promise : { items: [], errors: {}, hasMore: false as const, nextPage: null }
    );
    const notify = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData: readerDataWithEnabledSources(['v2ex']),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway: {
          getCategories: jest.fn(async () => ({ items: [], errors: {} })),
          getFeed,
          hasYaohuoCredential: jest.fn(async () => false)
        } as unknown as ReadGateway
      })
    );

    await act(async () => hook.result.current.changeFeedSource('v2ex'));
    await waitFor(() =>
      expect(getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'v2ex' }), expect.any(Object))
    );
    expect(hook.result.current.feedBusy).toBe(true);
    expect(hook.result.current.feedOutcomeKind).toBeUndefined();

    await act(async () => {
      recoveredFeed.resolve({ items: [topic], errors: {}, hasMore: false, nextPage: null });
      await recoveredFeed.promise;
    });

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([topic]));
    expect(hook.result.current.feedBusy).toBe(false);
    expect(hook.result.current.feedOutcomeKind).toBe('data');
    expect(notify).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-012] leaves Loading and reports the error when the runtime recovery replay also fails', async () => {
    const failedFeed = Promise.withResolvers<{
      items: Topic[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const getFeed = jest.fn(async ({ source }: { source: string }) =>
      source === 'v2ex' ? failedFeed.promise : { items: [], errors: {}, hasMore: false as const, nextPage: null }
    );
    const notify = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData: readerDataWithEnabledSources(['v2ex']),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway: {
          getCategories: jest.fn(async () => ({ items: [], errors: {} })),
          getFeed,
          hasYaohuoCredential: jest.fn(async () => false)
        } as unknown as ReadGateway
      })
    );

    await act(async () => hook.result.current.changeFeedSource('v2ex'));
    await waitFor(() => expect(hook.result.current.feedBusy).toBe(true));

    await act(async () => {
      failedFeed.reject(new Error('请求超时，请稍后重试'));
      await expect(failedFeed.promise).rejects.toThrow('请求超时，请稍后重试');
    });

    await waitFor(() => expect(hook.result.current.feedBusy).toBe(false));
    expect(hook.result.current.feedOutcomeKind).toBe('error');
    expect(notify).toHaveBeenCalledWith('请求超时，请稍后重试');
  });

  it('[REG-SOURCE-011] does not pause public Feed or Categories while identity reconciliation is pending', async () => {
    const topic: Topic = {
      source: 'xiaoyinsi',
      id: 'public-topic',
      title: '公开主题',
      author: 'alice',
      url: 'https://forum.xiaoyinsi.com/t/public-topic',
      createdAt: '2026-08-10T00:00:00.000Z',
      replyCount: 0
    };
    const getCategories = jest.fn(
      async (
        _request: Parameters<ReadGateway['getCategories']>[0],
        _context?: Parameters<ReadGateway['getCategories']>[1]
      ) => ({
        items: [],
        errors: {}
      })
    );
    const getFeed = jest.fn(
      async (_request: Parameters<ReadGateway['getFeed']>[0], _context?: Parameters<ReadGateway['getFeed']>[1]) => ({
        items: [topic],
        errors: {},
        hasMore: false,
        nextPage: null
      })
    );
    const hook = await renderHook(() =>
      useFeedRuntime({
        active: true,
        identityBarriers: ['xiaoyinsi'],
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: readerDataWithEnabledSources(['xiaoyinsi']),
        readerDataLoaded: true,
        readGateway: { getCategories, getFeed } as unknown as ReadGateway,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn()
      })
    );

    await waitFor(() => expect(getCategories).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.shownFeedItems).toEqual([topic]));
    expect(getCategories.mock.calls[0]?.[1]).toMatchObject({
      readPlanScopes: [['xiaoyinsi', 'public:omit']]
    });
    expect(getFeed.mock.calls[0]?.[1]).toMatchObject({
      readPlanScopes: [['xiaoyinsi', 'public:omit']]
    });
  });

  it('[REG-SOURCE-010] replaces aggregate Feed with the same enabled-source snapshot', async () => {
    type FeedResult = Awaited<ReturnType<ReadGateway['getFeed']>>;
    const requests: {
      context?: { includedSources?: readonly Source[] };
      deferred: ReturnType<typeof Promise.withResolvers<FeedResult>>;
      signal: AbortSignal;
    }[] = [];
    const getFeed = jest.fn(
      ({ signal }: { signal: AbortSignal }, context?: { includedSources?: readonly Source[] }): Promise<FeedResult> => {
        const deferred = Promise.withResolvers<FeedResult>();
        signal.addEventListener('abort', () => deferred.reject(new DOMException('aborted', 'AbortError')), {
          once: true
        });
        requests.push({ context, deferred, signal });
        return deferred.promise;
      }
    );
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let readerData = readerDataWithEnabledSources(['v2ex', 'nodeseek']);
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].context?.includedSources).toEqual(['v2ex', 'nodeseek']);

    readerData = readerDataWithEnabledSources(['v2ex']);
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].context?.includedSources).toEqual(['v2ex']);
  });

  it('[REG-SOURCE-010] keeps Feed selection on reorder and exposes no warm data when all sources are disabled', async () => {
    const topic: Topic = {
      source: 'v2ex',
      id: 'enabled-topic',
      title: '启用来源主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/enabled-topic',
      createdAt: '2026-08-10T00:00:00.000Z',
      replyCount: 0
    };
    const getFeed = jest.fn(async () => ({ items: [topic], errors: {}, hasMore: false, nextPage: null }));
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let readerData = readerDataWithEnabledSources(['v2ex', 'nodeseek']);
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([topic]));
    await act(async () => hook.result.current.setReadingFilter('unread'));
    readerData = readerDataWithEnabledSources(['nodeseek', 'v2ex']);
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(getFeed).toHaveBeenCalledTimes(1);
    expect(hook.result.current.feedSource).toBe('all');
    expect(hook.result.current.readingFilter).toBe('unread');

    readerData = readerDataWithEnabledSources([]);
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(getFeed).toHaveBeenCalledTimes(1);
    expect(hook.result.current.activeFeedState.items).toEqual([]);
    expect(hook.result.current.feedBusy).toBe(false);
    expect(hook.result.current.feedOutcomeKind).toBe('empty');
  });

  it('[REG-SOURCE-010] gates a disabled direct Feed before fallback, refresh, pagination or reselection can read it', async () => {
    const getFeed = jest.fn(async ({ source }: Parameters<ReadGateway['getFeed']>[0]) => ({
      items: [
        {
          source: source === 'all' ? 'v2ex' : source,
          id: `${source}-topic`,
          title: `${source} topic`,
          author: 'alice',
          url: `https://example.com/${source}`,
          createdAt: '2026-08-10T00:00:00.000Z',
          replyCount: 0
        }
      ],
      errors: {},
      hasMore: true,
      nextPage: 2
    }));
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const notify = jest.fn();
    const cancelQueries = jest.spyOn(appQueryClient, 'cancelQueries');
    const removeQueries = jest.spyOn(appQueryClient, 'removeQueries');
    let readerData = readerDataWithEnabledSources(['v2ex', 'nodeseek']);
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));
    await act(async () => hook.result.current.changeFeedSource('v2ex'));
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2));
    await act(async () => hook.result.current.setCategoryFilter('qna'));
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(3));

    const cancelCountBeforeReorder = cancelQueries.mock.calls.length;
    const removeCountBeforeReorder = removeQueries.mock.calls.length;
    readerData = readerDataWithEnabledSources(['nodeseek', 'v2ex']);
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(hook.result.current.feedSource).toBe('v2ex');
    expect(hook.result.current.categoryFilter).toBe('qna');
    expect(getFeed).toHaveBeenCalledTimes(3);
    expect(cancelQueries).toHaveBeenCalledTimes(cancelCountBeforeReorder);
    expect(removeQueries).toHaveBeenCalledTimes(removeCountBeforeReorder);

    readerData = readerDataWithEnabledSources([]);
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(hook.result.current.feedSource).toBe('all');
    expect(hook.result.current.categoryFilter).toBe('');
    const requestCount = getFeed.mock.calls.length;
    let loadOutcome: Awaited<ReturnType<typeof hook.result.current.loadFeed>> | undefined;
    await act(async () => {
      loadOutcome = await hook.result.current.loadFeed();
      await hook.result.current.refreshFeed();
      hook.result.current.changeFeedSource('v2ex');
      await Promise.resolve();
    });

    expect(loadOutcome).toBe('stale');
    expect(hook.result.current.feedSource).toBe('all');
    expect(getFeed).toHaveBeenCalledTimes(requestCount);
    expect(notify).not.toHaveBeenCalled();
    expect(
      appQueryClient
        .getQueryCache()
        .findAll({
          predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === 'v2ex' && queryKey[2] === 'feed'
        })
        .every((query) => query.state.fetchStatus === 'idle')
    ).toBe(true);
    cancelQueries.mockRestore();
    removeQueries.mockRestore();
  });

  it.each([
    { label: 'uncached', withCache: false },
    { label: 'cached', withCache: true }
  ])('[REG-FEED-015] replaces an in-flight $label feed during manual refresh', async ({ withCache }) => {
    type FeedResult = Awaited<ReturnType<ReadGateway['getFeed']>>;
    const requests: {
      deferred: ReturnType<typeof Promise.withResolvers<FeedResult>>;
      signal: AbortSignal;
    }[] = [];
    const getFeed = jest.fn(({ signal }: { signal: AbortSignal }) => {
      const deferred = Promise.withResolvers<FeedResult>();
      signal.addEventListener('abort', () => deferred.reject(new DOMException('aborted', 'AbortError')), {
        once: true
      });
      requests.push({ deferred, signal });
      return deferred.promise;
    });
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const notify = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    const response = (id: string): FeedResult => ({
      items: [
        {
          source: 'v2ex',
          id,
          title: id,
          author: 'alice',
          url: `https://www.v2ex.com/t/${id}`,
          createdAt: '2026-08-05T00:00:00.000Z',
          replyCount: 0
        }
      ],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    let staleRefresh: Promise<void> | undefined;
    if (withCache) {
      await act(async () => {
        requests[0].deferred.resolve(response('cached'));
        await requests[0].deferred.promise;
      });
      await waitFor(() => expect(hook.result.current.activeFeedState.items[0]?.id).toBe('cached'));
      await act(async () => {
        staleRefresh = hook.result.current.refreshFeed();
        await Promise.resolve();
      });
      await waitFor(() => expect(requests).toHaveLength(2));
    }
    notify.mockClear();
    let replacement!: Promise<void>;
    await act(async () => {
      replacement = hook.result.current.refreshFeed();
      await Promise.resolve();
    });
    const expectedCalls = withCache ? 3 : 2;
    await waitFor(() => expect(requests).toHaveLength(expectedCalls));
    const replacedRequest = requests[withCache ? 1 : 0];
    const finalRequest = requests.at(-1)!;

    expect(replacedRequest.signal.aborted).toBe(true);
    await act(async () => {
      finalRequest.deferred.resolve(response('replacement'));
      await Promise.all([replacement, staleRefresh].filter(Boolean));
    });

    await waitFor(() => expect(hook.result.current.activeFeedState.items[0]?.id).toBe('replacement'));
    expect(notify).not.toHaveBeenCalledWith('列表正在更新');
  });

  it('[REG-FEED-007] does not replay a cached partial error after returning to Feed', async () => {
    const partialErrors = {
      v2ex: {
        kind: 'ordinary' as const,
        message: 'V2EX 暂时不可用'
      }
    };
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => ({
        items: [
          {
            source: 'linuxdo' as const,
            id: 'partial-page-topic',
            title: '可用来源主题',
            author: 'alice',
            url: 'https://linux.do/t/partial-page-topic',
            createdAt: '2026-07-26T00:00:00.000Z',
            replyCount: 0
          }
        ],
        errors: partialErrors,
        hasMore: false,
        nextPage: null
      })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const notify = jest.fn();
    let active = true;
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(readGateway.getFeed).toHaveBeenCalledTimes(1);

    active = false;
    await act(async () => hook.rerender({}));
    active = true;
    await act(async () => hook.rerender({}));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(readGateway.getFeed).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('[REG-LINUXDO-006] aborts the owned Feed request after leaving Feed and ignores later credential changes', async () => {
    const pendingFeed = Promise.withResolvers<{
      items: never[];
      errors: {
        linuxdo: {
          kind: 'verification-required';
          message: string;
          verificationRequired: true;
        };
      };
      hasMore: false;
      nextPage: null;
    }>();
    const feedSignals: AbortSignal[] = [];
    const getFeed = jest.fn(async ({ signal }: { signal: AbortSignal }) => {
      feedSignals.push(signal);
      return pendingFeed.promise;
    });
    const showLinuxDoVerification = jest.fn<void, [message?: string, recovery?: LinuxDoReadRecovery]>();
    const showNodeSeekVerification = jest.fn<void, [message?: string]>();
    const showYaohuoLogin = jest.fn<void, [message?: string]>();
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let sessionEpochs = initialForumSessionEpochs;
    let active = true;
    const hook = await renderHook(() =>
      useFeedRuntime({
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway
      })
    );
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));

    active = false;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(feedSignals[0]?.aborted).toBe(true));

    sessionEpochs = { ...initialForumSessionEpochs, linuxdo: 1 };
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await act(async () => {
      pendingFeed.resolve({
        items: [],
        errors: {
          linuxdo: {
            kind: 'verification-required',
            message: '离开页面后的旧请求',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      });
      await pendingFeed.promise;
    });
    expect(getFeed).toHaveBeenCalledTimes(1);
    expect(showLinuxDoVerification).not.toHaveBeenCalled();
    expect(showNodeSeekVerification).not.toHaveBeenCalled();
    expect(showYaohuoLogin).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-006] pauses categories during verification without canceling the primary Feed read', async () => {
    const categorySignals: AbortSignal[] = [];
    const getCategories = jest.fn(async ({ signal }: { signal: AbortSignal }) => {
      categorySignals.push(signal);
      if (categorySignals.length === 1) {
        return new Promise<{ items: never[]; errors: Record<string, never> }>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      return { items: [], errors: {} };
    });
    const pendingFeed = Promise.withResolvers<{
      items: never[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const feedSignals: AbortSignal[] = [];
    const getFeed = jest.fn(async ({ signal }: { signal: AbortSignal }) => {
      feedSignals.push(signal);
      return pendingFeed.promise;
    });
    const readGateway = {
      getCategories,
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let linuxDoVerificationActive = false;
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    await waitFor(() => {
      expect(getCategories).toHaveBeenCalledTimes(1);
      expect(getFeed).toHaveBeenCalledTimes(1);
    });

    linuxDoVerificationActive = true;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(categorySignals[0]?.aborted).toBe(true));
    expect(feedSignals[0]?.aborted).toBe(false);
    expect(getCategories).toHaveBeenCalledTimes(1);

    linuxDoVerificationActive = false;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(getCategories).toHaveBeenCalledTimes(2));
    expect(getFeed).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingFeed.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
      await pendingFeed.promise;
    });
  });

  it('[REG-SOURCE-011] starts aggregate public lanes without waiting for account bootstrap', async () => {
    const topic: Topic = {
      source: 'v2ex',
      id: 'public-bootstrap',
      title: '公开启动主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/public-bootstrap',
      createdAt: '2026-08-10T00:00:00.000Z',
      replyCount: 0
    };
    const getCategories = jest.fn(async () => ({ items: [], errors: {} }));
    const getFeed = jest.fn(
      async (_request: Parameters<ReadGateway['getFeed']>[0], _context?: Parameters<ReadGateway['getFeed']>[1]) => ({
        items: [topic],
        errors: {},
        hasMore: false,
        nextPage: null
      })
    );
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers: sessionSources,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway: { getCategories, getFeed } as unknown as ReadGateway
      })
    );

    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getCategories).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([topic]));
    expect(getFeed.mock.calls[0]?.[1]?.readPlanScopes).toEqual([
      ['v2ex', 'public:omit'],
      ['linuxdo', 'public:omit'],
      ['nodeseek', 'public:omit'],
      ['yaohuo', 'blocked:identity-pending'],
      ['xiaoyinsi', 'public:omit']
    ]);
  });

  it('[REG-FEED-011] keeps unrelated single-source pagination active during aggregate reconciliation', async () => {
    const topics = [1, 2].map((page) => ({
      source: 'v2ex' as const,
      id: `single-source-page-${page}`,
      title: `单站第 ${page} 页`,
      author: 'alice',
      url: `https://www.v2ex.com/t/single-source-page-${page}`,
      createdAt: '2026-07-27T00:00:00.000Z',
      replyCount: 0
    }));
    const getFeed = jest.fn(
      async (
        { page = 1, source }: { page?: number; source: string },
        _context?: Parameters<ReadGateway['getFeed']>[1]
      ) => {
        if (source !== 'v2ex') {
          return { items: [], errors: {}, hasMore: false as const, nextPage: null };
        }
        return page === 1
          ? {
              items: [topics[0]],
              errors: {},
              hasMore: true as const,
              nextCursor: 'v2ex-next',
              nextPage: 2 as const
            }
          : {
              items: [topics[1]],
              errors: {},
              hasMore: false as const,
              nextPage: null
            };
      }
    );
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let identityBarriers: SessionSource[] = [];
    let sessionEpochs: ForumSessionEpochs = initialForumSessionEpochs;
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers,
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));
    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => {
      expect(hook.result.current.feedSource).toBe('v2ex');
      expect(hook.result.current.activeFeedState.items).toEqual([topics[0]]);
    });

    identityBarriers = [...sessionSources];
    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    let loadOutcome: Awaited<ReturnType<typeof hook.result.current.loadFeed>> | undefined;
    await act(async () => {
      loadOutcome = await hook.result.current.loadFeed();
    });
    expect(loadOutcome).toBe('completed');
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual(topics));
    expect(getFeed.mock.calls.at(-1)?.[0]).toMatchObject({
      cursor: 'v2ex-next',
      page: 2,
      source: 'v2ex'
    });
  });

  it('[REG-SOURCE-011] makes a saved authenticated recovery stale when the public plan takes ownership', async () => {
    const topic = {
      source: 'v2ex' as const,
      id: 'saved-recovery-topic',
      title: '旧恢复命令不可越过新事务',
      author: 'alice',
      url: 'https://www.v2ex.com/t/saved-recovery-topic',
      createdAt: '2026-07-27T00:00:00.000Z',
      replyCount: 0
    };
    const verificationError = {
      linuxdo: {
        kind: 'verification-required' as const,
        message: '需要验证',
        verificationRequired: true
      }
    };
    const getFeed = jest.fn(
      async (
        { page = 1, source }: { page?: number; source: string },
        _context?: Parameters<ReadGateway['getFeed']>[1]
      ) => {
        if (source !== 'linuxdo') {
          return { items: [], errors: {}, hasMore: false as const, nextPage: null };
        }
        return page === 1
          ? {
              items: [{ ...topic, source: 'linuxdo' as const, url: 'https://linux.do/t/saved-recovery-topic' }],
              errors: {},
              hasMore: true as const,
              nextCursor: 'saved-recovery-cursor',
              nextPage: 2 as const
            }
          : {
              items: [],
              errors: verificationError,
              hasMore: true as const,
              nextCursor: 'saved-recovery-cursor',
              nextPage: 2 as const
            };
      }
    );
    const showLinuxDoVerification = jest.fn<void, [message?: string, recovery?: LinuxDoReadRecovery]>();
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let identityBarriers: SessionSource[] = [];
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));
    await act(async () => {
      hook.result.current.changeFeedSource('linuxdo');
    });
    await waitFor(() =>
      expect(hook.result.current.activeFeedState.items).toEqual([
        { ...topic, source: 'linuxdo', url: 'https://linux.do/t/saved-recovery-topic' }
      ])
    );
    let loadOutcome: Awaited<ReturnType<typeof hook.result.current.loadFeed>> | undefined;
    await act(async () => {
      loadOutcome = await hook.result.current.loadFeed();
    });
    expect(loadOutcome).toBe('failed');
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery).toBeDefined();
    expect(getFeed.mock.calls.filter(([request]) => request.source === 'linuxdo')).toHaveLength(2);

    identityBarriers = ['linuxdo'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    let recoveryOutcome: Awaited<ReturnType<LinuxDoReadRecovery['resume']>> | undefined;
    await act(async () => {
      recoveryOutcome = await recovery!.resume();
    });
    expect(recoveryOutcome).toBe('stale');
    expect(getFeed.mock.calls.filter(([request]) => request.source === 'linuxdo')).toHaveLength(3);
    expect(getFeed.mock.calls.at(-1)?.[1]).toMatchObject({ readPlanScope: 'public:omit' });
  });

  it('[REG-LINUXDO-006] keeps shared categories on Search without starting Feed and cancels them after leaving both owners', async () => {
    const categorySignals: AbortSignal[] = [];
    const getCategories = jest.fn(async ({ signal }: { signal: AbortSignal }) => {
      categorySignals.push(signal);
      return new Promise<{ items: never[]; errors: Record<string, never> }>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const getFeed = jest.fn(
      async (_options: Parameters<ReadGateway['getFeed']>[0], _context?: Parameters<ReadGateway['getFeed']>[1]) => ({
        items: [],
        errors: {},
        hasMore: false,
        nextPage: null
      })
    );
    const readGateway = {
      getCategories,
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let catalogActive = true;
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: false,
        catalogActive,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    await waitFor(() => expect(getCategories).toHaveBeenCalledTimes(1));
    expect(getFeed).not.toHaveBeenCalled();

    catalogActive = false;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(categorySignals[0]?.aborted).toBe(true));
    expect(getFeed).not.toHaveBeenCalled();
  });

  it('[REG-LINUXDO-006] does not replay a stale single-source category panel when shared categories settle on Search', async () => {
    const sharedCategories = Promise.withResolvers<{ items: never[]; errors: Record<string, never> }>();
    const getCategories = jest.fn(async ({ source }: { source: string }) => {
      if (source === 'all') {
        return sharedCategories.promise;
      }
      throw Object.assign(new Error('NodeSeek 分类需要验证'), {
        source: 'nodeseek',
        reason: 'cloudflare'
      });
    });
    const showNodeSeekVerification = jest.fn<void, [message?: string]>();
    const readGateway = {
      getCategories,
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let active = true;
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification,
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    await act(async () => hook.result.current.changeFeedSource('nodeseek'));
    await waitFor(() => expect(showNodeSeekVerification).toHaveBeenCalledTimes(1));
    showNodeSeekVerification.mockClear();

    active = false;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await act(async () => {
      sharedCategories.reject(new Error('共享分类读取失败'));
      await sharedCategories.promise.catch(() => undefined);
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(showNodeSeekVerification).not.toHaveBeenCalled();
  });

  it('keeps an unrelated source request and categories intact when another credential session changes', async () => {
    const v2exTopic = {
      source: 'v2ex' as const,
      id: 'v2ex-current',
      title: 'V2EX 当前请求',
      author: 'alice',
      url: 'https://www.v2ex.com/t/v2ex-current',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const v2exFeed = Promise.withResolvers<{
      items: (typeof v2exTopic)[];
      errors: Record<string, never>;
      hasMore: boolean;
      nextPage: null;
    }>();
    const getCategories = jest.fn(async ({ source }: { source: string }) => ({
      items: source === 'v2ex' ? [{ source: 'v2ex' as const, id: 'go', name: 'Go' }] : [],
      errors: {}
    }));
    const getFeed = jest.fn(async ({ source }: { source: string }) =>
      source === 'v2ex' ? v2exFeed.promise : { items: [], errors: {}, hasMore: false, nextPage: null }
    );
    const readGateway = {
      getCategories,
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway
      })
    );

    await act(async () => hook.result.current.changeFeedSource('v2ex'));
    await waitFor(() =>
      expect(getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'v2ex' }), expect.any(Object))
    );
    await waitFor(() =>
      expect(hook.result.current.categories).toContainEqual(expect.objectContaining({ source: 'v2ex', id: 'go' }))
    );

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
    });

    expect(hook.result.current.categories).toContainEqual(expect.objectContaining({ source: 'v2ex', id: 'go' }));
    expect(hook.result.current.feedBusy).toBe(true);

    await act(async () => {
      v2exFeed.resolve({ items: [v2exTopic], errors: {}, hasMore: false, nextPage: null });
      await v2exFeed.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([v2exTopic]));
  });

  it('reloads the active source and aggregate presentation after a credential session changes', async () => {
    const oldTopic = {
      source: 'nodeseek' as const,
      id: 'old',
      title: '旧账号主题',
      author: 'old-user',
      url: 'https://www.nodeseek.com/post-old-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const newTopic = { ...oldTopic, id: 'new', title: '新账号主题', author: 'new-user' };
    let nodeSeekReads = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async ({ source }: { source: string }) => {
        if (source !== 'nodeseek') {
          return { items: [], errors: {}, hasMore: false, nextPage: null };
        }
        nodeSeekReads += 1;
        return {
          items: [nodeSeekReads === 1 ? oldTopic : newTopic],
          errors: {},
          hasMore: false,
          nextPage: null
        };
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const notify = jest.fn();
    const readerData = createEmptyReaderData();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    let sessionEpochs = initialForumSessionEpochs;
    const hook = await renderHook(() =>
      useFeedRuntime({
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify,
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway
      })
    );

    await act(async () => hook.result.current.changeFeedSource('nodeseek'));
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([oldTopic]));

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
      hook.rerender({});
    });

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([newTopic]));
    expect(nodeSeekReads).toBe(2);
  });

  it('[REG-FEED-010] never exposes a warm private feed before this runtime confirms its source identity', async () => {
    const oldPrivateTopic = {
      source: 'nodeseek' as const,
      id: 'previous-runtime-private',
      title: '上次运行的私有主题',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-previous-runtime-private-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const safeTopic = {
      ...oldPrivateTopic,
      source: 'v2ex' as const,
      id: 'current-runtime-public',
      title: '本次运行的公开主题',
      url: 'https://www.v2ex.com/t/current-runtime-public'
    };
    const safeRead = Promise.withResolvers<{
      items: (typeof safeTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => safeRead.promise),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    appQueryClient.clear();
    appQueryClient.setQueryData(
      forumQueryKeys.feed({
        enabledSourcesKey: defaultEnabledSourcesKey,
        readPlanScope: aggregateReadPlanScope('feed'),
        scope: initialForumSessionEpochs,
        source: 'all'
      }),
      {
        pages: [
          {
            items: [oldPrivateTopic],
            errors: {},
            hasMore: false,
            nextPage: null,
            page: 1
          }
        ],
        pageParams: [{ page: 1 }]
      }
    );
    const renderedKeys: string[][] = [];
    const hook = await renderNativeHook(
      () => {
        const controller = useFeedRuntime({
          identityBarriers: sessionSources,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        });
        renderedKeys.push(controller.activeFeedState.items.map(topicKey));
        return controller;
      },
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(1));
    expect(renderedKeys.some((keys) => keys.includes(topicKey(oldPrivateTopic)))).toBe(false);

    await act(async () => {
      safeRead.resolve({ items: [safeTopic], errors: {}, hasMore: false, nextPage: null });
      await safeRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]));
  });

  it('[REG-PERF-006] discards target Feed caches and requests fresh data on every activation', async () => {
    const cachedTopic: Topic = {
      source: 'v2ex',
      id: 'cached-v2ex',
      title: '不应回显的 V2EX 缓存',
      author: 'alice',
      url: 'https://www.v2ex.com/t/cached-v2ex',
      createdAt: '2026-07-30T00:00:00.000Z',
      replyCount: 0
    };
    const cachedLatestTopic = { ...cachedTopic, id: 'cached-v2ex-latest', title: '不应保留的最新缓存' };
    const firstFreshTopic = { ...cachedTopic, id: 'fresh-v2ex-1', title: '第一次新请求' };
    const secondFreshTopic = { ...cachedTopic, id: 'fresh-v2ex-2', title: '第二次新请求' };
    const firstV2exRead = Promise.withResolvers<{
      items: Topic[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const secondV2exRead = Promise.withResolvers<{
      items: Topic[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let v2exReadCount = 0;
    const getFeed = jest.fn(async ({ source }: Parameters<ReadGateway['getFeed']>[0]) => {
      if (source === 'v2ex') {
        v2exReadCount += 1;
        return v2exReadCount === 1 ? firstV2exRead.promise : secondV2exRead.promise;
      }
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const cachedFeed = (items: Topic[]) => ({
      pages: [{ items, errors: {}, hasMore: false, nextPage: null, page: 1 }],
      pageParams: [{ page: 1 }]
    });
    const defaultV2exKey = forumQueryKeys.feed({
      feedFilter: 'all',
      readPlanScope: 'public:omit',
      scope: initialForumSessionEpochs,
      source: 'v2ex'
    });
    const latestV2exKey = forumQueryKeys.feed({
      feedFilter: 'latest',
      readPlanScope: 'public:omit',
      scope: initialForumSessionEpochs,
      source: 'v2ex'
    });
    const categoryV2exKey = forumQueryKeys.feed({
      category: 'qna',
      feedFilter: 'all',
      readPlanScope: 'public:omit',
      scope: initialForumSessionEpochs,
      source: 'v2ex'
    });
    appQueryClient.clear();
    appQueryClient.setQueryData(
      forumQueryKeys.feed({
        enabledSourcesKey: defaultEnabledSourcesKey,
        readPlanScope: aggregateReadPlanScope('feed'),
        scope: initialForumSessionEpochs,
        source: 'all'
      }),
      cachedFeed([])
    );
    appQueryClient.setQueryData(defaultV2exKey, cachedFeed([cachedTopic]));
    appQueryClient.setQueryData(latestV2exKey, cachedFeed([cachedLatestTopic]));
    appQueryClient.setQueryData(categoryV2exKey, cachedFeed([cachedLatestTopic]));
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderNativeHook(
      () =>
        useFeedRuntime({
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(getFeed).not.toHaveBeenCalled();

    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => expect(v2exReadCount).toBe(1));
    expect(hook.result.current.activeFeedState.items).toEqual([]);
    expect(appQueryClient.getQueryData(latestV2exKey)).toBeUndefined();
    expect(appQueryClient.getQueryData(categoryV2exKey)).toBeUndefined();

    await act(async () => {
      firstV2exRead.resolve({ items: [firstFreshTopic], errors: {}, hasMore: false, nextPage: null });
      await firstV2exRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstFreshTopic]));

    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    expect(v2exReadCount).toBe(1);
    expect(hook.result.current.activeFeedState.items).toEqual([firstFreshTopic]);

    await act(async () => {
      hook.result.current.changeFeedSource('nodeseek');
    });
    await waitFor(() => expect(hook.result.current.feedSource).toBe('nodeseek'));

    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => expect(v2exReadCount).toBe(2));
    expect(hook.result.current.activeFeedState.items).toEqual([]);

    await act(async () => {
      secondV2exRead.resolve({ items: [secondFreshTopic], errors: {}, hasMore: false, nextPage: null });
      await secondV2exRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([secondFreshTopic]));
  });

  it('[REG-PERF-006] exposes cached target categories before that source becomes active', async () => {
    const cachedTargetCategory: Category = {
      source: 'nodeseek',
      id: 'cached-target-category',
      name: '目标站缓存分类'
    };
    appQueryClient.clear();
    appQueryClient.setQueryData(
      forumQueryKeys.categories('nodeseek', initialForumSessionEpochs, undefined, 'authenticated:0'),
      {
        items: [cachedTargetCategory],
        errors: {}
      }
    );
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderNativeHook(
      () =>
        useFeedRuntime({
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    expect(hook.result.current.categories).toEqual([]);
    expect(
      (hook.result.current as typeof hook.result.current & { feedCategories?: Category[] }).feedCategories
    ).toEqual([cachedTargetCategory]);
  });

  it('[REG-PERF-003][REG-PERF-006] requests every selected source and keeps late results route-bound', async () => {
    const cachedTopic: Topic = {
      source: 'v2ex',
      id: 'cached-selected',
      title: '不得复用的温缓存目标',
      author: 'alice',
      url: 'https://www.v2ex.com/t/cached-selected',
      createdAt: '2026-07-30T00:00:00.000Z',
      replyCount: 0
    };
    const lateTopic: Topic = {
      ...cachedTopic,
      source: 'nodeseek',
      id: 'late-selected',
      title: '迟到的 NodeSeek 结果',
      url: 'https://www.nodeseek.com/post-late-selected-1'
    };
    const finalTopic: Topic = {
      ...cachedTopic,
      source: 'xiaoyinsi',
      id: 'final-selected',
      title: '最终小隐寺结果',
      url: 'https://xiaoyinsi.com/t/final-selected'
    };
    const lateRead = Promise.withResolvers<{
      items: Topic[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const finalRead = Promise.withResolvers<{
      items: Topic[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let v2exReadCount = 0;
    const getFeed = jest.fn(async ({ source }: Parameters<ReadGateway['getFeed']>[0]) => {
      if (source === 'v2ex') {
        v2exReadCount += 1;
        return {
          items: [{ ...cachedTopic, id: `fresh-v2ex-${v2exReadCount}`, title: `V2EX 新请求 ${v2exReadCount}` }],
          errors: {},
          hasMore: false,
          nextPage: null
        };
      }
      if (source === 'nodeseek') {
        return lateRead.promise;
      }
      if (source === 'xiaoyinsi') {
        return finalRead.promise;
      }
      throw new Error(`unexpected Feed request: ${source}`);
    });
    const cachedFeed = (items: Topic[]) => ({
      pages: [{ items, errors: {}, hasMore: false, nextPage: null, page: 1 }],
      pageParams: [{ page: 1 }]
    });
    appQueryClient.clear();
    appQueryClient.setQueryData(
      forumQueryKeys.feed({
        enabledSourcesKey: defaultEnabledSourcesKey,
        readPlanScope: aggregateReadPlanScope('feed'),
        scope: initialForumSessionEpochs,
        source: 'all'
      }),
      cachedFeed([])
    );
    appQueryClient.setQueryData(
      forumQueryKeys.feed({
        feedFilter: 'all',
        readPlanScope: 'public:omit',
        scope: initialForumSessionEpochs,
        source: 'v2ex'
      }),
      cachedFeed([cachedTopic])
    );
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderNativeHook(
      () =>
        useFeedRuntime({
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(getFeed).not.toHaveBeenCalled();

    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items[0]?.title).toBe('V2EX 新请求 1'));
    expect(getFeed).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.result.current.changeFeedSource('nodeseek');
    });
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2));
    expect(getFeed).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'nodeseek' }), expect.any(Object));

    await act(async () => {
      hook.result.current.changeFeedSource('xiaoyinsi');
    });
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(3));

    await act(async () => {
      lateRead.resolve({ items: [lateTopic], errors: {}, hasMore: false, nextPage: null });
      await lateRead.promise;
    });
    expect(hook.result.current.feedSource).toBe('xiaoyinsi');
    expect(hook.result.current.activeFeedState.items).not.toContainEqual(lateTopic);

    await act(async () => {
      finalRead.resolve({ items: [finalTopic], errors: {}, hasMore: false, nextPage: null });
      await finalRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([finalTopic]));

    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items[0]?.title).toBe('V2EX 新请求 2'));
    expect(getFeed).toHaveBeenCalledTimes(4);
  });

  it('[REG-SOURCE-011] isolates switched public Feed and category reads from authenticated caches', async () => {
    const oldPrivateTopic = {
      source: 'nodeseek' as const,
      id: 'previous-runtime-single-source',
      title: '上次运行的单站私有主题',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-previous-runtime-single-source-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const getFeed = jest.fn(
      async (_options: Parameters<ReadGateway['getFeed']>[0], _context?: Parameters<ReadGateway['getFeed']>[1]) => ({
        items: [],
        errors: {},
        hasMore: false,
        nextPage: null
      })
    );
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    appQueryClient.clear();
    appQueryClient.setQueryData(
      forumQueryKeys.feed({
        feedFilter: 'postTime',
        readPlanScope: 'authenticated:0',
        scope: initialForumSessionEpochs,
        source: 'nodeseek'
      }),
      {
        pages: [
          {
            items: [oldPrivateTopic],
            errors: {},
            hasMore: false,
            nextPage: null,
            page: 1
          }
        ],
        pageParams: [{ page: 1 }]
      }
    );
    appQueryClient.setQueryData(
      forumQueryKeys.categories('nodeseek', initialForumSessionEpochs, undefined, 'authenticated:0'),
      {
        items: [{ source: 'nodeseek', id: 'private', name: '上次运行的私有分类' }],
        errors: {}
      }
    );
    let identityBarriers: SessionSource[] = ['nodeseek'];
    const hook = await renderNativeHook(
      () =>
        useFeedRuntime({
          identityBarriers,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await act(async () => hook.result.current.changeFeedSource('nodeseek'));

    expect(hook.result.current.activeFeedState.items).toEqual([]);
    expect(hook.result.current.categories).toEqual([]);
    expect(hook.result.current.feedCategories).toEqual([]);
    expect(getFeed.mock.calls.some(([request]) => request.source === 'nodeseek')).toBe(true);
    expect(getFeed.mock.calls.at(-1)?.[1]).toMatchObject({ readPlanScope: 'public:omit' });

    await act(async () => hook.rerender({}));

    expect(hook.result.current.activeFeedState.items).toEqual([]);
    expect(hook.result.current.categories).toEqual([]);
    expect(hook.result.current.feedCategories).toEqual([]);

    identityBarriers = [];
    await act(async () => hook.rerender({}));

    await waitFor(() =>
      expect(getFeed.mock.calls.filter(([request]) => request.source === 'nodeseek')).toHaveLength(2)
    );
    expect(getFeed.mock.calls.at(-1)?.[1]).toMatchObject({ readPlanScope: 'authenticated:0' });
    expect(hook.result.current.activeFeedState.items).toEqual([]);
  });

  it('[REG-SOURCE-011] does not project an authenticated error into a pending public Feed', async () => {
    const sourceFeedKey = forumQueryKeys.feed({
      feedFilter: 'postTime',
      readPlanScope: 'authenticated:0',
      scope: initialForumSessionEpochs,
      source: 'nodeseek'
    });
    const staleError = Object.assign(new Error('上次运行的验证错误'), {
      kind: 'verification-required' as const,
      source: 'nodeseek' as const,
      verificationRequired: true
    });
    appQueryClient.clear();
    await appQueryClient
      .fetchInfiniteQuery({
        queryKey: sourceFeedKey,
        initialPageParam: { page: 1 },
        queryFn: async () => {
          throw staleError;
        }
      })
      .catch(() => undefined);
    await appQueryClient
      .fetchQuery({
        queryKey: forumQueryKeys.categories('nodeseek', initialForumSessionEpochs, undefined, 'authenticated:0'),
        queryFn: async () => {
          throw staleError;
        }
      })
      .catch(() => undefined);
    const notify = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderNativeHook(
      () =>
        useFeedRuntime({
          identityBarriers: ['nodeseek'],
          linuxDoVerificationActive: false,
          notify,
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification,
          showYaohuoLogin: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await act(async () => {
      hook.result.current.changeFeedSource('nodeseek');
      await Promise.resolve();
    });

    await waitFor(() => expect(hook.result.current.feedBusy).toBe(false));
    expect(hook.result.current.feedOutcomeKind).toBe('empty');
    expect(notify).not.toHaveBeenCalled();
    expect(showNodeSeekVerification).not.toHaveBeenCalled();
  });

  it('[REG-SOURCE-011] aborts an in-flight aggregate plan before a narrower plan takes ownership', async () => {
    const safeTopic = {
      source: 'v2ex' as const,
      id: 'in-flight-bootstrap-safe',
      title: '启动中的公开主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/in-flight-bootstrap-safe',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const safeRead = Promise.withResolvers<{
      items: (typeof safeTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const nextRead = Promise.withResolvers<{
      items: (typeof safeTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const firstAbort = jest.fn();
    let feedReadCount = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async ({ signal }: { signal?: AbortSignal }) => {
        feedReadCount += 1;
        if (feedReadCount === 1) {
          signal?.addEventListener('abort', firstAbort, { once: true });
          return safeRead.promise;
        }
        return nextRead.promise;
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let identityBarriers: SessionSource[] = ['nodeseek', 'linuxdo'];
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(1));

    identityBarriers = ['linuxdo'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(firstAbort).toHaveBeenCalledTimes(1);
    expect(readGateway.getFeed).toHaveBeenCalledTimes(2);

    await act(async () => {
      safeRead.resolve({ items: [safeTopic], errors: {}, hasMore: false, nextPage: null });
      await safeRead.promise;
    });
    expect(hook.result.current.activeFeedState.items).toEqual([]);

    await act(async () => {
      nextRead.resolve({ items: [safeTopic], errors: {}, hasMore: false, nextPage: null });
      await nextRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]));
  });

  it('[REG-FEED-010] does not roll back to older warm aggregate lists when the last startup barrier clears', async () => {
    const oldSafeTopic = {
      source: 'v2ex' as const,
      id: 'warm-safe-old',
      title: '上次运行的公开主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/warm-safe-old',
      createdAt: '2026-07-19T00:00:00.000Z',
      replyCount: 0
    };
    const safeTopic = {
      ...oldSafeTopic,
      id: 'bootstrap-safe-new',
      title: '本次启动的公开主题',
      url: 'https://www.v2ex.com/t/bootstrap-safe-new'
    };
    const fullTopic = {
      ...safeTopic,
      source: 'nodeseek' as const,
      id: 'bootstrap-full-new',
      title: '身份确认后的完整主题',
      url: 'https://www.nodeseek.com/post-bootstrap-full-new-1'
    };
    const oldSafeCategory = { source: 'v2ex' as const, id: 'warm-category-old', name: '上次运行的公开分类' };
    const safeCategory = { source: 'v2ex' as const, id: 'bootstrap-category-new', name: '本次启动的公开分类' };
    const fullCategory = { source: 'nodeseek' as const, id: 'bootstrap-category-full', name: '身份确认后的完整分类' };
    const fullRead = Promise.withResolvers<{
      items: (typeof fullTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const fullCategoriesRead = Promise.withResolvers<{
      items: (typeof safeCategory | typeof fullCategory)[];
      errors: Record<string, never>;
    }>();
    let feedReadCount = 0;
    let categoryReadCount = 0;
    const readGateway = {
      getCategories: jest.fn(async () => {
        categoryReadCount += 1;
        return categoryReadCount === 1 ? { items: [safeCategory], errors: {} } : fullCategoriesRead.promise;
      }),
      getFeed: jest.fn(async () => {
        feedReadCount += 1;
        return feedReadCount === 1
          ? { items: [safeTopic], errors: {}, hasMore: false as const, nextPage: null }
          : fullRead.promise;
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    appQueryClient.clear();
    appQueryClient.setQueryData(
      forumQueryKeys.feed({
        enabledSourcesKey: defaultEnabledSourcesKey,
        readPlanScope: aggregateReadPlanScope('feed'),
        scope: initialForumSessionEpochs,
        source: 'all'
      }),
      {
        pages: [
          {
            items: [oldSafeTopic],
            errors: {},
            hasMore: false,
            nextPage: null,
            page: 1
          }
        ],
        pageParams: [{ page: 1 }]
      }
    );
    appQueryClient.setQueryData(
      forumQueryKeys.categories(
        'all',
        initialForumSessionEpochs,
        defaultEnabledSourcesKey,
        aggregateReadPlanScope('categories')
      ),
      {
        items: [oldSafeCategory],
        errors: {}
      }
    );
    let identityBarriers: SessionSource[] = ['nodeseek'];
    let sessionEpochs = initialForumSessionEpochs;
    const renderedKeys: string[][] = [];
    const hook = await renderNativeHook(
      () => {
        const controller = useFeedRuntime({
          identityBarriers,
          sessionEpochs,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        });
        renderedKeys.push(controller.activeFeedState.items.map(topicKey));
        return controller;
      },
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]));
    await waitFor(() => expect(hook.result.current.categories).toEqual([safeCategory]));
    const firstSafeFrame = renderedKeys.length - 1;

    identityBarriers = [];
    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readGateway.getCategories).toHaveBeenCalledTimes(2));
    expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]);
    expect(hook.result.current.categories).toEqual([safeCategory]);
    expect(renderedKeys.slice(firstSafeFrame)).not.toContainEqual([topicKey(oldSafeTopic)]);

    await act(async () => {
      fullRead.resolve({ items: [fullTopic], errors: {}, hasMore: false, nextPage: null });
      fullCategoriesRead.resolve({ items: [safeCategory, fullCategory], errors: {} });
      await Promise.all([fullRead.promise, fullCategoriesRead.promise]);
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([fullTopic]));
    await waitFor(() => expect(hook.result.current.categories).toEqual([safeCategory, fullCategory]));
  });

  it('[REG-FEED-010] keeps the safe list and disables old pagination when the last startup barrier clears', async () => {
    const safeTopic = {
      source: 'v2ex' as const,
      id: 'bootstrap-safe',
      title: '启动期公开主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/bootstrap-safe',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const fullTopic = {
      ...safeTopic,
      source: 'nodeseek' as const,
      id: 'bootstrap-complete',
      title: '身份确认后的主题',
      url: 'https://www.nodeseek.com/post-bootstrap-complete-1'
    };
    const fullRead = Promise.withResolvers<{
      items: (typeof fullTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let readCount = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => {
        readCount += 1;
        return readCount === 1
          ? { items: [safeTopic], errors: {}, hasMore: true as const, nextPage: 2 }
          : fullRead.promise;
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let identityBarriers: SessionSource[] = ['nodeseek'];
    const renderedKeys: string[][] = [];
    const hook = await renderHook(() => {
      const controller = useFeedRuntime({
        identityBarriers,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      });
      renderedKeys.push(controller.activeFeedState.items.map(topicKey));
      return controller;
    });

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]));
    identityBarriers = [];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(2));

    expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]);
    expect(hook.result.current.feedBusy).toBe(false);
    expect(hook.result.current.activeFeedState.hasMore).toBe(false);
    await expect(hook.result.current.loadFeed()).resolves.toBe('stale');
    expect(readGateway.getFeed).toHaveBeenCalledTimes(2);
    const firstSafeFrame = renderedKeys.findIndex((keys) => keys.includes(topicKey(safeTopic)));
    expect(renderedKeys.slice(firstSafeFrame)).not.toContainEqual([]);

    await act(async () => {
      fullRead.resolve({ items: [fullTopic], errors: {}, hasMore: false, nextPage: null });
      await fullRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([fullTopic]));
  });

  it('[REG-FEED-010] returns to Loading when an identity transition has no safe topic to retain', async () => {
    const fullRead = Promise.withResolvers<{
      items: never[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let readCount = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => {
        readCount += 1;
        return readCount === 1 ? { items: [], errors: {}, hasMore: false as const, nextPage: null } : fullRead.promise;
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let identityBarriers: SessionSource[] = ['nodeseek'];
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() => expect(hook.result.current.feedBusy).toBe(false));
    identityBarriers = [];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(2));
    expect(hook.result.current.feedBusy).toBe(true);

    await act(async () => {
      fullRead.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
      await fullRead.promise;
    });
  });

  it('[REG-SOURCE-011] keeps only cache-safe aggregate categories across plan and epoch changes', async () => {
    const safeCategory = { source: 'v2ex' as const, id: 'v2ex', name: 'V2EX' };
    const privateCategory = { source: 'nodeseek' as const, id: 'nodeseek', name: 'NodeSeek' };
    const unchangedCategory = { source: 'linuxdo' as const, id: 'linuxdo', name: 'linux.do' };
    const fullRead = Promise.withResolvers<{
      items: (typeof safeCategory | typeof privateCategory | typeof unchangedCategory)[];
      errors: Record<string, never>;
    }>();
    const pendingRead = Promise.withResolvers<{
      items: (typeof safeCategory)[];
      errors: Record<string, never>;
    }>();
    const changedEpochRead = Promise.withResolvers<{
      items: (typeof safeCategory)[];
      errors: Record<string, never>;
    }>();
    let categoryReadCount = 0;
    const readGateway = {
      getCategories: jest.fn(async () => {
        categoryReadCount += 1;
        if (categoryReadCount === 1) {
          return { items: [safeCategory], errors: {} };
        }
        if (categoryReadCount === 2) {
          return fullRead.promise;
        }
        return categoryReadCount === 3 ? pendingRead.promise : changedEpochRead.promise;
      }),
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let identityBarriers: SessionSource[] = ['nodeseek'];
    let sessionEpochs = initialForumSessionEpochs;
    const renderedCategoryKeys: string[][] = [];
    const hook = await renderHook(() => {
      const controller = useFeedRuntime({
        identityBarriers,
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      });
      renderedCategoryKeys.push(controller.categories.map((category) => `${category.source}:${category.id}`));
      return controller;
    });

    await waitFor(() => expect(hook.result.current.categories).toEqual([safeCategory]));
    identityBarriers = [];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getCategories).toHaveBeenCalledTimes(2));
    expect(hook.result.current.categories).toEqual([safeCategory]);

    await act(async () => {
      fullRead.resolve({ items: [safeCategory, privateCategory, unchangedCategory], errors: {} });
      await fullRead.promise;
    });
    await waitFor(() =>
      expect(hook.result.current.categories).toEqual([safeCategory, privateCategory, unchangedCategory])
    );

    identityBarriers = ['nodeseek', 'linuxdo'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getCategories).toHaveBeenCalledTimes(3));
    expect(hook.result.current.categories).toEqual([safeCategory]);

    await act(async () => {
      pendingRead.resolve({ items: [safeCategory], errors: {} });
      await pendingRead.promise;
    });
    await waitFor(() => expect(hook.result.current.categories).toEqual([safeCategory]));

    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    identityBarriers = ['linuxdo'];
    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getCategories).toHaveBeenCalledTimes(4));
    expect(hook.result.current.categories).toEqual([safeCategory]);
    const firstSafeFrame = renderedCategoryKeys.findIndex((keys) => keys.includes('v2ex:v2ex'));
    expect(renderedCategoryKeys.slice(firstSafeFrame)).not.toContainEqual([]);

    await act(async () => {
      changedEpochRead.resolve({ items: [safeCategory], errors: {} });
      await changedEpochRead.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      hook.rerender({});
      await Promise.resolve();
    });
    expect(hook.result.current.categories).toEqual([safeCategory]);
  });

  it('[REG-SOURCE-011] removes the aggregate category cache on a direct source epoch change', async () => {
    const changedCategory = { source: 'nodeseek' as const, id: 'direct-private', name: '旧账号分类' };
    const safeCategory = { source: 'v2ex' as const, id: 'direct-safe', name: 'V2EX 分类' };
    const unchangedCategory = { source: 'linuxdo' as const, id: 'direct-unchanged', name: 'linux.do 分类' };
    const changedEpochRead = Promise.withResolvers<{
      items: (typeof safeCategory)[];
      errors: Record<string, never>;
    }>();
    let changedEpoch = false;
    let sessionEpochs = initialForumSessionEpochs;
    const getCategories = jest.fn(async () =>
      changedEpoch
        ? changedEpochRead.promise
        : { items: [changedCategory, safeCategory, unchangedCategory], errors: {} }
    );
    const readGateway = {
      getCategories,
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderHook(() =>
      useFeedRuntime({
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() =>
      expect(hook.result.current.categories).toEqual([changedCategory, safeCategory, unchangedCategory])
    );

    changedEpoch = true;
    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(getCategories).toHaveBeenCalledTimes(2));
    expect(hook.result.current.categories).toEqual([safeCategory, unchangedCategory]);

    await act(async () => {
      changedEpochRead.resolve({ items: [safeCategory], errors: {} });
      await changedEpochRead.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      hook.rerender({});
      await Promise.resolve();
    });
    expect(hook.result.current.categories).toEqual([safeCategory]);
  });

  it('[REG-ACCOUNT-031][REG-SOURCE-011] removes old-plan aggregate data across an epoch change', async () => {
    const oldTopic = {
      source: 'nodeseek' as const,
      id: 'old-account',
      title: '旧账号聚合主题',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-old-account-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const newTopic = {
      ...oldTopic,
      source: 'v2ex' as const,
      id: 'new-epoch',
      title: '新世代公开主题',
      url: 'https://www.v2ex.com/t/new-epoch'
    };
    const dirtyPublicTopic = {
      ...newTopic,
      id: 'dirty-public',
      title: '待对账期间刷新的公开主题',
      url: 'https://www.v2ex.com/t/dirty-public'
    };
    const unchangedManagedTopic = {
      ...newTopic,
      source: 'linuxdo' as const,
      id: 'unchanged-managed',
      title: '未变化来源主题',
      url: 'https://linux.do/t/unchanged-managed'
    };
    const dirtyRead = Promise.withResolvers<{
      items: (typeof oldTopic | typeof dirtyPublicTopic | typeof unchangedManagedTopic)[];
      errors: SourceErrors;
      hasMore: false;
      nextPage: null;
    }>();
    const newEpochRead = Promise.withResolvers<{
      items: (typeof newTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let readCount = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => {
        readCount += 1;
        if (readCount === 1) {
          return { items: [oldTopic], errors: {}, hasMore: false, nextPage: null };
        }
        return readCount === 2 ? dirtyRead.promise : newEpochRead.promise;
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    let identityBarriers: SessionSource[] = [];
    let sessionEpochs = initialForumSessionEpochs;
    const notify = jest.fn();
    const hook = await renderHook(() => {
      const controller = useFeedRuntime({
        identityBarriers,
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify,
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      });
      return controller;
    });

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([oldTopic]));

    identityBarriers = ['nodeseek'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(2));
    expect(hook.result.current.activeFeedState.items).toEqual([]);

    await act(async () => {
      dirtyRead.resolve({
        items: [dirtyPublicTopic, unchangedManagedTopic],
        errors: {
          nodeseek: { kind: 'ordinary', message: 'removed-source-error' },
          linuxdo: { kind: 'ordinary', message: 'retained-source-error' }
        },
        hasMore: false,
        nextPage: null
      });
      await dirtyRead.promise;
    });
    await waitFor(() => {
      expect(hook.result.current.activeFeedState.items).toEqual([dirtyPublicTopic, unchangedManagedTopic]);
    });
    notify.mockClear();

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
      identityBarriers = [];
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(3));
    expect(hook.result.current.activeFeedState.items).toEqual([dirtyPublicTopic, unchangedManagedTopic]);
    await waitFor(() => expect(notify).toHaveBeenCalled());
    const transitionMessages = notify.mock.calls.flat().join(' ');
    expect(transitionMessages).toContain('retained-source-error');
    expect(transitionMessages).not.toContain('removed-source-error');

    await act(async () => {
      newEpochRead.resolve({ items: [newTopic], errors: {}, hasMore: false, nextPage: null });
      await newEpochRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([newTopic]));
  });

  it('[REG-SOURCE-011] keeps public aggregate pages while dropping a changed private source', async () => {
    const changedTopic = {
      source: 'nodeseek' as const,
      id: 'direct-epoch-private',
      title: '旧账号主题',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-direct-epoch-private-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const firstSafeTopic = {
      ...changedTopic,
      source: 'v2ex' as const,
      id: 'direct-epoch-safe-first',
      title: '第一页公开主题',
      url: 'https://www.v2ex.com/t/direct-epoch-safe-first'
    };
    const secondSafeTopic = {
      ...firstSafeTopic,
      id: 'direct-epoch-safe-second',
      title: '第二页公开主题',
      url: 'https://www.v2ex.com/t/direct-epoch-safe-second'
    };
    const newEpochFirstRead = Promise.withResolvers<{
      items: (typeof firstSafeTopic)[];
      errors: Record<string, never>;
      hasMore: true;
      nextCursor: string;
      nextPage: 2;
    }>();
    const newEpochSecondRead = Promise.withResolvers<{
      items: (typeof secondSafeTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const canceledRefreshRead = Promise.withResolvers<{
      items: (typeof firstSafeTopic)[];
      errors: Record<string, never>;
      hasMore: true;
      nextCursor: string;
      nextPage: 2;
    }>();
    let phase: 'initial' | 'changed-epoch' = 'initial';
    let changedEpochFirstPageReads = 0;
    let sessionEpochs = initialForumSessionEpochs;
    let active = true;
    const canceledRefreshSignals: AbortSignal[] = [];
    const getFeed = jest.fn(async ({ page = 1, signal }: { page?: number; cursor?: string; signal: AbortSignal }) => {
      if (phase === 'initial') {
        return page === 1
          ? {
              items: [changedTopic, firstSafeTopic],
              errors: {},
              hasMore: true as const,
              nextCursor: 'direct-old-cursor',
              nextPage: 2 as const
            }
          : { items: [secondSafeTopic], errors: {}, hasMore: false as const, nextPage: null };
      }
      if (page !== 1) {
        return newEpochSecondRead.promise;
      }
      changedEpochFirstPageReads += 1;
      if (changedEpochFirstPageReads === 2) {
        canceledRefreshSignals.push(signal);
        return canceledRefreshRead.promise;
      }
      if (changedEpochFirstPageReads === 3) {
        throw new Error('manual refresh failed');
      }
      return newEpochFirstRead.promise;
    });
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const notify = jest.fn();
    let settleCanceledRefreshInLayout = false;
    const hook = await renderHook(() => {
      const controller = useFeedRuntime({
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify,
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      });
      useLayoutEffect(() => {
        if (!settleCanceledRefreshInLayout || active) {
          return;
        }
        settleCanceledRefreshInLayout = false;
        canceledRefreshRead.resolve({
          items: [firstSafeTopic],
          errors: {},
          hasMore: true,
          nextCursor: 'direct-new-cursor',
          nextPage: 2
        });
      }, [active]);
      return controller;
    });

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([changedTopic, firstSafeTopic]));
    await act(async () => {
      await hook.result.current.loadFeed();
    });
    await waitFor(() =>
      expect(hook.result.current.activeFeedState.items).toEqual([changedTopic, firstSafeTopic, secondSafeTopic])
    );

    phase = 'changed-epoch';
    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    const changedEpochCallStart = getFeed.mock.calls.length;
    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(getFeed.mock.calls.length).toBeGreaterThan(changedEpochCallStart));
    expect(hook.result.current.activeFeedState.items).toEqual([firstSafeTopic, secondSafeTopic]);

    await act(async () => {
      newEpochFirstRead.resolve({
        items: [firstSafeTopic],
        errors: {},
        hasMore: true,
        nextCursor: 'direct-new-cursor',
        nextPage: 2
      });
      await newEpochFirstRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.hasMore).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      hook.rerender({});
      await Promise.resolve();
    });
    expect(hook.result.current.activeFeedState.items).toEqual([firstSafeTopic]);

    notify.mockClear();
    let canceledRefresh: Promise<void> | undefined;
    await act(async () => {
      canceledRefresh = hook.result.current.refreshFeed();
      await Promise.resolve();
    });
    await waitFor(() => expect(canceledRefreshSignals).toHaveLength(1));
    settleCanceledRefreshInLayout = true;
    active = false;
    await hook.rerender({});
    await act(async () => {
      await canceledRefreshRead.promise;
      await canceledRefresh;
    });
    expect(notify).not.toHaveBeenCalledWith('列表已更新');
    active = true;
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    expect(hook.result.current.activeFeedState.items).toEqual([firstSafeTopic]);

    await act(async () => {
      await hook.result.current.refreshFeed();
    });
    expect(hook.result.current.activeFeedState.items).toEqual([firstSafeTopic]);
    await act(async () => {
      await hook.result.current.refreshFeed();
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstSafeTopic]));

    let loadMore: Promise<unknown> | undefined;
    await act(async () => {
      loadMore = hook.result.current.loadFeed();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(getFeed.mock.calls.slice(changedEpochCallStart)).toContainEqual([
        expect.objectContaining({ cursor: 'direct-new-cursor', page: 2 }),
        expect.any(Object)
      ])
    );
    expect(
      getFeed.mock.calls.slice(changedEpochCallStart).some(([request]) => request.cursor === 'direct-old-cursor')
    ).toBe(false);
    await act(async () => {
      newEpochSecondRead.resolve({
        items: [secondSafeTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
      await newEpochSecondRead.promise;
      await loadMore;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstSafeTopic, secondSafeTopic]));
  });

  it('[REG-SOURCE-011] removes authenticated aggregate pages when sources enter public plans', async () => {
    const changedTopic = {
      source: 'nodeseek' as const,
      id: 'changed-pending-source',
      title: '即将换号的来源',
      author: 'alice',
      url: 'https://www.nodeseek.com/post-changed-pending-source-1',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const retainedTopic = {
      ...changedTopic,
      source: 'linuxdo' as const,
      id: 'retained-pending-source',
      title: '仍在对账的未变化来源',
      url: 'https://linux.do/t/retained-pending-source'
    };
    const safeTopic = {
      ...changedTopic,
      source: 'v2ex' as const,
      id: 'safe-source',
      title: '安全来源',
      url: 'https://www.v2ex.com/t/safe-source'
    };
    const secondSafeTopic = {
      ...safeTopic,
      id: 'safe-source-page-two',
      title: '第二页安全来源',
      url: 'https://www.v2ex.com/t/safe-source-page-two'
    };
    const barrierRead = Promise.withResolvers<{
      items: (typeof safeTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const changedEpochFirstRead = Promise.withResolvers<{
      items: (typeof safeTopic)[];
      errors: Record<string, never>;
      hasMore: true;
      nextCursor: string;
      nextPage: 2;
    }>();
    const changedEpochSecondRead = Promise.withResolvers<{
      items: (typeof secondSafeTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let phase: 'initial' | 'barrier' | 'changed-epoch' = 'initial';
    let identityBarriers: SessionSource[] = [];
    let sessionEpochs = initialForumSessionEpochs;
    const getFeed = jest.fn(async ({ page = 1 }: { page?: number; cursor?: string }) => {
      if (phase === 'initial') {
        return page === 1
          ? {
              items: [changedTopic, retainedTopic, safeTopic],
              errors: {},
              hasMore: true as const,
              nextCursor: 'old-account-cursor',
              nextPage: 2 as const
            }
          : { items: [secondSafeTopic], errors: {}, hasMore: false as const, nextPage: null };
      }
      if (phase === 'barrier') {
        return barrierRead.promise;
      }
      return page === 1 ? changedEpochFirstRead.promise : changedEpochSecondRead.promise;
    });
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers,
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await waitFor(() =>
      expect(hook.result.current.activeFeedState.items).toEqual([changedTopic, retainedTopic, safeTopic])
    );
    await act(async () => {
      await hook.result.current.loadFeed();
    });
    await waitFor(() =>
      expect(hook.result.current.activeFeedState.items).toEqual([
        changedTopic,
        retainedTopic,
        safeTopic,
        secondSafeTopic
      ])
    );

    phase = 'barrier';
    identityBarriers = ['nodeseek', 'linuxdo'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(3));
    await act(async () => {
      barrierRead.resolve({ items: [safeTopic], errors: {}, hasMore: false, nextPage: null });
      await barrierRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]));

    phase = 'changed-epoch';
    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    identityBarriers = ['linuxdo'];
    const changedEpochCallStart = getFeed.mock.calls.length;
    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(getFeed.mock.calls.length).toBeGreaterThan(changedEpochCallStart));
    expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]);

    await act(async () => {
      changedEpochFirstRead.resolve({
        items: [safeTopic],
        errors: {},
        hasMore: true,
        nextCursor: 'new-account-cursor',
        nextPage: 2
      });
      await changedEpochFirstRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.hasMore).toBe(true));
    let changedEpochLoad: Promise<unknown> | undefined;
    await act(async () => {
      changedEpochLoad = hook.result.current.loadFeed();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(getFeed.mock.calls.slice(changedEpochCallStart)).toContainEqual([
        expect.objectContaining({ cursor: 'new-account-cursor', page: 2 }),
        expect.any(Object)
      ])
    );
    expect(
      getFeed.mock.calls.slice(changedEpochCallStart).some(([request]) => request.cursor === 'old-account-cursor')
    ).toBe(false);
    expect(hook.result.current.activeFeedState.items).toEqual([safeTopic]);

    await act(async () => {
      changedEpochSecondRead.resolve({
        items: [secondSafeTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
      await changedEpochSecondRead.promise;
      await changedEpochLoad;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([safeTopic, secondSafeTopic]));
  });

  it('[REG-SOURCE-011] keeps only public aggregate pages while an authenticated plan is unavailable', async () => {
    const firstPage = [
      {
        source: 'nodeseek' as const,
        id: 'barrier-private-first',
        title: '第一页先出现的待对账主题',
        author: 'bob',
        url: 'https://www.nodeseek.com/post-barrier-private-first-1',
        createdAt: '2026-07-19T00:00:00.000Z',
        lastReplyAt: '2026-07-19T00:00:00.000Z',
        replyCount: 0
      },
      {
        source: 'v2ex' as const,
        id: 'barrier-public-second',
        title: '第一页公开主题',
        author: 'alice',
        url: 'https://www.v2ex.com/t/barrier-public-second',
        createdAt: '2026-07-20T00:00:00.000Z',
        lastReplyAt: '2026-07-20T00:00:00.000Z',
        replyCount: 0
      }
    ];
    const secondPageTopic = {
      source: 'nodeseek' as const,
      id: 'barrier-private-third',
      title: '第二页高活跃待对账主题',
      author: 'carol',
      url: 'https://www.nodeseek.com/post-barrier-private-third-1',
      createdAt: '2026-07-18T00:00:00.000Z',
      lastReplyAt: '2026-07-27T00:00:00.000Z',
      replyCount: 0
    };
    const secondPageSafeTopic = {
      ...secondPageTopic,
      source: 'v2ex' as const,
      id: 'barrier-public-third',
      title: '第二页公开主题',
      url: 'https://www.v2ex.com/t/barrier-public-third'
    };
    const barrierRead = Promise.withResolvers<{
      items: (typeof firstPage)[number][];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const releaseFirstRead = Promise.withResolvers<{
      items: (typeof firstPage)[number][];
      errors: Record<string, never>;
      hasMore: true;
      nextPage: 2;
    }>();
    const releaseSecondRead = Promise.withResolvers<{
      items: (typeof secondPageSafeTopic | typeof secondPageTopic)[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let identityBarriers: SessionSource[] = [];
    let sessionEpochs = initialForumSessionEpochs;
    let barrierCycleStarted = false;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async ({ page = 1 }: { page?: number }) => {
        if (identityBarriers.length) {
          barrierCycleStarted = true;
          return barrierRead.promise;
        }
        if (barrierCycleStarted) {
          return page === 1 ? releaseFirstRead.promise : releaseSecondRead.promise;
        }
        return page === 1
          ? { items: firstPage, errors: {}, hasMore: true, nextPage: 2 }
          : { items: [secondPageSafeTopic, secondPageTopic], errors: {}, hasMore: false, nextPage: null };
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers,
        sessionEpochs,
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    const loadedKeys = [...firstPage, secondPageSafeTopic, secondPageTopic].map(topicKey);

    await waitFor(() =>
      expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual(firstPage.map(topicKey))
    );
    await act(async () => {
      await hook.result.current.loadFeed();
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual(loadedKeys));
    identityBarriers = ['nodeseek'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(3));
    expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual(
      [firstPage[1], secondPageSafeTopic].map(topicKey)
    );

    await act(async () => {
      barrierRead.resolve({ items: [firstPage[1]], errors: {}, hasMore: false, nextPage: null });
      await barrierRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.refreshing).toBe(false));
    await waitFor(() =>
      expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual([topicKey(firstPage[1])])
    );

    identityBarriers = [];
    sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(4));
    expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual([topicKey(firstPage[1])]);

    await act(async () => {
      releaseFirstRead.resolve({
        items: firstPage,
        errors: {},
        hasMore: true,
        nextPage: 2
      });
      await releaseFirstRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.hasMore).toBe(true));
    let releasedLoad: Promise<unknown> | undefined;
    await act(async () => {
      releasedLoad = hook.result.current.loadFeed();
      await Promise.resolve();
    });
    await waitFor(() => expect(readGateway.getFeed).toHaveBeenCalledTimes(5));
    expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual(firstPage.map(topicKey));

    await act(async () => {
      releaseSecondRead.resolve({
        items: [secondPageSafeTopic, secondPageTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
      await releaseSecondRead.promise;
      await releasedLoad;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual(loadedKeys));
  });

  it('[REG-SOURCE-011] keeps a pending public single-source Feed available', async () => {
    const getFeed = jest.fn(
      async (_options: Parameters<ReadGateway['getFeed']>[0], _context?: Parameters<ReadGateway['getFeed']>[1]) => ({
        items: [],
        errors: {},
        hasMore: false,
        nextPage: null
      })
    );
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const hook = await renderHook(() =>
      useFeedRuntime({
        identityBarriers: ['nodeseek'],
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification: jest.fn(),
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );
    await waitFor(() =>
      expect(getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'all' }), expect.any(Object))
    );

    await act(async () => {
      hook.result.current.changeFeedSource('nodeseek');
      await Promise.resolve();
    });
    await act(async () => {
      await hook.result.current.refreshFeed();
    });

    expect(getFeed.mock.calls.some(([request]) => request.source === 'nodeseek')).toBe(true);
    expect(getFeed.mock.calls.at(-1)?.[1]).toMatchObject({ readPlanScope: 'public:omit' });
    await waitFor(() => expect(hook.result.current.feedBusy).toBe(false));
    expect(hook.result.current.feedBusy).toBe(false);
    expect(hook.result.current.feedOutcomeKind).toBe('empty');
  });

  it('REG-LINUXDO-002 preserves the loaded feed page across session reset before resuming pagination', async () => {
    const firstTopic = {
      source: 'linuxdo' as const,
      id: 'first',
      title: '第一页主题',
      author: 'alice',
      url: 'https://linux.do/t/first',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const secondTopic = {
      ...firstTopic,
      id: 'second',
      title: '第二页主题',
      url: 'https://linux.do/t/second'
    };
    let pageTwoAttempts = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async ({ source, page = 1 }: { source: string; page?: number }) => {
        if (source !== 'linuxdo') {
          return { items: [], errors: {}, hasMore: false, nextPage: null };
        }
        if (page === 1) {
          return { items: [firstTopic], errors: {}, hasMore: true, nextPage: 2, nextCursor: 'page-2' };
        }
        pageTwoAttempts += 1;
        return pageTwoAttempts === 1
          ? {
              items: [],
              errors: {
                linuxdo: {
                  kind: 'verification-required' as const,
                  message: 'linux.do 需要验证',
                  verificationRequired: true
                }
              },
              hasMore: false,
              nextPage: null
            }
          : { items: [secondTopic], errors: {}, hasMore: false, nextPage: null };
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway
      })
    );

    await act(async () => hook.result.current.changeFeedSource('linuxdo'));
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));
    await act(async () => {
      await hook.result.current.loadFeed();
    });

    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    expect(recovery).toBeDefined();
    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient, recovery.queryKey);
    });

    expect(hook.result.current.activeFeedState).toMatchObject({
      items: [firstTopic],
      hasMore: true,
      nextCursor: 'page-2',
      loadingMore: false
    });

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(pageTwoAttempts).toBe(2);
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic, secondTopic]));
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-LINUXDO-003 reports an ordinary feed recovery failure instead of another verification result', async () => {
    let linuxAttempts = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async ({ source }: { source: string }) => {
        if (source !== 'linuxdo') {
          return { items: [], errors: {}, hasMore: false, nextPage: null };
        }
        linuxAttempts += 1;
        if (linuxAttempts <= 2) {
          return {
            items: [],
            errors: {
              linuxdo: {
                kind: 'verification-required' as const,
                message: 'linux.do 需要验证',
                verificationRequired: true
              }
            },
            hasMore: false,
            nextPage: null
          };
        }
        throw new Error('恢复后网络失败');
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const showLinuxDoVerification = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await act(async () => hook.result.current.changeFeedSource('linuxdo'));
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('verification-required');
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('failed');
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    expect(linuxAttempts).toBe(3);
  });

  it('[REG-FEED-006] retries a failed multi-page refresh instead of advancing to a later page', async () => {
    const firstTopic = {
      source: 'linuxdo' as const,
      id: 'first',
      title: '第一页主题',
      author: 'alice',
      url: 'https://linux.do/t/first',
      createdAt: '2026-07-20T00:00:00.000Z',
      replyCount: 0
    };
    const secondTopic = { ...firstTopic, id: 'second', title: '第二页主题', url: 'https://linux.do/t/second' };
    let requestCount = 0;
    const getFeed = jest.fn(async ({ source, page = 1 }: { source: string; page?: number }) => {
      if (source !== 'linuxdo') return { items: [], errors: {}, hasMore: false, nextPage: null };
      requestCount += 1;
      if (requestCount === 4) {
        return {
          items: [],
          errors: {
            linuxdo: {
              kind: 'verification-required' as const,
              message: '刷新第二页需要验证',
              verificationRequired: true
            }
          },
          hasMore: true,
          nextPage: 3
        };
      }
      if (page === 1) return { items: [firstTopic], errors: {}, hasMore: true, nextPage: 2 };
      if (page === 2) return { items: [secondTopic], errors: {}, hasMore: true, nextPage: 3 };
      return {
        items: [{ ...secondTopic, id: 'third', title: '不应跳到第三页' }],
        errors: {},
        hasMore: false,
        nextPage: null
      };
    });
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const showLinuxDoVerification = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify: jest.fn(),
        readerData: createEmptyReaderData(),
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        readGateway
      })
    );

    await act(async () => hook.result.current.changeFeedSource('linuxdo'));
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));
    await act(async () => {
      await hook.result.current.loadFeed();
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic, secondTopic]));
    await act(async () => {
      await hook.result.current.refreshFeed();
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(
      getFeed.mock.calls.filter(([request]) => request.source === 'linuxdo').map(([request]) => request.page || 1)
    ).toEqual([1, 2, 1, 2, 1, 2]);
    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic, secondTopic]);
  });

  it.each(['all', 'nodeseek'] as const)(
    '[REG-FEED-008] keeps loaded topics as a prefix when %s loads another page',
    async (feedSource) => {
      const firstSource = feedSource === 'all' ? ('v2ex' as const) : ('nodeseek' as const);
      const secondSource = feedSource === 'all' ? ('linuxdo' as const) : ('nodeseek' as const);
      const firstPage = [
        {
          source: firstSource,
          id: `${feedSource}-first`,
          title: '第一页首个主题',
          author: 'alice',
          url: `https://example.com/${feedSource}-first`,
          createdAt: '2026-07-20T00:00:00.000Z',
          lastReplyAt: '2026-07-20T00:00:00.000Z',
          replyCount: 0
        },
        {
          source: secondSource,
          id: `${feedSource}-second`,
          title: '第一页第二个主题',
          author: 'bob',
          url: `https://example.com/${feedSource}-second`,
          createdAt: '2026-07-19T00:00:00.000Z',
          lastReplyAt: '2026-07-19T00:00:00.000Z',
          replyCount: 0
        }
      ];
      const nextPageTopic = {
        source: firstSource,
        id: `${feedSource}-third`,
        title: '第二页高活跃主题',
        author: 'carol',
        url: `https://example.com/${feedSource}-third`,
        createdAt: '2026-07-18T00:00:00.000Z',
        lastReplyAt: '2026-07-27T00:00:00.000Z',
        replyCount: 0
      };
      const readGateway = {
        getCategories: jest.fn(async () => ({ items: [], errors: {} })),
        getFeed: jest.fn(async ({ source, page = 1 }: { source: string; page?: number }) => {
          if (source !== feedSource) {
            return { items: [], errors: {}, hasMore: false, nextPage: null };
          }
          return page === 1
            ? { items: firstPage, errors: {}, hasMore: true, nextPage: 2 }
            : { items: [nextPageTopic], errors: {}, hasMore: false, nextPage: null };
        }),
        hasYaohuoCredential: jest.fn(async () => false)
      } as unknown as ReadGateway;
      const hook = await renderHook(() =>
        useFeedRuntime({
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          readerData: createEmptyReaderData(),
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification: jest.fn(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        })
      );

      if (feedSource !== 'all') {
        await act(async () => hook.result.current.changeFeedSource(feedSource));
      }
      await waitFor(() =>
        expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual(firstPage.map(topicKey))
      );

      await act(async () => {
        await hook.result.current.loadFeed();
      });

      await waitFor(() =>
        expect(hook.result.current.activeFeedState.items.map(topicKey)).toEqual([
          ...firstPage.map(topicKey),
          topicKey(nextPageTopic)
        ])
      );
    }
  );

  it('[REG-FEED-005] reports a single-source category error instead of treating it as an empty category list', async () => {
    const readGateway = {
      getCategories: jest.fn(async ({ source }: { source: string }) =>
        source === 'all'
          ? { items: [], errors: {} }
          : { items: [], errors: { v2ex: { kind: 'ordinary' as const, message: '分类读取失败' } } }
      ),
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const notify = jest.fn();
    const readerData = createEmptyReaderData();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway
      })
    );

    await waitFor(() =>
      expect(readGateway.getCategories).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'all' }),
        expect.any(Object)
      )
    );
    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() =>
      expect(readGateway.getCategories).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'v2ex' }),
        expect.any(Object)
      )
    );

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('分类读取失败')));
  });

  it('REG-FEED-004 preserves a single-source list when refresh returns a source error', async () => {
    const firstTopic = {
      source: 'v2ex' as const,
      id: 'first',
      title: '刷新前主题',
      author: 'alice',
      url: 'https://www.v2ex.com/t/first',
      createdAt: '2026-07-19T00:00:00.000Z',
      replyCount: 0
    };
    let v2exRequestCount = 0;
    const readGateway = {
      getCategories: jest.fn(async () => ({ items: [] })),
      getFeed: jest.fn(async ({ source }: { source: string }) => {
        if (source !== 'v2ex') {
          return { items: [], errors: {}, hasMore: false, nextPage: null };
        }
        v2exRequestCount += 1;
        return v2exRequestCount === 1
          ? { items: [firstTopic], errors: {}, hasMore: true, nextPage: 2, nextCursor: 'page-2' }
          : {
              items: [],
              errors: { v2ex: { kind: 'ordinary' as const, message: '刷新失败' } },
              hasMore: false,
              nextPage: null
            };
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const notify = jest.fn();
    const readerData = createEmptyReaderData();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway
      })
    );

    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));

    await act(async () => {
      await hook.result.current.refreshFeed();
    });

    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]);
    expect(hook.result.current.activeFeedState.nextCursor).toBe('page-2');
  });

  it.each(['source-error', 'parse-empty'] as const)(
    '[REG-SOURCE-002] does not append partial aggregate load-more results after %s',
    async (failure) => {
      const firstTopic = {
        source: 'v2ex' as const,
        id: 'first',
        title: '首屏主题',
        author: 'alice',
        url: 'https://www.v2ex.com/t/first',
        createdAt: '2026-07-19T00:00:00.000Z',
        replyCount: 0
      };
      const partialTopic = {
        ...firstTopic,
        source: 'linuxdo' as const,
        id: 'partial',
        title: '半页主题',
        url: 'https://linux.do/t/partial'
      };
      const partialPage = {
        items: [partialTopic],
        errors: failure === 'source-error' ? { yaohuo: { kind: 'ordinary' as const, message: 'HTTP 500' } } : {},
        hasMore: true,
        nextPage: 3,
        nextCursor: 'page-3'
      };
      const secondPage =
        failure === 'parse-empty'
          ? annotateSourceDiagnosticSummary(partialPage, {
              parserVariant: 'aggregate-feed',
              candidateCount: 2,
              validCount: 1,
              droppedCount: 1,
              isParseEmpty: true
            })
          : partialPage;
      const readGateway = {
        getCategories: jest.fn(async () => ({ items: [{ source: 'v2ex' as const, id: 'v2ex', name: 'V2EX' }] })),
        getFeed: jest.fn(async ({ page = 1 }: { page?: number }) =>
          page === 1
            ? { items: [firstTopic], errors: {}, hasMore: true, nextPage: 2, nextCursor: 'page-2' }
            : secondPage
        ),
        hasYaohuoCredential: jest.fn(async () => false)
      } as unknown as ReadGateway;
      const readerData = createEmptyReaderData();
      const notify = jest.fn();
      const showLinuxDoVerification = jest.fn();
      const showNodeSeekVerification = jest.fn();
      const showYaohuoLogin = jest.fn();
      const hook = await renderHook(() =>
        useFeedRuntime({
          linuxDoVerificationActive: false,
          notify,
          readerData,
          readerDataLoaded: true,
          active: true,
          showLinuxDoVerification,
          showNodeSeekVerification,
          showYaohuoLogin,
          readGateway
        })
      );

      await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));
      await act(async () => {
        await hook.result.current.loadFeed();
      });

      expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]);
      expect(hook.result.current.activeFeedState.nextCursor).toBe('page-2');
      await waitFor(() => expect(hook.result.current.activeFeedState.loadMoreFailureSignal).toBeGreaterThan(0));
    }
  );

  it('REG-XIAOYINSI-015 keeps its list filter state independent after a non-empty response', async () => {
    const readGateway = {
      getCategories: jest.fn(async () => ({
        items: [
          { source: 'v2ex', id: 'v2ex', name: 'V2EX' },
          { source: 'linuxdo', id: 'linuxdo', name: 'linux.do' },
          { source: 'nodeseek', id: 'nodeseek', name: 'NodeSeek' },
          { source: 'yaohuo', id: 'yaohuo', name: '妖火' },
          { source: 'xiaoyinsi', id: 'xiaoyinsi', name: '小隐寺' }
        ]
      })),
      getFeed: jest.fn(async () => ({
        items: [
          {
            source: 'xiaoyinsi' as const,
            id: '1',
            title: '小隐寺主题',
            author: 'alice',
            url: 'https://forum.xiaoyinsi.com/t/1',
            createdAt: '2026-07-19T00:00:00.000Z',
            replyCount: 0
          }
        ],
        errors: {},
        hasMore: false,
        nextPage: null
      })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as ReadGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() =>
      useFeedRuntime({
        linuxDoVerificationActive: false,
        notify,
        readerData,
        readerDataLoaded: true,
        active: true,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway
      })
    );

    await waitFor(() =>
      expect(readGateway.getFeed).toHaveBeenCalledWith(expect.objectContaining({ source: 'all' }), expect.any(Object))
    );
    await act(async () => {
      hook.result.current.changeFeedSource('xiaoyinsi');
    });
    await waitFor(() =>
      expect(readGateway.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'latest' }),
        expect.any(Object)
      )
    );

    await act(async () => {
      hook.result.current.setFeedFilter('hot');
    });

    await waitFor(() =>
      expect(readGateway.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'hot' }),
        expect.any(Object)
      )
    );
    expect(hook.result.current.feedFilter).toBe('hot');

    await act(async () => {
      hook.result.current.setFeedFilter('new-replies');
    });
    await waitFor(() =>
      expect(readGateway.getFeed).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'new-replies' }),
        expect.any(Object)
      )
    );
    expect(hook.result.current.feedFilter).toBe('new-replies');
  });
});
