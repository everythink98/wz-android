import { recordUserInteraction } from '@/platform/network/userPresence';
import { useContext, useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle
} from 'react-native';
import { List } from 'react-native-paper';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
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
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      fontSize: Math.round(14 * settings.uiFontScale),
      lineHeight: Math.round(20 * settings.uiFontScale),
      includeFontPadding: false,
      fontWeight: '500'
    },
    textCompact: {
      fontSize: Math.round(13 * settings.uiFontScale),
      includeFontPadding: false,
      lineHeight: Math.round(18 * settings.uiFontScale)
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
  scrollable = false,
  testID,
  visible,
  onLayerLayout,
  onRequestClose
}: {
  accessibilityLabel: string;
  children: ReactNode;
  placementStyle: StyleProp<ViewStyle>;
  scrollable?: boolean;
  testID?: string;
  visible: boolean;
  onLayerLayout?: (event: LayoutChangeEvent) => void;
  onRequestClose: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const { height } = useWindowDimensions();
  const insets = useContext(SafeAreaInsetsContext);
  const [layerHeight, setLayerHeight] = useState<number>();
  const placement = StyleSheet.flatten(placementStyle);
  const top = typeof placement?.top === 'number' ? placement.top : (insets?.top ?? 0);
  const bottom = typeof placement?.bottom === 'number' ? placement.bottom : (insets?.bottom ?? 0);
  const available = Math.max(0, (layerHeight ?? height) - top - bottom);
  const maxHeight = Math.min(available, typeof placement?.maxHeight === 'number' ? placement.maxHeight : available);
  return (
    <Modal
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      visible={visible}
      animationType="fade"
      onRequestClose={onRequestClose}
    >
      <View
        style={styles.layer}
        onLayout={(event) => {
          if (scrollable) setLayerHeight(event.nativeEvent.layout.height);
          onLayerLayout?.(event);
        }}
        onTouchStart={recordUserInteraction}
        onTouchMove={recordUserInteraction}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={styles.dismiss}
          onPress={onRequestClose}
        />
        <View testID={testID} style={[styles.menu, placementStyle, scrollable && { maxHeight }]}>
          <NavigationGlass variant="surface" />
          {scrollable ? (
            <ScrollView testID={testID && `${testID}-scroll`} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </View>
    </Modal>
  );
}

export function PopupMenuItem({
  compact = false,
  disabled = false,
  icon,
  label,
  last = false,
  selected = false,
  onPress
}: {
  compact?: boolean;
  disabled?: boolean;
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
      disabled={disabled}
      accessibilityState={{ disabled: disabled || undefined, selected: selected || undefined }}
      style={[
        styles.item,
        compact && styles.itemCompact,
        selected && styles.itemSelected,
        last && styles.itemLast,
        disabled && { opacity: 0.5 }
      ]}
      containerStyle={styles.row}
      contentStyle={styles.content}
      title={label}
      titleStyle={[styles.text, compact && styles.textCompact, selected && styles.textSelected]}
      titleNumberOfLines={0}
      left={
        Icon
          ? () => <Icon size={17} color={selected ? theme.primary : theme.ink} strokeWidth={1.8} accessible={false} />
          : undefined
      }
      onPress={onPress}
    />
  );
}
