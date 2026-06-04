import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronDown, ChevronRight, ChevronUp, type LucideIcon } from 'lucide-react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';

export const TOUCH_HIT_SLOP = { top: 6, right: 6, bottom: 6, left: 6 };

function pressWithFeedback(onPress: () => void) {
  void Haptics.selectionAsync().catch(() => undefined);
  onPress();
}

export function triggerPressFeedback() {
  void Haptics.selectionAsync().catch(() => undefined);
}

export function PillRail({
  items,
  variant = 'pills',
  value,
  resetScrollKey,
  styles,
  onChange
}: {
  items: Array<{ value: string; label: string }>;
  variant?: 'pills' | 'tabs' | 'subtabs';
  value: string;
  resetScrollKey?: string | number;
  styles: ReturnType<typeof createStyles>;
  onChange: (value: string) => void;
}) {
  const isTabs = variant === 'tabs';
  const isSubtabs = variant === 'subtabs';
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (resetScrollKey !== undefined) {
      scrollRef.current?.scrollTo({ x: 0, animated: false });
    }
  }, [resetScrollKey]);
  return (
    <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} fadingEdgeLength={0} contentContainerStyle={isTabs ? styles.tabRail : isSubtabs ? styles.subtabRail : styles.pillRail}>
      {items.map((item) => (
        <Pressable
          hitSlop={TOUCH_HIT_SLOP}
          key={`${item.value}-${item.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected: value === item.value }}
          style={isTabs ? [styles.tab, value === item.value && styles.tabActive] : isSubtabs ? [styles.subtab, value === item.value && styles.subtabActive] : [styles.pill, value === item.value && styles.pillActive]}
          onPress={() => pressWithFeedback(() => onChange(item.value))}
        >
          <Text style={isTabs ? [styles.tabText, value === item.value && styles.tabTextActive] : isSubtabs ? [styles.subtabText, value === item.value && styles.subtabTextActive] : [styles.pillText, value === item.value && styles.pillTextActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function SettingRail({
  title,
  items,
  value,
  styles,
  onChange
}: {
  title: string;
  items: Array<{ value: string; label: string }>;
  value: string;
  styles: ReturnType<typeof createStyles>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.settingGroup}>
      <Text style={styles.panelTitle}>{title}</Text>
      <PillRail items={items} value={value} styles={styles} onChange={onChange} />
    </View>
  );
}

export function MenuButton({
  icon,
  label,
  value,
  expanded,
  styles,
  theme,
  onPress
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  expanded?: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const Chevron = expanded === undefined ? ChevronRight : ChevronDown;
  return (
    <Pressable accessibilityRole="button" style={styles.menuButton} onPress={() => pressWithFeedback(onPress)}>
      <View style={styles.menuIcon}>
        <Icon size={19} color={theme.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.meta} numberOfLines={2}>{value}</Text>
      </View>
      <Chevron size={16} color={theme.muted} strokeWidth={1.6} style={[styles.menuChevron, expanded && styles.menuChevronExpanded]} />
    </Pressable>
  );
}

export function ExpandablePanel({
  children,
  defaultExpanded = false,
  expanded,
  icon,
  meta,
  quiet = false,
  styles,
  theme,
  title,
  onExpandedChange
}: {
  children: ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  icon?: LucideIcon;
  meta?: string;
  quiet?: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  title: string;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const panelExpanded = expanded ?? internalExpanded;
  const Icon = icon;
  const StateIcon = panelExpanded ? ChevronUp : ChevronDown;
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: withTiming(panelExpanded ? 1 : 0, { duration: 160 }),
    transform: [{ translateY: withTiming(panelExpanded ? 0 : -4, { duration: 160 }) }]
  }), [panelExpanded]);

  const toggleExpanded = () => {
    const nextExpanded = !panelExpanded;
    setInternalExpanded(nextExpanded);
    onExpandedChange?.(nextExpanded);
  };

  return (
    <View style={quiet ? styles.groupList : styles.group}>
      <Pressable
        accessibilityLabel={panelExpanded ? `收起${title}` : `展开${title}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: panelExpanded }}
        android_ripple={androidRipple(theme.primarySoft)}
        style={styles.expandableHeader}
        onPress={toggleExpanded}
      >
        {Icon ? (
          <View style={styles.menuIcon}>
            <Icon size={19} color={theme.primary} strokeWidth={1.8} />
          </View>
        ) : null}
        <View style={styles.flex}>
          <Text style={styles.panelTitle}>{title}</Text>
          {meta ? <Text style={styles.meta} numberOfLines={2}>{meta}</Text> : null}
        </View>
        <View style={styles.expandableStateIcon}>
          <StateIcon size={18} color={theme.primary} strokeWidth={1.9} />
        </View>
      </Pressable>
      <Animated.View pointerEvents={panelExpanded ? 'auto' : 'none'} style={[styles.expandableBody, { display: panelExpanded ? 'flex' : 'none' }, bodyStyle]}>
        {children}
      </Animated.View>
    </View>
  );
}

