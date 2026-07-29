import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void) => effect(),
  useLayoutEffect: (effect: () => void) => effect(),
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

const serverStateMocks = vi.hoisted(() => ({
  recoveryActive: vi.fn(() => true)
}));

vi.mock('./serverState', () => ({
  appQueryClient: {
    getQueryCache: () => ({
      find: () => ({ isActive: serverStateMocks.recoveryActive })
    })
  }
}));

vi.mock('../linuxdoSession', () => ({
  sanitizeLinuxDoUserAgent: (userAgent: string) => userAgent.trim()
}));

import {
  reduceSiteSessionState,
  type SiteSessionEvent,
  type SiteSessionState
} from '../siteSessionState';
import type { Topic } from '../types';
import type { AccountReconcileResult } from './useAccountStatusController';
import { useVerificationController } from './useVerificationController';

const ref = <T,>(current: T) => ({ current });
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

function createController(options: {
  linuxDoIdentityPending?: boolean;
  onBeforeLinuxDoSurfaceOpened?: () => void;
  onLinuxDoRecoveryBarrierChanged?: (active: boolean) => void;
  reconcileAccountStatus?: (source: 'linuxdo') => Promise<AccountReconcileResult>;
  selectedTopic?: Topic | null;
} = {}) {
  const showLinuxDoPanelRef = ref(false);
  const linuxDoWebViewSessionRef = ref(0);
  const linuxDoWebViewUserAgentRef = ref('');
  const linuxDoWebViewRef = ref({
    stopLoading: vi.fn()
  });
  const onLoginWebViewFailure = vi.fn();
  const onLinuxDoSurfaceClosed = vi.fn();
  const onLinuxDoSurfaceOpened = vi.fn();
  const onLinuxDoRecoveryBarrierChanged = vi.fn(
    options.onLinuxDoRecoveryBarrierChanged
  );
  const notify = vi.fn();
  const reconcileAccountStatus = vi.fn(
    options.reconcileAccountStatus
      || (async () => ({ status: 'same', session: loggedInSession } as const))
  );
  const setLinuxDoWebViewError = vi.fn();
  const setLinuxDoWebViewUserAgent = vi.fn();
  const updateLinuxDoSession = vi.fn<(event: SiteSessionEvent) => void>();
  const openTopic = vi.fn(async () => undefined);
  const controller = useVerificationController({
    changeNodeSeekLoginPanel: vi.fn(),
    changeScreen: vi.fn(),
    checkingRequestIdRef: ref(0),
    closeYaohuoLoginPanel: vi.fn(),
    linuxDoPanelClosingSessionRef: ref<number | null>(null),
    linuxDoPanelCloseSettleTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewMountTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: linuxDoWebViewRef as never,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgentRef,
    linuxDoIdentityPending: options.linuxDoIdentityPending,
    notify,
    onBeforeLinuxDoSurfaceOpened: options.onBeforeLinuxDoSurfaceOpened,
    onLoginWebViewFailure,
    onLinuxDoRecoveryBarrierChanged,
    onLinuxDoSurfaceClosed,
    onLinuxDoSurfaceOpened,
    openTopicRef: ref(openTopic),
    reconcileAccountStatus,
    selectedTopic: options.selectedTopic || null,
    setChecking: vi.fn(),
    setLinuxDoWebViewError,
    setLinuxDoWebViewKey: vi.fn(),
    setLinuxDoWebViewUserAgent,
    setLoadingLinuxDoPage: vi.fn(),
    setMountLinuxDoWebView: vi.fn(),
    setShowLinuxDoPanel: vi.fn((value: boolean | ((previous: boolean) => boolean)) => {
      showLinuxDoPanelRef.current = typeof value === 'function'
        ? value(showLinuxDoPanelRef.current)
        : value;
    }),
    setShowSettingsPanel: vi.fn(),
    showLinuxDoPanelRef,
    topicDetail: null,
    updateLinuxDoSession,
    updateNodeSeekSession: vi.fn()
  });
  const handleLinuxDoMessage = controller.handleLinuxDoMessage;
  controller.handleLinuxDoMessage = (event, webViewKey) => handleLinuxDoMessage({
    ...event,
    nativeEvent: {
      ...event.nativeEvent,
      url: event.nativeEvent.url || 'https://linux.do/latest'
    }
  }, webViewKey);
  return {
    controller,
    linuxDoWebViewRef,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgentRef,
    notify,
    openTopic,
    onLoginWebViewFailure,
    onLinuxDoRecoveryBarrierChanged,
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
  vi.clearAllMocks();
  serverStateMocks.recoveryActive.mockReset().mockReturnValue(true);
  vi.useRealTimers();
});

