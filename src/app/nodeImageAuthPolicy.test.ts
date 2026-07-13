import { describe, expect, it, vi } from 'vitest';
import { ensureNodeImageApiKeyForRequest } from './nodeImageAuthPolicy';

describe('NodeImage authorization policy', () => {
  it('returns a cached key without opening authorization', async () => {
    const openAuthorization = vi.fn(async () => 'fresh');
    const setSaved = vi.fn();

    await expect(ensureNodeImageApiKeyForRequest(undefined, {
      clearApiKey: vi.fn(async () => undefined),
      loadApiKey: vi.fn(async () => 'cached'),
      openAuthorization,
      setSaved
    })).resolves.toBe('cached');
    expect(openAuthorization).not.toHaveBeenCalled();
    expect(setSaved).toHaveBeenCalledWith(true);
  });

  it('clears a rejected key when forced reauthorization is canceled', async () => {
    const clearApiKey = vi.fn(async () => undefined);
    const setSaved = vi.fn();

    await expect(ensureNodeImageApiKeyForRequest({ forceRefresh: true, clearOnCancel: true }, {
      clearApiKey,
      loadApiKey: vi.fn(async () => 'stale'),
      openAuthorization: vi.fn(async () => null),
      setSaved
    })).resolves.toBeNull();
    expect(clearApiKey).toHaveBeenCalledTimes(1);
    expect(setSaved).toHaveBeenCalledWith(false);
  });
});
