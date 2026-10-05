import { ChevronRight } from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { UserReference } from '@/domain/forum/models';
import { Avatar } from '@/ui/avatar/Avatar';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderStyleSettings, type ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    title: { minHeight: 48, alignItems: 'center', flexDirection: 'row', gap: 8, flexShrink: 1 },
    name: {
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: Math.round(16 * settings.fontScale),
      lineHeight: Math.round(23 * settings.fontScale),
      fontWeight: '600',
      flexShrink: 1
    }
  });
}

export function NotificationContactTitle({ user, onPress }: { user: UserReference; onPress: () => void }) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  return (
    <Pressable
      style={styles.title}
      accessibilityRole="button"
      accessibilityLabel={`查看 ${user.displayName} 的主页`}
      onPress={onPress}
    >
      <Avatar small contentSource={user.source} name={user.displayName} uri={user.avatar} />
      <Text style={styles.name} numberOfLines={1}>
        {user.displayName}
      </Text>
      <ChevronRight size={15} color={theme.muted} accessibilityElementsHidden importantForAccessibility="no" />
    </Pressable>
  );
}
