import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Category, SourceErrorInfo, Topic } from '@/domain/forum/models';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { ReaderData } from '@/domain/reader/readerData';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { ForumIdentityBarrierSource } from '@/platform/query/serverState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { useIdentityVerificationPrompt } from '@/ui/hooks/useIdentityVerificationPrompt';
import { FeedScreen } from './FeedScreen';
import { useFeedController } from './useFeedController';

type IdentityCheck = {
  checking: boolean;
  pending: boolean;
  error?: SourceErrorInfo;
};

export type FeedRouteRuntimeValue = {
  account: {
    identityBarriers: readonly ForumIdentityBarrierSource[];
    identityChecks: Record<SessionSource, IdentityCheck>;
    identityReconciliationPending: boolean;
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    requestNodeSeekVerification: (message: string, recovery?: LinuxDoReadRecovery) => void;
    retainableIdentityBarriers: readonly ForumIdentityBarrierSource[];
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
    identityBarriers: runtime.account.identityBarriers,
    identityReconciliationPending: runtime.account.identityReconciliationPending,
    retainableIdentityBarriers: runtime.account.retainableIdentityBarriers,
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
  const identityCheck = controller.feedSource === 'linuxdo' ? runtime.account.identityChecks.linuxdo : undefined;
  const identityError = identityCheck?.pending ? identityCheck.error : undefined;
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(runtime.reader.data), [runtime.reader.data]);
  const loadMore = useCallback(() => {
    if (controller.feedAllowsRemotePagination) void controller.loadFeed();
  }, [controller]);
  const retryIdentity = useCallback(() => {
    if (controller.feedSource === 'linuxdo') void runtime.account.reconcileAccountStatus('linuxdo');
  }, [controller.feedSource, runtime.account]);
  const openTopic = useCallback(
    (topic: Topic) => navigation.dispatch(StackActions.push('Topic', { topic })),
    [navigation]
  );

  useIdentityVerificationPrompt({
    enabled: active && runtime.appActive && controller.shownFeedItems.length === 0,
    error: runtime.account.identityChecks.linuxdo.error,
    identityPending: runtime.account.identityChecks.linuxdo.pending,
    intentKey:
      active && runtime.appActive && controller.feedSource === 'linuxdo'
        ? `feed:${controller.categoryFilter}:${controller.feedFilter || ''}`
        : null,
    showVerification: runtime.account.showLinuxDoVerification
  });

  return (
    <FeedScreen
      busy={controller.feedBusy && !identityError}
      categories={controller.feedCategories}
      categoryFilter={controller.categoryFilter}
      feedHasMore={controller.activeFeedState.hasMore && controller.feedAllowsRemotePagination}
      feedItems={controller.shownFeedItems}
      feedOutcomeKind={
        identityError ? (identityError.kind === 'ordinary' ? 'error' : 'auth') : controller.feedOutcomeKind
      }
      feedPage={controller.activeFeedState.page}
      feedSource={controller.feedSource}
      feedFilter={controller.feedFilter}
      feedFilters={controller.feedFilters}
      identityChecking={Boolean(identityCheck?.checking)}
      identityError={identityError}
      loadMoreFailureSignal={controller.activeFeedState.loadMoreFailureSignal}
      loadingMore={controller.activeFeedState.loadingMore}
      topicStateIndex={topicStateIndex}
      readingFilter={controller.readingFilter}
      refreshing={controller.activeFeedState.refreshing}
      scrollRef={listRef}
      onCategoryChange={controller.setCategoryFilter}
      onFeedSourceChange={controller.changeFeedSource}
      onFeedFilterChange={controller.setFeedFilter}
      onLoadMore={loadMore}
      onCheckLinuxDoStatus={() => {
        void runtime.account.showLinuxDoVerification();
      }}
      onOpenTopic={openTopic}
      onRetryIdentity={retryIdentity}
      onReadingFilterChange={controller.setReadingFilter}
      onRefresh={identityError ? retryIdentity : controller.refreshFeed}
    />
  );
}
