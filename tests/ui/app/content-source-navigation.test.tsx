jest.mock('@/platform/storage/readerDataStore', () => ({
  queryReaderCategories: jest.fn(async () => []),
  queryReaderPage: jest.fn(async () => ({ records: [] }))
}));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEmptyReaderState } from '@/domain/reader/readerRecordState';
import { projectTestAccountSessions } from '../../helpers/accountSessions';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import React from 'react';
import { Alert, BackHandler, Linking, Pressable, Text, View } from 'react-native';
import { AppNavigator } from '@/app/AppNavigator';
import { useAppDeepLinkNavigation } from '@/app/useAppDeepLinkNavigation';
import { useContentSourceQueryCleanup } from '@/app/useContentSourceQueryCleanup';
import {
  navigateMainTab,
  navigationRef,
  openLibraryRoute,
  openLinuxDoCreditRoute,
  openNodeSeekCreditsRoute,
  pushTopicRoute,
  pushUserRoute
} from '@/app/appNavigation';
import type { FeedResponse, FeedSource, Topic, UserIdentity, UserReference } from '@/domain/forum/models';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { canonicalEnabledSourcesKey, projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { FeedRoute, FeedRouteRuntimeProvider, type FeedRouteRuntimeValue } from '@/features/feed/FeedRoute';
import { useFeedController } from '@/features/feed/useFeedController';
import { LibraryRoute } from '@/features/library/LibraryRoute';
import { LibraryRouteRuntimeProvider, type LibraryRouteRuntimeValue } from '@/features/library/LibraryRouteRuntime';
import { useReaderDataActionsController } from '@/features/library/useReaderDataActionsController';
import { MoreRoute } from '@/features/more/MoreRoute';
import { MoreRouteRuntimeProvider, type MoreRouteRuntimeValue } from '@/features/more/MoreRouteRuntime';
import { NodeSeekServicesPanel } from '@/features/more/components/NodeSeekServicesPanel';
import { SearchRoute } from '@/features/search/SearchRoute';
import { SearchRouteRuntimeProvider, type SearchRouteRuntimeValue } from '@/features/search/SearchRouteRuntime';
import { useSearchController } from '@/features/search/useSearchController';
import { TopicRoute } from '@/features/topic/TopicRoute';
import { TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRouteRuntime';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { queryReaderCategories, queryReaderPage } from '@/platform/storage/readerDataStore';
import type { ReadGateway } from '@/sources/readGateway';
import { createTheme } from '@/ui/theme/tokens';
import { act, fireEvent, render, waitFor } from '../render';
import { createTestStyles as createStyles } from '../styleFixture';

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Bell: Icon,
    Check: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    Eye: Icon,
    Home: Icon,
    ListFilter: Icon,
    MessageCircle: Icon,
    MoreHorizontal: Icon,
    Search: Icon,
    Settings: Icon,
    SlidersHorizontal: Icon,
    SquarePen: Icon,
    Star: Icon,
    Trash2: Icon,
    UserRound: Icon,
    X: Icon
  };
});
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('@/features/feed/useFeedController', () => ({ useFeedController: jest.fn() }));
jest.mock('@/features/search/useSearchController', () => ({ useSearchController: jest.fn() }));
jest.mock('@/features/library/useReaderDataActionsController', () => ({
  useReaderDataActionsController: jest.fn()
}));
jest.mock('@/features/topic/useTopicController', () => ({ useTopicController: jest.fn() }));
jest.mock('@/features/topic/useTopicSessionController', () => ({ useTopicSessionController: jest.fn() }));
jest.mock('@/features/topic/actions/useTopicActionsController', () => ({ useTopicActionsController: jest.fn() }));
jest.mock('@/features/topic/rendering/useHtmlRenderingController', () => ({ useHtmlRenderingController: jest.fn() }));
jest.mock('@/features/topic/media/useImagePreviewController', () => ({ useImagePreviewController: jest.fn() }));
jest.mock('@/ui/media/ImagePreviewModal', () => ({ ImagePreviewModal: () => null }));
jest.mock('@/features/topic/TopicScreen', () => ({ TopicScreen: () => null }));
jest.mock('@/features/more/useBackupStatusController', () => ({
  useBackupStatusController: () => ({
    backupOperation: 'idle',
    exportBackupFile: jest.fn(),
    importBackupFile: jest.fn()
  })
}));
jest.mock('@/features/more/useDiagnosticLogController', () => ({
  useDiagnosticLogController: () => ({ diagnosticBusy: false, exportDiagnosticLogFile: jest.fn() })
}));
jest.mock('@/features/more/useReaderSettingsController', () => ({
  useReaderSettingsController: () => ({ updateSettings: jest.fn() })
}));

function mockManagementEntry(label: string, onPress: () => void) {
  return (
    <Pressable accessibilityLabel={`${label}管理内容源`} onPress={onPress}>
      <Text>{`${label}管理内容源`}</Text>
    </Pressable>
  );
}

let mockFeedScreenMountCount = 0;
let mockFeedLoadMoreCallbacks: ((() => void) | undefined)[] = [];
let mockFeedOpenTopic: ((topic: Topic) => void) | undefined;
let mockSearchOpenTopic: ((topic: Topic) => void) | undefined;
let mockRealListScreen: 'feed' | 'search' | 'library' | undefined;
let mockLibraryOpenTopic: ((topic: Topic) => void) | undefined;
let mockLibraryOpenUser: ((user: UserReference) => void) | undefined;
let mockMoreAccount: MoreRouteRuntimeValue['account'] | undefined;
let mockMoreLibrary: MoreRouteRuntimeValue['library'] | undefined;
let mockMoreThreshold = false;
function MockFeedScreen({
  feedHasMore,
  feedItems,
  feedSource,
  onFeedSourceChange,
  onLoadMore,
  onManageContentSources,
  onOpenTopic
}: {
  feedHasMore?: boolean;
  feedItems?: Topic[];
  feedSource?: FeedSource;
  onFeedSourceChange?: (source: FeedSource) => void;
  onLoadMore?: () => void;
  onManageContentSources: () => void;
  onOpenTopic: (topic: Topic) => void;
}) {
  const [mount] = React.useState(() => ++mockFeedScreenMountCount);
  React.useLayoutEffect(() => {
    mockFeedLoadMoreCallbacks.push(onLoadMore);
    mockFeedOpenTopic = onOpenTopic;
  }, [onLoadMore, onOpenTopic]);
  return (
    <>
      {mockManagementEntry('首页', onManageContentSources)}
      {feedItems?.map((topic) => (
        <Text key={topic.id}>{topic.title}</Text>
      ))}
      {feedHasMore ? <Text>还有下一页</Text> : null}
      <Pressable testID="feed-test-select-v2ex" onPress={() => onFeedSourceChange?.('v2ex')}>
        <Text>{`首页来源 ${feedSource || 'all'} 挂载 ${mount}`}</Text>
      </Pressable>
    </>
  );
}

