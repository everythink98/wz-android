import type { SearchSort } from './feed';
import type { Category, Source } from './models';
import { isDiscourseSource, sourceCatalog, type DiscourseSource } from './sourceCatalog';

export type SearchTimeRange = 'all' | 'day' | 'week' | 'month' | 'year';
export type SearchTextScope = 'all' | 'title';
export type SearchKeywordOperator = 'or' | 'and';
export type DiscourseSearchOrder = 'relevance' | 'latest';
export type DiscourseTagMatch = 'any' | 'all';
export type DiscourseVisitedFilter = 'seen' | 'bookmarks' | 'likes' | 'posted' | 'created';
export type DiscourseSearchStatus =
  '' | 'open' | 'closed' | 'public' | 'archived' | 'noreplies' | 'single_user' | 'solved' | 'unsolved';
export type DiscourseDateRelation = 'before' | 'after';
export type NodeSeekSearchSort = 'replyTime' | 'postTime';

export type V2exSearchFilter = {
  source: 'v2ex';
  sort: SearchSort;
  timeRange: SearchTimeRange;
  node: string;
  username: string;
  operator: SearchKeywordOperator;
};

type DiscourseSearchFilterFields = {
  scope: SearchTextScope;
  category: string;
  tags: string[];
  tagMatch: DiscourseTagMatch;
  username: string;
  visited: DiscourseVisitedFilter[];
  timeRange: SearchTimeRange;
  dateRelation: DiscourseDateRelation;
  date: string;
  minPosts: number | null;
  maxPosts: number | null;
  minViews: number | null;
  maxViews: number | null;
  order: DiscourseSearchOrder;
};

interface DiscourseSearchExtensionMap {
  linuxdo: {
    expertResponse: boolean;
  };
}

type DiscourseSearchExtension<Site extends DiscourseSource> = Site extends keyof DiscourseSearchExtensionMap
  ? { siteExtension: { source: Site } & DiscourseSearchExtensionMap[Site] }
  : { siteExtension?: never };

export type DiscourseSearchFilter<Site extends DiscourseSource = DiscourseSource> = Site extends DiscourseSource
  ? DiscourseSearchFilterFields & {
      source: Site;
      status: DiscourseSearchStatus;
    } & DiscourseSearchExtension<Site>
  : never;

export function isDiscourseSearchFilter(filter: SourceSearchFilter): filter is DiscourseSearchFilter {
  return isDiscourseSource(filter.source);
}

export type NodeSeekSearchFilter = {
  source: 'nodeseek';
  category: string;
  sort: NodeSeekSearchSort;
};

export type YaohuoSearchFilter = {
  source: 'yaohuo';
  category: string;
};

export type SourceSearchFilter = V2exSearchFilter | DiscourseSearchFilter | NodeSeekSearchFilter | YaohuoSearchFilter;

type SearchFilterForSource<Site extends Source> = Site extends DiscourseSource
  ? DiscourseSearchFilter<Site>
  : Site extends 'v2ex'
    ? V2exSearchFilter
    : Site extends 'nodeseek'
      ? NodeSeekSearchFilter
      : Site extends 'yaohuo'
        ? YaohuoSearchFilter
        : never;

export type SearchFilterState = {
  [Site in Source]: SearchFilterForSource<Site>;
};

function defaultSearchFilter(source: Source): SourceSearchFilter {
  if (isDiscourseSource(source)) {
    return {
      source,
      scope: 'all',
      category: '',
      tags: [],
      tagMatch: 'any',
      username: '',
      visited: [],
      status: '',
      timeRange: 'all',
      dateRelation: 'after',
      date: '',
      minPosts: null,
      maxPosts: null,
      minViews: null,
      maxViews: null,
      order: 'relevance',
      ...(source === 'linuxdo' ? { siteExtension: { source: 'linuxdo' as const, expertResponse: false } } : {})
    } as DiscourseSearchFilter;
  }
  if (sourceCatalog[source].searchFilter === 'v2ex') {
    return {
      source: 'v2ex',
      sort: 'relevance',
      timeRange: 'all',
      node: '',
      username: '',
      operator: 'or'
    };
  }
  if (sourceCatalog[source].searchFilter === 'nodeseek') {
    return {
      source: 'nodeseek',
      category: '',
      sort: 'replyTime'
    };
  }
  return {
    source: 'yaohuo',
    category: '0'
  };
}

export const DEFAULT_SEARCH_FILTERS = Object.fromEntries(
  (Object.keys(sourceCatalog) as Source[]).map((source) => [source, defaultSearchFilter(source)])
) as SearchFilterState;

