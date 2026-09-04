import type { TopicStyles } from '../styles';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { alphaColor, type ReaderTheme } from '@/ui/theme/tokens';

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

function topicPrimarySelectedColor(tone: DetailActionTone, theme: ReaderTheme) {
  if (tone === 'danger') return theme.dark ? '#FF5C5C' : '#EB3B3B';
  if (tone === 'favorite') return theme.warning;
  if (tone === 'warning') return theme.dark ? '#E09678' : '#B75D42';
  return theme.primary;
}

export function DetailActionButton({
  accessibilityLabel,
  active = false,
  compact = false,
  count,
  disabled = false,
  icon,
  activeIcon,
  iconSize,
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
  activeIcon?: LucideIcon;
  iconSize?: number;
  label: string;
  pending?: boolean;
  alignStart?: boolean;
  tone?: DetailActionTone;
  styles: TopicStyles;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const isTopicPrimaryAction = !alignStart;
  const Icon = active ? (activeIcon ?? icon) : icon;
  const activeColor = detailActionColor(tone, theme);
  const topicSelectedColor = topicPrimarySelectedColor(tone, theme);
  const color = isTopicPrimaryAction
    ? active || pending
      ? topicSelectedColor
      : tone === 'favorite'
        ? theme.warning
        : theme.muted
    : active || pending
      ? activeColor
      : theme.ink;
  const fill = active
    ? isTopicPrimaryAction
      ? tone === 'favorite'
        ? theme.favorite
        : topicSelectedColor
      : alphaColor(activeColor, theme.dark ? 0.2 : 0.14)
    : 'none';
  const textColor = active && tone === 'favorite' ? theme.ink : color;
  const visibleCount = typeof count === 'number' ? (compact && count > 99 ? '99+' : String(count)) : '';
  const resolvedIconSize = iconSize ?? (compact ? 16 : 18);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: pending, disabled, selected: active }}
      disabled={disabled}
      style={[
        styles.detailActionButton,
        !alignStart && styles.topicPrimaryActionButton,
        alignStart && styles.replyDetailActionButton,
        compact && styles.replyCompactActionButton,
        disabled && !pending && !active && styles.buttonDisabled
      ]}
      onPress={() => {
        onPress();
      }}
    >
      <View style={[styles.detailActionIconSlot, compact && styles.replyCompactActionIconSlot]}>
        {pending ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Icon size={resolvedIconSize} color={color} fill={fill} strokeWidth={active ? 2.1 : 1.8} />
        )}
      </View>
      <View style={[styles.detailActionTextBlock, compact && styles.detailActionCompactTextBlock]}>
        <Text
          numberOfLines={1}
          style={[
            styles.detailActionLabel,
            !alignStart && styles.topicPrimaryActionLabel,
            compact && styles.detailActionCompactLabel,
            alignStart && active && styles.detailActionLabelActive,
            alignStart && active && { color: textColor }
          ]}
        >
          {label}
        </Text>
        {visibleCount ? (
          <Text
            numberOfLines={1}
            style={[
              styles.detailActionCount,
              !alignStart && styles.topicPrimaryActionCount,
              compact && styles.detailActionCompactCount,
              alignStart && active && styles.detailActionLabelActive,
              alignStart && active && { color: textColor }
            ]}
          >
            {visibleCount}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
