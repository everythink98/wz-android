import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');
const searchScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'SearchScreen.tsx'), 'utf8');
const themeSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'theme.ts'), 'utf8');

describe('Android topic detail reading layout', () => {
  it('uses render-html whitespace controls for cleaner native HTML output', () => {
    expect(appSource).toContain('enableExperimentalMarginCollapsing');
    expect(appSource).toContain('enableExperimentalBRCollapsing');
    expect(appSource).toContain('enableExperimentalGhostLinesPrevention');
  });

  it('limits forum inline styles so detail HTML follows the app reading layout', () => {
    const allowedInlineStyles = appSource.match(/HTML_ALLOWED_INLINE_STYLES: HtmlAllowedStyles = \[([^\]]+)\]/)?.[1] || '';

    expect(appSource).toContain('HTML_ALLOWED_INLINE_STYLES');
    expect(appSource).toContain('allowedStyles={HTML_ALLOWED_INLINE_STYLES}');
    expect(allowedInlineStyles).toContain("'fontWeight'");
    expect(allowedInlineStyles).not.toContain("'fontSize'");
    expect(allowedInlineStyles).not.toContain("'backgroundColor'");
  });

  it('does not keep an empty topic action row when the topic is read-only', () => {
    expect(appSource).not.toContain('<View style={styles.actions}>\n          {canWrite ?');
  });

  it('defines roomier topic detail spacing tokens', () => {
    expect(appSource).toContain('topicMetaStack');
    expect(appSource).toContain('topicPrimaryActions');
    expect(appSource).toContain('htmlParagraph');
  });

  it('separates reply floor, author, body, and actions for readable mobile replies', () => {
    expect(appSource).toContain('replyHead');
    expect(appSource).toContain('replyFloorBadge');
    expect(appSource).toContain('replyAuthorBlock');
    expect(appSource).toContain('replyBody');
    expect(appSource).toContain('replyActionRow');
  });

  it('uses saved search ids as chip keys while still filling the saved query text', () => {
    expect(searchScreenSource).toContain('key={item.id}');
    expect(searchScreenSource).toContain('const saved = readerData.savedSearches.find((item) => item.id === id)');
    expect(searchScreenSource).toContain('onQueryChange(saved.query);');
    expect(searchScreenSource).not.toContain('onSearchSourceChange(saved.source);');
    expect(searchScreenSource).not.toContain('items={readerData.savedSearches.map((item) => ({ value: item.query, label: item.query }))}');
  });

  it('keeps native controls large enough for touch use', () => {
    expect(themeSource).toMatch(/pill:\s*\{[\s\S]*minHeight:\s*40/);
    expect(themeSource).toMatch(/tab:\s*\{[\s\S]*minHeight:\s*40/);
    expect(themeSource).toMatch(/buttonIconOnly:\s*\{[\s\S]*width:\s*44[\s\S]*minHeight:\s*44/);
    expect(themeSource).toMatch(/buttonTiny:\s*\{[\s\S]*minHeight:\s*40/);
  });

  it('ties selected backgrounds and login panels to the current theme', () => {
    expect(themeSource).toContain('mist: alphaColor(palette.light, 0.09)');
    expect(themeSource).toContain('mist: alphaColor(palette.dark, 0.18)');
    expect(themeSource).toContain('const loginWebViewHeight = Math.min(480, Math.max(320, Math.round(windowHeight * 0.58)))');
    expect(themeSource).toMatch(/webViewShell:\s*\{[\s\S]*height:\s*loginWebViewHeight[\s\S]*backgroundColor:\s*theme\.surface/);
  });
});
