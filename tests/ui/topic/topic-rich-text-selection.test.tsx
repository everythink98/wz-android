import { describe, expect, it, jest } from '@jest/globals';
import { inactivePostInteractionActions } from '../topicInteractionFixture';
import React, { type ReactNode, type RefObject } from 'react';
import type { FlashListRef } from '@shopify/flash-list';
import { Platform, StyleSheet, Text, View, type MeasureOnSuccessCallback } from 'react-native';
import type { PanGestureHandlerEventPayload } from 'react-native-gesture-handler';
import { createGestureController, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import RenderHTML, { RenderHTMLConfigProvider, TRenderEngineProvider, useContentWidth } from 'react-native-render-html';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { compileForumContent, prepareTopicContent, prepareReplyContent } from '@/domain/forum/topicContentSplit';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import { TopicContentList } from '@/features/topic/components/TopicContentList';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { useForumContentWidth } from '@/ui/content/ForumContentWidth';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { createHtmlCustomElementModels } from '@/features/topic/rendering/htmlElementModels';
import { buildHtmlRenderingStyles } from '@/ui/content/forumHtmlStyles';
import { createTheme } from '@/ui/theme/tokens';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import type { Reply, TopicDetail } from '@/domain/forum/models';
import { act, fireEvent, render, within } from '../render';
import { TopicRouteBackBoundary } from '@/features/topic/useTopicRouteBeforeRemove';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { QueryClient } from '@tanstack/react-query';
import { createDiscourseReadingRuntime, type DiscourseReadingRuntime } from '@/platform/query/discourseReadingRuntime';
import { topicListReadingFloor, type TopicListItem } from '@/features/topic/model/topicListModel';

let mockReadingList: {
  data: TopicListItem[];
  onLoad: () => void;
  showCells: (visible: boolean) => void;
  onViewableItemsChanged: (event: {
    viewableItems: { item: TopicListItem; index: number; isViewable: boolean }[];
  }) => void;
};

let mockPreventRemove = false;
const mockCancelNativeSelection = jest.fn<() => Promise<void>>(() => Promise.resolve());
const mockReadingImages = new Map<string, { onDisplay?: () => void; onLoad?: (event: unknown) => void }>();
const mockReadingImageMounts = new Map<string, number>();
jest.mock('expo-image', () => ({
  ...jest.requireActual<typeof import('expo-image')>('expo-image'),
  Image: (props: { source?: { uri?: string }; onDisplay?: () => void; onLoad?: (event: unknown) => void }) => {
    if (props.source?.uri) mockReadingImages.set(props.source.uri, props);
    const uri = props.source?.uri;
    require('react').useEffect(() => {
      if (uri) mockReadingImageMounts.set(uri, (mockReadingImageMounts.get(uri) || 0) + 1);
    }, [uri]);
    return require('react').createElement(require('react-native').View, props);
  }
}));
let mockHandleBack = () => {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native'),
  usePreventRemove: (prevent: boolean, callback: () => void) => {
    mockPreventRemove = prevent;
    mockHandleBack = callback;
  }
}));
import { QueryTestWrapper } from '../QueryTestWrapper';
import { forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import {
  TopicSelectionSurface,
  TopicSelectionRowProvider,
  type TopicSelectionItem,
  useTopicSelectionRowActive,
  useTopicSelectionRowRef
} from '@/features/topic/selection/TopicSelectionSurface';

jest.mock('react-native', () => {
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  Object.defineProperty(actual.Platform, 'OS', { configurable: true, value: 'android' });
  return actual;
});

// Exercise Text's native responder handlers for phrasing links, rather than the preset's passthrough mock.
jest.unmock('react-native/Libraries/Text/Text');

jest.mock('expo-video', () => ({
  VideoView: require('react-native').View,
  createVideoPlayer: jest.fn(() => ({})),
  useVideoPlayer: jest.fn(() => ({}))
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));

jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual<typeof import('react-native-gesture-handler')>('react-native-gesture-handler'),
  ScrollView: require('react-native').ScrollView
}));

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react') as typeof React;
  const actual = jest.requireActual('react-native-reanimated/mock') as typeof import('react-native-reanimated');
  return {
    ...actual,
    isSharedValue: (value: unknown) => Boolean(value && typeof value === 'object' && 'value' in value),
    useSharedValue: <T,>(value: T) => ReactModule.useRef(actual.useSharedValue(value)).current,
    useEvent: (handler: (event: unknown) => void) => (event: { nativeEvent: unknown }) => handler(event.nativeEvent)
  };
});

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  return {
    FlashList: (props: Omit<typeof mockReadingList, 'showCells'> & { renderItem: (info: unknown) => ReactNode }) => {
      const [visible, showCells] = ReactModule.useState(true);
      mockReadingList = { ...props, showCells };
      const { data, renderItem } = props;
      return ReactModule.createElement(
        require('react-native').View,
        null,
        visible &&
          data.map((item, index) =>
            ReactModule.createElement(
              ReactModule.Fragment,
              { key: item.key },
              renderItem({ item, index, target: 'Cell' })
            )
          )
      );
    },
    useMappingHelper: () => ({ getMappingKey: (key: string) => key }),
    useRecyclingState: <T,>(initialState: T | (() => T), dependencies: React.DependencyList) => {
      const value = ReactModule.useRef<T | undefined>(undefined);
      ReactModule.useMemo(() => {
        value.current = typeof initialState === 'function' ? (initialState as () => T)() : initialState;
      }, dependencies);
      const [, forceRender] = ReactModule.useState(0);
      const setState = ReactModule.useCallback((nextState: T | ((mockCurrent: T) => T)) => {
        value.current =
          typeof nextState === 'function' ? (nextState as (mockCurrent: T) => T)(value.current!) : nextState;
        forceRender((mockRevision) => mockRevision + 1);
      }, []);
      return [value.current!, setState] as const;
    }
  };
});

jest.mock('expo-modules-core', () => {
  const ReactModule = require('react') as typeof React;
  const NativeView = require('react-native').View;
  const actual = jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core');
  const NativeSelectionView = ReactModule.forwardRef(function NativeSelectionView(
    props: Record<string, unknown> & { children?: ReactNode },
    ref: React.Ref<{ cancelSelection: () => Promise<void> }>
  ) {
    ReactModule.useImperativeHandle(ref, () => ({ cancelSelection: mockCancelNativeSelection }), []);
    return ReactModule.createElement(NativeView, props, props.children);
  });
  return { ...actual, requireNativeViewManager: jest.fn(() => NativeSelectionView) };
});

function SelectionRow({ children, item }: { children: ReactNode; item: TopicSelectionItem }) {
  const marker = useTopicSelectionRowRef(item.rowKey);
  return (
    <TopicSelectionRowProvider active={marker.active}>
      <View ref={marker.ref} nativeID={marker.nativeID} testID={`selection-row-${item.rowKey}`}>
        {children}
      </View>
    </TopicSelectionRowProvider>
  );
}

const SelectionTextProbe = React.memo(function SelectionTextProbe({
  onRender
}: {
  onRender: (active: boolean) => void;
}) {
  const active = useTopicSelectionRowActive();
  React.useEffect(() => onRender(active));
  return <View accessibilityState={{ selected: active }} />;
});

function SelectionCoordinatorProbe() {
  const { active: enabled } = useTopicSelectionRowRef(undefined);
  return <View accessibilityState={{ selected: enabled }} testID="selection-coordinator-probe" />;
}

const selectionReaderData = createEmptyReaderData();
const selectionTheme = createTheme(selectionReaderData.settings);
const selectionTopic: TopicDetail = {
  author: 'alice',
  contentHtml: '',
  createdAt: '2026-09-02T00:00:00.000Z',
  id: 'selection-topic',
  replies: [],
  replyCount: 0,
  source: 'nodeseek',
  title: '选择测试',
  url: 'https://www.nodeseek.com/post-1-1'
};

function ProductionRichTextRow({
  html,
  topic = selectionTopic,
  onOpenTopic = () => undefined,
  onOpenUser = () => undefined
}: {
  html: string;
  topic?: TopicDetail;
  onOpenTopic?: Parameters<typeof useHtmlRenderingController>[0]['onOpenTopic'];
  onOpenUser?: Parameters<typeof useHtmlRenderingController>[0]['onOpenUser'];
}) {
  const controller = useHtmlRenderingController({
    mediaSessionIdentity: 'nodeseek:selection-test',
    onOpenExternalUrl: () => undefined,
    onOpenImagePreview: () => undefined,
    onOpenTopic,
    onOpenUser,
    selectedTopic: topic,
    settings: selectionReaderData.settings,
    theme: selectionTheme,
    topicDetail: topic,
    webViewBlockMessage: ''
  });
  return (
    <RenderHTML
      baseStyle={controller.htmlBaseStyle}
      classesStyles={controller.htmlClassesStyles}
      contentWidth={320}
      customHTMLElementModels={createHtmlCustomElementModels(selectionReaderData.settings.lineHeight)}
      defaultTextProps={{ selectable: true }}
      ignoredStyles={controller.htmlIgnoredStyles}
      renderers={controller.htmlRenderers}
      renderersProps={controller.htmlRenderersProps}
      source={{ html }}
      tagsStyles={controller.htmlTagsStyles}
    />
  );
}

