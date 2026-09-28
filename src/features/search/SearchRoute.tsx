import { useCallback, useMemo, useRef } from 'react';
import { StackActions, useIsFocused, useNavigation, useScrollToTop } from '@react-navigation/native';
import type { FlashListRef } from '@shopify/flash-list';
import type { Topic } from '@/domain/forum/models';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';

import { openForumSearchCustomTab } from '@/platform/android/forumSearchCustomTab';
import { errorMessage } from '@/platform/network/errors';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import type { SearchListItem } from './listItems';
import { SearchScreen } from './SearchScreen';
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
      try {
        const customTabOpened = await openForumSearchCustomTab(url);
        if (!customTabOpened) {
          notify('当前浏览器不支持返回阅坛，可继续查看搜索结果');
        }
      } catch (error) {
        notify(`无法打开 Google 搜索：${errorMessage(error)}`);
      }
    },
    [notify]
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
  const candidateSource =
    controller.searchSource !== 'all' && isDiscourseSource(controller.searchSource)
      ? controller.searchSource
      : 'linuxdo';
  const tagReadPlan = runtime.account.readGateway.getReadPlan(candidateSource, 'search-tags');
  const userReadPlan = runtime.account.readGateway.getReadPlan(candidateSource, 'search-users');
  const candidateReadPlanScopes = useMemo(
    () => ({ tags: tagReadPlan.cacheScope, users: userReadPlan.cacheScope }),
    [tagReadPlan.cacheScope, userReadPlan.cacheScope]
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
    (topic: Topic) => navigation.dispatch(StackActions.push('Topic', { topic })),
    [navigation]
  );
  const manageContentSources = useCallback(() => navigation.dispatch(manageContentSourcesAction()), [navigation]);
  return (
    <SearchScreen
      busy={controller.searchBusy}
      categories={runtime.catalogCategories}
      sessionEpochs={runtime.account.sessionEpochs}
      searchCandidateReadPlanScopes={candidateReadPlanScopes}
      requestsEnabled={active && tagReadPlan.state === 'ready' && userReadPlan.state === 'ready'}
      query={controller.searchQuery}
      topicStateIndex={runtime.topicStateIndex}
      recentSearches={controller.recentSearches}
      searchFilters={controller.searchFilters}
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
      onSearchDiscourseTags={controller.searchDiscourseTags}
      onSearchDiscourseUsers={controller.searchDiscourseUsers}
      onSearchSourceChange={changeSearchSource}
      onRetrySearchSource={controller.retrySearchSource}
      onToggleLinuxDoAiSearch={controller.toggleLinuxDoAiSearch}
    />
  );
}
