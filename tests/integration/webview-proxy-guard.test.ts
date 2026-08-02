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
    const hiddenBrowserHost = readSource('src', 'features', 'account', 'HiddenBrowserHost.tsx');
    const accountHost = readSource('src', 'features', 'account', 'AccountHost.tsx');
    const htmlRenderingController = readSource(
      'src',
      'features',
      'topic',
      'rendering',
      'useHtmlRenderingController.tsx'
    );
    const morePanels = readSource('src', 'features', 'more', 'components', 'MorePanels.tsx');

    expect(appRuntime).toContain('const networkProxyWebViewBlockMessage =');
    expect(appRuntime).toContain('blockedMessage: networkProxyWebViewBlockMessage');
    expect(appRuntime).toContain('webViewBlockMessage: networkProxyWebViewBlockMessage');
    expect(appComposition).toContain('<HiddenBrowserHost {...runtime.hiddenBrowserHost} />');
    expect(appComposition).toContain('<AccountHost {...runtime.accountHost} />');
    expect(hiddenBrowserHost).toContain('blockedMessage');
    expect(hiddenBrowserHost).toContain('!blockedMessage && nodeSeekBrowserFetchRequest');
    expect(hiddenBrowserHost).toContain('!blockedMessage && linuxDoBrowserFetchRequest');
    expect(accountHost).toContain('webViewBlockMessage || nodeImageAuthError');
    expect(htmlRenderingController).toContain('webViewBlockMessage ? (');
    expect(morePanels).toContain('webViewBlockMessage || webViewError');
  });
});
