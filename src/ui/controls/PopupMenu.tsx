import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { TOUCH_HIT_SLOP } from './pressFeedback';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  return StyleSheet.create({
    layer: {
      flex: 1
    },
    dismiss: {
      ...StyleSheet.absoluteFillObject
    },
    menu: {
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 4
    },
    item: {
      minHeight: 42,
      alignItems: 'center',
      flexDirection: 'row',
      gap: 9,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    itemCompact: {
      minHeight: 38,
      paddingVertical: 6
    },
    itemSelected: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.06)
    },
    itemLast: {
      borderBottomWidth: 0
    },
    text: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: 14,
      fontWeight: '600'
    },
    textCompact: {
      fontSize: 13,
      includeFontPadding: false,
      lineHeight: 18
    },
    textSelected: {
      color: theme.primary
    }
  });
}

export function PopupMenu({
  accessibilityLabel,
  children,
  placementStyle,
  visible,
  onRequestClose
}: {
  accessibilityLabel: string;
  children: ReactNode;
  placementStyle: StyleProp<ViewStyle>;
  visible: boolean;
  onRequestClose: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onRequestClose}>
      <View style={styles.layer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={styles.dismiss}
          onPress={onRequestClose}
        />
        <View style={[styles.menu, placementStyle]}>{children}</View>
      </View>
    </Modal>
  );
}

export function PopupMenuItem({
  compact = false,
  icon,
  label,
  last = false,
  selected = false,
  onPress
}: {
  compact?: boolean;
  icon?: LucideIcon;
  label: string;
  last?: boolean;
  selected?: boolean;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const Icon = icon;
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={selected ? { selected: true } : undefined}
      android_ripple={{ color: theme.primarySoft }}
      style={[styles.item, compact && styles.itemCompact, selected && styles.itemSelected, last && styles.itemLast]}
      onPress={onPress}
    >
      {Icon ? <Icon size={17} color={theme.ink} strokeWidth={1.8} /> : null}
      <Text style={[styles.text, compact && styles.textCompact, selected && styles.textSelected]}>{label}</Text>
    </Pressable>
  );
}
