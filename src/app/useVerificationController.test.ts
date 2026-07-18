import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useRef: <T,>(value: T) => ({ current: value })
}));

vi.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: vi.fn((callback: () => void) => {
      callback();
      return { cancel: vi.fn() };
    })
  }
}));

const linuxDoMocks = vi.hoisted(() => ({
  canAcceptLinuxDoAccessUpdate: vi.fn(() => true),
  clearLinuxDoClearance: vi.fn(async () => null),
  loadLinuxDoAccess: vi.fn(),
  readLinuxDoCookiesFromStores: vi.fn(),
  saveLinuxDoAccess: vi.fn()
}));

vi.mock('../linuxdoCookieBridge', () => ({
  buildLinuxDoCookieHeader: () => 'COOKIE_VALUE_SECRET',
  canAcceptLinuxDoAccessUpdate: linuxDoMocks.canAcceptLinuxDoAccessUpdate,
  canStoreLinuxDoAccess: () => true,
  canStoreLinuxDoClearance: () => true,
  clearLinuxDoClearance: linuxDoMocks.clearLinuxDoClearance,
  linuxDoAccessSummary: () => ({ hasClearance: true, loggedIn: true }),
  linuxDoClearanceValue: () => 'CLEARANCE_VALUE_SECRET',
  loadLinuxDoAccess: linuxDoMocks.loadLinuxDoAccess,
  mergeLinuxDoCookies: (...maps: Array<Record<string, unknown>>) => Object.assign({}, ...maps),
  parseLinuxDoDocumentCookie: (header: string) => header ? {
    PRIVATE_COOKIE_NAME: { name: 'PRIVATE_COOKIE_NAME', value: header }
  } : {},
  readLinuxDoCookiesFromStores: linuxDoMocks.readLinuxDoCookiesFromStores,
  saveLinuxDoAccess: linuxDoMocks.saveLinuxDoAccess,
  sanitizeLinuxDoUserAgent: (userAgent: string) => userAgent,
  summarizeLinuxDoCookies: () => ({
    count: 3,
    hasClearance: true,
    loggedIn: true,
    names: ['PRIVATE_COOKIE_NAME']
  })
}));

import { setDiagnosticWriter, type DiagnosticEvent } from '../diagnostics';
import { useVerificationController } from './useVerificationController';

const ref = <T,>(current: T) => ({ current });

function createController() {
  const showLinuxDoPanelRef = ref(false);
  const linuxDoWebViewSessionRef = ref(0);
  const linuxDoWebViewRef = ref({
    injectJavaScript: vi.fn(),
    stopLoading: vi.fn()
  });
  const onLoginWebViewFailure = vi.fn();
  const updateLinuxDoSession = vi.fn();
  const controller = useVerificationController({
    changeNodeSeekLoginPanel: vi.fn(),
    changeScreen: vi.fn(),
    checkingRequestIdRef: ref(0),
    closeYaohuoLoginPanel: vi.fn(),
    linuxDoClearanceBeforeVerifyRef: ref<string | null>(null),
    linuxDoPanelClosingSessionRef: ref<number | null>(null),
    linuxDoPanelCloseSettleTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoRequireFreshClearanceRef: ref(false),
    linuxDoWebViewCookieHeader: '',
    linuxDoWebViewCookieHeaderRef: ref(''),
    linuxDoWebViewMountTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: linuxDoWebViewRef as never,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgent: '',
    linuxDoWebViewUserAgentRef: ref(''),
    notify: vi.fn(),
    onLoginWebViewFailure,
    openTopicRef: ref(null),
    resetLinuxDoLevelState: vi.fn(),
    selectedTopic: null,
    setChecking: vi.fn(),
    setLinuxDoWebViewCookieHeader: vi.fn(),
    setLinuxDoWebViewError: vi.fn(),
    setLinuxDoWebViewKey: vi.fn(),
    setLinuxDoWebViewUserAgent: vi.fn(),
    setLoadingLinuxDoPage: vi.fn(),
    setMountLinuxDoWebView: vi.fn(),
    setShowLinuxDoPanel: vi.fn((value: boolean | ((previous: boolean) => boolean)) => {
      showLinuxDoPanelRef.current = typeof value === 'function' ? value(showLinuxDoPanelRef.current) : value;
    }),
    setShowSettingsPanel: vi.fn(),
    showLinuxDoPanelRef,
    topicDetail: null,
    updateLinuxDoSession,
    updateNodeSeekSession: vi.fn()
  });
  return { controller, linuxDoWebViewSessionRef, onLoginWebViewFailure, showLinuxDoPanelRef, updateLinuxDoSession };
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
  linuxDoMocks.canAcceptLinuxDoAccessUpdate.mockReturnValue(true);
  vi.useRealTimers();
});

