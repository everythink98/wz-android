import { describe, expect, it, vi } from 'vitest';
import { createTopicImageDeriver, filterRepliesWithImages, inlineSizedImageSignatureForHtml } from './topicDerivedData';
import type { Reply } from './types';

const replyWithImage: Reply = {
  author: 'alice',
  contentHtml: '<p>photo <img src="https://cdn.example.com/a.jpg"></p>',
  createdAt: '2026-06-05T01:00:00.000Z',
  floor: 1
};

const replyWithoutImage: Reply = {
  author: 'bob',
  contentHtml: '<p>plain text</p>',
  createdAt: '2026-06-05T01:01:00.000Z',
  floor: 2
};

describe('Android topic derived data', () => {
  it('filters image replies through a cached HTML image deriver', () => {
    const extractImageUrls = vi.fn((html: string) => (
      html.includes('cdn.example.com') ? ['https://cdn.example.com/a.jpg'] : []
    ));
    const deriver = createTopicImageDeriver({ extractImageUrls });

    const first = filterRepliesWithImages([replyWithImage, replyWithoutImage], {}, deriver);
    const second = filterRepliesWithImages([replyWithImage, replyWithoutImage], {}, deriver);

    expect(first).toEqual([replyWithImage]);
    expect(second).toEqual([replyWithImage]);
    expect(extractImageUrls).toHaveBeenCalledTimes(2);
  });

  it('marks inline sized images once per html and inline-url set', () => {
    const markInlineSizedImageHtml = vi.fn((html: string, url: string) => `${html}<!-- inline:${url} -->`);
    const deriver = createTopicImageDeriver({
      extractImageUrls: () => [],
      markInlineSizedImageHtml
    });
    const inlineSizedImageUrls = { 'https://cdn.example.com/smile.png': true as const };

    const html = '<p><img src="https://cdn.example.com/smile.png"></p>';

    expect(deriver.markInlineSizedImages(html, inlineSizedImageUrls)).toBe('<p><img src="https://cdn.example.com/smile.png"></p><!-- inline:https://cdn.example.com/smile.png -->');
    expect(deriver.markInlineSizedImages(html, inlineSizedImageUrls)).toBe('<p><img src="https://cdn.example.com/smile.png"></p><!-- inline:https://cdn.example.com/smile.png -->');
    expect(markInlineSizedImageHtml).toHaveBeenCalledTimes(1);
  });

  it('scopes inline-sized image signatures to html that contains the image', () => {
    const inlineSizedImageUrls = {
      'https://cdn.example.com/a.png': true as const,
      'https://cdn.example.com/b.png': true as const
    };

    expect(inlineSizedImageSignatureForHtml('<p><img src="https://cdn.example.com/a.png"></p>', inlineSizedImageUrls)).toBe('https://cdn.example.com/a.png');
    expect(inlineSizedImageSignatureForHtml('<p>no image</p>', inlineSizedImageUrls)).toBe('');
  });
});