export const searchTimeRangeItems: { value: SearchTimeRange; label: string }[] = [
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
  const filter = DEFAULT_SEARCH_FILTERS[source];
  return (
    isDiscourseSearchFilter(filter)
      ? { ...filter, tags: [...filter.tags], visited: [...filter.visited] }
      : { ...filter }
  ) as SearchFilterState[T];
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

function discourseCategoryToken(categories: Category[], source: DiscourseSource, id: string) {
  const category = categoryForFilter(categories, source, id);
  return (category?.id || id).trim();
}

function cleanDiscourseTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim().replace(/^#+/, '')).filter(Boolean))];
}

function validSearchDate(value: string) {
  const clean = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return false;
  }
  const date = new Date(`${clean}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === clean;
}

function validRangeValue(value: number | null) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function discourseSearchFilterError(filter: DiscourseSearchFilter) {
  if (filter.date.trim() && !validSearchDate(filter.date)) {
    return '请选择有效日期';
  }
  const ranges = [filter.minPosts, filter.maxPosts, filter.minViews, filter.maxViews];
  if (ranges.some((value) => value !== null && validRangeValue(value) === null)) {
    return '帖子数和浏览量必须是非负整数';
  }
  if (filter.minPosts !== null && filter.maxPosts !== null && filter.minPosts > filter.maxPosts) {
    return '帖子数最小值不能大于最大值';
  }
  if (filter.minViews !== null && filter.maxViews !== null && filter.minViews > filter.maxViews) {
    return '浏览量最小值不能大于最大值';
  }
  return '';
}

export function buildDiscourseSearchQuery(query: string, filter: DiscourseSearchFilter, categories: Category[]) {
  const parts = [query.trim()];
  if (filter.scope === 'title') {
    parts.push('in:title');
  }
  const category = discourseCategoryToken(categories, filter.source, filter.category);
  if (category) {
    parts.push(`category:${category}`);
  }
  const tags = cleanDiscourseTags(filter.tags);
  if (tags.length) {
    parts.push(`tags:${tags.join(filter.tagMatch === 'all' ? '+' : ',')}`);
  }
  for (const visited of filter.visited) {
    parts.push(`in:${visited}`);
  }
  if (filter.status) {
    parts.push(`status:${filter.status}`);
  }
  const username = filter.username.trim().replace(/^@+/, '');
  if (username) {
    parts.push(`@${username}`);
  }
  const date = filter.date.trim();
  if (validSearchDate(date)) {
    parts.push(`${filter.dateRelation}:${date}`);
  } else {
    const after = searchTimeRangeStartDate(filter.timeRange);
    if (after) {
      parts.push(`after:${after}`);
    }
  }
  const ranges = [
    ['min_posts', validRangeValue(filter.minPosts)],
    ['max_posts', validRangeValue(filter.maxPosts)],
    ['min_views', validRangeValue(filter.minViews)],
    ['max_views', validRangeValue(filter.maxViews)]
  ] as const;
  for (const [name, value] of ranges) {
    if (value !== null) {
      parts.push(`${name}:${value}`);
    }
  }
  if (filter.siteExtension?.source === 'linuxdo' && filter.siteExtension.expertResponse) {
    parts.push('with:category_expert_response');
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
  if (isDiscourseSearchFilter(filter) && filter.source === source) {
    if (filter.scope === 'title') {
      parts.push('标题');
    }
    if (filter.category.trim()) {
      parts.push(categoryLabel(categories, source, filter.category));
    }
    const tags = cleanDiscourseTags(filter.tags);
    if (tags.length) {
      parts.push(tags.join(filter.tagMatch === 'all' ? ' + ' : '、'));
    }
    if (filter.visited.length) {
      parts.push(`${filter.visited.length}项回访`);
    }
    if (filter.status) {
      parts.push(`状态 ${filter.status}`);
    }
    if (filter.username.trim()) {
      parts.push(filter.username.trim().replace(/^@+/, ''));
    }
    if (validSearchDate(filter.date)) {
      parts.push(`${filter.date}${filter.dateRelation === 'before' ? '前' : '后'}`);
    } else if (filter.timeRange !== 'all') {
      parts.push(searchTimeRangeLabel(filter.timeRange));
    }
    const minPosts = validRangeValue(filter.minPosts);
    const maxPosts = validRangeValue(filter.maxPosts);
    if (minPosts !== null || maxPosts !== null) {
      parts.push(`帖子 ${minPosts ?? 0}–${maxPosts ?? '∞'}`);
    }
    const minViews = validRangeValue(filter.minViews);
    const maxViews = validRangeValue(filter.maxViews);
    if (minViews !== null || maxViews !== null) {
      parts.push(`浏览 ${minViews ?? 0}–${maxViews ?? '∞'}`);
    }
    if (filter.siteExtension?.source === 'linuxdo' && filter.siteExtension.expertResponse) {
      parts.push('专家回应');
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
    if ('category' in filter && !isDiscourseSearchFilter(filter) && filter.category.trim() && filter.category !== '0') {
      return item.categoryId === filter.category || item.category === filter.category;
    }
    return true;
  });
}
