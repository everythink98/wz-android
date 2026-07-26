import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimNodeImageConnectAttempt,
  closeNodeImageAuthOpening,
  createNodeImageAuthNonce,
  nextNodeImageAuthPhase,
  nodeImageAuthFlowCanAcceptMessage,
  nodeImageAuthPhaseMatchesTopLevelUrl,
  processNodeImageAuthMessage,
  runNodeImageAuthOpening,
  runNodeImageAuthSingleFlight,
  terminateNodeImageAuthFlow,
  type NodeImageAuthPhase
} from './nodeimageAuthFlow';

describe('NodeImage authorization flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates a 128-bit nonce through Web Crypto when the runtime provides it', async () => {
    const randomBytes = Uint8Array.from([
      0x00, 0x11, 0x22, 0x33,
      0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb,
      0xcc, 0xdd, 0xee, 0xff
    ]);
    const getRandomValues = vi.fn((target: Uint8Array) => {
      target.set(randomBytes);
      return target;
    });
    const mathRandom = vi.spyOn(Math, 'random');
    vi.stubGlobal('crypto', { getRandomValues });

    const nativeRandomHex = vi.fn();
    await expect(createNodeImageAuthNonce(nativeRandomHex)).resolves.toBe(
      '00112233445566778899aabbccddeeff'
    );
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16);
    expect(nativeRandomHex).not.toHaveBeenCalled();
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('uses the existing native SecureRandom provider when Hermes has no Web Crypto', async () => {
    vi.stubGlobal('crypto', undefined);
    const mathRandom = vi.spyOn(Math, 'random');
    const nativeRandomHex = vi.fn(async () => '00112233445566778899AABBCCDDEEFF');

    await expect(createNodeImageAuthNonce(nativeRandomHex)).resolves.toBe(
      '00112233445566778899aabbccddeeff'
    );
    expect(nativeRandomHex).toHaveBeenCalledWith(16);
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('fails closed when every secure random provider is unavailable or invalid', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(createNodeImageAuthNonce(async () => 'short')).rejects.toThrow(
      'secure random'
    );
    await expect(createNodeImageAuthNonce(async () => {
      throw new Error('entropy unavailable');
    })).rejects.toThrow('secure random');

    vi.stubGlobal('crypto', {
      getRandomValues: () => {
        throw new Error('entropy unavailable');
      }
    });
    await expect(createNodeImageAuthNonce(async () => '00'.repeat(16))).rejects.toThrow(
      'Web Crypto getRandomValues'
    );
  });

  it('REG-ACCOUNT-010 single-flights async initialization and clears after settlement', async () => {
    const slot = { current: null as Promise<string | null> | null };
    const nonce = Promise.withResolvers<void>();
    const result = Promise.withResolvers<string | null>();
    const initialize = vi.fn(async (isCurrent: () => boolean) => {
      await nonce.promise;
      return isCurrent() ? result.promise : null;
    });

    const first = runNodeImageAuthSingleFlight(slot, initialize);
    const second = runNodeImageAuthSingleFlight(slot, initialize);

    expect(first).toBe(second);
    expect(initialize).toHaveBeenCalledTimes(1);
    nonce.resolve();
    result.resolve('authorized-key');
    await expect(Promise.all([first, second])).resolves.toEqual([
      'authorized-key',
      'authorized-key'
    ]);
    expect(slot.current).toBeNull();

    const third = runNodeImageAuthSingleFlight(slot, async () => null);
    expect(third).not.toBe(first);
    await expect(third).resolves.toBeNull();
  });

  it('REG-ACCOUNT-010 closes a pending secure-random continuation before it opens a stale surface', async () => {
    const slot = { current: null as Promise<string | null> | null };
    const nonce = Promise.withResolvers<string>();
    const open = vi.fn(async () => 'unexpected-key');
    const finish = vi.fn(async () => undefined);
    const opening = runNodeImageAuthOpening(slot, {
      createNonce: () => nonce.promise,
      onError: vi.fn(),
      open
    });

    closeNodeImageAuthOpening(slot, finish);
    nonce.resolve('00112233445566778899aabbccddeeff');

    await expect(opening).resolves.toBeNull();
    expect(open).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(slot.current).toBeNull();
  });

  it.each([
    ['nodeimage-session', 'https://www.nodeimage.com/'],
    ['nodeimage-session', 'https://www.nodeimage.com:443/'],
    ['nodeseek-cauth', 'https://www.nodeseek.com/connect?target=NodeImage'],
    ['nodeseek-cauth', 'https://www.nodeseek.com:443/connect?target=NodeImage'],
    ['nodeimage-verify', 'https://www.nodeimage.com/'],
    ['nodeimage-verify', 'https://www.nodeimage.com:443/']
  ] as const)('accepts only the exact URL for phase %s: %s', (phase, url) => {
    expect(nodeImageAuthPhaseMatchesTopLevelUrl(phase, url)).toBe(true);
  });

  it.each([
    'http://www.nodeseek.com/connect?target=NodeImage',
    'https://user@www.nodeseek.com/connect?target=NodeImage',
    'https://@www.nodeseek.com/connect?target=NodeImage',
    'https://www.nodeseek.com:444/connect?target=NodeImage',
    'https://nodeseek.com/connect?target=NodeImage',
    'https://auth.nodeseek.com/connect?target=NodeImage',
    'https://www.nodeseek.com/connect/?target=NodeImage',
    'https://www.nodeseek.com/connect?target=nodeimage',
    'https://www.nodeseek.com/connect?target=NodeImage&next=/',
    'https://www.nodeseek.com/connect?target=NodeImage#done',
    'https://www.nodeseek.com/connect?target=NodeImage#',
    'http://www.nodeimage.com/',
    'https://user@www.nodeimage.com/',
    'https://@www.nodeimage.com/',
    'https://www.nodeimage.com:444/',
    'https://nodeimage.com/',
    'https://api.nodeimage.com/',
    'https://www.nodeimage.com/account',
    'https://www.nodeimage.com/?next=/',
    'https://www.nodeimage.com/?',
    'https://www.nodeimage.com/#done',
    'https://www.nodeimage.com/#',
    'not a URL'
  ])('rejects a non-exact or unsafe phase URL: %s', (url) => {
    expect(nodeImageAuthPhaseMatchesTopLevelUrl('nodeimage-session', url)).toBe(false);
    expect(nodeImageAuthPhaseMatchesTopLevelUrl('nodeseek-cauth', url)).toBe(false);
    expect(nodeImageAuthPhaseMatchesTopLevelUrl('nodeimage-verify', url)).toBe(false);
  });

  it('REG-ACCOUNT-038 only enters Connect after an explicit expired-session result', () => {
    expect(nextNodeImageAuthPhase('nodeimage-session', 'nodeimage-session-expired')).toBe(
      'nodeseek-cauth'
    );
    expect(nextNodeImageAuthPhase('nodeimage-session', 'nodeimage-session-key')).toBeNull();
    expect(nextNodeImageAuthPhase('nodeimage-session', 'nodeimage-session-error')).toBeNull();
    expect(nextNodeImageAuthPhase('nodeseek-cauth', 'nodeimage-auth-data')).toBe(
      'nodeimage-verify'
    );
    expect(nextNodeImageAuthPhase('nodeseek-cauth', 'nodeimage-auth-error')).toBeNull();
    expect(nextNodeImageAuthPhase('nodeimage-verify', 'nodeimage-api-key')).toBeNull();
  });

  it('REG-ACCOUNT-038 rejects late messages after owner, epoch, generation, or terminal changes', () => {
    const flow = {
      credentialGeneration: 7,
      ownerIdentityKey: 'nodeseek:42',
      ownerSessionEpoch: 3,
      terminal: false
    };
    const runtime = {
      identityKey: 'nodeseek:42',
      identityTrust: 'confirmed' as const,
      sessionEpoch: 3
    };

    expect(nodeImageAuthFlowCanAcceptMessage(flow, runtime, 7)).toBe(true);
    expect(nodeImageAuthFlowCanAcceptMessage(
      flow,
      { ...runtime, identityKey: 'nodeseek:99' },
      7
    )).toBe(false);
    expect(nodeImageAuthFlowCanAcceptMessage(
      flow,
      { ...runtime, sessionEpoch: 4 },
      7
    )).toBe(false);
    expect(nodeImageAuthFlowCanAcceptMessage(
      flow,
      { ...runtime, identityTrust: 'pending' },
      7
    )).toBe(false);
    expect(nodeImageAuthFlowCanAcceptMessage(flow, runtime, 8)).toBe(false);

    expect(terminateNodeImageAuthFlow(flow)).toBe(true);
    expect(terminateNodeImageAuthFlow(flow)).toBe(false);
    expect(nodeImageAuthFlowCanAcceptMessage(flow, runtime, 7)).toBe(false);
  });

  it('REG-ACCOUNT-038 grants one native Connect attempt across repeated document readiness', () => {
    const flow = { connectStarted: false };

    expect(claimNodeImageConnectAttempt(flow)).toBe(true);
    expect(claimNodeImageConnectAttempt(flow)).toBe(false);
  });

  it('REG-ACCOUNT-038 completes an existing NodeImage session without Connect and settles once', async () => {
    const flow = {
      connectStarted: false,
      credentialGeneration: 7,
      nonce: '00112233445566778899aabbccddeeff',
      ownerIdentityKey: 'nodeseek:42',
      ownerSessionEpoch: 3,
      payload: null,
      phase: 'nodeimage-session' as const,
      terminal: false
    };
    const connectTarget = { postMessage: vi.fn() };
    const effects = {
      complete: vi.fn(async () => undefined),
      connectTarget,
      fail: vi.fn(),
      mark: vi.fn(),
      mountCurrentPhase: vi.fn()
    };
    const message = {
      data: JSON.stringify({
        api_key: 'session-key',
        nonce: flow.nonce,
        type: 'nodeimage-session-key'
      }),
      url: 'https://www.nodeimage.com/'
    };
    const runtime = {
      identityKey: 'nodeseek:42',
      identityTrust: 'confirmed',
      sessionEpoch: 3
    };

    await processNodeImageAuthMessage(flow, {
      data: '{',
      url: 'https://www.nodeimage.com/'
    }, runtime, 7, effects);
    await processNodeImageAuthMessage(flow, {
      data: 'null',
      url: 'https://www.nodeimage.com/'
    }, runtime, 7, effects);
    await processNodeImageAuthMessage(flow, {
      data: '[]',
      url: 'https://www.nodeimage.com/'
    }, runtime, 7, effects);
    await processNodeImageAuthMessage(flow, {
      data: JSON.stringify({
        api_key: 'untrusted-key',
        type: 'nodeimage-session-key'
      }),
      url: 'https://www.nodeimage.com/'
    }, runtime, 7, effects);
    await processNodeImageAuthMessage(flow, message, runtime, 7, effects);
    await processNodeImageAuthMessage(flow, message, runtime, 7, effects);

    expect(effects.complete).toHaveBeenCalledTimes(1);
    expect(effects.complete).toHaveBeenCalledWith('session-key');
    expect(effects.mark).toHaveBeenCalledWith('session-reused');
    expect(effects.mountCurrentPhase).not.toHaveBeenCalled();
    expect(connectTarget.postMessage).not.toHaveBeenCalled();
    expect(effects.fail).not.toHaveBeenCalled();
    expect(flow.terminal).toBe(true);
  });

  it('REG-ACCOUNT-038 drives one Connect through verify, then ignores every late result', async () => {
    const flow = {
      connectStarted: false,
      credentialGeneration: 7,
      nonce: '00112233445566778899aabbccddeeff',
      ownerIdentityKey: 'nodeseek:42',
      ownerSessionEpoch: 3,
      payload: null,
      phase: 'nodeimage-session' as NodeImageAuthPhase,
      terminal: false
    };
    const connectTarget = { postMessage: vi.fn() };
    const effects = {
      complete: vi.fn(async () => undefined),
      connectTarget,
      fail: vi.fn(),
      mark: vi.fn(),
      mountCurrentPhase: vi.fn()
    };
    const runtime = {
      identityKey: 'nodeseek:42',
      identityTrust: 'confirmed',
      sessionEpoch: 3
    };
    const send = (type: string, data: Record<string, unknown> = {}) => (
      processNodeImageAuthMessage(flow, {
        data: JSON.stringify({ ...data, nonce: flow.nonce, type }),
        url: flow.phase === 'nodeseek-cauth'
          ? 'https://www.nodeseek.com/connect?target=NodeImage'
          : 'https://www.nodeimage.com/'
      }, runtime, 7, effects)
    );

    await send('nodeimage-session-expired', { status: 401 });
    await send('nodeimage-connect-ready');
    await send('nodeimage-connect-ready');
    await send('nodeimage-auth-data', {
      data: 'auth-data',
      sign: 'auth-sign',
      wtf: 'auth-wtf'
    });
    await send('nodeimage-api-key', { apiKey: 'verified-key' });
    await send('nodeimage-api-key', { apiKey: 'late-key' });

    expect(connectTarget.postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(connectTarget.postMessage.mock.calls[0]?.[0] || '{}')).toEqual({
      nonce: flow.nonce,
      type: 'nodeimage-connect-start'
    });
    expect(effects.mountCurrentPhase).toHaveBeenCalledTimes(2);
    expect(effects.mark.mock.calls.map(([state]) => state)).toEqual([
      'session-expired',
      'connect-started',
      'connect-finished'
    ]);
    expect(effects.complete).toHaveBeenCalledTimes(1);
    expect(effects.complete).toHaveBeenCalledWith('verified-key');
    expect(effects.fail).not.toHaveBeenCalled();
    expect(flow.phase).toBe('nodeimage-verify');
    expect(flow.terminal).toBe(true);
  });

  it('REG-ACCOUNT-038 terminates an unknown session result before a late expired message', async () => {
    const flow = {
      connectStarted: false,
      credentialGeneration: 7,
      nonce: '00112233445566778899aabbccddeeff',
      ownerIdentityKey: 'nodeseek:42',
      ownerSessionEpoch: 3,
      payload: null,
      phase: 'nodeimage-session' as NodeImageAuthPhase,
      terminal: false
    };
    const connectTarget = { postMessage: vi.fn() };
    const effects = {
      complete: vi.fn(async () => undefined),
      connectTarget,
      fail: vi.fn(),
      mark: vi.fn(),
      mountCurrentPhase: vi.fn()
    };
    const runtime = {
      identityKey: 'nodeseek:42',
      identityTrust: 'confirmed',
      sessionEpoch: 3
    };
    const send = (type: string, data: Record<string, unknown> = {}) => (
      processNodeImageAuthMessage(flow, {
        data: JSON.stringify({ ...data, nonce: flow.nonce, type }),
        url: 'https://www.nodeimage.com/'
      }, runtime, 7, effects)
    );

    await send('nodeimage-session-expired', { status: 403 });
    await send('nodeimage-session-expired', { status: 401 });

    expect(effects.fail).toHaveBeenCalledTimes(1);
    expect(effects.mountCurrentPhase).not.toHaveBeenCalled();
    expect(connectTarget.postMessage).not.toHaveBeenCalled();
    expect(effects.complete).not.toHaveBeenCalled();
    expect(flow.terminal).toBe(true);
  });
});
