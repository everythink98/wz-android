import { describe, expect, it, vi } from 'vitest';
import * as htmlRenderingStyles from './htmlRenderingStyles';
import type { ReaderSettings } from './readerData';
import { createTheme, LINK_COLOR } from './theme';

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1
  }
}));

describe('Android HTML rendering styles', () => {
  const settings: ReaderSettings = {
    theme: 'light',
    fontScale: 1,
    lineHeight: 'standard',
    contentWidth: 'standard',
    fontFamily: 'sans',
    listDensity: 'standard'
  };

  it('keeps forum user mentions visually separate from ordinary links', () => {
    const theme = createTheme(settings);
    const { htmlClassesStyles, htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlTagsStyles.a?.color).toBe(LINK_COLOR);
    expect(htmlClassesStyles['forum-user-mention'].color).toBe(LINK_COLOR);
    expect(htmlClassesStyles['forum-user-mention'].backgroundColor).toBeTruthy();
    expect(htmlClassesStyles['forum-user-mention'].textDecorationLine).toBe('none');
  });

  it('allows source text color without allowing source background colors', () => {
    const theme = createTheme(settings);
    const { htmlIgnoredStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect((htmlRenderingStyles as typeof htmlRenderingStyles & { HTML_ALLOWED_INLINE_STYLES?: string[] }).HTML_ALLOWED_INLINE_STYLES).toContain('color');
    expect(htmlIgnoredStyles).not.toContain('color');
    expect(htmlIgnoredStyles).toContain('backgroundColor');
  });

  it('uses bottom-only paragraph spacing so list item text is not pushed below markers', () => {
    const theme = createTheme(settings);
    const { htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlTagsStyles.p?.marginTop).toBe(0);
    expect(htmlTagsStyles.p?.marginBottom).toBe(10);
  });

  it('keeps reply prose denser than article prose while honoring reader scaling', () => {
    const theme = createTheme(settings);
    const { htmlBaseStyle, htmlClassesStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });
    const replyStyle = htmlClassesStyles[htmlRenderingStyles.HTML_REPLY_CONTENT_CLASS];

    expect(htmlBaseStyle).toMatchObject({ fontSize: 16, lineHeight: 26 });
    expect(replyStyle).toMatchObject({ fontSize: 15, lineHeight: 24 });
  });

  it('[REG-TOPIC-056] gives canonical Callout titles App-owned tone styles', () => {
    const theme = createTheme(settings);
    const ordinaryStyles = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });
    const { htmlClassesStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({
      enableDiscourseCallouts: true,
      settings,
      theme
    });

    expect(ordinaryStyles.htmlClassesStyles['forum-callout-title']).toBeUndefined();
    expect(ordinaryStyles.htmlClassesStyles['forum-callout-tone-danger']).toBeUndefined();
    expect(htmlClassesStyles['forum-callout-title']).toMatchObject({ fontWeight: '700' });
    expect(htmlClassesStyles['forum-callout-tone-primary']).toMatchObject({ color: theme.primary });
    expect(htmlClassesStyles['forum-callout-tone-success']).toMatchObject({ color: theme.success });
    expect(htmlClassesStyles['forum-callout-tone-warning']).toMatchObject({ color: theme.warning });
    expect(htmlClassesStyles['forum-callout-tone-danger']).toMatchObject({ color: theme.danger });
    expect(htmlClassesStyles['forum-callout-tone-muted']).toMatchObject({ color: theme.muted });
  });

  it('trims only the last visible block inside a marked reply fragment', () => {
    const markedParent = {
      attributes: { [htmlRenderingStyles.TRIM_TRAILING_BLOCK_SPACING_ATTRIBUTE]: 'true' },
      children: [] as unknown[],
      parent: null
    };
    const trailingChild = { nodeIndex: 0, parent: markedParent };
    markedParent.children.push(trailingChild);

    expect(htmlRenderingStyles.trimsTrailingBlockSpacing(trailingChild as never)).toBe(true);

    const firstChild = { nodeIndex: 0, parent: { ...markedParent, children: [{}, {}] } };
    expect(htmlRenderingStyles.trimsTrailingBlockSpacing(firstChild as never)).toBe(false);
  });
});
