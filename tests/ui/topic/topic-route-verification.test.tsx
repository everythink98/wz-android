import { seedLinuxDoAccount } from '../seedLinuxDoAccount';
import type { ComponentProps } from 'react';
import { Linking, Pressable, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as WebBrowser from 'expo-web-browser';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import type { TopicScreen } from '@/features/topic/TopicScreen';
import { TopicComposerRoute } from '@/features/topic-composer/TopicComposerRoute';
import {
  TopicComposerRouteRuntimeProvider,
  type TopicComposerRouteRuntimeValue
} from '@/features/topic-composer/TopicComposerRouteRuntime';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import * as SecureStore from 'expo-secure-store';
import {
  markAccountSessionMigrationCompleted,
  saveAccountSessionSnapshot
} from '@/platform/storage/accountSessionStore';
import { createEmptyReaderState } from '@/domain/reader/readerRecordState';
import { saveLocalImageFileToLibrary } from '@/platform/media/imageSave';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { captureLongTopicImage } from '@/platform/media/topicShareCapture';
import { setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import { appQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import type { Fetcher } from '@/platform/network/request';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import type { UserReference } from '@/domain/forum/models';
import { resolveReaderStyleSettings, createTheme } from '@/ui/theme/tokens';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

let mockStallHiddenRead = false;
const mockTopicScreenMount = jest.fn();
let mockTopicScreenProps: ComponentProps<typeof TopicScreen> | undefined;

// Presentation and native WebView are boundaries; Route, Account, gateway and Query owners are real.
jest.mock('@/features/topic/TopicScreen', () => {
  const React = require('react');
  const { Text, Pressable } = require('react-native');
  return {
    TopicScreen: (props: ComponentProps<typeof TopicScreen>) => {
      mockTopicScreenProps = props;
      React.useEffect(() => {
        mockTopicScreenMount();
      }, []);
      return (
        <>
          <Text accessibilityLabel={props.article.error?.message} accessibilityState={{ busy: props.article.busy }}>
            {props.article.error ? 'topic-error' : props.article.topic?.title || 'topic-pending'}
          </Text>
          <Pressable onPress={() => props.chrome.verifyLinuxDo()}>
            <Text>去验证</Text>
          </Pressable>
          <Pressable onPress={props.chrome.openReadingSettings}>
            <Text>离开详情</Text>
          </Pressable>
        </>
      );
    }
  };
});
jest.mock('@/ui/media/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
jest.mock('@/features/topic-composer/useTopicComposerController', () => ({
  useTopicComposerController: ({ onEdited }: { onEdited: (source: string, id: string) => void }) => ({
    leave: async () => true,
    finish: () => onEdited('linuxdo', '42')
  })
}));
jest.mock('@/features/topic-composer/TopicComposerScreen', () => {
  const { Pressable, Text } = require('react-native');
  return {
    TopicComposerScreen: ({ controller }: { controller: { finish: () => void } }) => (
      <Pressable onPress={controller.finish}>
        <Text>完成保存</Text>
      </Pressable>
    )
  };
});
jest.mock('@/platform/media/topicShareCapture', () => ({ captureLongTopicImage: jest.fn() }));
jest.mock('@/platform/media/imageSave', () => ({
  ...jest.requireActual('@/platform/media/imageSave'),
  saveLocalImageFileToLibrary: jest.fn(async () => undefined)
}));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));
jest.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: jest.fn(), createVideoPlayer: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef(function WebView(
      props: {
        source?: { uri?: string };
        onError?: (event: { nativeEvent: { description: string } }) => void;
      },
      ref: unknown
    ) {
      React.useImperativeHandle(ref, () => ({ stopLoading: jest.fn(), injectJavaScript: jest.fn() }), []);
      React.useEffect(() => {
        if (!mockStallHiddenRead && props.source?.uri?.includes('/t/42.json'))
          props.onError?.({ nativeEvent: { description: 'Fixture hidden browser unavailable' } });
      }, []);
      return React.createElement(View, { ...props, testID: 'verification-webview' });
    })
  };
});
jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined),
  readManagedCookieHeader: jest.fn(async () => ({ status: 'ok', header: '_t=fixture-auth; _rt=fixture-runtime' }))
}));

