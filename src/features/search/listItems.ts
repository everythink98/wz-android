import type { Source, SourceErrorKind, Topic } from '@/domain/forum/models';
import type { AuthNotice } from '@/domain/session/siteSessionPrompts';

export type SearchGroup = {
  source: Source;
  label: string;
  items: Topic[];
  externalSearchUrl?: string;
  error?: string;
  errorKind?: SourceErrorKind;
  authNotice?: AuthNotice;
  loading?: boolean;
  loadingMore?: boolean;
  settled?: boolean;
  hasMore?: boolean;
  nextPage?: number | null;
};

export type RemoteSearchAction =
  | { type: 'yaohuo-login'; message: string }
  | { type: 'nodeseek-verification'; message: string }
  | { type: 'linuxdo-verification'; message: string };

export type RemoteSearchSourceResult =
  | { kind: 'success'; group: SearchGroup }
  | { kind: 'failed'; group: SearchGroup }
  | { kind: 'action-required'; group: SearchGroup; action: RemoteSearchAction };

export type SearchListItem =
  | { type: 'groupHeader'; group: SearchGroup; meta: string }
  | { type: 'externalSearch'; group: SearchGroup; url: string }
  | { type: 'groupAuthNotice'; group: SearchGroup }
  | { type: 'groupError'; group: SearchGroup }
  | { type: 'groupLoading'; group: SearchGroup }
  | { type: 'groupEmpty'; group: SearchGroup }
  | { type: 'groupLoadMore'; group: SearchGroup; page: number }
  | { type: 'groupPageStatus'; group: SearchGroup; page: number }
  | { type: 'topic'; topic: Topic; groupSource?: Source };

function shouldRenderAuthNotice(group: SearchGroup) {
  return Boolean(group.authNotice && group.authNotice.tone !== 'neutral');
}

function errorLooksLikeVerification(group: SearchGroup) {
  return group.errorKind === 'verification-required';
}

function errorLooksLikeLogin(group: SearchGroup) {
  return group.errorKind === 'login-required' || group.errorKind === 'login-expired';
}

export function searchGroupMeta(group: SearchGroup) {
  if (group.loading) {
    return '搜索中';
  }
  if (group.settled === false) {
    return '等待账号状态';
  }
  if (group.error) {
    if (group.nextPage) {
      return `${group.items.length} 条 · 加载失败`;
    }
    if (errorLooksLikeVerification(group)) {
      return '需验证';
    }
    if (group.authNotice?.message === group.error && errorLooksLikeLogin(group)) {
      return group.errorKind === 'login-expired' ? '登录失效' : '需登录';
    }
    return '请求失败';
  }
  if (group.externalSearchUrl) {
    return 'Google 搜索';
  }
  return `已载入 ${group.items.length} 条`;
}

export function searchGroupEmptyText(group: SearchGroup) {
  return `${group.label} 没有匹配结果`;
}

export function groupFromRemoteSearchResult(result: RemoteSearchSourceResult) {
  return result.group;
}

export function hasNextSearchPage(
  hasMore: boolean | undefined,
  nextPage: number | null | undefined,
  requestedPage: number
) {
  return Boolean(hasMore && nextPage && nextPage !== requestedPage);
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
    const paginationError = Boolean(group.error && group.nextPage);
    if (mode === 'overview') {
      items.push({
        type: 'groupHeader',
        group,
        meta: searchGroupMeta(group)
      });
    }
    if (group.error && !paginationError) {
      if (group.authNotice?.message === group.error && shouldRenderAuthNotice(group)) {
        items.push({ type: 'groupAuthNotice', group });
      } else {
        if (shouldRenderAuthNotice(group)) {
          items.push({ type: 'groupAuthNotice', group });
        }
        items.push({ type: 'groupError', group });
      }
      continue;
    }
    if (shouldRenderAuthNotice(group)) {
      items.push({ type: 'groupAuthNotice', group });
    }
    if (group.loading) {
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
    if (!group.items.length) {
      items.push({ type: 'groupEmpty', group });
    }
    if (group.error) {
      items.push({ type: 'groupError', group });
      continue;
    }
    if (mode === 'source' && group.items.length > 0 && group.hasMore && group.nextPage) {
      items.push({ type: 'groupLoadMore', group, page: group.nextPage });
    }
  }
  return items;
}
