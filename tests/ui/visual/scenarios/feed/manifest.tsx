import { useMemo } from 'react';

import type { ReadingFilter } from '@/domain/forum/feed';
import type { Category, FeedSource, Source, SourceFeedFilter, Topic } from '@/domain/forum/models';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { topicKey } from '@/domain/reader/readerData';
import { FeedScreen } from '@/features/feed/FeedScreen';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

type FeedScenarioState = 'data' | 'disabled' | 'filtered' | 'loading' | 'pagination' | 'reading-favorite';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;
const sources: readonly Source[] = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];

function createCategories(): Category[] {
  return [
    { source: 'v2ex', id: 'qna', name: '问与答' },
    { source: 'linuxdo', id: 'dev', name: '开发调优', slug: 'dev' },
    { source: 'nodeseek', id: 'daily', name: '日常' },
    { source: 'yaohuo', id: '177', name: '妖火茶馆' }
  ];
}

function topic(source: Source, index: number, categories: Category[]): Topic {
  return {
    author: `示例作者 ${index}`,
    authorLevelLabel: source === 'linuxdo' ? 'LV 2' : undefined,
    category: categories.find((candidate) => candidate.source === source)?.name,
    createdAt: FIXED_TIME,
    excerpt: '固定摘要用于检查聚合列表在不同来源、标签和本机状态下的信息完整性。',
    id: `feed-${source}-${index}`,
    replyCount: 6 + index,
    source,
    tags: index % 2 ? ['Android', '体验'] : ['开发', '讨论', '长标签'],
    title: `${source} 聚合首页主题 ${index}`,
    url: `https://visual.invalid/${source}/feed-${index}`,
    viewCount: 120 + index * 10
  };
}

function FeedScenario({ state }: { state: FeedScenarioState }) {
  const { settings } = useReaderThemeStyles(() => null);
  const categories = useMemo(() => createCategories(), []);
  const feedSource: FeedSource = state === 'filtered' || state === 'pagination' ? 'linuxdo' : 'all';
  const readingFilter: ReadingFilter = state === 'reading-favorite' ? 'favorite' : 'all';
  const items = useMemo(() => {
    if (state === 'loading' || state === 'disabled') return [];
    if (state === 'reading-favorite') return [topic('nodeseek', 5, categories)];
    if (feedSource === 'linuxdo') return [topic('linuxdo', 1, categories), topic('linuxdo', 2, categories)];
    return sources.map((source, index) => topic(source, index + 1, categories));
  }, [categories, feedSource, state]);
  const favoriteRecords =
    state === 'reading-favorite'
      ? Object.fromEntries(items.map((item) => [topicKey(item), { topic: item, savedAt: '2026-07-14T00:00:00.000Z' }]))
      : {};
  const topicStateIndex: TopicListItemStateIndex = {
    favorites: favoriteRecords,
    history:
      state === 'data' && items[0]
        ? { [topicKey(items[0])]: { topic: items[0], savedAt: '2026-07-14T00:00:00.000Z' } }
        : {},
    listDensity: settings.listDensity
  };
  const feedFilter: SourceFeedFilter | undefined = feedSource === 'linuxdo' ? 'hot' : undefined;
  const busy = state === 'loading';
  return (
    <FeedScreen
      busy={busy}
      categories={categories}
      categoryFilter={state === 'filtered' ? 'dev' : ''}
      feedFilter={feedFilter}
      feedHasMore={state === 'pagination'}
      feedItems={items}
      feedOutcomeKind={busy ? undefined : items.length ? 'data' : 'empty'}
      feedPage={1}
      feedSource={feedSource}
      enabledFeedSources={state === 'disabled' ? [] : sources}
      loadMoreFailureSignal={0}
      loadingMore={state === 'pagination'}
      readingFilter={readingFilter}
      refreshing={false}
      topicStateIndex={topicStateIndex}
      onCategoryChange={noop}
      onFeedFilterChange={noop}
      onFeedSourceChange={noop}
      onLoadMore={noop}
      onManageContentSources={noop}
      onOpenTopic={noop}
      onReadingFilterChange={noop}
      onRefresh={noop}
    />
  );
}

function scenario(
  id: string,
  title: string,
  state: FeedScenarioState,
  capabilityIds: readonly string[],
  tags: readonly string[]
): VisualScenarioDefinition {
  return {
    capabilityIds,
    id,
    kind: 'rendered',
    tags: ['feed', ...tags],
    title,
    render: () => <FeedScenario state={state} />
  };
}

export const feedVisualScenarios: readonly VisualScenarioDefinition[] = [
  scenario('feed.aggregate.loading', '首页聚合·加载中', 'loading', ['FEED-01', 'FEED-02'], ['loading']),
  scenario('feed.aggregate.data', '首页聚合·四站完整列表', 'data', ['FEED-01'], ['data', 'topic-card']),
  scenario(
    'feed.sources.disabled',
    '首页·全部内容源已停用',
    'disabled',
    ['FEED-01', 'FEED-02'],
    ['empty', 'disabled-sources']
  ),
  scenario(
    'feed.source.filtered',
    'linux.do·分类与热门排序',
    'filtered',
    ['FEED-02', 'FEED-04'],
    ['source', 'category', 'sort']
  ),
  scenario(
    'feed.reading.favorite',
    '聚合首页·本机收藏筛选',
    'reading-favorite',
    ['FEED-03'],
    ['favorite', 'reading-filter']
  ),
  scenario('feed.pagination.loading', '单站列表·加载下一页', 'pagination', ['FEED-04'], ['pagination', 'loading']),
  {
    capabilityIds: ['FEED-01', 'FEED-02', 'FEED-04'],
    id: 'feed.host-feedback.error-auth',
    kind: 'non-visual',
    note: 'FeedScreen 对 error/auth 不绘制独立错误卡；结果通过既有通知或账号 surface 表达，不能为语料库伪造 Feed UI。',
    tags: ['feed', 'error', 'auth', 'host-feedback'],
    title: '首页错误与鉴权反馈 owner'
  }
];
