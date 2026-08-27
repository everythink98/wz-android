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

  it('[REG-TOPIC-118] keeps a standalone mention from becoming a full-width Android text frame', () => {
    const theme = createTheme(settings);
    const { htmlClassesStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });
    const mentionStyle = htmlClassesStyles['forum-user-mention'];

    expect(mentionStyle.alignSelf).toBe('flex-start');
    expect(mentionStyle.backgroundColor).toBeTruthy();
    expect(mentionStyle.borderWidth).toBe(1);
    expect(mentionStyle.paddingHorizontal).toBe(5);
    expect(mentionStyle.paddingVertical).toBe(1);
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
  });

  it('[REG-TOPIC-123][MORE-03] keeps the three reading line-height choices dense and distinct', () => {
    const compact = htmlRenderingStyles.buildHtmlRenderingStyles({
      settings: { ...settings, lineHeight: 'compact' },
      theme: createTheme({ ...settings, lineHeight: 'compact' })
    });
    const standard = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme: createTheme(settings) });
    const loose = htmlRenderingStyles.buildHtmlRenderingStyles({
      settings: { ...settings, lineHeight: 'loose' },
      theme: createTheme({ ...settings, lineHeight: 'loose' })
    });

    expect([
      compact.htmlBaseStyle.lineHeight,
      standard.htmlBaseStyle.lineHeight,
      loose.htmlBaseStyle.lineHeight
    ]).toEqual([22, 24, 27]);
    expect([
      compact.htmlClassesStyles['forum-reply-content'].lineHeight,
      standard.htmlClassesStyles['forum-reply-content'].lineHeight,
      loose.htmlClassesStyles['forum-reply-content'].lineHeight
    ]).toEqual([21, 23, 26]);
  });

  it('[REG-TOPIC-081][REG-TOPIC-122][REG-TOPIC-123] defines one shared article rhythm and semantic attachment card', () => {
    const theme = createTheme(settings);
    const { htmlClassesStyles, htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlTagsStyles.p).toMatchObject({ marginBottom: 10, marginTop: 0 });
    expect(htmlTagsStyles.h1).toMatchObject({ fontSize: 24, lineHeight: 32, marginBottom: 10, marginTop: 24 });
    expect(htmlTagsStyles.h2).toMatchObject({ fontSize: 20, lineHeight: 28, marginBottom: 10, marginTop: 20 });
    expect(htmlTagsStyles.h3).toMatchObject({ fontSize: 18, lineHeight: 26, marginBottom: 8, marginTop: 16 });
    expect(htmlTagsStyles.h4).toMatchObject({ fontSize: 16, lineHeight: 24, marginBottom: 8, marginTop: 16 });
    expect(htmlTagsStyles.h5).toMatchObject({ fontSize: 15, lineHeight: 22, marginBottom: 6, marginTop: 12 });
    expect(htmlTagsStyles.h6).toMatchObject({ fontSize: 14, lineHeight: 21, marginBottom: 6, marginTop: 12 });
    expect(htmlTagsStyles.img).toMatchObject({ marginBottom: 8, marginTop: 6 });
    expect(htmlTagsStyles.li).toMatchObject({ marginBottom: 2 });
    expect(htmlTagsStyles.ul).toMatchObject({ marginBottom: 10, marginTop: 6 });
    expect(htmlTagsStyles.ol).toMatchObject({ marginBottom: 10, marginTop: 6 });
    expect(htmlTagsStyles.strong).toMatchObject({ fontWeight: '700' });
    expect(htmlTagsStyles.hr).toMatchObject({
      borderBottomColor: theme.line,
      borderBottomWidth: 1,
      marginBottom: 8,
      marginTop: 8
    });
    expect(htmlTagsStyles.pre).toMatchObject({ borderRadius: 8, marginBottom: 10, marginTop: 10, padding: 12 });
    expect(htmlTagsStyles.code).toMatchObject({
      backgroundColor: theme.surface2,
      borderRadius: 4,
      fontFamily: 'monospace',
      fontSize: 14,
      paddingHorizontal: 4,
      paddingVertical: 1
    });
    expect(htmlTagsStyles.blockquote).toMatchObject({
      backgroundColor: 'transparent',
      borderLeftColor: theme.lineStrong,
      borderLeftWidth: 3,
      marginBottom: 10,
      marginTop: 10,
      paddingBottom: 2,
      paddingLeft: 12,
      paddingTop: 2
    });
    expect(htmlTagsStyles.blockquote).not.toHaveProperty('borderRadius');
    expect(htmlClassesStyles['forum-attachment']).toMatchObject({
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderWidth: 1
    });
    expect(htmlClassesStyles['forum-attachment-title']).toMatchObject({ fontWeight: '700' });
  });

  it('[REG-TOPIC-129] supplies the missing cooked-content semantic styles', () => {
    const lightTheme = createTheme(settings);
    const darkSettings = { ...settings, theme: 'dark' as const };
    const darkTheme = createTheme(darkSettings);
    const light = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme: lightTheme });
    const dark = htmlRenderingStyles.buildHtmlRenderingStyles({ settings: darkSettings, theme: darkTheme });

    expect(light.htmlClassesStyles['bbcode-b']).toMatchObject({ fontWeight: '700' });
    expect(light.htmlClassesStyles['bbcode-i']).toMatchObject({ fontStyle: 'italic' });
    expect(light.htmlClassesStyles['bbcode-u']).toMatchObject({ textDecorationLine: 'underline' });
    expect(light.htmlClassesStyles['bbcode-s']).toMatchObject({ textDecorationLine: 'line-through' });
    expect(light.htmlClassesStyles['mention-group']).toEqual(light.htmlClassesStyles['forum-user-mention']);
    expect(light.htmlTagsStyles.kbd).toMatchObject({
      backgroundColor: lightTheme.surface2,
      borderBottomWidth: 2,
      borderColor: lightTheme.lineStrong,
      borderRadius: 4,
      borderWidth: 1,
      fontFamily: 'monospace',
      paddingHorizontal: 5,
      paddingVertical: 1
    });
    expect(light.htmlTagsStyles.mark).toMatchObject({ color: lightTheme.ink });
    expect(light.htmlTagsStyles.ins).toMatchObject({ color: lightTheme.ink, textDecorationLine: 'underline' });
    expect(light.htmlTagsStyles.del).toMatchObject({ color: lightTheme.ink, textDecorationLine: 'line-through' });
    expect(light.htmlTagsStyles.big).toMatchObject({ fontSize: 24, lineHeight: 36 });
    expect(light.htmlTagsStyles.small).toMatchObject({ fontSize: 12, lineHeight: 18 });
    expect(light.htmlTagsStyles.mark?.backgroundColor).not.toBe(lightTheme.surface2);
    expect(light.htmlTagsStyles.ins?.backgroundColor).not.toBe(lightTheme.surface2);
    expect(light.htmlTagsStyles.del?.backgroundColor).not.toBe(lightTheme.surface2);
    expect(dark.htmlTagsStyles.mark).toMatchObject({ color: darkTheme.ink });
    expect(dark.htmlTagsStyles.ins).toMatchObject({ color: darkTheme.ink });
    expect(dark.htmlTagsStyles.del).toMatchObject({ color: darkTheme.ink });
    expect(dark.htmlTagsStyles.mark?.backgroundColor).not.toBe(light.htmlTagsStyles.mark?.backgroundColor);
    expect(dark.htmlTagsStyles.ins?.backgroundColor).not.toBe(light.htmlTagsStyles.ins?.backgroundColor);
    expect(dark.htmlTagsStyles.del?.backgroundColor).not.toBe(light.htmlTagsStyles.del?.backgroundColor);
  });

  it('[REG-TOPIC-130] owns NodeSeek native s styling without treating it as semantic deletion', () => {
    const lightTheme = createTheme(settings);
    const darkSettings = { ...settings, theme: 'dark' as const };
    const darkTheme = createTheme(darkSettings);
    const light = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme: lightTheme });
    const dark = htmlRenderingStyles.buildHtmlRenderingStyles({ settings: darkSettings, theme: darkTheme });

    expect(light.htmlTagsStyles.s).toMatchObject({ textDecorationLine: 'line-through' });
    expect(dark.htmlTagsStyles.s).toMatchObject({ textDecorationLine: 'line-through' });
    expect(light.htmlTagsStyles.s).not.toHaveProperty('backgroundColor');
    expect(dark.htmlTagsStyles.s).not.toHaveProperty('backgroundColor');
  });

  it('[REG-TOPIC-084][REG-TOPIC-127] leaves geometry to the native renderer and keeps inner rules visible', () => {
    const theme = createTheme(settings);
    const { htmlTagsStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });

    expect(htmlTagsStyles.table).not.toHaveProperty('borderWidth');
    expect(htmlTagsStyles.th).toMatchObject({
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderBottomWidth: 1,
      borderRightWidth: 1,
      color: theme.ink,
      flexShrink: 0,
      fontWeight: '700',
      paddingHorizontal: 10,
      paddingVertical: 9
    });
    expect(htmlTagsStyles.td).toMatchObject({
      backgroundColor: theme.surface,
      borderColor: theme.line,
      borderBottomWidth: 1,
      borderRightWidth: 1,
      color: theme.ink,
      flexShrink: 0,
      paddingHorizontal: 10,
      paddingVertical: 9
    });
    expect(htmlTagsStyles.th).not.toHaveProperty('width');
    expect(htmlTagsStyles.td).not.toHaveProperty('width');
  });
});
