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
  canStoreLinuxDoAccess: vi.fn((_cookies: Record<string, unknown>) => true),
  canStoreLinuxDoClearance: vi.fn((_cookies: Record<string, unknown>) => true),
  currentLinuxDoAccessGeneration: vi.fn(() => 7),
  loadLinuxDoAccess: vi.fn(),
  readLinuxDoCookiesFromStores: vi.fn(),
  saveLinuxDoAccess: vi.fn()
}));

const serverStateMocks = vi.hoisted(() => ({
  recoveryActive: vi.fn(() => true),
  useRealQueryCache: false
}));

vi.mock('./serverState', () => ({
  appQueryClient: {
    getQueryCache: () => serverStateMocks.useRealQueryCache
      ? verificationQueryClient.getQueryCache()
      : {
          find: () => ({ isActive: serverStateMocks.recoveryActive })
        }
  }
}));

function recoveryQueryKeyFor(id: string) {
  return ['forum', 'linuxdo', 'test-recovery', { id }] as const;
}

vi.mock('../linuxdoCookieBridge', () => ({
  buildLinuxDoCookieHeader: () => 'COOKIE_VALUE_SECRET',
  canStoreLinuxDoAccess: linuxDoMocks.canStoreLinuxDoAccess,
  canStoreLinuxDoClearance: linuxDoMocks.canStoreLinuxDoClearance,
  currentLinuxDoAccessGeneration: linuxDoMocks.currentLinuxDoAccessGeneration,
  loadLinuxDoAccess: linuxDoMocks.loadLinuxDoAccess,
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
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import type { SiteSessionEvent } from '../siteSessionState';
import { useVerificationController } from './useVerificationController';

const verificationQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      retry: false,
      staleTime: Infinity
    }
  }
});

