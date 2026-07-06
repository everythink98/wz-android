import type { Category, FeedFilterSource, FeedFilterState, FeedSource, LinuxDoFeedFilter, NodeSeekFeedFilter, Source, SourceFeedFilter, V2exFeedFilter } from './types';
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
export const defaultNodeSeekFeedFilter: NodeSeekFeedFilter = 'postTime';
export const defaultV2exFeedFilter: V2exFeedFilter = 'all';
export const defaultFeedFilters: FeedFilterState = {
  linuxdo: defaultLinuxDoFeedFilter,
  nodeseek: defaultNodeSeekFeedFilter,
  v2ex: defaultV2exFeedFilter
};

export const feedLinuxDoFilterItems: Array<{ value: LinuxDoFeedFilter; label: string }> = [
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '热门' },
  { value: 'new-all', label: '新·所有' },
  { value: 'new-topics', label: '新·话题' },
  { value: 'new-replies', label: '新·回复' }
];

export const feedNodeSeekFilterItems: Array<{ value: NodeSeekFeedFilter; label: string }> = [
  { value: 'postTime', label: '新帖子' },
  { value: 'replyTime', label: '新评论' }
];

export const feedV2exFilterItems: Array<{ value: V2exFeedFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '最热' }
];

export const feedFilterMenuGroups: Record<FeedFilterSource, Array<{ title?: string; items: Array<{ value: SourceFeedFilter; label: string }> }>> = {
  linuxdo: [
    {
      items: [
        { value: 'latest', label: '最新' },
        { value: 'hot', label: '热门' }
      ]
    },
    {
      title: '新',
      items: [
        { value: 'new-all', label: '所有' },
        { value: 'new-topics', label: '话题' },
        { value: 'new-replies', label: '回复' }
      ]
    }
  ],
  nodeseek: [{ items: feedNodeSeekFilterItems }],
  v2ex: [{ items: feedV2exFilterItems }]
};

export function feedFilterItems(source: FeedSource): Array<{ value: SourceFeedFilter; label: string }> {
  if (source === 'linuxdo') {
    return feedLinuxDoFilterItems;
  }
  if (source === 'nodeseek') {
    return feedNodeSeekFilterItems;
  }
  if (source === 'v2ex') {
    return feedV2exFilterItems;
  }
  return [];
}

export function feedFilterLabel(source: FeedSource, value?: SourceFeedFilter) {
  const items = feedFilterItems(source);
  return items.find((item) => item.value === value)?.label || items[0]?.label || '';
}

export function shouldUseFeedFilter(source: FeedSource, category = '') {
  return source === 'linuxdo' || ((source === 'nodeseek' || source === 'v2ex') && !category);
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
