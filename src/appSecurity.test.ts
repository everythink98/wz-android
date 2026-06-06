import { describe, expect, it } from 'vitest';
import { readProjectFile } from './sourceTestUtils';

const appSource = readProjectFile('android-app', 'App.tsx');
const accountControllerSource = readProjectFile('android-app', 'src', 'app', 'useAccountController.ts');
const sessionControllerSource = readProjectFile('android-app', 'src', 'app', 'useSessionController.ts');
const morePanelsSource = readProjectFile('android-app', 'src', 'screens', 'more', 'MorePanels.tsx');

describe('Android App security review guards', () => {
  it('routes external links through the http/https protocol guard', () => {
    expect(appSource).toContain('const openExternalUrl = useCallback');
    expect(appSource).toContain("notify('仅支持打开 http/https 链接。')");
    expect(appSource).not.toContain('void Linking.openURL(href);');
    expect(appSource).not.toContain('onOpenOriginal={(url) => void Linking.openURL(url)}');
  });

  it('clears only the selected login WebView cookies', () => {
    const clearNodeSeekStateBlock = sessionControllerSource.match(/const clearNodeSeekLoginState = useCallback[\s\S]*?\n\n  const clearNodeSeekLoginCookiesOnly/)?.[0] || '';
    const clearYaohuoStateBlock = sessionControllerSource.match(/const clearYaohuoLoginState = useCallback[\s\S]*?\n\n  const clearNodeSeekLoginState/)?.[0] || '';
    const clearNodeSeekLoginBlock = accountControllerSource.match(/const clearLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearNodeSeekLoginState, notify\]\);/)?.[1] || '';
    const clearYaohuoLoginBlock = accountControllerSource.match(/const clearYaohuoLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState, notify, yaohuoWebViewRef\]\);/)?.[1] || '';

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
    expect(morePanelsSource).toContain('onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}');
    expect(morePanelsSource).toContain('onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}');
    expect(morePanelsSource).toContain('onShouldStartLoadWithRequest={handleLinuxDoNavigation}');
  });
});
