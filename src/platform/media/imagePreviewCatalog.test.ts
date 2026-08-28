import { describe, expect, it } from 'vitest';

import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import { diagnosticRef } from '@/platform/diagnostics/diagnosticPolicy';
import {
  imagePreviewItemAt,
  imagePreviewListFromCatalog,
  isPreviewableImageUrl,
  prepareImagePreviewCatalog,
  projectImagePreviewCatalog,
  selectImageDisplaySource,
  selectImageOriginalSource
} from './imagePreviewCatalog';
import { shouldMarkLoadedImageInline } from './inlineMedia';

function catalog(
  descriptors: readonly ForumImagePreviewDescriptor[],
  contentWidth = 300,
  pixelRatio = 2,
  mediaContext?: Parameters<typeof projectImagePreviewCatalog>[1],
  isInlineSizedImage?: Parameters<typeof projectImagePreviewCatalog>[2]
) {
  return projectImagePreviewCatalog(
    prepareImagePreviewCatalog(descriptors, contentWidth, pixelRatio),
    mediaContext,
    isInlineSizedImage
  );
}

describe('image preview catalog', () => {
  it('reprojects inline exclusions from a prepared preview catalog', () => {
    const first = 'https://cdn.example.com/first-640.jpg';
    const second = 'https://cdn.example.com/first-1280.jpg';
    const prepared = prepareImagePreviewCatalog(
      [{ source: first, sourceSet: `${first} 640w, ${second} 1280w` }],
      360,
      2
    );

    expect(projectImagePreviewCatalog(prepared).items).toEqual([{ displayUri: second, originalUri: second }]);
    expect(projectImagePreviewCatalog(prepared, undefined, (url) => url === first).items).toEqual([]);
  });

  it('keeps prepared placeholder-only descriptors out of the preview catalog', () => {
    const placeholder = 'https://cdn.example.com/transparent.gif';

    expect(catalog([{ source: placeholder }]).items).toEqual([]);
    expect(catalog([{ dataOriginal: placeholder, source: 'https://cdn.example.com/real.jpg' }]).items).toEqual([
      {
        displayUri: 'https://cdn.example.com/real.jpg',
        originalUri: 'https://cdn.example.com/real.jpg'
      }
    ]);
  });

  it('separates one URL when its final Referer differs', () => {
    const imageUrl = 'https://i.imgur.com/shared.png';
    const referrer = { documentUrl: 'https://www.v2ex.com/t/1233346' } as const;
    const mediaContext = { contentSource: 'v2ex', referrer, sessionIdentity: 'v2ex:7' } as const;
    const result = catalog(
      [
        { source: imageUrl, referrerPolicy: 'no-referrer' },
        { source: imageUrl, referrerPolicy: 'origin' }
      ],
      300,
      2,
      mediaContext
    );

    expect(result.items).toEqual([
      { displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'no-referrer' },
      { displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'origin' }
    ]);
    expect(imagePreviewListFromCatalog(result, imageUrl, 'v2ex', undefined, 'origin')).toEqual({
      contentSource: 'v2ex',
      index: 1,
      items: result.items,
      referrer
    });
  });

  it('does not reuse an explicit policy when the tapped image uses the document policy', () => {
    const imageUrl = 'https://i.imgur.com/shared.png';
    const referrer = { documentUrl: 'https://www.v2ex.com/t/1233346' } as const;
    const mediaContext = { contentSource: 'v2ex', referrer, sessionIdentity: 'v2ex:7' } as const;
    const result = catalog([{ source: imageUrl, referrerPolicy: 'no-referrer' }], 300, 2, mediaContext);

    expect(imagePreviewListFromCatalog(result, imageUrl, 'v2ex')).toEqual({
      contentSource: 'v2ex',
      index: 1,
      items: [
        { displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'no-referrer' },
        { displayUri: imageUrl, originalUri: imageUrl }
      ],
      referrer
    });
  });

  it('links the responsive body URL and lightbox original to one media diagnostic ref', () => {
    const displayUrl = 'https://cdn.example.com/diagnostic-display-640.webp';
    const originalUrl = 'https://cdn.example.com/diagnostic-original.png';
    const bodyRef = diagnosticRef('media', displayUrl);

    catalog([
      {
        lightboxOriginal: originalUrl,
        source: 'https://cdn.example.com/fallback.png',
        sourceSet: `${displayUrl} 640w, ${originalUrl} 1600w`
      }
    ]);

    expect(diagnosticRef('media', originalUrl)).toBe(bodyRef);
  });

  it('does not merge different lazy images through a shared placeholder alias', () => {
    const firstOriginal = 'https://cdn.example.com/lazy-original-one.png';
    const secondOriginal = 'https://cdn.example.com/lazy-original-two.png';
    const placeholder = 'https://cdn.example.com/transparent.gif';
    const result = catalog([
      { source: placeholder, dataOriginal: firstOriginal },
      { source: placeholder, dataOriginal: secondOriginal }
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.itemIndexBySourceUrl).not.toHaveProperty(placeholder);
    expect(diagnosticRef('media', firstOriginal)).not.toBe(diagnosticRef('media', secondOriginal));
  });

  it('keeps the responsive body image separate from the lightbox original', () => {
    expect(
      catalog([
        {
          source: 'https://cdn.example.com/optimized.png',
          lightboxOriginal: 'https://cdn.example.com/original.png'
        }
      ]).items
    ).toEqual([
      {
        displayUri: 'https://cdn.example.com/optimized.png',
        originalUri: 'https://cdn.example.com/original.png'
      }
    ]);
  });

  it('rejects an unsafe original and keeps the sharpest safe source', () => {
    expect(
      selectImageOriginalSource({
        'data-original': 'javascript:alert(1)',
        src: 'https://cdn.example.com/display.png',
        srcset: 'https://cdn.example.com/display-640.png 640w, https://cdn.example.com/display-1280.png 1280w'
      })
    ).toBe('https://cdn.example.com/display-1280.png');
  });

  it('resolves body candidates at content width and keeps explicit originals', () => {
    expect(
      catalog([
        {
          source: 'https://cdn.example.com/a-fallback.jpg',
          dataOriginal: 'https://cdn.example.com/a-original.jpg',
          sourceSet:
            'https://cdn.example.com/a-320.jpg 320w, https://cdn.example.com/a-640.jpg 640w, https://cdn.example.com/a-1280.jpg 1280w'
        },
        {
          source: 'https://cdn.example.com/b-fallback.jpg',
          sourceSet:
            'https://cdn.example.com/b-360.jpg 360w, https://cdn.example.com/b-720.jpg 720w, https://cdn.example.com/b-1440.jpg 1440w'
        }
      ]).items
    ).toEqual([
      {
        displayUri: 'https://cdn.example.com/a-640.jpg',
        originalUri: 'https://cdn.example.com/a-original.jpg'
      },
      {
        displayUri: 'https://cdn.example.com/b-720.jpg',
        originalUri: 'https://cdn.example.com/b-1440.jpg'
      }
    ]);
  });

  it('selects the smallest responsive candidate that covers the rendered pixel width', () => {
    const attributes = {
      src: 'https://cdn.example.com/fallback.jpg',
      srcset: [
        'https://cdn.example.com/320.jpg 320w',
        'https://cdn.example.com/640.jpg 640w',
        'https://cdn.example.com/1280.jpg 1280w'
      ].join(', '),
      width: '1280',
      height: '720'
    };

    expect(selectImageDisplaySource(attributes, 300, 2)).toEqual({
      uri: 'https://cdn.example.com/640.jpg',
      candidateKind: 'srcset',
      displaySize: { width: 1280, height: 720 }
    });
    expect(selectImageDisplaySource(attributes, 800, 2)?.uri).toBe('https://cdn.example.com/1280.jpg');
  });

  it('caps a body candidate at 2048 physical pixels', () => {
    expect(
      selectImageDisplaySource(
        {
          src: 'https://cdn.example.com/fallback.jpg',
          srcset:
            'https://cdn.example.com/1024.jpg 1024w, https://cdn.example.com/2048.jpg 2048w, https://cdn.example.com/4096.jpg 4096w'
        },
        1_400,
        2
      )?.uri
    ).toBe('https://cdn.example.com/2048.jpg');
  });

  it('selects density candidates and falls back from unreliable candidate sets', () => {
    expect(
      selectImageDisplaySource(
        {
          src: 'https://cdn.example.com/fallback.jpg',
          srcset:
            'https://cdn.example.com/1x.jpg 1x, https://cdn.example.com/2x.jpg 2x, https://cdn.example.com/3x.jpg 3x'
        },
        300,
        2.5
      )?.uri
    ).toBe('https://cdn.example.com/3x.jpg');
    expect(
      selectImageDisplaySource(
        {
          src: 'https://cdn.example.com/fallback.jpg',
          srcset: 'https://cdn.example.com/wide.jpg 1200w, https://cdn.example.com/retina.jpg 2x'
        },
        300,
        2
      )
    ).toEqual({ uri: 'https://cdn.example.com/fallback.jpg', candidateKind: 'src' });
  });

  it('uses lazy attributes only when src is absent or a known placeholder', () => {
    expect(
      selectImageDisplaySource(
        {
          src: 'https://cdn.example.com/thumb.jpg',
          'data-src': 'https://cdn.example.com/lazy.jpg',
          'data-original': 'https://cdn.example.com/original.jpg'
        },
        300,
        2
      )?.uri
    ).toBe('https://cdn.example.com/thumb.jpg');
    expect(
      selectImageDisplaySource(
        {
          src: 'https://cdn.example.com/transparent.gif',
          'data-src': 'https://cdn.example.com/lazy.jpg',
          'data-original': 'https://cdn.example.com/original.jpg'
        },
        300,
        2
      )
    ).toEqual({ uri: 'https://cdn.example.com/lazy.jpg', candidateKind: 'data-src' });
  });

  it('refuses unsafe or relative tapped URLs as active preview requests', () => {
    const result = catalog([]);

    expect(imagePreviewListFromCatalog(result, 'javascript:x.png', 'linuxdo').items).toEqual([]);
    expect(imagePreviewListFromCatalog(result, '/api/image-proxy?id=1', 'linuxdo').items).toEqual([]);
  });

  it('recognizes direct image links and proxied image links only', () => {
    expect(isPreviewableImageUrl('https://cdn.example.com/a.webp?x=1')).toBe(true);
    expect(
      isPreviewableImageUrl('https://legacy.example.com/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa')
    ).toBe(true);
    expect(isPreviewableImageUrl('https://linux.do/images/emoji/twitter/slight_smile.png?v=12')).toBe(false);
    expect(isPreviewableImageUrl('https://example.com/topic/1')).toBe(false);
  });

  it('builds a de-duplicated preview list and keeps tapped image position', () => {
    const result = imagePreviewListFromCatalog(
      catalog([
        { source: 'https://cdn.example.com/a.jpg' },
        { source: 'https://cdn.example.com/b.png' },
        { source: 'https://cdn.example.com/a.jpg' }
      ]),
      'https://cdn.example.com/b.png',
      'linuxdo'
    );

    expect(result).toEqual({
      contentSource: 'linuxdo',
      items: [
        { displayUri: 'https://cdn.example.com/a.jpg', originalUri: 'https://cdn.example.com/a.jpg' },
        { displayUri: 'https://cdn.example.com/b.png', originalUri: 'https://cdn.example.com/b.png' }
      ],
      index: 1
    });
  });

  it('reuses the tapped responsive body candidate as the preview placeholder', () => {
    const result = catalog(
      [
        {
          source: 'https://cdn.example.com/fallback.png',
          sourceSet: 'https://cdn.example.com/320.png 320w, https://cdn.example.com/640.png 640w',
          lightboxOriginal: 'https://cdn.example.com/original.png'
        }
      ],
      300,
      2
    );
    const preview = imagePreviewListFromCatalog(result, 'https://cdn.example.com/640.png', null, {
      width: 640,
      height: 360
    });

    expect(preview.items).toBe(result.items);
    expect(imagePreviewItemAt(preview, 0)).toEqual({
      displayUri: 'https://cdn.example.com/640.png',
      originalUri: 'https://cdn.example.com/original.png',
      displaySize: { width: 640, height: 360 }
    });
  });

  it('keeps generic tiny images previewable and excludes only dynamically confirmed inline images', () => {
    const descriptors = [
      { source: 'https://i.imgur.com/agAJ0Rd.png', width: '20', height: '20' },
      { source: 'https://i.imgur.com/2ejt2Q6.png', width: '2198', height: '912' }
    ];
    const result = catalog(descriptors, 300, 2, undefined, (url) => url === descriptors[0]?.source);

    expect(result.items).toEqual([
      {
        displayUri: 'https://i.imgur.com/2ejt2Q6.png',
        originalUri: 'https://i.imgur.com/2ejt2Q6.png',
        displaySize: { width: 2198, height: 912 }
      }
    ]);
    expect(shouldMarkLoadedImageInline({ class: 'embedded_image' }, 20, 20)).toBe(true);
    expect(shouldMarkLoadedImageInline({ class: 'thumbnail' }, 20, 20)).toBe(false);
    expect(shouldMarkLoadedImageInline({ class: 'embedded_image' }, 358, 76)).toBe(false);
  });

  it('keeps descriptor images previewable when their URLs have no file extension', () => {
    const url = 'https://www.nodeseek.com/api/attachments/123';
    const result = imagePreviewListFromCatalog(catalog([{ source: url }]), url, 'nodeseek');

    expect(result).toEqual({
      contentSource: 'nodeseek',
      items: [{ displayUri: url, originalUri: url }],
      index: 0
    });
  });
});
