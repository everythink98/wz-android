import { describe, expect, it, vi } from 'vitest';
import { loadRemoteAvatarSvgText } from './avatarImages';

describe('Android remote avatar images', () => {
  it('loads NodeSeek default avatars when the avatar endpoint returns SVG', async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-type': 'image/svg+xml' }
        });
      }
      return new Response('<svg viewBox="0 0 32 32"></svg>', {
        headers: { 'content-type': 'image/svg+xml' }
      });
    });

    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/58159.png', fetcher)).resolves.toBe(
      '<svg viewBox="0 0 32 32"></svg>'
    );
    expect(fetcher).toHaveBeenCalledWith('https://www.nodeseek.com/avatar/58159.png', expect.objectContaining({
      method: 'HEAD',
      headers: expect.objectContaining({
        'User-Agent': expect.stringContaining('Android 14')
      })
    }));
    expect(fetcher).toHaveBeenLastCalledWith('https://www.nodeseek.com/avatar/58159.png', expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': expect.stringContaining('Android 14')
      })
    }));
  });

  it('reuses one pending request for the same NodeSeek SVG avatar', async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-type': 'image/svg+xml' }
        });
      }
      return new Response('<svg viewBox="0 0 32 32"></svg>', {
        headers: { 'content-type': 'image/svg+xml' }
      });
    });

    await expect(Promise.all([
      loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62001.png', fetcher),
      loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62001.png', fetcher)
    ])).resolves.toEqual([
      '<svg viewBox="0 0 32 32"></svg>',
      '<svg viewBox="0 0 32 32"></svg>'
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.filter((call) => call[1]?.method === 'HEAD')).toHaveLength(1);
  });

  it('keeps regular bitmap avatars on the native Image path', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      headers: { 'content-type': 'image/png' }
    }));

    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/55849.png', fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('loads SVG avatars when HEAD cannot identify the image type', async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null);
      }
      return new Response('<svg viewBox="0 0 32 32"></svg>', {
        headers: { 'content-type': 'image/svg+xml' }
      });
    });

    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62004.png', fetcher)).resolves.toBe(
      '<svg viewBox="0 0 32 32"></svg>'
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('caches bitmap avatar checks as null results', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      headers: { 'content-type': 'image/png' }
    }));

    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62002.png', fetcher)).resolves.toBeNull();
    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62002.png', fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed avatar request', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response(null, {
        headers: { 'content-type': 'image/png' }
      }));

    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62003.png', fetcher)).resolves.toBeNull();
    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62003.png', fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not cache temporary SVG avatar HTTP failures as bitmap results', async () => {
    let imageReads = 0;
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-type': 'image/svg+xml' }
        });
      }
      imageReads += 1;
      return imageReads === 1
        ? new Response('temporarily unavailable', { status: 503 })
        : new Response('<svg viewBox="0 0 32 32"></svg>', {
          headers: { 'content-type': 'image/svg+xml' }
        });
    });

    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62005.png', fetcher)).resolves.toBeNull();
    await expect(loadRemoteAvatarSvgText('https://www.nodeseek.com/avatar/62005.png', fetcher)).resolves.toBe(
      '<svg viewBox="0 0 32 32"></svg>'
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('does not fetch SVG text for non-NodeSeek avatar URLs', async () => {
    const fetcher = vi.fn();

    await expect(loadRemoteAvatarSvgText('https://cdn.example.com/avatar.svg', fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
