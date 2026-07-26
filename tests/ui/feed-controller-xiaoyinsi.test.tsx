import { afterEach } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { useFeedController } from '../../src/app/useFeedController';
import type { Screen } from '../../src/appTypes';
import { createEmptyReaderData } from '../../src/readerData';
import { annotateSourceDiagnosticSummary } from '../../src/sourceAdapterDiagnostics';
import type { SourceGateway } from '../../src/sources/sourceGateway';
import {
  appQueryClient,
  initialForumSessionEpochs,
  type ForumIdentityBarrierSource
} from '../../src/app/serverState';
import { resetForumSourceQueries } from '../../src/app/sessionControllerHelpers';
import type { LinuxDoReadRecovery } from '../../src/app/useVerificationController';
import { QueryTestWrapper } from './QueryTestWrapper';

function renderHook<Result>(callback: () => Result) {
  appQueryClient.clear();
  return renderNativeHook(callback, { wrapper: QueryTestWrapper });
}

describe('小隐寺 Feed controller', () => {
  afterEach(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('[REG-FEED-007] does not replay a cached partial error after returning to Feed', async () => {
    const partialErrors = {
      v2ex: {
        kind: 'ordinary' as const,
        message: 'V2EX 暂时不可用'
      }
    };
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => ({
        items: [{
          source: 'linuxdo' as const,
          id: 'partial-page-topic',
          title: '可用来源主题',
          author: 'alice',
          url: 'https://linux.do/t/partial-page-topic',
          createdAt: '2026-07-26T00:00:00.000Z',
          replyCount: 0
        }],
        errors: partialErrors,
        hasMore: false,
        nextPage: null
      })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const notify = jest.fn();
    let screen: Screen = 'feed';
    const hook = await renderHook(() => useFeedController({
      linuxDoVerificationActive: false,
      notify,
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen,
      showLinuxDoVerification: jest.fn(),
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(sourceGateway.getFeed).toHaveBeenCalledTimes(1);

    screen = 'more';
    await act(async () => hook.rerender({}));
    screen = 'feed';
    await act(async () => hook.rerender({}));

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(sourceGateway.getFeed).toHaveBeenCalledTimes(1);
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
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    let sessionEpochs = initialForumSessionEpochs;
    let screen: Screen = 'feed';
    const hook = await renderHook(() => useFeedController({
      sessionEpochs,
      linuxDoVerificationActive: false,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen,
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));
    await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(1));

    screen = 'more';
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
    const sourceGateway = {
      getCategories,
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    let linuxDoVerificationActive = false;
    const hook = await renderHook(() => useFeedController({
      linuxDoVerificationActive,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification: jest.fn(),
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));
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

  it('[REG-LINUXDO-006] keeps shared categories on Search without starting Feed and cancels them after leaving both owners', async () => {
    const categorySignals: AbortSignal[] = [];
    const getCategories = jest.fn(async ({ signal }: { signal: AbortSignal }) => {
      categorySignals.push(signal);
      return new Promise<{ items: never[]; errors: Record<string, never> }>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    const getFeed = jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null }));
    const sourceGateway = {
      getCategories,
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    let screen: Screen = 'search';
    const hook = await renderHook(() => useFeedController({
      linuxDoVerificationActive: false,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen,
      showLinuxDoVerification: jest.fn(),
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));
    await waitFor(() => expect(getCategories).toHaveBeenCalledTimes(1));
    expect(getFeed).not.toHaveBeenCalled();

    screen = 'more';
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
    const sourceGateway = {
      getCategories,
      getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    let screen: Screen = 'feed';
    const hook = await renderHook(() => useFeedController({
      linuxDoVerificationActive: false,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen,
      showLinuxDoVerification: jest.fn(),
      showNodeSeekVerification,
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));
    await act(async () => hook.result.current.changeFeedSource('nodeseek'));
    await waitFor(() => expect(showNodeSeekVerification).toHaveBeenCalledTimes(1));
    showNodeSeekVerification.mockClear();

    screen = 'search';
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await act(async () => {
      sharedCategories.reject(new Error('共享分类读取失败'));
      await sharedCategories.promise.catch(() => undefined);
    });

    await act(async () => { await Promise.resolve(); });
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
      linuxDoVerificationActive: false,
      notify,
      readerData,
      readerDataLoaded: true,
      screen: 'feed',
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
    let sessionEpochs = initialForumSessionEpochs;
    const hook = await renderHook(() => useFeedController({
      sessionEpochs,
      linuxDoVerificationActive: false,
      notify,
      readerData,
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

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

  it('[REG-ACCOUNT-031] uses the trusted aggregate as a dirty placeholder but drops it across an epoch change', async () => {
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
    const dirtyRead = Promise.withResolvers<{
      items: Array<typeof oldTopic | typeof dirtyPublicTopic>;
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    const newEpochRead = Promise.withResolvers<{
      items: typeof newTopic[];
      errors: Record<string, never>;
      hasMore: false;
      nextPage: null;
    }>();
    let readCount = 0;
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed: jest.fn(async () => {
        readCount += 1;
        if (readCount === 1) {
          return { items: [oldTopic], errors: {}, hasMore: false, nextPage: null };
        }
        return readCount === 2 ? dirtyRead.promise : newEpochRead.promise;
      }),
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    let identityBarriers: ForumIdentityBarrierSource[] = [];
    let sessionEpochs = initialForumSessionEpochs;
    const hook = await renderHook(() => useFeedController({
      identityBarriers,
      sessionEpochs,
      linuxDoVerificationActive: false,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification: jest.fn(),
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([oldTopic]));

    identityBarriers = ['nodeseek'];
    await act(async () => {
      hook.rerender({});
      await Promise.resolve();
    });
    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledTimes(2));
    expect(hook.result.current.activeFeedState.items).toEqual([oldTopic]);

    await act(async () => {
      dirtyRead.resolve({ items: [dirtyPublicTopic], errors: {}, hasMore: false, nextPage: null });
      await dirtyRead.promise;
    });
    await waitFor(() => {
      expect(hook.result.current.activeFeedState.items).toHaveLength(2);
      expect(hook.result.current.activeFeedState.items).toEqual(expect.arrayContaining([oldTopic, dirtyPublicTopic]));
    });

    await act(async () => {
      resetForumSourceQueries('nodeseek', appQueryClient);
      sessionEpochs = { ...sessionEpochs, nodeseek: sessionEpochs.nodeseek + 1 };
      identityBarriers = [];
      hook.rerender({});
      await Promise.resolve();
    });

    await waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledTimes(3));
    expect(hook.result.current.activeFeedState.items).toEqual([]);

    await act(async () => {
      newEpochRead.resolve({ items: [newTopic], errors: {}, hasMore: false, nextPage: null });
      await newEpochRead.promise;
    });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([newTopic]));
  });

  it('[REG-ACCOUNT-031] does not start or manually refresh a dirty single-source feed', async () => {
    const getFeed = jest.fn(async (_options: Parameters<SourceGateway['getFeed']>[0]) => ({
      items: [],
      errors: {},
      hasMore: false,
      nextPage: null
    }));
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const hook = await renderHook(() => useFeedController({
      identityBarriers: ['nodeseek'],
      linuxDoVerificationActive: false,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification: jest.fn(),
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));
    await waitFor(() => expect(getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'all' }),
      expect.any(Object)
    ));

    await act(async () => {
      hook.result.current.changeFeedSource('nodeseek');
      await Promise.resolve();
    });
    await act(async () => {
      await hook.result.current.refreshFeed();
    });

    expect(getFeed.mock.calls.some(([request]) => request.source === 'nodeseek')).toBe(false);
    expect(hook.result.current.feedBusy).toBe(false);
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
      linuxDoVerificationActive: false,
      notify,
      readerData,
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

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
    const sourceGateway = {
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
    } as unknown as SourceGateway;
    const showLinuxDoVerification = jest.fn();
    const hook = await renderHook(() => useFeedController({
      linuxDoVerificationActive: false,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification,
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));

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
    const sourceGateway = {
      getCategories: jest.fn(async () => ({ items: [], errors: {} })),
      getFeed,
      hasYaohuoCredential: jest.fn(async () => false)
    } as unknown as SourceGateway;
    const showLinuxDoVerification = jest.fn();
    const hook = await renderHook(() => useFeedController({
      linuxDoVerificationActive: false,
      notify: jest.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification,
      showNodeSeekVerification: jest.fn(),
      showYaohuoLogin: jest.fn(),
      sourceGateway
    }));

    await act(async () => hook.result.current.changeFeedSource('linuxdo'));
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));
    await act(async () => { await hook.result.current.loadFeed(); });
    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic, secondTopic]));
    await act(async () => { await hook.result.current.refreshFeed(); });
    await waitFor(() => expect(showLinuxDoVerification).toHaveBeenCalledTimes(1));
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1] as LinuxDoReadRecovery;

    await act(async () => {
      await expect(recovery.resume()).resolves.toBe('completed');
    });

    expect(getFeed.mock.calls
      .filter(([request]) => request.source === 'linuxdo')
      .map(([request]) => request.page || 1)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic, secondTopic]);
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
      linuxDoVerificationActive: false,
      notify,
      readerData,
      readerDataLoaded: true,
      screen: 'feed',
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
      linuxDoVerificationActive: false,
      notify,
      readerData,
      readerDataLoaded: true,
      screen: 'feed',
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
      await hook.result.current.refreshFeed();
    });

    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]);
    expect(hook.result.current.activeFeedState.nextCursor).toBe('page-2');
  });

  it.each(['source-error', 'parse-empty'] as const)('[REG-SOURCE-002] does not append partial aggregate load-more results after %s', async (failure) => {
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
      linuxDoVerificationActive: false,
      notify,
      readerData,
      readerDataLoaded: true,
      screen: 'feed',
      showLinuxDoVerification,
      showNodeSeekVerification,
      showYaohuoLogin,
      sourceGateway
    }));

    await waitFor(() => expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]));
    await act(async () => {
      await hook.result.current.loadFeed();
    });

    expect(hook.result.current.activeFeedState.items).toEqual([firstTopic]);
    expect(hook.result.current.activeFeedState.nextCursor).toBe('page-2');
    await waitFor(() => expect(hook.result.current.activeFeedState.loadMoreFailureSignal).toBeGreaterThan(0));
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
      linuxDoVerificationActive: false,
      notify,
      readerData,
      readerDataLoaded: true,
      screen: 'feed',
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
