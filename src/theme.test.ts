import { describe, expect, it, vi } from 'vitest';
import { StyleSheet } from 'react-native';
import { type ReaderSettings } from './readerData';
import { createStyles, createTheme } from './theme';

vi.mock('react-native', () => ({
  Platform: {
    OS: 'android',
    select: (options: Record<string, unknown>) => options.android ?? options.default
  },
  StatusBar: {
    currentHeight: 24
  },
  StyleSheet: {
    hairlineWidth: 1,
    create: (styles: unknown) => styles
  }
}));

describe('Android reader theme safety rails', () => {
  const settings: ReaderSettings = {
    theme: 'light',
    fontScale: 1,
    lineHeight: 'standard',
    contentWidth: 'standard',
    fontFamily: 'sans',
    listDensity: 'standard'
  };

  it('keeps scrollable content and user profiles clear of the Android status bar', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.statusBarScrim).toMatchObject({
      position: 'absolute',
      top: 0,
      height: 24,
      backgroundColor: theme.background,
      elevation: 0
    });
    expect(styles.statusBarScrim.zIndex).toBeGreaterThan(10);
    expect(styles.topicTopBar.paddingTop).toBe(32);
    expect(styles.contentInner.paddingTop).toBe(28);
    expect(styles.topicContentInner.paddingTop).toBe(18);
    expect(styles.userContentInner.paddingTop).toBe(8);
    expect(styles.userContentInner.paddingBottom).toBe(styles.contentInner.paddingBottom);
  });

  it('keeps reply action buttons tappable without forcing a wrapped row', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.replyActionRow.flexWrap).toBeUndefined();
    expect(styles.replyCompactActionButton.flexBasis).toBe(0);
    expect(styles.replyCompactActionButton.flexGrow).toBe(1);
    expect(styles.replyCompactActionButton.flexShrink).toBe(1);
    expect(styles.replyCompactActionButton.minWidth).toBeGreaterThanOrEqual(44);
    expect(styles.replyCompactActionButton.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('keeps reply composer actions grouped at the bottom edge', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.replyComposerActions).toMatchObject({
      alignItems: 'center',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end'
    });
  });

  it('keeps reply references readable without turning them into badges', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.htmlMentionLink.color).toBe(theme.primary);
    expect(styles.htmlFloorLink.color).toBe(theme.muted);
    expect('backgroundColor' in styles.htmlReplyReferenceRow).toBe(false);
    expect('borderWidth' in styles.htmlReplyReferenceRow).toBe(false);
    expect(styles.htmlReplyReferenceRow.alignSelf).toBe('stretch');
  });

  it('keeps required dividers and hidden WebView boundaries intact', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.feedFixedHeader.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
    expect(styles.hiddenBrowserWebViewHost).toMatchObject({
      position: 'absolute',
      width: 1,
      height: 1,
      overflow: 'hidden',
      opacity: 0
    });
    expect(styles.hiddenBrowserWebView).toMatchObject({
      flex: 0,
      width: 1,
      height: 1,
      opacity: 0,
      backgroundColor: 'transparent'
    });
  });
});
