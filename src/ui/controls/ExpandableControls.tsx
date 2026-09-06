import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export function createExpandableStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    group: {
      gap: 8,
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    groupList: {
      gap: 7,
      backgroundColor: 'transparent',
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderRadius: 0,
      paddingHorizontal: 0,
      paddingVertical: 12
    },
    menuButton: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44 },
    menuIcon: { alignItems: 'center', justifyContent: 'center', width: 30, height: 30 },
    menuLabel: { color: theme.ink, fontFamily, fontSize: 15, fontWeight: '600' },
    menuChevron: { marginLeft: 4, opacity: 0.45 },
    menuChevronExpanded: { transform: [{ rotate: '180deg' }] },
    header: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44 },
    stateIcon: { alignItems: 'center', justifyContent: 'center', width: 24, height: 32 },
    body: { gap: 10, overflow: 'hidden' },
    flex: { flex: 1 },
    meta: { color: theme.muted, fontFamily, fontSize: 12, lineHeight: 17 },
    panelTitle: { color: theme.ink, fontFamily, fontSize: 15, fontWeight: '600' },
    disabled: { opacity: 0.45 }
  });
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
  const Chevron = expanded === undefined ? ChevronRight : ChevronDown;
  const nestedActionColor = theme.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.menuButton, disabled && styles.disabled]}
      onPress={onPress}
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
  const StateIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <View style={quiet ? styles.groupList : styles.group}>
      <Pressable
        accessibilityLabel={expanded ? `收起${title}` : `展开${title}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={styles.header}
        onPress={() => onExpandedChange(!expanded)}
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
        <View style={styles.stateIcon}>
          <StateIcon size={18} color={theme.primary} strokeWidth={1.9} />
        </View>
      </Pressable>
      <View pointerEvents={expanded ? 'auto' : 'none'} style={[styles.body, { display: expanded ? 'flex' : 'none' }]}>
        {children}
      </View>
    </View>
  );
}
