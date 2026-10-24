import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook as renderNativeHook, waitFor } from '@testing-library/react-native';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { useAppRuntime } from '@/app/useAppRuntime';
import { useInitialForegroundRuntime } from '@/app/useInitialForegroundRuntime';
import type { ReaderData } from '@/domain/reader/readerData';
import { createEmptyReaderState, type ReaderChange, type ReaderCommand } from '@/domain/reader/readerRecordState';
import { useFeedController } from '@/features/feed/useFeedController';
import type { ReadGateway } from '@/sources/readGateway';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import React from 'react';
import { View } from 'react-native';
import { defaultScheduler, notifyManager } from '@tanstack/react-query';
import type { Topic } from '@/domain/forum/models';
import type { DiscourseReadingState } from '@/domain/forum/discourseReading';
import { getTopicListItemStateFromIndex } from '@/domain/forum/topicListItemState';
import { createDiscourseReadingRuntime, discourseReadingQueryKey } from '@/platform/query/discourseReadingRuntime';
import { MemoizedTopicCard } from '@/ui/topic/TopicCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { saveAccountSessionSnapshot } from '@/platform/storage/accountSessionStore';
import type { Fetcher } from '@/platform/network/request';
import { notificationPermissionGranted } from '@/platform/notifications/notificationSystem';
import { render, fireEvent, within } from '../render';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { formatAppUpdateDownloadProgress, type AppUpdateDownloadProgress } from '@/platform/update/appUpdate';

const mockUseAccountRuntime = jest.fn();
const mockShowLinuxDoVerification = jest.fn<(_message?: string, _recovery?: LinuxDoReadRecovery) => Promise<boolean>>(
  async () => true
);
const mockNotify = jest.fn<(message?: string) => void>();
const mockUseNotificationsRuntime =
  jest.fn<
    (
      options: Parameters<typeof import('@/features/notifications/useNotificationsRuntime').useNotificationsRuntime>[0]
    ) => void
  >();
let mockActualReader = false;
let mockActualAccount = false;
let mockActualNetwork = false;
let mockActualNotifications = false;
let mockStableBoundaries = false;
let mockUpdateProgress: AppUpdateDownloadProgress | null = null;
let mockNetworkReady = false;
const mockNetworkFetcher = jest.fn<Fetcher>();
const mockEnsureNetworkProxyReady = jest.fn<() => Promise<void>>();
const mockApplyNetworkProxy = jest.fn<() => Promise<unknown>>();
const mockLoadReader = jest.fn<() => Promise<import('@/domain/reader/readerRecordState').ReaderState>>();
const mockImportReader = jest.fn<() => Promise<import('@/domain/reader/readerRecordState').ReaderState>>();
const mockCommitReader = jest.fn<(command: ReaderCommand) => Promise<ReaderChange>>();
jest.mock('@/platform/storage/readerDataStore', () => ({
  loadReaderState: () => mockLoadReader(),
  importReaderDataBackup: () => mockImportReader(),
  commitReaderCommand: (command: ReaderCommand) => mockCommitReader(command)
}));
const renderHook: typeof renderNativeHook = (callback, options) =>
  renderNativeHook(callback, { wrapper: QueryTestWrapper, ...options });
const mockUseAppUpdateRuntime = jest.fn();
const mockUseForumCatalogRuntime = jest.fn();
const mockHandleNavigationReady = jest.fn();
const mockNotificationNavigationReady = jest.fn();
let mockReaderData: ReaderData | undefined;
let mockReaderDataLoaded = true;
let mockSessionsReady = true;
let mockInitialForegroundReady = false;
let mockFeedContentReady = false;
let mockScreen = 'feed';
let mockDiscourseReading: ReadGateway['reading'];
const mockReadGateway = {
  getEmojiUrls: jest.fn(),
  getReadPlan: () => ({ state: 'ready', cacheScope: 'public:fixture' }),
  getFeed: jest.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
  getCategories: jest.fn(async () => ({ items: [], errors: {} }))
};
const mockForumSessionEpochs = { linuxdo: 7, nodeseek: 7, yaohuo: 7 };
const mockOnFeedInitialContentReady = jest.fn(() => {
  mockInitialForegroundReady = true;
  mockFeedContentReady = true;
});

jest.mock('@/app/useAppLifecycleRuntime', () => ({
  useAppLifecycleRuntime: () => {
    const ReactModule = require('react') as typeof React;
    const value = {
      appActive: true,
      changeScreen: jest.fn(),
      getCurrentScreen: jest.fn(() => 'feed'),
      height: 800,
      initialForegroundReady: mockInitialForegroundReady,
      feedContentReady: mockFeedContentReady,
      loginNavigation: {},
      notify: mockNotify,
      onCatalogSettled: jest.fn(),
      onFeedInitialContentReady: mockOnFeedInitialContentReady,
      onReady: mockHandleNavigationReady,
      onScreenChange: jest.fn(),
      openUserRoute: jest.fn(),
      screen: mockScreen,
      width: 400
    };
    const stable = ReactModule.useRef(value);
    return mockStableBoundaries ? stable.current : value;
  }
}));

