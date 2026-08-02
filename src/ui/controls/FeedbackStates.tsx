import type { SharedStyles } from '@/ui/theme/sharedStyles';
import { ActivityIndicator, Text, View } from 'react-native';
import type { ReaderTheme } from '@/ui/theme/tokens';

export function EmptyText({ text, styles }: { text: string; styles: SharedStyles }) {
  return <Text style={styles.empty}>{text}</Text>;
}

export function LoadingState({ text, styles, theme }: { text: string; styles: SharedStyles; theme: ReaderTheme }) {
  return (
    <View
      accessible
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      role="status"
      style={styles.loadingState}
    >
      <View style={styles.loadingStateHeader}>
        <ActivityIndicator accessible={false} color={theme.primary} size="small" />
        <Text accessible={false} style={styles.loadingStateText}>
          {text}
        </Text>
      </View>
      <View style={styles.loadingPlaceholderStack}>
        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index}
            style={[
              styles.loadingPlaceholderLine,
              index === 0 && styles.loadingPlaceholderLineShort,
              index === 2 && styles.loadingPlaceholderLineMuted
            ]}
          />
        ))}
      </View>
    </View>
  );
}
