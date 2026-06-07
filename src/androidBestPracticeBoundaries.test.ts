import { describe, expect, it } from 'vitest';
import { readOptionalProjectFile, readProjectFile } from './sourceTestUtils';

const appSource = readProjectFile('App.tsx');
const accountControllerSource = readProjectFile('src', 'app', 'useAccountController.ts');
const globalModalHostSource = readProjectFile('src', 'app', 'GlobalModalHost.tsx');
const linuxDoVerifyModalSource = readOptionalProjectFile('src', 'app', 'LinuxDoVerifyModal.tsx');
const loginWebViewScriptsSource = readOptionalProjectFile('src', 'loginWebViewScripts.ts');
const moreScreenSource = readProjectFile('src', 'screens', 'MoreScreen.tsx');
const morePanelsSource = readProjectFile('src', 'screens', 'more', 'MorePanels.tsx');
const verificationControllerSource = readProjectFile('src', 'app', 'useVerificationController.ts');

describe('Android best-practice boundary guards', () => {
  it('keeps root providers in a focused host', () => {
    const appProvidersSource = readOptionalProjectFile('src', 'app', 'AppProviders.tsx');

    expect(appProvidersSource).toContain('export function AppProviders');
    expect(appProvidersSource).toContain('GestureHandlerRootView');
    expect(appProvidersSource).toContain('SafeAreaProvider');
    expect(appProvidersSource).toContain('KeyboardAvoidingView');
    expect(appProvidersSource).toContain('SafeAreaView');
    expect(appProvidersSource).toContain("edges={['left', 'right', 'bottom']}");
    expect(appSource).toContain('<AppProviders');
  });

  it('keeps the Android top inset owned by screen headers only once', () => {
    const appProvidersSource = readOptionalProjectFile('src', 'app', 'AppProviders.tsx');
    const statusBarScrimMatches = appSource.match(/styles\.statusBarScrim/g) || [];

    expect(appProvidersSource).not.toContain("'top'");
    expect(statusBarScrimMatches).toHaveLength(1);
  });

  it('keeps hidden browser WebView rendering in a focused host', () => {
    const hiddenBrowserHostSource = readOptionalProjectFile('src', 'app', 'HiddenBrowserHost.tsx');

    expect(hiddenBrowserHostSource).toContain('export function HiddenBrowserHost');
    expect(hiddenBrowserHostSource).toContain('nodeseek-browser-fetch');
    expect(hiddenBrowserHostSource).toContain('linuxdo-browser-fetch');
    expect(appSource).toContain('<HiddenBrowserHost');
    expect(appSource).not.toContain('key={`nodeseek-browser-fetch-${nodeSeekBrowserFetchRequest.id}`}');
    expect(appSource).not.toContain('key={`linuxdo-browser-fetch-${linuxDoBrowserFetchRequest.id}`}');
  });

  it('keeps global verification and preview modals in a focused host', () => {
    expect(globalModalHostSource).toContain('export function GlobalModalHost');
    expect(globalModalHostSource).toContain('MemoizedLinuxDoVerifyModal');
    expect(globalModalHostSource).toContain('ImagePreviewModal');
    expect(linuxDoVerifyModalSource).toContain('export function LinuxDoVerifyModal');
    expect(linuxDoVerifyModalSource).toContain('showLinuxDoPanel && mountLinuxDoWebView');
    expect(appSource).toContain('<GlobalModalHost');
    expect(appSource).not.toContain('<MemoizedLinuxDoVerifyModal');
    expect(appSource).not.toContain('<ImagePreviewModal');
  });

  it('keeps WebView probes and global verification outside More screen modules', () => {
    expect(loginWebViewScriptsSource).toContain('NODESEEK_LOGIN_PROBE_SCRIPT');
    expect(loginWebViewScriptsSource).toContain('LINUXDO_WEBVIEW_PROBE_SCRIPT');
    expect(globalModalHostSource).toContain("from './LinuxDoVerifyModal'");
    expect(accountControllerSource).toContain("from '../loginWebViewScripts'");
    expect(verificationControllerSource).toContain("from '../loginWebViewScripts'");
    expect(globalModalHostSource).not.toContain("from '../screens/more/MorePanels'");
    expect(accountControllerSource).not.toContain("from '../screens/more/MorePanels'");
    expect(verificationControllerSource).not.toContain("from '../screens/more/MorePanels'");
    expect(moreScreenSource).not.toContain('MemoizedLinuxDoVerifyModal');
    expect(morePanelsSource).not.toContain('MemoizedLinuxDoVerifyModal');
    expect(morePanelsSource).not.toContain('export function LinuxDoVerifyModal');
    expect(moreScreenSource).not.toContain('NODESEEK_LOGIN_PROBE_SCRIPT');
    expect(moreScreenSource).not.toContain('LINUXDO_WEBVIEW_PROBE_SCRIPT');
    expect(morePanelsSource).not.toContain('export const NODESEEK_LOGIN_PROBE_SCRIPT');
    expect(morePanelsSource).not.toContain('export const LINUXDO_WEBVIEW_PROBE_SCRIPT');
    expect(morePanelsSource).not.toContain('LINUXDO_WEBVIEW_PROBE_SCRIPT');
  });

  it('keeps navigation composition in a focused host', () => {
    const appNavigatorSource = readOptionalProjectFile('src', 'app', 'AppNavigator.tsx');

    expect(appNavigatorSource).toContain('export function AppNavigator');
    expect(appNavigatorSource).toContain('export function MainTabsHost');
    expect(appNavigatorSource).toContain('Tab.Navigator');
    expect(appNavigatorSource).toContain('Stack.Navigator');
    expect(appSource).toContain('<AppNavigator');
    expect(appSource).not.toContain('<Tab.Navigator');
    expect(appSource).not.toContain('<Stack.Navigator');
    expect(appNavigatorSource).not.toContain('activeScreen');
    expect(appSource).not.toContain('activeScreen={screen}');
  });

  it('does not pass raw cookie headers through More screen props', () => {
    expect(moreScreenSource).not.toContain('yaohuoLoginCookieHeader');
    expect(moreScreenSource).not.toContain('linuxDoWebViewCookieHeader');
    expect(morePanelsSource).not.toContain('yaohuoLoginCookieHeader');
    expect(morePanelsSource).not.toContain('headers: yaohuoLoginCookieHeader ? { Cookie: yaohuoLoginCookieHeader } : undefined');
    expect(appSource).not.toContain('yaohuoLoginCookieHeader');
  });

  it('keeps linux.do verification WebView details out of the More tab panel entry', () => {
    const linuxDoEntryBlock = morePanelsSource.match(/export function LinuxDoVerifyPanel\([\s\S]*?\nexport const MemoizedLinuxDoVerifyPanel/)?.[0] || '';

    expect(linuxDoEntryBlock).toContain('MenuButton');
    expect(linuxDoEntryBlock).not.toContain('LoginWebViewModal');
    expect(linuxDoEntryBlock).not.toContain('linuxDoWebViewRef');
    expect(linuxDoEntryBlock).not.toContain('mountLinuxDoWebView');
    expect(linuxDoEntryBlock).not.toContain('onHandleLinuxDoMessage');
    expect(moreScreenSource).not.toContain('linuxDoWebViewRef');
    expect(moreScreenSource).not.toContain('mountLinuxDoWebView');
    expect(globalModalHostSource).toContain('linuxDoWebViewRef');
    expect(globalModalHostSource).toContain('mountLinuxDoWebView');
  });
});
