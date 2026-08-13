import { describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { ScrollView, StyleSheet, ToastAndroid, View, type StyleProp, type ViewStyle } from 'react-native';
import { compileForumContent, type CompiledForumContentRow } from '@/domain/forum/topicContentSplit';
import { TopicContentBlock } from '@/features/topic/components/TopicContentBlock';
import {
  createTopicTableRenderers,
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

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));

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

  it('[REG-TOPIC-089][REG-TOPIC-090] exposes one complete copy action for split plain code and reports failure', async () => {
    const copy = jest.mocked(Clipboard.setStringAsync);
    copy.mockClear();
    copy.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const sourceText = Array.from({ length: 180 }, (_, index) => `line-${index + 1}:${'x'.repeat(80)}`).join('\n');
    const screen = await render(<CompiledContentFixture html={`<pre>${sourceText}</pre>`} source="linuxdo" />);

    expect(screen.getAllByTestId('topic-code-frame').length).toBeGreaterThan(1);
    expect(screen.getAllByRole('button', { name: '复制完整代码' })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: '复制完整代码' }));
    expect(copy).toHaveBeenCalledWith(sourceText);
    expect(toast).toHaveBeenCalledWith('复制失败', ToastAndroid.SHORT);
    toast.mockRestore();
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
      scrollEnabled: true
    });
  });

  it('[REG-TOPIC-084] keeps split table geometry continuous and restores one horizontal offset', async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => undefined);
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

    await fireEvent.scroll(scrolls[0], { nativeEvent: { contentOffset: { x: 120, y: 0 } } });
    expect(scrollTo).toHaveBeenCalledWith({ animated: false, x: 120 });
    await screen.rerender(pair(false));
    await screen.rerender(pair(true));
    await fireEvent(screen.getAllByTestId('topic-html-table-scroll')[1], 'contentSizeChange', 576, 100);
    expect(
      scrollTo.mock.calls.filter(([value]) => typeof value === 'object' && value?.x === 120).length
    ).toBeGreaterThanOrEqual(2);
    scrollTo.mockRestore();
  });

  it('[REG-TOPIC-086/088] renders compiler code segments as one frame identity and shared offset', async () => {
    const lines = Array.from({ length: 240 }, (_, index) => `line-${index + 1}:${'x'.repeat(90)}\n`);
    const rows = compileForumContent({
      html: `<pre>${lines.join('')}</pre>`,
      role: 'reply',
      source: 'linuxdo'
    }).rows.filter((row): row is Extract<CompiledForumContentRow, { type: 'codeBlock' }> => row.type === 'codeBlock');
    expect(rows.length).toBeGreaterThan(1);
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo').mockImplementation(() => undefined);
    const pair = (showLast: boolean) => (
      <TopicTableScrollProvider>
        <TopicSplitDisclosureScope scopeKey="reply:9:body">
          <TopicContentBlock contentWidth={320} row={rows[0]} />
          {showLast ? <TopicContentBlock contentWidth={320} row={rows.at(-1)!} /> : null}
        </TopicSplitDisclosureScope>
      </TopicTableScrollProvider>
    );
    const screen = await render(pair(true));
    const frames = screen.getAllByTestId('topic-code-frame');
    const scrolls = screen.getAllByTestId('topic-code-scroll');
    expect(StyleSheet.flatten(frames[0].props.style)).toMatchObject({
      borderBottomWidth: 0,
      borderTopLeftRadius: 10
    });
    expect(StyleSheet.flatten(frames[1].props.style)).toMatchObject({
      borderBottomLeftRadius: 10,
      borderTopWidth: 0
    });
    expect(scrolls[0].props.showsHorizontalScrollIndicator).toBe(false);
    expect(scrolls[1].props.showsHorizontalScrollIndicator).toBe(true);
    expect(JSON.stringify(screen.toJSON())).toContain('line-1:');
    expect(JSON.stringify(screen.toJSON())).toContain('line-240:');

    await fireEvent.scroll(scrolls[0], { nativeEvent: { contentOffset: { x: 84, y: 0 } } });
    expect(scrollTo).toHaveBeenCalledWith({ animated: false, x: 84 });
    await screen.rerender(pair(false));
    await screen.rerender(pair(true));
    await fireEvent(screen.getAllByTestId('topic-code-scroll')[1], 'contentSizeChange', 640, 100);
    expect(
      scrollTo.mock.calls.filter(([value]) => typeof value === 'object' && value?.x === 84).length
    ).toBeGreaterThanOrEqual(2);
    scrollTo.mockRestore();
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
