import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(join(process.cwd(), 'android-app', 'App.tsx'), 'utf8');
const moreScreenSource = readFileSync(join(process.cwd(), 'android-app', 'src', 'screens', 'MoreScreen.tsx'), 'utf8');

describe('Android App security review guards', () => {
  it('routes external links through the http/https protocol guard', () => {
    expect(appSource).toContain('const openExternalUrl = useCallback');
    expect(appSource).toContain("notify('仅支持打开 http/https 链接。')");
    expect(appSource).not.toContain('void Linking.openURL(href);');
    expect(appSource).not.toContain('onOpenOriginal={(url) => void Linking.openURL(url)}');
  });

  it('clears only the selected login WebView cookies', () => {
    const clearNodeSeekStateBlock = appSource.match(/const clearNodeSeekLoginState = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearStoredNodeSeekLoginState\]\);/)?.[1] || '';
    const clearYaohuoStateBlock = appSource.match(/const clearYaohuoLoginState = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearStoredYaohuoLoginState\]\);/)?.[1] || '';
    const clearNodeSeekLoginBlock = appSource.match(/const clearLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearNodeSeekLoginState, notify\]\);/)?.[1] || '';
    const clearYaohuoLoginBlock = appSource.match(/const clearYaohuoLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState, notify\]\);/)?.[1] || '';

    expect(appSource).not.toContain('CookieManager.clearAll');
    expect(clearNodeSeekStateBlock).toContain('await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);');
    expect(clearYaohuoStateBlock).toContain('await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);');
    expect(clearNodeSeekLoginBlock).toContain('await clearNodeSeekLoginState();');
    expect(clearYaohuoLoginBlock).toContain('await clearYaohuoLoginState();');
    expect(clearYaohuoLoginBlock).toContain('yaohuoWebViewRef.current?.reload()');
  });

  it('restricts login WebViews to their expected hosts', () => {
    expect(appSource).toContain('handleNodeSeekLoginNavigation');
    expect(appSource).toContain('handleYaohuoLoginNavigation');
    expect(appSource).toContain('handleLinuxDoNavigation');
    expect(moreScreenSource).toContain('onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}');
    expect(moreScreenSource).toContain('onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}');
    expect(moreScreenSource).toContain('onShouldStartLoadWithRequest={handleLinuxDoNavigation}');
  });
});
