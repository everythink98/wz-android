import { describe, expect, it, vi } from 'vitest';
import { StyleSheet } from 'react-native';
import { createEmptyReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import {
  createTheme,
  sourceBadgeColorStyle,
  topicStatusBadgeColorStyle,
  topicTagColorStyle,
  type ReaderTheme
} from '@/ui/theme/tokens';
import { createAppStyles } from '@/app/styles';
import { createFeedStyles } from '@/features/feed/styles';
import { createSearchStyles } from '@/features/search/styles';
import { createTopicStyles } from '@/features/topic/styles';
import { createHtmlRendererStyles } from '@/features/topic/rendering/htmlStyles';
import { createUserStyles } from '@/features/user/styles';
import { createLibraryStyles } from '@/features/library/styles';
import { createMoreAccountStyles } from '@/features/more/accountStyles';
import { createAccountHostStyles } from '@/features/account/accountHostStyles';
import { createLoginWebViewStyles } from '@/ui/navigation/loginWebViewStyles';
import { createMoreStyles } from '@/features/more/styles';
import { createNotificationStyles } from '@/features/notifications/styles';
import { createScreenTopBarStyles } from '@/ui/controls/ScreenTopBar';

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

vi.mock('lucide-react-native', () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
  ChevronUp: () => null,
  Home: () => null,
  MoreHorizontal: () => null,
  Search: () => null,
  Star: () => null
}));

vi.mock('@/ui/controls/pressFeedback', () => ({
  pressWithFeedback: (onPress: () => void) => onPress()
}));

function createStyles(theme: ReaderTheme, settings: ReaderSettings, _windowHeight: number) {
  return Object.assign(
    {},
    createAppStyles(theme),
    createFeedStyles(theme, settings),
    createSearchStyles(theme, settings),
    createTopicStyles(theme, settings),
    createHtmlRendererStyles(settings, theme),
    createUserStyles(theme, settings),
    createLibraryStyles(theme, settings),
    createMoreAccountStyles(theme, settings),
    createLoginWebViewStyles(theme, settings),
    createMoreStyles(theme, settings)
  );
}

