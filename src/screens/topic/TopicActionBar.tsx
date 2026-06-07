import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { androidRipple, createStyles, type ReaderTheme } from '../../theme';
import { triggerPressFeedback } from '../../components/AppControls';

export function TopicActionBar({
  accessibilityLabel,
  active = false,
  count,
  disabled = false,
  icon,
  label,
  pending = false,
  alignStart = false,
  styles,
  theme,
  onPress
}: {
  accessibilityLabel: string;
  active?: boolean;
  count?: number;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  pending?: boolean;
  alignStart?: boolean;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const color = active ? theme.primary : theme.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: pending, disabled, selected: active }}
      android_ripple={androidRipple(theme.primarySoft, true)}
      disabled={disabled}
      style={[
        styles.detailActionButton,
        alignStart && styles.replyDetailActionButton,
        active && styles.detailActionButtonActive,
        alignStart && active && styles.replyDetailActionButtonActive,
        disabled && styles.buttonDisabled
      ]}
      onPress={() => {
        triggerPressFeedback();
        onPress();
      }}
    >
      <View style={styles.detailActionIconSlot}>
        {pending ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : (
          <Icon size={18} color={color} fill={active ? theme.primarySoft : 'none'} strokeWidth={active ? 2.1 : 1.8} />
        )}
      </View>
      <View style={styles.detailActionTextBlock}>
        <Text numberOfLines={1} style={[styles.detailActionLabel, active && styles.detailActionLabelActive]}>{label}</Text>
        {typeof count === 'number' ? <Text numberOfLines={1} style={[styles.detailActionCount, active && styles.detailActionLabelActive]}>{count}</Text> : null}
      </View>
    </Pressable>
  );
}

export const DetailActionButton = TopicActionBar;
