import type { Category, FeedSource, Source } from './types';

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
  { value: 'favorite', label: '收藏' },
  { value: 'subscribed', label: '我的订阅' },
  { value: 'active', label: '最近活跃' },
  { value: 'hot', label: '热门' }
];

export function shouldUseReadingFilter(source: FeedSource) {
  return source === 'all';
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
