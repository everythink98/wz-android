import type { Category, FeedSource, LinuxDoFeedFilter, Source } from './types';
import type { ReadingFilter } from './feedLogic';

export const feedSourceItems: Array<{ value: FeedSource; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'v2ex', label: 'V2EX' },
  { value: 'linuxdo', label: 'linux.do' },
  { value: 'nodeseek', label: 'NodeSeek' },
  { value: 'yaohuo', label: '妖火' }
];

export const feedSources: Source[] = feedSourceItems
  .filter((item) => item.value !== 'all')
  .map((item) => item.value as Source);

export const feedReadingFilterItems = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' },
  { value: 'favorite', label: '收藏' }
];

export const defaultLinuxDoFeedFilter: LinuxDoFeedFilter = 'latest';

export const feedLinuxDoFilterItems: Array<{ value: LinuxDoFeedFilter; label: string }> = [
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '热门' },
  { value: 'new-all', label: '新·所有' },
  { value: 'new-topics', label: '新·话题' },
  { value: 'new-replies', label: '新·回复' }
];

export function linuxDoFeedFilterLabel(value: LinuxDoFeedFilter) {
  return feedLinuxDoFilterItems.find((item) => item.value === value)?.label || feedLinuxDoFilterItems[0].label;
}

export function shouldUseReadingFilter(source: FeedSource) {
  return source === 'all';
}

export function shouldAllowFeedRemotePagination(source: FeedSource, readingFilter: ReadingFilter) {
  return source !== 'all' || readingFilter === 'all';
}

export function shouldLoadCategoriesForSource(categories: Category[], source: FeedSource) {
  return source !== 'all' && !categories.some((category) => category.source === source);
}

export function feedCategoryItems(categories: Category[], source: FeedSource) {
  if (source === 'all') {
    return [];
  }
  return [
    { value: '', label: '全部' },
    ...categories
      .filter((category) => category.source === source)
      .map((category) => ({ value: category.id, label: category.name }))
  ];
}
