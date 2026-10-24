import { StyleSheet, Text, View } from 'react-native';
import { Bell, Home, UserRound, Search, type LucideIcon } from 'lucide-react-native';
import type { MainTabParamList } from './appRouteTypes';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { type ReaderStyleSettings, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export const tabNavItems: { value: keyof MainTabParamList; label: string; icon: LucideIcon }[] = [
  { value: 'feed', label: '首页', icon: Home },
  { value: 'search', label: '搜索', icon: Search },
  { value: 'notifications', label: '消息', icon: Bell },
  { value: 'more', label: '我的', icon: UserRound }
];

export function TabBarIcon({
  focused,
  icon,
  label,
  showBadge = false
}: {
  focused: boolean;
  icon: LucideIcon;
  label: string;
  showBadge?: boolean;
}) {
  const { styles, theme } = useReaderThemeStyles(createNavBarStyles);
  const Icon = icon;
  const color = focused ? theme.primary : theme.muted;
  return (
    <View style={styles.navItem}>
      <View style={styles.navIconPill}>
        <View style={styles.navIconWrap}>
          <Icon size={24} color={color} strokeWidth={focused ? 2.2 : 1.7} />
          {showBadge ? <View style={styles.navBadge} /> : null}
        </View>
      </View>
      <Text style={[styles.navText, focused && styles.navTextActive]}>{label}</Text>
    </View>
  );
}

export function createNavBarStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 48, borderRadius: 6 },
    navIconPill: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 46,
      height: 28,
      borderRadius: 999,
      paddingHorizontal: 16
    },
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
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: 10,
      fontWeight: '500',
      letterSpacing: 0
    },
    navTextActive: { color: theme.primary, fontWeight: '600' }
  });
}