jest.mock('@/app/useReaderRuntime', () => ({
  useReaderRuntime: (options: Parameters<typeof import('@/app/useReaderRuntime').useReaderRuntime>[0]) => {
    if (mockActualReader)
      return jest
        .requireActual<typeof import('@/app/useReaderRuntime')>('@/app/useReaderRuntime')
        .useReaderRuntime(options);
    const { createEmptyReaderData } =
      jest.requireActual<typeof import('@/domain/reader/readerData')>('@/domain/reader/readerData');
    const readerData = (mockReaderData ||= createEmptyReaderData());
    return {
      commitReaderData: jest.fn(),
      readerData,
      readerDataLoaded: mockReaderDataLoaded,
      readerStatus: mockReaderDataLoaded ? 'ready' : 'loading',
      readerDataRef: { current: readerData },
      replaceReaderData: jest.fn(),
      waitForReaderDataSave: jest.fn(async () => undefined)
    };
  }
}));

jest.mock('@/platform/network/networkProxy', () => ({
  ...jest.requireActual<typeof import('@/platform/network/networkProxy')>('@/platform/network/networkProxy'),
  applyNetworkProxy: () => mockApplyNetworkProxy()
}));

jest.mock('@/platform/network/useNetworkProxyRuntime', () => ({
  useNetworkProxyRuntime: (
    options: Parameters<typeof import('@/platform/network/useNetworkProxyRuntime').useNetworkProxyRuntime>[0]
  ) => {
    if (mockActualNetwork)
      return jest
        .requireActual<typeof import('@/platform/network/useNetworkProxyRuntime')>(
          '@/platform/network/useNetworkProxyRuntime'
        )
        .useNetworkProxyRuntime({ ...options, baseFetcher: mockNetworkFetcher });
    const ReactModule = require('react') as typeof React;
    const value = {
      activeProfile: null,
      applyError: '',
      applyStatus: 'loading',
      deleteProxyProfile: jest.fn(),
      ensureNetworkProxyReady: mockEnsureNetworkProxyReady,
      loaded: mockNetworkReady,
      networkProxyFetcher: mockNetworkFetcher,
      proxyState: { enabled: false, activeId: null, profiles: [] },
      selectProxyProfile: jest.fn(),
      setProxyEnabled: jest.fn(),
      summary: '代理状态读取中',
      testProxyProfile: jest.fn(),
      upsertProxyProfile: jest.fn(),
      webViewBlockMessage: mockNetworkReady ? '' : '代理状态读取中。'
    };
    const stable = ReactModule.useRef(value);
    return mockStableBoundaries ? stable.current : value;
  }
}));

jest.mock('@/features/account/useAccountRuntime', () => ({
  useAccountRuntime: (
    options: Parameters<typeof import('@/features/account/useAccountRuntime').useAccountRuntime>[0]
  ) => {
    mockUseAccountRuntime(options);
    if (mockActualAccount)
      return jest
        .requireActual<typeof import('@/features/account/useAccountRuntime')>('@/features/account/useAccountRuntime')
        .useAccountRuntime(options);
    return {
      center: {
        linuxDoCredit: { open: jest.fn(), connectSilently: jest.fn(), busy: false },
        account: {
          linuxDoLevelBusy: false,
          linuxDoLevelError: '',
          linuxDoLevelProfile: null,
          refreshLinuxDoLevel: jest.fn()
        },
        checkIn: {},
        nodeSeek: { busy: false, state: { kind: 'idle' }, checkIn: jest.fn(), observeBoard: jest.fn() },
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
        showLinuxDoVerification: mockShowLinuxDoVerification,
        showYaohuoLogin: jest.fn(),
        surfaces: { linuxdo: {}, nodeseek: {}, yaohuo: {} }
      },
      read: {
        accountIdentityPending: false,
        accountSessionViewModels: { nodeseek: { isLoggedIn: false } },
        forumSessionEpochs: mockForumSessionEpochs,
        getLinuxDoUserAgent: jest.fn(),
        getNodeSeekUserAgent: jest.fn(),
        notificationFetcher: mockNetworkFetcher,
        identityBarriers: {},
        readGateway: mockDiscourseReading ? { ...mockReadGateway, reading: mockDiscourseReading } : mockReadGateway,
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
    return {
      appUpdateBusy: false,
      appUpdateDownloading: false,
      appUpdateInfo: null,
      appUpdateDownloadProgress: mockUpdateProgress
    };
  }
}));

jest.mock('@/features/notifications/useNotificationsRuntime', () => ({
  useNotificationsRuntime: (
    options: Parameters<typeof import('@/features/notifications/useNotificationsRuntime').useNotificationsRuntime>[0]
  ) => {
    mockUseNotificationsRuntime(options);
    if (mockActualNotifications)
      return jest
        .requireActual<typeof import('@/features/notifications/useNotificationsRuntime')>(
          '@/features/notifications/useNotificationsRuntime'
        )
        .useNotificationsRuntime(options);
    return {
      identityKeys: {},
      activeSources: [],
      backgroundEnabled: false,
      onNavigationReady: mockNotificationNavigationReady,
      partialUnavailable: false,
      unreadTotal: 0
    };
  }
}));

jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual<typeof import('@/platform/network/managedCookies')>('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined)
}));