it('opens the V2EX user from a mention and the exact reply from its compiled inline floor', async () => {
  const onOpenTopic = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenTopic']>();
  const onOpenUser = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenUser']>();
  const topic: TopicDetail = { ...selectionTopic, id: '945124', source: 'v2ex', url: 'https://www.v2ex.com/t/945124' };
  const prepared = prepareTopicContent({ ...topic, contentHtml: '<p>@Pipecraft #6</p>' });
  let replyReads = 0;
  topic.replies = new Proxy(
    Array.from({ length: 2_000 }, () => ({
      author: 'reader',
      contentHtml: '',
      createdAt: ''
    })),
    {
      get(replies, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) replyReads++;
        return Reflect.get(replies, key, receiver);
      }
    }
  );
  const row = prepared.preparedContent.contentPlan.rows.find((item) => item.type === 'richText');
  if (!row || !('html' in row)) throw new Error('Expected a compiled text row');
  const view = await render(
    <ProductionRichTextRow html={row.html} topic={topic} onOpenTopic={onOpenTopic} onOpenUser={onOpenUser} />
  );
  await fireEvent.press(view.getByText('#6'));
  expect(replyReads).toBeLessThanOrEqual(32);
  expect(onOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ source: 'v2ex', id: '945124' }), {
    kind: 'reply',
    target: { floor: 6, expectedAuthorUsername: 'Pipecraft' }
  });
  await fireEvent.press(view.getByText('@Pipecraft'));
  expect(onOpenUser).toHaveBeenCalledWith(expect.objectContaining({ source: 'v2ex', username: 'Pipecraft' }));
  expect(onOpenTopic).toHaveBeenCalledTimes(1);
});

it('reports only visible production content floors after layout and pauses while an editor covers the list', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const send = jest.fn(async () => undefined);
  const reading = createDiscourseReadingRuntime({
    queryClient: new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
    scope: () => 'alice',
    send,
    now: () => clock
  });
  const topic = prepareTopicContent({
    ...selectionTopic,
    id: '42',
    source: 'linuxdo',
    contentHtml: '<p>opening body</p><pre>opening code</pre>',
    replyCount: 100,
    replies: [2, 100].map((floor) =>
      prepareReplyContent(
        { author: 'reader', floor, commentId: floor, contentHtml: `<p>reply ${floor}</p>`, createdAt: '' },
        'linuxdo'
      )
    )
  });
  const tree = (paused = false) => (
    <QueryTestWrapper>
      <ProductionContentList topic={topic} quotedReplies={{}} readingRuntime={reading} readingPaused={paused} />
    </QueryTestWrapper>
  );
  try {
    const view = await render(tree());
    const visible = () =>
      mockReadingList.data.flatMap((item, index) =>
        [1, 100].includes(topicListReadingFloor(item) || 0) ? [{ item, index, isViewable: true }] : []
      );
    await act(async () => {
      mockReadingList.onViewableItemsChanged({ viewableItems: visible() });
    });
    await act(async () => {
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => mockReadingList.onLoad());
    await act(async () => {
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ topicTime: 1000, timings: { 1: 1000, 100: 1000 } }),
      'alice',
      expect.anything(),
      expect.anything()
    );
    expect(reading.state()['42'].readPosts[2]).toBeUndefined();
    await view.rerender(tree(true));
    const before = send.mock.calls.length;
    await act(async () => {
      clock += 10000;
      await jest.advanceTimersByTimeAsync(10000);
    });
    expect(send).toHaveBeenCalledTimes(before);
    await view.unmount();
  } finally {
    reading.dispose();
    jest.useRealTimers();
  }
});

it('waits for actual pixels before recording an image-only visible content row', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const send = jest.fn(async () => undefined);
  const reading = createDiscourseReadingRuntime({
    queryClient: new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
    scope: () => 'alice',
    send,
    now: () => clock
  });
  const topic = prepareTopicContent({
    ...selectionTopic,
    id: '43',
    source: 'linuxdo',
    replyCount: 0,
    replies: [],
    contentHtml: '<img src="https://images.invalid/reading.png" width="100" height="100">'
  });
  try {
    const view = await render(
      <QueryTestWrapper>
        <ProductionContentList topic={topic} quotedReplies={{}} readingRuntime={reading} />
      </QueryTestWrapper>
    );
    await act(async () => {
      mockReadingList.onViewableItemsChanged({
        viewableItems: mockReadingList.data.flatMap((item, index) =>
          topicListReadingFloor(item) === 1 ? [{ item, index, isViewable: true }] : []
        )
      });
      mockReadingList.onLoad();
    });
    await act(async () => {
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(send).not.toHaveBeenCalled();
    const image = mockReadingImages.get('https://images.invalid/reading.png');
    expect(image).toBeDefined();
    await act(async () => {
      image!.onLoad?.({ source: { width: 100, height: 100 } });
      image!.onDisplay?.();
    });
    await act(async () => {
      clock += 1000;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ topicTime: 1000, timings: { 1: 1000 } }),
      'alice',
      expect.anything(),
      expect.anything()
    );
    await view.unmount();
  } finally {
    reading.dispose();
    jest.useRealTimers();
  }
});

it('records the current floor when filtering replaces content at the same visible index', async () => {
  jest.useFakeTimers({ doNotFake: ['performance'] });
  let clock = 0;
  const send = jest.fn(async () => undefined);
  const reading = createDiscourseReadingRuntime({
    queryClient: new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } }),
    scope: () => 'reading-filter',
    send,
    now: () => clock
  });
  const topic = prepareTopicContent({
    ...selectionTopic,
    id: '44',
    author: 'op',
    source: 'linuxdo',
    contentHtml: '<p>opening</p>',
    replyCount: 2,
    replies: [
      { author: 'reader', floor: 2, commentId: 2, contentHtml: '<p>other reply</p>', createdAt: '' },
      { author: 'op', floor: 100, commentId: 100, contentHtml: '<p>author reply</p>', createdAt: '' }
    ].map((reply) => prepareReplyContent(reply, 'linuxdo'))
  });
  let visibleIndices: number[] = [];
  const ViewabilityHelper = require('@shopify/flash-list/src/recyclerview/viewability/ViewabilityHelper').default;
  const helper = new ViewabilityHelper({ minimumViewTime: 0 }, (indices: number[]) => {
    mockReadingList.onViewableItemsChanged({
      viewableItems: indices.map((index) => ({
        index,
        item: mockReadingList.data[index],
        isViewable: true
      }))
    });
  });
  const report = () =>
    helper.updateViewableItems(
      false,
      0,
      { width: 320, height: 100 },
      () => ({ x: 0, y: 0, width: 320, height: 100 }),
      visibleIndices
    );
  const scrollRef = {
    current: {
      recomputeViewableItems: () => {
        helper.clearLastReportedViewableIndices();
        report();
      }
    }
  } as RefObject<FlashListRef<TopicListItem> | null>;
  try {
    const view = await render(
      <QueryTestWrapper>
        <ProductionContentList topic={topic} quotedReplies={{}} readingRuntime={reading} scrollRef={scrollRef} />
      </QueryTestWrapper>
    );
    const index = mockReadingList.data.findIndex((item) => topicListReadingFloor(item) === 2);
    expect(index).toBeGreaterThan(-1);
    visibleIndices = [index];
    await act(async () => {
      mockReadingList.onLoad();
      report();
    });
    await act(async () => {
      clock = 500;
      await jest.advanceTimersByTimeAsync(500);
    });
    await fireEvent.press(view.getByLabelText('只看楼主'));
    expect(topicListReadingFloor(mockReadingList.data[index])).toBe(100);
    await act(async () => report());
    await act(async () => {
      clock = 1500;
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(reading.state()[topic.id]?.readPosts[100]).toBe(true);
    expect(reading.state()[topic.id]?.readPosts[2]).toBeUndefined();
    expect(reading.state()[topic.id]?.anchor?.floor).toBe(100);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ timings: { 100: 1000 } }),
      'reading-filter',
      expect.anything(),
      expect.anything()
    );
    await view.unmount();
  } finally {
    helper.dispose();
    reading.dispose();
    jest.useRealTimers();
  }
});

