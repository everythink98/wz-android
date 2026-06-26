import { describe, expect, it } from 'vitest';
import { NODESEEK_LOGIN_PROBE_SCRIPT } from './loginWebViewScripts';

function runNodeSeekProbe(body: string) {
  const messages: string[] = [];
  const document = { body: { innerText: body }, cookie: 'cf_clearance=clear' };
  const window = { ReactNativeWebView: { postMessage: (message: string) => messages.push(message) } };
  const navigator = { userAgent: 'NodeSeek Test UA' };
  const run = new Function('document', 'window', 'navigator', NODESEEK_LOGIN_PROBE_SCRIPT);
  run(document, window, navigator);
  return JSON.parse(messages[0] || '{}') as { blank?: boolean; loggedIn?: boolean; userId?: number | null };
}

describe('login WebView scripts', () => {
  it('does not treat a blank NodeSeek page as logged in', () => {
    expect(runNodeSeekProbe('')).toMatchObject({
      blank: true,
      loggedIn: false,
      userId: null
    });
  });

  it('detects ordinary NodeSeek login pages as logged out', () => {
    expect(runNodeSeekProbe('登录 注册')).toMatchObject({
      blank: false,
      loggedIn: false,
      userId: null
    });
  });

  it('detects a NodeSeek UID as logged in', () => {
    expect(runNodeSeekProbe('UID: 12345')).toMatchObject({
      blank: false,
      loggedIn: true,
      userId: 12345
    });
  });
});