describe('linux.do visible verification coordinator', () => {
  it('[REG-ACCOUNT-031] opens the surface without probing identity or accepting page cookies', async () => {
    const {
      controller,
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
    expect(reconcileAccountStatus).not.toHaveBeenCalled();
  });

  it('ignores WebView messages from third-party frames', async () => {
    const {
      controller,
      linuxDoWebViewUserAgentRef,
      setLinuxDoWebViewUserAgent
    } = createController();
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

  it('[REG-ACCOUNT-039] uses the canonical Account verifier as the only manual identity proof and authoritatively closes', async () => {
    const {
      controller,
      notify,
      reconcileAccountStatus,
      showLinuxDoPanelRef,
      updateLinuxDoSession
    } = createController();
    await controller.showLinuxDoVerification();

    await controller.checkLinuxDoCookie();

    expect(reconcileAccountStatus).toHaveBeenCalledOnce();
    expect(reconcileAccountStatus).toHaveBeenCalledWith('linuxdo');
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated'
    }));
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'verification-succeeded',
      loggedIn: true,
      currentUser: loggedInSession.currentUser,
      cookieSummary: loggedInSession.cookieSummary,
      at: expect.any(String)
    });
    expect(notify).toHaveBeenCalledWith('linux.do 登录身份已确认。');
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('[REG-ACCOUNT-031] reports confirmed anonymous without clearing cookies or synthesizing login expiry', async () => {
    const {
      controller,
      setLinuxDoWebViewError,
      showLinuxDoPanelRef,
      updateLinuxDoSession
    } = createController({
      reconcileAccountStatus: async () => ({
        status: 'anonymous',
        session: anonymousSession
      })
    });
    await controller.showLinuxDoVerification();

    await controller.checkLinuxDoCookie();

    expect(setLinuxDoWebViewError).toHaveBeenCalledWith(
      'linux.do 当前为未登录状态，请登录后再检测。'
    );
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
      type: expect.stringMatching(/^(?:cleared|login-expired|session-updated)$/)
    }));
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-ACCOUNT-031] keeps unknown identity read-only and leaves the panel open for retry', async () => {
    const {
      controller,
      setLinuxDoWebViewError,
      showLinuxDoPanelRef,
      updateLinuxDoSession
    } = createController({
      reconcileAccountStatus: async () => ({
        status: 'unknown',
        error: 'network unavailable',
        errorInfo: { kind: 'ordinary', message: 'network unavailable' }
      })
    });
    await controller.showLinuxDoVerification();

    await controller.checkLinuxDoCookie();

    expect(setLinuxDoWebViewError).toHaveBeenCalledWith(
      'linux.do 登录状态暂时无法确认：network unavailable'
    );
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
      type: expect.stringMatching(/^(?:cleared|login-expired|session-updated)$/)
    }));
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-LINUXDO-007] opens identity verification instead of retrying a Topic query that has not started', async () => {
    const selectedTopic: Topic = {
      source: 'linuxdo',
      id: '42',
      title: 'Topic',
      author: 'alice',
      url: 'https://linux.do/t/42',
      createdAt: '2026-07-29T00:00:00.000Z',
      replyCount: 0
    };
    const { controller, openTopic, showLinuxDoPanelRef } = createController({
      linuxDoIdentityPending: true,
      selectedTopic
    });

    await controller.verifyLinuxDoFromTopic();

    expect(openTopic).not.toHaveBeenCalled();
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-ACCOUNT-039] reuses the authoritative identity result when an exact read recovery completes', async () => {
    const resume = vi.fn(async () => 'completed' as const);
    const {
      controller,
      onLinuxDoSurfaceClosed,
      reconcileAccountStatus,
      showLinuxDoPanelRef,
      updateLinuxDoSession
    } = createController();
    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('level'),
      resume
    });

    await controller.checkLinuxDoCookie();

    expect(reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(onLinuxDoSurfaceClosed.mock.invocationCallOrder[0]).toBeLessThan(
      resume.mock.invocationCallOrder[0]
    );
    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'verification-succeeded',
      loggedIn: true,
      currentUser: loggedInSession.currentUser,
      cookieSummary: loggedInSession.cookieSummary
    }));
    expect(updateLinuxDoSession.mock.invocationCallOrder.at(-1)).toBeLessThan(
      resume.mock.invocationCallOrder[0]
    );
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
    const {
      controller,
      onLinuxDoRecoveryBarrierChanged,
      showLinuxDoPanelRef,
      updateLinuxDoSession
    } = createController();
    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('feed'),
      resume
    });

    try {
      await controller.checkLinuxDoCookie();
      expect(showLinuxDoPanelRef.current).toBe(false);
      expect(onLinuxDoRecoveryBarrierChanged).toHaveBeenLastCalledWith(true);
      await vi.advanceTimersByTimeAsync(350);
      expect(showLinuxDoPanelRef.current).toBe(true);
      expect(onLinuxDoRecoveryBarrierChanged).toHaveBeenLastCalledWith(false);

      await controller.checkLinuxDoCookie();
      expect(showLinuxDoPanelRef.current).toBe(false);
      await vi.advanceTimersByTimeAsync(350);
    } finally {
      vi.useRealTimers();
    }

    expect(resume).toHaveBeenCalledTimes(2);
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'verification-required',
      message: '验证仍未生效，请继续完成验证后点击检测状态。'
    });
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-ACCOUNT-039] reports a recovery exception after the panel has already closed', async () => {
    const resume = vi.fn(async () => {
      throw new Error('resume exploded');
    });
    const {
      controller,
      notify,
      onLinuxDoSurfaceClosed,
      updateLinuxDoSession
    } = createController();
    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('throwing'),
      resume
    });

    await controller.checkLinuxDoCookie();

    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledWith({
      authoritativeResult: true,
      reason: 'authoritative-recovery'
    });
    expect(notify).toHaveBeenCalledWith(
      '登录身份已确认，但原页面恢复失败：resume exploded'
    );
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'check-failed',
      message: '登录身份已确认，但原页面恢复失败：resume exploded'
    });
    const finalSession = updateLinuxDoSession.mock.calls.reduce(
      (state, [event]) => reduceSiteSessionState(state, event),
      anonymousSession
    );
    expect(finalSession).toMatchObject({
      status: 'logged-in',
      currentUser: loggedInSession.currentUser,
      lastError: '登录身份已确认，但原页面恢复失败：resume exploded'
    });
  });

  it('does not resume an inactive recovery query', async () => {
    serverStateMocks.recoveryActive.mockReturnValue(false);
    const resume = vi.fn(async () => 'completed' as const);
    const { controller, showLinuxDoPanelRef } = createController();

    await expect(controller.showLinuxDoVerification('迟到的恢复', {
      queryKey: recoveryQueryKeyFor('stale'),
      resume
    })).resolves.toBe(false);

    expect(resume).not.toHaveBeenCalled();
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('[REG-ACCOUNT-031] treats App inactive as a temporary unmount, not a logical close', async () => {
    const {
      controller,
      onLinuxDoSurfaceClosed,
      showLinuxDoPanelRef
    } = createController();
    await controller.showLinuxDoVerification();

    controller.stopLinuxDoVerificationForInactiveApp();

    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(onLinuxDoSurfaceClosed).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-031] closes a visible surface once and makes hidden repeated closes no-op', async () => {
    const {
      controller,
      onLinuxDoSurfaceClosed,
      showLinuxDoPanelRef
    } = createController();
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
    const {
      controller,
      notify,
      updateLinuxDoSession
    } = createController({
      reconcileAccountStatus: () => deferred.promise
    });
    await controller.showLinuxDoVerification();

    const check = controller.checkLinuxDoCookie();
    controller.resetLinuxDoWebView();
    deferred.resolve({ status: 'same', session: loggedInSession });
    await check;

    expect(notify).not.toHaveBeenCalledWith('linux.do 登录身份已确认。');
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'verification-succeeded'
    }));
  });

  it('closes as superseded when another site verification replaces it', async () => {
    const {
      controller,
      linuxDoWebViewRef,
      onLinuxDoSurfaceClosed,
      showLinuxDoPanelRef
    } = createController();
    await controller.showLinuxDoVerification();

    controller.showNodeSeekVerification();

    expect(showLinuxDoPanelRef.current).toBe(false);
    expect(linuxDoWebViewRef.current.stopLoading).toHaveBeenCalled();
    expect(onLinuxDoSurfaceClosed).toHaveBeenCalledWith({
      authoritativeResult: false,
      reason: 'switch-surface'
    });
  });

  it('[REG-ACCOUNT-031] closes other surfaces before linux.do becomes logically visible', () => {
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
    const {
      controller,
      linuxDoWebViewSessionRef,
      onLoginWebViewFailure
    } = createController();
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
    expect(onLoginWebViewFailure).toHaveBeenCalledWith(
      'linuxdo',
      9,
      'renderer_gone'
    );
  });
});
