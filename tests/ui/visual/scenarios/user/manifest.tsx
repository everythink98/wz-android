import type { SourceErrorInfo, Topic, UserProfile, UserReference } from '@/domain/forum/models';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { UserScreen } from '@/features/user/UserScreen';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { AppButton } from '@/ui/controls/ButtonControls';
import type { VisualScenarioDefinition } from '../../types';

type UserScenarioState =
  | 'auth-error'
  | 'empty'
  | 'empty-refreshing'
  | 'followed'
  | 'loading'
  | 'loading-more'
  | 'long-profile'
  | 'profile'
  | 'refreshing'
  | 'refresh-error'
  | 'refresh-cycle';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;

function userTopic(index: number, source: UserProfile['source']): Topic {
  return {
    author: '示例用户',
    category: '开发调优',
    createdAt: FIXED_TIME,
    excerpt: '用户主页中的固定主题摘要。',
    id: `user-topic-${index}`,
    replyCount: index * 4,
    source,
    tags: ['Android', '体验'],
    title: `用户发布的主题 ${index}`,
    url: `https://visual.invalid/linuxdo/user-topic-${index}`
  };
}

function profile(empty: boolean, source: UserProfile['source']): UserProfile {
  return {
    bio: '固定简介用于检查长文本、统计信息和活动列表之间的视觉层级。',
    displayName: '示例用户 Alice',
    hasMoreReplies: !empty,
    hasMoreTopics: !empty,
    id: 'visual-user-7',
    joinedAt: FIXED_TIME,
    levelLabel: 'LV 3',
    postCount: empty ? 0 : 42,
    replies: empty
      ? []
      : [
          {
            author: '示例用户 Alice',
            createdAt: FIXED_TIME,
            excerpt: '固定回复摘要，用于检查回复活动卡片。',
            floor: 8,
            id: 'user-reply-1',
            source,
            topicId: 'reply-topic-1',
            topicTitle: '回复所在主题',
            topicUrl: 'https://visual.invalid/linuxdo/reply-topic-1',
            url: 'https://visual.invalid/linuxdo/reply-topic-1/8'
          }
        ],
    replyCount: empty ? 0 : 12,
    source,
    topicCount: empty ? 0 : 3,
    topics: empty ? [] : Array.from({ length: 8 }, (_, index) => userTopic(index + 1, source)),
    url: 'https://visual.invalid/linuxdo/users/visual-user-7',
    username: 'visual-user'
  };
}

function UserScenario({ state, source }: { state: UserScenarioState; source: UserProfile['source'] }) {
  const { settings } = useReaderThemeStyles(() => null);
  const [refreshing, setRefreshing] = useState(false);
  const unresolvedUser: UserReference = {
    displayName: '待解析用户',
    source: 'nodeseek',
    url: 'https://visual.invalid/nodeseek/member/visual-user',
    username: 'visual-user'
  };
  const loadedProfile = profile(state === 'empty' || state === 'empty-refreshing', source);
  if (state === 'long-profile') {
    loadedProfile.displayName = '喜欢折腾与记录生活的社区用户 Alice';
    loadedProfile.bio =
      '记录开发、阅读和日常观察，也分享在不同社区看到的有趣讨论。希望把复杂的问题讲清楚，把细小的体验做好。这段简介包含更多内容，用于检查折叠、展开与大字体排版。';
    loadedProfile.topicCount = 123456;
    loadedProfile.replyCount = 987654;
    loadedProfile.postCount = 1234567;
  }
  const error: SourceErrorInfo | null =
    state === 'auth-error'
      ? { kind: 'login-expired', message: 'linux.do 登录已失效，请重新登录。', retryable: true }
      : state === 'refresh-error'
        ? { kind: 'ordinary', message: '暂时无法刷新，请稍后重试。', retryable: true }
        : null;
  const requestedUser: UserReference = state === 'loading' ? unresolvedUser : loadedProfile;
  const topicStateIndex: TopicListItemStateIndex = {
    favorites: {},
    history: {},
    listDensity: settings.listDensity
  };
  return (
    <View style={{ flex: 1 }}>
      <UserScreen
        busy={state === 'loading' || state === 'refreshing' || state === 'empty-refreshing' || refreshing}
        error={error}
        followed={state === 'followed'}
        loadingMoreReplies={false}
        loadingMoreTopics={state === 'loading-more'}
        profile={state === 'loading' || state === 'auth-error' ? null : loadedProfile}
        requestedUser={requestedUser}
        topicStateIndex={topicStateIndex}
        onBack={noop}
        onLoadMoreReplies={noop}
        onLoadMoreTopics={noop}
        onOpenOriginal={noop}
        onOpenTopic={noop}
        onRefresh={state === 'refresh-cycle' ? () => setRefreshing(true) : noop}
        onToggleFollow={noop}
      />
      {state === 'refresh-cycle' ? (
        <AppButton label="结束模拟刷新" disabled={!refreshing} onPress={() => setRefreshing(false)} />
      ) : null}
    </View>
  );
}

