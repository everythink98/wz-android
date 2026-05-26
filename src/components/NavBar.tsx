import { Text, View } from 'react-native';
import { Home, MoreHorizontal, Search, Star, type LucideIcon } from 'lucide-react-native';
import type { Screen } from '../appTypes';
import { createStyles, type ReaderTheme } from '../theme';

export const tabNavItems: Array<{ value: Screen; label: string; icon: LucideIcon }> = [
  { value: 'feed', label: '首页', icon: Home },
  { value: 'search', label: '搜索', icon: Search },
  { value: 'library', label: '收藏', icon: Star },
  { value: 'more', label: '更多', icon: MoreHorizontal }
];

export function TabBarIcon({
  focused,
  icon,
  label,
  styles,
  theme
}: {
  focused: boolean;
  icon: LucideIcon;
  label: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
}) {
  const Icon = icon;
  return (
    <View style={styles.navItem}>
      <View style={[styles.navItemIndicator, focused && styles.navItemIndicatorActive]} />
      <Icon size={21} color={focused ? theme.primary : theme.muted} strokeWidth={1.7} />
      <Text style={[styles.navText, focused && styles.navTextActive]}>{label}</Text>
    </View>
  );
}
