import { requireNativeViewManager } from 'expo-modules-core';
import {
  createContext,
  type ComponentType,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef
} from 'react';
import { type NativeSyntheticEvent, Platform, StyleSheet, View, type ViewProps } from 'react-native';

export type TopicSelectionItem = Readonly<{
  documentId: 'opening';
  rowKey: string;
  selectionToken: string;
}>;

type NativeSelectionRow = TopicSelectionItem & { nativeId: string };

type NativeForumSelectionProps = {
  accessible: boolean;
  children: ReactNode;
  enabled: boolean;
  revision: string;
  rows: readonly NativeSelectionRow[];
  style: ViewProps['style'];
  testID?: string;
  onAutoScroll?: (event: NativeSyntheticEvent<{ delta: number }>) => void;
};

type NativeForumSelectionRef = View & { cancelSelection?: () => void };

let NativeForumSelection: ComponentType<
  NativeForumSelectionProps & { ref?: RefObject<NativeForumSelectionRef | null> }
> | null = null;
if (Platform.OS === 'android') {
  try {
    NativeForumSelection = requireNativeViewManager<NativeForumSelectionProps>('ForumContentSelection');
  } catch {
    // The stable per-TextView and reply-copy paths remain available without the optional native module.
  }
}

type TopicSelectionContextValue = {
  cancelSelection: (() => void) | null;
  enabled: boolean;
  sessionKey: string;
};

const TopicSelectionContext = createContext<TopicSelectionContextValue>({
  cancelSelection: null,
  enabled: false,
  sessionKey: ''
});
const TopicSelectionRowContext = createContext(false);

function hashRevision(parts: readonly string[]) {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function nativeRowsFor(sessionKey: string, items: readonly TopicSelectionItem[]) {
  const seen = new Set<string>();
  const rows: NativeSelectionRow[] = [];
  let valid = true;
  for (const item of items) {
    if (!item.rowKey || seen.has(item.rowKey)) valid = false;
    seen.add(item.rowKey);
    const nativeId = `topic-selection-${hashRevision([sessionKey, item.rowKey])}`;
    rows.push({ ...item, nativeId });
  }
  return { rows, valid } as const;
}

export function TopicSelectionSurface({
  active: routeActive,
  children,
  items,
  listRef,
  sessionKey
}: {
  active: boolean;
  children: ReactNode;
  items: readonly TopicSelectionItem[];
  listRef: RefObject<{
    getAbsoluteLastScrollOffset: () => number;
    scrollToOffset: (options: { animated: boolean; offset: number }) => void;
  } | null>;
  sessionKey: string;
}) {
  const snapshot = useMemo(() => nativeRowsFor(sessionKey, items), [items, sessionKey]);
  const revision = useMemo(
    () =>
      `${sessionKey}:${hashRevision(snapshot.rows.flatMap((row) => [row.documentId, row.rowKey, row.selectionToken]))}`,
    [sessionKey, snapshot.rows]
  );
  const nativeRef = useRef<NativeForumSelectionRef | null>(null);
  const nativeEnabled = Boolean(
    Platform.OS === 'android' && NativeForumSelection && routeActive && snapshot.valid && snapshot.rows.length > 0
  );
  const cancelSelection = useCallback(() => nativeRef.current?.cancelSelection?.(), []);

  useEffect(() => {
    cancelSelection();
  }, [cancelSelection, revision, routeActive]);

  const onAutoScroll = useCallback(
    ({ nativeEvent }: NativeSyntheticEvent<{ delta: number }>) => {
      const list = listRef.current;
      const currentOffset = list?.getAbsoluteLastScrollOffset();
      if (
        !list ||
        typeof currentOffset !== 'number' ||
        !Number.isFinite(currentOffset) ||
        !Number.isFinite(nativeEvent.delta)
      )
        return;
      list.scrollToOffset({
        animated: false,
        offset: Math.max(0, currentOffset + nativeEvent.delta)
      });
    },
    [listRef]
  );
  const context = useMemo(
    () => ({ cancelSelection: nativeEnabled ? cancelSelection : null, enabled: nativeEnabled, sessionKey }),
    [cancelSelection, nativeEnabled, sessionKey]
  );

  if (Platform.OS !== 'android' || !NativeForumSelection) {
    return <TopicSelectionContext.Provider value={context}>{children}</TopicSelectionContext.Provider>;
  }

  return (
    <TopicSelectionContext.Provider value={context}>
      <NativeForumSelection
        ref={nativeRef}
        accessible={false}
        enabled={nativeEnabled}
        revision={revision}
        rows={snapshot.valid ? snapshot.rows : []}
        style={styles.fill}
        testID="topic-selection-surface"
        onAutoScroll={onAutoScroll}
      >
        <View accessible={false} style={styles.fill} testID="topic-selection-content">
          {children}
        </View>
      </NativeForumSelection>
    </TopicSelectionContext.Provider>
  );
}

export function useTopicSelectionCancel() {
  return useContext(TopicSelectionContext).cancelSelection;
}

export function useTopicSelectionRowRef(rowKey?: string) {
  const { enabled, sessionKey } = useContext(TopicSelectionContext);
  const ref = useRef<View>(null);
  return {
    active: enabled,
    nativeID: enabled && rowKey ? `topic-selection-${hashRevision([sessionKey, rowKey])}` : undefined,
    ref
  };
}

export function TopicSelectionRowProvider({ active, children }: { active: boolean; children: ReactNode }) {
  return <TopicSelectionRowContext.Provider value={active}>{children}</TopicSelectionRowContext.Provider>;
}

export function useTopicSelectionRowActive() {
  return useContext(TopicSelectionRowContext);
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