const Stack = createNativeStackNavigator<RootStackParamList>();
const topic = {
  source: 'linuxdo' as const,
  id: '42',
  title: 'Fixture topic',
  author: 'alice',
  createdAt: '2026-05-20T00:00:00.000Z',
  url: 'https://linux.do/t/42'
};
// Existing discourse.test.ts response shape; challenge is explicit fault injection.
const body = {
  id: 42,
  title: 'Recovered topic',
  slug: 'linux-detail-topic',
  created_at: topic.createdAt,
  posts_count: 1,
  post_stream: {
    posts: [{ id: 100, post_number: 1, username: 'alice', cooked: '<p>body</p>', created_at: topic.createdAt }]
  }
};
beforeEach(() => {
  mockTopicScreenProps = undefined;
  jest
    .spyOn(SecureStore, 'getItemAsync')
    .mockImplementation(async (key) => (key.endsWith('-user-agent') ? 'Saved fixture browser UA' : null));
});
afterEach(() => jest.restoreAllMocks());

async function mount(readTopic?: Fetcher) {
  const navigationRef = createNavigationContainerRef<RootStackParamList>();
  const readerCommit = jest.fn<void, Parameters<TopicRouteRuntimeValue['reader']['commit']>>();
  await saveAccountSessionSnapshot(seedLinuxDoAccount());
  await markAccountSessionMigrationCompleted();
  let challenged = true;
  const requests: string[] = [];
  const fetcher: Fetcher = async (url, init) => {
    requests.push(url);
    if (url === 'https://linux.do/cdn-cgi/trace') return new Response('ip=192.0.2.17\nhttp=h2\n');
    if (/\/t\/\d+(?:\.json|\/posts\.json)/.test(url) && readTopic) return readTopic(url, init);
    if (url.includes('/t/42.json'))
      return challenged
        ? new Response('<title>Just a moment...</title>', {
            status: 403,
            headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }
          })
        : new Response(JSON.stringify(body));
    throw new Error(`Unexpected fixture request ${url}`);
  };
  const data = createEmptyReaderState();
  const notify = jest.fn();
  let accountReady = false;
  let latestAccount!: ReturnType<typeof useAccountRuntime>;
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    const account = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? ['linuxdo'] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: true,
      screen: 'topic',
      webViewBlockMessage: ''
    });
    latestAccount = account;
    accountReady = account.read.sessionsReady;
    const runtime: TopicRouteRuntimeValue = {
      enabledSources: ['linuxdo', 'nodeseek', 'yaohuo', 'v2ex'],
      account: {
        ...account.write,
        sessionEpochs: account.read.forumSessionEpochs,
        sessionViewModels: account.read.accountSessionViewModels,
        getLinuxDoUserAgent: account.read.getLinuxDoUserAgent,
        getNodeSeekUserAgent: account.read.getNodeSeekUserAgent,
        nodeSeekUserId: null,
        linuxDoVerificationVisible: account.hosts.linuxDoVerificationVisible,
        readGateway: account.read.readGateway,
        reconcileAccountStatus: account.read.reconcileAccountStatus,
        requestNodeSeekVerification: account.hosts.requestNodeSeekVerification,
        showLinuxDoVerification: account.hosts.showLinuxDoVerification,
        showYaohuoLogin: account.hosts.showYaohuoLogin
      },
      appActive: active,
      contentWidth: 360,
      ensureNetworkProxyReady: async () => undefined,
      fetcher,
      networkProxyWebViewBlockMessage: '',
      nodeSeekMediaUserAgent: '',
      notify,
      reader: { commit: readerCommit, data, dataRef: { current: data } },
      readerStyle: { settings: resolveReaderStyleSettings(data.settings), theme: createTheme(data.settings) }
    };
    if (!accountReady) return account.hosts.element;
    const { read, write } = account;
    const composerRuntime: TopicComposerRouteRuntimeValue = {
      ...write,
      appActive: active,
      enabledSources: runtime.enabledSources,
      sessions: read.accountSessionViewModels,
      sessionEpochs: read.forumSessionEpochs,
      fetcher,
      ensureNetworkProxyReady: runtime.ensureNetworkProxyReady,
      getUserAgent: read.getLinuxDoUserAgent,
      getEmojiUrls: read.readGateway.getEmojiUrls,
      getReadPlan: read.readGateway.getReadPlan,
      getLinuxDoTopicCreationContext: read.readGateway.getLinuxDoTopicCreationContext,
      getTopicEditContext: read.readGateway.getTopicEditContext,
      getTopic: read.readGateway.getTopic,
      openAccount: () => undefined,
      notify
    };
    return (
      <ForumSessionEpochProvider sessionEpochs={account.read.forumSessionEpochs} transportIdentity="applied">
        <TopicRouteRuntimeProvider value={runtime}>
          <TopicComposerRouteRuntimeProvider value={composerRuntime}>
            <NavigationContainer ref={navigationRef}>
              <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
                <Stack.Screen name="Topic" component={TopicRoute} initialParams={{ topic }} />
                <Stack.Screen name="User">
                  {({ route }) => <Text>{`用户 ${route.params.user.username}`}</Text>}
                </Stack.Screen>
                <Stack.Screen name="TopicComposer" component={TopicComposerRoute} />
                <Stack.Screen name="ReadingSettings">
                  {({ navigation }) => (
                    <Pressable onPress={navigation.goBack}>
                      <Text>返回详情</Text>
                    </Pressable>
                  )}
                </Stack.Screen>
              </Stack.Navigator>
            </NavigationContainer>
          </TopicComposerRouteRuntimeProvider>
          {account.hosts.element}
          <Pressable onPress={() => account.hosts.closeTopmostSurface()}>
            <Text>取消验证</Text>
          </Pressable>
        </TopicRouteRuntimeProvider>
      </ForumSessionEpochProvider>
    );
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  await waitFor(() => expect(accountReady).toBe(true));
  return {
    view,
    Harness,
    navigationRef,
    account: () => latestAccount,
    readerCommit,
    requests,
    allow: () => {
      challenged = false;
    }
  };
}

