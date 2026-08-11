import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { sourceCatalog, type Source } from '@/domain/forum/sourceCatalog';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { alphaColor, fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton } from './ButtonControls';

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
    routeState: { flex: 1, margin: 16 },
    header: { alignItems: 'center', flexDirection: 'row', gap: 9 },
    stateTitle: { color: theme.ink, fontFamily, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    text: { color: theme.muted, fontFamily, fontSize: 13 },
    centeredText: { textAlign: 'center' },
    actions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
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

export function ContentSourceDisabledState({
  source,
  onBack,
  onManage
}: {
  source: Source;
  onBack: () => void;
  onManage: () => void;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const title = `${sourceCatalog[source].label}已停用`;
  const text = '该内容源已停用，启用后才能查看此内容。';
  return (
    <View style={[styles.state, styles.routeState]}>
      <Text accessibilityRole="header" style={styles.stateTitle}>
        {title}
      </Text>
      <Text style={[styles.text, styles.centeredText]}>{text}</Text>
      <View style={styles.actions}>
        <AppButton label="管理内容源" variant="primary" onPress={onManage} />
        <AppButton label="返回" variant="ghost" onPress={onBack} />
      </View>
    </View>
  );
}
