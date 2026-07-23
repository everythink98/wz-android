import { describe, expect, it } from 'vitest';
import { initialForumSessionEpochs } from './app/serverState';
import {
  managedMediaSessionIdentity,
  mediaSessionIdentityForSource,
  mediaSourceForUrl
} from './mediaSessionEpoch';

const epochs = {
  ...initialForumSessionEpochs,
  linuxdo: 2,
  nodeseek: 4,
  xiaoyinsi: 6,
  yaohuo: 8
};

describe('managed media session epoch', () => {
  it('maps managed forum and NodeImage hosts to their owning identity epoch', () => {
    expect(mediaSourceForUrl('https://cdn.nodeimage.com/i/a.png')).toBe('nodeseek');
    expect(mediaSourceForUrl('https://i.111666.best/image/a.webp')).toBe('nodeseek');
    expect(managedMediaSessionIdentity('https://linux.do/uploads/a.png', epochs)).toBe('linuxdo:2');
    expect(managedMediaSessionIdentity('https://www.yaohuo.me/a.png', epochs)).toBe('yaohuo:8');
    expect(managedMediaSessionIdentity('https://forum.xiaoyinsi.com/a.png', epochs)).toBe('xiaoyinsi:6');
  });

  it('keeps public and lookalike hosts outside private media epochs', () => {
    expect(managedMediaSessionIdentity('https://evil-linux.do.example/a.png', epochs)).toBe('public:0');
    expect(mediaSessionIdentityForSource('v2ex', epochs)).toBe('public:0');
  });
});
