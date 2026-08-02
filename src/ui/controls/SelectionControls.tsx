import type { SharedStyles } from '@/ui/theme/sharedStyles';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { pressWithFeedback, TOUCH_HIT_SLOP } from './pressFeedback';

export function PillRail({
  disabled = false,
  items,
  variant = 'pills',
  value,
  resetScrollKey,
  testIDPrefix,
  styles,
  onChange
}: {
  disabled?: boolean;
  items: { value: string; label: string }[];
  variant?: 'pills' | 'tabs' | 'subtabs';
  value: string;
  resetScrollKey?: string | number;
  testIDPrefix?: string;
  styles: SharedStyles;
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
  styles,
  onChange
}: {
  title: string;
  items: { value: string; label: string }[];
  value: string;
  styles: SharedStyles;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.settingGroup}>
      <Text style={styles.panelTitle}>{title}</Text>
      <PillRail items={items} value={value} styles={styles} onChange={onChange} />
    </View>
  );
}
