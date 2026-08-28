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

  it('keeps a standalone mention from becoming a full-width Android text frame', () => {
    const theme = createTheme(settings);
    const { htmlClassesStyles } = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme });
    const mentionStyle = htmlClassesStyles['forum-user-mention'];

    expect(mentionStyle.alignSelf).toBe('flex-start');
    expect(mentionStyle.backgroundColor).toBeTruthy();
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

  it('gives canonical Callout titles App-owned tone styles', () => {
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

  it('exposes exact leading and trailing spacing for a continuation fragment', () => {
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

  it('[MORE-03] orders the three reading line-height choices from compact to loose', () => {
    const compact = htmlRenderingStyles.buildHtmlRenderingStyles({
      settings: { ...settings, lineHeight: 'compact' },
      theme: createTheme({ ...settings, lineHeight: 'compact' })
    });
    const standard = htmlRenderingStyles.buildHtmlRenderingStyles({ settings, theme: createTheme(settings) });
    const loose = htmlRenderingStyles.buildHtmlRenderingStyles({
      settings: { ...settings, lineHeight: 'loose' },
      theme: createTheme({ ...settings, lineHeight: 'loose' })
    });

    const baseHeights = [
      compact.htmlBaseStyle.lineHeight,
      standard.htmlBaseStyle.lineHeight,
      loose.htmlBaseStyle.lineHeight
    ] as number[];
    const replyHeights = [
      compact.htmlClassesStyles['forum-reply-content'].lineHeight,
      standard.htmlClassesStyles['forum-reply-content'].lineHeight,
      loose.htmlClassesStyles['forum-reply-content'].lineHeight
    ] as number[];

    expect(baseHeights[0]).toBeLessThan(baseHeights[1]);
    expect(baseHeights[1]).toBeLessThan(baseHeights[2]);
    expect(replyHeights[0]).toBeLessThan(replyHeights[1]);
    expect(replyHeights[1]).toBeLessThan(replyHeights[2]);
  });

  it('supplies the missing cooked-content semantic styles', () => {
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
      fontFamily: 'monospace'
    });
    expect(light.htmlTagsStyles.mark).toMatchObject({ color: lightTheme.ink });
    expect(light.htmlTagsStyles.ins).toMatchObject({ color: lightTheme.ink, textDecorationLine: 'underline' });
    expect(light.htmlTagsStyles.del).toMatchObject({ color: lightTheme.ink, textDecorationLine: 'line-through' });
    expect(light.htmlTagsStyles.big?.fontSize).toBeGreaterThan(light.htmlBaseStyle.fontSize as number);
    expect(light.htmlTagsStyles.small?.fontSize).toBeLessThan(light.htmlBaseStyle.fontSize as number);
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

  it('owns NodeSeek native s styling without treating it as semantic deletion', () => {
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

  it('leaves geometry to the native renderer and keeps inner rules visible', () => {
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
