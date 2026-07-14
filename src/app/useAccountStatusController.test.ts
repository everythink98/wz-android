import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let state = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [state, (next: T | ((current: T) => T)) => {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
    }];
  }
}));

const mocks = vi.hoisted(() => ({
  checkLinuxDoLoginAccess: vi.fn(),
  checkYaohuoLogin: vi.fn(),
  getCurrentUserProfile: vi.fn(),
  getItemAsync: vi.fn(),
  clearLinuxDoAccessForGeneration: vi.fn(),
  currentLinuxDoAccessGeneration: vi.fn(),
  loadLinuxDoAccess: vi.fn()
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: mocks.getItemAsync
}));

vi.mock('../sources/sourceGateway', () => ({
  checkLinuxDoLoginAccess: mocks.checkLinuxDoLoginAccess,
  checkYaohuoLogin: mocks.checkYaohuoLogin,
  getCurrentUserProfile: mocks.getCurrentUserProfile
}));

vi.mock('../nodeseekCookies', () => ({
  parseNodeSeekDocumentCookie: () => ({}),
  summarizeNodeSeekCookies: () => ({ count: 2, loggedIn: true, names: ['session-a', 'session-b'] })
}));

vi.mock('../yaohuoCookies', () => ({
  yaohuoCookieMapFromHeader: () => ({}),
  summarizeYaohuoCookies: () => ({ count: 1, loggedIn: true, names: ['session-c'] })
}));

vi.mock('../linuxdoCookieBridge', () => ({
  clearLinuxDoAccessForGeneration: mocks.clearLinuxDoAccessForGeneration,
  currentLinuxDoAccessGeneration: mocks.currentLinuxDoAccessGeneration,
  linuxDoAccessSummary: (access: { cookieHeader?: string } | null) => ({
    hasClearance: Boolean(access?.cookieHeader),
    loggedIn: Boolean(access?.cookieHeader)
  }),
  loadLinuxDoAccess: mocks.loadLinuxDoAccess,
  parseLinuxDoDocumentCookie: () => ({}),
  summarizeLinuxDoCookies: () => ({ count: 3, loggedIn: true, names: ['session-d'] })
}));

