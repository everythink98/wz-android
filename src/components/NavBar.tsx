import { Pressable, Text, View } from 'react-native';
import { Home, MoreHorizontal, Search, Star, type LucideIcon } from 'lucide-react-native';
import type { Screen } from '../appTypes';
import { androidRipple, createStyles, type ReaderTheme } from '../theme';

export function NavBar({
  active,
  styles,
  theme,
  onChange
}: {
  active: Screen;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onChange: (screen: Screen) => void;
}) {
  const items: Array<{ value: Screen; label: string; icon: LucideIcon }> = [
    { value: 'feed', label: '首页', icon: Home },
    { value: 'search', label: '搜索', icon: Search },
    { value: 'library', label: '收藏', icon: Star },
    { value: 'more', label: '更多', icon: MoreHorizontal }
  ];
  return (
    <View style={styles.nav}>
      {items.map((item) => {
        const Icon = item.icon;
        const selected = active === item.value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            android_ripple={androidRipple(theme.primarySoft)}
            style={[styles.navItem, selected && styles.navItemActive]}
            onPress={() => onChange(item.value)}
          >
            <Icon size={21} color={selected ? theme.primary : theme.muted} strokeWidth={1.8} />
            <Text style={[styles.navText, selected && styles.navTextActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
