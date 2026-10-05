import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ComponentProps, ReactNode } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Linking, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import type { Topic, TopicDetail } from '@/domain/forum/models';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import { useTopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { useImagePreviewController } from '@/features/topic/media/useImagePreviewController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import type { TopicScreen } from '@/features/topic/TopicScreen';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { createTheme } from '@/ui/theme/tokens';
import { act, fireEvent, render, waitFor } from '../render';

const mockTopicScreen = jest.fn<(_props: ComponentProps<typeof TopicScreen>) => ReactNode>(() => null);
let mockFocused = true;

jest.mock('@react-navigation/native', () => ({
  ...(jest.requireActual('@react-navigation/native') as Record<string, unknown>),
  useIsFocused: () => mockFocused,
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
jest.mock('@/ui/media/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('@shopify/flash-list', () => ({ useRecyclingState: (initialValue: unknown) => [initialValue, jest.fn()] }));
jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));
jest.mock('react-native-webview', () => ({ WebView: () => null }));

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

function setup(topicDetail: TopicDetail | null = null) {
  const data = createEmptyReaderData();
  jest.mocked(useTopicSessionController).mockReturnValue({
    state: { replyComposerIntent: { kind: 'closed' }, selectedTopic: topic },
    commands: {
      composer: { toggle: jest.fn() },
      view: {
        changeCommentQuery: jest.fn(),
        changeReplyFilter: jest.fn(),
        rememberScrollY: jest.fn()
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
    topicQueryKey: ['forum', 'nodeseek', 'topic'],
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
    push: jest.fn(),
    setParams: jest.fn()
  } as unknown as NativeStackScreenProps<RootStackParamList, 'Topic'>['navigation'];
  const element = (value = runtime, currentTopic = topic, sessionEpochs = initialForumSessionEpochs) => (
    <ForumSessionEpochProvider sessionEpochs={sessionEpochs} transportIdentity="applied">
      <TopicRouteRuntimeProvider value={value}>
        <TopicRoute navigation={navigation} route={{ key: 'topic', name: 'Topic', params: { topic: currentTopic } }} />
      </TopicRouteRuntimeProvider>
    </ForumSessionEpochProvider>
  );
  return { controller, element, notify, runtime };
}

describe('Topic Route external links', () => {
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

describe('Topic Route sharing', () => {
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
