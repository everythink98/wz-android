import { describe, expect, it } from 'vitest';
import {
  createImagePreviewList,
  dataImageFileFromUrl,
  extractImageUrlsFromHtml,
  flowInlineImagesInMixedParagraphs,
  imageRequestHeadersForUrl,
  imageSourceFromUrl,
  isHttpOrHttpsUrl,
  isPreviewableImageUrl,
  normalizeImagePreviewUrl
} from './htmlImages';

describe('Android HTML image preview helpers', () => {
  it('extracts and decodes image URLs from rendered HTML', () => {
    expect(extractImageUrlsFromHtml('<p><img src="/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&amp;w=1"><img data-src="x"><img src="https://cdn.example.com/b.png"></p>')).toEqual([
      '/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&w=1',
      'https://cdn.example.com/b.png'
    ]);
  });

  it('recognizes direct image links and proxied image links only', () => {
    expect(isPreviewableImageUrl('https://cdn.example.com/a.webp?x=1')).toBe(true);
    expect(isPreviewableImageUrl('https://legacy.example.com/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa')).toBe(true);
    expect(isPreviewableImageUrl('https://linux.do/images/emoji/twitter/slight_smile.png?v=12')).toBe(false);
    expect(isPreviewableImageUrl('https://example.com/topic/1')).toBe(false);
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

  it('adds browser-like headers for known forum image hosts', () => {
    expect(imageRequestHeadersForUrl('https://i.111666.best/image/a.webp')).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: 'https://i.111666.best'
    });
    expect(imageSourceFromUrl('https://i.111666.best/image/a.webp')).toEqual({
      uri: 'https://i.111666.best/image/a.webp',
      headers: {
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        Referer: 'https://i.111666.best'
      }
    });
    expect(imageRequestHeadersForUrl('https://evil111666.best/image/a.webp')).toBeUndefined();
    expect(imageRequestHeadersForUrl('data:image/png;base64,abc')).toBeUndefined();
  });

  it('adds a browser user agent for NodeSeek avatar images', () => {
    expect(imageRequestHeadersForUrl('https://www.nodeseek.com/avatar/48872.png')).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: 'https://www.nodeseek.com',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
    });
  });

  it('builds a de-duplicated preview list and keeps tapped image position', () => {
    const result = createImagePreviewList({
      tappedUrl: 'https://cdn.example.com/b.png',
      htmlParts: [
        '<img src="https://cdn.example.com/a.jpg">',
        '<img src="https://cdn.example.com/b.png"><img src="https://cdn.example.com/a.jpg">'
      ]
    });

    expect(result).toEqual({
      urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.png'],
      index: 1
    });
  });

  it('keeps forum emoji images out of the preview gallery', () => {
    const html = '<p>hello <img class="emoji" src="https://linux.do/images/emoji/twitter/slight_smile.png?v=12" alt="🙂" title=":slight_smile:" width="20" height="20"><img src="https://cdn.example.com/photo.jpg"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/photo.jpg']);
    expect(createImagePreviewList({
      tappedUrl: 'https://cdn.example.com/photo.jpg',
      htmlParts: [html]
    })).toEqual({
      urls: ['https://cdn.example.com/photo.jpg'],
      index: 0
    });
  });

  it('marks images mixed with paragraph text as inline while keeping standalone images block-like', () => {
    const mixed = '<p>hello 😟<img alt="image" src="https://cdn.example.com/sticker.png"></p>';
    const standalone = '<p><img alt="image" src="https://cdn.example.com/photo.jpg"></p>';

    expect(flowInlineImagesInMixedParagraphs(mixed)).toContain('<forum-inline-image alt="image" src="https://cdn.example.com/sticker.png"></forum-inline-image>');
    expect(flowInlineImagesInMixedParagraphs(standalone)).toContain('<img alt="image" src="https://cdn.example.com/photo.jpg">');
  });

  it('keeps real HTML images previewable even when their URLs have no file extension', () => {
    const result = createImagePreviewList({
      tappedUrl: 'https://www.nodeseek.com/api/attachments/123',
      htmlParts: [
        '<p><img src="https://www.nodeseek.com/api/attachments/123" alt="photo"></p>',
        '<p><img class="emoji" src="https://www.nodeseek.com/images/emoji/smile.png" alt=":smile:" width="20" height="20"></p>'
      ]
    });

    expect(result).toEqual({
      urls: ['https://www.nodeseek.com/api/attachments/123'],
      index: 0
    });
  });
});
