import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { useContentWidth, type CustomBlockRenderer } from 'react-native-render-html';
import type { ForumContentPart } from '@/domain/forum/topicContentSplit';
import type { HtmlRenderers } from './types';
import { useTopicSplitDisclosureScopeKey } from './TopicSplitDisclosure';

const MAX_TABLE_COLUMNS = 80;

type TopicTableNode = {
  attributes?: Readonly<Record<string, string | undefined>>;
  children?: readonly unknown[];
  parent?: TopicTableNode | null;
  tagName?: string | null;
};
type TopicTableScrollHandle = Pick<ScrollView, 'scrollTo'>;
type TopicTableScrollStore = {
  offsets: Map<string, number>;
  views: Map<string, Set<TopicTableScrollHandle>>;
};
type TopicTableRendererStyles = {
  htmlTableFrame: StyleProp<ViewStyle>;
  htmlTableScroll: StyleProp<ViewStyle>;
  htmlTableScrollContent: StyleProp<ViewStyle>;
};
type TopicTableSemanticIdentity = {
  columns: number;
  part: ForumContentPart;
  semanticId: string;
};

const TopicTableLayoutContext = createContext<{ columns: number; unitWidth: number } | null>(null);
const TopicTableSemanticContext = createContext<TopicTableSemanticIdentity | null>(null);
const TopicTableScrollContext = createContext<TopicTableScrollStore | null>(null);

export function TopicTableScrollProvider({ children }: { children: ReactNode }) {
  const store = useMemo<TopicTableScrollStore>(() => ({ offsets: new Map(), views: new Map() }), []);
  return <TopicTableScrollContext.Provider value={store}>{children}</TopicTableScrollContext.Provider>;
}

export function TopicTableSemanticBoundary({
  children,
  columns,
  part,
  semanticId
}: TopicTableSemanticIdentity & { children: ReactNode }) {
  const value = useMemo(() => ({ columns, part, semanticId }), [columns, part, semanticId]);
  return <TopicTableSemanticContext.Provider value={value}>{children}</TopicTableSemanticContext.Provider>;
}

function normalizedSpan(value: string | undefined, maximum: number) {
  if (!value || !/^\d+$/.test(value)) return 1;
  return Math.min(Math.max(Number.parseInt(value, 10), 1), maximum);
}

function tableColumnCount(table: TopicTableNode) {
  let maximum = 0;
  const pending = [...(table.children || [])];
  while (pending.length) {
    const current = pending.pop() as TopicTableNode;
    const tagName = String(current.tagName || '').toLowerCase();
    if (tagName === 'table') continue;
    if (tagName === 'tr') {
      const columns = ((current.children || []) as readonly TopicTableNode[]).reduce<number>((total, child) => {
        const cellTagName = String(child.tagName || '').toLowerCase();
        return cellTagName === 'td' || cellTagName === 'th'
          ? total + normalizedSpan(child.attributes?.colspan, MAX_TABLE_COLUMNS)
          : total;
      }, 0);
      maximum = Math.max(maximum, columns);
      continue;
    }
    pending.push(...(current.children || []));
  }
  return Math.min(MAX_TABLE_COLUMNS, Math.max(1, maximum));
}

function tableCellSpan(node: TopicTableNode, columns: number) {
  const cells = ((node.parent?.children || []) as readonly TopicTableNode[]).filter((child) => {
    const tagName = String(child.tagName || '').toLowerCase();
    return tagName === 'td' || tagName === 'th';
  });
  const cellIndex = cells.indexOf(node);
  if (cellIndex < 0) return normalizedSpan(node.attributes?.colspan, columns);
  let usedColumns = 0;
  for (let index = 0; index <= cellIndex; index += 1) {
    const remainingCells = cells.length - index - 1;
    const availableColumns = Math.max(1, columns - usedColumns - remainingCells);
    const span = Math.min(normalizedSpan(cells[index]?.attributes?.colspan, columns), availableColumns);
    if (index === cellIndex) return span;
    usedColumns += span;
  }
  return 1;
}

function frameContinuationStyle(part: ForumContentPart, style: ViewStyle): ViewStyle {
  if (part === 'only') return {};
  const border = style.borderWidth ?? StyleSheet.hairlineWidth;
  const radius = style.borderRadius ?? 0;
  return {
    borderBottomLeftRadius: part === 'last' ? radius : 0,
    borderBottomRightRadius: part === 'last' ? radius : 0,
    borderBottomWidth: part === 'last' ? border : 0,
    borderLeftWidth: style.borderLeftWidth ?? border,
    borderRadius: 0,
    borderRightWidth: style.borderRightWidth ?? border,
    borderTopLeftRadius: part === 'first' ? radius : 0,
    borderTopRightRadius: part === 'first' ? radius : 0,
    borderTopWidth: part === 'first' ? border : 0,
    borderWidth: 0
  };
}

