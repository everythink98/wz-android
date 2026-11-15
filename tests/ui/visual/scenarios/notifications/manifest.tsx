import { projectTestAccountSessions } from '../../../../helpers/accountSessions';
import { useMemo, useState } from 'react';

import type { ForumNotification, NotificationDetail } from '@/domain/notifications/models';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import {
  NotificationDetailScreen,
  NotificationSettingsScreen,
  NotificationsScreen
} from '@/features/notifications/NotificationScreens';
import { defaultNotificationState, type NotificationState } from '@/platform/notifications/notificationStore';
import type { VisualScenarioDefinition } from '../../types';

type NotificationListState = 'auth-unknown' | 'data' | 'loading' | 'partial';
type NotificationDetailState = 'conversation' | 'data' | 'error' | 'loading';
type NotificationSettingsState = 'default' | 'denied';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;

function notification(
  source: ForumNotification['source'],
  id: string,
  kind: ForumNotification['kind'],
  unread: boolean
): ForumNotification {
  return {
    actor: { name: source === 'nodeseek' ? '示例用户甲' : source === 'linuxdo' ? '示例用户乙' : '示例用户丙' },
    createdAt: FIXED_TIME,
    id,
    kind,
    preview: '这段回复还有一点补充：先看上下文，再决定是否需要回复。较长摘要会单独换行，保留标题的阅读空间。',
    source,
    target:
      kind === 'private-message'
        ? { conversationId: `conversation-${id}`, type: 'private-conversation' }
        : { topicId: `topic-${id}`, type: 'topic', url: `https://visual.invalid/${source}/topic-${id}` },
    title: kind === 'private-message' ? '关于上次讨论的私信' : `${source} · 关于社区阅读体验的一些想法与建议`,
    unread
  };
}

function NotificationListScenario({ state }: { state: NotificationListState }) {
  const items =
    state === 'data' || state === 'partial'
      ? [
          notification('nodeseek', 'reply-1', 'reply', true),
          notification('linuxdo', 'reaction-1', 'reaction', false),
          notification('yaohuo', 'private-1', 'private-message', true)
        ]
      : [];
  const unknown = state === 'auth-unknown';
  return (
    <NotificationsScreen
      activeSources={unknown ? [] : ['nodeseek', 'linuxdo', 'yaohuo']}
      errors={state === 'partial' ? { linuxdo: { kind: 'ordinary', message: '本次读取失败，可单独重试。' } } : {}}
      enabledSources={['nodeseek', 'linuxdo', 'yaohuo']}
      fetchingMore={false}
      hasMore={false}
      items={items}
      loading={state === 'loading'}
      markAllBusy={false}
      refreshing={false}
      source={unknown ? 'nodeseek' : 'all'}
      sourcePending={false}
      sourceUnknown={unknown}
      unreadOnly={false}
      onChangeSource={noop}
      onChangeUnreadOnly={noop}
      onItemPress={noop}
      onLoadMore={noop}
      onMarkAll={noop}
      onRefresh={noop}
      onRetryAccountStatus={noop}
      onLoginSource={noop}
      onRetrySource={noop}
    />
  );
}

function detail(state: Exclude<NotificationDetailState, 'error' | 'loading'>): NotificationDetail {
  const item = notification(
    'nodeseek',
    state === 'conversation' ? 'private-detail' : 'reply-detail',
    state === 'conversation' ? 'private-message' : 'reply',
    false
  );
  if (state === 'conversation') {
    return {
      contentText: '会话开始前的原消息。',
      historyNotice: '80 条本地合成消息，草稿仅保留在本场景，不读取或发送站内消息。',
      messages: Array.from({ length: 80 }, (_, index) => ({
        author: index % 2 === 0 ? '示例用户甲' : '我',
        contentText: `本地会话消息 ${index + 1}：保留上下文，检查草稿编辑与返回。`,
        createdAt: new Date(Date.parse(FIXED_TIME) + index * 60_000).toISOString(),
        id: `message-${index + 1}`,
        mine: index % 2 !== 0
      })),
      notification: item,
      reply: { format: 'markdown' },
      title: '示例私信会话'
    };
  }
  return {
    contentHtml:
      '<h2>社区准则更新</h2><p>请阅读本次变更后确认。</p><ul><li>保留清晰的讨论上下文。</li><li>确认操作与通知已读独立。</li></ul><blockquote><p>阅读完整内容后，使用下方按钮确认。</p></blockquote>',
    notification: { ...item, source: 'linuxdo', kind: 'system' },
    title: '社区准则更新公告',
    policy: {
      postId: '77',
      version: '1',
      acceptLabel: '我已知晓此更新内容',
      revokeLabel: '等我再仔细阅读一番',
      accepted: false,
      revoked: false,
      canAccept: true,
      canRevoke: false
    },
    topic: {
      author: '示例作者',
      createdAt: FIXED_TIME,
      id: 'notification-topic',
      source: 'linuxdo',
      title: '通知关联主题',
      url: 'https://visual.invalid/nodeseek/notification-topic'
    }
  };
}

