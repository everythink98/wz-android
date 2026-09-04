import { createContext, type ReactNode, useCallback, useContext, useRef } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Category, Topic } from '@/domain/forum/models';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { ReaderData } from '@/domain/reader/readerData';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import { FeedScreen } from './FeedScreen';
import { useFeedController } from './useFeedController';

export type FeedRouteRuntimeValue = {
  account: {
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    requestNodeSeekVerification: (message: string, recovery?: LinuxDoReadRecovery) => void;
    sessionEpochs: ForumSessionEpochs;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  appActive: boolean;
  catalogCategories: Category[];
  notify: (message: string) => void;
  onInitialContentReady: () => void;
  topicStateIndex: TopicListItemStateIndex;
  reader: {
    data: ReaderData;
    loaded: boolean;
  };
};

const FeedRouteRuntimeContext = createContext<FeedRouteRuntimeValue | null>(null);

export function FeedRouteRuntimeProvider({ children, value }: { children: ReactNode; value: FeedRouteRuntimeValue }) {
  return <FeedRouteRuntimeContext.Provider value={value}>{children}</FeedRouteRuntimeContext.Provider>;
}

function useFeedRouteRuntime() {
  const runtime = useContext(FeedRouteRuntimeContext);
  if (!runtime) throw new Error('FeedRouteRuntimeProvider is required');
  return runtime;
}

function FeedRouteSession({ runtime }: { runtime: FeedRouteRuntimeValue }) {
  const active = useIsFocused();
  const navigation = useNavigation();
  const listRef = useRef<FlashListRef<Topic> | null>(null);
  useScrollToTop(listRef);
  const controller = useFeedController({
    active,
    catalogCategories: runtime.catalogCategories,
    sessionEpochs: runtime.account.sessionEpochs,
    linuxDoVerificationActive: runtime.account.linuxDoVerificationVisible,
    notify: runtime.notify,
    readerData: runtime.reader.data,
    readerDataLoaded: runtime.reader.loaded,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showNodeSeekVerification: (message) =>
      runtime.account.requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证'),
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway
  });
  const { feedAllowsRemotePagination, loadFeed } = controller;
  const loadMore = useCallback(() => {
    if (feedAllowsRemotePagination) void loadFeed();
  }, [feedAllowsRemotePagination, loadFeed]);
  const openTopic = useCallback(
    (topic: Topic) => navigation.dispatch(StackActions.push('Topic', { topic })),
    [navigation]
  );
  const manageContentSources = useCallback(() => navigation.dispatch(manageContentSourcesAction()), [navigation]);

  return (
    <FeedScreen
      busy={controller.feedBusy}
      categories={controller.feedCategories}
      categoryFilter={controller.categoryFilter}
      feedHasMore={controller.activeFeedState.hasMore && controller.feedAllowsRemotePagination}
      feedItems={controller.shownFeedItems}
      feedOutcomeKind={active ? controller.feedOutcomeKind : undefined}
      feedPage={controller.activeFeedState.page}
      feedSource={controller.feedSource}
      feedFilter={controller.feedFilter}
      enabledFeedSources={controller.enabledFeedSources}
      loadMoreFailureSignal={controller.activeFeedState.loadMoreFailureSignal}
      loadingMore={controller.activeFeedState.loadingMore}
      topicStateIndex={runtime.topicStateIndex}
      readingFilter={controller.readingFilter}
      refreshing={controller.activeFeedState.refreshing}
      scrollRef={listRef}
      onCategoryChange={controller.setCategoryFilter}
      onFeedSourceChange={controller.changeFeedSource}
      onManageContentSources={manageContentSources}
      onFeedFilterChange={controller.setFeedFilter}
      onInitialContentReady={runtime.onInitialContentReady}
      onLoadMore={loadMore}
      onOpenTopic={openTopic}
      onReadingFilterChange={controller.setReadingFilter}
      onRefresh={controller.refreshFeed}
    />
  );
}

export function FeedRoute() {
  const runtime = useFeedRouteRuntime();
  const sourceOrderKey = projectContentSourcePreferences(
    runtime.reader.data.settings.contentSources,
    runtime.reader.loaded
  ).enabledSources.join('|');

  return <FeedRouteSession key={sourceOrderKey} runtime={runtime} />;
}