import { setDiagnosticWriter, type DiagnosticEvent } from '../diagnostics';
import { useAccountStatusController } from './useAccountStatusController';

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('account status diagnostics', () => {
  it('links multi-site credential checks, a partial result, and final apply with one parent trace', async () => {
    const nodeSeekSecret = 'NODESEEK_COOKIE_SHOULD_NOT_LEAK';
    const linuxDoSecret = 'LINUXDO_COOKIE_SHOULD_NOT_LEAK';
    const yaohuoSecret = 'YAOHUO_COOKIE_SHOULD_NOT_LEAK';
    const privateUserId = 'private-user-9487';
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });

    mocks.getItemAsync.mockResolvedValue(yaohuoSecret);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: linuxDoSecret,
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: true, loginRequired: false });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: true,
      loginRequired: false,
      currentUser: { id: privateUserId }
    });
    mocks.getCurrentUserProfile.mockImplementation(async ({ source }: { source: string }) => {
      if (source === 'nodeseek') {
        throw new Error('profile lookup failed');
      }
      return { id: privateUserId };
    });

    const dispatchSiteSessionEvent = vi.fn();
    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent,
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async (_source, options) => {
        options?.captureGeneration?.(3);
        options?.captureNodeSeekUserId?.(9487);
        return nodeSeekSecret;
      }),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => nodeSeekSecret)
    });

    await controller.refreshAccountStatus();

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    const parentEvents = events.filter((event) => event.operation === 'refresh');
    expect(parentEvents.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'intent',
      'credential',
      'transport',
      'apply',
      'finish'
    ]));
    expect(new Set(parentEvents.map((event) => event.traceId)).size).toBe(1);
    expect(parentEvents.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ area: 'session', outcome: 'partial', partialErrorCount: 1 })
    ]);
    expect(dispatchSiteSessionEvent).toHaveBeenCalledTimes(3);
    expect(lines.join('')).not.toMatch(new RegExp([
      nodeSeekSecret,
      linuxDoSecret,
      yaohuoSecret,
      privateUserId,
      'session-a',
      'session-b',
      'session-c',
      'session-d'
    ].join('|')));
  });

  it('records a busy refresh separately and gives the active refresh one canceled terminal', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const linuxDoCheck = Promise.withResolvers<{ ok: boolean; loginRequired: boolean }>();
    mocks.getItemAsync.mockResolvedValue(null);
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(2);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'secret',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.checkLinuxDoLoginAccess.mockReturnValue(linuxDoCheck.promise);
    mocks.checkYaohuoLogin.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.getCurrentUserProfile.mockResolvedValue(null);

    const controller = useAccountStatusController({
      clearYaohuoLoginState: vi.fn(async () => undefined),
      currentYaohuoCredentialGeneration: vi.fn(() => 4),
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    const activeRefresh = controller.refreshAccountStatus();
    await vi.waitFor(() => expect(mocks.checkLinuxDoLoginAccess).toHaveBeenCalledTimes(1));
    await controller.refreshAccountStatus();
    controller.abortAccountStatusRequests();
    linuxDoCheck.resolve({ ok: true, loginRequired: false });
    await activeRefresh;

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'session' && event.operation === 'refresh' && event.phase === 'finish');
    expect(terminalEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'blocked', reason: 'busy' }),
      expect.objectContaining({ outcome: 'canceled', reason: 'canceled' })
    ]));
    expect(terminalEvents).toHaveLength(2);
    expect(new Set(terminalEvents.map((event) => event.traceId)).size).toBe(2);
  });

  it('records generation-scoped credential clears without exporting credential data', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    mocks.getItemAsync.mockResolvedValue('YAOHUO_EXPIRED_COOKIE_SECRET');
    mocks.currentLinuxDoAccessGeneration.mockReturnValue(8);
    mocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'LINUXDO_EXPIRED_COOKIE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    mocks.clearLinuxDoAccessForGeneration.mockResolvedValue(null);
    mocks.checkLinuxDoLoginAccess.mockResolvedValue({ ok: false, loginRequired: true });
    mocks.checkYaohuoLogin.mockResolvedValue({
      ok: false,
      loginRequired: true,
      reason: 'expired'
    });
    mocks.getCurrentUserProfile.mockResolvedValue(null);
    const clearYaohuoLoginState = vi.fn(async () => undefined);
    const controller = useAccountStatusController({
      clearYaohuoLoginState,
      currentYaohuoCredentialGeneration: vi.fn(() => 5),
      dispatchSiteSessionEvent: vi.fn(),
      fetcher: vi.fn(),
      linuxDoUserAgentRef: { current: 'safe-agent' },
      loadNodeSeekCookieForSource: vi.fn(async () => undefined),
      nodeSeekUserAgentRef: { current: 'safe-agent' },
      notify: vi.fn(),
      resetLinuxDoLevelState: vi.fn(),
      saveNodeSeekCookieHeader: vi.fn(async () => '')
    });

    await controller.refreshAccountStatus();

    expect(mocks.clearLinuxDoAccessForGeneration).toHaveBeenCalledWith(8, 'LINUXDO_EXPIRED_COOKIE_SECRET');
    expect(clearYaohuoLoginState).toHaveBeenCalledWith({ generation: 5 });
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'linuxdo', generation: 8, state: 'expired' }),
      expect.objectContaining({ phase: 'credential', source: 'yaohuo', generation: 5, state: 'expired' }),
      expect.objectContaining({ phase: 'apply', source: 'linuxdo', generation: 8, hasCredential: false }),
      expect.objectContaining({ phase: 'apply', source: 'yaohuo', generation: 5, hasCredential: false })
    ]));
    expect(lines.join('')).not.toMatch(/LINUXDO_EXPIRED_COOKIE_SECRET|YAOHUO_EXPIRED_COOKIE_SECRET/);
  });
});
