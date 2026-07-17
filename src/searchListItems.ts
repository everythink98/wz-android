import type { Source, SourceErrorKind, Topic } from './types';
import type { AuthNotice } from './siteSessionPrompts';

export type SearchGroup = {
  source: Source;
  label: string;
  items: Topic[];
  error?: string;
  errorKind?: SourceErrorKind;
  authNotice?: AuthNotice;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  nextPage?: number | null;
};

export type SearchListItem =
  | { type: 'groupHeader'; group: SearchGroup; meta: string }
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
  return `已载入 ${group.items.length} 条`;
}

export function searchGroupEmptyText(group: SearchGroup) {
  return `${group.label} 没有匹配结果`;
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
    if (mode === 'source' && group.hasMore && group.nextPage) {
      items.push({ type: 'groupLoadMore', group, page: group.nextPage });
    }
  }
  return items;
}
