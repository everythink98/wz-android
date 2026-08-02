import { useDeferredValue, useMemo } from 'react';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';
import { contentWidthValue, createTheme } from '@/ui/theme/tokens';
import type { ReaderStyleContextValue } from '@/ui/theme/ReaderStyleProvider';
import { createAppStyles } from './styles';

export function useAppTheme(settings: ReaderSettings, width: number) {
  const deferredFontScale = useDeferredValue(settings.fontScale);
  const theme = useMemo(() => createTheme(settings), [settings]);
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
  const styleSettings = useMemo(() => ({ ...settings, fontScale: deferredFontScale }), [deferredFontScale, settings]);
  const loginWebViewStyles = useMemo(() => createLoginWebViewStyles(theme, styleSettings), [styleSettings, theme]);
  const appStyles = useMemo(
    () => Object.assign(createAppStyles(theme), loginWebViewStyles),
    [loginWebViewStyles, theme]
  );
  const readerStyleContext = useMemo<ReaderStyleContextValue>(
    () => ({ settings: styleSettings, theme }),
    [styleSettings, theme]
  );

  return {
    appStyles,
    contentWidth: Math.min(width - 40, contentWidthValue(settings.contentWidth)),
    navigationTheme,
    readerStyleContext,
    theme
  };
}
