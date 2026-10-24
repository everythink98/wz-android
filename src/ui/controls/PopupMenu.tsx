import { recordUserInteraction } from '@/platform/network/userPresence';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { List } from 'react-native-paper';
import type { LucideIcon } from 'lucide-react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { NavigationGlass } from '@/ui/navigation/NavigationGlass';
import {
  readerRadii,
  type ReaderStyleSettings,
  alphaColor,
  fontFamilyValue,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { TOUCH_HIT_SLOP } from './touchTarget';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    layer: {
      flex: 1
    },
    dismiss: {
      ...StyleSheet.absoluteFill
    },
    menu: {
      overflow: 'hidden',
      borderColor: theme.line,
      borderRadius: readerRadii.surface,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 4
    },
    item: {
      minHeight: 48,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingLeft: 12,
      paddingRight: 12,
      justifyContent: 'center',
      paddingVertical: 8
    },
    itemCompact: {
      minHeight: 44,
      paddingVertical: 6
    },
    row: { marginVertical: 0, alignItems: 'center', gap: 9 },
    content: { paddingLeft: 0 },
    itemSelected: {
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.16 : 0.06)
    },
    itemLast: {
      borderBottomWidth: 0
    },
    text: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(14 * settings.fontScale),
      lineHeight: Math.round(20 * settings.fontScale),
      includeFontPadding: false,
      fontWeight: '500'
    },
    textCompact: {
      fontSize: Math.round(13 * settings.fontScale),
      includeFontPadding: false,
      lineHeight: Math.round(18 * settings.fontScale)
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
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      visible={visible}
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <View style={styles.layer} onTouchStart={recordUserInteraction} onTouchMove={recordUserInteraction}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={styles.dismiss}
          onPress={onRequestClose}
        />
        <View style={[styles.menu, placementStyle]}>
          <NavigationGlass variant="surface" />
          {children}
        </View>
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
    <List.Item
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityState={selected ? { selected: true } : undefined}
      style={[styles.item, compact && styles.itemCompact, selected && styles.itemSelected, last && styles.itemLast]}
      containerStyle={styles.row}
      contentStyle={styles.content}
      title={label}
      titleStyle={[styles.text, compact && styles.textCompact, selected && styles.textSelected]}
      titleNumberOfLines={0}
      left={Icon ? () => <Icon size={17} color={theme.ink} strokeWidth={1.8} accessible={false} /> : undefined}
      onPress={onPress}
    />
  );
}