jest.mock('@/features/feed/FeedScreen', () => ({
  FeedScreen: (props: React.ComponentProps<typeof import('@/features/feed/FeedScreen').FeedScreen>) => {
    if (mockRealListScreen === 'feed') {
      const { FeedScreen } =
        jest.requireActual<typeof import('@/features/feed/FeedScreen')>('@/features/feed/FeedScreen');
      return <FeedScreen {...props} />;
    }
    return <MockFeedScreen {...props} />;
  }
}));
jest.mock('@/features/search/SearchScreen', () => ({
  SearchScreen: (props: React.ComponentProps<typeof import('@/features/search/SearchScreen').SearchScreen>) => {
    if (mockRealListScreen === 'search') {
      const { SearchScreen } = jest.requireActual<typeof import('@/features/search/SearchScreen')>(
        '@/features/search/SearchScreen'
      );
      return <SearchScreen {...props} />;
    }
    mockSearchOpenTopic = props.onOpenTopic;
    return mockManagementEntry('搜索', props.onManageContentSources);
  }
}));
jest.mock('@/features/library/LibraryScreen', () => ({
  LibraryScreen: (props: React.ComponentProps<typeof import('@/features/library/LibraryScreen').LibraryScreen>) => {
    if (mockRealListScreen === 'library') {
      const { LibraryScreen } = jest.requireActual<typeof import('@/features/library/LibraryScreen')>(
        '@/features/library/LibraryScreen'
      );
      return <LibraryScreen {...props} />;
    }
    mockLibraryOpenTopic = props.onOpenTopic;
    mockLibraryOpenUser = props.onOpenUser;
    return mockManagementEntry('收藏', props.onManageContentSources);
  }
}));
function mockMoreScreen({
  account,
  contentSourcesExpanded,
  onContentSourcesExpandedChange,
  utilities
}: {
  account: MoreRouteRuntimeValue['account'];
  contentSourcesExpanded: boolean;
  onContentSourcesExpandedChange: (expanded: boolean) => void;
  utilities: {
    library: MoreRouteRuntimeValue['library'];
    settings: { visible: boolean; changeVisible: (visible: boolean) => void };
  };
}) {
  mockMoreAccount = account;
  mockMoreLibrary = utilities.library;
  return (
    <>
      <Pressable
        accessibilityLabel={contentSourcesExpanded ? '收起内容源' : '展开内容源'}
        onPress={() => onContentSourcesExpandedChange(!contentSourcesExpanded)}
      >
        <Text>{contentSourcesExpanded ? '内容源面板已展开' : '内容源面板已折叠'}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={utilities.settings.visible ? '收起外观' : '展开外观'}
        accessibilityState={{ expanded: utilities.settings.visible }}
        onPress={() => utilities.settings.changeVisible(!utilities.settings.visible)}
      >
        <Text>{utilities.settings.visible ? '外观面板已展开' : '外观面板已折叠'}</Text>
      </Pressable>
      {mockMoreThreshold ? (
        <NodeSeekServicesPanel
          apiKeyAuthorized={false}
          apiKeyBusy={false}
          apiKeySaved={false}
          recoveryThreshold={3}
          theme={theme}
          onAuthorizeApiKey={jest.fn()}
          onClearApiKey={jest.fn()}
          onRecoveryThresholdChange={jest.fn()}
          onSaveApiKey={jest.fn()}
        />
      ) : null}
    </>
  );
}
jest.mock('@/features/more/MoreScreen', () => ({ MoreScreen: mockMoreScreen }));

const readerData = createEmptyReaderData();
const disabledTopicReaderData = {
  ...readerData,
  settings: {
    ...readerData.settings,
    contentSources: readerData.settings.contentSources.map((preference) =>
      preference.source === 'yaohuo' ? { ...preference, enabled: false } : preference
    )
  }
};
const disabledTopic: Topic = {
  source: 'yaohuo',
  id: '42',
  title: '停用来源主题',
  author: 'alice',
  url: 'https://www.yaohuo.me/bbs-42.html',
  createdAt: '2026-01-01T00:00:00.000Z',
  replyCount: 0
};
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const topicStateIndex = createTopicListItemStateIndex(readerData);
const readGateway = {
  getCategories: async () => ({ items: [], errors: {} }),
  getFeed: async () => emptyFeed,
  getReadPlan: (...[source, operation]: Parameters<ReadGateway['getReadPlan']>) => ({
    source,
    operation,
    state: 'ready',
    cacheScope: 'public:test'
  })
} as unknown as ReadGateway;
const emptyFeed: FeedResponse = { items: [], errors: {}, hasMore: false, nextPage: null };
const sessionViewModels = projectTestAccountSessions(createSiteSessionStates());

