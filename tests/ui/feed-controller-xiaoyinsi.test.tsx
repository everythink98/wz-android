import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useFeedController } from '../../src/app/useFeedController';
import { createEmptyReaderData } from '../../src/readerData';
import { annotateSourceDiagnosticSummary } from '../../src/sourceAdapterDiagnostics';
import type { SourceGateway } from '../../src/sources/sourceGateway';

describe('小隐寺 Feed controller', () => {
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
