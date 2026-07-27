import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../../src/xiaoyinsiKeystore', () => ({
  nativeSecureRandomHex: jest.fn(async () => 'a'.repeat(32))
}));

jest.mock('../../src/nodeimageCredentials', () => ({
  beginNodeImageApiKeyAuthorization: jest.fn(() => 3),
  clearNodeImageApiKey: jest.fn(async () => true),
  currentNodeImageApiKeyGeneration: jest.fn(() => 3),
  invalidateNodeImageApiKeyAuthorization: jest.fn(),
  loadNodeImageApiKey: jest.fn(async () => null),
  loadNodeImageApiKeyCredential: jest.fn(async () => null),
  nodeImageApiKeyUseStatus: jest.fn(() => 'missing'),
  saveNodeImageApiKeyForGeneration: jest.fn(async () => 'saved-key')
}));

import { useNodeImageAuthController } from '../../src/app/useNodeImageAuthController';

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
  const finishSurface = jest.fn(async () => ({
    status: 'same' as const,
    session: nodeSeekSession()
  }));
  const notify = jest.fn();
  const prepareSurfaceOpen = jest.fn();
  const readRuntime = jest.fn(() => ({
    source: 'nodeseek' as const,
    authenticated: true,
    authSurfaceOpen: true,
    identityKey: 'nodeseek:42',
    identityTrust: 'confirmed' as const,
    sessionEpoch: 5
  }));
  const reconcileAccountStatus = jest.fn(async () => ({
    status: 'same' as const,
    session: nodeSeekSession()
  }));
  const hook = await renderHook(() => useNodeImageAuthController({
    beginSurface,
    finishSurface,
    notify,
    prepareSurfaceOpen,
    readRuntime,
    reconcileAccountStatus
  }));
  return {
    beginSurface,
    finishSurface,
    hook,
    notify,
    prepareSurfaceOpen,
    reconcileAccountStatus
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
    expect(harness.hook.result.current.panel.document?.key).toBe(
      '7:nodeimage-session'
    );
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
  const nonce = hook.result.current.panel.document?.injectedJavaScript.match(
    /const nonce = "([0-9a-f]{32})";/
  )?.[1];
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
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps key and panel behavior behind two controller groups', async () => {
    const {
      beginSurface,
      finishSurface,
      hook,
      prepareSurfaceOpen,
      reconcileAccountStatus
    } = await openController();

    expect(Object.keys(hook.result.current).sort()).toEqual(['key', 'panel']);

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

  it('REG-ACCOUNT-040 settles a stalled session check without starting Connect', async () => {
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

  it('REG-ACCOUNT-040 distinguishes a Connect timeout before the quota call starts', async () => {
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

  it('REG-ACCOUNT-040 reports an unknown Connect result after the one quota call starts', async () => {
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

  it('REG-ACCOUNT-040 settles a stalled NodeImage verification phase', async () => {
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
