import { describe, expect, it } from 'vitest';
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
  it('[REG-TOPIC-029] derives request provenance and cache generation from the content source', () => {
    expect(mediaRequestContextForSource('linuxdo', epochs)).toEqual({
      contentSource: 'linuxdo',
      sessionIdentity: 'linuxdo:2'
    });
    expect(mediaRequestContextForSource(null, epochs)).toEqual({
      contentSource: null,
      sessionIdentity: 'public:0'
    });
  });
  it('keeps public sources outside private media epochs', () => {
    expect(mediaSessionIdentityForSource('v2ex', epochs)).toBe('public:0');
  });
});