describe('Android reader theme safety rails', () => {
  const settings: ReaderSettings = {
    theme: 'light',
    fontScale: 1,
    nodeSeekRecoveryThreshold: 1,
    lineHeight: 'standard',
    contentWidth: 'standard',
    fontFamily: 'sans',
    listDensity: 'standard',
    contentSources: createEmptyReaderData().settings.contentSources
  };

  it('keeps scrollable content and user profiles clear of the Android status bar', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);
    const topBarStyles = createScreenTopBarStyles(theme, settings);

    expect(styles.statusBarScrim).toMatchObject({
      position: 'absolute',
      top: 0,
      height: 24,
      backgroundColor: theme.background,
      elevation: 0
    });
    expect(styles.statusBarScrim.zIndex).toBeGreaterThan(10);
    expect(topBarStyles.bar.paddingTop).toBe(32);
    expect(styles.contentInner.paddingTop).toBe(28);
    expect(styles.topicContentInner.paddingTop).toBe(18);
    expect(styles.userContentInner.paddingTop).toBe(8);
    expect(styles.userContentInner.paddingBottom).toBe(styles.contentInner.paddingBottom);
  });

  it('uses stable hashed colors for functional tags and stable source identities', () => {
    const theme = createTheme(settings);

    expect(topicTagColorStyle('任意标签', theme)).toEqual(topicTagColorStyle('任意标签', theme));
    expect(topicTagColorStyle('任意标签', theme).color).not.toBe(topicTagColorStyle('另一个标签', theme).color);
    expect(sourceBadgeColorStyle('nodeseek', theme).color).toBe(theme.primary);
    expect(topicTagColorStyle('任意标签', theme).color).not.toBe(sourceBadgeColorStyle('nodeseek', theme).color);
    expect(sourceBadgeColorStyle('v2ex', theme).color).not.toBe(sourceBadgeColorStyle('linuxdo', theme).color);
    expect(sourceBadgeColorStyle('linuxdo', theme).color).not.toBe(sourceBadgeColorStyle('yaohuo', theme).color);
    expect(topicStatusBadgeColorStyle('success', theme).color).toBe(theme.primary);
    expect(topicStatusBadgeColorStyle('danger', theme).color).toBe(theme.danger);
  });

  it('keeps reply action buttons tappable without forcing a wrapped row', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.replyActionRow.flexWrap).toBeUndefined();
    expect(styles.replyCompactActionButton.flexBasis).toBe(0);
    expect(styles.replyCompactActionButton.flexGrow).toBe(1);
    expect(styles.replyCompactActionButton.flexShrink).toBe(1);
    expect(styles.replyCompactActionButton.minWidth).toBeGreaterThanOrEqual(44);
    expect(styles.replyCompactActionButton.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('[REG-TOPIC-047] keeps reply prose inset below the avatar while retaining vertical rhythm', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.replyCard).toMatchObject({
      backgroundColor: 'transparent',
      borderBottomWidth: StyleSheet.hairlineWidth,
      gap: 8,
      paddingBottom: 8,
      paddingTop: 16
    });
    expect(styles.replyCard.borderRadius).toBeUndefined();
    expect(styles.replyContentArea).toMatchObject({ gap: 8, paddingLeft: 42, paddingRight: 0 });
    expect(styles.replyActionRow).toMatchObject({ marginTop: -4, minHeight: 48 });
    expect(styles.replyActionRow.marginBottom).toBeUndefined();
    expect(styles.replyDetailActionButton).toMatchObject({ minHeight: 48, paddingBottom: 0, paddingTop: 0 });
    expect(styles.replySignature).toMatchObject({
      borderTopColor: theme.lineStrong,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 4,
      paddingBottom: 0,
      paddingTop: 8
    });
    expect(styles.replyStatRail.marginTop).toBe(4);
    expect(styles.replyThanksText.marginTop).toBe(4);
    expect(styles.replyAcceptedSolution).toMatchObject({ marginTop: 4, paddingTop: 8 });
    expect(styles.replyQuoteBox.backgroundColor).not.toBe(styles.quoteBox.backgroundColor);
  });

  it('[REG-TOPIC-054] gives quote headers stable touch targets and compact breathing room', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.quoteBox).toMatchObject({ gap: 8, paddingHorizontal: 12, paddingVertical: 10 });
    expect(styles.quoteAuthorSummary.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.quotePanelHeader.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.quotePanelState.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.topicContentInner.gap).toBe(0);
    expect(styles.quoteRowTop).toMatchObject({ borderBottomWidth: 0, paddingBottom: 8 });
    expect(styles.quoteRowContinuation).toMatchObject({
      borderBottomWidth: 0,
      borderTopWidth: 0,
      paddingBottom: 0,
      paddingTop: 0
    });
    expect(styles.quoteRowBottom).toMatchObject({ borderTopWidth: 0, paddingTop: 0 });
  });

  it('[REG-TOPIC-084] aligns native tables with the article surface geometry', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.htmlTableFrame).toMatchObject({
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden'
    });
  });

  it('keeps appearance controls compact, equal-width, and touch accessible', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;
    expect(styles.appearanceSegmentedControl.flex).toBe(1);
    expect(styles.appearanceSegment.flex).toBe(1);
    expect(styles.appearanceSegment.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceStepButton.width).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceStepButton.height).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceSlider.height).toBeGreaterThanOrEqual(48);
  });

  it('[REG-NOTIFY-036][REG-NOTIFY-040] applies reader type scale and link color to notification content', () => {
    const theme = createTheme(settings);
    const base = createNotificationStyles(theme, settings);
    const large = createNotificationStyles(theme, { ...settings, fontScale: 1.3 });

    expect(base.title.fontSize).toBe(14);
    expect(large.title.fontSize).toBe(Math.round(14 * 1.3));
    expect(large.messageBody.lineHeight).toBe(Math.round(21 * 1.3));
    expect(large.detailLink.color).toBe(theme.primary);
  });

  it('[REG-A11Y-001][REG-TOPIC-058] keeps reply navigation visually compact without changing the prose inset', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800) as Record<string, Record<string, unknown>>;

    expect(styles.replyHead.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.replyTargetPill).toMatchObject({
      alignSelf: 'flex-start',
      paddingVertical: 5
    });
    expect(styles.replyTargetPill).not.toHaveProperty('justifyContent');
    expect(styles.replyTargetPill).not.toHaveProperty('minHeight');
    expect(styles.replyContentArea).toMatchObject({ paddingLeft: 42, paddingRight: 0 });
  });

  it('keeps hidden WebView hosts non-visible', () => {
    const theme = createTheme(settings);
    const accountHostStyles = createAccountHostStyles(theme, settings);

    expect(accountHostStyles.hiddenBrowserWebViewHost).toMatchObject({
      position: 'absolute',
      width: 1,
      height: 1,
      overflow: 'hidden',
      opacity: 0
    });
    expect(accountHostStyles.hiddenBrowserWebView).toMatchObject({
      flex: 0,
      width: 1,
      height: 1,
      opacity: 0,
      backgroundColor: 'transparent'
    });
  });

  it('lets the bottom tab navigator own bottom safe-area spacing', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect('height' in styles.nav).toBe(false);
    expect('paddingBottom' in styles.nav).toBe(false);
  });

  it('[REG-NAV-001] lets each bottom tab button fill its existing slot without changing bar geometry', () => {
    const theme = createTheme(settings);
    const styles = createStyles(theme, settings, 800);

    expect(styles.navItem).toMatchObject({ alignItems: 'stretch', flex: 1, minHeight: 48 });
    expect(styles.nav).toMatchObject({ paddingHorizontal: 10, paddingTop: 4 });
  });
});
