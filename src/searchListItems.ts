import { sourceLabel } from './appUtils';
import type { Source, Topic } from './types';

export type SearchGroup = {
  source: Source;
  label: string;
  items: Topic[];
  error?: string;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  nextPage?: number | null;
};

export type SearchListItem =
  | { type: 'groupHeader'; group: SearchGroup; expanded: boolean; meta: string }
  | { type: 'groupError'; group: SearchGroup }
  | { type: 'groupLoading'; group: SearchGroup }
  | { type: 'groupEmpty'; group: SearchGroup }
  | { type: 'groupLoadMore'; group: SearchGroup; page: number }
  | { type: 'topic'; topic: Topic; groupSource?: Source }
  | { type: 'empty'; text: string };

export function searchResultCategoryKey(item: Topic) {
  const category = item.categoryId || item.category?.replace(/^#/, '');
  return category ? `${item.source}:${category}` : '';
}

function isHiddenSearchCategory(item: Topic) {
  return item.source === 'linuxdo' && item.category === '未分类';
}

export function searchCategoryOptions(results: Topic[]) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of results) {
    if (isHiddenSearchCategory(item)) {
      continue;
    }
    const key = searchResultCategoryKey(item);
    if (!key || !item.category) {
      continue;
    }
    const current = counts.get(key);
    counts.set(key, {
      label: `${sourceLabel(item.source)} · ${item.category}`,
      count: (current?.count || 0) + 1
    });
  }
  return [...counts.entries()].map(([value, item]) => ({
    value,
    label: `${item.label} ${item.count}`
  }));
}

export function filterSearchResultsByCategory(results: Topic[], categoryFilter: string) {
  return categoryFilter === 'all'
    ? results
    : results.filter((item) => searchResultCategoryKey(item) === categoryFilter);
}

export function filterSearchGroupsByCategory(groups: SearchGroup[], categoryFilter: string) {
  return groups.map((group) => ({
    ...group,
    items: filterSearchResultsByCategory(group.items, categoryFilter)
  }));
}

export function buildSearchListItems({
  busy,
  expandedGroups,
  filteredResults,
  groups,
  query,
  remote
}: {
  busy: boolean;
  expandedGroups: Record<string, boolean>;
  filteredResults: Topic[];
  groups: SearchGroup[];
  query: string;
  remote: boolean;
}): SearchListItem[] {
  if (!remote) {
    return filteredResults.map<SearchListItem>((topic) => ({ type: 'topic', topic }));
  }
  if (!groups.length) {
    return [{ type: 'empty', text: busy ? '正在搜索...' : '暂无搜索结果' }];
  }
  const items: SearchListItem[] = [];
  for (const group of groups) {
    const expanded = expandedGroups[group.source] ?? true;
    items.push({
      type: 'groupHeader',
      group,
      expanded,
      meta: group.loading ? '搜索中' : group.error ? '读取失败' : `${group.items.length} 条${group.hasMore ? ' · 可继续加载' : ''}`
    });
    if (!expanded) {
      continue;
    }
    if (group.error) {
      items.push({ type: 'groupError', group });
      continue;
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
  if (!items.length && query.trim()) {
    return [{ type: 'empty', text: busy ? '正在搜索...' : '暂无搜索结果' }];
  }
  return items;
}
