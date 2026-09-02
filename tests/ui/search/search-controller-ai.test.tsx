import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSearchCandidateQueries } from '@/features/search/DiscourseFilterPickers';
import { useSearchController } from '@/features/search/useSearchController';
import type { AccountReconcileResult, LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState } from '@/domain/forum/searchFilters';
import { createSiteSessionStates, createSiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { annotateSourceDiagnosticSummary } from '@/sources/diagnostics';
import type { ReadGateway } from '@/sources/readGateway';
import type { SearchResponse, Source, Topic } from '@/domain/forum/models';
import { aggregateSearchSources, isSessionSource, type SessionSource } from '@/domain/forum/sourceCatalog';
import { resolveForumReadPlan, type ForumReadOperation } from '@/domain/forum/readPlan';
import { appQueryClient } from '@/platform/query/serverState';
import { initialForumSessionEpochs, type ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { resetForumSourceQueries } from '@/features/account/sessionQueryOwnership';
import { QueryTestWrapper } from '../QueryTestWrapper';

const mockStorageGetItem = jest.fn<(key: string) => Promise<string | null>>(async () => null);
const mockStorageSetItem = jest.fn<(key: string, value: string) => Promise<void>>(async () => undefined);

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockStorageGetItem(key),
    setItem: (key: string, value: string) => mockStorageSetItem(key, value)
  }
}));

const standardTopic: Topic = {
  source: 'linuxdo',
  id: '1',
  title: '普通结果',
  author: 'alice',
  url: 'https://linux.do/t/1',
  createdAt: '2026-07-17T00:00:00.000Z',
  replyCount: 1
};

const aiOnlyTopic: Topic = {
  ...standardTopic,
  id: 'ai-2',
  title: 'AI 独有结果',
  url: 'https://linux.do/t/ai-2',
  isAiGenerated: true
};

const LINUXDO_RELEVANCE_FILTERS: SearchFilterState = {
  ...DEFAULT_SEARCH_FILTERS,
  linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'relevance' }
};

const loggedInSessions = createSiteSessionViewModels(
  createSiteSessionStates({
    linuxdo: {
      site: 'linuxdo',
      status: 'logged-in',
      cookieSummary: ['session-present'],
      isVerifying: false
    },
    nodeseek: {
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: ['session-present'],
      isVerifying: false
    }
  })
);

const loggedInYaohuoSessions = createSiteSessionViewModels(
  createSiteSessionStates({
    linuxdo: {
      site: 'linuxdo',
      status: 'logged-in',
      cookieSummary: ['session-present'],
      isVerifying: false
    },
    nodeseek: {
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: ['session-present'],
      isVerifying: false
    },
    yaohuo: {
      site: 'yaohuo',
      status: 'logged-in',
      cookieSummary: ['session-present'],
      isVerifying: false,
      currentUser: {
        source: 'yaohuo',
        id: '7',
        username: 'tester',
        url: 'https://www.yaohuo.me/space-7.html',
        topics: []
      }
    }
  })
);

function createGateway({
  searchSemanticTopics,
  searchTopics
}: {
  searchSemanticTopics?: ReadGateway['searchSemanticTopics'];
  searchTopics: ReadGateway['searchTopics'];
}) {
  return {
    getReadPlan: (source: Source, operation: ForumReadOperation) =>
      resolveForumReadPlan(
        source,
        operation,
        true,
        isSessionSource(source)
          ? {
              source,
              authenticated: true,
              authSurfaceOpen: false,
              identityKey: `${source}:test`,
              identityTrust: 'confirmed',
              sessionEpoch: 0,
              sourceEnabled: true
            }
          : undefined
      ),
    searchSemanticTopics:
      searchSemanticTopics ??
      jest.fn<ReadGateway['searchSemanticTopics']>(async () => ({
        items: [],
        errors: {},
        hasMore: false,
        nextPage: null
      })),
    searchTagOptions: jest.fn(async () => []),
    searchUserOptions: jest.fn(async () => []),
    searchTopics
  } as unknown as ReadGateway;
}

async function reconcileSameIdentity(source: SessionSource): Promise<AccountReconcileResult> {
  return {
    status: 'same',
    session: {
      site: source,
      status: 'logged-in',
      cookieSummary: ['session-present'],
      isVerifying: false
    }
  };
}

function renderSearchController(
  readGateway: ReadGateway,
  notify = jest.fn<(message: string) => void>(),
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  getSessionEpochs: () => ForumSessionEpochs = () => initialForumSessionEpochs,
  sessionViewModels: SiteSessionViewModels = loggedInSessions,
  showNodeSeekVerification = jest.fn<(message?: string) => void>(),
  showYaohuoLogin = jest.fn<(message?: string) => void>(),
  getEnabledSearchSources: () => readonly Source[] = () => aggregateSearchSources,
  reconcileIdentityStatus = jest.fn<(source: SessionSource) => Promise<AccountReconcileResult>>(reconcileSameIdentity),
  onOpenExternalSearch = jest.fn<(url: string) => void>(),
  getAuthSurfaceOpen: (source: SessionSource) => boolean = () => false
) {
  appQueryClient.clear();
  const getReadPlan = (source: Source, operation: ForumReadOperation) =>
    resolveForumReadPlan(
      source,
      operation,
      getEnabledSearchSources().includes(source),
      isSessionSource(source)
        ? {
            source,
            authenticated: sessionViewModels[source].isLoggedIn,
            authSurfaceOpen: getAuthSurfaceOpen(source),
            identityKey: `${source}:test`,
            identityTrust: sessionViewModels[source].identityTrust,
            sessionEpoch: getSessionEpochs()[source],
            sourceEnabled: true
          }
        : undefined
    );
  const readGatewayWithPlans = {
    ...readGateway,
    getReadPlan,
    searchTopics: async (
      request: Parameters<ReadGateway['searchTopics']>[0],
      context?: Parameters<ReadGateway['searchTopics']>[1]
    ) => {
      if (request.source === 'all') throw new Error('Search controller must execute aggregate reads per source');
      const plan = getReadPlan(request.source, 'search');
      if (plan.state === 'blocked') {
        const loginRequired = plan.reason === 'login-required';
        throw Object.assign(new Error(loginRequired ? '请先登录该内容源' : '登录状态核对失败，请重试'), {
          kind: loginRequired ? ('login-required' as const) : ('ordinary' as const),
          reason: plan.reason,
          retryable: !loginRequired,
          source: request.source
        });
      }
      return readGateway.searchTopics(request, context);
    }
  } as ReadGateway;
  return renderHook(
    () =>
      useSearchController({
        categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
        enabledSearchSources: getEnabledSearchSources(),
        sessionEpochs: getSessionEpochs(),
        linuxDoVerificationActive: false,
        notify,
        ...({ onOpenExternalSearch } as object),
        reconcileIdentityStatus,
        active: true,
        sessionViewModels,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        readGateway: readGatewayWithPlans
      }),
    { wrapper: QueryTestWrapper }
  );
}

async function prepareLinuxDoSearch(hook: Awaited<ReturnType<typeof renderSearchController>>, query: string) {
  await act(async () => {
    hook.result.current.setSearchSource('linuxdo');
    hook.result.current.setSearchQuery(query);
  });
  await waitFor(() => {
    expect(hook.result.current.searchSource).toBe('linuxdo');
    expect(hook.result.current.searchQuery).toBe(query);
  });
}