const feedRuntime = {
  enabledSources: readerData.settings.contentSources.filter((entry) => entry.enabled).map((entry) => entry.source),
  enabledSourcesKey: 'v2ex,linuxdo,nodeseek,yaohuo',
  account: {
    linuxDoVerificationVisible: false,
    nodeSeekVerificationVisible: false,
    readGateway,
    requestNodeSeekVerification: jest.fn(),
    sessionEpochs: initialForumSessionEpochs,
    showLinuxDoVerification: jest.fn(),
    showYaohuoLogin: jest.fn()
  },
  catalogCategories: [],
  notify: jest.fn(),
  onInitialContentReady: jest.fn(),
  reader: { data: readerData, loaded: true },
  topicStateIndex
} as FeedRouteRuntimeValue;
const FeedTestRuntimeContext = React.createContext(feedRuntime);
const searchRuntime = {
  enabledSources: feedRuntime.enabledSources,
  account: {
    ...feedRuntime.account,
    reconcileAccountStatus: jest.fn(async () => ({ status: 'stale' as const })),
    sessionViewModels
  },
  catalogCategories: [],
  notify: jest.fn(),
  topicStateIndex
} as SearchRouteRuntimeValue;
const libraryRuntime = {
  enabledSources: [],
  notify: jest.fn(),
  reader: {
    commit: jest.fn(),
    data: { ...createEmptyReaderState(), ...readerData },
    dataRef: { current: { ...createEmptyReaderState(), ...readerData } },
    loaded: true
  },
  topicStateIndex
} as LibraryRouteRuntimeValue;
const libraryRuntimeWithSources: LibraryRouteRuntimeValue = { ...libraryRuntime, enabledSources: ['v2ex'] };
const moreRuntime = {
  account: {
    surfaces: { closeAll: jest.fn() },
    center: {
      command: (command: Parameters<MoreRouteRuntimeValue['account']['center']['command']>[0]) => {
        if (command.type === 'open-user') pushUserRoute(command.user, command.initialTab);
      },
      openCredits: (currency: Parameters<MoreRouteRuntimeValue['account']['center']['openCredits']>[0]) => {
        openNodeSeekCreditsRoute({ identityKey: 'nodeseek:7', userId: '7', currency });
      },
      openLinuxDoCredit: () => {
        openLinuxDoCreditRoute({ identityKey: 'linuxdo:7', userId: '7', username: 'alice' });
      },
      nodeImageKey: {
        authorize: jest.fn(),
        clear: jest.fn(),
        save: jest.fn(),
        authorized: false,
        saved: false,
        busy: false
      },
      nodeSeek: { checkIn: jest.fn(), observeBoard: jest.fn(), state: { kind: 'idle' }, busy: false }
    }
  },
  library: { open: openLibraryRoute },
  diagnostics: { getCurrentScreen: () => 'more', metadata: {} },
  notify: jest.fn(),
  notifications: {},
  proxy: {},
  reader: {
    commit: jest.fn(),
    data: readerData,
    importBackup: jest.fn(async () => undefined),
    exportBackup: jest.fn(async () => '{}')
  },
  update: {}
} as unknown as MoreRouteRuntimeValue;

function FeedTab() {
  const runtime = React.useContext(FeedTestRuntimeContext);
  return (
    <FeedRouteRuntimeProvider value={runtime}>
      <FeedRoute />
    </FeedRouteRuntimeProvider>
  );
}

function SearchTab() {
  return (
    <SearchRouteRuntimeProvider value={searchRuntime}>
      <SearchRoute />
    </SearchRouteRuntimeProvider>
  );
}

function LibraryTab() {
  return (
    <LibraryRouteRuntimeProvider value={mockRealListScreen === 'library' ? libraryRuntimeWithSources : libraryRuntime}>
      <LibraryRoute />
    </LibraryRouteRuntimeProvider>
  );
}

function MoreTab() {
  return (
    <MoreRouteRuntimeProvider value={moreRuntime}>
      <MoreRoute />
    </MoreRouteRuntimeProvider>
  );
}

function TopicScreen(props: React.ComponentProps<typeof TopicRoute>) {
  return (
    <TopicRouteRuntimeProvider
      value={
        {
          enabledSources: [],
          reader: { data: disabledTopicReaderData }
        } as unknown as TopicRouteRuntimeValue
      }
    >
      <TopicRoute {...props} />
    </TopicRouteRuntimeProvider>
  );
}

function EmptyRoute() {
  return null;
}

type TestLinking = Pick<typeof Linking, 'addEventListener' | 'getInitialURL'>;

function Navigator({
  feedRuntimeValue = feedRuntime,
  linking
}: {
  feedRuntimeValue?: FeedRouteRuntimeValue;
  linking?: TestLinking;
}) {
  const [client] = React.useState(() => new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } }));
  const onReady = useAppDeepLinkNavigation(linking);
  return (
    <QueryClientProvider client={client}>
      <SourceQueryCleanup runtime={feedRuntimeValue} />
      <FeedTestRuntimeContext.Provider value={feedRuntimeValue}>
        <AppNavigator
          moreBadgeState="none"
          navigationTheme={DefaultTheme}
          FeedRouteComponent={FeedTab}
          getTopicComposerRoute={() => EmptyRoute}
          getLibraryRoute={() => LibraryTab}
          getMoreRoute={() => MoreTab}
          getNotificationDetailRoute={() => EmptyRoute}
          getNotificationSettingsRoute={() => EmptyRoute}
          getNotificationsRoute={() => EmptyRoute}
          getReadingSettingsRoute={() => EmptyRoute}
          getNetworkSettingsRoute={() => EmptyRoute}
          getNodeSeekCreditsRoute={() => EmptyRoute}
          getLinuxDoCreditRoute={() => EmptyRoute}
          getSearchRoute={() => SearchTab}
          getTopicRoute={() => TopicScreen}
          getUserRoute={() => EmptyRoute}
          styles={styles}
          theme={theme}
          onReady={onReady}
          onScreenChange={jest.fn()}
        />
      </FeedTestRuntimeContext.Provider>
    </QueryClientProvider>
  );
}

function SourceQueryCleanup({ runtime }: { runtime: FeedRouteRuntimeValue }) {
  useContentSourceQueryCleanup(runtime.enabledSources, runtime.enabledSourcesKey);
  return null;
}

function mockUseRealFeedController() {
  jest
    .mocked(useFeedController)
    .mockImplementation(
      jest.requireActual<typeof import('@/features/feed/useFeedController')>('@/features/feed/useFeedController')
        .useFeedController
    );
}

