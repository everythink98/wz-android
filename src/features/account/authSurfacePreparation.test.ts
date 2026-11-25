import { describe, expect, it } from 'vitest';
import { createAuthSurfacePreparation } from './authSurfacePreparation';

describe('auth surface preparation', () => {
  it('requires the owning runtime to observe the captured marker before admitting a new page', async () => {
    const marker = Promise.resolve();
    const preparation = createAuthSurfacePreparation(false, marker);

    expect(preparation.promise).toBe(marker);
    await marker;
    expect(preparation.ready).toBe(false);

    preparation.prepared();
    expect(preparation.ready).toBe(true);
    expect(preparation.pending).toBe(true);
  });

  it.each(['fulfilled', 'rejected'] as const)(
    'keeps completed handoff facts when the same %s marker is observed again',
    async (outcome) => {
      const marker = outcome === 'fulfilled' ? Promise.resolve() : Promise.reject(new Error('storage failure'));
      const preparation = createAuthSurfacePreparation(false, marker);
      preparation.persisted();
      const observe = () =>
        preparation.promise.then(
          () => preparation.prepared(),
          () => preparation.failed('登录会话保存失败')
        );

      await Promise.all([observe(), observe()]);

      expect(preparation.promise).toBe(marker);
      expect(preparation.ready).toBe(outcome === 'fulfilled');
      expect(preparation.error).toBe(outcome === 'rejected' ? '登录会话保存失败' : '');
      expect(preparation.pending).toBe(false);
    }
  );

  it('keeps admission inherited from the visible page when its new marker fails', async () => {
    const marker = Promise.reject(new Error('storage failure'));
    const preparation = createAuthSurfacePreparation(true, marker);
    expect(preparation.ready).toBe(true);
    expect(preparation.pending).toBe(true);
    expect(preparation.error).toBe('');

    await preparation.promise.catch(() => preparation.failed('登录会话保存失败'));

    expect(preparation.ready).toBe(true);
    expect(preparation.error).toBe('登录会话保存失败');
    expect(preparation.pending).toBe(true);
    preparation.persisted();
    expect(preparation.ready).toBe(true);
    expect(preparation.error).toBe('登录会话保存失败');
    expect(preparation.pending).toBe(false);
  });
});
