import type { SharedStyles } from '@/ui/theme/sharedStyles';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ChevronDown, ChevronRight, ChevronUp, type LucideIcon } from 'lucide-react-native';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import { pressWithFeedback } from './pressFeedback';

export function MenuButton({
  disabled = false,
  icon,
  label,
  nested = false,
  value,
  expanded,
  styles,
  theme,
  onPress
}: {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  nested?: boolean;
  value: string;
  expanded?: boolean;
  styles: SharedStyles;
  theme: ReaderTheme;
  onPress: () => void;
}) {
  const Icon = icon;
  const Chevron = expanded === undefined ? ChevronRight : ChevronDown;
  const nestedActionColor = theme.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      android_ripple={nested ? androidRipple(theme.primarySoft) : undefined}
      disabled={disabled}
      style={[styles.menuButton, disabled && styles.buttonDisabled]}
      onPress={() => pressWithFeedback(onPress)}
    >
      {nested ? null : (
        <View style={styles.menuIcon}>
          <Icon size={19} color={theme.primary} strokeWidth={1.8} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={[styles.menuLabel, nested && { color: nestedActionColor }]}>{label}</Text>
        <Text style={styles.meta} numberOfLines={2}>
          {value}
        </Text>
      </View>
      <Chevron
        size={16}
        color={nested ? nestedActionColor : theme.muted}
        strokeWidth={1.6}
        style={[styles.menuChevron, expanded && styles.menuChevronExpanded]}
      />
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
  styles: SharedStyles;
  theme: ReaderTheme;
  title: string;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const panelExpanded = expanded ?? internalExpanded;
  const Icon = icon;
  const StateIcon = panelExpanded ? ChevronUp : ChevronDown;
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
          {meta ? (
            <Text style={styles.meta} numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
        </View>
        <View style={styles.expandableStateIcon}>
          <StateIcon size={18} color={theme.primary} strokeWidth={1.9} />
        </View>
      </Pressable>
      <View
        pointerEvents={panelExpanded ? 'auto' : 'none'}
        style={[styles.expandableBody, { display: panelExpanded ? 'flex' : 'none' }]}
      >
        {children}
      </View>
    </View>
  );
}
