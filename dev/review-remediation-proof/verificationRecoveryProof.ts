import { useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
import type WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { useVerificationController } from '@/features/account/useVerificationController';
import type { AccountReconcileResult, LinuxDoReadRecovery } from '@/domain/session/sessionContracts';
import type { ManagedCookieNativeModule } from '@/platform/network/managedCookies';
import { check } from '../proofCheck';

export const verificationRecoveryProofModes = ['cancel-reopen', 'inactive', 'scope-change', 'unmount'] as const;

type RecoveryProof = ReturnType<typeof useRecoveryProbe>;

export async function verifyRecoveryProof(
  mode: (typeof verificationRecoveryProofModes)[number],
  host: {
    hook: (useValue: () => RecoveryProof) => Promise<() => RecoveryProof>;
    unmount: () => void | Promise<void>;
    until: (test: () => unknown, message: string) => Promise<void>;
  }
) {
  const native: ManagedCookieNativeModule | undefined = NativeModules.NetworkProxyModule;
  check(typeof native?.readManagedCookieHeader === 'function', 'Missing Native managed cookie reader');
  const originalCookieRead = native.readManagedCookieHeader;
  let release = () => {};
  const handoff = new Promise<void>((resolve) => {
    release = resolve;
  });
  let handoffStarted = false;
  let resumed = 0;
  const control = {
    active: true,
    scope: 'linuxdo:7:0',
    handoff: async () => {
      handoffStarted = true;
      if (mode !== 'cancel-reopen') await handoff;
    }
  };
  const get = await host.hook(function useValue() {
    return useRecoveryProbe(control);
  });
  const recovery = (): LinuxDoReadRecovery => ({
    queryKey: ['device-proof', mode],
    isCurrent: () => control.active,
    resume: async () => {
      resumed += 1;
      return 'completed';
    }
  });
  let checking: Promise<void> | undefined;
  // Only this private fixture supplies cookies; the real initialization gate still validates the page and header.
  native.readManagedCookieHeader = async (url: string) => {
    check(url === 'https://linux.do/', 'Unexpected recovery cookie URL');
    return { status: 'ok', header: '_t=fixture-auth; _rt=fixture-runtime' };
  };
  try {
    const initialSession = get().readSurface().session;
    check(await get().showLinuxDoVerification('controlled proof', recovery()), 'Verification did not open');
    await host.until(
      () => get().readSurface().visible && get().readSurface().session > initialSession,
      'Verification surface did not become ready'
    );
    if (mode === 'cancel-reopen') {
      const previousSession = get().readSurface().session;
      get().closeLinuxDoPanel();
      check(
        await get().showLinuxDoVerification('controlled reopen', recovery()),
        'Canceled verification could not reopen'
      );
      await host.until(
        () => get().readSurface().visible && get().readSurface().session > previousSession,
        'Reopened verification surface did not become ready'
      );
      get().observeInitializedPage();
      checking = get().checkLinuxDoCookie();
      await checking;
      checking = get().checkLinuxDoCookie();
      await checking;
      check(
        resumed === 1,
        `Current recovery was not resumed exactly once (handoff=${Number(handoffStarted)}, resume=${resumed})`
      );
    } else {
      get().observeInitializedPage();
      checking = get().checkLinuxDoCookie();
      await host.until(() => handoffStarted, 'Cookie handoff not reached');
      if (mode === 'inactive') control.active = false;
      if (mode === 'scope-change') control.scope = 'linuxdo:8:1';
      if (mode === 'unmount') {
        await host.unmount();
        await host.until(() => !get().readSurface().mounted, 'Verification hook did not unmount');
      }
      release();
      await checking;
      check(resumed === 0, 'Invalid recovery resumed its old request');
    }
  } finally {
    try {
      if (get().readSurface().mounted) get().closeLinuxDoPanel();
    } finally {
      release();
      try {
        if (checking) await Promise.allSettled([checking]);
      } finally {
        native.readManagedCookieHeader = originalCookieRead;
      }
    }
  }
}

function useRecoveryProbe(control: { active: boolean; scope: string; handoff: () => Promise<void> }) {
  const visible = useRef(false);
  const mounted = useRef(true);
  const webViewSession = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const controller = useVerificationController({
    awaitLinuxDoCookieHandoff: control.handoff,
    getRecoveryScope: () => control.scope,
    changeNodeSeekLoginPanel: () => undefined,
    checkingRequestIdRef: useRef(0),
    closeYaohuoLoginPanel: () => undefined,
    commitLinuxDoWebViewUserAgent: () => undefined,
    linuxDoWebViewMountTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    linuxDoWebViewRef: useRef<WebView | null>(null),
    linuxDoWebViewSessionRef: webViewSession,
    isLinuxDoSurfaceVisible: () => visible.current,
    notify: () => undefined,
    onLoginWebViewFailure: () => undefined,
    onLinuxDoSurfaceClosed: () => {
      visible.current = false;
    },
    onLinuxDoSurfaceOpened: () => {
      visible.current = true;
    },
    prepareLinuxDoCookieResponseBarrier: async () => undefined,
    reconcileAccountStatus: async (): Promise<AccountReconcileResult> => ({
      status: 'same',
      session: {
        site: 'linuxdo',
        status: 'logged-in',
        cookieSummary: [],
        isVerifying: false,
        currentUser: { source: 'linuxdo', id: '7', username: 'alice', url: 'https://linux.do/u/alice' }
      }
    }),
    setChecking: () => undefined,
    setLinuxDoWebViewError: () => undefined,
    setLinuxDoWebViewKey: () => undefined,
    setLoadingLinuxDoPage: () => undefined,
    setMountLinuxDoWebView: () => undefined,
    updateLinuxDoSession: () => undefined,
    updateNodeSeekSession: () => undefined
  });
  return {
    ...controller,
    readSurface: () => ({ mounted: mounted.current, visible: visible.current, session: webViewSession.current }),
    observeInitializedPage: () => {
      check(mounted.current && visible.current, 'Cannot initialize a closed verification surface');
      controller.handleLinuxDoMessage(
        {
          nativeEvent: {
            url: 'https://linux.do',
            data: JSON.stringify({
              type: 'linuxdo-webview',
              documentKey: `https://linux.do/latest:${webViewSession.current}`,
              userAgent: 'WebView fixture agent',
              status: 'logged-in',
              hasChallengeMarker: false,
              hasSessionInitialization: true
            })
          }
        } as WebViewMessageEvent,
        webViewSession.current
      );
    }
  };
}
