import { afterEach, describe, expect, it, vi } from 'vitest';

const effectCleanups = vi.hoisted(() => [] as (() => void)[]);

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect();
    if (cleanup) effectCleanups.push(cleanup);
  },
  useLayoutEffect: (effect: () => void) => effect(),
  useRef: <T>(value: T) => ({ current: value })
}));

vi.mock('react-native', () => ({
  InteractionManager: {
    runAfterInteractions: vi.fn((callback: () => void) => {
      callback();
      return { cancel: vi.fn() };
    })
  }
}));

const serverStateMocks = vi.hoisted(() => ({
  recoveryActive: vi.fn(() => true)
}));

vi.mock('@/platform/query/serverState', () => ({
  appQueryClient: {
    cancelQueries: vi.fn(async () => undefined),
    getQueryCache: () => ({
      find: () => ({ isActive: serverStateMocks.recoveryActive })
    })
  }
}));

import type { SiteSessionEvent, SiteSessionState } from '@/domain/session/siteSessionState';
import type { AccountReconcileResult, LinuxDoReadingRecovery } from '@/domain/session/sessionContracts';
import { useVerificationController } from './useVerificationController';

const ref = <T>(current: T) => ({ current });
const recoveryQueryKeyFor = (id: string) => ['forum', 'linuxdo', 'test-recovery', { id }] as const;
const loggedInSession: SiteSessionState = {
  site: 'linuxdo',
  status: 'logged-in',
  cookieSummary: ['_forum_session'],
  isVerifying: false,
  currentUser: {
    source: 'linuxdo',
    id: '42',
    username: 'alice',
    displayName: 'Alice',
    url: 'https://linux.do/u/alice',
    topics: []
  },
  lastVerifiedAt: '2026-07-24T00:00:00.000Z'
};
const anonymousSession: SiteSessionState = {
  site: 'linuxdo',
  status: 'anonymous',
  cookieSummary: [],
  isVerifying: false
};

function createController(
  options: {
    onBeforeLinuxDoSurfaceOpened?: () => void;
    prepareLinuxDoCookieResponseBarrier?: () => Promise<void>;
    reconcileAccountStatus?: (source: 'linuxdo') => Promise<AccountReconcileResult>;
    awaitLinuxDoCookieHandoff?: () => Promise<void>;
    awaitLinuxDoWebViewUnmount?: () => Promise<void>;
    canOpenLinuxDoPanel?: () => boolean;
    getRecoveryScope?: () => string;
  } = {}
) {
  const showLinuxDoPanelRef = ref(false);
  const linuxDoWebViewSessionRef = ref(0);
  const linuxDoWebViewUserAgentRef = ref('');
  const linuxDoWebViewRef = ref({
    stopLoading: vi.fn()
  });
  const onLoginWebViewFailure = vi.fn();
  const onLinuxDoSurfaceClosed = vi.fn(() => {
    showLinuxDoPanelRef.current = false;
  });
  const onLinuxDoSurfaceOpened = vi.fn(() => {
    showLinuxDoPanelRef.current = true;
  });
  const notify = vi.fn();
  const reconcileAccountStatus = vi.fn(
    options.reconcileAccountStatus || (async () => ({ status: 'same', session: loggedInSession }) as const)
  );
  const setLinuxDoWebViewError = vi.fn();
  const setMountLinuxDoWebView = vi.fn();
  const onRecoveryStateChanged = vi.fn();
  const setLinuxDoWebViewUserAgent = vi.fn();
  const commitLinuxDoWebViewUserAgent = vi.fn((userAgent: string) => {
    linuxDoWebViewUserAgentRef.current = userAgent;
    setLinuxDoWebViewUserAgent(userAgent);
  });
  const updateLinuxDoSession = vi.fn<(event: SiteSessionEvent) => void>();
  const controller = useVerificationController({
    awaitLinuxDoCookieHandoff: options.awaitLinuxDoCookieHandoff,
    awaitLinuxDoWebViewUnmount: options.awaitLinuxDoWebViewUnmount,
    canOpenLinuxDoPanel: options.canOpenLinuxDoPanel,
    getRecoveryScope: options.getRecoveryScope,
    onRecoveryStateChanged,
    changeNodeSeekLoginPanel: vi.fn(),
    checkingRequestIdRef: ref(0),
    closeYaohuoLoginPanel: vi.fn(),
    commitLinuxDoWebViewUserAgent,
    linuxDoPanelClosingSessionRef: ref<number | null>(null),
    linuxDoPanelCloseSettleTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewMountTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: linuxDoWebViewRef as never,
    linuxDoWebViewSessionRef,
    isLinuxDoSurfaceVisible: () => showLinuxDoPanelRef.current,
    notify,
    onBeforeLinuxDoSurfaceOpened: options.onBeforeLinuxDoSurfaceOpened,
    prepareLinuxDoCookieResponseBarrier: options.prepareLinuxDoCookieResponseBarrier,
    onLoginWebViewFailure,
    onLinuxDoSurfaceClosed,
    onLinuxDoSurfaceOpened,
    reconcileAccountStatus,
    setChecking: vi.fn(),
    setLinuxDoWebViewError,
    setLinuxDoWebViewKey: vi.fn(),
    setLoadingLinuxDoPage: vi.fn(),
    setMountLinuxDoWebView,
    updateLinuxDoSession,
    updateNodeSeekSession: vi.fn()
  });
  const handleLinuxDoMessage = controller.handleLinuxDoMessage;
  controller.handleLinuxDoMessage = (event, webViewKey) =>
    handleLinuxDoMessage(
      {
        ...event,
        nativeEvent: {
          ...event.nativeEvent,
          url: event.nativeEvent.url || 'https://linux.do/latest'
        }
      },
      webViewKey
    );
  return {
    onRecoveryStateChanged,
    controller,
    setMountLinuxDoWebView,
    commitLinuxDoWebViewUserAgent,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgentRef,
    notify,
    onLoginWebViewFailure,
    onLinuxDoSurfaceClosed,
    onLinuxDoSurfaceOpened,
    reconcileAccountStatus,
    setLinuxDoWebViewError,
    setLinuxDoWebViewUserAgent,
    showLinuxDoPanelRef,
    updateLinuxDoSession
  };
}

