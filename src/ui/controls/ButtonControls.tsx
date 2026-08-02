import type { SharedStyles } from '@/ui/theme/sharedStyles';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import { pressWithFeedback, TOUCH_HIT_SLOP } from './pressFeedback';

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
  styles: SharedStyles;
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
  label,
  styles,
  tiny = false,
  theme,
  onPress
}: {
  active?: boolean;
  activeColor?: string;
  compact?: boolean;
  disabled?: boolean;
  ghost?: boolean;
  iconOnly?: boolean;
  icon: LucideIcon;
  label: string;
  styles: SharedStyles;
  tiny?: boolean;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const iconSize = tiny ? 15 : iconOnly ? 14 : compact ? 14 : 17;
  const color = active ? activeColor || theme.primary : theme.ink;
  return (
    <Pressable
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      android_ripple={androidRipple(theme.primarySoft, iconOnly || tiny)}
      style={[
        styles.button,
        ghost && styles.buttonGhost,
        compact && styles.buttonCompact,
        iconOnly && styles.buttonIconOnly,
        tiny && styles.buttonTiny,
        active && !iconOnly && styles.buttonActive,
        disabled && styles.buttonDisabled
      ]}
      disabled={disabled}
      onPress={() => pressWithFeedback(onPress)}
    >
      <Icon size={iconSize} color={color} fill={active ? color : 'none'} strokeWidth={1.8} />
      {iconOnly ? null : (
        <Text
          numberOfLines={1}
          style={[
            styles.buttonText,
            compact && styles.buttonTextCompact,
            tiny && styles.buttonTextTiny,
            active && styles.buttonTextActive
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function AppButton({
  compact = false,
  disabled = false,
  label,
  testID,
  tiny = false,
  variant = 'default',
  styles,
  onPress
}: {
  compact?: boolean;
  disabled?: boolean;
  label: string;
  testID?: string;
  tiny?: boolean;
  variant?: 'default' | 'danger' | 'ghost' | 'primary';
  styles: SharedStyles;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      hitSlop={TOUCH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        tiny && styles.buttonTiny,
        variant === 'ghost' && styles.buttonGhost,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled
      ]}
      disabled={disabled}
      onPress={() => pressWithFeedback(onPress)}
    >
      <Text
        style={[
          styles.buttonText,
          compact && styles.buttonTextCompact,
          tiny && styles.buttonTextTiny,
          variant === 'primary' && styles.buttonTextPrimary,
          variant === 'danger' && styles.buttonTextDanger
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}
