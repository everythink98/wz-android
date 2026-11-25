import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { createNavigationContainerRef, NavigationContainer, StackActions } from '@react-navigation/native';
import { defaultScheduler, focusManager, notifyManager } from '@tanstack/react-query';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Alert, Linking, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNotificationsRuntime } from '@/features/notifications/useNotificationsRuntime';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';
import type {
  ForumNotification,
  NotificationDetail,
  NotificationMarkResult,
  NotificationPage
} from '@/domain/notifications/models';
import type { DiscoursePostPolicy } from '@/domain/forum/discoursePolicy';
import type { SourceErrorInfo, Topic, TopicDetail, UserReference } from '@/domain/forum/models';
import { notificationPageError } from '@/domain/notifications/notificationQuality';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticEvent } from '@/platform/diagnostics/diagnosticPolicy';
import type { AccountReconcileResult } from '@/domain/session/sessionContracts';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import { notificationSources, type NotificationSource } from '@/domain/forum/sourceCatalog';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import {
  NotificationDetailRoute,
  NotificationSettingsRoute,
  NotificationsRoute
} from '@/features/notifications/NotificationRoute';
import {
  NotificationRouteRuntimeProvider,
  type NotificationRouteRuntimeValue
} from '@/features/notifications/NotificationRouteRuntime';
import { defaultNotificationState } from '@/platform/notifications/notificationStore';
import {
  ensureMessageNotificationChannel,
  notificationPermissionGranted,
  requestNotificationPermission,
  syncNotificationBackgroundRegistration
} from '@/platform/notifications/notificationSystem';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { captureDiscoursePolicyRead, recordDiscoursePolicyReceipt } from '@/platform/query/discoursePolicyCache';
import { cleanupContentSourceQueries } from '@/app/useContentSourceQueryCleanup';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';
import type { NotificationAdapter, NotificationAdapterAccess } from '@/sources/notificationAdapter';
import { createNotificationGateway } from '@/sources/notificationGateway';
import { notificationAdapters } from '@/sources/notificationAdapters';
import * as uploadImagePreparation from '@/platform/media/prepareUploadImage';
import { MessageSubmissionFixture } from '../composerMessageFixture';
import { COMPOSER_DRAFT, createComposerTransport } from '../composerSubmissionFixture';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

afterEach(() => setDiagnosticWriter(null));

let mockListNavigationProps: React.ComponentProps<
  typeof import('@/features/notifications/NotificationScreens').NotificationsScreen
>;
let mockDetailNavigationProps: React.ComponentProps<
  typeof import('@/features/notifications/NotificationScreens').NotificationDetailScreen
>;
jest.mock('@/features/notifications/NotificationScreens', () => {
  const actual = jest.requireActual<typeof import('@/features/notifications/NotificationScreens')>(
    '@/features/notifications/NotificationScreens'
  );
  return {
    ...actual,
    NotificationsScreen: (props: typeof mockListNavigationProps) => {
      mockListNavigationProps = props;
      return <actual.NotificationsScreen {...props} />;
    },
    NotificationDetailScreen: (props: typeof mockDetailNavigationProps) => {
      mockDetailNavigationProps = props;
      return <actual.NotificationDetailScreen {...props} />;
    }
  };
});

const mockHistoricalHtmlRender = jest.fn<(html: string) => void>();
jest.mock('react-native-render-html', () => {
  const ReactModule = require('react') as typeof React;
  const actual = jest.requireActual<typeof import('react-native-render-html')>('react-native-render-html/src');
  return {
    __esModule: true,
    ...actual,
    default: (props: React.ComponentProps<typeof actual.default>) => {
      if ('html' in props.source && props.source.html.includes('历史消息')) {
        mockHistoricalHtmlRender(props.source.html);
      }
      return ReactModule.createElement(actual.default, props);
    }
  };
});

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn()
}));

jest.mock('@/platform/notifications/notificationSystem', () => ({
  ensureMessageNotificationChannel: jest.fn(async () => undefined),
  notificationPermissionGranted: jest.fn(async () => false),
  requestNotificationPermission: jest.fn(async () => false),
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
let mockNotificationListCommit: ((data: unknown[]) => void) | undefined;

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { Text, View } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ({
      data = [],
      ListEmptyComponent,
      ListHeaderComponent,
      onEndReached,
      refreshControl,
      renderItem
    }: {
      data?: unknown[];
      ListEmptyComponent?: React.ReactNode;
      ListHeaderComponent?: React.ReactNode;
      onEndReached?: () => void;
      refreshControl?: React.ReactNode;
      renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
    }) => {
      ReactModule.useLayoutEffect(() => {
        mockNotificationListCommit?.(data);
      });
      return ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, { testID: 'notification-list-end', onPress: onEndReached }, '列表末尾'),
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
      );
    }
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
  return { ChevronDown: Icon, ChevronRight: Icon, SquarePen: Icon };
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
      onSubmit: () => unknown;
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
              {
                accessibilityLabel: '测试发送私信',
                onPress: busy || !content.trim() ? undefined : () => void onSubmit()
              },
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
  NotificationSettings: undefined;
  notifications: { source?: NotificationSource } | undefined;
  Other: undefined;
  User: { user: UserReference };
  Topic: { topic: Topic };
};

const FocusTestStack = createNativeStackNavigator<FocusTestStackParamList>();

function linuxDoDetailTree(
  runtime: NotificationRouteRuntimeValue,
  item: ForumNotification,
  navigation: ReturnType<typeof createNavigationContainerRef<FocusTestStackParamList>>
) {
  return (
    <NotificationRouteRuntimeProvider value={runtime}>
      <NavigationContainer ref={navigation}>
        <FocusTestStack.Navigator initialRouteName="NotificationDetail">
          <FocusTestStack.Screen
            name="NotificationDetail"
            initialParams={{ notification: item, identityKey: 'linuxdo:7' }}
          >
            {(props) => <NotificationDetailRoute navigation={props.navigation as never} route={props.route} />}
          </FocusTestStack.Screen>
          <FocusTestStack.Screen name="Other">{() => <Text>其他页面</Text>}</FocusTestStack.Screen>
        </FocusTestStack.Navigator>
      </NavigationContainer>
    </NotificationRouteRuntimeProvider>
  );
}

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
    state: defaultNotificationState(),
    unreadTotal: 0,
    initializationError: '',
    retryInitialization: jest.fn(async () => undefined)
  } as NotificationRouteRuntimeValue;
}

