import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Reply, SourceErrorInfo, Topic, TopicDetail, TopicPoll } from '../../src/types';
import type { ReplyFilter } from '../../src/appTypes';
import { filterTopicSessionReplies } from '../../src/app/useTopicSessionController';
import { useHtmlRenderingController } from '../../src/app/useHtmlRenderingController';
import { buildHtmlRenderingStyles } from '../../src/htmlRenderingStyles';
import { createEmptyReaderData } from '../../src/readerData';
import { TopicScreen, YaohuoFavoriteStateProvider } from '../../src/screens/topic/TopicScreenBody';
import { createStyles, createTheme } from '../../src/theme';
import { createTopicImageDeriver } from '../../src/topicDerivedData';
import type { InteractionType } from '../../src/topicActionState';

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    FlashList: ReactModule.forwardRef(function FlashList(
      {
        accessibilityLabel,
        data = [],
        keyExtractor,
        ListFooterComponent,
        ListHeaderComponent,
        renderItem,
        testID
      }: {
        accessibilityLabel?: string;
        data?: unknown[];
        keyExtractor?: (item: unknown, index: number) => string;
        ListFooterComponent?: React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        renderItem?: (info: { item: unknown; index: number }) => React.ReactNode;
        testID?: string;
      },
      ref: React.ForwardedRef<{ scrollToOffset: () => void }>
    ) {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: () => undefined }));
      return ReactModule.createElement(
        NativeView,
        { accessibilityLabel, testID },
        ListHeaderComponent,
        ...data.map((item, index) => ReactModule.createElement(
          NativeView,
          { key: keyExtractor?.(item, index) ?? index },
          renderItem?.({ item, index })
        )),
        ListFooterComponent
      );
    })
  };
});

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));
jest.mock('react-native-webview', () => ({ WebView: () => null }));

jest.mock('react-native-render-html', () => {
  const ReactModule = require('react') as typeof React;
  const Passthrough = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children);
  const RenderersContext = ReactModule.createContext<Record<string, React.ComponentType<any>>>({});
  return {
    __useMockRenderers: () => ReactModule.useContext(RenderersContext),
    HTMLContentModel: { block: 'block', mixed: 'mixed', textual: 'textual' },
    HTMLElementModel: { fromCustomModel: () => ({}) },
    RenderHTMLConfigProvider: ({ children, renderers = {} }: { children?: React.ReactNode; renderers?: Record<string, React.ComponentType<any>> }) => ReactModule.createElement(RenderersContext.Provider, { value: renderers }, children),
    TChildrenRenderer: () => null,
    TRenderEngineProvider: Passthrough,
    defaultHTMLElementModels: {
      details: { extend: () => ({}) },
      summary: { extend: () => ({}) }
    },
    useTNodeChildrenProps: () => ({})
  };
});

jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    BookMarked: Icon,
    ChevronDown: Icon,
    ChevronLeft: Icon,
    ChevronRight: Icon,
    ChevronUp: Icon,
    Drumstick: Icon,
    MoreHorizontal: Icon,
    Star: Icon,
    ThumbsDown: Icon,
    ThumbsUp: Icon,
    X: Icon
  };
});

