import { projectTestAccountSessions } from '../../helpers/accountSessions';
import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Alert, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import type { ForumNotification } from '@/domain/notifications/models';
import type { AccountReconcileResult, LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import { notificationSources } from '@/domain/forum/sourceCatalog';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import {
  NotificationDetailRoute,
  NotificationRouteRuntimeProvider,
  NotificationsRoute,
  type NotificationRouteRuntimeValue
} from '@/features/notifications/NotificationRoute';
import { defaultNotificationState } from '@/platform/notifications/notificationStore';
import { notificationPermissionGranted } from '@/platform/notifications/notificationSystem';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { NotificationAdapter, NotificationAdapterAccess } from '@/sources/notificationAdapter';
import { createNotificationGateway } from '@/sources/notificationGateway';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn()
}));

jest.mock('@/platform/notifications/notificationSystem', () => ({
  notificationPermissionGranted: jest.fn(async () => false),
  syncNotificationBackgroundRegistration: jest.fn(async () => false),
  reconcileSourceNotificationSlots: jest.fn(async () => undefined),
  dismissSourceNotification: jest.fn(async () => undefined)
}));

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  clearLastNotificationResponse: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null)
}));

jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual<typeof import('react-native-gesture-handler')>('react-native-gesture-handler'),
  ScrollView: require('react-native').ScrollView
}));

const mockGetDocumentAsync = jest.mocked(DocumentPicker.getDocumentAsync);

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { Text, View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ({
      data = [],
      ListEmptyComponent,
      ListHeaderComponent,
      refreshControl,
      renderItem
    }: {
      data?: unknown[];
      ListEmptyComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      refreshControl?: React.ReactNode;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    }) =>
      ReactModule.createElement(
        View,
        null,
        refreshControl,
        ReactModule.isValidElement<{ onRefresh?: () => void }>(refreshControl)
          ? ReactModule.createElement(
              Text,
              { testID: 'notification-list-refresh', onPress: refreshControl.props.onRefresh },
              '刷新'
            )
          : null,
        ListHeaderComponent,
        data.length === 0 ? ListEmptyComponent : null,
        ...data.map((item, index) => ReactModule.createElement(View, { key: index }, renderItem?.({ item, index })))
      )
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined)
  }
}));

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { ChevronRight: Icon };
});

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}));

jest.mock('@/features/notifications/MessageReplyComposerSheet', () => {
  const ReactModule = require('react') as typeof React;
  const { Text, TextInput, View } = require('react-native') as typeof import('react-native');
  return {
    MessageReplyComposerSheet: ({
      busy,
      content,
      discourseEmojiUrls,
      error,
      status,
      visible,
      onChangeContent,
      onLoadLinuxDoPollCapabilities,
      onLoadLinuxDoTemplates,
      onSubmit,
      onUploadImage,
      onUseLinuxDoTemplate
    }: {
      busy: boolean;
      content: string;
      discourseEmojiUrls?: Record<string, string>;
      error?: string;
      status?: string;
      visible: boolean;
      onChangeContent: (value: string) => void;
      onLoadLinuxDoPollCapabilities?: () => Promise<unknown>;
      onLoadLinuxDoTemplates?: () => Promise<unknown>;
      onSubmit: () => void;
      onUploadImage?: () => unknown;
      onUseLinuxDoTemplate?: (id: string) => Promise<void>;
    }) =>
      visible
        ? ReactModule.createElement(
            View,
            null,
            error ? ReactModule.createElement(Text, null, error) : null,
            status ? ReactModule.createElement(Text, null, status) : null,
            ReactModule.createElement(TextInput, {
              accessibilityLabel: '私信回复内容',
              value: content,
              onChangeText: onChangeContent
            }),
            ReactModule.createElement(
              Text,
              { testID: 'message-composer-emoji-heart' },
              discourseEmojiUrls?.heart || ''
            ),
            ReactModule.createElement(
              Text,
              { accessibilityLabel: '测试发送私信', onPress: busy || !content.trim() ? undefined : onSubmit },
              '发送'
            ),
            ReactModule.createElement(
              Text,
              {
                accessibilityLabel: '测试上传图片',
                onPress:
                  busy || !onUploadImage
                    ? undefined
                    : async () => {
                        const markup = await onUploadImage();
                        if (typeof markup === 'string') onChangeContent(`${content}${markup}`);
                      }
              },
              '上传图片'
            ),
            ReactModule.createElement(
              Text,
              {
                accessibilityLabel: '测试加载投票能力',
                onPress: onLoadLinuxDoPollCapabilities ? () => void onLoadLinuxDoPollCapabilities() : undefined
              },
              '加载投票能力'
            ),
            ReactModule.createElement(
              Text,
              {
                accessibilityLabel: '测试加载模板',
                onPress: onLoadLinuxDoTemplates ? () => void onLoadLinuxDoTemplates() : undefined
              },
              '加载模板'
            ),
            ReactModule.createElement(
              Text,
              {
                accessibilityLabel: '测试记录模板使用',
                onPress: onUseLinuxDoTemplate ? () => void onUseLinuxDoTemplate('7') : undefined
              },
              '记录模板使用'
            )
          )
        : null
  };
});

const notification: ForumNotification = {
  source: 'nodeseek',
  id: 'reply:old-account',
  kind: 'reply',
  actor: { name: '张三' },
  title: '旧账号消息',
  createdAt: null,
  unread: true,
  target: { type: 'information' }
};

type FocusTestStackParamList = {
  NotificationDetail: { notification: ForumNotification; identityKey: string };
  Notifications: undefined;
  Other: undefined;
};

const FocusTestStack = createNativeStackNavigator<FocusTestStackParamList>();

function routeRuntime(gateway: NotificationRouteRuntimeValue['gateway']): NotificationRouteRuntimeValue {
  return {
    clearReadBlock: jest.fn(),
    getReadBlock: jest.fn(() => undefined),
    reportReadError: jest.fn(),
    sessionEpochs: { nodeseek: 0, linuxdo: 0, yaohuo: 0, v2ex: 0 },
    openAccountSurface: jest.fn(async () => undefined),
    activeSources: ['nodeseek'],
    backgroundEnabled: false,
    backgroundError: '',
    composer: {
      ensureNodeImageApiKey: jest.fn(async () => 'node-image-key'),
      ensureWritableSession: jest.fn(async (source) => ({
        source,
        identityKey: `${source}:new-account`,
        sessionEpoch: 1
      })),
      getDiscourseEmojiUrls: jest.fn(async () => ({})),
      isWritableSessionTicketCurrent: jest.fn(() => true)
    },
    contentWidth: 360,
    enabledNotificationSources: notificationSources,
    gateway,
    identityKeys: { nodeseek: 'nodeseek:new-account' },
    identitySignature: 'nodeseek:new-account',
    notify: jest.fn(),
    onNavigationReady: jest.fn(),
    openSystemSettings: jest.fn(),
    partialUnavailable: false,
    permission: 'denied',
    ready: true,
    reconcileAccountStatus: jest.fn(async () => ({
      status: 'same' as const,
      session: createSiteSessionStates().nodeseek
    })),
    refreshSnapshots: jest.fn(),
    sessions: projectTestAccountSessions(createSiteSessionStates()),
    setCenterVisible: jest.fn(),
    setGlobalEnabled: jest.fn(async () => false),
    setSourceEnabled: jest.fn(async () => undefined),
    snapshotErrors: {},
    state: defaultNotificationState(),
    unreadTotal: 0,
    initializationError: '',
    retryInitialization: jest.fn(async () => undefined)
  } as NotificationRouteRuntimeValue;
}

