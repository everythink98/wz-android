import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import { ScrollView } from 'react-native-gesture-handler';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { readerRadii, type ReaderStyleSettings, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { TOUCH_HIT_SLOP } from './touchTarget';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  const fontSize = (size: number) => Math.round(size * settings.fontScale);
  return StyleSheet.create({
    pillRail: { gap: 2, paddingRight: 18, paddingVertical: 0 },
    pill: {
      minHeight: 40,
      justifyContent: 'center',
      backgroundColor: theme.surface2,
      borderColor: 'transparent',
      borderRadius: readerRadii.control,
      borderWidth: 0,
      paddingHorizontal: 12,
      paddingVertical: 4
    },
    touchTarget: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    subtabTarget: { paddingHorizontal: 10 },
    subtabScroll: { marginLeft: -10 },
    pillActive: {
      backgroundColor: theme.mist,
      borderColor: 'transparent'
    },
    pillText: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(11),
      lineHeight: fontSize(16),
      includeFontPadding: false,
      fontWeight: '500'
    },
    pillTextActive: { color: theme.primary, fontWeight: '600' },
    subtabRail: { gap: 0, paddingRight: 18, paddingVertical: 0 },
    wrappingRail: { flexDirection: 'row', flexWrap: 'wrap', paddingRight: 0, rowGap: 4 },
    subtab: {
      borderRadius: 0,
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
    subtabText: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(12),
      lineHeight: fontSize(16),
      includeFontPadding: false,
      fontWeight: '500'
    },
    subtabTextActive: { color: theme.primary, fontWeight: '600' },
    tabRail: {
      gap: 22,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingRight: 18
    },
    tab: {
      borderRadius: 0,
      minWidth: 48,
      minHeight: 48,
      justifyContent: 'center',
      borderBottomColor: 'transparent',
      borderBottomWidth: 2,
      paddingBottom: 4
    },
    compactTab: { minWidth: undefined, minHeight: 40 },
    tabActive: { borderBottomColor: theme.primary },
    tabText: {
      color: theme.muted,
      fontFamily,
      fontSize: fontSize(13),
      lineHeight: fontSize(18),
      includeFontPadding: false,
      fontWeight: '500',
      textAlign: 'center'
    },
    tabTextActive: { color: theme.primary, fontWeight: '600' },
    settingGroup: { gap: 7 },
    panelTitle: { color: theme.ink, fontFamily, fontSize: fontSize(15), fontWeight: '600' }
  });
}

export function PillRail({
  compactTabs = false,
  disabled = false,
  items,
  layout = 'scroll',
  variant = 'pills',
  value,
  resetScrollKey,
  testIDPrefix,
  onChange
}: {
  compactTabs?: boolean;
  disabled?: boolean;
  items: { value: string; label: string }[];
  layout?: 'scroll' | 'wrap';
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
  const railStyle = isTabs ? styles.tabRail : isSubtabs ? styles.subtabRail : styles.pillRail;
  const content = items.map((item, index) => (
    <TouchableRipple
      testID={testIDPrefix ? `${testIDPrefix}-${item.value}` : undefined}
      hitSlop={TOUCH_HIT_SLOP}
      key={index}
      accessibilityLabel={`${item.label}${value === item.value ? '，已选择' : ''}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: value === item.value }}
      disabled={disabled}
      style={[styles.touchTarget, isSubtabs && styles.subtabTarget]}
      onPress={() => onChange(item.value)}
    >
      <View
        testID={testIDPrefix ? `${testIDPrefix}-${item.value}-container` : undefined}
        style={
          isTabs
            ? [styles.tab, compactTabs && styles.compactTab, value === item.value && styles.tabActive]
            : isSubtabs
              ? [styles.subtab, value === item.value && styles.subtabActive]
              : [styles.pill, value === item.value && styles.pillActive]
        }
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
      </View>
    </TouchableRipple>
  ));
  if (layout === 'wrap')
    return <View style={[railStyle, styles.wrappingRail, isSubtabs && styles.subtabScroll]}>{content}</View>;
  return (
    <ScrollView
      overScrollMode="never"
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      fadingEdgeLength={0}
      contentContainerStyle={railStyle}
      style={isSubtabs ? styles.subtabScroll : undefined}
    >
      {content}
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