describe('linux.do visible verification diagnostics', () => {
  it('keeps the Account manual panel open and records an explicit check as cookie-loaded', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(500);

    expect(linuxDoMocks.saveLinuxDoAccess).not.toHaveBeenCalled();

    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'cookie-loaded',
      hasVerification: true
    }));
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('keeps the panel open and avoids an automatic retry loop when the resumed read still needs verification', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    const resume = vi.fn(async () => 'verification-required' as const);
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef } = createController();

    await controller.showLinuxDoVerification('需要验证', {
      key: 'feed:linuxdo:latest',
      isCurrent: () => true,
      resume
    });
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(500);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(showLinuxDoPanelRef.current).toBe(true);

    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(1000);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(showLinuxDoPanelRef.current).toBe(true);

    const explicitCheck = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(500);
    await explicitCheck;

    expect(resume).toHaveBeenCalledTimes(2);
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('accepts a same-valued clearance after the forced reset and proves success with the resumed read', async () => {
    vi.useFakeTimers();
    linuxDoMocks.canAcceptLinuxDoAccessUpdate.mockReturnValue(false);
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    const resume = vi.fn(async () => 'completed' as const);
    const { controller, linuxDoWebViewSessionRef } = createController();

    await controller.showLinuxDoVerification('需要验证', {
      key: 'feed:linuxdo:same-clearance',
      isCurrent: () => true,
      resume
    });
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.runAllTimersAsync();

    expect(linuxDoMocks.canAcceptLinuxDoAccessUpdate).toHaveBeenCalled();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('closes only after the blocked read has resumed without another verification error', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    const resumed = Promise.withResolvers<'completed'>();
    const resume = vi.fn(() => resumed.promise);
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification('需要验证', {
      key: 'topic:linuxdo:42',
      isCurrent: () => true,
      resume
    });
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(250);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));

    resumed.resolve('completed');
    await vi.runAllTimersAsync();

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('REG-LINUXDO-002 does not reopen a user-dismissed recovery when its failure arrives during closing', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    const recovery = {
      key: 'topic:linuxdo:42:request-1',
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const)
    };
    const { controller, showLinuxDoPanelRef } = createController();

    await controller.showLinuxDoVerification('需要验证', recovery);
    await vi.advanceTimersByTimeAsync(80);
    expect(showLinuxDoPanelRef.current).toBe(true);

    controller.closeLinuxDoPanel();
    await controller.showLinuxDoVerification('迟到的同一失败', recovery);
    await vi.advanceTimersByTimeAsync(400);

    expect(showLinuxDoPanelRef.current).toBe(false);
    expect(linuxDoMocks.clearLinuxDoClearance).toHaveBeenCalledTimes(1);
  });

  it('REG-LINUXDO-002 keeps only the latest new foreground read requested during closing', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    const firstRecovery = {
      key: 'feed:linuxdo:request-1',
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const)
    };
    const queuedRecovery = {
      key: 'search:linuxdo:request-2',
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const)
    };
    const latestRecovery = {
      key: 'user:linuxdo:request-3',
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const)
    };
    const { controller, showLinuxDoPanelRef } = createController();

    await controller.showLinuxDoVerification('第一个请求', firstRecovery);
    await vi.advanceTimersByTimeAsync(80);
    controller.closeLinuxDoPanel();
    await controller.showLinuxDoVerification('排队请求', queuedRecovery);
    await controller.showLinuxDoVerification('最新请求', latestRecovery);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(80);

    expect(linuxDoMocks.clearLinuxDoClearance).toHaveBeenCalledTimes(2);
    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(queuedRecovery.resume).not.toHaveBeenCalled();

    await controller.showLinuxDoVerification('排队请求的迟到失败', queuedRecovery);
    expect(linuxDoMocks.clearLinuxDoClearance).toHaveBeenCalledTimes(2);
  });

  it('REG-LINUXDO-002 never lets an obsolete Cookie check resume a newer recovery', async () => {
    vi.useFakeTimers();
    const oldCookieRead = Promise.withResolvers<Record<string, { name: string; value: string }>>();
    const newerBaselineRead = Promise.withResolvers<Record<string, { name: string; value: string }>>();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores
      .mockResolvedValueOnce({})
      .mockReturnValueOnce(oldCookieRead.promise)
      .mockReturnValueOnce(newerBaselineRead.promise)
      .mockResolvedValue({
        cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
      });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    const oldRecovery = {
      key: 'feed:linuxdo:request-1',
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const)
    };
    const newerRecovery = {
      key: 'topic:linuxdo:request-2',
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const)
    };
    const { controller, linuxDoWebViewSessionRef } = createController();

    await controller.showLinuxDoVerification('旧请求', oldRecovery);
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'old-document',
          cookie: 'OLD_WEBVIEW_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(250);

    const showNewer = controller.showLinuxDoVerification('新请求', newerRecovery);
    oldCookieRead.resolve({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(oldRecovery.resume).not.toHaveBeenCalled();
    expect(newerRecovery.resume).not.toHaveBeenCalled();

    newerBaselineRead.resolve({});
    await showNewer;
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'new-document',
          cookie: 'NEW_WEBVIEW_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.runAllTimersAsync();

    expect(oldRecovery.resume).not.toHaveBeenCalled();
    expect(newerRecovery.resume).toHaveBeenCalledTimes(1);
  });

  it('uses one sanitized parent trace from panel open through cookie save and close', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });

    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef } = createController();

    controller.changeLinuxDoPanel(true);
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET',
          html: '<html>PRIVATE_WEBVIEW_HTML</html>'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    const pending = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(250);
    await pending;
    expect(showLinuxDoPanelRef.current).toBe(true);
    controller.closeLinuxDoPanel();

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    const parentEvents = events.filter((event) => event.area === 'credential' && event.operation === 'check');
    expect(parentEvents.map((event) => event.phase)).toEqual(expect.arrayContaining([
      'intent',
      'guard',
      'transport',
      'parse',
      'credential',
      'persist',
      'finish'
    ]));
    expect(new Set(parentEvents.map((event) => event.traceId)).size).toBe(1);
    expect(parentEvents.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'success' })
    ]);
    expect(linuxDoMocks.readLinuxDoCookiesFromStores).toHaveBeenCalledWith({
      diagnosticTrace: expect.objectContaining({ traceId: parentEvents[0].traceId })
    });
    expect(linuxDoMocks.readLinuxDoCookiesFromStores.mock.calls.every(([options]) => (
      options?.diagnosticTrace?.traceId === parentEvents[0].traceId
    ))).toBe(true);
    expect(lines.join('')).not.toMatch(/COOKIE_VALUE_SECRET|CLEARANCE_VALUE_SECRET|PRIVATE_COOKIE_NAME|WEBVIEW_MESSAGE_COOKIE_SECRET|WEBVIEW_MESSAGE_USER_AGENT_SECRET|PRIVATE_WEBVIEW_HTML/);
  });

  it('finishes an obsolete cookie check as stale when the WebView session is reset', async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const cookieRead = Promise.withResolvers<Record<string, { name: string; value: string }>>();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockReturnValue(cookieRead.promise);
    const { controller } = createController();

    controller.changeLinuxDoPanel(true);
    await vi.advanceTimersByTimeAsync(80);
    const pending = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(250);
    controller.resetLinuxDoWebView();
    cookieRead.resolve({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    await pending;

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check' && event.phase === 'finish');
    expect(terminalEvents).toEqual([
      expect.objectContaining({ outcome: 'stale', reason: 'stale' })
    ]);
  });

  it('records a user close once as canceled', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const { controller } = createController();

    controller.changeLinuxDoPanel(true);
    controller.closeLinuxDoPanel();
    controller.closeLinuxDoPanel();

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check' && event.phase === 'finish');
    expect(terminalEvents).toEqual([
      expect.objectContaining({ outcome: 'canceled', reason: 'canceled' })
    ]);
  });

  it('finishes LinuxDo verification when another verification panel replaces it', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const { controller } = createController();

    controller.changeLinuxDoPanel(true);
    controller.showNodeSeekVerification();

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check' && event.phase === 'finish');
    expect(terminalEvents).toEqual([
      expect.objectContaining({ outcome: 'canceled', reason: 'superseded' })
    ]);
  });

  it('records renderer loss as the terminal WebView failure', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const { controller, linuxDoWebViewSessionRef, onLoginWebViewFailure } = createController();

    controller.changeLinuxDoPanel(true);
    controller.setLinuxDoWebViewErrorForSession(
      'linux.do 验证页面已停止，请刷新页面重试。',
      linuxDoWebViewSessionRef.current,
      9
    );
    controller.setLinuxDoWebViewErrorForSession(
      'linux.do 页面加载失败，请刷新页面重试。',
      linuxDoWebViewSessionRef.current,
      9
    );

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check' && event.phase === 'finish');
    expect(terminalEvents).toEqual([
      expect.objectContaining({ outcome: 'failure', reason: 'renderer_gone' })
    ]);
    expect(new Set(terminalEvents.map((event) => event.traceId)).size).toBe(1);
    expect(onLoginWebViewFailure).toHaveBeenNthCalledWith(1, 'linuxdo', 9, 'renderer_gone');
    expect(onLoginWebViewFailure).toHaveBeenCalledTimes(1);
  });
});
