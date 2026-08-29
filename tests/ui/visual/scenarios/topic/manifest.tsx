import { useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';

import type { TopicActionDecisionFor } from '@/features/topic/actions/topicActionDecision';
import type { TopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { TopicMenu } from '@/features/topic/components/TopicMenu';
import type { TopicListItem } from '@/features/topic/model/topicListModel';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { createTopicStyles } from '@/features/topic/styles';
import { TopicScreen } from '@/features/topic/TopicScreen';
import type { useTopicController } from '@/features/topic/useTopicController';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import type { InteractionType } from '@/domain/forum/topicActionState';
import type { Reply, Source, SourceErrorInfo, TopicDetail, TopicPoll } from '@/domain/forum/models';
import { prepareTopicContent } from '@/domain/forum/topicContentSplit';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { contentWidthValue } from '@/ui/theme/tokens';
import type { VisualScenarioDefinition } from '../../types';

type ActionState = 'default' | 'disabled' | 'failure-rollback' | 'pending' | 'selected' | 'success' | 'unknown';
type PendingTarget = InteractionType | 'bookmark';
type TopicScene =
  | 'actions'
  | 'favorite'
  | 'replies-empty'
  | 'replies-loading'
  | 'replies-loading-more'
  | 'replies-partial'
  | 'replies-populated'
  | 'structured-content';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;
const noStyles = () => null;
const getEmptyDiscourseEmojiUrls = async () => ({});

const STRUCTURED_CONTENT = [
  '<h2>正文排版标题</h2>',
  '<p>普通文本、<strong>加粗</strong>、<em>斜体</em>和 <code>inline code</code>。</p>',
  '<blockquote><p>引用内容用于检查层级与留白。</p></blockquote>',
  '<pre><code>const visual = true;</code></pre>',
  '<table><thead><tr><th>项目</th><th>状态</th></tr></thead><tbody><tr><td>排版</td><td>已读</td></tr></tbody></table>'
].join('');

function createReplies(): Reply[] {
  return [
    {
      author: '一号回复者',
      canDelete: true,
      canEdit: true,
      canLike: true,
      commentId: 201,
      contentHtml: '<p>第一条纯文本回复。</p>',
      contentMarkdown: '第一条纯文本回复。',
      createdAt: '2026-08-29T08:01:00.000Z',
      floor: 1
    },
    {
      author: '二号回复者',
      commentId: 202,
      contentHtml: '<p>第二条回复，用于检查列表节奏。</p>',
      createdAt: '2026-08-29T08:02:00.000Z',
      floor: 2,
      replyTarget: { author: { name: '一号回复者' }, floor: 1 }
    }
  ];
}

function createTopic(source: Source, state: ActionState, scene: TopicScene) {
  const selected = state === 'selected' || state === 'success';
  const replies =
    scene.startsWith('replies-') && scene !== 'replies-empty' && scene !== 'replies-loading' ? createReplies() : [];
  const base: TopicDetail = {
    author: '示例作者',
    commentId: 101,
    contentHtml: scene === 'structured-content' ? STRUCTURED_CONTENT : '<p>用于检查主帖操作区的纯文本正文。</p>',
    createdAt: FIXED_TIME,
    id: `visual-${source}-${scene}-${state}`,
    replies,
    replyCount: replies.length,
    source,
    title: scene.startsWith('replies-') ? '回复列表视觉状态' : `${source} 主帖视觉状态`,
    url: `https://visual.invalid/${source}/${scene}/${state}`
  };

  if (scene === 'actions' && source === 'nodeseek') {
    return prepareTopicContent({
      ...base,
      collected: selected,
      collectionCount: 4,
      disliked: selected,
      dislikeCount: 1,
      liked: selected,
      likeCount: 3,
      upvoted: selected,
      upvoteCount: 12
    });
  }
  if (scene === 'actions' && source === 'linuxdo') {
    return prepareTopicContent({
      ...base,
      bookmarked: selected,
      bookmarkId: selected ? 88 : undefined,
      liked: selected,
      likeCount: 8,
      reactionSummary: [{ id: 'heart', count: 8 }],
      siteExtension: { boostCount: 2 }
    });
  }
  if (scene === 'actions' && source === 'yaohuo') {
    return prepareTopicContent({
      ...base,
      ...(state === 'unknown' ? {} : { bookmarked: selected })
    });
  }
  return prepareTopicContent(scene === 'actions' && source === 'v2ex' ? { ...base, upvoteCount: 336 } : base);
}

function decisionForScenario(
  source: Source,
  state: ActionState,
  scene: TopicScene,
  pendingTarget?: PendingTarget
): TopicActionDecisionFor {
  return ({ action, interaction, reply }) => {
    if (scene === 'replies-populated') {
      const allowed =
        action === 'reply' ||
        (action === 'edit' && reply?.canEdit === true) ||
        (action === 'delete' && reply?.canDelete === true) ||
        (action === 'like' && reply?.canLike !== false);
      return allowed ? { allowed: true, reason: 'allowed' } : { allowed: false, reason: 'object-forbidden' };
    }
    if (scene !== 'actions') return { allowed: false, reason: 'unsupported' };
    const supported =
      action === 'bookmark' ? source !== 'v2ex' : action === 'like' && (source === 'nodeseek' || source === 'linuxdo');
    if (!supported) return { allowed: false, reason: 'unsupported' };
    if (
      state === 'pending' &&
      ((action === 'bookmark' && pendingTarget === 'bookmark') || (action === 'like' && interaction === pendingTarget))
    ) {
      return { allowed: false, reason: 'pending' };
    }
    if (source === 'nodeseek' && action === 'like' && (state === 'selected' || state === 'success')) {
      return { allowed: false, reason: 'already-complete' };
    }
    return { allowed: true, reason: 'allowed' };
  };
}

function TopicScenarioScreen({
  favorite = false,
  pendingTarget,
  scene = 'actions',
  source,
  state = 'default'
}: {
  favorite?: boolean;
  pendingTarget?: PendingTarget;
  scene?: TopicScene;
  source: Source;
  state?: ActionState;
}) {
  const topic = useMemo(() => createTopic(source, state, scene), [scene, source, state]);
  const decisionFor = useMemo(
    () => decisionForScenario(source, state, scene, pendingTarget),
    [pendingTarget, scene, source, state]
  );
  const actions = useMemo(
    () =>
      ({
        actionBusy: state === 'disabled',
        bookmarkOnDiscourseSite: async () => undefined,
        collectOnNodeSeekSite: async () => undefined,
        decisionFor,
        deleteReply: async () => undefined,
        editReply: async () => undefined,
        favoriteOnYaohuoSite: async () => undefined,
        interact: async (_type: InteractionType, _commentId?: number) => undefined,
        loadLinuxDoPollCapabilities: async () => ({ groups: [], canUseStaffResults: false }),
        loadLinuxDoTemplates: async () => [],
        loadNodeSeekStardustStatus: async () => ({
          participantCount: 0,
          totalAmount: 0,
          paid: false,
          closed: false
        }),
        lockNodeSeekPoll: async () => undefined,
        payNodeSeekStardust: async () => 'canceled' as const,
        submitReply: async () => undefined,
        uploadReplyImage: async () => undefined,
        uploadReplyImageMarkup: async () => undefined,
        useLinuxDoTemplate: async () => undefined,
        votePoll: async (_poll: TopicPoll, _optionIds: string[]) => undefined
      }) satisfies TopicActionsController,
    [decisionFor, state]
  );
  const replyEndError: SourceErrorInfo | null =
    scene === 'replies-partial' ? { kind: 'ordinary', message: '更多回复暂时不可用', retryable: true } : null;
  const read = useMemo(
    () =>
      ({
        loadMoreReplies: async () => true,
        loadPreviousReplies: async () => true,
        loadedQuotedReplies: {},
        loadingMoreReplies: scene === 'replies-loading-more',
        loadingPreviousReplies: false,
        loadingQuotedFloors: {},
        locateReply: async () => 'completed' as const,
        replyCollectionComplete: scene === 'replies-empty' || scene === 'replies-populated',
        replyEndError,
        replyHasMore: scene === 'replies-loading-more',
        replyHasPrevious: false,
        replyRowsPartial: scene === 'replies-partial',
        repliesError: null,
        repliesLoading: scene === 'replies-loading',
        replyStartError: null,
        retryReplies: async () => 'completed' as const,
        toggleReplyQuote: noop,
        toggleTopicBodyQuote: noop,
        topicReplies: topic.replies,
        unreadReplyCount: 0
      }) as unknown as ReturnType<typeof useTopicController>,
    [replyEndError, scene, topic.replies]
  );
  const session = useTopicSessionController({ notify: noop, topic });
  const { settings, theme } = useReaderThemeStyles(noStyles);
  const { width } = useWindowDimensions();
  const mediaSessionIdentity = `${source}:visual`;
  const html = useHtmlRenderingController({
    mediaSessionIdentity,
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic: topic,
    settings,
    theme,
    topicDetail: topic,
    topicKey: `${topic.source}:${topic.id}`,
    webViewBlockMessage: ''
  });
  const topicScrollRef = useRef<FlashListRef<TopicListItem> | null>(null);

  return (
    <TopicScreen
      actions={actions}
      article={{
        busy: false,
        error: null,
        topic,
        ...(source === 'yaohuo' ? { yaohuoBookmarked: topic.bookmarked } : {})
      }}
      chrome={{
        back: noop,
        favorite,
        getDiscourseEmojiUrls: getEmptyDiscourseEmojiUrls,
        onScroll: noop,
        openOriginal: noop,
        openReadingSettings: noop,
        openTopic: noop,
        openUser: noop,
        refreshReplies: noop,
        refreshTopic: noop,
        share: noop,
        toggleFavorite: noop,
        verifyLinuxDo: noop,
        verifyNodeSeek: noop
      }}
      currentNodeSeekUser={undefined}
      html={{
        ...html,
        contentWidth: Math.min(width - 40, contentWidthValue(settings.contentWidth)),
        mediaSessionIdentity
      }}
      nodeSeekUserId={null}
      onImagePreviewDescriptors={noop}
      read={read}
      session={session}
      topicScrollRef={topicScrollRef}
    />
  );
}

function TopicMenuOpenScenario() {
  const [visible, setVisible] = useState(true);
  const { styles } = useReaderThemeStyles(createTopicStyles);
  return (
    <TopicMenu
      onOpenOriginal={noop}
      onOpenReadingSettings={noop}
      onRefreshTopic={noop}
      onRefreshWholeTopic={noop}
      onRequestClose={() => setVisible(false)}
      onShareTopic={noop}
      runTopicMenuAction={(action) => action()}
      styles={styles}
      topicUrl="https://visual.invalid/topic/menu"
      visible={visible}
    />
  );
}

function actionScenario(
  id: string,
  title: string,
  source: Source,
  state: ActionState,
  tags: readonly string[],
  pendingTarget?: PendingTarget
): VisualScenarioDefinition {
  return {
    capabilityIds: ['TOPIC-01', 'WRITE-03'],
    id,
    kind: 'rendered',
    tags: ['topic', 'main-post-actions', source, ...tags],
    title,
    render: () => <TopicScenarioScreen pendingTarget={pendingTarget} source={source} state={state} />
  };
}

export const topicVisualScenarios: readonly VisualScenarioDefinition[] = [
  actionScenario('topic.actions.nodeseek.default', 'NodeSeek 主帖操作·默认', 'nodeseek', 'default', ['default']),
  actionScenario('topic.actions.nodeseek.selected', 'NodeSeek 主帖操作·已选', 'nodeseek', 'selected', ['selected']),
  actionScenario('topic.actions.nodeseek.success', 'NodeSeek 主帖操作·成功稳态', 'nodeseek', 'success', ['success']),
  actionScenario(
    'topic.actions.nodeseek.upvote-pending',
    'NodeSeek 主帖操作·点赞处理中',
    'nodeseek',
    'pending',
    ['pending', 'upvote'],
    'upvote'
  ),
  actionScenario(
    'topic.actions.nodeseek.failure-rollback',
    'NodeSeek 主帖操作·失败回滚',
    'nodeseek',
    'failure-rollback',
    ['failure', 'rollback']
  ),
  actionScenario('topic.actions.nodeseek.disabled', 'NodeSeek 主帖操作·全局忙碌', 'nodeseek', 'disabled', ['disabled']),
  actionScenario('topic.actions.linuxdo.default', 'linux.do 主帖操作·默认', 'linuxdo', 'default', ['default']),
  actionScenario('topic.actions.linuxdo.selected', 'linux.do 主帖操作·已选', 'linuxdo', 'selected', ['selected']),
  actionScenario(
    'topic.actions.linuxdo.like-pending',
    'linux.do 主帖操作·点赞处理中',
    'linuxdo',
    'pending',
    ['pending', 'like'],
    'like'
  ),
  actionScenario('topic.actions.yaohuo.default', '妖火主帖收藏·未收藏', 'yaohuo', 'default', ['default']),
  actionScenario('topic.actions.yaohuo.selected', '妖火主帖收藏·已收藏', 'yaohuo', 'selected', ['selected']),
  actionScenario('topic.actions.yaohuo.unknown', '妖火主帖收藏·状态未知', 'yaohuo', 'unknown', ['unknown']),
  actionScenario('topic.actions.v2ex.readonly', 'V2EX 主帖 UP 票·只读', 'v2ex', 'default', ['read-only']),
  {
    capabilityIds: ['TOPIC-02'],
    id: 'topic.content.structured',
    kind: 'rendered',
    tags: ['topic', 'content', 'typography', 'table', 'code'],
    title: '正文结构与排版',
    render: () => <TopicScenarioScreen scene="structured-content" source="linuxdo" />
  },
  {
    capabilityIds: ['TOPIC-02'],
    id: 'topic.media.native-interaction',
    kind: 'device-only',
    note: '图片自然尺寸、横滑/文字选择、原图预览与保存、音视频 controls 必须在匹配 APK 的 Android 设备上取证；画廊不发起媒体网络请求。',
    tags: ['topic', 'media', 'gesture', 'native', 'device-only'],
    title: '正文媒体与手势'
  },
  {
    capabilityIds: ['TOPIC-03', 'WRITE-02'],
    id: 'topic.replies.populated',
    kind: 'rendered',
    tags: ['topic', 'replies', 'data', 'reply-actions'],
    title: '回复列表·有数据与操作',
    render: () => <TopicScenarioScreen scene="replies-populated" source="linuxdo" />
  },
  {
    capabilityIds: ['TOPIC-03'],
    id: 'topic.replies.loading',
    kind: 'rendered',
    tags: ['topic', 'replies', 'loading'],
    title: '回复列表·加载中',
    render: () => <TopicScenarioScreen scene="replies-loading" source="v2ex" />
  },
  {
    capabilityIds: ['TOPIC-03'],
    id: 'topic.replies.empty',
    kind: 'rendered',
    tags: ['topic', 'replies', 'empty'],
    title: '回复列表·空状态',
    render: () => <TopicScenarioScreen scene="replies-empty" source="v2ex" />
  },
  {
    capabilityIds: ['TOPIC-03'],
    id: 'topic.replies.partial-error',
    kind: 'rendered',
    tags: ['topic', 'replies', 'partial', 'error'],
    title: '回复列表·部分数据与边缘失败',
    render: () => <TopicScenarioScreen scene="replies-partial" source="linuxdo" />
  },
  {
    capabilityIds: ['TOPIC-03'],
    id: 'topic.replies.loading-more',
    kind: 'rendered',
    tags: ['topic', 'replies', 'pagination', 'pending'],
    title: '回复列表·加载更多',
    render: () => <TopicScenarioScreen scene="replies-loading-more" source="linuxdo" />
  },
  {
    capabilityIds: ['TOPIC-03'],
    id: 'topic.replies.device-continuity',
    kind: 'device-only',
    note: '前插保位、惯性滚动、楼层定位、长按选择与 Topic→User→Topic 返回连续性需在真实 FlashList/导航栈验收。',
    tags: ['topic', 'replies', 'navigation', 'device-only'],
    title: '回复滚动与导航连续性'
  },
  {
    capabilityIds: ['TOPIC-04'],
    id: 'topic.favorite.selected',
    kind: 'rendered',
    tags: ['topic', 'local-favorite', 'selected'],
    title: '主题本机收藏·已选',
    render: () => <TopicScenarioScreen favorite scene="favorite" source="v2ex" />
  },
  {
    capabilityIds: ['TOPIC-04'],
    id: 'topic.menu.open',
    kind: 'rendered',
    tags: ['topic', 'menu', 'overlay', 'open'],
    title: '主题更多操作菜单·展开',
    render: () => <TopicMenuOpenScenario />
  },
  {
    capabilityIds: ['TOPIC-04'],
    id: 'topic.menu.system-transitions',
    kind: 'device-only',
    note: '原生分享面板、Custom Tab、阅读设置返回、Android Back 与实机菜单几何由设备走查验证，只取消不执行外部写入。',
    tags: ['topic', 'menu', 'share', 'custom-tab', 'device-only'],
    title: '主题菜单系统过渡'
  }
];
