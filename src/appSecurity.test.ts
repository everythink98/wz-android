import { describe, expect, it } from 'vitest';
import { exportReaderBackupJson, importReaderBackupJson } from './readerBackup';
import { createEmptyReaderData } from './readerData';
import { isYaohuoRequestUrl } from './localYaohuoHelpers';
import { isNodeSeekRequestUrl } from './nodeseekFetchFallback';
import { readProjectFile } from './sourceTestUtils';

const appRootSource = readProjectFile('src', 'app', 'AppRoot.tsx');
const hiddenBrowserHostSource = readProjectFile('src', 'app', 'HiddenBrowserHost.tsx');
const linuxDoVerifyModalSource = readProjectFile('src', 'app', 'LinuxDoVerifyModal.tsx');
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');
const sessionControllerSource = readProjectFile('src', 'app', 'useSessionController.ts');
const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
const linuxDoCookiePluginSource = readProjectFile('plugins', 'withLinuxDoCookieModule.js');
const fakeSecret = 'fixed-fake-secret-do-not-leak';

describe('Android App security review guards', () => {
  it('routes external links through the http/https protocol guard', () => {
    expect(appRootSource).toContain('const openExternalUrl = useCallback');
    expect(appRootSource).toContain("notify('仅支持打开 http/https 链接。')");
    expect(appRootSource).not.toContain('void Linking.openURL(href);');
    expect(appRootSource).not.toContain('onOpenOriginal={(url) => void Linking.openURL(url)}');
  });

  it('clears only the selected login WebView cookies', () => {
    const clearNodeSeekStateBlock = sessionControllerSource.match(/const clearNodeSeekLoginState = useCallback[\s\S]*?\n\n  const clearNodeSeekLoginCookiesOnly/)?.[0] || '';
    const clearYaohuoStateBlock = sessionControllerSource.match(/const clearYaohuoLoginState = useCallback[\s\S]*?\n\n  const clearNodeSeekLoginState/)?.[0] || '';
    const clearNodeSeekLoginBlock = accountControllerSource.match(/const clearLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearNodeSeekLoginState, notify\]\);/)?.[1] || '';
    const clearYaohuoLoginBlock = accountControllerSource.match(/const clearYaohuoLogin = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[clearYaohuoLoginState, notify, yaohuoWebViewRef\]\);/)?.[1] || '';

    expect(appRootSource).not.toContain('CookieManager.clearAll');
    expect(clearNodeSeekStateBlock).toContain('await clearCookieUrls(CookieManager, NODESEEK_COOKIE_URLS);');
    expect(clearYaohuoStateBlock).toContain('await clearCookieUrls(CookieManager, YAOHUO_COOKIE_URLS);');
    expect(clearNodeSeekLoginBlock).toContain('await clearNodeSeekLoginState();');
    expect(clearYaohuoLoginBlock).toContain('await clearYaohuoLoginState();');
    expect(clearYaohuoLoginBlock).toContain('yaohuoWebViewRef.current?.reload()');
  });

  it('restricts login WebViews to their expected hosts', () => {
    expect(appRootSource).toContain('handleNodeSeekLoginNavigation');
    expect(appRootSource).toContain('handleYaohuoLoginNavigation');
    expect(appRootSource).toContain('handleLinuxDoNavigation');
    expect(morePanelsSource).toContain('onShouldStartLoadWithRequest={handleNodeSeekLoginNavigation}');
    expect(morePanelsSource).toContain('onShouldStartLoadWithRequest={handleYaohuoLoginNavigation}');
    expect(linuxDoVerifyModalSource).toContain('onShouldStartLoadWithRequest={handleLinuxDoNavigation}');
  });

  it('keeps login WebView links inside the App window', () => {
    expect((morePanelsSource.match(/setSupportMultipleWindows=\{false\}/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(linuxDoVerifyModalSource).toContain('setSupportMultipleWindows={false}');
  });

  it('restricts hidden fetch WebViews and rejects off-site browser results', () => {
    expect(hiddenBrowserHostSource).toContain('onShouldStartLoadWithRequest={handleNodeSeekBrowserNavigation}');
    expect(hiddenBrowserHostSource).toContain('onShouldStartLoadWithRequest={handleLinuxDoBrowserNavigation}');
    expect(sessionControllerSource).toContain('!data.url || !isNodeSeekRequestUrl(data.url)');
    expect(sessionControllerSource).toContain('!data.url || !isLinuxDoRequestUrl(data.url)');
  });

  it('allows authenticated source requests only over HTTPS on expected hosts', () => {
    expect(isNodeSeekRequestUrl('https://www.nodeseek.com/search?q=test')).toBe(true);
    expect(isNodeSeekRequestUrl('http://www.nodeseek.com/search?q=test')).toBe(false);
    expect(isNodeSeekRequestUrl('https://www.nodeseek.com.evil.example/search')).toBe(false);
    expect(isNodeSeekRequestUrl('https://evil.example@www.nodeseek.com/search')).toBe(false);
    expect(isNodeSeekRequestUrl('https://www.nodeseek.com@evil.example/search')).toBe(false);

    expect(isYaohuoRequestUrl('https://yaohuo.me/bbs/book_view.aspx?id=1')).toBe(true);
    expect(isYaohuoRequestUrl('http://yaohuo.me/bbs/book_view.aspx?id=1')).toBe(false);
    expect(isYaohuoRequestUrl('https://yaohuo.me.evil.example/bbs/book_view.aspx?id=1')).toBe(false);
    expect(isYaohuoRequestUrl('https://evil.example@yaohuo.me/bbs/book_view.aspx?id=1')).toBe(false);
  });

  it('keeps native NodeSeek cookie reads scoped to access cookies', () => {
    const nodeSeekReadBlock = linuxDoCookiePluginSource.match(/private fun readNodeSeekCookieHeaderFrom\(cookieDb: File\): String\? \{[\s\S]*?\n  \}/)?.[0] || '';

    expect(linuxDoCookiePluginSource).toContain('nodeSeekWantedCookieNames');
    expect(nodeSeekReadBlock).toContain("cf_clearance");
    expect(nodeSeekReadBlock).toContain("session");
    expect(nodeSeekReadBlock).not.toContain('if (!name.isNullOrBlank() && !value.isNullOrBlank() && seen.add(name))');
  });

  it('removes sensitive keys and URL parameters from Android backup JSON', () => {
    const exported = exportReaderBackupJson({
      version: 2,
      favorites: {
        one: {
          savedAt: '2026-06-06T00:00:00.000Z',
          topic: {
            source: 'nodeseek',
            id: '1',
            title: '安全测试',
            url: `https://www.nodeseek.com/post-1-1?token=${fakeSecret}&ok=1`,
            createdAt: '2026-06-06T00:00:00.000Z',
            cookie: fakeSecret,
            session: fakeSecret,
            csrf: fakeSecret
          }
        }
      },
      history: {},
      followedUsers: {},
      deletedRecords: {
        favorites: {},
        history: {},
        followedUsers: {}
      },
      settings: {},
      token: fakeSecret,
      password: fakeSecret,
      sid: fakeSecret,
      sidyaohuo: fakeSecret,
      csrf: fakeSecret
    });

    expect(exported).not.toContain(fakeSecret);
    expect(exported).not.toContain('token');
    expect(exported).not.toContain('password');
    expect(exported).not.toContain('sidyaohuo');
    expect(exported).toContain('ok=1');
  });

  it('does not import sensitive fields from Android backup JSON', () => {
    const merged = importReaderBackupJson(createEmptyReaderData(), JSON.stringify({
      version: 2,
      favorites: {
        one: {
          savedAt: '2026-06-06T00:00:00.000Z',
          topic: {
            source: 'linuxdo',
            id: '1',
            title: '导入安全测试',
            url: `https://linux.do/t/slug/1?session=${fakeSecret}&safe=1`,
            createdAt: '2026-06-06T00:00:00.000Z',
            authorization: fakeSecret
          }
        }
      },
      history: {},
      followedUsers: {},
      deletedRecords: {
        favorites: {},
        history: {},
        followedUsers: {}
      },
      settings: {},
      secret: fakeSecret
    }));

    const imported = JSON.stringify(merged);

    expect(imported).not.toContain(fakeSecret);
    expect(imported).not.toContain('authorization');
    expect(imported).not.toContain('session=');
    expect(imported).toContain('safe=1');
  });
});
