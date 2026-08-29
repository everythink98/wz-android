import type { SourceErrorInfo, Topic, UserProfile, UserReference } from '@/domain/forum/models';
import type { TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { UserScreen } from '@/features/user/UserScreen';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import type { VisualScenarioDefinition } from '../../types';

type UserScenarioState = 'auth-error' | 'empty' | 'followed' | 'loading' | 'profile';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;

function userTopic(index: number): Topic {
  return {
    author: '示例用户',
    category: '开发调优',
    createdAt: FIXED_TIME,
    excerpt: '用户主页中的固定主题摘要。',
    id: `user-topic-${index}`,
    replyCount: index * 4,
    source: 'linuxdo',
    tags: ['Android', '体验'],
    title: `用户发布的主题 ${index}`,
    url: `https://visual.invalid/linuxdo/user-topic-${index}`
  };
}

function profile(empty = false): UserProfile {
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
            source: 'linuxdo',
            topicId: 'reply-topic-1',
            topicTitle: '回复所在主题',
            topicUrl: 'https://visual.invalid/linuxdo/reply-topic-1',
            url: 'https://visual.invalid/linuxdo/reply-topic-1/8'
          }
        ],
    replyCount: empty ? 0 : 12,
    source: 'linuxdo',
    topicCount: empty ? 0 : 3,
    topics: empty ? [] : [userTopic(1), userTopic(2)],
    url: 'https://visual.invalid/linuxdo/users/visual-user-7',
    username: 'visual-user'
  };
}

function UserScenario({ state }: { state: UserScenarioState }) {
  const { settings } = useReaderThemeStyles(() => null);
  const unresolvedUser: UserReference = {
    displayName: '待解析用户',
    source: 'nodeseek',
    url: 'https://visual.invalid/nodeseek/member/visual-user',
    username: 'visual-user'
  };
  const loadedProfile = state === 'empty' ? profile(true) : profile();
  const error: SourceErrorInfo | null =
    state === 'auth-error'
      ? { kind: 'login-expired', message: 'linux.do 登录已失效，请重新登录。', retryable: true }
      : null;
  const requestedUser: UserReference = state === 'loading' ? unresolvedUser : loadedProfile;
  const topicStateIndex: TopicListItemStateIndex = {
    favorites: new Set(),
    history: new Set(),
    listDensity: settings.listDensity
  };
  return (
    <UserScreen
      busy={state === 'loading'}
      error={error}
      followed={state === 'followed'}
      loadingMoreReplies={false}
      loadingMoreTopics={false}
      profile={state === 'loading' || state === 'auth-error' ? null : loadedProfile}
      requestedUser={requestedUser}
      topicStateIndex={topicStateIndex}
      onBack={noop}
      onLoadMoreReplies={noop}
      onLoadMoreTopics={noop}
      onOpenOriginal={noop}
      onOpenTopic={noop}
      onRefresh={noop}
      onToggleFollow={noop}
    />
  );
}

function scenario(
  id: string,
  title: string,
  state: UserScenarioState,
  capabilityIds: readonly string[],
  tags: readonly string[]
): VisualScenarioDefinition {
  return {
    capabilityIds,
    id,
    kind: 'rendered',
    tags: ['user', ...tags],
    title,
    render: () => <UserScenario state={state} />
  };
}

export const userVisualScenarios: readonly VisualScenarioDefinition[] = [
  scenario('user.nodeseek.resolving', 'NodeSeek 用户·身份解析中', 'loading', ['USER-01'], ['loading']),
  scenario('user.profile.data', '用户主页·资料与主题回复', 'profile', ['USER-01'], ['data', 'activities']),
  scenario('user.profile.empty', '用户主页·活动为空', 'empty', ['USER-01'], ['empty']),
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
