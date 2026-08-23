import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Switch,
  Text,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GripVertical, ListTree } from 'lucide-react-native';
import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import type { ContentSourcePreference } from '@/domain/reader/contentSourcePreferences';
import { ExpandablePanel } from '@/ui/controls/ExpandableControls';
import { triggerPressFeedback } from '@/ui/controls/pressFeedback';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { createMoreScreenStyles } from '../styles';

const DRAG_ACTIVATION_DELAY_MS = 350;

type RowLayout = { height: number; y: number };
type DragPreview = {
  centers: number[];
  originIndex: number;
  source: Source;
  targetIndex: number;
};
type DragSession = DragPreview & {
  preferences: ContentSourcePreference[];
};

function reorderedPreferences(preferences: ContentSourcePreference[], from: number, to: number) {
  if (from === to) return preferences;
  const next = [...preferences];
  const [moved] = next.splice(from, 1);
  if (!moved) return preferences;
  next.splice(to, 0, moved);
  return next;
}

function nearestCenterIndex(centers: number[], value: number) {
  'worklet';
  let nearest = 0;
  for (let index = 1; index < centers.length; index += 1) {
    if (Math.abs(centers[index]! - value) < Math.abs(centers[nearest]! - value)) {
      nearest = index;
    }
  }
  return nearest;
}

function hasValidRowCenters(centers: number[], expectedCount: number) {
  'worklet';
  if (centers.length !== expectedCount) return false;
  for (let index = 0; index < centers.length; index += 1) {
    const center = centers[index]!;
    if (!Number.isFinite(center) || (index > 0 && center <= centers[index - 1]!)) return false;
  }
  return true;
}

function previewRowIndex(index: number, preview: DragPreview | null) {
  if (!preview) return index;
  if (index === preview.originIndex) return preview.targetIndex;
  if (preview.originIndex < preview.targetIndex && index > preview.originIndex && index <= preview.targetIndex) {
    return index - 1;
  }
  if (preview.originIndex > preview.targetIndex && index >= preview.targetIndex && index < preview.originIndex) {
    return index + 1;
  }
  return index;
}

function SortableRow({
  active,
  activeStyle,
  children,
  currentIndex,
  dragTranslationY,
  hostIndex,
  onLayout,
  previewIndex,
  rowCenters,
  style,
  testID
}: {
  active: boolean;
  activeStyle: StyleProp<ViewStyle>;
  children: ReactNode;
  currentIndex: number;
  dragTranslationY: SharedValue<number>;
  hostIndex: number;
  onLayout: (event: LayoutChangeEvent) => void;
  previewIndex: number;
  rowCenters: SharedValue<number[]>;
  style: StyleProp<ViewStyle>;
  testID: string;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const centers = rowCenters.value;
    const hostCenter = centers[hostIndex];
    const targetCenter = centers[active ? currentIndex : previewIndex];
    const settledOffset = hostCenter === undefined || targetCenter === undefined ? 0 : targetCenter - hostCenter;
    if (!active && settledOffset === 0) return { transform: undefined };
    return {
      transform: [{ translateY: settledOffset + (active ? dragTranslationY.value : 0) }]
    };
  }, [active, currentIndex, hostIndex, previewIndex]);

  return (
    <Animated.View onLayout={onLayout} style={[style, animatedStyle, active && activeStyle]} testID={testID}>
      {children}
    </Animated.View>
  );
}

