import { describe, expect, it } from 'vitest';
import {
  createImagePreviewList,
  extractImageUrlsFromHtml,
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
    expect(isPreviewableImageUrl('http://127.0.0.1:3000/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa')).toBe(true);
    expect(isPreviewableImageUrl('https://example.com/topic/1')).toBe(false);
  });

  it('normalizes relative proxy URLs against the configured server', () => {
    expect(normalizeImagePreviewUrl('/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg', ' http://10.0.2.2:3000/ ')).toBe(
      'http://10.0.2.2:3000/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg'
    );
  });

  it('builds a de-duplicated preview list and keeps tapped image position', () => {
    const result = createImagePreviewList({
      tappedUrl: 'https://cdn.example.com/b.png',
      htmlParts: [
        '<img src="https://cdn.example.com/a.jpg">',
        '<img src="https://cdn.example.com/b.png"><img src="https://cdn.example.com/a.jpg">'
      ],
      serverUrl: 'http://10.0.2.2:3000'
    });

    expect(result).toEqual({
      urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.png'],
      index: 1
    });
  });
});