const LINUXDO_PROBE_TIMEOUT_MS = 5000;
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
    linuxDoPanelClosingSessionRef: ref<number | null>(null),
    linuxDoPanelCloseSettleTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewCookieHeaderRef,
    linuxDoWebViewMountTimerRef: ref<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: linuxDoWebViewRef as never,
    linuxDoWebViewSessionRef,
    linuxDoWebViewUserAgent: '',
    linuxDoWebViewUserAgentRef: ref(''),
    notify,
    onLoginWebViewFailure,
    openTopicRef: ref(null),
    selectedTopic: null,
    setChecking: vi.fn(),
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
  verificationQueryClient.clear();
  serverStateMocks.recoveryActive.mockReset().mockReturnValue(true);
  serverStateMocks.useRealQueryCache = false;
  linuxDoMocks.canStoreLinuxDoAccess.mockReturnValue(true);
  linuxDoMocks.canStoreLinuxDoClearance.mockReturnValue(true);
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
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(500);

    expect(linuxDoMocks.saveLinuxDoAccess).not.toHaveBeenCalled();

    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      hasVerification: true,
      loggedIn: false
    }));
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-ACCOUNT-019] accepts only an explicit linux.do current-user marker as manual login proof', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-23T00:00:00.000Z',
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

    const check = controller.checkLinuxDoCookie();
    await Promise.resolve();
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          probeId: 1,
          documentKey: 'https://linux.do/latest:1000',
          status: 'logged-in',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      loggedIn: true
    }));
  });

  it('[REG-ACCOUNT-021] accepts a late same-origin linux.do proof when WebView URLs differ by path', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-23T00:00:00.000Z',
      source: 'webview'
    });
    const { controller, linuxDoWebViewSessionRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    const check = controller.checkLinuxDoCookie();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(300);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        url: 'https://linux.do/',
        data: JSON.stringify({
          type: 'linuxdo-webview',
          probeId: 1,
          documentKey: 'https://linux.do/latest:1000',
          status: 'logged-in',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      loggedIn: true
    }));
  });

  it('[REG-ACCOUNT-019] ignores a late linux.do login proof after the WebView starts a new document', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-23T00:00:00.000Z',
      source: 'webview'
    });
    const { controller, linuxDoWebViewSessionRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    const check = controller.checkLinuxDoCookie();
    await Promise.resolve();
    controller.setLoadingLinuxDoPageForSession(true, linuxDoWebViewSessionRef.current);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          probeId: 1,
          documentKey: 'https://linux.do/latest:1000',
          status: 'logged-in',
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      loggedIn: false
    }));
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      loggedIn: true
    }));
  });

  it('[REG-ACCOUNT-026] opens an exact recovery without clearing the original-site CF cookie', async () => {
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'OLD_CLEARANCE_SECRET' });
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
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

    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({
      type: expect.stringMatching(/^(?:session-updated|cleared)$/),
      recoveryQueryKey
    }));
    expect(linuxDoMocks.loadLinuxDoAccess).not.toHaveBeenCalled();
    expect(recoveryCurrent).toBe(true);
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-ACCOUNT-026] does not use a saved App snapshot as proof of the visible WebView session', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue({ cookieHeader: 'STORED_ONLY_COOKIE_SECRET' });
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    linuxDoMocks.canStoreLinuxDoAccess.mockImplementation((cookies) => Object.keys(cookies as object).length > 0);
    linuxDoMocks.canStoreLinuxDoClearance.mockImplementation((cookies) => Object.keys(cookies as object).length > 0);
    const { controller, linuxDoWebViewSessionRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    const check = controller.checkLinuxDoCookie();
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          probeId: 1,
          documentKey: 'https://linux.do/latest:1000',
          status: 'unknown',
          cookie: ''
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS * 2);
    await check;

    expect(linuxDoMocks.saveLinuxDoAccess).not.toHaveBeenCalled();
    expect(linuxDoMocks.loadLinuxDoAccess).not.toHaveBeenCalled();
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'verification-required',
      message: '没有检测到新的 linux.do 验证信息。'
    });
  });

  it('[REG-LINUXDO-006] preserves the active Level Query through credential save, exact resume, and panel close', async () => {
    vi.useFakeTimers();
    serverStateMocks.useRealQueryCache = true;
    const levelQueryKey = ['forum', 'linuxdo', 'level', { credential: 0 }] as const;
    const initialProfile = { username: 'before-verification' };
    const resumedProfile = { username: 'after-verification' };
    verificationQueryClient.setQueryData(levelQueryKey, initialProfile);
    const observer = new QueryObserver(verificationQueryClient, {
      queryKey: levelQueryKey,
      queryFn: async () => initialProfile,
      staleTime: Infinity
    });
    const unsubscribe = observer.subscribe(() => undefined);
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-10T00:00:00.000Z',
      source: 'webview'
    });
    const resume = vi.fn(async () => {
      verificationQueryClient.setQueryData(levelQueryKey, resumedProfile);
      return 'completed' as const;
    });
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef } = createController();

    try {
      await expect(controller.showLinuxDoVerification('需要验证', {
        queryKey: levelQueryKey,
        resume
      })).resolves.toBe(true);
      expect(verificationQueryClient.getQueryCache().find({ queryKey: levelQueryKey, exact: true })?.isActive()).toBe(true);
      expect(verificationQueryClient.getQueryData(levelQueryKey)).toEqual(initialProfile);

      await vi.advanceTimersByTimeAsync(80);
      controller.handleLinuxDoMessage({
        nativeEvent: {
          data: JSON.stringify({
            type: 'linuxdo-webview',
            challenge: false,
            cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
            userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
          })
        }
      } as never, linuxDoWebViewSessionRef.current);
      const check = controller.checkLinuxDoCookie();
      await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
      await check;

      expect(resume).toHaveBeenCalledTimes(1);
      expect(showLinuxDoPanelRef.current).toBe(false);
      expect(verificationQueryClient.getQueryData(levelQueryKey)).toEqual(resumedProfile);
      expect(verificationQueryClient.getQueryCache().find({ queryKey: levelQueryKey, exact: true })?.isActive()).toBe(true);
    } finally {
      unsubscribe();
    }
  });

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
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await check;

    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated'
    }));
    const savedCredentialTransition = updateLinuxDoSession.mock.calls.find(([event]) => event.type === 'session-updated')?.[0];
    expect(savedCredentialTransition).not.toHaveProperty('recoveryQueryKey');
  });

  it('[REG-VERIFICATION-001] keeps the panel open and lets each settled explicit check retry when verification is still required', async () => {
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
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(500);

    expect(resume).not.toHaveBeenCalled();
    const firstExplicitCheck = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await firstExplicitCheck;

    expect(resume).toHaveBeenCalledTimes(1);
    expect(showLinuxDoPanelRef.current).toBe(true);

    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(1000);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(showLinuxDoPanelRef.current).toBe(true);

    const explicitCheck = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await explicitCheck;

    expect(resume).toHaveBeenCalledTimes(2);
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-ACCOUNT-026] reports visible linux.do logout without deleting the original-site login', async () => {
    vi.useFakeTimers();
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    const check = controller.checkLinuxDoCookie();
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          probeId: 1,
          documentKey: 'https://linux.do/latest:1000',
          status: 'logged-out',
          loggedIn: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(250);
    await check;

    expect(linuxDoMocks.saveLinuxDoAccess).not.toHaveBeenCalled();
    expect(updateLinuxDoSession).toHaveBeenCalledWith({
      type: 'login-expired',
      message: 'linux.do 登录已失效，请重新登录。'
    });
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-ACCOUNT-026] cannot invoke a failing linux.do logout command during verification', async () => {
    vi.useFakeTimers();
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef, updateLinuxDoSession } = createController();

    await controller.showLinuxDoVerification();
    await vi.advanceTimersByTimeAsync(80);
    const check = controller.checkLinuxDoCookie();
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          probeId: 1,
          documentKey: 'https://linux.do/latest:1000',
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
      message: 'linux.do 登录已失效，请重新登录。'
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
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await check;

    expect(resume).toHaveBeenCalledTimes(1);
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('accepts the current WebView clearance and proves success with the resumed read', async () => {
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
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await check;

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
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    const check = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);

    expect(resume).toHaveBeenCalledTimes(1);
    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(updateLinuxDoSession).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-updated',
      recoveryQueryKey: recoveryQueryKeyFor('topic:42')
    }));
    expect(updateLinuxDoSession).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'verification-succeeded' }));

    resumed.resolve('completed');
    await check;
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
    const queuedRequest = controller.showLinuxDoVerification('排队请求', queuedRecovery);
    const latestRequest = controller.showLinuxDoVerification('最新请求', latestRecovery);
    await vi.advanceTimersByTimeAsync(400);
    await expect(queuedRequest).resolves.toBe(false);
    await expect(latestRequest).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(80);

    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(queuedRecovery.resume).not.toHaveBeenCalled();

    await controller.showLinuxDoVerification('排队请求的迟到失败', queuedRecovery);
  });

  it('[REG-ACCOUNT-026] opens queued Level verification without reading or clearing an App snapshot', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('queued storage read failed'));
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    const firstRecovery = {
      queryKey: recoveryQueryKeyFor('feed:closing'),
      resume: vi.fn(async () => 'completed' as const)
    };
    const levelRecovery = {
      queryKey: ['forum', 'linuxdo', 'level', { credential: 0 }] as const,
      resume: vi.fn(async () => 'completed' as const)
    };
    const { controller, showLinuxDoPanelRef } = createController();

    await controller.showLinuxDoVerification('第一个请求', firstRecovery);
    controller.closeLinuxDoPanel();
    const queuedLevel = controller.showLinuxDoVerification('等级需要验证', levelRecovery);
    await vi.advanceTimersByTimeAsync(400);

    await expect(queuedLevel).resolves.toBe(true);
    expect(showLinuxDoPanelRef.current).toBe(true);
    expect(levelRecovery.resume).not.toHaveBeenCalled();
    expect(linuxDoMocks.loadLinuxDoAccess).not.toHaveBeenCalled();
  });

  it('settles the first manual verification queued during panel closing', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({});
    const { controller, showLinuxDoPanelRef } = createController();

    await expect(controller.showLinuxDoVerification()).resolves.toBe(true);
    controller.closeLinuxDoPanel();
    const queuedManual = controller.showLinuxDoVerification('手动重新打开');
    await vi.advanceTimersByTimeAsync(400);

    await expect(queuedManual).resolves.toBe(true);
    expect(showLinuxDoPanelRef.current).toBe(true);
  });

  it('[REG-VERIFICATION-001] never lets a WebView document consume recovery before an explicit user check', async () => {
    vi.useFakeTimers();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores.mockResolvedValue({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    linuxDoMocks.saveLinuxDoAccess.mockResolvedValue({
      cookieHeader: 'COOKIE_VALUE_SECRET',
      savedAt: '2026-07-22T00:00:00.000Z',
      source: 'webview'
    });
    const resume = vi.fn(async () => 'completed' as const);
    const { controller, linuxDoWebViewSessionRef, showLinuxDoPanelRef } = createController();

    await controller.showLinuxDoVerification('等级需要验证', {
      queryKey: recoveryQueryKeyFor('level:challenge-document'),
      resume
    });
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'cloudflare-document',
          challenge: true,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(1000);

    expect(resume).not.toHaveBeenCalled();
    expect(showLinuxDoPanelRef.current).toBe(true);

    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'verified-document',
          challenge: false,
          cookie: 'WEBVIEW_MESSAGE_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    await vi.advanceTimersByTimeAsync(1000);

    expect(resume).not.toHaveBeenCalled();
    expect(showLinuxDoPanelRef.current).toBe(true);

    const explicitCheck = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await explicitCheck;

    expect(resume).toHaveBeenCalledTimes(1);
    expect(showLinuxDoPanelRef.current).toBe(false);
  });

  it('REG-LINUXDO-002 never lets an obsolete Cookie check resume a newer recovery', async () => {
    vi.useFakeTimers();
    const oldCookieRead = Promise.withResolvers<Record<string, { name: string; value: string }>>();
    linuxDoMocks.loadLinuxDoAccess.mockResolvedValue(null);
    linuxDoMocks.readLinuxDoCookiesFromStores
      .mockReturnValueOnce(oldCookieRead.promise)
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
          challenge: false,
          cookie: 'OLD_WEBVIEW_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    const oldCheck = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);

    const showNewer = controller.showLinuxDoVerification('新请求', newerRecovery);
    oldCookieRead.resolve({
      cf_clearance: { name: 'PRIVATE_COOKIE_NAME', value: 'COOKIE_VALUE_SECRET' }
    });
    await oldCheck;
    await vi.advanceTimersByTimeAsync(0);

    expect(oldRecovery.resume).not.toHaveBeenCalled();
    expect(newerRecovery.resume).not.toHaveBeenCalled();

    await showNewer;
    await vi.advanceTimersByTimeAsync(80);
    controller.handleLinuxDoMessage({
      nativeEvent: {
        data: JSON.stringify({
          type: 'linuxdo-webview',
          documentKey: 'new-document',
          challenge: false,
          cookie: 'NEW_WEBVIEW_COOKIE_SECRET',
          userAgent: 'WEBVIEW_MESSAGE_USER_AGENT_SECRET'
        })
      }
    } as never, linuxDoWebViewSessionRef.current);
    const newerCheck = controller.checkLinuxDoCookie();
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await newerCheck;

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
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
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
    await vi.advanceTimersByTimeAsync(LINUXDO_PROBE_TIMEOUT_MS);
    await vi.waitFor(() => expect(linuxDoMocks.readLinuxDoCookiesFromStores).toHaveBeenCalledTimes(1));
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
