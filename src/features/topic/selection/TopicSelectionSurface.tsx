import { requireNativeViewManager } from 'expo-modules-core';
import {
  createContext,
  type ComponentType,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { type NativeSyntheticEvent, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import Animated, { cancelAnimation, type SharedValue, useEvent, useSharedValue } from 'react-native-reanimated';
import { useTopicSelectionBackReport } from '../useTopicRouteBeforeRemove';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { beginDiagnosticTrace, finishDiagnosticTrace, recordDiagnosticError } from '@/platform/diagnostics/diagnostics';
import type { DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';

export type TopicSelectionItem = Readonly<{
  documentId: 'opening';
  rowKey: string;
  selectionToken: string;
}>;

type NativeSelectionRow = TopicSelectionItem & { nativeId: string };
type SelectionDrag = { revision: string; dragId: number; active: boolean };
type SelectionHorizontalTarget = { offset: SharedValue<number>; maximum: SharedValue<number> };
type SelectionHorizontalScroll = { revision: string; dragId: number; targetId: string; offsetDp: number };
type SelectionAutoScroll = { revision: string; dragId: number; delta: number };

type NativeForumSelectionProps = {
  accessible: boolean;
  children: ReactNode;
  enabled: boolean;
  revision: string;
  rows: readonly NativeSelectionRow[];
  horizontalTargets: readonly string[];
  style: ViewProps['style'];
  testID?: string;
  onAutoScroll?: (event: NativeSyntheticEvent<SelectionAutoScroll>) => void;
  onSelectionDragChange?: (event: NativeSyntheticEvent<SelectionDrag>) => void;
  onHorizontalAutoScroll?: (event: NativeSyntheticEvent<SelectionHorizontalScroll>) => void;
  onSelectionChange?: (event: NativeSyntheticEvent<{ active: boolean; revision: string }>) => void;
  onSelectionError?: (event: NativeSyntheticEvent<{ code: string; revision: string }>) => void;
};

type NativeForumSelectionRef = View & { cancelSelection?: () => Promise<void> };

type NativeSelectionComponent = ComponentType<
  NativeForumSelectionProps & { ref?: RefObject<NativeForumSelectionRef | null> }
>;
let NativeForumSelection: NativeSelectionComponent | null = null;
let moduleUnavailableReported = false;

function recordSelectionError(selectionError: DiagnosticFields['selectionError']) {
  const trace = beginDiagnosticTrace('topic', 'selection-error');
  finishDiagnosticTrace(trace, 'failure', {
    selectionError,
    reason: selectionError === 'module-unavailable' ? 'unsupported' : 'invalid_response'
  });
}
if (Platform.OS === 'android') {
  try {
    NativeForumSelection = Animated.createAnimatedComponent(
      requireNativeViewManager<NativeForumSelectionProps & { ref?: RefObject<NativeForumSelectionRef | null> }>(
        'ForumContentSelection'
      )
    ) as NativeSelectionComponent;
  } catch {
    // The stable per-TextView and reply-copy paths remain available without the optional native module.
  }
}

type TopicSelectionContextValue = {
  cancelSelection: (() => void) | null;
  enabled: boolean;
  sessionKey: string;
  registerHorizontalTarget: (id: string, target: SelectionHorizontalTarget) => () => void;
};

const TopicSelectionContext = createContext<TopicSelectionContextValue>({
  cancelSelection: null,
  enabled: false,
  sessionKey: '',
  registerHorizontalTarget: () => () => undefined
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
  const documentKey = useMemo(
    () =>
      `${sessionKey}:${hashRevision(snapshot.rows.flatMap((row) => [row.documentId, row.rowKey, row.selectionToken]))}`,
    [sessionKey, snapshot.rows]
  );
  const nativeRef = useRef<NativeForumSelectionRef | null>(null);
  const nativeEnabled = Boolean(
    Platform.OS === 'android' && NativeForumSelection && routeActive && snapshot.valid && snapshot.rows.length > 0
  );
  const surfaceId = useId();
  const lifecycleKey = `${documentKey}:${nativeEnabled}`;
  const [document, setDocument] = useState({ key: lifecycleKey, generation: 0 });
  if (document.key !== lifecycleKey) setDocument({ key: lifecycleKey, generation: document.generation + 1 });
  const revision = `${documentKey}:${surfaceId}:${document.generation}`;
  const [horizontalTargets, setHorizontalTargets] = useState<Record<string, SelectionHorizontalTarget>>({});
  const registerHorizontalTarget = useCallback((id: string, target: SelectionHorizontalTarget) => {
    setHorizontalTargets((current) => ({ ...current, [id]: target }));
    return () =>
      setHorizontalTargets((current) => {
        if (current[id] !== target) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
  }, []);
  const drag = useSharedValue<SelectionDrag>({ revision: '', dragId: 0, active: false });
  const onSelectionDragChange = useEvent<NativeSyntheticEvent<SelectionDrag>>(
    (event) => {
      'worklet';
      if (event.revision !== revision || !nativeEnabled || !Number.isFinite(event.dragId)) return;
      if (event.dragId < drag.value.dragId && drag.value.revision === revision) return;
      if (event.dragId === drag.value.dragId && drag.value.revision === revision && event.active) return;
      drag.set({ revision, dragId: event.dragId, active: event.active });
    },
    ['onSelectionDragChange'],
    true
  );
  const onHorizontalAutoScroll = useEvent<NativeSyntheticEvent<SelectionHorizontalScroll>>(
    (event) => {
      'worklet';
      if (
        !nativeEnabled ||
        event.revision !== revision ||
        !drag.value.active ||
        drag.value.revision !== revision ||
        event.dragId !== drag.value.dragId ||
        !Number.isFinite(event.offsetDp)
      )
        return;
      const target = horizontalTargets[event.targetId];
      if (!target) return;
      cancelAnimation(target.offset);
      target.offset.set(Math.max(0, Math.min(target.maximum.value, event.offsetDp)));
    },
    ['onHorizontalAutoScroll'],
    true
  );
  const reportSelection = useTopicSelectionBackReport();
  const mounted = useRef(false);
  const cancelSelection = useCallback(() => {
    drag.set({ ...drag.value, active: false });
    reportSelection(null);
    // The native view may disappear before this queued command runs; the caller owns its rejection.
    void nativeRef.current?.cancelSelection?.().catch((error: unknown) => {
      recordDiagnosticError('topic', 'selection-error', error, { selectionError: 'cancel-command' });
    });
  }, [drag, reportSelection]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reportSelection(null);
    };
  }, [reportSelection]);
  const onSelectionChange = useLatestCallback(
    ({ nativeEvent }: NativeSyntheticEvent<{ active: boolean; revision: string }>) => {
      if (
        !mounted.current ||
        !nativeEnabled ||
        nativeEvent.revision !== revision ||
        typeof nativeEvent.active !== 'boolean'
      )
        return;
      reportSelection(nativeEvent.active ? cancelSelection : null);
    }
  );
  const lastErrorRef = useRef('');
  const onSelectionError = useLatestCallback(
    ({ nativeEvent }: NativeSyntheticEvent<{ code: string; revision: string }>) => {
      if (!mounted.current || !nativeEnabled || nativeEvent.revision !== revision) return;
      const code = (
        [
          'blank-identity',
          'duplicate-native-id',
          'duplicate-row-key',
          'invalid-selection-token',
          'revision-reused',
          'copy-mapping-mismatch',
          'system-actions-load',
          'system-action-run'
        ] as const
      ).find((value) => value === nativeEvent.code);
      if (!code || lastErrorRef.current === `${revision}:${code}`) return;
      lastErrorRef.current = `${revision}:${code}`;
      recordSelectionError(code);
    }
  );
  useEffect(() => {
    if (Platform.OS !== 'android' || !routeActive || !snapshot.rows.length) return;
    if (!NativeForumSelection && !moduleUnavailableReported) {
      moduleUnavailableReported = true;
      recordSelectionError('module-unavailable');
    } else if (!snapshot.valid)
      recordSelectionError(items.some((item) => !item.rowKey) ? 'blank-identity' : 'duplicate-row-key');
  }, [items, routeActive, snapshot]);

  useEffect(() => {
    cancelSelection();
  }, [cancelSelection, revision, routeActive]);

  const onAutoScroll = useLatestCallback(({ nativeEvent }: NativeSyntheticEvent<SelectionAutoScroll>) => {
    const list = listRef.current;
    const currentOffset = list?.getAbsoluteLastScrollOffset();
    const activeDrag = drag.value;
    if (
      !mounted.current ||
      !nativeEnabled ||
      nativeEvent.revision !== revision ||
      !activeDrag.active ||
      activeDrag.revision !== revision ||
      nativeEvent.dragId !== activeDrag.dragId ||
      !list ||
      typeof currentOffset !== 'number' ||
      !Number.isFinite(currentOffset) ||
      !Number.isFinite(nativeEvent.delta)
    )
      return;
    const offset = Math.max(0, currentOffset + nativeEvent.delta);
    if (offset === currentOffset) return;
    list.scrollToOffset({
      animated: false,
      offset
    });
  });
  const context = useMemo(
    () => ({
      cancelSelection: nativeEnabled ? cancelSelection : null,
      enabled: nativeEnabled,
      sessionKey,
      registerHorizontalTarget
    }),
    [cancelSelection, nativeEnabled, sessionKey, registerHorizontalTarget]
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
        horizontalTargets={Object.keys(horizontalTargets)}
        style={styles.fill}
        testID="topic-selection-surface"
        onAutoScroll={onAutoScroll}
        onSelectionDragChange={onSelectionDragChange}
        onHorizontalAutoScroll={onHorizontalAutoScroll}
        onSelectionChange={onSelectionChange}
        onSelectionError={onSelectionError}
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

export function useTopicSelectionHorizontalTarget(offset: SharedValue<number>, maximum: SharedValue<number>) {
  const { enabled, sessionKey, registerHorizontalTarget } = useContext(TopicSelectionContext);
  const opening = useContext(TopicSelectionRowContext);
  const id = useId();
  const nativeID = enabled && opening ? `topic-horizontal-${hashRevision([sessionKey, id])}` : undefined;
  useLayoutEffect(() => {
    if (nativeID) return registerHorizontalTarget(nativeID, { offset, maximum });
  }, [nativeID, offset, maximum, registerHorizontalTarget]);
  return nativeID;
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