export function useTopicSynchronizedHorizontalScroll(semanticId: string, part: ForumContentPart) {
  const scopeKey = useTopicSplitDisclosureScopeKey();
  const store = useContext(TopicTableScrollContext);
  const scrollViewRef = useRef<ScrollView>(null);
  const syncKey = store && scopeKey && semanticId && part !== 'only' ? `${scopeKey}\u0000${semanticId}` : '';

  useEffect(() => {
    const view = scrollViewRef.current;
    if (!store || !syncKey || !view) return;
    const views = store.views.get(syncKey) || new Set<TopicTableScrollHandle>();
    views.add(view);
    store.views.set(syncKey, views);
    return () => {
      views.delete(view);
      if (!views.size) store.views.delete(syncKey);
    };
  }, [store, syncKey]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!store || !syncKey) return;
      const offset = event.nativeEvent.contentOffset.x;
      if (!Number.isFinite(offset) || offset < 0 || Math.abs((store.offsets.get(syncKey) || 0) - offset) <= 0.5) return;
      store.offsets.set(syncKey, offset);
      store.views.get(syncKey)?.forEach((view) => {
        if (view !== scrollViewRef.current) view.scrollTo({ animated: false, x: offset });
      });
    },
    [store, syncKey]
  );
  const restoreScroll = useCallback(() => {
    if (!store || !syncKey) return;
    const offset = store.offsets.get(syncKey);
    if (offset !== undefined) scrollViewRef.current?.scrollTo({ animated: false, x: offset });
  }, [store, syncKey]);

  return {
    contentOffset: { x: syncKey ? store?.offsets.get(syncKey) || 0 : 0, y: 0 },
    onScroll,
    restoreScroll,
    scrollViewRef
  };
}

export function createTopicTableRenderers({
  minColumnWidth,
  styles
}: {
  minColumnWidth: number;
  styles: TopicTableRendererStyles;
}): Pick<HtmlRenderers, 'table' | 'td' | 'th'> {
  const CellRenderer: CustomBlockRenderer = ({ TDefaultRenderer, ...props }) => {
    const layout = useContext(TopicTableLayoutContext);
    if (!layout) return <TDefaultRenderer {...props} />;
    const width = layout.unitWidth * tableCellSpan(props.tnode as TopicTableNode, layout.columns);
    return (
      <TDefaultRenderer
        {...props}
        style={[
          props.style,
          { flexBasis: width, flexGrow: 0, flexShrink: 0, width },
          props.renderIndex === props.renderLength - 1 ? { borderRightWidth: 0 } : undefined
        ]}
      />
    );
  };

  const TableRenderer: CustomBlockRenderer = ({ TDefaultRenderer, ...props }) => {
    const contentWidth = useContentWidth();
    const semantic = useContext(TopicTableSemanticContext);
    const part = semantic?.part || 'only';
    const columns = Math.min(
      MAX_TABLE_COLUMNS,
      Math.max(1, semantic?.columns || tableColumnCount(props.tnode as TopicTableNode))
    );
    const safeContentWidth = Number.isFinite(contentWidth) && contentWidth > 0 ? contentWidth : minColumnWidth;
    const tableWidth = Math.max(safeContentWidth, columns * Math.max(1, minColumnWidth));
    const horizontalScroll = useTopicSynchronizedHorizontalScroll(semantic?.semanticId || '', part);
    const overflow = tableWidth > safeContentWidth + StyleSheet.hairlineWidth;
    const frameStyle = StyleSheet.flatten(styles.htmlTableFrame) as ViewStyle;

    return (
      <ScrollView
        ref={horizontalScroll.scrollViewRef}
        accessibilityHint={overflow ? '横向滑动查看更多' : undefined}
        accessibilityLabel="表格"
        contentContainerStyle={[styles.htmlTableScrollContent, { width: tableWidth }]}
        contentOffset={horizontalScroll.contentOffset}
        horizontal
        nestedScrollEnabled
        scrollEnabled={overflow}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={overflow && (part === 'only' || part === 'last')}
        style={styles.htmlTableScroll}
        testID="topic-html-table-scroll"
        onContentSizeChange={horizontalScroll.restoreScroll}
        onScroll={horizontalScroll.onScroll}
      >
        <View
          style={[styles.htmlTableFrame, frameContinuationStyle(part, frameStyle), { width: tableWidth }]}
          testID="topic-html-table-frame"
        >
          <TopicTableLayoutContext.Provider value={{ columns, unitWidth: tableWidth / columns }}>
            <TDefaultRenderer {...props} style={[props.style, { width: tableWidth }]} />
          </TopicTableLayoutContext.Provider>
        </View>
      </ScrollView>
    );
  };

  return { table: TableRenderer, td: CellRenderer, th: CellRenderer };
}
