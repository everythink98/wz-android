import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Category, Topic } from '@/domain/forum/models';
import { isDiscourseSource, type SessionSource } from '@/domain/forum/sourceCatalog';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import type { ReaderData } from '@/domain/reader/readerData';
import { projectContentSourcePreferences } from '@/domain/reader/contentSourcePreferences';
import type { LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { SiteSessionViewModels } from '@/domain/session/siteSessionState';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import type { SearchListItem } from './listItems';
import { SearchScreen } from './SearchScreen';
import { useSearchController } from './useSearchController';

export type SearchRouteRuntimeValue = {
  account: {
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
  const { searchSources: enabledSearchSources } = projectContentSourcePreferences(
    runtime.readerData.settings.contentSources
  );
  const retryIdentityStatus = useCallback(
    (source: SessionSource) => {
      void runtime.account.reconcileAccountStatus(source);
    },
    [runtime.account]
  );
  const controller = useSearchController({
    active,
    categories: runtime.catalogCategories,
    enabledSearchSources,
    sessionEpochs: runtime.account.sessionEpochs,
    linuxDoVerificationActive: runtime.account.linuxDoVerificationVisible,
    notify: runtime.notify,
    onNodeSeekSearchVerificationRequired: runtime.account.requestNodeSeekVerification,
    onRetryIdentityStatus: retryIdentityStatus,
    sessionViewModels: runtime.account.sessionViewModels,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showNodeSeekVerification: (message) =>
      runtime.account.requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证'),
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway
  });
  const topicStateIndex = useMemo(() => createTopicListItemStateIndex(runtime.readerData), [runtime.readerData]);
  const candidateSource =
    controller.searchSource !== 'all' && isDiscourseSource(controller.searchSource)
      ? controller.searchSource
      : 'linuxdo';
  const tagReadPlan = runtime.account.readGateway.getReadPlan(candidateSource, 'search-tags');
  const userReadPlan = runtime.account.readGateway.getReadPlan(candidateSource, 'search-users');
  const runSearch = useCallback(
    (queryOverride?: string) => {
      void controller.runSearch(queryOverride === undefined ? undefined : { query: queryOverride });
    },
    [controller]
  );
  const openTopic = useCallback(
    (topic: Topic) => navigation.dispatch(StackActions.push('Topic', { topic })),
    [navigation]
  );
  const manageContentSources = useCallback(() => navigation.dispatch(manageContentSourcesAction()), [navigation]);
  return (
    <SearchScreen
      busy={controller.searchBusy}
      categories={runtime.catalogCategories}
      sessionEpochs={runtime.account.sessionEpochs}
      searchCandidateReadPlanScopes={{ tags: tagReadPlan.cacheScope, users: userReadPlan.cacheScope }}
      requestsEnabled={active && tagReadPlan.state === 'ready' && userReadPlan.state === 'ready'}
      query={controller.searchQuery}
      topicStateIndex={topicStateIndex}
      recentSearches={controller.recentSearches}
      searchFilters={controller.searchFilters}
      searchGroups={controller.searchGroups}
      expectedSearchSources={enabledSearchSources}
      linuxDoAiState={controller.linuxDoAiState}
      linuxDoAiVisible={controller.linuxDoAiVisible}
      searchSource={controller.searchSource}
      submittedQuery={controller.submittedSearchQuery}
      scrollRef={listRef}
      onLoadMoreSearchSource={controller.loadMoreSearchSource}
      onOpenTopic={openTopic}
      onManageContentSources={manageContentSources}
      onRemoveRecentSearch={controller.removeRecentSearch}
      onQueryChange={controller.setSearchQuery}
      onRetryLinuxDoAiSearch={controller.retryLinuxDoAiSearch}
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