it('closes reply reads and writes after the saved opening is denied, then restores them on refresh', async () => {
  let restricted = false;
  let recovered = false;
  const posts = [
    ...body.post_stream.posts,
    ...Array.from({ length: 31 }, (_, index) => ({
      id: 101 + index,
      post_number: 2 + index,
      username: 'reader',
      cooked: `<p>回复 ${index + 1}</p>`,
      created_at: topic.createdAt
    }))
  ];
  const { view, navigationRef, account, requests } = await mount(async (url) => {
    if (restricted) return new Response(JSON.stringify({ errors: ['当前用户组不可查看该主题'] }), { status: 403 });
    if (url.includes('/posts.json')) return new Response(JSON.stringify({ post_stream: { posts: [posts.at(-1)] } }));
    return new Response(
      JSON.stringify(
        recovered
          ? {
              ...body,
              posts_count: posts.length,
              post_stream: { posts: posts.slice(0, 31), stream: posts.map(({ id }) => id) }
            }
          : body
      )
    );
  });
  await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
  expect(mockTopicScreenProps?.actions.decisionFor({ action: 'reply' })).toEqual({ allowed: true, reason: 'allowed' });
  const detailKey = mockTopicScreenProps!.read.topicQueryKey;
  const epoch = account().read.forumSessionEpochs.linuxdo;
  const plan = account().read.readGateway.getReadPlan('linuxdo', 'replies');
  const replyKey = forumQueryKeys.replies(detailKey, 'oldest', plan.cacheScope);
  const initial = {
    pages: [
      {
        items: [{ author: 'reader', commentId: 101, contentHtml: '原回复', createdAt: topic.createdAt }],
        currentPage: 1,
        currentOffset: 0,
        requestedPage: 1,
        requestedOffset: 0,
        hasMore: true,
        nextPage: 2,
        nextOffset: 30,
        completeness: 'complete'
      }
    ],
    pageParams: [{ kind: 'start' }]
  };
  await act(() => appQueryClient.setQueryData(replyKey, initial));
  await waitFor(() => expect(mockTopicScreenProps?.read.replyHasMore).toBe(true));
  const oldActions = mockTopicScreenProps!.read;

  await act(() => navigationRef.navigate('TopicComposer', { kind: 'edit', source: 'linuxdo', topicId: '42' }));
  restricted = true;
  await fireEvent.press(await view.findByText('完成保存'));
  await waitFor(() => expect(view.getByText('受限帖子')).toBeTruthy());
  expect(account().read.forumSessionEpochs.linuxdo).toBe(epoch);
  expect(mockTopicScreenProps?.article.topic?.accessRequirement?.type).toBe('permission');
  expect(mockTopicScreenProps?.actions.decisionFor({ action: 'reply' })).toEqual({
    allowed: false,
    reason: 'object-forbidden'
  });
  const denied = mockTopicScreenProps!.read;
  const before = requests.length;
  await act(() => denied.loadMoreReplies({ silent: true }));
  await act(() => oldActions.loadPreviousReplies({ silent: true }));
  await act(() => oldActions.refreshTopicReplies());
  await act(() => oldActions.locateReply({ floor: 50 }, { silent: true }));
  expect({ canLoadMore: denied.replyHasMore, canLoadPrevious: denied.replyHasPrevious }).toEqual({
    canLoadMore: false,
    canLoadPrevious: false
  });
  expect(denied.topicReplies).toEqual([]);
  expect(requests.slice(before)).toEqual([]);
  expect(appQueryClient.getQueryData(replyKey)).toEqual(initial);

  restricted = false;
  recovered = true;
  await act(() => denied.refreshWholeTopic());
  await waitFor(() => expect(mockTopicScreenProps?.read.replyHasMore).toBe(true));
  expect(mockTopicScreenProps?.actions.decisionFor({ action: 'reply' })).toEqual({ allowed: true, reason: 'allowed' });
  await act(() => mockTopicScreenProps!.read.loadMoreReplies({ silent: true }));
  expect(mockTopicScreenProps?.read.topicReplies.map((reply) => reply.commentId)).toContain(131);
  expect(mockTopicScreenProps?.read.replyHasMore).toBe(false);
});

