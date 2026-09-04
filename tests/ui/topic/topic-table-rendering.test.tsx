import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, ToastAndroid, View, type StyleProp, type ViewStyle } from 'react-native';
import { compileForumContent, type CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import { TopicSelectionSurface } from '@/features/topic/selection/TopicSelectionSurface';
import {
  createTopicTableRenderers,
  TopicHorizontalScroll,
  TopicTableScrollProvider,
  TopicTableSemanticBoundary
} from '@/features/topic/rendering/topicTableRenderers';
import { useForumContentWidth } from '@/ui/content/ForumContentWidth';
import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  topicSemanticRowVisible,
  useTopicSplitDisclosureStore
} from '@/features/topic/rendering/TopicSplitDisclosure';
import { fireEvent, render } from '../render';

type MockPanGesture = {
  config: Record<string, unknown>;
  handlerTag: number;
  handlers: Record<string, (...args: any[]) => void>;
};

type MockGestureDetectorBinding = {
  child: React.ReactElement<Record<string, unknown>>;
  gesture: MockPanGesture;
};

let mockPanGestures: MockPanGesture[] = [];
let mockNativeGestures: MockPanGesture[] = [];
let mockGestureDetectorBindings: MockGestureDetectorBinding[] = [];
let mockAnimatedReactionRunners: (() => void)[] = [];
let mockNextGestureHandlerTag = 0;
const mockGestureStateManagers = new Map<number, { activate: () => void; fail: () => void }>();
const mockCancelNativeSelection = jest.fn();
const mockAnimatedScrollTo = jest.fn();
const mockWithDecay = jest.fn(({ clamp }: { clamp: [number, number] }) => clamp[0]);

beforeEach(() => {
  mockPanGestures = [];
  mockNativeGestures = [];
  mockGestureDetectorBindings = [];
  mockAnimatedReactionRunners = [];
  mockNextGestureHandlerTag = 0;
  mockGestureStateManagers.clear();
  mockCancelNativeSelection.mockClear();
  mockAnimatedScrollTo.mockClear();
  mockWithDecay.mockClear();
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));

jest.mock('react-native', () => {
  const actual = jest.requireActual<typeof import('react-native')>('react-native');
  Object.defineProperty(actual.Platform, 'OS', { configurable: true, value: 'android' });
  return actual;
});