describe('notification routes', () => {
  async function renderReadLifecycle(markRead: NotificationRouteRuntimeValue['gateway']['markRead']) {
    appQueryClient.clear();
    const detail = { notification, title: 'Read lifecycle', contentText: 'detail' };
    const loadDetail = jest.fn(async () => ({ ...detail }));
    const gateway = { loadDetail, markRead } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const tree = (value: NotificationRouteRuntimeValue) => (
      <NotificationRouteRuntimeProvider value={value}>
        <NavigationContainer ref={navigation}>
          <FocusTestStack.Navigator initialRouteName="NotificationDetail">
            <FocusTestStack.Screen
              name="NotificationDetail"
              initialParams={{ notification, identityKey: 'nodeseek:new-account' }}
            >
              {(props) => (
                <NotificationDetailRoute navigation={props.navigation as never} route={props.route as never} />
              )}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
    const view = await render(tree(runtime), { wrapper: QueryTestWrapper });
    return {
      view,
      navigation,
      loadDetail,
      runtime,
      updateRuntime: (value: NotificationRouteRuntimeValue) => view.rerender(tree(value))
    };
  }

  it.each(['identity-pending', 'source-disabled'] as const)(
    'cancels read access during %s and permits a fresh attempt after restoration',
    async (change) => {
      const markRead = jest
        .fn<NotificationRouteRuntimeValue['gateway']['markRead']>()
        .mockImplementationOnce(
          (_item, _detail, _identity, signal) =>
            new Promise((_resolve, reject) => {
              signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            })
        )
        .mockResolvedValue({ confirmed: true });
      const { runtime, updateRuntime } = await renderReadLifecycle(markRead);
      await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
      await act(async () => {
        await updateRuntime(
          change === 'identity-pending'
            ? { ...runtime, identityKeys: {}, activeSources: [] }
            : { ...runtime, enabledNotificationSources: [], activeSources: [] }
        );
      });
      expect(markRead.mock.calls[0][3]!.aborted).toBe(true);
      await waitFor(() => expect(runtime.refreshSnapshots).toHaveBeenCalledTimes(1));
      await act(async () => {
        await updateRuntime(runtime);
      });
      await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(runtime.refreshSnapshots).toHaveBeenCalledTimes(2));
    }
  );

  it('retries a canceled read on returning to the same detail instance and keeps confirmation', async () => {
    const markRead = jest
      .fn<NotificationRouteRuntimeValue['gateway']['markRead']>()
      .mockImplementationOnce(
        (_item, _detail, _identity, signal) =>
          new Promise((_resolve, reject) => {
            signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          })
      )
      .mockResolvedValue({ confirmed: true });
    const { navigation, runtime } = await renderReadLifecycle(markRead);
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    await act(async () => navigation.navigate('Other'));
    expect(markRead.mock.calls[0][3]!.aborted).toBe(true);
    await waitFor(() => expect(runtime.refreshSnapshots).toHaveBeenCalledTimes(1));
    await act(async () => navigation.goBack());
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(runtime.refreshSnapshots).toHaveBeenCalledTimes(2));
    await act(async () => navigation.navigate('Other'));
    await act(async () => navigation.goBack());
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it.each(['failure', 'unconfirmed'] as const)(
    'allows explicit retry after %s without retrying on detail refresh',
    async (failure) => {
      const markRead = jest.fn<NotificationRouteRuntimeValue['gateway']['markRead']>();
      if (failure === 'failure') markRead.mockRejectedValueOnce(new Error('offline'));
      else markRead.mockResolvedValueOnce({ confirmed: false, message: 'unknown' });
      const pending = Promise.withResolvers<Awaited<ReturnType<typeof markRead>>>();
      markRead.mockReturnValueOnce(pending.promise);
      const { view, loadDetail } = await renderReadLifecycle(markRead);
      await waitFor(() => expect(view.getByLabelText('重试已读状态')).toBeTruthy());
      await act(async () => {
        await appQueryClient.invalidateQueries({
          queryKey: forumQueryKeys.notificationDetail({
            source: notification.source,
            identityKey: 'nodeseek:new-account',
            notificationId: notification.id
          })
        });
      });
      expect(markRead).toHaveBeenCalledTimes(1);
      const before = loadDetail.mock.calls.length;
      await fireEvent.press(view.getByLabelText('重试已读状态'));
      await fireEvent.press(view.getByLabelText('重试已读状态'));
      await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
      expect(loadDetail).toHaveBeenCalledTimes(before + 1);
      const signal = markRead.mock.calls[1][3]!;
      await act(async () => {
        await appQueryClient.invalidateQueries({
          queryKey: forumQueryKeys.notificationDetail({
            source: notification.source,
            identityKey: 'nodeseek:new-account',
            notificationId: notification.id
          })
        });
      });
      expect(signal.aborted).toBe(false);
      await act(async () => {
        pending.resolve({ confirmed: true });
        await pending.promise;
      });
      await waitFor(() => expect(view.queryByLabelText('重试已读状态')).toBeNull());
      expect(markRead).toHaveBeenCalledTimes(2);
    }
  );

  it('ignores an old canceled result and keeps a new confirmation when reconciliation fails', async () => {
    const old = Promise.withResolvers<{ confirmed: boolean; message?: string }>();
    const current = Promise.withResolvers<{ confirmed: boolean }>();
    const markRead = jest
      .fn<NotificationRouteRuntimeValue['gateway']['markRead']>()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const { navigation, view, runtime } = await renderReadLifecycle(markRead);
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    await act(async () => navigation.navigate('Other'));
    await act(async () => navigation.goBack());
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(2));
    jest.mocked(runtime.refreshSnapshots).mockRejectedValue(new Error('snapshot offline'));
    await act(async () => {
      current.resolve({ confirmed: true });
      await current.promise;
    });
    await act(async () => {
      old.resolve({ confirmed: false, message: 'old failure' });
      await old.promise;
    });
    expect(view.queryByText('old failure')).toBeNull();
    expect(view.queryByLabelText('重试已读状态')).toBeNull();
    await act(async () => navigation.navigate('Other'));
    await act(async () => navigation.goBack());
    expect(markRead).toHaveBeenCalledTimes(2);
  });

  it.each(['storage', 'permission'] as const)(
    'recovers a %s initialization failure through the real route retry',
    async (failure) => {
      appQueryClient.clear();
      const stored = defaultNotificationState();
      stored.sources.nodeseek.identityKey = 'nodeseek:42';
      stored.sources.nodeseek.baselineReady = true;
      stored.sources.nodeseek.deliveredIds = ['existing-watermark'];
      let persisted = JSON.stringify(stored);
      jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
      jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
        persisted = value;
      });
      if (failure === 'storage')
        jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('injected storage read'));
      else jest.mocked(notificationPermissionGranted).mockRejectedValueOnce(new Error('injected permission probe'));
      const sessions = projectTestAccountSessions(
        createSiteSessionStates({
          nodeseek: {
            site: 'nodeseek',
            status: 'logged-in',
            cookieSummary: [],
            isVerifying: false,
            currentUser: { source: 'nodeseek', id: '42', username: 'alice', url: 'https://www.nodeseek.com/space/42' }
          }
        })
      );
      function Harness() {
        const runtime = useNotificationsRuntime({
          appActive: true,
          contentSourcesReady: true,
          enabledNotificationSources: ['nodeseek'],
          fetcher: async (url) =>
            new Response(JSON.stringify(url.endsWith('/unread-count') ? { reply: 0 } : { data: [] })),
          getLinuxDoUserAgent: () => 'test',
          getNodeSeekUserAgent: () => 'test',
          onSessionExpired: jest.fn(),
          openSource: () => true,
          privateAccessAllowed: () => true,
          remoteReady: true,
          sessionEpochs: initialForumSessionEpochs,
          sessions
        });
        return (
          <NotificationRouteRuntimeProvider value={{ ...routeRuntime(runtime.gateway), ...runtime }}>
            <NavigationContainer>
              <FocusTestStack.Navigator initialRouteName="Notifications">
                <FocusTestStack.Screen name="Notifications">
                  {(props) => (
                    <NotificationsRoute navigation={props.navigation as never} route={props.route as never} />
                  )}
                </FocusTestStack.Screen>
              </FocusTestStack.Navigator>
            </NavigationContainer>
          </NotificationRouteRuntimeProvider>
        );
      }
      const view = await render(<Harness />, { wrapper: QueryTestWrapper });
      try {
        await waitFor(() => expect(view.getByText('重试通知初始化')).toBeTruthy());
        expect(view.queryByText('请先登录')).toBeNull();
        if (failure === 'storage')
          expect(JSON.parse(persisted).sources.nodeseek.deliveredIds).toEqual(['existing-watermark']);
        await fireEvent.press(view.getByText('重试通知初始化'));
        await waitFor(() => expect(view.queryByText('重试通知初始化')).toBeNull());
        await waitFor(() => expect(view.getByText('暂无消息')).toBeTruthy());
        expect(JSON.parse(persisted).sources.nodeseek.deliveredIds).toEqual(['existing-watermark']);
      } finally {
        await view.unmount();
        jest.mocked(AsyncStorage.getItem).mockImplementation(async () => null);
        jest.mocked(AsyncStorage.setItem).mockImplementation(async () => undefined);
        jest.mocked(notificationPermissionGranted).mockResolvedValue(false);
      }
    }
  );
  it.each([
    { action: 'return during read', remaining: 0 },
    { action: 'return during read', remaining: 1 },
    { action: 'return during read', remaining: 2 },
    { action: 'confirmed read', remaining: 0 },
    { action: 'return during mark all', remaining: 0 },
    { action: 'pull to refresh', remaining: 0 },
    { action: 'reopen notifications', remaining: 0 }
  ])('reconciles $remaining unread after $action', async ({ action, remaining }) => {
    appQueryClient.clear();
    let persisted: string | null = null;
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    let unread = 2;
    let writeSignal: AbortSignal | undefined;
    const fetcher = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/unread-count')) {
        return new Response(JSON.stringify({ reply: unread }), { status: 200 });
      }
      if (url.includes('/markViewed')) {
        // The server has applied the read; returning cancels receipt of its response.
        unread = remaining;
        if (action === 'confirmed read') return new Response(JSON.stringify({ success: true }), { status: 200 });
        writeSignal = init?.signal || undefined;
        return new Promise<Response>((_resolve, reject) => {
          writeSignal?.addEventListener('abort', () => reject(new Error('操作已取消')), { once: true });
        });
      }
      if (url.includes('/list?page=')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      throw new Error(`Unexpected request: ${url}`);
    });
    const sessions = projectTestAccountSessions(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: [],
          isVerifying: false,
          currentUser: {
            source: 'nodeseek',
            id: 'read-badge',
            username: 'reader',
            url: 'https://www.nodeseek.com/space/read-badge'
          }
        }
      })
    );
    const options = {
      appActive: true,
      contentSourcesReady: true,
      enabledNotificationSources: ['nodeseek'] as const,
      fetcher,
      getLinuxDoUserAgent: () => 'test',
      getNodeSeekUserAgent: () => 'test',
      onSessionExpired: jest.fn(),
      openSource: () => true,
      privateAccessAllowed: () => true,
      remoteReady: true,
      sessionEpochs: initialForumSessionEpochs,
      sessions
    };
    const navigationRef = createNavigationContainerRef<FocusTestStackParamList>();
    function Harness() {
      const runtime = useNotificationsRuntime(options);
      return (
        <>
          <Text testID="unread-total">{runtime.unreadTotal}</Text>
          <NotificationRouteRuntimeProvider value={{ ...routeRuntime(runtime.gateway), ...runtime }}>
            <NavigationContainer ref={navigationRef}>
              <FocusTestStack.Navigator initialRouteName="Other">
                <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
                <FocusTestStack.Screen name="Notifications">
                  {(props) => (
                    <NotificationsRoute navigation={props.navigation as never} route={props.route as never} />
                  )}
                </FocusTestStack.Screen>
                <FocusTestStack.Screen name="NotificationDetail">
                  {(props) => (
                    <NotificationDetailRoute navigation={props.navigation as never} route={props.route as never} />
                  )}
                </FocusTestStack.Screen>
              </FocusTestStack.Navigator>
            </NavigationContainer>
          </NotificationRouteRuntimeProvider>
        </>
      );
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    let alert: ReturnType<typeof jest.spyOn> | undefined;
    try {
      await waitFor(() => expect(view.getByTestId('unread-total').props.children).toBe(2));
      if (action === 'return during read' || action === 'confirmed read') {
        await act(async () =>
          navigationRef.navigate('NotificationDetail', {
            notification: { ...notification, id: 'reply:read-badge', remoteReadId: '1', remoteGroup: 'reply-to-me' },
            identityKey: 'nodeseek:read-badge'
          })
        );
        if (action === 'return during read') await waitFor(() => expect(writeSignal).toBeDefined());
        else await waitFor(() => expect(view.getByTestId('unread-total').props.children).toBe(remaining));
        await act(async () => navigationRef.goBack());
        if (writeSignal) expect(writeSignal.aborted).toBe(true);
      } else if (action === 'return during mark all') {
        await act(async () => navigationRef.navigate('Notifications'));
        await fireEvent.press(view.getByTestId('notification-source-nodeseek'));
        await waitFor(() => expect(view.getByText('全部已读')).toBeTruthy());
        alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
          buttons?.find((button) => button.text === '确认')?.onPress?.();
        });
        await fireEvent.press(view.getByText('全部已读'));
        await waitFor(() => expect(writeSignal).toBeDefined());
        await act(async () => navigationRef.goBack());
        expect(writeSignal?.aborted).toBe(true);
      } else {
        await act(async () => navigationRef.navigate('Notifications'));
        await waitFor(() => expect(view.getByText('暂无消息')).toBeTruthy());
        unread = remaining;
        if (action === 'pull to refresh') {
          await fireEvent.press(view.getByTestId('notification-list-refresh'));
        } else {
          await act(async () => navigationRef.goBack());
          await act(async () => navigationRef.navigate('Notifications'));
        }
      }
      await waitFor(() => expect(view.getByTestId('unread-total').props.children).toBe(remaining));
      await waitFor(() => expect(JSON.parse(persisted!).sources.nodeseek.unreadCount).toBe(remaining));
    } finally {
      alert?.mockRestore();
      await view.unmount();
      jest.mocked(AsyncStorage.getItem).mockImplementation(async () => null);
      jest.mocked(AsyncStorage.setItem).mockImplementation(async () => undefined);
    }
  });

  it.each(notificationSources)('opens %s login directly from its account-not-ready state', async (source) => {
    appQueryClient.clear();
    const gateway = {
      getCategories: jest.fn(),
      listPage: jest.fn(),
      listAllPage: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: [],
      identityKeys: {},
      identitySignature: 'none'
    } satisfies NotificationRouteRuntimeValue;
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    expect(view.getByText('账号尚未就绪')).toBeTruthy();
    await fireEvent.press(view.getByText(/^去登录 /));
    expect(runtime.openAccountSurface).toHaveBeenCalledWith(source, '请登录并确认账号身份。');
    expect(runtime.reconcileAccountStatus).not.toHaveBeenCalled();
    expect(gateway.getCategories).not.toHaveBeenCalled();
    expect(gateway.listPage).not.toHaveBeenCalled();
  });

  it.each(notificationSources)(
    'reconciles %s on an ordinary notification retry before opening its login surface',
    async (source) => {
      appQueryClient.clear();
      const fetcher = jest.fn(async () => {
        throw new Error('连接中断');
      });
      const gateway = createNotificationGateway({
        readAccess: () => ({ identityKey: `${source}:42`, userId: '42', username: 'alice', fetcher }),
        sourceAllowed: () => true,
        privateAccessAllowed: () => true
      });
      const runtime = {
        ...routeRuntime(gateway),
        activeSources: [source],
        identityKeys: { [source]: `${source}:42` },
        identitySignature: `${source}:42`,
        reconcileAccountStatus: jest.fn(async () => ({
          status: 'anonymous' as const,
          session: createSiteSessionStates()[source]
        }))
      } satisfies NotificationRouteRuntimeValue;
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn() } as never}
              route={{ key: 'notifications', name: 'Notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(view.getByText(/^重试 /)).toBeTruthy());
      const before = fetcher.mock.calls.length;
      await fireEvent.press(view.getByText(/^重试 /));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledWith(source);
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
      expect(runtime.openAccountSurface).toHaveBeenCalledWith(source, '登录已失效，请重新登录。');
      expect(fetcher).toHaveBeenCalledTimes(before);
    }
  );

  it.each(['categories', 'list'] as const)(
    'recovers the exact LinuxDo %s read through the existing verification surface',
    async (failedRead) => {
      appQueryClient.clear();
      let challenged = true;
      const fetcher = jest.fn(async (input: RequestInfo | URL) => {
        const categories = String(input).includes('/site.json');
        if (challenged && categories === (failedRead === 'categories')) {
          return new Response('<title>Just a moment...</title>', {
            status: 403,
            headers: { 'content-type': 'text/html' }
          });
        }
        return new Response(JSON.stringify(categories ? { notification_types: {} } : { notifications: [] }), {
          headers: { 'content-type': 'application/json' }
        });
      });
      const gateway = createNotificationGateway({
        readAccess: () => ({ identityKey: 'linuxdo:user', userId: 'user', username: 'alice', fetcher }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      let recovery: LinuxDoReadRecovery | undefined;
      const runtime = {
        ...routeRuntime(gateway),
        activeSources: ['linuxdo'],
        identityKeys: { linuxdo: 'linuxdo:user' },
        identitySignature: 'linuxdo:user',
        openAccountSurface: jest.fn<NotificationRouteRuntimeValue['openAccountSurface']>(
          async (_source, _message, next) => {
            recovery = next;
          }
        )
      } satisfies NotificationRouteRuntimeValue;
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn() } as never}
              route={{ key: 'notifications', name: 'Notifications', params: { source: 'linuxdo' } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(view.getByText('去验证 linux.do')).toBeTruthy());
      const beforeOpen = fetcher.mock.calls.length;
      await fireEvent.press(view.getByText('去验证 linux.do'));
      expect(fetcher).toHaveBeenCalledTimes(beforeOpen);
      expect(recovery).toBeDefined();
      challenged = false;
      await act(async () => {
        expect(await recovery!.resume()).toBe('completed');
      });
      await waitFor(() => expect(view.queryByText('去验证 linux.do')).toBeNull());
      expect(
        fetcher.mock.calls.filter(([url]) =>
          String(url).includes(failedRead === 'categories' ? '/site.json' : '/notifications')
        )
      ).toHaveLength(2);
      await view.unmount();
      const settledCalls = fetcher.mock.calls.length;
      expect(await recovery!.resume()).toBe('stale');
      expect(fetcher).toHaveBeenCalledTimes(settledCalls);
    }
  );

  it.each([
    [403, 'same'],
    [429, 'same'],
    [403, 'anonymous'],
    [429, 'anonymous'],
    [403, 'verification'],
    [429, 'unknown']
  ] satisfies [number, 'same' | 'anonymous' | 'verification' | 'unknown'][])(
    'checks ambiguous HTTP %s once and handles %s without guessing expired login',
    async (status, outcome) => {
      appQueryClient.clear();
      let failed = true;
      const fetcher = jest.fn(async () =>
        failed
          ? new Response(JSON.stringify({ errors: ['请求受限'] }), { status })
          : new Response(JSON.stringify({ notifications: [] }))
      );
      const gateway = createNotificationGateway({
        readAccess: () => ({ identityKey: 'linuxdo:user', userId: 'user', username: 'alice', fetcher }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      let finishCheck!: (result: AccountReconcileResult) => void;
      const runtime = {
        ...routeRuntime(gateway),
        activeSources: ['linuxdo'],
        identityKeys: { linuxdo: 'linuxdo:user' },
        identitySignature: 'linuxdo:user',
        reconcileAccountStatus: jest.fn(
          () =>
            new Promise<AccountReconcileResult>((resolve) => {
              finishCheck = resolve;
            })
        )
      } satisfies NotificationRouteRuntimeValue;
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn() } as never}
              route={{ key: 'notifications', name: 'Notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(view.getByText('重试 linux.do')).toBeTruthy());
      await fireEvent.press(view.getByText('重试 linux.do'));
      await fireEvent.press(view.getByText('重试 linux.do'));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      failed = false;
      await act(async () =>
        finishCheck(
          outcome === 'same' || outcome === 'anonymous'
            ? { status: outcome, session: createSiteSessionStates().linuxdo }
            : {
                status: 'unknown',
                error: '核对未完成',
                errorInfo: {
                  kind: outcome === 'verification' ? 'verification-required' : 'ordinary',
                  message: '核对未完成'
                }
              }
        )
      );
      if (outcome === 'same') {
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(runtime.openAccountSurface).not.toHaveBeenCalled();
      } else {
        expect(fetcher).toHaveBeenCalledTimes(1);
        if (outcome === 'unknown') {
          expect(runtime.openAccountSurface).not.toHaveBeenCalled();
          expect(runtime.notify).toHaveBeenCalledWith(expect.stringContaining('账号状态暂不可确认'));
        } else
          expect(runtime.openAccountSurface).toHaveBeenCalledWith(
            'linuxdo',
            expect.any(String),
            ...(outcome === 'verification' ? [expect.objectContaining({ resume: expect.any(Function) })] : [])
          );
      }
    }
  );

  it.each(['login-expired', 'verification-required'] as const)(
    'opens the requested account surface for %s instead of repeating the notification read',
    async (kind) => {
      appQueryClient.clear();
      const listAllPage = jest.fn(async () => ({
        items: [notification],
        errors: { linuxdo: { kind, message: '需要恢复账号' } },
        nextCursors: { nodeseek: null, linuxdo: null },
        hasMore: false
      }));
      const gateway = { listAllPage, listPage: jest.fn() } as unknown as NotificationRouteRuntimeValue['gateway'];
      const openAccountSurface = jest.fn(async () => undefined);
      const runtime = {
        ...routeRuntime(gateway),
        activeSources: ['nodeseek', 'linuxdo'],
        identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:user' },
        identitySignature: 'linuxdo:user|nodeseek:new-account',
        openAccountSurface
      } as NotificationRouteRuntimeValue;
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn() } as never}
              route={{ key: 'notifications', name: 'Notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      const label = `${kind === 'verification-required' ? '去验证' : '去登录'} linux.do`;
      await waitFor(() => expect(view.getByText(label)).toBeTruthy());
      expect(openAccountSurface).not.toHaveBeenCalled();
      await fireEvent.press(view.getByText(label));
      expect(openAccountSurface).toHaveBeenCalledWith(
        'linuxdo',
        '需要恢复账号',
        kind === 'verification-required' ? expect.objectContaining({ resume: expect.any(Function) }) : undefined
      );
      expect(gateway.listPage).not.toHaveBeenCalled();
      expect(listAllPage).toHaveBeenCalledTimes(1);
      expect(view.getByText('旧账号消息')).toBeTruthy();
    }
  );

  it('falls back to All without mounting a source reader when a route parameter is disabled', async () => {
    appQueryClient.clear();
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: [],
      enabledNotificationSources: []
    } as NotificationRouteRuntimeValue;

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    expect(view.getByTestId('notification-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.getByText('尚未启用内容源')).toBeTruthy();
    expect(gateway.getCategories).not.toHaveBeenCalled();
    expect(gateway.listAllPage).not.toHaveBeenCalled();
    expect(gateway.listPage).not.toHaveBeenCalled();
  });

  it('aborts a selected source reader and returns to All when that source is disabled', async () => {
    appQueryClient.clear();
    let categorySignal: AbortSignal | undefined;
    const gateway = {
      getCategories: jest.fn((_source: string, _identityKey: string, signal: AbortSignal) => {
        categorySignal = signal;
        return new Promise<never>(() => undefined);
      }),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    let runtime = routeRuntime(gateway);
    const screen = () => (
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
    const view = await render(screen(), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(categorySignal).toBeDefined());

    runtime = { ...runtime, activeSources: [], enabledNotificationSources: [] };
    await act(async () => view.rerender(screen()));

    await waitFor(() => expect(categorySignal?.aborted).toBe(true));
    expect(view.getByTestId('notification-source-all').props.accessibilityState.selected).toBe(true);
    expect(view.queryByTestId('notification-source-nodeseek')).toBeNull();
  });

  it('shows a disabled-source guide without mounting a notification detail controller', async () => {
    appQueryClient.clear();
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['nodeseek'],
      enabledNotificationSources: ['linuxdo']
    } as NotificationRouteRuntimeValue;

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NotificationDetailRoute
          navigation={{ navigate: jest.fn() } as never}
          route={{
            key: 'notification-detail',
            name: 'NotificationDetail',
            params: { notification, identityKey: 'nodeseek:new-account' }
          }}
        />
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    expect(view.getByText('NodeSeek已停用')).toBeTruthy();
    expect(view.getByText('该内容源已停用，启用后才能查看此内容。')).toBeTruthy();
    expect(view.getByText('管理内容源')).toBeTruthy();
    expect(
      appQueryClient.getQueryState(
        forumQueryKeys.notificationDetail({
          source: notification.source,
          identityKey: 'nodeseek:new-account',
          notificationId: notification.id
        })
      )
    ).toBeUndefined();
    expect(gateway.loadDetail).not.toHaveBeenCalled();
    expect(gateway.markRead).not.toHaveBeenCalled();
  });

  it('settles an empty aggregate list without waiting for the disabled category query', async () => {
    appQueryClient.clear();
    const getCategories = jest.fn();
    const gateway = {
      getCategories,
      listAllPage: jest.fn(async () => ({
        items: [],
        pages: {},
        errors: {},
        nextCursors: { nodeseek: null },
        hasMore: false
      })),
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];

    const view = await render(
      <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('暂无消息')).toBeTruthy());
    expect(view.queryByText('正在读取消息')).toBeNull();
    expect(getCategories).not.toHaveBeenCalled();
  });

  it('retries category discovery before reading a selected source list', async () => {
    appQueryClient.clear();
    const getCategories = jest
      .fn<() => Promise<{ id: string; label: string }[]>>()
      .mockRejectedValueOnce(new Error('分类读取失败'))
      .mockResolvedValueOnce([{ id: 'all', label: '全部' }]);
    const listPage = jest.fn(async () => ({ items: [], cursor: null, hasMore: false }));
    const gateway = {
      getCategories,
      listAllPage: jest.fn(),
      listPage,
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];

    const view = await render(
      <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('重试 NodeSeek')).toBeTruthy());
    expect(view.queryByText('正在读取消息')).toBeNull();
    expect(listPage).not.toHaveBeenCalled();
    await fireEvent.press(view.getByText('重试 NodeSeek'));
    await waitFor(() => expect(view.getByTestId('notification-category-all')).toBeTruthy());
    await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
    expect(getCategories).toHaveBeenCalledTimes(2);
  });

  it('scopes list queries by adapter category and resets category when the site changes', async () => {
    appQueryClient.clear();
    const getCategories = jest.fn(async (source: string) =>
      source === 'nodeseek'
        ? [
            { id: 'inbox', label: '全部' },
            { id: 'messages', label: '私信' }
          ]
        : [
            { id: 'recent', label: '所有通知' },
            { id: 'replies', label: '回复' }
          ]
    );
    const listPage = jest.fn(async () => ({ items: [], cursor: null, hasMore: false }));
    const gateway = {
      getCategories,
      listAllPage: jest.fn(),
      listPage,
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn(),
      replyToConversation: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['nodeseek', 'linuxdo'] as const,
      identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:user' },
      identitySignature: 'linuxdo:user|nodeseek:new-account'
    } as NotificationRouteRuntimeValue;
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByTestId('notification-category-messages')).toBeTruthy());
    await fireEvent.press(view.getByTestId('notification-category-messages'));
    await waitFor(() =>
      expect(listPage).toHaveBeenLastCalledWith('nodeseek', expect.objectContaining({ categoryId: 'messages' }))
    );
    await fireEvent.press(view.getByTestId('notification-source-linuxdo'));
    await waitFor(() => expect(view.getByTestId('notification-category-replies')).toBeTruthy());
    expect(listPage).toHaveBeenLastCalledWith('linuxdo', expect.objectContaining({ categoryId: 'recent' }));
  });

  it('continues category pagination when an earlier source page has no matching rows', async () => {
    appQueryClient.clear();
    const listPage = jest
      .fn<
        (
          _source?: string,
          _options?: unknown
        ) => Promise<{
          items: ForumNotification[];
          cursor: string | null;
          hasMore: boolean;
        }>
      >()
      .mockResolvedValueOnce({ items: [], cursor: '30', hasMore: true })
      .mockResolvedValueOnce({ items: [notification], cursor: null, hasMore: false });
    const gateway = {
      getCategories: jest.fn(async () => [{ id: 'replies', label: '回复' }]),
      listAllPage: jest.fn(),
      listPage,
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];

    const view = await render(
      <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
    expect(listPage).toHaveBeenCalledTimes(2);
    expect(listPage).toHaveBeenLastCalledWith('nodeseek', expect.objectContaining({ cursor: '30' }));
  });

  it('stops the mounted notification list from reading after it loses focus', async () => {
    appQueryClient.clear();
    const listAllPage = jest.fn(async () => ({
      items: [],
      pages: {},
      errors: {},
      nextCursors: { nodeseek: null },
      hasMore: false
    }));
    const gateway = {
      listAllPage,
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const navigationRef = createNavigationContainerRef<FocusTestStackParamList>();
    await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigationRef}>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="Notifications">
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route as never} />}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(listAllPage).toHaveBeenCalledTimes(1));

    await act(async () => navigationRef.navigate('Other'));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Other'));
    await appQueryClient.refetchQueries({
      queryKey: forumQueryKeys.notificationList({
        source: 'all',
        identityKey: runtime.identitySignature,
        unreadOnly: false
      })
    });

    expect(listAllPage).toHaveBeenCalledTimes(1);
  });

  it('retries only the selected unknown account without starting a notification request', async () => {
    appQueryClient.clear();
    const gateway = {
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    runtime.sessions.yaohuo = { ...runtime.sessions.yaohuo, identityTrust: 'unknown' };
    runtime.identityKeys.yaohuo = 'yaohuo:known-account';

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: { source: 'yaohuo' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    expect(view.getByText('账号状态暂不可确认')).toBeTruthy();
    expect(view.queryByText('账号尚未就绪')).toBeNull();
    expect(view.queryByText(/请先登录/)).toBeNull();
    await fireEvent.press(view.getByText('重试账号核对'));
    expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(runtime.reconcileAccountStatus).toHaveBeenCalledWith('yaohuo');
    expect(gateway.listPage).not.toHaveBeenCalled();
  });

  it('presents an all-source unknown identity state without claiming the user is logged out', async () => {
    appQueryClient.clear();
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    runtime.activeSources = [];
    for (const source of runtime.enabledNotificationSources) {
      runtime.sessions[source] = { ...runtime.sessions[source], identityTrust: 'unknown' };
      runtime.identityKeys[source] = `${source}:known-account`;
    }

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    expect(view.getByText('账号状态暂不可确认')).toBeTruthy();
    await fireEvent.press(view.getByText('重试账号核对'));
    expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(notificationSources.length);
    for (const candidate of notificationSources) {
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledWith(candidate);
    }
    expect(view.queryByText(/登录任一|请先登录/)).toBeNull();
    expect(gateway.getCategories).not.toHaveBeenCalled();
    expect(gateway.listAllPage).not.toHaveBeenCalled();
    expect(gateway.listPage).not.toHaveBeenCalled();
  });

  it('retries only the selected failed source in the aggregate list', async () => {
    appQueryClient.clear();
    const linuxdoNotification = { ...notification, source: 'linuxdo', id: 'reply:linuxdo' } as ForumNotification;
    const listAllPage = jest.fn(async () => ({
      items: [notification],
      pages: { nodeseek: { items: [notification], cursor: null, hasMore: false } },
      errors: { linuxdo: { message: '暂不可用' } },
      nextCursors: { nodeseek: null, linuxdo: null },
      hasMore: false
    }));
    const listPage = jest.fn(async () => ({ items: [linuxdoNotification], cursor: null, hasMore: false }));
    const gateway = {
      listAllPage,
      listPage,
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['nodeseek', 'linuxdo'] as const,
      identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:user' },
      identitySignature: 'linuxdo:user|nodeseek:new-account'
    } as NotificationRouteRuntimeValue;

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('重试 linux.do')).toBeTruthy());
    await fireEvent.press(view.getByText('重试 linux.do'));
    await waitFor(() => expect(view.queryByText('重试 linux.do')).toBeNull());
    expect(view.getByText('linux.do · 时间未知')).toBeTruthy();
    expect(listPage).toHaveBeenCalledWith(
      'linuxdo',
      expect.objectContaining({
        cursor: undefined,
        expectedIdentityKey: 'linuxdo:user',
        limit: 30,
        signal: expect.any(AbortSignal),
        unreadOnly: false
      })
    );
    expect(listAllPage).toHaveBeenCalledTimes(1);
  });

  it('keeps recovered source pagination reachable after other sources already paged', async () => {
    appQueryClient.clear();
    const listAllPage = jest.fn(async () => ({
      items: [notification],
      pages: { nodeseek: { items: [notification], cursor: 'ns-next', hasMore: true } },
      errors: { linuxdo: { message: '暂不可用' } },
      nextCursors: { nodeseek: 'ns-next', linuxdo: null },
      hasMore: true
    }));
    const listPage = jest.fn(async () => ({ items: [], cursor: 'linux-next', hasMore: true }));
    const gateway = {
      listAllPage,
      listPage,
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['nodeseek', 'linuxdo'] as const,
      identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:user' },
      identitySignature: 'linuxdo:user|nodeseek:new-account'
    } as NotificationRouteRuntimeValue;
    const queryKey = forumQueryKeys.notificationList({
      source: 'all',
      identityKey: runtime.identitySignature,
      unreadOnly: false
    });
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{ key: 'notifications', name: 'Notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('重试 linux.do')).toBeTruthy());
    await act(async () => {
      appQueryClient.setQueryData(queryKey, (current: any) => ({
        ...current,
        pages: [
          ...current.pages,
          { items: [], errors: {}, hasMore: false, nextPage: { allCursors: { nodeseek: null, linuxdo: null } } }
        ],
        pageParams: [...current.pageParams, { allCursors: { nodeseek: 'ns-next', linuxdo: null } }]
      }));
    });
    await fireEvent.press(view.getByText('重试 linux.do'));

    await waitFor(() => {
      const cached = appQueryClient.getQueryData<any>(queryKey);
      expect(cached.pages.at(-1)).toMatchObject({
        hasMore: true,
        nextPage: { allCursors: { linuxdo: 'linux-next' } }
      });
    });
  });

  it('never loads or marks an old notification through a newly confirmed account', async () => {
    appQueryClient.clear();
    const loadDetail = jest.fn(async () => ({ notification, title: '消息详情', contentText: '正文' }));
    const markRead = jest.fn(async () => ({ confirmed: true }));
    const gateway = {
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail,
      markAllRead: jest.fn(),
      markRead,
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const navigation = { navigate: jest.fn() };

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={navigation as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification, identityKey: 'nodeseek:old-account' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText(/账号状态已变化/)).toBeTruthy());
    expect(loadDetail).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(view.queryByText('重试')).toBeNull();
  });

  it('opens the notification topic and exact reply after detail loading fails on a native press', async () => {
    appQueryClient.clear();
    const item: ForumNotification = {
      ...notification,
      target: {
        type: 'topic-post',
        topicId: '201',
        postId: '987',
        postNumber: 12,
        url: 'https://www.nodeseek.com/post-201-1'
      }
    };
    const gateway = {
      loadDetail: jest.fn(async () => {
        throw new Error('帖子内容未找到');
      }),
      markRead: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const navigation = { navigate: jest.fn() };
    const view = await render(
      <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={navigation as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification: item, identityKey: 'nodeseek:new-account' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('帖子内容未找到')).toBeTruthy());
    await fireEvent.press(view.getByText('前往主题回复'), { nativeEvent: { pageX: 120, pageY: 300 } });

    expect(navigation.navigate).toHaveBeenCalledWith('Topic', {
      topic: expect.objectContaining({ source: 'nodeseek', id: '201', title: item.title }),
      location: { kind: 'reply', target: { commentId: 987, floor: 12 } }
    });
    expect(gateway.markRead).not.toHaveBeenCalled();
  });

  it('opens a topic-only notification without inventing a reply target', async () => {
    appQueryClient.clear();
    const item: ForumNotification = {
      source: 'linuxdo',
      id: 'topic-reminder:18',
      kind: 'system',
      actor: { name: '站内消息' },
      title: '主题提醒',
      preview: '这是主题级通知，不对应某一条回复。',
      createdAt: '2026-08-07T03:00:00.000Z',
      unread: false,
      target: {
        type: 'topic',
        topicId: '201',
        url: 'https://linux.do/t/topic-reminder/201'
      }
    };
    const topic = {
      source: 'linuxdo' as const,
      id: '201',
      title: item.title,
      author: item.actor.name,
      url: 'https://linux.do/t/topic-reminder/201',
      createdAt: item.createdAt || ''
    };
    const gateway = {
      loadDetail: jest.fn(async () => ({
        notification: item,
        title: item.title,
        contentText: item.preview,
        topic
      })),
      markRead: jest.fn(async () => ({ confirmed: true }))
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['linuxdo'] as const,
      identityKeys: { linuxdo: 'linuxdo:alice' },
      identitySignature: 'linuxdo:alice'
    } as NotificationRouteRuntimeValue;
    const navigation = { navigate: jest.fn() };
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={navigation as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification: item, identityKey: 'linuxdo:alice' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText(item.preview!)).toBeTruthy());
    await fireEvent.press(view.getByText('查看相关主题'));

    expect(navigation.navigate).toHaveBeenCalledWith('Topic', {
      topic: expect.objectContaining({ source: 'linuxdo', id: '201' }),
      location: undefined
    });
  });

  it.each(['777', undefined])(
    'preserves a notification opening identity until it can be confirmed: %s',
    async (postId) => {
      appQueryClient.clear();
      const item: ForumNotification = {
        source: 'linuxdo',
        id: 'watching-first-post:54',
        kind: 'system',
        actor: { name: 'everythink98' },
        title: 'LINUX DO 社区抽奖规则',
        createdAt: '2026-08-06T23:50:00.000Z',
        unread: false,
        target: {
          type: 'topic-post',
          topicId: '201',
          postId,
          postNumber: 1,
          url: 'https://linux.do/t/lottery-rules/201/1'
        }
      };
      const topic = {
        source: 'linuxdo' as const,
        id: '201',
        title: item.title,
        author: item.actor.name,
        url: item.target.type === 'topic-post' ? item.target.url : '',
        createdAt: item.createdAt || ''
      };
      const gateway = {
        loadDetail: jest.fn(async () => ({
          notification: item,
          title: item.title,
          contentText: '抽奖规则正文',
          topic
        })),
        markRead: jest.fn(async () => ({ confirmed: true }))
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const runtime = {
        ...routeRuntime(gateway),
        activeSources: ['linuxdo'] as const,
        identityKeys: { linuxdo: 'linuxdo:alice' },
        identitySignature: 'linuxdo:alice'
      } as NotificationRouteRuntimeValue;
      const navigation = { navigate: jest.fn() };
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationDetailRoute
              navigation={navigation as never}
              route={{
                key: 'notification-detail',
                name: 'NotificationDetail',
                params: { notification: item, identityKey: 'linuxdo:alice' }
              }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(view.getByText('抽奖规则正文')).toBeTruthy());
      await fireEvent.press(view.getByText('查看相关主题'));

      expect(navigation.navigate).toHaveBeenCalledWith('Topic', {
        topic: expect.objectContaining({ source: 'linuxdo', id: '201' }),
        location: postId ? { kind: 'reply', target: { commentId: 777, floor: 1 } } : { kind: 'opening' }
      });
    }
  );

  it('forwards the Yaohuo full-reply floor into the Topic route', async () => {
    appQueryClient.clear();
    const item: ForumNotification = {
      source: 'yaohuo',
      id: 'message:41',
      kind: 'private-message',
      actor: { name: 'Clover' },
      title: '妖火私信',
      createdAt: '2026-07-03T05:45:52.000Z',
      unread: false,
      target: {
        type: 'message-detail',
        messageId: '41',
        url: 'https://www.yaohuo.me/bbs/messagelist_view.aspx?id=41'
      }
    };
    const gateway = {
      loadDetail: jest.fn(async () => ({
        notification: item,
        title: '妖火私信',
        contentHtml:
          '<a href="https://www.yaohuo.me/bbs/book_re.aspx?classid=177&amp;id=1560939&amp;tofloor=90&amp;fromuserid=1000">查看完整回复</a>'
      })),
      markRead: jest.fn(async () => ({ confirmed: true }))
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['yaohuo'] as const,
      identityKeys: { yaohuo: 'yaohuo:7' },
      identitySignature: 'yaohuo:7'
    } as NotificationRouteRuntimeValue;
    const navigation = { navigate: jest.fn() };
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={navigation as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification: item, identityKey: 'yaohuo:7' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByRole('link', { name: '查看完整回复' })).toBeTruthy());
    await fireEvent.press(view.getByRole('link', { name: '查看完整回复' }));

    expect(navigation.navigate).toHaveBeenCalledWith('Topic', {
      topic: expect.objectContaining({ source: 'yaohuo', id: '1560939', categoryId: '177' }),
      location: { kind: 'reply', target: { floor: 90 } }
    });
  });

  it('reports an external notification link that Android cannot open', async () => {
    appQueryClient.clear();
    const item: ForumNotification = {
      ...notification,
      id: 'information:external-link',
      kind: 'system',
      unread: false
    };
    const gateway = {
      loadDetail: jest.fn(async () => ({
        notification: item,
        title: '系统消息',
        contentHtml: '<a href="https://example.com/help">查看帮助</a> <a href="mailto:support@example.com">邮件支持</a>'
      })),
      markRead: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const navigation = { navigate: jest.fn() };
    const rejection = Promise.reject(new Error('browser unavailable'));
    void rejection.catch(() => undefined);
    const openBrowserAsync = jest.spyOn(WebBrowser, 'openBrowserAsync').mockReturnValue(rejection);
    try {
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationDetailRoute
              navigation={navigation as never}
              route={{
                key: 'notification-detail',
                name: 'NotificationDetail',
                params: { notification: item, identityKey: 'nodeseek:new-account' }
              }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(view.getByRole('link', { name: '查看帮助' })).toBeTruthy());
      await fireEvent.press(view.getByRole('link', { name: '查看帮助' }));
      await waitFor(() => expect(runtime.notify).toHaveBeenCalledWith('browser unavailable'));

      expect(openBrowserAsync).toHaveBeenCalledTimes(1);
      expect(runtime.notify).toHaveBeenCalledTimes(1);
      expect(gateway.loadDetail).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).not.toHaveBeenCalled();

      await fireEvent.press(view.getByRole('link', { name: '邮件支持' }));

      expect(openBrowserAsync).toHaveBeenCalledTimes(1);
      expect(runtime.notify).toHaveBeenNthCalledWith(2, '仅支持打开 http/https 链接。');
      expect(runtime.notify).toHaveBeenCalledTimes(2);
      expect(gateway.loadDetail).toHaveBeenCalledTimes(1);
      expect(navigation.navigate).not.toHaveBeenCalled();
    } finally {
      openBrowserAsync.mockRestore();
    }
  });

  it('routes private-message original and bubble links through the same external owner', async () => {
    appQueryClient.clear();
    const item: ForumNotification = {
      ...notification,
      id: 'message:external-links',
      kind: 'private-message',
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    const gateway = {
      loadDetail: jest.fn(async () => ({
        notification: item,
        title: '私信详情',
        contentHtml: '<a href="https://example.com/original">原消息外链</a>',
        messages: [
          {
            id: 'message-1',
            author: 'Bob',
            contentHtml: '<a href="https://example.com/bubble">气泡外链</a>',
            mine: false
          }
        ],
        reply: { format: 'markdown' as const }
      })),
      markRead: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const openBrowserAsync = jest
      .spyOn(WebBrowser, 'openBrowserAsync')
      .mockResolvedValue({ type: WebBrowser.WebBrowserResultType.OPENED });
    try {
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationDetailRoute
              navigation={{ navigate: jest.fn() } as never}
              route={{
                key: 'notification-detail',
                name: 'NotificationDetail',
                params: { notification: item, identityKey: 'nodeseek:new-account' }
              }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(view.getByRole('link', { name: '原消息外链' })).toBeTruthy());
      await fireEvent.press(view.getByRole('link', { name: '原消息外链' }));
      await fireEvent.press(view.getByRole('link', { name: '气泡外链' }));

      expect(openBrowserAsync).toHaveBeenNthCalledWith(1, 'https://example.com/original');
      expect(openBrowserAsync).toHaveBeenNthCalledWith(2, 'https://example.com/bubble');
      expect(runtime.notify).not.toHaveBeenCalled();
    } finally {
      openBrowserAsync.mockRestore();
    }
  });

  it('keeps the cached source emoji catalog across private composer mounts', async () => {
    const defaultOptions = appQueryClient.getDefaultOptions();
    appQueryClient.setDefaultOptions({
      ...defaultOptions,
      queries: { ...defaultOptions.queries, gcTime: 1_000 }
    });
    appQueryClient.clear();
    try {
      const privateNotification: ForumNotification = {
        ...notification,
        source: 'linuxdo',
        id: 'message:emoji-cache',
        kind: 'private-message',
        unread: false,
        target: { type: 'private-conversation', conversationId: '9' }
      };
      const gateway = {
        loadDetail: jest.fn(async () => ({
          notification: privateNotification,
          title: 'linux.do 私信',
          messages: [],
          reply: { format: 'markdown' as const }
        })),
        markRead: jest.fn(async () => ({ confirmed: true }))
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const getDiscourseEmojiUrls = jest.fn(async () => ({ heart: 'https://linux.do/network-heart.png' }));
      const runtime = {
        ...routeRuntime(gateway),
        activeSources: ['linuxdo'],
        composer: {
          ...routeRuntime(gateway).composer,
          getDiscourseEmojiUrls
        },
        identityKeys: { linuxdo: 'linuxdo:alice' },
        identitySignature: 'linuxdo:alice'
      } as NotificationRouteRuntimeValue;
      const first = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationDetailRoute
              navigation={{ navigate: jest.fn() } as never}
              route={{
                key: 'notification-detail',
                name: 'NotificationDetail',
                params: { notification: privateNotification, identityKey: 'linuxdo:alice' }
              }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(first.getByLabelText('回复私信')).toBeTruthy());
      await fireEvent.press(first.getByLabelText('回复私信'));
      await waitFor(() =>
        expect(first.getByTestId('message-composer-emoji-heart').props.children).toBe(
          'https://linux.do/network-heart.png'
        )
      );
      expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(1);
      jest.useFakeTimers();
      try {
        await first.unmount();
        await act(() => {
          jest.advanceTimersByTime(1_001);
        });
      } finally {
        jest.useRealTimers();
      }

      const second = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationDetailRoute
              navigation={{ navigate: jest.fn() } as never}
              route={{
                key: 'notification-detail-remount',
                name: 'NotificationDetail',
                params: { notification: privateNotification, identityKey: 'linuxdo:alice' }
              }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );

      await waitFor(() => expect(second.getByLabelText('回复私信')).toBeTruthy());
      await fireEvent.press(second.getByLabelText('回复私信'));
      expect(second.getByTestId('message-composer-emoji-heart').props.children).toBe(
        'https://linux.do/network-heart.png'
      );
      expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(1);
      await second.unmount();
    } finally {
      appQueryClient.setDefaultOptions(defaultOptions);
      appQueryClient.removeQueries({ queryKey: forumQueryKeys.emojiUrls('linuxdo'), exact: true });
    }
  });

  it('binds LinuxDo composer requests to the route identity and aborts them on unmount', async () => {
    appQueryClient.clear();
    const privateNotification: ForumNotification = {
      ...notification,
      source: 'linuxdo',
      id: 'message:composer-access',
      kind: 'private-message',
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    const pending = () => new Promise<never>(() => undefined);
    const loadLinuxDoPollCapabilities = jest.fn((_identityKey: string, _signal: AbortSignal) => pending());
    const loadLinuxDoTemplates = jest.fn((_identityKey: string, _signal: AbortSignal) => pending());
    const recordLinuxDoTemplateUse = jest.fn((_id: string, _identityKey: string, _signal: AbortSignal) => pending());
    const gateway = {
      loadDetail: jest.fn(async () => ({
        notification: privateNotification,
        title: 'linux.do 私信',
        messages: [],
        reply: { format: 'markdown' as const }
      })),
      loadLinuxDoPollCapabilities,
      loadLinuxDoTemplates,
      markRead: jest.fn(async () => ({ confirmed: true })),
      recordLinuxDoTemplateUse
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['linuxdo'],
      identityKeys: { linuxdo: 'linuxdo:alice' },
      identitySignature: 'linuxdo:alice'
    } as NotificationRouteRuntimeValue;
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification: privateNotification, identityKey: 'linuxdo:alice' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByLabelText('回复私信')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('回复私信'));
    await fireEvent.press(view.getByLabelText('测试加载投票能力'));
    await fireEvent.press(view.getByLabelText('测试加载模板'));
    await fireEvent.press(view.getByLabelText('测试记录模板使用'));
    await waitFor(() => {
      expect(loadLinuxDoPollCapabilities).toHaveBeenCalledWith('linuxdo:alice', expect.any(AbortSignal));
      expect(loadLinuxDoTemplates).toHaveBeenCalledWith('linuxdo:alice', expect.any(AbortSignal));
      expect(recordLinuxDoTemplateUse).toHaveBeenCalledWith('7', 'linuxdo:alice', expect.any(AbortSignal));
    });
    const signals = [
      loadLinuxDoPollCapabilities.mock.calls[0]![1],
      loadLinuxDoTemplates.mock.calls[0]![1],
      recordLinuxDoTemplateUse.mock.calls[0]![2]
    ];

    await view.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('opens a first conversation without writing and preserves failed or unconfirmed drafts until confirmation', async () => {
    appQueryClient.clear();
    const privateNotification: ForumNotification = {
      ...notification,
      id: 'conversation:9',
      kind: 'private-message',
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    const replyToConversation = jest
      .fn<() => Promise<{ confirmed: boolean; message?: string }>>()
      .mockRejectedValueOnce(new Error('发送失败'))
      .mockResolvedValueOnce({ confirmed: false, message: '原站未确认' })
      .mockResolvedValueOnce({ confirmed: true });
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(async () => ({
        notification: privateNotification,
        title: '私信详情',
        messages: [],
        reply: { format: 'markdown' as const }
      })),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn(),
      replyToConversation
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification: privateNotification, identityKey: 'nodeseek:new-account' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
    expect(view.getByText('还没有私信，点击下方输入区开始聊天。')).toBeTruthy();
    expect(view.queryByLabelText('私信回复内容')).toBeNull();
    expect(gateway.markRead).not.toHaveBeenCalled();
    expect(gateway.listPage).not.toHaveBeenCalled();
    await fireEvent.press(view.getByLabelText('发私信'));
    await fireEvent.changeText(view.getByLabelText('私信回复内容'), 'PRIVATE_DRAFT');
    await act(async () => {
      const onPress = view.getByLabelText('测试发送私信').props.onPress as () => void;
      onPress();
      onPress();
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('发送失败')).toBeTruthy());
    expect(view.getByLabelText('私信回复内容').props.value).toBe('PRIVATE_DRAFT');
    expect(replyToConversation).toHaveBeenCalledTimes(1);

    await fireEvent.press(view.getByLabelText('测试发送私信'));
    await waitFor(() => expect(view.getByText('原站未确认')).toBeTruthy());
    expect(view.getByLabelText('私信回复内容').props.value).toBe('PRIVATE_DRAFT');
    expect(replyToConversation).toHaveBeenCalledTimes(2);
    expect(replyToConversation.mock.calls[0]).toEqual([
      privateNotification,
      'PRIVATE_DRAFT',
      'nodeseek:new-account',
      expect.any(AbortSignal)
    ]);
    await fireEvent.press(view.getByLabelText('测试发送私信'));
    await waitFor(() => expect(runtime.notify).toHaveBeenCalledWith('回复已发送'));
    expect(view.queryByLabelText('私信回复内容')).toBeNull();
    await fireEvent.press(view.getByLabelText('发私信'));
    expect(view.getByLabelText('私信回复内容').props.value).toBe('');
    expect(runtime.refreshSnapshots).toHaveBeenCalledTimes(1);
  });

  it('preserves a private draft while identity is pending and clears it after a confirmed switch', async () => {
    appQueryClient.clear();
    const privateNotification: ForumNotification = {
      ...notification,
      id: 'message:pending-draft',
      kind: 'private-message',
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(async () => ({
        notification: privateNotification,
        title: '私信详情',
        messages: [],
        reply: { format: 'markdown' as const }
      })),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn(),
      replyToConversation: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const activeRuntime = routeRuntime(gateway);
    const renderRoute = (runtime: NotificationRouteRuntimeValue) => (
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification: privateNotification, identityKey: 'nodeseek:new-account' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
    const view = await render(renderRoute(activeRuntime), { wrapper: QueryTestWrapper });

    await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('发私信'));
    await fireEvent.changeText(view.getByLabelText('私信回复内容'), 'PENDING_DRAFT');

    const pendingRuntime = { ...activeRuntime, activeSources: [] } as NotificationRouteRuntimeValue;
    await act(async () => view.rerender(renderRoute(pendingRuntime)));
    expect(view.queryByLabelText('私信回复内容')).toBeNull();

    await act(async () => view.rerender(renderRoute(activeRuntime)));
    await fireEvent.press(view.getByLabelText('发私信'));
    expect(view.getByLabelText('私信回复内容').props.value).toBe('PENDING_DRAFT');

    const switchedRuntime = {
      ...activeRuntime,
      identityKeys: { nodeseek: 'nodeseek:next-account' },
      identitySignature: 'nodeseek:next-account'
    } as NotificationRouteRuntimeValue;
    await act(async () => view.rerender(renderRoute(switchedRuntime)));
    await act(async () => view.rerender(renderRoute(activeRuntime)));
    await fireEvent.press(view.getByLabelText('发私信'));
    expect(view.getByLabelText('私信回复内容').props.value).toBe('');
  });

  it('aborts an in-flight private reply when the detail route loses focus', async () => {
    appQueryClient.clear();
    const privateNotification: ForumNotification = {
      ...notification,
      id: 'message:blur',
      kind: 'private-message',
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    const replyToConversation = jest.fn(
      (_item: ForumNotification, _content: string, _identityKey: string, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        )
    );
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(async () => ({
        notification: privateNotification,
        title: '私信详情',
        messages: [],
        reply: { format: 'markdown' as const }
      })),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn(),
      replyToConversation
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const navigationRef = createNavigationContainerRef<FocusTestStackParamList>();
    const view = await render(
      <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
        <NavigationContainer ref={navigationRef}>
          <FocusTestStack.Navigator initialRouteName="NotificationDetail">
            <FocusTestStack.Screen
              name="NotificationDetail"
              initialParams={{ notification: privateNotification, identityKey: 'nodeseek:new-account' }}
            >
              {(props) => (
                <NotificationDetailRoute navigation={props.navigation as never} route={props.route as never} />
              )}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('发私信'));
    await fireEvent.changeText(view.getByLabelText('私信回复内容'), '仍在发送的草稿');
    await fireEvent.press(view.getByLabelText('测试发送私信'));
    await waitFor(() => expect(replyToConversation).toHaveBeenCalledTimes(1));
    const signal = replyToConversation.mock.calls[0]?.[3] as AbortSignal;

    await act(async () => navigationRef.navigate('Other'));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Other'));
    expect(signal.aborted).toBe(true);
    expect(view.queryByLabelText('私信回复内容')).toBeNull();
  });

  it('gates private-message image picking, inserts markup without sending, and ignores duplicate or canceled picks', async () => {
    appQueryClient.clear();
    mockGetDocumentAsync.mockReset();
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///reply.png', name: 'reply.png', mimeType: 'image/png', size: 512, lastModified: 0 }]
    });
    const privateNotification: ForumNotification = {
      ...notification,
      id: 'message:image',
      kind: 'private-message',
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    const uploadReplyImage = jest.fn(async () => ({ markup: '![reply.png](https://img.example/reply.png)' }));
    const replyToConversation = jest.fn();
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(),
      listPage: jest.fn(),
      loadDetail: jest.fn(async () => ({
        notification: privateNotification,
        title: '私信详情',
        messages: [],
        reply: { format: 'markdown' as const }
      })),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn(),
      replyToConversation,
      uploadReplyImage
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const ensureWritableSession = jest.fn(async () => ({
      source: 'nodeseek' as const,
      identityKey: 'nodeseek:new-account',
      sessionEpoch: 1
    }));
    const ensureNodeImageApiKey = jest.fn(async () => 'node-image-key');
    runtime.composer = {
      ...runtime.composer,
      ensureNodeImageApiKey,
      ensureWritableSession
    };
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={{ navigate: jest.fn() } as never}
            route={{
              key: 'notification-detail',
              name: 'NotificationDetail',
              params: { notification: privateNotification, identityKey: 'nodeseek:new-account' }
            }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('发私信'));
    await act(async () => {
      const onPress = view.getByLabelText('测试上传图片').props.onPress as () => void;
      onPress();
      onPress();
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText('图片已插入草稿')).toBeTruthy());

    expect(ensureWritableSession).toHaveBeenCalledTimes(1);
    expect(ensureNodeImageApiKey).toHaveBeenCalledTimes(1);
    expect(ensureWritableSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetDocumentAsync.mock.invocationCallOrder[0]!
    );
    expect(ensureNodeImageApiKey.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetDocumentAsync.mock.invocationCallOrder[0]!
    );
    expect(uploadReplyImage).toHaveBeenCalledTimes(1);
    expect(uploadReplyImage).toHaveBeenCalledWith(
      'nodeseek',
      expect.objectContaining({
        expectedIdentityKey: 'nodeseek:new-account',
        file: expect.objectContaining({ name: 'reply.png', mimeType: 'image/png' }),
        nodeImageApiKey: 'node-image-key',
        signal: expect.any(AbortSignal)
      })
    );
    expect(view.getByLabelText('私信回复内容').props.value).toBe('![reply.png](https://img.example/reply.png)');
    expect(replyToConversation).not.toHaveBeenCalled();

    mockGetDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    await fireEvent.press(view.getByLabelText('测试上传图片'));
    await waitFor(() => expect(mockGetDocumentAsync).toHaveBeenCalledTimes(2));
    expect(uploadReplyImage).toHaveBeenCalledTimes(1);
  });

  it('cancels an in-flight read write when the confirmed account changes', async () => {
    appQueryClient.clear();
    let resolveWriteAccess!: (access: NotificationAdapterAccess) => void;
    let accessCalls = 0;
    const sourceAdapter: NotificationAdapter = {
      getCategories: jest.fn(async () => [{ id: 'all', label: '全部' }]),
      listPage: jest.fn(async () => ({ items: [], cursor: null, hasMore: false })),
      readUnreadSnapshot: jest.fn(async () => ({
        total: 0,
        checkedAt: '2026-08-03T00:00:00Z'
      })),
      loadDetail: jest.fn(async (item: ForumNotification) => ({
        notification: item,
        title: '消息详情',
        contentText: '正文'
      })),
      replyToConversation: jest.fn(async () => ({ confirmed: true })),
      markRead: jest.fn(async () => ({ confirmed: true }))
    };
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: sourceAdapter,
        yaohuo: sourceAdapter
      },
      privateAccessAllowed: () => true,
      readAccess: async () => {
        accessCalls += 1;
        if (accessCalls === 1) return { identityKey: 'nodeseek:new-account', userId: 'new-account' };
        return new Promise<NotificationAdapterAccess>((resolve) => {
          resolveWriteAccess = resolve;
        });
      },
      sourceAllowed: () => true
    });
    let runtime = routeRuntime(gateway);
    const route = {
      key: 'notification-detail',
      name: 'NotificationDetail' as const,
      params: { notification, identityKey: 'nodeseek:new-account' }
    };
    const navigation = { navigate: jest.fn() };
    const screen = () => (
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute navigation={navigation as never} route={route} />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
    const view = await render(screen(), { wrapper: QueryTestWrapper });

    await waitFor(() => expect(accessCalls).toBe(2));
    runtime = {
      ...runtime,
      identityKeys: { nodeseek: 'nodeseek:next-account' },
      identitySignature: 'nodeseek:next-account'
    };
    await view.rerender(screen());
    resolveWriteAccess({ identityKey: 'nodeseek:next-account', userId: 'next-account' });

    await waitFor(() => expect(view.getByText(/账号状态已变化/)).toBeTruthy());
    expect(sourceAdapter.markRead).not.toHaveBeenCalled();
  });

  it('cancels an in-flight mark-all when the selected account changes', async () => {
    appQueryClient.clear();
    let resolveWriteAccess!: (access: NotificationAdapterAccess) => void;
    let accessCalls = 0;
    const sourceAdapter: NotificationAdapter = {
      getCategories: jest.fn(async () => [{ id: 'all', label: '全部' }]),
      listPage: jest.fn(async () => ({ items: [], cursor: null, hasMore: false })),
      readUnreadSnapshot: jest.fn(async () => ({
        total: 0,
        checkedAt: '2026-08-03T00:00:00Z'
      })),
      loadDetail: jest.fn(async (item: ForumNotification) => ({ notification: item, title: item.title })),
      replyToConversation: jest.fn(async () => ({ confirmed: true })),
      markRead: jest.fn(async () => ({ confirmed: true })),
      markAllRead: jest.fn(async () => ({ confirmed: true }))
    };
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: sourceAdapter,
        linuxdo: sourceAdapter,
        yaohuo: sourceAdapter
      },
      privateAccessAllowed: () => true,
      readAccess: async () => {
        accessCalls += 1;
        if (accessCalls <= 2) return { identityKey: 'nodeseek:new-account', userId: 'new-account' };
        if (accessCalls === 3) {
          return new Promise<NotificationAdapterAccess>((resolve) => {
            resolveWriteAccess = resolve;
          });
        }
        return { identityKey: 'nodeseek:next-account', userId: 'next-account' };
      },
      sourceAllowed: () => true
    });
    let runtime = routeRuntime(gateway);
    const route = {
      key: 'notifications',
      name: 'Notifications' as const,
      params: { source: 'nodeseek' as const }
    };
    const navigation = { navigate: jest.fn() };
    const screen = () => (
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute navigation={navigation as never} route={route} />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '确认')?.onPress?.();
    });

    try {
      const view = await render(screen(), { wrapper: QueryTestWrapper });
      await waitFor(() => expect(view.getByLabelText('将 NodeSeek 全部标记为已读')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('将 NodeSeek 全部标记为已读'));
      await waitFor(() => expect(accessCalls).toBe(3));

      runtime = {
        ...runtime,
        identityKeys: { nodeseek: 'nodeseek:next-account' },
        identitySignature: 'nodeseek:next-account'
      };
      await view.rerender(screen());
      resolveWriteAccess({ identityKey: 'nodeseek:next-account', userId: 'next-account' });

      await waitFor(() => expect(view.getByLabelText('将 NodeSeek 全部标记为已读')).toBeTruthy());
      expect(sourceAdapter.markAllRead).not.toHaveBeenCalled();
      expect(runtime.notify).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });
});
