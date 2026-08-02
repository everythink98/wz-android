import type { ReactNode } from 'react';
import { StatusBar as NativeStatusBar, StyleSheet, Text, View } from 'react-native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

export function createScreenTopBarStyles(theme: ReaderTheme, settings: ReaderSettings) {
  return StyleSheet.create({
    bar: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 12,
      paddingTop: (NativeStatusBar.currentHeight ?? 0) + 8,
      paddingBottom: 8,
      backgroundColor: theme.surface,
      borderBottomColor: theme.line,
      borderBottomWidth: StyleSheet.hairlineWidth
    },
    title: {
      flex: 1,
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0,
      textAlign: 'left'
    },
    actions: {
      alignItems: 'center',
      flexDirection: 'row',
      flexShrink: 0,
      gap: 4
    }
  });
}

export function ScreenTopBar({ children }: { children: ReactNode }) {
  const { styles } = useReaderThemeStyles(createScreenTopBarStyles);
  return <View style={styles.bar}>{children}</View>;
}

export function ScreenTopBarTitle({ children }: { children: ReactNode }) {
  const { styles } = useReaderThemeStyles(createScreenTopBarStyles);
  return (
    <Text style={styles.title} numberOfLines={1}>
      {children}
    </Text>
  );
}

export function ScreenTopBarActions({ children }: { children: ReactNode }) {
  const { styles } = useReaderThemeStyles(createScreenTopBarStyles);
  return <View style={styles.actions}>{children}</View>;
}