jest.mock('../../src/components/Avatar', () => ({ Avatar: () => null }));
jest.mock('../../src/components/ForumContentVideo', () => ({ ForumContentVideo: () => null }));
jest.mock('../../src/discourseSourceReaders', () => ({
  getDiscourseSourceEmojiUrls: async () => ({})
}));
jest.mock('../../src/screens/topic/TopicActionBar', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable, Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    DetailActionButton: ({
      accessibilityLabel,
      active,
      disabled,
      label,
      onPress,
      tone
    }: {
      accessibilityLabel: string;
      active?: boolean;
      disabled?: boolean;
      label: string;
      onPress: () => void;
      tone?: string;
    }) => ReactModule.createElement(NativePressable, {
      accessibilityLabel,
      accessibilityRole: 'button',
      accessibilityState: { disabled: Boolean(disabled), selected: Boolean(active) },
      disabled,
      onPress,
      testID: `detail-action-${tone || 'primary'}`
    }, ReactModule.createElement(NativeText, null, label))
  };
});
jest.mock('../../src/screens/topic/TopicContentBlock', () => {
  const ReactModule = require('react') as typeof React;
  const { Text: NativeText, View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    MemoizedTopicContentBlock: ({ html }: { html: string }) => {
      const renderers = (require('react-native-render-html') as {
        __useMockRenderers: () => Record<string, React.ComponentType<any>>;
      }).__useMockRenderers();
      const children: React.ReactNode[] = [];
      const pattern = /<forum-nodeseek-poll\b[^>]*\bid=["']([^"']+)["'][^>]*>\s*<\/forum-nodeseek-poll\s*>/gi;
      let offset = 0;
      let match = pattern.exec(html);
      while (match) {
        if (match.index > offset) {
          children.push(ReactModule.createElement(NativeText, { key: `html-${offset}` }, html.slice(offset, match.index)));
        }
        const Renderer = renderers['forum-nodeseek-poll'];
        if (Renderer) {
          children.push(ReactModule.createElement(Renderer, {
            key: `poll-${match.index}`,
            tnode: { attributes: { id: match[1] } }
          }));
        }
        offset = pattern.lastIndex;
        match = pattern.exec(html);
      }
      if (offset < html.length) {
        children.push(ReactModule.createElement(NativeText, { key: `html-${offset}` }, html.slice(offset)));
      }
      return ReactModule.createElement(NativeView, { testID: 'topic-html-block' }, children);
    }
  };
});
jest.mock('../../src/screens/topic/TopicPolls', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable, Text: NativeText, View: NativeView } = require('react-native') as typeof import('react-native');
  return {
    TopicPolls: ({
      canWritePollSource,
      onVotePoll,
      polls,
      source
    }: {
      canWritePollSource: boolean;
      onVotePoll: (poll: TopicPoll, optionIds: string[]) => void;
      polls: TopicPoll[];
      source?: TopicDetail['source'];
    }) => {
      const poll = polls[0];
      if (!poll) {
        return null;
      }
      return ReactModule.createElement(
        NativeView,
        { testID: `topic-poll-${source}` },
        ReactModule.createElement(NativeText, null, canWritePollSource ? '可投票' : '只读投票'),
        canWritePollSource ? ReactModule.createElement(
          NativePressable,
          {
            accessibilityLabel: `提交 ${source} 投票`,
            accessibilityRole: 'button',
            onPress: () => onVotePoll(poll, [poll.options[0].id])
          },
          ReactModule.createElement(NativeText, null, '提交投票')
        ) : null
      );
    }
  };
});
jest.mock('../../src/screens/topic/ReplyComposerSheet', () => ({ ReplyComposerSheet: () => null }));
jest.mock('../../src/screens/topic/TopicMenu', () => ({ TopicMenu: () => null }));
jest.mock('../../src/screens/topic/ReplyItem', () => {
  const ReactModule = require('react') as typeof React;
  const { Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    DiscourseReactionPill: ({ stat }: { stat: { id: string; label: string; value: number } }) => ReactModule.createElement(
      NativeText,
      { testID: `reaction-${stat.id}` },
      `${stat.label} ${stat.value}`
    ),
    MemoizedReplyItem: ({ reply }: { reply: Reply }) => ReactModule.createElement(
      NativeText,
      { testID: `reply-floor-${reply.floor}` },
      `reply-${reply.floor}-${reply.author}`
    ),
    NodeSeekStatPill: ({ label, value }: { label: string; value: number }) => ReactModule.createElement(
      NativeText,
      { testID: `readonly-stat-${label}` },
      `${label} ${value}`
    ),
    nodeSeekTopicReactionStats: () => []
  };
});

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const htmlStyles = buildHtmlRenderingStyles({ settings: readerData.settings, theme });
const topicImageDeriver = createTopicImageDeriver();
const noop = () => undefined;
const sourceReplies: Reply[] = [
  { author: 'alice', contentHtml: '<p>first answer</p>', createdAt: '2026-07-14T00:01:00.000Z', floor: 1 },
  { author: 'bob', contentHtml: '<p>second needle</p><img src="https://img.example.com/2.png">', createdAt: '2026-07-14T00:02:00.000Z', floor: 2 },
  { author: 'alice', contentHtml: '<p>third needle</p>', createdAt: '2026-07-14T00:03:00.000Z', floor: 3 }
];
const topic: TopicDetail = {
  source: 'v2ex',
  id: 'topic-1',
  title: '筛选测试主题',
  author: 'alice',
  authorId: 'alice',
  url: 'https://www.v2ex.com/t/topic-1',
  createdAt: '2026-07-14T00:00:00.000Z',
  replyCount: sourceReplies.length,
  contentHtml: '',
  replies: sourceReplies
};
const topicPoll: TopicPoll = {
  id: 'source-poll',
  title: '来源投票',
  options: [
    { id: 'yes', label: '赞成', count: 3 },
    { id: 'no', label: '反对', count: 1 }
  ]
};

