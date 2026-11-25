import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { useState } from 'react';
import type { AuthSurfaceCloseReason } from '@/domain/session/authSurfaceCoordinator';
import type { SessionRuntimeSnapshot } from '@/domain/session/writableSessionGate';

jest.mock('@/platform/android/secureRandom', () => ({
  nativeSecureRandomHex: jest.fn(async () => 'a'.repeat(32))
}));

jest.mock('@/sources/nodeimage/credentials', () => ({
  beginNodeImageApiKeyAuthorization: jest.fn(() => 3),
  clearNodeImageApiKey: jest.fn(async () => true),
  currentNodeImageApiKeyGeneration: jest.fn(() => 3),
  invalidateNodeImageApiKeyAuthorization: jest.fn(),
  loadNodeImageApiKeyCredential: jest.fn(async () => null),
  nodeImageApiKeyUseStatus: jest.fn(() => 'missing'),
  saveNodeImageApiKeyForGeneration: jest.fn(async () => 'saved-key')
}));

import { useNodeImageAuthController } from '@/features/account/useNodeImageAuthController';
import * as nodeImageCredentials from '@/sources/nodeimage/credentials';

function nodeSeekSession() {
  return {
    site: 'nodeseek' as const,
    status: 'logged-in' as const,
    cookieSummary: [],
    isVerifying: false,
    currentUser: {
      source: 'nodeseek' as const,
      id: '42',
      username: 'alice',
      displayName: 'Alice',
      url: 'https://www.nodeseek.com/space/42',
      topics: []
    }
  };
}

async function createControllerHarness(
  options: { webViewBlocked?: boolean; initialRuntime?: Partial<SessionRuntimeSnapshot> } = {}
) {
  const beginSurface = jest.fn(() => ({ generation: 7 }));
  const finishSurface = jest.fn(async (_reason: AuthSurfaceCloseReason) => ({
    status: 'same' as const,
    session: nodeSeekSession()
  }));
  const notify = jest.fn();
  const prepareSurfaceOpen = jest.fn();
  let runtime: SessionRuntimeSnapshot = {
    source: 'nodeseek' as const,
    authenticated: true,
    authSurfaceOpen: true,
    identityKey: 'nodeseek:42',
    identityTrust: 'confirmed' as const,
    sessionEpoch: 5,
    ...options.initialRuntime
  };
  let controls: {
    setSurfaceVisible: (visible: boolean) => void;
    setWebViewBlocked: (blocked: boolean) => void;
  } = {
    setSurfaceVisible: () => undefined,
    setWebViewBlocked: () => undefined
  };
  const readRuntime = jest.fn(() => runtime);
  const reconcileAccountStatus = jest.fn(async () => ({
    status: 'same' as const,
    session: nodeSeekSession()
  }));
  const hook = await renderHook(() => {
    const [surfaceVisible, setSurfaceVisible] = useState(false);
    const [webViewBlocked, setWebViewBlocked] = useState(options.webViewBlocked ?? false);
    controls = { setSurfaceVisible, setWebViewBlocked };
    return useNodeImageAuthController({
      access: runtime,
      beginSurface: () => {
        const ticket = beginSurface();
        setSurfaceVisible(true);
        return ticket;
      },
      finishSurface: (reason) => {
        setSurfaceVisible(false);
        return finishSurface(reason);
      },
      notify,
      prepareSurfaceOpen,
      readRuntime,
      reconcileAccountStatus,
      surfaceVisible,
      webViewBlocked
    });
  });
  return {
    beginSurface,
    finishSurface,
    hook,
    notify,
    prepareSurfaceOpen,
    reconcileAccountStatus,
    setRuntime: (next: Partial<SessionRuntimeSnapshot>) => {
      runtime = { ...runtime, ...next };
    },
    setSurfaceVisible: (visible: boolean) => {
      controls.setSurfaceVisible(visible);
    },
    setWebViewBlocked: (blocked: boolean) => {
      controls.setWebViewBlocked(blocked);
    },
    updateRuntime: async (next: Partial<SessionRuntimeSnapshot>) => {
      runtime = { ...runtime, ...next };
      await hook.rerender(undefined);
    }
  };
}

function useRealNodeImageCredentials(
  options: {
    initialValue?: string | null;
    pauseWriteMatching?: string;
  } = {}
) {
  const actual = jest.requireActual<typeof nodeImageCredentials>('@/sources/nodeimage/credentials');
  const storageKey = actual.NODEIMAGE_API_KEY_STORAGE_KEY;
  const values = new Map<string, string>(options.initialValue ? [[storageKey, options.initialValue]] : []);
  const writeStarted = Promise.withResolvers<void>();
  const allowWriteFinish = Promise.withResolvers<void>();
  let pausedOnce = false;

  jest
    .mocked(nodeImageCredentials.beginNodeImageApiKeyAuthorization)
    .mockImplementation(actual.beginNodeImageApiKeyAuthorization);
  jest.mocked(nodeImageCredentials.clearNodeImageApiKey).mockImplementation(actual.clearNodeImageApiKey);
  jest
    .mocked(nodeImageCredentials.currentNodeImageApiKeyGeneration)
    .mockImplementation(actual.currentNodeImageApiKeyGeneration);
  jest
    .mocked(nodeImageCredentials.invalidateNodeImageApiKeyAuthorization)
    .mockImplementation(actual.invalidateNodeImageApiKeyAuthorization);
  jest
    .mocked(nodeImageCredentials.loadNodeImageApiKeyCredential)
    .mockImplementation(actual.loadNodeImageApiKeyCredential);
  jest.mocked(nodeImageCredentials.nodeImageApiKeyUseStatus).mockImplementation(actual.nodeImageApiKeyUseStatus);
  jest
    .mocked(nodeImageCredentials.saveNodeImageApiKeyForGeneration)
    .mockImplementation(actual.saveNodeImageApiKeyForGeneration);

  const getItemSpy = jest.spyOn(SecureStore, 'getItemAsync').mockImplementation(async (key) => values.get(key) ?? null);
  const setItemSpy = jest.spyOn(SecureStore, 'setItemAsync').mockImplementation(async (key, value) => {
    values.set(key, value);
    if (!pausedOnce && options.pauseWriteMatching && value.includes(options.pauseWriteMatching)) {
      pausedOnce = true;
      writeStarted.resolve();
      await allowWriteFinish.promise;
    }
  });
  const deleteItemSpy = jest.spyOn(SecureStore, 'deleteItemAsync').mockImplementation(async (key) => {
    values.delete(key);
  });

  return {
    allowWriteFinish,
    deleteItemSpy,
    getItemSpy,
    setItemSpy,
    storageKey,
    values,
    writeStarted
  };
}

