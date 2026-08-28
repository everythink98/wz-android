import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useAppRuntime } from '@/app/useAppRuntime';
import { useInitialForegroundRuntime } from '@/app/useInitialForegroundRuntime';
import type { ReaderData } from '@/domain/reader/readerData';

const mockUseAccountRuntime = jest.fn();
const mockUseAppUpdateRuntime = jest.fn();
const mockUseForumCatalogRuntime = jest.fn();
const mockHandleNavigationReady = jest.fn();
const mockNotificationNavigationReady = jest.fn();
let mockReaderData: ReaderData | undefined;
let mockReaderDataLoaded = true;
let mockSessionsReady = true;
let mockInitialForegroundReady = false;
let mockScreen = 'feed';
const mockReadGateway = { getEmojiUrls: jest.fn() };
const mockForumSessionEpochs = { linuxdo: 7, nodeseek: 7, yaohuo: 7 };
const mockOnFeedInitialContentReady = jest.fn(() => {
  mockInitialForegroundReady = true;
});

jest.mock('@/app/useAppLifecycleRuntime', () => ({
  useAppLifecycleRuntime: () => ({
    appActive: true,
    changeScreen: jest.fn(),
    getCurrentScreen: jest.fn(() => 'feed'),
    height: 800,
    initialForegroundReady: mockInitialForegroundReady,
    loginNavigation: {},
    notify: jest.fn(),
    onCatalogSettled: jest.fn(),
    onFeedInitialContentReady: mockOnFeedInitialContentReady,
    onReady: mockHandleNavigationReady,
    onScreenChange: jest.fn(),
    openUserRoute: jest.fn(),
    screen: mockScreen,
    width: 400
  })
}));

jest.mock('@/app/useReaderRuntime', () => ({
  useReaderRuntime: () => {
    const { createEmptyReaderData } =
      jest.requireActual<typeof import('@/domain/reader/readerData')>('@/domain/reader/readerData');
    const readerData = (mockReaderData ||= createEmptyReaderData());
    return {
      commitReaderData: jest.fn(),
      readerData,
      readerDataLoaded: mockReaderDataLoaded,
      readerDataRef: { current: readerData },
      replaceReaderData: jest.fn(),
      waitForReaderDataSave: jest.fn(async () => undefined)
    };
  }
}));

jest.mock('@/platform/network/useNetworkProxyRuntime', () => ({
  useNetworkProxyRuntime: () => ({
    activeProfile: null,
    applyError: '',
    applyStatus: 'loading',
    deleteProxyProfile: jest.fn(),
    ensureNetworkProxyReady: jest.fn(async () => {
      throw new Error('代理状态读取中。');
    }),
    loaded: false,
    networkProxyFetcher: jest.fn(async () => {
      throw new Error('代理状态读取中。');
    }),
    proxyState: { enabled: false, activeId: null, profiles: [] },
    selectProxyProfile: jest.fn(),
    setProxyEnabled: jest.fn(),
    summary: '代理状态读取中',
    testProxyProfile: jest.fn(),
    upsertProxyProfile: jest.fn(),
    webViewBlockMessage: '代理状态读取中。'
  })
}));

