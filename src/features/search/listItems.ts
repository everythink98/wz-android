import { nextPagePosition } from '@/domain/forum/pagination';
import type { SearchTopic, Source, SourceErrorKind } from '@/domain/forum/models';
import type { AuthNotice } from '@/domain/session/siteSessionPrompts';

export type SearchGroup = {
  source: Source;
  label: string;
  items: SearchTopic[];
  externalSearchUrl?: string;
  error?: string;
  errorKind?: SourceErrorKind | 'invalid-query';
  authNotice?: AuthNotice;
  loading?: boolean;
  loadingMore?: boolean;
  retainedResults?: { retryPage: number | null };
  settled?: boolean;
  hasMore?: boolean;
  nextPage?: number | null;
};

type RemoteSearchAction =
  | { type: 'yaohuo-login'; message: string }
  | { type: 'nodeseek-verification'; message: string }
  | { type: 'linuxdo-verification'; message: string };

export type RemoteSearchSourceResult =
  | { kind: 'success'; group: SearchGroup }
  | { kind: 'failed'; group: SearchGroup }
  | { kind: 'action-required'; group: SearchGroup; action: RemoteSearchAction };

export type SearchListItem =
  | { type: 'recentHeader' }
  | { type: 'recentSearch'; query: string }
  | { type: 'groupHeader'; group: SearchGroup; meta: string }
  | { type: 'externalSearch'; group: SearchGroup; url: string }
  | { type: 'groupAuthNotice'; group: SearchGroup }
  | { type: 'groupError'; group: SearchGroup }
  | { type: 'groupLoading'; group: SearchGroup }
  | { type: 'groupEmpty'; group: SearchGroup }
  | { type: 'groupLoadMore'; group: SearchGroup; page: number }
  | { type: 'groupPageStatus'; group: SearchGroup; page: number }
  | { type: 'topic'; topic: SearchTopic; groupSource?: Source };

function shouldRenderAuthNotice(group: SearchGroup) {
  return Boolean(group.authNotice && group.authNotice.tone !== 'neutral');
}

function errorLooksLikeVerification(group: SearchGroup) {
  return group.errorKind === 'verification-required';
}

function errorLooksLikeLogin(group: SearchGroup) {
  return group.errorKind === 'login-required' || group.errorKind === 'login-expired';
}

export function searchGroupRetryPage(group: SearchGroup) {
  return group.retainedResults ? group.retainedResults.retryPage : (group.nextPage ?? null);
}

export function searchGroupMeta(group: SearchGroup) {
  const hasCachedResults = group.items.length > 0 && (!group.error || group.retainedResults);
  if (group.loading) {
    return hasCachedResults ? `${group.items.length} 条 · 刷新中` : '搜索中';
  }
  if (group.settled === false) {
    return '等待账号状态';
  }
  if (group.error) {
    if (group.errorKind === 'invalid-query') return '请修改搜索词';
    if (searchGroupRetryPage(group)) {
      return `${group.items.length} 条 · 加载失败`;
    }
    if (errorLooksLikeVerification(group)) {
      return '需验证';
    }
    if (group.authNotice?.message === group.error && errorLooksLikeLogin(group)) {
      return group.errorKind === 'login-expired' ? '登录失效' : '需登录';
    }
    return hasCachedResults ? `${group.items.length} 条 · 刷新失败` : '请求失败';
  }
  return `已载入 ${group.items.length} 条`;
}

export function searchGroupEmptyText(group: SearchGroup) {
  return `${group.label} 没有匹配结果`;
}

export function groupFromRemoteSearchResult(result: RemoteSearchSourceResult) {
  return result.group;
}

export function nextSearchPage(response: Pick<SearchGroup, 'hasMore' | 'nextPage'>, page: number) {
  return nextPagePosition(response, { page })?.page;
}

export function buildSearchListItems({
  groups,
  mode
}: {
  groups: SearchGroup[];
  mode: 'overview' | 'source';
}): SearchListItem[] {
  const items: SearchListItem[] = [];
  for (const group of groups) {
    const paginationError = Boolean(group.error && searchGroupRetryPage(group));
    const hasTopics = group.items.length > 0 && (!group.error || paginationError || group.retainedResults);
    const showAuthNotice = shouldRenderAuthNotice(group);
    const showError = paginationError || !showAuthNotice || group.authNotice?.message !== group.error;
    const canOpenExternal = group.externalSearchUrl && !group.error && !group.loading && group.settled !== false;
    if (mode === 'overview' && !canOpenExternal) {
      items.push({
        type: 'groupHeader',
        group,
        meta: searchGroupMeta(group)
      });
    }
    if (showAuthNotice) {
      items.push({ type: 'groupAuthNotice', group });
    }
    if (group.error && !paginationError && !hasTopics) {
      if (showError) items.push({ type: 'groupError', group });
      continue;
    }
    if (group.loading && !hasTopics) {
      items.push({ type: 'groupLoading', group });
      continue;
    }
    if (group.settled === false) {
      continue;
    }
    if (group.externalSearchUrl) {
      items.push({ type: 'externalSearch', group, url: group.externalSearchUrl });
      continue;
    }
    const visibleTopics = mode === 'overview' ? group.items.slice(0, 2) : group.items;
    for (const topic of visibleTopics) {
      items.push({ type: 'topic', topic, groupSource: group.source });
    }
    if (group.loading) {
      if (mode === 'source') items.push({ type: 'groupLoading', group });
      continue;
    }
    if (!hasTopics) {
      items.push({ type: 'groupEmpty', group });
    }
    if (group.error) {
      if (showError) items.push({ type: 'groupError', group });
      continue;
    }
    if (mode === 'source' && hasTopics && group.hasMore && group.nextPage) {
      items.push({ type: 'groupLoadMore', group, page: group.nextPage });
    }
  }
  return items;
}
