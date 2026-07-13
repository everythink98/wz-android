import { describe, expect, it } from 'vitest';
import { createWebViewMessageSession, parseTrustedWebViewMessage } from './webViewMessageGuard';

const guard = {
  allowedTypes: ['nodeseek-login'] as const,
  trustedOrigins: ['https://www.nodeseek.com'],
  sessionId: 'login-panel-7',
  nonce: 'b5b1a44c604a4ba0aa9d508e982f18b5'
};

function event(payload: unknown, url = 'https://www.nodeseek.com/signIn.html?from=app') {
  return {
    data: typeof payload === 'string' ? payload : JSON.stringify(payload),
    url
  };
}

describe('trusted WebView message guard', () => {
  it('creates isolated high-entropy sessions for each visible WebView lifetime', () => {
    const first = createWebViewMessageSession('nodeseek-login');
    const second = createWebViewMessageSession('nodeseek-login');

    expect(first.sessionId).toMatch(/^nodeseek-login-/);
    expect(first.nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(second).not.toEqual(first);
  });

  it('accepts a schema-valid message only from the exact trusted origin and session', () => {
    const payload = {
      type: 'nodeseek-login',
      sessionId: guard.sessionId,
      nonce: guard.nonce,
      loggedIn: true,
      userId: 7
    };

    expect(parseTrustedWebViewMessage(event(payload), guard)).toEqual(payload);
  });

  it.each([
    ['invalid JSON', event('{broken')],
    ['array payload', event([])],
    ['wrong type', event({ type: 'linuxdo-login', sessionId: guard.sessionId, nonce: guard.nonce })],
    ['missing nonce', event({ type: 'nodeseek-login', sessionId: guard.sessionId })],
    ['wrong nonce', event({ type: 'nodeseek-login', sessionId: guard.sessionId, nonce: `${guard.nonce}x` })],
    ['wrong session', event({ type: 'nodeseek-login', sessionId: 'login-panel-8', nonce: guard.nonce })],
    ['missing source URL', event({ type: 'nodeseek-login', sessionId: guard.sessionId, nonce: guard.nonce }, '')],
    ['downgraded scheme', event({ type: 'nodeseek-login', sessionId: guard.sessionId, nonce: guard.nonce }, 'http://www.nodeseek.com/')],
    ['lookalike host', event({ type: 'nodeseek-login', sessionId: guard.sessionId, nonce: guard.nonce }, 'https://www.nodeseek.com.evil.test/')],
    ['sibling origin', event({ type: 'nodeseek-login', sessionId: guard.sessionId, nonce: guard.nonce }, 'https://nodeseek.com/')]
  ])('rejects %s', (_label, nativeEvent) => {
    expect(parseTrustedWebViewMessage(nativeEvent, guard)).toBeNull();
  });

  it('rejects an invalid guard configuration instead of silently weakening origin or nonce checks', () => {
    expect(() => parseTrustedWebViewMessage(event({}), {
      ...guard,
      trustedOrigins: ['not-a-url']
    })).toThrow(/trusted origin/i);
    expect(() => parseTrustedWebViewMessage(event({}), {
      ...guard,
      nonce: 'short'
    })).toThrow(/nonce/i);
  });
});
