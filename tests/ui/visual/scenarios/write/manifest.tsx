import { View, useWindowDimensions } from 'react-native';

import { ReplyComposerSheet } from '@/features/topic/components/ReplyComposerSheet';
import { TopicPolls } from '@/features/topic/components/TopicPolls';
import type { TopicActionDecisionFor } from '@/features/topic/actions/topicActionDecision';
import type { ReplyComposerIntent } from '@/features/topic/useTopicSessionController';
import { createTopicStyles } from '@/features/topic/styles';
import type { Source, TopicPoll } from '@/domain/forum/models';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { contentWidthValue } from '@/ui/theme/tokens';
import type { VisualScenarioDefinition } from '../../types';

const noop = () => undefined;
const loadEmptyLinuxDoPollCapabilities = async () => ({ groups: [], canUseStaffResults: false });
const loadEmptyLinuxDoTemplates = async () => [];

type PollState = 'available' | 'readonly' | 'voted';

function createEditIntent(): ReplyComposerIntent {
  return {
    kind: 'edit',
    target: {
      commentId: 208,
      contentMarkdown: '编辑中的确定性 Markdown 草稿。',
      floor: 8,
      topicId: 'visual-linuxdo-topic',
      ticket: { source: 'linuxdo', identityKey: 'linuxdo:visual-user', sessionEpoch: 1 }
    }
  };
}

function createFloorIntent(): ReplyComposerIntent {
  return {
    kind: 'floor',
    target: { author: '示例用户', authorId: 'visual-user', floor: 12 }
  };
}

function createPoll(state: PollState): TopicPoll {
  const options =
    state === 'available'
      ? [
          { id: 'compact', label: '紧凑布局' },
          { id: 'relaxed', label: '宽松布局' }
        ]
      : [
          { id: 'compact', label: '紧凑布局', count: 5, ...(state === 'voted' ? { selected: true } : {}) },
          { id: 'relaxed', label: '宽松布局', count: 2 }
        ];
  return {
    id: 'visual-poll',
    ownerId: '1001',
    title: '选择一个排版方案',
    options,
    ...(state === 'available' ? {} : { participantCount: 7 }),
    ...(state === 'voted' ? { voted: true } : {})
  };
}

function ComposerScenario({
  actionBusy = false,
  intent,
  source
}: {
  actionBusy?: boolean;
  intent: ReplyComposerIntent;
  source: Extract<Source, 'linuxdo' | 'nodeseek' | 'yaohuo'>;
}) {
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const replyContent =
    intent.kind === 'edit'
      ? intent.target.contentMarkdown
      : source === 'yaohuo'
        ? '[b]妖火楼层回复草稿[/b]'
        : '结构化回复草稿。';
  return (
    <ReplyComposerSheet
      actionBusy={actionBusy}
      discourseEmojiUrls={{}}
      intent={intent}
      nodeSeekMemberId={source === 'nodeseek' ? '1001' : undefined}
      pendingNodeSeekPolls={[]}
      replyContent={replyContent}
      replyFace=""
      source={source}
      styles={styles}
      theme={theme}
      topicId={`visual-${source}-topic`}
      visible
      onLoadLinuxDoPollCapabilities={loadEmptyLinuxDoPollCapabilities}
      onLoadLinuxDoTemplates={loadEmptyLinuxDoTemplates}
      onReplyComposerOpenChange={noop}
      onReplyContentChange={noop}
      onReplyFaceChange={noop}
      onReplySnapshot={noop}
      onSubmitReply={noop}
      onUploadReplyImage={noop}
      onUseLinuxDoTemplate={async () => undefined}
    />
  );
}

function PollScenario({ state }: { state: PollState }) {
  const { width } = useWindowDimensions();
  const { settings, styles, theme } = useReaderThemeStyles(createTopicStyles);
  const decisionFor: TopicActionDecisionFor = ({ action }) =>
    action !== 'vote'
      ? { allowed: false, reason: 'object-forbidden' }
      : state === 'readonly'
        ? { allowed: false, reason: 'unsupported' }
        : state === 'voted'
          ? { allowed: false, reason: 'already-complete' }
          : { allowed: true, reason: 'allowed' };
  return (
    <View style={[styles.replyListItem, { width: Math.min(width - 40, contentWidthValue(settings.contentWidth)) }]}>
      <View style={styles.articleBody}>
        <TopicPolls
          embeddedInArticle
          actionBusy={false}
          decisionFor={decisionFor}
          keyPrefix="visual"
          onTogglePollSelection={noop}
          onVotePoll={noop}
          pollSelections={{}}
          polls={[createPoll(state)]}
          source={state === 'readonly' ? 'v2ex' : 'nodeseek'}
          styles={styles}
          theme={theme}
        />
      </View>
    </View>
  );
}