jest.mock('@/features/account/useAccountRuntime', () => ({
  useAccountRuntime: (options: unknown) => {
    mockUseAccountRuntime(options);
    return {
      center: {
        account: {
          linuxDoLevelBusy: false,
          linuxDoLevelError: '',
          linuxDoLevelProfile: null,
          refreshLinuxDoLevel: jest.fn()
        },
        checkIn: {},
        credentials: { credentialSummaries: [], pendingCredentialFillSite: null },
        handleAccountCenterCommand: jest.fn(),
        nodeImage: {
          key: {
            authorize: jest.fn(),
            busy: false,
            clear: jest.fn(),
            save: jest.fn(),
            saved: false
          }
        }
      },
      hosts: {
        closePanels: jest.fn(),
        closeTopmostSurface: jest.fn(),
        element: null,
        linuxDoVerificationVisible: false,
        requestNodeSeekVerification: jest.fn(),
        showLinuxDoVerification: jest.fn(),
        showYaohuoLogin: jest.fn(),
        surfaces: { linuxdo: {}, nodeseek: {}, yaohuo: {} }
      },
      read: {
        accountIdentityPending: false,
        accountSessionViewModels: { nodeseek: { isLoggedIn: false } },
        forumSessionEpochs: mockForumSessionEpochs,
        getLinuxDoUserAgent: jest.fn(),
        getNodeSeekUserAgent: jest.fn(),
        identityBarriers: {},
        readGateway: mockReadGateway,
        reconcileAccountStatus: jest.fn(),
        sessionsReady: mockSessionsReady,
        statusBusy: false
      },
      write: {
        ensureNodeImageApiKey: jest.fn(),
        ensureWritableSession: jest.fn(),
        isWritableSessionTicketCurrent: jest.fn(),
        reconcileWritableSession: jest.fn()
      }
    };
  }
}));

jest.mock('@/platform/update/useAppUpdateRuntime', () => ({
  useAppUpdateRuntime: (options: unknown) => {
    mockUseAppUpdateRuntime(options);
    return { appUpdateBusy: false, appUpdateDownloading: false, appUpdateInfo: null };
  }
}));

jest.mock('@/features/notifications/useNotificationsRuntime', () => ({
  useNotificationsRuntime: () => ({
    backgroundEnabled: false,
    onNavigationReady: mockNotificationNavigationReady,
    partialUnavailable: false,
    unreadTotal: 0
  })
}));

jest.mock('@/app/useForumCatalogRuntime', () => ({
  useForumCatalogRuntime: (options: unknown) => {
    mockUseForumCatalogRuntime(options);
    return { categories: [], settled: true };
  }
}));
jest.mock('@/app/useAppDiagnosticsRuntime', () => ({ useAppDiagnosticsRuntime: () => ({ metadata: {} }) }));
jest.mock('@/app/useAppBackHandler', () => ({ useAppBackHandler: jest.fn() }));
jest.mock('@/app/useContentSourceQueryCleanup', () => ({ useContentSourceQueryCleanup: jest.fn() }));

