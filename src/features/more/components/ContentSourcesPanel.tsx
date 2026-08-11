import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Switch,
  Text,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
  return centers.reduce(
    (nearest, center, index) => (Math.abs(center - value) < Math.abs(centers[nearest]! - value) ? index : nearest),
    0
  );
}

function shiftedRowOffset(index: number, preview: DragPreview | null) {
  if (!preview || index === preview.originIndex) return 0;
  if (preview.originIndex < preview.targetIndex && index > preview.originIndex && index <= preview.targetIndex) {
    return preview.centers[index - 1]! - preview.centers[index]!;
  }
  if (preview.originIndex > preview.targetIndex && index >= preview.targetIndex && index < preview.originIndex) {
    return preview.centers[index + 1]! - preview.centers[index]!;
  }
  return 0;
}

function SortableRow({
  active,
  activeStyle,
  children,
  dragTranslationY,
  onLayout,
  shift,
  style,
  testID
}: {
  active: boolean;
  activeStyle: StyleProp<ViewStyle>;
  children: ReactNode;
  dragTranslationY: Animated.Value;
  onLayout: (event: LayoutChangeEvent) => void;
  shift: number;
  style: StyleProp<ViewStyle>;
  testID: string;
}) {
  const shiftValue = useRef(new Animated.Value(shift)).current;

  useEffect(() => {
    Animated.timing(shiftValue, {
      duration: 120,
      easing: Easing.out(Easing.cubic),
      toValue: shift,
      useNativeDriver: true
    }).start();
  }, [shift, shiftValue]);

  return (
    <Animated.View
      onLayout={onLayout}
      style={[style, { transform: [{ translateY: active ? dragTranslationY : shiftValue }] }, active && activeStyle]}
      testID={testID}
    >
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
  expanded?: boolean;
  preferences: ContentSourcePreference[];
  onChange: (preferences: ContentSourcePreference[]) => void;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createMoreScreenStyles);
  const enabledCount = preferences.filter((preference) => preference.enabled).length;
  const preferencesRef = useCommittedRef(preferences);
  const onChangeRef = useCommittedRef(onChange);
  const rowLayoutsRef = useRef(new Map<Source, RowLayout>());
  const dragSessionRef = useRef<DragSession | null>(null);
  const dragPreviewRef = useRef<DragPreview | null>(null);
  const dragTranslationY = useRef(new Animated.Value(0)).current;
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const preferenceIdentity = preferences.map(({ source, enabled }) => `${source}:${enabled}`).join('|');

  const cancelDrag = useCallback(() => {
    dragSessionRef.current = null;
    dragPreviewRef.current = null;
    dragTranslationY.setValue(0);
    setDragPreview(null);
  }, [dragTranslationY]);

  useEffect(() => {
    const session = dragSessionRef.current;
    if (
      session &&
      session.preferences.map(({ source, enabled }) => `${source}:${enabled}`).join('|') !== preferenceIdentity
    ) {
      cancelDrag();
    }
  }, [cancelDrag, preferenceIdentity]);

  const move = (index: number, offset: -1 | 1) => {
    const current = preferencesRef.current;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= current.length) return;
    triggerPressFeedback();
    onChangeRef.current(reorderedPreferences(current, index, nextIndex));
  };

  const beginDrag = (source: Source) => {
    const current = preferencesRef.current;
    const originIndex = current.findIndex((preference) => preference.source === source);
    const centers = current.map((preference) => {
      const layout = rowLayoutsRef.current.get(preference.source);
      return layout ? layout.y + layout.height / 2 : Number.NaN;
    });
    if (originIndex < 0 || centers.some((center) => !Number.isFinite(center))) return;
    const session: DragSession = {
      centers,
      originIndex,
      preferences: [...current],
      source,
      targetIndex: originIndex
    };
    dragSessionRef.current = session;
    dragPreviewRef.current = session;
    dragTranslationY.setValue(0);
    setDragPreview(session);
    triggerPressFeedback();
  };

  const updateDrag = (source: Source, translationY: number) => {
    const session = dragSessionRef.current;
    if (!session || session.source !== source || !Number.isFinite(translationY)) return;
    const originCenter = session.centers[session.originIndex]!;
    const minTranslation = session.centers[0]! - originCenter;
    const maxTranslation = session.centers.at(-1)! - originCenter;
    const clampedTranslation = Math.max(minTranslation, Math.min(maxTranslation, translationY));
    const targetIndex = nearestCenterIndex(session.centers, originCenter + clampedTranslation);
    dragTranslationY.setValue(clampedTranslation);
    if (dragPreviewRef.current?.targetIndex === targetIndex) return;
    const preview = { ...session, targetIndex };
    dragPreviewRef.current = preview;
    setDragPreview(preview);
  };

  const finishDrag = (source: Source, success: boolean) => {
    const session = dragSessionRef.current;
    const targetIndex = dragPreviewRef.current?.targetIndex ?? session?.originIndex;
    cancelDrag();
    if (
      !success ||
      !session ||
      session.source !== source ||
      targetIndex === undefined ||
      targetIndex === session.originIndex
    )
      return;
    onChangeRef.current(reorderedPreferences(session.preferences, session.originIndex, targetIndex));
  };

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
        {preferences.map((preference, index) => {
          const label = sourceCatalog[preference.source].label;
          const first = index === 0;
          const last = index === preferences.length - 1;
          const dragGesture = Gesture.Pan()
            .activateAfterLongPress(DRAG_ACTIVATION_DELAY_MS)
            .runOnJS(true)
            .onStart(() => beginDrag(preference.source))
            .onUpdate(({ translationY }) => updateDrag(preference.source, translationY))
            .onFinalize((_event, success) => finishDrag(preference.source, success));
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
              active={dragPreview?.source === preference.source}
              activeStyle={styles.contentSourceRowDragging}
              dragTranslationY={dragTranslationY}
              key={preference.source}
              onLayout={({ nativeEvent }) => {
                rowLayoutsRef.current.set(preference.source, {
                  height: nativeEvent.layout.height,
                  y: nativeEvent.layout.y
                });
              }}
              shift={shiftedRowOffset(index, dragPreview)}
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