function ProductionContentList({
  active = true,
  actions,
  contentWidth = 320,
  settings = selectionReaderData.settings,
  topic,
  quotedReplies,
  onOpenImagePreview = () => undefined,
  readingRuntime,
  readingPaused = false,
  scrollRef
}: {
  active?: boolean;
  actions?: Partial<React.ComponentProps<typeof TopicContentList>['actions']>;
  contentWidth?: number;
  settings?: typeof selectionReaderData.settings;
  topic: ReturnType<typeof prepareTopicContent>;
  quotedReplies: Record<string, Reply>;
  onOpenImagePreview?: Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview'];
  readingRuntime?: DiscourseReadingRuntime;
  readingPaused?: boolean;
  scrollRef?: RefObject<FlashListRef<TopicListItem> | null>;
}) {
  const session = useTopicSessionController({ topic, notify: () => undefined });
  const topicScrollRef = React.useRef(null);
  const controller = useHtmlRenderingController({
    mediaSessionIdentity: 'selection-test',
    onOpenExternalUrl: () => undefined,
    onOpenImagePreview,
    onOpenTopic: () => undefined,
    onOpenUser: () => undefined,
    selectedTopic: topic,
    settings,
    theme: selectionTheme,
    topicDetail: topic,
    webViewBlockMessage: ''
  });
  const unexpected = React.useCallback(() => {
    throw new Error('Selection fixture must not perform a read or write transaction.');
  }, []);
  return (
    <TopicContentList
      active={active}
      readingPaused={readingPaused}
      actions={{
        ...inactivePostInteractionActions(),
        actionBusy: false,
        replyImageUploading: false,
        decisionFor: () => ({ allowed: false, reason: 'login-required' }),
        bookmarkOnDiscourseSite: unexpected,
        collectOnNodeSeekSite: unexpected,
        deleteReply: unexpected,
        editReply: unexpected,
        favoriteOnYaohuoSite: unexpected,
        interact: unexpected,
        loadLinuxDoPollCapabilities: unexpected,
        loadLinuxDoTemplates: unexpected,
        resolveLinuxDoUpload: unexpected,
        loadNodeSeekStardustStatus: unexpected,
        lockNodeSeekPoll: unexpected,
        payNodeSeekStardust: unexpected,
        submitReply: unexpected,
        uploadReplyImage: unexpected,
        uploadReplyImageMarkup: unexpected,
        useLinuxDoTemplate: unexpected,
        policySubmissions: {},
        setPolicyAcceptance: unexpected,
        votePoll: unexpected,
        ...actions
      }}
      article={{ busy: false, error: null, topic }}
      currentNodeSeekUser={undefined}
      discourseEmojiUrls={{}}
      headerState={null}
      html={{ ...controller, contentWidth, mediaSessionIdentity: 'selection-test' }}
      nodeSeekUserId={null}
      onImagePreviewDescriptors={() => undefined}
      onOpenTopic={unexpected}
      onOpenUser={unexpected}
      onScroll={() => undefined}
      session={session}
      topicScrollRef={scrollRef || topicScrollRef}
      read={{
        isReadRecoveryCurrent: () => true,
        readingRuntime,
        readingEntry: {
          ready: true,
          positionReady: true,
          windowReady: true,
          windowLoaded: () => undefined,
          anchor: undefined,
          location: undefined,
          baseline: undefined,
          highest: undefined,
          positioned: () => undefined,
          failed: () => undefined
        },
        hasNewReplies: false,
        cancelTopicQueries: unexpected,
        currentTopic: topic,
        currentTopicKey: `${topic.source}:${topic.id}`,
        loadPreviousReplies: unexpected,
        loadMoreReplies: unexpected,
        locateReply: unexpected,
        loadedQuotedReplies: quotedReplies,
        loadingMoreReplies: false,
        loadingPreviousReplies: false,
        loadingQuotedFloors: {},
        openTopic: unexpected,
        refreshTopicReplies: unexpected,
        refreshWholeTopic: unexpected,
        repliesError: null,
        replyStartError: null,
        replyEndError: null,
        repliesLoading: false,
        retryReplies: unexpected,
        replyRowsPartial: false,
        replyCollectionComplete: true,
        replyHasPrevious: false,
        replyHasMore: false,
        replyNextOffset: null,
        replyNextPage: null,
        toggleReplyQuote: unexpected,
        toggleTopicBodyQuote: ({ instanceKey }) => {
          session.commands.quotes.changeExpanded(instanceKey, !session.commands.quotes.isExpanded(instanceKey));
          return Promise.resolve('completed');
        },
        topicBusy: false,
        topicDetail: topic,
        topicError: null,
        topicFavorite: false,
        topicQueryKey: forumQueryKeys.topic({
          source: topic.source,
          topicId: topic.id,
          scope: initialForumSessionEpochs
        }),
        topicReplies: topic.replies,
        unreadReplyCount: 0
      }}
    />
  );
}

