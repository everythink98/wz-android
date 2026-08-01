import { describe, expect, it, vi } from 'vitest';
import {
  createTopicImageDeriver,
  filterRepliesWithImages,
  inlineSizedImageSignatureForHtml,
  inlineSizedImageSignatureForReply,
  replyHtmlWithSignature,
  sameInlineSizedImagesForHtml,
  sameInlineSizedImagesForReply
} from './topicDerivedData';
import type { Reply } from '@/domain/forum/models';

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
    const extractImageUrls = vi.fn((html: string) =>
      html.includes('cdn.example.com') ? ['https://cdn.example.com/a.jpg'] : []
    );
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

    expect(deriver.markInlineSizedImages(html, inlineSizedImageUrls)).toBe(
      '<p><img src="https://cdn.example.com/smile.png"></p><!-- inline:https://cdn.example.com/smile.png -->'
    );
    expect(deriver.markInlineSizedImages(html, inlineSizedImageUrls)).toBe(
      '<p><img src="https://cdn.example.com/smile.png"></p><!-- inline:https://cdn.example.com/smile.png -->'
    );
    expect(markInlineSizedImageHtml).toHaveBeenCalledTimes(1);
  });

  it('does not mark inline-sized image URLs in text-only html', () => {
    const markInlineSizedImageHtml = vi.fn((html: string, url: string) => `${html}<!-- inline:${url} -->`);
    const deriver = createTopicImageDeriver({
      extractImageUrls: () => [],
      markInlineSizedImageHtml
    });
    const html = '<p>https://cdn.example.com/smile.png</p>';

    expect(deriver.markInlineSizedImages(html, { 'https://cdn.example.com/smile.png': true })).toBe(html);
    expect(markInlineSizedImageHtml).not.toHaveBeenCalled();
  });

  it('scopes inline-sized image signatures to html that contains the image', () => {
    const inlineSizedImageUrls = {
      'https://cdn.example.com/a.png': true as const,
      'https://cdn.example.com/b.png': true as const
    };

    expect(
      inlineSizedImageSignatureForHtml('<p><img src="https://cdn.example.com/a.png"></p>', inlineSizedImageUrls)
    ).toBe('https://cdn.example.com/a.png');
    expect(inlineSizedImageSignatureForHtml('<p>no image</p>', inlineSizedImageUrls)).toBe('');
  });

  it('includes reply signatures in inline-sized image signatures', () => {
    const inlineSizedImageUrls = { 'https://cdn.example.com/sign.png': true as const };

    expect(
      inlineSizedImageSignatureForReply(
        {
          contentHtml: '<p>body</p>',
          signatureHtml: '<p><img src="https://cdn.example.com/sign.png"></p>'
        },
        inlineSizedImageUrls
      )
    ).toBe('https://cdn.example.com/sign.png');
  });

  it('[REG-PERF-007] skips inline image scans for changed replies and stable maps', () => {
    const scanned = vi.fn();
    const countedMap = () =>
      new Proxy(
        { 'https://cdn.example.com/a.jpg': true as const },
        {
          ownKeys(target) {
            scanned();
            return Reflect.ownKeys(target);
          }
        }
      );
    const firstMap = countedMap();
    const secondMap = countedMap();

    expect(sameInlineSizedImagesForReply(replyWithImage, { ...replyWithImage }, firstMap, secondMap)).toBe(false);
    expect(sameInlineSizedImagesForReply(replyWithImage, replyWithImage, firstMap, firstMap)).toBe(true);
    expect(
      sameInlineSizedImagesForHtml(replyWithImage.contentHtml, replyWithImage.contentHtml, firstMap, firstMap)
    ).toBe(true);
    expect(scanned).not.toHaveBeenCalled();

    expect(sameInlineSizedImagesForReply(replyWithImage, replyWithImage, firstMap, secondMap)).toBe(true);
    expect(scanned).toHaveBeenCalledTimes(2);
  });

  it('treats reply signature images as reply images', () => {
    const replyWithSignatureImage = {
      ...replyWithoutImage,
      signatureHtml: '<p><img src="https://cdn.example.com/sign.jpg"></p>'
    };
    const deriver = createTopicImageDeriver();

    expect(filterRepliesWithImages([replyWithSignatureImage], {}, deriver)).toEqual([replyWithSignatureImage]);
    expect(replyHtmlWithSignature(replyWithSignatureImage)).toContain('https://cdn.example.com/sign.jpg');
  });

  it('treats dimension-only small images as reply images without counting emoji', () => {
    const smallRealImage = {
      ...replyWithImage,
      contentHtml: '<p><img src="https://i.imgur.com/agAJ0Rd.png" class="thumbnail" width="20" height="20"></p>'
    };
    const emojiOnly = {
      ...replyWithoutImage,
      contentHtml:
        '<p><img class="emoji" src="https://linux.do/images/emoji/twitter/slight_smile.png" alt=":slight_smile:" title=":slight_smile:" width="20" height="20"></p>'
    };
    const deriver = createTopicImageDeriver();

    expect(filterRepliesWithImages([smallRealImage, emojiOnly], {}, deriver)).toEqual([smallRealImage]);
  });

  it('evicts old HTML image derivation cache entries after the configured limit', () => {
    const extractImageUrls = vi.fn((html: string) => [html.match(/src="([^"]+)"/)?.[1] || '']);
    const deriver = createTopicImageDeriver({ extractImageUrls, cacheLimit: 2 });
    const first = '<p><img src="https://cdn.example.com/1.jpg"></p>';
    const second = '<p><img src="https://cdn.example.com/2.jpg"></p>';
    const third = '<p><img src="https://cdn.example.com/3.jpg"></p>';

    expect(deriver.imageUrlsForHtml(first, {})).toEqual(['https://cdn.example.com/1.jpg']);
    expect(deriver.imageUrlsForHtml(second, {})).toEqual(['https://cdn.example.com/2.jpg']);
    expect(deriver.imageUrlsForHtml(third, {})).toEqual(['https://cdn.example.com/3.jpg']);
    expect(deriver.imageUrlsForHtml(first, {})).toEqual(['https://cdn.example.com/1.jpg']);
    expect(extractImageUrls).toHaveBeenCalledTimes(4);
  });
});
