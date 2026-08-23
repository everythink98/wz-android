import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { StyleSheet, ToastAndroid, View, type StyleProp, type ViewStyle } from 'react-native';
import { compileForumContent, type CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import {
  createTopicTableRenderers,
  TopicHorizontalScroll,
  TopicTableScrollProvider,
  TopicTableSemanticBoundary
} from '@/features/topic/rendering/topicTableRenderers';
import {
  TopicSplitDisclosureProvider,
  TopicSplitDisclosureScope,
  topicSemanticRowVisible,
  useTopicSplitDisclosureStore
} from '@/features/topic/rendering/TopicSplitDisclosure';
import { fireEvent, render } from '../render';

type MockPanGesture = {
  config: Record<string, unknown>;
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
const mockAnimatedScrollTo = jest.fn();
const mockWithDecay = jest.fn(({ clamp }: { clamp: [number, number] }) => clamp[0]);

beforeEach(() => {
  mockPanGestures = [];
  mockNativeGestures = [];
  mockGestureDetectorBindings = [];
  mockAnimatedReactionRunners = [];
  mockAnimatedScrollTo.mockClear();
  mockWithDecay.mockClear();
});

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  const native = () => {
    const gesture: MockPanGesture = { config: {}, handlers: {} };
    mockNativeGestures.push(gesture);
    return gesture;
  };
  const pan = () => {
    const gesture: MockPanGesture & Record<string, any> = { config: {}, handlers: {} };
    for (const name of ['activeOffsetX', 'enabled', 'failOffsetY', 'manualActivation', 'maxPointers']) {
      gesture[name] = (value: unknown) => {
        gesture.config[name] = value;
        return gesture;
      };
    }
    for (const name of ['onBegin', 'onEnd', 'onTouchesDown', 'onTouchesMove', 'onUpdate']) {
      gesture[name] = (handler: (...args: any[]) => void) => {
        gesture.handlers[name] = handler;
        return gesture;
      };
    }
    gesture.blocksExternalGesture = (...gestures: MockPanGesture[]) => {
      gesture.config.blocksExternalGesture = gestures;
      return gesture;
    };
    mockPanGestures.push(gesture);
    return gesture;
  };
  return {
    Gesture: { Native: native, Pan: pan },
    GestureDetector: ({
      children,
      gesture
    }: {
      children: React.ReactElement<Record<string, unknown>>;
      gesture: MockPanGesture;
    }) => {
      mockGestureDetectorBindings.push({ child: children, gesture });
      return ReactModule.cloneElement(children, { ...gesture.handlers, gestureConfig: gesture.config });
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

function CompiledContentFixture({ html, source = 'nodeseek' }: { html: string; source?: 'linuxdo' | 'nodeseek' }) {
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
              <TopicContentBlock key={row.keySuffix} contentWidth={320} row={row} />
            ))}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    </TopicSplitDisclosureProvider>
  );
}

describe('native topic structured rendering', () => {
  it('[REG-TOPIC-090][REG-A11Y-001] renders route-owned tabs and copies the complete styled terminal owner', async () => {
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

  it('[REG-TOPIC-089][REG-TOPIC-090][REG-TOPIC-093] exposes one complete code frame and reports copy failure', async () => {
    const copy = jest.mocked(Clipboard.setStringAsync);
    copy.mockClear();
    copy.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const sourceText = Array.from({ length: 180 }, (_, index) => `line-${index + 1}:${'x'.repeat(80)}`).join('\n');
    const screen = await render(<CompiledContentFixture html={`<pre>${sourceText}</pre>`} source="linuxdo" />);

    expect(screen.getAllByTestId('topic-code-frame')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '复制完整代码' })).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByTestId('topic-code-frame').props.style)).toMatchObject({
      backgroundColor: '#F0F0F0',
      borderRadius: 10,
      minWidth: 320,
      padding: 14,
      paddingRight: 68
    });
    expect(StyleSheet.flatten(screen.getByRole('button', { name: '复制完整代码' }).props.style)).toMatchObject({
      backgroundColor: '#FCFCFC',
      borderRadius: 8,
      minHeight: 48,
      minWidth: 48,
      right: 6,
      top: 6
    });
    expect(screen.queryByText('复制')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '复制完整代码' }));
    expect(copy).toHaveBeenCalledWith(sourceText);
    expect(toast).toHaveBeenCalledWith('复制失败', ToastAndroid.SHORT);
    toast.mockRestore();
  });

  it('[REG-TOPIC-093] presents blockquotes as one continuous reading rail', async () => {
    const screen = await render(
      <CompiledContentFixture html="<blockquote><p>quoted community content</p></blockquote>" />
    );

    expect(StyleSheet.flatten(screen.getByTestId('topic-blockquote-frame').props.style)).toMatchObject({
      borderLeftColor: '#1677FF',
      borderLeftWidth: 3,
      marginBottom: 12,
      marginTop: 12,
      paddingBottom: 4,
      paddingLeft: 12,
      paddingRight: 4,
      paddingTop: 4
    });
    expect(StyleSheet.flatten(screen.getByTestId('topic-blockquote-frame').props.style)).not.toHaveProperty(
      'backgroundColor'
    );
  });

  it('[REG-TOPIC-084] fills narrow NodeSeek tables and honors colspan', async () => {
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

  it('[REG-TOPIC-084] scales minimum columns and bounds hostile colspan to 80 columns', async () => {
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

  it('[REG-TOPIC-094] gives table overflow one thresholded horizontal pan and a passive scroll owner', async () => {
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

    await fireEvent(scroll, 'end', { velocityX: -900 });
    expect(mockWithDecay).toHaveBeenCalledWith({ clamp: [0, 256], velocity: 900 });
  });

  it('[REG-TOPIC-097] claims a deliberate horizontal drag before native text selection can own it', async () => {
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

  it('[REG-TOPIC-097] leaves a non-overflowing horizontal region unowned', async () => {
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

  it('[REG-TOPIC-084][REG-TOPIC-094] keeps split table geometry continuous and shares one horizontal offset', async () => {
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

  it('[REG-TOPIC-086/088/093/094/097/098] renders 240 selectable code lines with the shared pan policy', async () => {
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
    expect(mockPanGestures[0]?.config.blocksExternalGesture).toEqual([mockNativeGestures[0]]);
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

  it('[REG-TOPIC-088] keeps the LinuxDo 52-line decorated pre in one native code frame', async () => {
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
});
