import { useDeferredValue, useMemo } from 'react';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { contentWidthValue, createTheme, fontFamilyValue, resolveReaderStyleSettings } from '@/ui/theme/tokens';
import type { ReaderStyleContextValue } from '@/ui/theme/ReaderStyleProvider';
import { createAppStyles } from './styles';

export function useAppTheme(settings: ReaderSettings, width: number) {
  const { contentWidth, fontFamily, lineHeight, listDensity, showUnreadDot, theme: themeMode, uiFontFamily } = settings;
  const deferredFontScale = useDeferredValue(settings.fontScale);
  const deferredUiFontScale = useDeferredValue(settings.uiFontScale ?? 1);
  const interfaceFont = fontFamilyValue(uiFontFamily);
  const theme = useMemo(() => createTheme({ theme: themeMode }), [themeMode]);
  const navigationTheme = useMemo(() => {
    const base = theme.dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      dark: theme.dark,
      fonts: {
        regular: { ...base.fonts.regular, fontFamily: interfaceFont },
        medium: { ...base.fonts.medium, fontFamily: interfaceFont },
        bold: { ...base.fonts.bold, fontFamily: interfaceFont },
        heavy: { ...base.fonts.heavy, fontFamily: interfaceFont }
      },
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
  }, [interfaceFont, theme]);
  const styleSettings = useMemo(
    () =>
      resolveReaderStyleSettings({
        contentWidth,
        fontFamily,
        fontScale: deferredFontScale,
        lineHeight,
        listDensity,
        showUnreadDot,
        theme: themeMode,
        uiFontFamily,
        uiFontScale: deferredUiFontScale
      }),
    [
      contentWidth,
      deferredFontScale,
      deferredUiFontScale,
      fontFamily,
      lineHeight,
      listDensity,
      showUnreadDot,
      themeMode,
      uiFontFamily
    ]
  );
  const appStyles = useMemo(
    () => createAppStyles(theme, interfaceFont, deferredUiFontScale),
    [interfaceFont, deferredUiFontScale, theme]
  );
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
