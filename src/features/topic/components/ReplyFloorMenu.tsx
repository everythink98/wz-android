import { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  VirtualizedList,
  useWindowDimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight } from 'lucide-react-native';
import type { Reply, Topic } from '@/domain/forum/models';
import { IconButton } from '@/ui/controls/ButtonControls';
import { PopupMenu } from '@/ui/controls/PopupMenu';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    rim: { borderTopColor: alphaColor('#FFFFFF', theme.dark ? 0.34 : 0.9) },
    form: { flexDirection: 'row', alignItems: 'center', paddingStart: 12 },
    formDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
    input: { flex: 1, minWidth: 0, alignSelf: 'stretch', padding: 0 },
    invalidInput: { color: theme.danger },
    list: { flexGrow: 0, flexShrink: 1 },
    item: { justifyContent: 'center', paddingHorizontal: 12 },
    selected: { backgroundColor: alphaColor(theme.primary, theme.dark ? 0.18 : 0.08) },
    label: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      fontSize: Math.round(14 * settings.uiFontScale),
      lineHeight: Math.round(20 * settings.uiFontScale),
      fontVariant: ['tabular-nums'],
      includeFontPadding: false
    },
    selectedLabel: { color: theme.dark ? theme.primary : theme.primaryStrong, fontWeight: '600' }
  });
}

type FloorChoices = { first: number; count: number } | { floors: number[]; count: number };

function replyFloorChoices(topic: Topic, replies: readonly Reply[]): FloorChoices {
  const first = topic.source === 'linuxdo' ? 2 : 1;
  const last = topic.replyWatermark ?? topic.reading?.highestPostNumber ?? (first === 1 ? topic.replyCount : undefined);
  const known = new Set<number>();
  let lastLoaded = first - 1;
  for (const { floor } of replies) {
    if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor < first) continue;
    known.add(floor);
    lastLoaded = Math.max(lastLoaded, floor);
  }
  if (typeof last === 'number' && Number.isSafeInteger(last) && last >= first) {
    return { first, count: Math.max(last, lastLoaded) - first + 1 };
  }
  const floors = [...known].sort((a, b) => a - b);
  return { floors, count: floors.length };
}

export function ReplyFloorMenu({
  anchor,
  currentFloor,
  topic,
  replies,
  onClose,
  onJump
}: {
  anchor: { x: number; top: number; width: number };
  currentFloor?: number;
  topic: Topic;
  replies: readonly Reply[];
  onClose: () => void;
  onJump: (floor: number) => void;
}) {
  const { styles, settings, theme } = useReaderThemeStyles(createStyles);
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [layer, setLayer] = useState<{ width: number; height: number }>();
  const [keyboardTop, setKeyboardTop] = useState(() => Keyboard.metrics()?.screenY);
  const [input, setInput] = useState('');
  const choices = useMemo(() => replyFloorChoices(topic, replies), [topic, replies]);
  const initialIndex =
    currentFloor === undefined
      ? 0
      : 'first' in choices
        ? currentFloor - choices.first
        : choices.floors.indexOf(currentFloor);
  const rowHeight = Math.max(48, Math.ceil(20 * settings.uiFontScale * fontScale) + 16);
  const text = input.trim();
  const floor = Number(text);
  const valid = /^\d+$/.test(text) && Number.isSafeInteger(floor) && floor > 0;
  const submit = () => {
    if (valid) onJump(floor);
  };
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(undefined));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const layerWidth = layer?.width ?? width;
  const layerHeight = layer?.height ?? height;
  const lastFloor = 'first' in choices ? choices.first + choices.count - 1 : (choices.floors.at(-1) ?? 1);
  const labelSize = styles.label.fontSize * fontScale;
  // Two CJK characters, spaces and tabular digits must fit between the row's horizontal insets.
  const labelWidth = 24 + Math.ceil(labelSize * (2.55 + 0.6 * String(lastFloor).length));
  const menuWidth = Math.min(Math.max(116, labelWidth, anchor.width), layerWidth - 16);
  const left = Math.max(8, Math.min(anchor.x, layerWidth - menuWidth - 8));
  const bottomEdge = Math.min(anchor.top, keyboardTop ?? layerHeight, layerHeight) - 8;

  return (
    <PopupMenu
      visible
      testID="topic-reply-floor-menu"
      accessibilityLabel="关闭楼层菜单"
      placementStyle={[
        styles.rim,
        {
          position: 'absolute',
          left,
          bottom: layerHeight - bottomEdge,
          width: menuWidth,
          maxHeight: Math.max(0, bottomEdge - insets.top - 8)
        }
      ]}
      onLayerLayout={({ nativeEvent: { layout } }) => {
        setLayer((current) => (current?.width === layout.width && current.height === layout.height ? current : layout));
      }}
      onRequestClose={onClose}
    >
      {choices.count > 0 ? (
        <VirtualizedList<number>
          accessibilityLabel="选择楼层"
          data={choices}
          getItem={(data: FloorChoices, index) => ('first' in data ? data.first + index : data.floors[index])}
          getItemCount={(data: FloorChoices) => data.count}
          getItemLayout={(_data, index) => ({ index, length: rowHeight, offset: index * rowHeight })}
          keyExtractor={String}
          initialScrollIndex={Math.max(0, Math.min(choices.count - 1, initialIndex))}
          initialNumToRender={6}
          keyboardShouldPersistTaps="handled"
          persistentScrollbar
          style={[styles.list, { height: rowHeight * Math.min(choices.count, 3) }]}
          renderItem={({ item }) => {
            const label = `第 ${item} 楼`;
            const selected = item === currentFloor;
            return (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                style={[styles.item, { height: rowHeight }, selected && styles.selected]}
                onPress={() => onJump(item)}
              >
                <Text numberOfLines={1} style={[styles.label, selected && styles.selectedLabel]}>
                  {label}
                </Text>
              </Pressable>
            );
          }}
        />
      ) : null}
      <View style={[styles.form, choices.count > 0 && styles.formDivider]}>
        <TextInput
          accessibilityLabel="楼层编号"
          placeholder="楼层"
          placeholderTextColor={theme.muted}
          selectionColor={theme.primary}
          keyboardType="number-pad"
          returnKeyType="go"
          selectTextOnFocus
          underlineColorAndroid="transparent"
          style={[styles.label, styles.input, Boolean(text) && !valid && styles.invalidInput]}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={submit}
        />
        <IconButton iconOnly icon={ArrowRight} iconSize={17} label="跳转" disabled={!valid} onPress={submit} />
      </View>
    </PopupMenu>
  );
}