afterEach(() => {
  effectCleanups.splice(0).forEach((cleanup) => cleanup());
  vi.clearAllMocks();
  serverStateMocks.recoveryActive.mockReset().mockReturnValue(true);
  vi.useRealTimers();
});

describe('linux.do visible verification coordinator', () => {
  it('attaches reading to an existing verification without resetting its WebView', async () => {
    const { controller, linuxDoWebViewSessionRef, reconcileAccountStatus } = createController();
    const resumePage = vi.fn(async () => 'completed' as const);
    await controller.showLinuxDoVerification('页面验证', { queryKey: ['page'], resume: resumePage });
    const generation = linuxDoWebViewSessionRef.current;
    const recovery: LinuxDoReadingRecovery = {
      kind: 'reading',
      batchId: 1,
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const),
      cancel: vi.fn()
    };
    await controller.showLinuxDoVerification('阅读验证', recovery);
    await controller.showLinuxDoVerification('阅读验证', recovery);
    expect(linuxDoWebViewSessionRef.current).toBe(generation);
    await controller.checkLinuxDoCookie();
    expect(resumePage).toHaveBeenCalledTimes(1);
    expect(recovery.resume).toHaveBeenCalledTimes(1);
    expect(reconcileAccountStatus).not.toHaveBeenCalled();
  });

  it('uses reading ownership without an active query and cancels it when dismissed', async () => {
    serverStateMocks.recoveryActive.mockReturnValue(false);
    const { controller } = createController();
    const recovery: LinuxDoReadingRecovery = {
      kind: 'reading',
      batchId: 1,
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const),
      cancel: vi.fn()
    };
    expect(await controller.showLinuxDoVerification('阅读验证', recovery)).toBe(true);
    controller.closeLinuxDoPanel();
    expect(recovery.cancel).toHaveBeenCalledTimes(1);
    await controller.checkLinuxDoCookie();
    expect(recovery.resume).not.toHaveBeenCalled();
  });

  it('waits for native cookie writes to settle before mounting the login page', async () => {
    vi.useFakeTimers();
    let settle!: () => void;
    const barrier = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const { controller, setMountLinuxDoWebView } = createController({
      prepareLinuxDoCookieResponseBarrier: () => barrier
    });
    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(100);
    expect(setMountLinuxDoWebView).not.toHaveBeenCalledWith(true);
    settle();
    await vi.advanceTimersByTimeAsync(100);
    expect(setMountLinuxDoWebView).toHaveBeenCalledWith(true);
  });

  it('keeps a failed cookie handoff unmounted and allows refresh to retry', async () => {
    vi.useFakeTimers();
    const prepare = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined);
    const { controller, setMountLinuxDoWebView, setLinuxDoWebViewError } = createController({
      prepareLinuxDoCookieResponseBarrier: prepare
    });
    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(100);
    expect(setMountLinuxDoWebView).not.toHaveBeenCalledWith(true);
    expect(setLinuxDoWebViewError).toHaveBeenCalledWith(expect.stringContaining('重试'));
    controller.resetLinuxDoWebView();
    await vi.advanceTimersByTimeAsync(100);
    expect(setMountLinuxDoWebView).toHaveBeenCalledWith(true);
  });
  it('opens the surface without probing identity or accepting page cookies', async () => {
    const {
      controller,
      commitLinuxDoWebViewUserAgent,
      onLinuxDoSurfaceOpened,
      reconcileAccountStatus,
      showLinuxDoPanelRef
    } = createController();

    await expect(controller.showLinuxDoVerification()).resolves.toBe(true);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'PAGE_COOKIE_MUST_BE_IGNORED',
          userAgent: '  trusted-agent  '
        }),
        url: 'https://linux.do/latest'
      }
    } as never);

    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(onLinuxDoSurfaceOpened).toHaveBeenCalledTimes(1);
    expect(onLinuxDoSurfaceOpened).toHaveBeenCalledWith({ accountBarrier: true });
    expect(commitLinuxDoWebViewUserAgent).toHaveBeenCalledWith('trusted-agent');
    expect(reconcileAccountStatus).not.toHaveBeenCalled();
  });

  it('ignores WebView messages from third-party frames', async () => {
    const { controller, linuxDoWebViewUserAgentRef, setLinuxDoWebViewUserAgent } = createController();
    await controller.showLinuxDoVerification();

    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          userAgent: 'forged-agent'
        }),
        url: 'https://evil.example/frame'
      }
    } as never);

    expect(linuxDoWebViewUserAgentRef.current).toBe('');
    expect(setLinuxDoWebViewUserAgent).not.toHaveBeenCalled();
  });

  it('uses the canonical Account verifier as the only manual identity proof and authoritatively closes', async () => {
    const { controller, notify, reconcileAccountStatus, showLinuxDoPanelRef, updateLinuxDoSession } =
      createController();
    await controller.showLinuxDoVerification();

    await controller.checkLinuxDoCookie();

    expect(reconcileAccountStatus).toHaveBeenCalledOnce();
    expect(reconcileAccountStatus).toHaveBeenCalledWith('linuxdo');
    expect(updateLinuxDoSession).toHaveBeenCalledTimes(1);
    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-started' }));
    expect(notify).toHaveBeenCalledWith('linux.do 登录身份已确认。');
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('reports confirmed anonymous without clearing cookies or synthesizing login expiry', async () => {
    const { controller, setLinuxDoWebViewError, showLinuxDoPanelRef, updateLinuxDoSession } = createController({
      reconcileAccountStatus: async () => ({
        status: 'anonymous',
        session: anonymousSession
      })
    });
    await controller.showLinuxDoVerification();

    await controller.checkLinuxDoCookie();

    expect(setLinuxDoWebViewError).toHaveBeenCalledWith('linux.do 当前为未登录状态，请登录后再检测。');
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringMatching(/^(?:cleared|login-expired|session-updated)$/)
      })
    );
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('keeps unknown identity read-only and leaves the panel open for retry', async () => {
    const { controller, setLinuxDoWebViewError, showLinuxDoPanelRef, updateLinuxDoSession } = createController({
      reconcileAccountStatus: async () => ({
        status: 'unknown',
        error: 'network unavailable',
        errorInfo: { kind: 'ordinary', message: 'network unavailable' }
      })
    });
    await controller.showLinuxDoVerification();

    await controller.checkLinuxDoCookie();

    expect(setLinuxDoWebViewError).toHaveBeenCalledWith('linux.do 登录状态暂时无法确认：network unavailable');
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringMatching(/^(?:cleared|login-expired|session-updated)$/)
      })
    );
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('keeps an exact CF read recovery outside the account identity lifecycle', async () => {
    const resume = vi.fn(async () => 'completed' as const);
    const {
      controller,
      onLinuxDoSurfaceClosed,
      onLinuxDoSurfaceOpened,
      reconcileAccountStatus,
      showLinuxDoPanelRef,
      updateLinuxDoSession
    } = createController();
    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('level'),
      resume
    });

    expect(onLinuxDoSurfaceOpened).toHaveBeenCalledWith({ accountBarrier: false });
    await controller.checkLinuxDoCookie();

    expect(reconcileAccountStatus).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(onLinuxDoSurfaceClosed.mock.invocationCallOrder[0]).toBeLessThan(resume.mock.invocationCallOrder[0]);
    expect(updateLinuxDoSession).not.toHaveBeenCalled();
    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledWith({
      authoritativeResult: true,
      reason: 'authoritative-recovery'
    });
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('never resumes a recovery merely because a WebView document posted a message', async () => {
    const resume = vi.fn(async () => 'completed' as const);
    const { controller, reconcileAccountStatus } = createController();
    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('topic'),
      resume
    });

    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          status: 'logged-in',
          cookie: 'PAGE_COOKIE_MUST_BE_IGNORED'
        }),
        url: 'https://linux.do/latest'
      }
    } as never);
    await Promise.resolve();

    expect(reconcileAccountStatus).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('keeps a recovery open for another explicit check when verification is still required', async () => {
    vi.useFakeTimers();
    const resume = vi.fn(async () => 'verification-required' as const);
    const { controller, showLinuxDoPanelRef, updateLinuxDoSession, onRecoveryStateChanged } = createController();
    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('feed'),
      resume
    });

    try {
      await controller.checkLinuxDoCookie();
      expect(showLinuxDoPanelRef.current).toBe(false);
      await vi.advanceTimersByTimeAsync(350);
      expect(showLinuxDoPanelRef.current).toBe(false);
      expect(onRecoveryStateChanged).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'result' }));
      await controller.checkLinuxDoCookie();
      expect(resume).toHaveBeenCalledTimes(1);
      controller.retryLinuxDoRecovery();
      expect(showLinuxDoPanelRef.current).toBe(true);
      await controller.checkLinuxDoCookie();
      expect(showLinuxDoPanelRef.current).toBe(false);
      await vi.advanceTimersByTimeAsync(350);
    } finally {
      vi.useRealTimers();
    }

    expect(resume).toHaveBeenCalledTimes(2);
    expect(updateLinuxDoSession).not.toHaveBeenCalled();
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('reports a CF recovery exception without mutating account state', async () => {
    const resume = vi.fn(async () => {
      throw new Error('resume exploded');
    });
    const { controller, onRecoveryStateChanged, onLinuxDoSurfaceClosed, updateLinuxDoSession } = createController();
    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('throwing'),
      resume
    });

    await controller.checkLinuxDoCookie();

    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledWith({
      authoritativeResult: true,
      reason: 'authoritative-recovery'
    });
    expect(onRecoveryStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'result',
        results: [{ kind: 'page', outcome: 'failed', error: 'resume exploded' }]
      })
    );
    expect(updateLinuxDoSession).not.toHaveBeenCalled();
  });

  it('does not resume an inactive recovery query', async () => {
    serverStateMocks.recoveryActive.mockReturnValue(false);
    const resume = vi.fn(async () => 'completed' as const);
    const { controller, showLinuxDoPanelRef } = createController();

    await expect(
      controller.showLinuxDoVerification('迟到的恢复', {
        queryKey: recoveryQueryKeyFor('stale'),
        resume
      })
    ).resolves.toBe(false);

    expect(resume).not.toHaveBeenCalled();
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('allows a pending login page mount to finish while the App is inactive', async () => {
    vi.useFakeTimers();
    const { controller, onLinuxDoSurfaceClosed, showLinuxDoPanelRef, setMountLinuxDoWebView } = createController();
    await controller.showLinuxDoVerification();

    controller.cancelLinuxDoCheckForInactiveApp();
    await vi.advanceTimersByTimeAsync(100);

    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(onLinuxDoSurfaceClosed).not.toHaveBeenCalled();
    expect(setMountLinuxDoWebView).toHaveBeenLastCalledWith(true);
  });

  it('ignores a late login check after backgrounding and permits a fresh check', async () => {
    let complete!: (result: AccountReconcileResult) => void;
    const pending = new Promise<AccountReconcileResult>((resolve) => {
      complete = resolve;
    });
    const { controller, onLinuxDoSurfaceClosed, linuxDoWebViewSessionRef } = createController({
      reconcileAccountStatus: () => pending
    });
    await controller.showLinuxDoVerification();
    const session = linuxDoWebViewSessionRef.current;
    const check = controller.checkLinuxDoCookie();
    controller.cancelLinuxDoCheckForInactiveApp();
    complete({ status: 'same', session: loggedInSession });
    await check;
    expect(onLinuxDoSurfaceClosed).not.toHaveBeenCalled();
    expect(linuxDoWebViewSessionRef.current).toBe(session);
    await controller.checkLinuxDoCookie();
    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledTimes(1);
  });

  it('closes a visible surface once and makes hidden repeated closes no-op', async () => {
    const { controller, onLinuxDoSurfaceClosed, showLinuxDoPanelRef } = createController();
    await controller.showLinuxDoVerification();

    controller.closeLinuxDoPanel();
    controller.closeLinuxDoPanel();

    expect(showLinuxDoPanelRef.current).toBe(false);
    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledTimes(1);
    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledWith({
      authoritativeResult: false,
      reason: 'close-button'
    });
  });

  it.each(['close', 'replace', 'unmount'] as const)('cancels queued reading ownership on %s', async (action) => {
    vi.useFakeTimers();
    const { controller, showLinuxDoPanelRef } = createController();
    await controller.showLinuxDoVerification();
    controller.closeLinuxDoPanel();
    const reading: LinuxDoReadingRecovery = {
      kind: 'reading',
      batchId: 1,
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const),
      cancel: vi.fn()
    };
    const queued = controller.showLinuxDoVerification('阅读验证', reading);
    const replacement = {
      queryKey: recoveryQueryKeyFor('replacement'),
      resume: vi.fn(async () => 'completed' as const)
    };
    let next: Promise<boolean> | undefined;
    if (action === 'close') controller.closeLinuxDoPanel(true, 'navigation-away');
    else if (action === 'replace') next = controller.showLinuxDoVerification('页面验证', replacement);
    else effectCleanups.splice(0).forEach((cleanup) => cleanup());

    await expect(queued).resolves.toBe(false);
    expect(reading.cancel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(reading.resume).not.toHaveBeenCalled();
    if (next) {
      await expect(next).resolves.toBe(true);
      await controller.checkLinuxDoCookie();
      expect(replacement.resume).toHaveBeenCalledTimes(1);
    } else if (action === 'close') {
      expect(showLinuxDoPanelRef.current).toBe(false);
    }
  });

  it('keeps only the latest foreground recovery queued while the panel is closing', async () => {
    vi.useFakeTimers();
    const first = {
      queryKey: recoveryQueryKeyFor('first'),
      resume: vi.fn(async () => 'completed' as const)
    };
    const queued = {
      queryKey: recoveryQueryKeyFor('queued'),
      resume: vi.fn(async () => 'completed' as const)
    };
    const latest = {
      queryKey: recoveryQueryKeyFor('latest'),
      resume: vi.fn(async () => 'completed' as const)
    };
    const { controller, showLinuxDoPanelRef } = createController();
    await controller.showLinuxDoVerification('first', first);
    controller.closeLinuxDoPanel();

    const queuedResult = controller.showLinuxDoVerification('queued', queued);
    const latestResult = controller.showLinuxDoVerification('latest', latest);
    await vi.advanceTimersByTimeAsync(400);

    await expect(queuedResult).resolves.toBe(false);
    await expect(latestResult).resolves.toBe(true);
    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(queued.resume).not.toHaveBeenCalled();
  });

  it('invalidates a late Account result when the visible WebView session is reset', async () => {
    const deferred = Promise.withResolvers<AccountReconcileResult>();
    const { controller, notify, updateLinuxDoSession } = createController({
      reconcileAccountStatus: () => deferred.promise
    });
    await controller.showLinuxDoVerification();

    const check = controller.checkLinuxDoCookie();
    controller.resetLinuxDoWebView();
    deferred.resolve({ status: 'same', session: loggedInSession });
    await check;

    expect(notify).not.toHaveBeenCalledWith('linux.do 登录身份已确认。');
    expect(updateLinuxDoSession).toHaveBeenCalledTimes(1);
    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-started' }));
  });

  it('closes as superseded when another site verification replaces it', async () => {
    const { controller, linuxDoWebViewRef, onLinuxDoSurfaceClosed, showLinuxDoPanelRef } = createController();
    await controller.showLinuxDoVerification();

    controller.showNodeSeekVerification();

    expect(showLinuxDoPanelRef.current).toBe(false);
    expect(linuxDoWebViewRef.current.stopLoading).toHaveBeenCalled();
    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledWith({
      authoritativeResult: false,
      reason: 'switch-surface'
    });
  });

  it('closes other surfaces before linux.do becomes logically visible', () => {
    const events: string[] = [];
    const { controller, onLinuxDoSurfaceOpened } = createController({
      onBeforeLinuxDoSurfaceOpened: () => {
        events.push('close-other-surfaces');
      }
    });
    onLinuxDoSurfaceOpened.mockImplementation(() => {
      events.push('open-linuxdo');
    });

    expect(controller.changeLinuxDoPanel(true)).toBe(true);

    expect(events).toEqual(['close-other-surfaces', 'open-linuxdo']);
  });

  it('reports renderer loss once for the current WebView session', async () => {
    const { controller, linuxDoWebViewSessionRef, onLoginWebViewFailure } = createController();
    await controller.showLinuxDoVerification();

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

    expect(onLoginWebViewFailure).toHaveBeenCalledTimes(1);
    expect(onLoginWebViewFailure).toHaveBeenCalledWith('linuxdo', 9, 'renderer_gone');
  });
});

