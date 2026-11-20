import { StyleSheet, Text, View } from 'react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import {
  createReaderFontSizer,
  fontFamilyValue,
  readerRadii,
  type ReaderStyleSettings,
  type ReaderTheme
} from '@/ui/theme/tokens';

const paragraphWidths = ['100%', '89%', '64%'] as const;
const titleWidths = ['86%', '70%', '93%'] as const;

export function ContentLoadingPlaceholder({ text, layout }: { text: string; layout: 'body' | 'list' }) {
  const { styles } = useReaderThemeStyles(createStyles);
  return (
    <View
      testID="content-loading-placeholder"
      accessible
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      accessibilityState={{ busy: true }}
      role="status"
      style={styles.placeholder}
    >
      <Text accessible={false} style={styles.label}>
        {text}
      </Text>
      {layout === 'body' ? (
        <View style={styles.paragraph}>
          {paragraphWidths.map((width) => (
            <View key={width} style={[styles.bar, { width }]} />
          ))}
        </View>
      ) : (
        titleWidths.map((width) => (
          <View key={width} style={styles.row}>
            <View style={[styles.bar, styles.title, { width }]} />
            <View style={[styles.bar, styles.byline]} />
          </View>
        ))
      )}
    </View>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const size = createReaderFontSizer(settings);
  return StyleSheet.create({
    placeholder: { paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
    label: {
      color: theme.muted,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: size(12),
      lineHeight: size(17)
    },
    paragraph: { gap: size(10), paddingVertical: 6 },
    bar: { height: size(10), borderRadius: readerRadii.badge, backgroundColor: theme.line },
    row: { paddingVertical: 11, gap: size(10) },
    title: { height: size(14) },
    byline: { width: '40%' }
  });
}