export function InfoRow({
  icon,
  label,
  value,
  styles,
  theme
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
}) {
  const Icon = icon;
  return (
    <View style={styles.menuButton}>
      <View style={styles.menuIcon}>
        <Icon size={19} color={theme.primary} strokeWidth={1.8} />
      </View>
      <Text style={[styles.menuLabel, styles.flex]}>{label}</Text>
      <Text style={styles.meta} numberOfLines={1}>{value}</Text>
    </View>
  );
}

export function FloatingIconButton({
  disabled = false,
  icon,
  label,
  loading = false,
  styles,
  theme,
  onPress
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      android_ripple={androidRipple(theme.primarySoft, true)}
      disabled={disabled}
      style={[styles.floatingIconButton, disabled && styles.buttonDisabled]}
      onPress={() => pressWithFeedback(onPress)}
    >
      {loading ? <ActivityIndicator color={theme.primary} size="small" /> : <Icon size={20} color={theme.primary} strokeWidth={1.9} />}
    </Pressable>
  );
}

export function IconButton({
  active = false,
  compact = false,
  disabled = false,
  ghost = false,
  iconOnly = false,
  icon,
  label,
  styles,
  tiny = false,
  theme,
  onPress
}: {
  active?: boolean;
  compact?: boolean;
  disabled?: boolean;
  ghost?: boolean;
  iconOnly?: boolean;
  icon: LucideIcon;
  label: string;
  styles: ReturnType<typeof createStyles>;
  tiny?: boolean;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const iconSize = tiny ? 15 : iconOnly ? 14 : compact ? 14 : 17;
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      android_ripple={androidRipple(theme.primarySoft, iconOnly || tiny)}
      style={[styles.button, ghost && styles.buttonGhost, compact && styles.buttonCompact, iconOnly && styles.buttonIconOnly, tiny && styles.buttonTiny, active && !iconOnly && styles.buttonActive, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={() => pressWithFeedback(onPress)}
    >
      <Icon size={iconSize} color={active ? theme.primary : theme.ink} fill={active ? theme.primary : 'none'} strokeWidth={1.8} />
      {iconOnly ? null : <Text numberOfLines={1} style={[styles.buttonText, compact && styles.buttonTextCompact, tiny && styles.buttonTextTiny, active && styles.buttonTextActive]}>{label}</Text>}
    </Pressable>
  );
}

export function AppButton({
  compact = false,
  disabled = false,
  label,
  variant = 'default',
  styles,
  onPress
}: {
  compact?: boolean;
  disabled?: boolean;
  label: string;
  variant?: 'default' | 'danger' | 'ghost' | 'primary';
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.button, compact && styles.buttonCompact, variant === 'ghost' && styles.buttonGhost, variant === 'primary' && styles.buttonPrimary, variant === 'danger' && styles.buttonDanger, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={() => pressWithFeedback(onPress)}
    >
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact, variant === 'primary' && styles.buttonTextPrimary, variant === 'danger' && styles.buttonTextDanger]}>{label}</Text>
    </Pressable>
  );
}

export function EmptyText({ text, styles }: { text: string; styles: ReturnType<typeof createStyles> }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export function LoadingState({ text, styles, theme }: { text: string; styles: ReturnType<typeof createStyles>; theme: ReaderTheme }) {
  return (
    <View style={styles.loadingState}>
      <View style={styles.loadingStateHeader}>
        <ActivityIndicator color={theme.primary} size="small" />
        <Text style={styles.loadingStateText}>{text}</Text>
      </View>
      <View style={styles.loadingPlaceholderStack}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.loadingPlaceholderLine,
              index === 0 && styles.loadingPlaceholderLineShort,
              index === 2 && styles.loadingPlaceholderLineMuted
            ]}
          />
        ))}
      </View>
    </View>
  );
}