function scenario(
  id: string,
  title: string,
  state: UserScenarioState,
  capabilityIds: readonly string[],
  tags: readonly string[],
  source: UserProfile['source'] = 'linuxdo'
): VisualScenarioDefinition {
  return {
    capabilityIds,
    id,
    kind: 'rendered',
    tags: ['user', ...tags],
    title,
    render: () => <UserScenario state={state} source={source} />
  };
}

export const userVisualScenarios: readonly VisualScenarioDefinition[] = [
  scenario('user.nodeseek.resolving', 'NodeSeek 用户·身份解析中', 'loading', ['USER-01'], ['loading']),
  scenario('user.profile.data', '用户主页·资料与主题回复', 'profile', ['USER-01'], ['data', 'activities']),
  scenario('user.profile.nodeseek', 'NodeSeek 用户·统计去重', 'profile', ['USER-01'], ['data', 'nodeseek'], 'nodeseek'),
  scenario('user.profile.v2ex', 'V2EX 用户·统计去重', 'profile', ['USER-01'], ['data', 'v2ex'], 'v2ex'),
  scenario('user.profile.yaohuo', '妖火用户·资料与活动', 'profile', ['USER-01'], ['data', 'yaohuo'], 'yaohuo'),
  scenario('user.profile.long', '用户主页·长名字简介与大数字', 'long-profile', ['USER-01'], ['long-text', 'overflow']),
  scenario('user.profile.refreshing', '用户主页·保留内容刷新', 'refreshing', ['USER-01'], ['refresh', 'loading']),
  scenario(
    'user.profile.refresh-cycle',
    '用户主页·刷新前中后切换',
    'refresh-cycle',
    ['USER-01'],
    ['refresh', 'interaction']
  ),
  scenario(
    'user.profile.refresh-error',
    '用户主页·刷新失败保留内容',
    'refresh-error',
    ['USER-01'],
    ['refresh', 'error']
  ),
  scenario('user.profile.loading-more', '用户主页·分页加载中', 'loading-more', ['USER-01'], ['pagination', 'loading']),
  scenario('user.profile.empty', '用户主页·活动为空', 'empty', ['USER-01'], ['empty']),
  scenario(
    'user.profile.empty-refreshing',
    '用户主页·空列表刷新',
    'empty-refreshing',
    ['USER-01'],
    ['empty', 'refresh']
  ),
  scenario('user.profile.auth-error', '用户主页·登录失效', 'auth-error', ['USER-01'], ['auth', 'error']),
  scenario('user.follow.selected', '用户主页·已关注', 'followed', ['USER-02'], ['follow', 'selected']),
  {
    capabilityIds: ['USER-02'],
    id: 'user.navigation.state-retention',
    kind: 'device-only',
    note: 'User A → User B → A、User → Topic → 返回以及滚动位置保留必须由真实 native route 实例验证。',
    tags: ['user', 'navigation', 'state-retention'],
    title: '用户页嵌套导航状态保留'
  }
];
import { useState } from 'react';
import { View } from 'react-native';
