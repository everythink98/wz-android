import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { TOUCH_HIT_SLOP } from './touchTarget';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
  return StyleSheet.create({
    floating: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
      borderRadius: 22,
      borderColor: theme.line,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.surface,
      elevation: 1
    },
    button: {
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 5
    },
    compact: {
      minHeight: 40,
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 2
    },
    iconOnly: {
      width: 44,
      minHeight: 44,
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 22,
      paddingHorizontal: 0,
      paddingVertical: 0
    },
    tiny: {
      alignSelf: 'flex-start',
      borderRadius: 8,
      minHeight: 40,
      gap: 5,
      backgroundColor: alphaColor(theme.primary, theme.dark ? 0.1 : 0.045),
      borderColor: theme.line,
      paddingHorizontal: 10,
      paddingVertical: 0
    },
    ghost: {
      backgroundColor: 'transparent',
      borderColor: 'transparent'
    },
    danger: {
      backgroundColor: alphaColor(theme.danger, theme.dark ? 0.14 : 0.06),
      borderColor: alphaColor(theme.danger, theme.dark ? 0.38 : 0.24)
    },
    primary: {
      backgroundColor: theme.primaryStrong,
      borderColor: theme.primaryStrong
    },
    active: {
      backgroundColor: theme.mist,
      borderColor: 'transparent'
    },
    disabled: {
      opacity: 0.45
    },
    text: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: fontSize(13),
      fontWeight: '600'
    },
    textCompact: {
      fontSize: fontSize(12),
      fontWeight: '500'
    },
    textTiny: {
      color: theme.muted,
      fontSize: fontSize(12),
      fontWeight: '500',
      includeFontPadding: false,
      lineHeight: fontSize(16)
    },
    textActive: {
      color: theme.primary
    },
    textDanger: {
      color: theme.danger
    },
    textPrimary: {
      color: theme.onPrimary,
      fontWeight: '700',
      letterSpacing: 0
    }
  });
}

export function FloatingIconButton({
  disabled = false,
  icon,
  label,
  loading = false,
  onPress
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const Icon = icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.floating, disabled && styles.disabled]}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator color={theme.primary} size="small" />
      ) : (
        <Icon size={20} color={theme.primary} strokeWidth={1.9} />
      )}
    </Pressable>
  );
}

export function IconButton({
  active = false,
  activeColor,
  compact = false,
  disabled = false,
  ghost = false,
  iconOnly = false,
  icon,
  iconSize,
  label,
  loading = false,
  tiny = false,
  onPress
}: {
  active?: boolean;
  activeColor?: string;
  compact?: boolean;
  disabled?: boolean;
  ghost?: boolean;
  iconOnly?: boolean;
  icon: LucideIcon;
  iconSize?: number;
  label: string;
  loading?: boolean;
  tiny?: boolean;
  onPress: () => void;
}) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const Icon = icon;
  const resolvedIconSize = iconSize ?? (tiny ? 15 : iconOnly ? 14 : compact ? 14 : 17);
  const color = active ? activeColor || theme.primary : theme.ink;
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, selected: active, busy: loading }}
      style={[
        styles.button,
        ghost && styles.ghost,
        compact && styles.compact,
        iconOnly && styles.iconOnly,
        tiny && styles.tiny,
        active && !iconOnly && styles.active,
        disabled && styles.disabled
      ]}
      disabled={disabled || loading}
      onPress={onPress}
    >
      {loading ? (
        <ActivityIndicator
          accessible={false}
          color={color}
          size="small"
          style={{ width: resolvedIconSize, height: resolvedIconSize }}
        />
      ) : (
        <Icon size={resolvedIconSize} color={color} fill={active ? color : 'none'} strokeWidth={1.8} />
      )}
      {iconOnly ? null : (
        <Text
          numberOfLines={1}
          style={[styles.text, compact && styles.textCompact, tiny && styles.textTiny, active && styles.textActive]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function AppButton({
  accessibilityLabel,
  compact = false,
  disabled = false,
  label,
  testID,
  tiny = false,
  variant = 'default',
  onPress
}: {
  accessibilityLabel?: string;
  compact?: boolean;
  disabled?: boolean;
  label: string;
  testID?: string;
  tiny?: boolean;
  variant?: 'default' | 'danger' | 'ghost' | 'primary';
  onPress: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <Pressable
      testID={testID}
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled }}
      style={[
        styles.button,
        compact && styles.compact,
        tiny && styles.tiny,
        variant === 'ghost' && styles.ghost,
        variant === 'primary' && styles.primary,
        variant === 'danger' && styles.danger,
        disabled && styles.disabled
      ]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text
        style={[
          styles.text,
          compact && styles.textCompact,
          tiny && styles.textTiny,
          variant === 'primary' && styles.textPrimary,
          variant === 'danger' && styles.textDanger
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
