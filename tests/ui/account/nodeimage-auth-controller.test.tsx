import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
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

async function createControllerHarness() {
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
    sessionEpoch: 5
  };
  const readRuntime = jest.fn(() => runtime);
  const reconcileAccountStatus = jest.fn(async () => ({
    status: 'same' as const,
    session: nodeSeekSession()
  }));
  const hook = await renderHook(() => {
    const [surfaceVisible, setSurfaceVisible] = useState(false);
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
      surfaceVisible
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
    }
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
    jest.mocked(nodeImageCredentials.loadNodeImageApiKeyCredential).mockReset().mockResolvedValue(null);
    jest.mocked(nodeImageCredentials.nodeImageApiKeyUseStatus).mockReset().mockReturnValue('missing');
    jest.mocked(nodeImageCredentials.currentNodeImageApiKeyGeneration).mockReset().mockReturnValue(3);
  });

  afterEach(() => {
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
});
