import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { DarkTheme, LightTheme, PaperProvider } from 'react-native-paper';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { ReaderTheme } from './tokens';

export type ReaderStyleContextValue = {
  settings: ReaderSettings;
  theme: ReaderTheme;
};

const ReaderStyleContext = createContext<ReaderStyleContextValue | null>(null);

export function ReaderStyleProvider({ children, value }: { children: ReactNode; value: ReaderStyleContextValue }) {
  const paperTheme = useMemo(() => {
    const theme = value.theme;
    const base = theme.dark ? DarkTheme : LightTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: theme.primaryStrong,
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
  }, [value.theme]);
  return (
    <ReaderStyleContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>{children}</PaperProvider>
    </ReaderStyleContext.Provider>
  );
}

export function useReaderThemeStyles<T>(createStyles: (theme: ReaderTheme, settings: ReaderSettings) => T) {
  const context = useContext(ReaderStyleContext);
  const styles = useMemo(
    () => (context ? createStyles(context.theme, context.settings) : undefined),
    [context, createStyles]
  );
  if (!context) {
    throw new Error('ReaderStyleProvider is required');
  }
  return { settings: context.settings, styles: styles as T, theme: context.theme };
}