async function openController() {
  const harness = await createControllerHarness();
  await act(async () => {
    harness.hook.result.current.key.authorize();
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
  });
  return harness;
}

async function sendBridgeMessage(
  hook: Awaited<ReturnType<typeof createControllerHarness>>['hook'],
  sourceUrl: string,
  documentUrl: string,
  type: string,
  data: Record<string, unknown> = {}
) {
  const nonce = hook.result.current.panel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1];
  if (!nonce) {
    throw new Error('NodeImage authorization nonce is unavailable');
  }
  await act(async () => {
    hook.result.current.panel.handleMessage({
      nativeEvent: {
        data: JSON.stringify({
          ...data,
          documentUrl,
          nonce,
          type
        }),
        url: sourceUrl
      }
    } as never);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('NodeImage auth controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(nodeImageCredentials.beginNodeImageApiKeyAuthorization).mockReset().mockReturnValue(3);
    jest.mocked(nodeImageCredentials.clearNodeImageApiKey).mockReset().mockResolvedValue(true);
    jest.mocked(nodeImageCredentials.currentNodeImageApiKeyGeneration).mockReset().mockReturnValue(3);
    jest.mocked(nodeImageCredentials.invalidateNodeImageApiKeyAuthorization).mockReset();
    jest.mocked(nodeImageCredentials.loadNodeImageApiKeyCredential).mockReset().mockResolvedValue(null);
    jest.mocked(nodeImageCredentials.nodeImageApiKeyUseStatus).mockReset().mockReturnValue('missing');
    jest.mocked(nodeImageCredentials.saveNodeImageApiKeyForGeneration).mockReset().mockResolvedValue('saved-key');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each(['load-start', 'load-end', 'error'] as const)(
    'ignores an old document %s callback after entering Connect',
    async (event) => {
      const { hook } = await openController();
      const previous = hook.result.current.panel;
      await sendBridgeMessage(
        hook,
        'https://www.nodeimage.com',
        'https://www.nodeimage.com/',
        'nodeimage-session-expired',
        { status: 401 }
      );
      if (event === 'load-start') {
        await act(async () => hook.result.current.panel.setLoading(false));
      }

      await act(async () => {
        if (event === 'error') previous.fail('late session error');
        else previous.setLoading(event === 'load-start');
      });

      expect(hook.result.current.panel.document?.key).toBe('7:nodeseek-cauth');
      expect(hook.result.current.panel.error).toBe('');
      expect(hook.result.current.panel.loading).toBe(event !== 'load-start');
    }
  );

  it.each([
    { identityKey: 'nodeseek:other' },
    { sessionEpoch: 6 },
    { identityTrust: 'unknown' as const },
    { sourceEnabled: false }
  ])('does not return a credential after its requesting owner changes to %j', async (next) => {
    const harness = await createControllerHarness();
    const credential =
      Promise.withResolvers<Awaited<ReturnType<typeof nodeImageCredentials.loadNodeImageApiKeyCredential>>>();
    jest.mocked(nodeImageCredentials.loadNodeImageApiKeyCredential).mockReturnValueOnce(credential.promise);
    jest.mocked(nodeImageCredentials.nodeImageApiKeyUseStatus).mockReturnValueOnce('usable');
    const ensured = harness.hook.result.current.ensureApiKey();
    harness.setRuntime(next);
    let result: string | null = null;
    await act(async () => {
      credential.resolve({
        version: 1,
        apiKey: 'old-owner-key',
        ownership: { kind: 'verified', identityKey: 'nodeseek:42' }
      });
      result = await ensured;
    });
    expect(result).toBeNull();
    expect(harness.hook.result.current.key.saved).toBe(false);
  });

  it('does not return a credential read before its generation was replaced or its controller unmounted', async () => {
    let generation = 3;
    jest.mocked(nodeImageCredentials.currentNodeImageApiKeyGeneration).mockImplementation(() => generation);
    const { hook } = await createControllerHarness();
    const first =
      Promise.withResolvers<Awaited<ReturnType<typeof nodeImageCredentials.loadNodeImageApiKeyCredential>>>();
    const second =
      Promise.withResolvers<Awaited<ReturnType<typeof nodeImageCredentials.loadNodeImageApiKeyCredential>>>();
    jest
      .mocked(nodeImageCredentials.loadNodeImageApiKeyCredential)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    jest.mocked(nodeImageCredentials.nodeImageApiKeyUseStatus).mockReturnValue('usable');
    const credential = {
      version: 1 as const,
      apiKey: 'replaced-key',
      ownership: { kind: 'verified' as const, identityKey: 'nodeseek:42' }
    };
    const replacedRead = hook.result.current.ensureApiKey();
    generation = 4;
    await act(async () => {
      first.resolve(credential);
      expect(await replacedRead).toBeNull();
    });
    const closedRead = hook.result.current.ensureApiKey();
    await hook.unmount();
    second.resolve(credential);
    expect(await closedRead).toBeNull();
  });

  it('keeps a late startup credential available for clearing without authorizing the replacement account', async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof nodeImageCredentials.loadNodeImageApiKeyCredential>>>();
    jest.mocked(nodeImageCredentials.loadNodeImageApiKeyCredential).mockReturnValueOnce(pending.promise);
    jest
      .mocked(nodeImageCredentials.nodeImageApiKeyUseStatus)
      .mockImplementation(
        jest.requireActual<typeof nodeImageCredentials>('@/sources/nodeimage/credentials').nodeImageApiKeyUseStatus
      );
    const { hook, setRuntime } = await createControllerHarness();
    setRuntime({ authSurfaceOpen: false, identityKey: 'nodeseek:57', sessionEpoch: 6 });
    await act(async () => {
      pending.resolve({
        version: 1,
        apiKey: 'synthetic-retained-key',
        ownership: { kind: 'verified', identityKey: 'nodeseek:42' }
      });
    });
    expect(hook.result.current.key).toMatchObject({ authorized: false, saved: true });
  });

  it('serializes manual save and clear commands and releases the busy state after failure', async () => {
    const write = Promise.withResolvers<string | undefined>();
    jest.mocked(nodeImageCredentials.saveNodeImageApiKeyForGeneration).mockReturnValueOnce(write.promise);
    const { hook, notify } = await createControllerHarness();
    let saved = Promise.resolve();
    await act(async () => {
      saved = hook.result.current.key.save('first-key');
      void hook.result.current.key.save('duplicate-key');
      void hook.result.current.key.clear();
    });
    expect(hook.result.current.key.busy).toBe(true);
    expect(nodeImageCredentials.saveNodeImageApiKeyForGeneration).toHaveBeenCalledTimes(1);
    expect(nodeImageCredentials.clearNodeImageApiKey).not.toHaveBeenCalled();
    await act(async () => {
      write.reject(new Error('storage write failed'));
      await saved;
    });
    expect(hook.result.current.key.busy).toBe(false);
    expect(hook.result.current.key.saved).toBe(false);
    expect(notify).toHaveBeenCalledWith('storage write failed');
    await act(async () => {
      await hook.result.current.key.clear();
    });
    expect(nodeImageCredentials.clearNodeImageApiKey).toHaveBeenCalledTimes(1);
    expect(hook.result.current.key.busy).toBe(false);
  });

  it('keeps one authorization while the successful surface is reconciling and saving', async () => {
    const harness = await openController();
    const { hook, beginSurface, finishSurface } = harness;
    const reconciliation = Promise.withResolvers<Awaited<ReturnType<typeof finishSurface>>>();
    finishSurface.mockReturnValueOnce(reconciliation.promise);
    await sendBridgeMessage(hook, 'https://www.nodeimage.com', 'https://www.nodeimage.com/', 'nodeimage-session-key', {
      apiKey: 'session-key'
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.visible).toBe(false);
    await act(async () => {
      hook.result.current.key.authorize();
      hook.result.current.panel.close();
      hook.result.current.key.authorize();
    });
    expect(beginSurface).toHaveBeenCalledTimes(1);
    expect(finishSurface).toHaveBeenCalledTimes(1);
    expect(nodeImageCredentials.saveNodeImageApiKeyForGeneration).not.toHaveBeenCalled();
    await act(async () => {
      reconciliation.resolve({ status: 'same', session: nodeSeekSession() });
    });
    await waitFor(() => expect(hook.result.current.key.saved).toBe(true));
    expect(nodeImageCredentials.saveNodeImageApiKeyForGeneration).toHaveBeenCalledTimes(1);
    await act(async () => hook.result.current.key.authorize());
    await waitFor(() => expect(beginSurface).toHaveBeenCalledTimes(2));
  });

  it('does not let a closed document fail a new authorization with the same phase', async () => {
    const { hook, beginSurface } = await openController();
    const previous = hook.result.current.panel;
    await act(async () => {
      previous.close();
    });
    await waitFor(() => expect(hook.result.current.panel.visible).toBe(false));
    await act(async () => hook.result.current.key.authorize());
    await waitFor(() => expect(beginSurface).toHaveBeenCalledTimes(2));
    await act(async () => previous.fail('old window error'));
    expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    expect(hook.result.current.panel.error).toBe('');
    expect(hook.result.current.panel.loading).toBe(true);
  });

  it('opens and closes the authorization panel through the account surface', async () => {
    const { beginSurface, finishSurface, hook, prepareSurfaceOpen, reconcileAccountStatus } = await openController();

    await waitFor(() => {
      expect(hook.result.current.panel.visible).toBe(true);
    });
    expect(prepareSurfaceOpen).toHaveBeenCalledTimes(1);
    expect(beginSurface).toHaveBeenCalledTimes(1);
    expect(reconcileAccountStatus).toHaveBeenCalledWith(7);

    await act(async () => {
      hook.result.current.panel.close('close-button');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(hook.result.current.panel.visible).toBe(false);
    });
    expect(finishSurface).toHaveBeenCalledWith('close-button');
  });

  it('settles a stalled session check without starting Connect', async () => {
    jest.useFakeTimers();
    const { hook } = await openController();
    const stopLoading = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      stopLoading
    };

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(stopLoading).toHaveBeenCalledTimes(1);
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.loading).toBe(false);
    expect(hook.result.current.panel.error).toContain('本次未发起 NodeSeek Connect');
  });

  it('distinguishes a Connect timeout before the quota call starts', async () => {
    jest.useFakeTimers();
    const { hook } = await openController();

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    expect(hook.result.current.panel.document?.key).toBe('7:nodeseek-cauth');

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toContain('本次未发起连接');
    expect(hook.result.current.panel.error).not.toContain('未占用');
  });

  it('reports an unknown Connect result after the one quota call starts', async () => {
    jest.useFakeTimers();
    const { hook } = await openController();
    const postMessage = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      postMessage,
      stopLoading: jest.fn()
    };

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-connect-ready'
    );
    expect(postMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toContain('结果未知');
    expect(hook.result.current.panel.error).toContain('可能已占用一次连接额度');
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('settles a stalled NodeImage verification phase', async () => {
    jest.useFakeTimers();
    const { hook } = await openController();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      postMessage: jest.fn(),
      stopLoading: jest.fn()
    };

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-connect-ready'
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-auth-data',
      { data: 'auth-data', sign: 'auth-sign', wtf: 'auth-wtf' }
    );
    expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-verify');

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toContain('API Key 结果未知');
  });

  it('does not start the stage 1 timeout while WebView mount is blocked and starts a full 30s timer only after unblock', async () => {
    jest.useFakeTimers();
    const harness = await createControllerHarness({ webViewBlocked: true });
    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(harness.hook.result.current.panel.visible).toBe(true);
    expect(harness.hook.result.current.panel.document).toBeNull();
    expect(harness.hook.result.current.panel.error).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(30_001);
      await Promise.resolve();
    });
    expect(harness.hook.result.current.panel.document).toBeNull();
    expect(harness.hook.result.current.panel.error).toBe('');

    await act(async () => {
      harness.setWebViewBlocked(false);
      await Promise.resolve();
    });
    expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    expect(harness.hook.result.current.panel.error).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(29_999);
      await Promise.resolve();
    });
    expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    expect(harness.hook.result.current.panel.error).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(harness.hook.result.current.panel.document).toBeNull();
    expect(harness.hook.result.current.panel.error).toContain('本次未发起 NodeSeek Connect');
  });

  it('invalidates stage 1 timer on mid-flow block, ignores stale callbacks, and resumes cleanly after unblock', async () => {
    jest.useFakeTimers();
    const harness = await openController();
    const { hook } = harness;
    const stopLoading = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = { stopLoading };
    const beforeBlockPanel = hook.result.current.panel;
    const nonce = beforeBlockPanel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1] || '';

    await act(async () => {
      jest.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    await act(async () => {
      harness.setWebViewBlocked(true);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      beforeBlockPanel.fail('late stage 1 error');
      beforeBlockPanel.setLoading(false);
      beforeBlockPanel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            apiKey: 'stale-session-key',
            documentUrl: 'https://www.nodeimage.com/',
            nonce,
            type: 'nodeimage-session-key'
          }),
          url: 'https://www.nodeimage.com'
        }
      } as never);
      jest.advanceTimersByTime(30_001);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.error).toBe('');
    expect(harness.finishSurface).not.toHaveBeenCalled();

    await act(async () => {
      harness.setWebViewBlocked(false);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document?.url).toBe('https://www.nodeimage.com/');
    expect(hook.result.current.panel.document?.key).not.toBe(beforeBlockPanel.document?.key);
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      beforeBlockPanel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            apiKey: 'stale-after-remount-key',
            documentUrl: 'https://www.nodeimage.com/',
            nonce,
            type: 'nodeimage-session-key'
          }),
          url: 'https://www.nodeimage.com'
        }
      } as never);
      jest.advanceTimersByTime(29_999);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document?.url).toBe('https://www.nodeimage.com/');
    expect(hook.result.current.panel.error).toBe('');
    expect(harness.finishSurface).not.toHaveBeenCalled();

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    expect(hook.result.current.panel.document?.key).toBe('7:nodeseek-cauth');
    expect(hook.result.current.panel.error).toBe('');
  });

  it('delays stage 2 timeout until mount and resumes pre-dispatch Connect after mid-flow block without extra dispatch', async () => {
    jest.useFakeTimers();
    const harness = await openController();
    const { hook } = harness;
    const postMessage = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      postMessage,
      stopLoading: jest.fn()
    };
    const stage1Nonce =
      hook.result.current.panel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1] || '';

    await act(async () => {
      hook.result.current.panel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            documentUrl: 'https://www.nodeimage.com/',
            nonce: stage1Nonce,
            status: 401,
            type: 'nodeimage-session-expired'
          }),
          url: 'https://www.nodeimage.com'
        }
      } as never);
      harness.setWebViewBlocked(true);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(60_001);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      harness.setWebViewBlocked(false);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document?.key).toBe('7:nodeseek-cauth');
    const beforeBlockPanel = hook.result.current.panel;

    await act(async () => {
      jest.advanceTimersByTime(40_000);
      await Promise.resolve();
    });
    await act(async () => {
      harness.setWebViewBlocked(true);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();

    await act(async () => {
      beforeBlockPanel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
            nonce: stage1Nonce,
            type: 'nodeimage-connect-ready'
          }),
          url: 'https://www.nodeseek.com'
        }
      } as never);
      jest.advanceTimersByTime(60_001);
      await Promise.resolve();
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      harness.setWebViewBlocked(false);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document?.url).toBe('https://www.nodeseek.com/connect?target=NodeImage');
    expect(hook.result.current.panel.document?.key).not.toBe(beforeBlockPanel.document?.key);

    await act(async () => {
      beforeBlockPanel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
            nonce: stage1Nonce,
            type: 'nodeimage-connect-ready'
          }),
          url: 'https://www.nodeseek.com'
        }
      } as never);
      jest.advanceTimersByTime(59_999);
      await Promise.resolve();
    });
    expect(postMessage).not.toHaveBeenCalled();
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toContain('本次未发起连接');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'surface-hidden', 'render-process-gone'] as const)(
    'retains unknown-result state and avoids remounting or duplicate Connect after %s interruption once Connect started',
    async (interruption) => {
      jest.useFakeTimers();
      const harness = await openController();
      const { hook } = harness;
      const postMessage = jest.fn();
      (hook.result.current.panel.webViewRef as { current: unknown }).current = {
        postMessage,
        stopLoading: jest.fn()
      };

      await sendBridgeMessage(
        hook,
        'https://www.nodeimage.com',
        'https://www.nodeimage.com/',
        'nodeimage-session-expired',
        { status: 401 }
      );
      const beforeInterruptPanel = hook.result.current.panel;
      const nonce =
        beforeInterruptPanel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1] || '';
      await sendBridgeMessage(
        hook,
        'https://www.nodeseek.com',
        'https://www.nodeseek.com/connect?target=NodeImage',
        'nodeimage-connect-ready'
      );
      expect(postMessage).toHaveBeenCalledTimes(1);

      await act(async () => {
        if (interruption === 'blocked') harness.setWebViewBlocked(true);
        else if (interruption === 'surface-hidden') harness.setSurfaceVisible(false);
        else beforeInterruptPanel.fail('NodeImage 授权页面已停止，请关闭后重试。');
        await Promise.resolve();
      });
      expect(hook.result.current.panel.document).toBeNull();
      expect(hook.result.current.panel.error).toContain('结果未知');
      expect(hook.result.current.panel.error).toContain('可能已占用一次连接额度');
      const errorBeforeAdvance = hook.result.current.panel.error;

      await act(async () => {
        jest.advanceTimersByTime(60_001);
        await Promise.resolve();
      });
      expect(hook.result.current.panel.error).toBe(errorBeforeAdvance);

      await act(async () => {
        if (interruption === 'blocked') harness.setWebViewBlocked(false);
        else if (interruption === 'surface-hidden') harness.setSurfaceVisible(true);
        await Promise.resolve();
      });
      expect(hook.result.current.panel.document).toBeNull();
      expect(hook.result.current.panel.error).toBe(errorBeforeAdvance);

      await act(async () => {
        beforeInterruptPanel.handleMessage({
          nativeEvent: {
            data: JSON.stringify({
              documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
              nonce,
              type: 'nodeimage-connect-ready'
            }),
            url: 'https://www.nodeseek.com'
          }
        } as never);
        beforeInterruptPanel.handleMessage({
          nativeEvent: {
            data: JSON.stringify({
              data: 'late-data',
              documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
              nonce,
              sign: 'late-sign',
              type: 'nodeimage-auth-data',
              wtf: 'late-wtf'
            }),
            url: 'https://www.nodeseek.com'
          }
        } as never);
        await Promise.resolve();
      });
      expect(hook.result.current.panel.document).toBeNull();
      expect(postMessage).toHaveBeenCalledTimes(1);
    }
  );

  it('delays stage 3 verify timeout when blocked before mount and starts 30s only after mount', async () => {
    jest.useFakeTimers();
    const harness = await openController();
    const { hook } = harness;
    const postMessage = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      postMessage,
      stopLoading: jest.fn()
    };

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-connect-ready'
    );
    const nonce =
      hook.result.current.panel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1] || '';

    await act(async () => {
      hook.result.current.panel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            data: 'auth-data',
            documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
            nonce,
            sign: 'auth-sign',
            type: 'nodeimage-auth-data',
            wtf: 'auth-wtf'
          }),
          url: 'https://www.nodeseek.com'
        }
      } as never);
      harness.setWebViewBlocked(true);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(30_001);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      harness.setWebViewBlocked(false);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-verify');

    await act(async () => {
      jest.advanceTimersByTime(29_999);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-verify');
    expect(hook.result.current.panel.error).toBe('');

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toContain('API Key 结果未知');
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['blocked', 'surface-hidden', 'render-process-gone'] as const)(
    'retains unknown-result state without remounting when final verification page is interrupted by %s after mount',
    async (interruption) => {
      jest.useFakeTimers();
      const harness = await openController();
      const { hook } = harness;
      const postMessage = jest.fn();
      (hook.result.current.panel.webViewRef as { current: unknown }).current = {
        postMessage,
        stopLoading: jest.fn()
      };

      await sendBridgeMessage(
        hook,
        'https://www.nodeimage.com',
        'https://www.nodeimage.com/',
        'nodeimage-session-expired',
        { status: 401 }
      );
      await sendBridgeMessage(
        hook,
        'https://www.nodeseek.com',
        'https://www.nodeseek.com/connect?target=NodeImage',
        'nodeimage-connect-ready'
      );
      await sendBridgeMessage(
        hook,
        'https://www.nodeseek.com',
        'https://www.nodeseek.com/connect?target=NodeImage',
        'nodeimage-auth-data',
        { data: 'auth-data', sign: 'auth-sign', wtf: 'auth-wtf' }
      );
      expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-verify');
      const beforeInterruptPanel = hook.result.current.panel;
      const nonce =
        beforeInterruptPanel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1] || '';

      await act(async () => {
        if (interruption === 'blocked') harness.setWebViewBlocked(true);
        else if (interruption === 'surface-hidden') harness.setSurfaceVisible(false);
        else beforeInterruptPanel.fail('NodeImage 授权页面已停止，请关闭后重试。');
        await Promise.resolve();
      });
      expect(hook.result.current.panel.document).toBeNull();
      expect(hook.result.current.panel.error).toContain('API Key 结果未知');
      const errorBeforeAdvance = hook.result.current.panel.error;

      await act(async () => {
        jest.advanceTimersByTime(30_001);
        await Promise.resolve();
      });
      expect(hook.result.current.panel.error).toBe(errorBeforeAdvance);

      await act(async () => {
        if (interruption === 'blocked') harness.setWebViewBlocked(false);
        else if (interruption === 'surface-hidden') harness.setSurfaceVisible(true);
        await Promise.resolve();
      });
      expect(hook.result.current.panel.document).toBeNull();
      expect(hook.result.current.panel.error).toBe(errorBeforeAdvance);

      await act(async () => {
        beforeInterruptPanel.handleMessage({
          nativeEvent: {
            data: JSON.stringify({
              apiKey: 'late-verify-key',
              documentUrl: 'https://www.nodeimage.com/',
              nonce,
              type: 'nodeimage-api-key'
            }),
            url: 'https://www.nodeimage.com'
          }
        } as never);
        await Promise.resolve();
      });
      expect(nodeImageCredentials.saveNodeImageApiKeyForGeneration).not.toHaveBeenCalled();
      expect(harness.finishSurface).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledTimes(1);
    }
  );

  it('invalidates timers on close while blocked and does not remount after later unblock', async () => {
    jest.useFakeTimers();
    const harness = await createControllerHarness({ webViewBlocked: true });
    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(harness.hook.result.current.panel.document).toBeNull();

    await act(async () => {
      harness.hook.result.current.panel.close('close-button');
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      harness.setWebViewBlocked(false);
      jest.advanceTimersByTime(60_001);
      await Promise.resolve();
    });

    expect(harness.finishSurface).toHaveBeenCalledWith('close-button');
    expect(harness.hook.result.current.panel.document).toBeNull();
    expect(harness.hook.result.current.panel.error).toBe('');
  });

  it.each([
    {
      name: 'account switch while blocked in stage 1',
      stage: 'blocked-stage1' as const,
      change: { identityKey: 'nodeseek:99', sessionEpoch: 6 }
    },
    {
      name: 'session epoch change while mounted in stage 2 before Connect',
      stage: 'stage2-awaiting' as const,
      change: { sessionEpoch: 6 }
    },
    {
      name: 'account switch after Connect dispatched',
      stage: 'stage2-started' as const,
      change: { identityKey: 'nodeseek:99', sessionEpoch: 6 }
    },
    {
      name: 'unknown identity after stage 3 verify mounted',
      stage: 'stage3-mounted' as const,
      change: { identityTrust: 'unknown' as const }
    }
  ])(
    'invalidates active flow and timers on $name without remounting or saving stale keys',
    async ({ stage, change }) => {
      jest.useFakeTimers();
      const postMessage = jest.fn();
      const harness =
        stage === 'blocked-stage1' ? await createControllerHarness({ webViewBlocked: true }) : await openController();
      const { hook } = harness;
      (hook.result.current.panel.webViewRef as { current: unknown }).current = {
        postMessage,
        stopLoading: jest.fn()
      };

      if (stage === 'blocked-stage1') {
        await act(async () => {
          hook.result.current.key.authorize();
          await Promise.resolve();
          await Promise.resolve();
        });
      } else {
        await sendBridgeMessage(
          hook,
          'https://www.nodeimage.com',
          'https://www.nodeimage.com/',
          'nodeimage-session-expired',
          { status: 401 }
        );
        if (stage === 'stage2-started' || stage === 'stage3-mounted') {
          await sendBridgeMessage(
            hook,
            'https://www.nodeseek.com',
            'https://www.nodeseek.com/connect?target=NodeImage',
            'nodeimage-connect-ready'
          );
        }
        if (stage === 'stage3-mounted') {
          await sendBridgeMessage(
            hook,
            'https://www.nodeseek.com',
            'https://www.nodeseek.com/connect?target=NodeImage',
            'nodeimage-auth-data',
            { data: 'auth-data', sign: 'auth-sign', wtf: 'auth-wtf' }
          );
        }
      }
      const beforeSwitchPanel = hook.result.current.panel;
      const nonce =
        beforeSwitchPanel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1] || 'a'.repeat(32);

      await harness.updateRuntime(change);
      expect(hook.result.current.panel.document).toBeNull();
      expect(hook.result.current.panel.error).not.toBe('');
      if (stage === 'stage2-started' || stage === 'stage3-mounted') {
        expect(hook.result.current.panel.error).toContain('结果未知');
      }
      const errorAfterSwitch = hook.result.current.panel.error;

      await act(async () => {
        if (stage === 'blocked-stage1') harness.setWebViewBlocked(false);
        jest.advanceTimersByTime(60_001);
        beforeSwitchPanel.handleMessage({
          nativeEvent: {
            data: JSON.stringify({
              apiKey: 'wrong-account-key',
              documentUrl: 'https://www.nodeimage.com/',
              nonce,
              type: 'nodeimage-api-key'
            }),
            url: 'https://www.nodeimage.com'
          }
        } as never);
        beforeSwitchPanel.handleMessage({
          nativeEvent: {
            data: JSON.stringify({
              documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
              nonce,
              type: 'nodeimage-connect-ready'
            }),
            url: 'https://www.nodeseek.com'
          }
        } as never);
        await Promise.resolve();
      });

      expect(hook.result.current.panel.document).toBeNull();
      expect(hook.result.current.panel.error).toBe(errorAfterSwitch);
      expect(nodeImageCredentials.saveNodeImageApiKeyForGeneration).not.toHaveBeenCalled();
      expect(postMessage).toHaveBeenCalledTimes(stage === 'stage2-started' || stage === 'stage3-mounted' ? 1 : 0);
    }
  );

  it.each([
    { name: 'account switch', change: { identityKey: 'nodeseek:99', sessionEpoch: 6 } },
    { name: 'session epoch change', change: { sessionEpoch: 6 } },
    { name: 'unconfirmed identity trust', change: { identityTrust: 'unknown' as const } },
    { name: 'source disabled', change: { sourceEnabled: false } }
  ])('preserves the Connect-completed, unverified notice on $name before stage 3 mounts', async ({ change }) => {
    jest.useFakeTimers();
    const harness = await openController();
    const { hook } = harness;
    const postMessage = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      postMessage,
      stopLoading: jest.fn()
    };

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-connect-ready'
    );
    expect(postMessage).toHaveBeenCalledTimes(1);
    const beforeBlockPanel = hook.result.current.panel;
    const nonce = beforeBlockPanel.document?.injectedJavaScript.match(/const nonce = "([0-9a-f]{32})";/)?.[1] || '';

    await act(async () => {
      beforeBlockPanel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            data: 'auth-data',
            documentUrl: 'https://www.nodeseek.com/connect?target=NodeImage',
            nonce,
            sign: 'auth-sign',
            type: 'nodeimage-auth-data',
            wtf: 'auth-wtf'
          }),
          url: 'https://www.nodeseek.com'
        }
      } as never);
      harness.setWebViewBlocked(true);
      await Promise.resolve();
    });
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toBe('');

    await harness.updateRuntime(change);
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toContain('Connect 已完成');
    expect(hook.result.current.panel.error).toContain('最终验证尚未发送');
    expect(hook.result.current.panel.error).not.toContain('请关闭后重试');
    expect(hook.result.current.panel.error).not.toContain('API Key 结果未知');
    const errorAfterSwitch = hook.result.current.panel.error;

    await act(async () => {
      harness.setWebViewBlocked(false);
      jest.advanceTimersByTime(60_001);
      beforeBlockPanel.handleMessage({
        nativeEvent: {
          data: JSON.stringify({
            apiKey: 'wrong-account-key',
            documentUrl: 'https://www.nodeimage.com/',
            nonce,
            type: 'nodeimage-api-key'
          }),
          url: 'https://www.nodeimage.com'
        }
      } as never);
      await Promise.resolve();
    });

    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toBe(errorAfterSwitch);
    expect(nodeImageCredentials.saveNodeImageApiKeyForGeneration).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: 'account switch', change: { identityKey: 'nodeseek:99', sessionEpoch: 6 } },
    { name: 'session epoch change', change: { sessionEpoch: 6 } }
  ])('keeps the unknown-result warning on $name after stage 3 mounts', async ({ change }) => {
    jest.useFakeTimers();
    const harness = await openController();
    const { hook } = harness;
    const postMessage = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      postMessage,
      stopLoading: jest.fn()
    };

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-connect-ready'
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-auth-data',
      { data: 'auth-data', sign: 'auth-sign', wtf: 'auth-wtf' }
    );
    expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-verify');

    await harness.updateRuntime(change);
    expect(hook.result.current.panel.document).toBeNull();
    expect(hook.result.current.panel.error).toContain('Connect 已完成');
    expect(hook.result.current.panel.error).toContain('API Key 结果未知');
    expect(hook.result.current.panel.error).not.toContain('最终验证尚未发送');
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('rolls back an in-flight SecureStore write and keeps storage empty when NodeSeek source is disabled (prior empty)', async () => {
    const store = useRealNodeImageCredentials({
      initialValue: null,
      pauseWriteMatching: 'stale-empty-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'stale-empty-key' }
    );
    await store.writeStarted.promise;

    await harness.updateRuntime({ sourceEnabled: false });
    await act(async () => {
      store.allowWriteFinish.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage 授权结果未保存：NodeSeek 来源已停用');
    });
    expect(store.values.get(store.storageKey)).toBeUndefined();
    expect(harness.hook.result.current.key.saved).toBe(false);
    expect(harness.hook.result.current.key.authorized).toBe(false);
    expect(harness.notify).not.toHaveBeenCalledWith('NodeImage API Key 已保存');
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('rolls back an in-flight SecureStore write to the prior existing key when NodeSeek source is disabled', async () => {
    const priorCredential = JSON.stringify({
      apiKey: 'prior-existing-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    const store = useRealNodeImageCredentials({
      initialValue: priorCredential,
      pauseWriteMatching: 'stale-overwrite-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    await waitFor(() => expect(harness.hook.result.current.key.saved).toBe(true));

    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'stale-overwrite-key' }
    );
    await store.writeStarted.promise;

    await harness.updateRuntime({ sourceEnabled: false });
    await act(async () => {
      store.allowWriteFinish.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage 授权结果未保存：NodeSeek 来源已停用');
    });
    expect(store.values.get(store.storageKey)).toBe(priorCredential);
    expect(harness.hook.result.current.key.saved).toBe(true);
    expect(harness.hook.result.current.key.authorized).toBe(false);
    expect(harness.notify).not.toHaveBeenCalledWith('NodeImage API Key 已保存');
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('preserves a newer key written directly to SecureStore during the paused write when source is disabled', async () => {
    const priorCredential = JSON.stringify({
      apiKey: 'prior-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    const newerCredential = JSON.stringify({
      apiKey: 'newer-concurrent-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    const store = useRealNodeImageCredentials({
      initialValue: priorCredential,
      pauseWriteMatching: 'stale-paused-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    await waitFor(() => expect(harness.hook.result.current.key.saved).toBe(true));

    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'stale-paused-key' }
    );
    await store.writeStarted.promise;

    await harness.updateRuntime({ sourceEnabled: false });
    store.values.set(store.storageKey, newerCredential);
    await act(async () => {
      store.allowWriteFinish.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage 授权结果未保存：NodeSeek 来源已停用');
    });
    expect(store.values.get(store.storageKey)).toBe(newerCredential);
    expect(harness.hook.result.current.key.saved).toBe(true);
    expect(harness.hook.result.current.key.authorized).toBe(false);
    expect(harness.notify).not.toHaveBeenCalledWith('NodeImage API Key 已保存');
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('preserves a newer authorized key saved via controller after disable and re-enable during the paused write', async () => {
    const priorCredential = JSON.stringify({
      apiKey: 'prior-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    const store = useRealNodeImageCredentials({
      initialValue: priorCredential,
      pauseWriteMatching: 'stale-auth-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    await waitFor(() => expect(harness.hook.result.current.key.saved).toBe(true));

    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'stale-auth-key' }
    );
    await store.writeStarted.promise;

    await harness.updateRuntime({ sourceEnabled: false });
    await harness.updateRuntime({ sourceEnabled: true });

    let newerSave = Promise.resolve();
    await act(async () => {
      newerSave = harness.hook.result.current.key.save('newer-manual-key');
      await Promise.resolve();
    });

    await act(async () => {
      store.allowWriteFinish.resolve();
      await newerSave;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(JSON.parse(store.values.get(store.storageKey) || '{}')).toMatchObject({
      apiKey: 'newer-manual-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    await waitFor(() => {
      expect(harness.hook.result.current.key).toMatchObject({ authorized: true, saved: true });
    });
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.notify).toHaveBeenCalledWith('NodeImage API Key 已保存');
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('preserves a newer authorized key from a second auth flow started after disable -> re-enable during the paused write', async () => {
    const priorCredential = JSON.stringify({
      apiKey: 'prior-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    const store = useRealNodeImageCredentials({
      initialValue: priorCredential,
      pauseWriteMatching: 'stale-flow1-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    await waitFor(() => expect(harness.hook.result.current.key.saved).toBe(true));

    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'stale-flow1-key' }
    );
    await store.writeStarted.promise;

    await harness.updateRuntime({ sourceEnabled: false });
    await harness.updateRuntime({ sourceEnabled: true });

    // Start and finish Flow 2 while Flow 1's SecureStore write is still paused.
    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });
    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'flow2-newer-key' }
    );

    await act(async () => {
      store.allowWriteFinish.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage API Key 已保存');
    });
    expect(JSON.parse(store.values.get(store.storageKey) || '{}')).toMatchObject({
      apiKey: 'flow2-newer-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    expect(harness.hook.result.current.key).toMatchObject({ authorized: true, saved: true });
    expect(harness.notify).toHaveBeenCalledTimes(1);
    expect(harness.beginSurface).toHaveBeenCalledTimes(2);
    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(2);
    expect(harness.finishSurface).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: 'empty prior storage', initialValue: null },
    {
      name: 'existing prior key',
      initialValue: JSON.stringify({
        apiKey: 'prior-retained-key',
        ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
        version: 1
      })
    }
  ])(
    'keeps an invalidated flow permanently dead after immediate disable -> re-enable during paused SecureStore write ($name)',
    async ({ initialValue }) => {
      const store = useRealNodeImageCredentials({
        initialValue,
        pauseWriteMatching: 'stale-reenable-key'
      });
      const harness = await createControllerHarness({
        initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
      });
      if (initialValue) {
        await waitFor(() => expect(harness.hook.result.current.key.saved).toBe(true));
      }

      await act(async () => {
        harness.hook.result.current.key.authorize();
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
      });

      await sendBridgeMessage(
        harness.hook,
        'https://www.nodeimage.com',
        'https://www.nodeimage.com/',
        'nodeimage-session-key',
        { apiKey: 'stale-reenable-key' }
      );
      await store.writeStarted.promise;

      // Disable then immediately re-enable before the paused write finishes.
      await harness.updateRuntime({ sourceEnabled: false });
      await harness.updateRuntime({ sourceEnabled: true });

      await act(async () => {
        store.allowWriteFinish.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(harness.notify).toHaveBeenCalledWith('NodeImage 授权结果未保存：NodeSeek 来源已停用');
      });
      expect(store.values.get(store.storageKey)).toBe(initialValue ?? undefined);
      expect(harness.hook.result.current.key.saved).toBe(Boolean(initialValue));
      expect(harness.hook.result.current.key.authorized).toBe(Boolean(initialValue));
      expect(harness.notify).not.toHaveBeenCalledWith('NodeImage API Key 已保存');
      expect(harness.beginSurface).toHaveBeenCalledTimes(1);
      expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
      expect(harness.finishSurface).toHaveBeenCalledTimes(1);

      // A subsequent fresh authorization after re-enable succeeds normally.
      await act(async () => {
        harness.hook.result.current.key.authorize();
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
      });
      await sendBridgeMessage(
        harness.hook,
        'https://www.nodeimage.com',
        'https://www.nodeimage.com/',
        'nodeimage-session-key',
        { apiKey: 'fresh-authorized-key' }
      );
      await waitFor(() => {
        expect(harness.notify).toHaveBeenCalledWith('NodeImage API Key 已保存');
      });
      expect(JSON.parse(store.values.get(store.storageKey) || '{}')).toMatchObject({
        apiKey: 'fresh-authorized-key',
        ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
        version: 1
      });
      expect(harness.beginSurface).toHaveBeenCalledTimes(2);
      expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(2);
      expect(harness.finishSurface).toHaveBeenCalledTimes(2);
    }
  );

  it('skips SecureStore write entirely when source is disabled and immediately re-enabled during finish reconciliation', async () => {
    const store = useRealNodeImageCredentials({ initialValue: null });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    const reconciliation = Promise.withResolvers<Awaited<ReturnType<typeof harness.finishSurface>>>();
    harness.finishSurface.mockReturnValueOnce(reconciliation.promise);

    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'blocked-before-write-key' }
    );

    await harness.updateRuntime({ sourceEnabled: false });
    await harness.updateRuntime({ sourceEnabled: true });

    await act(async () => {
      reconciliation.resolve({ status: 'same', session: nodeSeekSession() });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage 授权结果未保存：NodeSeek 来源已停用');
    });
    expect(store.setItemSpy).not.toHaveBeenCalled();
    expect(store.values.get(store.storageKey)).toBeUndefined();
    expect(harness.hook.result.current.key.saved).toBe(false);
    expect(harness.notify).not.toHaveBeenCalledWith('NodeImage API Key 已保存');
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('blocks publishing success state at the post-write boundary if source was disabled before settlement publishes', async () => {
    const write = Promise.withResolvers<string | undefined>();
    jest.mocked(nodeImageCredentials.saveNodeImageApiKeyForGeneration).mockReturnValueOnce(write.promise);
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });

    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'post-write-blocked-key' }
    );
    await waitFor(() => {
      expect(nodeImageCredentials.saveNodeImageApiKeyForGeneration).toHaveBeenCalledTimes(1);
    });

    await harness.updateRuntime({ sourceEnabled: false });
    await harness.updateRuntime({ sourceEnabled: true });

    await act(async () => {
      write.resolve('post-write-blocked-key');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage 授权结果未保存：NodeSeek 来源已停用');
    });
    expect(harness.hook.result.current.key.saved).toBe(false);
    expect(harness.hook.result.current.key.authorized).toBe(false);
    expect(harness.notify).not.toHaveBeenCalledWith('NodeImage API Key 已保存');
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('never leaves a persisted key paired with an unsaved toast when source is disabled in the post-write microtask gap during auth settlement', async () => {
    const store = useRealNodeImageCredentials({
      initialValue: null,
      pauseWriteMatching: 'microtask-gap-auth-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });

    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'microtask-gap-auth-key' }
    );
    await store.writeStarted.promise;

    await act(async () => {
      store.allowWriteFinish.resolve();
      await Promise.resolve();
      await Promise.resolve();
      // Fires right after the write-gate task returns apiKey and before credentialWriteGate / finish() resumes.
      harness.setRuntime({ sourceEnabled: false });
      harness.hook.result.current.panel.close('source-disabled');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const persistedRaw = store.values.get(store.storageKey);
    const notifiedMessages = harness.notify.mock.calls.map(([message]) => String(message));
    if (persistedRaw) {
      expect(JSON.parse(persistedRaw)).toMatchObject({ apiKey: 'microtask-gap-auth-key' });
      expect(notifiedMessages).toEqual(['NodeImage API Key 已保存']);
      expect(harness.hook.result.current.key.saved).toBe(true);
    } else {
      expect(notifiedMessages).toEqual(['NodeImage 授权结果未保存：NodeSeek 来源已停用']);
      expect(harness.hook.result.current.key.saved).toBe(false);
    }
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('never leaves a persisted key paired with an unsaved toast when source is disabled in the post-write microtask gap during manual save', async () => {
    const store = useRealNodeImageCredentials({
      initialValue: null,
      pauseWriteMatching: 'microtask-gap-manual-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });

    let manualSave = Promise.resolve();
    await act(async () => {
      manualSave = harness.hook.result.current.key.save('microtask-gap-manual-key');
      await Promise.resolve();
    });
    await store.writeStarted.promise;

    await act(async () => {
      store.allowWriteFinish.resolve();
      await Promise.resolve();
      await Promise.resolve();
      // Fires right after the write-gate task returns apiKey and before credentialWriteGate / save() resumes.
      harness.setRuntime({ sourceEnabled: false });
      nodeImageCredentials.invalidateNodeImageApiKeyAuthorization();
      await manualSave;
    });

    const persistedRaw = store.values.get(store.storageKey);
    const notifiedMessages = harness.notify.mock.calls.map(([message]) => String(message));
    if (persistedRaw) {
      expect(JSON.parse(persistedRaw)).toMatchObject({ apiKey: 'microtask-gap-manual-key' });
      expect(notifiedMessages).toEqual(['NodeImage API Key 已保存']);
      expect(harness.hook.result.current.key.saved).toBe(true);
    } else {
      expect(notifiedMessages).toEqual(['NodeImage API Key 未保存：NodeSeek 来源已停用']);
      expect(harness.hook.result.current.key.saved).toBe(false);
    }
  });

  it('revokes settling flow via close("source-disabled") without firing duplicate finishSurface calls', async () => {
    const store = useRealNodeImageCredentials({
      initialValue: null,
      pauseWriteMatching: 'stale-close-disabled-key'
    });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    await act(async () => {
      harness.hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(harness.hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      harness.hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-key',
      { apiKey: 'stale-close-disabled-key' }
    );
    await store.writeStarted.promise;

    await act(async () => {
      harness.hook.result.current.panel.close('source-disabled');
      store.allowWriteFinish.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage 授权结果未保存：NodeSeek 来源已停用');
    });
    expect(store.values.get(store.storageKey)).toBeUndefined();
    expect(harness.hook.result.current.key.saved).toBe(false);
    expect(harness.notify).not.toHaveBeenCalledWith('NodeImage API Key 已保存');
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });

  it('completes a normal 3-stage Connect authorization and persists the verified key in SecureStore', async () => {
    const store = useRealNodeImageCredentials({ initialValue: null });
    const harness = await createControllerHarness({
      initialRuntime: { authSurfaceOpen: false, sourceEnabled: true }
    });
    const { hook } = harness;
    const postMessage = jest.fn();
    (hook.result.current.panel.webViewRef as { current: unknown }).current = {
      postMessage,
      stopLoading: jest.fn()
    };

    await act(async () => {
      hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
    });

    await sendBridgeMessage(
      hook,
      'https://www.nodeimage.com',
      'https://www.nodeimage.com/',
      'nodeimage-session-expired',
      { status: 401 }
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-connect-ready'
    );
    await sendBridgeMessage(
      hook,
      'https://www.nodeseek.com',
      'https://www.nodeseek.com/connect?target=NodeImage',
      'nodeimage-auth-data',
      { data: 'auth-data', sign: 'auth-sign', wtf: 'auth-wtf' }
    );
    await sendBridgeMessage(hook, 'https://www.nodeimage.com', 'https://www.nodeimage.com/', 'nodeimage-api-key', {
      apiKey: 'connect-verified-key'
    });

    await waitFor(() => {
      expect(harness.notify).toHaveBeenCalledWith('NodeImage API Key 已保存');
    });
    expect(JSON.parse(store.values.get(store.storageKey) || '{}')).toEqual({
      apiKey: 'connect-verified-key',
      ownership: { kind: 'verified', identityKey: 'nodeseek:42' },
      version: 1
    });
    expect(hook.result.current.key).toMatchObject({ authorized: true, saved: true });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(harness.beginSurface).toHaveBeenCalledTimes(1);
    expect(harness.reconcileAccountStatus).toHaveBeenCalledTimes(1);
    expect(harness.finishSurface).toHaveBeenCalledTimes(1);
  });
});
