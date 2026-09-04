import { describe, expect, it, jest } from '@jest/globals';
import React, { type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import RenderHTML, { RenderHTMLConfigProvider, TRenderEngineProvider, useContentWidth } from 'react-native-render-html';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { compileForumContent, prepareTopicContent, prepareReplyContent } from '@/domain/forum/topicContentSplit';
import { TopicContentList } from '@/features/topic/components/TopicContentList';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { useForumContentWidth } from '@/ui/content/ForumContentWidth';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { createHtmlCustomElementModels } from '@/features/topic/rendering/htmlElementModels';
import { buildHtmlRenderingStyles } from '@/features/topic/rendering/htmlStyles';
import { createTheme } from '@/ui/theme/tokens';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import type { Reply, TopicDetail } from '@/domain/forum/models';
import { act, fireEvent, render, within } from '../render';
import { TopicRouteBackBoundary } from '@/features/topic/useTopicRouteBeforeRemove';

let mockPreventRemove = false;
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

jest.mock('expo-video', () => ({
  VideoView: require('react-native').View,
  createVideoPlayer: jest.fn(() => ({})),
  useVideoPlayer: jest.fn(() => ({}))
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  return {
    FlashList: ({ data, renderItem }: { data: { key: string }[]; renderItem: (info: unknown) => ReactNode }) =>
      ReactModule.createElement(
        require('react-native').View,
        null,
        data.map((item, index) =>
          ReactModule.createElement(
            ReactModule.Fragment,
            { key: item.key },
            renderItem({ item, index, target: 'Cell' })
          )
        )
      ),
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
    _ref: unknown
  ) {
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
    floor: 6,
    expectedAuthorUsername: 'Pipecraft'
  });
  await fireEvent.press(view.getByText('@Pipecraft'));
  expect(onOpenUser).toHaveBeenCalledWith(expect.objectContaining({ source: 'v2ex', username: 'Pipecraft' }));
  expect(onOpenTopic).toHaveBeenCalledTimes(1);
});

function ProductionContentList({
  topic,
  quotedReplies
}: {
  topic: ReturnType<typeof prepareTopicContent>;
  quotedReplies: Record<string, Reply>;
}) {
  const session = useTopicSessionController({ topic, notify: () => undefined });
  const topicScrollRef = React.useRef(null);
  const controller = useHtmlRenderingController({
    mediaSessionIdentity: 'selection-test',
    onOpenExternalUrl: () => undefined,
    onOpenImagePreview: () => undefined,
    onOpenTopic: () => undefined,
    onOpenUser: () => undefined,
    selectedTopic: topic,
    settings: selectionReaderData.settings,
    theme: selectionTheme,
    topicDetail: topic,
    webViewBlockMessage: ''
  });
  const unexpected = React.useCallback(() => {
    throw new Error('Selection fixture must not perform a read or write transaction.');
  }, []);
  return (
    <TopicContentList
      actions={React.useMemo(
        () => ({
          actionBusy: false,
          decisionFor: () => ({ allowed: false, reason: 'login-required' }),
          bookmarkOnDiscourseSite: unexpected,
          collectOnNodeSeekSite: unexpected,
          deleteReply: unexpected,
          editReply: unexpected,
          favoriteOnYaohuoSite: unexpected,
          interact: unexpected,
          loadLinuxDoPollCapabilities: unexpected,
          loadLinuxDoTemplates: unexpected,
          loadNodeSeekStardustStatus: unexpected,
          lockNodeSeekPoll: unexpected,
          payNodeSeekStardust: unexpected,
          submitReply: unexpected,
          uploadReplyImage: unexpected,
          uploadReplyImageMarkup: unexpected,
          useLinuxDoTemplate: unexpected,
          votePoll: unexpected
        }),
        [unexpected]
      )}
      article={{ busy: false, error: null, topic }}
      currentNodeSeekUser={undefined}
      discourseEmojiUrls={{}}
      headerState={null}
      html={{ ...controller, contentWidth: 320, mediaSessionIdentity: 'selection-test' }}
      nodeSeekUserId={null}
      onImagePreviewDescriptors={() => undefined}
      onOpenTopic={unexpected}
      onOpenUser={unexpected}
      onScroll={() => undefined}
      session={session}
      topicScrollRef={topicScrollRef}
      read={{
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
    const expected = 320 - 16 - StyleSheet.hairlineWidth * 2 - 19 - 28;
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
    surface.props.onAutoScroll({ nativeEvent: { delta: -24 } });
    expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 96 });
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
    jest.isolateModules(() => {
      jest.doMock('react', () => React);
      jest.doMock('expo-modules-core', () => ({
        requireNativeViewManager: () => {
          throw new Error('ForumContentSelection unavailable');
        }
      }));
      UnavailableSelectionSurface = require('@/features/topic/selection/TopicSelectionSurface').TopicSelectionSurface;
    });
    jest.dontMock('react');
    jest.dontMock('expo-modules-core');
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
