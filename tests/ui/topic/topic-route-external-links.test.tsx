import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ComponentProps, ReactNode } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppState, Linking, Pressable, Share, Text } from 'react-native';
import RenderHTML from 'react-native-render-html';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { navigationRef } from '@/app/appNavigation';
import { LinuxDoPacketPage } from '@/features/topic/components/LinuxDoPacketPage';
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';
import type { Topic, TopicDetail } from '@/domain/forum/models';
import { createEmptyReaderData, topicKey } from '@/domain/reader/readerData';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import { useTopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { useImagePreviewController } from '@/features/topic/media/useImagePreviewController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import type { TopicScreen } from '@/features/topic/TopicScreen';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import { ImagePreviewModal } from '@/ui/media/ImagePreviewModal';
import { saveImageUriToLibrary } from '@/platform/media/imageSave';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { createTheme } from '@/ui/theme/tokens';
import { act, fireEvent, render, waitFor } from '../render';

const mockTopicScreen = jest.fn<(_props: ComponentProps<typeof TopicScreen>) => ReactNode>(() => null);
let mockFocused = true;
let mockReadTopicFocus = () => mockFocused;

jest.mock('@react-navigation/native', () => ({
  ...(jest.requireActual('@react-navigation/native') as Record<string, unknown>),
  useIsFocused: () => mockReadTopicFocus(),
  usePreventRemove: jest.fn(),
  useScrollToTop: jest.fn()
}));
jest.mock('@/features/topic/useTopicController', () => ({ useTopicController: jest.fn() }));
jest.mock('@/features/topic/useTopicSessionController', () => ({ useTopicSessionController: jest.fn() }));
jest.mock('@/features/topic/actions/useTopicActionsController', () => ({ useTopicActionsController: jest.fn() }));
jest.mock('@/features/topic/media/useImagePreviewController', () => ({ useImagePreviewController: jest.fn() }));
jest.mock('@/features/topic/TopicScreen', () => ({
  TopicScreen: (props: ComponentProps<typeof TopicScreen>) => mockTopicScreen(props)
}));
jest.mock('@/ui/media/ImagePreviewModal', () => ({ ImagePreviewModal: jest.fn(() => null) }));
jest.mock('@/platform/media/imageSave', () => ({ saveImageUriToLibrary: jest.fn(async () => undefined) }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('@shopify/flash-list', () => ({ useRecyclingState: (initialValue: unknown) => [initialValue, jest.fn()] }));
jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

const topic: Topic = {
  source: 'nodeseek',
  id: '42',
  title: 'External link topic',
  author: 'alice',
  url: 'https://www.nodeseek.com/post-42-1',
  createdAt: '2026-08-20T00:00:00.000Z',
  replyCount: 0
};

const detail: TopicDetail = {
  ...topic,
  title: 'Loaded topic title',
  contentHtml: '<p>当前主题正文</p>',
  replies: []
};

beforeEach(() => {
  mockFocused = true;
  mockReadTopicFocus = () => mockFocused;
  jest.mocked(ImagePreviewModal).mockImplementation(() => null);
  jest.mocked(saveImageUriToLibrary).mockClear();
  mockTopicScreen.mockReset();
  mockTopicScreen.mockImplementation(() => null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function latestScreen() {
  const props = mockTopicScreen.mock.calls.at(-1)?.[0];
  if (!props) throw new Error('Topic screen was not rendered');
  return props;
}

function setup(topicDetail: TopicDetail | null = null, routeTopic = topic) {
  const data = createEmptyReaderData();
  jest.mocked(useTopicSessionController).mockReturnValue({
    state: { replyComposerIntent: { kind: 'closed' }, selectedTopic: routeTopic },
    commands: {
      composer: { toggle: jest.fn() },
      view: {
        changeCommentQuery: jest.fn(),
        changeReplyFilter: jest.fn()
      }
    }
  } as never);
  const controller = {
    readingEntry: { location: undefined },
    openTopic: jest.fn(),
    refreshTopicReplies: jest.fn(),
    refreshWholeTopic: jest.fn(),
    topicBusy: false,
    topicDetail,
    topicError: null,
    topicFavorite: false,
    topicQueryKey: ['forum', routeTopic.source, 'topic'],
    topicReplies: []
  };
  jest.mocked(useTopicController).mockReturnValue(controller as never);
  jest.mocked(useTopicActionsController).mockReturnValue({} as never);
  jest.mocked(useImagePreviewController).mockReturnValue({
    closeImagePreview: jest.fn(),
    imagePreview: null,
    openImagePreview: jest.fn(),
    registerImagePreviewDescriptors: jest.fn(),
    savePreviewImage: jest.fn(),
    selectPreviewImage: jest.fn()
  } as never);
  const notify = jest.fn();
  const runtime = {
    account: {
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
    notify,
    enabledSources: ['linuxdo', 'nodeseek', 'yaohuo', 'v2ex'],
    reader: { commit: jest.fn(), data, dataRef: { current: data } },
    readerStyle: { settings: data.settings, theme: createTheme(data.settings) }
  } as unknown as TopicRouteRuntimeValue;
  const navigation = {
    addListener: jest.fn(() => jest.fn()),
    dispatch: jest.fn(),
    goBack: jest.fn(),
    isFocused: () => true,
    push: jest.fn(),
    setParams: jest.fn()
  } as unknown as NativeStackScreenProps<RootStackParamList, 'Topic'>['navigation'];
  const element = (
    value = runtime,
    currentTopic = routeTopic,
    sessionEpochs = initialForumSessionEpochs,
    transportIdentity = 'applied'
  ) => (
    <ForumSessionEpochProvider sessionEpochs={sessionEpochs} transportIdentity={transportIdentity}>
      <TopicRouteRuntimeProvider value={value}>
        <TopicRoute navigation={navigation} route={{ key: 'topic', name: 'Topic', params: { topic: currentTopic } }} />
      </TopicRouteRuntimeProvider>
    </ForumSessionEpochProvider>
  );
  return { controller, element, notify, runtime };
}

async function renderWarmTopic(
  opening: TopicDetail,
  renderScreen: (props: ComponentProps<typeof TopicScreen>) => ReactNode
) {
  const { controller, runtime } = setup(opening, opening);
  mockReadTopicFocus =
    jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native').useIsFocused;
  jest
    .mocked(useTopicController)
    .mockImplementation(
      ({ topic: selected }) => ({ ...controller, topicDetail: selected.id === opening.id ? opening : null }) as never
    );
  mockTopicScreen.mockImplementation((props) => (props.article.topic?.id === opening.id ? renderScreen(props) : null));
  const subscription = Linking.addEventListener('url', () => {});
  const addEventListener = jest.fn<typeof Linking.addEventListener>(() => subscription);
  const linking = { addEventListener, getInitialURL: async () => null };
  const Stack = createNativeStackNavigator<RootStackParamList>();
  function WarmTopicNavigator() {
    const onReady = useAppDeepLinkNavigation(linking);
    return (
      <ForumSessionEpochProvider sessionEpochs={initialForumSessionEpochs} transportIdentity="default">
        <TopicRouteRuntimeProvider value={runtime}>
          <NavigationContainer ref={navigationRef} onReady={onReady}>
            <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
              <Stack.Screen name="Topic" component={TopicRoute} initialParams={{ topic: opening }} />
            </Stack.Navigator>
          </NavigationContainer>
        </TopicRouteRuntimeProvider>
      </ForumSessionEpochProvider>
    );
  }
  const view = await render(<WarmTopicNavigator />);
  const [[, onUrl]] = addEventListener.mock.calls;
  return { view, onUrl };
}
it('keeps a topic image through a proxy change and closes it when the source session changes', async () => {
  const { controller, element, runtime } = setup(detail);
  jest.mocked(useTopicController).mockImplementation(
    ({ sessionEpochs }) =>
      ({
        ...controller,
        topicQueryKey: forumQueryKeys.topic({
          source: topic.source,
          topicId: topic.id,
          scope: sessionEpochs ?? initialForumSessionEpochs
        })
      }) as never
  );
  jest
    .mocked(useImagePreviewController)
    .mockImplementation(
      jest.requireActual<typeof import('@/features/topic/media/useImagePreviewController')>(
        '@/features/topic/media/useImagePreviewController'
      ).useImagePreviewController
    );
  jest
    .mocked(ImagePreviewModal)
    .mockImplementation(
      jest.requireActual<typeof import('@/ui/media/ImagePreviewModal')>('@/ui/media/ImagePreviewModal')
        .ImagePreviewModal
    );
  const view = await render(element());
  const openImage = async (url: string) => {
    await act(() =>
      latestScreen().html.htmlRenderersProps.a?.onPress?.(
        { stopPropagation: jest.fn() } as never,
        url,
        {} as never,
        {} as never
      )
    );
  };
  const oldUri = 'https://example.invalid/first-account-picture.png';
  await openImage(oldUri);
  expect(view.getByLabelText('保存图片')).toBeTruthy();

  await view.rerender(element(runtime, topic, initialForumSessionEpochs, 'rotated'));
  expect(view.getByLabelText('保存图片')).toBeTruthy();

  const epochs = { ...initialForumSessionEpochs, nodeseek: 1 };
  await view.rerender(
    element({ ...runtime, account: { ...runtime.account, sessionEpochs: epochs } }, topic, epochs, 'rotated')
  );
  const oldSave = view.queryByLabelText('保存图片');
  if (oldSave) await fireEvent.press(oldSave);
  expect(view.queryByLabelText('保存图片')).toBeNull();
  expect(saveImageUriToLibrary).not.toHaveBeenCalled();

  const currentUri = 'https://example.invalid/current-account-picture.png';
  await openImage(currentUri);
  await fireEvent.press(view.getByLabelText('保存图片'));
  expect(saveImageUriToLibrary).toHaveBeenCalledTimes(1);
  expect(jest.mocked(saveImageUriToLibrary).mock.calls[0]?.[0]).toBe(currentUri);
  mockFocused = false;
  await view.rerender(
    element({ ...runtime, account: { ...runtime.account, sessionEpochs: epochs } }, topic, epochs, 'rotated')
  );
  expect(view.queryByLabelText('保存图片')).toBeNull();
  mockFocused = true;
  await view.rerender(
    element({ ...runtime, account: { ...runtime.account, sessionEpochs: epochs } }, topic, epochs, 'rotated')
  );
  expect(view.queryByLabelText('保存图片')).toBeNull();
});

describe('Topic Route external links', () => {
  it('ignores a queued same-topic floor link after a warm deep link and still locates the floor on return', async () => {
    const linkTitle = '打开本主题3楼';
    const opening = {
      ...detail,
      contentHtml: `<p><a href="https://www.nodeseek.com/post-42-1#3">${linkTitle}</a></p>`
    };
    const { view, onUrl } = await renderWarmTopic(opening, ({ html }) => (
      <RenderHTML contentWidth={360} source={{ html: opening.contentHtml }} renderersProps={html.htmlRenderersProps} />
    ));
    try {
      await fireEvent.press(view.getByText(linkTitle));
      const before = navigationRef.getRootState()?.routes[0]?.params;
      expect(before).toMatchObject({ location: { kind: 'reply', target: { floor: 3 } }, locationRequestId: 1 });
      await act(async () => {
        onUrl({ url: 'https://linux.do/t/176543' });
        expect(navigationRef.getCurrentRoute()?.params).toMatchObject({ topic: { id: '176543' } });
        await fireEvent.press(view.getByText(linkTitle, { includeHiddenElements: true }));
      });
      expect(navigationRef.getRootState()?.routes[0]?.params).toEqual(before);

      await act(() => navigationRef.goBack());
      await fireEvent.press(view.getByText(linkTitle));
      expect(navigationRef.getCurrentRoute()?.params).toMatchObject({ locationRequestId: 2 });
    } finally {
      await view.unmount();
    }
  });

  it.each(['分享链接', '复制链接'] as const)(
    'ignores a queued %s after a warm deep link and still works on return',
    async (label) => {
      const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
      const copy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);
      const { view, onUrl } = await renderWarmTopic(detail, ({ chrome }) => (
        <Pressable accessibilityRole="button" accessibilityLabel="打开分享" onPress={chrome.share}>
          <Text>打开分享</Text>
        </Pressable>
      ));
      try {
        await fireEvent.press(view.getByRole('button', { name: '打开分享' }));
        expect(view.getByRole('button', { name: label })).toBeTruthy();
        await act(async () => {
          onUrl({ url: 'https://linux.do/t/176543' });
          expect(navigationRef.getCurrentRoute()?.params).toMatchObject({ topic: { id: '176543' } });
          await fireEvent.press(view.getByRole('button', { name: label, includeHiddenElements: true }));
        });
        expect(share).not.toHaveBeenCalled();
        expect(copy).not.toHaveBeenCalled();

        await act(() => navigationRef.goBack());
        await fireEvent.press(view.getByRole('button', { name: '打开分享' }));
        await fireEvent.press(view.getByRole('button', { name: label }));
        if (label === '分享链接') {
          expect(share.mock.calls).toEqual([
            [{ title: detail.title, message: `${detail.title}\n${detail.url}`, url: detail.url }]
          ]);
          expect(copy).not.toHaveBeenCalled();
        } else {
          expect(copy.mock.calls).toEqual([[detail.url]]);
          expect(share).not.toHaveBeenCalled();
        }
      } finally {
        await view.unmount();
      }
    }
  );
  it('opens the packet site in the reader and returns to the same topic when closed', async () => {
    const routeTopic = { ...topic, source: 'linuxdo' as const, url: 'https://linux.do/t/42' };
    const { element } = setup(null, routeTopic);
    const view = await render(element());
    const link = latestScreen().html.htmlRenderersProps.a?.onPress;
    await act(async () =>
      link?.({ stopPropagation: jest.fn() } as never, 'https://hb.lafi.sh/', {} as never, {} as never)
    );
    expect(view.getByText('红包站')).toBeTruthy();
    await fireEvent(view.getByTestId('linuxdo-packet-session', { includeHiddenElements: true }), 'message', {
      nativeEvent: {
        url: view.getByTestId('linuxdo-packet-session', { includeHiddenElements: true }).props.source.baseUrl,
        data: 'mismatch'
      }
    });
    expect(view.queryByTestId('linuxdo-packet-page', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByLabelText('关闭'));
    expect(view.queryByText('红包站')).toBeNull();
    expect(latestScreen().active).toBe(true);
    await act(async () =>
      link?.({ stopPropagation: jest.fn() } as never, 'https://hb.lafi.sh/', {} as never, {} as never)
    );
    await fireEvent(view.getByTestId('linuxdo-packet-session', { includeHiddenElements: true }), 'message', {
      nativeEvent: { url: 'https://hb.lafi.sh', data: 'matching' }
    });
    expect(view.getByTestId('linuxdo-packet-page', { includeHiddenElements: true })).toHaveProp('source', {
      uri: 'https://hb.lafi.sh/'
    });
    expect(view.getByTestId('linuxdo-packet-page', { includeHiddenElements: true }).props.onMessage).toBeUndefined();
    expect(view.getByText('正在打开红包页…')).toBeTruthy();
    await fireEvent(view.getByTestId('linuxdo-packet-page', { includeHiddenElements: true }), 'load', {
      nativeEvent: { url: 'https://hb.lafi.sh/' }
    });
    expect(view.queryByText('正在打开红包页…')).toBeNull();
  });

  it('preserves the topic behind account checks and offers a retry when the site refuses the check', async () => {
    const view = await render(
      <LinuxDoPacketPage url="https://hb.lafi.sh/" username="reader" blockMessage="" onClose={jest.fn()} />
    );
    const session = view.getByTestId('linuxdo-packet-session', { includeHiddenElements: true });
    expect(session.props.containerStyle).toMatchObject({ opacity: 0 });
    await fireEvent(session, 'message', { nativeEvent: { url: session.props.source.baseUrl, data: 'http:403' } });
    expect(view.getByText(/账号核对失败（HTTP 403）/)).toBeTruthy();
    expect(view.queryByTestId('linuxdo-packet-page', { includeHiddenElements: true })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '重新加载' }));
    expect(view.getByTestId('linuxdo-packet-session', { includeHiddenElements: true })).toBeTruthy();
  });

  it('keeps the previous packet account hidden when a user cancels reconnecting', async () => {
    const view = await render(
      <LinuxDoPacketPage url="https://hb.lafi.sh/" username="reader" blockMessage="" onClose={jest.fn()} />
    );
    await fireEvent(view.getByTestId('linuxdo-packet-session', { includeHiddenElements: true }), 'message', {
      nativeEvent: {
        url: view.getByTestId('linuxdo-packet-session', { includeHiddenElements: true }).props.source.baseUrl,
        data: 'mismatch'
      }
    });
    await fireEvent.press(view.getByLabelText('连接当前账号'));
    const navigate = view.getByTestId('linuxdo-packet-page', { includeHiddenElements: true }).props
      .onShouldStartLoadWithRequest;
    await act(async () =>
      expect(navigate({ url: 'https://hb.lafi.sh/?authError=access_denied', isTopFrame: true })).toBe(false)
    );
    expect(view.queryByTestId('linuxdo-packet-page', { includeHiddenElements: true })).toBeNull();
  });

  it('reports a Custom Tab rejection, keeps original-site opening in the full browser, and stops native content in the background', async () => {
    const { element, notify, runtime } = setup();
    const openBrowserAsync = jest
      .spyOn(WebBrowser, 'openBrowserAsync')
      .mockRejectedValue(new Error('custom tab unavailable'));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      const view = await render(element());
      const screen = mockTopicScreen.mock.calls.at(-1)?.[0] as {
        chrome: { openOriginal: (url: string) => void };
        html: ReturnType<typeof useHtmlRenderingController>;
      };
      const [nativeFrame] = view.container.queryAll((node) => node.props.accessibilityElementsHidden === false);
      expect(nativeFrame.props.collapsable).toBe(false);

      screen.html.htmlRenderersProps.a?.onPress?.(
        { stopPropagation: jest.fn() } as never,
        'https://example.com/help',
        {} as never,
        {} as never
      );
      await waitFor(() => expect(notify).toHaveBeenCalledWith('custom tab unavailable'));

      screen.chrome.openOriginal(topic.url);
      expect(openBrowserAsync).toHaveBeenCalledTimes(1);
      expect(openBrowserAsync).toHaveBeenCalledWith('https://example.com/help');
      expect(openURL).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledWith(topic.url);

      await view.rerender(element({ ...runtime, appActive: false }));
      const backgroundedScreen = mockTopicScreen.mock.calls.at(-1)?.[0] as {
        active: boolean;
        composerRouteFocused: boolean;
      };
      expect(backgroundedScreen.active).toBe(false);
      expect(backgroundedScreen.composerRouteFocused).toBe(true);
      expect(view.container.queryAll((node) => node.props.accessibilityElementsHidden === true)).toEqual([nativeFrame]);
      expect(nativeFrame.props.collapsable).toBe(false);
    } finally {
      openBrowserAsync.mockRestore();
      openURL.mockRestore();
    }
  });
});

describe('Topic Route local favorites', () => {
  it.each(['linuxdo', 'nodeseek', 'yaohuo', 'v2ex'] as const)(
    'saves the loaded %s summary after opening a topic stub and keeps the local toggle target',
    async (source) => {
      const urls = {
        linuxdo: 'https://linux.do/t/42',
        nodeseek: 'https://www.nodeseek.com/post-42-1',
        yaohuo: 'https://www.yaohuo.me/bbs-42.html',
        v2ex: 'https://www.v2ex.com/t/42'
      };
      const stub = { ...topic, source, title: '主题占位', author: '未知作者', url: urls[source] };
      const loaded = {
        ...detail,
        ...stub,
        title: '已加载标题',
        author: '已加载作者',
        categoryId: '177',
        category: '已加载分类',
        createdAt: '2026-07-13T04:05:00.000Z',
        lastReplyAt: '2026-10-08T06:30:00.000Z',
        replyCount: 27,
        viewCount: 91
      };
      const { element, runtime } = setup(loaded, stub);
      await render(element());

      await act(() => latestScreen().chrome.toggleFavorite());
      expect(runtime.reader.commit).toHaveBeenCalledWith({
        type: 'favorite',
        topic: expect.objectContaining({
          source,
          id: stub.id,
          title: loaded.title,
          author: loaded.author,
          categoryId: loaded.categoryId,
          category: loaded.category,
          createdAt: loaded.createdAt,
          lastReplyAt: loaded.lastReplyAt,
          replyCount: loaded.replyCount,
          viewCount: loaded.viewCount,
          url: loaded.url
        }),
        enabled: true,
        at: expect.any(String)
      });
      const command = jest.mocked(runtime.reader.commit).mock.calls[0][0];
      if (command.type !== 'favorite') throw new Error('Expected a favorite command');
      expect(command.topic).not.toHaveProperty('contentHtml');
      expect(command.topic).not.toHaveProperty('replies');
      runtime.reader.dataRef.current = {
        ...runtime.reader.dataRef.current,
        favorites: { [topicKey(stub)]: true }
      };
      await act(() => latestScreen().chrome.toggleFavorite());
      expect(runtime.reader.commit).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
    }
  );

  it('keeps the route summary when detail is missing or belongs to another topic or source', async () => {
    const { controller, element, runtime } = setup();
    const view = await render(element());
    await act(() => latestScreen().chrome.toggleFavorite());
    for (const staleDetail of [
      { ...detail, id: '43' },
      { ...detail, source: 'yaohuo' as const }
    ]) {
      jest.mocked(useTopicController).mockReturnValue({ ...controller, topicDetail: staleDetail } as never);
      await view.rerender(element());
      await act(() => latestScreen().chrome.toggleFavorite());
    }
    expect(runtime.reader.commit).toHaveBeenCalledTimes(3);
    for (const [command] of jest.mocked(runtime.reader.commit).mock.calls) {
      expect(command).toMatchObject({
        type: 'favorite',
        topic: { source: topic.source, id: topic.id, title: topic.title }
      });
    }
  });
});

describe('Topic Route sharing', () => {
  it('keeps one Android link chooser until returning to the app and releases its listener on close', async () => {
    const { element } = setup(detail);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const subscribe = jest.spyOn(AppState, 'addEventListener');
    const view = await render(element());
    await act(() => latestScreen().chrome.share());

    await fireEvent.press(view.getByRole('button', { name: '分享链接' }));
    const button = view.getByRole('button', { name: '分享链接' });
    expect(button).toBeDisabled();
    for (let press = 0; press < 3; press += 1) await fireEvent.press(button);
    expect(share).toHaveBeenCalledTimes(1);

    const subscriptionIndex = subscribe.mock.calls.findLastIndex(([event]) => event === 'change');
    const listener = subscribe.mock.calls[subscriptionIndex]?.[1];
    if (!listener) throw new Error('Missing chooser lifecycle listener');
    const subscription = subscribe.mock.results[subscriptionIndex];
    if (subscription.type !== 'return') throw new Error('Missing chooser lifecycle subscription');
    const remove = jest.spyOn(subscription.value, 'remove');
    await act(() => listener('active'));
    expect(button).toBeDisabled();
    await act(() => listener('background'));
    expect(button).toBeDisabled();
    await act(() => listener('active'));
    expect(button).toBeEnabled();
    expect(remove).toHaveBeenCalledTimes(1);

    await fireEvent.press(button);
    expect(share).toHaveBeenCalledTimes(2);
    expect(button).toBeDisabled();
    const secondSubscription = subscribe.mock.results.at(-1);
    if (secondSubscription?.type !== 'return') throw new Error('Missing second chooser subscription');
    const removeSecond = jest.spyOn(secondSubscription.value, 'remove');
    await fireEvent.press(view.getAllByRole('button', { name: '关闭分享' })[0]);
    expect(removeSecond).toHaveBeenCalledTimes(1);
    expect(view.queryByRole('header', { name: '分享帖子' })).toBeNull();
    await act(() => latestScreen().chrome.share());
    expect(view.getByRole('button', { name: '分享链接' })).toBeEnabled();
    await fireEvent.press(view.getByRole('button', { name: '分享链接' }));
    const thirdSubscription = subscribe.mock.results.at(-1);
    if (thirdSubscription?.type !== 'return') throw new Error('Missing third chooser subscription');
    const removeThird = jest.spyOn(thirdSubscription.value, 'remove');
    await view.unmount();
    expect(removeThird).toHaveBeenCalledTimes(1);
  });

  it('releases the Android chooser listener when sharing cannot launch and keeps the clipboard fallback retryable', async () => {
    const { element, notify } = setup(detail);
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof Share.share>>>();
    const share = jest
      .spyOn(Share, 'share')
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue({ action: Share.dismissedAction });
    const copy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);
    const subscribe = jest.spyOn(AppState, 'addEventListener');
    const view = await render(element());
    await act(() => latestScreen().chrome.share());

    await fireEvent.press(view.getByRole('button', { name: '分享链接' }));
    const subscription = subscribe.mock.results.at(-1);
    if (subscription?.type !== 'return') throw new Error('Missing failed chooser subscription');
    const remove = jest.spyOn(subscription.value, 'remove');
    await act(async () => {
      pending.reject(new Error('share unavailable'));
      await pending.promise.catch(() => undefined);
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(detail.url);
    expect(notify).toHaveBeenCalledWith('链接已复制');
    expect(view.getByRole('button', { name: '分享链接' })).toBeEnabled();
    await fireEvent.press(view.getByRole('button', { name: '分享链接' }));
    expect(share).toHaveBeenCalledTimes(2);
    expect(view.getByRole('button', { name: '分享链接' })).toBeEnabled();
  });

  it('cancels the chooser listener on unmount without a late clipboard fallback', async () => {
    const { element, notify } = setup(detail);
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof Share.share>>>();
    jest.spyOn(Share, 'share').mockReturnValue(pending.promise);
    const copy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValue(true);
    const subscribe = jest.spyOn(AppState, 'addEventListener');
    const view = await render(element());
    await act(() => latestScreen().chrome.share());
    await fireEvent.press(view.getByRole('button', { name: '分享链接' }));
    const subscription = subscribe.mock.results.at(-1);
    if (subscription?.type !== 'return') throw new Error('Missing pending chooser subscription');
    const remove = jest.spyOn(subscription.value, 'remove');

    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error('late chooser failure'));
      await pending.promise.catch(() => undefined);
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(copy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('opens sharing choices, copies and shares the current link, and returns from or closes the image preview', async () => {
    const { element } = setup(detail);
    const copy = jest.spyOn(Clipboard, 'setStringAsync').mockResolvedValueOnce(false).mockResolvedValue(true);
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction });
    const view = await render(element());

    await act(() => latestScreen().chrome.share());
    expect(view.getByRole('header', { name: '分享帖子' })).toBeTruthy();
    expect(view.queryByRole('header', { name: '正文长图' })).toBeNull();
    expect(share).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();

    await fireEvent.press(view.getByRole('button', { name: '复制链接' }));
    expect(copy).toHaveBeenCalledWith(detail.url);
    expect(view.getByRole('alert')).toHaveTextContent('无法复制链接，请重试。');
    expect(view.queryByText('链接已复制')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '复制链接' }));
    expect(view.getByText('链接已复制')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '分享链接' }));
    expect(share).toHaveBeenCalledWith({
      title: detail.title,
      message: `${detail.title}\n${detail.url}`,
      url: detail.url
    });
    expect(view.getByRole('header', { name: '分享帖子' })).toBeTruthy();

    await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    expect(view.queryByRole('header', { name: '分享帖子' })).toBeNull();
    expect(view.getByRole('header', { name: '正文长图' })).toBeTruthy();
    expect(view.getByText('当前主题正文')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: '返回分享方式' }));
    expect(view.getByRole('header', { name: '分享帖子' })).toBeTruthy();
    expect(view.queryByRole('header', { name: '正文长图' })).toBeNull();

    await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    await fireEvent.press(view.getByRole('button', { name: '关闭' }));
    expect(view.queryByRole('header', { name: '正文长图' })).toBeNull();
    expect(view.queryByRole('header', { name: '分享帖子' })).toBeNull();
    expect(latestScreen().bodyMediaPaused).toBe(false);
    await act(() => latestScreen().chrome.share());
    await fireEvent.press(view.getAllByRole('button', { name: '关闭分享' })[0]);
    expect(view.queryByRole('header', { name: '分享帖子' })).toBeNull();
  });

  it.each<{ state: string; current: TopicDetail }>([
    { state: 'empty', current: { ...detail, contentHtml: '' } },
    {
      state: 'a permission notice',
      current: {
        ...detail,
        accessRequirement: { type: 'permission', label: '需权限', detail: '暂无权限查看此内容' },
        contentHtml: '<p>暂无权限查看此内容</p>'
      }
    }
  ])('keeps link sharing available when the body is $state', async ({ current }) => {
    const { element } = setup(current);
    const view = await render(element());
    await act(() => latestScreen().chrome.share());

    expect(view.getByRole('button', { name: '分享链接' })).toBeEnabled();
    expect(view.getByRole('button', { name: '复制链接' })).toBeEnabled();
    expect(view.getByRole('button', { name: '生成长图' })).toBeDisabled();
  });

  it('enables image sharing in the already open choices when the current body finishes loading', async () => {
    const { controller, element } = setup();
    const view = await render(element());
    await act(() => latestScreen().chrome.share());
    const choices = view.getByRole('header', { name: '分享帖子' });
    expect(view.getByRole('button', { name: '分享链接' })).toBeEnabled();
    expect(view.getByRole('button', { name: '复制链接' })).toBeEnabled();
    expect(view.getByRole('button', { name: '生成长图' })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    expect(view.queryByRole('header', { name: '正文长图' })).toBeNull();

    jest.mocked(useTopicController).mockReturnValue({ ...controller, topicDetail: detail } as never);
    await view.rerender(element());

    expect(view.getByRole('header', { name: '分享帖子' })).toBe(choices);
    expect(view.getByRole('button', { name: '生成长图' })).toBeEnabled();
    await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    expect(view.getByText('当前主题正文')).toBeTruthy();
    expect(view.getByText(detail.title)).toBeTruthy();

    jest.mocked(useTopicController).mockReturnValue({
      ...controller,
      topicDetail: { ...detail, contentHtml: '<p>刷新后的正文</p>' }
    } as never);
    await view.rerender(element());
    expect(view.getByText('当前主题正文')).toBeTruthy();
    expect(view.queryByText('刷新后的正文')).toBeNull();
  });

  it.each([
    ['choices', 'focus'],
    ['image', 'focus'],
    ['choices', 'session'],
    ['image', 'session'],
    ['choices', 'topic'],
    ['image', 'topic'],
    ['choices', 'source'],
    ['image', 'source']
  ])('dismisses %s after %s changes and never restores the old share surface', async (surface, change) => {
    const { element, runtime } = setup(detail);
    const view = await render(element());
    await act(() => latestScreen().chrome.share());
    if (surface === 'image') await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    const title = surface === 'image' ? '正文长图' : '分享帖子';
    expect(view.getByRole('header', { name: title })).toBeTruthy();

    mockFocused = change !== 'focus';
    const nextTopic =
      change === 'topic'
        ? { ...topic, id: 'another-topic' }
        : change === 'source'
          ? { ...topic, source: 'v2ex' as const, url: 'https://www.v2ex.com/t/42' }
          : topic;
    const epochs = change === 'session' ? { ...initialForumSessionEpochs, nodeseek: 1 } : initialForumSessionEpochs;
    await view.rerender(element(runtime, nextTopic, epochs));
    expect(view.queryByRole('header', { name: title, includeHiddenElements: true })).toBeNull();

    mockFocused = true;
    await view.rerender(element());
    expect(view.queryByRole('header', { name: '分享帖子', includeHiddenElements: true })).toBeNull();
    expect(view.queryByRole('header', { name: '正文长图', includeHiddenElements: true })).toBeNull();
    expect(latestScreen().bodyMediaPaused).toBe(false);
  });

  it.each(['choices', 'image'])(
    'retains %s across an app background transition while the route stays focused',
    async (surface) => {
      const { element, runtime } = setup(detail);
      const view = await render(element());
      await act(() => latestScreen().chrome.share());
      if (surface === 'image') await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
      const title = surface === 'image' ? '正文长图' : '分享帖子';
      const header = view.getByRole('header', { name: title });

      await view.rerender(element({ ...runtime, appActive: false }));
      expect(view.getByRole('header', { name: title, includeHiddenElements: true })).toBe(header);
      expect(latestScreen().composerRouteFocused).toBe(true);
      expect(latestScreen().bodyMediaPaused).toBe(true);
      await view.rerender(element());
      expect(view.getByRole('header', { name: title })).toBe(header);
    }
  );
});
