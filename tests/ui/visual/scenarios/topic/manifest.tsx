import { useMemo, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
  | 'replies-long'
  | 'structured-content';

const FIXED_TIME = '2026-08-29T08:00:00.000Z';
const noop = () => undefined;
const noStyles = () => null;
const getEmptyDiscourseEmojiUrls = async () => ({});

const STRUCTURED_CONTENT = [
  '<h2>给长列表加上稳定的内容缓存</h2>',
  '<p>列表恢复到原来的位置后，正文、引用和代码应该仍然保持相同的阅读节奏。缓存除了减少重复请求，还需要保留内容的结构与顺序。</p>',
  '<p>这个示例把 <strong>缓存身份</strong>、<em>更新时机</em>和 <code>revision</code> 放在同一篇正文中，讨论一套可以逐步验证的实现。</p>',
  '<h3>先明确缓存边界</h3>',
  '<ol>',
  '<li><p>用来源、主题和内容版本共同确定缓存身份。</p>',
  '<ul><li>同一主题的新版本不能继续使用旧正文。</li><li>引用内容保留自己的主题与楼层信息。</li></ul></li>',
  '<li><p>把加载状态与已经读到的内容分开保存。</p>',
  '<ul><li>请求失败时保留已有段落。</li><li>重新进入页面时，先恢复内容，再检查是否需要更新。</li></ul></li>',
  '</ol>',
  '<blockquote>',
  '<p>缓存命中只说明找到了对应的数据。它不能代替内容版本检查，也不能决定页面应该滚动到哪里。</p>',
  '<p>阅读位置应该跟随稳定的内容身份保存。段落重新编排时，尽量使用内容锚点，而不是复用上一次的像素偏移。</p>',
  '<blockquote><p>展开引用后，新增内容仍然属于当前阅读流；收起时也需要保留前后的上下文。</p></blockquote>',
  '</blockquote>',
  '<blockquote data-forum-callout="true" data-forum-callout-type="note" data-forum-callout-fold="expanded">',
  '<div class="forum-callout-title">实现前的检查</div>',
  '<div class="forum-callout-content">',
  '<p>先检查已有数据是否足够表达内容版本、加载状态和阅读位置，再决定是否增加新的缓存字段。</p>',
  '<p>一次更新只替换已确认变化的内容。折叠区域和列表回收中的单元仍然需要保持各自的身份。</p>',
  '</div></blockquote>',
  '<details open><summary>缓存命中后的恢复步骤</summary>',
  '<p>恢复正文之后，先找到上一次阅读的内容锚点，再检查该段落是否仍然存在。</p>',
  '<ul><li>锚点存在时，恢复到段落附近。</li><li>锚点已删除时，选择前一个仍然存在的段落。</li></ul>',
  '<p>最后更新加载状态和操作入口。多段内容应该像一个连续的折叠区域，展开后仍然可以顺着正文阅读。</p>',
  '</details>',
  '<details><summary>请求失败时如何保留已有内容</summary>',
  '<p>失败只改变本次请求的状态，不应清空已经成功读取的正文。</p>',
  '<p>重试时继续使用同一份内容快照；只有新结果通过版本检查后，才替换当前显示的数据。</p>',
  '</details>',
  '<h3>用明确的身份读取快照</h3>',
  '<p>下面的示例保留了较长的标识符。代码按原始行展示，横向查看时不应挤压复制入口。</p>',
  '<pre><code class="language-typescript">',
  'type ContentKey = { source: string; topicId: string; revision: number };\n',
  '\n',
  'function readSnapshot(key: ContentKey) {\n',
  "  const snapshotKey = [key.source, key.topicId, key.revision].join(':');\n",
  '  const snapshot = contentCache.get(snapshotKey);\n',
  "  if (!snapshot) return { kind: 'missing', key };\n",
  '\n',
  '  const restoredContentAnchor = snapshot.readingPosition?.stableContentAnchor ?? snapshot.contentBlocks[0]?.stableContentAnchor ?? null;\n',
  "  return { kind: 'ready', content: snapshot.contentBlocks, restoredContentAnchor };\n",
  '}',
  '</code></pre>',
  '<h3>对照恢复结果</h3>',
  '<p>少量字段适合使用窄表。信息较多时，保留清楚的列关系，再通过横向滚动查看其余内容。</p>',
  '<table><thead><tr><th>字段</th><th>用途</th></tr></thead><tbody>',
  '<tr><td>revision</td><td>区分内容版本</td></tr>',
  '<tr><td>anchor</td><td>恢复阅读位置</td></tr>',
  '</tbody></table>',
  '<table><thead><tr><th>场景</th><th>已有内容</th><th>请求结果</th><th>阅读位置</th><th>折叠状态</th><th>后续动作</th></tr></thead><tbody>',
  '<tr><td>首次进入</td><td>没有快照</td><td>读取成功</td><td>正文开头</td><td>使用默认状态</td><td>保存新快照</td></tr>',
  '<tr><td>返回长帖</td><td>版本一致</td><td>无需更新</td><td>恢复内容锚点</td><td>保留展开区域</td><td>继续阅读</td></tr>',
  '<tr><td>手动刷新</td><td>已有旧版本</td><td>暂时失败</td><td>保留当前位置</td><td>保持当前状态</td><td>显示重试入口</td></tr>',
  '</tbody></table>',
  '<p>完成这些检查后，再观察长帖滚动、连续展开与收起，以及浅色和深色主题下的文字层级。</p>'
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
  if (scene === 'replies-long') {
    const sample = replies[0];
    replies.splice(
      0,
      replies.length,
      ...Array.from({ length: 30 }, (_, index) => ({
        ...sample,
        commentId: 201 + index,
        floor: index + 1,
        contentHtml: `<p>第 ${index + 1} 条回复。读到这里也可以直接使用底部入口，继续参与讨论。</p>`
      }))
    );
  }
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
    if (scene === 'replies-populated' || scene === 'replies-long') {
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
        replyImageUploading: false,
        bookmarkOnDiscourseSite: async () => undefined,
        collectOnNodeSeekSite: async () => undefined,
        decisionFor,
        deleteReply: async () => undefined,
        editReply: async () => undefined,
        favoriteOnYaohuoSite: async () => undefined,
        interact: async (_type: InteractionType, _commentId?: number) => undefined,
        loadLinuxDoPollCapabilities: async () => ({ groups: [], canUseStaffResults: false }),
        loadLinuxDoTemplates: async () => [],
        resolveLinuxDoUpload: async () => {
          throw new Error('Unexpected image lookup');
        },
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
        policySubmissions: {},
        setPolicyAcceptance: async () => undefined,
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
        replyCollectionComplete: scene === 'replies-empty' || scene === 'replies-populated' || scene === 'replies-long',
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
  const { width, height } = useWindowDimensions();
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
    webViewBlockMessage: ''
  });
  const topicScrollRef = useRef<FlashListRef<TopicListItem> | null>(null);

  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width, height },
        insets: { top: 0, right: 0, bottom: 0, left: 0 }
      }}
    >
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
    </SafeAreaProvider>
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
  {
    capabilityIds: ['TOPIC-03', 'WRITE-01'],
    id: 'topic.replies.bottom-bar',
    kind: 'rendered',
    tags: ['topic', 'replies', 'composer', 'bottom-bar', 'long-content'],
    title: '长帖与悬浮回复按钮',
    render: () => <TopicScenarioScreen scene="replies-long" source="linuxdo" />
  },
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
