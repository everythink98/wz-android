import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = path.resolve(__dirname, '..');

function readSource(...parts: string[]) {
  return readFileSync(path.join(rootDir, ...parts), 'utf8');
}

describe('WebView proxy guard', () => {
  it('blocks WebViews while an enabled proxy is not applied', () => {
    const appRoot = readSource('src', 'app', 'AppRoot.tsx');
    const hiddenBrowserHost = readSource('src', 'app', 'HiddenBrowserHost.tsx');
    const globalModalHost = readSource('src', 'app', 'GlobalModalHost.tsx');
    const htmlRenderingController = readSource('src', 'app', 'useHtmlRenderingController.tsx');
    const morePanels = readSource('src', 'screens', 'more', 'MorePanels.tsx');

    expect(appRoot).toContain('const networkProxyWebViewBlockMessage =');
    expect(appRoot).toContain('blockedMessage={networkProxyWebViewBlockMessage}');
    expect(appRoot).toContain('webViewBlockMessage={networkProxyWebViewBlockMessage}');
    expect(appRoot).toContain('webViewBlockMessage: networkProxyWebViewBlockMessage');
    expect(hiddenBrowserHost).toContain('blockedMessage');
    expect(hiddenBrowserHost).toContain('!blockedMessage && nodeSeekBrowserFetchRequest');
    expect(hiddenBrowserHost).toContain('!blockedMessage && linuxDoBrowserFetchRequest');
    expect(globalModalHost).toContain('webViewBlockMessage || nodeImageAuthError');
    expect(htmlRenderingController).toContain('webViewBlockMessage ? (');
    expect(morePanels).toContain('webViewBlockMessage || webViewError');
  });
});
