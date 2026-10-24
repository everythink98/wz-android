import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { List } from 'react-native-paper';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { readerRadii, type ReaderStyleSettings, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export function createExpandableStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
  return StyleSheet.create({
    group: {
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: readerRadii.surface,
      borderWidth: 0,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    groupList: {
      backgroundColor: 'transparent',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      marginTop: 0,
      paddingHorizontal: 0,
      paddingVertical: 6
    },
    menuButton: {
      alignItems: 'center',
      paddingVertical: 0,
      paddingLeft: 0,
      paddingRight: 0,
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: readerRadii.control
    },
    menuIcon: { alignItems: 'center', justifyContent: 'center', width: 30, height: 30 },
    menuLabel: {
      color: theme.ink,
      fontFamily,
      fontSize: fontSize(15),
      lineHeight: fontSize(20),
      includeFontPadding: false,
      fontWeight: '500'
    },
    menuChevron: { alignItems: 'center', justifyContent: 'center', width: 24, height: 24, opacity: 0.6 },
    header: {
      paddingVertical: 0,
      paddingLeft: 0,
      paddingRight: 0,
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: readerRadii.control
    },
    row: { marginVertical: 0, alignItems: 'center', gap: 10 },
    content: { paddingLeft: 0, paddingVertical: 0, minWidth: 0 },
    body: { gap: 10, paddingTop: 8 },
    flex: { flex: 1 },
    meta: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(17),
      includeFontPadding: false
    },
    panelTitle: {
      color: theme.ink,
      fontFamily,
      fontSize: fontSize(15),
      lineHeight: fontSize(20),
      includeFontPadding: false,
      fontWeight: '600'
    },
    disabled: { opacity: 0.45 }
  });
}

const DISCLOSURE_TIMING = { duration: 200, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
const contentStyles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  measured: { position: 'absolute', width: '100%' }
});

export function ExpandableContent({
  children,
  expanded,
  style
}: {
  children: ReactNode;
  expanded: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const height = useSharedValue(0);
  const progress = useDerivedValue(() => withTiming(expanded ? 1 : 0, DISCLOSURE_TIMING), [expanded]);
  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value * progress.value,
    opacity: progress.value
  }));
  return (
    <Animated.View
      accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}
      pointerEvents={expanded ? 'auto' : 'none'}
      style={[contentStyles.clip, animatedStyle]}
    >
      <View
        onLayout={(event) => {
          height.set(event.nativeEvent.layout.height);
        }}
        style={[contentStyles.measured, style]}
      >
        {children}
      </View>
    </Animated.View>
  );
}

export function DisclosureChevron({ expanded, color, size = 18 }: { expanded: boolean; color: string; size?: number }) {
  const animatedStyle = useAnimatedStyle(
    () => ({ transform: [{ rotate: withTiming(expanded ? '180deg' : '0deg', DISCLOSURE_TIMING) }] }),
    [expanded]
  );
  return (
    <Animated.View accessible={false} importantForAccessibility="no-hide-descendants" style={animatedStyle}>
      <ChevronDown size={size} color={color} strokeWidth={1.8} />
    </Animated.View>
  );
}

export function MenuButton({
  accessibilityLabel,
  disabled = false,
  icon,
  label,
  nested = false,
  value,
  expanded,
  onPress
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  nested?: boolean;
  value: string;
  expanded?: boolean;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createExpandableStyles);
  const Icon = icon;
  const nestedActionColor = theme.primary;
  return (
    <List.Item
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, expanded }}
      disabled={disabled}
      style={[styles.menuButton, disabled && styles.disabled]}
      containerStyle={styles.row}
      contentStyle={styles.content}
      title={label}
      titleStyle={[styles.menuLabel, nested && { color: nestedActionColor }]}
      titleNumberOfLines={0}
      description={value || undefined}
      descriptionStyle={styles.meta}
      descriptionNumberOfLines={2}
      left={
        nested
          ? undefined
          : () => (
              <View style={styles.menuIcon}>
                <Icon size={19} color={theme.primary} strokeWidth={1.8} accessible={false} />
              </View>
            )
      }
      right={() => (
        <View style={styles.menuChevron}>
          {expanded === undefined ? (
            <ChevronRight
              size={18}
              color={nested ? nestedActionColor : theme.muted}
              strokeWidth={1.8}
              accessible={false}
            />
          ) : (
            <DisclosureChevron expanded={expanded} color={nested ? nestedActionColor : theme.muted} />
          )}
        </View>
      )}
      onPress={onPress}
    />
  );
}

export function ExpandablePanel({
  children,
  expanded,
  icon,
  meta,
  quiet = false,
  title,
  onExpandedChange
}: {
  children: ReactNode;
  expanded: boolean;
  icon?: LucideIcon;
  meta?: string;
  quiet?: boolean;
  title: string;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createExpandableStyles);
  const Icon = icon;

  return (
    <View style={quiet ? styles.groupList : styles.group}>
      <List.Item
        accessibilityLabel={expanded ? `收起${title}` : `展开${title}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.header}
        containerStyle={styles.row}
        contentStyle={styles.content}
        title={title}
        titleStyle={styles.panelTitle}
        titleNumberOfLines={0}
        description={meta || undefined}
        descriptionStyle={styles.meta}
        descriptionNumberOfLines={2}
        left={
          Icon
            ? () => (
                <View style={styles.menuIcon}>
                  <Icon size={19} color={theme.primary} strokeWidth={1.8} accessible={false} />
                </View>
              )
            : undefined
        }
        right={() => (
          <View style={styles.menuChevron}>
            <DisclosureChevron expanded={expanded} color={theme.muted} />
          </View>
        )}
        onPress={() => onExpandedChange(!expanded)}
      />
      <ExpandableContent expanded={expanded} style={styles.body}>
        {children}
      </ExpandableContent>
    </View>
  );
}
