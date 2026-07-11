import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
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
  loadLinuxDoAccess: vi.fn(),
  readLinuxDoCookiesFromStores: vi.fn(),
  saveLinuxDoAccess: vi.fn()
}));

vi.mock('../linuxdoCookieBridge', () => ({
  buildLinuxDoCookieHeader: () => 'COOKIE_VALUE_SECRET',
  canAcceptLinuxDoAccessUpdate: () => true,
  canStoreLinuxDoAccess: () => true,
  canStoreLinuxDoClearance: () => true,
  clearLinuxDoSavedClearance: vi.fn(async () => null),
  clearLinuxDoWebViewClearance: vi.fn(async () => undefined),
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
  const controller = useVerificationController({
    cancelLinuxDoPendingReopenTask: vi.fn(),
    changeNodeSeekLoginPanel: vi.fn(),
    changeScreen: vi.fn(),
    checkingRequestIdRef: ref(0),
    closeYaohuoLoginPanel: vi.fn(),
    linuxDoClearanceBeforeVerifyRef: ref<string | null>(null),
    linuxDoDismissedVerificationTopicKeyRef: ref<string | null>(null),
    linuxDoPanelClosingSessionRef: ref<number | null>(null),
    linuxDoPanelCloseSettleTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoPendingReopenTaskRef: ref(null),
    linuxDoPendingReopenTopicAfterCloseRef: ref(null),
    linuxDoPendingTopicVerifiedRef: ref(false),
    linuxDoRequireFreshClearanceRef: ref(false),
    linuxDoVerifiedRetryTopicKeyRef: ref<string | null>(null),
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
    pendingLinuxDoTopicRef: ref(null),
    reopenExistingTopicScreenRef: ref(false),
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
    showLinuxDoPanel: false,
    showLinuxDoPanelRef,
    topicDetail: null,
    updateLinuxDoSession: vi.fn(),
    updateNodeSeekSession: vi.fn()
  });
  return { controller, linuxDoWebViewSessionRef, onLoginWebViewFailure };
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('linux.do visible verification diagnostics', () => {
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

    const { controller, linuxDoWebViewSessionRef } = createController();

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
