import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ReactNode } from 'react';
import { StackActions } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Topic, UserReference } from '@/domain/forum/models';
import type { ForumNotification } from '@/domain/notifications/models';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { MoreRoute, MoreRouteRuntimeProvider, type MoreRouteRuntimeValue } from '@/features/more/MoreRoute';
import {
  NotificationDetailRoute,
  NotificationRouteRuntimeProvider,
  type NotificationRouteRuntimeValue
} from '@/features/notifications/NotificationRoute';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { useTopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { useImagePreviewController } from '@/features/topic/media/useImagePreviewController';
import { UserRoute, UserRouteRuntimeProvider, type UserRouteRuntimeValue } from '@/features/user/UserRoute';
import { useUserController } from '@/features/user/useUserController';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { act, fireEvent, render, waitFor } from '../render';

const mockTopicScreen = jest.fn((_props: unknown) => null);
const mockMoreNavigation = { replaceParams: jest.fn() };
let mockMoreRouteParams: { intent?: 'manage-content-sources' } | undefined;
let mockMoreFocused = true;
let mockMoreUtilities: {
  proxy: { open: () => void; visible: boolean };
  settings: { changeVisible: (visible: boolean) => void; visible: boolean };
} | null = null;

jest.mock('@react-navigation/native', () => ({
  ...(jest.requireActual('@react-navigation/native') as Record<string, unknown>),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(() => {
      if (!mockMoreFocused) return;
      return effect();
    }, [effect, mockMoreFocused]);
  },
  useIsFocused: () => mockMoreFocused,
  useNavigation: () => mockMoreNavigation,
  usePreventRemove: jest.fn(),
  useRoute: () => ({ params: mockMoreRouteParams }),
  useScrollToTop: jest.fn()
}));
jest.mock('@/features/topic/useTopicController', () => ({ useTopicController: jest.fn() }));
jest.mock('@/features/topic/useTopicSessionController', () => ({ useTopicSessionController: jest.fn() }));
jest.mock('@/features/topic/actions/useTopicActionsController', () => ({ useTopicActionsController: jest.fn() }));
jest.mock('@/features/topic/rendering/useHtmlRenderingController', () => ({ useHtmlRenderingController: jest.fn() }));
jest.mock('@/features/topic/media/useImagePreviewController', () => ({ useImagePreviewController: jest.fn() }));
jest.mock('@/ui/media/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
jest.mock('@/features/topic/TopicScreen', () => ({ TopicScreen: (props: unknown) => mockTopicScreen(props) }));
jest.mock('@/features/user/UserScreen', () => ({ UserScreen: () => null }));
jest.mock('@/features/user/useUserController', () => ({ useUserController: jest.fn() }));
jest.mock('@/features/notifications/NotificationScreens', () => ({
  NotificationDetailScreen: () => null,
  NotificationSettingsScreen: () => null,
  NotificationsScreen: () => null
}));
jest.mock('@/features/more/components/MoreAccountPanel', () => ({ MoreAccountPanel: () => null }));
jest.mock('@/features/more/components/MoreUpdatePanel', () => ({ MoreUpdatePanel: () => null }));
jest.mock('@/features/more/components/MoreUtilityPanels', () => ({
  MoreUtilityPanels: ({ runtime }: { runtime: typeof mockMoreUtilities }) => {
    mockMoreUtilities = runtime;
    return null;
  }
}));
jest.mock('react-native-gesture-handler', () => {
  return {
    Gesture: {
      Pan: () => ({
        activateAfterLongPress() {
          return this;
        },
        runOnJS() {
          return this;
        },
        onStart() {
          return this;
        },
        onUpdate() {
          return this;
        },
        onFinalize() {
          return this;
        }
      })
    },
    GestureDetector: ({ children }: { children: ReactNode }) => children
  };
});
jest.mock('react-native-webview', () => ({ WebView: () => null }));

const topic: Topic = {
  source: 'yaohuo',
  id: '42',
  title: '停用来源主题',
  author: 'alice',
  url: 'https://www.yaohuo.me/bbs-42.html',
  createdAt: '2026-01-01T00:00:00.000Z',
  replyCount: 0
};
const user: UserReference = {
  source: 'yaohuo',
  id: '7',
  username: 'alice',
  url: 'https://www.yaohuo.me/user-7.html'
};
const notification: ForumNotification = {
  source: 'yaohuo',
  id: '42',
  kind: 'reply',
  actor: { name: 'alice' },
  title: '停用来源消息',
  createdAt: null,
  unread: true,
  target: { type: 'information' }
};

const expectedManageContentSourcesAction = manageContentSourcesAction();

beforeEach(() => {
  mockMoreFocused = true;
  mockMoreRouteParams = undefined;
  mockMoreUtilities = null;
  mockMoreNavigation.replaceParams.mockClear();
});

function disabledReaderData() {
  const data = createEmptyReaderData();
  return {
    ...data,
    settings: {
      ...data.settings,
      contentSources: data.settings.contentSources.map((preference) =>
        preference.source === 'yaohuo' ? { ...preference, enabled: false } : preference
      )
    }
  };
}

describe('disabled content source route gates', () => {
  it('blocks a disabled Topic route before topic controllers mount', async () => {
    const dispatch = jest.fn();
    const goBack = jest.fn();
    const data = disabledReaderData();
    const navigation = { dispatch, goBack } as unknown as NativeStackScreenProps<
      RootStackParamList,
      'Topic'
    >['navigation'];
    const route = { key: 'topic', name: 'Topic', params: { topic } } as const;

    const view = await render(
      <TopicRouteRuntimeProvider value={{ reader: { data } } as unknown as TopicRouteRuntimeValue}>
        <TopicRoute navigation={navigation} route={route} />
      </TopicRouteRuntimeProvider>
    );

    expect(view.getByText('妖火已停用')).toBeTruthy();
    expect(view.getByText('该内容源已停用，启用后才能查看此内容。')).toBeTruthy();
    expect(useTopicSessionController).not.toHaveBeenCalled();
    expect(useTopicController).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('管理内容源'));
    expect(expectedManageContentSourcesAction).toEqual(
      StackActions.popTo('MainTabs', { screen: 'more', params: { intent: 'manage-content-sources' } })
    );
    expect(dispatch).toHaveBeenCalledWith(expectedManageContentSourcesAction);
    await fireEvent.press(view.getByLabelText('返回'));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('blocks a disabled User route before the user controller mounts', async () => {
    const dispatch = jest.fn();
    const goBack = jest.fn();
    const data = disabledReaderData();
    const navigation = { dispatch, goBack } as unknown as NativeStackScreenProps<
      RootStackParamList,
      'User'
    >['navigation'];
    const route = { key: 'user', name: 'User', params: { user } } as const;

    const view = await render(
      <UserRouteRuntimeProvider value={{ reader: { data } } as unknown as UserRouteRuntimeValue}>
        <UserRoute navigation={navigation} route={route} />
      </UserRouteRuntimeProvider>
    );

    expect(view.getByText('妖火已停用')).toBeTruthy();
    expect(view.getByText('该内容源已停用，启用后才能查看此内容。')).toBeTruthy();
    expect(useUserController).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('管理内容源'));
    expect(dispatch).toHaveBeenCalledWith(expectedManageContentSourcesAction);
    await fireEvent.press(view.getByLabelText('返回'));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('routes a disabled NotificationDetail through the same content-source management intent', async () => {
    const dispatch = jest.fn();
    const goBack = jest.fn();
    const navigation = { dispatch, goBack } as unknown as NativeStackScreenProps<
      RootStackParamList,
      'NotificationDetail'
    >['navigation'];
    const route = {
      key: 'notification',
      name: 'NotificationDetail',
      params: { identityKey: 'yaohuo:alice', notification }
    } as const;

    const view = await render(
      <NotificationRouteRuntimeProvider
        value={{ enabledNotificationSources: [] } as unknown as NotificationRouteRuntimeValue}
      >
        <NotificationDetailRoute navigation={navigation} route={route} />
      </NotificationRouteRuntimeProvider>
    );

    expect(view.getByText('妖火已停用')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('管理内容源'));
    expect(dispatch).toHaveBeenCalledWith(expectedManageContentSourcesAction);
    await fireEvent.press(view.getByLabelText('返回'));
    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('[REG-SOURCE-012] expands only for the management intent and then preserves local panel state', async () => {
    const data = createEmptyReaderData();
    const runtime = {
      account: { surfaces: { closeAll: jest.fn() } },
      diagnostics: { getCurrentScreen: () => 'more', metadata: {} },
      notify: jest.fn(),
      notifications: {},
      proxy: {},
      reader: {
        commit: jest.fn(),
        data,
        dataRef: { current: data },
        replace: jest.fn(async () => undefined),
        waitForSave: jest.fn(async () => undefined)
      },
      update: {}
    } as unknown as MoreRouteRuntimeValue;
    const tree = () => (
      <MoreRouteRuntimeProvider value={runtime}>
        <MoreRoute />
      </MoreRouteRuntimeProvider>
    );
    mockMoreNavigation.replaceParams.mockClear();
    mockMoreRouteParams = undefined;

    const view = await render(tree());

    expect(view.getByLabelText('展开内容源').props.accessibilityState.expanded).toBe(false);
    mockMoreRouteParams = { intent: 'manage-content-sources' };
    await view.rerender(tree());
    await waitFor(() => expect(view.getByLabelText('收起内容源').props.accessibilityState.expanded).toBe(true));
    expect(mockMoreNavigation.replaceParams).toHaveBeenCalledWith({});

    mockMoreRouteParams = undefined;
    await view.rerender(tree());
    expect(view.getByLabelText('收起内容源').props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(view.getByLabelText('收起内容源'));
    await view.rerender(tree());
    expect(view.getByLabelText('展开内容源').props.accessibilityState.expanded).toBe(false);
  });

  it('[REG-ACCOUNT-043] closes global account surfaces only after More really loses focus', async () => {
    const data = createEmptyReaderData();
    const firstCloseAll = jest.fn();
    const secondCloseAll = jest.fn();
    const latestCloseAll = jest.fn();
    let runtime = {
      account: { surfaces: { closeAll: firstCloseAll } },
      diagnostics: { getCurrentScreen: () => 'more', metadata: {} },
      notify: jest.fn(),
      notifications: {},
      proxy: {},
      reader: {
        commit: jest.fn(),
        data,
        dataRef: { current: data },
        replace: jest.fn(async () => undefined),
        waitForSave: jest.fn(async () => undefined)
      },
      update: {}
    } as unknown as MoreRouteRuntimeValue;
    const tree = () => (
      <MoreRouteRuntimeProvider value={runtime}>
        <MoreRoute />
      </MoreRouteRuntimeProvider>
    );

    mockMoreFocused = false;
    const view = await render(tree());
    expect(firstCloseAll).not.toHaveBeenCalled();

    runtime = {
      ...runtime,
      account: { ...runtime.account, surfaces: { ...runtime.account.surfaces, closeAll: secondCloseAll } }
    };
    await view.rerender(tree());
    expect(firstCloseAll).not.toHaveBeenCalled();
    expect(secondCloseAll).not.toHaveBeenCalled();

    mockMoreFocused = true;
    await view.rerender(tree());
    expect(secondCloseAll).not.toHaveBeenCalled();

    runtime = {
      ...runtime,
      account: { ...runtime.account, surfaces: { ...runtime.account.surfaces, closeAll: latestCloseAll } }
    };
    await view.rerender(tree());
    expect(secondCloseAll).not.toHaveBeenCalled();
    expect(latestCloseAll).not.toHaveBeenCalled();

    await act(async () => {
      mockMoreUtilities?.proxy.open();
      mockMoreUtilities?.settings.changeVisible(true);
    });
    expect(mockMoreUtilities?.proxy.visible).toBe(true);
    expect(mockMoreUtilities?.settings.visible).toBe(true);

    mockMoreFocused = false;
    await view.rerender(tree());
    expect(latestCloseAll).toHaveBeenCalledTimes(1);
    expect(mockMoreUtilities?.proxy.visible).toBe(false);
    expect(mockMoreUtilities?.settings.visible).toBe(false);
  });

  it('[REG-PROXY-011][REG-TOPIC-076] remounts Topic media and leaves route targets to the controller', async () => {
    const data = createEmptyReaderData();
    const enabledTopic: Topic = {
      ...topic,
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-42-1'
    };
    jest.mocked(useTopicSessionController).mockReturnValue({
      state: { replyComposerOpen: false, selectedTopic: enabledTopic },
      commands: {
        composer: { toggle: jest.fn() },
        view: {
          changeCommentQuery: jest.fn(),
          changeReplyFilter: jest.fn(),
          rememberScrollY: jest.fn()
        }
      }
    } as never);
    const locateReply = jest.fn();
    jest.mocked(useTopicController).mockReturnValue({
      loadedQuotedReplies: {},
      locateReply,
      openTopic: jest.fn(),
      refreshTopicReplies: jest.fn(),
      refreshWholeTopic: jest.fn(),
      topicBusy: false,
      topicDetail: null,
      topicError: null,
      topicFavorite: false,
      topicQueryKey: ['forum', 'nodeseek', 'topic'],
      topicReplies: []
    } as never);
    jest.mocked(useTopicActionsController).mockReturnValue({} as never);
    jest.mocked(useHtmlRenderingController).mockReturnValue({
      inlineSizedImageUrls: [],
      topicImageDeriver: jest.fn()
    } as never);
    jest.mocked(useImagePreviewController).mockReturnValue({
      closeImagePreview: jest.fn(),
      imagePreview: null,
      openImagePreview: jest.fn(),
      savePreviewImage: jest.fn(),
      selectPreviewImage: jest.fn()
    } as never);
    const navigation = {
      addListener: jest.fn(() => jest.fn()),
      dispatch: jest.fn(),
      goBack: jest.fn(),
      push: jest.fn(),
      setParams: jest.fn()
    } as unknown as NativeStackScreenProps<RootStackParamList, 'Topic'>['navigation'];
    const route = { key: 'topic', name: 'Topic', params: { topic: enabledTopic } } as const;
    const runtime = {
      account: {
        ensureNodeImageApiKey: jest.fn(),
        getLinuxDoUserAgent: jest.fn(() => ''),
        getNodeSeekUserAgent: jest.fn(() => ''),
        nodeSeekUserId: null,
        readGateway: { getEmojiUrls: jest.fn() },
        reconcileAccountStatus: jest.fn(),
        requestNodeSeekVerification: jest.fn(),
        sessionEpochs: initialForumSessionEpochs,
        sessionViewModels: { nodeseek: { currentUser: null } },
        showLinuxDoVerification: jest.fn(),
        showYaohuoLogin: jest.fn()
      },
      appActive: true,
      contentWidth: 360,
      ensureNetworkProxyReady: jest.fn(),
      fetcher: jest.fn(),
      networkProxyWebViewBlockMessage: '',
      nodeSeekMediaUserAgent: '',
      notify: jest.fn(),
      reader: { commit: jest.fn(), data, dataRef: { current: data } },
      readerStyle: { settings: data.settings, theme: {} }
    } as unknown as TopicRouteRuntimeValue;
    const tree = (transportIdentity: string) => (
      <ForumSessionEpochProvider sessionEpochs={initialForumSessionEpochs} transportIdentity={transportIdentity}>
        <TopicRouteRuntimeProvider value={runtime}>
          <TopicRoute navigation={navigation} route={route} />
        </TopicRouteRuntimeProvider>
      </ForumSessionEpochProvider>
    );

    mockTopicScreen.mockClear();
    const view = await render(tree('loading'));
    const loadingIdentity = (mockTopicScreen.mock.calls.at(-1)?.[0] as { html: { mediaSessionIdentity: string } }).html
      .mediaSessionIdentity;
    await view.rerender(tree('applied'));
    const appliedIdentity = (mockTopicScreen.mock.calls.at(-1)?.[0] as { html: { mediaSessionIdentity: string } }).html
      .mediaSessionIdentity;

    expect(loadingIdentity).toMatch(/:loading$/);
    expect(appliedIdentity).toMatch(/:applied$/);
    expect(appliedIdentity).not.toBe(loadingIdentity);

    const onOpenTopic = jest.mocked(useHtmlRenderingController).mock.calls.at(-1)?.[0].onOpenTopic;
    onOpenTopic?.(enabledTopic, { floor: 9 });
    expect(navigation.setParams).toHaveBeenCalledWith({ targetReply: { floor: 9 } });
    expect(locateReply).not.toHaveBeenCalled();
  });
});
