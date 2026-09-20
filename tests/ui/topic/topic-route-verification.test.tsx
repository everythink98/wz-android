import type { ComponentProps } from 'react';
import { Pressable, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import type { TopicScreen } from '@/features/topic/TopicScreen';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import { createEmptyReaderState } from '@/domain/reader/readerRecordState';
import { accountSessionSnapshotFromEvent, createAccountSessionSnapshot } from '@/domain/session/siteSessionState';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { ForumSessionEpochProvider } from '@/platform/media/mediaSessionEpoch';
import { setLinuxDoCookieResponseBarrier } from '@/platform/network/managedCookies';
import type { Fetcher } from '@/platform/network/request';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { createTheme } from '@/ui/theme/tokens';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

let mockStallHiddenRead = false;
const mockTopicScreenMount = jest.fn();

// Presentation and native WebView are boundaries; Route, Account, gateway and Query owners are real.
jest.mock('@/features/topic/TopicScreen', () => {
  const React = require('react');
  const { Text, Pressable } = require('react-native');
  return {
    TopicScreen: (props: ComponentProps<typeof TopicScreen>) => {
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
  readManagedCookieHeader: jest.fn(async () => ({ status: 'ok', header: 'test-session=fixture' }))
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
function seedAccount(username = 'alice') {
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot('linuxdo'),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot('linuxdo'), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { source: 'linuxdo', id: username, username, url: `https://linux.do/u/${username}` }
    })
  );
}

async function mount(readTopic?: Fetcher) {
  seedAccount();
  let challenged = true;
  const requests: string[] = [];
  const fetcher: Fetcher = async (url, init) => {
    requests.push(url);
    if (url.includes('/t/42.json') && readTopic) return readTopic(url, init);
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
  function Harness({ active = true, enabled = true }: { active?: boolean; enabled?: boolean }) {
    const account = useAccountRuntime({
      appActive: active,
      enabledSources: enabled ? ['linuxdo'] : [],
      fetcher,
      loginNavigation: { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true },
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser: async () => undefined,
      ready: false,
      screen: 'topic',
      webViewBlockMessage: ''
    });
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
      reader: { commit: jest.fn(), data, dataRef: { current: data } },
      readerStyle: { settings: data.settings, theme: createTheme(data.settings) }
    };
    return (
      <ForumSessionEpochProvider sessionEpochs={account.read.forumSessionEpochs} transportIdentity="applied">
        <TopicRouteRuntimeProvider value={runtime}>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }}>
              <Stack.Screen name="Topic" component={TopicRoute} initialParams={{ topic }} />
              <Stack.Screen name="ReadingSettings">
                {({ navigation }) => (
                  <Pressable onPress={navigation.goBack}>
                    <Text>返回详情</Text>
                  </Pressable>
                )}
              </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
          {account.hosts.element}
          <Pressable onPress={() => account.hosts.closeTopmostSurface()}>
            <Text>取消验证</Text>
          </Pressable>
        </TopicRouteRuntimeProvider>
      </ForumSessionEpochProvider>
    );
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  return {
    view,
    Harness,
    requests,
    allow: () => {
      challenged = false;
    }
  };
}

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
  await waitFor(() => expect(view.getByText('检测状态')).toBeTruthy());
  await fireEvent.press(view.getByText('取消验证'));
  await act(async () => fireEvent.press(view.getByText('去验证')));
  await waitFor(() => expect(view.getByText('检测状态')).toBeTruthy());
  const before = requests.length;
  allow();
  await fireEvent.press(view.getByText('检测状态'));
  await waitFor(() => expect(view.getByText('Recovered topic')).toBeTruthy());
  expect(requests.slice(before)).toEqual([expect.stringContaining('/t/42.json')]);
  expect(view.queryByText('检测状态')).toBeNull();
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
    await waitFor(() => expect(view.getByText('检测状态')).toBeTruthy());
    const handoff = Promise.withResolvers<void>();
    jest.mocked(setLinuxDoCookieResponseBarrier).mockImplementationOnce(() => handoff.promise);
    allow();
    await fireEvent.press(view.getByText('检测状态'));
    const before = requests.length;
    if (exit === 'identity') await act(async () => seedAccount('bob'));
    else if (exit === 'route') await fireEvent.press(view.getByText('离开详情'));
    else await view.rerender(<Harness active={exit !== 'background'} enabled={exit !== 'source'} />);
    await act(async () => handoff.resolve());
    expect(requests).toHaveLength(before);
    expect(view.queryByText('Recovered topic')).toBeNull();
  }
);