describe('reading recovery ownership', () => {
  it('resumes reading attached to a manually opened verification panel', async () => {
    const { controller, showLinuxDoPanelRef } = createController();
    await controller.showLinuxDoVerification();
    const reading: LinuxDoReadingRecovery = {
      kind: 'reading',
      batchId: 8001,
      isCurrent: () => true,
      resume: vi.fn(async () => 'completed' as const),
      cancel: vi.fn()
    };
    await controller.showLinuxDoVerification('reading', reading);
    await controller.checkLinuxDoCookie();
    expect(showLinuxDoPanelRef.current).toBe(false);
    expect(reading.resume).toHaveBeenCalledTimes(1);
  });
  it.each(['before-check', 'during-resume'] as const)(
    'resumes valid reading when its attached page query becomes inactive %s',
    async (phase) => {
      const { controller } = createController();
      await controller.showLinuxDoVerification('page', {
        queryKey: ['page'],
        resume: vi.fn(async () => 'stale' as const)
      });
      const reading: LinuxDoReadingRecovery = {
        kind: 'reading',
        batchId: 8002,
        isCurrent: () => true,
        resume: vi.fn(async () => 'completed' as const),
        cancel: vi.fn()
      };
      await controller.showLinuxDoVerification('reading', reading);
      if (phase === 'before-check') serverStateMocks.recoveryActive.mockReturnValue(false);
      await controller.checkLinuxDoCookie();
      expect(reading.resume).toHaveBeenCalledTimes(1);
    }
  );
});