describe('app runtime startup', () => {
  beforeEach(() => {
    mockReaderDataLoaded = true;
    mockSessionsReady = true;
    mockInitialForegroundReady = false;
    mockScreen = 'feed';
    mockOnFeedInitialContentReady.mockClear();
    mockHandleNavigationReady.mockClear();
    mockNotificationNavigationReady.mockClear();
    mockUseAccountRuntime.mockClear();
    mockUseAppUpdateRuntime.mockClear();
    mockUseForumCatalogRuntime.mockClear();
  });

  it('exposes local routes while keeping WebViews blocked during proxy load', async () => {
    const hook = await renderHook(() => useAppRuntime());

    expect(hook.result.current.routes).not.toBeNull();
    expect(hook.result.current.routes?.libraryRouteRuntime).toBeDefined();
    expect(hook.result.current.routes?.moreRouteRuntime).toBeDefined();
    expect(mockUseAccountRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ webViewBlockMessage: '代理状态读取中。' })
    );
  });

  it('keeps the navigation ready callback stable and preserves callback order', async () => {
    const hook = await renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useAppRuntime();
      },
      { initialProps: { revision: 0 } }
    );
    const onReady = hook.result.current.routes!.onReady;

    await act(async () => hook.rerender({ revision: 1 }));

    expect(hook.result.current.routes!.onReady).toBe(onReady);
    onReady();
    expect(mockNotificationNavigationReady).toHaveBeenCalledTimes(1);
    expect(mockHandleNavigationReady).toHaveBeenCalledTimes(1);
    expect(mockNotificationNavigationReady.mock.invocationCallOrder[0]).toBeLessThan(
      mockHandleNavigationReady.mock.invocationCallOrder[0]!
    );
  });

  it('shares one Reader index and ignores unrelated ReaderData changes', async () => {
    mockReaderData = undefined;
    const hook = await renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useAppRuntime();
      },
      { initialProps: { revision: 0 } }
    );
    const routes = hook.result.current.routes!;
    const feedIndex = (routes.feedRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex;

    expect(feedIndex).toBeDefined();
    expect((routes.searchRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex).toBe(feedIndex);
    expect((routes.libraryRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex).toBe(feedIndex);
    expect((routes.userRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex).toBe(feedIndex);

    mockReaderData = { ...mockReaderData!, followedUsers: { ...mockReaderData!.followedUsers } };
    await act(async () => hook.rerender({ revision: 1 }));
    expect(
      (hook.result.current.routes!.feedRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex
    ).toBe(feedIndex);

    mockReaderData = { ...mockReaderData!, favorites: { ...mockReaderData!.favorites } };
    await act(async () => hook.rerender({ revision: 2 }));
    expect(
      (hook.result.current.routes!.feedRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex
    ).not.toBe(feedIndex);
  });

  it('settles only after Feed and Categories reach terminal state', async () => {
    const hook = await renderHook(() => useInitialForegroundRuntime());

    expect(hook.result.current.initialForegroundReady).toBe(false);
    await act(async () => hook.result.current.onFeedInitialContentReady());
    expect(hook.result.current.initialForegroundReady).toBe(false);
    await act(async () => hook.result.current.onCatalogSettled(true));
    expect(hook.result.current.initialForegroundReady).toBe(true);
    await act(async () => hook.result.current.onCatalogSettled(false));
    expect(hook.result.current.initialForegroundReady).toBe(true);
  });

  it('ignores the empty catalog projection before ReaderData is loaded', async () => {
    mockReaderDataLoaded = false;
    const hook = await renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useAppRuntime();
      },
      { initialProps: { revision: 0 } }
    );

    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false, onSettled: undefined })
    );

    mockReaderDataLoaded = true;
    await act(async () => hook.rerender({ revision: 1 }));
    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true, onSettled: expect.any(Function) })
    );
  });

  it('starts foreground transport immediately and background work after first Feed content', async () => {
    const hook = await renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useAppRuntime();
      },
      { initialProps: { revision: 0 } }
    );

    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ readGateway: mockReadGateway, sessionEpochs: mockForumSessionEpochs })
    );
    expect(mockUseAccountRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }));
    expect(mockUseAppUpdateRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ autoCheck: false }));
    expect(hook.result.current.routes!.feedRouteRuntime.account.readGateway).toBe(mockReadGateway);
    expect(hook.result.current.routes!.feedRouteRuntime.account.sessionEpochs).toBe(mockForumSessionEpochs);
    expect(hook.result.current.routes!.topicRouteRuntime.account.readGateway).toBe(mockReadGateway);
    expect(hook.result.current.routes!.topicRouteRuntime.account.sessionEpochs).toBe(mockForumSessionEpochs);
    expect(mockUseAccountRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }));

    await act(async () =>
      (
        hook.result.current.routes!.feedRouteRuntime as unknown as {
          onInitialContentReady?: () => void;
        }
      ).onInitialContentReady?.()
    );
    await act(async () => hook.rerender({ revision: 1 }));
    expect(mockUseAccountRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }));
    expect(mockUseAppUpdateRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ autoCheck: true }));
  });

  it('withholds routes and remote queries until local account sessions are restored', async () => {
    mockSessionsReady = false;
    const hook = await renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useAppRuntime();
      },
      { initialProps: { revision: 0 } }
    );

    expect(mockUseAccountRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }));
    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ active: false }));
    expect(hook.result.current.routes).toBeNull();

    mockSessionsReady = true;
    await act(async () => hook.rerender({ revision: 1 }));

    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
    expect(hook.result.current.routes).not.toBeNull();
  });
});