export const writeVisualScenarios: readonly VisualScenarioDefinition[] = [
  {
    capabilityIds: ['WRITE-01', 'WRITE-04', 'WRITE-05', 'WRITE-06'],
    id: 'write.composer.nodeseek.new',
    kind: 'rendered',
    tags: ['write', 'composer', 'nodeseek', 'new', 'structured'],
    title: 'NodeSeek 结构化回复·新回复',
    render: () => <ComposerScenario intent={{ kind: 'new' }} source="nodeseek" />
  },
  {
    capabilityIds: ['WRITE-01', 'WRITE-02', 'WRITE-04', 'WRITE-05'],
    id: 'write.composer.linuxdo.edit',
    kind: 'rendered',
    tags: ['write', 'composer', 'linuxdo', 'edit', 'structured'],
    title: 'linux.do 结构化回复·编辑',
    render: () => <ComposerScenario intent={createEditIntent()} source="linuxdo" />
  },
  {
    capabilityIds: ['WRITE-01', 'WRITE-04'],
    id: 'write.composer.yaohuo.floor',
    kind: 'rendered',
    tags: ['write', 'composer', 'yaohuo', 'floor', 'ubb'],
    title: '妖火纯文本回复·楼层回复',
    render: () => <ComposerScenario intent={createFloorIntent()} source="yaohuo" />
  },
  {
    capabilityIds: ['WRITE-01'],
    id: 'write.composer.yaohuo.pending',
    kind: 'rendered',
    tags: ['write', 'composer', 'yaohuo', 'pending'],
    title: '妖火纯文本回复·提交中',
    render: () => <ComposerScenario actionBusy intent={{ kind: 'new' }} source="yaohuo" />
  },
  {
    capabilityIds: ['WRITE-03'],
    id: 'write.poll.nodeseek.available',
    kind: 'rendered',
    tags: ['write', 'poll', 'nodeseek', 'default'],
    title: 'NodeSeek 投票·可投票',
    render: () => <PollScenario state="available" />
  },
  {
    capabilityIds: ['WRITE-03'],
    id: 'write.poll.nodeseek.voted',
    kind: 'rendered',
    note: '这是提交成功后的权威稳态；提交失败回滚复用 available 场景，不伪造新的失败卡片。',
    tags: ['write', 'poll', 'nodeseek', 'selected', 'success'],
    title: 'NodeSeek 投票·已投票',
    render: () => <PollScenario state="voted" />
  },
  {
    capabilityIds: ['WRITE-03'],
    id: 'write.poll.v2ex.readonly',
    kind: 'rendered',
    tags: ['write', 'poll', 'v2ex', 'read-only'],
    title: 'V2EX 投票信息·只读',
    render: () => <PollScenario state="readonly" />
  },
  {
    capabilityIds: ['WRITE-02'],
    id: 'write.reply.delete-confirmation',
    kind: 'device-only',
    note: '编辑入口由 topic.replies.populated 渲染；删除确认使用原生 Alert，真实编辑/删除是远端写入，只能在逐项授权后做设备验收。',
    tags: ['write', 'reply-actions', 'delete', 'alert', 'device-only'],
    title: '回复编辑与删除确认'
  },
  {
    capabilityIds: ['WRITE-03'],
    id: 'write.interactions.outcome-transition',
    kind: 'non-visual',
    note: '点赞、收藏与投票成功进入既有 selected/voted 稳态；失败回滚回到原 idle/selected 稳态并由 Android Toast 提示，画廊不新增虚假状态面。',
    tags: ['write', 'interaction', 'success', 'rollback', 'non-visual'],
    title: '互动成功与失败回滚'
  },
  {
    capabilityIds: ['WRITE-03'],
    id: 'write.interactions.native-confirmation',
    kind: 'device-only',
    note: '不可逆投票、锁定与相关 Toast/Alert 必须在设备上只取消确认；画廊不触发远端请求。',
    tags: ['write', 'interaction', 'confirmation', 'device-only'],
    title: '互动原生确认与反馈'
  },
  {
    capabilityIds: ['WRITE-04'],
    id: 'write.upload.file-picker',
    kind: 'device-only',
    note: '编辑器中的图片入口可在 rendered 场景检查；文件选择、权限、上传进度与失败恢复依赖 Android 系统面板，且真实上传需单独授权。',
    tags: ['write', 'upload', 'file-picker', 'permission', 'device-only'],
    title: '图片选择与上传系统流程'
  },
  {
    capabilityIds: ['WRITE-01', 'WRITE-05'],
    id: 'write.composer.device-interaction',
    kind: 'device-only',
    note: '键盘避让、安全区、Sheet/全屏切换、WebView 选区焦点、工具栏横滑与返回手势必须在真实 Android 输入法和触摸链路验收。',
    tags: ['write', 'composer', 'keyboard', 'gesture', 'device-only'],
    title: '编辑器键盘与触摸交互'
  },
  {
    capabilityIds: ['WRITE-06'],
    id: 'write.stardust.reader-payment',
    kind: 'device-only',
    note: 'NodeSeek composer 场景承载 Stardust Builder 入口；Reader 卡片硬绑定原站头像/状态读取，付款还需原生确认与远端写授权，因此不在离线画廊挂载。',
    tags: ['write', 'nodeseek', 'stardust', 'payment', 'device-only'],
    title: 'Stardust 阅读卡与付款确认'
  },
  {
    capabilityIds: ['WRITE-01', 'WRITE-02', 'WRITE-03', 'WRITE-04', 'WRITE-05', 'WRITE-06'],
    id: 'write.mutation.session-ownership',
    kind: 'non-visual',
    note: 'credential generation、ticket 失效、幂等与写后 Query 对账没有独立视觉面；用户可见承载面是入口关闭、既有稳态与 Toast。',
    tags: ['write', 'session', 'mutation', 'non-visual'],
    title: '写事务身份与幂等边界'
  }
];
