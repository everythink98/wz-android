import type { Source, Topic } from './types';
import type { AuthNotice } from './siteSessionPrompts';

export type SearchGroup = {
  source: Source;
  label: string;
  items: Topic[];
  error?: string;
  authNotice?: AuthNotice;
  verificationRequired?: boolean;
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
      meta: group.loading ? '搜索中' : group.error ? group.authNotice?.message === group.error ? '受限' : '读取失败' : `${group.items.length} 条${group.hasMore ? ' · 可继续加载' : ''}`
    });
    if (!expanded) {
      continue;
    }
    if (group.error) {
      if (group.authNotice?.message === group.error) {
        items.push({ type: 'groupAuthNotice', group });
      } else {
        if (group.authNotice && group.authNotice.tone !== 'neutral') {
          items.push({ type: 'groupAuthNotice', group });
        }
        items.push({ type: 'groupError', group });
      }
      continue;
    }
    if (group.authNotice) {
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
    if (group.hasMore && group.nextPage) {
      items.push({ type: 'groupLoadMore', group, page: group.nextPage });
    }
  }
  return items;
}
