import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import type {
  Category,
  DiscourseFeedFilter,
  FeedFilterSource,
  FeedFilterState,
  FeedSource,
  NodeSeekFeedFilter,
  Source,
  SourceFeedFilter,
  V2exFeedFilter
} from '@/domain/forum/models';
import type { ReadingFilter } from '@/feedLogic';

const registeredSources = Object.keys(sourceCatalog) as Source[];

export const feedSourceItems: { value: FeedSource; label: string }[] = [
  { value: 'all', label: '全部' },
  ...registeredSources.map((source) => ({ value: source, label: sourceCatalog[source].label }))
];

export const feedSources: Source[] = [...registeredSources];

export const feedReadingFilterItems = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' },
  { value: 'favorite', label: '收藏' }
];

export const feedDiscourseFilterItems: { value: DiscourseFeedFilter; label: string }[] = [
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '热门' },
  { value: 'new-all', label: '新·所有' },
  { value: 'new-topics', label: '新·话题' },
  { value: 'new-replies', label: '新·回复' }
];

export const feedNodeSeekFilterItems: { value: NodeSeekFeedFilter; label: string }[] = [
  { value: 'postTime', label: '新帖子' },
  { value: 'replyTime', label: '新评论' }
];

export const feedV2exFilterItems: { value: V2exFeedFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '最热' }
];

function defaultFeedFilter(source: FeedFilterSource): SourceFeedFilter {
  switch (sourceCatalog[source].feedFilter) {
    case 'discourse':
      return 'latest';
    case 'nodeseek':
      return 'postTime';
    case 'v2ex':
      return 'all';
  }
}

export const defaultFeedFilters = Object.fromEntries(
  registeredSources
    .filter((source): source is FeedFilterSource => sourceCatalog[source].feedFilter !== 'none')
    .map((source) => [source, defaultFeedFilter(source)])
) as FeedFilterState;

type FeedFilterMenuGroup = {
  title?: string;
  items: { value: SourceFeedFilter; label: string }[];
};

const discourseFilterMenuGroups: FeedFilterMenuGroup[] = [
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
];

function feedFilterGroups(source: FeedFilterSource): FeedFilterMenuGroup[] {
  switch (sourceCatalog[source].feedFilter) {
    case 'discourse':
      return discourseFilterMenuGroups;
    case 'nodeseek':
      return [{ items: feedNodeSeekFilterItems }];
    case 'v2ex':
      return [{ items: feedV2exFilterItems }];
  }
}

export const feedFilterMenuGroups = Object.fromEntries(
  registeredSources
    .filter((source): source is FeedFilterSource => sourceCatalog[source].feedFilter !== 'none')
    .map((source) => [source, feedFilterGroups(source)])
) as Record<FeedFilterSource, FeedFilterMenuGroup[]>;

export function feedFilterMenuGroupsFor(source: FeedSource) {
  return source !== 'all' && sourceCatalog[source].feedFilter !== 'none'
    ? feedFilterMenuGroups[source as FeedFilterSource]
    : [];
}

export function feedFilterItems(source: FeedSource): { value: SourceFeedFilter; label: string }[] {
  if (source === 'all') {
    return [];
  }
  switch (sourceCatalog[source].feedFilter) {
    case 'discourse':
      return feedDiscourseFilterItems;
    case 'nodeseek':
      return feedNodeSeekFilterItems;
    case 'v2ex':
      return feedV2exFilterItems;
    case 'none':
      return [];
  }
}

export function feedFilterLabel(source: FeedSource, value?: SourceFeedFilter) {
  const items = feedFilterItems(source);
  return items.find((item) => item.value === value)?.label || items[0]?.label || '';
}

export function shouldUseFeedFilter(source: FeedSource, category = '') {
  if (source === 'all') {
    return false;
  }
  const filterKind = sourceCatalog[source].feedFilter;
  return filterKind === 'discourse' || ((filterKind === 'nodeseek' || filterKind === 'v2ex') && !category);
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
