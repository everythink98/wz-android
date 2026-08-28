import { describe, expect, it } from 'vitest';
import { androidWebViewUserAgentFromReactNativeImport } from './androidWebViewUserAgentValue';

describe('Android WebView user agent', () => {
  it('reads the exact native WebView provider identity', () => {
    const userAgent = 'Mozilla/5.0 (Linux; Android 15; Pixel; wv) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36';

    expect(
      androidWebViewUserAgentFromReactNativeImport({
        NativeModules: { NetworkProxyModule: { defaultWebViewUserAgent: `  ${userAgent}  ` } }
      })
    ).toBe(userAgent);
  });

  it('does not invent a browser identity when the native module is unavailable', () => {
    expect(androidWebViewUserAgentFromReactNativeImport({ NativeModules: {} })).toBe('');
    expect(
      androidWebViewUserAgentFromReactNativeImport({
        default: { NativeModules: { NetworkProxyModule: { defaultWebViewUserAgent: '   ' } } }
      })
    ).toBe('');
  });
});