function HtmlRendererIdentityHarness({
  onRender,
  selectedTopic,
  topicDetail
}: {
  onRender: (renderers: object, rendererProps: object) => void;
  selectedTopic: Topic;
  topicDetail: TopicDetail;
}) {
  const rendering = useHtmlRenderingController({
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic,
    settings: readerData.settings,
    styles,
    theme,
    topicDetail,
    topicKey: `${topicDetail.source}:${topicDetail.id}`,
    webViewBlockMessage: ''
  });
  useEffect(() => {
    onRender(rendering.htmlRenderers, rendering.htmlRenderersProps);
  }, [onRender, rendering.htmlRenderers, rendering.htmlRenderersProps]);
  return null;
}

function TopicFilterHarness({
  canUseLinuxDoActions = false,
  canUseNodeSeekActions = false,
  canUseXiaoyinsiActions = false,
  canUseYaohuoActions = false,
  filteredCommentQuery,
  loadingMoreReplies = false,
  onLoadMoreReplies = jest.fn(),
  onInteract = jest.fn(),
  onRefreshWholeTopic = jest.fn(),
  onReplyComposerOpenChange = jest.fn(),
  onToggleFavorite = jest.fn(),
  onYaohuoFavorite = jest.fn(),
  onVerifyNodeSeek = jest.fn(),
  onVotePoll = jest.fn(),
  onDiscourseBookmark = jest.fn(),
  replyHasMore = false,
  selectedTopic = topic,
  topicDetail = topic,
  topicError = null,
  topicFavorite = false,
  topicBusy = false,
  yaohuoVisualBookmarked
}: {
  canUseLinuxDoActions?: boolean;
  canUseNodeSeekActions?: boolean;
  canUseXiaoyinsiActions?: boolean;
  canUseYaohuoActions?: boolean;
  filteredCommentQuery?: string;
  loadingMoreReplies?: boolean;
  onLoadMoreReplies?: () => void;
  onInteract?: (type: InteractionType, commentId?: number) => void;
  onRefreshWholeTopic?: () => void;
  onReplyComposerOpenChange?: (open: boolean) => void;
  onToggleFavorite?: (topic: Topic) => void;
  onYaohuoFavorite?: () => void;
  onVerifyNodeSeek?: () => void;
  onVotePoll?: (poll: TopicPoll, optionIds: string[]) => void;
  onDiscourseBookmark?: () => void;
  replyHasMore?: boolean;
  selectedTopic?: Topic;
  topicDetail?: TopicDetail | null;
  topicError?: SourceErrorInfo | null;
  topicFavorite?: boolean;
  topicBusy?: boolean;
  yaohuoVisualBookmarked?: boolean;
} = {}) {
  const [commentQuery, setCommentQuery] = useState('');
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>('all');
  const topicScrollRef = useRef(null);
  const effectiveCommentQuery = filteredCommentQuery ?? commentQuery;
  const replies = useMemo(() => filterTopicSessionReplies({
    commentQuery: effectiveCommentQuery,
    inlineSizedImageUrls: {},
    replyFilter,
    topicDetail,
    topicImageDeriver,
    topicReplies: sourceReplies
  }), [effectiveCommentQuery, replyFilter, topicDetail]);

  return (
    <View>
      <YaohuoFavoriteStateProvider
        bookmarked={yaohuoVisualBookmarked ?? topicDetail?.bookmarked}
        onPress={onYaohuoFavorite}
        topicKey={topicDetail ? `${topicDetail.source}:${topicDetail.id}` : ''}
      >
        <TopicScreen
        actionBusy={false}
        sourceActionAvailability={{
          linuxdo: canUseLinuxDoActions,
          nodeseek: canUseNodeSeekActions,
          v2ex: false,
          xiaoyinsi: canUseXiaoyinsiActions,
          yaohuo: canUseYaohuoActions
        }}
        commentQuery={commentQuery}
        contentWidth={720}
        expandedQuotes={{}}
        htmlBaseStyle={htmlStyles.htmlBaseStyle}
        htmlClassesStyles={htmlStyles.htmlClassesStyles}
        htmlIgnoredStyles={htmlStyles.htmlIgnoredStyles}
        htmlRenderers={{}}
        htmlRenderersProps={{}}
        htmlTagsStyles={htmlStyles.htmlTagsStyles}
        inlineSizedImageUrls={{}}
        loadedQuotedReplies={{}}
        loadingMoreReplies={loadingMoreReplies}
        loadingQuotedFloors={{}}
        optimisticActions={{}}
        quoteStateVersion={0}
        replies={replies}
        replyComposerOpen={false}
        replyContent=""
        replyEditTarget={null}
        replyFace=""
        replyFilter={replyFilter}
        replyHasMore={replyHasMore}
        replyHighlightQuery={effectiveCommentQuery}
        replyTarget={null}
        selectedTopic={selectedTopic}
        sourceReplies={sourceReplies}
        styles={styles}
        theme={theme}
        topic={topicDetail}
        topicBusy={topicBusy}
        topicError={topicError}
        topicFavorite={topicFavorite}
        topicImageDeriver={topicImageDeriver}
        topicScrollRef={topicScrollRef}
        unreadReplyCount={0}
        onBack={jest.fn()}
        onCommentQueryChange={setCommentQuery}
        onDeleteReply={jest.fn()}
        onEditReply={jest.fn()}
        onInteract={onInteract}
        onDiscourseBookmark={onDiscourseBookmark}
        onLoadMoreReplies={onLoadMoreReplies}
        onNodeSeekCollection={jest.fn()}
        onOpenOriginal={jest.fn()}
        onOpenReadingSettings={jest.fn()}
        onOpenUser={jest.fn()}
        onRefreshTopic={jest.fn()}
        onRefreshWholeTopic={onRefreshWholeTopic}
        onReplyComposerOpenChange={onReplyComposerOpenChange}
        onReplyContentChange={jest.fn()}
        onReplyFaceChange={jest.fn()}
        onReplyFilterChange={setReplyFilter}
        onReplyToFloor={jest.fn()}
        onShareTopic={jest.fn()}
        onSubmitReply={jest.fn()}
        onToggleFavorite={onToggleFavorite}
        onToggleReplyQuote={jest.fn()}
        onToggleTopicBodyQuote={jest.fn()}
        onTopicScroll={jest.fn()}
        onUploadReplyImage={jest.fn()}
        onVerifyLinuxDo={jest.fn()}
        onVerifyNodeSeek={onVerifyNodeSeek}
        onVotePoll={onVotePoll}
      />
      </YaohuoFavoriteStateProvider>
      <Text testID="active-filter">{replyFilter}</Text>
    </View>
  );
}