describe('topic rich-text selection', () => {
  it.each(['block', 'phrasing'] as const)(
    'rejects a two-finger drag owned by a %s image link and preserves the next single-finger image tap',
    async (kind) => {
      const imageUrl = 'https://images.invalid/linked.png';
      const onOpenImagePreview = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview']>();
      const linkedImage = `<a href="${imageUrl}"><img src="${imageUrl}" alt="linked image" width="120" height="240"></a>`;
      const topic = prepareTopicContent({
        ...selectionTopic,
        source: 'linuxdo',
        url: 'https://linux.do/t/42',
        contentHtml: sanitizeContentHtml(
          kind === 'phrasing' ? `<p>before ${linkedImage} after</p>` : linkedImage,
          'https://linux.do/'
        )
      });
      const view = await render(
        <QueryTestWrapper>
          <ProductionContentList topic={topic} quotedReplies={{}} onOpenImagePreview={onOpenImagePreview} />
        </QueryTestWrapper>
      );
      try {
        await act(async () => {
          mockReadingList.onViewableItemsChanged({
            viewableItems: mockReadingList.data.map((item, index) => ({ item, index, isViewable: true }))
          });
          mockReadingList.onLoad();
        });
        const anchor = view.getByTestId('a');
        const image = within(anchor).getByLabelText('linked image');
        const target = { measure: (callback: MeasureOnSuccessCallback) => callback(0, 0, 320, 240, 0, 0) };
        const touch = (x: number, count: number) => {
          const point = (identifier: number) => ({ identifier, pageX: x, pageY: 60 + identifier * 40 });
          return {
            currentTarget: target,
            target,
            persist: () => undefined,
            stopPropagation: () => undefined,
            nativeEvent: {
              ...point(0),
              touches: Array.from({ length: count }, (_, index) => point(index)),
              changedTouches: [point(count === 2 ? 1 : 0)]
            }
          };
        };
        expect(anchor).not.toBe(image);
        expect(anchor.props.accessibilityRole).toBe('link');
        expect(anchor.props.onResponderGrant).toEqual(expect.any(Function));
        expect(image.props.onResponderGrant).toEqual(expect.any(Function));
        await fireEvent(anchor, 'responderGrant', touch(110, 1));
        // The child receives touch starts, while the outer link owns the native responder.
        // Deliver only installed host handlers; fireEvent would also find props dropped by a composite.
        await act(async () => {
          image.props.onTouchStart?.(touch(110, 1));
          anchor.props.onTouchStart?.(touch(110, 1));
          image.props.onTouchStart?.(touch(110, 2));
          anchor.props.onTouchStart?.(touch(110, 2));
        });
        await fireEvent(anchor, 'responderMove', touch(50, 2));
        await act(async () => anchor.props.onTouchMove?.(touch(50, 2)));
        await fireEvent(anchor, 'touchEnd', touch(50, 1));
        await fireEvent(anchor, 'responderMove', touch(40, 1));
        await act(async () => anchor.props.onTouchMove?.(touch(40, 1)));
        await fireEvent(anchor, 'touchEnd', touch(40, 0));
        await fireEvent(anchor, 'responderRelease', touch(40, 0));
        expect(onOpenImagePreview).not.toHaveBeenCalled();

        await fireEvent(anchor, 'click', { currentTarget: target, target, nativeEvent: {} });
        expect(onOpenImagePreview).toHaveBeenCalledTimes(1);
        expect(onOpenImagePreview).toHaveBeenLastCalledWith(imageUrl);

        await fireEvent(image, 'responderGrant', touch(80, 1));
        await act(async () => {
          image.props.onTouchStart?.(touch(80, 1));
          anchor.props.onTouchStart?.(touch(80, 1));
        });
        await fireEvent(image, 'responderRelease', touch(80, 0));
        await fireEvent(image, 'touchEnd', touch(80, 0));
        expect(onOpenImagePreview).toHaveBeenCalledTimes(2);
        expect(onOpenImagePreview).toHaveBeenLastCalledWith(imageUrl, undefined, undefined);

        await fireEvent(anchor, 'responderGrant', touch(80, 1));
        await act(async () => anchor.props.onTouchStart?.(touch(80, 1)));
        await fireEvent(anchor, 'responderRelease', touch(80, 0));
        expect(onOpenImagePreview).toHaveBeenCalledTimes(3);
        expect(onOpenImagePreview).toHaveBeenLastCalledWith(imageUrl);
      } finally {
        await view.unmount();
      }
    }
  );

  it.each(['opening', 'reply'] as const)(
    'rejects a two-finger drag on a %s gallery image and accepts the next single-finger tap',
    async (role) => {
      const onOpenImagePreview = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview']>();
      const html = sanitizeContentHtml(
        '<div class="d-image-grid" data-mode="carousel">' +
          '<img src="https://images.invalid/touch-1.png" alt="touch gallery image" width="320" height="240">' +
          '<img src="https://images.invalid/touch-2.png" width="320" height="240"></div>',
        'https://linux.do/'
      );
      const topic = prepareTopicContent({
        ...selectionTopic,
        source: 'linuxdo',
        contentHtml: role === 'opening' ? html : '<p>opening</p>',
        replies:
          role === 'reply'
            ? [prepareReplyContent({ author: 'alice', contentHtml: html, createdAt: '', floor: 2 }, 'linuxdo')]
            : []
      });
      const view = await render(
        <QueryTestWrapper>
          <ProductionContentList topic={topic} quotedReplies={{}} onOpenImagePreview={onOpenImagePreview} />
        </QueryTestWrapper>
      );
      try {
        await act(async () => {
          mockReadingList.onViewableItemsChanged({
            viewableItems: mockReadingList.data.map((item, index) => ({ item, index, isViewable: true }))
          });
          mockReadingList.onLoad();
        });
        const image = view.getByLabelText('touch gallery image');
        const target = { measure: (callback: MeasureOnSuccessCallback) => callback(0, 0, 320, 240, 0, 0) };
        const touch = (x: number, count: number) => {
          const point = (identifier: number) => ({ identifier, pageX: x, pageY: 60 + identifier * 40 });
          return {
            currentTarget: target,
            target,
            persist: () => undefined,
            stopPropagation: () => undefined,
            nativeEvent: {
              ...point(0),
              touches: Array.from({ length: count }, (_, index) => point(index)),
              changedTouches: [point(count === 2 ? 1 : 0)]
            }
          };
        };
        expect(image.props.onResponderGrant).toEqual(expect.any(Function));
        await fireEvent(image, 'responderGrant', touch(240, 1));
        await fireEvent(image, 'touchStart', touch(240, 1));
        await fireEvent(image, 'touchStart', touch(240, 2));
        await fireEvent(image, 'touchMove', touch(80, 2));
        await fireEvent(image, 'responderMove', touch(80, 2));
        await fireEvent(image, 'touchEnd', touch(80, 1));
        await fireEvent(image, 'responderMove', touch(70, 1));
        await fireEvent(image, 'touchEnd', touch(70, 0));
        // The real Pressability release emits onPress even though the carousel rejected this pan.
        await fireEvent(image, 'responderRelease', touch(70, 0));
        expect(onOpenImagePreview).not.toHaveBeenCalled();

        await fireEvent(image, 'responderGrant', touch(160, 1));
        await fireEvent(image, 'touchStart', touch(160, 1));
        await fireEvent(image, 'responderRelease', touch(160, 0));
        await fireEvent(image, 'touchEnd', touch(160, 0));
        expect(onOpenImagePreview).toHaveBeenCalledTimes(1);
        expect(onOpenImagePreview).toHaveBeenCalledWith('https://images.invalid/touch-1.png', undefined, undefined);
      } finally {
        await view.unmount();
      }
    }
  );

  it.each(['opening', 'reply'] as const)(
    'configures a single-pointer horizontal gallery gesture in %s content and cancels selection only when scrolling starts',
    async (role) => {
      const html = sanitizeContentHtml(
        '<div class="d-image-grid" data-mode="carousel">' +
          '<img src="https://images.invalid/gesture-1.png" width="200" height="100">' +
          '<img src="https://images.invalid/gesture-2.png" width="200" height="100"></div>',
        'https://linux.do/'
      );
      const topic = prepareTopicContent({
        ...selectionTopic,
        source: 'linuxdo',
        url: 'https://linux.do/t/42',
        contentHtml: '<p>selectable opening</p>' + (role === 'opening' ? html : ''),
        replies:
          role === 'reply'
            ? [prepareReplyContent({ author: 'alice', contentHtml: html, createdAt: '', floor: 2 }, 'linuxdo')]
            : []
      });
      const view = await render(
        <QueryTestWrapper>
          <TopicRouteBackBoundary
            imagePreviewOpen={false}
            replyComposerOpen={false}
            closeImagePreview={jest.fn()}
            closeReplyComposer={jest.fn()}
          >
            <ProductionContentList topic={topic} quotedReplies={{}} />
          </TopicRouteBackBoundary>
        </QueryTestWrapper>
      );
      try {
        const surface = view.getByTestId('topic-selection-surface').props;
        await act(async () => surface.onSelectionChange({ nativeEvent: { active: true, revision: surface.revision } }));
        expect(mockPreventRemove).toBe(true);
        mockCancelNativeSelection.mockClear();

        const pan = getByGestureTestId('rnrc-gesture-handler');
        expect(pan.config).toMatchObject({
          enabled: true,
          activeOffsetXStart: -10,
          activeOffsetXEnd: 10,
          failOffsetYStart: -10,
          failOffsetYEnd: 10,
          maxPointers: 1
        });
        const gesture = createGestureController<PanGestureHandlerEventPayload>('rnrc-gesture-handler');
        // RNGH injects recognized states here; native threshold arbitration needs device coverage.
        await act(async () => {
          gesture.begin({ translationX: 0, translationY: 0 });
          gesture.fail({ translationX: 0, translationY: 11 });
        });
        expect(mockCancelNativeSelection).not.toHaveBeenCalled();
        expect(mockPreventRemove).toBe(true);
        await act(async () => {
          gesture.begin({ translationX: 0, translationY: 0 });
          gesture.activate({ translationX: 11, translationY: 0 });
        });
        expect(mockCancelNativeSelection).not.toHaveBeenCalled();
        await act(async () => gesture.update({ translationX: 12, translationY: 0 }));
        expect(mockCancelNativeSelection).toHaveBeenCalledTimes(1);
        expect(mockPreventRemove).toBe(false);
        await act(async () => {
          gesture.update({ translationX: 20, translationY: 0 });
          gesture.end({ translationX: 20, translationY: 0, velocityX: 0, velocityY: 0 });
        });
        expect(mockCancelNativeSelection).toHaveBeenCalledTimes(1);
      } finally {
        await view.unmount();
        mockCancelNativeSelection.mockClear();
      }
    }
  );

  it.each(['opening', 'reply'] as const)(
    'renders a bounded carousel in %s content, switches pages and opens the selected image',
    async (role) => {
      const onOpenImagePreview = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview']>();
      const html = sanitizeContentHtml(
        '<div class="d-image-grid" data-mode="carousel">' +
          Array.from({ length: 10 }, (_, index) => {
            const image = `<img src="https://images.invalid/slide-${index}.png" alt="gallery slide ${index}" width="230" height="500">`;
            return role === 'opening'
              ? `<a class="lightbox" href="https://images.invalid/full-${index}.png">${image}</a>`
              : image;
          }).join('') +
          '</div>',
        'https://linux.do/'
      );
      const topic = prepareTopicContent({
        ...selectionTopic,
        source: 'linuxdo',
        url: 'https://linux.do/t/42',
        contentHtml: role === 'opening' ? html : '<p>opening</p>',
        replies:
          role === 'reply'
            ? [prepareReplyContent({ author: 'alice', contentHtml: html, createdAt: '', floor: 2 }, 'linuxdo')]
            : []
      });
      const tree = (contentWidth = 320) => (
        <QueryTestWrapper>
          <ProductionContentList
            topic={topic}
            quotedReplies={{}}
            contentWidth={contentWidth}
            onOpenImagePreview={onOpenImagePreview}
          />
        </QueryTestWrapper>
      );
      const view = await render(tree());
      await act(async () => {
        mockReadingList.onViewableItemsChanged({
          viewableItems: mockReadingList.data.map((item, index) => ({ item, index, isViewable: true }))
        });
        mockReadingList.onLoad();
      });
      const gallery = within(view.getByTestId('topic-image-gallery'));
      expect(gallery.getByText('1 / 10')).toBeTruthy();
      expect(gallery.getAllByTestId('topic-image-frame', { includeHiddenElements: true })).toHaveLength(3);
      const firstSize = StyleSheet.flatten(gallery.getByTestId('topic-image-frame').props.style);
      expect(firstSize.height).toBeLessThanOrEqual(400);
      expect(firstSize.width / firstSize.height).toBeCloseTo(230 / 500);
      const firstImageUri = 'https://images.invalid/slide-0.png';
      const firstImageMounts = mockReadingImageMounts.get(firstImageUri);
      expect(firstImageMounts).toBeGreaterThan(0);
      await view.rerender(tree(280.4));
      const viewportSize = StyleSheet.flatten(gallery.getByTestId('topic-image-gallery-carousel').props.style);
      await fireEvent(view.getByTestId('topic-image-gallery-carousel'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: viewportSize.width, height: viewportSize.height } }
      });
      expect(mockReadingImageMounts.get(firstImageUri)).toBe(firstImageMounts);
      await fireEvent.press(gallery.getByLabelText('上一张图片'));
      expect(gallery.getByText('10 / 10')).toBeTruthy();
      await fireEvent.press(gallery.getByLabelText('下一张图片'));
      expect(gallery.getByText('1 / 10')).toBeTruthy();
      const pageStyle = StyleSheet.flatten(gallery.getByTestId('__CAROUSEL_ITEM_0__').props.style);
      expect(viewportSize.width % 1).not.toBe(0);
      expect(pageStyle.width).toBe(viewportSize.width);
      for (let page = 0; page < 4; page++) await fireEvent.press(gallery.getByLabelText('下一张图片'));
      expect(gallery.getByText('5 / 10')).toBeTruthy();
      await act(async () => mockReadingList.showCells(false));
      expect(view.queryByTestId('topic-image-gallery')).toBeNull();
      await act(async () => mockReadingList.showCells(true));
      const restoredGallery = within(view.getByTestId('topic-image-gallery'));
      expect(restoredGallery.getByText('5 / 10')).toBeTruthy();
      expect(restoredGallery.getAllByTestId('topic-image-frame', { includeHiddenElements: true })).toHaveLength(3);
      expect(restoredGallery.queryByLabelText('gallery slide 0', { includeHiddenElements: true })).toBeNull();
      await fireEvent.press(restoredGallery.getByLabelText('gallery slide 4'));
      expect(onOpenImagePreview).toHaveBeenCalledWith('https://images.invalid/slide-4.png', undefined, undefined);
      await view.unmount();
    }
  );

  it('keeps prose and a clickable image in order between separate terminal sections', async () => {
    const onOpenImagePreview = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview']>();
    const imageUrl = 'https://img.example/terminal-proof.png';
    const topic = prepareTopicContent({
      ...selectionTopic,
      contentHtml: sanitizeContentHtml(
        '<p>💻 CPU</p><div class="forum-terminal-code">first terminal output</div>' +
          `<p>explanation before image</p><p><img src="${imageUrl}" alt="terminal proof" width="200" height="100"></p>` +
          '<p>explanation after image</p><p>🌐 Network</p><div class="forum-terminal-code">second terminal output</div>',
        selectionTopic.url
      )
    });
    const screen = await render(
      <QueryTestWrapper>
        <ProductionContentList topic={topic} quotedReplies={{}} onOpenImagePreview={onOpenImagePreview} />
      </QueryTestWrapper>
    );
    await act(async () => {
      mockReadingList.onViewableItemsChanged({
        viewableItems: mockReadingList.data.map((item, index) => ({ item, index, isViewable: true }))
      });
      mockReadingList.onLoad();
    });
    const rendered = JSON.stringify(screen.toJSON());
    const markers = [
      'first terminal output',
      'explanation before image',
      'terminal proof',
      'explanation after image',
      'second terminal output'
    ];
    for (const text of markers.filter((text) => text !== 'terminal proof')) expect(screen.getByText(text)).toBeTruthy();
    for (let index = 1; index < markers.length; index++) {
      expect(rendered.indexOf(markers[index - 1]!)).toBeLessThan(rendered.indexOf(markers[index]!));
    }
    await fireEvent.press(screen.getByLabelText('terminal proof'));
    expect(onOpenImagePreview).toHaveBeenCalledWith(imageUrl, undefined, undefined);
  });

  it('keeps Stardust status and payment guards while using the latest actions', async () => {
    const topic = prepareTopicContent({
      ...selectionTopic,
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/post-42-1',
      contentHtml:
        '<forum-nodeseek-stardust member-id="42" ref-id="100" amount="5" data-one-time="false"></forum-nodeseek-stardust>'
    });
    const actions = {
      actionBusy: false,
      decisionFor: () => ({ allowed: true, reason: 'allowed' as const }),
      loadNodeSeekStardustStatus: jest.fn(async () => ({
        participantCount: 2,
        totalAmount: 10,
        paid: false,
        closed: false
      })),
      payNodeSeekStardust: jest.fn(async () => 'unknown' as const)
    };
    const tree = (
      nextActions: Partial<React.ComponentProps<typeof TopicContentList>['actions']> = actions,
      active = true
    ) => (
      <QueryTestWrapper>
        <ProductionContentList active={active} topic={topic} quotedReplies={{}} actions={nextActions} />
      </QueryTestWrapper>
    );
    const view = await render(tree());
    const card = view.getByTestId('nodeseek-stardust-card');
    expect(actions.loadNodeSeekStardustStatus).toHaveBeenCalledTimes(1);
    for (const active of [false, true]) {
      await view.rerender(tree({ ...actions, actionBusy: true }, active));
      expect(view.getByTestId('nodeseek-stardust-card') === card).toBe(true);
      if (active) expect(view.getByRole('button', { name: '支付 5 Stardust' })).toBeDisabled();
    }
    expect(actions.loadNodeSeekStardustStatus).toHaveBeenCalledTimes(1);
    expect(view.getByText('2 人已付 · 累计 10 Stardust')).toBeTruthy();
    await view.rerender(tree({ ...actions, decisionFor: () => ({ allowed: false, reason: 'login-required' }) }));
    expect(view.getByRole('button', { name: '支付 5 Stardust' })).toBeDisabled();
    const latestPay = jest.fn(async () => 'unknown' as const);
    await view.rerender(tree({ ...actions, payNodeSeekStardust: latestPay }));
    await fireEvent.press(view.getByRole('button', { name: '支付 5 Stardust' }));
    expect(latestPay).toHaveBeenCalledTimes(1);
    expect(actions.payNodeSeekStardust).not.toHaveBeenCalled();
    expect(view.getByRole('button', { name: '结果待确认' })).toBeDisabled();
    await view.rerender(tree());
    expect(view.getByRole('button', { name: '结果待确认' })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: '结果待确认' }));
    expect(actions.payNodeSeekStardust).not.toHaveBeenCalled();
  });

  it('shows the opening policy after the article and keeps acceptance tied to server state', async () => {
    const policy = {
      postId: '121',
      version: '1',
      accepted: false,
      revoked: false,
      canAccept: true,
      canRevoke: false,
      acceptLabel: '我已知晓此更新内容',
      revokeLabel: '等我再仔细阅读一番'
    };
    const topic = prepareTopicContent({ ...selectionTopic, source: 'linuxdo', url: 'https://linux.do/t/42', policy });
    const setPolicyAcceptance = jest.fn(async () => {});
    const actions = { decisionFor: () => ({ allowed: true, reason: 'allowed' as const }), setPolicyAcceptance };
    const tree = (submitted: boolean) => (
      <QueryTestWrapper>
        <ProductionContentList
          topic={topic}
          quotedReplies={{}}
          actions={{
            ...actions,
            policySubmissions: submitted
              ? { '121': { scope: 'linuxdo:42:0:7', postId: '121', version: '1', accepted: true } }
              : {}
          }}
        />
      </QueryTestWrapper>
    );
    const view = await render(tree(false));
    expect(view.getAllByTestId('discourse-policy-121')).toHaveLength(1);
    await fireEvent.press(view.getByRole('button', { name: policy.acceptLabel }));
    expect(setPolicyAcceptance).toHaveBeenCalledWith(policy, true);
    await view.rerender(tree(true));
    expect(view.getByRole('button', { name: policy.acceptLabel })).toBeDisabled();
    expect(view.getByText('尚未确认阅读当前版本')).toBeTruthy();
  });

  it('keeps table hosts mounted across lifecycle and unrelated reading settings updates', async () => {
    const topic = prepareTopicContent({
      ...selectionTopic,
      contentHtml: '<table><tr><th>项目</th><th>内容</th></tr><tr><td>表格</td><td>保持位置</td></tr></table>'
    });
    const initialStyle = { settings: selectionReaderData.settings, theme: selectionTheme };
    const tree = (active: boolean, style = initialStyle, contentWidth = 320) => (
      <ReaderStyleProvider value={style}>
        <QueryTestWrapper>
          <ProductionContentList
            active={active}
            contentWidth={contentWidth}
            settings={style.settings}
            topic={topic}
            quotedReplies={{}}
          />
        </QueryTestWrapper>
      </ReaderStyleProvider>
    );
    const view = await render(tree(true));
    const scroll = view.getByTestId('topic-html-table-scroll');
    const cell = view.getByText('保持位置');
    for (const active of [true, false, true]) {
      await view.rerender(tree(active));
      expect(view.getByTestId('topic-html-table-scroll') === scroll).toBe(true);
      expect(view.getByText('保持位置') === cell).toBe(true);
    }
    for (const [settings, contentWidth] of [
      [{ ...selectionReaderData.settings, listDensity: 'compact' }, 320],
      [{ ...selectionReaderData.settings, contentWidth: 'wide' }, 400]
    ] satisfies [typeof selectionReaderData.settings, number][]) {
      await view.rerender(tree(true, { settings, theme: selectionTheme }, contentWidth));
      expect(view.getByTestId('topic-html-table-scroll') === scroll).toBe(true);
      expect(view.getByText('保持位置') === cell).toBe(true);
    }
  });

  it.each([false, true])('owns a rejected native selection cancellation after unmount=%s', async (unmount) => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const row = compileForumContent({ html: '<p>private selection</p>', role: 'opening', source: 'linuxdo' }).rows[0]!;
    let rejectCancellation!: (error: Error) => void;
    const cancellation = new Promise<void>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    // Keep a broken owner from leaking into other tests; the oracle requires its own failure diagnostic.
    const observedRejection = cancellation.catch((error: unknown) => error);
    let view: Awaited<ReturnType<typeof render>> | undefined;
    try {
      view = await render(
        <TopicRouteBackBoundary
          imagePreviewOpen={false}
          replyComposerOpen={false}
          closeImagePreview={jest.fn()}
          closeReplyComposer={jest.fn()}
        >
          <TopicSelectionSurface
            active
            items={[{ documentId: 'opening', rowKey: 'private-row', selectionToken: row.selectionToken }]}
            listRef={{ current: null }}
            sessionKey="private-session"
          >
            <Text>selection content</Text>
          </TopicSelectionSurface>
        </TopicRouteBackBoundary>
      );
      const surface = view.getByTestId('topic-selection-surface').props;
      await act(async () => surface.onSelectionChange({ nativeEvent: { active: true, revision: surface.revision } }));
      expect(mockPreventRemove).toBe(true);
      mockCancelNativeSelection.mockClear();
      mockCancelNativeSelection.mockImplementationOnce(() => cancellation);
      await act(async () => mockHandleBack());
      expect(mockCancelNativeSelection).toHaveBeenCalledTimes(1);
      expect(mockPreventRemove).toBe(false);
      if (unmount) {
        await view.unmount();
        view = undefined;
      } else {
        await act(async () => surface.onSelectionChange({ nativeEvent: { active: true, revision: surface.revision } }));
        expect(mockPreventRemove).toBe(true);
      }
      const error = Object.assign(
        new Error(
          "Call to function 'ForumContentSelectionView.cancelSelection' has been rejected.\n→ Caused by: Unable to find the class expo.modules.forumcontentselection.ForumContentSelectionView view with tag 123\nPRIVATE_SELECTION_COMMAND"
        ),
        { code: 'ERR_L' }
      );
      await act(async () => {
        rejectCancellation(error);
        expect(await observedRejection).toBe(error);
      });
      expect(mockCancelNativeSelection).toHaveBeenCalledTimes(1);
      expect(lines.map((line) => JSON.parse(line))).toContainEqual(
        expect.objectContaining({
          operation: 'selection-error',
          phase: 'finish',
          selectionError: 'cancel-command',
          exceptionKind: 'selection-view-missing',
          outcome: 'failure'
        })
      );
      expect(lines.join('')).not.toMatch(/PRIVATE_SELECTION_COMMAND|private-row|private-session|private selection/);
      if (view) {
        expect(view.getByText('selection content')).toBeTruthy();
        expect(mockPreventRemove).toBe(true);
      }
    } finally {
      await view?.unmount();
      mockCancelNativeSelection.mockReset().mockImplementation(() => Promise.resolve());
      setDiagnosticWriter(null);
    }
  });

  it('records current native selection errors and ignores stale documents without exposing selection contents', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    try {
      const row = compileForumContent({ html: '<p>private selected text</p>', role: 'opening', source: 'nodeseek' })
        .rows[0]!;
      const screen = await render(
        <TopicSelectionSurface
          active
          items={[{ documentId: 'opening', rowKey: 'private-row', selectionToken: row.selectionToken }]}
          listRef={{ current: { getAbsoluteLastScrollOffset: () => 0, scrollToOffset: jest.fn() } }}
          sessionKey="private-session"
        >
          <View />
        </TopicSelectionSurface>
      );
      const surface = screen.getByTestId('topic-selection-surface');
      await fireEvent(surface, 'selectionError', {
        nativeEvent: { code: 'copy-mapping-mismatch', revision: 'old-document' }
      });
      expect(lines).toHaveLength(0);
      await fireEvent(surface, 'selectionError', {
        nativeEvent: {
          code: 'copy-mapping-mismatch',
          revision: surface.props.revision,
          rowKey: 'private-row',
          text: 'private selected text'
        }
      });
      expect(lines.map((line) => JSON.parse(line))).toContainEqual(
        expect.objectContaining({
          operation: 'selection-error',
          phase: 'finish',
          selectionError: 'copy-mapping-mismatch',
          outcome: 'failure'
        })
      );
      expect(lines.join('')).not.toMatch(/private selected text|private-row|private-session/);
    } finally {
      setDiagnosticWriter(null);
    }
  });
  it('reports only current native selection to the route without rerendering body consumers', async () => {
    const row = compileForumContent({ html: '<p>正文</p>', role: 'opening', source: 'nodeseek' }).rows[0]!;
    const item: TopicSelectionItem = {
      documentId: 'opening',
      rowKey: 'opening:body',
      selectionToken: row.selectionToken
    };
    const renders = jest.fn();
    const children = <SelectionTextProbe onRender={renders} />;
    const tree = (active: boolean, token = item.selectionToken) => (
      <TopicRouteBackBoundary
        imagePreviewOpen={false}
        replyComposerOpen={false}
        closeImagePreview={jest.fn()}
        closeReplyComposer={jest.fn()}
      >
        <TopicSelectionSurface
          active={active}
          items={[{ ...item, selectionToken: token }]}
          sessionKey="selection-events"
          listRef={{ current: null }}
        >
          {children}
        </TopicSelectionSurface>
      </TopicRouteBackBoundary>
    );
    const view = await render(tree(true));
    const old = view.getByTestId('topic-selection-surface').props;
    await act(async () => old.onSelectionChange({ nativeEvent: { active: true, revision: old.revision } }));
    expect(mockPreventRemove).toBe(true);
    expect(renders).toHaveBeenCalledTimes(1);
    await act(async () => mockHandleBack());
    expect(mockPreventRemove).toBe(false);
    await view.rerender(tree(false));
    await act(async () => old.onSelectionChange({ nativeEvent: { active: true, revision: old.revision } }));
    expect(mockPreventRemove).toBe(false);
    await view.rerender(tree(true));
    const current = view.getByTestId('topic-selection-surface').props;
    expect(current.revision).not.toBe(old.revision);
    await act(async () => old.onSelectionChange({ nativeEvent: { active: true, revision: old.revision } }));
    expect(mockPreventRemove).toBe(false);
    await act(async () => current.onSelectionChange({ nativeEvent: { active: true, revision: current.revision } }));
    expect(mockPreventRemove).toBe(true);
    await view.rerender(tree(true, `${item.selectionToken} `));
    expect(mockPreventRemove).toBe(false);
  });
  it('passes the actual nested tab width to HTML, media and continuous code', async () => {
    const rows = compileForumContent({
      source: 'nodeseek',
      role: 'opening',
      html: '<forum-terminal-report><forum-terminal-tab title="Images"><blockquote><ul><li><p><img src="https://img.example/width.png"></p><pre>full code</pre></li></ul></blockquote></forum-terminal-tab></forum-terminal-report>'
    }).rows;
    const mediaRow = rows.find((row) => row.type === 'richText');
    const codeRow = rows.find((row) => row.type === 'codeBlock');
    if (!mediaRow || mediaRow.type !== 'richText' || !codeRow || codeRow.type !== 'codeBlock')
      throw new Error('Expected tab media and code');
    function ImageWidth() {
      return <Text testID="width-probe">{`${useContentWidth()}:${useForumContentWidth()}`}</Text>;
    }
    const view = await render(
      <TRenderEngineProvider>
        <RenderHTMLConfigProvider renderers={{ img: ImageWidth }}>
          <TopicContentBlock contentWidth={320} row={mediaRow} />
          <TopicContentBlock contentWidth={320} row={codeRow} />
        </RenderHTMLConfigProvider>
      </TRenderEngineProvider>
    );
    const expected = 320 - 16 - StyleSheet.hairlineWidth * 2 - 18 - 28;
    expect(view.getByTestId('width-probe').props.children).toBe(`${expected}:${expected}`);
    expect(StyleSheet.flatten(view.getByTestId('topic-code-frame').props.style).minWidth).toBe(expected);
    expect(view.getByText('full code')).toBeTruthy();
  });
  it('renders NodeSeek native s markup with a visible strike', async () => {
    const settings = createEmptyReaderData().settings;
    const styles = buildHtmlRenderingStyles({ settings, theme: createTheme(settings) });
    const row = compileForumContent({
      html: '<p><s>**<em>555555</em></s></p>',
      role: 'reply',
      source: 'nodeseek'
    }).rows[0];
    if (!row || !('html' in row)) throw new Error('Expected one rich-text row.');
    const screen = await render(
      <RenderHTML
        baseStyle={styles.htmlBaseStyle}
        classesStyles={styles.htmlClassesStyles}
        contentWidth={320}
        ignoredStyles={styles.htmlIgnoredStyles}
        source={{ html: row.html }}
        tagsStyles={styles.htmlTagsStyles}
      />
    );

    expect(screen.getByText('555555')).toHaveStyle({ textDecorationLine: 'line-through' });
  });

  it('renders legacy font hierarchy and submits the matching trailing-break token in one row', async () => {
    const settings = createEmptyReaderData().settings;
    const styles = buildHtmlRenderingStyles({ settings, theme: createTheme(settings) });
    const row = compileForumContent({
      html: '<p><font size="6">论坛总规则</font><br><br><br></p>',
      role: 'opening',
      source: 'yaohuo'
    }).rows[0];
    if (!row || !('html' in row)) throw new Error('Expected one rich-text row.');
    const item: TopicSelectionItem = {
      documentId: 'opening',
      rowKey: 'opening:legacy-font',
      selectionToken: row.selectionToken
    };
    const screen = await render(
      <TopicSelectionSurface
        active
        items={[item]}
        listRef={{ current: { getAbsoluteLastScrollOffset: () => 0, scrollToOffset: jest.fn() } }}
        sessionKey="yaohuo:5248:320:1:standard"
      >
        <SelectionRow item={item}>
          <RenderHTML
            baseStyle={styles.htmlBaseStyle}
            classesStyles={styles.htmlClassesStyles}
            contentWidth={320}
            customHTMLElementModels={createHtmlCustomElementModels(settings.lineHeight)}
            emSize={16}
            enableUserAgentStyles
            ignoredStyles={styles.htmlIgnoredStyles}
            source={{ html: row.html }}
            tagsStyles={styles.htmlTagsStyles}
          />
        </SelectionRow>
      </TopicSelectionSurface>
    );

    expect(screen.getByText('论坛总规则')).toHaveStyle({ fontSize: 32, lineHeight: 48 });
    expect(JSON.parse(row.selectionToken).owners[0]?.text).toBe('论坛总规则\n\n');
    expect(screen.getByTestId('topic-selection-surface').props.rows[0]).toMatchObject({
      rowKey: item.rowKey,
      selectionToken: row.selectionToken
    });
  });

  it('coordinates one opening-post selection across rich text, media, table, and code rows', async () => {
    const { rows } = compileForumContent({
      html:
        '<p>开头😀<img class="emoji" width="20" height="20" src="https://img.example/emoji.png" alt="笑"></p>' +
        '<p><img width="640" height="360" src="https://img.example/standalone.png" alt="独立图"></p>' +
        '<h3>配置</h3>' +
        '<table><tbody><tr><th>CPU</th><th>规格</th></tr><tr><td>核心</td><td>1 核</td></tr></tbody></table>' +
        '<forum-sticker-row><forum-sticker src="https://img.example/sticker.webp" title="贴纸">ignored</forum-sticker></forum-sticker-row>' +
        '<pre>const face = "😀";\n</pre>' +
        '<p>尾声</p>',
      role: 'opening',
      source: 'nodeseek'
    });

    expect(rows.map((row) => row.type)).toEqual(['richText', 'table', 'richText', 'codeBlock', 'richText']);
    expect(rows.every((row) => row.part === 'only')).toBe(true);

    expect(Platform.OS).toBe('android');
    const items: TopicSelectionItem[] = rows.map((row, index) => ({
      documentId: 'opening',
      rowKey: `opening:${row.type}:${index}`,
      selectionToken: row.selectionToken
    }));
    const scrollToOffset = jest.fn();

    const screen = await render(
      <TopicSelectionSurface
        active
        items={items}
        listRef={{ current: { getAbsoluteLastScrollOffset: () => 120, scrollToOffset } }}
        sessionKey="nodeseek:topic-1:320:1:standard"
      >
        <View>
          <SelectionCoordinatorProbe />
          {rows.map((row, index) => (
            <SelectionRow key={`${row.semanticId}:${row.segmentIndex}`} item={items[index]!}>
              {'html' in row ? (
                <ProductionRichTextRow html={row.html} />
              ) : row.type === 'codeBlock' ? (
                <TopicContentBlock contentWidth={320} row={row} />
              ) : null}
            </SelectionRow>
          ))}
        </View>
      </TopicSelectionSurface>
    );
    const surfaces = screen.queryAllByTestId('topic-selection-surface');
    const surface = surfaces[0]!;
    const nativeRows = surface.props.rows as {
      documentId: string;
      nativeId: string;
      rowKey: string;
      selectionToken: string;
    }[];

    expect(surfaces).toHaveLength(1);
    expect(nativeRows.map(({ documentId }) => documentId)).toEqual(Array(rows.length).fill('opening'));
    expect(nativeRows.map(({ rowKey }) => rowKey)).toEqual(items.map(({ rowKey }) => rowKey));
    expect(nativeRows.map(({ selectionToken }) => selectionToken)).toEqual(rows.map((row) => row.selectionToken));
    nativeRows.forEach((nativeRow) => {
      expect(screen.getByTestId(`selection-row-${nativeRow.rowKey}`).props.nativeID).toBe(nativeRow.nativeId);
    });
    expect(surface).toHaveStyle({ flex: 1 });
    expect(surface.props.accessible).toBe(false);
    expect(screen.getByTestId('selection-coordinator-probe').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('topic-selection-content')).toHaveStyle({ flex: 1 });
    expect(screen.getByTestId('topic-selection-content').props.accessible).toBe(false);
    expect(screen.getByTestId('topic-inline-image')).toBeTruthy();
    expect(screen.getByTestId('topic-image-frame')).toBeTruthy();
    expect(screen.getByText('const face = "😀";').parent?.props.selectable).toBe(false);
    const identity = { revision: surface.props.revision, dragId: 1 };
    surface.props.onSelectionDragChange({ nativeEvent: { ...identity, active: true } });
    surface.props.onAutoScroll({ nativeEvent: { ...identity, delta: -24 } });
    expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 96 });
    surface.props.onSelectionDragChange({ nativeEvent: { ...identity, active: false } });
    surface.props.onAutoScroll({ nativeEvent: { ...identity, delta: -24 } });
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
  });

  it('connects visible opening markers and real code selection while excluding replies, signatures, and accepted answers', async () => {
    const reply = prepareReplyContent(
      {
        author: 'reply-author',
        floor: 1,
        commentId: 222,
        createdAt: selectionTopic.createdAt,
        contentHtml: '<p>reply body</p><pre>reply code</pre>',
        signatureHtml: '<p>reply signature</p>'
      },
      'linuxdo'
    );
    const accepted = prepareReplyContent(
      {
        author: 'accepted-author',
        floor: 42,
        createdAt: selectionTopic.createdAt,
        contentHtml: '<p>accepted body</p><pre>accepted code</pre>'
      },
      'linuxdo',
      'quoted-reply'
    );
    const quoted = prepareReplyContent(
      {
        author: 'quoted-author',
        floor: 9,
        createdAt: selectionTopic.createdAt,
        contentHtml: '<p>expanded quote body</p>'
      },
      'linuxdo',
      'quoted-reply'
    );
    const topic = prepareTopicContent({
      ...selectionTopic,
      source: 'linuxdo',
      url: 'https://linux.do/t/topic/selection-topic',
      acceptedAnswerFloor: 42,
      solved: true,
      replies: [reply],
      replyCount: 1,
      contentHtml:
        '<p>opening body</p><table><tr><td>opening cell</td></tr></table><pre>opening code</pre>' +
        '<details open><summary>opening details</summary><p>details body</p></details>' +
        '<details><summary>collapsed details</summary><p>collapsed details body</p></details>' +
        '<aside class="quote" data-post="9" data-topic="quoted-topic" data-username="quoted-author"><div class="title">quoted-author:</div><blockquote>quote preview</blockquote></aside>' +
        '<forum-terminal-report><forum-terminal-tab title="Visible"><div class="forum-terminal-code">visible terminal body</div></forum-terminal-tab>' +
        '<forum-terminal-tab title="Hidden"><div class="forum-terminal-code">hidden terminal body</div></forum-terminal-tab></forum-terminal-report>'
    });
    const screen = await render(
      <QueryTestWrapper>
        <ProductionContentList
          topic={topic}
          quotedReplies={{ 'linuxdo:selection-topic:42': accepted, 'linuxdo:quoted-topic:9': quoted }}
        />
      </QueryTestWrapper>
    );
    await fireEvent.press(screen.getByLabelText('查看完整解决方案，第 42 楼'));
    await fireEvent.press(within(screen.getByTestId('topic-quote-quoted-topic-9')).getByLabelText('展开'));
    const surface = screen.getByTestId('topic-selection-surface');
    const nativeRows = surface.props.rows as { nativeId: string; selectionToken: string }[];
    const manifest = nativeRows.map((row) => row.selectionToken).join('\n');
    for (const visible of [
      'opening body',
      'opening cell',
      'opening code',
      'details body',
      'visible terminal body',
      'expanded quote body'
    ]) {
      expect(manifest).toContain(visible);
    }
    for (const excluded of [
      'collapsed details body',
      'hidden terminal body',
      'reply body',
      'reply code',
      'reply signature',
      'accepted body',
      'accepted code'
    ]) {
      expect(manifest).not.toContain(excluded);
    }
    const renderedTree = JSON.stringify(screen.toJSON());
    const markers = [...renderedTree.matchAll(/"nativeID":"(topic-selection-[^"]+)"/g)].map((match) => match[1]);
    expect(markers.sort()).toEqual(nativeRows.map((row) => row.nativeId).sort());
    const nativeMarkers = screen.container.queryAll((node) => markers.includes(node.props.nativeID));
    expect(nativeMarkers).toHaveLength(nativeRows.length);
    for (const marker of nativeMarkers) {
      expect(marker.props.collapsable).toBe(false);
    }
    expect(screen.getByText('opening code').parent?.props.selectable).toBe(false);
    expect(screen.getByText('accepted code').parent?.props.selectable).toBe(false);
    expect(screen.getByText('reply code').parent?.props.selectable).toBe(false);
    expect(screen.getByText('reply signature')).toBeTruthy();
    await fireEvent.press(screen.getByText('Hidden'));
    const changed = screen
      .getByTestId('topic-selection-surface')
      .props.rows.map((row: { selectionToken: string }) => row.selectionToken)
      .join('\n');
    expect(changed).toContain('hidden terminal body');
    expect(changed).not.toContain('visible terminal body');
    await fireEvent.press(screen.getByText('Visible'));
    expect(screen.getByTestId('topic-selection-surface').props.rows).toEqual(nativeRows);
  });

  it('fails closed before mounting repeated rows into the native coordinator', async () => {
    const row = compileForumContent({ html: '<p>正文</p>', role: 'opening', source: 'nodeseek' }).rows[0]!;
    const repeated: TopicSelectionItem = {
      documentId: 'opening',
      rowKey: 'opening:duplicate',
      selectionToken: row.selectionToken
    };
    const screen = await render(
      <TopicSelectionSurface
        active
        items={[repeated, repeated]}
        listRef={{ current: { getAbsoluteLastScrollOffset: () => 0, scrollToOffset: jest.fn() } }}
        sessionKey="nodeseek:topic-1:320:1:standard"
      >
        <View testID="duplicate-snapshot-content">
          <SelectionCoordinatorProbe />
        </View>
      </TopicSelectionSurface>
    );

    const surface = screen.getByTestId('topic-selection-surface');
    expect(surface.props.enabled).toBe(false);
    expect(surface.props.rows).toEqual([]);
    expect(screen.getByTestId('selection-coordinator-probe').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('duplicate-snapshot-content')).toBeTruthy();
  });

  it('does not broadcast selection-token changes to stable row consumers', async () => {
    const row = compileForumContent({ html: '<p>正文</p>', role: 'opening', source: 'nodeseek' }).rows[0]!;
    const item: TopicSelectionItem = {
      documentId: 'opening',
      rowKey: 'opening:body',
      selectionToken: row.selectionToken
    };
    const nonOpeningRender = jest.fn();
    const openingRender = jest.fn();
    const children = (
      <View>
        <SelectionTextProbe onRender={nonOpeningRender} />
        <SelectionRow item={item}>
          <SelectionTextProbe onRender={openingRender} />
        </SelectionRow>
      </View>
    );
    const props = {
      active: true,
      listRef: { current: { getAbsoluteLastScrollOffset: () => 0, scrollToOffset: jest.fn() } },
      sessionKey: 'nodeseek:topic-1:320:1:standard'
    } as const;
    const screen = await render(
      <TopicSelectionSurface {...props} items={[item]}>
        {children}
      </TopicSelectionSurface>
    );

    expect(nonOpeningRender).toHaveBeenLastCalledWith(false);
    expect(openingRender).toHaveBeenLastCalledWith(true);
    expect(nonOpeningRender).toHaveBeenCalledTimes(1);
    expect(openingRender).toHaveBeenCalledTimes(1);

    await screen.rerender(
      <TopicSelectionSurface {...props} items={[{ ...item, selectionToken: `${item.selectionToken} ` }]}>
        {children}
      </TopicSelectionSurface>
    );

    expect(nonOpeningRender).toHaveBeenCalledTimes(1);
    expect(openingRender).toHaveBeenCalledTimes(1);
  });

  it('passes existing content through without a native wrapper on non-Android platforms', async () => {
    const originalPlatform = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
    try {
      const row = compileForumContent({ html: '<p>正文</p>', role: 'opening', source: 'nodeseek' }).rows[0]!;
      const item: TopicSelectionItem = {
        documentId: 'opening',
        rowKey: 'opening:body',
        selectionToken: row.selectionToken
      };
      const screen = await render(
        <TopicSelectionSurface
          active
          items={[item]}
          listRef={{ current: { getAbsoluteLastScrollOffset: () => 0, scrollToOffset: jest.fn() } }}
          sessionKey="nodeseek:topic-1:320:1:standard"
        >
          <SelectionRow item={item}>
            <View testID="platform-fallback-content" />
          </SelectionRow>
        </TopicSelectionSurface>
      );

      expect(screen.queryByTestId('topic-selection-surface')).toBeNull();
      expect(screen.getByTestId('platform-fallback-content')).toBeTruthy();
      expect(screen.getByTestId('selection-row-opening:body').props.nativeID).toBeUndefined();
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
    }
  });

  it('passes existing content through when the Android native selection module is unavailable', async () => {
    let UnavailableSelectionSurface: typeof TopicSelectionSurface | undefined;
    const expo = require('expo-modules-core') as typeof import('expo-modules-core');
    jest.mocked(expo.requireNativeViewManager).mockImplementationOnce(() => {
      throw new Error('ForumContentSelection unavailable');
    });
    jest.isolateModules(() => {
      jest.doMock('react', () => React);
      UnavailableSelectionSurface = require('@/features/topic/selection/TopicSelectionSurface').TopicSelectionSurface;
    });
    jest.dontMock('react');
    if (!UnavailableSelectionSurface) throw new Error('Expected the fallback selection surface.');

    const row = compileForumContent({ html: '<p>正文</p>', role: 'opening', source: 'nodeseek' }).rows[0]!;
    const screen = await render(
      <UnavailableSelectionSurface
        active
        items={[{ documentId: 'opening', rowKey: 'opening:body', selectionToken: row.selectionToken }]}
        listRef={{ current: { getAbsoluteLastScrollOffset: () => 0, scrollToOffset: jest.fn() } }}
        sessionKey="nodeseek:topic-1:320:1:standard"
      >
        <View testID="module-fallback-content" />
      </UnavailableSelectionSurface>
    );

    expect(screen.queryByTestId('topic-selection-surface')).toBeNull();
    expect(screen.getByTestId('module-fallback-content')).toBeTruthy();
  });
});
