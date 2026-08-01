import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { alphaColor, androidRipple, createStyles, type ReaderTheme } from '@/theme';
import { triggerPressFeedback } from '@/components/AppControls';

export type DetailActionTone = 'danger' | 'favorite' | 'primary' | 'success' | 'warning';

function detailActionColor(tone: DetailActionTone, theme: ReaderTheme) {
  if (tone === 'danger') {
    return theme.danger;
  }
  if (tone === 'favorite') {
    return theme.favorite;
  }
  if (tone === 'success') {
    return theme.success;
  }
  if (tone === 'warning') {
    return theme.warning;
  }
  return theme.primary;
}

export function DetailActionButton({
  accessibilityLabel,
  active = false,
  compact = false,
  count,
  disabled = false,
  icon,
  label,
  pending = false,
  alignStart = false,
  tone = 'primary',
  styles,
  theme,
  onPress
}: {
  accessibilityLabel: string;
  active?: boolean;
  compact?: boolean;
  count?: number;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  pending?: boolean;
  alignStart?: boolean;
  tone?: DetailActionTone;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const activeColor = detailActionColor(tone, theme);
  const color = active ? activeColor : theme.ink;
  const textColor = active && tone === 'favorite' ? theme.ink : color;
  const activeSoft = alphaColor(activeColor, theme.dark ? 0.13 : 0.07);
  const visibleCount = typeof count === 'number' ? (compact && count > 99 ? '99+' : String(count)) : '';
  const iconSize = compact ? 16 : 18;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: pending, disabled, selected: active }}
      android_ripple={androidRipple(
        active ? alphaColor(activeColor, theme.dark ? 0.18 : 0.12) : theme.primarySoft,
        true
      )}
      disabled={disabled}
      style={[
        styles.detailActionButton,
        alignStart && styles.replyDetailActionButton,
        compact && styles.replyCompactActionButton,
        active && styles.detailActionButtonActive,
        active && { backgroundColor: activeSoft },
        alignStart && active && styles.replyDetailActionButtonActive,
        disabled && styles.buttonDisabled
      ]}
      onPress={() => {
        triggerPressFeedback();
        onPress();
      }}
    >
      <View style={[styles.detailActionIconSlot, compact && styles.replyCompactActionIconSlot]}>
        {pending ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Icon
            size={iconSize}
            color={color}
            fill={active ? alphaColor(activeColor, theme.dark ? 0.2 : 0.14) : 'none'}
            strokeWidth={active ? 2.1 : 1.8}
          />
        )}
      </View>
      <View style={[styles.detailActionTextBlock, compact && styles.detailActionCompactTextBlock]}>
        <Text
          numberOfLines={1}
          style={[
            styles.detailActionLabel,
            compact && styles.detailActionCompactLabel,
            active && styles.detailActionLabelActive,
            active && { color: textColor }
          ]}
        >
          {label}
        </Text>
        {visibleCount ? (
          <Text
            numberOfLines={1}
            style={[
              styles.detailActionCount,
              compact && styles.detailActionCompactCount,
              active && styles.detailActionLabelActive,
              active && { color: textColor }
            ]}
          >
            {visibleCount}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
