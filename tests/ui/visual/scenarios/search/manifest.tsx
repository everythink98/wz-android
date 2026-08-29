import { View } from 'react-native';

import type { Category, Source, Topic } from '@/domain/forum/models';
import { DEFAULT_SEARCH_FILTERS, searchFilterSummary, type SearchFilterState } from '@/domain/forum/searchFilters';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { SearchFilterSheet } from '@/features/search/SearchFilterSheet';
import type { SearchGroup } from '@/features/search/listItems';
import { SearchScreen } from '@/features/search/SearchScreen';
import { createSearchStyles } from '@/features/search/styles';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

type SearchScenarioState = 'aggregate' | 'auth' | 'empty' | 'external' | 'idle' | 'pagination-error' | 'partial';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;
const emptyCandidates = async () => [];
const sources: readonly Source[] = ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];

function topic(source: Source, index: number): Topic {
  return {
    author: `搜索作者 ${index}`,
    category: source === 'v2ex' ? '问与答' : '开发交流',
    createdAt: FIXED_TIME,
    excerpt: '固定搜索摘要用于观察关键词高亮、分站标题与结果卡片层级。',
    id: `search-${source}-${index}`,
    replyCount: 3 + index,
    source,
    tags: ['Android', '搜索'],
    title: `${source} Android 搜索结果 ${index}`,
    url: `https://visual.invalid/${source}/search-${index}`,
    viewCount: 80 + index
  };
}

function filters(): SearchFilterState {
  return {
    linuxdo: {
      ...DEFAULT_SEARCH_FILTERS.linuxdo,
      tags: [...DEFAULT_SEARCH_FILTERS.linuxdo.tags],
      visited: [...DEFAULT_SEARCH_FILTERS.linuxdo.visited]
    },
    nodeseek: { ...DEFAULT_SEARCH_FILTERS.nodeseek },
    v2ex: { ...DEFAULT_SEARCH_FILTERS.v2ex },
    yaohuo: { ...DEFAULT_SEARCH_FILTERS.yaohuo }
  };
}

function groups(state: SearchScenarioState): SearchGroup[] {
  if (state === 'idle') return [];
  if (state === 'aggregate') {
    return sources.map((source, index) => ({
      items: [topic(source, index + 1), topic(source, index + 5)],
      label: source,
      settled: true,
      source
    }));
  }
  if (state === 'partial') {
    return [
      { items: [topic('v2ex', 1)], label: 'V2EX', settled: true, source: 'v2ex' },
      {
        error: 'linux.do 本次读取失败，可单独重试。',
        errorKind: 'ordinary',
        items: [],
        label: 'linux.do',
        settled: true,
        source: 'linuxdo'
      }
    ];
  }
  if (state === 'auth') {
    const message = '妖火需要登录后使用原站搜索。';
    return [
      {
        authNotice: { kind: 'login-required', message, tone: 'warning' },
        error: message,
        errorKind: 'login-required',
        items: [],
        label: '妖火',
        settled: true,
        source: 'yaohuo'
      }
    ];
  }
  if (state === 'external') {
    return ['linuxdo', 'nodeseek'].map((source) => ({
      externalSearchUrl: `https://visual.invalid/google/${source}`,
      items: [],
      label: source === 'linuxdo' ? 'linux.do' : 'NodeSeek',
      settled: true,
      source: source as Source
    }));
  }
  if (state === 'pagination-error') {
    return [
      {
        error: '下一页读取失败，请重试。',
        errorKind: 'ordinary',
        hasMore: true,
        items: [topic('v2ex', 1), topic('v2ex', 2)],
        label: 'V2EX',
        nextPage: 2,
        settled: true,
        source: 'v2ex'
      }
    ];
  }
  return [{ items: [], label: 'V2EX', settled: true, source: 'v2ex' }];
}

