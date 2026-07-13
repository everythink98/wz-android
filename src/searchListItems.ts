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
  | { type: 'groupHeader'; group: SearchGroup; expanded: boolean; meta: string }
  | { type: 'groupAuthNotice'; group: SearchGroup }
  | { type: 'groupError'; group: SearchGroup }
  | { type: 'groupLoading'; group: SearchGroup }
  | { type: 'groupEmpty'; group: SearchGroup }
  | { type: 'groupLoadMore'; group: SearchGroup; page: number }
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
    if (errorLooksLikeVerification(group)) {
      return '需验证';
    }
    if (group.authNotice?.message === group.error && errorLooksLikeLogin(group)) {
      return group.errorKind === 'login-expired' ? '登录失效' : '需登录';
    }
    return '请求失败';
  }
  return `${group.items.length} 条${group.hasMore ? ' · 可继续加载' : ''}`;
}

export function searchGroupEmptyText(group: SearchGroup) {
  return `${group.label} 没有匹配结果`;
}

export function buildSearchListItems({
  expandedGroups,
  groups
}: {
  expandedGroups: Record<string, boolean>;
  groups: SearchGroup[];
}): SearchListItem[] {
  const items: SearchListItem[] = [];
  for (const group of groups) {
    const expanded = expandedGroups[group.source] ?? true;
    items.push({
      type: 'groupHeader',
      group,
      expanded,
      meta: searchGroupMeta(group)
    });
    if (!expanded) {
      continue;
    }
    if (group.error) {
      if (group.authNotice?.message === group.error && shouldRenderAuthNotice(group)) {
        items.push({ type: 'groupAuthNotice', group });
      } else {
        if (shouldRenderAuthNotice(group)) {
          items.push({ type: 'groupAuthNotice', group });
        }
        items.push({ type: 'groupError', group });
      }
      if (!group.items.length) {
        continue;
      }
    }
    if (shouldRenderAuthNotice(group)) {
      items.push({ type: 'groupAuthNotice', group });
    }
    if (group.loading) {
      items.push({ type: 'groupLoading', group });
      continue;
    }
    for (const topic of group.items) {
      items.push({ type: 'topic', topic, groupSource: group.source });
    }
    if (!group.items.length) {
      items.push({ type: 'groupEmpty', group });
    }
    if (!group.error && group.hasMore && group.nextPage) {
      items.push({ type: 'groupLoadMore', group, page: group.nextPage });
    }
  }
  return items;
}
