import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useSearchCandidateQueries, useSearchController } from '../../src/app/useSearchController';
import type { Screen } from '../../src/appTypes';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';
import { setDiagnosticWriter } from '../../src/diagnostics';
import { DEFAULT_SEARCH_FILTERS, type SearchFilterState } from '../../src/searchFilters';
import { createSiteSessionStates, createSiteSessionViewModels } from '../../src/siteSessionState';
import type { SiteSessionViewModels } from '../../src/siteSessionState';
import { annotateSourceDiagnosticSummary } from '../../src/sourceAdapterDiagnostics';
import type { SourceGateway } from '../../src/sources/sourceGateway';
import type { SearchResponse, Source, Topic } from '../../src/types';
import { appQueryClient, initialForumSessionEpochs, type ForumSessionEpochs } from '../../src/app/serverState';
import { resetForumSourceQueries } from '../../src/app/sessionControllerHelpers';
import { QueryTestWrapper } from './QueryTestWrapper';

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

const loggedInSessions = createSiteSessionViewModels(
  createSiteSessionStates({
    linuxdo: {
      site: 'linuxdo',
      status: 'logged-in',
      cookieSummary: ['session-present'],
      isVerifying: false
    }
  })
);

function createGateway({
  searchSemanticTopics,
  searchTopics
}: {
  searchSemanticTopics?: SourceGateway['searchSemanticTopics'];
  searchTopics: SourceGateway['searchTopics'];
}) {
  return {
    searchSemanticTopics:
      searchSemanticTopics ??
      jest.fn<SourceGateway['searchSemanticTopics']>(async () => ({
        items: [],
        errors: {},
        hasMore: false,
        nextPage: null
      })),
    searchTagOptions: jest.fn(async () => []),
    searchUserOptions: jest.fn(async () => []),
    searchTopics
  } as unknown as SourceGateway;
}

