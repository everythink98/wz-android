import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFeedController } from '../../src/app/useFeedController';
import { createEmptyReaderData } from '../../src/readerData';
import { annotateSourceDiagnosticSummary } from '../../src/sourceAdapterDiagnostics';
import type { SourceGateway } from '../../src/sources/sourceGateway';
import { appQueryClient, resetForumSourceQueries } from '../../src/app/serverState';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';

describe('小隐寺 Feed controller', () => {
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
      items: typeof v2exTopic[];
      errors: Record<string, never>;
      hasMore: boolean;
      nextPage: null;
    }>();
    const getCategories = jest.fn(async ({ source }: { source: string }) => ({
      items: source === 'v2ex' ? [{ source: 'v2ex' as const, id: 'go', name: 'Go' }] : [],
      errors: {}
    }));
    const getFeed = jest.fn(async ({ source }: { source: string }) => source === 'v2ex'
      ? v2exFeed.promise
      : { items: [], errors: {}, hasMore: false, nextPage: null });
    const sourceGateway = {
      getCategories,
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await act(async () => hook.result.current.changeFeedSource('v2ex'));
    await waitFor(() => expect(getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'v2ex' }),
      expect.any(Object)
    ));
    await waitFor(() => expect(hook.result.current.categories).toContainEqual(expect.objectContaining({ source: 'v2ex', id: 'go' })));

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient, 'session-updated');
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
    const sourceGateway = {
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
    } as unknown as SourceGateway;
    const notify = jest.fn();
    const readerData = createEmptyReaderData();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await act(async () => hook.result.current.changeFeedSource('nodeseek'));
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([oldTopic]));

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient, 'session-updated');
    });

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([newTopic]));
    expect(nodeSeekReads).toBe(2);
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
    const sourceGateway = {
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
    } as unknown as SourceGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await act(async () => hook.result.current.changeFeedSource('linuxdo'));
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));
    await act(async () => {
      await hook.result.current.loadFeed({ source: 'linuxdo', page: 2, cursor: 'page-2' });
    });

    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;
    expect(recovery).toBeDefined();
    await act(async () => {
      resetForumSourceQueries('linuxdo', appQueryClient, 'session-updated', recovery.key);
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
    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic, secondTopic]);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('[REG-FEED-005] reports a single-source category error instead of treating it as an empty category list', async () => {
    const sourceGateway = {
      getCategories: jest.fn(async ({ source }: { source: string }) => source === 'all'
        ? { items: [], errors: {} }
        : { items: [], errors: { v2ex: { kind: 'ordinary' as const, message: '分类读取失败' } } }),
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const notify = jest.fn();
    const readerData = createEmptyReaderData();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await waitFor(() => expect(sourceGateway.getCategories).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'all' }),
      expect.any(Object)
    ));
    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => expect(sourceGateway.getCategories).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'v2ex' }),
      expect.any(Object)
    ));

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('分类读取失败'));
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
    const sourceGateway = {
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
    } as unknown as SourceGateway;
    const notify = jest.fn();
    const readerData = createEmptyReaderData();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await act(async () => {
      hook.result.current.changeFeedSource('v2ex');
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));

    await act(async () => {
      await hook.result.current.loadFeed({ source: 'v2ex', reset: true, nocache: true });
    });

    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]);
    expect(hook.result.current.activeFeedState.nextCursor).toBe('page-2');
  });

  it.each(['source-error', 'parse-empty'] as const)('does not append partial aggregate load-more results after %s', async (failure) => {
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
      errors: failure === 'source-error'
        ? { yaohuo: { kind: 'ordinary' as const, message: 'HTTP 500' } }
        : {},
      hasMore: true,
      nextPage: 3,
      nextCursor: 'page-3'
    };
    const secondPage = failure === 'parse-empty'
      ? annotateSourceDiagnosticSummary(partialPage, {
        parserVariant: 'aggregate-feed',
        candidateCount: 2,
        validCount: 1,
        droppedCount: 1,
        isParseEmpty: true
      })
      : partialPage;
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [
        { source: 'v2ex' as const, id: 'v2ex', name: 'V2EX' }
      ] })),
      getFeed: jest.fn(async ({ page = 1 }: { page?: number }) => page === 1
        ? { items: [firstTopic], errors: {}, hasMore: true, nextPage: 2, nextCursor: 'page-2' }
        : secondPage),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));
    await act(async () => {
      await hook.result.current.loadFeed({ source: 'all', page: 2, cursor: 'page-2' });
    });

    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]);
    expect(hook.result.current.activeFeedState.nextCursor).toBe('page-2');
    expect(hook.result.current.activeFeedState.loadMoreFailureSignal).toBe(1);
  });

  it('REG-XIAOYINSI-015 keeps its list filter state independent after a non-empty response', async () => {
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [
        { source: 'v2ex', id: 'v2ex', name: 'V2EX' },
        { source: 'linuxdo', id: 'linuxdo', name: 'linux.do' },
        { source: 'nodeseek', id: 'nodeseek', name: 'NodeSeek' },
        { source: 'yaohuo', id: 'yaohuo', name: '妖火' },
        { source: 'xiaoyinsi', id: 'xiaoyinsi', name: '小隐寺' }
      ] })),
      getFeed: jest.fn(async () => ({
        items: [{
          source: 'xiaoyinsi' as const,
          id: '1',
          title: '小隐寺主题',
          author: 'alice',
          url: 'https://forum.xiaoyinsi.com/t/1',
          createdAt: '2026-07-19T00:00:00.000Z',
          replyCount: 0
        }],
        errors: {},
        hasMore: false,
        nextPage: null
      })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const readerData = createEmptyReaderData();
    const notify = jest.fn();
    const showLinuxDoVerification = jest.fn();
    const showNodeSeekVerification = jest.fn();
    const showYaohuoLogin = jest.fn();
    const hook = await renderHook(() => useFeedController({
      notify,
      readerData,
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'all' }),
      expect.any(Object)
    ));
    await act(async () => {
      hook.result.current.changeFeedSource('xiaoyinsi');
    });
    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'latest' }),
      expect.any(Object)
    ));

    await act(async () => {
      hook.result.current.setFeedFilter('hot');
    });

    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'hot' }),
      expect.any(Object)
    ));
    expect(hook.result.current.feedFilter).toBe('hot');

    await act(async () => {
      hook.result.current.setFeedFilter('new-replies');
    });
    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'xiaoyinsi', feedFilter: 'new-replies' }),
      expect.any(Object)
    ));
    expect(hook.result.current.feedFilter).toBe('new-replies');
  });
});
