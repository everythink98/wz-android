import type { LibraryTab } from '@/domain/forum/feed';
import type { Category, Topic } from '@/domain/forum/models';
import type { Source } from '@/domain/forum/sourceCatalog';
import { createTopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { createEmptyReaderData, type FollowedUserRecord, type TopicRecord } from '@/domain/reader/readerData';
import { LibraryScreen } from '@/features/library/LibraryScreen';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;
const noStyles = () => null;

function createEnabledSources(): readonly Source[] {
  return ['v2ex', 'linuxdo', 'nodeseek', 'yaohuo'];
}

function createCategories(): Category[] {
  return [
    { source: 'v2ex', id: 'qna', name: '问与答' },
    { source: 'linuxdo', id: '4', name: '开发调优', slug: 'dev' },
    { source: 'nodeseek', id: 'tech', name: '技术交流' }
  ];
}

function topic(source: Source, id: string, title: string, categoryId: string, category: string): Topic {
  return {
    source,
    id,
    title,
    excerpt: '用清晰步骤记录范围、状态与证据，便于逐项复核。',
    author: '示例作者',
    categoryId,
    category,
    url: `https://library.visual.invalid/${source}/${id}`,
    createdAt: FIXED_TIME,
    replyCount: Number(id) + 2
  };
}

function createRecords(): TopicRecord[] {
  return [
    {
      topic: topic('v2ex', '1', '如何组织一次完整的代码走查', 'qna', '问与答'),
      savedAt: FIXED_TIME
    },
    {
      topic: topic('linuxdo', '2', '移动端阅读体验的细节检查清单', '4', '开发调优'),
      savedAt: '2026-08-28T08:00:00.000Z'
    },
    {
      topic: topic('nodeseek', '3', '长列表中如何保持信息层级', 'tech', '技术交流'),
      savedAt: '2026-08-27T08:00:00.000Z'
    }
  ];
}

function createFollowedUsers(): FollowedUserRecord[] {
  return [
    {
      user: {
        source: 'v2ex',
        id: 'visual-alice',
        username: 'visual-alice',
        displayName: '林林',
        url: 'https://library.visual.invalid/v2ex/users/visual-alice',
        topics: []
      },
      followedAt: FIXED_TIME
    },
    {
      user: {
        source: 'linuxdo',
        id: 'visual-bob',
        username: 'visual-bob',
        displayName: '陈屿',
        url: 'https://library.visual.invalid/linuxdo/users/visual-bob',
        topics: []
      },
      followedAt: '2026-08-28T08:00:00.000Z'
    }
  ];
}

function LibraryScenario({
  empty = false,
  sources = createEnabledSources(),
  tab
}: {
  empty?: boolean;
  sources?: readonly Source[];
  tab: LibraryTab;
}) {
  const { settings } = useReaderThemeStyles(noStyles);
  const readerData = createEmptyReaderData();
  const topicStateIndex = createTopicListItemStateIndex({
    ...readerData,
    settings: { ...readerData.settings, listDensity: settings.listDensity }
  });
  return (
    <LibraryScreen
      active
      categories={createCategories()}
      enabledSources={sources}
      favoriteRecords={empty ? [] : createRecords()}
      followedUsers={empty ? [] : createFollowedUsers()}
      historyRecords={empty ? [] : createRecords()}
      libraryTab={tab}
      loaded
      topicStateIndex={topicStateIndex}
      onClearHistory={noop}
      onManageContentSources={noop}
      onOpenTopic={noop}
      onOpenUser={noop}
      onRemove={noop}
      onRemoveUser={noop}
      onTabChange={noop}
    />
  );
}

function rendered(
  id: string,
  title: string,
  capabilityIds: readonly string[],
  tab: LibraryTab,
  tags: readonly string[],
  state: 'populated' | 'sources-disabled' = 'populated'
): VisualScenarioDefinition {
  return {
    capabilityIds,
    id,
    kind: 'rendered',
    tags: ['library', tab, ...tags],
    title,
    render: () => (
      <LibraryScenario
        empty={state === 'sources-disabled'}
        sources={state === 'sources-disabled' ? [] : createEnabledSources()}
        tab={tab}
      />
    )
  };
}

export const libraryVisualScenarios: readonly VisualScenarioDefinition[] = [
  rendered('library.favorites.populated', '收藏帖子·多来源', ['LIBRARY-01'], 'favorites', ['populated']),
  rendered('library.users.followed', '关注用户·多来源', ['LIBRARY-02'], 'users', ['populated']),
  rendered('library.history.populated', '历史记录·多来源', ['LIBRARY-03'], 'history', ['populated']),
  rendered(
    'library.sources.disabled',
    '收藏·未启用内容源',
    ['LIBRARY-01', 'LIBRARY-02', 'LIBRARY-03'],
    'favorites',
    ['empty', 'sources-disabled'],
    'sources-disabled'
  )
];