jest.mock('expo-modules-core', () => {
  const ReactModule = require('react') as typeof React;
  const NativeView = require('react-native').View;
  const actual = jest.requireActual<typeof import('expo-modules-core')>('expo-modules-core');
  const NativeSelectionView = ReactModule.forwardRef(function NativeSelectionView(
    props: Record<string, unknown> & { children?: React.ReactNode },
    ref: React.ForwardedRef<{ cancelSelection: () => void }>
  ) {
    ReactModule.useImperativeHandle(ref, () => ({ cancelSelection: mockCancelNativeSelection }));
    return ReactModule.createElement(NativeView, props, props.children);
  });
  return {
    ...actual,
    requireNativeViewManager: jest.fn(() => NativeSelectionView)
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  const native = (config: Record<string, unknown> = {}) => {
    const gesture: MockPanGesture = {
      config,
      handlerTag: ++mockNextGestureHandlerTag,
      handlers: {}
    };
    mockNativeGestures.push(gesture);
    return gesture;
  };
  const pan = (config: Record<string, unknown> = {}) => {
    const handlers = Object.fromEntries(
      ['onBegin', 'onDeactivate', 'onTouchesDown', 'onTouchesMove', 'onUpdate']
        .filter((name) => typeof config[name] === 'function')
        .map((name) => [name, config[name]])
    ) as MockPanGesture['handlers'];
    const gesture: MockPanGesture = {
      config,
      handlerTag: ++mockNextGestureHandlerTag,
      handlers
    };
    mockPanGestures.push(gesture);
    return gesture;
  };
  return {
    GestureStateManager: {
      activate: (handlerTag: number) => mockGestureStateManagers.get(handlerTag)?.activate(),
      fail: (handlerTag: number) => mockGestureStateManagers.get(handlerTag)?.fail()
    },
    useNativeGesture: native,
    usePanGesture: pan,
    GestureDetector: ({
      children,
      gesture
    }: {
      children: React.ReactElement<Record<string, unknown>>;
      gesture: MockPanGesture;
    }) => {
      mockGestureDetectorBindings.push({ child: children, gesture });
      const touchHandler = (name: 'onTouchesDown' | 'onTouchesMove') => {
        const handler = gesture.handlers[name];
        return handler
          ? (event: Record<string, unknown>, stateManager: { activate: () => void; fail: () => void }) => {
              mockGestureStateManagers.set(gesture.handlerTag, stateManager);
              handler({ ...event, handlerTag: gesture.handlerTag });
            }
          : undefined;
      };
      return ReactModule.cloneElement(children, {
        ...gesture.handlers,
        gestureConfig: gesture.config,
        onTouchesDown: touchHandler('onTouchesDown'),
        onTouchesMove: touchHandler('onTouchesMove')
      });
    }
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react') as typeof React;
  const Native = require('react-native') as typeof import('react-native');
  const actual = jest.requireActual('react-native-reanimated/mock') as Record<string, any>;
  const sharedValue = <Value,>(initialValue: Value) => {
    let value = initialValue;
    return {
      get value() {
        return value;
      },
      set value(next: Value) {
        value = next;
        mockAnimatedReactionRunners.forEach((run) => run());
      },
      get: () => value,
      set(next: Value) {
        this.value = next;
      }
    };
  };
  const AnimatedScrollView = ReactModule.forwardRef(function AnimatedScrollView(
    props: React.ComponentProps<typeof Native.ScrollView>,
    ref: React.ForwardedRef<import('react-native').ScrollView>
  ) {
    return ReactModule.createElement(Native.ScrollView, { ...props, ref });
  });
  return {
    ...actual,
    default: { ...(actual.default || {}), ScrollView: AnimatedScrollView },
    cancelAnimation: jest.fn(),
    makeMutable: sharedValue,
    scrollTo: (...args: unknown[]) => mockAnimatedScrollTo(...args),
    useAnimatedReaction: (prepare: () => unknown, react: (value: unknown, previous: unknown) => void) => {
      const previous = ReactModule.useRef<unknown>(null);
      ReactModule.useEffect(() => {
        const run = () => {
          const value = prepare();
          react(value, previous.current);
          previous.current = value;
        };
        mockAnimatedReactionRunners.push(run);
        run();
        return () => {
          mockAnimatedReactionRunners = mockAnimatedReactionRunners.filter((candidate) => candidate !== run);
        };
      }, [prepare, react]);
    },
    useAnimatedRef: () => ReactModule.useRef(null),
    useSharedValue: <Value,>(initialValue: Value) => ReactModule.useRef(sharedValue(initialValue)).current,
    withDecay: (options: { clamp: [number, number]; velocity: number }) => mockWithDecay(options)
  };
});

jest.mock('react-native-worklets', () => ({
  ...(jest.requireActual('react-native-worklets') as Record<string, unknown>),
  scheduleOnRN: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => callback(...args)
}));

jest.mock('react-native-render-html', () => ({
  RenderHTMLSource: () => null,
  useContentWidth: () => 320
}));

type TestNode = {
  attributes: Record<string, string>;
  children: TestNode[];
  parent?: TestNode;
  tagName: string;
};

const styles = {
  htmlTableFrame: {
    borderColor: '#ddd',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden' as const
  },
  htmlTableScroll: {},
  htmlTableScrollContent: {}
};

function cell(tagName: 'td' | 'th' = 'td', attributes: Record<string, string> = {}): TestNode {
  return { attributes, children: [], tagName };
}

function table(rows: TestNode[][], attributes: Record<string, string> = {}): TestNode {
  const tableNode: TestNode = { attributes, children: [], tagName: 'table' };
  const tbody: TestNode = { attributes: {}, children: [], parent: tableNode, tagName: 'tbody' };
  tbody.children = rows.map((children) => {
    const row: TestNode = { attributes: {}, children, parent: tbody, tagName: 'tr' };
    children.forEach((child) => {
      child.parent = row;
    });
    return row;
  });
  tableNode.children = [tbody];
  return tableNode;
}

function rendererProps(tnode: TestNode, TDefaultRenderer: React.ComponentType<any>, renderIndex = 0, renderLength = 1) {
  return {
    InternalRenderer: TDefaultRenderer,
    TDefaultRenderer,
    TNodeChildrenRenderer: () => null,
    propsFromParent: {},
    renderIndex,
    renderLength,
    sharedProps: {},
    style: {},
    textProps: {},
    tnode,
    type: 'block',
    viewProps: {}
  };
}

function semanticBoundary(
  child: React.ReactNode,
  {
    columns,
    part = 'only',
    semanticId = 'table-0'
  }: { columns: number; part?: 'only' | 'first' | 'middle' | 'last'; semanticId?: string }
) {
  return (
    <TopicTableSemanticBoundary columns={columns} part={part} semanticId={semanticId}>
      {child}
    </TopicTableSemanticBoundary>
  );
}

function CompiledContentFixture({
  html,
  selectable,
  source = 'nodeseek'
}: {
  html: string;
  selectable?: boolean;
  source?: 'linuxdo' | 'nodeseek';
}) {
  const store = useTopicSplitDisclosureStore();
  const rows = compileForumContent({ html, role: 'opening', source }).rows;
  return (
    <TopicSplitDisclosureProvider value={store}>
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {rows
            .filter((row) => topicSemanticRowVisible(row, 'opening', store))
            .filter((row) => row.type !== 'poll' && row.type !== 'quote')
            .map((row) => (
              <TopicContentBlock key={row.keySuffix} contentWidth={320} row={row} selectable={selectable} />
            ))}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    </TopicSplitDisclosureProvider>
  );
}

describe('native topic structured rendering', () => {
  it('keeps generated list markers out of the selectable text-owner fingerprint', async () => {
    const screen = await render(<CompiledContentFixture html="<ul><li>正文</li></ul>" />);

    expect(screen.getByText('•').props.selectable).not.toBe(true);
  });

  it('renders route-owned tabs and copies the complete styled terminal owner', async () => {
    const copy = jest.mocked(Clipboard.setStringAsync);
    copy.mockClear();
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const html =
      '<forum-terminal-report>' +
      '<forum-terminal-tab title="Overview"><div class="forum-terminal-code">overview</div></forum-terminal-tab>' +
      '<forum-terminal-tab title="Benchmark"><div class="forum-terminal-code"><span style="color: #22c55e; background-color: #111827">benchmark result</span><br>complete line</div></forum-terminal-tab>' +
      '</forum-terminal-report>';
    const screen = await render(<CompiledContentFixture html={html} />);

    expect(screen.getByText('overview')).toBeTruthy();
    expect(screen.queryByText('benchmark result')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: 'Benchmark' }));
    expect(screen.queryByText('overview')).toBeNull();
    expect(StyleSheet.flatten(screen.getByText('benchmark result').props.style)).toMatchObject({
      backgroundColor: '#111827',
      color: '#22c55e'
    });

    await fireEvent.press(screen.getByRole('button', { name: '复制完整代码' }));
    expect(copy).toHaveBeenCalledWith('benchmark result\ncomplete line');
    expect(toast).toHaveBeenCalledWith('代码已复制', ToastAndroid.SHORT);
    expect(screen.getByRole('button', { name: '复制完整代码' }).props.hitSlop).toEqual(12);
    toast.mockRestore();
  });

  it('exposes one complete code frame and reports copy failure', async () => {
    const copy = jest.mocked(Clipboard.setStringAsync);
    copy.mockClear();
    copy.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const sourceText = Array.from({ length: 180 }, (_, index) => `line-${index + 1}:${'x'.repeat(80)}`).join('\n');
    const screen = await render(<CompiledContentFixture html={`<pre>${sourceText}</pre>`} source="linuxdo" />);

    expect(screen.getAllByTestId('topic-code-frame')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '复制完整代码' })).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByRole('button', { name: '复制完整代码' }).props.style)).toMatchObject({
      minHeight: 48,
      minWidth: 48
    });
    await fireEvent.press(screen.getByRole('button', { name: '复制完整代码' }));
    expect(copy).toHaveBeenCalledWith(sourceText);
    expect(toast).toHaveBeenCalledWith('复制失败', ToastAndroid.SHORT);
    toast.mockRestore();
  });

  it('fills narrow NodeSeek tables and honors colspan', async () => {
    const renderers = createTopicTableRenderers({ minColumnWidth: 96, styles });
    const Table = renderers.table as React.ComponentType<any>;
    const Td = renderers.td as React.ComponentType<any>;
    const Th = renderers.th as React.ComponentType<any>;
    const CellDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => (
      <View testID={`cell-${tnode.attributes.id}`} style={style} />
    );
    const TableDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => (
      <View testID={`table-${tnode.attributes.id}`} style={style}>
        {(tnode.children[0]?.children || []).flatMap((row) =>
          row.children.map((node, index) => {
            const Cell = node.tagName === 'th' ? Th : Td;
            return <Cell key={node.attributes.id} {...rendererProps(node, CellDefault, index, row.children.length)} />;
          })
        )}
      </View>
    );
    const threeColumns = table(
      [[cell('th', { id: 'three-a' }), cell('td', { id: 'three-b' }), cell('td', { id: 'three-c' })]],
      { id: 'three' }
    );
    const twoColumns = table(
      [[cell('td', { id: 'two-a' }), cell('td', { id: 'two-b' })], [cell('td', { colspan: '2', id: 'two-wide' })]],
      { id: 'two' }
    );

    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {semanticBoundary(<Table {...rendererProps(threeColumns, TableDefault)} />, {
            columns: 3,
            semanticId: 'three'
          })}
          {semanticBoundary(<Table {...rendererProps(twoColumns, TableDefault)} />, { columns: 2, semanticId: 'two' })}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    expect(StyleSheet.flatten(screen.getByTestId('table-three').props.style)).toMatchObject({ width: 320 });
    expect(StyleSheet.flatten(screen.getByTestId('cell-three-a').props.style)).toMatchObject({
      flexBasis: 320 / 3,
      width: 320 / 3
    });
    expect(StyleSheet.flatten(screen.getByTestId('cell-two-a').props.style)).toMatchObject({ width: 160 });
    expect(StyleSheet.flatten(screen.getByTestId('cell-two-wide').props.style)).toMatchObject({ width: 320 });
  });

  it('keeps media inside an equally sized table cell', async () => {
    const renderers = createTopicTableRenderers({ minColumnWidth: 96, styles });
    const Table = renderers.table as React.ComponentType<any>;
    const Td = renderers.td as React.ComponentType<any>;
    const source = table([[cell('td', { id: 'label' }), cell('td', { id: 'media' })]]);
    const ContentWidthProbe = ({ testID }: { testID: string }) => (
      <View testID={testID} style={{ width: useForumContentWidth() }} />
    );
    const CellDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => {
      const availableWidth = useForumContentWidth();
      return (
        <View testID={`cell-${tnode.attributes.id}`} style={style}>
          {tnode.attributes.id === 'media' ? <View testID="table-media" style={{ width: availableWidth }} /> : null}
        </View>
      );
    };
    const TableDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => (
      <View testID="media-table" style={style}>
        {tnode.children[0]?.children[0]?.children.map((node, index, cells) => (
          <Td
            key={node.attributes.id}
            {...rendererProps(node, CellDefault, index, cells.length)}
            style={{ borderRightWidth: 1, paddingHorizontal: 10 }}
          />
        ))}
      </View>
    );

    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          <ContentWidthProbe testID="outside-table-media" />
          {semanticBoundary(<Table {...rendererProps(source, TableDefault)} />, { columns: 2 })}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    expect(StyleSheet.flatten(screen.getByTestId('media-table').props.style)).toMatchObject({ width: 320 });
    expect(StyleSheet.flatten(screen.getByTestId('cell-label').props.style)).toMatchObject({ width: 160 });
    expect(StyleSheet.flatten(screen.getByTestId('cell-media').props.style)).toMatchObject({ width: 160 });
    expect(StyleSheet.flatten(screen.getByTestId('table-media').props.style)).toMatchObject({ width: 140 });
    expect(StyleSheet.flatten(screen.getByTestId('outside-table-media').props.style)).toMatchObject({ width: 320 });
  });

  it('gives the table perimeter a single stroke owner', async () => {
    const renderers = createTopicTableRenderers({ minColumnWidth: 96, styles });
    const Table = renderers.table as React.ComponentType<any>;
    const Td = renderers.td as React.ComponentType<any>;
    const source = table([
      [cell('td', { id: 'top-left' }), cell('td', { id: 'top-right' })],
      [cell('td', { id: 'bottom-left' }), cell('td', { id: 'bottom-right' })]
    ]);
    const CellDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => (
      <View testID={`cell-${tnode.attributes.id}`} style={style} />
    );
    const TableDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => (
      <View testID="single-stroke-table" style={style}>
        {tnode.children[0]?.children.flatMap((row) =>
          row.children.map((node, index) => (
            <Td key={node.attributes.id} {...rendererProps(node, CellDefault, index, row.children.length)} />
          ))
        )}
      </View>
    );
    const fixture = (part: 'only' | 'first') => (
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {semanticBoundary(<Table {...rendererProps(source, TableDefault)} />, {
            columns: 2,
            part,
            semanticId: 'single-stroke'
          })}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    const screen = await render(fixture('only'));
    expect(StyleSheet.flatten(screen.getByTestId('cell-top-left').props.style)?.borderBottomWidth).not.toBe(0);
    expect(StyleSheet.flatten(screen.getByTestId('cell-bottom-left').props.style)).toMatchObject({
      borderBottomWidth: 0
    });
    expect(StyleSheet.flatten(screen.getByTestId('cell-bottom-right').props.style)).toMatchObject({
      borderBottomWidth: 0,
      borderRightWidth: 0
    });

    await screen.rerender(fixture('first'));
    expect(StyleSheet.flatten(screen.getByTestId('cell-bottom-left').props.style)?.borderBottomWidth).not.toBe(0);
  });

  it('scales minimum columns and bounds hostile colspan to 80 columns', async () => {
    const renderers = createTopicTableRenderers({ minColumnWidth: 120, styles });
    const Table = renderers.table as React.ComponentType<any>;
    const Td = renderers.td as React.ComponentType<any>;
    const source = table([[cell('td', { colspan: '80' }), cell('td', { colspan: '80' })]]);
    const CellDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => (
      <View
        testID={tnode === source.children[0]?.children[0]?.children[0] ? 'first-cell' : 'last-cell'}
        style={style}
      />
    );
    const TableDefault = ({ style, tnode }: { style?: StyleProp<ViewStyle>; tnode: TestNode }) => (
      <View testID="bounded-table" style={style}>
        {tnode.children[0]?.children[0]?.children.map((node, index, cells) => (
          <Td key={index} {...rendererProps(node, CellDefault, index, cells.length)} />
        ))}
      </View>
    );

    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {semanticBoundary(<Table {...rendererProps(source, TableDefault)} />, { columns: 80 })}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    expect(StyleSheet.flatten(screen.getByTestId('bounded-table').props.style)).toMatchObject({ width: 80 * 120 });
    expect(StyleSheet.flatten(screen.getByTestId('first-cell').props.style)).toMatchObject({ width: 79 * 120 });
    expect(StyleSheet.flatten(screen.getByTestId('last-cell').props.style)).toMatchObject({ width: 120 });
    expect(screen.getByTestId('topic-html-table-scroll').props).toMatchObject({
      accessibilityHint: '横向滑动查看更多',
      scrollEnabled: false
    });
  });

  it('gives table overflow one thresholded horizontal pan and a passive scroll owner', async () => {
    const renderers = createTopicTableRenderers({ minColumnWidth: 96, styles });
    const Table = renderers.table as React.ComponentType<any>;
    const source = table([[cell(), cell(), cell(), cell(), cell(), cell()]]);
    const TableDefault = ({ style }: { style?: StyleProp<ViewStyle> }) => <View testID="gesture-table" style={style} />;

    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {semanticBoundary(<Table {...rendererProps(source, TableDefault)} />, {
            columns: 6,
            semanticId: 'gesture-table'
          })}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );
    const scroll = screen.getByTestId('topic-html-table-scroll');

    expect(scroll.props.scrollEnabled).toBe(false);
    expect(scroll.props.gestureConfig).toMatchObject({
      enabled: true,
      manualActivation: true,
      maxPointers: 1
    });
    expect(scroll.props.gestureConfig).not.toHaveProperty('activeOffsetX');
    expect(scroll.props.gestureConfig).not.toHaveProperty('failOffsetY');
    expect(scroll.props.accessibilityActions).toEqual([
      { label: '向左滚动', name: 'decrement' },
      { label: '向右滚动', name: 'increment' }
    ]);

    mockAnimatedScrollTo.mockClear();
    await fireEvent(scroll, 'begin', {});
    await fireEvent(scroll, 'update', { translationX: -999, translationY: 0 });
    expect(mockAnimatedScrollTo).toHaveBeenLastCalledWith(expect.anything(), 256, 0, false);

    mockAnimatedScrollTo.mockClear();
    await fireEvent(scroll, 'begin', {});
    await fireEvent(scroll, 'update', { translationX: 0, translationY: 100 });
    expect(mockAnimatedScrollTo.mock.calls.every(([, x]) => x === 256)).toBe(true);

    await fireEvent(scroll, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(mockAnimatedScrollTo).toHaveBeenLastCalledWith(expect.anything(), 0, 0, false);
    await fireEvent(scroll, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(mockAnimatedScrollTo).toHaveBeenLastCalledWith(expect.anything(), 256, 0, false);

    await fireEvent(scroll, 'deactivate', { velocityX: -900 });
    expect(mockWithDecay).toHaveBeenCalledWith({ clamp: [0, 256], velocity: 900 });

    mockWithDecay.mockClear();
    await fireEvent(scroll, 'deactivate', { canceled: true, velocityX: -900 });
    expect(mockWithDecay).not.toHaveBeenCalled();
  });

  it('cancels native selection only after the horizontal pan claims the drag', async () => {
    const row = compileForumContent({ html: '<pre>const value = 1;</pre>', role: 'opening', source: 'nodeseek' })
      .rows[0]!;
    const screen = await render(
      <TopicSelectionSurface
        active
        items={[{ documentId: 'opening', rowKey: 'opening:code', selectionToken: row.selectionToken }]}
        listRef={{ current: { getAbsoluteLastScrollOffset: () => 0, scrollToOffset: jest.fn() } }}
        sessionKey="nodeseek:topic-1:320:1:standard"
      >
        <TopicHorizontalScroll
          accessibilityLabel="代码块"
          contentWidth={640}
          semanticId="opening:code"
          testID="selection-owner-code-scroll"
          viewportWidth={320}
        >
          <View />
        </TopicHorizontalScroll>
      </TopicSelectionSurface>
    );

    const scroll = screen.getByTestId('selection-owner-code-scroll');
    const horizontalState = { activate: jest.fn(), fail: jest.fn() };
    mockCancelNativeSelection.mockClear();

    scroll.props.onTouchesDown?.(
      { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
      horizontalState
    );
    scroll.props.onTouchesMove?.(
      { allTouches: [{ absoluteX: 105, absoluteY: 201 }], numberOfTouches: 1 },
      horizontalState
    );

    expect(horizontalState.activate).toHaveBeenCalledTimes(1);
    expect(mockCancelNativeSelection).toHaveBeenCalledTimes(1);
    expect(mockPanGestures[0]?.config.block).toBe(mockNativeGestures[0]);

    const verticalState = { activate: jest.fn(), fail: jest.fn() };
    scroll.props.onTouchesDown?.(
      { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
      verticalState
    );
    scroll.props.onTouchesMove?.(
      { allTouches: [{ absoluteX: 101, absoluteY: 220 }], numberOfTouches: 1 },
      verticalState
    );

    expect(verticalState.fail).toHaveBeenCalledTimes(1);
    expect(mockCancelNativeSelection).toHaveBeenCalledTimes(1);
  });

  it('claims a deliberate horizontal drag before native text selection can own it', async () => {
    const renderers = createTopicTableRenderers({ minColumnWidth: 96, styles });
    const Table = renderers.table as React.ComponentType<any>;
    const source = table([[cell(), cell(), cell(), cell(), cell(), cell()]]);
    const TableDefault = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={style} />;
    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {semanticBoundary(<Table {...rendererProps(source, TableDefault)} />, {
            columns: 6,
            semanticId: 'selection-race-table'
          })}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );
    const scroll = screen.getByTestId('topic-html-table-scroll');
    const stateManager = { activate: jest.fn(), fail: jest.fn() };

    scroll.props.onTouchesDown?.(
      { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
      stateManager
    );
    scroll.props.onTouchesMove?.(
      { allTouches: [{ absoluteX: 105, absoluteY: 201 }], numberOfTouches: 1 },
      stateManager
    );

    expect(scroll.props.gestureConfig).toMatchObject({ manualActivation: true, maxPointers: 1 });
    expect(stateManager.activate).toHaveBeenCalledTimes(1);
    expect(stateManager.fail).not.toHaveBeenCalled();

    scroll.props.onTouchesMove?.(
      { allTouches: [{ absoluteX: 105, absoluteY: 220 }], numberOfTouches: 1 },
      stateManager
    );
    expect(stateManager.activate).toHaveBeenCalledTimes(1);
    expect(stateManager.fail).not.toHaveBeenCalled();

    const belowLock = { activate: jest.fn(), fail: jest.fn() };
    scroll.props.onTouchesDown?.({ allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 }, belowLock);
    scroll.props.onTouchesMove?.({ allTouches: [{ absoluteX: 103, absoluteY: 203 }], numberOfTouches: 1 }, belowLock);
    expect(belowLock.activate).not.toHaveBeenCalled();
    expect(belowLock.fail).not.toHaveBeenCalled();

    for (const { x, y } of [
      { x: 102, y: 205 },
      { x: 104, y: 204 }
    ]) {
      const verticalOwner = { activate: jest.fn(), fail: jest.fn() };
      scroll.props.onTouchesDown?.(
        { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
        verticalOwner
      );
      scroll.props.onTouchesMove?.({ allTouches: [{ absoluteX: x, absoluteY: y }], numberOfTouches: 1 }, verticalOwner);
      expect(verticalOwner.activate).not.toHaveBeenCalled();
      expect(verticalOwner.fail).toHaveBeenCalledTimes(1);
    }

    const extraPointer = { activate: jest.fn(), fail: jest.fn() };
    scroll.props.onTouchesDown?.(
      { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
      extraPointer
    );
    scroll.props.onTouchesMove?.(
      {
        allTouches: [
          { absoluteX: 105, absoluteY: 201 },
          { absoluteX: 140, absoluteY: 240 }
        ],
        numberOfTouches: 2
      },
      extraPointer
    );
    expect(extraPointer.activate).not.toHaveBeenCalled();
    expect(extraPointer.fail).toHaveBeenCalledTimes(1);

    for (const invalidStart of [
      {
        allTouches: [
          { absoluteX: 100, absoluteY: 200 },
          { absoluteX: 140, absoluteY: 240 }
        ],
        numberOfTouches: 2
      },
      { allTouches: [], numberOfTouches: 1 }
    ]) {
      const invalidStartOwner = { activate: jest.fn(), fail: jest.fn() };
      scroll.props.onTouchesDown?.(invalidStart, invalidStartOwner);
      expect(invalidStartOwner.activate).not.toHaveBeenCalled();
      expect(invalidStartOwner.fail).toHaveBeenCalledTimes(1);
    }

    const missingMove = { activate: jest.fn(), fail: jest.fn() };
    scroll.props.onTouchesDown?.({ allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 }, missingMove);
    scroll.props.onTouchesMove?.({ allTouches: [], numberOfTouches: 1 }, missingMove);
    expect(missingMove.activate).not.toHaveBeenCalled();
    expect(missingMove.fail).toHaveBeenCalledTimes(1);

    const latePointer = { activate: jest.fn(), fail: jest.fn() };
    scroll.props.onTouchesDown?.({ allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 }, latePointer);
    scroll.props.onTouchesMove?.({ allTouches: [{ absoluteX: 105, absoluteY: 201 }], numberOfTouches: 1 }, latePointer);
    scroll.props.onTouchesMove?.(
      {
        allTouches: [
          { absoluteX: 106, absoluteY: 201 },
          { absoluteX: 140, absoluteY: 240 }
        ],
        numberOfTouches: 2
      },
      latePointer
    );
    expect(latePointer.activate).toHaveBeenCalledTimes(1);
    expect(latePointer.fail).toHaveBeenCalledTimes(1);
  });

  it('leaves a non-overflowing horizontal region unowned', async () => {
    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          <TopicHorizontalScroll
            accessibilityLabel="测试区域"
            contentWidth={320}
            semanticId="non-overflow"
            testID="non-overflow-scroll"
            viewportWidth={320}
          >
            <View />
          </TopicHorizontalScroll>
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );
    const scroll = screen.getByTestId('non-overflow-scroll');
    const stateManager = { activate: jest.fn(), fail: jest.fn() };

    scroll.props.onTouchesDown?.(
      { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
      stateManager
    );

    expect(stateManager.activate).not.toHaveBeenCalled();
    expect(stateManager.fail).toHaveBeenCalledTimes(1);
  });

  it('keeps split table geometry continuous and shares one horizontal offset', async () => {
    const renderers = createTopicTableRenderers({ minColumnWidth: 96, styles });
    const Table = renderers.table as React.ComponentType<any>;
    const source = table([[cell(), cell(), cell(), cell(), cell(), cell()]]);
    const TableDefault = ({ style }: { style?: StyleProp<ViewStyle> }) => <View testID="split-table" style={style} />;
    const pair = (showLast: boolean) => (
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="opening">
          {semanticBoundary(<Table {...rendererProps(source, TableDefault)} />, {
            columns: 6,
            part: 'first',
            semanticId: 'v2ex-table'
          })}
          {showLast
            ? semanticBoundary(<Table {...rendererProps(source, TableDefault)} />, {
                columns: 6,
                part: 'last',
                semanticId: 'v2ex-table'
              })
            : null}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    const screen = await render(pair(true));
    const scrolls = screen.getAllByTestId('topic-html-table-scroll');
    const frames = screen.getAllByTestId('topic-html-table-frame');
    expect(screen.getAllByTestId('split-table').map((node) => StyleSheet.flatten(node.props.style)?.width)).toEqual([
      576, 576
    ]);
    expect(StyleSheet.flatten(frames[0].props.style)).toMatchObject({
      borderBottomWidth: 0,
      borderTopLeftRadius: 8,
      borderTopWidth: 1
    });
    expect(StyleSheet.flatten(frames[1].props.style)).toMatchObject({
      borderBottomLeftRadius: 8,
      borderBottomWidth: 1,
      borderTopWidth: 0
    });
    expect(scrolls[0].props.showsHorizontalScrollIndicator).toBe(false);
    expect(scrolls[1].props.showsHorizontalScrollIndicator).toBe(true);

    mockAnimatedScrollTo.mockClear();
    await fireEvent(scrolls[0], 'begin', {});
    await fireEvent(scrolls[0], 'update', { translationX: -120 });
    expect(mockAnimatedScrollTo.mock.calls.filter(([, x]) => x === 120)).toHaveLength(2);
    await screen.rerender(pair(false));
    mockAnimatedScrollTo.mockClear();
    await screen.rerender(pair(true));
    expect(
      mockAnimatedScrollTo.mock.calls.some(([, x, y, animated]) => x === 120 && y === 0 && animated === false)
    ).toBe(true);
  });

  it('renders 240 selectable code lines with the shared pan policy', async () => {
    const lines = Array.from({ length: 240 }, (_, index) => `line-${index + 1}:${'x'.repeat(90)}\n`);
    const rows = compileForumContent({
      html: `<pre>${lines.join('')}</pre>`,
      role: 'reply',
      source: 'linuxdo'
    }).rows.filter((row): row is Extract<CompiledForumContentRow, { type: 'codeBlock' }> => row.type === 'codeBlock');
    expect(rows).toHaveLength(1);
    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="reply:9:body">
          <TopicContentBlock contentWidth={320} row={rows[0]} />
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    expect(screen.getAllByTestId('topic-code-frame')).toHaveLength(1);
    const codeScroll = screen.getByTestId('topic-code-scroll');
    expect(codeScroll.props.scrollEnabled).toBe(false);
    expect(codeScroll.props.gestureConfig).toMatchObject({
      enabled: true,
      manualActivation: true,
      maxPointers: 1
    });
    expect(mockNativeGestures).toHaveLength(1);
    expect(mockPanGestures[0]?.config.block).toBe(mockNativeGestures[0]);
    const nativeBinding = mockGestureDetectorBindings.find(({ gesture }) => gesture === mockNativeGestures[0]);
    expect(nativeBinding?.child.type).toBe(View);
    expect(nativeBinding?.child.props.collapsable).toBe(false);
    expect(nativeBinding?.child.props.children).toMatchObject({ props: { testID: 'topic-code-frame' } });
    await fireEvent(codeScroll, 'contentSizeChange', 960, 21);
    const stateManager = { activate: jest.fn(), fail: jest.fn() };
    codeScroll.props.onTouchesDown?.(
      { allTouches: [{ absoluteX: 100, absoluteY: 200 }], numberOfTouches: 1 },
      stateManager
    );
    codeScroll.props.onTouchesMove?.(
      { allTouches: [{ absoluteX: 105, absoluteY: 201 }], numberOfTouches: 1 },
      stateManager
    );
    expect(stateManager.activate).toHaveBeenCalledTimes(1);
    expect(stateManager.fail).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: '复制完整代码' })).toHaveLength(1);
    expect(rows[0]).toMatchObject({ copyText: lines.join(''), part: 'only', segmentIndex: 0, text: lines.join('') });
    expect(JSON.stringify(screen.toJSON())).toContain('line-1:');
    expect(JSON.stringify(screen.toJSON())).toContain('line-240:');
    expect(JSON.stringify(screen.toJSON())).toContain('"selectable":true');
  });

  it('keeps the LinuxDo 52-line decorated pre in one native code frame', async () => {
    const html = `<pre>${Array.from(
      { length: 52 },
      (_, index) => `<span data-line="${index + 1}">line-${String(index + 1).padStart(2, '0')}</span>\n`
    ).join('')}</pre>`;
    const rows = compileForumContent({ html, role: 'reply', source: 'linuxdo' }).rows;
    const code = rows[0];
    if (!code || code.type !== 'codeBlock') throw new Error('Expected one semantic code block.');

    const screen = await render(
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="reply:9:body">
          <TopicContentBlock contentWidth={320} query="line-52" row={code} />
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );

    expect(screen.getAllByTestId('topic-code-frame')).toHaveLength(1);
    expect(JSON.stringify(screen.toJSON())).toContain('line-01');
    expect(JSON.stringify(screen.toJSON())).toContain('line-52');
    expect(StyleSheet.flatten(screen.getByText('line-52').props.style)?.backgroundColor).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain('"selectable":true');
  });

  it('lets reply ownership disable native selection for code and disclosure text', async () => {
    const screen = await render(
      <CompiledContentFixture
        html="<details><summary>Summary</summary><p>body</p></details><pre>code</pre>"
        selectable={false}
        source="linuxdo"
      />
    );

    const tree = JSON.stringify(screen.toJSON());
    expect(tree).toContain('"selectable":false');
    expect(tree).not.toContain('"selectable":true');
  });
});
