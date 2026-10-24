jest.mock('@/platform/storage/readerDataStore', () => ({
  queryReaderCategories: jest.fn(async () => []),
  queryReaderPage: jest.fn(async () => ({ records: [], total: 0, visibleTotal: 0 }))
}));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createEmptyReaderState } from '@/domain/reader/readerRecordState';
import { projectTestAccountSessions } from '../../helpers/accountSessions';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { cleanup } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import React from 'react';
import { Pressable, Text } from 'react-native';
import { AppNavigator } from '@/app/AppNavigator';
import {
  navigateMainTab,
  navigationRef,
  openLibraryRoute,
  openLinuxDoCreditRoute,
  openNodeSeekCreditsRoute,
  pushTopicRoute,
  pushUserRoute
} from '@/app/appNavigation';
import type { FeedSource, Topic, UserIdentity, UserReference } from '@/domain/forum/models';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import { FeedRoute, FeedRouteRuntimeProvider, type FeedRouteRuntimeValue } from '@/features/feed/FeedRoute';
import { useFeedController } from '@/features/feed/useFeedController';
import {
  LibraryRoute,
  LibraryRouteRuntimeProvider,
  type LibraryRouteRuntimeValue
} from '@/features/library/LibraryRoute';
import { useReaderDataActionsController } from '@/features/library/useReaderDataActionsController';
import { MoreRoute, MoreRouteRuntimeProvider, type MoreRouteRuntimeValue } from '@/features/more/MoreRoute';
import { SearchRoute, SearchRouteRuntimeProvider, type SearchRouteRuntimeValue } from '@/features/search/SearchRoute';
import { useSearchController } from '@/features/search/useSearchController';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
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
    UserRound: Icon,
    Search: Icon,
    Settings: Icon,
    Star: Icon
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
    backupBusy: false,
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
let mockLibraryOpenTopic: ((topic: Topic) => void) | undefined;
let mockLibraryOpenUser: ((user: UserReference) => void) | undefined;
let mockMoreAccount: MoreRouteRuntimeValue['account'] | undefined;
let mockMoreLibrary: MoreRouteRuntimeValue['library'] | undefined;
function mockFeedScreen({
  feedSource,
  onFeedSourceChange,
  onLoadMore,
  onManageContentSources,
  onOpenTopic
}: {
  feedSource?: FeedSource;
  onFeedSourceChange?: (source: FeedSource) => void;
  onLoadMore?: () => void;
  onManageContentSources: () => void;
  onOpenTopic: (topic: Topic) => void;
}) {
  const [mount] = React.useState(() => ++mockFeedScreenMountCount);
  mockFeedLoadMoreCallbacks.push(onLoadMore);
  mockFeedOpenTopic = onOpenTopic;
  return (
    <>
      {mockManagementEntry('首页', onManageContentSources)}
      <Pressable testID="feed-test-select-v2ex" onPress={() => onFeedSourceChange?.('v2ex')}>
        <Text>{`首页来源 ${feedSource || 'all'} 挂载 ${mount}`}</Text>
      </Pressable>
    </>
  );
}

jest.mock('@/features/feed/FeedScreen', () => ({ FeedScreen: mockFeedScreen }));
jest.mock('@/features/search/SearchScreen', () => ({
  SearchScreen: ({
    onManageContentSources,
    onOpenTopic
  }: {
    onManageContentSources: () => void;
    onOpenTopic: (topic: Topic) => void;
  }) => {
    mockSearchOpenTopic = onOpenTopic;
    return mockManagementEntry('搜索', onManageContentSources);
  }
}));
jest.mock('@/features/library/LibraryScreen', () => ({
  LibraryScreen: ({
    onManageContentSources,
    onOpenTopic,
    onOpenUser
  }: {
    onManageContentSources: () => void;
    onOpenTopic: (topic: Topic) => void;
    onOpenUser: (user: UserReference) => void;
  }) => {
    mockLibraryOpenTopic = onOpenTopic;
    mockLibraryOpenUser = onOpenUser;
    return mockManagementEntry('收藏', onManageContentSources);
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
  getReadPlan: () => ({ state: 'ready', cacheScope: 'public:test' })
} as unknown as ReadGateway;
const sessionViewModels = projectTestAccountSessions(createSiteSessionStates());

const feedRuntime = {
  enabledSources: readerData.settings.contentSources.filter((entry) => entry.enabled).map((entry) => entry.source),
  enabledSourcesKey: 'v2ex,linuxdo,nodeseek,yaohuo',
  account: {
    linuxDoVerificationVisible: false,
    readGateway,
    requestNodeSeekVerification: jest.fn(),
    sessionEpochs: initialForumSessionEpochs,
    showLinuxDoVerification: jest.fn(),
    showYaohuoLogin: jest.fn()
  },
  appActive: true,
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
  readerData,
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
      }
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
    dataRef: { current: readerData },
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
    <LibraryRouteRuntimeProvider value={libraryRuntime}>
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

function Navigator({ feedRuntimeValue = feedRuntime }: { feedRuntimeValue?: FeedRouteRuntimeValue }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { gcTime: 0, retry: false } } })}>
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
          getNodeSeekCreditsRoute={() => EmptyRoute}
          getLinuxDoCreditRoute={() => EmptyRoute}
          getSearchRoute={() => SearchTab}
          getTopicRoute={() => TopicScreen}
          getUserRoute={() => EmptyRoute}
          styles={styles}
          theme={theme}
          onReady={jest.fn()}
          onScreenChange={jest.fn()}
        />
      </FeedTestRuntimeContext.Provider>
    </QueryClientProvider>
  );
}

describe('content-source management navigation', () => {
  beforeEach(() => {
    mockFeedScreenMountCount = 0;
    mockFeedLoadMoreCallbacks = [];
    mockFeedOpenTopic = undefined;
    mockSearchOpenTopic = undefined;
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
    jest.mocked(useFeedController).mockImplementation(({ readerData: currentReaderData }) => {
      const [feedSource, setFeedSource] = React.useState<FeedSource>('all');
      return {
        activeFeedState: {
          hasMore: false,
          loadMoreFailureSignal: 0,
          loadingMore: false,
          page: 1,
          refreshing: false
        },
        changeFeedSource: setFeedSource,
        feedAllowsRemotePagination: false,
        feedSource,
        enabledFeedSources: projectContentSourcePreferences(currentReaderData.settings.contentSources).enabledSources
      } as never;
    });
    const view = await render(<Navigator />);
    await waitFor(() => expect(view.getByText('首页来源 all 挂载 1')).toBeTruthy());
    await fireEvent.press(view.getByTestId('feed-test-select-v2ex'));
    await waitFor(() => expect(view.getByText('首页来源 v2ex 挂载 1')).toBeTruthy());
    await fireEvent.press(view.getByTestId('main-tab-more'));

    const [first, second, ...rest] = readerData.settings.contentSources;
    const reorderedFeedRuntime = {
      ...feedRuntime,
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

    await view.rerender(<Navigator feedRuntimeValue={{ ...feedRuntime, appActive: false }} />);

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
});
