import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');

describe('Android App security review guards', () => {
  it('routes external links through the http/https protocol guard', () => {
    expect(appSource).toContain('const openExternalUrl = useCallback');
    expect(appSource).toContain("notify('仅支持打开 http/https 链接。')");
    expect(appSource).not.toContain('void Linking.openURL(href);');
    expect(appSource).not.toContain('onOpenOriginal={(url) => void Linking.openURL(url)}');
  });

  it('clears only the selected login WebView cookies', () => {
    const clearNodeSeekLoginBlock = appSource.match(/const clearLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[notify\]\);/)?.[1] || '';
    const clearYaohuoLoginBlock = appSource.match(/const clearYaohuoLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[notify\]\);/)?.[1] || '';

    expect(appSource).not.toContain('CookieManager.clearAll');
    expect(clearNodeSeekLoginBlock).toContain('await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);');
    expect(clearYaohuoLoginBlock).toContain('await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);');
    expect(clearYaohuoLoginBlock).toContain('yaohuoWebViewRef.current?.reload()');
  });

  it('restricts login WebViews to their expected hosts', () => {
    expect(appSource).toContain('handleNodeSeekLoginNavigation');
    expect(appSource).toContain('handleYaohuoLoginNavigation');
    expect(appSource).toContain('onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}');
    expect(appSource).toContain('onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}');
  });
});
