import { useDeferredValue, useMemo } from 'react';
import { DarkTheme, DefaultTheme } from '@react-navigation/native';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { createFeedStyles } from '@/features/feed/styles';
import { createLibraryStyles } from '@/features/library/styles';
import { createMoreAccountStyles } from '@/features/more/accountStyles';
import { createMoreStyles } from '@/features/more/styles';
import { createSearchStyles } from '@/features/search/styles';
import { createTopicStyles } from '@/features/topic/styles';
import { createUserStyles } from '@/features/user/styles';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';
import { createSharedStyles } from '@/ui/theme/sharedStyles';
import { contentWidthValue, createTheme } from '@/ui/theme/tokens';
import { createAppStyles } from './styles';

export function useAppTheme(settings: ReaderSettings, width: number, height: number) {
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
  const sharedStyles = useMemo(() => createSharedStyles(theme, styleSettings, height), [height, styleSettings, theme]);
  const loginWebViewStyles = useMemo(
    () => createLoginWebViewStyles(sharedStyles, theme, styleSettings),
    [sharedStyles, styleSettings, theme]
  );
  const appStyles = useMemo(
    () => Object.assign(createAppStyles(sharedStyles, theme), loginWebViewStyles),
    [loginWebViewStyles, sharedStyles, theme]
  );
  const feedStyles = useMemo(
    () => createFeedStyles(sharedStyles, theme, styleSettings),
    [sharedStyles, styleSettings, theme]
  );
  const searchStyles = useMemo(
    () => createSearchStyles(sharedStyles, theme, styleSettings),
    [sharedStyles, styleSettings, theme]
  );
  const topicStyles = useMemo(
    () => createTopicStyles(sharedStyles, theme, styleSettings),
    [sharedStyles, styleSettings, theme]
  );
  const userStyles = useMemo(
    () => createUserStyles(sharedStyles, theme, styleSettings),
    [sharedStyles, styleSettings, theme]
  );
  const libraryStyles = useMemo(
    () => createLibraryStyles(sharedStyles, theme, styleSettings),
    [sharedStyles, styleSettings, theme]
  );
  const moreStyles = useMemo(
    () =>
      Object.assign(
        createMoreStyles(sharedStyles, theme, styleSettings),
        createMoreAccountStyles(sharedStyles, theme, styleSettings),
        loginWebViewStyles
      ),
    [loginWebViewStyles, sharedStyles, styleSettings, theme]
  );

  return {
    appStyles,
    contentWidth: Math.min(width - 40, contentWidthValue(settings.contentWidth)),
    feedStyles,
    libraryStyles,
    moreStyles,
    navigationTheme,
    searchStyles,
    theme,
    topicStyles,
    userStyles
  };
}