async function returnToForum(view: Awaited<ReturnType<typeof mount>>['view']) {
  await waitFor(() => expect(view.getByTestId('verification-webview')).toBeTruthy());
  const challenge = view.getByTestId('verification-webview');
  await fireEvent(challenge, 'loadStart', { nativeEvent: { url: 'https://cdk.linux.do/login', loading: true } });
  await fireEvent(challenge, 'message', {
    nativeEvent: {
      url: 'https://cdk.linux.do',
      data: JSON.stringify({
        type: 'linuxdo-webview',
        documentKey: 'https://cdk.linux.do/login:1234',
        hasChallengeMarker: false
      })
    }
  });
  await waitFor(() =>
    expect(view.getByTestId('verification-webview').props.source.uri).toBe('https://linux.do/latest')
  );
  const observe = (hasSessionInitialization: boolean) =>
    fireEvent(view.getByTestId('verification-webview'), 'message', {
      nativeEvent: {
        url: 'https://linux.do',
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'https://linux.do/latest:1235',
          userAgent: 'Saved fixture browser UA',
          status: 'logged-in',
          hasChallengeMarker: false,
          hasSessionInitialization
        })
      }
    });
  await observe(false);
  return () => observe(true);
}

it('cancels a long-image export when opening login revokes private topic reads at the same epoch', async () => {
  const capture = Promise.withResolvers<Awaited<ReturnType<typeof captureLongTopicImage>>>();
  jest.mocked(captureLongTopicImage).mockClear().mockReturnValueOnce(capture.promise);
  jest.mocked(saveLocalImageFileToLibrary).mockClear();
  const release = jest.fn();
  const privateText = 'Private fixture article';
  const publicText = 'Anonymous replacement article';
  const { view, account } = await mount(async (_url, init) =>
    Response.json({
      ...body,
      post_stream: {
        posts: body.post_stream.posts.map((post) => ({
          ...post,
          cooked: `<p>${init?.credentials === 'omit' ? publicText : privateText}</p>`
        }))
      }
    })
  );
  const captured = { uri: 'file:///synthetic-private-artifact.png', release };
  try {
    await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
    expect(account().read.readGateway.getReadPlan('linuxdo', 'topic')).toMatchObject({ lane: 'authenticated' });
    const epoch = account().read.forumSessionEpochs.linuxdo;
    await act(() => mockTopicScreenProps?.chrome.share());
    await fireEvent.press(view.getByRole('button', { name: '生成长图' }));
    expect(view.getByText(privateText)).toBeTruthy();
    await fireEvent(view.getByTestId('topic-share-content'), 'contentSizeChange', 360, 1000);
    await fireEvent.press(view.getByRole('button', { name: '保存到相册' }));
    await waitFor(() => expect(captureLongTopicImage).toHaveBeenCalledTimes(1));
    const [, signal] = jest.mocked(captureLongTopicImage).mock.calls[0]!;

    await act(async () => account().center.handleAccountCenterCommand({ type: 'open-login', site: 'linuxdo' }));
    expect(account().read.forumSessionEpochs.linuxdo).toBe(epoch);
    expect(account().read.readGateway.getReadPlan('linuxdo', 'topic')).toMatchObject({ lane: 'public' });
    await waitFor(() => expect(mockTopicScreenProps?.article.topic?.contentHtml).toContain(publicText));
    await act(async () => capture.resolve(captured));

    expect(signal.aborted).toBe(true);
    expect(saveLocalImageFileToLibrary).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(view.queryByRole('header', { name: '正文长图', includeHiddenElements: true })).toBeNull();
  } finally {
    capture.resolve(captured);
    await view.unmount();
    await saveAccountSessionSnapshot(seedLinuxDoAccount(), () => true);
  }
});

