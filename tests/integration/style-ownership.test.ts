import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import { createTheme, sourceBadgeColorStyle, topicStatusBadgeColorStyle, topicTagColorStyle } from '@/ui/theme/tokens';
import { createAppStyles } from '@/app/styles';
import { createSearchStyles } from '@/features/search/styles';
import { createTopicStyles } from '@/features/topic/styles';
import { createUserStyles } from '@/features/user/styles';
import { createAccountHostStyles } from '@/features/account/accountHostStyles';
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

vi.mock('lucide-react-native/icons/chevron-down', () => ({ default: () => null }));
vi.mock('lucide-react-native/icons/chevron-right', () => ({ default: () => null }));
vi.mock('lucide-react-native/icons/chevron-up', () => ({ default: () => null }));
vi.mock('lucide-react-native/icons/house', () => ({ default: () => null }));
vi.mock('lucide-react-native/icons/ellipsis', () => ({ default: () => null }));
vi.mock('lucide-react-native/icons/search', () => ({ default: () => null }));
vi.mock('lucide-react-native/icons/star', () => ({ default: () => null }));

describe('Android reader theme safety rails', () => {
  const settings: ReaderSettings = {
    ...createEmptyReaderData().settings,
    theme: 'light'
  };

  it('keeps scrollable content and user profiles clear of the Android status bar', () => {
    const theme = createTheme(settings);
    const styles = createAppStyles(theme);
    const topBarStyles = createScreenTopBarStyles(theme, settings);

    expect(styles.statusBarScrim).toMatchObject({
      position: 'absolute',
      top: 0,
      height: 24,
      backgroundColor: theme.background
    });
    expect(styles.statusBarScrim.zIndex).toBeGreaterThan(10);
    expect(topBarStyles.bar.paddingTop).toBeGreaterThan(24);
    expect(createUserStyles(theme, settings).userContentInner.paddingBottom).toBe(
      createSearchStyles(theme, settings).contentInner.paddingBottom
    );
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
    const styles = createTopicStyles(theme, settings);

    expect(Reflect.get(styles.replyActionRow, 'flexWrap')).toBeUndefined();
    expect(styles.replyCompactActionButton.flexBasis).toBe(0);
    expect(styles.replyCompactActionButton.flexGrow).toBe(1);
    expect(styles.replyCompactActionButton.flexShrink).toBe(1);
    expect(styles.replyCompactActionButton.minWidth).toBeGreaterThanOrEqual(44);
    expect(styles.replyCompactActionButton.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('keeps expandable quote controls touch accessible', () => {
    const theme = createTheme(settings);
    const styles = createTopicStyles(theme, settings);

    expect(styles.quoteAuthorSummary.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.quotePanelHeader.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.quotePanelState.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('keeps appearance controls compact, equal-width, and touch accessible', () => {
    const theme = createTheme(settings);
    const styles = createMoreStyles(theme, settings);
    expect(styles.appearanceSegmentedControl.flex).toBe(1);
    expect(styles.appearanceSegment.flex).toBe(1);
    expect(styles.appearanceSegment.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceStepButton.width).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceStepButton.height).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceSlider.height).toBeGreaterThanOrEqual(48);
  });

  it('applies reader type scale and link color to notification content', () => {
    const theme = createTheme(settings);
    const base = createNotificationStyles(theme, settings);
    const large = createNotificationStyles(theme, { ...settings, fontScale: 1.3 });

    expect(base.title.fontSize).toBe(14);
    expect(large.title.fontSize).toBe(Math.round(14 * 1.3));
    expect(large.messageBody.lineHeight).toBe(Math.round(21 * 1.3));
    expect(large.detailLink.color).toBe(theme.primary);
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
    const styles = createAppStyles(theme);

    expect('height' in styles.nav).toBe(false);
    expect('paddingBottom' in styles.nav).toBe(false);
  });

  it('lets each bottom tab button fill its existing slot without changing bar geometry', () => {
    const theme = createTheme(settings);
    const styles = createAppStyles(theme);

    expect(styles.navItem).toMatchObject({ alignItems: 'stretch', flex: 1, minHeight: 48 });
  });
});