describe('bounded recovery sessions', () => {
  it.each([
    ['completed', 'verification-required'],
    ['verification-required', 'completed'],
    ['completed', 'failed'],
    ['failed', 'completed']
  ] as const)('settles page %s and reading %s independently', async (pageOutcome, readingOutcome) => {
    const page = { queryKey: ['partial'], resume: vi.fn(async () => pageOutcome) };
    const reading: LinuxDoReadingRecovery = {
      kind: 'reading',
      batchId: 8,
      isCurrent: () => true,
      cancel: vi.fn(),
      resume: vi.fn(async () => readingOutcome)
    };
    const { controller, onRecoveryStateChanged, onLinuxDoSurfaceOpened } = createController();
    await controller.showLinuxDoVerification('page', page);
    await controller.showLinuxDoVerification('reading', reading);
    await controller.checkLinuxDoCookie();
    expect(onRecoveryStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'result',
        results: [
          { kind: 'page', outcome: pageOutcome, error: undefined },
          { kind: 'reading', outcome: readingOutcome, error: undefined }
        ]
      })
    );
    await controller.showLinuxDoVerification('duplicate page', { ...page });
    await controller.showLinuxDoVerification('duplicate reading', { ...reading });
    await controller.checkLinuxDoCookie();
    expect(onLinuxDoSurfaceOpened).toHaveBeenCalledTimes(1);
    expect(page.resume).toHaveBeenCalledTimes(1);
    expect(reading.resume).toHaveBeenCalledTimes(1);
    controller.retryLinuxDoRecovery();
    await controller.checkLinuxDoCookie();
    expect(page.resume).toHaveBeenCalledTimes(pageOutcome === 'verification-required' ? 2 : 1);
    expect(reading.resume).toHaveBeenCalledTimes(readingOutcome === 'verification-required' ? 2 : 1);
    controller.closeLinuxDoPanel();
  });

  it.each(['unmount', 'handoff', 'request'] as const)(
    'cancels at %s and ignores its late completion',
    async (stage) => {
      vi.useFakeTimers();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reading: LinuxDoReadingRecovery = {
        kind: 'reading',
        batchId: 9,
        isCurrent: () => true,
        cancel: vi.fn(),
        resume: vi.fn(async () => {
          if (stage === 'request') await pending;
          return 'verification-required' as const;
        })
      };
      const { controller, onRecoveryStateChanged, onLinuxDoSurfaceOpened } = createController({
        awaitLinuxDoWebViewUnmount: () => (stage === 'unmount' ? pending : Promise.resolve()),
        awaitLinuxDoCookieHandoff: () => (stage === 'handoff' ? pending : Promise.resolve())
      });
      await controller.showLinuxDoVerification('reading', reading);
      const checking = controller.checkLinuxDoCookie();
      await Promise.resolve();
      await Promise.resolve();
      controller.closeLinuxDoPanel();
      release();
      await checking;
      await vi.advanceTimersByTimeAsync(1000);
      expect(reading.cancel).toHaveBeenCalledTimes(1);
      expect(reading.resume).toHaveBeenCalledTimes(stage === 'request' ? 1 : 0);
      expect(await controller.showLinuxDoVerification('late', reading)).toBe(false);
      expect(onLinuxDoSurfaceOpened).toHaveBeenCalledTimes(1);
      expect(onRecoveryStateChanged).toHaveBeenLastCalledWith({ phase: 'idle', dedicated: false, results: [] });
    }
  );

  it('does not load verification for an expired batch on retry or first notification', async () => {
    let expired = false;
    const reading: LinuxDoReadingRecovery = {
      kind: 'reading',
      batchId: 10,
      isCurrent: () => true,
      isExpired: () => expired,
      cancel: vi.fn(),
      resume: vi.fn(async () => 'verification-required' as const)
    };
    const { controller, onLinuxDoSurfaceOpened, onRecoveryStateChanged } = createController();
    await controller.showLinuxDoVerification('reading', reading);
    await controller.checkLinuxDoCookie();
    expired = true;
    controller.retryLinuxDoRecovery();
    expect(onLinuxDoSurfaceOpened).toHaveBeenCalledTimes(1);
    expect(reading.resume).toHaveBeenCalledTimes(1);
    expect(onRecoveryStateChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'result',
        results: [expect.objectContaining({ outcome: 'stale' })]
      })
    );
    controller.closeLinuxDoPanel();
    const next = createController();
    await next.controller.showLinuxDoVerification('expired', { ...reading, batchId: 11 });
    expect(next.onLinuxDoSurfaceOpened).not.toHaveBeenCalled();
  });
});
