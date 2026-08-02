import { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { ReaderSettings } from '@/domain/reader/readerData';
import type { SharedStyles } from './sharedStyles';
import type { ReaderTheme } from './tokens';

export type ReaderStyleContextValue = {
  settings: ReaderSettings;
  sharedStyles: SharedStyles;
  theme: ReaderTheme;
};

const ReaderStyleContext = createContext<ReaderStyleContextValue | null>(null);

export function ReaderStyleProvider({ children, value }: { children: ReactNode; value: ReaderStyleContextValue }) {
  return <ReaderStyleContext.Provider value={value}>{children}</ReaderStyleContext.Provider>;
}

export function useReaderStyles<T>(
  createStyles: (sharedStyles: SharedStyles, theme: ReaderTheme, settings: ReaderSettings) => T
) {
  const context = useContext(ReaderStyleContext);
  const styles = useMemo(
    () => (context ? createStyles(context.sharedStyles, context.theme, context.settings) : undefined),
    [context, createStyles]
  );
  if (!context) {
    throw new Error('ReaderStyleProvider is required');
  }
  return { styles: styles as T, theme: context.theme };
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