function NotificationDetailScenario({ state }: { state: NotificationDetailState }) {
  const loadedDetail = useMemo(
    () => (state === 'data' || state === 'conversation' ? detail(state) : undefined),
    [state]
  );
  const [replyContent, setReplyContent] = useState('我看过了，补充一个想法');
  const [replyVisible, setReplyVisible] = useState(false);
  return (
    <NotificationDetailScreen
      canOpenTopic={state === 'data' || state === 'error'}
      contentWidth={350}
      detail={loadedDetail}
      error={state === 'error' ? '详情暂时无法读取，仍可前往完整主题。' : undefined}
      loading={state === 'loading'}
      replyContent={state === 'conversation' ? replyContent : ''}
      replyVisible={state === 'conversation' && replyVisible}
      actorUser={
        state === 'conversation'
          ? { source: 'nodeseek', id: '9', displayName: '示例用户甲', url: 'https://visual.invalid/nodeseek/space/9' }
          : undefined
      }
      onOpenActor={noop}
      onSetPolicyAcceptance={noop}
      onOpenExternalUrl={noop}
      onOpenTopic={noop}
      onOpenReply={() => setReplyVisible(true)}
      onReplyClose={() => setReplyVisible(false)}
      onReplyContentChange={setReplyContent}
      onSubmitReply={noop}
      onUploadReplyImage={noop}
      onRetry={noop}
    />
  );
}

function notificationState(enabled: boolean): NotificationState {
  const state = defaultNotificationState();
  return {
    ...state,
    globalEnabled: enabled,
    hasOptedIn: enabled,
    sources: {
      linuxdo: { ...state.sources.linuxdo, intentEnabled: enabled },
      nodeseek: { ...state.sources.nodeseek, intentEnabled: enabled },
      yaohuo: { ...state.sources.yaohuo, intentEnabled: false }
    }
  };
}

function NotificationSettingsScenario({ state }: { state: NotificationSettingsState }) {
  const enabled = state === 'denied';
  return (
    <NotificationSettingsScreen
      backgroundEnabled={false}
      backgroundError={enabled ? 'Android 当前未安排后台任务。' : ''}
      busy={false}
      enabledSources={['linuxdo', 'nodeseek', 'yaohuo']}
      permission={enabled ? 'denied' : 'granted'}
      sessions={projectTestAccountSessions(createSiteSessionStates())}
      state={notificationState(enabled)}
      onOpenSystemSettings={noop}
      onToggleGlobal={noop}
      onToggleSource={noop}
    />
  );
}

function listScenario(id: string, title: string, state: NotificationListState, tags: readonly string[]) {
  return {
    capabilityIds: ['NOTIFY-01'],
    id,
    kind: 'rendered' as const,
    tags: ['notifications', 'list', ...tags],
    title,
    render: () => <NotificationListScenario state={state} />
  };
}

function detailScenario(id: string, title: string, state: NotificationDetailState, tags: readonly string[]) {
  return {
    capabilityIds: ['NOTIFY-02'],
    id,
    kind: 'rendered' as const,
    tags: ['notifications', 'detail', ...tags],
    title,
    render: () => <NotificationDetailScenario state={state} />
  };
}

export const notificationVisualScenarios: readonly VisualScenarioDefinition[] = [
  listScenario('notifications.list.loading', '消息列表·加载中', 'loading', ['loading']),
  listScenario('notifications.list.data', '消息列表·三站已读与未读', 'data', ['data', 'unread']),
  listScenario('notifications.list.partial', '消息列表·局部来源失败', 'partial', ['partial', 'error']),
  listScenario('notifications.list.auth-unknown', '消息列表·账号状态未知', 'auth-unknown', ['auth', 'unknown']),
  detailScenario('notifications.detail.loading', '消息详情·加载中', 'loading', ['loading']),
  detailScenario('notifications.detail.data', '消息详情·正文与主题操作', 'data', ['data', 'topic-action']),
  detailScenario('notifications.detail.conversation', '私信详情·双方会话气泡', 'conversation', [
    'conversation',
    'messages'
  ]),
  detailScenario('notifications.detail.error', '消息详情·失败与主题逃生口', 'error', ['error', 'fallback']),
  {
    capabilityIds: ['NOTIFY-03'],
    id: 'notifications.settings.default',
    kind: 'rendered',
    tags: ['notifications', 'settings', 'default'],
    title: 'Android 消息设置·默认关闭',
    render: () => <NotificationSettingsScenario state="default" />
  },
  {
    capabilityIds: ['NOTIFY-03'],
    id: 'notifications.settings.permission-denied',
    kind: 'rendered',
    tags: ['notifications', 'settings', 'permission', 'error'],
    title: 'Android 消息设置·权限拒绝',
    render: () => <NotificationSettingsScenario state="denied" />
  },
  {
    capabilityIds: ['NOTIFY-02'],
    id: 'notifications.detail.write-interactions',
    kind: 'device-only',
    note: '自动已读、回复器 safe-area、键盘、上传与发送属于真实 route/设备交互；语料库不得挂载会自动 markRead 的 Route。',
    tags: ['notifications', 'detail', 'composer', 'write'],
    title: '消息详情写入交互边界'
  },
  {
    capabilityIds: ['NOTIFY-03'],
    id: 'notifications.system.delivery',
    kind: 'device-only',
    note: '系统权限弹窗、通知栏、锁屏隐私、冷/热点击与 WorkManager 调度只能在隔离 Android 设备验证。',
    tags: ['notifications', 'android', 'permission', 'worker'],
    title: 'Android 系统通知投递'
  }
];