export function ContentSourcesPanel({
  expanded,
  preferences,
  onChange,
  onExpandedChange
}: {
  expanded: boolean;
  preferences: ContentSourcePreference[];
  onChange: (preferences: ContentSourcePreference[]) => void;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const enabledCount = preferences.filter((preference) => preference.enabled).length;
  const preferencesRef = useCommittedRef(preferences);
  const onChangeRef = useCommittedRef(onChange);
  const hostSourcesRef = useRef(preferences.map(({ source }) => source));
  const hostSources = hostSourcesRef.current;
  const rowLayoutsRef = useRef(new Map<number, RowLayout>());
  const dragSessionRef = useRef<DragSession | null>(null);
  const rowCenters = useSharedValue<number[]>([]);
  const dragActiveIndex = useSharedValue(-1);
  const dragTargetIndex = useSharedValue(-1);
  const dragTranslationY = useSharedValue(0);
  const [dragPreview, setDragPreview] = useState<DragSession | null>(null);
  const preferenceIdentity = preferences.map(({ source, enabled }) => `${source}:${enabled}`).join('|');
  const preferenceCount = preferences.length;

  const cancelDrag = useCallback(() => {
    dragSessionRef.current = null;
    setDragPreview(null);
  }, []);

  useEffect(() => {
    if (expanded) return;
    cancelDrag();
    hostSourcesRef.current = preferencesRef.current.map(({ source }) => source);
    rowLayoutsRef.current.clear();
    rowCenters.value = [];
    dragActiveIndex.value = -1;
    dragTargetIndex.value = -1;
    dragTranslationY.value = 0;
  }, [
    cancelDrag,
    dragActiveIndex,
    dragTargetIndex,
    dragTranslationY,
    expanded,
    preferenceIdentity,
    preferencesRef,
    rowCenters
  ]);

  useEffect(() => {
    const session = dragSessionRef.current;
    if (
      session &&
      session.preferences.map(({ source, enabled }) => `${source}:${enabled}`).join('|') !== preferenceIdentity
    ) {
      cancelDrag();
    }
  }, [cancelDrag, preferenceIdentity]);
  const renderDragPreview =
    dragPreview &&
    dragPreview.preferences.map(({ source, enabled }) => `${source}:${enabled}`).join('|') === preferenceIdentity
      ? dragPreview
      : null;

  const move = (index: number, offset: -1 | 1) => {
    const current = preferencesRef.current;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= current.length) return;
    triggerPressFeedback();
    onChangeRef.current(reorderedPreferences(current, index, nextIndex));
  };

  const beginDrag = (source: Source, expectedOriginIndex: number, centers: number[]) => {
    const current = preferencesRef.current;
    const originIndex = current.findIndex((preference) => preference.source === source);
    if (originIndex !== expectedOriginIndex || !hasValidRowCenters(centers, current.length)) {
      cancelDrag();
      return;
    }
    const session: DragSession = {
      centers: [...centers],
      originIndex,
      preferences: [...current],
      source,
      targetIndex: originIndex
    };
    dragSessionRef.current = session;
    setDragPreview(session);
    triggerPressFeedback();
  };

  const updateDragTarget = (source: Source, targetIndex: number) => {
    const session = dragSessionRef.current;
    if (!session || session.source !== source || targetIndex < 0 || targetIndex >= session.preferences.length) return;
    setDragPreview((current) =>
      current?.source === source && current.targetIndex === targetIndex ? current : { ...session, targetIndex }
    );
  };

  const finishDrag = (source: Source, success: boolean, targetIndex: number) => {
    const session = dragSessionRef.current;
    const currentPreferenceIdentity = preferencesRef.current
      .map(({ source: currentSource, enabled }) => `${currentSource}:${enabled}`)
      .join('|');
    if (
      !success ||
      !session ||
      session.source !== source ||
      session.preferences.map(({ source: currentSource, enabled }) => `${currentSource}:${enabled}`).join('|') !==
        currentPreferenceIdentity ||
      targetIndex < 0 ||
      targetIndex >= session.preferences.length ||
      targetIndex === session.originIndex
    ) {
      cancelDrag();
      return;
    }
    onChangeRef.current(reorderedPreferences(session.preferences, session.originIndex, targetIndex));
  };
  const visibleHostSources = expanded ? hostSources : [];

  return (
    <ExpandablePanel
      quiet
      title="内容源"
      meta={`${enabledCount}/${preferences.length} 已启用`}
      icon={ListTree}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      <View>
        {visibleHostSources.map((source, hostIndex) => {
          const index = preferences.findIndex((preference) => preference.source === source);
          const preference = preferences[index];
          if (!preference) return null;
          const label = sourceCatalog[preference.source].label;
          const first = index === 0;
          const last = index === preferences.length - 1;
          const dragGesture = Gesture.Pan()
            .activateAfterLongPress(DRAG_ACTIVATION_DELAY_MS)
            .onStart(() => {
              'worklet';
              const centers = rowCenters.value;
              if (!hasValidRowCenters(centers, preferenceCount)) {
                dragActiveIndex.value = -1;
                dragTargetIndex.value = -1;
                dragTranslationY.value = 0;
                scheduleOnRN(cancelDrag);
                return;
              }
              dragActiveIndex.value = index;
              dragTargetIndex.value = index;
              dragTranslationY.value = 0;
              scheduleOnRN(beginDrag, preference.source, index, centers);
            })
            .onUpdate(({ translationY }) => {
              'worklet';
              const originIndex = dragActiveIndex.value;
              const centers = rowCenters.value;
              if (originIndex !== index) return;
              if (!Number.isFinite(translationY) || !hasValidRowCenters(centers, preferenceCount)) {
                dragActiveIndex.value = -1;
                dragTargetIndex.value = -1;
                dragTranslationY.value = 0;
                scheduleOnRN(cancelDrag);
                return;
              }
              const originCenter = centers[originIndex]!;
              const minTranslation = centers[0]! - originCenter;
              const maxTranslation = centers[centers.length - 1]! - originCenter;
              const clampedTranslation = Math.max(minTranslation, Math.min(maxTranslation, translationY));
              const targetIndex = nearestCenterIndex(centers, originCenter + clampedTranslation);
              dragTranslationY.value = clampedTranslation;
              if (dragTargetIndex.value !== targetIndex) {
                dragTargetIndex.value = targetIndex;
                scheduleOnRN(updateDragTarget, preference.source, targetIndex);
              }
            })
            .onFinalize((_event, success) => {
              'worklet';
              if (dragActiveIndex.value !== index) return;
              const targetIndex = dragTargetIndex.value;
              if (success) {
                const centers = rowCenters.value;
                dragTranslationY.value = centers[targetIndex]! - centers[index]!;
              }
              scheduleOnRN(finishDrag, preference.source, success, targetIndex);
            });
          const accessibilityActions = [
            ...(first ? [] : [{ name: 'moveUp', label: '上移' }]),
            ...(last ? [] : [{ name: 'moveDown', label: '下移' }])
          ];
          const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
            if (event.nativeEvent.actionName === 'moveUp') move(index, -1);
            if (event.nativeEvent.actionName === 'moveDown') move(index, 1);
          };
          return (
            <SortableRow
              active={renderDragPreview?.source === preference.source}
              activeStyle={styles.contentSourceRowDragging}
              currentIndex={index}
              dragTranslationY={dragTranslationY}
              hostIndex={hostIndex}
              key={preference.source}
              onLayout={({ nativeEvent }) => {
                rowLayoutsRef.current.set(hostIndex, {
                  height: nativeEvent.layout.height,
                  y: nativeEvent.layout.y
                });
                const centers = hostSources.map((_, candidateIndex) => {
                  const layout = rowLayoutsRef.current.get(candidateIndex);
                  return layout ? layout.y + layout.height / 2 : Number.NaN;
                });
                rowCenters.value = hasValidRowCenters(centers, preferences.length) ? centers : [];
              }}
              previewIndex={previewRowIndex(index, renderDragPreview)}
              rowCenters={rowCenters}
              style={[styles.contentSourceRow, index > 0 && styles.appearanceSettingRowDivided]}
              testID={`content-source-row-${preference.source}`}
            >
              <View style={styles.contentSourceCopy}>
                <Text style={styles.menuLabel}>{label}</Text>
                <Text style={styles.meta}>{preference.enabled ? '已启用' : '已停用'}</Text>
              </View>
              <View style={styles.contentSourceActions}>
                <Switch
                  accessibilityLabel={`${label} 内容源开关`}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: preference.enabled }}
                  value={preference.enabled}
                  trackColor={{ false: theme.lineStrong, true: theme.primarySoft }}
                  thumbColor={preference.enabled ? theme.primary : theme.surface}
                  onValueChange={(enabled) =>
                    onChange(
                      preferences.map((candidate) =>
                        candidate.source === preference.source ? { ...candidate, enabled } : candidate
                      )
                    )
                  }
                />
                <GestureDetector gesture={dragGesture}>
                  <View
                    accessible
                    accessibilityActions={accessibilityActions}
                    accessibilityHint="长按并拖动可调整顺序"
                    accessibilityLabel={`拖动排序：${label}，第 ${index + 1} 项，共 ${preferences.length} 项`}
                    accessibilityRole="button"
                    onAccessibilityAction={handleAccessibilityAction}
                    style={styles.contentSourceDragHandle}
                    testID={`content-source-drag-${preference.source}`}
                  >
                    <GripVertical color={theme.muted} size={22} strokeWidth={1.8} />
                  </View>
                </GestureDetector>
              </View>
            </SortableRow>
          );
        })}
      </View>
    </ExpandablePanel>
  );
}
