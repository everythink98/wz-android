import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { pressWithFeedback, TOUCH_HIT_SLOP } from './pressFeedback';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    pillRail: { gap: 2, paddingRight: 18, paddingVertical: 0 },
    pill: {
      minHeight: 40,
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 8,
      paddingVertical: 4
    },
    pillActive: {
      backgroundColor: theme.mist,
      borderColor: alphaColor(theme.primary, theme.dark ? 0.24 : 0.12)
    },
    pillText: { color: theme.muted, fontFamily, fontSize: 11, fontWeight: '500' },
    pillTextActive: { color: theme.primary, fontWeight: '600' },
    subtabRail: { gap: 20, paddingRight: 18, paddingVertical: 0 },
    subtab: {
      minHeight: 34,
      justifyContent: 'center',
      backgroundColor: 'transparent',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingHorizontal: 2,
      paddingTop: 3,
      paddingBottom: 5
    },
    subtabActive: { borderBottomColor: theme.primary },
    subtabText: { color: theme.muted, fontFamily, fontSize: 12, fontWeight: '500' },
    subtabTextActive: { color: theme.primary, fontWeight: '600' },
    tabRail: {
      gap: 22,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingRight: 18
    },
    tab: {
      minWidth: 48,
      minHeight: 48,
      justifyContent: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingBottom: 4
    },
    tabActive: { borderBottomColor: theme.primary },
    tabText: { color: theme.muted, fontFamily, fontSize: 13, fontWeight: '500' },
    tabTextActive: { color: theme.primary, fontWeight: '600' },
    settingGroup: { gap: 7 },
    panelTitle: { color: theme.ink, fontFamily, fontSize: 15, fontWeight: '600' }
  });
}

export function PillRail({
  disabled = false,
  items,
  variant = 'pills',
  value,
  resetScrollKey,
  testIDPrefix,
  onChange
}: {
  disabled?: boolean;
  items: { value: string; label: string }[];
  variant?: 'pills' | 'tabs' | 'subtabs';
  value: string;
  resetScrollKey?: string | number;
  testIDPrefix?: string;
  onChange: (value: string) => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const isTabs = variant === 'tabs';
  const isSubtabs = variant === 'subtabs';
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (resetScrollKey !== undefined) scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [resetScrollKey]);
  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      fadingEdgeLength={0}
      contentContainerStyle={isTabs ? styles.tabRail : isSubtabs ? styles.subtabRail : styles.pillRail}
    >
      {items.map((item) => (
        <Pressable
          testID={testIDPrefix ? `${testIDPrefix}-${item.value}` : undefined}
          hitSlop={TOUCH_HIT_SLOP}
          key={`${item.value}-${item.label}`}
          accessibilityLabel={`${item.label}${value === item.value ? '，已选择' : ''}`}
          accessibilityRole="button"
          accessibilityState={
            disabled ? { disabled: true, selected: value === item.value } : { selected: value === item.value }
          }
          disabled={disabled || undefined}
          style={
            isTabs
              ? [styles.tab, value === item.value && styles.tabActive]
              : isSubtabs
                ? [styles.subtab, value === item.value && styles.subtabActive]
                : [styles.pill, value === item.value && styles.pillActive]
          }
          onPress={() => pressWithFeedback(() => onChange(item.value))}
        >
          <Text
            style={
              isTabs
                ? [styles.tabText, value === item.value && styles.tabTextActive]
                : isSubtabs
                  ? [styles.subtabText, value === item.value && styles.subtabTextActive]
                  : [styles.pillText, value === item.value && styles.pillTextActive]
            }
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function SettingRail({
  title,
  items,
  value,
  onChange
}: {
  title: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <View style={styles.settingGroup}>
      <Text style={styles.panelTitle}>{title}</Text>
      <PillRail items={items} value={value} onChange={onChange} />
    </View>
  );
}