it.each(['author', 'topic', 'settings', 'edit'])(
  'ignores queued %s navigation after leaving the topic and permits revisiting after return',
  async (destination) => {
    const { view, navigationRef } = await mount(
      async (url) =>
        new Response(
          JSON.stringify(
            url.includes('/t/43.json')
              ? { ...body, id: 43, title: 'Related topic' }
              : destination === 'edit'
                ? { ...body, details: { can_edit: true } }
                : body
          )
        )
    );
    await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
    const chrome = mockTopicScreenProps?.chrome;
    if (!chrome) throw new Error('Expected the mounted Topic route navigation actions');
    if (destination === 'edit' && !chrome.editTopic) throw new Error('Expected the editable topic action');
    const author: UserReference = { source: 'linuxdo', id: '7', username: 'author', url: 'https://linux.do/u/author' };
    const openDestination =
      destination === 'author'
        ? () => chrome.openUser(author)
        : destination === 'topic'
          ? () => chrome.openTopic({ ...topic, id: '43', url: 'https://linux.do/t/43' })
          : destination === 'edit'
            ? chrome.editTopic!
            : chrome.openReadingSettings;
    const routeName =
      destination === 'author'
        ? 'User'
        : destination === 'topic'
          ? 'Topic'
          : destination === 'edit'
            ? 'TopicComposer'
            : 'ReadingSettings';
    await act(() => {
      openDestination();
      openDestination();
      openDestination();
      chrome.openUser({ ...author, id: '8', username: 'another-author' });
      chrome.back();
    });
    expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(['Topic', routeName]);
    if (destination === 'author') expect(view.getByText('用户 author')).toBeTruthy();
    await act(() => navigationRef.goBack());
    expect(view.getByText('Recovered topic')).toBeTruthy();
    await act(() => openDestination());
    expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(['Topic', routeName]);
  }
);

