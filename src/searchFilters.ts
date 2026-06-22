import type { SearchSort } from './feedLogic';
import type { Category, Source } from './types';

export type SearchTimeRange = 'all' | 'day' | 'week' | 'month' | 'year';
export type SearchTextScope = 'all' | 'title';
export type SearchKeywordOperator = 'or' | 'and';
export type LinuxDoSearchOrder = 'relevance' | 'latest';
export type NodeSeekSearchSort = 'replyTime' | 'postTime';

export type V2exSearchFilter = {
  source: 'v2ex';
  sort: SearchSort;
  timeRange: SearchTimeRange;
  node: string;
  username: string;
  operator: SearchKeywordOperator;
};

export type LinuxDoSearchFilter = {
  source: 'linuxdo';
  scope: SearchTextScope;
  category: string;
  tags: string;
  username: string;
  timeRange: SearchTimeRange;
  order: LinuxDoSearchOrder;
};

export type NodeSeekSearchFilter = {
  source: 'nodeseek';
  category: string;
  sort: NodeSeekSearchSort;
};

export type YaohuoSearchFilter = {
  source: 'yaohuo';
  category: string;
};

export type SourceSearchFilter =
  | V2exSearchFilter
  | LinuxDoSearchFilter
  | NodeSeekSearchFilter
  | YaohuoSearchFilter;

export type SearchFilterState = {
  v2ex: V2exSearchFilter;
  linuxdo: LinuxDoSearchFilter;
  nodeseek: NodeSeekSearchFilter;
  yaohuo: YaohuoSearchFilter;
};

export const DEFAULT_SEARCH_FILTERS: SearchFilterState = {
  v2ex: {
    source: 'v2ex',
    sort: 'relevance',
    timeRange: 'all',
    node: '',
    username: '',
    operator: 'or'
  },
  linuxdo: {
    source: 'linuxdo',
    scope: 'all',
    category: '',
    tags: '',
    username: '',
    timeRange: 'all',
    order: 'relevance'
  },
  nodeseek: {
    source: 'nodeseek',
    category: '',
    sort: 'replyTime'
  },
  yaohuo: {
    source: 'yaohuo',
    category: '0'
  }
};

export const searchTimeRangeItems: Array<{ value: SearchTimeRange; label: string }> = [
  { value: 'all', label: '不限时间' },
  { value: 'day', label: '24小时' },
  { value: 'week', label: '7天' },
  { value: 'month', label: '30天' },
  { value: 'year', label: '1年' }
];

const TIME_RANGE_DAYS: Partial<Record<SearchTimeRange, number>> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365
};

function categoryForFilter(categories: Category[], source: Source, id: string) {
  const value = id.trim();
  return categories.find((category) => category.source === source && category.id === value);
}

export function defaultSearchFilterForSource<T extends Source>(source: T): SearchFilterState[T] {
  return { ...DEFAULT_SEARCH_FILTERS[source] };
}

export function searchFilterForSource(filters: SearchFilterState, source: Source): SourceSearchFilter {
  return filters[source];
}

export function searchTimeRangeLabel(value: SearchTimeRange) {
  return searchTimeRangeItems.find((item) => item.value === value)?.label || '不限时间';
}

function searchTimeRangeStartDate(value: SearchTimeRange, nowMs = Date.now()) {
  const days = TIME_RANGE_DAYS[value];
  if (!days) {
    return '';
  }
  const date = new Date(nowMs - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export function searchTimeRangeStartEpoch(value: SearchTimeRange, nowMs = Date.now()) {
  const days = TIME_RANGE_DAYS[value];
  return days ? Math.floor((nowMs - days * 24 * 60 * 60 * 1000) / 1000) : undefined;
}

function categoryLabel(categories: Category[], source: Source, id: string) {
  return categoryForFilter(categories, source, id)?.name || id.trim();
}

function linuxDoCategoryToken(categories: Category[], id: string) {
  const category = categoryForFilter(categories, 'linuxdo', id);
  return (category?.slug || category?.id || id).trim();
}

export function buildLinuxDoSearchQuery(query: string, filter: LinuxDoSearchFilter, categories: Category[]) {
  const parts = [query.trim()];
  if (filter.scope === 'title') {
    parts.push('in:title');
  }
  const category = linuxDoCategoryToken(categories, filter.category);
  if (category) {
    parts.push(`category:${category}`);
  }
  const tags = filter.tags.trim().replace(/^#+/, '');
  if (tags) {
    parts.push(`tags:${tags}`);
  }
  const username = filter.username.trim().replace(/^@+/, '');
  if (username) {
    parts.push(`@${username}`);
  }
  const after = searchTimeRangeStartDate(filter.timeRange);
  if (after) {
    parts.push(`after:${after}`);
  }
  if (filter.order === 'latest') {
    parts.push('order:latest');
  }
  return parts.filter(Boolean).join(' ');
}

export function searchFilterSummary(source: Source, filter: SourceSearchFilter, categories: Category[]) {
  const parts: string[] = [];
  if (source === 'v2ex' && filter.source === 'v2ex') {
    if (filter.sort === 'time') {
      parts.push('按时间');
    }
    if (filter.node.trim()) {
      parts.push(categoryLabel(categories, 'v2ex', filter.node));
    }
    if (filter.username.trim()) {
      parts.push(filter.username.trim().replace(/^@+/, ''));
    }
    if (filter.operator === 'and') {
      parts.push('全部关键词');
    }
    if (filter.timeRange !== 'all') {
      parts.push(searchTimeRangeLabel(filter.timeRange));
    }
  }
  if (source === 'linuxdo' && filter.source === 'linuxdo') {
    if (filter.scope === 'title') {
      parts.push('标题');
    }
    if (filter.category.trim()) {
      parts.push(categoryLabel(categories, 'linuxdo', filter.category));
    }
    if (filter.tags.trim()) {
      parts.push(filter.tags.trim().replace(/^#+/, ''));
    }
    if (filter.username.trim()) {
      parts.push(filter.username.trim().replace(/^@+/, ''));
    }
    if (filter.timeRange !== 'all') {
      parts.push(searchTimeRangeLabel(filter.timeRange));
    }
    if (filter.order === 'latest') {
      parts.push('最新');
    }
  }
  if (source === 'nodeseek' && filter.source === 'nodeseek') {
    if (filter.category.trim()) {
      parts.push(categoryLabel(categories, 'nodeseek', filter.category));
    }
    if (filter.sort === 'postTime') {
      parts.push('新帖子');
    }
  }
  if (source === 'yaohuo' && filter.source === 'yaohuo' && filter.category.trim() && filter.category !== '0') {
    parts.push(categoryLabel(categories, 'yaohuo', filter.category));
  }
  return parts.length ? parts.join(' · ') : '默认';
}

function positiveTerms(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .filter((term) => term && !term.startsWith('-'))
    .map((term) => term.toLowerCase());
}

export function filterSearchResponseItems<T extends { categoryId?: string; category?: string; title: string }>(
  items: T[],
  filter: SourceSearchFilter | undefined,
  query = ''
) {
  const titleTerms = positiveTerms(query);
  if (!filter) {
    return items;
  }
  return items.filter((item) => {
    if ('scope' in filter && filter.scope === 'title') {
      const title = item.title.toLowerCase();
      if (!titleTerms.length || !titleTerms.every((term) => title.includes(term))) {
        return false;
      }
    }
    if ('category' in filter && filter.category.trim() && filter.category !== '0') {
      return item.categoryId === filter.category || item.category === filter.category;
    }
    return true;
  });
}