describe('content-source management navigation', () => {
  beforeEach(() => {
    mockFeedScreenMountCount = 0;
    mockFeedLoadMoreCallbacks = [];
    mockFeedOpenTopic = undefined;
    mockSearchOpenTopic = undefined;
    mockRealListScreen = undefined;
    mockLibraryOpenTopic = undefined;
    mockLibraryOpenUser = undefined;
    mockMoreAccount = undefined;
    mockMoreLibrary = undefined;
    jest.mocked(useFeedController).mockReturnValue({
      activeFeedState: {
        hasMore: false,
        loadMoreFailureSignal: 0,
        loadingMore: false,
        page: 1,
        refreshing: false
      },
      feedAllowsRemotePagination: false
    } as never);
    jest.mocked(useSearchController).mockReturnValue({ runSearch: jest.fn(), searchSource: 'all' } as never);
    jest.mocked(useReaderDataActionsController).mockReturnValue({
      clearHistory: jest.fn(),
      removeFollowedUser: jest.fn(),
      removeLibraryTopic: jest.fn()
    } as never);
  });

  afterEach(async () => {
    await cleanup();
  });

  it.each(['user', 'credits', 'ldc', 'library'] as const)(
    'ignores queued More %s shortcuts after leaving and restores them on return',
    async (destination) => {
      const view = await render(<Navigator />);
      try {
        await waitFor(() => expect(navigationRef.isReady()).toBe(true));
        await act(() => navigateMainTab('more'));
        const account = mockMoreAccount!;
        const library = mockMoreLibrary!;
        const user: UserIdentity = {
          source: 'nodeseek',
          id: '7',
          username: 'alice',
          url: 'https://www.nodeseek.com/space/7'
        };
        const open = () =>
          destination === 'user'
            ? account.center.command({ type: 'open-user', user })
            : destination === 'credits'
              ? account.center.openCredits('coin')
              : destination === 'ldc'
                ? account.center.openLinuxDoCredit()
                : library.open('favorites');
        await act(() => {
          open();
          open();
          library.open('history');
        });
        expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual([
          'MainTabs',
          destination === 'user'
            ? 'User'
            : destination === 'credits'
              ? 'NodeSeekCredits'
              : destination === 'ldc'
                ? 'LinuxDoCredit'
                : 'Library'
        ]);
        if (destination === 'library')
          expect(navigationRef.getCurrentRoute()?.params).toEqual({ initialTab: 'favorites' });
        await act(() => navigationRef.goBack());
        await act(() => open());
        expect(navigationRef.getRootState()?.routes).toHaveLength(2);
      } finally {
        await view.unmount();
      }
    }
  );

  it.each(['feed', 'search', 'library-topic', 'library-user'] as const)(
    'ignores queued different-card navigation from %s until the source route is focused again',
    async (source) => {
      await render(<Navigator />);
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
      if (source === 'search') await act(() => navigateMainTab('search'));
      if (source.startsWith('library')) await act(() => navigationRef.navigate('Library'));
      const initialKeys = navigationRef.getRootState()?.routes.map((route) => route.key) ?? [];
      const openTopic =
        source === 'feed' ? mockFeedOpenTopic : source === 'search' ? mockSearchOpenTopic : mockLibraryOpenTopic;
      const openUser = mockLibraryOpenUser;
      const open = (id: string) =>
        source === 'library-user'
          ? openUser!({ source: 'yaohuo', id, username: `user${id}`, url: `https://yaohuo.me/user-${id}.html` })
          : openTopic!({ ...disabledTopic, id });
      await act(() => {
        open('42');
        open('43');
        open('44');
      });
      const routes = navigationRef.getRootState()?.routes;
      expect(routes).toHaveLength(initialKeys.length + 1);
      expect(routes?.at(-1)?.params).toEqual(
        source === 'library-user'
          ? { user: expect.objectContaining({ id: '42' }) }
          : { topic: expect.objectContaining({ id: '42' }) }
      );
      await act(() => navigationRef.goBack());
      expect(navigationRef.getRootState()?.routes.map((route) => route.key)).toEqual(initialKeys);
      await act(() => open('43'));
      expect(navigationRef.getRootState()?.routes).toHaveLength(initialKeys.length + 1);
    }
  );

  it.each(['Library', 'feed'] as const)('preserves inline appearance when returning from %s', async (destination) => {
    const view = await render(<Navigator />);
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));
    await fireEvent.press(view.getByTestId('main-tab-more'));
    await fireEvent.press(view.getByLabelText('展开外观'));
    expect(view.getByLabelText('收起外观').props.accessibilityState.expanded).toBe(true);

    if (destination === 'Library') {
      await act(async () => navigationRef.navigate('Library'));
    } else {
      await fireEvent.press(view.getByTestId('main-tab-feed'));
    }
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe(destination));
    if (destination === 'Library') {
      await act(async () => navigationRef.goBack());
    } else {
      await fireEvent.press(view.getByTestId('main-tab-more'));
    }

    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('more'));
    expect(view.getByText('外观面板已展开')).toBeTruthy();
    expect(view.getByLabelText('收起外观').props.accessibilityState.expanded).toBe(true);
  });

  it.each(['appearance', 'threshold'] as const)(
    'lets hardware Back return from a warm topic when More had opened %s',
    async (control) => {
      mockMoreThreshold = control === 'threshold';
      const handlers = new Set<Parameters<typeof BackHandler.addEventListener>[1]>();
      const register = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
        handlers.add(handler);
        return { remove: () => handlers.delete(handler) };
      });
      const measure = jest
        .spyOn(View.prototype, 'measureInWindow')
        .mockImplementation((callback) => callback(40, 200, 180, 36));
      const subscription = Linking.addEventListener('url', () => {});
      const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
      const linking: TestLinking = { addEventListener, getInitialURL: async () => null };
      const view = await render(<Navigator linking={linking} />);
      const systemBack = () =>
        [...handlers]
          .reverse()
          .some((handler) => handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) === true);
      const isExpanded = () =>
        control === 'appearance' ? Boolean(view.queryByText('外观面板已展开')) : Boolean(view.queryByLabelText('4 次'));
      try {
        await waitFor(() => expect(navigationRef.isReady()).toBe(true));
        await fireEvent.press(view.getByTestId('main-tab-more'));
        await fireEvent.press(view.getByLabelText(control === 'appearance' ? '展开外观' : '读取通道自愈阈值'));
        await waitFor(() => expect(isExpanded()).toBe(true));

        const [[, onUrl]] = addEventListener.mock.calls;
        await act(async () => {
          onUrl({ url: disabledTopic.url });
          expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
          expect(systemBack()).toBe(true);
        });
        expect(navigationRef.getCurrentRoute()?.name).toBe('more');
        if (control === 'appearance') {
          expect(isExpanded()).toBe(true);
        } else {
          await waitFor(() => expect(isExpanded()).toBe(false));
          await fireEvent.press(view.getByLabelText('读取通道自愈阈值'));
          await waitFor(() => expect(isExpanded()).toBe(true));
        }

        await act(async () => expect(systemBack()).toBe(true));
        expect(navigationRef.getCurrentRoute()?.name).toBe('more');
        await waitFor(() => expect(isExpanded()).toBe(false));
      } finally {
        await view.unmount();
        mockMoreThreshold = false;
        register.mockRestore();
        measure.mockRestore();
      }
    }
  );

  it.each<['feed' | 'search' | 'library', string]>([
    ['feed', '首页'],
    ['search', '搜索'],
    ['library', '收藏']
  ])('carries the %s route intent through the real stack and tabs exactly once', async (tab, label) => {
    const view = await render(<Navigator />);
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));
    if (tab === 'library') {
      await act(async () => navigationRef.navigate('Library'));
    } else if (tab !== 'feed') {
      await fireEvent.press(view.getByTestId(`main-tab-${tab}`));
    }
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe(tab === 'library' ? 'Library' : tab));

    await fireEvent.press(view.getByLabelText(`${label}管理内容源`));

    await waitFor(() => {
      expect(navigationRef.getCurrentRoute()?.name).toBe('more');
      expect(view.getByText('内容源面板已展开')).toBeTruthy();
    });
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.params).toEqual({}));
    await fireEvent.press(view.getByLabelText('收起内容源'));
    if (tab === 'library') {
      await act(async () => navigationRef.navigate('Library'));
    } else {
      await fireEvent.press(view.getByTestId(`main-tab-${tab}`));
    }
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe(tab === 'library' ? 'Library' : tab));
    await act(async () => navigateMainTab('more'));

    await waitFor(() => expect(view.getByText('内容源面板已折叠')).toBeTruthy());
  });

  it('rebuilds Feed at all after the source order changes in More', async () => {
    mockUseRealFeedController();
    const initialRuntime = {
      ...feedRuntime,
      account: {
        ...feedRuntime.account,
        readGateway: {
          ...readGateway,
          getCategories: jest.fn<ReadGateway['getCategories']>().mockResolvedValue({ items: [], errors: {} }),
          getFeed: jest.fn<ReadGateway['getFeed']>().mockResolvedValue(emptyFeed)
        }
      }
    };
    const view = await render(<Navigator feedRuntimeValue={initialRuntime} />);
    await waitFor(() => expect(view.getByText('首页来源 all 挂载 1')).toBeTruthy());
    await fireEvent.press(view.getByTestId('feed-test-select-v2ex'));
    await waitFor(() => expect(view.getByText('首页来源 v2ex 挂载 1')).toBeTruthy());
    await fireEvent.press(view.getByTestId('main-tab-more'));

    const [first, second, ...rest] = readerData.settings.contentSources;
    const reorderedFeedRuntime = {
      ...initialRuntime,
      enabledSources: [second, first, ...rest].filter((entry) => entry.enabled).map((entry) => entry.source),
      reader: {
        ...feedRuntime.reader,
        data: {
          ...readerData,
          settings: { ...readerData.settings, contentSources: [second, first, ...rest] }
        }
      }
    };
    await view.rerender(<Navigator feedRuntimeValue={reorderedFeedRuntime} />);
    await fireEvent.press(view.getByTestId('main-tab-feed'));

    await waitFor(() => expect(view.getByText('首页来源 all 挂载 2')).toBeTruthy());
  });

  it('keeps trusted home items through source changes without reusing the old cursor', async () => {
    mockUseRealFeedController();
    const retained: Topic = {
      ...disabledTopic,
      source: 'v2ex',
      id: '123',
      title: '仍启用来源的首页主题',
      url: 'https://www.v2ex.com/t/123'
    };
    const restored = { ...disabledTopic, title: '重新启用来源的新主题' };
    const disabledRead = Promise.withResolvers<FeedResponse>();
    const restoredRead = Promise.withResolvers<FeedResponse>();
    const getFeed = jest
      .fn<ReadGateway['getFeed']>()
      .mockResolvedValueOnce({
        items: [retained, disabledTopic],
        errors: {},
        hasMore: true,
        nextPage: 2,
        nextCursor: 'previous-aggregate-cursor'
      })
      .mockReturnValueOnce(disabledRead.promise)
      .mockReturnValue(restoredRead.promise);
    const initialRuntime = {
      ...feedRuntime,
      account: { ...feedRuntime.account, readGateway: { ...readGateway, getFeed } }
    };
    const preferences = disabledTopicReaderData.settings.contentSources;
    const disabledRuntime = {
      ...initialRuntime,
      enabledSources: projectContentSourcePreferences(preferences).enabledSources,
      enabledSourcesKey: canonicalEnabledSourcesKey(preferences),
      reader: { data: disabledTopicReaderData, loaded: true }
    };
    const view = await render(<Navigator feedRuntimeValue={initialRuntime} />);
    try {
      await waitFor(() => expect(view.getByText(retained.title)).toBeTruthy());
      expect(view.getByText(disabledTopic.title)).toBeTruthy();
      expect(view.getByText('还有下一页')).toBeTruthy();

      await fireEvent.press(view.getByTestId('main-tab-more'));
      await view.rerender(<Navigator feedRuntimeValue={disabledRuntime} />);
      await fireEvent.press(view.getByTestId('main-tab-feed'));
      await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(2));
      expect(view.getByText('首页来源 all 挂载 2')).toBeTruthy();
      expect(view.getByText(retained.title)).toBeTruthy();
      expect(view.queryByText(disabledTopic.title)).toBeNull();
      expect(view.queryByText('还有下一页')).toBeNull();

      await act(async () => disabledRead.reject(new Error('fixture read failed')));
      expect(view.getByText(retained.title)).toBeTruthy();
      expect(view.queryByText('还有下一页')).toBeNull();

      await fireEvent.press(view.getByTestId('main-tab-more'));
      await view.rerender(<Navigator feedRuntimeValue={initialRuntime} />);
      await fireEvent.press(view.getByTestId('main-tab-feed'));
      await waitFor(() => expect(getFeed).toHaveBeenCalledTimes(3));
      expect(view.getByText(retained.title)).toBeTruthy();
      expect(view.queryByText(disabledTopic.title)).toBeNull();
      expect(view.queryByText('还有下一页')).toBeNull();

      await act(async () => restoredRead.resolve({ ...emptyFeed, items: [retained, restored] }));
      await waitFor(() => expect(view.getByText(restored.title)).toBeTruthy());
      expect(getFeed.mock.calls.map(([request]) => request.cursor)).toEqual([undefined, undefined, undefined]);
    } finally {
      disabledRead.resolve(emptyFeed);
      restoredRead.resolve(emptyFeed);
    }
  });

  it('keeps load-more callback stable across unrelated runtime renders', async () => {
    const loadFeed = jest.fn(async () => undefined);
    jest.mocked(useFeedController).mockImplementation(
      () =>
        ({
          activeFeedState: {
            hasMore: true,
            loadMoreFailureSignal: 0,
            loadingMore: false,
            page: 1,
            refreshing: false
          },
          feedAllowsRemotePagination: true,
          loadFeed
        }) as never
    );
    const view = await render(<Navigator />);
    const firstCallback = mockFeedLoadMoreCallbacks.at(-1);

    await view.rerender(
      <Navigator
        feedRuntimeValue={{ ...feedRuntime, catalogCategories: [{ source: 'v2ex', id: 'qna', name: '问与答' }] }}
      />
    );

    expect(mockFeedLoadMoreCallbacks.at(-1)).toBe(firstCallback);
  });

  it('carries a disabled Topic management intent through the real root stack and tabs', async () => {
    const view = await render(<Navigator />);
    await waitFor(() => expect(navigationRef.isReady()).toBe(true));

    await act(async () => {
      expect(pushTopicRoute({ topic: disabledTopic })).toBe(true);
    });
    await waitFor(() => {
      expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
      expect(view.getByText('妖火已停用')).toBeTruthy();
    });

    await fireEvent.press(view.getByLabelText('管理内容源'));

    await waitFor(() => {
      expect(navigationRef.getCurrentRoute()?.name).toBe('more');
      expect(view.getByText('内容源面板已展开')).toBeTruthy();
    });
    await waitFor(() => expect(navigationRef.getCurrentRoute()?.params).toEqual({}));
  });

  it.each([true, false])('changes Feed source only for a focused tab press (leave: %s)', async (leave) => {
    mockRealListScreen = 'feed';
    mockUseRealFeedController();
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
    const view = await render(<Navigator linking={{ addEventListener, getInitialURL: async () => null }} />);
    try {
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
      expect(view.getByTestId('feed-source-all').props.accessibilityState).toMatchObject({ selected: true });
      const [[, onUrl]] = addEventListener.mock.calls;
      await act(async () => {
        if (leave) {
          onUrl({ url: disabledTopic.url });
          expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
        }
        await fireEvent.press(view.getByTestId('feed-source-v2ex', { includeHiddenElements: true }));
      });
      if (leave) await act(() => navigationRef.goBack());
      expect(view.getByTestId('feed-source-v2ex').props.accessibilityState).toMatchObject({ selected: !leave });
      expect(view.getByTestId('feed-source-all').props.accessibilityState).toMatchObject({ selected: leave });
      if (leave) {
        await fireEvent.press(view.getByTestId('feed-source-v2ex'));
        expect(view.getByTestId('feed-source-v2ex').props.accessibilityState).toMatchObject({ selected: true });
      }
    } finally {
      await view.unmount();
    }
  });

  it.each(['open', 'queued-option'] as const)(
    'retires a %s feed filter menu when a warm link opens a topic',
    async (mode) => {
      mockRealListScreen = 'feed';
      mockUseRealFeedController();
      const subscription = Linking.addEventListener('url', () => {});
      const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
      const linking: TestLinking = { addEventListener, getInitialURL: async () => null };
      const view = await render(<Navigator linking={linking} />);
      try {
        await waitFor(() => expect(navigationRef.isReady()).toBe(true));
        await fireEvent.press(view.getByTestId('feed-source-v2ex'));
        await fireEvent.press(view.getByTestId('feed-list-filter'));
        await fireEvent.press(view.getByLabelText('最新'));
        await fireEvent.press(view.getByTestId('feed-list-filter'));
        expect(view.getByLabelText('关闭列表筛选菜单')).toBeTruthy();

        expect(addEventListener).toHaveBeenCalledTimes(1);
        const [[, onUrl]] = addEventListener.mock.calls;
        await act(async () => {
          onUrl({ url: disabledTopic.url });
          if (mode === 'queued-option') {
            expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
            await fireEvent.press(view.getByLabelText('最热', { includeHiddenElements: true }));
          }
        });
        await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Topic'));
        expect(view.queryByLabelText('关闭列表筛选菜单', { includeHiddenElements: true })).toBeNull();

        await act(() => navigationRef.goBack());
        expect(view.getByTestId('feed-list-filter').props.accessibilityValue).toEqual({ text: '最新' });
        expect(view.queryByLabelText('关闭列表筛选菜单', { includeHiddenElements: true })).toBeNull();
        await fireEvent.press(view.getByTestId('feed-list-filter'));
        await fireEvent.press(view.getByLabelText('最热'));
        expect(view.getByTestId('feed-list-filter').props.accessibilityValue).toEqual({ text: '最热' });
      } finally {
        await view.unmount();
      }
    }
  );

  it.each(['open', 'queued-apply'] as const)(
    'retires a %s search filter draft when a warm link opens a topic',
    async (mode) => {
      mockRealListScreen = 'search';
      jest
        .mocked(useSearchController)
        .mockImplementation(
          jest.requireActual<typeof import('@/features/search/useSearchController')>(
            '@/features/search/useSearchController'
          ).useSearchController
        );
      const subscription = Linking.addEventListener('url', () => {});
      const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
      const linking: TestLinking = { addEventListener, getInitialURL: async () => null };
      const view = await render(<Navigator linking={linking} />);
      try {
        await waitFor(() => expect(navigationRef.isReady()).toBe(true));
        await fireEvent.press(view.getByTestId('main-tab-search'));
        await fireEvent.press(view.getByTestId('search-source-v2ex'));
        await fireEvent.changeText(view.getByPlaceholderText('输入关键词'), '回到搜索');
        await fireEvent.press(view.getByTestId('search-filter-trigger'));
        await fireEvent.press(view.getByText('相关'));
        await fireEvent.press(view.getByText('确认筛选'));

        await fireEvent.press(view.getByLabelText('打开搜索筛选，当前相关'));
        await fireEvent.press(view.getByText('最新'));
        if (mode === 'open') {
          await fireEvent.press(view.getByTestId('search-filter-node'));
          expect(view.getByTestId('search-filter-node-query')).toBeTruthy();
        }

        expect(addEventListener).toHaveBeenCalledTimes(1);
        const [[, onUrl]] = addEventListener.mock.calls;
        await act(async () => {
          onUrl({ url: disabledTopic.url });
          if (mode === 'queued-apply') {
            expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
            await fireEvent.press(view.getByText('确认筛选', { includeHiddenElements: true }));
          }
        });
        await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Topic'));
        expect(view.queryByTestId('search-filter-close', { includeHiddenElements: true })).toBeNull();

        await act(() => navigationRef.goBack());
        expect(view.getByDisplayValue('回到搜索')).toBeTruthy();
        expect(view.queryByTestId('search-filter-close', { includeHiddenElements: true })).toBeNull();
        await fireEvent.press(view.getByLabelText('打开搜索筛选，当前相关'));
        expect(view.getByRole('radio', { name: '相关', checked: true })).toBeTruthy();
        expect(view.queryByTestId('search-filter-node-query')).toBeNull();
      } finally {
        await view.unmount();
      }
    }
  );

  it.each([
    { action: 'submit', leave: true },
    { action: 'submit', leave: false },
    { action: 'remove', leave: true },
    { action: 'remove', leave: false }
  ] as const)('persists Search $action only while focused (leave: $leave)', async ({ action, leave }) => {
    mockRealListScreen = 'search';
    jest
      .mocked(useSearchController)
      .mockImplementation(
        jest.requireActual<typeof import('@/features/search/useSearchController')>(
          '@/features/search/useSearchController'
        ).useSearchController
      );
    const historyKey = 'reader-search-history';
    const history = await AsyncStorage.getItem(historyKey);
    const saved = '已有搜索';
    const query = '新搜索';
    await AsyncStorage.setItem(historyKey, JSON.stringify([saved]));
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
    const view = await render(<Navigator linking={{ addEventListener, getInitialURL: async () => null }} />);
    try {
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
      await fireEvent.press(view.getByTestId('main-tab-search'));
      await fireEvent(view.getByTestId('search-screen'), 'layout', {
        nativeEvent: { layout: { width: 400, height: 800, x: 0, y: 0 } }
      });
      await waitFor(() => expect(view.getByText(saved)).toBeTruthy());
      if (action === 'submit') await fireEvent.changeText(view.getByPlaceholderText('输入关键词'), query);

      const [[, onUrl]] = addEventListener.mock.calls;
      await act(async () => {
        if (leave) {
          onUrl({ url: disabledTopic.url });
          expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
        }
        if (action === 'submit') {
          await fireEvent(view.getByPlaceholderText('输入关键词', { includeHiddenElements: true }), 'submitEditing', {
            nativeEvent: { text: query }
          });
        } else {
          await fireEvent.press(view.getByLabelText(`删除最近搜索 ${saved}`, { includeHiddenElements: true }));
        }
      });
      if (leave) await act(() => navigationRef.goBack());
      if (action === 'submit') expect(view.getByDisplayValue(query)).toBeTruthy();
      if (!leave) {
        await waitFor(async () => {
          expect(await AsyncStorage.getItem(historyKey)).toBe(
            JSON.stringify(action === 'submit' ? [query, saved] : [])
          );
        });
      } else {
        expect(await AsyncStorage.getItem(historyKey)).toBe(JSON.stringify([saved]));
      }
    } finally {
      await view.unmount();
      if (history === null) await AsyncStorage.removeItem(historyKey);
      else await AsyncStorage.setItem(historyKey, history);
    }
  });

  it.each([true, false])('selects the search source only while focused (leave: %s)', async (leave) => {
    mockRealListScreen = 'search';
    jest
      .mocked(useSearchController)
      .mockImplementation(
        jest.requireActual<typeof import('@/features/search/useSearchController')>(
          '@/features/search/useSearchController'
        ).useSearchController
      );
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
    const view = await render(<Navigator linking={{ addEventListener, getInitialURL: async () => null }} />);
    try {
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
      await fireEvent.press(view.getByTestId('main-tab-search'));
      expect(view.getByTestId('search-source-all').props.accessibilityState.selected).toBe(true);
      const [[, onUrl]] = addEventListener.mock.calls;
      await act(async () => {
        if (leave) {
          onUrl({ url: disabledTopic.url });
          expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
        }
        await fireEvent.press(view.getByTestId('search-source-v2ex', { includeHiddenElements: true }));
      });
      if (leave) await act(() => navigationRef.goBack());
      expect(view.getByTestId('search-source-v2ex').props.accessibilityState.selected).toBe(!leave);
      expect(view.getByTestId('search-source-all').props.accessibilityState.selected).toBe(leave);
    } finally {
      await view.unmount();
    }
  });

  it('keeps the selected feed reading filter when a tap arrives after a warm link opens a topic', async () => {
    mockRealListScreen = 'feed';
    mockUseRealFeedController();
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
    const view = await render(<Navigator linking={{ addEventListener, getInitialURL: async () => null }} />);
    try {
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
      expect(view.getByLabelText('未读')).toBeTruthy();
      const [[, onUrl]] = addEventListener.mock.calls;
      await act(async () => {
        onUrl({ url: disabledTopic.url });
        expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
        await fireEvent.press(view.getByLabelText('未读', { includeHiddenElements: true }));
      });
      await act(() => navigationRef.goBack());
      expect(view.queryByLabelText('未读，已选择')).toBeNull();
      await fireEvent.press(view.getByLabelText('未读'));
      expect(view.getByLabelText('未读，已选择')).toBeTruthy();
    } finally {
      await view.unmount();
    }
  });

  it('discards a queued library category select after a warm link opens a topic', async () => {
    mockRealListScreen = 'library';
    jest.mocked(queryReaderCategories).mockResolvedValueOnce([{ source: 'v2ex', id: 'qna', name: '问与答' }]);
    const measure = jest
      .spyOn(View.prototype, 'measureInWindow')
      .mockImplementation((callback) => callback(40, 200, 180, 44));
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
    const linking: TestLinking = { addEventListener, getInitialURL: async () => null };
    const view = await render(<Navigator linking={linking} />);
    try {
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
      await act(() => {
        openLibraryRoute('favorites');
      });
      const categoryLabel = '分类：全部';
      await waitFor(() => expect(view.getByLabelText(categoryLabel).props.accessibilityState.disabled).toBe(false));
      await fireEvent.press(view.getByLabelText(categoryLabel));
      expect(view.getByLabelText('关闭分类菜单')).toBeTruthy();

      expect(addEventListener).toHaveBeenCalledTimes(1);
      const [[, onUrl]] = addEventListener.mock.calls;
      await act(async () => {
        onUrl({ url: disabledTopic.url });
        expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
        await fireEvent.press(view.getByRole('menuitem', { name: '问与答', includeHiddenElements: true }));
      });
      expect(view.queryByLabelText('关闭分类菜单', { includeHiddenElements: true })).toBeNull();

      await act(() => navigationRef.goBack());
      expect(view.getByTestId('library-category-menu-button').props.accessibilityLabel).toBe(categoryLabel);
      await fireEvent.press(view.getByLabelText(categoryLabel));
      await fireEvent.press(view.getByRole('menuitem', { name: '问与答' }));
      expect(view.getByLabelText('分类：问与答')).toBeTruthy();
    } finally {
      measure.mockRestore();
      await view.unmount();
    }
  });

  it.each([
    { tab: 'history', button: '清空历史', command: { type: 'clear-history' } },
    { tab: 'favorites', button: '取消收藏', command: { type: 'delete', collection: 'favorites', keys: ['v2ex:7'] } }
  ] as const)(
    'retires the library $tab confirmation across a warm topic link and back',
    async ({ tab, button, command }) => {
      mockRealListScreen = 'library';
      jest
        .mocked(useReaderDataActionsController)
        .mockImplementation(
          jest.requireActual<typeof import('@/features/library/useReaderDataActionsController')>(
            '@/features/library/useReaderDataActionsController'
          ).useReaderDataActionsController
        );
      const localTopic: Topic = {
        ...disabledTopic,
        source: 'v2ex',
        id: '7',
        title: '本机已保存的主题',
        url: 'https://www.v2ex.com/t/7'
      };
      jest.mocked(queryReaderPage).mockResolvedValueOnce({ records: [{ topic: localTopic, savedAt: '2026-01-01' }] });
      const reader = libraryRuntimeWithSources.reader;
      const original = reader.data;
      const fixture = {
        ...original,
        counts: { ...original.counts, [tab]: 1 },
        [tab]: { 'v2ex:7': true }
      };
      reader.data = fixture;
      reader.dataRef.current = fixture;
      const commit = jest.mocked(reader.commit);
      commit.mockClear();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const subscription = Linking.addEventListener('url', () => {});
      const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
      const linking: TestLinking = { addEventListener, getInitialURL: async () => null };
      const view = await render(<Navigator linking={linking} />);
      const requestConfirmation = async () => {
        await fireEvent.press(view.getByLabelText(button));
        const confirm = alert.mock.calls.at(-1)?.[2]?.find((item) => item.style === 'destructive')?.onPress;
        if (!confirm) throw new Error('找不到资料库确认按钮');
        return confirm;
      };
      try {
        await waitFor(() => expect(navigationRef.isReady()).toBe(true));
        await act(() => {
          openLibraryRoute(tab);
        });
        await waitFor(() => expect(view.getByLabelText(button)).toBeTruthy());
        const previousConfirm = await requestConfirmation();

        const [[, onUrl]] = addEventListener.mock.calls;
        await act(async () => onUrl({ url: disabledTopic.url }));
        await waitFor(() => expect(navigationRef.getCurrentRoute()?.name).toBe('Topic'));
        await act(() => previousConfirm());
        expect(commit).not.toHaveBeenCalled();

        await act(() => navigationRef.goBack());
        await act(() => previousConfirm());
        expect(commit).not.toHaveBeenCalled();

        const currentConfirm = await requestConfirmation();
        await act(() => currentConfirm());
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit).toHaveBeenCalledWith(expect.objectContaining(command));
      } finally {
        alert.mockRestore();
        reader.data = original;
        reader.dataRef.current = original;
        await view.unmount();
      }
    }
  );

  it('keeps a history entry when its delete tap arrives after a warm link opens a topic', async () => {
    mockRealListScreen = 'library';
    jest
      .mocked(useReaderDataActionsController)
      .mockImplementation(
        jest.requireActual<typeof import('@/features/library/useReaderDataActionsController')>(
          '@/features/library/useReaderDataActionsController'
        ).useReaderDataActionsController
      );
    const topic: Topic = {
      ...disabledTopic,
      source: 'v2ex',
      id: '7',
      url: 'https://www.v2ex.com/t/7'
    };
    jest.mocked(queryReaderPage).mockResolvedValueOnce({
      records: [{ topic, savedAt: '2026-01-01T00:00:00.000Z', visitCount: 1 }]
    });
    const commit = jest.mocked(libraryRuntimeWithSources.reader.commit);
    commit.mockClear();
    const subscription = Linking.addEventListener('url', () => {});
    const addEventListener = jest.fn<TestLinking['addEventListener']>(() => subscription);
    const view = await render(<Navigator linking={{ addEventListener, getInitialURL: async () => null }} />);
    try {
      await waitFor(() => expect(navigationRef.isReady()).toBe(true));
      await act(() => openLibraryRoute('history'));
      await waitFor(() => expect(view.getByLabelText('删除')).toBeTruthy());
      const [[, onUrl]] = addEventListener.mock.calls;
      await act(async () => {
        onUrl({ url: disabledTopic.url });
        expect(navigationRef.getCurrentRoute()?.name).toBe('Topic');
        await fireEvent.press(view.getByLabelText('删除', { includeHiddenElements: true }));
      });
      expect(commit).not.toHaveBeenCalled();

      await act(() => navigationRef.goBack());
      await fireEvent.press(view.getByLabelText('删除'));
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'delete', collection: 'history', keys: ['v2ex:7'] })
      );
    } finally {
      await view.unmount();
    }
  });
});