it('keeps a queued favorite tap from a covered topic from changing local data', async () => {
  const { view, navigationRef, readerCommit } = await mount(async () => new Response(JSON.stringify(body)));
  await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
  const chrome = mockTopicScreenProps!.chrome;
  await act(() => {
    chrome.openReadingSettings();
    expect(navigationRef.getCurrentRoute()?.name).toBe('ReadingSettings');
    chrome.toggleFavorite();
  });
  expect(readerCommit).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'favorite' }));

  await act(() => navigationRef.goBack());
  await act(() => mockTopicScreenProps!.chrome.toggleFavorite());
  expect(readerCommit).toHaveBeenCalledWith(expect.objectContaining({ type: 'favorite', enabled: true }));
});

it('keeps a covered topic from opening the browser through either of its existing link actions', async () => {
  const { view, navigationRef } = await mount(async () => new Response(JSON.stringify(body)));
  await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
  const openOriginal = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  const openBrowser = jest.spyOn(WebBrowser, 'openBrowserAsync').mockRejectedValue(new Error('test browser'));
  const { chrome, html } = mockTopicScreenProps!;
  const externalUrl = 'https://example.invalid/forum-help';
  const pressExternalLink = () =>
    html.htmlRenderersProps.a?.onPress?.(
      { stopPropagation: jest.fn() } as never,
      externalUrl,
      {} as never,
      {} as never
    );

  await act(() => {
    chrome.openReadingSettings();
    expect(navigationRef.getCurrentRoute()?.name).toBe('ReadingSettings');
    chrome.openOriginal(topic.url);
    pressExternalLink();
  });
  expect({ original: openOriginal.mock.calls.length, browser: openBrowser.mock.calls.length }).toEqual({
    original: 0,
    browser: 0
  });

  await act(() => navigationRef.goBack());
  await act(() => {
    mockTopicScreenProps!.chrome.openOriginal(topic.url);
    pressExternalLink();
  });
  expect(openOriginal).toHaveBeenCalledWith(topic.url);
  expect(openBrowser).toHaveBeenCalledWith(externalUrl);
});

it('retains the real route detail transport when the app backgrounds and displays its original result on return', async () => {
  const response = Promise.withResolvers<Response>();
  let signal: AbortSignal | undefined;
  const transport = jest.fn(async (_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return response.promise;
  });
  const { view, Harness } = await mount(transport);
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  await view.rerender(<Harness active={false} />);
  expect(signal?.aborted).toBe(false);
  await act(async () => response.resolve(new Response(JSON.stringify(body))));
  await view.rerender(<Harness />);
  await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
  expect(transport).toHaveBeenCalledTimes(1);
});

it('settles a backgrounded route at the original direct and hidden-browser deadlines without restarting on return', async () => {
  jest.useFakeTimers();
  mockStallHiddenRead = true;
  let mounted: Awaited<ReturnType<typeof mount>> | undefined;
  let signal: AbortSignal | undefined;
  const transport = jest.fn(async (_url: string, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>(() => undefined);
  });
  try {
    mounted = await mount(transport);
    const { view, Harness } = mounted;
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTimeAsync(4_000));
    await view.rerender(<Harness active={false} />);
    expect(signal?.aborted).toBe(false);

    // The production direct transport gets 8 s; its real WebView fallback then gets 15 s.
    await act(async () => jest.advanceTimersByTimeAsync(3_999));
    expect(signal?.aborted).toBe(false);
    expect(view.queryByTestId('verification-webview')).toBeNull();
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(signal?.aborted).toBe(true);
    expect(view.getByTestId('verification-webview')).toBeTruthy();
    await act(async () => jest.advanceTimersByTimeAsync(14_999));
    expect(view.queryByText('topic-error', { includeHiddenElements: true })).toBeNull();
    await act(async () => jest.advanceTimersByTimeAsync(1));
    expect(
      view.getByLabelText('linux.do 页面读取超时', { includeHiddenElements: true }).props.accessibilityState
    ).toEqual({
      busy: false
    });

    await view.rerender(<Harness />);
    await act(async () => jest.advanceTimersByTimeAsync(1_000));
    expect(view.getByLabelText('linux.do 页面读取超时').props.accessibilityState).toEqual({ busy: false });
    expect(view.queryByTestId('verification-webview')).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    await mounted?.view.unmount();
    mockStallHiddenRead = false;
    jest.useRealTimers();
  }
});

