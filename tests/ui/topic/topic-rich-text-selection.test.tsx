import { describe, expect, it, jest } from '@jest/globals';
import React, { type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import RenderHTML from 'react-native-render-html';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { compileForumContent } from '@/domain/forum/topicContentSplit';
import { createHtmlCustomElementModels } from '@/features/topic/rendering/htmlElementModels';
import { buildHtmlRenderingStyles } from '@/features/topic/rendering/htmlStyles';
import { createTheme } from '@/ui/theme/tokens';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import type { TopicDetail } from '@/domain/forum/models';
import { render } from '../render';
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

jest.mock('@shopify/flash-list', () => {
  const ReactModule = require('react') as typeof React;
  return {
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

function ProductionRichTextRow({ html }: { html: string }) {
  const controller = useHtmlRenderingController({
    mediaSessionIdentity: 'nodeseek:selection-test',
    onOpenExternalUrl: () => undefined,
    onOpenImagePreview: () => undefined,
    onOpenTopic: () => undefined,
    onOpenUser: () => undefined,
    selectedTopic: selectionTopic,
    settings: selectionReaderData.settings,
    theme: selectionTheme,
    topicDetail: selectionTopic,
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

describe('topic rich-text selection', () => {
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
              {'html' in row ? <ProductionRichTextRow html={row.html} /> : <View />}
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
    surface.props.onAutoScroll({ nativeEvent: { delta: -24 } });
    expect(scrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 96 });
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
