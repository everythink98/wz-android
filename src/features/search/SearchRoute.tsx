import { useCallback, useRef } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Topic } from '@/domain/forum/models';

import { openForumSearchCustomTab } from '@/platform/android/forumSearchCustomTab';
import { errorMessage } from '@/platform/network/errors';
import { dispatchFocusedRoute, manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import type { SearchListItem } from './listItems';
import { SearchScreen } from './SearchScreen';
import { SearchFilterSheet, type SearchFilterPlacement } from './SearchFilterSheet';
import { useSearchController } from './useSearchController';
import { useSearchRouteRuntime } from './SearchRouteRuntime';

export { SearchRouteRuntimeProvider, type SearchRouteRuntimeValue } from './SearchRouteRuntime';

export function SearchRoute() {
  const runtime = useSearchRouteRuntime();
  const active = useIsFocused();
  const navigation = useNavigation();
  const listRef = useRef<FlashListRef<SearchListItem> | null>(null);
  useScrollToTop(listRef);
  const enabledSearchSources = runtime.enabledSources;
  const notify = runtime.notify;
  const requestNodeSeekVerification = runtime.account.requestNodeSeekVerification;
  const openExternalSearch = useCallback(
    async (url: string) => {
      if (!navigation.isFocused()) return;
      try {
        const customTabOpened = await openForumSearchCustomTab(url);
        if (!customTabOpened) {
          notify('当前浏览器不支持返回阅坛，可继续查看搜索结果');
        }
      } catch (error) {
        notify(`无法打开 Google 搜索：${errorMessage(error)}`);
      }
    },
    [navigation, notify]
  );
  const showNodeSeekVerification = useCallback(
    (message?: string) => requestNodeSeekVerification(message || 'NodeSeek 需要完成 Cloudflare 验证'),
    [requestNodeSeekVerification]
  );
  const controller = useSearchController({
    active,
    categories: runtime.catalogCategories,
    enabledSearchSources,
    sessionEpochs: runtime.account.sessionEpochs,
    linuxDoVerificationActive: runtime.account.linuxDoVerificationVisible,
    notify: runtime.notify,
    onOpenExternalSearch: openExternalSearch,
    onNodeSeekSearchVerificationRequired: runtime.account.requestNodeSeekVerification,
    reconcileIdentityStatus: runtime.account.reconcileAccountStatus,
    sessionViewModels: runtime.account.sessionViewModels,
    showLinuxDoVerification: runtime.account.showLinuxDoVerification,
    showNodeSeekVerification,
    showYaohuoLogin: runtime.account.showYaohuoLogin,
    readGateway: runtime.account.readGateway
  });
  const readGateway = runtime.account.readGateway;
  const loadV2exNodes = useCallback(
    async (signal: AbortSignal) => {
      const { items, errors } = await readGateway.getCategories({ source: 'v2ex', v2exNodeDirectory: true, signal });
      if (errors.v2ex) throw new Error(errors.v2ex.message);
      return items;
    },
    [readGateway]
  );
  const {
    searchFilters,
    searchCandidateReadPlanScopes,
    searchCandidateRequestsEnabled,
    searchDiscourseTags,
    searchDiscourseUsers
  } = controller;
  const renderFilters = useCallback(
    (placement: SearchFilterPlacement) => (
      <SearchFilterSheet
        {...placement}
        active={active}
        onApply={(source, filter) => {
          if (navigation.isFocused()) placement.onApply(source, filter);
        }}
        categories={runtime.catalogCategories}
        sessionEpochs={runtime.account.sessionEpochs}
        readPlanScopes={searchCandidateReadPlanScopes}
        requestsEnabled={searchCandidateRequestsEnabled}
        searchFilters={searchFilters}
        onLoadV2exNodes={loadV2exNodes}
        onSearchDiscourseTags={searchDiscourseTags}
        onSearchDiscourseUsers={searchDiscourseUsers}
      />
    ),
    [
      active,
      loadV2exNodes,
      navigation,
      runtime.account.sessionEpochs,
      runtime.catalogCategories,
      searchCandidateReadPlanScopes,
      searchCandidateRequestsEnabled,
      searchDiscourseTags,
      searchDiscourseUsers,
      searchFilters
    ]
  );
  const runControllerSearch = controller.runSearch;
  const runSearch = useCallback(
    (queryOverride?: string) => {
      void runControllerSearch(queryOverride === undefined ? undefined : { query: queryOverride });
    },
    [runControllerSearch]
  );
  const changeSearchSource = useLatestCallback(controller.setSearchSource);
  const openTopic = useCallback(
    (topic: Topic) => dispatchFocusedRoute(navigation, StackActions.push('Topic', { topic })),
    [navigation]
  );
  const manageContentSources = useCallback(
    () => dispatchFocusedRoute(navigation, manageContentSourcesAction()),
    [navigation]
  );
  return (
    <SearchScreen
      active={active}
      isRouteFocused={navigation.isFocused}
      busy={controller.searchBusy}
      renderFilters={renderFilters}
      query={controller.searchQuery}
      readScope={controller.searchReadScope}
      topicStateIndex={runtime.topicStateIndex}
      recentSearches={controller.recentSearches}
      searchGroups={controller.searchGroups}
      expectedSearchSources={enabledSearchSources}
      externalSearchSources={controller.externalSearchSources}
      linuxDoAiState={controller.linuxDoAiState}
      linuxDoAiVisible={controller.linuxDoAiVisible}
      searchSource={controller.searchSource}
      submittedQuery={controller.submittedSearchQuery}
      scrollRef={listRef}
      onLoadMoreSearchSource={controller.loadMoreSearchSource}
      onOpenExternalSearch={openExternalSearch}
      onOpenTopic={openTopic}
      onManageContentSources={manageContentSources}
      onRemoveRecentSearch={controller.removeRecentSearch}
      onQueryChange={controller.setSearchQuery}
      onRetryLinuxDoAiSearch={controller.retryLinuxDoAiSearch}
      onSearch={runSearch}
      onSearchFilterApply={controller.applySearchFilter}
      onSearchSourceChange={changeSearchSource}
      onRetrySearchSource={controller.retrySearchSource}
      onToggleLinuxDoAiSearch={controller.toggleLinuxDoAiSearch}
    />
  );
}