async function renderNotificationSettings(openSystemSettings?: NotificationRouteRuntimeValue['openSystemSettings']) {
  const navigation = createNavigationContainerRef<FocusTestStackParamList>();
  const subscription = Linking.addEventListener('url', () => {});
  const addEventListener = jest.fn<typeof Linking.addEventListener>(() => subscription);
  const linking = { addEventListener, getInitialURL: async () => null };
  const pushTopic = (destination: { topic: Topic }) => {
    if (!navigation.isReady()) return false;
    navigation.dispatch(StackActions.push('Topic', destination));
    return true;
  };
  const sessions = projectTestAccountSessions(createSiteSessionStates());
  const ignore = jest.fn();
  function Harness() {
    const onReady = useAppDeepLinkNavigation(linking, pushTopic);
    const runtime = useNotificationsRuntime({
      appActive: true,
      contentSourcesReady: true,
      enabledNotificationSources: notificationSources,
      fetcher: async () => new Response('{}'),
      getLinuxDoUserAgent: () => 'test',
      getNodeSeekUserAgent: () => 'test',
      onSessionExpired: ignore,
      requestAccountRecheck: jest.fn(() => undefined),
      openSource: () => true,
      privateAccessAllowed: () => false,
      remoteReady: false,
      sessionEpochs: initialForumSessionEpochs,
      sessions
    });
    return (
      <NotificationRouteRuntimeProvider
        value={{ ...routeRuntime(runtime.gateway), ...runtime, ...(openSystemSettings ? { openSystemSettings } : {}) }}
      >
        <NavigationContainer ref={navigation} onReady={onReady}>
          <FocusTestStack.Navigator initialRouteName="NotificationSettings">
            <FocusTestStack.Screen name="NotificationSettings" component={NotificationSettingsRoute} />
            <FocusTestStack.Screen name="Topic">{() => <Text>新打开的主题</Text>}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  const followLink = () => {
    const [[, onUrl]] = addEventListener.mock.calls;
    onUrl({ url: 'https://linux.do/t/176543' });
    expect(navigation.getCurrentRoute()?.name).toBe('Topic');
  };
  return { view, navigation, followLink };
}
describe('notification routes', () => {
  it('claims a settings operation before two switch events can start the same change', async () => {
    const runtime = routeRuntime({} as NotificationRouteRuntimeValue['gateway']);
    runtime.state = { ...defaultNotificationState(), hasOptedIn: true };
    const pending = Promise.withResolvers<boolean>();
    runtime.setGlobalEnabled = jest.fn(() => pending.promise);
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="NotificationSettings" component={NotificationSettingsRoute} />
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    const toggle = view.getByTestId('notification-global-switch').props.onChange;
    const event = { nativeEvent: { value: true } };
    await act(async () => {
      toggle(event);
      toggle(event);
    });
    expect(runtime.setGlobalEnabled).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(true));
  });
  it.each(['left', 'returned', 'current'] as const)(
    'applies first Android notification opt-in once with current settings focus after %s',
    async (transition) => {
      let persisted = defaultNotificationState();
      const read = jest.mocked(AsyncStorage.getItem);
      const write = jest.mocked(AsyncStorage.setItem);
      const permission = jest.mocked(requestNotificationPermission);
      read.mockClear().mockImplementation(async () => JSON.stringify(persisted));
      write.mockClear().mockImplementation(async (_key, value) => {
        persisted = JSON.parse(value);
      });
      const permissionResult = Promise.withResolvers<boolean>();
      permission.mockClear().mockReturnValue(permissionResult.promise);
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const { view, navigation, followLink } = await renderNotificationSettings();
      const requestOptIn = async () => {
        const toggle = await view.findByTestId('notification-global-switch');
        await waitFor(() => expect(toggle.props.accessibilityState.disabled).toBe(false));
        await fireEvent(toggle, 'valueChange', true);
        expect(alert.mock.calls.at(-1)?.[0]).toBe('开启 Android 消息通知');
        const accept = alert.mock.calls.at(-1)?.[2]?.find(({ text }) => text === '继续')?.onPress;
        expect(accept).toBeDefined();
        return accept!;
      };
      try {
        let confirm = await requestOptIn();
        expect(persisted.hasOptedIn).toBe(false);
        expect(permission).not.toHaveBeenCalled();
        if (transition !== 'current') {
          await act(async () => {
            followLink();
            if (transition === 'left') confirm();
          });
          await act(async () => navigation.goBack());
          expect(navigation.getCurrentRoute()?.name).toBe('NotificationSettings');
          if (transition === 'returned') await act(async () => confirm());
          expect(persisted.globalEnabled).toBe(false);
          expect(persisted.hasOptedIn).toBe(false);
          expect(write).not.toHaveBeenCalled();
          expect(permission).not.toHaveBeenCalled();
          confirm = await requestOptIn();
        }
        await act(async () => {
          confirm();
          confirm();
        });
        await waitFor(() => expect(permission).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(persisted.androidPermissionRequestStarted).toBe(true));
        expect(write).toHaveBeenCalledTimes(2);
        expect(persisted).toMatchObject({
          globalEnabled: true,
          hasOptedIn: true,
          androidPermissionRequestStarted: true
        });
        await act(async () => {
          followLink();
          permissionResult.resolve(true);
        });
        expect(persisted.globalEnabled).toBe(true);
        expect(permission).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(2);
      } finally {
        permissionResult.resolve(false);
        await view.unmount();
        read.mockImplementation(async () => null);
        write.mockImplementation(async () => undefined);
        permission.mockReset().mockResolvedValue(false);
        alert.mockRestore();
      }
    }
  );

  it.each(['left', 'returned'] as const)(
    'does not publish permission feedback to a settings visit after it is %s',
    async (visit) => {
      const runtime = routeRuntime({} as NotificationRouteRuntimeValue['gateway']);
      runtime.state = { ...defaultNotificationState(), hasOptedIn: true };
      const pending = Promise.withResolvers<boolean>();
      runtime.setGlobalEnabled = jest.fn(() => pending.promise);
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName="NotificationSettings">
              <FocusTestStack.Screen name="NotificationSettings" component={NotificationSettingsRoute} />
              <FocusTestStack.Screen name="Other">{() => <Text>其他页面</Text>}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await fireEvent(view.getByTestId('notification-global-switch'), 'valueChange', true);
        expect(runtime.setGlobalEnabled).toHaveBeenCalledTimes(1);
        await act(async () => navigation.navigate('Other'));
        expect(navigation.getCurrentRoute()?.name).toBe('Other');
        if (visit === 'returned') await act(async () => navigation.goBack());
        await act(async () => pending.resolve(false));
        expect(runtime.notify).not.toHaveBeenCalled();
      } finally {
        pending.resolve(false);
        await view.unmount();
      }
    }
  );

  it('keeps first opt-in settings usable on native permission exception and recovers via retry initialization', async () => {
    const initial = defaultNotificationState();
    initial.sources.nodeseek.identityKey = 'nodeseek:42';
    let persisted = initial;
    const read = jest.mocked(AsyncStorage.getItem);
    const write = jest.mocked(AsyncStorage.setItem);
    const probe = jest.mocked(notificationPermissionGranted);
    const permission = jest.mocked(requestNotificationPermission);
    const syncBackground = jest.mocked(syncNotificationBackgroundRegistration);
    read.mockClear().mockImplementation(async () => JSON.stringify(persisted));
    write.mockClear().mockImplementation(async (_key, value) => {
      persisted = JSON.parse(value);
    });
    probe.mockReset().mockResolvedValue(false);
    permission.mockReset().mockRejectedValueOnce(new Error('native permission bridge failed'));
    syncBackground.mockClear();

    const notify = jest.fn();
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
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    function Harness() {
      const runtime = useNotificationsRuntime({
        appActive: true,
        contentSourcesReady: true,
        enabledNotificationSources: notificationSources,
        fetcher: async () => new Response(JSON.stringify({ data: [] })),
        getLinuxDoUserAgent: () => 'test',
        getNodeSeekUserAgent: () => 'test',
        onSessionExpired: jest.fn(),
        requestAccountRecheck: jest.fn(() => undefined),
        openSource: () => true,
        privateAccessAllowed: () => true,
        remoteReady: false,
        sessionEpochs: initialForumSessionEpochs,
        sessions
      });
      return (
        <NotificationRouteRuntimeProvider value={{ ...routeRuntime(runtime.gateway), ...runtime, notify }}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName="NotificationSettings">
              <FocusTestStack.Screen name="NotificationSettings" component={NotificationSettingsRoute} />
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
    }
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    try {
      const toggle = await view.findByTestId('notification-global-switch');
      await waitFor(() => expect(toggle.props.accessibilityState.disabled).toBe(false));
      syncBackground.mockClear();

      await fireEvent(toggle, 'valueChange', true);
      expect(alert).toHaveBeenCalledTimes(1);
      const accept = alert.mock.calls[0]?.[2]?.find(({ text }) => text === '继续')?.onPress;
      expect(accept).toBeDefined();
      await act(async () => {
        accept?.();
      });

      await waitFor(() => expect(view.getByText('系统通知权限读取失败，请重试；站内消息仍可使用。')).toBeTruthy());
      expect(view.getByText('重试通知初始化')).toBeTruthy();
      expect(view.queryByText('系统通知权限未开启')).toBeNull();
      expect(view.queryByText('打开系统设置')).toBeNull();
      expect(notify).not.toHaveBeenCalledWith('系统通知权限未开启，已保留你的设置');
      expect(persisted).toMatchObject({
        globalEnabled: true,
        hasOptedIn: true,
        sources: {
          nodeseek: expect.objectContaining({ intentEnabled: true }),
          linuxdo: expect.objectContaining({ intentEnabled: true }),
          yaohuo: expect.objectContaining({ intentEnabled: true })
        }
      });
      expect(syncBackground).toHaveBeenCalled();
      for (const call of syncBackground.mock.calls) expect(call[1]).toBe(false);

      // Toggling off and back on must not re-open the first-time confirmation or permission prompt.
      await fireEvent(view.getByTestId('notification-global-switch'), 'valueChange', false);
      await waitFor(() => expect(view.getByTestId('notification-global-switch').props.value).toBe(false));
      await fireEvent(view.getByTestId('notification-global-switch'), 'valueChange', true);
      await waitFor(() => expect(view.getByTestId('notification-global-switch').props.value).toBe(true));
      expect(alert).toHaveBeenCalledTimes(1);
      expect(permission).toHaveBeenCalledTimes(1);

      // Retrying initialization re-reads permission and clears the error on success.
      probe.mockResolvedValueOnce(true);
      await fireEvent.press(view.getByText('重试通知初始化'));
      await waitFor(() => expect(view.queryByText('重试通知初始化')).toBeNull());
      expect(view.queryByText('系统通知权限读取失败，请重试；站内消息仍可使用。')).toBeNull();
      await waitFor(() =>
        expect(syncBackground).toHaveBeenLastCalledWith(
          expect.objectContaining({ globalEnabled: true, hasOptedIn: true }),
          true,
          ['nodeseek']
        )
      );
    } finally {
      await view.unmount();
      read.mockImplementation(async () => null);
      write.mockImplementation(async () => undefined);
      probe.mockReset().mockResolvedValue(false);
      permission.mockReset().mockResolvedValue(false);
      alert.mockRestore();
    }
  });

  it.each(['granted', 'denied', 'bridge-exception'] as const)(
    'recovers Android permission on a replaced settings screen after interruption during channel creation and suppresses stale toasts (%s)',
    async (outcome) => {
      const initial = defaultNotificationState();
      initial.sources.nodeseek.identityKey = 'nodeseek:42';
      let persisted: Record<string, unknown> = initial as unknown as Record<string, unknown>;
      const read = jest.mocked(AsyncStorage.getItem);
      const write = jest.mocked(AsyncStorage.setItem);
      const channel = jest.mocked(ensureMessageNotificationChannel);
      const probe = jest.mocked(notificationPermissionGranted);
      const permission = jest.mocked(requestNotificationPermission);
      const syncBackground = jest.mocked(syncNotificationBackgroundRegistration);
      read.mockClear().mockImplementation(async () => JSON.stringify(persisted));
      write.mockClear().mockImplementation(async (_key, value) => {
        persisted = JSON.parse(value);
      });
      probe.mockReset().mockResolvedValue(false);
      channel.mockReset();
      permission.mockReset();
      syncBackground.mockClear();

      const oldChannelPending = Promise.withResolvers<void>();
      channel.mockReturnValueOnce(oldChannelPending.promise).mockResolvedValue(undefined);
      if (outcome === 'granted') permission.mockResolvedValueOnce(true);
      else if (outcome === 'denied') permission.mockResolvedValueOnce(false);
      else permission.mockRejectedValueOnce(new Error('native permission bridge failed'));

      const oldNotify = jest.fn();
      const newNotify = jest.fn();
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
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      function SettingsHarness({ notify }: { notify: jest.Mock }) {
        const runtime = useNotificationsRuntime({
          appActive: true,
          contentSourcesReady: true,
          enabledNotificationSources: notificationSources,
          fetcher: async () => new Response(JSON.stringify({ data: [] })),
          getLinuxDoUserAgent: () => 'test',
          getNodeSeekUserAgent: () => 'test',
          onSessionExpired: jest.fn(),
          requestAccountRecheck: jest.fn(() => undefined),
          openSource: () => true,
          privateAccessAllowed: () => true,
          remoteReady: false,
          sessionEpochs: initialForumSessionEpochs,
          sessions
        });
        return (
          <NotificationRouteRuntimeProvider value={{ ...routeRuntime(runtime.gateway), ...runtime, notify }}>
            <NavigationContainer>
              <FocusTestStack.Navigator initialRouteName="NotificationSettings">
                <FocusTestStack.Screen name="NotificationSettings" component={NotificationSettingsRoute} />
              </FocusTestStack.Navigator>
            </NavigationContainer>
          </NotificationRouteRuntimeProvider>
        );
      }

      const oldView = await render(<SettingsHarness notify={oldNotify} />, { wrapper: QueryTestWrapper });
      let newView: Awaited<ReturnType<typeof render>> | undefined;
      try {
        const oldToggle = await oldView.findByTestId('notification-global-switch');
        await waitFor(() => expect(oldToggle.props.accessibilityState.disabled).toBe(false));

        // First regress cancel confirmation: canceling alert persists nothing and calls no OS/channel APIs.
        await fireEvent(oldToggle, 'valueChange', true);
        expect(alert).toHaveBeenCalledTimes(1);
        const cancel = alert.mock.calls[0]?.[2]?.find(({ text }) => text === '取消')?.onPress;
        await act(async () => cancel?.());
        expect(write).not.toHaveBeenCalled();
        expect(channel).not.toHaveBeenCalled();
        expect(permission).not.toHaveBeenCalled();
        expect(oldNotify).not.toHaveBeenCalled();

        // Confirm opt-in; pause during channel creation BEFORE OS permission API is called.
        await fireEvent(oldToggle, 'valueChange', true);
        expect(alert).toHaveBeenCalledTimes(2);
        const accept = alert.mock.calls[1]?.[2]?.find(({ text }) => text === '继续')?.onPress;
        await act(async () => accept?.());
        await waitFor(() => expect(channel).toHaveBeenCalledTimes(1));
        expect(permission).not.toHaveBeenCalled();
        expect(persisted).toMatchObject({
          globalEnabled: true,
          hasOptedIn: true,
          androidPermissionRequestStarted: false
        });

        // Replace runtime + settings screen BEFORE OS call is issued.
        newView = await render(<SettingsHarness notify={newNotify} />, { wrapper: QueryTestWrapper });
        expect(await newView.findByText('继续申请权限')).toBeTruthy();
        expect(newView.queryByText('打开系统设置')).toBeNull();

        // Late channel completion on stale old runtime must not issue OS call, toast, or register background.
        const syncBeforeStaleChannel = syncBackground.mock.calls.length;
        await act(async () => {
          oldChannelPending.resolve();
          await Promise.resolve();
        });
        expect(permission).not.toHaveBeenCalled();
        expect(oldNotify).not.toHaveBeenCalled();
        expect(syncBackground.mock.calls).toHaveLength(syncBeforeStaleChannel);
        expect(persisted.androidPermissionRequestStarted).toBe(false);

        // User taps "继续申请权限" on the active replacement screen -> exactly 1 OS permission request.
        await fireEvent.press(newView.getByText('继续申请权限'));
        await waitFor(() => expect(permission).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(persisted.androidPermissionRequestStarted).toBe(true));

        if (outcome === 'granted') {
          await waitFor(() => expect(newView!.queryByText('继续申请权限')).toBeNull());
          expect(newView.queryByText('打开系统设置')).toBeNull();
          expect(newNotify).not.toHaveBeenCalled();
          await waitFor(() =>
            expect(syncBackground).toHaveBeenLastCalledWith(
              expect.objectContaining({
                globalEnabled: true,
                hasOptedIn: true,
                androidPermissionRequestStarted: true
              }),
              true,
              ['nodeseek']
            )
          );
        } else if (outcome === 'denied') {
          await waitFor(() => expect(newView!.getByText('打开系统设置')).toBeTruthy());
          expect(newView.queryByText('继续申请权限')).toBeNull();
          expect(newNotify).toHaveBeenCalledWith('系统通知权限未开启，已保留你的设置');
          expect(syncBackground).toHaveBeenLastCalledWith(
            expect.objectContaining({ globalEnabled: true, androidPermissionRequestStarted: true }),
            false,
            ['nodeseek']
          );
        } else {
          await waitFor(() => expect(newView!.getByText('重试通知初始化')).toBeTruthy());
          expect(newView.queryByText('继续申请权限')).toBeNull();
          expect(newView.queryByText('打开系统设置')).toBeNull();
          expect(newNotify).toHaveBeenCalledWith('系统通知权限读取失败，已保留你的设置，请重试通知初始化');
          expect(syncBackground).toHaveBeenLastCalledWith(
            expect.objectContaining({ globalEnabled: true, androidPermissionRequestStarted: true }),
            false,
            ['nodeseek']
          );
        }
        expect(oldNotify).not.toHaveBeenCalled();

        // Regress disabling notifications on active screen: persists globalEnabled=false and preserves started flag.
        const notifyCallsBeforeDisable = newNotify.mock.calls.length;
        await fireEvent(newView.getByTestId('notification-global-switch'), 'valueChange', false);
        await waitFor(() => expect(persisted.globalEnabled).toBe(false));
        expect(persisted).toMatchObject({
          globalEnabled: false,
          hasOptedIn: true,
          androidPermissionRequestStarted: true
        });
        expect(newNotify).toHaveBeenCalledTimes(notifyCallsBeforeDisable);
        expect(permission).toHaveBeenCalledTimes(1);
      } finally {
        oldChannelPending.resolve();
        await newView?.unmount();
        await oldView.unmount();
        read.mockImplementation(async () => null);
        write.mockImplementation(async () => undefined);
        channel.mockReset().mockResolvedValue(undefined);
        probe.mockReset().mockResolvedValue(false);
        permission.mockReset().mockResolvedValue(false);
        alert.mockRestore();
      }
    }
  );

  it.each(['denied', 'bridge-exception'] as const)(
    'suppresses stale screen toasts and keeps process-wide OS permission requests at 1 when replaced after OS call (%s)',
    async (lateOutcome) => {
      const initial = defaultNotificationState();
      initial.sources.nodeseek.identityKey = 'nodeseek:42';
      let persisted: Record<string, unknown> = initial as unknown as Record<string, unknown>;
      const read = jest.mocked(AsyncStorage.getItem);
      const write = jest.mocked(AsyncStorage.setItem);
      const channel = jest.mocked(ensureMessageNotificationChannel);
      const probe = jest.mocked(notificationPermissionGranted);
      const permission = jest.mocked(requestNotificationPermission);
      const syncBackground = jest.mocked(syncNotificationBackgroundRegistration);
      read.mockClear().mockImplementation(async () => JSON.stringify(persisted));
      write.mockClear().mockImplementation(async (_key, value) => {
        persisted = JSON.parse(value);
      });
      channel.mockReset().mockResolvedValue(undefined);
      probe.mockReset().mockResolvedValue(false);
      permission.mockReset();
      syncBackground.mockClear();

      const osPending = Promise.withResolvers<boolean>();
      permission.mockReturnValueOnce(osPending.promise);

      const oldNotify = jest.fn();
      const newNotify = jest.fn();
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
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      function SettingsHarness({ notify }: { notify: jest.Mock }) {
        const runtime = useNotificationsRuntime({
          appActive: true,
          contentSourcesReady: true,
          enabledNotificationSources: notificationSources,
          fetcher: async () => new Response(JSON.stringify({ data: [] })),
          getLinuxDoUserAgent: () => 'test',
          getNodeSeekUserAgent: () => 'test',
          onSessionExpired: jest.fn(),
          requestAccountRecheck: jest.fn(() => undefined),
          openSource: () => true,
          privateAccessAllowed: () => true,
          remoteReady: false,
          sessionEpochs: initialForumSessionEpochs,
          sessions
        });
        return (
          <NotificationRouteRuntimeProvider value={{ ...routeRuntime(runtime.gateway), ...runtime, notify }}>
            <NavigationContainer>
              <FocusTestStack.Navigator initialRouteName="NotificationSettings">
                <FocusTestStack.Screen name="NotificationSettings" component={NotificationSettingsRoute} />
              </FocusTestStack.Navigator>
            </NavigationContainer>
          </NotificationRouteRuntimeProvider>
        );
      }

      const oldView = await render(<SettingsHarness notify={oldNotify} />, { wrapper: QueryTestWrapper });
      let newView: Awaited<ReturnType<typeof render>> | undefined;
      try {
        const oldToggle = await oldView.findByTestId('notification-global-switch');
        await waitFor(() => expect(oldToggle.props.accessibilityState.disabled).toBe(false));
        await fireEvent(oldToggle, 'valueChange', true);
        const accept = alert.mock.calls[0]?.[2]?.find(({ text }) => text === '继续')?.onPress;
        await act(async () => accept?.());
        await waitFor(() => expect(permission).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(persisted.androidPermissionRequestStarted).toBe(true));

        // Replace runtime + screen AFTER OS permission call was issued.
        newView = await render(<SettingsHarness notify={newNotify} />, { wrapper: QueryTestWrapper });
        expect(await newView.findByText('打开系统设置')).toBeTruthy();
        expect(newView.queryByText('继续申请权限')).toBeNull();

        const syncCallsBeforeLateSettlement = syncBackground.mock.calls.length;
        await act(async () => {
          if (lateOutcome === 'denied') osPending.resolve(false);
          else osPending.reject(new Error('late bridge exception'));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });

        expect(permission).toHaveBeenCalledTimes(1);
        expect(oldNotify).not.toHaveBeenCalled();
        expect(newNotify).not.toHaveBeenCalled();
        expect(syncBackground.mock.calls).toHaveLength(syncCallsBeforeLateSettlement);
        expect(persisted).toMatchObject({
          globalEnabled: true,
          hasOptedIn: true,
          androidPermissionRequestStarted: true
        });
      } finally {
        osPending.resolve(false);
        await newView?.unmount();
        await oldView.unmount();
        read.mockImplementation(async () => null);
        write.mockImplementation(async () => undefined);
        channel.mockReset().mockResolvedValue(undefined);
        probe.mockReset().mockResolvedValue(false);
        permission.mockReset().mockResolvedValue(false);
        alert.mockRestore();
      }
    }
  );

  it.each(['global', 'source', 'system'] as const)(
    'ignores a queued %s notification settings action after a warm link and permits a fresh action',
    async (action) => {
      const defaults = defaultNotificationState();
      const before = {
        ...defaults,
        globalEnabled: true,
        hasOptedIn: true,
        androidPermissionRequestStarted: true,
        sources: { ...defaults.sources, nodeseek: { ...defaults.sources.nodeseek, intentEnabled: true } }
      };
      let persisted = before;
      const read = jest.mocked(AsyncStorage.getItem);
      const write = jest.mocked(AsyncStorage.setItem);
      read.mockClear().mockImplementation(async () => JSON.stringify(persisted));
      write.mockClear().mockImplementation(async (_key, value) => {
        persisted = JSON.parse(value);
      });
      const openSystemSettings = jest.fn(async () => undefined);
      const { view, navigation, followLink } = await renderNotificationSettings(openSystemSettings);
      const perform = async (includeHiddenElements = false) => {
        if (action === 'system') {
          await fireEvent.press(view.getByRole('button', { name: '打开系统设置', includeHiddenElements }));
          return;
        }
        const testId = action === 'global' ? 'notification-global-switch' : 'notification-source-switch-nodeseek';
        await fireEvent(view.getByTestId(testId, { includeHiddenElements }), 'valueChange', false);
      };
      try {
        const toggle = await view.findByTestId('notification-global-switch');
        await waitFor(() => expect(toggle.props.accessibilityState.disabled).toBe(false));
        expect(toggle.props.value).toBe(true);
        await act(async () => {
          followLink();
          await perform(true);
        });
        expect(persisted).toEqual(before);
        expect(write).not.toHaveBeenCalled();
        expect(openSystemSettings).not.toHaveBeenCalled();

        await act(() => navigation.goBack());
        await perform();
        if (action === 'system') {
          expect(openSystemSettings).toHaveBeenCalledTimes(1);
          expect(write).not.toHaveBeenCalled();
        } else {
          await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
          expect(persisted.globalEnabled).toBe(action !== 'global');
          expect(persisted.sources.nodeseek.intentEnabled).toBe(action !== 'source');
        }
      } finally {
        await view.unmount();
        read.mockImplementation(async () => null);
        write.mockImplementation(async () => undefined);
      }
    }
  );
  it.each(['list', 'topic', 'actor'] as const)(
    'ignores captured %s navigation after leaving the notification route and permits returning',
    async (source) => {
      appQueryClient.clear();
      const item = { ...notification, id: 'first', unread: false, actor: { id: '9', name: 'actor' } };
      const topic: Topic = {
        source: 'nodeseek',
        id: '42',
        title: 'Linked topic',
        author: 'actor',
        createdAt: '2026-10-24T00:00:00Z',
        url: 'https://www.nodeseek.com/post-42-1'
      };
      const gateway = {
        getCategories: jest.fn(async () => []),
        listAllPage: jest.fn(async () => ({ items: [item], errors: {}, nextCursors: {}, hasMore: false })),
        loadDetail: jest.fn(async () => ({ notification: item, title: 'Loaded detail', contentText: 'body', topic })),
        markRead: jest.fn(async () => ({ confirmed: true }))
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const view = await render(
        <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName={source === 'list' ? 'notifications' : 'NotificationDetail'}>
              <FocusTestStack.Screen name="notifications">
                {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen
                name="NotificationDetail"
                initialParams={{ notification: item, identityKey: 'nodeseek:new-account' }}
              >
                {(props) =>
                  source === 'list' ? null : (
                    <NotificationDetailRoute navigation={props.navigation as never} route={props.route} />
                  )
                }
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Topic">{() => null}</FocusTestStack.Screen>
              <FocusTestStack.Screen name="User">{() => null}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await waitFor(() =>
          expect(source === 'list' ? mockListNavigationProps.items : mockDetailNavigationProps.detail).toBeTruthy()
        );
        const list = mockListNavigationProps;
        const detail = mockDetailNavigationProps;
        const open = (id: string) =>
          source === 'list'
            ? list.onItemPress({ ...item, id })
            : source === 'topic'
              ? detail.onOpenTopic({ ...topic, id })
              : detail.onOpenActor?.({
                  source: 'nodeseek',
                  id,
                  username: `actor${id}`,
                  url: `https://www.nodeseek.com/space/${id}`
                });
        await act(() => {
          open('42');
          open('43');
          open('44');
        });
        expect(navigation.getRootState()?.routes).toHaveLength(2);
        expect(navigation.getCurrentRoute()?.params).toEqual(
          expect.objectContaining(
            source === 'list'
              ? { notification: expect.objectContaining({ id: '42' }) }
              : source === 'topic'
                ? { topic: expect.objectContaining({ id: '42' }) }
                : { user: expect.objectContaining({ id: '42' }) }
          )
        );
        await act(() => navigation.goBack());
        await act(() => open('43'));
        expect(navigation.getRootState()?.routes).toHaveLength(2);
      } finally {
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );
  it.each(['current', 'blur', 'background'] as const)(
    'handles a pending detail account check after %s without opening an obsolete login intent',
    async (change) => {
      appQueryClient.clear();
      const item: ForumNotification = {
        ...notification,
        source: 'linuxdo',
        id: 'pm:201',
        unread: false,
        target: { type: 'private-conversation', conversationId: '201' }
      };
      const fetcher = jest.fn(async () => new Response('{"errors":["页面不存在"]}', { status: 404 }));
      const gateway = createNotificationGateway({
        readAccess: () => ({ identityKey: 'linuxdo:7', userId: '7', fetcher }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const accountCheck = Promise.withResolvers<AccountReconcileResult>();
      let runtime: NotificationRouteRuntimeValue = {
        ...routeRuntime(gateway),
        activeSources: ['linuxdo'],
        identityKeys: { linuxdo: 'linuxdo:7' },
        identitySignature: 'linuxdo:7',
        reconcileAccountStatus: jest.fn(() => accountCheck.promise)
      };
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const tree = () => (
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName="NotificationDetail">
              <FocusTestStack.Screen
                name="NotificationDetail"
                initialParams={{ notification: item, identityKey: 'linuxdo:7' }}
              >
                {(props) => <NotificationDetailRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
      const view = await render(tree(), { wrapper: QueryTestWrapper });
      try {
        await waitFor(() => expect(view.getByText('重试')).toBeTruthy());
        await fireEvent.press(view.getByText('重试'));
        await fireEvent.press(view.getByText('重试'));
        expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
        if (change === 'blur') await act(async () => navigation.navigate('Other'));
        if (change === 'background') await act(async () => focusManager.setFocused(false));
        runtime = {
          ...runtime,
          activeSources: [],
          identityKeys: {},
          sessionEpochs: { ...runtime.sessionEpochs, linuxdo: 1 }
        };
        // Commit the anonymous epoch before the pending controller returns its result.
        await view.rerender(tree());
        await act(async () => {
          accountCheck.resolve({ status: 'anonymous', session: createSiteSessionStates().linuxdo });
          await accountCheck.promise;
        });
        if (change === 'current') {
          await waitFor(() => expect(runtime.openAccountSurface).toHaveBeenCalledTimes(1));
        } else {
          expect(runtime.openAccountSurface).not.toHaveBeenCalled();
          if (change === 'blur') await act(async () => navigation.goBack());
          else await act(async () => focusManager.setFocused(true));
          await waitFor(() => expect(view.getByText('去登录')).toBeTruthy());
          await fireEvent.press(view.getByText('去登录'));
          await waitFor(() => expect(runtime.openAccountSurface).toHaveBeenCalledTimes(1));
        }
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        accountCheck.resolve({ status: 'stale' });
        await act(async () => focusManager.setFocused(true));
        await view.unmount();
      }
    }
  );

  it.each(['epoch', 'identity', 'disabled'] as const)(
    'resumes the exact detail after verification and isolates a stale %s recovery',
    async (change) => {
      const events: DiagnosticEvent[] = [];
      setDiagnosticWriter((line) => {
        events.push(JSON.parse(line));
      });
      appQueryClient.clear();
      const item: ForumNotification = {
        ...notification,
        source: 'linuxdo',
        id: 'pm:201',
        unread: false,
        target: { type: 'private-conversation', conversationId: '201' }
      };
      let challenged = true;
      const response = Promise.withResolvers<Response>();
      const fetcher = jest.fn(async () =>
        challenged
          ? new Response('<title>Just a moment...</title>', { status: 403, headers: { 'content-type': 'text/html' } })
          : response.promise
      );
      const gateway = createNotificationGateway({
        readAccess: () => ({ identityKey: 'linuxdo:7', userId: '7', fetcher }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      let recovery: ReadRecovery | undefined;
      let runtime = {
        ...routeRuntime(gateway),
        activeSources: ['linuxdo'],
        identityKeys: { linuxdo: 'linuxdo:7' },
        identitySignature: 'linuxdo:7',
        openAccountSurface: jest.fn<NotificationRouteRuntimeValue['openAccountSurface']>(
          async (_source, _message, next) => {
            recovery = next;
          }
        )
      } satisfies NotificationRouteRuntimeValue;
      const tree = () => (
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationDetailRoute
              navigation={{ navigate: jest.fn(), setOptions: jest.fn() } as never}
              route={{
                key: 'detail',
                name: 'NotificationDetail',
                params: { notification: item, identityKey: 'linuxdo:7' }
              }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
      const view = await render(tree(), { wrapper: QueryTestWrapper });
      try {
        await waitFor(() => expect(view.getByText('去验证')).toBeTruthy());
        const initialReads = fetcher.mock.calls.length;
        await fireEvent.press(view.getByText('去验证'));
        expect(fetcher).toHaveBeenCalledTimes(initialReads);
        expect(recovery?.queryKey).toEqual(
          forumQueryKeys.notificationDetail({
            source: 'linuxdo',
            identityKey: 'linuxdo:7',
            notificationId: item.id,
            sessionEpoch: 0
          })
        );
        challenged = false;
        const retries = [recovery!.resume(), recovery!.resume()];
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(initialReads + 1));
        await act(async () => {
          response.resolve(
            new Response(
              JSON.stringify({
                id: 201,
                title: '私信',
                slug: 'private-topic',
                archetype: 'private_message',
                posts_count: 1,
                created_at: '2026-10-01T00:00:00Z',
                post_stream: {
                  stream: [1],
                  posts: [{ id: 1, post_number: 1, username: 'bob', cooked: '<p>验证后正文</p>' }]
                }
              })
            )
          );
          expect(await Promise.all(retries)).toEqual(['completed', 'completed']);
        });
        await waitFor(() => expect(view.getByText('验证后正文')).toBeTruthy());
        const completedReads = fetcher.mock.calls.length;
        runtime =
          change === 'identity'
            ? { ...runtime, identityKeys: { linuxdo: 'linuxdo:8' } }
            : change === 'disabled'
              ? { ...runtime, enabledNotificationSources: [] }
              : { ...runtime, sessionEpochs: { ...runtime.sessionEpochs, linuxdo: 1 } };
        await view.rerender(tree());
        const currentReads = completedReads + (change === 'epoch' ? 1 : 0);
        await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(currentReads));
        expect(await recovery!.resume()).toBe('stale');
        expect(fetcher).toHaveBeenCalledTimes(currentReads);
        const retry = events.find(
          (event) => event.operation === 'notification-detail-retry' && event.phase === 'intent'
        );
        expect(retry).toBeDefined();
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              traceId: retry?.traceId,
              phase: 'finish',
              outcome: 'blocked',
              reason: 'verification_required',
              state: 'open'
            }),
            expect.objectContaining({
              operation: 'notification-detail-resume',
              phase: 'finish',
              outcome: 'success'
            }),
            expect.objectContaining({
              operation: 'notification-detail-resume',
              phase: 'finish',
              outcome: 'stale',
              reason: 'stale'
            })
          ])
        );
        const resume = events.find(
          (event) => event.operation === 'notification-detail-resume' && event.phase === 'intent'
        );
        expect(resume).toMatchObject({ parentTraceId: retry?.traceId });
        expect(events).toContainEqual(
          expect.objectContaining({ operation: 'notification-detail', phase: 'intent', parentTraceId: resume?.traceId })
        );
        expect(JSON.stringify(events)).not.toMatch(/pm:201|linuxdo:7|private-topic|验证后正文/);
        if (change !== 'epoch') {
          runtime = {
            ...runtime,
            enabledNotificationSources: notificationSources,
            identityKeys: { linuxdo: 'linuxdo:7' }
          };
          await view.rerender(tree());
          const readsAfterReturn = fetcher.mock.calls.length;
          expect(await recovery!.resume()).toBe('stale');
          expect(fetcher).toHaveBeenCalledTimes(readsAfterReturn);
        }
      } finally {
        response.resolve(new Response('{}'));
        await view.unmount();
      }
    }
  );

  it.each(['list', 'detail'] as const)(
    'aborts the NodeSeek notification %s recovery when its verification attempt closes',
    async (flow) => {
      appQueryClient.clear();
      const item = { ...notification, unread: false, title: 'NodeSeek 验证后消息' };
      const release = Promise.withResolvers<void>();
      let recovery: ReadRecovery | undefined;
      let challenged = true;
      let requestSignal: AbortSignal | undefined;
      const read = async (options: NotificationAdapterAccess) => {
        if (challenged) throw Object.assign(new Error('站点需要验证'), { source: 'nodeseek', reason: 'cloudflare' });
        requestSignal = options.signal;
        await release.promise;
      };
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          nodeseek: {
            ...notificationAdapters.nodeseek,
            listPage: async (options) => {
              await read(options);
              return { items: [item], cursor: null, hasMore: false, quality: 'complete' };
            },
            loadDetail: async (_item, options) => {
              await read(options);
              return { notification: item, title: item.title };
            }
          }
        },
        readAccess: () => ({ identityKey: 'nodeseek:7', userId: '7' }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const runtime = {
        ...routeRuntime(gateway),
        identityKeys: { nodeseek: 'nodeseek:7' },
        identitySignature: 'nodeseek:7',
        openAccountSurface: jest.fn<NotificationRouteRuntimeValue['openAccountSurface']>(
          async (_source, _message, next) => {
            recovery = next;
          }
        )
      } satisfies NotificationRouteRuntimeValue;
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            {flow === 'list' ? (
              <NotificationsRoute
                navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
                route={{ key: 'notifications', name: 'notifications', params: { source: 'nodeseek' } }}
              />
            ) : (
              <NotificationDetailRoute
                navigation={{ navigate: jest.fn(), setOptions: jest.fn() } as never}
                route={{
                  key: 'detail',
                  name: 'NotificationDetail',
                  params: { notification: item, identityKey: 'nodeseek:7' }
                }}
              />
            )}
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        const verification = await waitFor(() =>
          flow === 'list' ? view.getByRole('button', { name: '去验证 NodeSeek' }) : view.getByText('去验证')
        );
        await fireEvent.press(verification);
        expect(recovery).toBeDefined();
        const controller = new AbortController();
        challenged = false;
        let running!: ReturnType<ReadRecovery['resume']>;
        await act(async () => {
          running = recovery!.resume(controller.signal);
        });
        await waitFor(() => expect(requestSignal).toBeDefined());
        await act(async () => {
          controller.abort();
          release.resolve();
          await expect(running).resolves.toBe('stale');
        });
        expect(requestSignal?.aborted).toBe(true);
        expect(view.queryByText(item.title)).toBeNull();
        expect(runtime.clearReadBlock).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        await view.unmount();
      }
    }
  );

  async function renderLinuxDoHistory() {
    appQueryClient.clear();
    let size = 65;
    let failRead = false;
    const missingIds = new Set<string>();
    let pendingRead: Promise<void> | undefined;
    let malformedCursor: 'repeat' | 'empty-advance' | undefined;
    let runtime: NotificationRouteRuntimeValue;
    const requests: { url: URL; method: string; signal?: AbortSignal | null }[] = [];
    const item: ForumNotification = {
      source: 'linuxdo',
      id: 'pm:201',
      kind: 'private-message',
      actor: { id: 'bob', name: 'Bob' },
      title: '长私信',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation', conversationId: '201' }
    };
    const fetcher: Fetcher = async (input, init) => {
      const url = new URL(input);
      requests.push({ url, method: init?.method || 'GET', signal: init?.signal });
      const pending = pendingRead;
      pendingRead = undefined;
      await pending;
      if (failRead) throw new Error('会话读取失败');
      const posts = Array.from({ length: size }, (_, index) => ({
        id: 1000 + index,
        post_number: index + 1,
        username: index % 2 ? 'alice' : 'bob',
        cooked: `<p>历史消息 ${index + 1}</p>`,
        created_at: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString()
      })).filter((post) => !missingIds.has(String(post.id)));
      if (url.pathname === '/t/201/posts.json') {
        const ids = url.searchParams.getAll('post_ids[]');
        return new Response(
          JSON.stringify({ post_stream: { posts: posts.filter((post) => ids.includes(String(post.id))) } })
        );
      }
      if (url.pathname !== '/t/201.json') throw new Error(`Unexpected history request ${url.pathname}`);
      return new Response(
        JSON.stringify({
          id: 201,
          title: '长私信',
          slug: 'private-topic',
          archetype: 'private_message',
          posts_count: size,
          created_at: '2026-10-01T00:00:00Z',
          post_stream: { stream: posts.map((post) => post.id), posts: posts.slice(0, 20) }
        })
      );
    };
    const gateway = createNotificationGateway({
      adapters: {
        ...notificationAdapters,
        linuxdo: {
          ...notificationAdapters.linuxdo,
          loadEarlierMessages: async (notification, cursor, access) => {
            const page = await notificationAdapters.linuxdo.loadEarlierMessages(notification, cursor, access);
            return malformedCursor === 'repeat'
              ? { ...page, olderCursor: cursor }
              : malformedCursor === 'empty-advance'
                ? { ...page, messages: [] }
                : page;
          }
        }
      },
      privateAccessAllowed: (source, identityKey) =>
        source === 'linuxdo' &&
        runtime.identityKeys.linuxdo === identityKey &&
        runtime.activeSources.includes('linuxdo'),
      readAccess: async () => ({ identityKey: 'linuxdo:7', userId: '7', username: 'alice', fetcher }),
      sourceAllowed: (source) => source === 'linuxdo'
    });
    const loadEarlier = jest.spyOn(gateway, 'loadEarlierMessages');
    runtime = {
      ...routeRuntime(gateway),
      activeSources: ['linuxdo'],
      identityKeys: { linuxdo: 'linuxdo:7' },
      identitySignature: 'linuxdo:7'
    };
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const tree = () => linuxDoDetailTree(runtime, item, navigation);
    const view = await render(tree(), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(view.getByText('历史消息 65')).toBeTruthy());
    return {
      view,
      navigation,
      requests,
      loadEarlier,
      async refresh() {
        await act(async () => {
          await appQueryClient.refetchQueries({
            queryKey: forumQueryKeys.notificationDetail({
              source: 'linuxdo',
              identityKey: 'linuxdo:7',
              notificationId: item.id,
              sessionEpoch: 0
            }),
            exact: true
          });
        });
      },
      updateRuntime(changes: Partial<NotificationRouteRuntimeValue>) {
        runtime = { ...runtime, ...changes };
        return view.rerender(tree());
      },
      holdRead(value: Promise<void>) {
        pendingRead = value;
      },
      failRead(value: boolean) {
        failRead = value;
      },
      setSize(value: number) {
        size = value;
      },
      removeAnchor(value: string) {
        missingIds.add(value);
      },
      malformedCursor(value: typeof malformedCursor) {
        malformedCursor = value;
      }
    };
  }

  it('keeps loaded conversation HTML idle through separately committed draft edits', async () => {
    mockHistoricalHtmlRender.mockClear();
    const owner = await renderLinuxDoHistory();
    try {
      await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
      await waitFor(() => expect(owner.view.getByText('历史消息 6')).toBeTruthy());
      await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
      await waitFor(() => expect(owner.view.getByText('历史消息 1')).toBeTruthy());
      expect(new Set(mockHistoricalHtmlRender.mock.calls.map(([html]) => html)).size).toBe(65);
      await fireEvent.press(owner.view.getByLabelText('回复私信'));
      await waitFor(() => expect(owner.view.getByLabelText('私信回复内容')).toBeTruthy());
      const requestCount = owner.requests.length;
      mockHistoricalHtmlRender.mockClear();

      for (let index = 1; index <= 3; index += 1) {
        await fireEvent.changeText(owner.view.getByLabelText('私信回复内容'), `本机草稿 ${index}`);
      }

      expect(owner.view.getByLabelText('私信回复内容').props.value).toBe('本机草稿 3');
      expect(owner.requests).toHaveLength(requestCount);
      expect(owner.requests.every(({ method }) => method === 'GET')).toBe(true);
      expect(mockHistoricalHtmlRender).not.toHaveBeenCalled();

      owner.setSize(66);
      await owner.refresh();
      await waitFor(() => expect(owner.view.getByText('历史消息 66')).toBeTruthy());
      expect(mockHistoricalHtmlRender.mock.calls.some(([html]) => html.includes('历史消息 66'))).toBe(true);
      expect(owner.view.getByLabelText('私信回复内容').props.value).toBe('本机草稿 3');
      expect(owner.requests.every(({ method }) => method === 'GET')).toBe(true);
    } finally {
      await owner.view.unmount();
      appQueryClient.clear();
      mockHistoricalHtmlRender.mockClear();
    }
  });

  it('loads private history only on demand and retains its messages across latest-window refreshes', async () => {
    const owner = await renderLinuxDoHistory();
    expect(owner.requests).toHaveLength(2);
    expect(owner.view.queryByText('历史消息 6')).toBeNull();
    let settle!: () => void;
    owner.holdRead(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.loadEarlier).toHaveBeenCalledTimes(1));
    await act(async () => {
      settle();
    });
    await waitFor(() => expect(owner.view.getByText('历史消息 6')).toBeTruthy());
    expect(owner.requests).toHaveLength(4);
    owner.failRead(true);
    await owner.refresh();
    expect(owner.view.getByText('历史消息 6')).toBeTruthy();
    owner.failRead(false);
    owner.setSize(67);
    await owner.refresh();
    expect(owner.view.getByText('历史消息 67')).toBeTruthy();
    expect(owner.view.getAllByText('历史消息 36')).toHaveLength(1);
    expect(owner.view.getByText('历史消息 6')).toBeTruthy();
    expect(owner.loadEarlier).toHaveBeenCalledTimes(1);
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 1')).toBeTruthy());
    expect(owner.loadEarlier.mock.calls.map((call) => call[1])).toEqual(['1035', '1005']);
    expect(owner.view.getByText('已到最早消息')).toBeTruthy();
  });

  it('does not reuse a private-history cursor before the new messages commit', async () => {
    const owner = await renderLinuxDoHistory();
    const button = owner.view.getByLabelText('加载更早消息');
    await act(async () => {
      await fireEvent.press(button);
      await owner.loadEarlier.mock.results[0].value;
      await fireEvent.press(button);
    });
    expect(owner.loadEarlier.mock.calls.map((call) => call[1])).toEqual(['1035']);
    await waitFor(() => expect(owner.view.getByText('历史消息 6')).toBeTruthy());
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 1')).toBeTruthy());
    expect(owner.loadEarlier.mock.calls.map((call) => call[1])).toEqual(['1035', '1005']);
  });

  it('retries a failed private-history cursor and can rebuild a deleted anchor without discarding readable messages on failure', async () => {
    const owner = await renderLinuxDoHistory();
    owner.failRead(true);
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText(/更早消息读取失败/)).toBeTruthy());
    expect(owner.view.getByText('历史消息 65')).toBeTruthy();
    owner.failRead(false);
    owner.removeAnchor('1035');
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.loadEarlier).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(owner.view.getByLabelText('重新读取会话').props.accessibilityState.disabled).toBe(false)
    );
    expect(owner.loadEarlier.mock.calls.map((call) => call[1])).toEqual(['1035', '1035']);
    await fireEvent.press(owner.view.getByLabelText('重新读取会话'));
    await waitFor(() => expect(owner.view.getByText('历史消息 35')).toBeTruthy());
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 5')).toBeTruthy());
    expect(owner.loadEarlier.mock.calls.at(-1)?.[1]).toBe('1034');
  });

  it('replaces the refreshed private-message tail while retaining earlier history and chronological order', async () => {
    const owner = await renderLinuxDoHistory();
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 6')).toBeTruthy());
    owner.removeAnchor('1049');
    await owner.refresh();
    expect(owner.view.queryByText('历史消息 50')).toBeNull();
    expect(owner.view.getAllByText(/^历史消息 \d+$/).map((message) => message.props.children)).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 6)
        .filter((number) => number !== 50)
        .map((number) => `历史消息 ${number}`)
    );
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 1')).toBeTruthy());
    expect(owner.loadEarlier.mock.calls.at(-1)?.[1]).toBe('1005');
  });

  it('rebuilds an overlapping latest window when its new boundary cannot preserve the previous prefix safely', async () => {
    const owner = await renderLinuxDoHistory();
    owner.removeAnchor('1035');
    owner.removeAnchor('1049');
    owner.setSize(66);
    await owner.refresh();
    expect(owner.view.queryByText('历史消息 36')).toBeNull();
    expect(owner.view.queryByText('历史消息 50')).toBeNull();
    expect(owner.view.getAllByText(/^历史消息 \d+$/).map((message) => message.props.children)).toEqual(
      Array.from({ length: 32 }, (_, index) => index + 35)
        .filter((number) => number !== 36 && number !== 50)
        .map((number) => `历史消息 ${number}`)
    );
    expect(owner.view.getByText(/最新消息范围已变化/)).toBeTruthy();
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 5')).toBeTruthy());
    expect(owner.loadEarlier.mock.calls.at(-1)?.[1]).toBe('1034');
  });

  it('restarts a disjoint private-message window so intervening messages remain reachable', async () => {
    const owner = await renderLinuxDoHistory();
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 6')).toBeTruthy());
    owner.setSize(105);
    await owner.refresh();
    expect(owner.view.queryByText('历史消息 6')).toBeNull();
    expect(owner.view.getByText(/最新消息与已加载历史不连续/)).toBeTruthy();
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 66')).toBeTruthy());
    expect(owner.loadEarlier.mock.calls.at(-1)?.[1]).toBe('1075');
  });

  it('discards an older response after a concurrent latest read rebuilds the conversation window', async () => {
    const owner = await renderLinuxDoHistory();
    let settle!: () => void;
    owner.holdRead(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.loadEarlier).toHaveBeenCalledTimes(1));
    const pending = owner.loadEarlier.mock.results[0].value;
    owner.setSize(105);
    await owner.refresh();
    expect(owner.loadEarlier.mock.calls[0][3]?.aborted).toBe(true);
    await act(async () => {
      settle();
      await Promise.resolve(pending).catch(() => undefined);
    });
    expect(owner.view.queryByText('历史消息 6')).toBeNull();
    expect(owner.view.getByText('历史消息 105')).toBeTruthy();
    await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
    await waitFor(() => expect(owner.view.getByText('历史消息 66')).toBeTruthy());
    expect(owner.loadEarlier.mock.calls.at(-1)?.[1]).toBe('1075');
  });

  it.each(['blur', 'background', 'account', 'epoch', 'access'] as const)(
    'cancels private-history reads on %s and keeps late results from releasing a replacement request',
    async (change) => {
      const owner = await renderLinuxDoHistory();
      await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
      await waitFor(() => expect(owner.view.getByText('历史消息 6')).toBeTruthy());
      let settle!: () => void;
      owner.holdRead(
        new Promise<void>((resolve) => {
          settle = resolve;
        })
      );
      let settleReplacement: (() => void) | undefined;
      try {
        await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
        await waitFor(() => expect(owner.loadEarlier).toHaveBeenCalledTimes(2));
        const pending = owner.loadEarlier.mock.results[1].value;
        if (change === 'blur')
          await act(async () => {
            owner.navigation.navigate('Other');
          });
        if (change === 'background')
          await act(async () => {
            focusManager.setFocused(false);
          });
        if (change === 'account')
          await owner.updateRuntime({ identityKeys: { linuxdo: 'linuxdo:8' }, identitySignature: 'linuxdo:8' });
        if (change === 'epoch')
          await owner.updateRuntime({ sessionEpochs: { ...initialForumSessionEpochs, linuxdo: 1 } });
        if (change === 'access') await owner.updateRuntime({ activeSources: [] });
        expect(owner.loadEarlier.mock.calls[1][3]?.aborted).toBe(true);
        if (change === 'blur')
          await act(async () => {
            owner.navigation.goBack();
          });
        if (change === 'background')
          await act(async () => {
            focusManager.setFocused(true);
          });
        if (change === 'access') await owner.updateRuntime({ activeSources: ['linuxdo'] });
        expect(owner.view.queryByText('历史消息 1')).toBeNull();
        if (change === 'blur' || change === 'background' || change === 'access') {
          await waitFor(() => expect(owner.view.getByText('历史消息 6')).toBeTruthy());
          owner.holdRead(
            new Promise<void>((resolve) => {
              settleReplacement = resolve;
            })
          );
          await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
          await waitFor(() => expect(owner.loadEarlier).toHaveBeenCalledTimes(3));
          await act(async () => {
            settle();
            await Promise.resolve(pending).catch(() => undefined);
          });
          expect(owner.view.getByLabelText('加载更早消息')).toBeDisabled();
          expect(owner.loadEarlier.mock.calls[2][3]?.aborted).toBe(false);
          expect(owner.view.queryByText('历史消息 1')).toBeNull();
          await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
          expect(owner.loadEarlier).toHaveBeenCalledTimes(3);
          await act(async () => settleReplacement?.());
          await waitFor(() => expect(owner.view.getByText('历史消息 1')).toBeTruthy());
          expect(owner.loadEarlier.mock.calls.at(-1)?.[1]).toBe('1005');
        } else {
          await act(async () => {
            settle();
            await Promise.resolve(pending).catch(() => undefined);
          });
          expect(owner.view.queryByText('历史消息 1')).toBeNull();
        }
      } finally {
        settle();
        settleReplacement?.();
        await owner.view.unmount();
        focusManager.setFocused(true);
      }
    }
  );

  it.each(['repeat', 'empty-advance'] as const)(
    'does not auto-fetch a private-history page with a %s cursor response',
    async (kind) => {
      const owner = await renderLinuxDoHistory();
      owner.malformedCursor(kind);
      await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
      if (kind === 'repeat') {
        await waitFor(() => expect(owner.view.getByText(/历史游标重复/)).toBeTruthy());
        expect(owner.view.queryByLabelText('加载更早消息')).toBeNull();
      } else {
        await waitFor(() =>
          expect(owner.view.getByLabelText('加载更早消息').props.accessibilityState.disabled).toBe(false)
        );
        owner.malformedCursor(undefined);
        await fireEvent.press(owner.view.getByLabelText('加载更早消息'));
        await waitFor(() => expect(owner.view.getByText('历史消息 1')).toBeTruthy());
        expect(owner.loadEarlier.mock.calls.at(-1)?.[1]).toBe('1005');
      }
      expect(owner.loadEarlier).toHaveBeenCalledTimes(kind === 'repeat' ? 1 : 2);
    }
  );

  async function renderAnnouncementPolicy(initiallyAccepted = false) {
    appQueryClient.clear();
    let accepted = initiallyAccepted;
    let revoked = false;
    let runtime: NotificationRouteRuntimeValue;
    let failRead = false;
    let response = { success: 'OK' };
    let applyUnconfirmedWrite = false;
    let pendingWrite: Promise<void> | undefined;
    const writes: { path: string; body: string; signal: AbortSignal | null | undefined }[] = [];
    const item: ForumNotification = {
      ...notification,
      source: 'linuxdo',
      id: 'announcement',
      kind: 'system',
      unread: false,
      actor: { id: 'admin', name: '公告作者' },
      title: '社区准则更新公告',
      target: { type: 'topic-post', topicId: '293017', postId: '77', url: 'https://linux.do/t/topic/293017' }
    };
    const readPolicy = (): DiscoursePostPolicy => ({
      postId: '77',
      version: '2604181600',
      acceptLabel: '我已知晓此更新内容',
      revokeLabel: '等我再仔细阅读一番',
      accepted,
      revoked,
      canAccept: !accepted,
      canRevoke: accepted
    });
    const fetcher = jest.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      prepareRequestToSend(init);
      if (path === '/session/csrf') return new Response(JSON.stringify({ csrf: 'policy-test-csrf' }));
      if (path === '/policy/accept' || path === '/policy/unaccept') {
        expect(init?.method).toBe('PUT');
        writes.push({ path, body: String(init?.body), signal: init?.signal });
        await pendingWrite;
        if (response.success === 'OK' || applyUnconfirmedWrite) {
          accepted = path === '/policy/accept';
          revoked = !accepted;
        }
        return new Response(JSON.stringify(response));
      }
      throw new Error(`Unexpected policy request: ${path}`);
    });
    const markRead = jest.fn(async () => ({ confirmed: true }));
    const loadDetail = jest.fn(async () => {
      if (failRead) throw new Error('公告最新状态暂不可用');
      return {
        notification: item,
        title: item.title,
        contentHtml: '<p>请阅读更新内容后确认。</p>',
        policy: readPolicy()
      };
    });
    const gateway = createNotificationGateway({
      adapters: { ...notificationAdapters, linuxdo: { ...notificationAdapters.linuxdo, loadDetail, markRead } },
      privateAccessAllowed: (source, identityKey) =>
        source === 'linuxdo' &&
        runtime.identityKeys.linuxdo === identityKey &&
        runtime.activeSources.includes('linuxdo'),
      readAccess: async () => ({ identityKey: 'linuxdo:7', username: 'policy-reader', userId: '7', fetcher }),
      sourceAllowed: (source) => source === 'linuxdo'
    });
    runtime = {
      ...routeRuntime(gateway),
      activeSources: ['linuxdo'],
      identityKeys: { linuxdo: 'linuxdo:7' },
      identitySignature: 'linuxdo:7'
    };
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const tree = () => linuxDoDetailTree(runtime, item, navigation);
    const view = await render(tree(), { wrapper: QueryTestWrapper });
    await waitFor(() => expect(view.getByText('阅读确认')).toBeTruthy());
    return {
      view,
      navigation,
      markRead,
      writes,
      loadDetail,
      queryKey: forumQueryKeys.notificationDetail({
        source: 'linuxdo',
        identityKey: 'linuxdo:7',
        notificationId: item.id,
        sessionEpoch: 0
      }),
      updateRuntime(changes: Partial<NotificationRouteRuntimeValue>) {
        runtime = { ...runtime, ...changes };
        return view.rerender(tree());
      },
      holdWrite(value: Promise<void>) {
        pendingWrite = value;
      },
      failRead(value: boolean) {
        failRead = value;
      },
      respond(value: { success: string }, applyWrite = false) {
        response = value;
        applyUnconfirmedWrite = applyWrite;
      }
    };
  }

  it('confirms an already-read announcement through its policy without duplicate submissions', async () => {
    const owner = await renderAnnouncementPolicy();
    let settle!: () => void;
    owner.holdWrite(
      new Promise<void>((resolve) => {
        settle = resolve;
      })
    );
    expect(owner.markRead).not.toHaveBeenCalled();
    expect(owner.view.getByText('尚未确认阅读当前版本')).toBeTruthy();
    await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
    await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
    await waitFor(() => expect(owner.writes).toHaveLength(1));
    expect(owner.writes[0]).toMatchObject({ path: '/policy/accept', body: 'post_id=77' });
    expect(owner.view.getByText('尚未确认阅读当前版本')).toBeTruthy();
    await act(async () => {
      settle();
    });
    await waitFor(() => expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy());
    expect(owner.markRead).not.toHaveBeenCalled();
    expect(owner.view.getByLabelText('等我再仔细阅读一番')).toBeTruthy();
  });

  it('keeps an unconfirmed policy result retryable without claiming acceptance', async () => {
    const owner = await renderAnnouncementPolicy();
    owner.respond({ success: 'unconfirmed' });
    await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
    await waitFor(() => expect(owner.view.getByText('原站尚未明确确认操作结果，请刷新公告核对')).toBeTruthy());
    expect(owner.view.getByText('尚未确认阅读当前版本')).toBeTruthy();
    expect(owner.writes).toHaveLength(1);
    owner.respond({ success: 'OK' });
    await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
    await waitFor(() => expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy());
    expect(owner.writes).toHaveLength(2);
  });

  it('clears an uncertain policy response only after the authoritative read confirms the requested acceptance', async () => {
    const owner = await renderAnnouncementPolicy();
    owner.respond({ success: 'unconfirmed' }, true);
    const write = Promise.withResolvers<void>();
    owner.holdWrite(write.promise);
    await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
    await waitFor(() => expect(owner.writes).toHaveLength(1));
    expect(owner.view.getByText('尚未确认阅读当前版本')).toBeTruthy();
    await act(async () => {
      write.resolve();
    });
    await waitFor(() => expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy());
    expect(owner.loadDetail).toHaveBeenCalledTimes(2);
    expect(owner.view.queryByText('原站尚未明确确认操作结果，请刷新公告核对')).toBeNull();
    expect(owner.view.getByLabelText('等我再仔细阅读一番').props.accessibilityState.disabled).toBe(false);
  });

  it('holds stale policy controls until a confirmed submission can be read back', async () => {
    const owner = await renderAnnouncementPolicy();
    const topicKey = forumQueryKeys.topic({
      source: 'linuxdo',
      topicId: '293017',
      scope: initialForumSessionEpochs,
      readPlanScope: `authenticated:${initialForumSessionEpochs.linuxdo}`
    });
    const cachedTopic: TopicDetail = {
      source: 'linuxdo',
      id: '293017',
      title: '社区准则更新公告',
      author: 'admin',
      url: 'https://linux.do/t/topic/293017',
      createdAt: '',
      contentHtml: '<p>公告</p>',
      replies: [],
      policy: appQueryClient.getQueryData<NotificationDetail>(owner.queryKey)?.policy
    };
    appQueryClient.setQueryData(topicKey, cachedTopic);
    owner.failRead(true);
    await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
    await waitFor(() => expect(owner.view.getByText('暂时无法读取原站最新状态，请重试读取消息后核对。')).toBeTruthy());
    expect(owner.view.getByLabelText('我已知晓此更新内容').props.accessibilityState.disabled).toBe(true);
    expect(owner.view.getByText('尚未确认阅读当前版本')).toBeTruthy();
    expect(appQueryClient.getQueryData<TopicDetail>(topicKey)?.policy?.accepted).toBe(false);
    owner.failRead(false);
    await fireEvent.press(owner.view.getByRole('button', { name: '重试读取消息' }));
    await waitFor(() => expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy());
    expect(appQueryClient.getQueryData<TopicDetail>(topicKey)?.policy?.accepted).toBe(true);
    expect(owner.writes).toHaveLength(1);
  });

  it('discards an announcement revocation confirmation after leaving its page', async () => {
    const owner = await renderAnnouncementPolicy(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      await fireEvent.press(owner.view.getByLabelText('等我再仔细阅读一番'));
      const confirm = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === '撤销确认')?.onPress;
      expect(confirm).toBeDefined();
      await act(async () => {
        owner.navigation.navigate('Other');
      });
      await act(async () => {
        confirm?.();
      });
      expect(owner.writes).toHaveLength(0);
    } finally {
      alert.mockRestore();
    }
  });

  it('does not resubmit an acknowledged announcement from stale data after re-enabling linux.do', async () => {
    const owner = await renderAnnouncementPolicy();
    const firstRead = Promise.withResolvers<void>();
    const initialRead = owner.loadDetail.mock.results[0];
    if (initialRead?.type !== 'return') throw new Error('Expected the opening announcement read');
    const detail = await initialRead.value;
    owner.loadDetail.mockImplementationOnce(async () => {
      await firstRead.promise;
      return detail;
    });
    await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
    await waitFor(() => expect(owner.view.getByText('阅读确认已提交，正在核对原站状态。')).toBeTruthy());
    expect(owner.writes).toHaveLength(1);

    await act(async () => {
      owner.navigation.reset({ index: 0, routes: [{ name: 'Other' }] });
    });
    expect(owner.view.getByText('其他页面')).toBeTruthy();
    const enabled = { enabledSources: ['linuxdo', 'nodeseek'] as const, enabledSourcesKey: 'linuxdo|nodeseek' };
    const disabled = { enabledSources: ['nodeseek'] as const, enabledSourcesKey: 'nodeseek' };
    cleanupContentSourceQueries(appQueryClient, enabled, disabled);
    cleanupContentSourceQueries(appQueryClient, disabled, enabled);
    owner.loadDetail.mockResolvedValueOnce(detail);
    await act(async () => {
      owner.navigation.navigate('NotificationDetail', { notification: detail.notification, identityKey: 'linuxdo:7' });
    });
    try {
      await waitFor(() => expect(owner.view.getByLabelText('我已知晓此更新内容')).toBeTruthy());
      const action = owner.view.getByLabelText('我已知晓此更新内容');
      await fireEvent.press(action);
      expect(owner.writes).toHaveLength(1);
      expect(action.props.accessibilityState.disabled).toBe(true);
      expect(owner.view.getByText('阅读确认已提交，正在核对原站状态。')).toBeTruthy();
    } finally {
      await act(async () => {
        firstRead.resolve();
      });
    }

    expect(owner.view.getByLabelText('我已知晓此更新内容').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      await appQueryClient.refetchQueries({ queryKey: owner.queryKey, exact: true });
    });
    await waitFor(() => expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy());
    expect(owner.writes).toHaveLength(1);
  });

  it('blocks an old announcement version while the same post has a newer acknowledgement to reconcile', async () => {
    const owner = await renderAnnouncementPolicy(true);
    const account = { identityKey: 'linuxdo:7', sessionEpoch: 0 };
    const initial = owner.loadDetail.mock.results[0];
    if (initial?.type !== 'return') throw new Error('Opening announcement read missing');
    const stale = await initial.value;
    const newer = { ...stale.policy, version: '2604181601', revokeLabel: '撤销新版阅读确认' };
    const readStarted = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      await act(async () => owner.navigation.reset({ index: 0, routes: [{ name: 'Other' }] }));
      recordDiscoursePolicyReceipt(appQueryClient, account, {
        postId: newer.postId,
        version: newer.version,
        accepted: true
      });
      owner.loadDetail.mockImplementationOnce(async () => {
        readStarted.resolve();
        await releaseRead.promise;
        return { ...stale, policy: newer };
      });
      await act(async () =>
        owner.navigation.navigate('NotificationDetail', { notification: stale.notification, identityKey: 'linuxdo:7' })
      );
      await readStarted.promise;
      const action = owner.view.getByLabelText('等我再仔细阅读一番');
      expect(action.props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(action);
      expect(alert).not.toHaveBeenCalled();
      expect(owner.writes).toHaveLength(0);
    } finally {
      await act(async () => releaseRead.resolve());
      alert.mockRestore();
    }
    await waitFor(() =>
      expect(owner.view.getByLabelText('撤销新版阅读确认').props.accessibilityState.disabled).toBe(false)
    );
  });

  it('keeps the authoritative announcement result when an older GET settles after cross-entry readback', async () => {
    const owner = await renderAnnouncementPolicy();
    const account = { identityKey: 'linuxdo:7', sessionEpoch: 0 };
    const topicId = '293017';
    const topicKey = forumQueryKeys.topic({
      source: 'linuxdo',
      topicId,
      scope: initialForumSessionEpochs,
      readPlanScope: 'authenticated:0'
    });
    const initial = owner.loadDetail.mock.results[0];
    if (initial?.type !== 'return') throw new Error('Opening announcement read missing');
    const stale = await initial.value;
    const accepted = { ...stale.policy, accepted: true, canAccept: false, canRevoke: true };
    const readStarted = Promise.withResolvers<void>();
    const releaseRead = Promise.withResolvers<void>();
    owner.loadDetail.mockImplementationOnce(async () => {
      readStarted.resolve();
      await releaseRead.promise;
      return stale;
    });
    appQueryClient.setQueryData<TopicDetail>(topicKey, {
      source: 'linuxdo',
      id: topicId,
      title: stale.title,
      author: 'author',
      url: 'https://linux.do/t/293017',
      createdAt: '',
      contentHtml: stale.contentHtml,
      replies: [],
      policy: stale.policy
    });
    let slowRead!: Promise<void>;
    await act(async () => {
      slowRead = appQueryClient.refetchQueries({ queryKey: owner.queryKey, exact: true });
      await readStarted.promise;
    });
    try {
      await act(async () => {
        recordDiscoursePolicyReceipt(appQueryClient, account, {
          postId: accepted.postId,
          version: accepted.version,
          accepted: true
        });
        captureDiscoursePolicyRead(appQueryClient, account, topicId)({ policy: accepted });
      });
      expect(appQueryClient.getQueryData<TopicDetail>(topicKey)?.policy?.accepted).toBe(true);
      expect(appQueryClient.getQueryData<NotificationDetail>(owner.queryKey)?.policy?.accepted).toBe(true);
    } finally {
      await act(async () => {
        releaseRead.resolve();
        await slowRead;
      });
    }
    expect(appQueryClient.getQueryData<TopicDetail>(topicKey)?.policy?.accepted).toBe(true);
    expect(appQueryClient.getQueryData<NotificationDetail>(owner.queryKey)?.policy?.accepted).toBe(true);
    await waitFor(() => expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy());
  });

  it('revokes an announcement only once when its action and native confirmation are pressed twice', async () => {
    const owner = await renderAnnouncementPolicy(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const write = Promise.withResolvers<void>();
    owner.holdWrite(write.promise);
    try {
      await fireEvent.press(owner.view.getByLabelText('等我再仔细阅读一番'));
      await fireEvent.press(owner.view.getByLabelText('等我再仔细阅读一番'));
      expect(alert).toHaveBeenCalledTimes(1);
      expect(owner.writes).toHaveLength(0);
      const confirm = alert.mock.calls[0]?.[2]?.find((button) => button.text === '撤销确认')?.onPress;
      expect(confirm).toBeDefined();
      await act(async () => {
        confirm?.();
        confirm?.();
      });
      await waitFor(() => expect(owner.writes).toHaveLength(1));
      expect(owner.writes[0]).toMatchObject({ path: '/policy/unaccept', body: 'post_id=77' });
      expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy();
      await act(async () => {
        write.resolve();
      });
      await waitFor(() => expect(owner.view.getByText('已撤销阅读确认')).toBeTruthy());
      expect(owner.writes).toHaveLength(1);
      expect(owner.view.getByLabelText('我已知晓此更新内容')).toBeTruthy();
    } finally {
      write.resolve();
      alert.mockRestore();
    }
  });

  it('reopens announcement revocation confirmation after Android dismiss without letting stale callbacks cancel or double-submit', async () => {
    const owner = await renderAnnouncementPolicy(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const write = Promise.withResolvers<void>();
    owner.holdWrite(write.promise);
    try {
      await fireEvent.press(owner.view.getByLabelText('等我再仔细阅读一番'));
      expect(alert).toHaveBeenCalledTimes(1);
      const firstButtons = alert.mock.calls[0]?.[2];
      const firstOptions = alert.mock.calls[0]?.[3];
      expect(firstOptions?.onDismiss).toBeDefined();

      // Dismissed/replaced by another Android dialog: release immediately without writing.
      await act(async () => {
        firstOptions?.onDismiss?.();
      });
      expect(owner.writes).toHaveLength(0);

      // Immediately reopenable on the same page; explicit cancel writes 0 times.
      await fireEvent.press(owner.view.getByLabelText('等我再仔细阅读一番'));
      expect(alert).toHaveBeenCalledTimes(2);
      const secondCancel = alert.mock.calls[1]?.[2]?.find((button) => button.text === '取消')?.onPress;
      await act(async () => {
        secondCancel?.();
      });
      expect(owner.writes).toHaveLength(0);

      // Reopen a third time; stale callbacks from dialog #1 must not close dialog #3 or write.
      await fireEvent.press(owner.view.getByLabelText('等我再仔细阅读一番'));
      expect(alert).toHaveBeenCalledTimes(3);
      await act(async () => {
        firstOptions?.onDismiss?.();
        firstButtons?.find((button) => button.text === '取消')?.onPress?.();
        firstButtons?.find((button) => button.text === '撤销确认')?.onPress?.();
      });
      expect(owner.writes).toHaveLength(0);

      // Confirm dialog #3, followed by Android onDismiss while in flight: must write once and complete.
      const thirdConfirm = alert.mock.calls[2]?.[2]?.find((button) => button.text === '撤销确认')?.onPress;
      const thirdDismiss = alert.mock.calls[2]?.[3]?.onDismiss;
      await act(async () => {
        thirdConfirm?.();
        thirdDismiss?.();
        thirdConfirm?.();
      });
      await waitFor(() => expect(owner.writes).toHaveLength(1));
      await act(async () => {
        write.resolve();
      });
      await waitFor(() => expect(owner.view.getByText('已撤销阅读确认')).toBeTruthy());
      expect(owner.writes).toHaveLength(1);
    } finally {
      write.resolve();
      alert.mockRestore();
    }
  });

  it.each(['background', 'account'] as const)(
    'ignores a late announcement policy response after %s changes',
    async (change) => {
      focusManager.setFocused(true);
      const owner = await renderAnnouncementPolicy();
      const write = Promise.withResolvers<void>();
      owner.holdWrite(write.promise);
      try {
        await fireEvent.press(owner.view.getByLabelText('我已知晓此更新内容'));
        await waitFor(() => expect(owner.writes).toHaveLength(1));
        const reads = owner.loadDetail.mock.calls.length;
        if (change === 'background')
          await act(async () => {
            focusManager.setFocused(false);
          });
        else await owner.updateRuntime({ identityKeys: { linuxdo: 'linuxdo:8' }, identitySignature: 'linuxdo:8' });
        expect(owner.writes[0]?.signal?.aborted).toBe(true);
        await act(async () => {
          write.resolve();
        });
        expect(owner.loadDetail).toHaveBeenCalledTimes(reads);
        expect(appQueryClient.getQueryData<{ policy: DiscoursePostPolicy }>(owner.queryKey)?.policy.accepted).toBe(
          false
        );
        expect(owner.view.queryByText('已确认阅读当前版本')).toBeNull();
        if (change === 'background') {
          await act(async () => {
            focusManager.setFocused(true);
          });
          await waitFor(() => expect(owner.view.getByText('已确认阅读当前版本')).toBeTruthy());
        } else {
          expect(owner.view.getByText('账号状态已变化，请返回消息列表重新打开。')).toBeTruthy();
        }
        expect(owner.writes).toHaveLength(1);
      } finally {
        write.resolve();
        await owner.view.unmount();
        focusManager.setFocused(true);
      }
    }
  );
  function privateMessageRow(id: number, viewed = false) {
    return {
      id,
      sender_id: 9,
      receiver_id: 7,
      content: `私信 ${id}`,
      created_at: `2026-10-02T00:00:${String(id).padStart(2, '0')}Z`,
      is_markdown: false,
      viewed
    };
  }

  async function renderProfileConversation(
    initialRows: ReturnType<typeof privateMessageRow>[],
    firstMark: 'confirmed' | 'failure' | 'unconfirmed' = 'confirmed'
  ) {
    appQueryClient.clear();
    let rows = initialRows;
    const serverConfirmedIds = new Set<number>();
    const markAttempts: string[][] = [];
    const markSignals: (AbortSignal | undefined)[] = [];
    const markSettlements: Promise<NotificationMarkResult>[] = [];
    let markOutcome = firstMark;
    let nextMarkSettlement: Promise<void> | undefined;
    let nextReadBody: { promise: Promise<string>; started: () => void } | undefined;
    let failNextRead = false;
    let runtime: NotificationRouteRuntimeValue;
    const item: ForumNotification = {
      source: 'nodeseek',
      id: 'conversation:9',
      kind: 'private-message',
      actor: { id: '9', name: '张三' },
      title: '张三',
      createdAt: null,
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    const fetcher = jest.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === '/api/notification/message/with/9') {
        if (failNextRead) {
          failNextRead = false;
          return new Response(JSON.stringify({ success: false, message: '会话暂不可用' }), { status: 503 });
        }
        const response = new Response(JSON.stringify({ msgArray: rows }));
        const delayed = nextReadBody;
        nextReadBody = undefined;
        if (delayed) {
          jest.spyOn(response, 'text').mockImplementationOnce(() => {
            delayed.started();
            return delayed.promise;
          });
        }
        return response;
      }
      if (path === '/api/notification/message/markViewed') {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body)) as { messages: number[] };
        const settlement = nextMarkSettlement;
        nextMarkSettlement = undefined;
        await settlement;
        body.messages.forEach((id) => serverConfirmedIds.add(id));
        rows = rows.map((row) => (body.messages.includes(row.id) ? { ...row, viewed: true } : row));
        return new Response(JSON.stringify({ success: true }));
      }
      if (path === '/api/notification/unread-count') {
        return new Response(
          JSON.stringify({
            atMe: 0,
            reply: 0,
            message: rows.filter((row) => !row.viewed && !serverConfirmedIds.has(row.id)).length
          })
        );
      }
      throw new Error(`Unexpected private-message request: ${path}`);
    });
    const gateway = createNotificationGateway({
      adapters: {
        ...notificationAdapters,
        nodeseek: {
          ...notificationAdapters.nodeseek,
          markRead: async (notification, detail, access) => {
            markAttempts.push([...(detail.unreadMessageIds || [])]);
            markSignals.push(access.signal);
            const settlement = markSettlements.shift();
            if (settlement) return settlement;
            const outcome = markOutcome;
            markOutcome = 'confirmed';
            if (outcome === 'failure') throw new Error('已读请求失败');
            if (outcome === 'unconfirmed') return { confirmed: false, message: '原站未确认已读' };
            return notificationAdapters.nodeseek.markRead(notification, detail, access);
          }
        }
      },
      privateAccessAllowed: (source, identityKey) =>
        source === 'nodeseek' &&
        runtime.identityKeys.nodeseek === identityKey &&
        runtime.activeSources.includes('nodeseek'),
      readAccess: async () => ({ identityKey: 'nodeseek:7', userId: '7', fetcher }),
      sourceAllowed: (source) => source === 'nodeseek'
    });
    const snapshots: number[] = [];
    runtime = {
      ...routeRuntime(gateway),
      identityKeys: { nodeseek: 'nodeseek:7' },
      identitySignature: 'nodeseek:7',
      refreshSnapshots: jest.fn(async () => {
        snapshots.push((await gateway.readUnreadSnapshot('nodeseek')).total);
        return [];
      })
    };
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const tree = () => (
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigation}>
          <FocusTestStack.Navigator initialRouteName="Other">
            <FocusTestStack.Screen name="Other">{() => <Text>个人主页</Text>}</FocusTestStack.Screen>
            <FocusTestStack.Screen name="NotificationDetail">
              {(props) => <NotificationDetailRoute navigation={props.navigation as never} route={props.route} />}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="User">{() => <Text>对方个人主页</Text>}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );
    const view = await render(tree(), { wrapper: QueryTestWrapper });
    return {
      view,
      navigation,
      item,
      snapshots,
      markAttempts,
      markSignals,
      get runtime() {
        return runtime;
      },
      queryKey: forumQueryKeys.notificationDetail({
        source: 'nodeseek',
        identityKey: 'nodeseek:7',
        notificationId: item.id,
        sessionEpoch: 0
      }),
      snapshotReads: () => fetcher.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/unread-count')).length,
      reads: () => fetcher.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/message/with/9')).length,
      marks: () =>
        fetcher.mock.calls
          .filter(([url]) => new URL(url).pathname.endsWith('/message/markViewed'))
          .map(([, init]) => init?.body),
      pauseNextMark: () => {
        const settlement = Promise.withResolvers<void>();
        nextMarkSettlement = settlement.promise;
        return settlement.resolve;
      },
      deferNextMarkResult: () => {
        const settlement = Promise.withResolvers<NotificationMarkResult>();
        markSettlements.push(settlement.promise);
        return settlement;
      },
      pauseNextRead: () => {
        const body = Promise.withResolvers<string>();
        const started = Promise.withResolvers<void>();
        nextReadBody = { promise: body.promise, started: started.resolve };
        return { started: started.promise, resolve: () => body.resolve(JSON.stringify({ msgArray: rows })) };
      },
      failNextRead: () => {
        failNextRead = true;
      },
      setNextMarkOutcome: (outcome: 'failure' | 'unconfirmed') => {
        markOutcome = outcome;
      },
      open: () =>
        act(async () => {
          navigation.dispatch(
            StackActions.push('NotificationDetail', { notification: item, identityKey: 'nodeseek:7' })
          );
        }),
      setRows: (next: ReturnType<typeof privateMessageRow>[]) => {
        rows = next;
      },
      updateRuntime: (changes: Partial<NotificationRouteRuntimeValue>) => {
        runtime = { ...runtime, ...changes };
        return view.rerender(tree());
      }
    };
  }

  it.each([
    { label: '私信 20', rows: [privateMessageRow(20, true)] },
    { label: '暂无私信', rows: [] }
  ])('does not reconcile unread snapshots without a mark write ($label)', async ({ label, rows }) => {
    const conversation = await renderProfileConversation(rows);
    try {
      await conversation.open();
      await waitFor(() => expect(conversation.view.getByText(label)).toBeTruthy());
      expect(conversation.reads()).toBe(1);
      expect(conversation.markAttempts).toEqual([]);
      expect(conversation.marks()).toEqual([]);
      expect(conversation.runtime.refreshSnapshots).not.toHaveBeenCalled();
      expect(conversation.snapshotReads()).toBe(0);
    } finally {
      await conversation.view.unmount();
    }
  });

  it('reads the latest same-account conversation when reopening it from a cached profile route', async () => {
    expect(appQueryClient.getDefaultOptions().queries?.refetchOnMount).toBe(false);
    const conversation = await renderProfileConversation([privateMessageRow(20, true)]);
    await conversation.open();
    await waitFor(() => expect(conversation.view.getByText('私信 20')).toBeTruthy());
    expect(conversation.reads()).toBe(1);
    await act(async () => conversation.navigation.goBack());
    await waitFor(() => expect(conversation.navigation.getCurrentRoute()?.name).toBe('Other'));
    expect(appQueryClient.getQueryData(conversation.queryKey)).toBeDefined();
    conversation.setRows([privateMessageRow(20, true), privateMessageRow(21, true)]);

    await conversation.open();
    await waitFor(() => expect(conversation.view.getByText('私信 21')).toBeTruthy());
    expect(conversation.reads()).toBe(2);
    expect(conversation.marks()).toEqual([]);
  });

  it('loads the active page when moving directly between two views of the same conversation', async () => {
    const conversation = await renderProfileConversation([privateMessageRow(20, true)]);
    const firstRead = conversation.pauseNextRead();
    try {
      await conversation.open();
      await firstRead.started;
      const firstKey = conversation.navigation.getCurrentRoute()?.key;
      await conversation.open();
      expect(conversation.navigation.getCurrentRoute()?.key).not.toBe(firstKey);
      await act(async () => firstRead.resolve());
      await waitFor(() => expect(conversation.view.getByText('私信 20')).toBeTruthy());
    } finally {
      firstRead.resolve();
      await conversation.view.unmount();
    }
  });

  it('shows conversation messages only after a read for the current session', async () => {
    const conversation = await renderProfileConversation([privateMessageRow(20, true)]);
    await conversation.open();
    await waitFor(() => expect(conversation.view.getByText('私信 20')).toBeTruthy());
    const currentRead = conversation.pauseNextRead();
    try {
      conversation.setRows([privateMessageRow(21, true)]);
      await conversation.updateRuntime({ sessionEpochs: { ...conversation.runtime.sessionEpochs, nodeseek: 1 } });
      expect(conversation.view.queryByText('私信 20')).toBeNull();
      await currentRead.started;
      await act(async () => currentRead.resolve());
      await waitFor(() => expect(conversation.view.getByText('私信 21')).toBeTruthy());
    } finally {
      currentRead.resolve();
      await conversation.view.unmount();
    }
  });

  it('opens the conversation participant from the native header with the canonical source and user id', async () => {
    const conversation = await renderProfileConversation([privateMessageRow(20, true)]);
    await conversation.open();
    await waitFor(() => expect(conversation.view.getByText('私信 20')).toBeTruthy());
    const participant = conversation.view.getByRole('button', { name: '查看 张三 的主页' });
    expect(conversation.view.queryByText('查看对方主页')).toBeNull();
    await fireEvent.press(participant);
    await waitFor(() => expect(conversation.view.getByText('对方个人主页')).toBeTruthy());
    expect(conversation.navigation.getCurrentRoute()).toMatchObject({
      name: 'User',
      params: { user: { source: 'nodeseek', id: '9', displayName: '张三', url: 'https://www.nodeseek.com/space/9' } }
    });
    expect(conversation.marks()).toEqual([]);
  });

  it.each(['confirmed', 'failure', 'unconfirmed'] as const)(
    'marks newly read profile conversation ids after %s without repeating an attempted batch',
    async (firstMark) => {
      const conversation = await renderProfileConversation([privateMessageRow(20)], firstMark);
      await conversation.open();
      await waitFor(() => expect(conversation.view.getByText('私信 20')).toBeTruthy());
      expect(conversation.item.unread).toBe(false);
      expect(conversation.item.remoteGroup).toBeUndefined();
      if (firstMark !== 'confirmed') {
        await waitFor(() => expect(conversation.view.getByLabelText('重试已读状态')).toBeTruthy());
        await act(async () => appQueryClient.invalidateQueries({ queryKey: conversation.queryKey }));
        expect(conversation.markAttempts).toEqual([['20']]);
        expect(conversation.marks()).toEqual([]);

        conversation.setRows([privateMessageRow(20), privateMessageRow(21)]);
        await act(async () => appQueryClient.invalidateQueries({ queryKey: conversation.queryKey }));
        await waitFor(() => expect(conversation.marks()).toEqual([JSON.stringify({ messages: [21] })]));
        await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(1));
        expect(conversation.view.getByText('部分消息的已读状态未确认')).toBeTruthy();
        expect(conversation.view.getByLabelText('重试已读状态')).toBeTruthy();
        expect(conversation.markAttempts).toEqual([['20'], ['21']]);

        const resumeMark = conversation.pauseNextMark();
        await fireEvent.press(conversation.view.getByLabelText('重试已读状态'));
        await fireEvent.press(conversation.view.getByLabelText('重试已读状态'));
        await waitFor(() => expect(conversation.markAttempts).toEqual([['20'], ['21'], ['20']]));
        expect(conversation.marks()).toEqual([JSON.stringify({ messages: [21] }), JSON.stringify({ messages: [20] })]);
        await act(async () => resumeMark());
        await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(0));
        expect(conversation.view.queryByLabelText('重试已读状态')).toBeNull();
        return;
      }
      await waitFor(() => expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] })]));
      await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(0));

      conversation.setRows([privateMessageRow(20)]);
      await act(async () => appQueryClient.invalidateQueries({ queryKey: conversation.queryKey }));
      expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] })]);
      conversation.setRows([privateMessageRow(20), privateMessageRow(21)]);
      await act(async () => appQueryClient.invalidateQueries({ queryKey: conversation.queryKey }));
      await waitFor(() =>
        expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] }), JSON.stringify({ messages: [21] })])
      );
      await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(0));
    }
  );

  it.each(['failure', 'unconfirmed'] as const)(
    'keeps a current private-message retry attempted after an old canceled retry settles and the current ends in %s',
    async (outcome) => {
      focusManager.setFocused(true);
      const conversation = await renderProfileConversation([privateMessageRow(20)], 'failure');
      await conversation.open();
      await waitFor(() => expect(conversation.view.getByLabelText('重试已读状态')).toBeTruthy());
      const retryA = conversation.deferNextMarkResult();
      await fireEvent.press(conversation.view.getByLabelText('重试已读状态'));
      await waitFor(() => expect(conversation.markAttempts).toHaveLength(2));
      const signalA = conversation.markSignals[1];
      expect(signalA?.aborted).toBe(false);

      await act(async () => conversation.navigation.navigate('Other'));
      expect(signalA?.aborted).toBe(true);
      const retryB = conversation.deferNextMarkResult();
      await act(async () => conversation.navigation.goBack());
      await waitFor(() => expect(conversation.view.getByLabelText('重试已读状态')).toBeTruthy());
      await fireEvent.press(conversation.view.getByLabelText('重试已读状态'));
      await waitFor(() => expect(conversation.markAttempts).toHaveLength(3));
      expect(conversation.markSignals[2]?.aborted).toBe(false);

      await act(async () => {
        retryA.reject(new Error('旧重试迟到失败'));
        await retryA.promise.catch(() => undefined);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      expect(conversation.markSignals[2]?.aborted).toBe(false);
      await act(async () => {
        if (outcome === 'failure') retryB.reject(new Error('当前重试失败'));
        else retryB.resolve({ confirmed: false, message: '当前重试未确认' });
        await retryB.promise.catch(() => undefined);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      });
      await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      expect(conversation.markAttempts).toEqual([['20'], ['20'], ['20']]);
      expect(conversation.marks()).toEqual([]);
      expect(conversation.view.getByLabelText('重试已读状态')).toBeTruthy();

      await fireEvent.press(conversation.view.getByLabelText('重试已读状态'));
      await waitFor(() => expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] })]));
      await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(0));
    }
  );

  it('marks newly arrived conversation ids after the previous read attempt finishes', async () => {
    const conversation = await renderProfileConversation([privateMessageRow(20)]);
    const finishFirstMark = conversation.pauseNextMark();
    try {
      await conversation.open();
      await waitFor(() => expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] })]));
      conversation.setRows([privateMessageRow(20), privateMessageRow(21)]);
      await act(async () => appQueryClient.invalidateQueries({ queryKey: conversation.queryKey }));
      await waitFor(() => expect(conversation.view.getByText('私信 21')).toBeTruthy());
      expect(conversation.markAttempts).toEqual([['20']]);

      await act(async () => finishFirstMark());
      await waitFor(() =>
        expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] }), JSON.stringify({ messages: [21] })])
      );
      await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(0));
      expect(conversation.markAttempts).toEqual([['20'], ['21']]);
      expect(conversation.view.queryByLabelText('重试已读状态')).toBeNull();
    } finally {
      await act(async () => finishFirstMark());
      await conversation.view.unmount();
      appQueryClient.clear();
    }
  });

  it('does not mark unread private messages when a pending foreground read finishes in the background', async () => {
    focusManager.setFocused(true);
    const conversation = await renderProfileConversation([privateMessageRow(20)]);
    const read = conversation.pauseNextRead();
    try {
      await conversation.open();
      await act(async () => read.started);
      await act(async () => focusManager.setFocused(false));
      await act(async () => read.resolve());
      await waitFor(() => expect(conversation.view.getByText('私信 20')).toBeTruthy());
      await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      expect(conversation.markAttempts).toEqual([]);
      expect(conversation.marks()).toEqual([]);

      await act(async () => focusManager.setFocused(true));
      await waitFor(() => expect(conversation.reads()).toBe(2));
      await waitFor(() => expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] })]));
      await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(0));

      conversation.setRows([privateMessageRow(20, true), privateMessageRow(21)]);
      conversation.setNextMarkOutcome('failure');
      await act(async () => appQueryClient.invalidateQueries({ queryKey: conversation.queryKey }));
      await waitFor(() => expect(conversation.view.getByLabelText('重试已读状态')).toBeTruthy());
      const retry = conversation.deferNextMarkResult();
      await fireEvent.press(conversation.view.getByLabelText('重试已读状态'));
      await waitFor(() => expect(conversation.markAttempts).toEqual([['20'], ['21'], ['21']]));
      const retrySignal = conversation.markSignals[2];
      await act(async () => focusManager.setFocused(false));
      expect(retrySignal?.aborted).toBe(true);
      conversation.failNextRead();
      await act(async () => focusManager.setFocused(true));
      await waitFor(() => expect(appQueryClient.getQueryState(conversation.queryKey)?.status).toBe('error'));
      expect(conversation.view.getByLabelText('重试已读状态').props.accessibilityState.disabled).toBe(false);

      await act(async () => retry.resolve({ confirmed: false, message: '已取消的重试' }));
      await fireEvent.press(conversation.view.getByLabelText('重试已读状态'));
      await waitFor(() =>
        expect(conversation.marks()).toEqual([JSON.stringify({ messages: [20] }), JSON.stringify({ messages: [21] })])
      );
      await waitFor(() => expect(conversation.snapshots.at(-1)).toBe(0));
    } finally {
      await conversation.view.unmount();
      appQueryClient.clear();
      focusManager.setFocused(true);
    }
  });

  it('polls only the focused accessible foreground NodeSeek conversation every minute', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    focusManager.setFocused(true);
    const conversation = await renderProfileConversation([privateMessageRow(20, true)]);
    try {
      await conversation.open();
      await waitFor(() => expect(conversation.view.getByText('私信 20')).toBeTruthy());
      conversation.setRows([privateMessageRow(20, true), privateMessageRow(21)]);
      const initialReads = conversation.reads();
      await act(async () => jest.advanceTimersByTimeAsync(60_001));
      expect(conversation.reads()).toBeGreaterThan(initialReads);
      expect(conversation.view.getByText('私信 21')).toBeTruthy();
      expect(conversation.marks()).toEqual([JSON.stringify({ messages: [21] })]);

      await act(async () => focusManager.setFocused(false));
      const foregroundReads = conversation.reads();
      await act(async () => jest.advanceTimersByTimeAsync(120_001));
      expect(conversation.reads()).toBe(foregroundReads);
      await act(async () => focusManager.setFocused(true));
      await waitFor(() => expect(conversation.reads()).toBeGreaterThan(foregroundReads));

      await act(async () => conversation.navigation.navigate('Other'));
      await waitFor(() => expect(conversation.navigation.getCurrentRoute()?.name).toBe('Other'));
      const hiddenReads = conversation.reads();
      await act(async () => jest.advanceTimersByTimeAsync(120_001));
      expect(conversation.reads()).toBe(hiddenReads);
      await act(async () => conversation.navigation.goBack());
      await waitFor(() => expect(conversation.reads()).toBeGreaterThan(hiddenReads));

      await conversation.updateRuntime({ activeSources: [] });
      const pendingReads = conversation.reads();
      await act(async () => jest.advanceTimersByTimeAsync(120_001));
      expect(conversation.reads()).toBe(pendingReads);
      await conversation.updateRuntime({ activeSources: ['nodeseek'] });
      await waitFor(() => expect(conversation.reads()).toBeGreaterThan(pendingReads));

      const readBlock = sourceErrorFromUnknown('nodeseek', { kind: 'verification-required', message: '请完成验证' });
      await conversation.updateRuntime({ getReadBlock: () => readBlock });
      const pausedReads = conversation.reads();
      await act(async () => jest.advanceTimersByTimeAsync(120_001));
      expect(conversation.reads()).toBe(pausedReads);
      await conversation.updateRuntime({ getReadBlock: () => undefined });

      await conversation.updateRuntime({
        identityKeys: { nodeseek: 'nodeseek:8' },
        identitySignature: 'nodeseek:8'
      });
      const previousOwnerReads = conversation.reads();
      await act(async () => jest.advanceTimersByTimeAsync(120_001));
      expect(conversation.reads()).toBe(previousOwnerReads);
      expect(conversation.marks()).toEqual([JSON.stringify({ messages: [21] })]);
    } finally {
      await conversation.view.unmount();
      appQueryClient.clear();
      jest.useRealTimers();
      focusManager.setFocused(true);
    }
  });

  it.each(['nodeseek', 'all'] as const)(
    'keeps partial %s messages and same-account cached rows on invalid retries',
    async (source) => {
      appQueryClient.clear();
      let page: NotificationPage = {
        quality: 'complete',
        items: [notification],
        cursor: null,
        hasMore: false,
        historyNotice: '仅提供近期消息'
      };
      const gateway = {
        getCategories: jest.fn(async () => [{ id: 'all', label: '全部' }]),
        listPage: jest.fn(async () => page),
        listAllPage: jest.fn(async () => {
          const error = notificationPageError(page.quality);
          return {
            items: page.quality === 'invalid' ? [] : page.items,
            qualities: { nodeseek: page.quality },
            errors: error ? { nodeseek: sourceErrorFromUnknown('nodeseek', error) } : {},
            nextCursors: { nodeseek: null },
            hasMore: false
          };
        })
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const runtime = routeRuntime(gateway);
      const tree = (value = runtime) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: source === 'all' ? undefined : { source } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
      const view = await render(tree(), { wrapper: QueryTestWrapper });
      await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
      if (source !== 'all') expect(view.getByText('仅提供近期消息')).toBeTruthy();
      page = { ...page, quality: 'partial', items: [{ ...notification, title: '部分有效消息' }] };
      await fireEvent.press(view.getByTestId('notification-list-refresh'));
      await waitFor(() => expect(view.getByText('部分有效消息')).toBeTruthy());
      expect(view.getByRole('button', { name: '重试 NodeSeek' })).toBeTruthy();
      page = { ...page, quality: 'invalid', items: [] };
      await fireEvent.press(view.getByRole('button', { name: '重试 NodeSeek' }));
      await waitFor(() => expect(view.getByText(/消息内容无法解析，请重试/)).toBeTruthy());
      expect(view.getByText('部分有效消息')).toBeTruthy();
      if (source !== 'all') expect(view.getByText('仅提供近期消息')).toBeTruthy();
      page = { quality: 'complete', items: [{ ...notification, title: '恢复后的消息' }], cursor: null, hasMore: false };
      await fireEvent.press(view.getByRole('button', { name: '重试 NodeSeek' }));
      await waitFor(() => expect(view.getByText('恢复后的消息')).toBeTruthy());
      expect(view.queryByRole('button', { name: '重试 NodeSeek' })).toBeNull();
      expect(view.queryByText('仅提供近期消息')).toBeNull();
      page = { ...page, quality: 'invalid', items: [] };
      await fireEvent.press(view.getByTestId('notification-list-refresh'));
      await waitFor(() => expect(view.getByRole('button', { name: '重试 NodeSeek' })).toBeTruthy());
      expect(view.getByText('恢复后的消息')).toBeTruthy();
      await view.rerender(
        tree({
          ...runtime,
          identityKeys: { nodeseek: 'nodeseek:another-account' },
          identitySignature: 'nodeseek:another-account'
        })
      );
      await waitFor(() => expect(view.queryByText('恢复后的消息')).toBeNull());
      expect(view.queryByText('部分有效消息')).toBeNull();
    }
  );

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
            notificationId: notification.id,
            sessionEpoch: 0
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
            notificationId: notification.id,
            sessionEpoch: 0
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
          requestAccountRecheck: jest.fn(() => undefined),
          openSource: () => true,
          privateAccessAllowed: () => true,
          remoteReady: true,
          sessionEpochs: initialForumSessionEpochs,
          sessions
        });
        return (
          <NotificationRouteRuntimeProvider value={{ ...routeRuntime(runtime.gateway), ...runtime }}>
            <NavigationContainer>
              <FocusTestStack.Navigator initialRouteName="notifications">
                <FocusTestStack.Screen name="notifications">
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
  it('reconciles a written NodeSeek receipt without restarting the first linux.do unread GET', async () => {
    appQueryClient.clear();
    let persisted: string | null = null;
    jest.mocked(AsyncStorage.getItem).mockImplementation(async () => persisted);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (_key, value) => {
      persisted = value;
    });
    const linuxDoSnapshot = Promise.withResolvers<Response>();
    const linuxDoResponse = new Response(JSON.stringify({ notifications: [], total_rows_notifications: 4 }));
    const linuxDoSignals: (AbortSignal | null | undefined)[] = [];
    let unread = 2;
    let markCalls = 0;
    const fetcher = jest.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'linux.do' && parsed.pathname === '/notifications') {
        linuxDoSignals.push(init?.signal);
        if (linuxDoSignals.length === 1) return linuxDoSnapshot.promise;
        return new Response(JSON.stringify({ notifications: [], total_rows_notifications: 9 }));
      }
      if (parsed.pathname.endsWith('/unread-count')) {
        return new Response(JSON.stringify({ atMe: 0, reply: unread, message: 0 }));
      }
      if (parsed.pathname.endsWith('/markViewed')) {
        expect(init?.method).toBe('POST');
        markCalls++;
        unread = 1;
        return new Response(JSON.stringify({ success: true }));
      }
      return new Response(JSON.stringify({ data: [] }));
    });
    const sessions = projectTestAccountSessions(
      createSiteSessionStates({
        nodeseek: {
          site: 'nodeseek',
          status: 'logged-in',
          cookieSummary: [],
          isVerifying: false,
          currentUser: { source: 'nodeseek', id: '41', username: 'reader', url: 'https://www.nodeseek.com/space/41' }
        },
        linuxdo: {
          site: 'linuxdo',
          status: 'logged-in',
          cookieSummary: [],
          isVerifying: false,
          currentUser: { source: 'linuxdo', id: '42', username: 'reader', url: 'https://linux.do/u/reader' }
        }
      })
    );
    const navigationRef = createNavigationContainerRef<FocusTestStackParamList>();
    function Harness() {
      const runtime = useNotificationsRuntime({
        appActive: true,
        contentSourcesReady: true,
        enabledNotificationSources: ['nodeseek', 'linuxdo'],
        fetcher,
        getLinuxDoUserAgent: () => 'test',
        getNodeSeekUserAgent: () => 'test',
        onSessionExpired: jest.fn(),
        requestAccountRecheck: jest.fn(() => undefined),
        openSource: () => true,
        privateAccessAllowed: () => true,
        remoteReady: true,
        sessionEpochs: initialForumSessionEpochs,
        sessions
      });
      return (
        <>
          <Text testID="unread-total">{runtime.unreadTotal}</Text>
          <NotificationRouteRuntimeProvider value={{ ...routeRuntime(runtime.gateway), ...runtime }}>
            <NavigationContainer ref={navigationRef}>
              <FocusTestStack.Navigator initialRouteName="Other">
                <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
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
    const nodeSeekUnreadKey = forumQueryKeys.notificationSnapshot({
      source: 'nodeseek',
      identityKey: 'nodeseek:41',
      sessionEpoch: 0
    });
    const view = await render(<Harness />, { wrapper: QueryTestWrapper });
    try {
      await waitFor(() => expect(linuxDoSignals).toHaveLength(1));
      await waitFor(() => expect(view.getByTestId('unread-total').props.children).toBe(2));
      expect(linuxDoSignals[0]?.aborted).toBe(false);
      await act(async () =>
        navigationRef.navigate('NotificationDetail', {
          notification: { ...notification, id: 'reply:known-writer', remoteReadId: '1', remoteGroup: 'reply-to-me' },
          identityKey: 'nodeseek:41'
        })
      );
      await waitFor(() => expect(markCalls).toBe(1));
      await waitFor(() =>
        expect(appQueryClient.getQueryData(nodeSeekUnreadKey)).toMatchObject({ snapshot: { total: 1 } })
      );
      expect(linuxDoSignals).toHaveLength(1);
      expect(linuxDoSignals[0]?.aborted).toBe(false);
      await act(async () => {
        linuxDoSnapshot.resolve(linuxDoResponse);
        await linuxDoSnapshot.promise;
      });
      await waitFor(() => expect(view.getByTestId('unread-total').props.children).toBe(5));
    } finally {
      linuxDoSnapshot.resolve(linuxDoResponse);
      await view.unmount();
      jest.mocked(AsyncStorage.getItem).mockImplementation(async () => null);
      jest.mocked(AsyncStorage.setItem).mockImplementation(async () => undefined);
    }
  });

  it.each([
    { action: 'first snapshot pending', remaining: 0 },
    { action: 'return during read', remaining: 0 },
    { action: 'return during read', remaining: 1 },
    { action: 'return during read', remaining: 2 },
    { action: 'confirmed read', remaining: 0 },
    { action: 'return during mark all', remaining: 0 },
    { action: 'confirmed mark all', remaining: 0 },
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
    const markAllCounts = { atMe: 1, reply: 1, message: 1 };
    const markedGroups: string[] = [];
    const snapshotsAfterMarkAll: (typeof markAllCounts)[] = [];
    let snapshotReads = 0;
    const firstSnapshot = Promise.withResolvers<Response>();
    let writeSignal: AbortSignal | undefined;
    const fetcher = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/unread-count')) {
        snapshotReads += 1;
        if (action === 'first snapshot pending' && snapshotReads === 1) return firstSnapshot.promise;
        if (action === 'confirmed mark all') {
          const snapshot = { ...markAllCounts };
          if (markedGroups.length === 3) snapshotsAfterMarkAll.push(snapshot);
          return new Response(JSON.stringify(snapshot), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            atMe: 0,
            reply: action === 'first snapshot pending' ? 0 : unread,
            message: action === 'first snapshot pending' ? unread : 0
          }),
          { status: 200 }
        );
      }
      if (url.includes('/markViewed')) {
        if (action === 'confirmed mark all') {
          const request = new URL(url);
          expect(init?.method).toBe('POST');
          expect(request.search).toBe('?all=true');
          const group = request.pathname.split('/').at(-2);
          if (group === 'at-me') markAllCounts.atMe = 0;
          else if (group === 'reply-to-me') markAllCounts.reply = 0;
          else if (group === 'message') markAllCounts.message = 0;
          else throw new Error('Unexpected mark-all notification group');
          markedGroups.push(group);
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        // The server has applied the read; returning cancels receipt of its response.
        unread = remaining;
        if (action === 'confirmed read' || action === 'first snapshot pending')
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        writeSignal = init?.signal || undefined;
        return new Promise<Response>((_resolve, reject) => {
          writeSignal?.addEventListener('abort', () => reject(new Error('操作已取消')), { once: true });
        });
      }
      if (url.endsWith('/message/with/9')) {
        return new Response(JSON.stringify({ msgArray: [privateMessageRow(20), privateMessageRow(21)] }));
      }
      if (new URL(url).pathname.endsWith('/list')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
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
      requestAccountRecheck: jest.fn(() => undefined),
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
                <FocusTestStack.Screen name="notifications">
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
      if (action === 'first snapshot pending') await waitFor(() => expect(snapshotReads).toBe(1));
      else
        await waitFor(() =>
          expect(view.getByTestId('unread-total').props.children).toBe(action === 'confirmed mark all' ? 3 : 2)
        );
      if (action === 'return during read' || action === 'confirmed read' || action === 'first snapshot pending') {
        await act(async () =>
          navigationRef.navigate('NotificationDetail', {
            notification:
              action === 'first snapshot pending'
                ? {
                    ...notification,
                    id: 'conversation:9',
                    kind: 'private-message',
                    unread: false,
                    target: { type: 'private-conversation', conversationId: '9' }
                  }
                : { ...notification, id: 'reply:read-badge', remoteReadId: '1', remoteGroup: 'reply-to-me' },
            identityKey: 'nodeseek:read-badge'
          })
        );
        if (action === 'first snapshot pending') {
          await waitFor(() =>
            expect(fetcher.mock.calls.some(([url]) => url.endsWith('/message/markViewed'))).toBe(true)
          );
          await act(async () => firstSnapshot.resolve(new Response(JSON.stringify({ atMe: 0, reply: 0, message: 2 }))));
          await waitFor(() => expect(snapshotReads).toBe(2));
        }
        if (action === 'return during read') await waitFor(() => expect(writeSignal).toBeDefined());
        else await waitFor(() => expect(view.getByTestId('unread-total').props.children).toBe(remaining));
        await act(async () => navigationRef.goBack());
        if (writeSignal) expect(writeSignal.aborted).toBe(true);
      } else if (action === 'return during mark all' || action === 'confirmed mark all') {
        await act(async () => navigationRef.navigate('notifications'));
        await fireEvent.press(view.getByTestId('notification-source-nodeseek'));
        await waitFor(() => expect(view.getByText('全部已读')).toBeTruthy());
        alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
          buttons?.find((button) => button.text === '确认')?.onPress?.();
        });
        await fireEvent.press(view.getByText('全部已读'));
        if (action === 'confirmed mark all') {
          await waitFor(() => expect(markedGroups).toEqual(['at-me', 'reply-to-me', 'message']));
          await waitFor(() => expect(snapshotsAfterMarkAll).toContainEqual({ atMe: 0, reply: 0, message: 0 }));
          expect(navigationRef.getCurrentRoute()?.name).toBe('notifications');
        } else {
          await waitFor(() => expect(writeSignal).toBeDefined());
          await act(async () => navigationRef.goBack());
          expect(writeSignal?.aborted).toBe(true);
        }
      } else {
        await act(async () => navigationRef.navigate('notifications'));
        await waitFor(() => expect(view.getByText('暂无消息')).toBeTruthy());
        unread = remaining;
        if (action === 'pull to refresh') {
          await fireEvent.press(view.getByTestId('notification-list-refresh'));
        } else {
          await act(async () => navigationRef.goBack());
          await act(async () => navigationRef.navigate('notifications'));
        }
      }
      await waitFor(() => expect(view.getByTestId('unread-total').props.children).toBe(remaining));
      await waitFor(() => expect(JSON.parse(persisted!).sources.nodeseek.unreadCount).toBe(remaining));
    } finally {
      firstSnapshot.resolve(new Response(JSON.stringify({ atMe: 0, reply: 0, message: unread })));
      alert?.mockRestore();
      await view.unmount();
      jest.mocked(AsyncStorage.getItem).mockImplementation(async () => null);
      jest.mocked(AsyncStorage.setItem).mockImplementation(async () => undefined);
    }
  });

  it.each(['foreground', 'background', 'resumed'] as const)(
    'keeps a notification retry login intent with its original foreground visit after %s',
    async (visit) => {
      appQueryClient.clear();
      const fetcher = jest.fn(async () => new Response('{"errors":["请求受限"]}', { status: 429 }));
      const gateway = createNotificationGateway({
        readAccess: () => ({ identityKey: 'nodeseek:42', userId: '42', fetcher }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const accountCheck = Promise.withResolvers<AccountReconcileResult>();
      let runtime: NotificationRouteRuntimeValue = {
        ...routeRuntime(gateway),
        enabledNotificationSources: ['nodeseek'],
        activeSources: ['nodeseek'],
        identityKeys: { nodeseek: 'nodeseek:42' },
        identitySignature: 'nodeseek:42',
        reconcileAccountStatus: jest.fn(() => accountCheck.promise)
      };
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const tree = () => (
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName="notifications">
              <FocusTestStack.Screen name="notifications">
                {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route as never} />}
              </FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
      const view = await render(tree(), { wrapper: QueryTestWrapper });
      try {
        const retry = await view.findByRole('button', { name: '重试 NodeSeek' });
        const listRequests = fetcher.mock.calls.length;
        await fireEvent.press(retry);
        expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
        expect(runtime.openAccountSurface).not.toHaveBeenCalled();
        if (visit !== 'foreground') {
          await act(async () => focusManager.setFocused(false));
          expect(navigation.getCurrentRoute()?.name).toBe('notifications');
          if (visit === 'resumed') await act(async () => focusManager.setFocused(true));
        }
        await act(async () => {
          accountCheck.resolve({ status: 'anonymous', session: createSiteSessionStates().nodeseek });
          await accountCheck.promise;
        });
        if (visit === 'foreground') {
          expect(runtime.openAccountSurface).toHaveBeenCalledWith('nodeseek', '登录已失效，请重新登录。');
        } else {
          expect(runtime.openAccountSurface).not.toHaveBeenCalled();
          await act(async () => focusManager.setFocused(true));
          runtime = {
            ...runtime,
            activeSources: [],
            identityKeys: {},
            identitySignature: 'none',
            sessionEpochs: { ...runtime.sessionEpochs, nodeseek: 1 }
          };
          await view.rerender(tree());
          await fireEvent.press(await view.findByRole('button', { name: '去登录 NodeSeek' }));
          expect(runtime.openAccountSurface).toHaveBeenCalledTimes(1);
        }
        expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledTimes(listRequests);
      } finally {
        accountCheck.resolve({ status: 'stale' });
        await act(async () => focusManager.setFocused(true));
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    expect(view.getByText('登录后查看消息')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: /^去登录 / }));
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
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(view.getByRole('button', { name: /^重试 / })).toBeTruthy());
      const before = fetcher.mock.calls.length;
      await fireEvent.press(view.getByRole('button', { name: /^重试 / }));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledWith(source);
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
      expect(runtime.openAccountSurface).toHaveBeenCalledWith(source, '登录已失效，请重新登录。');
      expect(fetcher).toHaveBeenCalledTimes(before);
    }
  );

  it('resumes an explicit retry after returning while an older account check is pending', async () => {
    appQueryClient.clear();
    const accountCheck = Promise.withResolvers<AccountReconcileResult>();
    const retryResponse = Promise.withResolvers<Response>();
    let retryRead = false;
    const fetcher = jest.fn(async () => {
      if (retryRead) return retryResponse.promise;
      throw new Error('连接中断');
    });
    const gateway = createNotificationGateway({
      readAccess: () => ({ identityKey: 'linuxdo:user', userId: 'user', username: 'alice', fetcher }),
      sourceAllowed: () => true,
      privateAccessAllowed: () => true
    });
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['linuxdo'],
      identityKeys: { linuxdo: 'linuxdo:user' },
      identitySignature: 'linuxdo:user',
      reconcileAccountStatus: jest.fn(() => accountCheck.promise)
    } satisfies NotificationRouteRuntimeValue;
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigation}>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="notifications">
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await waitFor(() => expect(view.getByRole('button', { name: '重试 linux.do' })).toBeTruthy());
      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
      await act(async () => navigation.navigate('Other'));
      await act(async () => navigation.goBack());
      await waitFor(() => expect(appQueryClient.isFetching()).toBe(0));
      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(2);

      const readsBeforeRetry = fetcher.mock.calls.length;
      retryRead = true;
      await act(async () => {
        accountCheck.resolve({ status: 'same', session: createSiteSessionStates().linuxdo });
        await accountCheck.promise;
      });
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(readsBeforeRetry + 1));
      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(2);
      expect(runtime.openAccountSurface).not.toHaveBeenCalled();
      await act(async () => {
        retryResponse.resolve(new Response(JSON.stringify({ notifications: [] })));
        await retryResponse.promise;
      });
      await waitFor(() => expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull());
      expect(runtime.notify).not.toHaveBeenCalled();
    } finally {
      accountCheck.resolve({ status: 'stale' });
      retryResponse.resolve(new Response(JSON.stringify({ notifications: [] })));
      await view.unmount();
    }
  });

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
      let recovery: ReadRecovery | undefined;
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
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: { source: 'linuxdo' } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(view.getByRole('button', { name: '去验证 linux.do' })).toBeTruthy());
      const beforeOpen = fetcher.mock.calls.length;
      await fireEvent.press(view.getByRole('button', { name: '去验证 linux.do' }));
      expect(fetcher).toHaveBeenCalledTimes(beforeOpen);
      expect(recovery).toBeDefined();
      challenged = false;
      await act(async () => {
        expect(await recovery!.resume()).toBe('completed');
      });
      await waitFor(() => expect(view.queryByRole('button', { name: '去验证 linux.do' })).toBeNull());
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
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(view.getByRole('button', { name: '重试 linux.do' })).toBeTruthy());
      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
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
        qualities: {},
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
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      const label = `${kind === 'verification-required' ? '去验证' : '去登录'} linux.do`;
      await waitFor(() => expect(view.getByRole('button', { name: label })).toBeTruthy());
      expect(openAccountSurface).not.toHaveBeenCalled();
      await fireEvent.press(view.getByRole('button', { name: label }));
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source: 'nodeseek' } }}
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source: 'nodeseek' } }}
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
          navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
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
          notificationId: notification.id,
          sessionEpoch: 0
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
        qualities: {},
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
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
    const listPage = jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }));
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByRole('button', { name: '重试 NodeSeek' })).toBeTruthy());
    expect(view.queryByText('正在读取消息')).toBeNull();
    expect(listPage).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: '重试 NodeSeek' }));
    await waitFor(() => expect(view.getByTestId('notification-category-all')).toBeTruthy());
    await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
    expect(getCategories).toHaveBeenCalledTimes(2);
  });

  it('keeps cached messages in every commit when switching to a source default category', async () => {
    appQueryClient.clear();
    const gateway = {
      getCategories: jest.fn(),
      listAllPage: jest.fn(async () => ({
        qualities: {},
        items: [notification],
        pages: {},
        errors: {},
        nextCursors: {},
        hasMore: false
      })),
      listPage: jest.fn(async (source: NotificationSource) => ({
        quality: 'complete',
        items: [{ ...notification, source }],
        cursor: null,
        hasMore: false
      })),
      loadDetail: jest.fn(),
      markAllRead: jest.fn(),
      markRead: jest.fn(),
      readUnreadSnapshot: jest.fn()
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['nodeseek', 'linuxdo'],
      identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:user' },
      identitySignature: 'linuxdo:user|nodeseek:new-account'
    } satisfies NotificationRouteRuntimeValue;
    for (const source of ['all', 'nodeseek', 'linuxdo'] as const) {
      const identityKey = source === 'all' ? runtime.identitySignature : runtime.identityKeys[source];
      const categoryId = source === 'nodeseek' ? 'inbox' : 'recent';
      if (source !== 'all') {
        appQueryClient.setQueryData(forumQueryKeys.notificationCategories({ source, identityKey }), [
          { id: categoryId, label: '全部' }
        ]);
      }
      appQueryClient.setQueryData(
        forumQueryKeys.notificationList({
          source,
          identityKey,
          categoryId: source === 'all' ? null : categoryId,
          unreadOnly: false
        }),
        {
          pages: [
            {
              items: [{ ...notification, source: source === 'all' ? 'nodeseek' : source }],
              errors: {},
              hasMore: false,
              nextPage: {}
            }
          ],
          pageParams: [{}]
        }
      );
    }
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    const commits: unknown[][] = [];
    mockNotificationListCommit = (data) => commits.push(data);
    try {
      for (const source of ['nodeseek', 'linuxdo', 'all', 'nodeseek'] as const) {
        commits.length = 0;
        await fireEvent.press(view.getByTestId(`notification-source-${source}`));
        expect(commits.length).toBeGreaterThan(0);
        expect(commits.every((items) => items.length === 1)).toBe(true);
        expect(view.queryByText('暂无消息')).toBeNull();
      }
      expect(gateway.listPage).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ categoryId: '' }));
    } finally {
      mockNotificationListCommit = undefined;
      await view.unmount();
    }
  });

  it('scopes list queries by category and consumes repeated site intents without losing manual site changes', async () => {
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
    const listPage = jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }));
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
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigation}>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="notifications" initialParams={{ source: 'nodeseek' }}>
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
            </FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByTestId('notification-category-messages')).toBeTruthy());
    await waitFor(() => expect(navigation.getCurrentRoute()?.params).toEqual({ source: undefined }));
    await fireEvent.press(view.getByTestId('notification-category-messages'));
    await waitFor(() =>
      expect(listPage).toHaveBeenLastCalledWith('nodeseek', expect.objectContaining({ categoryId: 'messages' }))
    );
    const callsBeforeReselecting = listPage.mock.calls.length;
    await fireEvent.press(view.getByTestId('notification-source-nodeseek'));
    await fireEvent.press(view.getByTestId('notification-category-messages'));
    expect(view.getByTestId('notification-category-messages').props.accessibilityState.selected).toBe(true);
    expect(listPage).toHaveBeenCalledTimes(callsBeforeReselecting);
    await fireEvent.press(view.getByTestId('notification-source-linuxdo'));
    await waitFor(() => expect(view.getByTestId('notification-category-replies')).toBeTruthy());
    expect(listPage).toHaveBeenLastCalledWith('linuxdo', expect.objectContaining({ categoryId: 'recent' }));

    await act(async () => navigation.navigate('notifications', { source: 'nodeseek' }));
    await waitFor(() => expect(view.getByTestId('notification-category-messages')).toBeTruthy());
    await waitFor(() => expect(navigation.getCurrentRoute()?.params).toEqual({ source: undefined }));
    expect(view.getByTestId('notification-source-nodeseek').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(view.getByTestId('notification-source-linuxdo'));
    await waitFor(() => expect(view.getByTestId('notification-category-replies')).toBeTruthy());

    await act(async () => navigation.navigate('notifications', { source: 'nodeseek' }));
    await waitFor(() => expect(view.getByTestId('notification-category-messages')).toBeTruthy());
    await waitFor(() => expect(navigation.getCurrentRoute()?.params).toEqual({ source: undefined }));
    expect(view.getByTestId('notification-source-nodeseek').props.accessibilityState.selected).toBe(true);
  });

  it.each(['source', 'category', 'unread', 'focus'] as const)(
    'does not send from a mark-all confirmation opened before a change of %s',
    async (scope) => {
      appQueryClient.clear();
      const posts = jest.fn(async () => new Response(JSON.stringify({ success: true })));
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          nodeseek: {
            ...notificationAdapters.nodeseek,
            getCategories: async () => [
              { id: 'all', label: '全部消息' },
              { id: 'replies', label: '回复' }
            ],
            listPage: async () => ({ quality: 'complete', items: [notification], cursor: null, hasMore: false })
          }
        },
        privateAccessAllowed: () => true,
        sourceAllowed: () => true,
        readAccess: () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account', fetcher: posts })
      });
      const runtime = routeRuntime(gateway);
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      let confirm: (() => void) | undefined;
      const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        confirm = buttons?.find((button) => button.text === '确认')?.onPress;
      });
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator>
              <FocusTestStack.Screen name="notifications" initialParams={{ source: 'nodeseek' }}>
                {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await waitFor(() => expect(view.getByText('全部已读')).toBeTruthy());
        const queuedMarkAll = mockListNavigationProps.onMarkAll;
        await fireEvent.press(view.getByText('全部已读'));
        expect(confirm).toBeDefined();
        const previousConfirm = confirm!;
        if (scope === 'source') {
          await fireEvent.press(view.getByTestId('notification-source-all'));
          await fireEvent.press(view.getByTestId('notification-source-nodeseek'));
        } else if (scope === 'category') {
          await fireEvent.press(view.getByTestId('notification-category-replies'));
          await fireEvent.press(view.getByTestId('notification-category-all'));
        } else if (scope === 'unread') {
          await fireEvent(view.getByLabelText('只看未读'), 'valueChange', true);
        } else {
          await act(async () => navigation.navigate('Other'));
          await act(async () => navigation.goBack());
        }
        await act(async () => previousConfirm());
        expect(posts).not.toHaveBeenCalled();
        await act(async () => queuedMarkAll());
        expect(alert).toHaveBeenCalledTimes(1);
        await fireEvent.press(view.getByText('全部已读'));
        expect(alert.mock.calls.at(-1)?.[1]).toContain('NodeSeek');
        await act(async () => confirm?.());
        await waitFor(() => expect(runtime.notify).toHaveBeenCalledWith('已按原站状态标记全部已读'));
        expect(posts).toHaveBeenCalledTimes(3);
      } finally {
        alert.mockRestore();
        await view.unmount();
      }
    }
  );

  it('reopens mark-all confirmation after Android dismiss without letting stale callbacks cancel or double-submit', async () => {
    appQueryClient.clear();
    const pendingPost = Promise.withResolvers<void>();
    const posts = jest.fn<Fetcher>(async (_url, init) => {
      if (init?.method?.toUpperCase() === 'POST') await pendingPost.promise;
      return new Response(JSON.stringify({ success: true, data: [] }));
    });
    const gateway = createNotificationGateway({
      adapters: {
        ...notificationAdapters,
        nodeseek: {
          ...notificationAdapters.nodeseek,
          getCategories: async () => [
            { id: 'all', label: '全部消息' },
            { id: 'replies', label: '回复' }
          ],
          listPage: async () => ({ quality: 'complete', items: [notification], cursor: null, hasMore: false })
        }
      },
      readAccess: () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account', fetcher: posts }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });
    const markAllSpy = jest.spyOn(gateway, 'markAllRead');
    const runtime = routeRuntime(gateway);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="notifications" initialParams={{ source: 'nodeseek' }}>
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
            </FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await waitFor(() => expect(view.getByText('全部已读')).toBeTruthy());
      posts.mockClear();

      // Open dialog #1 and simulate Android replacing/dismissing it via onDismiss.
      await fireEvent.press(view.getByText('全部已读'));
      expect(alert).toHaveBeenCalledTimes(1);
      const firstButtons = alert.mock.calls[0]?.[2];
      const firstOptions = alert.mock.calls[0]?.[3];
      expect(firstOptions?.onDismiss).toBeDefined();
      await act(async () => {
        firstOptions?.onDismiss?.();
      });
      expect(markAllSpy).not.toHaveBeenCalled();

      // Immediately reopenable on the same page; cancel writes 0 times.
      await fireEvent.press(view.getByText('全部已读'));
      expect(alert).toHaveBeenCalledTimes(2);
      const secondCancel = alert.mock.calls[1]?.[2]?.find((button) => button.text === '取消')?.onPress;
      await act(async () => {
        secondCancel?.();
      });
      expect(markAllSpy).not.toHaveBeenCalled();

      // Reopen dialog #3; stale callbacks from dialog #1 must not close dialog #3 or write.
      await fireEvent.press(view.getByText('全部已读'));
      expect(alert).toHaveBeenCalledTimes(3);
      await act(async () => {
        firstOptions?.onDismiss?.();
        firstButtons?.find((button) => button.text === '取消')?.onPress?.();
        firstButtons?.find((button) => button.text === '确认')?.onPress?.();
      });
      expect(markAllSpy).not.toHaveBeenCalled();

      // Confirm dialog #3; trailing Android onDismiss during submission must not abort it.
      const thirdConfirm = alert.mock.calls[2]?.[2]?.find((button) => button.text === '确认')?.onPress;
      const thirdDismiss = alert.mock.calls[2]?.[3]?.onDismiss;
      await act(async () => {
        thirdConfirm?.();
        thirdDismiss?.();
        thirdConfirm?.();
      });
      expect(markAllSpy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(posts).toHaveBeenCalledTimes(1));
      await act(async () => {
        pendingPost.resolve();
      });
      await waitFor(() => expect(runtime.notify).toHaveBeenCalledWith('已按原站状态标记全部已读'));
      expect(markAllSpy).toHaveBeenCalledTimes(1);
      expect(posts).toHaveBeenCalledTimes(3);
    } finally {
      pendingPost.resolve();
      alert.mockRestore();
      await view.unmount();
    }
  });

  it.each(['source', 'category', 'unread', 'focus'] as const)(
    'releases mark-all busy on a change of %s and ignores the old settlement',
    async (scope) => {
      appQueryClient.clear();
      const pending = Promise.withResolvers<NotificationMarkResult>();
      const nextPending = Promise.withResolvers<NotificationMarkResult>();
      let oldSignal: AbortSignal | undefined;
      let attempts = 0;
      const markAllRead = jest.fn<NotificationRouteRuntimeValue['gateway']['markAllRead']>(
        async (_source, _identityKey, signal) => {
          attempts += 1;
          if (attempts === 1) oldSignal = signal;
          return attempts === 1 ? pending.promise : nextPending.promise;
        }
      );
      const gateway = {
        getCategories: jest.fn(async () => [
          { id: 'all', label: '全部消息' },
          { id: 'replies', label: '回复' }
        ]),
        listPage: jest.fn(async () => ({ quality: 'complete', items: [notification], cursor: null, hasMore: false })),
        listAllPage: jest.fn(async () => ({ items: [notification], errors: {}, nextCursors: {}, hasMore: false })),
        markAllRead
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const runtime = routeRuntime(gateway);
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        const confirm = buttons?.find((button) => button.text === '确认')?.onPress;
        confirm?.();
        confirm?.();
      });
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator>
              <FocusTestStack.Screen name="notifications" initialParams={{ source: 'nodeseek' }}>
                {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await waitFor(() => expect(view.getByText('全部已读')).toBeTruthy());
        await fireEvent.press(view.getByText('全部已读'));
        await waitFor(() => expect(view.getByTestId('notification-mark-all').props.accessibilityState.busy).toBe(true));
        expect(markAllRead).toHaveBeenCalledTimes(1);
        if (scope === 'source') {
          await fireEvent.press(view.getByTestId('notification-source-all'));
          await fireEvent.press(view.getByTestId('notification-source-nodeseek'));
        } else if (scope === 'category') {
          await fireEvent.press(view.getByTestId('notification-category-replies'));
          await fireEvent.press(view.getByTestId('notification-category-all'));
        } else if (scope === 'unread') {
          await fireEvent(view.getByLabelText('只看未读'), 'valueChange', true);
        } else {
          await act(async () => navigation.navigate('Other'));
          await act(async () => navigation.goBack());
        }
        expect(oldSignal?.aborted).toBe(true);
        await waitFor(() => expect(view.getByText('全部已读')).toBeTruthy());
        await fireEvent.press(view.getByText('全部已读'));
        await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(2));
        await act(async () => pending.resolve({ confirmed: true }));
        expect(runtime.notify).not.toHaveBeenCalled();
        expect(view.getByTestId('notification-mark-all').props.accessibilityState.busy).toBe(true);
        await act(async () => nextPending.resolve({ confirmed: true }));
        await waitFor(() =>
          expect(view.getByTestId('notification-mark-all').props.accessibilityState.busy).toBe(false)
        );
        expect(runtime.notify).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => {
          pending.resolve({ confirmed: true });
          nextPending.resolve({ confirmed: true });
        });
        alert.mockRestore();
        await view.unmount();
      }
    }
  );

  it.each<[source: 'all' | 'nodeseek', refreshKind: 'none' | 'background' | 'manual']>([
    ['all', 'none'],
    ['nodeseek', 'none'],
    ['all', 'background'],
    ['nodeseek', 'background'],
    ['all', 'manual'],
    ['nodeseek', 'manual']
  ])(
    'keeps refresh and repeated end callbacks from racing for %s with refresh kind %s',
    async (source, refreshKind) => {
      appQueryClient.clear();
      const refreshStarted = Promise.withResolvers<void>();
      const refreshPage = Promise.withResolvers<NotificationPage>();
      const next = Promise.withResolvers<NotificationPage>();
      const signals: (AbortSignal | undefined)[] = [];
      const nextItem = { ...notification, id: 'reply:next-page', title: '下一页消息' };
      const firstPage: NotificationPage = { quality: 'complete', items: [notification], cursor: 'next', hasMore: true };
      const listPage = jest.fn<NotificationAdapter['listPage']>(async ({ cursor, signal }) => {
        signals.push(signal);
        if (!cursor) {
          if (refreshKind !== 'none' && signals.length > 1) {
            refreshStarted.resolve();
            return refreshPage.promise;
          }
          return firstPage;
        }
        return next.promise;
      });
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          nodeseek: {
            ...notificationAdapters.nodeseek,
            getCategories: async () => [{ id: 'replies', label: '回复' }],
            listPage
          }
        },
        privateAccessAllowed: () => true,
        sourceAllowed: () => true,
        readAccess: async () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account' })
      });
      const view = await render(
        <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: source === 'all' ? undefined : { source } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
      const reachEnd = view.getByTestId('notification-list-end').props.onPress;
      const expectedCursors = refreshKind !== 'none' ? [undefined, undefined, 'next'] : [undefined, 'next'];
      try {
        await act(async () => {
          if (refreshKind === 'manual') {
            view.getByTestId('notification-list-refresh').props.onPress();
            await refreshStarted.promise;
          } else if (refreshKind === 'background') {
            void appQueryClient.refetchQueries({
              queryKey: forumQueryKeys.notificationList({
                source,
                categoryId: source === 'all' ? null : 'replies',
                identityKey: 'nodeseek:new-account',
                unreadOnly: false
              }),
              exact: true
            });
            await refreshStarted.promise;
          }
          if (refreshKind === 'manual') {
            reachEnd();
            reachEnd();
            expect(signals[1]?.aborted).toBe(false);
            expect(listPage.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, undefined]);
            refreshPage.resolve(firstPage);
          }
        });
        if (refreshKind === 'manual') {
          await waitFor(() =>
            expect(
              appQueryClient.getQueryState(
                forumQueryKeys.notificationList({
                  source,
                  categoryId: source === 'all' ? null : 'replies',
                  identityKey: 'nodeseek:new-account',
                  unreadOnly: false
                })
              )?.fetchStatus
            ).toBe('idle')
          );
        }
        await act(async () => {
          reachEnd();
          await waitFor(() => expect(listPage.mock.calls.map(([options]) => options.cursor)).toEqual(expectedCursors));
          // A second native callback can arrive before React commits fetchingMore.
          reachEnd();
          next.resolve({ quality: 'complete', items: [nextItem], cursor: null, hasMore: false });
        });
        await waitFor(() => expect(view.getByText('下一页消息')).toBeTruthy());
        expect(listPage.mock.calls.map(([options]) => options.cursor)).toEqual(expectedCursors);
        expect(signals.at(-1)?.aborted).toBe(false);
        if (refreshKind !== 'none') {
          expect(signals[1]?.aborted).toBe(refreshKind === 'background');
          await act(async () => refreshPage.resolve(firstPage));
          expect(view.getByText('下一页消息')).toBeTruthy();
        }
        expect(view.getAllByText('旧账号消息')).toHaveLength(1);
        expect(view.getAllByText('下一页消息')).toHaveLength(1);
      } finally {
        await act(async () => {
          refreshPage.resolve(firstPage);
          next.resolve({ quality: 'complete', items: [nextItem], cursor: null, hasMore: false });
        });
        await view.unmount();
      }
    }
  );

  it.each(['all', 'nodeseek'] as const)(
    'waits for the visible %s page to commit before a repeated end callback advances again',
    async (source) => {
      appQueryClient.clear();
      const secondItem = { ...notification, id: 'reply:second', title: '第二页消息' };
      const thirdItem = { ...notification, id: 'reply:third', title: '第三页消息' };
      const listPage = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => ({
        quality: 'complete',
        items: [cursor === 'next' ? secondItem : cursor === 'last' ? thirdItem : notification],
        cursor: cursor === 'next' ? 'last' : cursor === 'last' ? null : 'next',
        hasMore: cursor !== 'last'
      }));
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          nodeseek: {
            ...notificationAdapters.nodeseek,
            getCategories: async () => [{ id: 'replies', label: '回复' }],
            listPage
          }
        },
        privateAccessAllowed: () => true,
        sourceAllowed: () => true,
        readAccess: async () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account' })
      });
      const queryKey = forumQueryKeys.notificationList({
        source,
        categoryId: source === 'all' ? null : 'replies',
        identityKey: 'nodeseek:new-account',
        unreadOnly: false
      });
      const view = await render(
        <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: source === 'all' ? undefined : { source } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      const notifications: (() => void)[] = [];
      const secondCached = Promise.withResolvers<void>();
      const unsubscribe = appQueryClient.getQueryCache().subscribe(() => {
        if (appQueryClient.getQueryData<{ pages: unknown[] }>(queryKey)?.pages.length === 2) secondCached.resolve();
      });
      try {
        await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
        const reachEnd = view.getByTestId('notification-list-end').props.onPress;
        notifyManager.setScheduler((callback) => notifications.push(callback));
        await act(async () => {
          reachEnd();
          await secondCached.promise;
          // The native list still displays page one while Query observer notifications wait.
          reachEnd();
        });
        expect(view.queryByText('第二页消息')).toBeNull();
        expect(listPage.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, 'next']);
        notifyManager.setScheduler(defaultScheduler);
        await act(async () => notifications.splice(0).forEach((notify) => notify()));
        await waitFor(() => expect(view.getByText('第二页消息')).toBeTruthy());
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await waitFor(() => expect(view.getByText('第三页消息')).toBeTruthy());
        expect(listPage.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, 'next', 'last']);
      } finally {
        unsubscribe();
        notifyManager.setScheduler(defaultScheduler);
        await act(async () => {
          notifications.splice(0).forEach((notify) => notify());
          await appQueryClient.cancelQueries();
        });
        await view.unmount();
      }
    }
  );

  it.each(['all', 'nodeseek'] as const)(
    'polls one page in %s but leaves loaded history to explicit refresh',
    async (source) => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      appQueryClient.clear();
      focusManager.setFocused(true);
      const listPage = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => ({
        quality: 'complete',
        items: [{ ...notification, id: cursor ? 'history' : 'recent', title: cursor ? '历史消息' : '最新消息' }],
        cursor: cursor ? null : 'next',
        hasMore: !cursor
      }));
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          nodeseek: {
            ...notificationAdapters.nodeseek,
            getCategories: async () => [{ id: 'all', label: '全部' }],
            listPage
          }
        },
        privateAccessAllowed: () => true,
        sourceAllowed: () => true,
        readAccess: () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account' })
      });
      const view = await render(
        <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: source === 'all' ? undefined : { source } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await waitFor(() => expect(view.getByText('最新消息')).toBeTruthy());
        expect(listPage).toHaveBeenCalledTimes(1);
        await act(async () => jest.advanceTimersByTimeAsync(60_001));
        expect(listPage).toHaveBeenCalledTimes(2);
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await waitFor(() => expect(view.getByText('历史消息')).toBeTruthy());
        expect(listPage).toHaveBeenCalledTimes(3);
        await act(async () => jest.advanceTimersByTimeAsync(120_001));
        expect(listPage).toHaveBeenCalledTimes(3);
        await fireEvent.press(view.getByTestId('notification-list-refresh'));
        await waitFor(() => expect(listPage).toHaveBeenCalledTimes(5));
        expect(view.getByText('最新消息')).toBeTruthy();
        expect(view.getByText('历史消息')).toBeTruthy();
      } finally {
        await view.unmount();
        appQueryClient.clear();
        jest.useRealTimers();
        focusManager.setFocused(true);
      }
    }
  );

  it.each(['all', 'nodeseek'] as const)(
    'stops a historical cursor cycle in %s and retries the failed page while other sources continue',
    async (source) => {
      appQueryClient.clear();
      let retrySucceeded = false;
      let pageReads = 0;
      const listPage = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => {
        pageReads += 1;
        const next = !cursor ? 'A' : cursor === 'A' ? 'B' : cursor === 'B' ? (retrySucceeded ? 'C' : 'A') : null;
        return {
          quality: 'complete',
          items: source === 'all' || retrySucceeded ? [{ ...notification, id: cursor || 'first' }] : [],
          // Stop a broken implementation's empty-page loop so the failure stays bounded.
          cursor: pageReads > 3 && !retrySucceeded ? null : next,
          hasMore: Boolean(next) && (pageReads <= 3 || retrySucceeded)
        };
      });
      const otherListPage = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => ({
        quality: 'complete',
        items: [],
        cursor: !cursor ? 'L1' : cursor === 'L1' ? 'L2' : cursor === 'L2' ? 'L3' : null,
        hasMore: cursor !== 'L3'
      }));
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          nodeseek: {
            ...notificationAdapters.nodeseek,
            getCategories: async () => [{ id: 'all', label: '全部' }],
            listPage
          },
          linuxdo: { ...notificationAdapters.linuxdo, listPage: otherListPage }
        },
        privateAccessAllowed: () => true,
        sourceAllowed: () => true,
        readAccess: (candidate) => ({ identityKey: `${candidate}:new-account`, userId: 'new-account' })
      });
      const runtime: NotificationRouteRuntimeValue = {
        ...routeRuntime(gateway),
        activeSources: source === 'all' ? ['nodeseek', 'linuxdo'] : ['nodeseek'],
        identityKeys: { nodeseek: 'nodeseek:new-account', linuxdo: 'linuxdo:new-account' },
        identitySignature: source === 'all' ? 'linuxdo:new-account|nodeseek:new-account' : 'nodeseek:new-account'
      };
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: source === 'all' ? undefined : { source } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        if (source === 'all') {
          await waitFor(() => expect(view.getAllByText('旧账号消息')).toHaveLength(1));
          await fireEvent.press(view.getByTestId('notification-list-end'));
          await waitFor(() => expect(view.getAllByText('旧账号消息')).toHaveLength(2));
          await fireEvent.press(view.getByTestId('notification-list-end'));
        }
        await waitFor(() => expect(view.getByRole('button', { name: '重试 NodeSeek' })).toBeTruthy());
        expect(listPage.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, 'A', 'B']);
        if (source === 'all') {
          await fireEvent.press(view.getByTestId('notification-list-end'));
          await waitFor(() => expect(otherListPage).toHaveBeenCalledTimes(4));
          expect(listPage).toHaveBeenCalledTimes(3);
        }
        retrySucceeded = true;
        await fireEvent.press(view.getByRole('button', { name: '重试 NodeSeek' }));
        await waitFor(() => expect(view.queryByRole('button', { name: '重试 NodeSeek' })).toBeNull());
        expect(listPage.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, 'A', 'B', 'B']);
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await waitFor(() => expect(listPage).toHaveBeenCalledTimes(5));
        expect(listPage.mock.calls.at(-1)?.[0].cursor).toBe('C');
        expect(otherListPage).toHaveBeenCalledTimes(source === 'all' ? 4 : 0);
      } finally {
        await view.unmount();
      }
    }
  );

  it('continues category pagination when an earlier source page has no matching rows', async () => {
    appQueryClient.clear();
    const listPage = jest
      .fn<
        (
          _source?: string,
          _options?: unknown
        ) => Promise<{
          quality: 'complete';
          items: ForumNotification[];
          cursor: string | null;
          hasMore: boolean;
        }>
      >()
      .mockResolvedValueOnce({ quality: 'complete' as const, items: [], cursor: '30', hasMore: true })
      .mockResolvedValueOnce({ quality: 'complete' as const, items: [notification], cursor: null, hasMore: false });
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
    expect(listPage).toHaveBeenCalledTimes(2);
    expect(listPage).toHaveBeenLastCalledWith('nodeseek', expect.objectContaining({ cursor: '30' }));
  });

  it('does not replay an empty-page continuation when the App goes to the background', async () => {
    const listPage = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => {
      if (!cursor) return { quality: 'complete', items: [], cursor: '30', hasMore: true };
      return new Promise(() => {});
    });
    const gateway = createNotificationGateway({
      adapters: {
        ...notificationAdapters,
        nodeseek: {
          ...notificationAdapters.nodeseek,
          getCategories: async () => [{ id: 'all', label: '全部' }],
          listPage
        }
      },
      privateAccessAllowed: () => true,
      sourceAllowed: () => true,
      readAccess: () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account' })
    });
    focusManager.setFocused(true);
    const view = await render(
      <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source: 'nodeseek' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await waitFor(() => expect(listPage).toHaveBeenCalledTimes(2));
      await act(async () => focusManager.setFocused(false));
      expect(listPage.mock.calls[1]?.[0].signal?.aborted).toBe(true);
      await fireEvent.press(view.getByTestId('notification-list-end'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
      expect(listPage).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
      focusManager.setFocused(true);
    }
  });

  it('resumes the first notification list read after App background canceled it', async () => {
    appQueryClient.clear();
    focusManager.setFocused(true);
    const pending = Promise.withResolvers<NotificationPage>();
    const page: NotificationPage = { quality: 'complete', items: [notification], cursor: null, hasMore: false };
    const listPage = jest
      .fn<NotificationAdapter['listPage']>(async () => page)
      .mockImplementationOnce(() => pending.promise);
    const gateway = createNotificationGateway({
      adapters: { ...notificationAdapters, nodeseek: { ...notificationAdapters.nodeseek, listPage } },
      privateAccessAllowed: () => true,
      sourceAllowed: () => true,
      readAccess: () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account' })
    });
    const view = await render(
      <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
      await act(async () => focusManager.setFocused(false));
      expect(listPage.mock.calls[0]?.[0].signal?.aborted).toBe(true);
      expect(listPage).toHaveBeenCalledTimes(1);
      await act(async () => focusManager.setFocused(true));
      await view.findByText('旧账号消息');
      expect(listPage).toHaveBeenCalledTimes(2);
    } finally {
      await view.unmount();
      await act(async () => pending.resolve(page));
      appQueryClient.clear();
      focusManager.setFocused(true);
    }
  });

  it('cancels pending linux.do category discovery and its account recovery when the App goes to the background', async () => {
    appQueryClient.clear();
    focusManager.setFocused(true);
    const pending = Promise.withResolvers<Response>();
    const fetcher = jest.fn<Fetcher>(async () => new Response('{}')).mockImplementationOnce(() => pending.promise);
    const requestAccountRecheck = jest.fn(async () => true);
    const gateway = createNotificationGateway({
      adapters: {
        ...notificationAdapters,
        linuxdo: {
          ...notificationAdapters.linuxdo,
          listPage: async () => ({ quality: 'complete', items: [], cursor: null, hasMore: false })
        }
      },
      readAccess: () => ({ identityKey: 'linuxdo:42', userId: '42', username: 'test-user', fetcher }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true,
      requestAccountRecheck
    });
    const runtime = routeRuntime(gateway);
    runtime.activeSources = ['linuxdo'];
    runtime.identityKeys = { linuxdo: 'linuxdo:42' };
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source: 'linuxdo' } }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
      expect(String(fetcher.mock.calls[0]?.[0])).toContain('/site.json');
      const signal = fetcher.mock.calls[0]?.[1]?.signal;
      await act(async () => focusManager.setFocused(false));
      expect(signal?.aborted).toBe(true);
      await act(async () => pending.resolve(new Response('{}', { status: 401 })));
      expect(requestAccountRecheck).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => focusManager.setFocused(true));
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      expect(fetcher.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    } finally {
      await view.unmount();
      await act(async () => pending.resolve(new Response('{}')));
      appQueryClient.clear();
      focusManager.setFocused(true);
    }
  });

  it.each(['all', 'nodeseek'] as const)(
    'aborts the current %s notification read when another route opens',
    async (source) => {
      appQueryClient.clear();
      let observed: AbortSignal | undefined;
      const gateway = {
        listAllPage: ({ signal }: { signal: AbortSignal }) => {
          if (source === 'all') observed = signal;
          return new Promise(() => {});
        },
        getCategories: (_site: string, _identity: string, signal: AbortSignal) => {
          observed = signal;
          return new Promise(() => {});
        }
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      await render(
        <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator>
              <FocusTestStack.Screen
                name="notifications"
                initialParams={{ source: source === 'all' ? undefined : source }}
              >
                {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route as never} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      await waitFor(() => expect(observed).toBeDefined());
      await act(async () => navigation.navigate('Other'));
      expect(observed?.aborted).toBe(true);
    }
  );

  it('stops the mounted notification list from reading after it loses focus', async () => {
    appQueryClient.clear();
    const listAllPage = jest.fn(async () => ({
      qualities: {},
      items: [notification],
      pages: {},
      errors: {},
      nextCursors: { nodeseek: 'next' },
      hasMore: true
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
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigationRef}>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="notifications">
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route as never} />}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    await waitFor(() => expect(listAllPage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
    const lateEnd = view.getByTestId('notification-list-end').props.onPress;
    const lateRefresh = view.getByTestId('notification-list-refresh').props.onPress;

    await act(async () => navigationRef.navigate('Other'));
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Other'));
    await act(async () => {
      lateEnd();
      lateRefresh();
    });
    await appQueryClient.refetchQueries({
      queryKey: forumQueryKeys.notificationList({
        source: 'all',
        identityKey: runtime.identitySignature,
        unreadOnly: false
      })
    });

    expect(listAllPage).toHaveBeenCalledTimes(1);
  });

  it.each(['notification-list-end', 'notification-list-refresh'])(
    'ignores a queued %s when another source takes over the list',
    async (testId) => {
      appQueryClient.clear();
      const listPage = jest.fn<NotificationRouteRuntimeValue['gateway']['listPage']>(async () => ({
        quality: 'complete',
        items: [notification],
        cursor: 'next',
        hasMore: true
      }));
      const gateway = {
        getCategories: jest.fn(async () => [{ id: 'all', label: '全部' }]),
        listAllPage: jest.fn(async () => ({
          qualities: {},
          items: [notification],
          pages: {},
          errors: {},
          nextCursors: { nodeseek: 'old' },
          hasMore: true
        })),
        listPage
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const view = await render(
        <NotificationRouteRuntimeProvider value={routeRuntime(gateway)}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications' }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
        const oldEvent = view.getByTestId(testId).props.onPress;
        expect(oldEvent).toBeDefined();
        await fireEvent.press(view.getByTestId('notification-source-nodeseek'));
        await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
        await act(async () => oldEvent());
        expect(listPage).toHaveBeenCalledTimes(1);
        await fireEvent.press(view.getByTestId(testId));
        await waitFor(() => expect(listPage).toHaveBeenCalledTimes(2));
      } finally {
        await view.unmount();
      }
    }
  );

  it.each(['source', 'focus'])('rejects a site retry queued before a change of %s', async (change) => {
    appQueryClient.clear();
    const gateway = {
      getCategories: jest.fn(async () => [{ id: 'all', label: '全部' }]),
      listAllPage: jest.fn(async () => ({
        qualities: {},
        items: [notification],
        pages: {},
        errors: { nodeseek: sourceErrorFromUnknown('nodeseek', new Error('暂时无法读取')) },
        nextCursors: {},
        hasMore: false
      })),
      listPage: jest.fn(async () => ({ quality: 'complete', items: [notification], cursor: null, hasMore: false }))
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = routeRuntime(gateway);
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigation}>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="notifications">
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await waitFor(() => expect(view.getByText('旧账号消息')).toBeTruthy());
      const queuedRetry = mockListNavigationProps.onRetrySource;
      if (change === 'source') await fireEvent.press(view.getByTestId('notification-source-nodeseek'));
      else await act(async () => navigation.navigate('Other'));
      await act(async () => queuedRetry('nodeseek'));
      expect(runtime.reconcileAccountStatus).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  });

  it('stops its account retry sequence when the first check completes after leaving messages', async () => {
    appQueryClient.clear();
    const runtime = routeRuntime({} as NotificationRouteRuntimeValue['gateway']);
    runtime.activeSources = [];
    runtime.enabledNotificationSources = ['nodeseek', 'linuxdo'];
    runtime.sessions.nodeseek = { ...runtime.sessions.nodeseek, identityTrust: 'unknown' };
    runtime.sessions.linuxdo = { ...runtime.sessions.linuxdo, identityTrust: 'unknown' };
    const first = Promise.withResolvers<AccountReconcileResult>();
    jest
      .mocked(runtime.reconcileAccountStatus)
      .mockResolvedValue({ status: 'stale' })
      .mockReturnValueOnce(first.promise);
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer ref={navigation}>
          <FocusTestStack.Navigator>
            <FocusTestStack.Screen name="notifications">
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
            </FocusTestStack.Screen>
            <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await fireEvent.press(view.getByText('重试账号核对'));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
      await act(async () => navigation.navigate('Other'));
      await act(async () => first.resolve({ status: 'stale' }));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    } finally {
      first.resolve({ status: 'stale' });
      await view.unmount();
    }
  });

  it.each(['storage', 'source'] as const)(
    'does not continue empty pages or late refresh callbacks while %s access is unavailable',
    async (blockedBy) => {
      appQueryClient.clear();
      const pending = Promise.withResolvers<NotificationPage>();
      const listPage = jest.fn<NotificationRouteRuntimeValue['gateway']['listPage']>(async () => pending.promise);
      const gateway = {
        getCategories: jest.fn(async () => [{ id: 'replies', label: '回复' }]),
        listPage
      } as unknown as NotificationRouteRuntimeValue['gateway'];
      const runtime = routeRuntime(gateway);
      const tree = (value = runtime) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: { source: 'nodeseek' } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
      const view = await render(tree(), { wrapper: QueryTestWrapper });
      try {
        await waitFor(() => expect(listPage).toHaveBeenCalledTimes(1));
        const lateRefresh = view.getByTestId('notification-list-refresh').props.onPress;
        await view.rerender(
          tree({ ...runtime, ...(blockedBy === 'storage' ? { ready: false } : { activeSources: [] }) })
        );
        await act(async () => {
          pending.resolve({ quality: 'complete', items: [], cursor: 'next', hasMore: true });
        });
        await act(async () => {
          lateRefresh();
        });
        expect(listPage).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => pending.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false }));
        await view.unmount();
      }
    }
  );

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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: { source: 'yaohuo' } }}
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
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

  it.each([true, false])(
    'keeps an unknown account distinct from a guest when another site is readable: %s',
    async (readable) => {
      appQueryClient.clear();
      const listAllPage = jest.fn(async () => ({
        items: [notification],
        errors: {},
        qualities: {},
        nextCursors: { nodeseek: null },
        hasMore: false
      }));
      const gateway = { listAllPage, listPage: jest.fn() } as unknown as NotificationRouteRuntimeValue['gateway'];
      const runtime = routeRuntime(gateway);
      const states = createSiteSessionStates();
      for (const site of ['nodeseek', 'linuxdo'] as const) {
        states[site] = {
          ...states[site],
          status: 'logged-in',
          currentUser: { ...testAccountUser(site), id: 'new-account' }
        };
      }
      runtime.sessions = projectTestAccountSessions(states);
      runtime.sessions.linuxdo.identityTrust = 'unknown';
      if (!readable) {
        runtime.activeSources = [];
        runtime.enabledNotificationSources = ['linuxdo', 'yaohuo'];
      }
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      if (readable) {
        expect(await view.findByText(notification.title)).toBeTruthy();
        expect(listAllPage).toHaveBeenCalledWith(expect.objectContaining({ sources: ['nodeseek'] }));
      } else expect(listAllPage).not.toHaveBeenCalled();
      expect(view.queryByRole('button', { name: '去登录 linux.do' })).toBeNull();
      await fireEvent.press(view.getByRole('button', { name: '重试账号核对 linux.do' }));
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledTimes(1);
      expect(runtime.reconcileAccountStatus).toHaveBeenCalledWith('linuxdo');
      expect(runtime.openAccountSurface).not.toHaveBeenCalled();
      expect(gateway.listPage).not.toHaveBeenCalled();
      await fireEvent.press(view.getByRole('button', { name: '去登录 妖火' }));
      expect(runtime.openAccountSurface).toHaveBeenCalledWith('yaohuo', '请登录并确认账号身份。');
    }
  );

  it.each([false, true])(
    'loads newly confirmed sources into the same active aggregate during refetch %s',
    async (refetching) => {
      appQueryClient.clear();
      const check = Promise.withResolvers<AccountReconcileResult>();
      const release = Promise.withResolvers<void>();
      let hold = false;
      const listAllPage = jest.fn(async () => {
        if (hold) await release.promise;
        return {
          items: [notification],
          errors: {},
          qualities: {},
          nextCursors: { nodeseek: null },
          hasMore: false
        };
      });
      const listPage = jest.fn(async (source: 'linuxdo' | 'yaohuo') => ({
        quality: 'complete',
        items: [{ ...notification, source, id: source, title: source + ' 新消息' }],
        cursor: null,
        hasMore: false
      }));
      const runtime = routeRuntime({ listAllPage, listPage } as unknown as NotificationRouteRuntimeValue['gateway']);
      runtime.identityKeys.linuxdo = 'linuxdo:alice';
      runtime.identityKeys.yaohuo = 'yaohuo:7';
      runtime.sessions.linuxdo = { ...runtime.sessions.linuxdo, identityTrust: 'unknown' };
      runtime.sessions.yaohuo = { ...runtime.sessions.yaohuo, identityTrust: 'unknown' };
      runtime.reconcileAccountStatus = jest.fn(() => check.promise);
      const tree = (value: NotificationRouteRuntimeValue) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
      const view = await render(tree(runtime), { wrapper: QueryTestWrapper });
      expect(await view.findByText(notification.title)).toBeTruthy();
      let refresh: Promise<void> | undefined;
      if (refetching) {
        hold = true;
        await act(async () => {
          refresh = appQueryClient.refetchQueries({
            queryKey: forumQueryKeys.notificationList({
              source: 'all',
              identityKey: runtime.identitySignature,
              unreadOnly: false
            }),
            exact: true
          });
        });
        expect(listAllPage).toHaveBeenCalledTimes(2);
      }
      await fireEvent.press(view.getByRole('button', { name: '重试账号核对 linux.do' }));
      await act(async () => {
        check.resolve({ status: 'same', session: createSiteSessionStates().linuxdo });
      });
      await fireEvent.press(view.getByRole('button', { name: '重试账号核对 妖火' }));
      await view.rerender(
        tree({
          ...runtime,
          activeSources: ['nodeseek', 'linuxdo', 'yaohuo'],
          sessions: {
            ...runtime.sessions,
            linuxdo: { ...runtime.sessions.linuxdo, identityTrust: 'confirmed' },
            yaohuo: { ...runtime.sessions.yaohuo, identityTrust: 'confirmed' }
          }
        })
      );
      await act(async () => {
        release.resolve();
        await refresh;
      });
      expect(await view.findByText('linuxdo 新消息')).toBeTruthy();
      expect(await view.findByText('yaohuo 新消息')).toBeTruthy();
      expect(listPage).toHaveBeenCalledTimes(2);
      expect(listAllPage).toHaveBeenCalledTimes(refetching ? 2 : 1);
      expect(view.getByText(notification.title)).toBeTruthy();
    }
  );

  it.each([
    'first-commits-first',
    'second-commits-during-check',
    'all-commit-together',
    'all-commit-after-checks'
  ] as const)(
    'loads every newly confirmed source across an all-source unknown retry when commits arrive as %s',
    async (mode) => {
      appQueryClient.clear();
      const identities: Record<NotificationSource, string> = {
        nodeseek: 'nodeseek:1',
        linuxdo: 'linuxdo:2',
        yaohuo: 'yaohuo:3'
      };
      const releaseAggregate = Promise.withResolvers<void>();
      let holdAggregate = true;
      const adapterCalls: NotificationSource[] = [];
      const makeAdapter = (source: NotificationSource): NotificationAdapter =>
        ({
          listPage: jest.fn(async () => {
            adapterCalls.push(source);
            if (holdAggregate) await releaseAggregate.promise;
            return {
              quality: 'complete' as const,
              items: [{ ...notification, source, id: `${source}-1`, title: `${source} 本轮消息` }],
              cursor: `${source}-2`,
              hasMore: true
            };
          })
        }) as unknown as NotificationAdapter;
      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: makeAdapter('nodeseek'),
          linuxdo: makeAdapter('linuxdo'),
          yaohuo: makeAdapter('yaohuo')
        },
        readAccess: (source) => ({
          identityKey: identities[source],
          userId: identities[source].split(':')[1]!
        }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const listAllPageSpy = jest.spyOn(gateway, 'listAllPage');
      const listPageSpy = jest.spyOn(gateway, 'listPage');

      let currentRuntime = routeRuntime(gateway);
      currentRuntime.activeSources = [];
      currentRuntime.identityKeys = { ...identities };
      currentRuntime.identitySignature = 'nodeseek|linuxdo|yaohuo:nodeseek:1|linuxdo:2|yaohuo:3';
      for (const site of notificationSources) {
        currentRuntime.sessions[site] = { ...currentRuntime.sessions[site], identityTrust: 'unknown' };
      }

      const tree = (value: NotificationRouteRuntimeValue) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );

      let view: Awaited<ReturnType<typeof render>> | undefined;
      const commitSources = async (sources: NotificationSource[]) => {
        const nextActive = notificationSources.filter(
          (site) => currentRuntime.activeSources.includes(site) || sources.includes(site)
        );
        const nextSessions = { ...currentRuntime.sessions };
        for (const site of sources) {
          nextSessions[site] = { ...nextSessions[site], isLoggedIn: true, identityTrust: 'confirmed' };
        }
        currentRuntime = { ...currentRuntime, activeSources: nextActive, sessions: nextSessions };
        await view!.rerender(tree(currentRuntime));
      };

      const reconcile = jest.fn<NotificationRouteRuntimeValue['reconcileAccountStatus']>(async (candidate) => {
        if (mode === 'all-commit-together') {
          await commitSources(['nodeseek', 'linuxdo', 'yaohuo']);
        } else if (mode === 'second-commits-during-check' && candidate === 'nodeseek') {
          await commitSources(['nodeseek']);
          await commitSources(['linuxdo']);
        } else if (mode !== 'all-commit-after-checks') {
          await commitSources([candidate]);
        }
        return { status: 'same', session: createSiteSessionStates()[candidate] };
      });
      currentRuntime.reconcileAccountStatus = reconcile;

      view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
      try {
        await fireEvent.press(view.getByText('重试账号核对'));
        if (mode === 'all-commit-after-checks') {
          await waitFor(() => expect(reconcile).toHaveBeenCalledTimes(3));
          expect(listAllPageSpy).not.toHaveBeenCalled();
          await commitSources(['nodeseek', 'linuxdo', 'yaohuo']);
        }
        await waitFor(() => expect(listAllPageSpy).toHaveBeenCalledTimes(1));
        if (mode === 'all-commit-together' || mode === 'all-commit-after-checks') {
          expect(listAllPageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ sources: ['nodeseek', 'linuxdo', 'yaohuo'] })
          );
        } else {
          expect(listAllPageSpy).toHaveBeenCalledWith(expect.objectContaining({ sources: ['nodeseek'] }));
        }
        expect(listPageSpy).not.toHaveBeenCalled();

        holdAggregate = false;
        await act(async () => {
          releaseAggregate.resolve();
        });

        expect(await view.findByText('nodeseek 本轮消息')).toBeTruthy();
        expect(await view.findByText('linuxdo 本轮消息')).toBeTruthy();
        expect(await view.findByText('yaohuo 本轮消息')).toBeTruthy();

        expect(listAllPageSpy).toHaveBeenCalledTimes(1);
        if (mode === 'all-commit-together' || mode === 'all-commit-after-checks') {
          expect(listPageSpy).not.toHaveBeenCalled();
          expect(reconcile).toHaveBeenCalledTimes(mode === 'all-commit-together' ? 1 : 3);
        } else {
          expect(listPageSpy).toHaveBeenCalledTimes(2);
          expect(listPageSpy.mock.calls.map(([site]) => site).sort()).toEqual(['linuxdo', 'yaohuo']);
          expect(reconcile.mock.calls.map(([site]) => site)).toEqual(
            mode === 'second-commits-during-check' ? ['nodeseek', 'yaohuo'] : ['nodeseek', 'linuxdo', 'yaohuo']
          );
        }
        expect(adapterCalls.sort()).toEqual(['linuxdo', 'nodeseek', 'yaohuo']);
      } finally {
        holdAggregate = false;
        releaseAggregate.resolve();
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it('retains loaded history pages and skips re-reading an empty site already covered by the aggregate retry', async () => {
    appQueryClient.clear();
    const identities: Record<NotificationSource, string> = {
      nodeseek: 'nodeseek:1',
      linuxdo: 'linuxdo:2',
      yaohuo: 'yaohuo:3'
    };
    const identitySignature = 'nodeseek|linuxdo|yaohuo:nodeseek:1|linuxdo:2|yaohuo:3';
    const listQueryKey = forumQueryKeys.notificationList({
      source: 'all',
      categoryId: null,
      identityKey: identitySignature,
      unreadOnly: false
    });
    appQueryClient.setQueryData(listQueryKey, {
      pages: [
        {
          items: [
            { ...notification, source: 'nodeseek', id: 'old-ns-1', title: '旧缓存 NS-1' },
            { ...notification, source: 'linuxdo', id: 'old-ld-1', title: '旧缓存 LD-1' }
          ],
          errors: {},
          hasMore: true,
          nextPage: { allCursors: { nodeseek: 'ns-old-2', linuxdo: 'ld-old-2', yaohuo: 'yh-old-2' } }
        },
        {
          items: [{ ...notification, source: 'nodeseek', id: 'old-ns-2', title: '旧缓存 NS-2' }],
          errors: {},
          hasMore: true,
          nextPage: { allCursors: { nodeseek: 'ns-old-3', linuxdo: null, yaohuo: null } }
        }
      ],
      pageParams: [{}, { allCursors: { nodeseek: 'ns-old-2', linuxdo: 'ld-old-2', yaohuo: 'yh-old-2' } }]
    });

    const adapterReads: Record<NotificationSource, (string | null | undefined)[]> = {
      nodeseek: [],
      linuxdo: [],
      yaohuo: []
    };
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            adapterReads.nodeseek.push(cursor);
            return cursor === 'ns-2'
              ? {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-p2', title: 'NodeSeek 历史页' }],
                  cursor: 'ns-3',
                  hasMore: true
                }
              : {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-p1', title: 'NodeSeek 首页' }],
                  cursor: 'ns-2',
                  hasMore: true
                };
          })
        } as unknown as NotificationAdapter,
        linuxdo: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            adapterReads.linuxdo.push(cursor);
            return { quality: 'complete' as const, items: [], cursor: null, hasMore: false };
          })
        } as unknown as NotificationAdapter,
        yaohuo: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            adapterReads.yaohuo.push(cursor);
            return {
              quality: 'complete' as const,
              items: [{ ...notification, source: 'yaohuo', id: 'yh-p1', title: '妖火 补读消息' }],
              cursor: 'yh-2',
              hasMore: true
            };
          })
        } as unknown as NotificationAdapter
      },
      readAccess: (source) => ({
        identityKey: identities[source],
        userId: identities[source].split(':')[1]!
      }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });
    const listAllPageSpy = jest.spyOn(gateway, 'listAllPage');
    const listPageSpy = jest.spyOn(gateway, 'listPage');

    let currentRuntime = routeRuntime(gateway);
    currentRuntime.activeSources = [];
    currentRuntime.identityKeys = { ...identities };
    currentRuntime.identitySignature = identitySignature;
    for (const site of notificationSources) {
      currentRuntime.sessions[site] = { ...currentRuntime.sessions[site], identityTrust: 'unknown' };
    }
    const tree = (value: NotificationRouteRuntimeValue) => (
      <NotificationRouteRuntimeProvider value={value}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );

    let view: Awaited<ReturnType<typeof render>> | undefined;
    const commitSources = async (sources: NotificationSource[]) => {
      const nextActive = notificationSources.filter(
        (site) => currentRuntime.activeSources.includes(site) || sources.includes(site)
      );
      const nextSessions = { ...currentRuntime.sessions };
      for (const site of sources) {
        nextSessions[site] = { ...nextSessions[site], isLoggedIn: true, identityTrust: 'confirmed' };
      }
      currentRuntime = { ...currentRuntime, activeSources: nextActive, sessions: nextSessions };
      await view!.rerender(tree(currentRuntime));
    };
    currentRuntime.reconcileAccountStatus = jest.fn<NotificationRouteRuntimeValue['reconcileAccountStatus']>(
      async (candidate) => {
        if (candidate === 'nodeseek') await commitSources(['nodeseek', 'linuxdo']);
        else await commitSources([candidate]);
        return { status: 'same', session: createSiteSessionStates()[candidate] };
      }
    );

    view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
    try {
      await fireEvent.press(view.getByText('重试账号核对'));
      expect(await view.findByText('NodeSeek 首页')).toBeTruthy();
      expect(await view.findByText('NodeSeek 历史页')).toBeTruthy();
      expect(await view.findByText('妖火 补读消息')).toBeTruthy();
      expect(view.queryByText('旧缓存 NS-1')).toBeNull();
      expect(view.queryByText('旧缓存 LD-1')).toBeNull();

      expect(adapterReads.linuxdo).toEqual([undefined]);
      expect(adapterReads.nodeseek).toEqual([undefined, 'ns-2']);
      expect(adapterReads.yaohuo).toEqual([undefined]);
      expect(listAllPageSpy).toHaveBeenCalledTimes(2);
      expect(listPageSpy).toHaveBeenCalledTimes(1);
      expect(listPageSpy).toHaveBeenCalledWith('yaohuo', expect.objectContaining({ cursor: undefined }));

      const cached = appQueryClient.getQueryData<{
        pages: { nextPage: { allCursors?: Partial<Record<NotificationSource, string | null>> } }[];
      }>(listQueryKey);
      expect(cached?.pages).toHaveLength(2);
      expect(cached?.pages[0]?.nextPage.allCursors).toEqual({
        nodeseek: 'ns-2',
        linuxdo: null,
        yaohuo: 'yh-2'
      });
      expect(cached?.pages[1]?.nextPage.allCursors).toEqual({
        nodeseek: 'ns-3',
        linuxdo: null,
        yaohuo: 'yh-2'
      });
    } finally {
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it.each(['blur', 'account-switch', 'filter-change'] as const)(
    'discards stale all-source retry and backfill results after %s',
    async (change) => {
      appQueryClient.clear();
      let linuxdoIdentity = 'linuxdo:userA';
      let linuxdoEpoch = 0;
      const pendingLinuxdoA = Promise.withResolvers<NotificationPage>();
      const linuxdoCalls: string[] = [];
      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: {
            listPage: jest.fn(async () => ({
              quality: 'complete' as const,
              items: [{ ...notification, source: 'nodeseek', id: 'ns-a', title: 'NodeSeek A 消息' }],
              cursor: null,
              hasMore: false
            }))
          } as unknown as NotificationAdapter,
          linuxdo: {
            listPage: jest.fn(async ({ identityKey }: NotificationAdapterAccess) => {
              linuxdoCalls.push(identityKey);
              if (identityKey === 'linuxdo:userA') return pendingLinuxdoA.promise;
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-b', title: 'linuxdo B 新账号消息' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          yaohuo: {
            listPage: jest.fn(async () => ({
              quality: 'complete' as const,
              items: [{ ...notification, source: 'yaohuo', id: 'yh-a', title: '妖火 A 消息' }],
              cursor: null,
              hasMore: false
            }))
          } as unknown as NotificationAdapter
        },
        readAccess: (source) =>
          source === 'linuxdo'
            ? { identityKey: linuxdoIdentity, userId: linuxdoIdentity.split(':')[1]! }
            : { identityKey: `${source}:userA`, userId: 'userA' },
        requestSessionEpoch: (source) => (source === 'linuxdo' ? linuxdoEpoch : 0),
        privateAccessAllowed: (source, id) => (source === 'linuxdo' ? id === linuxdoIdentity : true),
        sourceAllowed: () => true
      });

      const oldSignature = 'nodeseek|linuxdo|yaohuo:nodeseek:userA|linuxdo:userA|yaohuo:userA';
      const oldQueryKey = forumQueryKeys.notificationList({
        source: 'all',
        categoryId: null,
        identityKey: oldSignature,
        unreadOnly: false
      });
      let currentRuntime = routeRuntime(gateway);
      currentRuntime.activeSources = [];
      currentRuntime.identityKeys = {
        nodeseek: 'nodeseek:userA',
        linuxdo: 'linuxdo:userA',
        yaohuo: 'yaohuo:userA'
      };
      currentRuntime.identitySignature = oldSignature;
      for (const site of notificationSources) {
        currentRuntime.sessions[site] = { ...currentRuntime.sessions[site], identityTrust: 'unknown' };
      }

      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const tree = (value: NotificationRouteRuntimeValue) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName="notifications">
              <FocusTestStack.Screen name="notifications">
                {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Other">{() => <Text>其他页面</Text>}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );

      let view: Awaited<ReturnType<typeof render>> | undefined;
      const reconcile = jest.fn<NotificationRouteRuntimeValue['reconcileAccountStatus']>(async (candidate) => {
        const nextActive = notificationSources.filter(
          (site) => currentRuntime.activeSources.includes(site) || site === candidate
        );
        currentRuntime = {
          ...currentRuntime,
          activeSources: nextActive,
          sessions: {
            ...currentRuntime.sessions,
            [candidate]: { ...currentRuntime.sessions[candidate], isLoggedIn: true, identityTrust: 'confirmed' }
          }
        };
        await view!.rerender(tree(currentRuntime));
        return { status: 'same', session: createSiteSessionStates()[candidate] };
      });
      currentRuntime.reconcileAccountStatus = reconcile;

      view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
      try {
        await fireEvent.press(view.getByText('重试账号核对'));
        expect(await view.findByText('NodeSeek A 消息')).toBeTruthy();
        await waitFor(() => expect(linuxdoCalls).toEqual(['linuxdo:userA']));

        if (change === 'blur') {
          await act(async () => navigation.navigate('Other'));
        } else if (change === 'account-switch') {
          linuxdoIdentity = 'linuxdo:userB';
          linuxdoEpoch = 1;
          const nextSignature = 'nodeseek|linuxdo|yaohuo:nodeseek:userA|linuxdo:userB|yaohuo:userA';
          currentRuntime = {
            ...currentRuntime,
            identityKeys: { ...currentRuntime.identityKeys, linuxdo: 'linuxdo:userB' },
            identitySignature: nextSignature,
            sessionEpochs: { ...currentRuntime.sessionEpochs, linuxdo: 1 }
          };
          await view.rerender(tree(currentRuntime));
        } else {
          await fireEvent(view.getByTestId('notification-unread-switch'), 'valueChange', true);
        }

        await act(async () => {
          pendingLinuxdoA.resolve({
            quality: 'complete',
            items: [{ ...notification, source: 'linuxdo', id: 'ld-stale', title: '过期 linuxdo A 消息' }],
            cursor: 'ld-stale-2',
            hasMore: true
          });
        });

        const oldCached = appQueryClient.getQueryData<{ pages: { items: ForumNotification[] }[] }>(oldQueryKey);
        expect(oldCached?.pages.flatMap((page) => page.items).map((item) => item.id)).not.toContain('ld-stale');
        expect(view.queryByText('过期 linuxdo A 消息')).toBeNull();
        if (change === 'account-switch') {
          expect(await view.findByText('linuxdo B 新账号消息')).toBeTruthy();
        } else {
          expect(reconcile).not.toHaveBeenCalledWith('yaohuo');
        }
      } finally {
        pendingLinuxdoA.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it('coordinates pending aggregate source backfill with concurrent pagination without duplicating page zero or losing later pages', async () => {
    appQueryClient.clear();
    const identities: Record<NotificationSource, string> = {
      nodeseek: 'nodeseek:1',
      linuxdo: 'linuxdo:2',
      yaohuo: 'yaohuo:3'
    };
    const pendingLinuxdoPage0 = Promise.withResolvers<NotificationPage>();
    const linuxdoReads: (string | null | undefined)[] = [];
    let heldFirstLinuxdoPage0 = false;
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            if (cursor === 'ns-2') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'nodeseek', id: 'ns-2', title: 'NodeSeek 第 2 页' }],
                cursor: 'ns-3',
                hasMore: true
              };
            }
            if (cursor === 'ns-3') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'nodeseek', id: 'ns-3', title: 'NodeSeek 第 3 页' }],
                cursor: null,
                hasMore: false
              };
            }
            return {
              quality: 'complete' as const,
              items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 第 1 页' }],
              cursor: 'ns-2',
              hasMore: true
            };
          })
        } as unknown as NotificationAdapter,
        linuxdo: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            linuxdoReads.push(cursor);
            if (!cursor) {
              if (!heldFirstLinuxdoPage0) {
                heldFirstLinuxdoPage0 = true;
                return pendingLinuxdoPage0.promise;
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-1', title: 'linuxdo 第 1 页' }],
                cursor: 'ld-2',
                hasMore: true
              };
            }
            if (cursor === 'ld-2') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-2', title: 'linuxdo 第 2 页' }],
                cursor: 'ld-3',
                hasMore: true
              };
            }
            if (cursor === 'ld-3') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-3', title: 'linuxdo 第 3 页' }],
                cursor: null,
                hasMore: false
              };
            }
            return { quality: 'complete' as const, items: [], cursor: null, hasMore: false };
          })
        } as unknown as NotificationAdapter,
        yaohuo: {
          listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
        } as unknown as NotificationAdapter
      },
      readAccess: (source) => ({
        identityKey: identities[source],
        userId: identities[source].split(':')[1]!
      }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });

    const states = createSiteSessionStates();
    for (const site of ['nodeseek', 'linuxdo'] as const) {
      states[site] = {
        ...states[site],
        status: 'logged-in',
        currentUser: { ...testAccountUser(site), id: identities[site].split(':')[1]! }
      };
    }
    let currentRuntime = routeRuntime(gateway);
    currentRuntime.enabledNotificationSources = ['nodeseek', 'linuxdo'];
    currentRuntime.activeSources = ['nodeseek'];
    currentRuntime.identityKeys = { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo };
    currentRuntime.identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
    currentRuntime.sessions = projectTestAccountSessions(states);
    currentRuntime.sessions.linuxdo = { ...currentRuntime.sessions.linuxdo, identityTrust: 'unknown' };

    const tree = (value: NotificationRouteRuntimeValue) => (
      <NotificationRouteRuntimeProvider value={value}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );

    let view: Awaited<ReturnType<typeof render>> | undefined;
    currentRuntime.reconcileAccountStatus = jest.fn<NotificationRouteRuntimeValue['reconcileAccountStatus']>(
      async (candidate) => {
        if (candidate === 'linuxdo') {
          currentRuntime = {
            ...currentRuntime,
            activeSources: ['nodeseek', 'linuxdo'],
            sessions: {
              ...currentRuntime.sessions,
              linuxdo: { ...currentRuntime.sessions.linuxdo, isLoggedIn: true, identityTrust: 'confirmed' }
            }
          };
          await view!.rerender(tree(currentRuntime));
        }
        return { status: 'same', session: createSiteSessionStates()[candidate] };
      }
    );

    view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
    try {
      expect(await view.findByText('NodeSeek 第 1 页')).toBeTruthy();

      await fireEvent.press(view.getByRole('button', { name: '重试账号核对 linux.do' }));
      await waitFor(() => expect(linuxdoReads).toEqual([undefined]));

      // Advance pagination twice while linux.do page-0 backfill is still in-flight.
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('NodeSeek 第 2 页')).toBeTruthy();
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('NodeSeek 第 3 页')).toBeTruthy();

      expect(linuxdoReads.filter((cursor) => cursor === undefined)).toHaveLength(1);

      await act(async () => {
        pendingLinuxdoPage0.resolve({
          quality: 'complete',
          items: [{ ...notification, source: 'linuxdo', id: 'ld-1', title: 'linuxdo 第 1 页' }],
          cursor: 'ld-2',
          hasMore: true
        });
      });

      expect(await view.findByText('linuxdo 第 1 页')).toBeTruthy();
      expect(view.queryByText(/重复的消息分页/)).toBeNull();

      await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('linuxdo 第 2 页')).toBeTruthy();

      await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('linuxdo 第 3 页')).toBeTruthy();

      expect(linuxdoReads).toEqual([undefined, 'ld-2', 'ld-3']);
      expect(view.queryByText(/重复的消息分页/)).toBeNull();
    } finally {
      pendingLinuxdoPage0.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it('keeps aggregate backfill items and next cursor when backfill settles while pagination is in flight', async () => {
    appQueryClient.clear();
    const identities: Record<NotificationSource, string> = {
      nodeseek: 'nodeseek:1',
      linuxdo: 'linuxdo:2',
      yaohuo: 'yaohuo:3'
    };
    const pendingLinuxdoPage0 = Promise.withResolvers<NotificationPage>();
    const pendingNodeSeekPage2 = Promise.withResolvers<NotificationPage>();
    const linuxdoReads: (string | null | undefined)[] = [];
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            if (cursor === 'ns-2') return pendingNodeSeekPage2.promise;
            return {
              quality: 'complete' as const,
              items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 首页' }],
              cursor: 'ns-2',
              hasMore: true
            };
          })
        } as unknown as NotificationAdapter,
        linuxdo: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            linuxdoReads.push(cursor);
            if (!cursor) return pendingLinuxdoPage0.promise;
            if (cursor === 'ld-2') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-2', title: 'linuxdo 次页' }],
                cursor: 'ld-3',
                hasMore: true
              };
            }
            if (cursor === 'ld-3') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-3', title: 'linuxdo 末页' }],
                cursor: null,
                hasMore: false
              };
            }
            return { quality: 'complete' as const, items: [], cursor: null, hasMore: false };
          })
        } as unknown as NotificationAdapter,
        yaohuo: {
          listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
        } as unknown as NotificationAdapter
      },
      readAccess: (source) => ({
        identityKey: identities[source],
        userId: identities[source].split(':')[1]!
      }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });

    const states = createSiteSessionStates();
    for (const site of ['nodeseek', 'linuxdo'] as const) {
      states[site] = {
        ...states[site],
        status: 'logged-in',
        currentUser: { ...testAccountUser(site), id: identities[site].split(':')[1]! }
      };
    }
    let currentRuntime = routeRuntime(gateway);
    currentRuntime.enabledNotificationSources = ['nodeseek', 'linuxdo'];
    currentRuntime.activeSources = ['nodeseek'];
    currentRuntime.identityKeys = { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo };
    currentRuntime.identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
    currentRuntime.sessions = projectTestAccountSessions(states);
    currentRuntime.sessions.linuxdo = { ...currentRuntime.sessions.linuxdo, identityTrust: 'unknown' };

    const tree = (value: NotificationRouteRuntimeValue) => (
      <NotificationRouteRuntimeProvider value={value}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );

    let view: Awaited<ReturnType<typeof render>> | undefined;
    currentRuntime.reconcileAccountStatus = jest.fn<NotificationRouteRuntimeValue['reconcileAccountStatus']>(
      async (candidate) => {
        if (candidate === 'linuxdo') {
          currentRuntime = {
            ...currentRuntime,
            activeSources: ['nodeseek', 'linuxdo'],
            sessions: {
              ...currentRuntime.sessions,
              linuxdo: { ...currentRuntime.sessions.linuxdo, isLoggedIn: true, identityTrust: 'confirmed' }
            }
          };
          await view!.rerender(tree(currentRuntime));
        }
        return { status: 'same', session: createSiteSessionStates()[candidate] };
      }
    );

    view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
    try {
      expect(await view.findByText('NodeSeek 首页')).toBeTruthy();

      await fireEvent.press(view.getByRole('button', { name: '重试账号核对 linux.do' }));
      await waitFor(() => expect(linuxdoReads).toEqual([undefined]));

      // Start pagination while backfill is pending, then finish backfill BEFORE pagination finishes.
      await fireEvent.press(view.getByTestId('notification-list-end'));
      await act(async () => {
        pendingLinuxdoPage0.resolve({
          quality: 'complete',
          items: [{ ...notification, source: 'linuxdo', id: 'ld-1', title: 'linuxdo 首页' }],
          cursor: 'ld-2',
          hasMore: true
        });
      });
      await act(async () => {
        pendingNodeSeekPage2.resolve({
          quality: 'complete',
          items: [{ ...notification, source: 'nodeseek', id: 'ns-2', title: 'NodeSeek 末页' }],
          cursor: null,
          hasMore: false
        });
      });

      expect(await view.findByText('NodeSeek 末页')).toBeTruthy();
      expect(await view.findByText('linuxdo 首页')).toBeTruthy();

      await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('linuxdo 次页')).toBeTruthy();

      await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('linuxdo 末页')).toBeTruthy();

      expect(linuxdoReads).toEqual([undefined, 'ld-2', 'ld-3']);
    } finally {
      pendingLinuxdoPage0.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
      pendingNodeSeekPage2.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it('never rewinds an already-advanced aggregate tail cursor when a page-zero source retry settles late', async () => {
    appQueryClient.clear();
    const identities: Record<NotificationSource, string> = {
      nodeseek: 'nodeseek:1',
      linuxdo: 'linuxdo:2',
      yaohuo: 'yaohuo:3'
    };
    const identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
    const listQueryKey = forumQueryKeys.notificationList({
      source: 'all',
      categoryId: null,
      identityKey: identitySignature,
      unreadOnly: false
    });
    const linuxdoReads: (string | null | undefined)[] = [];
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: {
          listPage: jest.fn(async () => ({
            quality: 'complete' as const,
            items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 首页' }],
            cursor: 'ns-2',
            hasMore: true
          }))
        } as unknown as NotificationAdapter,
        linuxdo: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            linuxdoReads.push(cursor);
            if (!cursor) {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-1', title: 'linuxdo 第 1 页' }],
                cursor: 'ld-2',
                hasMore: true
              };
            }
            if (cursor === 'ld-3') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-3', title: 'linuxdo 第 3 页' }],
                cursor: null,
                hasMore: false
              };
            }
            return { quality: 'complete' as const, items: [], cursor: null, hasMore: false };
          })
        } as unknown as NotificationAdapter,
        yaohuo: {
          listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
        } as unknown as NotificationAdapter
      },
      readAccess: (source) => ({
        identityKey: identities[source],
        userId: identities[source].split(':')[1]!
      }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });

    const runtime = routeRuntime(gateway);
    runtime.enabledNotificationSources = ['nodeseek', 'linuxdo'];
    runtime.activeSources = ['nodeseek', 'linuxdo'];
    runtime.identityKeys = { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo };
    runtime.identitySignature = identitySignature;

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      expect(await view.findByText('NodeSeek 首页')).toBeTruthy();
      linuxdoReads.length = 0;

      // Simulate page 0 needing retry while pages 1-2 already advanced linux.do from page 2 (ld-2) to page 3 (ld-3).
      await act(async () => {
        appQueryClient.setQueryData(listQueryKey, {
          pages: [
            {
              items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 首页' }],
              errors: { linuxdo: { kind: 'ordinary', message: '暂不可用' } },
              hasMore: true,
              nextPage: { allCursors: { nodeseek: 'ns-2', linuxdo: null } }
            },
            {
              items: [{ ...notification, source: 'linuxdo', id: 'ld-1-dup', title: 'linuxdo 已拉取页 1' }],
              errors: {},
              hasMore: true,
              nextPage: { allCursors: { nodeseek: 'ns-3', linuxdo: 'ld-2' } }
            },
            {
              items: [{ ...notification, source: 'linuxdo', id: 'ld-2', title: 'linuxdo 第 2 页' }],
              errors: {},
              hasMore: true,
              nextPage: { allCursors: { nodeseek: null, linuxdo: 'ld-3' } }
            }
          ],
          pageParams: [{}, { allCursors: { nodeseek: 'ns-2' } }, { allCursors: { nodeseek: 'ns-3', linuxdo: 'ld-2' } }]
        });
      });

      await fireEvent.press(await view.findByRole('button', { name: '重试 linux.do' }));
      expect(await view.findByText('linuxdo 第 1 页')).toBeTruthy();
      expect(view.queryByText(/重复的消息分页/)).toBeNull();

      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('linuxdo 第 3 页')).toBeTruthy();
      expect(linuxdoReads).toEqual([undefined, 'ld-3']);
    } finally {
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it('binds account status retry callbacks to their originating source filter and ignores stale callbacks after switching', async () => {
    appQueryClient.clear();
    const identities: Record<NotificationSource, string> = {
      nodeseek: 'nodeseek:1',
      linuxdo: 'linuxdo:2',
      yaohuo: 'yaohuo:3'
    };
    const makeAdapter = (source: NotificationSource): NotificationAdapter =>
      ({
        getCategories: jest.fn(async () => [{ id: 'all', label: '全部' }]),
        listPage: jest.fn(async () => ({
          quality: 'complete' as const,
          items: [{ ...notification, source, id: `${source}-1`, title: `${source} 恢复消息` }],
          cursor: null,
          hasMore: false
        }))
      }) as unknown as NotificationAdapter;
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: makeAdapter('nodeseek'),
        linuxdo: makeAdapter('linuxdo'),
        yaohuo: makeAdapter('yaohuo')
      },
      readAccess: (source) => ({
        identityKey: identities[source],
        userId: identities[source].split(':')[1]!
      }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });
    const listAllPageSpy = jest.spyOn(gateway, 'listAllPage');
    const listPageSpy = jest.spyOn(gateway, 'listPage');

    let currentRuntime = routeRuntime(gateway);
    currentRuntime.activeSources = [];
    currentRuntime.identityKeys = { ...identities };
    currentRuntime.identitySignature = 'nodeseek|linuxdo|yaohuo:nodeseek:1|linuxdo:2|yaohuo:3';
    for (const site of notificationSources) {
      currentRuntime.sessions[site] = { ...currentRuntime.sessions[site], identityTrust: 'unknown' };
    }

    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const tree = (value: NotificationRouteRuntimeValue) => (
      <NotificationRouteRuntimeProvider value={value}>
        <NavigationContainer ref={navigation}>
          <FocusTestStack.Navigator initialRouteName="notifications">
            <FocusTestStack.Screen name="notifications" initialParams={{ source: 'nodeseek' }}>
              {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
            </FocusTestStack.Screen>
          </FocusTestStack.Navigator>
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );

    let view: Awaited<ReturnType<typeof render>> | undefined;
    const reconcile = jest.fn<NotificationRouteRuntimeValue['reconcileAccountStatus']>(async (candidate) => {
      const nextActive = notificationSources.filter(
        (site) => currentRuntime.activeSources.includes(site) || site === candidate
      );
      currentRuntime = {
        ...currentRuntime,
        activeSources: nextActive,
        sessions: {
          ...currentRuntime.sessions,
          [candidate]: { ...currentRuntime.sessions[candidate], isLoggedIn: true, identityTrust: 'confirmed' }
        }
      };
      await view!.rerender(tree(currentRuntime));
      return { status: 'same', session: createSiteSessionStates()[candidate] };
    });
    currentRuntime.reconcileAccountStatus = reconcile;

    view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
    try {
      expect(view.getByText('账号状态暂不可确认')).toBeTruthy();
      expect(mockListNavigationProps.source).toBe('nodeseek');
      const staleNodeSeekRetry = mockListNavigationProps.onRetryAccountStatus;

      // Switch from NodeSeek single-site view to the aggregate "全部" view, then invoke the stale callback.
      await fireEvent.press(view.getByTestId('notification-source-all'));
      await waitFor(() => expect(mockListNavigationProps.source).toBe('all'));

      await act(async () => {
        await staleNodeSeekRetry();
      });

      expect(reconcile).not.toHaveBeenCalled();
      expect(listAllPageSpy).not.toHaveBeenCalled();
      expect(listPageSpy).not.toHaveBeenCalled();

      // The fresh "全部" retry button still recovers every unknown site one by one.
      await fireEvent.press(view.getByRole('button', { name: '重试账号核对' }));
      expect(await view.findByText('nodeseek 恢复消息')).toBeTruthy();
      expect(await view.findByText('linuxdo 恢复消息')).toBeTruthy();
      expect(await view.findByText('yaohuo 恢复消息')).toBeTruthy();
      expect(reconcile.mock.calls.map(([site]) => site)).toEqual(['nodeseek', 'linuxdo', 'yaohuo']);
    } finally {
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it.each<['retry-first' | 'refresh-first', 'success' | 'failure', 'pull-to-refresh' | 'refetch']>([
    ['retry-first', 'success', 'pull-to-refresh'],
    ['refresh-first', 'success', 'pull-to-refresh'],
    ['retry-first', 'failure', 'pull-to-refresh'],
    ['refresh-first', 'failure', 'pull-to-refresh'],
    ['retry-first', 'success', 'refetch'],
    ['refresh-first', 'failure', 'refetch']
  ])(
    'prevents a stale single-site page-zero retry (%s, %s, via %s) from overwriting a newer refresh or attaching errors',
    async (order, outcome, trigger) => {
      appQueryClient.clear();
      const identityKey = 'linuxdo:7';
      const listQueryKey = forumQueryKeys.notificationList({
        source: 'linuxdo',
        categoryId: 'all',
        identityKey,
        unreadOnly: false
      });
      const pendingOldRetry = Promise.withResolvers<NotificationPage>();
      const pendingRefresh = Promise.withResolvers<NotificationPage>();
      const page0Attempts: number[] = [];
      const nextCursorsRequested: (string | null | undefined)[] = [];
      let page0Calls = 0;

      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          linuxdo: {
            ...notificationAdapters.linuxdo,
            getCategories: jest.fn(async () => [{ id: 'all', label: '所有通知' }]),
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              if (!cursor) {
                page0Calls += 1;
                page0Attempts.push(page0Calls);
                if (page0Calls === 1) throw new Error('首页加载失败');
                if (page0Calls === 2) return pendingOldRetry.promise;
                return pendingRefresh.promise;
              }
              nextCursorsRequested.push(cursor);
              if (cursor === '30') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'linuxdo', id: 'ld-fresh-p2', title: '新刷新下一页消息' }],
                  cursor: null,
                  hasMore: false
                };
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-stale-p2', title: '旧重试下一页消息' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter
        },
        privateAccessAllowed: () => true,
        sourceAllowed: () => true,
        readAccess: () => ({ identityKey, userId: '7' })
      });

      const runtime = routeRuntime(gateway);
      runtime.enabledNotificationSources = ['linuxdo'];
      runtime.activeSources = ['linuxdo'];
      runtime.identityKeys = { linuxdo: identityKey };
      runtime.identitySignature = `linuxdo:${identityKey}`;

      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: { source: 'linuxdo' } }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );

      let refetchPromise: Promise<void> | undefined;
      try {
        expect(await view.findByRole('button', { name: '重试 linux.do' })).toBeTruthy();

        await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
        await waitFor(() => expect(page0Attempts).toEqual([1, 2]));

        if (trigger === 'pull-to-refresh') {
          await fireEvent.press(view.getByTestId('notification-list-refresh'));
        } else {
          await act(async () => {
            refetchPromise = appQueryClient.refetchQueries({ queryKey: listQueryKey, exact: true });
          });
        }
        await waitFor(() => expect(page0Attempts).toEqual([1, 2, 3]));

        const settleOldRetry = async () => {
          await act(async () => {
            if (outcome === 'success') {
              pendingOldRetry.resolve({
                quality: 'complete',
                items: [{ ...notification, source: 'linuxdo', id: 'ld-old-retry', title: '旧重试消息' }],
                cursor: '15',
                hasMore: true
              });
            } else {
              pendingOldRetry.reject(new Error('旧重试失败'));
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
        };
        const settleRefresh = async () => {
          await act(async () => {
            pendingRefresh.resolve({
              quality: 'complete',
              items: [{ ...notification, source: 'linuxdo', id: 'ld-fresh-refresh', title: '新刷新消息' }],
              cursor: '30',
              hasMore: true
            });
            await refetchPromise;
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
        };

        if (order === 'retry-first') {
          await settleOldRetry();
          await settleRefresh();
        } else {
          await settleRefresh();
          expect(await view.findByText('新刷新消息')).toBeTruthy();
          await settleOldRetry();
        }

        expect(await view.findByText('新刷新消息')).toBeTruthy();
        expect(view.queryByText('旧重试消息')).toBeNull();
        expect(view.queryByText(/旧重试失败|首页加载失败/)).toBeNull();
        expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull();

        await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
        await fireEvent.press(view.getByTestId('notification-list-end'));
        expect(await view.findByText('新刷新下一页消息')).toBeTruthy();
        expect(nextCursorsRequested).toEqual(['30']);
      } finally {
        pendingOldRetry.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        pendingRefresh.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        await refetchPromise?.catch(() => undefined);
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it.each<['retry-first' | 'refresh-first', 'success' | 'failure']>([
    ['retry-first', 'success'],
    ['refresh-first', 'success'],
    ['retry-first', 'failure'],
    ['refresh-first', 'failure']
  ])(
    'prevents a stale aggregate page-two retry (%s, %s) from overwriting a newer pull-to-refresh or re-attaching errors',
    async (order, outcome) => {
      appQueryClient.clear();
      const identities: Record<NotificationSource, string> = {
        nodeseek: 'nodeseek:1',
        linuxdo: 'linuxdo:2',
        yaohuo: 'yaohuo:3'
      };
      const identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
      const listQueryKey = forumQueryKeys.notificationList({
        source: 'all',
        categoryId: null,
        identityKey: identitySignature,
        unreadOnly: false
      });
      const pendingOldRetry = Promise.withResolvers<NotificationPage>();
      const pendingRefreshPage2 = Promise.withResolvers<NotificationPage>();
      let refreshStarted = false;
      let ldPage2FailedOnce = false;
      let oldRetryStarted = false;
      let refreshPage2Started = false;
      const linuxdoCursors: (string | null | undefined)[] = [];

      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              if (!cursor) {
                return refreshStarted
                  ? {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'nodeseek', id: 'ns-r1', title: 'NodeSeek 刷新第 1 页' }],
                      cursor: 'ns-r2',
                      hasMore: true
                    }
                  : {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 第 1 页' }],
                      cursor: 'ns-2',
                      hasMore: true
                    };
              }
              if (cursor === 'ns-2') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-2', title: 'NodeSeek 第 2 页' }],
                  cursor: 'ns-3',
                  hasMore: true
                };
              }
              if (cursor === 'ns-3') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-3', title: 'NodeSeek 第 3 页' }],
                  cursor: null,
                  hasMore: false
                };
              }
              if (cursor === 'ns-r2') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-r2', title: 'NodeSeek 刷新第 2 页' }],
                  cursor: 'ns-r3',
                  hasMore: true
                };
              }
              if (cursor === 'ns-r3') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-r3', title: 'NodeSeek 刷新第 3 页' }],
                  cursor: null,
                  hasMore: false
                };
              }
              return { quality: 'complete' as const, items: [], cursor: null, hasMore: false };
            })
          } as unknown as NotificationAdapter,
          linuxdo: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              linuxdoCursors.push(cursor);
              if (!cursor) {
                return refreshStarted
                  ? {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'linuxdo', id: 'ld-r1', title: 'linuxdo 刷新第 1 页' }],
                      cursor: 'ld-r2',
                      hasMore: true
                    }
                  : {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'linuxdo', id: 'ld-1', title: 'linuxdo 第 1 页' }],
                      cursor: 'ld-2',
                      hasMore: true
                    };
              }
              if (cursor === 'ld-2') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'linuxdo', id: 'ld-2', title: 'linuxdo 第 2 页' }],
                  cursor: 'ld-3',
                  hasMore: true
                };
              }
              if (cursor === 'ld-3') {
                if (!ldPage2FailedOnce) {
                  ldPage2FailedOnce = true;
                  throw new Error('第3页加载失败');
                }
                oldRetryStarted = true;
                return pendingOldRetry.promise;
              }
              if (cursor === 'ld-r2') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'linuxdo', id: 'ld-r2', title: 'linuxdo 刷新第 2 页' }],
                  cursor: 'ld-r3',
                  hasMore: true
                };
              }
              if (cursor === 'ld-r3') {
                refreshPage2Started = true;
                return pendingRefreshPage2.promise;
              }
              if (cursor === 'ld-r4') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'linuxdo', id: 'ld-r4', title: 'linuxdo 刷新第 4 页' }],
                  cursor: null,
                  hasMore: false
                };
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-old-4', title: 'linuxdo 旧第 4 页' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          yaohuo: {
            listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
          } as unknown as NotificationAdapter
        },
        readAccess: (source) => ({
          identityKey: identities[source],
          userId: identities[source].split(':')[1]!
        }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });

      const runtime = routeRuntime(gateway);
      runtime.enabledNotificationSources = ['nodeseek', 'linuxdo'];
      runtime.activeSources = ['nodeseek', 'linuxdo'];
      runtime.identityKeys = { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo };
      runtime.identitySignature = identitySignature;

      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );

      try {
        expect(await view.findByText('linuxdo 第 1 页')).toBeTruthy();

        await fireEvent.press(view.getByTestId('notification-list-end'));
        expect(await view.findByText('linuxdo 第 2 页')).toBeTruthy();

        await fireEvent.press(view.getByTestId('notification-list-end'));
        expect(await view.findByText('NodeSeek 第 3 页')).toBeTruthy();
        expect(await view.findByRole('button', { name: '重试 linux.do' })).toBeTruthy();

        await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
        await waitFor(() => expect(oldRetryStarted).toBe(true));

        refreshStarted = true;
        await fireEvent.press(view.getByTestId('notification-list-refresh'));
        await waitFor(() => expect(refreshPage2Started).toBe(true));

        const settleOldRetry = async () => {
          await act(async () => {
            if (outcome === 'success') {
              pendingOldRetry.resolve({
                quality: 'complete',
                items: [{ ...notification, source: 'linuxdo', id: 'ld-old-3', title: 'linuxdo 旧第 3 页重试消息' }],
                cursor: 'ld-old-4',
                hasMore: true
              });
            } else {
              pendingOldRetry.reject(new Error('旧第3页重试失败'));
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
        };
        const settleRefresh = async () => {
          await act(async () => {
            pendingRefreshPage2.resolve({
              quality: 'complete',
              items: [{ ...notification, source: 'linuxdo', id: 'ld-r3', title: 'linuxdo 刷新第 3 页' }],
              cursor: 'ld-r4',
              hasMore: true
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
        };

        if (order === 'retry-first') {
          await settleOldRetry();
          await settleRefresh();
        } else {
          await settleRefresh();
          expect(await view.findByText('linuxdo 刷新第 3 页')).toBeTruthy();
          await settleOldRetry();
        }

        expect(await view.findByText('linuxdo 刷新第 3 页')).toBeTruthy();
        expect(view.queryByText('linuxdo 旧第 3 页重试消息')).toBeNull();
        expect(view.queryByText(/旧第3页重试失败|第3页加载失败/)).toBeNull();
        expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull();

        const cached = appQueryClient.getQueryData<{
          pages: {
            errors: Partial<Record<NotificationSource, unknown>>;
            nextPage: { allCursors?: Partial<Record<NotificationSource, string | null>> };
          }[];
        }>(listQueryKey);
        expect(cached?.pages[2]?.errors.linuxdo).toBeUndefined();
        expect(cached?.pages[2]?.nextPage.allCursors?.linuxdo).toBe('ld-r4');

        await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
        await fireEvent.press(view.getByTestId('notification-list-end'));
        expect(await view.findByText('linuxdo 刷新第 4 页')).toBeTruthy();
        expect(linuxdoCursors).not.toContain('ld-old-4');
        expect(linuxdoCursors.at(-1)).toBe('ld-r4');
      } finally {
        pendingOldRetry.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        pendingRefreshPage2.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it('keeps the first partial page visible when a source retry is also partial', async () => {
    appQueryClient.clear();
    const identities = { linuxdo: 'linuxdo:42', nodeseek: 'nodeseek:44' };
    const partialPage = (id: string): NotificationPage => ({
      items: [{ ...notification, source: 'linuxdo', id, title: id }],
      cursor: 'ld:2',
      hasMore: true,
      quality: 'partial'
    });
    const linuxdo = jest
      .fn<NotificationAdapter['listPage']>()
      .mockResolvedValueOnce(partialPage('第一次有效消息'))
      .mockResolvedValueOnce(partialPage('重试新消息'));
    const nodeseek = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => ({
      items: [{ ...notification, id: cursor ?? 'ns:1', title: cursor ? 'NodeSeek 续页' : 'NodeSeek 首屏' }],
      cursor: cursor ? null : 'ns:2',
      hasMore: !cursor,
      quality: 'complete'
    }));
    const gateway = createNotificationGateway({
      adapters: {
        ...notificationAdapters,
        linuxdo: { ...notificationAdapters.linuxdo, listPage: linuxdo },
        nodeseek: { ...notificationAdapters.nodeseek, listPage: nodeseek }
      },
      readAccess: (source) => {
        const userId = source === 'linuxdo' ? '42' : '44';
        return { identityKey: `${source}:${userId}`, userId };
      },
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });
    const runtime = routeRuntime(gateway);
    runtime.enabledNotificationSources = runtime.activeSources = ['linuxdo', 'nodeseek'];
    runtime.identityKeys = identities;
    runtime.identitySignature = 'linuxdo:42|nodeseek:44';
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );
    try {
      await view.findByText('第一次有效消息');
      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
      await view.findByText('重试新消息');
      expect(view.getByText('第一次有效消息')).toBeTruthy();
      expect(view.getByRole('button', { name: '重试 linux.do' })).toBeTruthy();

      await fireEvent.press(view.getByTestId('notification-list-end'));
      await view.findByText('NodeSeek 续页');
      expect(linuxdo.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, undefined]);
      expect(nodeseek.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, 'ns:2']);
    } finally {
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it.each([
    { retryNext: '54', continuedAt: '54', refreshPartial: false },
    { retryNext: '60', continuedAt: '90', refreshPartial: false },
    { retryNext: null, continuedAt: null, refreshPartial: false },
    { retryNext: '60', continuedAt: '90', refreshPartial: true }
  ])(
    'keeps successful refresh pages and repairs a failed source with retry cursor $retryNext (partial refresh: $refreshPartial)',
    async ({ retryNext, continuedAt, refreshPartial }) => {
      appQueryClient.clear();
      const identities = { linuxdo: 'linuxdo:42', yaohuo: 'yaohuo:43', nodeseek: 'nodeseek:44' };
      const page = (
        source: NotificationSource,
        id: string,
        cursor: string | null,
        quality: NotificationPage['quality'] = 'complete'
      ): NotificationPage => ({
        items: [{ ...notification, source, id, title: id }],
        cursor,
        hasMore: cursor !== null,
        quality
      });
      let phase: 'initial' | 'refresh' | 'partial' | 'complete' = 'initial';
      const linuxdo = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => {
        if (phase === 'initial') {
          if (!cursor) return page('linuxdo', 'linuxdo 旧首页', '30');
          if (cursor === '30') return page('linuxdo', 'linuxdo 旧第 2 页', '60');
          if (cursor === '60') return page('linuxdo', 'linuxdo 旧第 3 页', '90');
        }
        if (phase === 'refresh' && !cursor) return page('linuxdo', 'linuxdo 新首页', '24');
        if (phase === 'refresh' && cursor === '24' && refreshPartial)
          return page('linuxdo', 'linuxdo 刷新部分有效消息', '54', 'partial');
        if (phase === 'partial' && cursor === '24') return page('linuxdo', 'linuxdo 部分有效消息', '54', 'partial');
        if (phase === 'complete' && cursor === '24') return page('linuxdo', 'linuxdo 恢复第 2 页', retryNext);
        if (phase === 'complete' && cursor === continuedAt) return page('linuxdo', 'linuxdo 恢复续页', null);
        throw new Error('linuxdo 消息读取失败');
      });
      const yaohuo = jest.fn<NotificationAdapter['listPage']>(async ({ cursor }) => {
        const index = Number(cursor || '1');
        const cycle = phase === 'initial' ? '初始' : '刷新';
        return page('yaohuo', `妖火 ${cycle}第 ${index} 页`, index < 5 ? String(index + 1) : null);
      });
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          linuxdo: { ...notificationAdapters.linuxdo, listPage: linuxdo },
          yaohuo: { ...notificationAdapters.yaohuo, listPage: yaohuo }
        },
        readAccess: (source) => ({ identityKey: identities[source], userId: identities[source].split(':')[1]! }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const runtime = routeRuntime(gateway);
      runtime.enabledNotificationSources = runtime.activeSources = ['linuxdo', 'yaohuo'];
      runtime.identityKeys = identities;
      runtime.identitySignature = 'linuxdo:42|yaohuo:43';
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await view.findByText('linuxdo 旧首页');
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await view.findByText('linuxdo 旧第 2 页');
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await view.findByText('linuxdo 旧第 3 页');
        phase = 'refresh';
        await fireEvent.press(view.getByTestId('notification-list-refresh'));
        await view.findByText('妖火 刷新第 3 页');
        if (refreshPartial) {
          expect(view.getByText('linuxdo 刷新部分有效消息')).toBeTruthy();
          expect(view.getByText('linuxdo 旧第 2 页')).toBeTruthy();
          expect(view.getByText('linuxdo 旧第 3 页')).toBeTruthy();
        }
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await view.findByText('妖火 刷新第 4 页');
        expect(linuxdo.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, '30', '60', undefined, '24']);

        phase = 'partial';
        await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
        await view.findByText('linuxdo 部分有效消息');
        expect(view.getByRole('button', { name: '重试 linux.do' })).toBeTruthy();
        expect(view.getByText('linuxdo 旧第 2 页')).toBeTruthy();
        expect(view.getByText('linuxdo 旧第 3 页')).toBeTruthy();
        expect(linuxdo.mock.calls.at(-1)?.[0].cursor).toBe('24');

        phase = 'complete';
        await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
        await view.findByText('linuxdo 恢复第 2 页');
        expect(view.getByText('linuxdo 新首页')).toBeTruthy();
        expect(view.queryByText('linuxdo 旧首页')).toBeNull();
        expect(view.queryByText('linuxdo 部分有效消息')).toBeNull();
        expect(view.queryByText('linuxdo 刷新部分有效消息')).toBeNull();
        expect(Boolean(view.queryByText('linuxdo 旧第 3 页'))).toBe(retryNext === '60');
        expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull();
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await view.findByText('妖火 刷新第 5 页');
        expect(linuxdo.mock.calls.map(([request]) => request.cursor)).toEqual([
          undefined,
          '30',
          '60',
          undefined,
          '24',
          '24',
          '24',
          ...(continuedAt ? [continuedAt] : [])
        ]);
      } finally {
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it.each(['failed head', 'retry settles first', 'refresh settles first', 'incompatible cursor'] as const)(
    'retains loaded history or a newer page retry when %s',
    async (scenario) => {
      appQueryClient.clear();
      const identities = { nodeseek: 'nodeseek:1', linuxdo: 'linuxdo:2', yaohuo: 'yaohuo:3' };
      const firstRefresh = Promise.withResolvers<NotificationPage>();
      const sourceRetry = Promise.withResolvers<NotificationPage>();
      let refreshing = false;
      let failedRefreshHead = false;
      let initialLinuxDoSecondPage = true;
      let retrySignal: AbortSignal | undefined;
      const page = (source: NotificationSource, id: string, cursor: string | null = null): NotificationPage => ({
        quality: 'complete',
        items: [{ ...notification, source, id, title: id }],
        cursor,
        hasMore: cursor !== null
      });
      const nodeSeek = jest.fn(async ({ cursor }: { cursor?: string | null }) =>
        cursor
          ? page('nodeseek', refreshing ? 'NodeSeek 新历史' : 'NodeSeek 旧历史')
          : page('nodeseek', refreshing ? 'NodeSeek 新首页' : 'NodeSeek 旧首页', refreshing ? null : 'ns:2')
      );
      const linuxDo = jest.fn(async ({ cursor, signal }: { cursor?: string | null; signal?: AbortSignal }) => {
        if (!cursor) {
          if (refreshing && scenario === 'failed head') {
            if (failedRefreshHead) return page('linuxdo', 'linux.do 新重试首页', 'ld:2');
            failedRefreshHead = true;
            throw new Error('linux.do 首页连接失败');
          }
          if (refreshing) return firstRefresh.promise;
          return page('linuxdo', 'linux.do 旧首页', 'ld:2');
        }
        if (cursor === 'ld:3') return page('linuxdo', 'linux.do 第三页');
        if (scenario === 'failed head') return page('linuxdo', 'linux.do 旧历史', 'ld:3');
        if (initialLinuxDoSecondPage) {
          initialLinuxDoSecondPage = false;
          throw new Error('linux.do 历史暂时不可用');
        }
        if (!retrySignal) {
          retrySignal = signal;
          return sourceRetry.promise;
        }
        return page('linuxdo', 'linux.do 旧刷新回执');
      });
      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: { listPage: nodeSeek } as unknown as NotificationAdapter,
          linuxdo: { listPage: linuxDo } as unknown as NotificationAdapter,
          yaohuo: { listPage: jest.fn(async () => page('yaohuo', '妖火')) } as unknown as NotificationAdapter
        },
        readAccess: (source) => ({ identityKey: identities[source], userId: identities[source].split(':')[1]! }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const runtime = routeRuntime(gateway);
      runtime.enabledNotificationSources = runtime.activeSources = ['nodeseek', 'linuxdo'];
      runtime.identityKeys = { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo };
      runtime.identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        expect(await view.findByText('linux.do 旧首页')).toBeTruthy();
        await fireEvent.press(view.getByTestId('notification-list-end'));
        expect(await view.findByText('NodeSeek 旧历史')).toBeTruthy();
        if (scenario === 'failed head') expect(await view.findByText('linux.do 旧历史')).toBeTruthy();
        else expect(await view.findByRole('button', { name: '重试 linux.do' })).toBeTruthy();
        refreshing = true;
        await fireEvent.press(view.getByTestId('notification-list-refresh'));
        if (scenario !== 'failed head') {
          await waitFor(() => expect(linuxDo).toHaveBeenCalledTimes(3));
          await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
          await waitFor(() => expect(retrySignal).toBeDefined());
          if (scenario === 'retry settles first') {
            await act(async () => sourceRetry.resolve(page('linuxdo', 'linux.do 新重试成功', 'ld:3')));
          }
        }
        await act(async () =>
          firstRefresh.resolve(
            page('linuxdo', 'linux.do 刷新首页', scenario === 'incompatible cursor' ? 'ld:other' : 'ld:2')
          )
        );
        expect(await view.findByText('NodeSeek 新首页')).toBeTruthy();
        expect(view.queryByText('NodeSeek 旧历史')).toBeNull();
        if (scenario !== 'failed head') {
          expect(retrySignal?.aborted).toBe(false);
          await act(async () => sourceRetry.resolve(page('linuxdo', 'linux.do 新重试成功', 'ld:3')));
          expect(await view.findByText('linux.do 新重试成功')).toBeTruthy();
          expect(view.queryByText('linux.do 旧刷新回执')).toBeNull();
          expect(
            view.getByText(scenario === 'incompatible cursor' ? 'linux.do 旧首页' : 'linux.do 刷新首页')
          ).toBeTruthy();
        } else {
          expect(view.getByText('linux.do 旧历史')).toBeTruthy();
          expect(linuxDo.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, 'ld:2', undefined]);
          await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
          expect(await view.findByText('linux.do 新重试首页')).toBeTruthy();
          expect(view.getByText('linux.do 旧历史')).toBeTruthy();
          await fireEvent.press(view.getByTestId('notification-list-end'));
          expect(await view.findByText('linux.do 第三页')).toBeTruthy();
          expect(linuxDo.mock.calls.map(([request]) => request.cursor)).toEqual([
            undefined,
            'ld:2',
            undefined,
            undefined,
            'ld:3'
          ]);
        }
      } finally {
        firstRefresh.resolve(page('linuxdo', 'linux.do 清理首页'));
        sourceRetry.resolve(page('linuxdo', 'linux.do 清理重试'));
        await view.unmount();
      }
    }
  );

  it('still applies normal non-raced retries on single-site page zero and aggregate page two', async () => {
    appQueryClient.clear();
    const identities: Record<NotificationSource, string> = {
      nodeseek: 'nodeseek:1',
      linuxdo: 'linuxdo:2',
      yaohuo: 'yaohuo:3'
    };
    const identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
    let singlePage0Failed = false;
    let aggPage2Failed = false;
    const singleCursors: (string | null | undefined)[] = [];
    const aggCursors: (string | null | undefined)[] = [];

    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: {
          listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
            if (!cursor) {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 第 1 页' }],
                cursor: 'ns-2',
                hasMore: true
              };
            }
            if (cursor === 'ns-2') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'nodeseek', id: 'ns-2', title: 'NodeSeek 第 2 页' }],
                cursor: 'ns-3',
                hasMore: true
              };
            }
            return {
              quality: 'complete' as const,
              items: [{ ...notification, source: 'nodeseek', id: 'ns-3', title: 'NodeSeek 第 3 页' }],
              cursor: null,
              hasMore: false
            };
          })
        } as unknown as NotificationAdapter,
        linuxdo: {
          getCategories: jest.fn(async () => [{ id: 'all', label: '所有通知' }]),
          listPage: jest.fn(async ({ categoryId, cursor }: { categoryId?: string; cursor?: string | null }) => {
            if (categoryId) {
              singleCursors.push(cursor);
              if (!cursor) {
                if (!singlePage0Failed) {
                  singlePage0Failed = true;
                  throw new Error('单站首页失败');
                }
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'linuxdo', id: 'ld-s1', title: '单站重试恢复首页' }],
                  cursor: '15',
                  hasMore: true
                };
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-s2', title: '单站重试下一页' }],
                cursor: null,
                hasMore: false
              };
            }
            aggCursors.push(cursor);
            if (!cursor) {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-a1', title: '聚合第 1 页' }],
                cursor: 'ld-2',
                hasMore: true
              };
            }
            if (cursor === 'ld-2') {
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-a2', title: '聚合第 2 页' }],
                cursor: 'ld-3',
                hasMore: true
              };
            }
            if (cursor === 'ld-3') {
              if (!aggPage2Failed) {
                aggPage2Failed = true;
                throw new Error('聚合第 3 页失败');
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-a3', title: '聚合第 3 页恢复' }],
                cursor: 'ld-4',
                hasMore: true
              };
            }
            return {
              quality: 'complete' as const,
              items: [{ ...notification, source: 'linuxdo', id: 'ld-a4', title: '聚合第 4 页' }],
              cursor: null,
              hasMore: false
            };
          })
        } as unknown as NotificationAdapter,
        yaohuo: {
          listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
        } as unknown as NotificationAdapter
      },
      readAccess: (source) => ({
        identityKey: identities[source],
        userId: identities[source].split(':')[1]!
      }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });

    const runtime = routeRuntime(gateway);
    runtime.enabledNotificationSources = ['nodeseek', 'linuxdo'];
    runtime.activeSources = ['nodeseek', 'linuxdo'];
    runtime.identityKeys = { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo };
    runtime.identitySignature = identitySignature;

    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    try {
      expect(await view.findByText('聚合第 1 页')).toBeTruthy();
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('聚合第 2 页')).toBeTruthy();
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByRole('button', { name: '重试 linux.do' })).toBeTruthy();

      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
      expect(await view.findByText('聚合第 3 页恢复')).toBeTruthy();
      expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull();
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('聚合第 4 页')).toBeTruthy();
      expect(aggCursors).toEqual([undefined, 'ld-2', 'ld-3', 'ld-3', 'ld-4']);

      await fireEvent.press(view.getByTestId('notification-source-linuxdo'));
      expect(await view.findByRole('button', { name: '重试 linux.do' })).toBeTruthy();
      await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
      expect(await view.findByText('单站重试恢复首页')).toBeTruthy();
      expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull();
      await fireEvent.press(view.getByTestId('notification-list-end'));
      expect(await view.findByText('单站重试下一页')).toBeTruthy();
      expect(singleCursors).toEqual([undefined, undefined, '15']);
    } finally {
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it.each(['switched-to-confirmed', 'switched-to-anonymous', 'switched-while-still-unknown'] as const)(
    'ignores a stale unified account-status retry callback after an account switch while staying on all sources: %s',
    async (mode) => {
      appQueryClient.clear();
      const identities: Record<NotificationSource, string> = {
        nodeseek: 'nodeseek:userA',
        linuxdo: 'linuxdo:userA',
        yaohuo: 'yaohuo:userA'
      };
      const makeAdapter = (source: NotificationSource): NotificationAdapter =>
        ({
          listPage: jest.fn(async () => ({
            quality: 'complete' as const,
            items: [{ ...notification, source, id: `${source}-1`, title: `${source} 新账号消息` }],
            cursor: null,
            hasMore: false
          }))
        }) as unknown as NotificationAdapter;
      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: makeAdapter('nodeseek'),
          linuxdo: makeAdapter('linuxdo'),
          yaohuo: makeAdapter('yaohuo')
        },
        readAccess: (source) => ({
          identityKey: identities[source],
          userId: identities[source].split(':')[1]!
        }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const listAllPageSpy = jest.spyOn(gateway, 'listAllPage');
      const listPageSpy = jest.spyOn(gateway, 'listPage');

      let currentRuntime = routeRuntime(gateway);
      currentRuntime.activeSources = [];
      currentRuntime.identityKeys = { ...identities };
      currentRuntime.identitySignature = 'nodeseek|linuxdo|yaohuo:nodeseek:userA|linuxdo:userA|yaohuo:userA';
      for (const site of notificationSources) {
        currentRuntime.sessions[site] = { ...currentRuntime.sessions[site], identityTrust: 'unknown' };
      }

      const tree = (value: NotificationRouteRuntimeValue) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );

      let view: Awaited<ReturnType<typeof render>> | undefined;
      const reconcile = jest.fn<NotificationRouteRuntimeValue['reconcileAccountStatus']>(async (candidate) => {
        const nextActive = notificationSources.filter(
          (site) => currentRuntime.activeSources.includes(site) || site === candidate
        );
        currentRuntime = {
          ...currentRuntime,
          activeSources: nextActive,
          sessions: {
            ...currentRuntime.sessions,
            [candidate]: { ...currentRuntime.sessions[candidate], isLoggedIn: true, identityTrust: 'confirmed' }
          }
        };
        await view!.rerender(tree(currentRuntime));
        return { status: 'same', session: createSiteSessionStates()[candidate] };
      });
      currentRuntime.reconcileAccountStatus = reconcile;

      view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
      try {
        expect(view.getByText('账号状态暂不可确认')).toBeTruthy();
        expect(mockListNavigationProps.source).toBe('all');
        expect(mockListNavigationProps.categoryId).toBe('');
        expect(mockListNavigationProps.unreadOnly).toBe(false);
        expect(view.getByRole('button', { name: '重试账号核对' })).toBeTruthy();
        const staleUnifiedRetry = mockListNavigationProps.onRetryAccountStatus;

        // Switch NodeSeek account while remaining on "全部" with identical source/categoryId/unreadOnly.
        if (mode === 'switched-to-confirmed') {
          identities.nodeseek = 'nodeseek:userB';
          currentRuntime = {
            ...currentRuntime,
            activeSources: ['nodeseek'],
            identityKeys: { ...currentRuntime.identityKeys, nodeseek: 'nodeseek:userB' },
            identitySignature: 'nodeseek|linuxdo|yaohuo:nodeseek:userB|linuxdo:userA|yaohuo:userA',
            sessionEpochs: { ...currentRuntime.sessionEpochs, nodeseek: 1 },
            sessions: {
              ...currentRuntime.sessions,
              nodeseek: {
                ...currentRuntime.sessions.nodeseek,
                isLoggedIn: true,
                identityTrust: 'confirmed',
                currentUser: { ...testAccountUser('nodeseek'), id: 'userB' }
              }
            }
          };
        } else if (mode === 'switched-to-anonymous') {
          currentRuntime = {
            ...currentRuntime,
            activeSources: [],
            identityKeys: { ...currentRuntime.identityKeys, nodeseek: undefined },
            identitySignature: 'nodeseek|linuxdo|yaohuo:nodeseek:none|linuxdo:userA|yaohuo:userA',
            sessionEpochs: { ...currentRuntime.sessionEpochs, nodeseek: 1 },
            sessions: {
              ...currentRuntime.sessions,
              nodeseek: {
                ...currentRuntime.sessions.nodeseek,
                isLoggedIn: false,
                identityTrust: 'none',
                currentUser: undefined
              }
            }
          };
        } else {
          identities.nodeseek = 'nodeseek:userB';
          currentRuntime = {
            ...currentRuntime,
            activeSources: [],
            identityKeys: { ...currentRuntime.identityKeys, nodeseek: 'nodeseek:userB' },
            identitySignature: 'nodeseek|linuxdo|yaohuo:nodeseek:userB|linuxdo:userA|yaohuo:userA',
            sessionEpochs: { ...currentRuntime.sessionEpochs, nodeseek: 1 }
          };
        }
        await view.rerender(tree(currentRuntime));

        expect(mockListNavigationProps.source).toBe('all');
        expect(mockListNavigationProps.categoryId).toBe('');
        expect(mockListNavigationProps.unreadOnly).toBe(false);
        if (mode === 'switched-to-confirmed') {
          expect(await view.findByText('nodeseek 新账号消息')).toBeTruthy();
          expect(view.queryByRole('button', { name: '重试账号核对' })).toBeNull();
        } else if (mode === 'switched-to-anonymous') {
          expect(view.queryByRole('button', { name: '重试账号核对' })).toBeNull();
        }

        const listAllCallsBeforeStale = listAllPageSpy.mock.calls.length;
        const listPageCallsBeforeStale = listPageSpy.mock.calls.length;

        await act(async () => {
          await staleUnifiedRetry();
        });

        expect(reconcile).not.toHaveBeenCalled();
        expect(listAllPageSpy).toHaveBeenCalledTimes(listAllCallsBeforeStale);
        expect(listPageSpy).toHaveBeenCalledTimes(listPageCallsBeforeStale);

        if (mode === 'switched-while-still-unknown') {
          await fireEvent.press(view.getByRole('button', { name: '重试账号核对' }));
          expect(await view.findByText('nodeseek 新账号消息')).toBeTruthy();
          expect(await view.findByText('linuxdo 新账号消息')).toBeTruthy();
          expect(await view.findByText('yaohuo 新账号消息')).toBeTruthy();
          expect(reconcile.mock.calls.map(([site]) => site)).toEqual(['nodeseek', 'linuxdo', 'yaohuo']);
        }
      } finally {
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it.each(['poll-first', 'backfill-first'] as const)(
    'keeps pending linuxdo verification backfill eligible and clears its block when 60s poll only reads NodeSeek (%s)',
    async (order) => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      focusManager.setFocused(true);
      appQueryClient.clear();
      const identities: Record<NotificationSource, string> = {
        nodeseek: 'nodeseek:1',
        linuxdo: 'linuxdo:2',
        yaohuo: 'yaohuo:3'
      };
      const identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
      const pendingBackfill = Promise.withResolvers<NotificationPage>();
      const pendingPollNodeSeek = Promise.withResolvers<NotificationPage>();
      let nodeSeekInitialCalls = 0;
      let linuxdoCalls = 0;
      const requestedAllSources: NotificationSource[][] = [];
      const requestedLinuxdoCursors: (string | null | undefined)[] = [];
      const requestedNodeSeekCursors: (string | null | undefined)[] = [];

      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              requestedNodeSeekCursors.push(cursor);
              if (!cursor) {
                nodeSeekInitialCalls += 1;
                if (nodeSeekInitialCalls === 1) {
                  return {
                    quality: 'complete' as const,
                    items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 首轮消息' }],
                    cursor: 'ns-2',
                    hasMore: true
                  };
                }
                return pendingPollNodeSeek.promise;
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'nodeseek', id: 'ns-p2', title: 'NodeSeek 轮询次页' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          linuxdo: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              requestedLinuxdoCursors.push(cursor);
              if (!cursor) {
                linuxdoCalls += 1;
                if (linuxdoCalls === 1) {
                  throw Object.assign(new Error('请先完成 Cloudflare 验证'), { verificationRequired: true });
                }
                return pendingBackfill.promise;
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-p2', title: 'linuxdo 补读次页' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          yaohuo: {
            listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
          } as unknown as NotificationAdapter
        },
        readAccess: (source) => ({
          identityKey: identities[source],
          userId: identities[source].split(':')[1]!
        }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      const listAllPageOriginal = gateway.listAllPage;
      const listAllPageSpy = jest.spyOn(gateway, 'listAllPage').mockImplementation((options) => {
        requestedAllSources.push([...options.sources]);
        return listAllPageOriginal(options);
      });
      const listPageSpy = jest.spyOn(gateway, 'listPage');

      const readBlocks = new Map<NotificationSource, { epoch: number; error: SourceErrorInfo }>();
      let capturedRecovery: ReadRecovery | undefined;
      let view: Awaited<ReturnType<typeof render>> | undefined;
      let currentRuntime!: NotificationRouteRuntimeValue;
      const rerenderRuntime = () => {
        currentRuntime = { ...currentRuntime };
        view?.rerender(tree(currentRuntime));
      };
      const clearReadBlock = jest.fn((source: NotificationSource, epoch: number) => {
        if (readBlocks.get(source)?.epoch === epoch) {
          readBlocks.delete(source);
          rerenderRuntime();
        }
      });
      const reportReadError = jest.fn((source: NotificationSource, error: SourceErrorInfo, epoch: number) => {
        if (
          error.kind === 'verification-required' ||
          error.kind === 'login-required' ||
          error.kind === 'login-expired'
        ) {
          readBlocks.set(source, { epoch, error });
          rerenderRuntime();
        }
      });
      const getReadBlock = jest.fn((source: NotificationSource) => {
        const block = readBlocks.get(source);
        return block && block.epoch === currentRuntime.sessionEpochs[source] ? block.error : undefined;
      });

      currentRuntime = {
        ...routeRuntime(gateway),
        enabledNotificationSources: ['nodeseek', 'linuxdo'],
        activeSources: ['nodeseek', 'linuxdo'],
        identityKeys: { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo },
        identitySignature,
        clearReadBlock,
        getReadBlock,
        reportReadError,
        openAccountSurface: jest.fn(async (_source, _message, recovery?: ReadRecovery) => {
          capturedRecovery = recovery;
        })
      };

      const tree = (value: NotificationRouteRuntimeValue) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );

      let resumePromise: Promise<string> | undefined;
      view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
      try {
        expect(await view.findByText('NodeSeek 首轮消息')).toBeTruthy();
        expect(await view.findByRole('button', { name: '去验证 linux.do' })).toBeTruthy();
        expect(readBlocks.get('linuxdo')?.error.kind).toBe('verification-required');

        await fireEvent.press(view.getByRole('button', { name: '去验证 linux.do' }));
        expect(capturedRecovery).toBeDefined();

        // Start linux.do verification backfill; linux.do read block is still active until backfill completes.
        await act(async () => {
          resumePromise = capturedRecovery!.resume();
        });
        await waitFor(() => expect(linuxdoCalls).toBe(2));

        // Trigger the 60s aggregate poll while linux.do backfill is still pending.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(60_000);
        });
        await waitFor(() => expect(nodeSeekInitialCalls).toBe(2));
        expect(requestedAllSources).toEqual([['nodeseek', 'linuxdo'], ['nodeseek']]);

        const settlePoll = async () => {
          await act(async () => {
            pendingPollNodeSeek.resolve({
              quality: 'complete',
              items: [{ ...notification, source: 'nodeseek', id: 'ns-poll-1', title: 'NodeSeek 轮询新消息' }],
              cursor: 'ns-poll-2',
              hasMore: true
            });
            await Promise.resolve();
          });
        };
        const settleBackfill = async () => {
          await act(async () => {
            pendingBackfill.resolve({
              quality: 'complete',
              items: [{ ...notification, source: 'linuxdo', id: 'ld-bf-1', title: 'linuxdo 验证补读消息' }],
              cursor: 'ld-2',
              hasMore: true
            });
            await Promise.resolve();
          });
        };

        if (order === 'poll-first') {
          await settlePoll();
          await settleBackfill();
        } else {
          await settleBackfill();
          await settlePoll();
        }

        const outcome = await act(async () => resumePromise);
        expect(outcome).toBe('completed');
        expect(await view.findByText('NodeSeek 轮询新消息')).toBeTruthy();
        expect(await view.findByText('linuxdo 验证补读消息')).toBeTruthy();
        expect(readBlocks.get('linuxdo')).toBeUndefined();
        expect(clearReadBlock).toHaveBeenCalledWith('linuxdo', 0);
        expect(view.queryByRole('button', { name: '去验证 linux.do' })).toBeNull();

        // Next pagination continues with BOTH NodeSeek's new poll cursor and linux.do's backfill cursor.
        await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
        await fireEvent.press(view.getByTestId('notification-list-end'));
        expect(await view.findByText('NodeSeek 轮询次页')).toBeTruthy();
        expect(await view.findByText('linuxdo 补读次页')).toBeTruthy();
        expect(requestedAllSources).toEqual([['nodeseek', 'linuxdo'], ['nodeseek'], ['nodeseek', 'linuxdo']]);
        expect(requestedNodeSeekCursors).toEqual([undefined, undefined, 'ns-poll-2']);
        expect(requestedLinuxdoCursors).toEqual([undefined, undefined, 'ld-2']);
        expect(listAllPageSpy).toHaveBeenCalledTimes(3);
        expect(listPageSpy.mock.calls.filter(([site]) => site === 'linuxdo')).toHaveLength(1);
      } finally {
        pendingBackfill.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        pendingPollNodeSeek.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        await resumePromise?.catch(() => undefined);
        await view.unmount();
        appQueryClient.clear();
        focusManager.setFocused(true);
        jest.useRealTimers();
      }
    }
  );

  it.each<['older-first' | 'newer-first', 'success' | 'failure', 'success' | 'failure']>([
    ['older-first', 'success', 'success'],
    ['newer-first', 'success', 'success'],
    ['older-first', 'success', 'failure'],
    ['newer-first', 'success', 'failure'],
    ['older-first', 'failure', 'success'],
    ['newer-first', 'failure', 'success'],
    ['older-first', 'failure', 'failure'],
    ['newer-first', 'failure', 'failure']
  ])(
    'always keeps the newer valid read when older aggregate and newer source retry callbacks swap completion order (%s, older=%s, newer=%s)',
    async (order, olderOutcome, newerOutcome) => {
      appQueryClient.clear();
      focusManager.setFocused(true);
      const identities: Record<NotificationSource, string> = {
        nodeseek: 'nodeseek:1',
        linuxdo: 'linuxdo:2',
        yaohuo: 'yaohuo:3'
      };
      const identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
      const listQueryKey = forumQueryKeys.notificationList({
        source: 'all',
        categoryId: null,
        identityKey: identitySignature,
        unreadOnly: false
      });
      const pendingOlderNodeSeek = Promise.withResolvers<NotificationPage>();
      const pendingOlderLinuxdo = Promise.withResolvers<NotificationPage>();
      const pendingNewerLinuxdo = Promise.withResolvers<NotificationPage>();
      let nodeSeekInitialCalls = 0;
      let linuxdoInitialCalls = 0;
      const nextLinuxdoCursors: (string | null | undefined)[] = [];

      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              if (!cursor) {
                nodeSeekInitialCalls += 1;
                if (nodeSeekInitialCalls === 1) {
                  return {
                    quality: 'complete' as const,
                    items: [{ ...notification, source: 'nodeseek', id: 'ns-init', title: 'NodeSeek 初始消息' }],
                    cursor: null,
                    hasMore: false
                  };
                }
                return pendingOlderNodeSeek.promise;
              }
              return { quality: 'complete' as const, items: [], cursor: null, hasMore: false };
            })
          } as unknown as NotificationAdapter,
          linuxdo: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              if (!cursor) {
                linuxdoInitialCalls += 1;
                if (linuxdoInitialCalls === 1) throw new Error('初始加载失败');
                if (linuxdoInitialCalls === 2) return pendingOlderLinuxdo.promise;
                return pendingNewerLinuxdo.promise;
              }
              nextLinuxdoCursors.push(cursor);
              return {
                quality: 'complete' as const,
                items: [
                  { ...notification, source: 'linuxdo', id: `ld-next-${cursor}`, title: `linuxdo 续页 ${cursor}` }
                ],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          yaohuo: {
            listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
          } as unknown as NotificationAdapter
        },
        readAccess: (source) => ({
          identityKey: identities[source],
          userId: identities[source].split(':')[1]!
        }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });

      const readBlocks = new Map<NotificationSource, { epoch: number; error: SourceErrorInfo }>();
      let view: Awaited<ReturnType<typeof render>> | undefined;
      let currentRuntime!: NotificationRouteRuntimeValue;
      const rerenderRuntime = () => {
        currentRuntime = { ...currentRuntime };
        view?.rerender(tree(currentRuntime));
      };
      currentRuntime = {
        ...routeRuntime(gateway),
        enabledNotificationSources: ['nodeseek', 'linuxdo'],
        activeSources: ['nodeseek', 'linuxdo'],
        identityKeys: { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo },
        identitySignature,
        clearReadBlock: jest.fn((source: NotificationSource, epoch: number) => {
          if (readBlocks.get(source)?.epoch === epoch) {
            readBlocks.delete(source);
            rerenderRuntime();
          }
        }),
        getReadBlock: jest.fn((source: NotificationSource) => {
          const block = readBlocks.get(source);
          return block && block.epoch === currentRuntime.sessionEpochs[source] ? block.error : undefined;
        }),
        reportReadError: jest.fn((source: NotificationSource, error: SourceErrorInfo, epoch: number) => {
          if (
            error.kind === 'verification-required' ||
            error.kind === 'login-required' ||
            error.kind === 'login-expired'
          ) {
            readBlocks.set(source, { epoch, error });
            rerenderRuntime();
          }
        })
      };

      const tree = (value: NotificationRouteRuntimeValue) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );

      let refetchPromise: Promise<void> | undefined;
      view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
      try {
        expect(await view.findByText('NodeSeek 初始消息')).toBeTruthy();
        expect(await view.findByRole('button', { name: '重试 linux.do' })).toBeTruthy();

        // Launch older aggregate refetch reading BOTH NodeSeek and linux.do.
        await act(async () => {
          refetchPromise = appQueryClient.refetchQueries({ queryKey: listQueryKey, exact: true });
        });
        await waitFor(() => expect(linuxdoInitialCalls).toBe(2));

        // While older aggregate refetch is still in flight, user triggers newer retry for linux.do.
        await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
        await waitFor(() => expect(linuxdoInitialCalls).toBe(3));

        const settleOlder = async () => {
          await act(async () => {
            pendingOlderNodeSeek.resolve({
              quality: 'complete',
              items: [{ ...notification, source: 'nodeseek', id: 'ns-poll', title: 'NodeSeek 轮询更新消息' }],
              cursor: null,
              hasMore: false
            });
            if (olderOutcome === 'success') {
              pendingOlderLinuxdo.resolve({
                quality: 'complete',
                items: [{ ...notification, source: 'linuxdo', id: 'ld-older', title: '旧聚合成功消息' }],
                cursor: 'ld-old-2',
                hasMore: true
              });
            } else {
              pendingOlderLinuxdo.reject(Object.assign(new Error('旧聚合验证失败'), { verificationRequired: true }));
            }
            await refetchPromise;
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
        };
        const settleNewer = async () => {
          await act(async () => {
            if (newerOutcome === 'success') {
              pendingNewerLinuxdo.resolve({
                quality: 'complete',
                items: [{ ...notification, source: 'linuxdo', id: 'ld-newer', title: '新重试成功消息' }],
                cursor: 'ld-new-2',
                hasMore: true
              });
            } else {
              pendingNewerLinuxdo.reject(new Error('新重试失败'));
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
        };

        if (order === 'older-first') {
          await settleOlder();
          await settleNewer();
        } else {
          await settleNewer();
          await settleOlder();
        }

        expect(await view.findByText('NodeSeek 轮询更新消息')).toBeTruthy();
        if (newerOutcome === 'success') {
          expect(await view.findByText('新重试成功消息')).toBeTruthy();
          expect(view.queryByText('旧聚合成功消息')).toBeNull();
          expect(view.queryByText(/旧聚合验证失败|新重试失败|初始加载失败/)).toBeNull();
          expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull();
          expect(view.queryByRole('button', { name: '去验证 linux.do' })).toBeNull();
          expect(readBlocks.get('linuxdo')).toBeUndefined();

          await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
          await fireEvent.press(view.getByTestId('notification-list-end'));
          expect(await view.findByText('linuxdo 续页 ld-new-2')).toBeTruthy();
          expect(nextLinuxdoCursors).toEqual(['ld-new-2']);
        } else {
          expect(await view.findByText('新重试失败')).toBeTruthy();
          expect(view.queryByText('旧聚合成功消息')).toBeNull();
          expect(view.queryByText('旧聚合验证失败')).toBeNull();
          expect(view.queryByRole('button', { name: '去验证 linux.do' })).toBeNull();
          expect(readBlocks.get('linuxdo')).toBeUndefined();
        }
      } finally {
        pendingOlderNodeSeek.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        pendingOlderLinuxdo.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        pendingNewerLinuxdo.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        await refetchPromise?.catch(() => undefined);
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it.each(['success', 'failure'] as const)(
    'prevents a stale offset pagination callback from reattaching after a full-chain refresh and continues from the new cursor (%s)',
    async (outcome) => {
      appQueryClient.clear();
      focusManager.setFocused(true);
      const identities: Record<NotificationSource, string> = {
        nodeseek: 'nodeseek:1',
        linuxdo: 'linuxdo:2',
        yaohuo: 'yaohuo:3'
      };
      const identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
      const pendingOldOffset = Promise.withResolvers<NotificationPage>();
      let refreshStarted = false;
      let oldOffsetStarted = false;
      const linuxdoCursors: (string | null | undefined)[] = [];
      const nodeSeekCursors: (string | null | undefined)[] = [];

      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              nodeSeekCursors.push(cursor);
              if (!cursor) {
                return refreshStarted
                  ? {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'nodeseek', id: 'ns-r1', title: 'NodeSeek 刷新首页' }],
                      cursor: 'ns-r2',
                      hasMore: true
                    }
                  : {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 初始首页' }],
                      cursor: 'ns-2',
                      hasMore: true
                    };
              }
              if (cursor === 'ns-2') {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-2', title: 'NodeSeek 旧第2页' }],
                  cursor: null,
                  hasMore: false
                };
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'nodeseek', id: 'ns-r2', title: 'NodeSeek 新链第2页' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          linuxdo: {
            listPage: jest.fn(async ({ cursor }: { cursor?: string | null }) => {
              linuxdoCursors.push(cursor);
              if (!cursor) {
                return refreshStarted
                  ? {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'linuxdo', id: 'ld-r1', title: 'linuxdo 刷新首页' }],
                      cursor: 'ld-r2',
                      hasMore: true
                    }
                  : {
                      quality: 'complete' as const,
                      items: [{ ...notification, source: 'linuxdo', id: 'ld-1', title: 'linuxdo 初始首页' }],
                      cursor: 'ld-2',
                      hasMore: true
                    };
              }
              if (cursor === 'ld-2') {
                oldOffsetStarted = true;
                return pendingOldOffset.promise;
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-r2', title: 'linuxdo 新链第2页' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          yaohuo: {
            listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
          } as unknown as NotificationAdapter
        },
        readAccess: (source) => ({
          identityKey: identities[source],
          userId: identities[source].split(':')[1]!
        }),
        privateAccessAllowed: () => true,
        sourceAllowed: () => true
      });
      // Simulate an aggregate transport whose older offset call settles even after abort.
      const originalListAll = gateway.listAllPage;
      jest.spyOn(gateway, 'listAllPage').mockImplementation(async (options) => {
        if (options.cursors?.linuxdo === 'ld-2') {
          oldOffsetStarted = true;
          try {
            const page = await pendingOldOffset.promise;
            return {
              items: page.items,
              errors: {},
              qualities: { linuxdo: page.quality },
              nextCursors: { linuxdo: page.cursor },
              hasMore: page.hasMore
            };
          } catch (error) {
            return {
              items: [],
              errors: { linuxdo: sourceErrorFromUnknown('linuxdo', error) },
              qualities: { linuxdo: 'invalid' },
              nextCursors: { linuxdo: null },
              hasMore: false
            };
          }
        }
        return originalListAll(options);
      });

      const reportReadError = jest.fn();
      const runtime: NotificationRouteRuntimeValue = {
        ...routeRuntime(gateway),
        enabledNotificationSources: ['nodeseek', 'linuxdo'],
        activeSources: ['nodeseek', 'linuxdo'],
        identityKeys: { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo },
        identitySignature,
        reportReadError
      };

      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationsRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
              route={{ key: 'notifications', name: 'notifications', params: undefined }}
            />
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        expect(await view.findByText('linuxdo 初始首页')).toBeTruthy();

        // Start forward pagination with old offset cursor ld-2.
        await fireEvent.press(view.getByTestId('notification-list-end'));
        await waitFor(() => expect(oldOffsetStarted).toBe(true));

        // Full-chain refresh starts and replaces page chain with ld-r2 / ns-r2.
        refreshStarted = true;
        await fireEvent.press(view.getByTestId('notification-list-refresh'));
        expect(await view.findByText('linuxdo 刷新首页')).toBeTruthy();

        // Late old offset callback settles after full-chain refresh completed.
        await act(async () => {
          if (outcome === 'success') {
            pendingOldOffset.resolve({
              quality: 'complete',
              items: [{ ...notification, source: 'linuxdo', id: 'ld-old-2', title: '旧分页回调消息' }],
              cursor: 'ld-old-3',
              hasMore: true
            });
          } else {
            pendingOldOffset.reject(Object.assign(new Error('旧分页验证失败'), { verificationRequired: true }));
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        });

        expect(view.queryByText('旧分页回调消息')).toBeNull();
        expect(view.queryByText('旧分页验证失败')).toBeNull();
        expect(reportReadError).not.toHaveBeenCalled();

        await waitFor(() => expect(view.getByTestId('notification-list-end').props.onPress).toBeDefined());
        await fireEvent.press(view.getByTestId('notification-list-end'));
        expect(await view.findByText('linuxdo 新链第2页')).toBeTruthy();
        expect(await view.findByText('NodeSeek 新链第2页')).toBeTruthy();
        expect(linuxdoCursors).not.toContain('ld-old-3');
        expect(linuxdoCursors.at(-1)).toBe('ld-r2');
        expect(nodeSeekCursors.at(-1)).toBe('ns-r2');
      } finally {
        pendingOldOffset.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        await view.unmount();
        appQueryClient.clear();
      }
    }
  );

  it.each(['blur', 'account-switch', 'verification-cancel'] as const)(
    'stops stale verification backfill after waiting for an aggregate poll when %s happens mid-wait',
    async (change) => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      focusManager.setFocused(true);
      appQueryClient.clear();
      let linuxdoIdentity = 'linuxdo:userA';
      let linuxdoEpoch = 0;
      const pendingBackfill = Promise.withResolvers<NotificationPage>();
      const pendingPollNodeSeek = Promise.withResolvers<NotificationPage>();
      const verification = new AbortController();
      let backfillSignal: AbortSignal | undefined;
      let nodeSeekInitialCalls = 0;
      let linuxdoUserACalls = 0;
      const requestedAllSources: NotificationSource[][] = [];
      const requestedListPageSources: NotificationSource[] = [];

      const gateway = createNotificationGateway({
        adapters: {
          nodeseek: {
            listPage: jest.fn(async () => {
              nodeSeekInitialCalls += 1;
              if (nodeSeekInitialCalls === 1) {
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'nodeseek', id: 'ns-a1', title: 'NodeSeek 首轮消息' }],
                  cursor: null,
                  hasMore: false
                };
              }
              if (nodeSeekInitialCalls === 2) return pendingPollNodeSeek.promise;
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'nodeseek', id: 'ns-b1', title: 'NodeSeek 切换后消息' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          linuxdo: {
            listPage: jest.fn(async ({ identityKey, signal }: NotificationAdapterAccess) => {
              if (identityKey === 'linuxdo:userA') {
                linuxdoUserACalls += 1;
                if (linuxdoUserACalls === 1) {
                  throw Object.assign(new Error('请先完成 Cloudflare 验证'), { verificationRequired: true });
                }
                if (linuxdoUserACalls === 2) {
                  backfillSignal = signal;
                  return pendingBackfill.promise;
                }
                return {
                  quality: 'complete' as const,
                  items: [{ ...notification, source: 'linuxdo', id: 'ld-fresh-bf', title: 'linuxdo 新验证补读消息' }],
                  cursor: null,
                  hasMore: false
                };
              }
              return {
                quality: 'complete' as const,
                items: [{ ...notification, source: 'linuxdo', id: 'ld-b1', title: 'linuxdo userB 新账号消息' }],
                cursor: null,
                hasMore: false
              };
            })
          } as unknown as NotificationAdapter,
          yaohuo: {
            listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
          } as unknown as NotificationAdapter
        },
        readAccess: (source) =>
          source === 'linuxdo'
            ? { identityKey: linuxdoIdentity, userId: linuxdoIdentity.split(':')[1]! }
            : { identityKey: 'nodeseek:1', userId: '1' },
        requestSessionEpoch: (source) => (source === 'linuxdo' ? linuxdoEpoch : 0),
        privateAccessAllowed: (source, id) => (source === 'linuxdo' ? id === linuxdoIdentity : true),
        sourceAllowed: () => true
      });
      const originalListAll = gateway.listAllPage;
      jest.spyOn(gateway, 'listAllPage').mockImplementation((options) => {
        requestedAllSources.push([...options.sources]);
        return originalListAll(options);
      });
      const originalListPage = gateway.listPage;
      jest.spyOn(gateway, 'listPage').mockImplementation((source, options) => {
        requestedListPageSources.push(source);
        return originalListPage(source, options);
      });

      const oldSignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:userA';
      const oldQueryKey = forumQueryKeys.notificationList({
        source: 'all',
        categoryId: null,
        identityKey: oldSignature,
        unreadOnly: false
      });
      const readBlocks = new Map<NotificationSource, { epoch: number; error: SourceErrorInfo }>();
      let capturedRecovery: ReadRecovery | undefined;
      let view: Awaited<ReturnType<typeof render>> | undefined;
      let currentRuntime!: NotificationRouteRuntimeValue;
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const tree = (value: NotificationRouteRuntimeValue) => (
        <NotificationRouteRuntimeProvider value={value}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName="notifications">
              <FocusTestStack.Screen name="notifications">
                {(props) => <NotificationsRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Other">{() => <Text>其他页面</Text>}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
      const clearReadBlock = jest.fn((source: NotificationSource, epoch: number) => {
        if (readBlocks.get(source)?.epoch === epoch) {
          readBlocks.delete(source);
          currentRuntime = { ...currentRuntime };
          view?.rerender(tree(currentRuntime));
        }
      });
      const reportReadError = jest.fn((source: NotificationSource, error: SourceErrorInfo, epoch: number) => {
        if (
          error.kind === 'verification-required' ||
          error.kind === 'login-required' ||
          error.kind === 'login-expired'
        ) {
          readBlocks.set(source, { epoch, error });
          currentRuntime = { ...currentRuntime };
          view?.rerender(tree(currentRuntime));
        }
      });
      currentRuntime = {
        ...routeRuntime(gateway),
        enabledNotificationSources: ['nodeseek', 'linuxdo'],
        activeSources: ['nodeseek', 'linuxdo'],
        identityKeys: { nodeseek: 'nodeseek:1', linuxdo: 'linuxdo:userA' },
        identitySignature: oldSignature,
        clearReadBlock,
        getReadBlock: jest.fn((source: NotificationSource) => {
          const block = readBlocks.get(source);
          return block && block.epoch === currentRuntime.sessionEpochs[source] ? block.error : undefined;
        }),
        reportReadError,
        openAccountSurface: jest.fn(async (_source, _message, recovery?: ReadRecovery) => {
          capturedRecovery = recovery;
        })
      };

      let resumePromise: Promise<string> | undefined;
      view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
      try {
        expect(await view.findByText('NodeSeek 首轮消息')).toBeTruthy();
        await fireEvent.press(await view.findByRole('button', { name: '去验证 linux.do' }));

        await act(async () => {
          resumePromise = capturedRecovery!.resume(verification.signal);
        });
        await waitFor(() => expect(linuxdoUserACalls).toBe(2));

        // 60s aggregate poll launches reading ONLY NodeSeek while linux.do backfill is in flight.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(60_000);
        });
        await waitFor(() => expect(nodeSeekInitialCalls).toBe(2));

        // linux.do backfill resolves its transport first and now waits for the in-flight aggregate poll to settle.
        await act(async () => {
          pendingBackfill.resolve({
            quality: 'complete',
            items: [{ ...notification, source: 'linuxdo', id: 'ld-stale-bf', title: 'linuxdo 旧验证补读消息' }],
            cursor: 'ld-stale-2',
            hasMore: true
          });
          await Promise.resolve();
        });

        if (change === 'blur') {
          await act(async () => navigation.navigate('Other'));
          expect(await view.findByText('其他页面')).toBeTruthy();
        } else if (change === 'account-switch') {
          linuxdoIdentity = 'linuxdo:userB';
          linuxdoEpoch = 1;
          readBlocks.delete('linuxdo');
          currentRuntime = {
            ...currentRuntime,
            identityKeys: { nodeseek: 'nodeseek:1', linuxdo: 'linuxdo:userB' },
            identitySignature: 'nodeseek|linuxdo:nodeseek:1|linuxdo:userB',
            sessionEpochs: { ...currentRuntime.sessionEpochs, linuxdo: 1 }
          };
          await view.rerender(tree(currentRuntime));
        } else {
          verification.abort();
          capturedRecovery!.cancel?.();
          expect(backfillSignal?.aborted).toBe(true);
        }

        // Now settle the old aggregate poll and flush all microtasks.
        await act(async () => {
          pendingPollNodeSeek.resolve({
            quality: 'complete',
            items: [{ ...notification, source: 'nodeseek', id: 'ns-old-poll', title: 'NodeSeek 过期轮询消息' }],
            cursor: null,
            hasMore: false
          });
          for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
        });

        const outcome = await act(async () => resumePromise);
        expect(outcome).toBe('stale');
        expect(clearReadBlock).not.toHaveBeenCalledWith('linuxdo', 0);
        const oldCached = appQueryClient.getQueryData<{ pages: { items: ForumNotification[] }[] }>(oldQueryKey);
        expect(oldCached?.pages.flatMap((page) => page.items).map((item) => item.id)).not.toContain('ld-stale-bf');
        expect(view.queryByText('linuxdo 旧验证补读消息')).toBeNull();
        expect(requestedListPageSources).toEqual(['linuxdo']);
        if (change === 'verification-cancel') {
          expect(oldCached?.pages.flatMap((page) => page.items).map((item) => item.id)).toContain('ns-old-poll');
          const canceled = capturedRecovery;
          await fireEvent.press(await view.findByRole('button', { name: '去验证 linux.do' }));
          expect(capturedRecovery).not.toBe(canceled);
          const nextVerification = new AbortController();
          expect(await act(() => capturedRecovery!.resume(nextVerification.signal))).toBe('completed');
          expect(await view.findByText('linuxdo 新验证补读消息')).toBeTruthy();
          expect(requestedListPageSources).toEqual(['linuxdo', 'linuxdo']);
        } else if (change === 'account-switch') {
          expect(oldCached?.pages.flatMap((page) => page.items).map((item) => item.id)).not.toContain('ns-old-poll');
          expect(await view.findByText('linuxdo userB 新账号消息')).toBeTruthy();
          expect(requestedAllSources).toEqual([['nodeseek', 'linuxdo'], ['nodeseek'], ['nodeseek', 'linuxdo']]);
        } else {
          expect(oldCached?.pages.flatMap((page) => page.items).map((item) => item.id)).not.toContain('ns-old-poll');
          expect(requestedAllSources).toEqual([['nodeseek', 'linuxdo'], ['nodeseek']]);
        }
      } finally {
        pendingBackfill.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        pendingPollNodeSeek.resolve({ quality: 'complete', items: [], cursor: null, hasMore: false });
        await resumePromise?.catch(() => undefined);
        await view.unmount();
        appQueryClient.clear();
        focusManager.setFocused(true);
        jest.useRealTimers();
      }
    }
  );

  it('backfills a newly confirmed source once in aggregate view when activeSources updates after initial load', async () => {
    appQueryClient.clear();
    focusManager.setFocused(true);
    const identities: Record<NotificationSource, string> = {
      nodeseek: 'nodeseek:1',
      linuxdo: 'linuxdo:2',
      yaohuo: 'yaohuo:3'
    };
    const identitySignature = 'nodeseek|linuxdo:nodeseek:1|linuxdo:2';
    const gateway = createNotificationGateway({
      adapters: {
        nodeseek: {
          listPage: jest.fn(async () => ({
            quality: 'complete' as const,
            items: [{ ...notification, source: 'nodeseek', id: 'ns-1', title: 'NodeSeek 首轮消息' }],
            cursor: null,
            hasMore: false
          }))
        } as unknown as NotificationAdapter,
        linuxdo: {
          listPage: jest.fn(async () => ({
            quality: 'complete' as const,
            items: [{ ...notification, source: 'linuxdo', id: 'ld-1', title: 'linuxdo 新确认消息' }],
            cursor: null,
            hasMore: false
          }))
        } as unknown as NotificationAdapter,
        yaohuo: {
          listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false }))
        } as unknown as NotificationAdapter
      },
      readAccess: (source) => ({
        identityKey: identities[source],
        userId: identities[source].split(':')[1]!
      }),
      privateAccessAllowed: () => true,
      sourceAllowed: () => true
    });
    const listAllPageSpy = jest.spyOn(gateway, 'listAllPage');
    const listPageSpy = jest.spyOn(gateway, 'listPage');

    const states = createSiteSessionStates();
    for (const site of ['nodeseek', 'linuxdo'] as const) {
      states[site] = {
        ...states[site],
        status: 'logged-in',
        currentUser: { ...testAccountUser(site), id: identities[site].split(':')[1]! }
      };
    }
    let currentRuntime: NotificationRouteRuntimeValue = {
      ...routeRuntime(gateway),
      enabledNotificationSources: ['nodeseek', 'linuxdo'],
      activeSources: ['nodeseek'],
      identityKeys: { nodeseek: identities.nodeseek, linuxdo: identities.linuxdo },
      identitySignature,
      sessions: projectTestAccountSessions(states)
    };
    currentRuntime.sessions.linuxdo = {
      ...currentRuntime.sessions.linuxdo,
      identityTrust: 'unknown',
      isVerifying: true
    };

    const tree = (value: NotificationRouteRuntimeValue) => (
      <NotificationRouteRuntimeProvider value={value}>
        <NavigationContainer>
          <NotificationsRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>
    );

    const view = await render(tree(currentRuntime), { wrapper: QueryTestWrapper });
    try {
      expect(await view.findByText('NodeSeek 首轮消息')).toBeTruthy();
      expect(listAllPageSpy).toHaveBeenCalledTimes(1);
      expect(listAllPageSpy).toHaveBeenCalledWith(expect.objectContaining({ sources: ['nodeseek'] }));
      expect(listPageSpy).not.toHaveBeenCalled();

      // linux.do finishes account confirmation while user stays on "全部".
      currentRuntime = {
        ...currentRuntime,
        activeSources: ['nodeseek', 'linuxdo'],
        sessions: {
          ...currentRuntime.sessions,
          linuxdo: { ...currentRuntime.sessions.linuxdo, identityTrust: 'confirmed', isVerifying: false }
        }
      };
      await view.rerender(tree(currentRuntime));

      expect(await view.findByText('linuxdo 新确认消息')).toBeTruthy();
      expect(listPageSpy).toHaveBeenCalledTimes(1);
      expect(listPageSpy).toHaveBeenCalledWith('linuxdo', expect.objectContaining({ cursor: undefined }));
      expect(listAllPageSpy).toHaveBeenCalledTimes(1);

      // Subsequent benign re-render must not duplicate the backfill.
      await view.rerender(tree({ ...currentRuntime }));
      expect(listPageSpy).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
      appQueryClient.clear();
    }
  });

  it('retries only the selected failed source in the aggregate list', async () => {
    appQueryClient.clear();
    const linuxdoNotification = { ...notification, source: 'linuxdo', id: 'reply:linuxdo' } as ForumNotification;
    const listAllPage = jest.fn(async () => ({
      qualities: {},
      items: [notification],
      pages: { nodeseek: { quality: 'complete' as const, items: [notification], cursor: null, hasMore: false } },
      errors: { linuxdo: { message: '暂不可用' } },
      nextCursors: { nodeseek: null, linuxdo: null },
      hasMore: false
    }));
    const listPage = jest.fn(async () => ({
      quality: 'complete' as const,
      items: [linuxdoNotification],
      cursor: null,
      hasMore: false
    }));
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByRole('button', { name: '重试 linux.do' })).toBeTruthy());
    await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));
    await waitFor(() => expect(view.queryByRole('button', { name: '重试 linux.do' })).toBeNull());
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
      qualities: {},
      items: [notification],
      pages: { nodeseek: { quality: 'complete' as const, items: [notification], cursor: 'ns-next', hasMore: true } },
      errors: { linuxdo: { message: '暂不可用' } },
      nextCursors: { nodeseek: 'ns-next', linuxdo: null },
      hasMore: true
    }));
    const listPage = jest.fn(async () => ({
      quality: 'complete' as const,
      items: [],
      cursor: 'linux-next',
      hasMore: true
    }));
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
            route={{ key: 'notifications', name: 'notifications', params: undefined }}
          />
        </NavigationContainer>
      </NotificationRouteRuntimeProvider>,
      { wrapper: QueryTestWrapper }
    );

    await waitFor(() => expect(view.getByRole('button', { name: '重试 linux.do' })).toBeTruthy());
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
    await fireEvent.press(view.getByRole('button', { name: '重试 linux.do' }));

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
    const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };

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
    const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };
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
    const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };
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
      const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };
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
      loadDetail: jest.fn(async () =>
        notificationAdapters.yaohuo.loadDetail(item, {
          identityKey: 'yaohuo:7',
          userId: '7',
          fetcher: async () =>
            new Response(`<div class="msgview-page" data-message-id="41" data-partner-id="9">
              <div class="chat-list"><div class="chat-msg chat-msg--in is-anchor" data-message-id="41">
                <div class="chat-bubble"><a href="/bbs/book_re.aspx?classid=177&amp;id=1560939&amp;tofloor=90&amp;fromuserid=1000">查看完整回复</a></div>
              </div></div></div>`)
        })
      ),
      markRead: jest.fn(async () => ({ confirmed: true }))
    } as unknown as NotificationRouteRuntimeValue['gateway'];
    const runtime = {
      ...routeRuntime(gateway),
      activeSources: ['yaohuo'] as const,
      identityKeys: { yaohuo: 'yaohuo:7' },
      identitySignature: 'yaohuo:7'
    } as NotificationRouteRuntimeValue;
    const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };
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
    const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };
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

  it('opens original and bubble links only while their private-message route is focused', async () => {
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
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<typeof Linking.addEventListener>(() => subscription);
    const linking = { addEventListener, getInitialURL: async () => null };
    function pushTopic(destination: { topic: Topic }) {
      if (!navigation.isReady()) return false;
      navigation.dispatch(StackActions.push('Topic', destination));
      return true;
    }
    function Navigator() {
      const onReady = useAppDeepLinkNavigation(linking, pushTopic);
      return (
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation} onReady={onReady}>
            <FocusTestStack.Navigator initialRouteName="NotificationDetail">
              <FocusTestStack.Screen
                name="NotificationDetail"
                initialParams={{ notification: item, identityKey: 'nodeseek:new-account' }}
              >
                {(props) => <NotificationDetailRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Topic">{() => <Text>新打开的主题</Text>}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>
      );
    }
    const openBrowserAsync = jest
      .spyOn(WebBrowser, 'openBrowserAsync')
      .mockResolvedValue({ type: WebBrowser.WebBrowserResultType.OPENED });
    const view = await render(<Navigator />, { wrapper: QueryTestWrapper });
    try {
      await waitFor(() => expect(view.getByRole('link', { name: '原消息外链' })).toBeTruthy());
      await fireEvent.press(view.getByRole('link', { name: '原消息外链' }));
      await fireEvent.press(view.getByRole('link', { name: '气泡外链' }));
      expect(openBrowserAsync).toHaveBeenNthCalledWith(1, 'https://example.com/original');
      expect(openBrowserAsync).toHaveBeenNthCalledWith(2, 'https://example.com/bubble');

      openBrowserAsync.mockClear();
      const [[, onUrl]] = addEventListener.mock.calls;
      await act(async () => {
        onUrl({ url: 'https://linux.do/t/176543' });
        expect(navigation.getCurrentRoute()?.name).toBe('Topic');
        await fireEvent.press(view.getByRole('link', { name: '原消息外链', includeHiddenElements: true }));
        await fireEvent.press(view.getByRole('link', { name: '气泡外链', includeHiddenElements: true }));
      });
      expect(openBrowserAsync).not.toHaveBeenCalled();

      await act(() => navigation.goBack());
      await fireEvent.press(await view.findByRole('link', { name: '原消息外链' }));
      await fireEvent.press(view.getByRole('link', { name: '气泡外链' }));
      expect(openBrowserAsync.mock.calls).toEqual([['https://example.com/original'], ['https://example.com/bubble']]);
      expect(runtime.notify).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
      openBrowserAsync.mockRestore();
      appQueryClient.clear();
    }
  });

  it('retries the private-message emoji catalog in place and reuses its success across composer mounts', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
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
      const getDiscourseEmojiUrls = jest
        .fn(async () => ({ heart: 'https://linux.do/network-heart.png' }))
        .mockRejectedValueOnce(new Error('temporary emoji failure'))
        .mockRejectedValueOnce(new Error('another emoji failure'));
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
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
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
      await fireEvent.changeText(first.getByLabelText('私信回复内容'), '表情等待期间保留的草稿');
      expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTimeAsync(1_000));
      expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTimeAsync(2_000));
      await waitFor(() =>
        expect(first.getByTestId('message-composer-emoji-heart').props.children).toBe(
          'https://linux.do/network-heart.png'
        )
      );
      expect(first.getByLabelText('私信回复内容').props.value).toBe('表情等待期间保留的草稿');
      expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(3);
      expect(runtime.notify).not.toHaveBeenCalled();
      await first.unmount();
      await act(async () => jest.advanceTimersByTimeAsync(31_001));

      const second = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <NotificationDetailRoute
              navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
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
      expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(3);
      await second.unmount();
    } finally {
      appQueryClient.setDefaultOptions(defaultOptions);
      appQueryClient.removeQueries({ queryKey: forumQueryKeys.emojiUrls('linuxdo'), exact: true });
      jest.useRealTimers();
    }
  });

  it.each(['background', 'blur'] as const)(
    'cancels pending private-message emoji reads on %s and ignores their result after reopening',
    async (interruption) => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      focusManager.setFocused(true);
      appQueryClient.clear();
      const oldRead = Promise.withResolvers<Record<string, string>>();
      const currentRead = Promise.withResolvers<Record<string, string>>();
      const getDiscourseEmojiUrls = jest
        .fn<NotificationRouteRuntimeValue['composer']['getDiscourseEmojiUrls']>()
        .mockReturnValueOnce(oldRead.promise)
        .mockReturnValueOnce(currentRead.promise);
      const privateNotification: ForumNotification = {
        ...notification,
        source: 'linuxdo',
        id: 'message:emoji-recovery',
        kind: 'private-message',
        unread: false,
        target: { type: 'private-conversation', conversationId: '9' }
      };
      const gateway = createNotificationGateway({
        adapters: {
          ...notificationAdapters,
          linuxdo: {
            ...notificationAdapters.linuxdo,
            loadDetail: async () => ({
              notification: privateNotification,
              title: 'linux.do 私信',
              messages: [],
              reply: { format: 'markdown' }
            }),
            markRead: async () => ({ confirmed: true })
          }
        },
        readAccess: () => ({ identityKey: 'linuxdo:alice', userId: 'alice', username: 'alice' }),
        sourceAllowed: () => true,
        privateAccessAllowed: () => true
      });
      const runtime = {
        ...routeRuntime(gateway),
        activeSources: ['linuxdo'],
        composer: { ...routeRuntime(gateway).composer, getDiscourseEmojiUrls },
        identityKeys: { linuxdo: 'linuxdo:alice' },
        identitySignature: 'linuxdo:alice'
      } satisfies NotificationRouteRuntimeValue;
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator initialRouteName="NotificationDetail">
              <FocusTestStack.Screen
                name="NotificationDetail"
                initialParams={{ notification: privateNotification, identityKey: 'linuxdo:alice' }}
              >
                {(props) => <NotificationDetailRoute navigation={props.navigation as never} route={props.route} />}
              </FocusTestStack.Screen>
              <FocusTestStack.Screen name="Other">{() => null}</FocusTestStack.Screen>
            </FocusTestStack.Navigator>
          </NavigationContainer>
        </NotificationRouteRuntimeProvider>,
        { wrapper: QueryTestWrapper }
      );
      try {
        await waitFor(() => expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(1));
        const oldSignal = getDiscourseEmojiUrls.mock.calls[0][0].signal;
        expect(oldSignal?.aborted).toBe(false);
        if (interruption === 'background') await act(async () => focusManager.setFocused(false));
        else await act(async () => navigation.navigate('Other'));
        expect(oldSignal?.aborted).toBe(true);
        await act(async () => jest.advanceTimersByTimeAsync(31_000));
        expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(1);
        if (interruption === 'background') await act(async () => focusManager.setFocused(true));
        else await act(async () => navigation.goBack());
        await waitFor(() => expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(2));
        await act(async () => oldRead.resolve({ heart: 'https://linux.do/stale-heart.png' }));
        expect(appQueryClient.getQueryData(forumQueryKeys.emojiUrls('linuxdo'))).toBeUndefined();
        await act(async () => currentRead.resolve({ heart: 'https://linux.do/current-heart.png' }));
        await fireEvent.press(view.getByLabelText('回复私信'));
        await waitFor(() =>
          expect(view.getByTestId('message-composer-emoji-heart').props.children).toBe(
            'https://linux.do/current-heart.png'
          )
        );
        await act(async () => jest.advanceTimersByTimeAsync(31_000));
        expect(getDiscourseEmojiUrls).toHaveBeenCalledTimes(2);
        expect(runtime.notify).not.toHaveBeenCalled();
      } finally {
        await view.unmount();
        oldRead.resolve({});
        currentRead.resolve({});
        appQueryClient.clear();
        focusManager.setFocused(true);
        jest.useRealTimers();
      }
    }
  );

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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
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
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(
      <NotificationRouteRuntimeProvider value={runtime}>
        <NavigationContainer>
          <NotificationDetailRoute
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
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
    expect(view.getByText('暂无私信')).toBeTruthy();
    expect(view.queryByLabelText('私信回复内容')).toBeNull();
    expect(gateway.markRead).not.toHaveBeenCalled();
    expect(gateway.listPage).not.toHaveBeenCalled();
    expect(runtime.refreshSnapshots).not.toHaveBeenCalled();
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
    await fireEvent.press(view.getByLabelText('测试发送私信'));
    expect(replyToConversation).toHaveBeenCalledTimes(2);
    expect(replyToConversation.mock.calls[0]).toEqual([
      privateNotification,
      'PRIVATE_DRAFT',
      'nodeseek:new-account',
      expect.any(AbortSignal),
      { mayHaveSent: false }
    ]);
    const confirmation = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === '仍要重发');
    expect(confirmation).toBeDefined();
    await act(async () => confirmation?.onPress?.());
    await waitFor(() => expect(runtime.notify).toHaveBeenCalledWith('回复已发送'));
    expect(view.queryByLabelText('私信回复内容')).toBeNull();
    await fireEvent.press(view.getByLabelText('发私信'));
    expect(view.getByLabelText('私信回复内容').props.value).toBe('');
    expect(runtime.refreshSnapshots).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it.each(['unsent', 'rejected', 'unknown', 'network', 'aborted', 'stale-access'] as const)(
    'retries a private reply safely after a real %s result without replaying a stale confirmation',
    async (outcome) => {
      appQueryClient.clear();
      focusManager.setFocused(true);
      const privateNotification: ForumNotification = {
        ...notification,
        id: 'conversation:9',
        kind: 'private-message',
        unread: false,
        target: { type: 'private-conversation', conversationId: '9' }
      };
      let attempts = 0;
      let privateAccessAllowed = true;
      const sentBodies: string[] = [];
      const fetcher: Fetcher = async (_url, init) => {
        attempts += 1;
        if (attempts === 1 && outcome === 'unsent') throw new Error('transport preparation failed');
        const request = prepareRequestToSend(init);
        sentBodies.push(String(request?.body));
        if (attempts > 1) return new Response(JSON.stringify({ success: true }));
        if (outcome === 'network') throw new Error('response lost after dispatch');
        if (outcome === 'stale-access') {
          privateAccessAllowed = false;
          return new Response(JSON.stringify({ success: true }));
        }
        if (outcome === 'aborted') {
          return new Promise<Response>((_resolve, reject) => {
            request?.signal?.addEventListener('abort', () => reject(new Error('response canceled')), { once: true });
          });
        }
        return new Response(JSON.stringify(outcome === 'rejected' ? { success: false, message: '发送失败' } : {}));
      };
      const loadDetail = jest.fn(async () => ({
        notification: privateNotification,
        title: '私信详情',
        messages: [],
        reply: { format: 'markdown' as const }
      }));
      const gateway = createNotificationGateway({
        adapters: { ...notificationAdapters, nodeseek: { ...notificationAdapters.nodeseek, loadDetail } },
        privateAccessAllowed: () => privateAccessAllowed,
        sourceAllowed: () => true,
        readAccess: () => ({ identityKey: 'nodeseek:new-account', userId: 'new-account', fetcher })
      });
      const runtime = routeRuntime(gateway);
      const navigation = createNavigationContainerRef<FocusTestStackParamList>();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const view = await render(
        <NotificationRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigation}>
            <FocusTestStack.Navigator>
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
      try {
        await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
        await fireEvent.press(view.getByLabelText('发私信'));
        await fireEvent.changeText(view.getByLabelText('私信回复内容'), '只发送一次');
        await fireEvent.press(view.getByLabelText('测试发送私信'));
        await waitFor(() => expect(attempts).toBe(1));
        if (outcome === 'aborted') {
          await act(async () => navigation.navigate('Other'));
          await act(async () => navigation.goBack());
        }
        if (outcome === 'stale-access') {
          await waitFor(() => expect(view.getByText(/登录状态|账号状态/)).toBeTruthy());
          privateAccessAllowed = true;
        }
        await waitFor(() => expect(view.getByLabelText('测试发送私信').props.onPress).toBeDefined());
        await fireEvent.press(view.getByLabelText('测试发送私信'));
        const uncertain = !['unsent', 'rejected'].includes(outcome);
        if (uncertain) {
          expect(attempts).toBe(1);
          expect(alert).toHaveBeenCalledWith(
            '私信可能已发送',
            expect.any(String),
            expect.any(Array),
            expect.objectContaining({ onDismiss: expect.any(Function) })
          );
          const review = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === '核对会话');
          expect(review).toBeDefined();
          const readsBeforeReview = loadDetail.mock.calls.length;
          await act(async () => review?.onPress?.());
          await waitFor(() => expect(loadDetail.mock.calls.length).toBeGreaterThan(readsBeforeReview));
          expect(attempts).toBe(1);
          await fireEvent.press(view.getByLabelText('继续编辑私信草稿'));
          await fireEvent.press(view.getByLabelText('测试发送私信'));
          const staleConfirm = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === '仍要重发');
          await act(async () => navigation.navigate('Other'));
          await act(async () => navigation.goBack());
          await act(async () => staleConfirm?.onPress?.());
          expect(attempts).toBe(1);
          await fireEvent.press(view.getByLabelText('测试发送私信'));
          const confirm = alert.mock.calls.at(-1)?.[2]?.find((button) => button.text === '仍要重发');
          await act(async () => {
            confirm?.onPress?.();
            confirm?.onPress?.();
          });
        } else expect(alert).not.toHaveBeenCalled();
        await waitFor(() => expect(runtime.notify).toHaveBeenCalledWith('回复已发送'));
        expect(attempts).toBe(2);
        expect(sentBodies).toHaveLength(outcome === 'unsent' ? 1 : 2);
        expect(view.queryByLabelText('私信回复内容')).toBeNull();
      } finally {
        alert.mockRestore();
        await view.unmount();
        focusManager.setFocused(true);
      }
    }
  );

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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
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
    await fireEvent.press(view.getByLabelText('继续编辑私信草稿'));
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

  it('lets the private-message fixture pick and mock-upload an image without sending or losing the draft on cancellation', async () => {
    appQueryClient.clear();
    mockGetDocumentAsync.mockReset();
    mockGetDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///reply.png', name: 'reply.png', mimeType: 'image/png', size: 512, lastModified: 0 }]
    });
    const transport = createComposerTransport('success', false, 0, true);
    const prepareImage = jest
      .spyOn(uploadImagePreparation, 'prepareUploadImage')
      .mockImplementation(async (file) => ({ file: { ...file, size: 512 }, cleanup() {} }));
    const realNetwork = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('The composer fixture must not use the real network');
    });
    const view = await render(<MessageSubmissionFixture transport={transport} />, { wrapper: QueryTestWrapper });
    try {
      await waitFor(() => expect(view.getByLabelText('发私信')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('发私信'));
      await fireEvent.changeText(view.getByLabelText('私信回复内容'), COMPOSER_DRAFT);
      await fireEvent.press(view.getByLabelText('测试上传图片'));
      await waitFor(() => expect(mockGetDocumentAsync).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(transport.uploads).toBe(1));
      const uploadedDraft = `${COMPOSER_DRAFT}![reply.png](https://example.invalid/composer-proof.png)`;
      expect(view.getByLabelText('私信回复内容').props.value).toBe(uploadedDraft);
      expect(view.getByText('图片已插入草稿')).toBeTruthy();

      mockGetDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
      await fireEvent.press(view.getByLabelText('测试上传图片'));
      await waitFor(() => expect(mockGetDocumentAsync).toHaveBeenCalledTimes(2));
      expect(view.getByLabelText('私信回复内容').props.value).toBe(uploadedDraft);
      expect(transport.uploads).toBe(1);
      expect(transport.requests).toHaveLength(0);
      expect(transport.confirmations).toBe(0);
      expect(realNetwork).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
      transport.dispose();
      prepareImage.mockRestore();
      realNetwork.mockRestore();
    }
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
            navigation={{ navigate: jest.fn(), setParams: jest.fn() } as never}
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
      listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false })),
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
    const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };
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
      listPage: jest.fn(async () => ({ quality: 'complete' as const, items: [], cursor: null, hasMore: false })),
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
      name: 'notifications' as const,
      params: { source: 'nodeseek' as const }
    };
    const navigation = { navigate: jest.fn(), setParams: jest.fn(), isFocused: () => true };
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

  it.each([
    { status: 403, unconfirmed: false },
    { status: 408, unconfirmed: true },
    { status: 409, unconfirmed: true },
    { status: 503, unconfirmed: true }
  ])('retries a LinuxDo private reply according to the HTTP $status receipt', async ({ status, unconfirmed }) => {
    appQueryClient.clear();
    focusManager.setFocused(true);
    const item: ForumNotification = {
      ...notification,
      source: 'linuxdo',
      id: 'pm:9',
      kind: 'private-message',
      unread: false,
      target: { type: 'private-conversation', conversationId: '9' }
    };
    let posts = 0;
    const fetcher: Fetcher = async (url, init) => {
      const request = prepareRequestToSend(init);
      if (url === 'https://linux.do/session/csrf') return new Response('{"csrf":"fixture"}');
      expect(url).toBe('https://linux.do/posts.json');
      expect(request?.method).toBe('POST');
      posts++;
      return posts === 1 ? new Response('{"errors":["发送请求返回异常"]}', { status }) : new Response('{"id":20}');
    };
    const loadDetail = jest.fn(async () => ({
      notification: item,
      title: '私信详情',
      messages: [],
      reply: { format: 'markdown' as const }
    }));
    const gateway = createNotificationGateway({
      adapters: { ...notificationAdapters, linuxdo: { ...notificationAdapters.linuxdo, loadDetail } },
      privateAccessAllowed: () => true,
      sourceAllowed: (source) => source === 'linuxdo',
      readAccess: () => ({ identityKey: 'linuxdo:7', userId: '7', userAgent: 'fixture', fetcher })
    });
    const runtime: NotificationRouteRuntimeValue = {
      ...routeRuntime(gateway),
      activeSources: ['linuxdo'],
      identityKeys: { linuxdo: 'linuxdo:7' },
      identitySignature: 'linuxdo:7'
    };
    const navigation = createNavigationContainerRef<FocusTestStackParamList>();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const view = await render(linuxDoDetailTree(runtime, item, navigation), { wrapper: QueryTestWrapper });
    try {
      await waitFor(() => expect(view.getByLabelText('回复私信')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('回复私信'));
      await fireEvent.changeText(view.getByLabelText('私信回复内容'), '待发送私信');
      await fireEvent.press(view.getByLabelText('测试发送私信'));
      await waitFor(() => expect(view.getByText(/发送请求返回异常/)).toBeTruthy());
      expect(posts).toBe(1);
      expect(Boolean(view.queryByText(/发送结果未确认/))).toBe(unconfirmed);
      await fireEvent.press(view.getByLabelText('测试发送私信'));
      if (unconfirmed) {
        expect(posts).toBe(1);
        expect(alert).toHaveBeenCalledWith('私信可能已发送', expect.any(String), expect.any(Array), expect.any(Object));
      } else {
        await waitFor(() => expect(posts).toBe(2));
        expect(alert).not.toHaveBeenCalled();
      }
    } finally {
      await view.unmount();
      alert.mockRestore();
      focusManager.setFocused(undefined);
      appQueryClient.clear();
    }
  });
});
