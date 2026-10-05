import { useDeferredValue, useMemo } from 'react';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { contentWidthValue, createTheme, type ReaderStyleSettings } from '@/ui/theme/tokens';
import type { ReaderStyleContextValue } from '@/ui/theme/ReaderStyleProvider';
import { createAppStyles } from './styles';

export function useAppTheme(settings: ReaderSettings, width: number) {
  const { contentWidth, fontFamily, lineHeight, listDensity, theme: themeMode } = settings;
  const deferredFontScale = useDeferredValue(settings.fontScale);
  const theme = useMemo(() => createTheme({ theme: themeMode }), [themeMode]);
  const navigationTheme = useMemo(() => {
    const base = theme.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: theme.dark,
      colors: {
        ...base.colors,
        primary: theme.primary,
        background: theme.background,
        card: theme.surface,
        text: theme.ink,
        border: theme.line,
        notification: theme.primary
      }
    };
  }, [theme]);
  const styleSettings = useMemo<ReaderStyleSettings>(
    () => ({ contentWidth, fontFamily, fontScale: deferredFontScale, lineHeight, listDensity, theme: themeMode }),
    [contentWidth, deferredFontScale, fontFamily, lineHeight, listDensity, themeMode]
  );
  const appStyles = useMemo(() => createAppStyles(theme), [theme]);
  const readerStyleContext = useMemo<ReaderStyleContextValue>(
    () => ({ settings: styleSettings, theme }),
    [styleSettings, theme]
  );

  return {
    appStyles,
    contentWidth: Math.min(width - 40, contentWidthValue(contentWidth)),
    navigationTheme,
    readerStyleContext,
    theme
  };
}
