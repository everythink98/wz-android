import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    empty: { color: theme.muted, fontFamily, fontSize: 13, paddingVertical: 24, textAlign: 'center' },
    state: {
      width: '100%',
      alignItems: 'stretch',
      justifyContent: 'center',
      gap: 12,
      minHeight: 156,
      backgroundColor: alphaColor(theme.primary, 0.035),
      borderColor: alphaColor(theme.primary, theme.dark ? 0.2 : 0.12),
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 16,
      paddingVertical: 22
    },
    header: { alignItems: 'center', flexDirection: 'row', gap: 9 },
    text: { color: theme.muted, fontFamily, fontSize: 13 },
    placeholders: { gap: 8 },
    line: { alignSelf: 'stretch', height: 10, borderRadius: 999, backgroundColor: theme.line },
    shortLine: { width: '42%' },
    mutedLine: { width: '68%' }
  });
}

export function EmptyText({ text }: { text: string }) {
  const { styles } = useReaderThemeStyles(createStyles);
  return <Text style={styles.empty}>{text}</Text>;
}

export function LoadingState({ text }: { text: string }) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  return (
    <View
      accessible
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      role="status"
      style={styles.state}
    >
      <View style={styles.header}>
        <ActivityIndicator accessible={false} color={theme.primary} size="small" />
        <Text accessible={false} style={styles.text}>
          {text}
        </Text>
      </View>
      <View style={styles.placeholders}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View key={index} style={[styles.line, index === 0 && styles.shortLine, index === 2 && styles.mutedLine]} />
        ))}
      </View>
    </View>
  );
}
