import { describe, expect, it } from 'vitest';
import {
  createImagePreviewList,
  extractImageUrlsFromHtml,
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

  it('normalizes relative proxy URLs against the configured server', () => {
    expect(normalizeImagePreviewUrl('/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg', ' https://legacy.example.com/ ')).toBe(
      'https://legacy.example.com/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg'
    );
  });

  it('keeps relative legacy proxy URLs relative when no server is configured', () => {
    expect(normalizeImagePreviewUrl('/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg', '')).toBe(
      '/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg'
    );
  });

  it('builds a de-duplicated preview list and keeps tapped image position', () => {
    const result = createImagePreviewList({
      tappedUrl: 'https://cdn.example.com/b.png',
      htmlParts: [
        '<img src="https://cdn.example.com/a.jpg">',
        '<img src="https://cdn.example.com/b.png"><img src="https://cdn.example.com/a.jpg">'
      ],
      serverUrl: ''
    });

    expect(result).toEqual({
      urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.png'],
      index: 1
    });
  });
});
