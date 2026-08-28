import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ReactNode } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { Topic } from '@/domain/forum/models';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import { useTopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { useImagePreviewController } from '@/features/topic/media/useImagePreviewController';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { createTheme } from '@/ui/theme/tokens';
import { render, waitFor } from '../render';

const mockTopicScreen = jest.fn<(_props: unknown) => ReactNode>(() => null);

jest.mock('@react-navigation/native', () => ({
  ...(jest.requireActual('@react-navigation/native') as Record<string, unknown>),
  useIsFocused: () => true,
  usePreventRemove: jest.fn(),
  useScrollToTop: jest.fn()
}));
jest.mock('@/features/topic/useTopicController', () => ({ useTopicController: jest.fn() }));
jest.mock('@/features/topic/useTopicSessionController', () => ({ useTopicSessionController: jest.fn() }));
jest.mock('@/features/topic/actions/useTopicActionsController', () => ({ useTopicActionsController: jest.fn() }));
jest.mock('@/features/topic/media/useImagePreviewController', () => ({ useImagePreviewController: jest.fn() }));
jest.mock('@/features/topic/TopicScreen', () => ({ TopicScreen: (props: unknown) => mockTopicScreen(props) }));
jest.mock('@/ui/media/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
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

beforeEach(() => {
  mockTopicScreen.mockReset();
  mockTopicScreen.mockImplementation(() => null);
});

describe('Topic Route external links', () => {
  it('reports a Custom Tab rejection, keeps original-site opening in the full browser, and stops native content in the background', async () => {
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
    jest.mocked(useTopicController).mockReturnValue({
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
    const route = { key: 'topic', name: 'Topic', params: { topic } } as const;
    const openBrowserAsync = jest
      .spyOn(WebBrowser, 'openBrowserAsync')
      .mockRejectedValue(new Error('custom tab unavailable'));
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      const view = await render(
        <ForumSessionEpochProvider sessionEpochs={initialForumSessionEpochs} transportIdentity="applied">
          <TopicRouteRuntimeProvider value={runtime}>
            <TopicRoute navigation={navigation} route={route} />
          </TopicRouteRuntimeProvider>
        </ForumSessionEpochProvider>
      );
      const screen = mockTopicScreen.mock.calls.at(-1)?.[0] as {
        chrome: { openOriginal: (url: string) => void };
        html: ReturnType<typeof useHtmlRenderingController>;
      };

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

      await view.rerender(
        <ForumSessionEpochProvider sessionEpochs={initialForumSessionEpochs} transportIdentity="applied">
          <TopicRouteRuntimeProvider value={{ ...runtime, appActive: false }}>
            <TopicRoute navigation={navigation} route={route} />
          </TopicRouteRuntimeProvider>
        </ForumSessionEpochProvider>
      );
      expect((mockTopicScreen.mock.calls.at(-1)?.[0] as { active: boolean }).active).toBe(false);
    } finally {
      openBrowserAsync.mockRestore();
      openURL.mockRestore();
    }
  });
});
