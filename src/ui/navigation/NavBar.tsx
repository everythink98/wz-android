import type { SharedStyles } from '@/ui/theme/sharedStyles';
import { Text, View } from 'react-native';
import { Home, MoreHorizontal, Search, Star, type LucideIcon } from 'lucide-react-native';
import type { Screen } from './types';
import { type ReaderTheme } from '@/ui/theme/tokens';

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
  showBadge = false,
  styles,
  theme
}: {
  focused: boolean;
  icon: LucideIcon;
  label: string;
  showBadge?: boolean;
  styles: SharedStyles;
  theme: ReaderTheme;
}) {
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
