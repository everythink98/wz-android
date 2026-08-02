import { StyleSheet, Text, View } from 'react-native';
import { Home, MoreHorizontal, Search, Star, type LucideIcon } from 'lucide-react-native';
import type { Screen } from './types';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export const tabNavItems: { value: Screen; label: string; icon: LucideIcon }[] = [
  { value: 'feed', label: '首页', icon: Home },
  { value: 'search', label: '搜索', icon: Search },
  { value: 'library', label: '收藏', icon: Star },
  { value: 'more', label: '更多', icon: MoreHorizontal }
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
          <Icon size={21} color={color} strokeWidth={focused ? 2.1 : 1.7} />
          {showBadge ? <View style={styles.navBadge} /> : null}
        </View>
      </View>
      <Text style={[styles.navText, focused && styles.navTextActive]}>{label}</Text>
    </View>
  );
}

export function createNavBarStyles(theme: ReaderTheme, settings: ReaderSettings) {
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
      fontWeight: '600',
      letterSpacing: 0
    },
    navTextActive: { color: theme.primary, fontWeight: '700' }
  });
}