describe('linux.do AI search controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps the first search submit enabled before any Query has started', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderSearchController(createGateway({ searchTopics }));

    expect(hook.result.current.searchBusy).toBe(false);
    await prepareLinuxDoSearch(hook, 'codex');
    await act(async () => {
      await hook.result.current.runSearch();
    });

    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
  });

  it('exposes a same-key source refetch as busy until the replacement settles', async () => {
    const replacement = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      })
      .mockImplementationOnce(async () => replacement.promise);
    const hook = await renderSearchController(createGateway({ searchTopics }));
    await prepareLinuxDoSearch(hook, 'same key');

    await act(async () => {
      await hook.result.current.runSearch({ query: 'same key', source: 'linuxdo' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items).toEqual([standardTopic]));

    await act(async () => {
      void hook.result.current.runSearch({ query: 'same key', source: 'linuxdo' });
      await Promise.resolve();
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(2));
    expect(hook.result.current.searchBusy).toBe(true);
    expect(hook.result.current.searchGroups[0]?.loading).toBe(true);

    await act(async () => {
      replacement.resolve({ items: [standardTopic], errors: {}, hasMore: false, nextPage: null });
      await replacement.promise;
    });
    await waitFor(() => {
      expect(hook.result.current.searchBusy).toBe(false);
      expect(hook.result.current.searchGroups[0]?.loading).toBe(false);
    });
  });

  it('does not open an action panel for a result whose input was just replaced', async () => {
    const pending = Promise.withResolvers<SearchResponse>();
    const showNodeSeekVerification = jest.fn<(message?: string) => void>();
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => pending.promise);
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInSessions,
      showNodeSeekVerification
    );
    await act(async () => {
      hook.result.current.setSearchSource('nodeseek');
      hook.result.current.setSearchQuery('old query');
    });
    await waitFor(() => expect(hook.result.current.searchQuery).toBe('old query'));
    await act(async () => {
      await hook.result.current.runSearch({ query: 'old query', source: 'nodeseek' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));

    await act(async () => {
      hook.result.current.setSearchQuery('replacement');
      pending.resolve({
        items: [],
        errors: {
          nodeseek: {
            kind: 'verification-required',
            message: '旧请求需要验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      });
      await pending.promise;
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(hook.result.current.searchQuery).toBe('replacement');
    expect(showNodeSeekVerification).not.toHaveBeenCalled();
  });

  it('exposes anonymous linux.do and NodeSeek searches without starting gateway transport', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const anonymousSessions = createSiteSessionViewModels(createSiteSessionStates());
    const onOpenExternalSearch = jest.fn<(url: string) => void>();
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      anonymousSessions,
      jest.fn(),
      jest.fn(),
      () => ['linuxdo', 'nodeseek'],
      jest.fn(),
      onOpenExternalSearch
    );

    for (const [source, expectedUrl] of [
      ['linuxdo', 'https://www.google.com/search?q=site%3Alinux.do+%22AI+agent%22+-windows'],
      ['nodeseek', 'https://www.google.com/search?q=site%3Anodeseek.com+%22AI+agent%22+-windows']
    ] as const) {
      await act(async () => {
        await hook.result.current.runSearch({ query: '  "AI agent" -windows  ', source });
      });
      await waitFor(() =>
        expect(hook.result.current.searchGroups).toEqual([
          expect.objectContaining({
            source,
            items: [],
            settled: true,
            externalSearchUrl: expectedUrl
          })
        ])
      );
      expect(onOpenExternalSearch).toHaveBeenLastCalledWith(expectedUrl);
    }

    await act(async () => {
      await hook.result.current.runSearch({ query: '"AI agent" -windows', source: 'all' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups).toHaveLength(2));
    expect(onOpenExternalSearch).toHaveBeenCalledTimes(2);
    expect(searchTopics).not.toHaveBeenCalled();
    expect(hook.result.current.linuxDoAiState).toMatchObject({ status: 'idle', enabled: false });
  });

  it('keeps the active authenticated search identity while verification is in progress', async () => {
    const restartedSearch = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [],
        errors: {
          linuxdo: {
            kind: 'verification-required',
            message: 'linux.do 需要验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      })
      .mockImplementation(async () => restartedSearch.promise);
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const readGateway = createGateway({ searchTopics });
    let sessionViewModels = loggedInSessions;
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
          enabledSearchSources: aggregateSearchSources,
          sessionEpochs: initialForumSessionEpochs,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          reconcileIdentityStatus: reconcileSameIdentity,
          active: true,
          sessionViewModels,
          showLinuxDoVerification,
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'linuxdo' });
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    sessionViewModels = createSiteSessionViewModels(
      createSiteSessionStates({
        linuxdo: {
          site: 'linuxdo',
          status: 'verifying',
          cookieSummary: ['session-present'],
          isVerifying: true
        }
      })
    );
    await act(async () => {
      hook.rerender(undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(appQueryClient.getQueryCache().find({ queryKey: recovery.queryKey, exact: true })?.isActive()).toBe(true);
    expect(searchTopics).toHaveBeenCalledTimes(1);
  });

  it('aborts an owned search after leaving Search and does not restart it for a new credential scope', async () => {
    const pendingSearch = Promise.withResolvers<SearchResponse>();
    let requestSignal: AbortSignal | undefined;
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async (options) => {
      requestSignal = options.signal;
      return pendingSearch.promise;
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const showNodeSeekVerification = jest.fn<(message?: string) => void>();
    const showYaohuoLogin = jest.fn<(message?: string) => void>();
    const readGateway = createGateway({ searchTopics });
    let active = true;
    let sessionEpochs = initialForumSessionEpochs;
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
          enabledSearchSources: aggregateSearchSources,
          sessionEpochs,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          reconcileIdentityStatus: reconcileSameIdentity,
          active,
          sessionViewModels: loggedInSessions,
          showLinuxDoVerification,
          showNodeSeekVerification,
          showYaohuoLogin,
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await prepareLinuxDoSearch(hook, 'codex');
    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'linuxdo' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));

    active = false;
    sessionEpochs = { ...initialForumSessionEpochs, linuxdo: 1 };
    await act(async () => {
      hook.rerender(undefined);
      await Promise.resolve();
    });
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    await act(async () => {
      pendingSearch.resolve({
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
      await pendingSearch.promise;
    });

    expect(searchTopics).toHaveBeenCalledTimes(1);
    expect(showLinuxDoVerification).not.toHaveBeenCalled();
    expect(showNodeSeekVerification).not.toHaveBeenCalled();
    expect(showYaohuoLogin).not.toHaveBeenCalled();
  });

  it('pauses an in-flight AI read while verification is open and resumes it after closing', async () => {
    const aiSignals: AbortSignal[] = [];
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>(async ({ signal }) => {
      if (signal) aiSignals.push(signal);
      if (aiSignals.length === 1) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      return { items: [aiOnlyTopic], errors: {}, hasMore: false, nextPage: null };
    });
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const readGateway = createGateway({ searchSemanticTopics, searchTopics });
    let linuxDoVerificationActive = false;
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
          enabledSearchSources: aggregateSearchSources,
          sessionEpochs: initialForumSessionEpochs,
          linuxDoVerificationActive,
          notify: jest.fn(),
          reconcileIdentityStatus: reconcileSameIdentity,
          active: true,
          sessionViewModels: loggedInSessions,
          showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
          showNodeSeekVerification: jest.fn<(message?: string) => void>(),
          showYaohuoLogin: jest.fn<(message?: string) => void>(),
          readGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await prepareLinuxDoSearch(hook, 'codex');
    await act(async () => {
      await hook.result.current.runSearch({
        query: 'codex',
        source: 'linuxdo',
        filters: LINUXDO_RELEVANCE_FILTERS
      });
    });
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(1));

    linuxDoVerificationActive = true;
    await act(async () => {
      hook.rerender(undefined);
      await Promise.resolve();
    });
    await waitFor(() => expect(aiSignals[0]?.aborted).toBe(true));
    expect(searchSemanticTopics).toHaveBeenCalledTimes(1);

    linuxDoVerificationActive = false;
    await act(async () => {
      hook.rerender(undefined);
      await Promise.resolve();
    });
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(2));
  });

  it('cancels candidate reads while verification is open and resumes the current request after closing', async () => {
    const tagSignals: AbortSignal[] = [];
    const searchDiscourseTags = jest.fn(async ({ signal }: { signal?: AbortSignal }) => {
      if (signal) tagSignals.push(signal);
      if (tagSignals.length === 1) {
        return new Promise<never[]>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      return [];
    });
    let enabled = true;
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchCandidateQueries({
          sessionEpochs: initialForumSessionEpochs,
          enabled,
          readPlanScopes: { tags: 'public:omit', users: 'public:omit' },
          searchDiscourseTags,
          searchDiscourseUsers: jest.fn(async () => []),
          tagRequest: {
            source: 'linuxdo',
            query: 'react',
            selectedTags: []
          },
          userRequest: null
        }),
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(searchDiscourseTags).toHaveBeenCalledTimes(1));

    enabled = false;
    await act(async () => {
      hook.rerender(undefined);
      await Promise.resolve();
    });
    await waitFor(() => expect(tagSignals[0]?.aborted).toBe(true));
    expect(searchDiscourseTags).toHaveBeenCalledTimes(1);

    enabled = true;
    await act(async () => {
      hook.rerender(undefined);
      await Promise.resolve();
    });
    await waitFor(() => expect(searchDiscourseTags).toHaveBeenCalledTimes(2));
  });

  it('resumes the exact foreground search without recursively reopening verification', async () => {
    const showLinuxDoVerification = jest.fn();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [],
        errors: {
          linuxdo: {
            kind: 'verification-required',
            message: 'linux.do 需要验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      })
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      }),
      jest.fn(),
      showLinuxDoVerification
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      await hook.result.current.runSearch({
        filters: {
          ...DEFAULT_SEARCH_FILTERS,
          linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'latest' }
        },
        query: 'codex',
        source: 'linuxdo'
      });
    });

    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    expect(recovery.queryKey.slice(0, 3)).toEqual(['forum', 'linuxdo', 'search']);
    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });
    expect(searchTopics).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
  });

  it('reports an ordinary search recovery failure instead of completed', async () => {
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [],
        errors: {
          linuxdo: {
            kind: 'verification-required',
            message: 'linux.do 需要验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      })
      .mockResolvedValueOnce({
        items: [],
        errors: {
          linuxdo: {
            kind: 'verification-required',
            message: 'linux.do 仍需验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      })
      .mockResolvedValueOnce({
        items: [],
        errors: {
          linuxdo: {
            kind: 'ordinary',
            message: '恢复后网络失败'
          }
        },
        hasMore: false,
        nextPage: null
      });
    const hook = await renderSearchController(createGateway({ searchTopics }), jest.fn(), showLinuxDoVerification);
    await prepareLinuxDoSearch(hook, 'recovery');

    await act(async () => {
      await hook.result.current.runSearch({ query: 'recovery', source: 'linuxdo' });
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('verification-required');
    });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('failed');
    });
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
    expect(searchTopics).toHaveBeenCalledTimes(3);
  });

  it('preserves the loaded search page across session reset before resuming pagination', async () => {
    const secondPageTopic: Topic = {
      ...standardTopic,
      id: '2',
      title: '第二页结果',
      url: 'https://linux.do/t/2'
    };
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: true,
        nextPage: 2
      })
      .mockResolvedValueOnce({
        items: [],
        errors: {
          linuxdo: {
            kind: 'verification-required',
            message: 'linux.do 需要验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      })
      .mockResolvedValueOnce({
        items: [secondPageTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      }),
      jest.fn(),
      showLinuxDoVerification
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      void hook.result.current.runSearch({
        filters: {
          ...DEFAULT_SEARCH_FILTERS,
          linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'latest' }
        },
        query: 'codex',
        source: 'linuxdo'
      });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.nextPage).toBe(2));
    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });

    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    expect(recovery).toBeDefined();
    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient, recovery.queryKey);
    });

    expect(hook.result.current.searchGroups[0]).toMatchObject({
      source: 'linuxdo',
      items: [standardTopic],
      hasMore: true,
      nextPage: 2,
      loadingMore: false
    });

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(searchTopics).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items).toEqual([standardTopic, secondPageTopic]));
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('does not auto-open login or verification panels for aggregated search', async () => {
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const showNodeSeekVerification = jest.fn<(message?: string) => void>();
    const showYaohuoLogin = jest.fn<(message?: string) => void>();
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => {
      if (source === 'yaohuo') {
        throw Object.assign(new Error('妖火需要登录'), { kind: 'login-required' });
      }
      return {
        items: [],
        errors:
          source === 'linuxdo' || source === 'nodeseek'
            ? {
                [source]: {
                  kind: 'verification-required' as const,
                  message: `${source} 需要验证`,
                  verificationRequired: true
                }
              }
            : {},
        hasMore: false,
        nextPage: null
      };
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      }),
      jest.fn(),
      showLinuxDoVerification,
      () => initialForumSessionEpochs,
      loggedInYaohuoSessions,
      showNodeSeekVerification,
      showYaohuoLogin
    );
    await act(async () => {
      hook.result.current.setSearchQuery('codex');
    });
    await waitFor(() => expect(hook.result.current.searchQuery).toBe('codex'));

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'all' });
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups.find(({ source }) => source === 'nodeseek')?.error).toBe(
        'nodeseek 需要验证'
      )
    );
    expect(searchTopics).toHaveBeenCalledTimes(4);
    expect(showLinuxDoVerification).not.toHaveBeenCalled();
    expect(showNodeSeekVerification).not.toHaveBeenCalled();
    expect(showYaohuoLogin).not.toHaveBeenCalled();
    const nodeSeekQuery = appQueryClient
      .getQueryCache()
      .findAll({
        queryKey: ['forum', 'nodeseek', 'search']
      })
      .at(-1);
    expect(nodeSeekQuery?.state.data).toBeUndefined();
    expect(nodeSeekQuery?.state.error).toEqual(expect.any(Error));
  });

  it('uses clean newest-topic defaults for every aggregated source', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInYaohuoSessions
    );
    await act(async () => {
      hook.result.current.applySearchFilter('linuxdo', {
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        category: '4',
        order: 'relevance'
      });
    });
    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'all' });
    });

    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(4));
    const expectedFilters = {
      v2ex: { source: 'v2ex', sort: 'time' },
      linuxdo: { source: 'linuxdo', category: '', order: 'latest' },
      nodeseek: { source: 'nodeseek', category: '', sort: 'postTime' },
      yaohuo: { source: 'yaohuo', category: '0' }
    } as const;

    for (const [source, expectedFilter] of Object.entries(expectedFilters)) {
      const request = searchTopics.mock.calls.find(([options]) => options.source === source)?.[0];
      expect(request?.filter).toMatchObject(expectedFilter);
      const queryKeys = appQueryClient
        .getQueryCache()
        .findAll({ queryKey: ['forum', source, 'search'] })
        .map(({ queryKey }) => queryKey[3]);
      expect(queryKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ filter: expect.objectContaining(expectedFilter), query: 'codex', sort: 'time' })
        ])
      );
    }
  });

  it('switches from a settled aggregate preview to a paged source without reusing its data shape', async () => {
    const v2exTopic: Topic = {
      ...standardTopic,
      source: 'v2ex',
      id: 'v2ex-1',
      title: 'V2EX 结果',
      url: 'https://www.v2ex.com/t/1'
    };
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => ({
      items: source === 'v2ex' ? [v2exTopic] : [],
      errors: {},
      hasMore: source === 'v2ex',
      nextPage: source === 'v2ex' ? 2 : null
    }));
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInYaohuoSessions
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'all' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(hook.result.current.searchGroups.find(({ source }) => source === 'v2ex')?.items).toEqual([v2exTopic])
    );

    await act(async () => {
      hook.result.current.setSearchSource('v2ex');
    });

    await waitFor(() => expect(hook.result.current.searchSource).toBe('v2ex'));
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(5));
    await waitFor(() =>
      expect(hook.result.current.searchGroups).toEqual([
        expect.objectContaining({
          source: 'v2ex',
          items: [v2exTopic],
          hasMore: true,
          nextPage: 2
        })
      ])
    );

    const v2exQueries = appQueryClient
      .getQueryCache()
      .findAll({ queryKey: ['forum', 'v2ex', 'search'] })
      .filter(
        ({ queryKey, state }) => (queryKey[3] as { query?: string }).query === 'codex' && state.data !== undefined
      );
    expect(v2exQueries).toHaveLength(2);
    expect(v2exQueries.map(({ queryKey }) => queryKey[3])).toEqual(
      expect.arrayContaining([expect.objectContaining({ lane: 'preview' }), expect.objectContaining({ lane: 'pages' })])
    );
    expect(v2exQueries.find(({ queryKey }) => (queryKey[3] as { lane?: string }).lane === 'pages')?.state.data).toEqual(
      {
        pageParams: [1],
        pages: [expect.objectContaining({ kind: 'success' })]
      }
    );
  });

  it('opens Yaohuo login exactly once for a single-source login failure', async () => {
    const showYaohuoLogin = jest.fn<(message?: string) => void>();
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => {
      throw Object.assign(new Error('妖火需要登录'), { kind: 'login-required' as const });
    });
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInYaohuoSessions,
      jest.fn(),
      showYaohuoLogin
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'yaohuo' });
    });

    await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(1));
    expect(showYaohuoLogin).toHaveBeenCalledWith('妖火需要登录');
    expect(searchTopics).toHaveBeenCalledTimes(1);
  });

  it('keeps a dismissed anonymous Yaohuo login closed until explicit retry', async () => {
    let authSurfaceOpen = false;
    const showYaohuoLogin = jest.fn<(message?: string) => void>(() => {
      authSurfaceOpen = true;
    });
    const hook = await renderSearchController(
      createGateway({
        searchTopics: jest.fn<ReadGateway['searchTopics']>(async () => {
          throw Object.assign(new Error('妖火需要登录'), { kind: 'login-required' as const });
        })
      }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      createSiteSessionViewModels(createSiteSessionStates()),
      jest.fn(),
      showYaohuoLogin,
      () => aggregateSearchSources,
      jest.fn(),
      jest.fn(),
      (source) => source === 'yaohuo' && authSurfaceOpen
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'yaohuo' });
    });
    await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(1));

    await act(async () => hook.rerender(undefined));
    authSurfaceOpen = false;
    await act(async () => hook.rerender(undefined));
    await act(async () => {
      await appQueryClient.refetchQueries({ queryKey: ['forum', 'yaohuo', 'search'] });
    });

    expect(showYaohuoLogin).toHaveBeenCalledTimes(1);

    await act(async () => hook.result.current.retrySearchSource('yaohuo'));
    await waitFor(() => expect(showYaohuoLogin).toHaveBeenCalledTimes(2));
  });

  it('keeps an initial source failure out of trusted Query data', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [],
      errors: {
        nodeseek: { kind: 'ordinary', message: 'NodeSeek 首次搜索失败' }
      },
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderSearchController(createGateway({ searchTopics }));

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'nodeseek' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.error).toBe('NodeSeek 首次搜索失败'));

    const query = appQueryClient
      .getQueryCache()
      .findAll({
        queryKey: ['forum', 'nodeseek', 'search']
      })
      .at(-1);
    expect(query?.state.data).toBeUndefined();
    expect(query?.state.error).toEqual(expect.any(Error));
  });

  it('keeps trusted aggregate results visible with a retryable refresh error', async () => {
    let nodeSeekAttempts = 0;
    const nodeSeekTopic = {
      ...standardTopic,
      source: 'nodeseek' as const,
      id: 'ns-1',
      url: 'https://www.nodeseek.com/post-1-1'
    };
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => {
      if (source !== 'nodeseek') {
        return { items: [], errors: {}, hasMore: false, nextPage: null };
      }
      nodeSeekAttempts += 1;
      return nodeSeekAttempts === 1
        ? { items: [nodeSeekTopic], errors: {}, hasMore: false, nextPage: null }
        : {
            items: [],
            errors: { nodeseek: { kind: 'ordinary' as const, message: 'NodeSeek 刷新失败' } },
            hasMore: false,
            nextPage: null
          };
    });
    const hook = await renderSearchController(createGateway({ searchTopics }));

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'all' });
    });
    await waitFor(() =>
      expect(hook.result.current.searchGroups.find(({ source }) => source === 'nodeseek')).toMatchObject({
        items: [nodeSeekTopic],
        error: undefined
      })
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'all' });
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups.find(({ source }) => source === 'nodeseek')).toMatchObject({
        items: [nodeSeekTopic],
        error: 'NodeSeek 刷新失败',
        errorKind: 'ordinary'
      })
    );
    expect(searchTopics).toHaveBeenCalledTimes(6);
  });

  it('judges a whole-source retry by that source instead of unrelated aggregate errors', async () => {
    const notify = jest.fn<(message: string) => void>();
    let nodeSeekAttempts = 0;
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => {
      if (source === 'linuxdo') {
        return {
          items: [],
          errors: { linuxdo: { kind: 'ordinary' as const, message: 'linux.do 暂时失败' } },
          hasMore: false,
          nextPage: null
        };
      }
      if (source === 'nodeseek') {
        nodeSeekAttempts += 1;
        return nodeSeekAttempts === 1
          ? {
              items: [],
              errors: { nodeseek: { kind: 'ordinary' as const, message: 'NodeSeek 暂时失败' } },
              hasMore: false,
              nextPage: null
            }
          : {
              items: [{ ...standardTopic, source: 'nodeseek', id: 'ns-1', url: 'https://www.nodeseek.com/post-1-1' }],
              errors: {},
              hasMore: false,
              nextPage: null
            };
      }
      return { items: [], errors: {}, hasMore: false, nextPage: null };
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      }),
      notify
    );
    await act(async () => {
      hook.result.current.setSearchQuery('codex');
    });
    await waitFor(() => expect(hook.result.current.searchQuery).toBe('codex'));
    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'all' });
    });
    notify.mockClear();

    let outcome: Awaited<ReturnType<typeof hook.result.current.runSearch>> | undefined;
    await act(async () => {
      outcome = await hook.result.current.runSearch('nodeseek');
    });

    expect(outcome).toBe('completed');
    await waitFor(() =>
      expect(hook.result.current.searchGroups.find((group) => group.source === 'nodeseek')).toMatchObject({
        items: [expect.objectContaining({ id: 'ns-1' })],
        error: undefined
      })
    );
    expect(hook.result.current.searchGroups.find((group) => group.source === 'linuxdo')?.error).toBe(
      'linux.do 暂时失败'
    );
    expect(notify).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    setDiagnosticWriter(null);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    appQueryClient.clear();
  });

  it('uses inline status instead of success notifications for search and pagination', async () => {
    const notify = jest.fn<(message: string) => void>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: true,
        nextPage: 2
      })
      .mockResolvedValueOnce({
        items: [{ ...standardTopic, id: '2', url: 'https://linux.do/t/2' }],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      }),
      notify
    );
    await prepareLinuxDoSearch(hook, 'codex');
    const filters = {
      ...DEFAULT_SEARCH_FILTERS,
      linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'latest' as const }
    };

    await act(async () => {
      void hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.nextPage).toBe(2));
    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });

    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items).toHaveLength(2));
    expect(notify).not.toHaveBeenCalled();
  });

  it('submits a query override with the current source and stores one recent entry', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      })
    );
    await act(async () => {
      hook.result.current.setSearchSource('linuxdo');
    });
    await waitFor(() => expect(hook.result.current.searchSource).toBe('linuxdo'));
    await act(async () => {
      hook.result.current.applySearchFilter('linuxdo', { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'latest' });
    });

    await act(async () => {
      void hook.result.current.runSearch({ query: 'history query' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));
    await act(async () => {
      void hook.result.current.runSearch({ query: 'history query' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(2));

    expect(hook.result.current.searchQuery).toBe('history query');
    expect(hook.result.current.recentSearches).toEqual(['history query']);
    expect(searchTopics).toHaveBeenCalledTimes(2);
    expect(searchTopics.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        query: 'history query',
        source: 'linuxdo',
        filter: expect.objectContaining({ order: 'latest' })
      })
    );
  });

  it('persists a search submitted before saved history finishes loading', async () => {
    const storedHistory = Promise.withResolvers<string | null>();
    mockStorageGetItem.mockImplementationOnce(async () => storedHistory.promise);
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      })
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'new query', source: 'linuxdo' });
    });
    expect(hook.result.current.recentSearches).toEqual(['new query']);

    await act(async () => {
      storedHistory.resolve(JSON.stringify(['saved query']));
      await storedHistory.promise;
    });

    await waitFor(() => {
      expect(hook.result.current.recentSearches).toEqual(['new query', 'saved query']);
      expect(mockStorageSetItem).toHaveBeenCalledWith(
        'reader-search-history',
        JSON.stringify(['new query', 'saved query'])
      );
    });
  });

  it('does not overwrite saved history when the initial storage read fails', async () => {
    const storedHistory = Promise.withResolvers<string | null>();
    mockStorageGetItem.mockImplementationOnce(async () => storedHistory.promise);
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics: jest.fn<ReadGateway['searchTopics']>()
      })
    );

    await act(async () => {
      storedHistory.reject(new Error('storage unavailable'));
      await storedHistory.promise.catch(() => undefined);
    });

    expect(hook.result.current.recentSearches).toEqual([]);
    expect(mockStorageSetItem).not.toHaveBeenCalled();
  });

  it('retries a failed history read before persisting a new search', async () => {
    mockStorageGetItem
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(JSON.stringify(['saved query']));
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      })
    );
    await waitFor(() => expect(mockStorageGetItem).toHaveBeenCalledTimes(1));

    await act(async () => {
      await hook.result.current.runSearch({ query: 'new query', source: 'linuxdo' });
    });

    await waitFor(() => {
      expect(mockStorageGetItem).toHaveBeenCalledTimes(2);
      expect(hook.result.current.recentSearches).toEqual(['new query', 'saved query']);
      expect(mockStorageSetItem).toHaveBeenCalledWith(
        'reader-search-history',
        JSON.stringify(['new query', 'saved query'])
      );
    });
  });

  it('runs AI in parallel, caches it behind the switch, and keeps it after standard pagination', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const firstStandard = Promise.withResolvers<SearchResponse>();
    const ai = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockImplementationOnce(async () => firstStandard.promise)
      .mockResolvedValueOnce({
        items: [{ ...standardTopic, id: '2', title: '普通第二页', url: 'https://linux.do/t/2' }],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>(async () => ai.promise);
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'codex');
    const filters: SearchFilterState = {
      ...DEFAULT_SEARCH_FILTERS,
      linuxdo: {
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        category: '4',
        tags: ['人工智能', '快问快答'],
        tagMatch: 'all',
        order: 'relevance',
        expertResponse: true
      }
    };

    let searchPromise!: ReturnType<typeof hook.result.current.runSearch>;
    await act(async () => {
      searchPromise = hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters });
      await Promise.resolve();
    });
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(1));
    expect(searchSemanticTopics.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        source: 'linuxdo',
        query: 'codex category:4 tags:人工智能+快问快答 with:category_expert_response'
      })
    );
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(true));

    await act(async () => {
      ai.resolve({
        items: [{ ...standardTopic, isAiGenerated: true }, aiOnlyTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
      await ai.promise;
    });
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('ready'));
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      firstStandard.resolve({ items: [standardTopic], errors: {}, hasMore: true, nextPage: 2 });
      await searchPromise;
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1']));

    await act(async () => hook.result.current.toggleLinuxDoAiSearch());
    expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1', 'ai-2']);
    expect(hook.result.current.searchGroups[0]?.items[1]?.isAiGenerated).toBe(true);

    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });
    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1', '2', 'ai-2'])
    );

    await act(async () => hook.result.current.toggleLinuxDoAiSearch());
    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1', '2'])
    );
    await act(async () => hook.result.current.toggleLinuxDoAiSearch());
    expect(searchSemanticTopics).toHaveBeenCalledTimes(1);
    const semanticEvents = diagnosticLines
      .map((line) => JSON.parse(line))
      .filter(({ operation }) => operation === 'searchSemanticTopics');
    expect(semanticEvents.map(({ phase }) => phase)).toEqual(['intent', 'guard', 'apply', 'finish']);
    expect(searchSemanticTopics.mock.calls[0]?.[1]?.trace?.traceId).toBe(semanticEvents[0]?.traceId);
    expect(new Set(semanticEvents.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    expect(diagnosticLines.join('')).not.toContain('人工智能');
    expect(diagnosticLines.join('')).not.toContain('快问快答');
  });

  it('preserves the failed page cursor and retries that page', async () => {
    const secondPageTopic: Topic = {
      ...standardTopic,
      id: '2',
      title: '普通第二页',
      url: 'https://linux.do/t/2'
    };
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: true,
        nextPage: 2
      })
      .mockRejectedValueOnce(new Error('第二页请求失败'))
      .mockResolvedValueOnce({
        items: [secondPageTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      })
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      void hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.nextPage).toBe(2));
    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]).toMatchObject({
        items: [expect.objectContaining({ id: '1' })],
        error: expect.any(String),
        hasMore: true,
        loadingMore: false,
        nextPage: 2
      })
    );

    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });

    expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 2]);
    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]).toMatchObject({
        items: [expect.objectContaining({ id: '1' }), expect.objectContaining({ id: '2' })],
        error: undefined,
        hasMore: false,
        nextPage: null
      })
    );
  });

  it('retries a failed multi-page refresh instead of skipping to the next cursor', async () => {
    const secondPageTopic = {
      ...standardTopic,
      id: '2',
      title: '第二页',
      url: 'https://linux.do/t/2'
    };
    let requestCount = 0;
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ page = 1 }) => {
      requestCount += 1;
      if (requestCount === 4) {
        return {
          items: [],
          errors: { linuxdo: { kind: 'ordinary' as const, message: '刷新第二页失败' } },
          hasMore: true,
          nextPage: 3
        };
      }
      if (page === 1) {
        return { items: [standardTopic], errors: {}, hasMore: true, nextPage: 2 };
      }
      if (page === 2) {
        return { items: [secondPageTopic], errors: {}, hasMore: true, nextPage: 3 };
      }
      return {
        items: [{ ...secondPageTopic, id: '3', title: '不应跳到第三页' }],
        errors: {},
        hasMore: false,
        nextPage: null
      };
    });
    const hook = await renderSearchController(createGateway({ searchTopics }));
    await prepareLinuxDoSearch(hook, 'refresh pagination');

    await act(async () => {
      await hook.result.current.runSearch({ query: 'refresh pagination', source: 'linuxdo' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.nextPage).toBe(2));
    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items.map(({ id }) => id)).toEqual(['1', '2']));

    await act(async () => {
      await hook.result.current.runSearch({ query: 'refresh pagination', source: 'linuxdo' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.error).toBe('刷新第二页失败'));
    await act(async () => {
      hook.result.current.retrySearchSource('linuxdo');
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(6));

    expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(hook.result.current.searchGroups[0]?.items.map(({ id }) => id)).toEqual(['1', '2']);
  });

  it('does not append partial items from a failed search page', async () => {
    const partialTopic: Topic = {
      ...standardTopic,
      id: 'partial-2',
      title: '失败页的非权威条目',
      url: 'https://linux.do/t/partial-2'
    };
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: true,
        nextPage: 2
      })
      .mockResolvedValueOnce({
        items: [partialTopic],
        errors: {
          linuxdo: {
            kind: 'ordinary',
            message: '第二页只返回了部分结果'
          }
        },
        hasMore: true,
        nextPage: 3
      });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      })
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      void hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.nextPage).toBe(2));
    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]).toMatchObject({
        items: [expect.objectContaining({ id: '1' })],
        error: '第二页只返回了部分结果',
        hasMore: true,
        loadingMore: false,
        nextPage: 2
      })
    );
  });

  it('treats a parse-empty search page as retryable instead of advancing the cursor', async () => {
    const secondPageTopic: Topic = {
      ...standardTopic,
      id: '2',
      title: '普通第二页',
      url: 'https://linux.do/t/2'
    };
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: true,
        nextPage: 2
      })
      .mockResolvedValueOnce(
        annotateSourceDiagnosticSummary(
          {
            items: [],
            errors: {},
            hasMore: true,
            nextPage: 3
          },
          {
            parserVariant: 'discourse-search',
            candidateCount: 2,
            validCount: 0,
            droppedCount: 2,
            isExpectedEmpty: false
          }
        )
      )
      .mockResolvedValueOnce({
        items: [secondPageTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      })
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      void hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.nextPage).toBe(2));
    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]).toMatchObject({
        items: [expect.objectContaining({ id: '1' })],
        error: expect.stringContaining('无法解析'),
        hasMore: true,
        loadingMore: false,
        nextPage: 2
      })
    );

    await act(async () => {
      await hook.result.current.loadMoreSearchSource('linuxdo', 2);
    });

    expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 2]);
    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]).toMatchObject({
        items: [expect.objectContaining({ id: '1' }), expect.objectContaining({ id: '2' })],
        error: undefined,
        hasMore: false,
        nextPage: null
      })
    );
  });

  it('preserves existing results when a whole-source retry parses empty', async () => {
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: true,
        nextPage: 2
      })
      .mockResolvedValueOnce(
        annotateSourceDiagnosticSummary(
          {
            items: [],
            errors: {},
            hasMore: true,
            nextPage: 2
          },
          {
            parserVariant: 'discourse-search',
            candidateCount: 2,
            validCount: 0,
            droppedCount: 2,
            isExpectedEmpty: false
          }
        )
      );
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      })
    );
    await prepareLinuxDoSearch(hook, 'codex');
    await act(async () => {
      void hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items).toEqual([standardTopic]));

    await act(async () => {
      void hook.result.current.runSearch('linuxdo');
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]).toMatchObject({
        items: [expect.objectContaining({ id: '1' })],
        error: expect.stringContaining('无法解析'),
        hasMore: true,
        nextPage: 2
      })
    );
  });

  it('keeps a first-page partial failure on the whole-source retry path', async () => {
    const notify = jest.fn<(message: string) => void>();
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {
        linuxdo: {
          kind: 'ordinary',
          message: '首屏部分失败'
        }
      },
      hasMore: true,
      nextPage: 2
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
        searchTopics
      }),
      notify
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      void hook.result.current.runSearch({ query: 'codex', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]).toMatchObject({
        items: [expect.objectContaining({ id: '1' })],
        error: '首屏部分失败',
        hasMore: false,
        nextPage: null
      })
    );
  });

  it('retries a NodeSeek verification failure on the same pagination page', async () => {
    const nodeSeekTopic: Topic = {
      ...standardTopic,
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-1-1'
    };
    const secondPageTopic: Topic = {
      ...nodeSeekTopic,
      id: '2',
      url: 'https://www.nodeseek.com/post-2-1'
    };
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [nodeSeekTopic],
        errors: {},
        hasMore: true,
        nextPage: 2
      })
      .mockResolvedValueOnce({
        items: [],
        errors: {
          nodeseek: {
            kind: 'verification-required',
            message: 'NodeSeek 需要验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      })
      .mockResolvedValueOnce({
        items: [],
        errors: {
          nodeseek: {
            kind: 'verification-required',
            message: 'NodeSeek 仍需验证',
            verificationRequired: true
          }
        },
        hasMore: false,
        nextPage: null
      })
      .mockResolvedValueOnce({
        items: [secondPageTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const onVerificationRequired = jest.fn<(message: string, recovery: LinuxDoReadRecovery) => void>();
    const gateway = createGateway({
      searchSemanticTopics: jest.fn<ReadGateway['searchSemanticTopics']>(),
      searchTopics
    });
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [],
          enabledSearchSources: aggregateSearchSources,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          onNodeSeekSearchVerificationRequired: onVerificationRequired,
          reconcileIdentityStatus: reconcileSameIdentity,
          sessionViewModels: createSiteSessionViewModels(
            createSiteSessionStates({
              nodeseek: {
                site: 'nodeseek',
                status: 'logged-in',
                cookieSummary: ['session-present'],
                isVerifying: false
              }
            })
          ),
          active: true,
          showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway: gateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await act(async () => {
      hook.result.current.setSearchSource('nodeseek');
      hook.result.current.setSearchQuery('codex');
    });
    await waitFor(() => expect(hook.result.current.searchSource).toBe('nodeseek'));

    await act(async () => {
      void hook.result.current.runSearch({ query: 'codex', source: 'nodeseek', filters: DEFAULT_SEARCH_FILTERS });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.nextPage).toBe(2));
    await act(async () => {
      await hook.result.current.loadMoreSearchSource('nodeseek', 2);
    });

    expect(hook.result.current.searchGroups[0]).toMatchObject({
      items: [expect.objectContaining({ id: '1' })],
      hasMore: true,
      nextPage: 2
    });
    await waitFor(() => expect(onVerificationRequired).toHaveBeenCalledTimes(1));

    const recovery = onVerificationRequired.mock.calls[0]?.[1];
    await act(async () => {
      await expect(recovery?.resume()).resolves.toBe('verification-required');
      await expect(recovery?.resume()).resolves.toBe('completed');
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(4));

    expect(searchTopics.mock.calls.map(([request]) => request.page)).toEqual([1, 2, 2, 2]);
    await waitFor(() =>
      expect(hook.result.current.searchGroups[0]?.items.map((topic) => topic.id)).toEqual(['1', '2'])
    );
  });

  it('passes one safe controller trace into each generic candidate gateway read', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>();
    const gateway = createGateway({ searchSemanticTopics, searchTopics });
    const searchTagOptions = jest.fn<ReadGateway['searchTagOptions']>(async () => [{ name: 'private-tag' }]);
    const searchUserOptions = jest.fn<ReadGateway['searchUserOptions']>(async () => [
      { id: '7', username: 'private-user' }
    ]);
    gateway.searchTagOptions = searchTagOptions;
    gateway.searchUserOptions = searchUserOptions;
    const hook = await renderSearchController(gateway);

    await act(async () => {
      await hook.result.current.searchDiscourseTags({ query: 'private-tag', selectedTags: [] });
      await hook.result.current.searchDiscourseUsers({ term: 'private-user' });
    });

    for (const [operation, mock] of [
      ['searchTagOptions', searchTagOptions],
      ['searchUserOptions', searchUserOptions]
    ] as const) {
      const events = diagnosticLines.map((line) => JSON.parse(line)).filter((event) => event.operation === operation);
      expect(events.map(({ phase }) => phase)).toEqual(['intent', 'guard', 'apply', 'finish']);
      expect(mock.mock.calls[0]?.[1]?.trace?.traceId).toBe(events[0]?.traceId);
      expect(new Set(events.map(({ traceId }) => traceId))).toHaveProperty('size', 1);
    }
    expect(diagnosticLines.join('')).not.toContain('private-tag');
    expect(diagnosticLines.join('')).not.toContain('private-user');
  });

  it('ignores an old AI response after a new query and retries only retryable failures', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const firstAi = Promise.withResolvers<SearchResponse>();
    const secondAi = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest
      .fn<ReadGateway['searchSemanticTopics']>()
      .mockImplementationOnce(async () => firstAi.promise)
      .mockImplementationOnce(async () => secondAi.promise)
      .mockRejectedValueOnce(Object.assign(new Error('limited'), { status: 429 }))
      .mockResolvedValueOnce({ items: [aiOnlyTopic], errors: {}, hasMore: false, nextPage: null });
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'first');

    await act(async () => {
      await hook.result.current.runSearch({ filters: LINUXDO_RELEVANCE_FILTERS });
    });
    await act(async () => {
      hook.result.current.setSearchQuery('second');
    });
    await act(async () => {
      await hook.result.current.runSearch({
        query: 'second',
        source: 'linuxdo',
        filters: LINUXDO_RELEVANCE_FILTERS
      });
    });
    expect(hook.result.current.linuxDoAiState.status).toBe('loading');

    await act(async () => {
      firstAi.resolve({ items: [{ ...aiOnlyTopic, id: 'stale' }], errors: {}, hasMore: false, nextPage: null });
      await firstAi.promise;
    });
    expect(hook.result.current.linuxDoAiState.status).toBe('loading');

    await act(async () => {
      secondAi.resolve({ items: [{ ...aiOnlyTopic, id: 'fresh' }], errors: {}, hasMore: false, nextPage: null });
      await secondAi.promise;
    });
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('ready'));

    await act(async () => {
      hook.result.current.setSearchQuery('third');
    });
    await act(async () => {
      await hook.result.current.runSearch({
        query: 'third',
        source: 'linuxdo',
        filters: LINUXDO_RELEVANCE_FILTERS
      });
    });
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('error'));
    await act(async () => hook.result.current.retryLinuxDoAiSearch());
    await waitFor(() => expect(hook.result.current.linuxDoAiState.status).toBe('ready'));
    expect(searchSemanticTopics).toHaveBeenCalledTimes(4);
    expect(
      diagnosticLines
        .map((line) => JSON.parse(line))
        .filter(({ operation, phase }) => operation === 'searchSemanticTopics' && phase === 'finish')
        .map(({ outcome }) => outcome)
    ).toEqual(['canceled', 'success', 'failure', 'success']);
  });

  it('records a transport rejection caused by Query cancellation as canceled', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest
      .fn<ReadGateway['searchSemanticTopics']>()
      .mockImplementationOnce(
        async ({ signal }) =>
          new Promise<SearchResponse>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true });
          })
      )
      .mockResolvedValueOnce({ items: [aiOnlyTopic], errors: {}, hasMore: false, nextPage: null });
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'first cancellation');

    await act(async () => {
      await hook.result.current.runSearch({
        query: 'first cancellation',
        source: 'linuxdo',
        filters: LINUXDO_RELEVANCE_FILTERS
      });
    });
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(1));
    await act(async () => {
      hook.result.current.setSearchQuery('replacement');
      await Promise.resolve();
    });
    await act(async () => {
      await hook.result.current.runSearch({
        query: 'replacement',
        source: 'linuxdo',
        filters: LINUXDO_RELEVANCE_FILTERS
      });
    });
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(2));

    expect(
      diagnosticLines
        .map((line) => JSON.parse(line))
        .filter(({ operation, phase }) => operation === 'searchSemanticTopics' && phase === 'finish')
        .map(({ outcome }) => outcome)
    ).toEqual(['canceled', 'success']);
  });

  it('does not expose or request AI search for latest-order results', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>();
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'latest only');

    await act(async () => {
      hook.result.current.applySearchFilter('linuxdo', { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'latest' });
    });
    await act(async () => {
      void hook.result.current.runSearch({ query: 'latest only', source: 'linuxdo' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));

    expect(searchSemanticTopics).not.toHaveBeenCalled();
    expect(hook.result.current.linuxDoAiVisible).toBe(false);
    expect(hook.result.current.linuxDoAiState.status).toBe('idle');
  });

  it('switches an authenticated linux.do 429 to the Google lane after account reconciliation confirms anonymous', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => {
      throw Object.assign(new Error('您执行此操作的次数过多，请稍后再试。'), { status: 429 });
    });
    const anonymousSession = createSiteSessionStates().linuxdo;
    const sessionViewModels: SiteSessionViewModels = {
      ...loggedInSessions,
      linuxdo: { ...loggedInSessions.linuxdo }
    };
    let sessionEpochs = initialForumSessionEpochs;
    const reconcileIdentityStatus = jest.fn<(source: SessionSource) => Promise<AccountReconcileResult>>(async () => {
      sessionViewModels.linuxdo = createSiteSessionViewModels(createSiteSessionStates()).linuxdo;
      resetForumSourceQueries('linuxdo', appQueryClient);
      sessionEpochs = { ...sessionEpochs, linuxdo: sessionEpochs.linuxdo + 1 };
      return { status: 'anonymous', session: anonymousSession };
    });
    const onOpenExternalSearch = jest.fn<(url: string) => void>();
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => sessionEpochs,
      sessionViewModels,
      jest.fn(),
      jest.fn(),
      () => aggregateSearchSources,
      reconcileIdentityStatus,
      onOpenExternalSearch
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'linuxdo' });
    });
    await waitFor(() => expect(reconcileIdentityStatus).toHaveBeenCalledTimes(1));
    await act(async () => hook.rerender(undefined));
    await waitFor(() =>
      expect(hook.result.current.searchGroups).toEqual([
        expect.objectContaining({
          source: 'linuxdo',
          externalSearchUrl: 'https://www.google.com/search?q=site%3Alinux.do+codex'
        })
      ])
    );

    expect(reconcileIdentityStatus).toHaveBeenCalledWith('linuxdo');
    expect(searchTopics).toHaveBeenCalledTimes(1);
    expect(hook.result.current.searchGroups[0]?.error).toBeUndefined();
    expect(onOpenExternalSearch).not.toHaveBeenCalled();
  });

  it('keeps the original linux.do 429 when account reconciliation confirms the same identity', async () => {
    const rateLimitMessage = '您执行此操作的次数过多，请稍后再试。';
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => {
      throw Object.assign(new Error(rateLimitMessage), { status: 429 });
    });
    const reconcileIdentityStatus = jest.fn<(source: SessionSource) => Promise<AccountReconcileResult>>(async () => ({
      status: 'same',
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: ['session-present'],
        isVerifying: false
      }
    }));
    const onOpenExternalSearch = jest.fn<(url: string) => void>();
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInSessions,
      jest.fn(),
      jest.fn(),
      () => aggregateSearchSources,
      reconcileIdentityStatus,
      onOpenExternalSearch
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'linuxdo' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.error).toBe(rateLimitMessage));

    expect(reconcileIdentityStatus).toHaveBeenCalledTimes(1);
    expect(hook.result.current.searchGroups[0]?.externalSearchUrl).toBeUndefined();
    expect(onOpenExternalSearch).not.toHaveBeenCalled();
  });

  it('shows a combined linux.do status when 429 reconciliation is unknown without blocking aggregate siblings', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => {
      if (source === 'linuxdo') {
        throw Object.assign(new Error('您执行此操作的次数过多，请稍后再试。'), { status: 429 });
      }
      return {
        items: [{ ...standardTopic, source: source as Source, id: `${source}-result` }],
        errors: {},
        hasMore: false,
        nextPage: null
      };
    });
    const reconcileIdentityStatus = jest.fn<(source: SessionSource) => Promise<AccountReconcileResult>>(async () => ({
      status: 'unknown',
      error: '账号接口暂时不可用',
      errorInfo: {
        kind: 'ordinary',
        message: '账号接口暂时不可用',
        reason: 'account_probe_failed',
        retryable: true
      }
    }));
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInSessions,
      jest.fn(),
      jest.fn(),
      () => aggregateSearchSources,
      reconcileIdentityStatus
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'all' });
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));

    expect(reconcileIdentityStatus).toHaveBeenCalledTimes(1);
    expect(hook.result.current.searchGroups.find(({ source }) => source === 'linuxdo')).toMatchObject({
      error: 'linux.do 登录状态暂时无法确认；原站搜索同时返回频控，请稍后重试。'
    });
    expect(hook.result.current.searchGroups.find(({ source }) => source === 'v2ex')?.items).toEqual([
      expect.objectContaining({ id: 'v2ex-result' })
    ]);
    expect(hook.result.current.searchGroups.find(({ source }) => source === 'nodeseek')?.items).toEqual([
      expect.objectContaining({ id: 'nodeseek-result' })
    ]);
    expect(loggedInSessions.linuxdo.isLoggedIn).toBe(true);
  });

  it('does not expose data from the previous credential scope while the replacement query loads', async () => {
    const replacement = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest
      .fn<ReadGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      })
      .mockImplementationOnce(async () => replacement.promise);
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>().mockResolvedValue({
      items: [],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    let sessionEpochs = initialForumSessionEpochs;
    const hook = await renderSearchController(
      createGateway({ searchSemanticTopics, searchTopics }),
      jest.fn(),
      jest.fn(),
      () => sessionEpochs
    );

    await act(async () => {
      void hook.result.current.runSearch({
        query: 'session result',
        source: 'linuxdo',
        filters: {
          ...DEFAULT_SEARCH_FILTERS,
          linuxdo: { ...DEFAULT_SEARCH_FILTERS.linuxdo, order: 'latest' }
        }
      });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items).toEqual([standardTopic]));

    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient);
      sessionEpochs = { ...sessionEpochs, linuxdo: sessionEpochs.linuxdo + 1 };
      hook.rerender(undefined);
    });

    expect(hook.result.current.searchGroups).toEqual([]);
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(2));
    expect(hook.result.current.searchBusy).toBe(true);
    expect(hook.result.current.linuxDoAiState.status).toBe('idle');

    await act(async () => {
      replacement.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
      await replacement.promise;
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
  });

  it('exposes an external search for an unknown public source while keeping AI blocked', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>(async () => ({
      items: [aiOnlyTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const unknownSessions: SiteSessionViewModels = {
      ...loggedInSessions,
      linuxdo: {
        ...loggedInSessions.linuxdo,
        canWrite: false,
        identityTrust: 'unknown',
        summaryLabel: '账号状态尚未核对'
      }
    };
    const onOpenExternalSearch = jest.fn<(url: string) => void>();
    const hook = await renderSearchController(
      createGateway({ searchSemanticTopics, searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      unknownSessions,
      jest.fn(),
      jest.fn(),
      () => aggregateSearchSources,
      jest.fn(),
      onOpenExternalSearch
    );

    await prepareLinuxDoSearch(hook, 'pending identity');
    await act(async () => {
      await hook.result.current.runSearch();
      await Promise.resolve();
    });

    expect(searchTopics).not.toHaveBeenCalled();
    expect(searchSemanticTopics).not.toHaveBeenCalled();
    expect(hook.result.current.searchBusy).toBe(false);
    expect(hook.result.current.searchGroups).toEqual([
      expect.objectContaining({
        source: 'linuxdo',
        items: [],
        settled: true,
        externalSearchUrl: 'https://www.google.com/search?q=site%3Alinux.do+pending+identity'
      })
    ]);
    expect(onOpenExternalSearch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.linuxDoAiState.status).toBe('idle');
  });

  it('replaces an external entry with fresh native results after identity becomes confirmed', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const unknownLinuxDo: SiteSessionViewModels = {
      ...loggedInSessions,
      linuxdo: {
        ...loggedInSessions.linuxdo,
        canWrite: false,
        identityTrust: 'unknown',
        summaryLabel: '账号状态尚未核对'
      }
    };
    let sessionViewModels = unknownLinuxDo;
    const onOpenExternalSearch = jest.fn<(url: string) => void>();
    const gateway = createGateway({ searchTopics });
    gateway.getReadPlan = (source: Source, operation: ForumReadOperation) =>
      resolveForumReadPlan(
        source,
        operation,
        true,
        isSessionSource(source)
          ? {
              source,
              authenticated: sessionViewModels[source].isLoggedIn,
              authSurfaceOpen: false,
              identityKey: `${source}:test`,
              identityTrust: sessionViewModels[source].identityTrust,
              sessionEpoch: 0,
              sourceEnabled: true
            }
          : undefined
      );
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [],
          enabledSearchSources: ['linuxdo'],
          sessionEpochs: initialForumSessionEpochs,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          active: true,
          onOpenExternalSearch,
          reconcileIdentityStatus: reconcileSameIdentity,
          sessionViewModels,
          showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          readGateway: gateway
        }),
      { wrapper: QueryTestWrapper }
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'identity scope', source: 'linuxdo' });
    });
    expect(searchTopics).not.toHaveBeenCalled();
    expect(onOpenExternalSearch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.searchGroups[0]).toMatchObject({
      source: 'linuxdo',
      externalSearchUrl: 'https://www.google.com/search?q=site%3Alinux.do+identity+scope'
    });

    sessionViewModels = loggedInSessions;
    await act(async () => {
      hook.rerender(undefined);
    });

    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.items).toEqual([standardTopic]));
    expect(onOpenExternalSearch).toHaveBeenCalledTimes(1);
    const readPlanScopes = appQueryClient
      .getQueryCache()
      .getAll()
      .filter(({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === 'linuxdo' && queryKey[2] === 'search')
      .map(({ queryKey }) => (queryKey[3] as { readPlanScope?: string }).readPlanScope);
    expect(readPlanScopes).toEqual(expect.arrayContaining(['public:omit', 'authenticated:0']));
  });

  it('settles an unknown forum source as an external action inside aggregate search', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => ({
      items: [{ ...standardTopic, source: source as Source, id: source }],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const unknownSessions: SiteSessionViewModels = {
      ...loggedInSessions,
      nodeseek: {
        ...loggedInSessions.nodeseek,
        status: 'logged-in',
        isLoggedIn: true,
        canWrite: false,
        identityTrust: 'unknown',
        summaryLabel: '账号状态尚未核对'
      }
    };
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      unknownSessions
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'aggregate pending', source: 'all' });
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));

    expect(searchTopics.mock.calls.map(([request]) => request.source)).toEqual(['v2ex', 'linuxdo']);
    expect(hook.result.current.searchGroups.find(({ source }) => source === 'nodeseek')).toMatchObject({
      items: [],
      settled: true,
      externalSearchUrl: 'https://www.google.com/search?q=site%3Anodeseek.com+aggregate+pending'
    });
  });

  it('settles a timed-out private source and retries identity from all or single-source search', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async () => ({
      items: [],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const reconcileIdentityStatus =
      jest.fn<(source: SessionSource) => Promise<AccountReconcileResult>>(reconcileSameIdentity);
    const pendingSessions: SiteSessionViewModels = {
      ...loggedInSessions,
      yaohuo: {
        ...loggedInSessions.yaohuo,
        canWrite: false,
        identityTrust: 'unknown',
        summaryLabel: '登录状态核对失败'
      }
    };
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      pendingSessions,
      jest.fn(),
      jest.fn(),
      () => ['yaohuo'],
      reconcileIdentityStatus
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'aggregate terminal', source: 'all' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups).toHaveLength(1));
    expect(searchTopics).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
    expect(hook.result.current.searchGroups[0]).toMatchObject({
      source: 'yaohuo',
      error: '登录状态核对失败，请重试',
      loading: false
    });
    expect(hook.result.current.searchGroups[0]?.settled).not.toBe(false);
    expect(reconcileIdentityStatus).not.toHaveBeenCalled();
    await act(async () => {
      hook.result.current.retrySearchSource('yaohuo');
    });
    expect(reconcileIdentityStatus).toHaveBeenCalledTimes(1);
    expect(reconcileIdentityStatus).toHaveBeenLastCalledWith('yaohuo');

    await act(async () => {
      await hook.result.current.runSearch({ query: 'single terminal', source: 'yaohuo' });
    });
    await waitFor(() => expect(hook.result.current.searchGroups[0]?.error).toBe('登录状态核对失败，请重试'));
    expect(searchTopics).not.toHaveBeenCalled();
    expect(reconcileIdentityStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      hook.result.current.retrySearchSource('yaohuo');
    });
    expect(reconcileIdentityStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps an unrelated source search in flight when another credential session changes', async () => {
    const pendingSearch = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(() => pendingSearch.promise);
    const hook = await renderSearchController(createGateway({ searchTopics }));

    await act(async () => {
      hook.result.current.setSearchSource('v2ex');
      hook.result.current.setSearchQuery('v2ex request');
    });
    await waitFor(() => {
      expect(hook.result.current.searchSource).toBe('v2ex');
      expect(hook.result.current.searchQuery).toBe('v2ex request');
    });

    await act(async () => {
      void hook.result.current.runSearch({ query: 'v2ex request', source: 'v2ex' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
    });
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      pendingSearch.resolve({ items: [standardTopic], errors: {}, hasMore: false, nextPage: null });
      await pendingSearch.promise;
    });

    await waitFor(() =>
      expect(hook.result.current.searchGroups).toEqual([
        expect.objectContaining({ source: 'v2ex', items: [standardTopic], loading: false })
      ])
    );
  });

  it('lets unaffected aggregate search sources finish when one source session changes', async () => {
    const sources: Source[] = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];
    const requestSources = sources.filter((source) => source !== 'yaohuo');
    const pendingSearches = new Map<Source, ReturnType<typeof Promise.withResolvers<SearchResponse>>>(
      requestSources.map((source) => [source, Promise.withResolvers<SearchResponse>()])
    );
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(
      ({ source }) => pendingSearches.get(source as Source)!.promise
    );
    const hook = await renderSearchController(createGateway({ searchTopics }));

    await act(async () => {
      void hook.result.current.runSearch({ query: 'aggregate request', source: 'all' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(3));
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
    });
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      for (const source of requestSources) {
        pendingSearches.get(source)!.resolve({
          items: source === 'nodeseek' ? [] : [{ ...standardTopic, source, id: source }],
          errors: {},
          hasMore: false,
          nextPage: null
        });
      }
      await Promise.all([...pendingSearches.values()].map(({ promise }) => promise));
    });

    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
    expect(hook.result.current.searchGroups.map(({ source }) => source)).toEqual(sources);
  });

  it('keeps settled aggregate groups stable across an unrelated rerender', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => ({
      items: [{ ...standardTopic, source: source === 'all' ? 'v2ex' : source, id: `${source}-stable` }],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderSearchController(createGateway({ searchTopics }));

    await act(async () => {
      await hook.result.current.runSearch({ query: 'stable aggregate', source: 'all' });
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
    const searchGroups = hook.result.current.searchGroups;

    await act(async () => hook.rerender({}));

    expect(hook.result.current.searchGroups).toBe(searchGroups);
    expect(searchTopics).toHaveBeenCalledTimes(3);
  });

  it('keeps settled single-source groups stable across an unrelated rerender', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => ({
      items: [{ ...standardTopic, source: source === 'all' ? 'v2ex' : source, id: `${source}-stable` }],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const hook = await renderSearchController(createGateway({ searchTopics }));

    await act(async () => {
      await hook.result.current.runSearch({ query: 'stable single', source: 'v2ex' });
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
    const searchGroups = hook.result.current.searchGroups;

    await act(async () => hook.rerender({}));

    expect(hook.result.current.searchGroups).toBe(searchGroups);
    expect(searchTopics).toHaveBeenCalledTimes(1);
  });

  it('aborts a removed aggregate source without interrupting an enabled source', async () => {
    const requests = new Map<
      Source,
      {
        deferred: ReturnType<typeof Promise.withResolvers<SearchResponse>>;
        signal: AbortSignal;
      }
    >();
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(({ source, signal }) => {
      if (source === 'all' || !signal) throw new Error('aggregate Search must dispatch one signaled source request');
      const deferred = Promise.withResolvers<SearchResponse>();
      signal.addEventListener('abort', () => deferred.reject(new DOMException('aborted', 'AbortError')), {
        once: true
      });
      requests.set(source, { deferred, signal });
      return deferred.promise;
    });
    let enabledSearchSources: readonly Source[] = ['v2ex', 'nodeseek'];
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInSessions,
      jest.fn(),
      jest.fn(),
      () => enabledSearchSources
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'enabled sources', source: 'all' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(2));

    enabledSearchSources = ['v2ex'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(requests.get('nodeseek')?.signal.aborted).toBe(true));
    expect(requests.get('v2ex')?.signal.aborted).toBe(false);
    await act(async () => {
      requests.get('v2ex')?.deferred.resolve({
        items: [{ ...standardTopic, source: 'v2ex', id: 'v2ex-enabled' }],
        errors: {},
        hasMore: false,
        nextPage: null
      });
      await requests.get('v2ex')?.deferred.promise;
    });

    await waitFor(() => expect(hook.result.current.searchGroups.map(({ source }) => source)).toEqual(['v2ex']));
  });

  it('reorders aggregate groups without refetching and settles an empty source set', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => {
      if (source === 'all') throw new Error('aggregate Search must dispatch one source request');
      return {
        items: [{ ...standardTopic, source, id: `${source}-enabled` }],
        errors: {},
        hasMore: false,
        nextPage: null
      };
    });
    let enabledSearchSources: readonly Source[] = ['v2ex', 'linuxdo'];
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInSessions,
      jest.fn(),
      jest.fn(),
      () => enabledSearchSources
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'ordered sources', source: 'all' });
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
    expect(searchTopics).toHaveBeenCalledTimes(2);

    enabledSearchSources = ['linuxdo', 'v2ex'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(searchTopics).toHaveBeenCalledTimes(2);
    expect(hook.result.current.searchGroups.map(({ source }) => source)).toEqual(['linuxdo', 'v2ex']);
    expect(hook.result.current.searchSource).toBe('all');
    expect(hook.result.current.submittedSearchQuery).toBe('ordered sources');

    enabledSearchSources = [];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(searchTopics).toHaveBeenCalledTimes(2);
    expect(hook.result.current.searchGroups).toEqual([]);
    expect(hook.result.current.searchBusy).toBe(false);
    expect(hook.result.current.searchQuery).toBe('ordered sources');
    await act(async () => {
      await hook.result.current.runSearch();
    });
    expect(searchTopics).toHaveBeenCalledTimes(2);
  });

  it('gates a disabled direct Search across queries, retries, pagination, AI and filter candidates', async () => {
    const searchTopics = jest.fn<ReadGateway['searchTopics']>(async ({ source }) => ({
      items: [{ ...standardTopic, source: source === 'all' ? 'v2ex' : source, id: `${source}-result` }],
      errors: {},
      hasMore: true,
      nextPage: 2
    }));
    const searchSemanticTopics = jest.fn<ReadGateway['searchSemanticTopics']>(async () => {
      throw new Error('AI unavailable');
    });
    const readGateway = createGateway({ searchSemanticTopics, searchTopics });
    const searchTagOptions = readGateway.searchTagOptions as jest.MockedFunction<ReadGateway['searchTagOptions']>;
    const searchUserOptions = readGateway.searchUserOptions as jest.MockedFunction<ReadGateway['searchUserOptions']>;
    let enabledSearchSources: readonly Source[] = ['linuxdo', 'v2ex'];
    const hook = await renderSearchController(
      readGateway,
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      loggedInSessions,
      jest.fn(),
      jest.fn(),
      () => enabledSearchSources
    );

    await act(async () => {
      hook.result.current.setSearchSource('linuxdo');
      hook.result.current.setSearchQuery('direct source');
    });
    await act(async () => {
      await hook.result.current.runSearch({
        query: 'direct source',
        source: 'linuxdo',
        filters: LINUXDO_RELEVANCE_FILTERS
      });
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(1));
    expect(searchTopics).toHaveBeenCalledTimes(1);

    enabledSearchSources = ['v2ex', 'linuxdo'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    expect(hook.result.current.searchSource).toBe('linuxdo');
    expect(hook.result.current.submittedSearchQuery).toBe('direct source');
    expect(hook.result.current.searchGroups.map(({ source }) => source)).toEqual(['linuxdo']);
    expect(searchTopics).toHaveBeenCalledTimes(1);
    expect(searchSemanticTopics).toHaveBeenCalledTimes(1);

    enabledSearchSources = ['v2ex'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(hook.result.current.searchSource).toBe('all'));
    await waitFor(() => expect(hook.result.current.searchGroups.map(({ source }) => source)).toEqual(['v2ex']));
    expect(hook.result.current.submittedSearchQuery).toBe('direct source');
    expect(hook.result.current.searchQuery).toBe('direct source');
    const ordinaryRequestCount = searchTopics.mock.calls.length;
    const aiRequestCount = searchSemanticTopics.mock.calls.length;

    let loadOutcome: Awaited<ReturnType<typeof hook.result.current.loadMoreSearchSource>> | undefined;
    let runOutcome: Awaited<ReturnType<typeof hook.result.current.runSearch>> | undefined;
    await act(async () => {
      hook.result.current.setSearchSource('linuxdo');
      hook.result.current.retrySearchSource('linuxdo');
      loadOutcome = await hook.result.current.loadMoreSearchSource('linuxdo', 2);
      runOutcome = await hook.result.current.runSearch({ query: 'disabled source', source: 'linuxdo' });
      hook.result.current.applySearchFilter('linuxdo', {
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        order: 'latest'
      });
      hook.result.current.retryLinuxDoAiSearch();
      await hook.result.current.searchDiscourseTags({ source: 'linuxdo', query: 'ai', selectedTags: [] });
      await hook.result.current.searchDiscourseUsers({ source: 'linuxdo', term: 'alice' });
      await Promise.resolve();
    });

    expect(loadOutcome).toBe('stale');
    expect(runOutcome).toBe('stale');
    expect(hook.result.current.searchSource).toBe('all');
    expect(hook.result.current.searchQuery).toBe('direct source');
    expect(hook.result.current.searchFilters.linuxdo).toEqual(DEFAULT_SEARCH_FILTERS.linuxdo);
    expect(searchTopics).toHaveBeenCalledTimes(ordinaryRequestCount);
    expect(searchSemanticTopics).toHaveBeenCalledTimes(aiRequestCount);
    expect(searchTagOptions).not.toHaveBeenCalled();
    expect(searchUserOptions).not.toHaveBeenCalled();
    expect(
      appQueryClient
        .getQueryCache()
        .findAll({
          predicate: ({ queryKey }) => queryKey[0] === 'forum' && queryKey[1] === 'linuxdo'
        })
        .every((query) => query.state.fetchStatus === 'idle')
    ).toBe(true);
  });
});
