import { describe, expect, it, vi } from 'vitest';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import {
  resolveReaderStyleSettings,
  createTheme,
  sourceBadgeColorStyle,
  topicStatusBadgeColorStyle,
  topicTagColorStyles
} from '@/ui/theme/tokens';
import { createAppStyles } from '@/app/styles';
import { createSearchStyles } from '@/features/search/styles';
import { createFeedStyles } from '@/features/feed/styles';
import { createTopicStyles } from '@/features/topic/styles';
import { createUserStyles } from '@/features/user/styles';
import { createAccountHostStyles } from '@/features/account/accountHostStyles';
import { createMoreStyles } from '@/features/more/styles';
import { createNotificationStyles } from '@/features/notifications/styles';
import { createScreenTopBarStyles } from '@/ui/controls/ScreenTopBar';

// These checks exercise style factories; native providers are exercised by the UI suites.
vi.mock('@/ui/theme/ReaderStyleProvider', () => ({ useReaderThemeStyles: vi.fn() }));
vi.mock('@react-navigation/native', () => ({ NavigationContext: null }));
vi.mock('expo-blur', () => ({ BlurTargetView: 'BlurTargetView', BlurView: 'BlurView' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaInsetsContext: null }));

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

function contrastRatio(foreground: unknown, background: unknown) {
  const luminance = (hex: unknown) => {
    const color = String(hex);
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(color.slice(offset, offset + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function topicTagColorStyle(label: string, theme: ReturnType<typeof createTheme>, tags: readonly string[] = [label]) {
  return topicTagColorStyles(tags, theme)(label)!;
}

describe('Android reader theme safety rails', () => {
  const settings = resolveReaderStyleSettings(createEmptyReaderData().settings);

  it.each(['light', 'dark'] as const)('joins the status bar to the page surface in %s mode', (mode) => {
    const theme = createTheme({ ...settings, theme: mode });
    const styles = createAppStyles(theme);
    const topBarStyles = createScreenTopBarStyles(theme, settings);

    expect(styles.statusBarScrim).toMatchObject({
      position: 'absolute',
      top: 0,
      height: 24,
      backgroundColor: theme.surface
    });
    expect(styles.statusBarScrim.zIndex).toBeGreaterThan(10);
    expect(topBarStyles.bar.paddingTop).toBeGreaterThan(24);
    expect(topBarStyles.bar.zIndex).toBeGreaterThan(0);
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

  it('keeps tag labels and secondary text readable in both themes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = createTheme({ theme: mode });
      expect(contrastRatio(theme.muted, theme.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.primary, theme.surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.ink, theme.background)).toBeGreaterThanOrEqual(4.5);
      for (const label of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const tag = topicTagColorStyle(label, theme);
        expect(contrastRatio(tag.color, tag.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(['light', 'dark'] as const)(
    'distinguishes colliding tags without depending on their order in %s mode',
    (mode) => {
      const theme = createTheme({ theme: mode });
      const tags = ['A', 'I', 'Q', '纯水', '人工智能'];
      const colors = tags.map((tag) => topicTagColorStyle(tag, theme, tags));

      expect(new Set(colors.map((color) => color.backgroundColor)).size).toBe(tags.length);
      expect(new Set(colors.map((color) => color.color)).size).toBe(tags.length);
      expect(tags.map((tag) => topicTagColorStyle(tag, theme, [...tags].reverse()))).toEqual(colors);
      expect(topicTagColorStyle(' a ', theme, ['a', 'A', 'I'])).toEqual(topicTagColorStyle('A', theme, ['A', 'I']));
    }
  );

  it('keeps reply action buttons tappable without forcing a wrapped row', () => {
    const theme = createTheme(settings);
    const styles = createTopicStyles(theme, resolveReaderStyleSettings(settings));

    expect(Reflect.get(styles.replyActionRow, 'flexWrap')).toBeUndefined();
    expect(styles.replyCompactActionButton.flexBasis).toBe(0);
    expect(styles.replyCompactActionButton.flexGrow).toBe(1);
    expect(styles.replyCompactActionButton.flexShrink).toBe(1);
    expect(styles.replyCompactActionButton.minWidth).toBeGreaterThanOrEqual(44);
    expect(styles.replyCompactActionButton.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('keeps expandable quote controls touch accessible', () => {
    const theme = createTheme(settings);
    const styles = createTopicStyles(theme, resolveReaderStyleSettings(settings));

    expect(styles.quoteAuthorSummary.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.quotePanelHeader.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.quotePanelState.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('aligns appearance choices within accessible touch targets', () => {
    const theme = createTheme(settings);
    const styles = createMoreStyles(theme, settings);
    expect(styles.appearanceChoiceRow.flexDirection).toBe('row');
    expect(styles.appearanceChoiceRow.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceDropdownItem.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceThemeOption.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceSegment.minHeight).toBeGreaterThanOrEqual(48);
    expect(styles.appearanceSlider.height).toBeGreaterThanOrEqual(48);
  });

  it('applies reader type scale and link color to notification content', () => {
    const theme = createTheme(settings);
    const base = createNotificationStyles(theme, settings);
    const large = createNotificationStyles(theme, { ...settings, uiFontScale: 0.85, fontScale: 1.3 });

    expect(base.title.fontSize).toBe(15);
    expect(large.title.fontSize).toBe(Math.round(15 * 1.3));
    expect(large.messageBody.lineHeight).toBe(Math.round(21 * 1.3));
    expect(large.controlLabel.fontSize).toBe(Math.round(13 * 0.85));
    expect(large.detailLink.color).toBe(theme.primary);
  });

  it('keeps hidden WebView hosts non-visible', () => {
    const theme = createTheme(settings);
    const accountHostStyles = createAccountHostStyles(theme, resolveReaderStyleSettings(settings));

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

  it('lets the bottom tab navigator fit its labels and own bottom safe-area spacing', () => {
    const theme = createTheme(settings);
    const styles = createAppStyles(theme);

    expect(styles.nav.height).toBe('auto');
    expect('paddingBottom' in styles.nav).toBe(false);
  });

  it('keeps font choice independent of interface metrics and the full reading scale', () => {
    const theme = createTheme(settings);
    const topBar = createScreenTopBarStyles(theme, settings).title;
    const systemTopBar = createScreenTopBarStyles(theme, { ...settings, uiFontFamily: 'system' }).title;
    expect(topBar).toMatchObject({ fontSize: 14, lineHeight: 20, includeFontPadding: false });
    expect(systemTopBar).toEqual({ ...topBar, fontFamily: 'sans-serif' });
    const replyTitle = createUserStyles(theme, { ...settings, fontScale: 1.4 }).cardTitle;
    expect(replyTitle).toMatchObject({ fontSize: 22, lineHeight: 32 });
  });

  it('scales search and source labels as interface text and poll and system-event content as reading text', () => {
    const theme = createTheme(settings);
    const typography = { ...settings, uiFontFamily: 'system' as const, uiFontScale: 1.4, fontScale: 0.85 };
    expect(createSearchStyles(theme, typography)).toMatchObject({
      searchFilterEntryText: { fontFamily: 'sans-serif', fontSize: 18, lineHeight: 25 },
      searchFilterEntrySummary: { fontSize: 17, lineHeight: 24 },
      searchGroupTitleText: { fontSize: 18, lineHeight: 25 },
      searchGroupMetaText: { fontSize: 17, lineHeight: 24 },
      searchGroupActionText: { fontSize: 17, lineHeight: 24 }
    });
    expect(createUserStyles(theme, typography).topicSourceBadge).toMatchObject({
      fontFamily: 'sans-serif',
      fontSize: 15,
      lineHeight: 22
    });
    expect(createMoreStyles(theme, typography)).toMatchObject({
      proxyCurrentLabel: { fontFamily: 'sans-serif', fontSize: 15, lineHeight: 20 },
      proxyAddLabel: { fontFamily: 'sans-serif', fontSize: 21 }
    });
    expect(createFeedStyles(theme, typography).endOfListText).toMatchObject({ fontSize: 17, lineHeight: 24 });
    expect(createTopicStyles(theme, typography)).toMatchObject({
      pollTitle: { fontFamily: 'WzNotoSansSC', fontSize: 12, lineHeight: 17 },
      pollOptionText: { fontSize: 12, lineHeight: 17 },
      topicAcceptedAnswerTitle: { fontSize: 12, lineHeight: 16 },
      replySystemEventText: { fontSize: 11, lineHeight: 15 }
    });
  });

  it('lets each bottom tab button fill its existing slot without changing bar geometry', () => {
    const theme = createTheme(settings);
    const styles = createAppStyles(theme);

    expect(styles.navItem).toMatchObject({ alignItems: 'stretch', flex: 1, minHeight: 48 });
  });
});
