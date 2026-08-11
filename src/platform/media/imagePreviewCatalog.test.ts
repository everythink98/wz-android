import { describe, expect, it } from 'vitest';

import { diagnosticRef } from '@/platform/diagnostics/diagnosticPolicy';
import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import {
  createImagePreviewCatalog,
  extractImageUrlsFromHtml,
  imagePreviewListFromCatalog,
  isPreviewableImageUrl,
  selectImageDisplaySource,
  selectImageOriginalSource
} from './imagePreviewCatalog';
import { shouldMarkLoadedImageInline } from './inlineMedia';

describe('image preview catalog', () => {
  it('[REG-TOPIC-078] keeps element policy and separates one URL when its final Referer differs', () => {
    const imageUrl = 'https://i.imgur.com/shared.png';
    const referrer = { documentUrl: 'https://www.v2ex.com/t/1233346' } as const;
    const mediaContext = { contentSource: 'v2ex', referrer, sessionIdentity: 'v2ex:7' } as const;
    const catalog = createImagePreviewCatalog(
      [`<img src="${imageUrl}" referrerpolicy="no-referrer">`, `<img src="${imageUrl}" referrerpolicy="origin">`],
      300,
      2,
      mediaContext
    );

    expect(catalog.items).toEqual([
      { displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'no-referrer' },
      { displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'origin' }
    ]);
    expect(imagePreviewListFromCatalog(catalog, imageUrl, 'v2ex', undefined, 'origin')).toEqual({
      contentSource: 'v2ex',
      index: 1,
      items: catalog.items,
      referrer
    });
  });

  it('[REG-TOPIC-078] does not reuse an explicit policy when the tapped image uses the document policy', () => {
    const imageUrl = 'https://i.imgur.com/shared.png';
    const referrer = { documentUrl: 'https://www.v2ex.com/t/1233346' } as const;
    const mediaContext = { contentSource: 'v2ex', referrer, sessionIdentity: 'v2ex:7' } as const;
    const catalog = createImagePreviewCatalog(
      [`<img src="${imageUrl}" referrerpolicy="no-referrer">`],
      300,
      2,
      mediaContext
    );

    expect(imagePreviewListFromCatalog(catalog, imageUrl, 'v2ex')).toEqual({
      contentSource: 'v2ex',
      index: 1,
      items: [
        { displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'no-referrer' },
        { displayUri: imageUrl, originalUri: imageUrl }
      ],
      referrer
    });
  });

  it('[REG-TOPIC-078] keeps a mixed-case image policy after sanitizing into the preview catalog', () => {
    const imageUrl = 'https://cdn.example.com/mixed-case.png';
    const html = sanitizeContentHtml(
      `<img src="${imageUrl}" ReFeRrErPoLiCy="no-referrer">`,
      'https://www.v2ex.com/t/1233346'
    );

    expect(createImagePreviewCatalog([html], 300, 2).items).toEqual([
      { displayUri: imageUrl, originalUri: imageUrl, referrerPolicy: 'no-referrer' }
    ]);
  });

  it('links the responsive body URL and lightbox original to one media diagnostic ref', () => {
    const displayUrl = 'https://cdn.example.com/diagnostic-display-640.webp';
    const originalUrl = 'https://cdn.example.com/diagnostic-original.png';
    const bodyRef = diagnosticRef('media', displayUrl);

    createImagePreviewCatalog(
      [
        `<a href="${originalUrl}"><img src="https://cdn.example.com/fallback.png" srcset="${displayUrl} 640w, ${originalUrl} 1600w"></a>`
      ],
      300,
      2
    );

    expect(diagnosticRef('media', originalUrl)).toBe(bodyRef);
  });

  it('does not merge different lazy images through a shared placeholder alias', () => {
    const firstOriginal = 'https://cdn.example.com/lazy-original-one.png';
    const secondOriginal = 'https://cdn.example.com/lazy-original-two.png';
    const placeholder = 'https://cdn.example.com/transparent.gif';
    const catalog = createImagePreviewCatalog(
      [
        `<img src="${placeholder}" data-original="${firstOriginal}"><img src="${placeholder}" data-original="${secondOriginal}">`
      ],
      300,
      2
    );

    expect(catalog.items).toHaveLength(2);
    expect(catalog.itemIndexBySourceUrl).not.toHaveProperty(placeholder);
    expect(diagnosticRef('media', firstOriginal)).not.toBe(diagnosticRef('media', secondOriginal));
  });

  it('[REG-TOPIC-040] keeps the responsive body image separate from the lightbox original', () => {
    const html =
      '<div class="lightbox-wrapper"><a class="lightbox" href="https://cdn.example.com/original.png"><img src="https://cdn.example.com/optimized.png" alt="photo"></a></div>';
    expect(createImagePreviewCatalog([html], 300, 2).items).toEqual([
      {
        displayUri: 'https://cdn.example.com/optimized.png',
        originalUri: 'https://cdn.example.com/original.png'
      }
    ]);
  });

  it('[REG-TOPIC-048] carries the safe lightbox original into the progressive renderer', () => {
    expect(
      selectImageOriginalSource({
        'data-original': 'javascript:alert(1)',
        src: 'https://cdn.example.com/display.png',
        srcset: 'https://cdn.example.com/display-640.png 640w, https://cdn.example.com/display-1280.png 1280w'
      })
    ).toBe('https://cdn.example.com/display-1280.png');
  });

  it('[REG-TOPIC-040] resolves every catalog placeholder at the body width and keeps explicit originals', () => {
    const html = [
      '<img src="https://cdn.example.com/a-fallback.jpg" data-original="https://cdn.example.com/a-original.jpg" srcset="https://cdn.example.com/a-320.jpg 320w, https://cdn.example.com/a-640.jpg 640w, https://cdn.example.com/a-1280.jpg 1280w">',
      '<img src="https://cdn.example.com/b-fallback.jpg" srcset="https://cdn.example.com/b-360.jpg 360w, https://cdn.example.com/b-720.jpg 720w, https://cdn.example.com/b-1440.jpg 1440w">'
    ].join('');

    expect(createImagePreviewCatalog([html], 300, 2).items).toEqual([
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

  it('[REG-PERF-010] caps an inline body candidate at 2048 physical pixels', () => {
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

  it('selects density srcset candidates and falls back from unreliable candidate sets', () => {
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
    ).toEqual({
      uri: 'https://cdn.example.com/fallback.jpg',
      candidateKind: 'src'
    });
    expect(
      selectImageDisplaySource(
        {
          src: 'https://cdn.example.com/fallback.jpg',
          srcset: 'https://cdn.example.com/unqualified.jpg, https://cdn.example.com/retina.jpg 2x'
        },
        300,
        2
      )?.uri
    ).toBe('https://cdn.example.com/fallback.jpg');
  });

  it('uses lazy attributes for the body only when src is absent or a known placeholder', () => {
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
    ).toEqual({
      uri: 'https://cdn.example.com/lazy.jpg',
      candidateKind: 'data-src'
    });

    expect(
      selectImageDisplaySource(
        {
          src: 'javascript:alert(1)',
          'data-original': 'https://cdn.example.com/original.jpg'
        },
        300,
        2
      )?.uri
    ).toBe('https://cdn.example.com/original.jpg');

    const lazyHtml =
      '<img src="https://cdn.example.com/transparent.gif" data-src="https://cdn.example.com/lazy.jpg" data-original="https://cdn.example.com/original.jpg">';
    expect(
      selectImageDisplaySource(
        {
          src: 'https://cdn.example.com/lazy.jpg',
          'data-src': 'https://cdn.example.com/lazy.jpg',
          'data-forum-display-candidate-kind': 'data-src'
        },
        300,
        2
      )?.candidateKind
    ).toBe('data-src');
    expect(createImagePreviewCatalog([lazyHtml], 300, 2).items).toEqual([
      {
        displayUri: 'https://cdn.example.com/lazy.jpg',
        originalUri: 'https://cdn.example.com/original.jpg'
      }
    ]);
  });

  it('[REG-TOPIC-030] refuses an unsafe or relative tapped URL as an active preview request', () => {
    const catalog = createImagePreviewCatalog([], 300, 2);

    expect(imagePreviewListFromCatalog(catalog, 'javascript:x.png', 'linuxdo').items).toEqual([]);
    expect(imagePreviewListFromCatalog(catalog, '/api/image-proxy?id=1', 'linuxdo').items).toEqual([]);
  });

  it('[REG-TOPIC-033] decodes parsed image attributes exactly once', () => {
    expect(extractImageUrlsFromHtml('<img src="https://cdn.example.com/photo.png?label=&amp;lt;">')).toEqual([
      'https://cdn.example.com/photo.png?label=&lt;'
    ]);
  });

  it('extracts and decodes image URLs from rendered HTML', () => {
    expect(
      extractImageUrlsFromHtml(
        '<p><img src="https://legacy.example.com/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&amp;w=1"><img data-src="x"><img src="https://cdn.example.com/b.png"></p>'
      )
    ).toEqual([
      'https://legacy.example.com/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&w=1',
      'https://cdn.example.com/b.png'
    ]);
  });

  it('prefers original lightbox image URLs over optimized inline image URLs', () => {
    const html =
      '<div class="lightbox-wrapper"><a class="lightbox" href="https://cdn.example.com/original.png"><img src="https://cdn.example.com/optimized.png" alt="photo"></a></div>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/original.png']);
    expect(
      imagePreviewListFromCatalog(
        createImagePreviewCatalog([html], 300, 2),
        'https://cdn.example.com/optimized.png',
        null
      )
    ).toEqual({
      contentSource: null,
      items: [
        {
          displayUri: 'https://cdn.example.com/optimized.png',
          originalUri: 'https://cdn.example.com/original.png'
        }
      ],
      index: 0
    });
  });

  it('reuses the responsive body candidate that was actually tapped as the preview placeholder', () => {
    const html =
      '<a class="lightbox" href="https://cdn.example.com/original.png"><img src="https://cdn.example.com/fallback.png" srcset="https://cdn.example.com/320.png 320w, https://cdn.example.com/640.png 640w"></a>';

    expect(
      imagePreviewListFromCatalog(createImagePreviewCatalog([html], 300, 2), 'https://cdn.example.com/640.png', null, {
        width: 640,
        height: 360
      })
    ).toEqual({
      contentSource: null,
      items: [
        {
          displayUri: 'https://cdn.example.com/640.png',
          originalUri: 'https://cdn.example.com/original.png',
          displaySize: { width: 640, height: 360 }
        }
      ],
      index: 0
    });
  });

  it('prefers the sharpest srcset image when no original lightbox URL exists', () => {
    const html =
      '<p><img src="https://cdn.example.com/small.jpg" srcset="https://cdn.example.com/small.jpg 1x, https://cdn.example.com/large.jpg 2x, https://cdn.example.com/wide.jpg 1200w" alt="photo"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/wide.jpg']);
  });

  it('falls back to data-original and data-src before the visible image src', () => {
    expect(
      extractImageUrlsFromHtml(
        '<img src="https://cdn.example.com/thumb.jpg" data-original="https://cdn.example.com/original.jpg">'
      )
    ).toEqual(['https://cdn.example.com/original.jpg']);
    expect(
      extractImageUrlsFromHtml(
        '<img src="https://cdn.example.com/thumb.jpg" data-src="https://cdn.example.com/lazy.jpg">'
      )
    ).toEqual(['https://cdn.example.com/lazy.jpg']);
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
      createImagePreviewCatalog(
        [
          '<img src="https://cdn.example.com/a.jpg">',
          '<img src="https://cdn.example.com/b.png"><img src="https://cdn.example.com/a.jpg">'
        ],
        300,
        2
      ),
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

  it('keeps forum emoji images out of the preview gallery', () => {
    const html =
      '<p>hello <img class="emoji" src="https://linux.do/images/emoji/twitter/slight_smile.png?v=12" alt="🙂" title=":slight_smile:" width="20" height="20"><img src="https://cdn.example.com/photo.jpg"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/photo.jpg']);
    expect(
      imagePreviewListFromCatalog(createImagePreviewCatalog([html], 300, 2), 'https://cdn.example.com/photo.jpg', null)
    ).toEqual({
      contentSource: null,
      items: [{ displayUri: 'https://cdn.example.com/photo.jpg', originalUri: 'https://cdn.example.com/photo.jpg' }],
      index: 0
    });
  });

  it('does not treat a pure forum emoji reply as containing previewable images', () => {
    const html =
      '<p><img class="emoji" src="https://linux.do/uploads/default/original/3X/smile.webp" alt=":smile:" title=":smile:" width="48" height="48"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual([]);
  });

  it('keeps generic dimension-only tiny images previewable because size alone is not an emoji signal', () => {
    const html =
      '<p>去年是机房火灾 <img src="https://i.imgur.com/agAJ0Rd.png" class="thumbnail" width="20" height="20"></p><p><img alt="" class="embedded_image" src="https://i.imgur.com/2ejt2Q6.png" width="2198" height="912"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual([
      'https://i.imgur.com/agAJ0Rd.png',
      'https://i.imgur.com/2ejt2Q6.png'
    ]);
    expect(
      imagePreviewListFromCatalog(createImagePreviewCatalog([html], 300, 2), 'https://i.imgur.com/2ejt2Q6.png', null)
    ).toEqual({
      contentSource: null,
      items: [
        {
          displayUri: 'https://i.imgur.com/agAJ0Rd.png',
          originalUri: 'https://i.imgur.com/agAJ0Rd.png',
          displaySize: { width: 20, height: 20 }
        },
        {
          displayUri: 'https://i.imgur.com/2ejt2Q6.png',
          originalUri: 'https://i.imgur.com/2ejt2Q6.png',
          displaySize: { width: 2198, height: 912 }
        }
      ],
      index: 1
    });
  });

  it('keeps tiny V2EX embedded images inline after their size is known', () => {
    const html =
      '<p>去年是机房火灾 <img src="https://i.imgur.com/agAJ0Rd.png" class="embedded_image" width="20" height="20"></p><p><img alt="" class="embedded_image" src="https://i.imgur.com/2ejt2Q6.png" width="2198" height="912"></p>';
    expect(shouldMarkLoadedImageInline({ class: 'embedded_image' }, 20, 20)).toBe(true);
    expect(shouldMarkLoadedImageInline({ class: 'thumbnail' }, 20, 20)).toBe(false);
    expect(shouldMarkLoadedImageInline({ class: 'embedded_image' }, 358, 76)).toBe(false);
    expect(extractImageUrlsFromHtml(html)).toEqual(['https://i.imgur.com/2ejt2Q6.png']);
  });

  it('keeps forum emoji paths from all Android sources out of preview', () => {
    const html = [
      '<img src="https://linux.do/images/emoji/twitter/slight_smile.png?v=12" alt=":slight_smile:" width="20" height="20">',
      '<img src="https://www.nodeseek.com/static/image/smiley/xhj032.png" alt="xhj032" width="120" height="99">',
      '<img src="https://www.v2ex.com/static/img/emoji/smile.png" alt=":smile:" width="20" height="20">',
      '<img src="https://yaohuo.me/NetImages/face/1.gif" alt="微笑">',
      '<img src="https://cdn.example.com/photo.jpg" alt="photo">'
    ].join('');

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('keeps xhj sticker images out of the preview catalog', () => {
    const html = '<p>前两天刚买的bugnet，买早了<img alt="xhj032" src="https://cdn.example.com/xhj032.png"></p>';
    expect(extractImageUrlsFromHtml(html)).toEqual([]);
  });

  it('keeps large NodeSeek xhj stickers out of the preview catalog', () => {
    const html =
      '<p>rt<br>有什么特别之处吗 <img alt="xhj032" title="xhj032" width="120" height="99" src="https://www.nodeseek.com/static/image/smiley/xhj032.png"><br><img alt="photo" src="https://www.nodeseek.com/api/attachments/123"></p>';
    expect(extractImageUrlsFromHtml(html)).toEqual(['https://www.nodeseek.com/api/attachments/123']);
  });

  it('keeps forum avatar images out of the preview catalog', () => {
    const avatar = 'https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png';
    const html = `<aside class="quote"><div class="title"><div class="quote-controls"></div><img alt="" width="24" height="24" src="${avatar}" class="avatar"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/1">Quoted topic</a></div></div><blockquote><p>quoted text</p></blockquote></aside><p><img src="https://cdn.example.com/photo.jpg"></p>`;
    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('keeps real HTML images previewable even when their URLs have no file extension', () => {
    const result = imagePreviewListFromCatalog(
      createImagePreviewCatalog(
        [
          '<p><img src="https://www.nodeseek.com/api/attachments/123" alt="photo"></p>',
          '<p><img class="emoji" src="https://www.nodeseek.com/images/emoji/smile.png" alt=":smile:" width="20" height="20"></p>'
        ],
        300,
        2
      ),
      'https://www.nodeseek.com/api/attachments/123',
      'nodeseek'
    );

    expect(result).toEqual({
      contentSource: 'nodeseek',
      items: [
        {
          displayUri: 'https://www.nodeseek.com/api/attachments/123',
          originalUri: 'https://www.nodeseek.com/api/attachments/123'
        }
      ],
      index: 0
    });
  });
});
