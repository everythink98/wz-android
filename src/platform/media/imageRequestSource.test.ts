import { describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/android/androidWebViewUserAgent', () => ({
  DEFAULT_ANDROID_WEBVIEW_USER_AGENT: 'native-provider-user-agent'
}));

import {
  dataImageFileFromUrl,
  imageRequestHeadersForUrl,
  imageSourceFromUrl,
  isHttpOrHttpsUrl,
  normalizeImagePreviewUrl
} from './imageRequestSource';
import { extractImageUrlsFromHtml, isPreviewableImageUrl } from './imagePreviewCatalog';

const publicMediaContext = { contentSource: null, sessionIdentity: 'public:0' } as const;

const nodeSeekMediaContext = { contentSource: 'nodeseek', sessionIdentity: 'nodeseek:4' } as const;

describe('image request source', () => {
  it('keeps svg data images out of preview and saving', () => {
    expect(isPreviewableImageUrl('data:image/png;base64,abc')).toBe(true);
    expect(isPreviewableImageUrl('data:image/svg+xml;base64,abc')).toBe(false);
    expect(
      extractImageUrlsFromHtml('<img src="data:image/svg+xml;base64,abc"><img src="data:image/webp;base64,ok">')
    ).toEqual(['data:image/webp;base64,ok']);
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

  it('[REG-TOPIC-064] gives unknown NodeSeek image hosts the forum browser request profile', () => {
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

  it('[REG-TOPIC-064] applies the same source profile without a target-host allowlist', () => {
    expect(
      imageRequestHeadersForUrl('https://i.111666.best/image/a.webp', { mediaContext: nodeSeekMediaContext })
    ).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://www.nodeseek.com/',
      'User-Agent': 'native-provider-user-agent',
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
        'User-Agent': 'native-provider-user-agent',
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
      'User-Agent': 'native-provider-user-agent',
      'X-WZ-Forum-Media-Identity': 'nodeseek:4',
      'X-WZ-Forum-Media-Source': 'nodeseek'
    });
    expect(
      imageRequestHeadersForUrl('data:image/png;base64,abc', { mediaContext: nodeSeekMediaContext })
    ).toBeUndefined();
  });

  it('[REG-TOPIC-029] marks every remote media request with its owning forum source', () => {
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
      'User-Agent': 'native-provider-user-agent',
      'X-WZ-Forum-Media-Identity': 'linuxdo:4',
      'X-WZ-Forum-Media-Source': 'linuxdo'
    });
  });

  it('[REG-TOPIC-041] separates Expo cache and in-flight request identity by session epoch', () => {
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
        'User-Agent': 'native-provider-user-agent',
        'X-WZ-Forum-Media-Identity': 'public:0',
        'X-WZ-Forum-Media-Source': 'anonymous'
      }
    });
  });

  it('adds a browser user agent for NodeSeek avatar images', () => {
    expect(
      imageRequestHeadersForUrl('https://www.nodeseek.com/avatar/48872.png', { mediaContext: nodeSeekMediaContext })
    ).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      'Accept-Language': expect.any(String),
      Referer: 'https://www.nodeseek.com/',
      'User-Agent': 'native-provider-user-agent',
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
      'User-Agent': 'native-provider-user-agent',
      'X-WZ-Forum-Media-Identity': 'nodeseek:4',
      'X-WZ-Forum-Media-Source': 'nodeseek'
    });
  });

  it('[REG-ACCOUNT-029] leaves NodeSeek media Cookie attachment to the native read-only jar', () => {
    expect(
      imageRequestHeadersForUrl('https://www.nodeseek.com/api/attachments/123', {
        mediaContext: nodeSeekMediaContext,
        nodeSeekUserAgent: 'WZ-Media-Test'
      })
    ).not.toHaveProperty('Cookie');
  });

  it('[REG-TOPIC-064] uses a safe language fallback when the platform locale is unavailable', async () => {
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