jest.mock('@/platform/notifications/notificationSystem', () => ({
  dismissSourceNotification: jest.fn(async () => undefined),
  dismissSourceNotificationExact: jest.fn(async () => undefined),
  notificationPermissionGranted: jest.fn(async () => false),
  openNotificationSystemSettings: jest.fn(async () => undefined),
  presentSourceNotification: jest.fn(async (_source: string, _digest: unknown, identifier: string) => identifier),
  reconcileSourceNotificationSlots: jest.fn(async () => undefined),
  requestNotificationPermission: jest.fn(async () => false),
  syncNotificationBackgroundRegistration: jest.fn(async () => false)
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponse: jest.fn(() => undefined),
  getLastNotificationResponse: jest.fn(() => null)
}));

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    WebView: ReactModule.forwardRef(function MockWebView(props: Record<string, unknown>, ref) {
      ReactModule.useImperativeHandle(ref, () => ({ stopLoading: jest.fn(), injectJavaScript: jest.fn() }), []);
      return ReactModule.createElement(View, { ...props, testID: 'mock-webview' });
    })
  };
});

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
    mockActualReader = false;
    mockActualAccount = false;
    mockActualNetwork = false;
    mockActualNotifications = false;
    mockStableBoundaries = false;
    mockUpdateProgress = null;
    mockNetworkReady = false;
    mockApplyNetworkProxy.mockReset().mockResolvedValue({ ok: true });
    mockNetworkFetcher.mockReset().mockRejectedValue(new Error('代理状态读取中。'));
    mockEnsureNetworkProxyReady.mockReset().mockImplementation(async () => {
      if (!mockNetworkReady) throw new Error('代理状态读取中。');
    });
    mockReaderData = undefined;
    mockReaderDataLoaded = true;
    mockSessionsReady = true;
    mockInitialForegroundReady = false;
    mockFeedContentReady = false;
    mockScreen = 'feed';
    mockDiscourseReading = undefined;
    mockOnFeedInitialContentReady.mockClear();
    mockHandleNavigationReady.mockClear();
    mockNotificationNavigationReady.mockClear();
    mockUseAccountRuntime.mockClear();
    mockShowLinuxDoVerification.mockClear();
    mockUseAppUpdateRuntime.mockClear();
    mockUseForumCatalogRuntime.mockClear();
    mockCommitReader.mockReset();
  });

  it('preserves More account and utility inputs through real account runtime progress renders', async () => {
    mockStableBoundaries = true;
    mockActualAccount = true;
    mockActualReader = true;
    const state = createEmptyReaderState();
    state.settings.contentSources = state.settings.contentSources.map((entry) => ({ ...entry, enabled: false }));
    mockLoadReader.mockResolvedValue(state);
    const hook = await renderHook(
      ({ revision }: { revision: number }) => {
        void revision;
        return useAppRuntime();
      },
      { initialProps: { revision: 0 } }
    );
    await waitFor(() => expect(hook.result.current.routes).not.toBeNull());
    const original = hook.result.current.routes!.moreRouteRuntime;
    for (let percent = 10; percent <= 100; percent += 10) {
      mockUpdateProgress = formatAppUpdateDownloadProgress('2.0.0', percent, 100);
      await act(async () => hook.rerender({ revision: percent }));
      const current = hook.result.current.routes!.moreRouteRuntime;
      expect(current.update.appUpdateDownloadProgress?.percent).toBe(percent);
      expect(current.account).toBe(original.account);
      expect(current.proxy).toBe(original.proxy);
      expect(current.library).toBe(original.library);
    }
    await act(async () => {
      appQueryClient.setQueryData(
        accountQueryKeys.snapshot('linuxdo'),
        accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), { type: 'login-expired' })
      );
    });
    await waitFor(() => expect(hook.result.current.routes!.moreRouteRuntime.account).not.toBe(original.account));
    expect(hook.result.current.routes!.moreRouteRuntime.account.read.sessions.linuxdo.status).toBe('expired');
    await hook.unmount();
  });

  it('loads foreground NodeSeek unread counts and notifications after native security responses recover in the shared browser', async () => {
    mockActualAccount = true;
    mockActualNotifications = true;
    mockNetworkReady = true;
    mockInitialForegroundReady = true;
    mockReaderData = createEmptyReaderData();
    mockReaderData.settings.contentSources = mockReaderData.settings.contentSources.map((entry) => ({
      ...entry,
      enabled: entry.source === 'nodeseek'
    }));
    await AsyncStorage.setItem('account-session.migration.v1', '1');
    await saveAccountSessionSnapshot(
      accountSessionSnapshotFromEvent(createAccountSessionSnapshot('nodeseek'), {
        type: 'session-updated',
        loggedIn: true,
        currentUser: { source: 'nodeseek', id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' }
      })
    );
    const userAgentRead = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
    const permissionChecks: ReturnType<typeof Promise.withResolvers<boolean>>[] = [];
    jest.mocked(notificationPermissionGranted).mockImplementation(() => {
      const check = Promise.withResolvers<boolean>();
      permissionChecks.push(check);
      return check.promise;
    });
    const nativeRequests: { url: string; response: ReturnType<typeof Promise.withResolvers<Response>> }[] = [];
    mockNetworkFetcher.mockImplementation((url) => {
      const response = Promise.withResolvers<Response>();
      nativeRequests.push({ url, response });
      return response.promise;
    });
    let runtime!: ReturnType<typeof useAppRuntime>;
    function Harness() {
      runtime = useAppRuntime();
      return runtime.accountHost;
    }
    let view!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      view = await render(<Harness />, { wrapper: QueryTestWrapper });
    });
    await act(async () => {
      permissionChecks.forEach((check) => check.resolve(false));
    });
    const completeDocument = async (path: string, data: unknown) => {
      const url = `https://www.nodeseek.com${path}`;
      await waitFor(() => expect(nativeRequests.at(-1)?.url).toBe(url));
      await act(async () => {
        nativeRequests.at(-1)!.response.resolve(
          new Response('<html><title>NodeSeek | security check</title><body>Checking your browser</body></html>', {
            status: 403,
            headers: { 'content-type': 'text/html' }
          })
        );
      });
      await waitFor(() => expect(view.getByTestId('mock-webview').props.source.uri).toBe(url));
      const browser = view.getByTestId('mock-webview');
      const requestId = Number(
        /const requestId = (\d+);/.exec(browser.props.injectedJavaScriptBeforeContentLoaded)?.[1]
      );
      expect(Number.isSafeInteger(requestId) && requestId > 0).toBe(true);
      await fireEvent(browser, 'message', {
        nativeEvent: {
          url: browser.props.source.uri,
          data: JSON.stringify({
            type: 'nodeseek-browser-fetch',
            id: requestId,
            url: browser.props.source.uri,
            html: JSON.stringify(data)
          })
        }
      });
    };
    try {
      await waitFor(() =>
        expect(mockNetworkFetcher).toHaveBeenCalledWith(
          'https://www.nodeseek.com/api/notification/unread-count',
          expect.anything()
        )
      );
      await completeDocument('/api/notification/unread-count', { atMe: 1, reply: 2, message: 0 });
      await waitFor(() => expect(runtime.routes!.notificationRouteRuntime.unreadTotal).toBe(3));
      expect(runtime.routes!.moreBadgeState).toBe('messages');
      let list!: ReturnType<NonNullable<typeof runtime.routes>['notificationRouteRuntime']['gateway']['listPage']>;
      await act(async () => {
        list = runtime.routes!.notificationRouteRuntime.gateway.listPage('nodeseek', {
          categoryId: 'mentions',
          expectedIdentityKey: 'nodeseek:42'
        });
      });
      await completeDocument('/api/notification/at-me/list', {
        atList: [{ id: 13, post_id: 832584, commenter_id: 7, commenter_name: 'bob', post_title: 'Recovered mention' }],
        hasMore: false
      });
      await expect(list).resolves.toMatchObject({
        items: [{ id: 'at-me:13', title: 'Recovered mention', unread: true }],
        quality: 'complete'
      });
      expect(mockNetworkFetcher.mock.calls.map(([url]) => url)).toEqual([
        'https://www.nodeseek.com/api/notification/unread-count',
        'https://www.nodeseek.com/api/notification/at-me/list'
      ]);
      expect(view.queryByTestId('mock-webview')).toBeNull();
      let refresh!: ReturnType<NonNullable<typeof runtime.routes>['notificationRouteRuntime']['refreshSnapshots']>;
      await act(async () => {
        refresh = runtime.routes!.notificationRouteRuntime.refreshSnapshots();
      });
      await completeDocument('/api/notification/unread-count', { atMe: 0, reply: 0, message: 0 });
      await act(async () => {
        await refresh;
      });
      await waitFor(() => expect(runtime.routes!.notificationRouteRuntime.unreadTotal).toBe(0));
      expect(runtime.routes!.moreBadgeState).toBe('none');
      const notificationFetcher = mockUseNotificationsRuntime.mock.calls.at(-1)![0].fetcher;
      for (const url of ['https://linux.do/notifications.json', 'https://yaohuo.me/bbs/receive.aspx']) {
        const original = new Response('original security response', {
          status: 403,
          headers: { 'cf-mitigated': 'challenge' }
        });
        mockNetworkFetcher.mockResolvedValueOnce(original);
        expect(await notificationFetcher(url)).toBe(original);
      }
      const rejectedWrite = new Response('write rejected', {
        status: 403,
        headers: { 'cf-mitigated': 'challenge' }
      });
      mockNetworkFetcher.mockResolvedValueOnce(rejectedWrite);
      expect(await notificationFetcher('https://www.nodeseek.com/api/notification/mark-read', { method: 'POST' })).toBe(
        rejectedWrite
      );
      const callsBeforeStaleIdentity = mockNetworkFetcher.mock.calls.length;
      await expect(
        runtime.routes!.notificationRouteRuntime.gateway.listPage('nodeseek', {
          expectedIdentityKey: 'nodeseek:previous-account'
        })
      ).rejects.toThrow('账号状态已变化');
      expect(mockNetworkFetcher).toHaveBeenCalledTimes(callsBeforeStaleIdentity);
      expect(view.queryByTestId('mock-webview')).toBeNull();
    } finally {
      nativeRequests.forEach(({ response }) => response.resolve(new Response('', { status: 503 })));
      await act(async () => {
        await view.unmount();
        permissionChecks.forEach((check) => check.resolve(false));
        await Promise.allSettled(permissionChecks.map((check) => check.promise));
      });
      jest.mocked(notificationPermissionGranted).mockResolvedValue(false);
      userAgentRead.mockRestore();
      await AsyncStorage.removeItem('account-session.v1.nodeseek');
      await AsyncStorage.removeItem('account-session.migration.v1');
    }
  });

  it.each(['visit', 'topic-summary'] as const)(
    'keeps reading page inputs stable when %s only updates stored history metadata',
    async (type) => {
      mockActualReader = true;
      const state = createEmptyReaderState();
      state.history = { 'nodeseek:1': true };
      state.counts.history = 1;
      mockLoadReader.mockResolvedValue(state);
      const saved = Promise.withResolvers<ReaderChange>();
      mockCommitReader.mockReturnValueOnce(saved.promise);
      const hook = await renderHook(() => useAppRuntime());
      await waitFor(() => expect(hook.result.current.routes).not.toBeNull());
      const views = () => {
        const routes = hook.result.current.routes!;
        return [
          routes.feedRouteRuntime.reader.data,
          routes.searchRouteRuntime.readerData,
          routes.topicRouteRuntime.reader.data,
          routes.userRouteRuntime.reader.data
        ];
      };
      const before = views();
      const topic = {
        source: 'nodeseek' as const,
        id: '1',
        title: 'Already read',
        author: 'alice',
        url: 'https://www.nodeseek.com/post-1-1',
        createdAt: '2026-01-01T00:00:00Z'
      };
      const command: ReaderCommand = type === 'visit' ? { type, topic, at: '2026-09-30T00:00:00Z' } : { type, topic };
      await act(async () => hook.result.current.routes!.topicRouteRuntime.reader.commit(command));
      expect(mockCommitReader).toHaveBeenCalledWith(command);
      expect(views().map((view, index) => view === before[index])).toEqual([true, true, true, true]);
      await act(async () => {
        saved.resolve({
          membership: [{ collection: 'history', key: 'nodeseek:1', present: true }],
          counts: { history: 1 },
          changed: ['history']
        });
      });
      expect(hook.result.current.routes!.libraryRouteRuntime.reader.data.revisions.history).toBe(1);
      expect(hook.result.current.routes!.topicRouteRuntime.reader.dataRef.current).toBe(
        hook.result.current.routes!.libraryRouteRuntime.reader.data
      );
      expect(views().map((view, index) => view === before[index])).toEqual([true, true, true, true]);
      mockCommitReader.mockResolvedValueOnce({
        membership: [{ collection: 'history', key: 'nodeseek:2', present: true }],
        counts: { history: 2 },
        changed: ['history']
      });
      await act(async () => {
        hook.result.current.routes!.topicRouteRuntime.reader.commit({
          type: 'visit',
          topic: { ...topic, id: '2', url: 'https://www.nodeseek.com/post-2-1' },
          at: '2026-09-30T00:01:00Z'
        });
      });
      for (const view of views()) {
        expect(view.history).toEqual({ 'nodeseek:1': true, 'nodeseek:2': true });
        expect(view).not.toBe(before[0]);
      }
      expect(hook.result.current.routes!.libraryRouteRuntime.reader.data.counts.history).toBe(2);
    }
  );

  it('keeps background card inputs and commits stable for reading anchors and floors, then updates visited and new replies', async () => {
    mockStableBoundaries = true;
    mockActualReader = true;
    const reader = createEmptyReaderState();
    reader.settings.contentSources = reader.settings.contentSources.map((entry) => ({ ...entry, enabled: false }));
    mockLoadReader.mockResolvedValue(reader);
    const scope = 'linuxdo:background-reading-oracle';
    const key = discourseReadingQueryKey(scope);
    const send = jest.fn(async () => undefined);
    const reading = createDiscourseReadingRuntime({ queryClient: appQueryClient, scope: () => scope, send });
    mockDiscourseReading = reading;
    const initial: DiscourseReadingState = {
      '482293': {
        server: { topicId: '482293', highestPostNumber: 500, lastReadPostNumber: 500 },
        visited: true,
        highestKnown: 500,
        localVersion: 0,
        requestSequence: 1,
        readPosts: { 500: true },
        anchor: { floor: 500, rowKey: 'reply:500', offset: 0 }
      },
      '482294': {
        server: { topicId: '482294', highestPostNumber: 1, lastReadPostNumber: 0 },
        visited: false,
        highestKnown: 0,
        localVersion: 0,
        requestSequence: 1,
        readPosts: {}
      }
    };
    appQueryClient.setQueryData(key, initial);
    const topics: Topic[] = ['482293', '482294'].map((id) => ({
      source: 'linuxdo',
      id,
      title: 'Reading ' + id,
      author: 'alice',
      url: 'https://linux.do/t/topic/' + id,
      createdAt: '2026-10-17T00:00:00Z'
    }));
    const feedCommits = jest.fn<React.ProfilerOnRenderCallback>();
    const searchCommits = jest.fn<React.ProfilerOnRenderCallback>();
    const openTopic = () => undefined;
    type Routes = NonNullable<ReturnType<typeof useAppRuntime>['routes']>;
    const cards = (
      runtime: Routes['feedRouteRuntime' | 'searchRouteRuntime'],
      id: string,
      onCommit: React.ProfilerOnRenderCallback
    ) => (
      <React.Profiler id={id} onRender={onCommit}>
        <View testID={id}>
          {topics.map((topic) => (
            <MemoizedTopicCard
              key={topic.id}
              topic={topic}
              readerState={getTopicListItemStateFromIndex(runtime.topicStateIndex, topic)}
              onOpenTopic={openTopic}
            />
          ))}
        </View>
      </React.Profiler>
    );
    const BackgroundFeedCards = React.memo(function BackgroundFeedCards({
      runtime
    }: {
      runtime: Routes['feedRouteRuntime'];
    }) {
      useFeedController({
        active: false,
        enabledSources: runtime.enabledSources,
        enabledSourcesKey: runtime.enabledSourcesKey,
        catalogCategories: runtime.catalogCategories,
        sessionEpochs: runtime.account.sessionEpochs,
        linuxDoVerificationActive: false,
        notify: runtime.notify,
        readerData: runtime.reader.data,
        readerDataLoaded: runtime.reader.loaded,
        showLinuxDoVerification: runtime.account.showLinuxDoVerification,
        showNodeSeekVerification: (message) =>
          runtime.account.requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证'),
        showYaohuoLogin: runtime.account.showYaohuoLogin,
        readGateway: runtime.account.readGateway
      });
      return cards(runtime, 'background-feed', feedCommits);
    });
    const BackgroundSearchCards = React.memo(function BackgroundSearchCards({
      runtime
    }: {
      runtime: Routes['searchRouteRuntime'];
    }) {
      return cards(runtime, 'background-search', searchCommits);
    });
    let runtime!: ReturnType<typeof useAppRuntime>;
    function Harness() {
      runtime = useAppRuntime();
      return runtime.routes ? (
        <>
          <BackgroundFeedCards runtime={runtime.routes.feedRouteRuntime} />
          <BackgroundSearchCards runtime={runtime.routes.searchRouteRuntime} />
        </>
      ) : null;
    }
    const inputs = () => {
      const routes = runtime.routes!;
      return [routes.feedRouteRuntime, routes.searchRouteRuntime] as const;
    };
    const update = async (change: (previous: DiscourseReadingState) => DiscourseReadingState) => {
      await act(async () => {
        appQueryClient.setQueryData<DiscourseReadingState>(key, (previous) => change(previous!));
      });
    };
    notifyManager.setScheduler((callback) => callback());
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      view = await render(<Harness />, { wrapper: QueryTestWrapper });
      await waitFor(() => expect(runtime.routes).not.toBeNull());
      expect(feedCommits).toHaveBeenCalled();
      expect(searchCommits).toHaveBeenCalled();
      const before = inputs();
      const selected = before[0].topicStateIndex.reading;
      expect(selected?.['482293']).toEqual({ visited: true, hasNewReplies: false });
      expect(selected?.['482294']).toEqual({ visited: false, hasNewReplies: false });
      const commitsBefore = [feedCommits.mock.calls.length, searchCommits.mock.calls.length] as const;
      const initialEntry = reading.state()['482293'];
      await update((previous) => ({
        ...previous,
        '482293': { ...previous['482293'], anchor: { floor: 501, rowKey: 'reply:501', offset: 12 } }
      }));
      expect(reading.state()['482293']).not.toBe(initialEntry);
      expect(reading.state()['482293'].anchor).toEqual({ floor: 501, rowKey: 'reply:501', offset: 12 });
      expect(inputs().map((input, index) => input === before[index])).toEqual([true, true]);
      expect(inputs().map((input) => input.topicStateIndex.reading === selected)).toEqual([true, true]);
      expect([feedCommits.mock.calls.length, searchCommits.mock.calls.length]).toEqual(commitsBefore);
      const entryBeforeFloor = reading.state()['482293'];
      await update((previous) => ({
        ...previous,
        '482293': {
          ...previous['482293'],
          highestKnown: 501,
          localVersion: 1,
          readPosts: { ...previous['482293'].readPosts, 501: true }
        }
      }));
      expect(reading.state()['482293'].readPosts).not.toBe(entryBeforeFloor.readPosts);
      expect(reading.state()['482293'].readPosts[501]).toBe(true);
      expect(inputs().map((input, index) => input === before[index])).toEqual([true, true]);
      expect(inputs().map((input) => input.topicStateIndex.reading === selected)).toEqual([true, true]);
      expect([feedCommits.mock.calls.length, searchCommits.mock.calls.length]).toEqual(commitsBefore);
      await update((previous) => ({
        ...previous,
        '482294': { ...previous['482294'], visited: true, localVersion: 1 }
      }));
      expect(inputs().map((input) => getTopicListItemStateFromIndex(input.topicStateIndex, topics[1]!).read)).toEqual([
        true,
        true
      ]);
      expect(inputs().map((input, index) => input === before[index])).toEqual([false, false]);
      expect(feedCommits.mock.calls.length).toBeGreaterThan(commitsBefore[0]);
      expect(searchCommits.mock.calls.length).toBeGreaterThan(commitsBefore[1]);
      const commitsAfterVisit = [feedCommits.mock.calls.length, searchCommits.mock.calls.length] as const;
      await update((previous) => ({
        ...previous,
        '482293': { ...previous['482293'], server: { ...previous['482293'].server, highestPostNumber: 502 } }
      }));
      expect(
        inputs().map((input) => getTopicListItemStateFromIndex(input.topicStateIndex, topics[0]!).hasNewReplies)
      ).toEqual([true, true]);
      expect(feedCommits.mock.calls.length).toBeGreaterThan(commitsAfterVisit[0]);
      expect(searchCommits.mock.calls.length).toBeGreaterThan(commitsAfterVisit[1]);
      expect(within(view.getByTestId('background-feed')).getByText('有新回复')).toBeTruthy();
      expect(within(view.getByTestId('background-search')).getByText('有新回复')).toBeTruthy();
      expect(send).not.toHaveBeenCalled();
    } finally {
      await view?.unmount();
      reading.dispose();
      mockDiscourseReading = undefined;
      notifyManager.setScheduler(defaultScheduler);
    }
  });

  it('forwards the exact create-topic read recovery to the existing linux.do verification host', async () => {
    const hook = await renderHook(() => useAppRuntime());
    const recovery: LinuxDoReadRecovery = {
      queryKey: ['create-topic', 'tags'],
      isCurrent: () => true,
      resume: async () => 'completed',
      cancel: jest.fn()
    };
    expect(
      await hook.result.current.routes!.topicComposerRouteRuntime.openAccount('linuxdo', '读取标签需要验证', recovery)
    ).toBe(true);
    expect(mockShowLinuxDoVerification).toHaveBeenCalledWith('读取标签需要验证', recovery);
  });

  it('settles local routes without trusting fallback settings, then enables only restored sources', async () => {
    mockActualReader = true;
    mockLoadReader.mockRejectedValue(new Error('unreadable database'));
    const empty = createEmptyReaderState();
    mockReadGateway.getFeed.mockClear();
    mockReadGateway.getCategories.mockClear();
    const hook = await renderHook(() => {
      const app = useAppRuntime();
      const feed = app.routes?.feedRouteRuntime;
      useFeedController({
        active: true,
        enabledSources: feed?.enabledSources || [],
        enabledSourcesKey: feed?.enabledSourcesKey || '',
        readerData: feed?.reader.data || empty,
        readerDataLoaded: feed?.reader.loaded || false,
        catalogCategories: [],
        linuxDoVerificationActive: false,
        notify: mockNotify,
        showLinuxDoVerification: mockNotify,
        showNodeSeekVerification: mockNotify,
        showYaohuoLogin: mockNotify,
        readGateway: mockReadGateway as unknown as ReadGateway
      });
      return app;
    });
    await waitFor(() => expect(hook.result.current.routes).not.toBeNull());
    const routes = hook.result.current.routes!;
    expect(routes.moreRouteRuntime.reader.status).toBe('recovery');
    for (const runtime of [
      routes.feedRouteRuntime,
      routes.searchRouteRuntime,
      routes.topicRouteRuntime,
      routes.userRouteRuntime,
      routes.libraryRouteRuntime
    ]) {
      expect(runtime.enabledSources).toEqual([]);
    }
    expect(mockUseAccountRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ ready: true, enabledSources: [] })
    );
    expect(mockUseNotificationsRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentSourcesReady: false, enabledNotificationSources: [] })
    );
    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: false, enabledFeedSources: [] })
    );
    mockImportReader.mockRejectedValueOnce(new Error('bad backup'));
    await act(async () => {
      await expect(routes.moreRouteRuntime.reader.importBackup('bad')).rejects.toThrow('bad backup');
    });
    expect(hook.result.current.routes!.feedRouteRuntime.enabledSources).toEqual([]);
    expect(mockReadGateway.getFeed).not.toHaveBeenCalled();
    expect(mockReadGateway.getCategories).not.toHaveBeenCalled();
    const restored = createEmptyReaderState();
    restored.settings.contentSources = restored.settings.contentSources.map((entry) => ({
      ...entry,
      enabled: entry.source === 'nodeseek'
    }));
    mockImportReader.mockResolvedValueOnce(restored);
    await act(async () => {
      await routes.moreRouteRuntime.reader.importBackup('backup');
    });
    expect(hook.result.current.routes!.moreRouteRuntime.reader.status).toBe('ready');
    expect(hook.result.current.routes!.feedRouteRuntime.enabledSources).toEqual(['nodeseek']);
    expect(mockUseNotificationsRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentSourcesReady: true, enabledNotificationSources: ['nodeseek'] })
    );
    await waitFor(() => expect(mockReadGateway.getFeed).toHaveBeenCalled());
  });

  it('trusts the successfully loaded defaults on first install', async () => {
    mockActualReader = true;
    mockLoadReader.mockResolvedValueOnce(createEmptyReaderState());
    const hook = await renderHook(() => useAppRuntime());
    await waitFor(() => expect(hook.result.current.routes).not.toBeNull());
    expect(hook.result.current.routes!.moreRouteRuntime.reader.status).toBe('ready');
    expect(hook.result.current.routes!.feedRouteRuntime.enabledSources).toEqual([
      'v2ex',
      'linuxdo',
      'nodeseek',
      'yaohuo'
    ]);
  });

  it('exposes local routes while keeping WebViews blocked during proxy load', async () => {
    const hook = await renderHook(() => useAppRuntime());

    expect(hook.result.current.routes).not.toBeNull();
    expect(hook.result.current.routes?.libraryRouteRuntime).toBeDefined();
    expect(hook.result.current.routes?.moreRouteRuntime).toBeDefined();
    expect(hook.result.current.routes?.userRouteRuntime.nodeSeekMessaging).toEqual({
      identityKey: undefined,
      available: false
    });
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
    const readerView = routes.feedRouteRuntime.reader.data;

    expect(feedIndex).toBeDefined();
    expect(routes.searchRouteRuntime.readerData).toBe(readerView);
    expect(routes.topicRouteRuntime.reader.data).toBe(readerView);
    expect(routes.userRouteRuntime.reader.data).toBe(readerView);
    expect((routes.searchRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex).toBe(feedIndex);
    expect((routes.libraryRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex).toBe(feedIndex);
    expect((routes.userRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex).toBe(feedIndex);

    mockReaderData = { ...mockReaderData!, followedUsers: { ...mockReaderData!.followedUsers } };
    await act(async () => hook.rerender({ revision: 1 }));
    expect(hook.result.current.routes!.userRouteRuntime.reader.data.followedUsers).toBe(mockReaderData.followedUsers);
    expect(
      (hook.result.current.routes!.feedRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex
    ).toBe(feedIndex);

    mockReaderData = { ...mockReaderData!, favorites: { ...mockReaderData!.favorites } };
    await act(async () => hook.rerender({ revision: 2 }));
    expect(hook.result.current.routes!.topicRouteRuntime.reader.data.favorites).toBe(mockReaderData.favorites);
    expect(
      (hook.result.current.routes!.feedRouteRuntime as unknown as { topicStateIndex?: unknown }).topicStateIndex
    ).not.toBe(feedIndex);
    mockReaderData = { ...mockReaderData!, settings: { ...mockReaderData!.settings, theme: 'dark' } };
    await act(async () => hook.rerender({ revision: 3 }));
    expect(hook.result.current.routes!.topicRouteRuntime.reader.data.settings.theme).toBe('dark');
  });

  it('settles only after Feed and Categories reach terminal state', async () => {
    const hook = await renderHook(() => useInitialForegroundRuntime());

    expect(hook.result.current.initialForegroundReady).toBe(false);
    expect(hook.result.current.feedContentReady).toBe(false);
    await act(async () => hook.result.current.onFeedInitialContentReady());
    expect(hook.result.current.initialForegroundReady).toBe(false);
    expect(hook.result.current.feedContentReady).toBe(true);
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

    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true, deferSecondary: true })
    );
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
    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ deferSecondary: false }));
    expect(mockUseAccountRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true }));
    expect(mockUseAppUpdateRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ autoCheck: true }));
  });

  it('keeps the initial aggregate feed budget after shared network preparation through the real account gateway', async () => {
    jest.useFakeTimers();
    mockActualAccount = true;
    mockActualNetwork = true;
    const secureStoreRead = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
    mockReaderData = createEmptyReaderData();
    mockReaderData.settings.contentSources = mockReaderData.settings.contentSources.map((entry) => ({
      ...entry,
      enabled: entry.source === 'v2ex'
    }));
    let releasePreparation!: () => void;
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    mockApplyNetworkProxy.mockReturnValue(preparation);
    mockNetworkFetcher.mockImplementation(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 4_000));
      return new Response(
        '<div class="cell item"><a class="topic-link" href="/t/901#reply0">Fresh topic</a><a class="node" href="/go/create">Create</a><strong><a href="/member/neo">neo</a></strong><span title="2026-05-20 00:00:00 +08:00"></span></div>'
      );
    });
    const hook = await renderHook(() => useAppRuntime());
    let pending: ReturnType<ReadGateway['getFeed']> | undefined;
    let settled = false;
    try {
      await waitFor(() => expect(hook.result.current.routes).not.toBeNull());
      await waitFor(() => expect(mockApplyNetworkProxy).toHaveBeenCalledTimes(1));
      await act(async () => {
        pending = hook.result.current.routes!.feedRouteRuntime.account.readGateway.getFeed({ source: 'all', limit: 1 });
        void pending.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          }
        );
        await jest.advanceTimersByTimeAsync(4_999);
      });
      expect(settled).toBe(false);
      expect(mockNetworkFetcher).not.toHaveBeenCalled();
      await act(async () => jest.advanceTimersByTimeAsync(1));
      expect(settled).toBe(false);
      expect(mockNetworkFetcher).not.toHaveBeenCalled();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2_400);
        releasePreparation();
        await jest.advanceTimersByTimeAsync(4_000);
      });
      await expect(pending).resolves.toMatchObject({
        errors: {},
        items: [expect.objectContaining({ source: 'v2ex', id: '901', title: 'Fresh topic' })]
      });
      expect(mockNetworkFetcher).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        releasePreparation();
        await jest.advanceTimersByTimeAsync(5_000);
        await pending;
      });
      await hook.unmount();
      secureStoreRead.mockRestore();
      jest.useRealTimers();
    }
  });

  it('loads Search categories even before the initial Feed is visible', async () => {
    mockScreen = 'search';
    await renderHook(() => useAppRuntime());
    expect(mockUseForumCatalogRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({ active: true, deferSecondary: false })
    );
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
