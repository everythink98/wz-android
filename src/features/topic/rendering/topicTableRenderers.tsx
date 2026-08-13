import { createContext, type ComponentRef, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  makeMutable,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useSharedValue,
  withDecay,
  type SharedValue
} from 'react-native-reanimated';
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
type TopicTableScrollStore = {
  offsets: Map<string, SharedValue<number>>;
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
  const store = useMemo<TopicTableScrollStore>(() => ({ offsets: new Map() }), []);
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

function useTopicHorizontalOffset(semanticId: string) {
  const scopeKey = useTopicSplitDisclosureScopeKey();
  const store = useContext(TopicTableScrollContext);
  const localOffset = useSharedValue(0);
  const syncKey = store && scopeKey && semanticId ? `${scopeKey}\u0000${semanticId}` : '';
  return useMemo(() => {
    if (!store || !syncKey) return localOffset;
    const current = store.offsets.get(syncKey) || makeMutable(0);
    store.offsets.set(syncKey, current);
    return current;
  }, [localOffset, store, syncKey]);
}

export function TopicHorizontalScroll({
  accessibilityHint = '横向滑动查看更多',
  accessibilityLabel,
  children,
  contentContainerStyle,
  contentWidth,
  enabled = true,
  semanticId,
  showsHorizontalScrollIndicator = true,
  style,
  testID,
  viewportWidth
}: {
  accessibilityHint?: string;
  accessibilityLabel: string;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  contentWidth?: number;
  enabled?: boolean;
  semanticId: string;
  showsHorizontalScrollIndicator?: boolean;
  style?: StyleProp<ViewStyle>;
  testID: string;
  viewportWidth: number;
}) {
  const offset = useTopicHorizontalOffset(semanticId);
  const initialMaximum = contentWidth === undefined ? 0 : Math.max(0, contentWidth - viewportWidth);
  const maximumOffset = useSharedValue(initialMaximum);
  const gestureStartOffset = useSharedValue(0);
  const scrollViewRef = useAnimatedRef<ComponentRef<typeof Animated.ScrollView>>();

  useAnimatedReaction(
    () => offset.value,
    (currentOffset, previousOffset) => {
      if (currentOffset !== 0 || previousOffset !== null) scrollTo(scrollViewRef, currentOffset, 0, false);
    },
    [offset, scrollViewRef]
  );

  const horizontalPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled)
        .maxPointers(1)
        .activeOffsetX([-10, 10])
        .failOffsetY([-10, 10])
        .onBegin(() => {
          'worklet';
          cancelAnimation(offset);
          gestureStartOffset.value = offset.value;
        })
        .onUpdate((event) => {
          'worklet';
          offset.value = Math.max(0, Math.min(maximumOffset.value, gestureStartOffset.value - event.translationX));
        })
        .onEnd((event) => {
          'worklet';
          offset.value = withDecay({ clamp: [0, maximumOffset.value], velocity: -event.velocityX });
        }),
    [enabled, gestureStartOffset, maximumOffset, offset]
  );
  const handleContentSizeChange = useCallback(
    (width: number) => {
      const maximum = Number.isFinite(width) ? Math.max(0, width - viewportWidth) : 0;
      maximumOffset.value = maximum;
      if (offset.value > maximum) offset.value = maximum;
    },
    [maximumOffset, offset, viewportWidth]
  );
  const handleAccessibilityAction = useCallback(
    ({ nativeEvent }: AccessibilityActionEvent) => {
      const direction = nativeEvent.actionName === 'increment' ? 1 : nativeEvent.actionName === 'decrement' ? -1 : 0;
      if (!direction) return;
      const step = Math.max(48, viewportWidth * 0.8);
      offset.value = Math.max(0, Math.min(maximumOffset.value, offset.value + direction * step));
    },
    [maximumOffset, offset, viewportWidth]
  );
  return (
    <GestureDetector gesture={horizontalPan}>
      <Animated.ScrollView
        ref={scrollViewRef}
        accessibilityActions={
          enabled
            ? [
                { label: '向左滚动', name: 'decrement' },
                { label: '向右滚动', name: 'increment' }
              ]
            : undefined
        }
        accessibilityHint={enabled ? accessibilityHint : undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={enabled ? 'adjustable' : undefined}
        contentContainerStyle={contentContainerStyle}
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={enabled && showsHorizontalScrollIndicator}
        style={style}
        testID={testID}
        onAccessibilityAction={handleAccessibilityAction}
        onContentSizeChange={handleContentSizeChange}
      >
        {children}
      </Animated.ScrollView>
    </GestureDetector>
  );
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
    const overflow = tableWidth > safeContentWidth + StyleSheet.hairlineWidth;
    const frameStyle = StyleSheet.flatten(styles.htmlTableFrame) as ViewStyle;

    return (
      <TopicHorizontalScroll
        accessibilityLabel="表格"
        contentContainerStyle={[styles.htmlTableScrollContent, { width: tableWidth }]}
        contentWidth={tableWidth}
        enabled={overflow}
        semanticId={semantic?.semanticId || ''}
        showsHorizontalScrollIndicator={overflow && (part === 'only' || part === 'last')}
        style={styles.htmlTableScroll}
        testID="topic-html-table-scroll"
        viewportWidth={safeContentWidth}
      >
        <View
          style={[styles.htmlTableFrame, frameContinuationStyle(part, frameStyle), { width: tableWidth }]}
          testID="topic-html-table-frame"
        >
          <TopicTableLayoutContext.Provider value={{ columns, unitWidth: tableWidth / columns }}>
            <TDefaultRenderer {...props} style={[props.style, { width: tableWidth }]} />
          </TopicTableLayoutContext.Provider>
        </View>
      </TopicHorizontalScroll>
    );
  };

  return { table: TableRenderer, td: CellRenderer, th: CellRenderer };
}
