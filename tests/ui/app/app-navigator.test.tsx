import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { cleanup } from '@testing-library/react-native';
import { DefaultTheme, useIsFocused, useScrollToTop } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppNavigator } from '@/app/AppNavigator';
import {
  navigateMainTab,
  navigationRef,
  openNotificationsRoute,
  pushTopicRoute,
  pushUserRoute
} from '@/app/appNavigation';
import { TopicRouteBackBoundary, useTopicSelectionBackReport } from '@/features/topic/useTopicRouteBeforeRemove';
import type { Topic, UserReference } from '@/domain/forum/models';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { OriginalImageUpgradeBoundary, useOriginalImageUpgradeEnabled } from '@/platform/media/originalImageLoading';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import type { MoreBadgeState } from '@/ui/navigation/moreBadge';
import { createTheme } from '@/ui/theme/tokens';
import { act, fireEvent, render, waitFor } from '../render';
import { createTestStyles as createStyles } from '../styleFixture';

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
  const [value, setValue] = useState('');
  const [scrollToTopCount, setScrollToTopCount] = useState(0);
  const scrollRef = useRef({ scrollToTop: () => setScrollToTopCount((current) => current + 1) });
  useScrollToTop(scrollRef);
  return (
    <View>
      <Text>{label}页面</Text>
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
  return <StatefulTab label="更多" />;
}

function ReadingSettingsRoute() {
  return <Text>阅读设置页面</Text>;
}

function NotificationsRoute() {
  return <Text>消息页面</Text>;
}

function NotificationDetailRoute() {
  return <Text>消息详情页面</Text>;
}

function NotificationSettingsRoute() {
  return <Text>消息设置页面</Text>;
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
  const [filter, setFilter] = useState('topics');
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
  moreHasBadge = false
}: {
  moreBadgeState?: MoreBadgeState;
  moreHasBadge?: boolean;
}) {
  return (
    <AppNavigator
      moreBadgeState={moreBadgeState ?? (moreHasBadge ? 'update' : 'none')}
      navigationTheme={DefaultTheme}
      FeedRouteComponent={FeedTab}
      LibraryRouteComponent={LibraryTab}
      MoreRouteComponent={MoreTab}
      NotificationDetailRouteComponent={NotificationDetailRoute}
      NotificationSettingsRouteComponent={NotificationSettingsRoute}
      NotificationsRouteComponent={NotificationsRoute}
      ReadingSettingsRouteComponent={ReadingSettingsRoute}
      SearchRouteComponent={SearchTab}
      TopicRouteComponent={StatefulTopicRoute}
      UserRouteComponent={StatefulUserRoute}
      styles={styles}
      theme={theme}
      onReady={jest.fn()}
      onScreenChange={jest.fn()}
    />
  );
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
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await cleanup();
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it.each<[MoreBadgeState, string]>([
    ['none', '更多'],
    ['update', '更多，有可用更新'],
    ['messages', '更多，有新消息'],
    ['both', '更多，有新消息和可用更新']
  ])('renders the %s More badge accessibility label', async (moreBadgeState, label) => {
    const view = await render(<Navigator moreBadgeState={moreBadgeState} />);

    expect(view.getByLabelText(label)).toBeTruthy();
  });

  it('opens an Android summary with a flat header and keeps settings in the More stack', async () => {
    const view = await renderNavigator();

    const searchTab = view.getByTestId('main-tab-search');
    expect(searchTab.props.android_ripple).toBeUndefined();
    expect(searchTab.props.hoverEffect).toBeUndefined();

    await act(async () => {
      expect(openNotificationsRoute('linuxdo')).toBe(true);
    });
    await waitFor(() => expect(view.getByText('消息页面')).toBeTruthy());
    expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'Notifications', params: { source: 'linuxdo' } });
    const header = view.container.queryAll((node) => node.props.title === '消息' && 'hideShadow' in node.props)[0];
    expect(header?.props.hideShadow).toBe(true);

    const backButton = view.getByLabelText('返回');
    expect(backButton.props.android_ripple).toBeUndefined();
    expect(backButton.props.style).not.toEqual(expect.any(Function));

    const settingsButton = view.getByLabelText('消息通知设置');
    expect(settingsButton.props.android_ripple).toBeUndefined();
    expect(settingsButton.props.style).not.toEqual(expect.any(Function));
    await fireEvent.press(settingsButton);
    await waitFor(() => expect(view.getByText('消息设置页面')).toBeTruthy());
    const settingsHeader = view.container.queryAll(
      (node) => node.props.title === '消息通知设置' && 'hideShadow' in node.props
    )[0];
    expect(settingsHeader?.props.hideShadow).toBe(true);
  });

  it('preserves the complete destination when pushing a Topic route', async () => {
    await renderNavigator();
    const destination: RootStackParamList['Topic'] = {
      targetReply: { floor: 155, pageHint: 16 },
      topic: topicA
    };
    await act(async () => {
      expect(pushTopicRoute(destination)).toBe(true);
    });

    await waitFor(() => expect(navigationRef.getCurrentRoute()).toMatchObject({ name: 'Topic', params: destination }));
  });

  it('mounts only the active tab initially and preserves a visited tab instance', async () => {
    const view = await renderNavigator();

    expect(view.getByText('首页页面')).toBeTruthy();
    expect(view.queryByText('搜索页面', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByText('收藏页面', { includeHiddenElements: true })).toBeNull();
    expect(view.queryByText('更多页面', { includeHiddenElements: true })).toBeNull();

    await fireEvent.press(view.getByTestId('main-tab-search'));
    await waitFor(() => expect(view.getByText('搜索页面')).toBeTruthy());
    await fireEvent.changeText(view.getByLabelText('搜索状态'), 'kept');
    await fireEvent.press(view.getByTestId('main-tab-feed'));
    await fireEvent.press(view.getByTestId('main-tab-search'));

    await waitFor(() => expect(view.getByLabelText('搜索状态').props.value).toBe('kept'));
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
