import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';

export const TOUCH_HIT_SLOP = { top: 6, right: 6, bottom: 6, left: 6 };

export function PillRail({
  items,
  variant = 'pills',
  value,
  styles,
  onChange
}: {
  items: Array<{ value: string; label: string }>;
  variant?: 'pills' | 'tabs';
  value: string;
  styles: ReturnType<typeof createStyles>;
  onChange: (value: string) => void;
}) {
  const isTabs = variant === 'tabs';
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={isTabs ? styles.tabRail : styles.pillRail}>
      {items.map((item) => (
        <Pressable
          hitSlop={TOUCH_HIT_SLOP}
          key={`${item.value}-${item.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected: value === item.value }}
          style={isTabs ? [styles.tab, value === item.value && styles.tabActive] : [styles.pill, value === item.value && styles.pillActive]}
          onPress={() => onChange(item.value)}
        >
          <Text style={isTabs ? [styles.tabText, value === item.value && styles.tabTextActive] : [styles.pillText, value === item.value && styles.pillTextActive]}>{item.label}</Text>
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
  styles,
  theme,
  onPress
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  return (
    <Pressable accessibilityRole="button" style={styles.menuButton} onPress={onPress}>
      <View style={styles.menuIcon}>
        <Icon size={19} color={theme.primary} strokeWidth={1.8} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.menuLabel}>{label}</Text>
        <Text style={styles.meta} numberOfLines={2}>{value}</Text>
      </View>
    </Pressable>
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
      onPress={onPress}
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
      onPress={onPress}
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
  variant?: 'default' | 'ghost';
  styles: ReturnType<typeof createStyles>;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.button, compact && styles.buttonCompact, variant === 'ghost' && styles.buttonGhost, disabled && styles.buttonDisabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.buttonText, compact && styles.buttonTextCompact]}>{label}</Text>
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
