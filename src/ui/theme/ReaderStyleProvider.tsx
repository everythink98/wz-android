import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { DarkTheme, LightTheme, PaperProvider } from 'react-native-paper';
import {
  createUiFontSizer,
  fontFamilyValue,
  textSizeStyle,
  type ReaderStyleSettings,
  type ReaderTheme
} from './tokens';

export type ReaderStyleContextValue = {
  settings: ReaderStyleSettings;
  theme: ReaderTheme;
};

type StyleFactory<T> = (theme: ReaderTheme, settings: ReaderStyleSettings) => T;
const ReaderStyleContext = createContext<
  (ReaderStyleContextValue & { styles: WeakMap<StyleFactory<unknown>, unknown> }) | null
>(null);
const paperSettings = { rippleEffectEnabled: false };

export function ReaderStyleProvider({ children, value }: { children: ReactNode; value: ReaderStyleContextValue }) {
  const { uiFontFamily, uiFontScale } = value.settings;
  const context = useMemo(() => ({ ...value, styles: new WeakMap<StyleFactory<unknown>, unknown>() }), [value]);
  const paperTheme = useMemo(() => {
    const theme = value.theme;
    const base = theme.dark ? DarkTheme : LightTheme;
    const fontSize = createUiFontSizer({ uiFontScale });
    const fontFamily = fontFamilyValue(uiFontFamily);
    const fonts = { ...base.fonts };
    for (const name of Object.keys(fonts) as (keyof typeof fonts)[]) {
      if (name === 'default') fonts.default = { ...fonts.default, fontFamily };
      else {
        const variant = fonts[name];
        fonts[name] = {
          ...variant,
          fontFamily,
          ...textSizeStyle(fontSize(variant.fontSize), fontSize(variant.lineHeight))
        };
      }
    }
    return {
      ...base,
      fonts,
      colors: {
        ...base.colors,
        primary: theme.dark ? theme.primary : theme.primaryStrong,
        onPrimary: theme.onPrimary,
        secondaryContainer: theme.primarySoft,
        onSecondaryContainer: theme.ink,
        background: theme.background,
        surface: theme.surface,
        surfaceContainer: theme.surface2,
        surfaceContainerHighest: theme.surface2,
        onSurface: theme.ink,
        onSurfaceVariant: theme.muted,
        outline: theme.lineStrong,
        error: theme.danger
      }
    };
  }, [uiFontFamily, uiFontScale, value.theme]);
  return (
    <ReaderStyleContext.Provider value={context}>
      <PaperProvider theme={paperTheme} settings={paperSettings}>
        {children}
      </PaperProvider>
    </ReaderStyleContext.Provider>
  );
}

export function useReaderThemeStyles<T>(createStyles: StyleFactory<T>) {
  const context = useContext(ReaderStyleContext);
  if (!context) {
    throw new Error('ReaderStyleProvider is required');
  }
  if (!context.styles.has(createStyles))
    context.styles.set(createStyles, createStyles(context.theme, context.settings));
  return { settings: context.settings, styles: context.styles.get(createStyles) as T, theme: context.theme };
}
