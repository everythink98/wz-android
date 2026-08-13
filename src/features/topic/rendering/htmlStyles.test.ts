import { describe, expect, it, vi } from 'vitest';
import * as htmlRenderingStyles from './htmlStyles';
import { createEmptyReaderData, type ReaderSettings } from '@/domain/reader/readerData';
import { createTheme, LINK_COLOR } from '@/ui/theme/tokens';

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1
  }
}));

describe('Android HTML rendering styles', () => {
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

    expect(
      (htmlRenderingStyles as typeof htmlRenderingStyles & { HTML_ALLOWED_INLINE_STYLES?: string[] })
        .HTML_ALLOWED_INLINE_STYLES
    ).toContain('color');
    expect(htmlIgnoredStyles).not.toContain('color');
    expect(htmlIgnoredStyles).toContain('backgroundColor');
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

  it('[REG-PERF-010] exposes exact leading and trailing spacing for a continuation fragment', () => {
    expect(htmlRenderingStyles.contentBoundaryForContinuation('first')).toEqual({
      trimLeading: false,
      trimTrailing: true
    });
    expect(htmlRenderingStyles.contentBoundaryForContinuation('middle')).toEqual({
      trimLeading: true,
      trimTrailing: true
    });
    expect(htmlRenderingStyles.contentBoundaryForContinuation('last')).toEqual({
      trimLeading: true,
      trimTrailing: false
    });
    expect(htmlRenderingStyles.contentBoundaryForContinuation('only')).toEqual({
      trimLeading: false,
      trimTrailing: false
    });
    for (const continuation of ['first', 'middle', 'last', 'only'] as const) {
      expect(
        htmlRenderingStyles.contentContinuationForBoundary(
          htmlRenderingStyles.contentBoundaryForContinuation(continuation)
        )
      ).toBe(continuation);
    }
  });

  it('[REG-TOPIC-081] defines one shared article rhythm and semantic attachment card', () => {
    const theme = createTheme(settings);
    const { htmlClassesStyles, htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlTagsStyles.strong).toMatchObject({ fontWeight: '700' });
    expect(htmlTagsStyles.hr).toMatchObject({ borderBottomColor: theme.line, borderBottomWidth: 1 });
    expect(htmlClassesStyles['forum-attachment']).toMatchObject({
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: 1
    });
    expect(htmlClassesStyles['forum-attachment-title']).toMatchObject({ fontWeight: '700' });
  });

  it('[REG-TOPIC-084] leaves table geometry to the native logical-table renderer', () => {
    const theme = createTheme(settings);
    const { htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlTagsStyles.table).not.toHaveProperty('borderWidth');
    expect(htmlTagsStyles.th).toMatchObject({
      borderBottomWidth: 1,
      borderRightWidth: 1,
      flexShrink: 0
    });
    expect(htmlTagsStyles.td).toMatchObject({
      borderBottomWidth: 1,
      borderRightWidth: 1,
      flexShrink: 0
    });
    expect(htmlTagsStyles.th).not.toHaveProperty('width');
    expect(htmlTagsStyles.td).not.toHaveProperty('width');
  });
});
