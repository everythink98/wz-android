import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Bell, Home, UserRound, Search, type LucideIcon } from 'lucide-react-native';
import type { MainTabParamList } from './appRouteTypes';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { type ReaderStyleSettings, fontFamilyValue, type ReaderTheme, textSizeStyle } from '@/ui/theme/tokens';

export const tabNavItems: { value: keyof MainTabParamList; label: string; icon: LucideIcon }[] = [
  { value: 'feed', label: '首页', icon: Home },
  { value: 'search', label: '搜索', icon: Search },
  { value: 'notifications', label: '消息', icon: Bell },
  { value: 'more', label: '我的', icon: UserRound }
];

export function TabBarIcon({
  focused,
  icon,
  showBadge = false
}: {
  focused: boolean;
  icon: LucideIcon;
  showBadge?: boolean;
}) {
  const { styles, theme } = useReaderThemeStyles(createNavBarStyles);
  const Icon = icon;
  const color = focused ? styles.navTextActive.color : theme.muted;
  return (
    <View style={styles.navIconWrap}>
      <Icon size={24} color={color} strokeWidth={focused ? 2.2 : 1.7} accessible={false} />
      {showBadge ? <View style={styles.navBadge} /> : null}
    </View>
  );
}

export function TabBarLabel({ focused, label }: { focused: boolean; label: string }) {
  const { styles } = useReaderThemeStyles(createNavBarStyles);
  return (
    <Text numberOfLines={1} style={[styles.navText, focused && styles.navTextActive]}>
      {label}
    </Text>
  );
}

export const TabBarItemContent = memo(function TabBarItemContent({
  focused,
  item,
  showBadge
}: {
  focused: boolean;
  item: (typeof tabNavItems)[number];
  showBadge: boolean;
}) {
  return (
    <>
      <View style={tabIconFrame}>
        <TabBarIcon focused={focused} icon={item.icon} showBadge={showBadge} />
      </View>
      <TabBarLabel focused={focused} label={item.label} />
    </>
  );
});

const tabIconFrame = { width: 31, height: 28, alignItems: 'center', justifyContent: 'center' } as const;

function createNavBarStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    navIconWrap: { position: 'relative' },
    navBadge: {
      position: 'absolute',
      top: -2,
      right: -7,
      width: 8,
      height: 8,
      borderRadius: 999,
      borderColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      backgroundColor: theme.danger
    },
    navText: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(Math.round(10 * settings.uiFontScale)),
      fontWeight: '500',
      letterSpacing: 0
    },
    navTextActive: { color: theme.dark ? theme.primary : theme.primaryStrong, fontWeight: '600' }
  });
}