describe('Topic reply filters', () => {
  it.each(['linuxdo', 'yaohuo', 'xiaoyinsi'] as const)('wires %s topic polls through the source-specific writable path', async (source) => {
    const onVotePoll = jest.fn<(poll: TopicPoll, optionIds: string[]) => void>();
    const sourceTopic: TopicDetail = {
      ...topic,
      source,
      id: `${source}-poll-topic`,
      url: source === 'linuxdo'
        ? 'https://linux.do/t/topic/2'
        : source === 'xiaoyinsi'
          ? 'https://forum.xiaoyinsi.com/t/topic/2'
          : 'https://yaohuo.me/bbs-2.html',
      polls: [topicPoll]
    };
    const view = await render(
      <TopicFilterHarness
        canUseLinuxDoActions={source === 'linuxdo'}
        canUseXiaoyinsiActions={source === 'xiaoyinsi'}
        canUseYaohuoActions={source === 'yaohuo'}
        onVotePoll={onVotePoll}
        selectedTopic={sourceTopic}
        topicDetail={sourceTopic}
      />
    );

    expect(view.getByTestId(`topic-poll-${source}`)).toBeTruthy();
    expect(view.getByText('可投票')).toBeTruthy();
    await fireEvent.press(view.getByLabelText(`提交 ${source} 投票`));
    expect(onVotePoll).toHaveBeenCalledWith(topicPoll, ['yes']);
  });

  it('shows 小隐寺 write actions only after authorization and wires them independently', async () => {
    const xiaoyinsiTopic: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      id: 'xiaoyinsi-actions',
      url: 'https://forum.xiaoyinsi.com/t/topic/42',
      commentId: 100,
      canCreatePost: true,
      canLike: true,
      liked: false,
      bookmarked: false,
      reactionSummary: [{ id: 'heart', count: 3 }]
    };
    const onInteract = jest.fn<(type: InteractionType, commentId?: number) => void>();
    const onDiscourseBookmark = jest.fn();

    const anonymous = await render(
      <TopicFilterHarness selectedTopic={xiaoyinsiTopic} topicDetail={xiaoyinsiTopic} />
    );
    expect(anonymous.getByTestId('reaction-heart')).toBeTruthy();
    expect(anonymous.queryByLabelText('点赞')).toBeNull();
    expect(anonymous.queryByLabelText('原站收藏')).toBeNull();
    await anonymous.unmount();

    const authorized = await render(
      <TopicFilterHarness
        canUseXiaoyinsiActions
        onInteract={onInteract}
        onDiscourseBookmark={onDiscourseBookmark}
        selectedTopic={xiaoyinsiTopic}
        topicDetail={xiaoyinsiTopic}
      />
    );
    await fireEvent.press(authorized.getByLabelText('点赞'));
    await fireEvent.press(authorized.getByLabelText('原站收藏'));
    expect(onInteract).toHaveBeenCalledWith('like', 100);
    expect(onDiscourseBookmark).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-007] hides reply entry without can_create_post while preserving allowed 小隐寺 interactions', async () => {
    const readOnlyTopic: TopicDetail = {
      ...topic,
      source: 'xiaoyinsi',
      id: 'xiaoyinsi-read-only',
      url: 'https://forum.xiaoyinsi.com/t/topic/43',
      commentId: 101,
      canCreatePost: false,
      canLike: true,
      liked: false,
      bookmarked: false
    };

    const view = await render(
      <TopicFilterHarness
        canUseXiaoyinsiActions
        selectedTopic={readOnlyTopic}
        topicDetail={readOnlyTopic}
      />
    );

    expect(view.queryByText('写回复')).toBeNull();
    expect(view.getByLabelText('点赞')).toBeTruthy();
    expect(view.getByLabelText('原站收藏')).toBeTruthy();
  });

  it('[REG-WRITE-009] renders a NodeSeek poll at its marker between body blocks', async () => {
    const nodeSeekTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: 'nodeseek-poll-topic',
      url: 'https://www.nodeseek.com/post-2-1',
      contentHtml: '<p>投票前正文<br><forum-nodeseek-poll id="source-poll"></forum-nodeseek-poll><br>投票后正文 <img class="sticker" src="/sticker.png"></p>',
      polls: [topicPoll]
    };
    const view = await render(
      <TopicFilterHarness
        canUseNodeSeekActions
        selectedTopic={nodeSeekTopic}
        topicDetail={nodeSeekTopic}
      />
    );

    const rendered = JSON.stringify(view.toJSON());
    const beforeIndex = rendered.indexOf('投票前正文');
    const pollIndex = rendered.indexOf('topic-poll-nodeseek');
    const afterIndex = rendered.indexOf('投票后正文');
    expect(beforeIndex).toBeGreaterThanOrEqual(0);
    expect(pollIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(pollIndex);
    expect(view.getAllByTestId('topic-html-block')).toHaveLength(1);
    expect(view.getAllByTestId('topic-poll-nodeseek')).toHaveLength(1);
  });

  it('shows the V2EX topic vote count without exposing a vote action', async () => {
    const v2exTopic: TopicDetail = { ...topic, upvoteCount: 336 };
    const view = await render(
      <TopicFilterHarness selectedTopic={v2exTopic} topicDetail={v2exTopic} />
    );

    expect(view.getByTestId('readonly-stat-UP 票').props.children).toBe('UP 票 336');
    expect(view.queryByTestId('topic-poll-v2ex')).toBeNull();
  });

  it('keeps V2EX read-only and exposes reply composition only for an authorized writable source', async () => {
    const onReplyComposerOpenChange = jest.fn<(open: boolean) => void>();
    const view = await render(
      <TopicFilterHarness
        canUseNodeSeekActions
        onReplyComposerOpenChange={onReplyComposerOpenChange}
      />
    );

    expect(view.queryByLabelText('写回复')).toBeNull();

    const nodeSeekTopic: TopicDetail = {
      ...topic,
      source: 'nodeseek',
      id: 'nodeseek-writable',
      url: 'https://www.nodeseek.com/post-2-1'
    };
    await view.rerender(
      <TopicFilterHarness
        canUseNodeSeekActions
        selectedTopic={nodeSeekTopic}
        topicDetail={nodeSeekTopic}
        onReplyComposerOpenChange={onReplyComposerOpenChange}
      />
    );
    await fireEvent.press(view.getByLabelText('写回复'));
    expect(onReplyComposerOpenChange).toHaveBeenCalledWith(true);
  });

  it('shows a single detail loading state before the selected topic is available', async () => {
    const view = await render(
      <TopicFilterHarness topicDetail={null} topicBusy />
    );

    expect(view.getAllByText('正在读取主题...')).toHaveLength(1);
    expect(view.queryByText('回复列表')).toBeNull();
  });

  it('offers verification and retry actions when a NodeSeek topic cannot be read', async () => {
    const onRefreshWholeTopic = jest.fn<() => void>();
    const onVerifyNodeSeek = jest.fn<() => void>();
    const selectedTopic: Topic = {
      ...topic,
      source: 'nodeseek',
      id: 'nodeseek-topic-1',
      url: 'https://www.nodeseek.com/post-1-1'
    };
    const view = await render(
      <TopicFilterHarness
        selectedTopic={selectedTopic}
        topicDetail={null}
        topicError={{
          kind: 'verification-required',
          message: 'NodeSeek 需要完成验证后继续。',
          retryable: true,
          verificationRequired: true
        }}
        onRefreshWholeTopic={onRefreshWholeTopic}
        onVerifyNodeSeek={onVerifyNodeSeek}
      />
    );

    expect(view.getByText('NodeSeek 需要完成验证后继续。')).toBeTruthy();
    expect(view.queryByText('正在读取主题...')).toBeNull();
    await fireEvent.press(view.getByLabelText('去验证'));
    await fireEvent.press(view.getByLabelText('重试'));
    expect(onVerifyNodeSeek).toHaveBeenCalledTimes(1);
    expect(onRefreshWholeTopic).toHaveBeenCalledTimes(1);
  });

  it('disables reply pagination while the next page is loading', async () => {
    const onLoadMoreReplies = jest.fn<() => void>();
    const view = await render(
      <TopicFilterHarness replyHasMore onLoadMoreReplies={onLoadMoreReplies} />
    );

    await fireEvent.press(view.getByLabelText('加载更多回复'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);

    await view.rerender(
      <TopicFilterHarness replyHasMore loadingMoreReplies onLoadMoreReplies={onLoadMoreReplies} />
    );
    expect(view.getByLabelText('正在加载...').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(view.getByLabelText('正在加载...'));
    expect(onLoadMoreReplies).toHaveBeenCalledTimes(1);
  });

  it('toggles the local favorite for the current topic and reflects the updated state', async () => {
    const onToggleFavorite = jest.fn<(topic: Topic) => void>();
    const view = await render(
      <TopicFilterHarness onToggleFavorite={onToggleFavorite} />
    );

    await fireEvent.press(view.getByLabelText('收藏'));
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onToggleFavorite).toHaveBeenCalledWith(topic);

    await view.rerender(
      <TopicFilterHarness topicFavorite onToggleFavorite={onToggleFavorite} />
    );
    expect(view.getByLabelText('已收藏')).toBeTruthy();
  });

  it('REG-WRITE-003 exposes the confirmed yaohuo favorite as a yellow cancel action', async () => {
    const onYaohuoFavorite = jest.fn<() => void>();
    const yaohuoTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html',
      bookmarked: true,
      bookmarkId: 987
    };
    const view = await render(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={yaohuoTopic}
        topicDetail={yaohuoTopic}
      />
    );

    const cancelButton = view.getByLabelText('取消原站收藏');
    expect(cancelButton.props.accessibilityState.selected).toBe(true);
    expect(cancelButton.props.testID).toBe('detail-action-favorite');
    await fireEvent.press(cancelButton);
    expect(onYaohuoFavorite).toHaveBeenCalledTimes(1);

    const unfavoritedYaohuoTopic: TopicDetail = {
      ...yaohuoTopic,
      bookmarked: false,
      bookmarkId: undefined
    };
    await view.rerender(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={unfavoritedYaohuoTopic}
        topicDetail={unfavoritedYaohuoTopic}
      />
    );
    expect(view.getByLabelText('原站收藏').props.accessibilityState.selected).toBe(false);
  });

  it('REG-WRITE-003 disables the yaohuo favorite action while its original state is unknown', async () => {
    const onYaohuoFavorite = jest.fn<() => void>();
    const yaohuoTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html'
    };
    const view = await render(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={yaohuoTopic}
        topicDetail={yaohuoTopic}
      />
    );

    const unknownButton = view.getByLabelText('原站收藏状态未加载');
    expect(unknownButton.props.accessibilityState.disabled).toBe(true);
    expect(view.getByText('状态未知')).toBeTruthy();
    await fireEvent.press(unknownButton);
    expect(onYaohuoFavorite).not.toHaveBeenCalled();
  });

  it('[REG-WRITE-004] updates the yaohuo favorite button without replacing the topic layout detail', async () => {
    const onYaohuoFavorite = jest.fn<() => void>();
    const unfavoritedTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html',
      bookmarked: false
    };
    const view = await render(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={unfavoritedTopic}
        topicDetail={unfavoritedTopic}
        yaohuoVisualBookmarked={false}
      />
    );

    await fireEvent.press(view.getByLabelText('原站收藏'));
    expect(onYaohuoFavorite).toHaveBeenCalledTimes(1);
    await view.rerender(
      <TopicFilterHarness
        canUseYaohuoActions
        onYaohuoFavorite={onYaohuoFavorite}
        selectedTopic={unfavoritedTopic}
        topicDetail={unfavoritedTopic}
        yaohuoVisualBookmarked
      />
    );

    expect(view.getByLabelText('取消原站收藏').props.accessibilityState.selected).toBe(true);
  });

  it('[REG-WRITE-005] keeps HTML rendering inputs stable for yaohuo favorite and cancel confirmations', async () => {
    const unbookmarkedTopic: TopicDetail = {
      ...topic,
      source: 'yaohuo',
      id: '123',
      url: 'https://www.yaohuo.me/bbs-123.html',
      bookmarked: false
    };
    const onRender = jest.fn<(renderers: object, rendererProps: object) => void>();
    const view = await render(
      <HtmlRendererIdentityHarness
        onRender={onRender}
        selectedTopic={unbookmarkedTopic}
        topicDetail={unbookmarkedTopic}
      />
    );
    const initialRenderers = onRender.mock.calls.at(-1)?.[0];
    const initialRendererProps = onRender.mock.calls.at(-1)?.[1];

    const bookmarkedTopic: TopicDetail = { ...unbookmarkedTopic, bookmarked: true, bookmarkId: 987 };
    await view.rerender(
      <HtmlRendererIdentityHarness
        onRender={onRender}
        selectedTopic={unbookmarkedTopic}
        topicDetail={bookmarkedTopic}
      />
    );

    expect(onRender.mock.calls.at(-1)?.[0]).toBe(initialRenderers);
    expect(onRender.mock.calls.at(-1)?.[1]).toBe(initialRendererProps);

    await view.rerender(
      <HtmlRendererIdentityHarness
        onRender={onRender}
        selectedTopic={unbookmarkedTopic}
        topicDetail={{ ...bookmarkedTopic, bookmarked: false, bookmarkId: undefined }}
      />
    );

    expect(onRender.mock.calls.at(-1)?.[0]).toBe(initialRenderers);
    expect(onRender.mock.calls.at(-1)?.[1]).toBe(initialRendererProps);
  });

  it('updates visible replies for every filter and comment query', async () => {
    const view = await render(<TopicFilterHarness />);

    expect(view.getByText('3 条')).toBeTruthy();
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual([
      'reply-1-alice',
      'reply-2-bob',
      'reply-3-alice'
    ]);

    await fireEvent.press(view.getByLabelText('只看楼主'));
    expect(view.getByLabelText('只看楼主，已选择')).toBeTruthy();
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual(['reply-1-alice', 'reply-3-alice']);

    await fireEvent.press(view.getByLabelText('只看带图'));
    expect(view.getByLabelText('只看带图，已选择')).toBeTruthy();
    expect(view.getByText('reply-2-bob')).toBeTruthy();

    await fireEvent.press(view.getByLabelText('倒序'));
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual([
      'reply-3-alice',
      'reply-2-bob',
      'reply-1-alice'
    ]);

    await fireEvent.press(view.getByLabelText('全部'));
    await fireEvent.changeText(view.getByPlaceholderText('评论内查找'), 'needle');
    expect(view.getAllByText(/^reply-/).map((node) => node.props.children)).toEqual(['reply-2-bob', 'reply-3-alice']);

    await fireEvent.press(view.getByLabelText('清空查找'));
    expect(view.getByText('3 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] shows the two visible replies in the count after selecting only the author', async () => {
    const view = await render(<TopicFilterHarness />);

    await fireEvent.press(view.getByLabelText('只看楼主'));

    expect(view.getByText('2 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] shows the one visible reply in the count after selecting replies with images', async () => {
    const view = await render(<TopicFilterHarness />);

    await fireEvent.press(view.getByLabelText('只看带图'));

    expect(view.getByText('1 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] shows the two visible replies in the count after a comment query', async () => {
    const view = await render(<TopicFilterHarness />);

    await fireEvent.changeText(view.getByPlaceholderText('评论内查找'), 'needle');

    expect(view.getByText('2 条')).toBeTruthy();
  });

  it('[REG-TOPIC-001] keeps the count aligned with the debounced result while a cleared query settles', async () => {
    const view = await render(<TopicFilterHarness filteredCommentQuery="needle" />);

    expect(view.getAllByText(/^reply-/)).toHaveLength(2);
    expect(view.getByText('2 条')).toBeTruthy();

    await view.rerender(<TopicFilterHarness filteredCommentQuery="first" />);
    expect(view.getAllByText(/^reply-/)).toHaveLength(1);
    expect(view.getByText('1 条')).toBeTruthy();
  });
});