function SearchScenario({ state }: { state: SearchScenarioState }) {
  const { settings } = useReaderThemeStyles(() => null);
  const query = state === 'idle' ? '' : 'Android';
  const searchSource = state === 'auth' ? 'yaohuo' : state === 'empty' || state === 'pagination-error' ? 'v2ex' : 'all';
  const expectedSearchSources =
    state === 'auth'
      ? (['yaohuo'] as const)
      : state === 'empty' || state === 'pagination-error'
        ? (['v2ex'] as const)
        : state === 'partial'
          ? (['v2ex', 'linuxdo'] as const)
          : state === 'external'
            ? (['linuxdo', 'nodeseek'] as const)
            : sources;
  const topicStateIndex: TopicListItemStateIndex = {
    favorites: new Set(),
    history: new Set(),
    listDensity: settings.listDensity
  };
  return (
    <SearchScreen
      busy={false}
      categories={[]}
      expectedSearchSources={expectedSearchSources}
      externalSearchSources={state === 'external' ? ['linuxdo', 'nodeseek'] : []}
      linuxDoAiState={{ count: 0, enabled: false, status: 'idle' }}
      linuxDoAiVisible={false}
      query={query}
      recentSearches={state === 'idle' ? ['Android 大字号', '深色主题'] : []}
      requestsEnabled={false}
      searchCandidateReadPlanScopes={{ tags: 'visual:tags', users: 'visual:users' }}
      searchFilters={filters()}
      searchGroups={groups(state)}
      searchSource={searchSource}
      sessionEpochs={{ ...initialForumSessionEpochs }}
      submittedQuery={query}
      topicStateIndex={topicStateIndex}
      onLoadMoreSearchSource={noop}
      onManageContentSources={noop}
      onOpenExternalSearch={noop}
      onOpenTopic={noop}
      onQueryChange={noop}
      onRemoveRecentSearch={noop}
      onRetryLinuxDoAiSearch={noop}
      onRetrySearchSource={noop}
      onSearch={noop}
      onSearchDiscourseTags={emptyCandidates}
      onSearchDiscourseUsers={emptyCandidates}
      onSearchFilterApply={noop}
      onSearchSourceChange={noop}
      onToggleLinuxDoAiSearch={noop}
    />
  );
}

function LinuxDoFilterScenario() {
  const { styles, theme } = useReaderThemeStyles(createSearchStyles);
  const categories: Category[] = [{ id: 'dev', name: '开发调优', slug: 'dev', source: 'linuxdo' }];
  const searchFilters = filters();
  searchFilters.linuxdo = {
    ...searchFilters.linuxdo,
    category: 'dev',
    expertResponse: true,
    maxPosts: 50,
    minPosts: 2,
    order: 'latest',
    tags: ['react-native', 'android'],
    username: 'visual-author',
    visited: ['seen', 'bookmarks']
  };
  return (
    <View style={styles.contentInner}>
      <SearchFilterSheet
        categories={categories}
        readPlanScopes={{ tags: 'visual:tags', users: 'visual:users' }}
        requestsEnabled={false}
        searchFilters={searchFilters}
        sessionEpochs={{ ...initialForumSessionEpochs }}
        source="linuxdo"
        styles={styles}
        summary={searchFilterSummary('linuxdo', searchFilters.linuxdo, categories)}
        theme={theme}
        onApply={noop}
        onSearchDiscourseTags={emptyCandidates}
        onSearchDiscourseUsers={emptyCandidates}
      />
    </View>
  );
}

function scenario(
  id: string,
  title: string,
  state: SearchScenarioState,
  capabilityIds: readonly string[],
  tags: readonly string[]
): VisualScenarioDefinition {
  return {
    capabilityIds,
    id,
    kind: 'rendered',
    tags: ['search', ...tags],
    title,
    render: () => <SearchScenario state={state} />
  };
}

export const searchVisualScenarios: readonly VisualScenarioDefinition[] = [
  scenario('search.idle.recent', '搜索·未输入与最近记录', 'idle', ['SEARCH-02'], ['idle', 'history']),
  scenario('search.aggregate.data', '搜索全部·四站预览', 'aggregate', ['SEARCH-01'], ['aggregate', 'data']),
  scenario(
    'search.aggregate.partial',
    '搜索全部·局部来源失败',
    'partial',
    ['SEARCH-01', 'SEARCH-04'],
    ['partial', 'error']
  ),
  scenario('search.source.auth', '妖火搜索·需要登录', 'auth', ['SEARCH-04'], ['auth', 'error']),
  scenario(
    'search.external.actions',
    '公开搜索·Google 外部入口',
    'external',
    ['SEARCH-01', 'SEARCH-02', 'SEARCH-04'],
    ['external', 'public']
  ),
  scenario('search.source.empty', 'V2EX 搜索·空结果', 'empty', ['SEARCH-02', 'SEARCH-04'], ['empty']),
  scenario(
    'search.pagination.error',
    'V2EX 搜索·分页失败重试',
    'pagination-error',
    ['SEARCH-02', 'SEARCH-04'],
    ['pagination', 'error']
  ),
  {
    capabilityIds: ['SEARCH-03'],
    id: 'search.filters.linuxdo.advanced',
    kind: 'rendered',
    tags: ['search', 'filters', 'linuxdo', 'advanced'],
    title: 'linux.do 高级筛选表单',
    render: () => <LinuxDoFilterScenario />
  },
  {
    capabilityIds: ['SEARCH-03', 'SEARCH-04'],
    id: 'search.platform.modal-custom-tab',
    kind: 'device-only',
    note: 'Android 键盘避让、Modal 连续开关、Custom Tab、浏览器 fallback 与 PendingIntent 返回需要设备验证。',
    tags: ['search', 'keyboard', 'modal', 'custom-tab'],
    title: '搜索系统交互边界'
  }
];