function renderSearchController(
  sourceGateway: SourceGateway,
  notify = jest.fn<(message: string) => void>(),
  showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
  getSessionEpochs: () => ForumSessionEpochs = () => initialForumSessionEpochs,
  sessionViewModels: SiteSessionViewModels = loggedInSessions,
  showNodeSeekVerification = jest.fn<(message?: string) => void>(),
  showYaohuoLogin = jest.fn<(message?: string) => void>()
) {
  appQueryClient.clear();
  return renderHook(
    () =>
      useSearchController({
        categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
        sessionEpochs: getSessionEpochs(),
        linuxDoVerificationActive: false,
        notify,
        screen: 'search',
        sessionViewModels,
        showLinuxDoVerification,
        showNodeSeekVerification,
        showYaohuoLogin,
        sourceGateway
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

  it('[REG-SEARCH-006] keeps the first search submit enabled before any Query has started', async () => {
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async () => ({
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

  it('[REG-SEARCH-011] exposes a same-key source refetch as busy until the replacement settles', async () => {
    const replacement = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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

  it('[REG-SEARCH-012] does not open an action panel for a result whose input was just replaced', async () => {
    const pending = Promise.withResolvers<SearchResponse>();
    const showNodeSeekVerification = jest.fn<(message?: string) => void>();
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async () => pending.promise);
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

  it('[REG-LINUXDO-005] selects anonymous search until linux.do identity is confirmed', async () => {
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const unconfirmedSessions = createSiteSessionViewModels(
      createSiteSessionStates({
        linuxdo: {
          site: 'linuxdo',
          status: 'verified',
          cookieSummary: ['cf_clearance', '_t'],
          isVerifying: false
        }
      })
    );
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      unconfirmedSessions
    );
    await prepareLinuxDoSearch(hook, 'codex');

    await act(async () => {
      await hook.result.current.runSearch();
    });

    await waitFor(() =>
      expect(searchTopics).toHaveBeenCalledWith(expect.objectContaining({ source: 'linuxdo' }), expect.any(Object))
    );
    expect(
      appQueryClient
        .getQueryCache()
        .getAll()
        .some(
          ({ queryKey }) =>
            queryKey[0] === 'forum' &&
            queryKey[1] === 'linuxdo' &&
            queryKey[2] === 'search' &&
            (queryKey[3] as { authenticated?: boolean })?.authenticated === false
        )
    ).toBe(true);
    expect(hook.result.current.linuxDoAiState).toMatchObject({ status: 'idle', enabled: false });
  });

  it('[REG-LINUXDO-006] keeps the active authenticated search identity while verification is in progress', async () => {
    const restartedSearch = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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
    const sourceGateway = createGateway({ searchTopics });
    let sessionViewModels = loggedInSessions;
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
          sessionEpochs: initialForumSessionEpochs,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          screen: 'search',
          sessionViewModels,
          showLinuxDoVerification,
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          sourceGateway
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

  it('[REG-LINUXDO-006] aborts an owned search after leaving Search and does not restart it for a new credential scope', async () => {
    const pendingSearch = Promise.withResolvers<SearchResponse>();
    let requestSignal: AbortSignal | undefined;
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async (options) => {
      requestSignal = options.signal;
      return pendingSearch.promise;
    });
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const showNodeSeekVerification = jest.fn<(message?: string) => void>();
    const showYaohuoLogin = jest.fn<(message?: string) => void>();
    const sourceGateway = createGateway({ searchTopics });
    let screen: Screen = 'search';
    let sessionEpochs = initialForumSessionEpochs;
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
          sessionEpochs,
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          screen,
          sessionViewModels: loggedInSessions,
          showLinuxDoVerification,
          showNodeSeekVerification,
          showYaohuoLogin,
          sourceGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await prepareLinuxDoSearch(hook, 'codex');
    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'linuxdo' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(1));

    screen = 'more';
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

  it('[REG-LINUXDO-006] pauses an in-flight AI read while verification is open and resumes it after closing', async () => {
    const aiSignals: AbortSignal[] = [];
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>(async ({ signal }) => {
      if (signal) aiSignals.push(signal);
      if (aiSignals.length === 1) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      return { items: [aiOnlyTopic], errors: {}, hasMore: false, nextPage: null };
    });
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const sourceGateway = createGateway({ searchSemanticTopics, searchTopics });
    let linuxDoVerificationActive = false;
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [{ source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' }],
          sessionEpochs: initialForumSessionEpochs,
          linuxDoVerificationActive,
          notify: jest.fn(),
          screen: 'search',
          sessionViewModels: loggedInSessions,
          showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
          showNodeSeekVerification: jest.fn<(message?: string) => void>(),
          showYaohuoLogin: jest.fn<(message?: string) => void>(),
          sourceGateway
        }),
      { wrapper: QueryTestWrapper }
    );
    await prepareLinuxDoSearch(hook, 'codex');
    await act(async () => {
      await hook.result.current.runSearch({ query: 'codex', source: 'linuxdo' });
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

  it('[REG-LINUXDO-006] cancels candidate reads while verification is open and resumes the current request after closing', async () => {
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

  it('REG-LINUXDO-002 resumes the exact foreground search without recursively reopening verification', async () => {
    const showLinuxDoVerification = jest.fn();
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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

  it('REG-LINUXDO-003 reports an ordinary search recovery failure instead of completed', async () => {
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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

  it('REG-LINUXDO-002 preserves the loaded search page across session reset before resuming pagination', async () => {
    const secondPageTopic: Topic = {
      ...standardTopic,
      id: '2',
      title: '第二页结果',
      url: 'https://linux.do/t/2'
    };
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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

  it('[REG-SEARCH-007] does not auto-open login or verification panels for aggregated search', async () => {
    const showLinuxDoVerification = jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>();
    const showNodeSeekVerification = jest.fn<(message?: string) => void>();
    const showYaohuoLogin = jest.fn<(message?: string) => void>();
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async ({ source }) => {
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
        searchTopics
      }),
      jest.fn(),
      showLinuxDoVerification,
      () => initialForumSessionEpochs,
      loggedInSessions,
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
    expect(searchTopics).toHaveBeenCalledTimes(5);
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

  it('[REG-SEARCH-009] keeps an initial source failure out of trusted Query data', async () => {
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async () => ({
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

  it('[REG-SEARCH-008] keeps trusted aggregate results visible with a retryable refresh error', async () => {
    let nodeSeekAttempts = 0;
    const nodeSeekTopic = {
      ...standardTopic,
      source: 'nodeseek' as const,
      id: 'ns-1',
      url: 'https://www.nodeseek.com/post-1-1'
    };
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async ({ source }) => {
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
    expect(searchTopics).toHaveBeenCalledTimes(10);
  });

  it('REG-SEARCH-004 judges a whole-source retry by that source instead of unrelated aggregate errors', async () => {
    const notify = jest.fn<(message: string) => void>();
    let nodeSeekAttempts = 0;
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async ({ source }) => {
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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
      .fn<SourceGateway['searchTopics']>()
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
        searchTopics: jest.fn<SourceGateway['searchTopics']>()
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
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const hook = await renderSearchController(
      createGateway({
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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
      .fn<SourceGateway['searchTopics']>()
      .mockImplementationOnce(async () => firstStandard.promise)
      .mockResolvedValueOnce({
        items: [{ ...standardTopic, id: '2', title: '普通第二页', url: 'https://linux.do/t/2' }],
        errors: {},
        hasMore: false,
        nextPage: null
      });
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>(async () => ai.promise);
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'codex');
    const filters: SearchFilterState = {
      ...DEFAULT_SEARCH_FILTERS,
      linuxdo: {
        ...DEFAULT_SEARCH_FILTERS.linuxdo,
        category: '4',
        tags: ['人工智能', '快问快答'],
        tagMatch: 'all',
        siteExtension: { source: 'linuxdo', expertResponse: true }
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

  it('REG-SEARCH-002 preserves the failed page cursor and retries that page', async () => {
    const secondPageTopic: Topic = {
      ...standardTopic,
      id: '2',
      title: '普通第二页',
      url: 'https://linux.do/t/2'
    };
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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

  it('[REG-SEARCH-010] retries a failed multi-page refresh instead of skipping to the next cursor', async () => {
    const secondPageTopic = {
      ...standardTopic,
      id: '2',
      title: '第二页',
      url: 'https://linux.do/t/2'
    };
    let requestCount = 0;
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async ({ page = 1 }) => {
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

  it('REG-SEARCH-005 does not append partial items from a failed search page', async () => {
    const partialTopic: Topic = {
      ...standardTopic,
      id: 'partial-2',
      title: '失败页的非权威条目',
      url: 'https://linux.do/t/partial-2'
    };
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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

  it('REG-SOURCE-002 treats a parse-empty search page as retryable instead of advancing the cursor', async () => {
    const secondPageTopic: Topic = {
      ...standardTopic,
      id: '2',
      title: '普通第二页',
      url: 'https://linux.do/t/2'
    };
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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

  it('REG-SOURCE-002 preserves existing results when a whole-source retry parses empty', async () => {
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
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
        searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
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
      .fn<SourceGateway['searchTopics']>()
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
      searchSemanticTopics: jest.fn<SourceGateway['searchSemanticTopics']>(),
      searchTopics
    });
    appQueryClient.clear();
    const hook = await renderHook(
      () =>
        useSearchController({
          categories: [],
          linuxDoVerificationActive: false,
          notify: jest.fn(),
          onNodeSeekSearchVerificationRequired: onVerificationRequired,
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
          screen: 'search',
          showLinuxDoVerification: jest.fn<(message?: string, recovery?: LinuxDoReadRecovery) => void>(),
          showNodeSeekVerification: jest.fn(),
          showYaohuoLogin: jest.fn(),
          sourceGateway: gateway
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
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>();
    const gateway = createGateway({ searchSemanticTopics, searchTopics });
    const searchTagOptions = jest.fn<SourceGateway['searchTagOptions']>(async () => [{ name: 'private-tag' }]);
    const searchUserOptions = jest.fn<SourceGateway['searchUserOptions']>(async () => [
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
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest
      .fn<SourceGateway['searchSemanticTopics']>()
      .mockImplementationOnce(async () => firstAi.promise)
      .mockImplementationOnce(async () => secondAi.promise)
      .mockRejectedValueOnce(Object.assign(new Error('limited'), { status: 429 }))
      .mockResolvedValueOnce({ items: [aiOnlyTopic], errors: {}, hasMore: false, nextPage: null });
    const hook = await renderSearchController(createGateway({ searchSemanticTopics, searchTopics }));
    await prepareLinuxDoSearch(hook, 'first');

    await act(async () => {
      await hook.result.current.runSearch();
    });
    await act(async () => {
      hook.result.current.setSearchQuery('second');
    });
    await act(async () => {
      await hook.result.current.runSearch({ query: 'second', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
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
      await hook.result.current.runSearch({ query: 'third', source: 'linuxdo', filters: DEFAULT_SEARCH_FILTERS });
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

  it('[REG-SOURCE-003] records a transport rejection caused by Query cancellation as canceled', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest
      .fn<SourceGateway['searchSemanticTopics']>()
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
      await hook.result.current.runSearch({ query: 'first cancellation', source: 'linuxdo' });
    });
    await waitFor(() => expect(searchSemanticTopics).toHaveBeenCalledTimes(1));
    await act(async () => {
      hook.result.current.setSearchQuery('replacement');
      await Promise.resolve();
    });
    await act(async () => {
      await hook.result.current.runSearch({ query: 'replacement', source: 'linuxdo' });
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
    const searchTopics = jest.fn<SourceGateway['searchTopics']>().mockResolvedValue({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    });
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>();
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

  it('does not expose data from the previous credential scope while the replacement query loads', async () => {
    const replacement = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest
      .fn<SourceGateway['searchTopics']>()
      .mockResolvedValueOnce({
        items: [standardTopic],
        errors: {},
        hasMore: false,
        nextPage: null
      })
      .mockImplementationOnce(async () => replacement.promise);
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>().mockResolvedValue({
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

  it('[REG-ACCOUNT-031] pauses a dirty single-source search and AI request without entering permanent loading', async () => {
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async () => ({
      items: [standardTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const searchSemanticTopics = jest.fn<SourceGateway['searchSemanticTopics']>(async () => ({
      items: [aiOnlyTopic],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const pendingSessions: SiteSessionViewModels = {
      ...loggedInSessions,
      linuxdo: {
        ...loggedInSessions.linuxdo,
        canWrite: false,
        identityTrust: 'pending',
        summaryLabel: '登录状态待确认'
      }
    };
    const hook = await renderSearchController(
      createGateway({ searchSemanticTopics, searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      pendingSessions
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
      expect.objectContaining({ source: 'linuxdo', settled: false, loading: false })
    ]);
    expect(hook.result.current.linuxDoAiState.status).toBe('idle');
  });

  it('[REG-ACCOUNT-031] skips only the dirty source during an aggregate search', async () => {
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(async ({ source }) => ({
      items: [{ ...standardTopic, source: source as Source, id: source }],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const pendingSessions: SiteSessionViewModels = {
      ...loggedInSessions,
      nodeseek: {
        ...loggedInSessions.nodeseek,
        status: 'logged-in',
        isLoggedIn: true,
        canWrite: false,
        identityTrust: 'pending',
        summaryLabel: '登录状态待确认'
      }
    };
    const hook = await renderSearchController(
      createGateway({ searchTopics }),
      jest.fn(),
      jest.fn(),
      () => initialForumSessionEpochs,
      pendingSessions
    );

    await act(async () => {
      await hook.result.current.runSearch({ query: 'aggregate pending', source: 'all' });
    });
    await waitFor(() => expect(hook.result.current.searchBusy).toBe(false));

    expect(searchTopics.mock.calls.map(([request]) => request.source)).toEqual([
      'v2ex',
      'linuxdo',
      'yaohuo',
      'xiaoyinsi'
    ]);
    expect(hook.result.current.searchGroups.find(({ source }) => source === 'nodeseek')).toMatchObject({
      items: [],
      loading: false,
      settled: false
    });
  });

  it('keeps an unrelated source search in flight when another credential session changes', async () => {
    const pendingSearch = Promise.withResolvers<SearchResponse>();
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(() => pendingSearch.promise);
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
    const sources: Source[] = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo', 'xiaoyinsi'];
    const pendingSearches = new Map(sources.map((source) => [source, Promise.withResolvers<SearchResponse>()]));
    const searchTopics = jest.fn<SourceGateway['searchTopics']>(
      ({ source }) => pendingSearches.get(source as Source)!.promise
    );
    const hook = await renderSearchController(createGateway({ searchTopics }));

    await act(async () => {
      void hook.result.current.runSearch({ query: 'aggregate request', source: 'all' });
    });
    await waitFor(() => expect(searchTopics).toHaveBeenCalledTimes(5));
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
    });
    expect(hook.result.current.searchBusy).toBe(true);

    await act(async () => {
      for (const source of sources) {
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
});
