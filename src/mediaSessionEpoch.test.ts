import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialForumSessionEpochs } from './app/serverState';
import {
  mediaRequestContextForSource,
  mediaSessionIdentityForSource
} from './mediaSessionEpoch';

const epochs = {
  ...initialForumSessionEpochs,
  linuxdo: 2,
  nodeseek: 4,
  xiaoyinsi: 6,
  yaohuo: 8
};

describe('managed media session epoch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('[REG-TOPIC-029] derives request provenance and cache generation from the content source', () => {
    expect(mediaRequestContextForSource('linuxdo', epochs)).toEqual({
      contentSource: 'linuxdo',
      sessionIdentity: expect.stringMatching(/^linuxdo:[a-z0-9-]+:2$/)
    });
    expect(mediaRequestContextForSource(null, epochs)).toEqual({
      contentSource: null,
      sessionIdentity: 'public:0'
    });
  });
  it('keeps public sources outside private media epochs', () => {
    expect(mediaSessionIdentityForSource('v2ex', epochs)).toBe('public:0');
  });

  it('[REG-TOPIC-042] gives private disk cache keys a new namespace after a process restart', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
    vi.resetModules();
    const firstProcess = await import('./mediaSessionEpoch');
    const firstIdentity = firstProcess.mediaSessionIdentityForSource('nodeseek', epochs);
    vi.resetModules();
    const secondProcess = await import('./mediaSessionEpoch');
    const secondIdentity = secondProcess.mediaSessionIdentityForSource('nodeseek', epochs);

    expect(secondIdentity).not.toBe(firstIdentity);
    expect(firstIdentity).toMatch(/^nodeseek:[a-z0-9-]+:4$/);
    expect(secondIdentity).toMatch(/^nodeseek:[a-z0-9-]+:4$/);
  });
});
