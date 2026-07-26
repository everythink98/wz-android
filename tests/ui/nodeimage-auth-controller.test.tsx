import { beforeEach, describe, expect, it, jest } from '@jest/globals';
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

describe('NodeImage auth controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps key and panel behavior behind two controller groups', async () => {
    const beginSurface = jest.fn(() => ({ generation: 7 }));
    const finishSurface = jest.fn(async () => ({
      status: 'same' as const,
      session: {
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
      }
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
      session: {
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
      }
    }));
    const hook = await renderHook(() => useNodeImageAuthController({
      beginSurface,
      finishSurface,
      notify,
      prepareSurfaceOpen,
      readRuntime,
      reconcileAccountStatus
    }));

    expect(Object.keys(hook.result.current).sort()).toEqual(['key', 'panel']);

    await act(async () => {
      hook.result.current.key.authorize();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(hook.result.current.panel.visible).toBe(true);
      expect(hook.result.current.panel.document?.key).toBe('7:nodeimage-session');
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
});
