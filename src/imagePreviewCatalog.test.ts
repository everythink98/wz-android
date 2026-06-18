import { describe, expect, it, vi } from 'vitest';
import { createLazyImagePreviewResolver } from './imagePreviewCatalog';

describe('Android image preview catalog', () => {
  it('builds the preview catalog only when an image is opened', () => {
    const markInlineSizedImages = vi.fn((html: string) => html);
    const resolvePreview = createLazyImagePreviewResolver({
      htmlParts: [
        '<p><img src="https://cdn.example.com/a.jpg"></p>',
        '<p><img src="https://cdn.example.com/b.jpg"></p>'
      ],
      inlineSizedImageUrls: {},
      topicImageDeriver: {
        imageUrlsForHtml: () => [],
        markInlineSizedImages
      }
    });

    expect(markInlineSizedImages).not.toHaveBeenCalled();
    expect(resolvePreview('https://cdn.example.com/b.jpg')).toEqual({
      urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
      index: 1
    });
    expect(markInlineSizedImages).toHaveBeenCalledTimes(2);
  });
});
