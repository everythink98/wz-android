import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Category, Topic } from '@/domain/forum/models';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { ReaderData } from '@/domain/reader/readerData';
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

export function FeedRoute() {
  const runtime = useFeedRouteRuntime();
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
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(runtime.reader.data), [runtime.reader.data]);
  const loadMore = useCallback(() => {
    if (controller.feedAllowsRemotePagination) void controller.loadFeed();
  }, [controller]);
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
      feedOutcomeKind={controller.feedOutcomeKind}
      feedPage={controller.activeFeedState.page}
      feedSource={controller.feedSource}
      feedFilter={controller.feedFilter}
      feedFilters={controller.feedFilters}
      enabledFeedSources={controller.enabledFeedSources}
      loadMoreFailureSignal={controller.activeFeedState.loadMoreFailureSignal}
      loadingMore={controller.activeFeedState.loadingMore}
      topicStateIndex={topicStateIndex}
      readingFilter={controller.readingFilter}
      refreshing={controller.activeFeedState.refreshing}
      scrollRef={listRef}
      onCategoryChange={controller.setCategoryFilter}
      onFeedSourceChange={controller.changeFeedSource}
      onManageContentSources={manageContentSources}
      onFeedFilterChange={controller.setFeedFilter}
      onLoadMore={loadMore}
      onOpenTopic={openTopic}
      onReadingFilterChange={controller.setReadingFilter}
      onRefresh={controller.refreshFeed}
    />
  );
}
