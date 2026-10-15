import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDefaultUserAgent } = vi.hoisted(() => ({
  getDefaultUserAgent: vi.fn(async () => 'native-provider-user-agent')
}));

vi.mock('@/platform/android/androidWebViewUserAgent', () => ({
  getDefaultAndroidWebViewUserAgent: getDefaultUserAgent
}));

import {
  dataImageFileFromUrl,
  forumMediaPlayerSourceFromUrl,
  imageRequestHeadersForUrl,
  imageSourceFromUrl,
  isHttpOrHttpsUrl,
  normalizeImagePreviewUrl
} from './imageRequestSource';
import { isPreviewableImageUrl } from './imagePreviewCatalog';

const publicMediaContext = { contentSource: null, sessionIdentity: 'public:0' } as const;

const nodeSeekMediaContext = { contentSource: 'nodeseek', sessionIdentity: 'nodeseek:4' } as const;

describe('image request source', () => {
  beforeEach(() => {
    getDefaultUserAgent.mockReset();
    getDefaultUserAgent.mockResolvedValue('native-provider-user-agent');
  });

  it('leaves the default image browser identity to native without reading it during source construction', () => {
    const source = imageSourceFromUrl('https://cdn.example.com/image.webp', {
      mediaContext: nodeSeekMediaContext
    });

    expect(source).toMatchObject({ cacheKey: 'nodeseek:4:https://cdn.example.com/image.webp' });
    expect(source.headers).not.toHaveProperty('User-Agent');
    expect(
      imageSourceFromUrl('https://cdn.example.com/image.webp', {
        mediaContext: nodeSeekMediaContext,
        baseSource: { headers: { 'User-Agent': 'explicit-base-profile' } }
      })
    ).toMatchObject({ headers: { 'User-Agent': 'explicit-base-profile' } });
    expect(getDefaultUserAgent).not.toHaveBeenCalled();
  });

  it.each(['audio', 'video'] as const)(
    'prepares the actual default %s profile before the cacheable player source',
    async (kind) => {
      let resolveUserAgent: ((value: string) => void) | undefined;
      getDefaultUserAgent.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveUserAgent = resolve;
          })
      );
      const source = forumMediaPlayerSourceFromUrl('https://cdn.example.com/media', {
        kind,
        mediaContext: nodeSeekMediaContext,
        runtimeGeneration: 7
      });
      let prepared = false;
      void source.then(() => {
        prepared = true;
      });
      await Promise.resolve();
      expect(prepared).toBe(false);
      resolveUserAgent?.('resolved-browser-identity');
      expect(await source).toMatchObject({
        useCaching: true,
        headers: { 'User-Agent': 'resolved-browser-identity', 'X-WZ-Read-Network-Generation': '7' }
      });
      expect(getDefaultUserAgent).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps saved NodeSeek player identity without reading the default profile', async () => {
    expect(
      await forumMediaPlayerSourceFromUrl('https://cdn.example.com/video.mp4', {
        kind: 'video',
        mediaContext: nodeSeekMediaContext,
        nodeSeekUserAgent: 'saved-node-agent',
        runtimeGeneration: 7
      })
    ).toMatchObject({ headers: { 'User-Agent': 'saved-node-agent' } });
    expect(getDefaultUserAgent).not.toHaveBeenCalled();
  });

  it.each(['file:///cache/audio.mp3', 'data:video/mp4;base64,AA=='])(
    'does not read a browser identity for local %s',
    async (url) => {
      const source = await forumMediaPlayerSourceFromUrl(url, {
        kind: 'audio',
        mediaContext: publicMediaContext,
        runtimeGeneration: 7
      });
      expect(source.headers).not.toHaveProperty('User-Agent');
      expect(getDefaultUserAgent).not.toHaveBeenCalled();
    }
  );

  it('keeps svg data images out of preview and saving', () => {
    expect(isPreviewableImageUrl('data:image/png;base64,abc')).toBe(true);
    expect(isPreviewableImageUrl('data:image/svg+xml;base64,abc')).toBe(false);
    expect(isPreviewableImageUrl('data:image/webp;base64,ok')).toBe(true);
    expect(dataImageFileFromUrl('data:image/svg+xml;base64,abc')).toBeNull();
  });

  it('allows external opening only for http and https URLs', () => {
    expect(isHttpOrHttpsUrl('https://example.com/topic/1')).toBe(true);
    expect(isHttpOrHttpsUrl('https://example.com/status')).toBe(true);
    expect(isHttpOrHttpsUrl('HTTPS://EXAMPLE.COM')).toBe(true);
    expect(isHttpOrHttpsUrl('mailto:test@example.com')).toBe(false);
    expect(isHttpOrHttpsUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpOrHttpsUrl('data:text/html,hello')).toBe(false);
    expect(isHttpOrHttpsUrl('/relative/path')).toBe(false);
    expect(isHttpOrHttpsUrl(undefined)).toBe(false);
  });

  it('keeps preview URLs in the expected app-safe form', () => {
    expect(normalizeImagePreviewUrl(' https://cdn.example.com/a.jpg ')).toBe('https://cdn.example.com/a.jpg');
    expect(normalizeImagePreviewUrl('HTTP://cdn.example.com/a.jpg')).toBe('HTTP://cdn.example.com/a.jpg');
    expect(normalizeImagePreviewUrl('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    expect(normalizeImagePreviewUrl('//cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(normalizeImagePreviewUrl('/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg')).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg'
    );
    expect(normalizeImagePreviewUrl('images/a.jpg')).toBe('images/a.jpg');
  });

  it('extracts base64 image file data from data URLs for local saving', () => {
    expect(dataImageFileFromUrl('data:image/jpeg;base64,abc123')).toEqual({
      base64: 'abc123',
      extension: 'jpg'
    });
    expect(dataImageFileFromUrl('data:text/plain;base64,abc123')).toBeNull();
    expect(dataImageFileFromUrl('https://cdn.example.com/a.jpg')).toBeNull();
  });

  it('gives unknown NodeSeek image hosts the forum browser request profile', () => {
    const headers = imageRequestHeadersForUrl('https://im.legend.moe/file/topic.webp', {
      mediaContext: nodeSeekMediaContext,
      nodeSeekUserAgent: 'NodeSeek WebView UA'
    });

    expect(headers).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://www.nodeseek.com/',
      'User-Agent': 'NodeSeek WebView UA',
      'X-WZ-Forum-Media-Identity': 'nodeseek:4',
      'X-WZ-Forum-Media-Source': 'nodeseek'
    });
    expect(headers).not.toHaveProperty('Cookie');
  });

  it('applies the same source profile without a target-host allowlist', () => {
    expect(
      imageRequestHeadersForUrl('https://i.111666.best/image/a.webp', { mediaContext: nodeSeekMediaContext })
    ).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://www.nodeseek.com/',
      'X-WZ-Forum-Media-Identity': 'nodeseek:4',
      'X-WZ-Forum-Media-Source': 'nodeseek'
    });
    expect(imageSourceFromUrl('https://i.111666.best/image/a.webp', { mediaContext: nodeSeekMediaContext })).toEqual({
      uri: 'https://i.111666.best/image/a.webp',
      cacheKey: 'nodeseek:4:https://i.111666.best/image/a.webp',
      headers: {
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        'Accept-Language': expect.any(String),
        Referer: 'https://www.nodeseek.com/',
        'X-WZ-Forum-Media-Identity': 'nodeseek:4',
        'X-WZ-Forum-Media-Source': 'nodeseek'
      }
    });
    expect(
      imageRequestHeadersForUrl('https://future-cdn.example/image/a.webp', { mediaContext: nodeSeekMediaContext })
    ).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://www.nodeseek.com/',
      'X-WZ-Forum-Media-Identity': 'nodeseek:4',
      'X-WZ-Forum-Media-Source': 'nodeseek'
    });
    expect(
      imageRequestHeadersForUrl('data:image/png;base64,abc', { mediaContext: nodeSeekMediaContext })
    ).toBeUndefined();
  });

  it('follows the original document referrer contract for all four topic sources', () => {
    const yaohuoHeaders = imageRequestHeadersForUrl(
      'https://cdn.waimaimingtang.com/file/images/bwc/20260809205204-e60bd8a4a2.jpg',
      {
        mediaContext: {
          contentSource: 'yaohuo',
          sessionIdentity: 'yaohuo:4',
          referrer: {
            documentUrl: 'https://www.yaohuo.me/bbs-1571096.html',
            documentPolicy: 'same-origin'
          }
        },
        referrerPolicy: 'no-referrer'
      }
    );
    const v2exHeaders = imageRequestHeadersForUrl('https://i.imgur.com/PxlOHiu.jpeg', {
      mediaContext: {
        contentSource: 'v2ex',
        sessionIdentity: 'public:0',
        referrer: { documentUrl: 'https://www.v2ex.com/t/1233346' }
      },
      referrerPolicy: 'no-referrer'
    });
    const nodeSeekHeaders = imageRequestHeadersForUrl('https://im.legend.moe/topic.webp', {
      mediaContext: {
        contentSource: 'nodeseek',
        sessionIdentity: 'nodeseek:4',
        referrer: { documentUrl: 'https://www.nodeseek.com/post-857589-1' }
      }
    });
    const linuxDoHeaders = imageRequestHeadersForUrl('https://cdn.ldstatic.com/topic.png', {
      mediaContext: {
        contentSource: 'linuxdo',
        sessionIdentity: 'linuxdo:4',
        referrer: {
          documentUrl: 'https://linux.do/t/topic/847468',
          documentPolicy: 'strict-origin-when-cross-origin'
        }
      }
    });
    const linuxdoHeaders = imageRequestHeadersForUrl('https://linux.do/uploads/default/optimized/topic.jpeg', {
      mediaContext: {
        contentSource: 'linuxdo',
        sessionIdentity: 'linuxdo:4',
        referrer: {
          documentUrl: 'https://linux.do/t/topic/263',
          documentPolicy: 'strict-origin-when-cross-origin'
        }
      }
    });

    expect(yaohuoHeaders).not.toHaveProperty('Referer');
    expect(v2exHeaders).not.toHaveProperty('Referer');
    expect(nodeSeekHeaders).toHaveProperty('Referer', 'https://www.nodeseek.com/');
    expect(linuxDoHeaders).toHaveProperty('Referer', 'https://linux.do/');
    expect(linuxdoHeaders).toHaveProperty('Referer', 'https://linux.do/t/topic/263');
  });

  it.each([
    ['no-referrer', 'https://forum.example.com/media.png', undefined],
    ['no-referrer-when-downgrade', 'http://cdn.example.com/media.png', undefined],
    ['no-referrer-when-downgrade', 'https://cdn.example.com/media.png', 'https://forum.example.com/t/42?q=1'],
    ['origin', 'http://cdn.example.com/media.png', 'https://forum.example.com/'],
    ['origin-when-cross-origin', 'https://forum.example.com/media.png', 'https://forum.example.com/t/42?q=1'],
    ['origin-when-cross-origin', 'https://cdn.example.com/media.png', 'https://forum.example.com/'],
    ['same-origin', 'https://cdn.example.com/media.png', undefined],
    ['same-origin', 'https://forum.example.com/media.png', 'https://forum.example.com/t/42?q=1'],
    ['strict-origin', 'http://cdn.example.com/media.png', undefined],
    ['strict-origin', 'https://cdn.example.com/media.png', 'https://forum.example.com/'],
    ['strict-origin-when-cross-origin', 'https://forum.example.com/media.png', 'https://forum.example.com/t/42?q=1'],
    ['strict-origin-when-cross-origin', 'https://cdn.example.com/media.png', 'https://forum.example.com/'],
    ['strict-origin-when-cross-origin', 'http://cdn.example.com/media.png', undefined],
    ['unsafe-url', 'http://cdn.example.com/media.png', 'https://forum.example.com/t/42?q=1']
  ] as const)('applies %s to %s', (documentPolicy, mediaUrl, expectedReferer) => {
    const headers = imageRequestHeadersForUrl(mediaUrl, {
      mediaContext: {
        contentSource: 'v2ex',
        sessionIdentity: 'public:0',
        referrer: {
          documentUrl: 'https://user:password@forum.example.com/t/42?q=1#reply',
          documentPolicy
        }
      }
    });

    expect(headers?.Referer).toBe(expectedReferer);
  });

  it('falls back from an invalid element policy to the document policy', () => {
    expect(
      imageRequestHeadersForUrl('https://cdn.example.com/media.png', {
        mediaContext: {
          contentSource: 'v2ex',
          sessionIdentity: 'public:0',
          referrer: {
            documentUrl: 'https://www.v2ex.com/t/1233346',
            documentPolicy: 'same-origin'
          }
        },
        referrerPolicy: 'invalid' as never
      })
    ).not.toHaveProperty('Referer');
  });

  it('separates image cache identity by the effective Referer header', () => {
    const url = 'https://i.imgur.com/PxlOHiu.jpeg';
    const mediaContext = {
      contentSource: 'v2ex',
      sessionIdentity: 'public:0',
      referrer: { documentUrl: 'https://www.v2ex.com/t/1233346' }
    } as const;

    expect(imageSourceFromUrl(url, { mediaContext, referrerPolicy: 'no-referrer' })).toMatchObject({
      cacheKey: `public:0:${url}:referrer:none`
    });
    expect(imageSourceFromUrl(url, { mediaContext, referrerPolicy: 'origin' })).toMatchObject({
      cacheKey: `public:0:${url}:referrer:https://www.v2ex.com/`
    });
  });

  it('marks every remote media request with its owning forum source', () => {
    expect(
      imageRequestHeadersForUrl('https://cdn.example.com/public.png', {
        mediaContext: {
          contentSource: 'linuxdo',
          sessionIdentity: 'linuxdo:4'
        },
        nodeSeekUserAgent: 'must-not-leak-to-linuxdo'
      })
    ).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://linux.do/',
      'X-WZ-Forum-Media-Identity': 'linuxdo:4',
      'X-WZ-Forum-Media-Source': 'linuxdo'
    });
  });

  it('separates Expo cache and in-flight request identity by session epoch', () => {
    const url = 'https://www.nodeseek.com/uploads/private.png';

    expect(
      imageSourceFromUrl(url, {
        mediaContext: { contentSource: 'nodeseek', sessionIdentity: 'nodeseek:4' },
        nodeSeekUserAgent: 'Node UA'
      })
    ).toMatchObject({
      cacheKey: `nodeseek:4:${url}`,
      uri: url,
      headers: { 'X-WZ-Forum-Media-Identity': 'nodeseek:4' }
    });
    expect(
      imageSourceFromUrl(url, {
        mediaContext: { contentSource: 'nodeseek', sessionIdentity: 'nodeseek:5' },
        nodeSeekUserAgent: 'Node UA'
      })
    ).toMatchObject({
      cacheKey: `nodeseek:5:${url}`,
      uri: url,
      headers: { 'X-WZ-Forum-Media-Identity': 'nodeseek:5' }
    });
  });

  it('keeps Imgur topic images on their original URL', () => {
    expect(imageSourceFromUrl('https://i.imgur.com/hKWwFrX.jpeg', { mediaContext: publicMediaContext })).toEqual({
      uri: 'https://i.imgur.com/hKWwFrX.jpeg',
      cacheKey: 'public:0:https://i.imgur.com/hKWwFrX.jpeg',
      headers: {
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        'Accept-Language': expect.any(String),
        'X-WZ-Forum-Media-Identity': 'public:0',
        'X-WZ-Forum-Media-Source': 'anonymous'
      }
    });
  });

  it('leaves a missing NodeSeek avatar user agent to the native media profile', () => {
    expect(
      imageRequestHeadersForUrl('https://www.nodeseek.com/avatar/48872.png', { mediaContext: nodeSeekMediaContext })
    ).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://www.nodeseek.com/',
      'X-WZ-Forum-Media-Identity': 'nodeseek:4',
      'X-WZ-Forum-Media-Source': 'nodeseek'
    });
  });

  it('does not send NodeSeek login cookies to public static sticker media', () => {
    expect(
      imageRequestHeadersForUrl('https://www.nodeseek.com/static/image/sticker/emoji/00.webm', {
        mediaContext: nodeSeekMediaContext
      })
    ).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://www.nodeseek.com/',
      'X-WZ-Forum-Media-Identity': 'nodeseek:4',
      'X-WZ-Forum-Media-Source': 'nodeseek'
    });
  });

  it('leaves NodeSeek media Cookie attachment to the native read-only jar', () => {
    expect(
      imageRequestHeadersForUrl('https://www.nodeseek.com/api/attachments/123', {
        mediaContext: nodeSeekMediaContext,
        nodeSeekUserAgent: 'WZ-Media-Test'
      })
    ).not.toHaveProperty('Cookie');
  });

  it('uses a safe language fallback when the platform locale is unavailable', async () => {
    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new Error('locale unavailable');
    });
    vi.resetModules();

    try {
      const reloaded = await import('./imageRequestSource');
      expect(
        reloaded.imageRequestHeadersForUrl('https://cdn.example.com/image.webp', {
          mediaContext: publicMediaContext
        })
      ).toMatchObject({ 'Accept-Language': 'en-US,en;q=0.9' });
    } finally {
      dateTimeFormat.mockRestore();
      vi.resetModules();
    }
  });
});
