import { useContext, type ReactNode } from 'react';
import { StatusBar as NativeStatusBar, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { type ReaderStyleSettings, fontFamilyValue, type ReaderTheme, textSizeStyle } from '@/ui/theme/tokens';

export function createScreenTopBarStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    bar: {
      zIndex: 1,
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
    actions: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    title: {
      flex: 1,
      color: theme.ink,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(Math.round(14 * settings.uiFontScale)),
      fontWeight: '500',
      letterSpacing: 0,
      textAlign: 'left'
    }
  });
}

export function ScreenTopBar({
  children,
  onLayout
}: {
  children: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { styles } = useReaderThemeStyles(createScreenTopBarStyles);
  const insets = useContext(SafeAreaInsetsContext);
  return (
    <View style={[styles.bar, insets && { paddingTop: insets.top + 8 }]} onLayout={onLayout}>
      {children}
    </View>
  );
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
