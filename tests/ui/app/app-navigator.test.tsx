import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { cleanup } from '@testing-library/react-native';
import { CommonActions, DefaultTheme, useIsFocused, useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { AppNavigator } from '@/app/AppNavigator';
import { useAppLifecycleRuntime } from '@/app/useAppLifecycleRuntime';
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import {
  navigateMainTab,
  navigationRef,
  openNodeSeekCreditsRoute,
  openNotificationsRoute,
  pushTopicRoute,
  pushUserRoute
} from '@/app/appNavigation';
import { TopicRouteBackBoundary, useTopicSelectionBackReport } from '@/features/topic/useTopicRouteBeforeRemove';
import type { Topic, UserReference } from '@/domain/forum/models';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { OriginalImageUpgradeBoundary, useOriginalImageUpgradeEnabled } from '@/platform/media/originalImageLoading';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import type { Screen } from '@/ui/navigation/types';
import type { MoreBadgeState } from '@/ui/navigation/moreBadge';
import { createTheme } from '@/ui/theme/tokens';
import { act, fireEvent, render, waitFor } from '../render';
import { createTestStyles as createStyles } from '../styleFixture';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    ChevronLeft: Icon,
    Bell: Icon,
    Home: Icon,
    MoreHorizontal: Icon,
    Search: Icon,
    Settings: Icon,
    Star: Icon
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const topicA = topic('A');
const topicB = topic('B');
const user: UserReference = { source: 'linuxdo', id: '7', username: 'alice', url: 'https://linux.do/u/alice' };
const userB: UserReference = { source: 'linuxdo', id: '8', username: 'bob', url: 'https://linux.do/u/bob' };

function topic(id: string): Topic {
  return {
    source: 'linuxdo',
    id,
    title: `Topic ${id}`,
    author: 'alice',
    url: `https://linux.do/t/${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    replyCount: 0
  };
}

function StatefulTab({ label }: { label: string }) {
  const focused = useIsFocused();
  const [value, setValue] = useState('');
  const [scrollToTopCount, setScrollToTopCount] = useState(0);
  const scrollRef = useRef({ scrollToTop: () => setScrollToTopCount((current) => current + 1) });
  useScrollToTop(scrollRef);
  return (
    <View>
      <Text>{label}页面</Text>
      <Text>{`${label} ${focused ? 'focused' : 'inactive'}`}</Text>
      <Text>{`${label}回顶 ${scrollToTopCount}`}</Text>
      <TextInput accessibilityLabel={`${label}状态`} value={value} onChangeText={setValue} />
    </View>
  );
}

function FeedTab() {
  return <StatefulTab label="首页" />;
}

function SearchTab() {
  return <StatefulTab label="搜索" />;
}

function LibraryTab() {
  return <StatefulTab label="收藏" />;
}

function MoreTab() {
  return (
    <View>
      <StatefulTab label="更多" />
      <Pressable accessibilityLabel="打开收藏" onPress={() => navigationRef.navigate('Library')}>
        <Text>打开收藏</Text>
      </Pressable>
    </View>
  );
}

function ReadingSettingsRoute() {
  return <Text>阅读设置页面</Text>;
}

function NotificationsRoute() {
  return <StatefulTab label="消息" />;
}

function CreditsRoute({ route }: NativeStackScreenProps<RootStackParamList, 'NodeSeekCredits'>) {
  return <Text>{`${route.params.currency === 'stardust' ? '星辰' : '鸡腿'}流水 ${route.params.identityKey}`}</Text>;
}

function NotificationDetailRoute() {
  return <Text>消息详情页面</Text>;
}

function NotificationSettingsRoute() {
  return <Text>消息设置页面</Text>;
}

function TopicComposerRoute() {
  return <Text>新主题编辑页</Text>;
}

function OriginalUpgradeProbe({ id }: { id: string }) {
  const enabled = useOriginalImageUpgradeEnabled();
  return <Text>{`${id} originals ${enabled ? 'active' : 'paused'}`}</Text>;
}

function StatefulTopicRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Topic'>) {
  const active = useIsFocused();
  const { topic: routeTopic } = route.params;
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('all');
  const [scrollY, setScrollY] = useState('0');
  const [submitted, setSubmitted] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  return (
    <TopicRouteBackBoundary
      imagePreviewOpen={imagePreviewOpen}
      replyComposerOpen={composerOpen}
      closeImagePreview={() => setImagePreviewOpen(false)}
      closeReplyComposer={() => setComposerOpen(false)}
    >
      <OriginalImageUpgradeBoundary enabled={active}>
        <View>
          <SelectionBackProbe />
          <Text>{routeTopic.title}</Text>
          <TextInput accessibilityLabel={`${routeTopic.id}草稿`} value={draft} onChangeText={setDraft} />
          <TextInput accessibilityLabel={`${routeTopic.id}筛选`} value={filter} onChangeText={setFilter} />
          <TextInput accessibilityLabel={`${routeTopic.id}滚动`} value={scrollY} onChangeText={setScrollY} />
          <OriginalUpgradeProbe id={routeTopic.id} />
          <Text>{`${routeTopic.id} submitted ${submitted ? 'visible' : 'empty'}`}</Text>
          <Text>{`${routeTopic.id} composer ${composerOpen ? 'open' : 'closed'}`}</Text>
          <Text>{`${routeTopic.id} image ${imagePreviewOpen ? 'open' : 'closed'}`}</Text>
          <Pressable accessibilityLabel="打开回复框" onPress={() => setComposerOpen(true)}>
            <Text>打开回复框</Text>
          </Pressable>
          <Pressable accessibilityLabel="打开图片预览" onPress={() => setImagePreviewOpen(true)}>
            <Text>打开图片预览</Text>
          </Pressable>
          <Pressable accessibilityLabel="提交本地内容" onPress={() => setSubmitted(true)}>
            <Text>提交本地内容</Text>
          </Pressable>
          <Pressable accessibilityLabel="打开 Topic B" onPress={() => navigation.push('Topic', { topic: topicB })}>
            <Text>打开 Topic B</Text>
          </Pressable>
          <Pressable accessibilityLabel="打开用户" onPress={() => navigation.push('User', { user })}>
            <Text>打开用户</Text>
          </Pressable>
          <Pressable accessibilityLabel="打开阅读设置" onPress={() => navigation.push('ReadingSettings')}>
            <Text>打开阅读设置</Text>
          </Pressable>
        </View>
      </OriginalImageUpgradeBoundary>
    </TopicRouteBackBoundary>
  );
}

function SelectionBackProbe() {
  const report = useTopicSelectionBackReport();
  const [selected, setSelected] = useState(false);
  return (
    <Pressable
      accessibilityLabel="选择正文"
      onPress={() => {
        setSelected(true);
        report(() => {
          setSelected(false);
          report(null);
        });
      }}
    >
      <Text>{selected ? '正文已选择' : '正文未选择'}</Text>
    </Pressable>
  );
}

function StatefulUserRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'User'>) {
  const identity = route.params.user.id || route.params.user.username || '';
  const [filter, setFilter] = useState<string>(route.params.initialTab || 'topics');
  const [scrollY, setScrollY] = useState('0');
  return (
    <View>
      <Text>{`用户详情页面 ${route.params.user.username || route.params.user.id}`}</Text>
      <TextInput accessibilityLabel={`${identity}用户筛选`} value={filter} onChangeText={setFilter} />
      <TextInput accessibilityLabel={`${identity}用户滚动`} value={scrollY} onChangeText={setScrollY} />
      {identity === '7' ? (
        <Pressable accessibilityLabel="打开用户 B" onPress={() => navigation.push('User', { user: userB })}>
          <Text>打开用户 B</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Navigator({
  moreBadgeState,
  moreHasBadge = false,
  onReady = jest.fn(),
  onScreenChange = jest.fn()
}: {
  moreBadgeState?: MoreBadgeState;
  moreHasBadge?: boolean;
  onReady?: () => void;
  onScreenChange?: (screen: Screen, routeKey: string) => void;
}) {
  return (
    <AppNavigator
      moreBadgeState={moreBadgeState ?? (moreHasBadge ? 'update' : 'none')}
      navigationTheme={DefaultTheme}
      FeedRouteComponent={FeedTab}
      getTopicComposerRoute={() => TopicComposerRoute}
      getLibraryRoute={() => LibraryTab}
      getMoreRoute={() => MoreTab}
      getNotificationDetailRoute={() => NotificationDetailRoute}
      getNotificationSettingsRoute={() => NotificationSettingsRoute}
      getNotificationsRoute={() => NotificationsRoute}
      getReadingSettingsRoute={() => ReadingSettingsRoute}
      getNodeSeekCreditsRoute={() => CreditsRoute}
      getSearchRoute={() => SearchTab}
      getTopicRoute={() => StatefulTopicRoute}
      getUserRoute={() => StatefulUserRoute}
      styles={styles}
      theme={theme}
      onReady={onReady}
      onScreenChange={onScreenChange}
    />
  );
}

function DiagnosticNavigator() {
  const lifecycle = useAppLifecycleRuntime();
  return <Navigator onScreenChange={lifecycle.onScreenChange} />;
}

function DeepLinkNavigator({ linking }: { linking: Pick<typeof Linking, 'addEventListener' | 'getInitialURL'> }) {
  const onReady = useAppDeepLinkNavigation(linking);
  return <Navigator onReady={onReady} />;
}

async function renderNavigator(moreHasBadge = false) {
  const view = await render(<Navigator moreHasBadge={moreHasBadge} />);
  await waitFor(() => expect(navigationRef.isReady()).toBe(true));
  await act(async () => {
    navigateMainTab('feed');
  });
  await waitFor(() => expect(view.getByText('首页页面')).toBeTruthy());
  return view;
}

describe('App navigator UI state', () => {
  it('keeps four primary tabs and returns from the collection to the same More instance', async () => {
    const view = await renderNavigator();
    expect(view.getAllByTestId(/^main-tab-/).map((tab) => tab.props.testID)).toEqual([
      'main-tab-feed',
      'main-tab-search',
      'main-tab-notifications',
      'main-tab-more'
    ]);
    expect(view.queryByTestId('main-tab-library')).toBeNull();
    expect(view.getByTestId('main-tab-notifications')).toBeTruthy();
    await fireEvent.press(view.getByTestId('main-tab-more'));
    await fireEvent.changeText(view.getByLabelText('更多状态'), '保留更多状态');
    const moreKey = navigationRef.getCurrentRoute()!.key;
    await fireEvent.press(view.getByLabelText('打开收藏'));
    expect(navigationRef.getCurrentRoute()?.name).toBe('Library');
    expect(view.getByText('收藏页面')).toBeTruthy();
    await fireEvent.changeText(view.getByLabelText('收藏状态'), '收藏筛选');
    await act(async () => pushTopicRoute({ topic: topicA }));
    await act(async () => navigationRef.goBack());
    expect(view.getByLabelText('收藏状态').props.value).toBe('收藏筛选');
    await act(async () => navigationRef.goBack());
    expect(navigationRef.getCurrentRoute()?.key).toBe(moreKey);
    expect(view.getByLabelText('更多状态').props.value).toBe('保留更多状态');
    await fireEvent.press(view.getByTestId('main-tab-notifications'));
    expect(view.getByText('消息页面')).toBeTruthy();
    expect(navigationRef.getRootState()?.routes).toHaveLength(1);
  });

  it('opens account replies and the identity-bound credits page while preserving More on return', async () => {
    const view = await render(<Navigator />);
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));
    await fireEvent.press(view.getByTestId('main-tab-more'));
    await waitFor(() => expect(view.getByLabelText('更多状态')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('更多状态'), 'expanded-nodeseek');
    await act(async () => {
      pushUserRoute(user, 'replies');
    });
    await waitFor(() => expect(view.getByLabelText('7用户筛选').props.value).toBe('replies'));
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByLabelText('更多状态').props.value).toBe('expanded-nodeseek'));
    await act(async () => {
      openNodeSeekCreditsRoute({ identityKey: 'nodeseek:42', userId: '42' });
    });
    await waitFor(() => expect(view.getByText('鸡腿流水 nodeseek:42')).toBeTruthy());
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByLabelText('更多状态').props.value).toBe('expanded-nodeseek'));
    await act(async () => {
      openNodeSeekCreditsRoute({ identityKey: 'nodeseek:42', userId: '42', currency: 'stardust' });
    });
    await waitFor(() => expect(view.getByText('星辰流水 nodeseek:42')).toBeTruthy());
    await act(async () => navigationRef.goBack());
    await waitFor(() => expect(view.getByLabelText('更多状态').props.value).toBe('expanded-nodeseek'));
  });
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await cleanup();
    setDiagnosticWriter(null);
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('isolates repeated cross-source route stacks from initial links belonging to unmounted apps', async () => {
    const pendingLinks: ReturnType<typeof Promise.withResolvers<string | null>>[] = [];
    const listeners = new Set<(event: { url: string }) => void>();
    const removeListener = jest.fn();
    const initialUrl = jest.fn(() => {
      const pending = Promise.withResolvers<string | null>();
      pendingLinks.push(pending);
      return pending.promise;
    });
    const subscribe = jest.fn((_type: 'url', listener: (event: { url: string }) => void) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
          removeListener();
        }
      };
    });
    const linking = { addEventListener: subscribe, getInitialURL: initialUrl } as unknown as Pick<
      typeof Linking,
      'addEventListener' | 'getInitialURL'
    >;
    const sources = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'] as const;
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      for (let round = 0; round < 20; round++) {
        view = await render(<DeepLinkNavigator linking={linking} />);
        await waitFor(() => expect(navigationRef.isReady()).toBe(true));
        expect(listeners.size).toBe(1);
        expect(initialUrl).toHaveBeenCalledTimes(round + 1);
        if (round > 0) {
          await act(async () => pendingLinks[round - 1].resolve(`https://linux.do/t/stale/${90_000 + round}/3`));
        }
        expect(navigationRef.getRootState()?.routes).toHaveLength(1);
        expect(navigationRef.getCurrentRoute()?.name).toBe('feed');
        await fireEvent.changeText(view.getByLabelText('首页状态'), `feed-${round}`);
        await fireEvent.press(view.getByTestId('main-tab-search'));
        await fireEvent.changeText(view.getByLabelText('搜索状态'), `search-${round}`);

        const routeKeys: string[] = [];
        for (const [index, source] of sources.entries()) {
          const id = String(10_000 + round * sources.length + index);
          const url = {
            v2ex: `https://www.v2ex.com/t/${id}`,
            linuxdo: `https://linux.do/t/${id}`,
            nodeseek: `https://www.nodeseek.com/post-${id}-1`,
            yaohuo: `https://www.yaohuo.me/bbs-${id}.html`
          }[source];
          await act(async () => {
            expect(pushTopicRoute({ topic: { ...topic(id), source, url } })).toBe(true);
          });
          expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'Topic', params: { topic: { id, source } } });
          expect(navigationRef.getRootState()?.routes).toHaveLength(index + 2);
          routeKeys.push(navigationRef.getCurrentRoute()!.key);
          await fireEvent.changeText(view.getByLabelText(`${id}草稿`), `${source}-${round}`);
        }
        expect(new Set(routeKeys).size).toBe(sources.length);
        for (let index = sources.length - 1; index >= 0; index--) {
          const id = String(10_000 + round * sources.length + index);
          expect(navigationRef.getCurrentRoute()?.key).toBe(routeKeys[index]);
          expect(view.getByLabelText(`${id}草稿`).props.value).toBe(`${sources[index]}-${round}`);
          await act(async () => navigationRef.goBack());
          expect(view.queryByLabelText(`${id}草稿`, { includeHiddenElements: true })).toBeNull();
        }
        expect(navigationRef.getRootState()?.routes).toHaveLength(1);
        expect(view.getByLabelText('搜索状态').props.value).toBe(`search-${round}`);
        await fireEvent.press(view.getByTestId('main-tab-feed'));
        expect(view.getByLabelText('首页状态').props.value).toBe(`feed-${round}`);
        await view.unmount();
        view = undefined;
        expect(listeners.size).toBe(0);
        expect(removeListener).toHaveBeenCalledTimes(round + 1);
      }
    } finally {
      await view?.unmount();
      await act(async () => pendingLinks.forEach((pending) => pending.resolve(null)));
    }
  }, 30_000);

  it('opens one draft page for repeated create navigation and returns to the original feed', async () => {
    const view = await renderNavigator();
    await fireEvent.changeText(view.getByLabelText('首页状态'), '保留首页状态');
    const originalRootKey = navigationRef.getRootState()!.routes[0]!.key;
    await act(async () => {
      navigationRef.dispatch(CommonActions.navigate('TopicComposer', { initialSource: 'nodeseek' }));
      navigationRef.dispatch(CommonActions.navigate('TopicComposer', { initialSource: 'nodeseek' }));
    });
    await waitFor(() => expect(view.getByText('新主题编辑页')).toBeTruthy());
    expect(navigationRef.getRootState()!.routes.filter((route) => route.name === 'TopicComposer')).toHaveLength(1);
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByLabelText('首页状态').props.value).toBe('保留首页状态'));
    expect(navigationRef.getRootState()!.routes).toHaveLength(1);
    expect(navigationRef.getRootState()!.routes[0]!.key).toBe(originalRootKey);
  });

  it('distinguishes same-screen topic and user navigation with stable anonymous targets', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const view = await render(<DiagnosticNavigator />);
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));
    const privateTopicA = {
      ...topicA,
      id: 'PRIVATE_TOPIC_A',
      title: 'PRIVATE_TITLE_A',
      url: 'https://private.invalid/topic/a'
    };
    const privateTopicB = {
      ...topicB,
      id: 'PRIVATE_TOPIC_B',
      title: 'PRIVATE_TITLE_B',
      url: 'https://private.invalid/topic/b'
    };
    const privateUserA = { ...user, id: 'PRIVATE_USER_ID_A', username: 'PRIVATE_USER_A' };
    const privateUserB = { ...userB, id: 'PRIVATE_USER_ID_B', username: 'PRIVATE_USER_B' };
    const routeKeys: string[] = [];
    const captureRouteKey = () => routeKeys.push(navigationRef.getCurrentRoute()!.key);
    await act(async () => {
      pushTopicRoute({ topic: privateTopicA, location: { kind: 'reply', target: { floor: 7 } } });
    });
    await waitFor(() => expect(view.getByText('PRIVATE_TITLE_A')).toBeTruthy());
    captureRouteKey();
    await act(async () => {
      pushTopicRoute({ topic: privateTopicB });
    });
    await waitFor(() => expect(view.getByText('PRIVATE_TITLE_B')).toBeTruthy());
    captureRouteKey();
    await act(async () => navigationRef.goBack());
    await waitFor(() => expect(view.getByText('PRIVATE_TITLE_A')).toBeTruthy());
    await act(async () => {
      pushUserRoute(privateUserA);
    });
    await waitFor(() => expect(view.getByText('用户详情页面 PRIVATE_USER_A')).toBeTruthy());
    captureRouteKey();
    await act(async () => {
      pushUserRoute(privateUserB);
    });
    await waitFor(() => expect(view.getByText('用户详情页面 PRIVATE_USER_B')).toBeTruthy());
    captureRouteKey();
    await act(async () => navigationRef.goBack());
    await waitFor(() => expect(view.getByText('用户详情页面 PRIVATE_USER_A')).toBeTruthy());
    const events = lines
      .map((line) => JSON.parse(line))
      .filter((event) => event.operation === 'screen-change' && event.phase === 'finish');
    const topics = events.filter((event) => event.topicRef);
    expect(topics).toEqual([
      expect.objectContaining({ outcome: 'success', source: 'linuxdo', hasTargetReply: true }),
      expect.objectContaining({ outcome: 'success', source: 'linuxdo', hasTargetReply: false }),
      expect.objectContaining({ outcome: 'success', source: 'linuxdo', hasTargetReply: true })
    ]);
    expect(topics[0].topicRef).not.toBe(topics[1].topicRef);
    expect(topics[0].topicRef).toBe(topics[2].topicRef);
    const users = events.filter((event) => event.userRef);
    expect(users).toHaveLength(3);
    expect(users.every((event) => event.outcome === 'success' && event.source === 'linuxdo')).toBe(true);
    expect(users[0].userRef).not.toBe(users[1].userRef);
    expect(users[0].userRef).toBe(users[2].userRef);
    await act(async () => navigationRef.setParams({ user: privateUserA }));
    await waitFor(() =>
      expect(lines.map((line) => JSON.parse(line)).at(-1)).toMatchObject({
        operation: 'screen-change',
        phase: 'finish',
        outcome: 'noop',
        userRef: users[0].userRef
      })
    );
    expect(lines.join('')).not.toMatch(/PRIVATE_|https:\/\//);
    routeKeys.forEach((routeKey) => expect(lines.join('')).not.toContain(routeKey));
  });

  it.each<[MoreBadgeState, string, string]>([
    ['none', '更多', '消息'],
    ['update', '更多，有可用更新', '消息'],
    ['messages', '更多', '消息，有新消息'],
    ['both', '更多，有可用更新', '消息，有新消息']
  ])(
    'keeps %s update and unread badges on their own destinations',
    async (moreBadgeState, moreLabel, messagesLabel) => {
      const view = await render(<Navigator moreBadgeState={moreBadgeState} />);

      expect(view.getByLabelText(moreLabel)).toBeTruthy();
      expect(view.getByLabelText(messagesLabel)).toBeTruthy();
    }
  );

  it('opens an Android summary in the message tab and returns from settings to that tab', async () => {
    const view = await renderNavigator();

    const searchTab = view.getByTestId('main-tab-search');
    expect(searchTab.props.android_ripple).toBeUndefined();
    expect(searchTab.props.hoverEffect).toBeUndefined();

    await act(async () => {
      expect(openNotificationsRoute('linuxdo')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('消息页面')).toBeTruthy());
    expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'notifications', params: { source: 'linuxdo' } });
    expect(navigationRef.getRootState()?.routes).toHaveLength(1);
    expect(view.getByRole('heading', { name: '消息' })).toBeTruthy();

    expect(view.queryByLabelText('返回')).toBeNull();

    const settingsButton = view.getByLabelText('消息通知设置');
    expect(settingsButton.props.android_ripple).toBeUndefined();
    expect(settingsButton.props.style).not.toEqual(expect.any(Function));
    await fireEvent.press(settingsButton);
    await waitFor(() => expect(view.getByText('消息设置页面')).toBeTruthy());
    const settingsHeader = view.container.queryAll(
      (node) => node.props.title === '消息通知设置' && 'hideShadow' in node.props
    )[0];
    expect(settingsHeader?.props.hideShadow).toBe(true);
    const backButton = view.getByLabelText('返回');
    expect(backButton.props.android_ripple).toBeUndefined();
    expect(backButton.props.style).not.toEqual(expect.any(Function));
    await fireEvent.press(backButton);
    expect(navigationRef.getCurrentRoute()?.name).toBe('notifications');
  });

  it('preserves the complete destination when pushing a Topic route', async () => {
    await renderNavigator();
    const destination: RootStackParamList['Topic'] = {
      location: { kind: 'reply', target: { floor: 155, pageHint: 16 } },
      topic: topicA
    };
    await act(async () => {
      expect(pushTopicRoute(destination)).toBe(true);
    });

    await waitFor(() => expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'Topic', params: destination }));
  });

  it('lazily retains four tab states while exposing only the focused leaf route', async () => {
    const view = await renderNavigator();
    const tabs = [
      { route: 'feed', label: '首页' },
      { route: 'search', label: '搜索' },
      { route: 'notifications', label: '消息' },
      { route: 'more', label: '更多' }
    ];
    const expectFocusedTab = async (focusedLabel: string | null) => {
      await waitFor(() => {
        for (const { label } of tabs) {
          const focused = label === focusedLabel;
          expect(
            view.getByText(`${label} ${focused ? 'focused' : 'inactive'}`, { includeHiddenElements: true })
          ).toBeTruthy();
          if (focused) {
            expect(view.getByLabelText(`${label}状态`).props.value).toBe(`${label}-state`);
          } else {
            expect(view.queryByText(`${label}页面`)).toBeNull();
            expect(view.queryByLabelText(`${label}状态`)).toBeNull();
          }
          expect(view.getByLabelText(`${label}状态`, { includeHiddenElements: true }).props.value).toBe(
            `${label}-state`
          );
        }
      });
    };

    expect(view.getByText('首页页面')).toBeTruthy();
    expect(view.queryByText('搜索页面', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByText('消息页面', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByText('更多页面', { includeHiddenElements: true })).toBeNull();

    for (const { route, label } of tabs) {
      await fireEvent.press(view.getByTestId(`main-tab-${route}`));
      await waitFor(() => expect(view.getByText(`${label}页面`)).toBeTruthy());
      await fireEvent.changeText(view.getByLabelText(`${label}状态`), `${label}-state`);
    }
    for (const { route, label } of tabs) {
      await fireEvent.press(view.getByTestId(`main-tab-${route}`));
      await expectFocusedTab(label);
    }

    await act(async () => {
      expect(pushTopicRoute({ topic: topicA })).toBe(true);
    });
    await waitFor(() => expect(view.getByText('Topic A')).toBeTruthy());
    await expectFocusedTab(null);
    await act(async () => navigationRef.goBack());
    await expectFocusedTab('更多');
  });

  it('keeps tab and native route state owned by their mounted route instances', async () => {
    const view = await renderNavigator(true);
    await fireEvent.changeText(view.getByLabelText('首页状态'), 'feed-state');
    await fireEvent.press(view.getByTestId('main-tab-search'));
    await waitFor(() => expect(view.getByText('搜索页面')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索状态'), 'search-state');
    await fireEvent.press(view.getByTestId('main-tab-feed'));

    await waitFor(() => expect(view.getByLabelText('首页状态').props.value).toBe('feed-state'));
    await fireEvent.press(view.getByTestId('main-tab-feed'));
    await waitFor(() => expect(view.getByText('首页回顶 1')).toBeTruthy());
    await fireEvent.press(view.getByTestId('main-tab-search'));
    await waitFor(() => expect(view.getByLabelText('搜索状态').props.value).toBe('search-state'));
    expect(view.getByLabelText('更多，有可用更新')).toBeTruthy();

    await act(async () => {
      expect(pushTopicRoute({ topic: topicA })).toBe(true);
    });
    await waitFor(() => expect(view.getByText('Topic A')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('A草稿'), 'draft-a');
    await fireEvent.changeText(view.getByLabelText('A筛选'), 'author');
    await fireEvent.changeText(view.getByLabelText('A滚动'), '480');
    await fireEvent.press(view.getByLabelText('提交本地内容'));
    await fireEvent.press(view.getByLabelText('打开 Topic B'));
    await waitFor(() => expect(view.getByText('Topic B')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('B草稿'), 'draft-b');

    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => {
      expect(view.getByLabelText('A草稿').props.value).toBe('draft-a');
      expect(view.getByLabelText('A筛选').props.value).toBe('author');
      expect(view.getByLabelText('A滚动').props.value).toBe('480');
      expect(view.getByText('A submitted visible')).toBeTruthy();
    });

    await fireEvent.press(view.getByLabelText('打开用户'));
    await waitFor(() => expect(view.getByText('用户详情页面 alice')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('7用户筛选'), 'replies');
    await fireEvent.changeText(view.getByLabelText('7用户滚动'), '320');
    await fireEvent.press(view.getByLabelText('打开用户 B'));
    await waitFor(() => expect(view.getByText('用户详情页面 bob')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('8用户筛选'), 'topics-b');
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => {
      expect(view.getByLabelText('7用户筛选').props.value).toBe('replies');
      expect(view.getByLabelText('7用户滚动').props.value).toBe('320');
    });
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByLabelText('A草稿').props.value).toBe('draft-a'));

    await fireEvent.press(view.getByLabelText('打开阅读设置'));
    await waitFor(() => expect(view.getByText('阅读设置页面')).toBeTruthy());
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => expect(view.getByLabelText('A筛选').props.value).toBe('author'));

    await fireEvent.press(view.getByLabelText('选择正文'));
    await fireEvent.press(view.getByLabelText('打开回复框'));
    await fireEvent.press(view.getByLabelText('打开图片预览'));
    await waitFor(() => {
      expect(view.getByText('A composer open')).toBeTruthy();
      expect(view.getByText('A image open')).toBeTruthy();
    });
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => {
      expect(view.getByText('A image closed')).toBeTruthy();
      expect(view.getByText('A composer open')).toBeTruthy();
      expect(view.getByText('Topic A')).toBeTruthy();
    });
    await act(async () => {
      navigationRef.goBack();
    });
    await waitFor(() => {
      expect(view.getByText('A composer closed')).toBeTruthy();
      expect(view.getByText('Topic A')).toBeTruthy();
      expect(view.getByText('正文已选择')).toBeTruthy();
    });
    await act(async () => navigationRef.goBack());
    await waitFor(() => {
      expect(view.getByText('Topic A')).toBeTruthy();
      expect(view.getByText('正文未选择')).toBeTruthy();
    });

    await act(async () => {
      expect(pushTopicRoute({ topic: topicB })).toBe(true);
    });

    await waitFor(() => {
      expect(view.getByText('B originals active')).toBeTruthy();
      expect(view.getByText('A originals paused', { includeHiddenElements: true })).toBeTruthy();
    });

    await act(async () => {
      navigationRef.goBack();
      expect(pushUserRoute(user)).toBe(true);
    });
    await waitFor(() => expect(view.getByText('用户详情页面 alice')).toBeTruthy());
    expect(navigationRef.getCurrentRoute()?.params).toEqual({ user });
  });
});
