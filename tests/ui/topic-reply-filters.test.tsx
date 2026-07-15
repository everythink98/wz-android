import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Reply, SourceErrorInfo, Topic, TopicDetail } from '../../src/types';
import type { ReplyFilter } from '../../src/appTypes';
import { filterTopicSessionReplies } from '../../src/app/useTopicSessionController';
import { useHtmlRenderingController } from '../../src/app/useHtmlRenderingController';
import { buildHtmlRenderingStyles } from '../../src/htmlRenderingStyles';
import { createEmptyReaderData } from '../../src/readerData';
import { TopicScreen, YaohuoFavoriteStateProvider } from '../../src/screens/topic/TopicScreenBody';
import { createStyles, createTheme } from '../../src/theme';
import { createTopicImageDeriver } from '../../src/topicDerivedData';

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
  return {
    HTMLContentModel: { block: 'block', mixed: 'mixed', textual: 'textual' },
    HTMLElementModel: { fromCustomModel: () => ({}) },
    RenderHTMLConfigProvider: Passthrough,
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
jest.mock('../../src/localLinuxdo', () => ({ getLinuxDoEmojiUrls: async () => ({}) }));
jest.mock('../../src/screens/topic/TopicActionBar', () => {
  const ReactModule = require('react') as typeof React;
  const { Pressable: NativePressable } = require('react-native') as typeof import('react-native');
  return {
    DetailActionButton: ({
      accessibilityLabel,
      active,
      onPress,
      tone
    }: {
      accessibilityLabel: string;
      active?: boolean;
      onPress: () => void;
      tone?: string;
    }) => ReactModule.createElement(NativePressable, {
      accessibilityLabel,
      accessibilityRole: 'button',
      accessibilityState: { selected: Boolean(active) },
      onPress,
      testID: `detail-action-${tone || 'primary'}`
    })
  };
});
jest.mock('../../src/screens/topic/TopicContentBlock', () => ({ MemoizedTopicContentBlock: () => null }));
jest.mock('../../src/screens/topic/TopicPolls', () => ({ TopicPolls: () => null }));
jest.mock('../../src/screens/topic/ReplyComposerSheet', () => ({ ReplyComposerSheet: () => null }));
jest.mock('../../src/screens/topic/TopicMenu', () => ({ TopicMenu: () => null }));
jest.mock('../../src/screens/topic/ReplyItem', () => {
  const ReactModule = require('react') as typeof React;
  const { Text: NativeText } = require('react-native') as typeof import('react-native');
  return {
    LinuxDoReactionPill: () => null,
    MemoizedReplyItem: ({ reply }: { reply: Reply }) => ReactModule.createElement(
      NativeText,
      { testID: `reply-floor-${reply.floor}` },
      `reply-${reply.floor}-${reply.author}`
    ),
    NodeSeekStatPill: () => null,
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
  onRender(rendering.htmlRenderers, rendering.htmlRenderersProps);
  return null;
}

function TopicFilterHarness({
  canUseNodeSeekActions = false,
  canUseYaohuoActions = false,
  filteredCommentQuery,
  loadingMoreReplies = false,
  onLoadMoreReplies = jest.fn(),
  onRefreshWholeTopic = jest.fn(),
  onReplyComposerOpenChange = jest.fn(),
  onToggleFavorite = jest.fn(),
  onYaohuoFavorite = jest.fn(),
  onVerifyNodeSeek = jest.fn(),
  replyHasMore = false,
  selectedTopic = topic,
  topicDetail = topic,
  topicError = null,
  topicFavorite = false,
  topicBusy = false,
  yaohuoVisualBookmarked
}: {
  canUseNodeSeekActions?: boolean;
  canUseYaohuoActions?: boolean;
  filteredCommentQuery?: string;
  loadingMoreReplies?: boolean;
  onLoadMoreReplies?: () => void;
  onRefreshWholeTopic?: () => void;
  onReplyComposerOpenChange?: (open: boolean) => void;
  onToggleFavorite?: (topic: Topic) => void;
  onYaohuoFavorite?: () => void;
  onVerifyNodeSeek?: () => void;
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
        bookmarked={yaohuoVisualBookmarked ?? Boolean(topicDetail?.bookmarked)}
        onPress={onYaohuoFavorite}
        topicKey={topicDetail ? `${topicDetail.source}:${topicDetail.id}` : ''}
      >
        <TopicScreen
        actionBusy={false}
        canUseLinuxDoActions={false}
        canUseNodeSeekActions={canUseNodeSeekActions}
        canUseYaohuoActions={canUseYaohuoActions}
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
        onInteract={jest.fn()}
        onLinuxDoBookmark={jest.fn()}
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
        onToggleQuotedFloor={jest.fn()}
        onTopicScroll={jest.fn()}
        onUploadReplyImage={jest.fn()}
        onVerifyLinuxDo={jest.fn()}
        onVerifyNodeSeek={onVerifyNodeSeek}
        onVotePoll={jest.fn()}
      />
      </YaohuoFavoriteStateProvider>
      <Text testID="active-filter">{replyFilter}</Text>
    </View>
  );
}

describe('Topic reply filters', () => {
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
