import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '../..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('WebView proxy guard', () => {
  it('routes every WebView through the shared proxy transition guard', () => {
    const appComposition = readSource('src', 'app', 'AppComposition.tsx');
    const appRuntime = readSource('src', 'app', 'useAppRuntime.tsx');
    const accountRuntime = readSource('src', 'features', 'account', 'useAccountRuntime.ts');
    const networkRuntime = readSource('src', 'platform', 'network', 'useNetworkProxyRuntime.ts');
    const hiddenBrowserHost = readSource('src', 'features', 'account', 'HiddenBrowserHost.tsx');
    const accountHost = readSource('src', 'features', 'account', 'AccountHost.tsx');
    const accountHosts = readSource('src', 'features', 'account', 'AccountHosts.tsx');
    const contentMediaRenderers = readSource('src', 'features', 'topic', 'rendering', 'contentMediaRenderers.tsx');
    const yaohuoLoginHost = readSource('src', 'features', 'account', 'components', 'YaohuoLoginHost.tsx');

    expect(networkRuntime).toContain('const webViewBlockMessage = networkProxyWebViewBlockMessage({');
    expect(appRuntime).toContain('webViewBlockMessage: networkProxyWebViewBlockMessage');
    expect(accountRuntime).toContain('blockedMessage: webViewBlockMessage');
    expect(appComposition).toContain('{runtime.accountHost}');
    expect(accountHosts).toContain('<HiddenBrowserHost');
    expect(accountHosts).toContain('<AccountHost');
    expect(accountHosts).toContain('<NodeSeekLoginHost');
    expect(accountHosts).toContain('<YaohuoLoginHost');
    expect(hiddenBrowserHost).toContain('blockedMessage');
    expect(hiddenBrowserHost).toContain('!blockedMessage && nodeSeekBrowserFetchRequest');
    expect(hiddenBrowserHost).toContain('!blockedMessage && linuxDoBrowserFetchRequest');
    expect(accountHost).toContain('webViewBlockMessage || nodeImageAuthError');
    expect(contentMediaRenderers).toContain('webViewBlockMessage ? (');
    expect(yaohuoLoginHost).toContain('webViewBlockMessage || error');
  });
});
