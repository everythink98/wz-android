import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  closeNodeImageAuthOpening,
  createNodeImageAuthNonce,
  nodeImageAuthPhaseForTopLevelUrl,
  runNodeImageAuthOpening,
  runNodeImageAuthSingleFlight
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
    ['https://www.nodeseek.com/connect?target=NodeImage', 'nodeseek-cauth'],
    ['https://www.nodeseek.com:443/connect?target=NodeImage', 'nodeseek-cauth'],
    ['https://www.nodeimage.com/', 'nodeimage-payload'],
    ['https://www.nodeimage.com:443/', 'nodeimage-payload']
  ] as const)('accepts only an exact top-level phase URL: %s', (url, phase) => {
    expect(nodeImageAuthPhaseForTopLevelUrl(url)).toBe(phase);
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
    expect(nodeImageAuthPhaseForTopLevelUrl(url)).toBeNull();
  });
});
