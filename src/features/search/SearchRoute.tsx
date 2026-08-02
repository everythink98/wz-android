import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Category, SourceErrorInfo, Topic } from '@/domain/forum/models';
import type { SessionSource } from '@/domain/forum/sourceCatalog';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { ReaderData } from '@/domain/reader/readerData';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { useIdentityVerificationPrompt } from '@/ui/hooks/useIdentityVerificationPrompt';
import type { SearchListItem } from './listItems';
import { SearchScreen } from './SearchScreen';
import { useSearchController } from './useSearchController';

type IdentityCheck = {
  checking: boolean;
  pending: boolean;
  error?: SourceErrorInfo;
};

export type SearchRouteRuntimeValue = {
  account: {
    identityChecks: Record<SessionSource, IdentityCheck>;
    identityPending: Record<SessionSource, boolean>;
    linuxDoVerificationVisible: boolean;
    readGateway: ReadGateway;
    reconcileAccountStatus: (source: SessionSource) => Promise<unknown>;
    requestNodeSeekVerification: (message: string, recovery?: LinuxDoReadRecovery) => void;
    sessionEpochs: ForumSessionEpochs;
    sessionViewModels: SiteSessionViewModels;
    showLinuxDoVerification: (
      message?: string,
      recovery?: LinuxDoReadRecovery
    ) => void | boolean | Promise<void | boolean>;
    showYaohuoLogin: (message?: string) => void;
  };
  appActive: boolean;
  catalogCategories: Category[];
  notify: (message: string) => void;
  readerData: ReaderData;
};

const SearchRouteRuntimeContext = createContext<SearchRouteRuntimeValue | null>(null);

export function SearchRouteRuntimeProvider({
  children,
  value
}: {
  children: ReactNode;
  value: SearchRouteRuntimeValue;
}) {
  return <SearchRouteRuntimeContext.Provider value={value}>{children}</SearchRouteRuntimeContext.Provider>;
}

function useSearchRouteRuntime() {
  const runtime = useContext(SearchRouteRuntimeContext);
  if (!runtime) throw new Error('SearchRouteRuntimeProvider is required');
  return runtime;
}

export function SearchRoute() {
  const runtime = useSearchRouteRuntime();
  const active = useIsFocused();
  const navigation = useNavigation();
  const listRef = useRef<FlashListRef<SearchListItem> | null>(null);
  useScrollToTop(listRef);
  const controller = useSearchController({
    active,
    categories: runtime.catalogCategories,
    sessionEpochs: runtime.account.sessionEpochs,
    linuxDoVerificationActive: runtime.account.linuxDoVerificationVisible,
    notify: runtime.notify,
    onNodeSeekSearchVerificationRequired: runtime.account.requestNodeSeekVerification,
    sessionViewModels: runtime.account.sessionViewModels,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showNodeSeekVerification: (message) =>
      runtime.account.requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证'),
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway
  });
  const identityCheck = controller.searchSource === 'linuxdo' ? runtime.account.identityChecks.linuxdo : undefined;
  const identityError = identityCheck?.pending ? identityCheck.error : undefined;
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(runtime.readerData), [runtime.readerData]);
  const runSearch = useCallback(
    (queryOverride?: string) => {
      void controller.runSearch(queryOverride === undefined ? undefined : { query: queryOverride });
    },
    [controller]
  );
  const retryIdentity = useCallback(() => {
    if (controller.searchSource === 'linuxdo') void runtime.account.reconcileAccountStatus('linuxdo');
  }, [controller.searchSource, runtime.account]);
  const openTopic = useCallback(
    (topic: Topic) => navigation.dispatch(StackActions.push('Topic', { topic })),
    [navigation]
  );
  const linuxDoResultCount = controller.searchGroups.find((group) => group.source === 'linuxdo')?.items.length || 0;

  useIdentityVerificationPrompt({
    enabled:
      active &&
      runtime.appActive &&
      !controller.linuxDoAiVisible &&
      Boolean(controller.submittedSearchQuery) &&
      linuxDoResultCount === 0,
    error: runtime.account.identityChecks.linuxdo.error,
    identityPending: runtime.account.identityChecks.linuxdo.pending,
    intentKey:
      active && runtime.appActive && controller.searchSource === 'linuxdo' && controller.submittedSearchQuery
        ? `search:${controller.submittedSearchQuery}:${JSON.stringify(controller.searchFilters.linuxdo)}`
        : null,
    showVerification: runtime.account.showLinuxDoVerification
  });

  return (
    <SearchScreen
      busy={controller.searchBusy}
      categories={runtime.catalogCategories}
      sessionEpochs={runtime.account.sessionEpochs}
      requestsEnabled={
        active &&
        !runtime.account.linuxDoVerificationVisible &&
        (controller.searchSource === 'all' ||
          controller.searchSource === 'v2ex' ||
          !runtime.account.identityPending[controller.searchSource])
      }
      query={controller.searchQuery}
      topicStateIndex={topicStateIndex}
      recentSearches={controller.recentSearches}
      searchFilters={controller.searchFilters}
      searchGroups={controller.searchGroups}
      linuxDoAiState={controller.linuxDoAiState}
      linuxDoAiVisible={controller.linuxDoAiVisible}
      identityChecking={Boolean(identityCheck?.checking)}
      identityError={identityError}
      searchSessionNotices={identityCheck?.pending ? [] : controller.searchSessionNotices}
      searchSource={controller.searchSource}
      submittedQuery={controller.submittedSearchQuery}
      scrollRef={listRef}
      onLoadMoreSearchSource={controller.loadMoreSearchSource}
      onCheckLinuxDoStatus={() => {
        void runtime.account.showLinuxDoVerification();
      }}
      onOpenTopic={openTopic}
      onRemoveRecentSearch={controller.removeRecentSearch}
      onQueryChange={controller.setSearchQuery}
      onRetryLinuxDoAiSearch={controller.retryLinuxDoAiSearch}
      onRetryIdentity={retryIdentity}
      onSearch={runSearch}
      onSearchFilterApply={controller.applySearchFilter}
      onSearchDiscourseTags={controller.searchDiscourseTags}
      onSearchDiscourseUsers={controller.searchDiscourseUsers}
      onSearchSourceChange={controller.setSearchSource}
      onRetrySearchSource={controller.retrySearchSource}
      onToggleLinuxDoAiSearch={controller.toggleLinuxDoAiSearch}
    />
  );
}
