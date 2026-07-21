import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
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

const linuxDoMocks = vi.hoisted(() => ({
  canAcceptLinuxDoAccessUpdate: vi.fn((
    _cookies?: unknown,
    _previousClearance?: string | null,
    _requireFreshClearance?: boolean
  ) => true),
  canStoreLinuxDoLogin: vi.fn(() => false),
  clearLinuxDoAccessForGeneration: vi.fn(),
  clearLinuxDoClearance: vi.fn(async () => null),
  currentLinuxDoAccessGeneration: vi.fn(() => 7),
  linuxDoClearanceValue: vi.fn(() => 'CLEARANCE_VALUE_SECRET'),
  loadLinuxDoAccess: vi.fn(),
  readLinuxDoCookiesFromStores: vi.fn(),
  saveLinuxDoAccess: vi.fn()
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

function recoveryQueryKeyFor(id: string) {
  return ['forum', 'linuxdo', 'test-recovery', { id }] as const;
}

vi.mock('../linuxdoCookieBridge', () => ({
  buildLinuxDoCookieHeader: () => 'COOKIE_VALUE_SECRET',
  canAcceptLinuxDoAccessUpdate: linuxDoMocks.canAcceptLinuxDoAccessUpdate,
  canStoreLinuxDoAccess: () => true,
  canStoreLinuxDoClearance: () => true,
  canStoreLinuxDoLogin: linuxDoMocks.canStoreLinuxDoLogin,
  clearLinuxDoAccessForGeneration: linuxDoMocks.clearLinuxDoAccessForGeneration,
  clearLinuxDoClearance: linuxDoMocks.clearLinuxDoClearance,
  currentLinuxDoAccessGeneration: linuxDoMocks.currentLinuxDoAccessGeneration,
  linuxDoAccessSummary: () => ({ hasClearance: true, loggedIn: true }),
  linuxDoClearanceValue: linuxDoMocks.linuxDoClearanceValue,
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
import type { SiteSessionEvent } from '../siteSessionState';
import { useVerificationController } from './useVerificationController';

const ref = <T,>(current: T) => ({ current });

function createController({
  onUpdateLinuxDoSession
}: {
  onUpdateLinuxDoSession?: (event: SiteSessionEvent) => void;
} = {}) {
  const showLinuxDoPanelRef = ref(false);
  const linuxDoWebViewSessionRef = ref(0);
  const linuxDoWebViewCookieHeaderRef = ref('');
  const linuxDoWebViewRef = ref({
    injectJavaScript: vi.fn(),
    stopLoading: vi.fn()
  });
  const onLoginWebViewFailure = vi.fn();
  const notify = vi.fn();
  const updateLinuxDoSession = vi.fn((event: SiteSessionEvent) => {
    onUpdateLinuxDoSession?.(event);
  });
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
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewMountTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: linuxDoWebViewRef as never,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgent: '',
    linuxDoWebViewUserAgentRef: ref(''),
    notify,
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
  const handleLinuxDoMessage = controller.handleLinuxDoMessage;
  controller.handleLinuxDoMessage = (event, webViewKey) => handleLinuxDoMessage({
    ...event,
    nativeEvent: {
      ...event.nativeEvent,
      url: event.nativeEvent.url || 'https://linux.do/latest'
    }
  }, webViewKey);
  return { controller, linuxDoWebViewCookieHeaderRef, linuxDoWebViewRef, linuxDoWebViewSessionRef, notify, onLoginWebViewFailure, showLinuxDoPanelRef, updateLinuxDoSession };
}

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
  serverStateMocks.recoveryActive.mockReset().mockReturnValue(true);
  linuxDoMocks.canAcceptLinuxDoAccessUpdate.mockReturnValue(true);
  linuxDoMocks.canStoreLinuxDoLogin.mockReturnValue(false);
  linuxDoMocks.linuxDoClearanceValue.mockReturnValue('CLEARANCE_VALUE_SECRET');
  vi.useRealTimers();
});

describe('linux.do visible verification diagnostics', () => {
  it('rejects a forged verification message from a third-party frame', () => {
    const { controller, linuxDoWebViewCookieHeaderRef, linuxDoWebViewSessionRef, showLinuxDoPanelRef } = createController();
    showLinuxDoPanelRef.current = true;

    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          cookie: 'FORGED_COOKIE_SECRET',
          userAgent: 'FORGED_USER_AGENT_SECRET'
        }),
        url: 'https://evil.example/frame'
      }
    } as never, linuxDoWebViewSessionRef.current);

    expect(linuxDoWebViewCookieHeaderRef.current).toBe('');
  });

  it('keeps the Account manual panel open and records newly saved access as session-updated', async () => {
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
      type: 'session-updated',
      hasVerification: true
    }));
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('keeps the exact recovery current while clearing the old clearance before opening verification', async () => {
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'OLD_CLEARANCE_SECRET' });
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    linuxDoMocks.clearLinuxDoClearance.mockResolvedValue(null);
    const recoveryQueryKey = recoveryQueryKeyFor('search-more:stable:2');
    let recoveryCurrent = true;
    serverStateMocks.recoveryActive.mockImplementation(() => recoveryCurrent);
    const { controller, showLinuxDoPanelRef, updateLinuxDoSession } = createController({
      onUpdateLinuxDoSession: (event) => {
        if (
          (event.type === 'session-updated' || event.type === 'cleared')
          && event.recoveryQueryKey !== recoveryQueryKey
        ) {
          recoveryCurrent = false;
        }
      }
    });

    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKey,
      resume: vi.fn(async () => 'completed' as const)
    });

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      recoveryQueryKey
    }));
    expect(recoveryCurrent).toBe(true);
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('abandons a recovery that becomes stale while clearing so a later manual verification can finish', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'OLD_CLEARANCE_SECRET' });
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    const clearanceReset = Promise.withResolvers<null>();
    linuxDoMocks.clearLinuxDoClearance.mockReturnValue(clearanceReset.promise);
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    let recoveryCurrent = true;
    serverStateMocks.recoveryActive.mockImplementation(() => recoveryCurrent);
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    const showing = controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('feed:stale-during-clear'),
      resume: vi.fn(async () => 'completed' as const)
    });
    await vi.waitFor(() => expect(linuxDoMocks.clearLinuxDoClearance).toHaveBeenCalledTimes(1));
    recoveryCurrent = false;
    clearanceReset.resolve(null);
    await showing;

    const clearanceTransition = updateLinuxDoSession.mock.calls.find(([
      event
    ]) => event.type === 'session-updated' || event.type === 'cleared')?.[0];
    expect(clearanceTransition).toBeDefined();
    expect(clearanceTransition).not.toHaveProperty('recoveryQueryKey');
    expect(showLinuxDoPanelRef.current).toBe(false);

    updateLinuxDoSession.mockClear();
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
    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      hasVerification: true
    }));
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it.each(['baseline-read', 'clearance-clear'] as const)(
    'abandons a recovery when %s preparation rejects so a later manual verification can finish',
    async (failure) => {
      vi.useFakeTimers();
      linuxDoMocks.loadLinuxDoAccess.mockReset();
      linuxDoMocks.clearLinuxDoClearance.mockReset();
      linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
      linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
        cookieHeader: 'COOKIE_VALUE_SECRET',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      });
      linuxDoMocks.clearLinuxDoClearance.mockResolvedValue(null);
      if (failure === 'baseline-read') {
        linuxDoMocks.loadLinuxDoAccess
          .mockRejectedValueOnce(new Error('storage read failed'))
          .mockResolvedValue(null);
      } else {
        linuxDoMocks.loadLinuxDoAccess
          .mockResolvedValueOnce({ cookieHeader: 'OLD_CLEARANCE_SECRET' })
          .mockResolvedValue(null);
        linuxDoMocks.clearLinuxDoClearance
          .mockRejectedValueOnce(new Error('storage clear failed'));
      }
      const resume = vi.fn(async () => 'completed' as const);
      const { controller, linuxDoWebViewSessionRef, notify, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

      await expect(controller.showLinuxDoVerification('需要验证', {
        queryKey: recoveryQueryKeyFor(`feed:${failure}`),
        resume
      })).resolves.toBeUndefined();
      expect(showLinuxDoPanelRef.current).toBe(false);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('linux.do 验证准备失败，请重试。');

      updateLinuxDoSession.mockClear();
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
      const check = controller.checkLinuxDoCookie();
      await vi.advanceTimersByTimeAsync(250);
      await check;

      expect(resume).not.toHaveBeenCalled();
      expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
        type: 'session-updated',
        hasVerification: true
      }));
      expect(showLinuxDoPanelRef.current).toBe(true);
    }
  );

  it('does not report a preparation storage failure after its recovery becomes stale', async () => {
    const baselineRead = Promise.withResolvers<null>();
    linuxDoMocks.loadLinuxDoAccess.mockReturnValueOnce(baselineRead.promise);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    let recoveryCurrent = true;
    serverStateMocks.recoveryActive.mockImplementation(() => recoveryCurrent);
    const { controller, notify, showLinuxDoPanelRef } = createController();

    const showing = controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('feed:stale-storage-failure'),
      resume: vi.fn(async () => 'completed' as const)
    });
    recoveryCurrent = false;
    baselineRead.reject(new Error('late storage read failure'));
    await expect(showing).resolves.toBeUndefined();

    expect(notify).not.toHaveBeenCalled();
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it.each([
    ['an unchanged clearance', false],
    ['an explicit login cookie', true]
  ] as const)('handles %s fail-closed when a manual baseline read rejects', async (_credential, explicitLogin) => {
    vi.useFakeTimers();
    linuxDoMocks.canStoreLinuxDoLogin.mockReturnValue(explicitLogin);
    linuxDoMocks.loadLinuxDoAccess
      .mockRejectedValueOnce(new Error('storage read failed'))
      .mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
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
    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(250);
    await check;

    if (explicitLogin) {
      expect(linuxDoMocks.saveLinuxDoAccess).toHaveBeenCalledTimes(1);
      expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
        type: 'session-updated',
        hasVerification: true
      }));
    } else {
      expect(linuxDoMocks.saveLinuxDoAccess).not.toHaveBeenCalled();
      expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
        type: 'verification-required'
      }));
      expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'session-updated'
      }));
    }
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a manual baseline that finishes with late %s after a newer login check succeeds',
    async (settlement) => {
      vi.useFakeTimers();
      const baselineRead = Promise.withResolvers<{ cookieHeader: string } | null>();
      linuxDoMocks.loadLinuxDoAccess
        .mockReturnValueOnce(baselineRead.promise)
        .mockResolvedValue(null);
      linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
      linuxDoMocks.canStoreLinuxDoLogin.mockReturnValue(true);
      linuxDoMocks.linuxDoClearanceValue
        .mockReturnValueOnce('FRESH_CLEARANCE_SECRET')
        .mockReturnValueOnce('OLD_CLEARANCE_SECRET');
      linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
        cookieHeader: 'COOKIE_VALUE_SECRET',
        savedAt: '2026-07-10T00:00:00.000Z',
        source: 'webview'
      });
      const { controller, linuxDoWebViewSessionRef, updateLinuxDoSession } = createController();

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
      const firstCheck = controller.checkLinuxDoCookie();
      await vi.advanceTimersByTimeAsync(250);
      await firstCheck;
      expect(linuxDoMocks.saveLinuxDoAccess).toHaveBeenCalledTimes(1);

      linuxDoMocks.saveLinuxDoAccess.mockClear();
      updateLinuxDoSession.mockClear();
      linuxDoMocks.canStoreLinuxDoLogin.mockReturnValue(false);
      linuxDoMocks.canAcceptLinuxDoAccessUpdate.mockImplementation((
        _cookies?: unknown,
        previousClearance?: string | null
      ) => previousClearance !== 'FRESH_CLEARANCE_SECRET');
      if (settlement === 'resolve') {
        baselineRead.resolve({ cookieHeader: 'OLD_CLEARANCE_SECRET' });
      } else {
        baselineRead.reject(new Error('late baseline failure'));
      }
      await vi.advanceTimersByTimeAsync(0);

      const secondCheck = controller.checkLinuxDoCookie();
      await vi.advanceTimersByTimeAsync(250);
      await secondCheck;

      expect(linuxDoMocks.saveLinuxDoAccess).not.toHaveBeenCalled();
      expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
        type: 'verification-required'
      }));
      expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
        type: 'session-updated'
      }));
    }
  );

  it('does not preserve a stale recovery lane when newly saved credentials invalidate it', async () => {
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
    let recoveryCurrent = true;
    serverStateMocks.recoveryActive.mockImplementation(() => recoveryCurrent);
    const { controller, linuxDoWebViewSessionRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('topic:stale'),
      resume: vi.fn(async () => 'completed' as const)
    });
    await vi.advanceTimersByTimeAsync(80);
    updateLinuxDoSession.mockClear();
    recoveryCurrent = false;
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

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated'
    }));
    const savedCredentialTransition = updateLinuxDoSession.mock.calls.find(([event]) => event.type === 'session-updated')?.[0];
    expect(savedCredentialTransition).not.toHaveProperty('recoveryQueryKey');
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
      queryKey: recoveryQueryKeyFor('feed:latest'),
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

  it('REG-LINUXDO-004 expires stale login immediately when the visible page reports logged out without clearance', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'STORED_EXPIRED_COOKIE_SECRET'
    });
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    linuxDoMocks.clearLinuxDoAccessForGeneration.mockResolvedValue({
      cookieHeader: 'cf_clearance=RETAINED_CLEARANCE_SECRET',
      savedAt: '2026-07-20T00:00:00.000Z',
      source: 'webview'
    });
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    const check = controller.checkLinuxDoCookie();
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'logged-out-document',
          status: 'logged-out',
          loggedIn: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(linuxDoMocks.clearLinuxDoAccessForGeneration).toHaveBeenCalledWith(7, 'STORED_EXPIRED_COOKIE_SECRET');
    expect(linuxDoMocks.saveLinuxDoAccess).not.toHaveBeenCalled();
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'login-expired',
      message: 'linux.do 登录已失效，请重新登录。'
    });
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('keeps the expired state when stale login cleanup fails', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'STORED_EXPIRED_COOKIE_SECRET'
    });
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.clearLinuxDoAccessForGeneration.mockRejectedValueOnce(new Error('storage failed'));
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    const check = controller.checkLinuxDoCookie();
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          status: 'logged-out',
          loggedIn: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'login-expired',
      message: 'linux.do 登录已失效，本机 Cookie 清理未完成，请重试。'
    });
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('REG-LINUXDO-003 does not claim success when the resumed read fails normally', async () => {
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
    const resume = vi.fn(async () => 'failed' as const);
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification('需要验证', {
      queryKey: recoveryQueryKeyFor('feed:ordinary-failure'),
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

    expect(resume).toHaveBeenCalledTimes(1);
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));
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
      queryKey: recoveryQueryKeyFor('feed:same-clearance'),
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
      queryKey: recoveryQueryKeyFor('topic:42'),
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
    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      recoveryQueryKey: recoveryQueryKeyFor('topic:42')
    }));
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));

    resumed.resolve('completed');
    await vi.runAllTimersAsync();

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));
    expect(updateLinuxDoSession.mock.calls.findIndex(([event]) => event.type === 'session-updated')).toBeLessThan(
      updateLinuxDoSession.mock.calls.findIndex(([event]) => event.type === 'verification-succeeded')
    );
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('REG-LINUXDO-002 does not reopen a user-dismissed recovery when its failure arrives during closing', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    const recovery = {
      queryKey: recoveryQueryKeyFor('topic:42:request-1'),
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
      queryKey: recoveryQueryKeyFor('feed:request-1'),
      resume: vi.fn(async () => 'completed' as const)
    };
    const queuedRecovery = {
      queryKey: recoveryQueryKeyFor('search:request-2'),
      resume: vi.fn(async () => 'completed' as const)
    };
    const latestRecovery = {
      queryKey: recoveryQueryKeyFor('user:request-3'),
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
      queryKey: recoveryQueryKeyFor('feed:request-1'),
      resume: vi.fn(async () => 'completed' as const)
    };
    const newerRecovery = {
      queryKey: recoveryQueryKeyFor('topic:request-2'),
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

  it('finishes and invalidates LinuxDo verification when another verification panel replaces it', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const { controller, linuxDoWebViewRef, linuxDoWebViewSessionRef } = createController();

    controller.changeLinuxDoPanel(true);
    const previousSession = linuxDoWebViewSessionRef.current;
    controller.showNodeSeekVerification();

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.area === 'credential' && event.operation === 'check' && event.phase === 'finish');
    expect(terminalEvents).toEqual([
      expect.objectContaining({ outcome: 'canceled', reason: 'superseded' })
    ]);
    expect(linuxDoWebViewSessionRef.current).toBeGreaterThan(previousSession);
    expect(linuxDoWebViewRef.current.stopLoading).toHaveBeenCalled();
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