it('resumes the first cold linux.do read after navigation cancels it and returns to the retained route', async () => {
  let signal: AbortSignal | undefined;
  const transport = jest
    .fn<ReturnType<Fetcher>, Parameters<Fetcher>>()
    .mockImplementationOnce((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Canceled fixture read', 'AbortError')), {
          once: true
        });
      });
    })
    .mockResolvedValueOnce(new Response(JSON.stringify(body)));
  const mountsBefore = mockTopicScreenMount.mock.calls.length;
  const { view } = await mount(transport);
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
  expect(mockTopicScreenMount).toHaveBeenCalledTimes(mountsBefore + 1);
  expect(view.getByText('topic-pending').props.accessibilityState).toEqual({ busy: true });
  await fireEvent.press(view.getByText('离开详情'));
  expect(signal?.aborted).toBe(true);
  expect(mockTopicScreenMount).toHaveBeenCalledTimes(mountsBefore + 1);
  await fireEvent.press(view.getByText('返回详情'));
  await waitFor(() => expect(view.getByText('Recovered topic').props.accessibilityState).toEqual({ busy: false }));
  expect(mockTopicScreenMount).toHaveBeenCalledTimes(mountsBefore + 1);
  expect(transport).toHaveBeenCalledTimes(2);
});

it('reopens Account verification after cancellation and explicitly refreshes the current Topic once', async () => {
  const { view, requests, allow } = await mount();
  await waitFor(() => expect(view.getByText('topic-error')).toBeTruthy());
  await fireEvent.press(view.getByText('取消验证'));
  await act(async () => fireEvent.press(view.getByText('去验证')));
  await waitFor(() => expect(view.getByText('检测并继续')).toBeTruthy());
  await fireEvent.press(view.getByText('取消验证'));
  await act(async () => fireEvent.press(view.getByText('去验证')));
  await waitFor(() => expect(view.getByText('检测并继续')).toBeTruthy());
  const completeInitialization = await returnToForum(view);
  const before = requests.length;
  allow();
  await fireEvent.press(view.getByText('检测并继续'));
  expect(view.getByTestId('verification-webview')).toBeTruthy();
  expect(requests).toHaveLength(before);
  await completeInitialization();
  await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
  expect(requests.slice(before)).toEqual([expect.stringContaining('/t/42.json')]);
  expect(view.queryByText('检测并继续')).toBeNull();
  const confirmed = requests.length;
  await fireEvent.press(view.getByText('离开详情'));
  await fireEvent.press(view.getByText('返回详情'));
  await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
  expect(requests).toHaveLength(confirmed);
});

it.each(['background', 'identity', 'source', 'route'] as const)(
  'drops a pending manual recovery after %s changes',
  async (exit) => {
    const { view, Harness, requests, allow } = await mount();
    await waitFor(() => expect(view.getByText('topic-error')).toBeTruthy());
    await fireEvent.press(view.getByText('取消验证'));
    await act(async () => fireEvent.press(view.getByText('去验证')));
    await waitFor(() => expect(view.getByText('检测并继续')).toBeTruthy());
    const completeInitialization = await returnToForum(view);
    const handoff = Promise.withResolvers<void>();
    const beginHandoff = jest.fn(() => handoff.promise);
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(beginHandoff);
    allow();
    await fireEvent.press(view.getByText('检测并继续'));
    await completeInitialization();
    await waitFor(() => expect(beginHandoff).toHaveBeenCalledTimes(1));
    const before = requests.length;
    if (exit === 'identity') await act(async () => seedLinuxDoAccount('bob'));
    else if (exit === 'route') await fireEvent.press(view.getByText('离开详情'));
    else await view.rerender(<Harness active={exit !== 'background'} enabled={exit !== 'source'} />);
    await act(async () => handoff.resolve());
    expect(requests).toHaveLength(before);
    expect(view.queryByText('Recovered topic')).toBeNull();
  }
);
