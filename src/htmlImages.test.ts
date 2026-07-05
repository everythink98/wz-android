import { describe, expect, it } from 'vitest';
import {
  createImagePreviewCatalog,
  dataImageFileFromUrl,
  extractImageUrlsFromHtml,
  flowInlineImagesInMixedParagraphs,
  imagePreviewListFromCatalog,
  imageRequestHeadersForUrl,
  imageSourceFromUrl,
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize,
  isHttpOrHttpsUrl,
  isPreviewableImageUrl,
  normalizeImagePreviewUrl,
  visibleImagePreviewThumbnails
} from './htmlImages';

describe('Android HTML image preview helpers', () => {
  it('extracts and decodes image URLs from rendered HTML', () => {
    expect(extractImageUrlsFromHtml('<p><img src="/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&amp;w=1"><img data-src="x"><img src="https://cdn.example.com/b.png"></p>')).toEqual([
      '/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fa.jpg&w=1',
      'https://cdn.example.com/b.png'
    ]);
  });

  it('prefers original lightbox image URLs over optimized inline image URLs', () => {
    const html = '<div class="lightbox-wrapper"><a class="lightbox" href="https://cdn.example.com/original.png"><img src="https://cdn.example.com/optimized.png" alt="photo"></a></div>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/original.png']);
    expect(imagePreviewListFromCatalog(createImagePreviewCatalog([html]), 'https://cdn.example.com/optimized.png')).toEqual({
      urls: ['https://cdn.example.com/original.png'],
      index: 0
    });
  });

  it('prefers the sharpest srcset image when no original lightbox URL exists', () => {
    const html = '<p><img src="https://cdn.example.com/small.jpg" srcset="https://cdn.example.com/small.jpg 1x, https://cdn.example.com/large.jpg 2x, https://cdn.example.com/wide.jpg 1200w" alt="photo"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/wide.jpg']);
  });

  it('falls back to data-original and data-src before the visible image src', () => {
    expect(extractImageUrlsFromHtml('<img src="https://cdn.example.com/thumb.jpg" data-original="https://cdn.example.com/original.jpg">')).toEqual([
      'https://cdn.example.com/original.jpg'
    ]);
    expect(extractImageUrlsFromHtml('<img src="https://cdn.example.com/thumb.jpg" data-src="https://cdn.example.com/lazy.jpg">')).toEqual([
      'https://cdn.example.com/lazy.jpg'
    ]);
  });

  it('recognizes direct image links and proxied image links only', () => {
    expect(isPreviewableImageUrl('https://cdn.example.com/a.webp?x=1')).toBe(true);
    expect(isPreviewableImageUrl('https://legacy.example.com/api/image-proxy?url=https%3A%2F%2Fcdn.example.com%2Fa')).toBe(true);
    expect(isPreviewableImageUrl('https://linux.do/images/emoji/twitter/slight_smile.png?v=12')).toBe(false);
    expect(isPreviewableImageUrl('https://example.com/topic/1')).toBe(false);
  });

  it('keeps svg data images out of preview and saving', () => {
    expect(isPreviewableImageUrl('data:image/png;base64,abc')).toBe(true);
    expect(isPreviewableImageUrl('data:image/svg+xml;base64,abc')).toBe(false);
    expect(extractImageUrlsFromHtml('<img src="data:image/svg+xml;base64,abc"><img src="data:image/webp;base64,ok">')).toEqual([
      'data:image/webp;base64,ok'
    ]);
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

  it('keeps Imgur topic images on their original URL', () => {
    expect(imageSourceFromUrl('https://i.imgur.com/hKWwFrX.jpeg')).toEqual({
      uri: 'https://i.imgur.com/hKWwFrX.jpeg'
    });
  });

  it('adds a browser user agent for NodeSeek avatar images', () => {
    expect(imageRequestHeadersForUrl('https://www.nodeseek.com/avatar/48872.png')).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: 'https://www.nodeseek.com',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
    });
  });

  it('does not send NodeSeek login cookies to public static sticker media', () => {
    expect(imageRequestHeadersForUrl('https://www.nodeseek.com/static/image/sticker/emoji/00.webm', 'uid=1')).toEqual({
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      Referer: 'https://www.nodeseek.com',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
    });
  });

  it('keeps NodeSeek cookies for media URLs that may require login', () => {
    expect(imageRequestHeadersForUrl('https://www.nodeseek.com/api/attachments/123', 'uid=1')?.Cookie).toBe('uid=1');
  });

  it('builds a de-duplicated preview list and keeps tapped image position', () => {
    const result = imagePreviewListFromCatalog(createImagePreviewCatalog([
        '<img src="https://cdn.example.com/a.jpg">',
        '<img src="https://cdn.example.com/b.png"><img src="https://cdn.example.com/a.jpg">'
      ]), 'https://cdn.example.com/b.png');

    expect(result).toEqual({
      urls: ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.png'],
      index: 1
    });
  });

  it('windows image preview thumbnails around the active image', () => {
    const urls = Array.from({ length: 100 }, (_, index) => `https://cdn.example.com/${index}.jpg`);

    expect(visibleImagePreviewThumbnails(urls, 50).map((item) => item.index)).toEqual([44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56]);
    expect(visibleImagePreviewThumbnails(urls, 2).map((item) => item.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('keeps forum emoji images out of the preview gallery', () => {
    const html = '<p>hello <img class="emoji" src="https://linux.do/images/emoji/twitter/slight_smile.png?v=12" alt="🙂" title=":slight_smile:" width="20" height="20"><img src="https://cdn.example.com/photo.jpg"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://cdn.example.com/photo.jpg']);
    expect(imagePreviewListFromCatalog(createImagePreviewCatalog([html]), 'https://cdn.example.com/photo.jpg')).toEqual({
      urls: ['https://cdn.example.com/photo.jpg'],
      index: 0
    });
  });

  it('does not treat a pure forum emoji reply as containing previewable images', () => {
    const html = '<p><img class="emoji" src="https://linux.do/uploads/default/original/3X/smile.webp" alt=":smile:" title=":smile:" width="48" height="48"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual([]);
  });

  it('keeps dimension-only tiny images previewable because size alone is not an emoji signal', () => {
    const html = '<p>去年是机房火灾 <img src="https://i.imgur.com/agAJ0Rd.png" class="embedded_image" width="20" height="20"></p><p><img alt="" class="embedded_image" src="https://i.imgur.com/2ejt2Q6.png" width="2198" height="912"></p>';

    expect(extractImageUrlsFromHtml(html)).toEqual(['https://i.imgur.com/agAJ0Rd.png', 'https://i.imgur.com/2ejt2Q6.png']);
    expect(imagePreviewListFromCatalog(createImagePreviewCatalog([html]), 'https://i.imgur.com/2ejt2Q6.png')).toEqual({
      urls: ['https://i.imgur.com/agAJ0Rd.png', 'https://i.imgur.com/2ejt2Q6.png'],
      index: 1
    });
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

  it('uses the source dimensions for small forum emoji display', () => {
    expect(inlineForumImageDisplaySize({
      class: 'emoji',
      src: 'https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15',
      alt: ':joy:',
      title: ':joy:',
      width: '20',
      height: '20'
    })).toEqual({ width: 20, height: 20 });
  });

  it('nudges small forum emoji down to the middle of the text line', () => {
    expect(inlineForumImageAlignmentStyle({
      class: 'emoji',
      src: 'https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15',
      alt: ':joy:',
      title: ':joy:',
      width: '20',
      height: '20'
    }, 1, 26)).toEqual({ transform: [{ translateY: 3 }] });
  });

  it('keeps real images block-like even when mixed with paragraph text', () => {
    const mixed = '<p>hello 😟<img alt="image" src="https://cdn.example.com/sticker.png"></p>';
    const standalone = '<p><img alt="image" src="https://cdn.example.com/photo.jpg"></p>';

    expect(flowInlineImagesInMixedParagraphs(mixed)).toContain('<img alt="image" src="https://cdn.example.com/sticker.png">');
    expect(flowInlineImagesInMixedParagraphs(mixed)).not.toContain('<forum-inline-image alt="image" src="https://cdn.example.com/sticker.png">');
    expect(flowInlineImagesInMixedParagraphs(standalone)).toContain('<img alt="image" src="https://cdn.example.com/photo.jpg">');
  });

  it('renders forum emoji in mixed paragraphs through the inline image path', () => {
    const html = '<p>hello <img class="emoji" src="https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15" alt=":joy:" title=":joy:" width="20" height="20"></p>';

    expect(flowInlineImagesInMixedParagraphs(html)).toContain('<forum-inline-image class="emoji"');
    expect(flowInlineImagesInMixedParagraphs(html)).not.toContain('<img class="emoji"');
  });

  it('renders standalone V2EX emoji through the inline image path', () => {
    const html = '<p><img src="https://www.v2ex.com/static/img/emoji/smile.png" alt=":smile:" width="20" height="20"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-image');
    expect(result).not.toContain('<forum-sticker-row>');
    expect(result).not.toContain('<img');
  });

  it('renders standalone linux.do emoji through the inline image path', () => {
    const html = '<p><img class="emoji" src="https://linux.do/images/emoji/twemoji/grinning_face.png" alt=":grinning_face:" width="20" height="20"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-image class="emoji"');
    expect(result).not.toContain('<forum-sticker-row>');
    expect(result).not.toContain('<img class="emoji"');
  });

  it('renders Yaohuo face images through the inline image path', () => {
    const html = '<p>红包可能不一样 <img src="https://yaohuo.me/bbs/face/淡定.gif" class="ubbimg" alt="淡定"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-image src="https://yaohuo.me/bbs/face/淡定.gif" class="ubbimg"');
    expect(result).not.toContain('<img src="https://yaohuo.me/bbs/face/淡定.gif"');
  });

  it('does not treat standalone Yaohuo face images as sticker rows', () => {
    const html = '<p><img src="https://yaohuo.me/bbs/face/淡定.gif" class="ubbimg" alt="淡定"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-image src="https://yaohuo.me/bbs/face/淡定.gif" class="ubbimg"');
    expect(result).not.toContain('<forum-sticker-row>');
  });

  it('renders xhj sticker images in mixed paragraphs through the inline media line path', () => {
    const html = '<p>前两天刚买的bugnet，买早了<img alt="xhj032" src="https://cdn.example.com/xhj032.png"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-media-line>前两天刚买的bugnet，买早了<forum-sticker alt="xhj032"');
    expect(result).not.toContain('<img alt="xhj032"');
    expect(extractImageUrlsFromHtml(html)).toEqual([]);
  });

  it('moves large text-mixed NodeSeek xhj stickers out of the text paragraph', () => {
    const html = '<p>rt<br>有什么特别之处吗 <img alt="xhj032" title="xhj032" width="120" height="99" src="https://www.nodeseek.com/static/image/smiley/xhj032.png"><br><img alt="photo" src="https://www.nodeseek.com/api/attachments/123"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>有什么特别之处吗</p>');
    expect(result).toContain('<forum-sticker-row><forum-sticker alt="xhj032"');
    expect(result).toContain('data-forum-sticker-row="true"');
    expect(result).not.toContain('<forum-inline-image alt="xhj032"');
    expect(result).not.toContain('<img alt="xhj032"');
    expect(extractImageUrlsFromHtml(html)).toEqual(['https://www.nodeseek.com/api/attachments/123']);
  });

  it('keeps small text-mixed NodeSeek stickers inline', () => {
    const html = '<p>文字 <img class="sticker" width="30" height="26" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" loading="lazy" alt="ac01"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).not.toContain('<forum-sticker-row>');
    expect(result).toContain('<forum-inline-media-line>文字 <forum-sticker class="sticker"');
  });

  it('moves NodeSeek sticker class images without source dimensions out of the text line', () => {
    const html = '<p><img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" loading="lazy" alt="ac01"> 拉段了吗</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-sticker-row><forum-sticker class="sticker"');
    expect(result).toContain('<p>拉段了吗</p>');
    expect(result).not.toContain('<forum-inline-image class="sticker"');
    expect(result).not.toContain('<img class="sticker"');
  });

  it('keeps small no-dimension NodeSeek xhj stickers inline with surrounding text', () => {
    const html = '<p>应该可以类比成公交车和出租车 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/xhj/001.png" alt="xhj001"><br>公交车便宜，但是路程不是直达，会绕路</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-media-line>应该可以类比成公交车和出租车 <forum-sticker class="sticker"');
    expect(result).toContain('src="https://www.nodeseek.com/static/image/sticker/xhj/001.png"');
    expect(result).toContain('</forum-inline-media-line><p>公交车便宜，但是路程不是直达，会绕路</p>');
    expect(result).not.toContain('<forum-sticker-row>');
  });

  it('preserves text order around a text-mixed NodeSeek sticker row', () => {
    const html = '<p>公交车便宜 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/35.png" alt="emoji35"> 出租车直达</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>公交车便宜</p><forum-sticker-row><forum-sticker class="sticker"');
    expect(result).toContain('</forum-sticker-row><p>出租车直达</p>');
    expect(result).not.toContain('<forum-inline-image class="sticker"');
  });

  it('keeps unknown no-dimension NodeSeek sticker packs inline instead of guessing a large layout', () => {
    const html = '<p>公交车便宜 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/unknown/01.png" alt="unknown01"> 出租车直达</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-media-line>公交车便宜 <forum-sticker class="sticker"');
    expect(result).toContain('src="https://www.nodeseek.com/static/image/sticker/unknown/01.png"');
    expect(result).toContain('出租车直达</forum-inline-media-line>');
    expect(result).not.toContain('<forum-sticker-row>');
  });

  it('preserves text before a line break when a later text line contains a NodeSeek sticker', () => {
    const html = '<p>rt,刚坠机，我只是带上自己的ip段<br>ipv6顶一会儿 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/35.png" alt="emoji35"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-sticker-row><forum-sticker class="sticker"');
    expect(result).toContain('rt,刚坠机，我只是带上自己的ip段');
    expect(result).toContain('<p>ipv6顶一会儿</p>');
    expect(result).not.toContain('ipv6顶一会儿 <forum-inline-image class="sticker"');
  });

  it('renders media-only NodeSeek sticker source lines as one sticker row', () => {
    const html = '<p>正文<br><img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01"> <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/02.png" alt="ac02"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>正文</p>');
    expect(result).toContain('<forum-sticker-row><forum-sticker class="sticker"');
    expect(result.match(/<forum-sticker/g)).toHaveLength(3);
    expect(result.match(/<forum-sticker-row>/g)).toHaveLength(1);
  });

  it('keeps adjacent sticker videos in one source line', () => {
    const html = '<p>正文<br><forum-video-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/00.webm" data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/00.png" alt="emoji00" width="100" height="100"></forum-video-sticker>  <forum-video-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/00.webm" data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/00.png" alt="emoji00" width="100" height="100"></forum-video-sticker></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>正文</p>');
    expect(result).toContain('<forum-sticker-row><forum-video-sticker class="sticker"');
    expect(result).toContain('data-forum-sticker-row="true"');
    expect(result.match(/<forum-sticker-row>/g)).toHaveLength(1);
  });

  it('moves large text-mixed sticker videos out of the text paragraph', () => {
    const html = '<p>hhhhhhh <forum-video-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/00.webm" data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/00.png" alt="emoji00" width="100" height="100"></forum-video-sticker></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>hhhhhhh</p>');
    expect(result).toContain('<forum-sticker-row><forum-video-sticker class="sticker"');
    expect(result).toContain('data-forum-sticker-row="true"');
    expect(result).toContain('</forum-video-sticker></forum-sticker-row>');
    expect(result).not.toContain('<forum-sticker src="https://www.nodeseek.com/static/image/sticker/emoji/00.png"');
  });

  it('uses a readable inline size for xhj sticker images without explicit dimensions', () => {
    expect(inlineForumImageDisplaySize({
      alt: 'xhj032',
      src: 'https://cdn.example.com/xhj032.png'
    })).toEqual({ width: 48, height: 48 });
  });

  it('uses known NodeSeek sticker source dimensions when source omits dimensions', () => {
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'ac01',
      src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png'
    })).toEqual({ width: 64, height: 55 });
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'xhj001',
      src: 'https://www.nodeseek.com/static/image/sticker/xhj/001.png'
    })).toEqual({ width: 48, height: 48 });
  });

  it('keeps inline sticker source dimensions when they are already readable', () => {
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'ac01',
      src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
      width: '30',
      height: '26'
    })).toEqual({ width: 30, height: 26 });
  });

  it('caps inline NodeSeek xhj sticker source dimensions without treating them as emoji', () => {
    expect(inlineForumImageDisplaySize({
      alt: 'xhj032',
      title: 'xhj032',
      src: 'https://cdn.example.com/xhj032.png',
      width: '120',
      height: '99'
    })).toEqual({ width: 64, height: 53 });
  });

  it('keeps standalone NodeSeek sticker rows near their original sticker size when source omits dimensions', () => {
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'ac01',
      src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
      'data-forum-sticker-row': 'true'
    })).toEqual({ width: 150, height: 130 });
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'emoji35',
      src: 'https://www.nodeseek.com/static/image/sticker/emoji/35.png',
      'data-forum-sticker-row': 'true'
    })).toEqual({ width: 100, height: 100 });
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'duck01',
      src: 'https://www.nodeseek.com/static/image/sticker/duck/01.png',
      'data-forum-sticker-row': 'true'
    })).toEqual({ width: 100, height: 100 });
  });

  it('scales sticker rows down to the app content width while preserving aspect ratio', () => {
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'ac01',
      src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
      'data-forum-sticker-row': 'true'
    }, 1, 180)).toEqual({ width: 99, height: 86 });
  });

  it('keeps small standalone sticker row source dimensions instead of enlarging them', () => {
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'ac01',
      src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
      width: '30',
      height: '26',
      'data-forum-sticker-row': 'true'
    })).toEqual({ width: 30, height: 26 });
  });

  it('allows standalone sticker rows to be larger when source dimensions say so', () => {
    expect(inlineForumImageDisplaySize({
      class: 'sticker',
      alt: 'ac01',
      src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
      width: '120',
      height: '99',
      'data-forum-sticker-row': 'true'
    })).toEqual({ width: 120, height: 99 });
  });

  it('caps generic forum emoji near text size when source dimensions are large', () => {
    expect(inlineForumImageDisplaySize({
      class: 'emoji',
      alt: ':party:',
      title: ':party:',
      src: 'https://cdn.example.com/emoji/party.png',
      width: '64',
      height: '64'
    })).toEqual({ width: 24, height: 24 });
  });

  it('does not turn lightbox gallery images into inline emoji-sized images', () => {
    const html = '<p><div class="lightbox-wrapper"><a class="lightbox" href="https://cdn.example.com/original.png"><img alt="image" src="https://cdn.example.com/optimized.png" width="689" height="411"></a></div><br>text <img class="emoji" src="https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15" alt=":joy:" title=":joy:" width="20" height="20"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<img alt="image" src="https://cdn.example.com/original.png" width="689" height="411">');
    expect(result).not.toContain('src="https://cdn.example.com/optimized.png"');
    expect(result).toContain('<forum-inline-image class="emoji"');
  });

  it('renders forum avatar images in quote headers through the inline image path', () => {
    const avatar = 'https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png';
    const html = `<aside class="quote"><div class="title"><div class="quote-controls"></div><img alt="" width="24" height="24" src="${avatar}" class="avatar"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/1">Quoted topic</a></div></div><blockquote><p>quoted text</p></blockquote></aside><p><img src="https://cdn.example.com/photo.jpg"></p>`;
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-image alt="" width="24" height="24" src="https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png" class="avatar">');
    expect(result).toContain('<span class="quote-title__text-content">');
    expect(result).not.toContain('<img alt="" width="24" height="24" src="https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png" class="avatar">');
    expect(extractImageUrlsFromHtml(result)).toEqual(['https://cdn.example.com/photo.jpg']);
  });

  it('shows linux.do quote usernames from quote metadata in quote headers', () => {
    const html = '<aside class="quote" data-username="alice"><div class="title"><div class="quote-controls"></div><div class="quote-title__text-content"><a href="https://linux.do/t/topic/1">Quoted topic</a></div></div><blockquote><p>quoted text</p></blockquote></aside>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<strong class="quote-title__username">alice</strong>');
    expect(result).toContain('<span class="quote-title__separator"> · </span>');
  });

  it('falls back to linux.do quote header avatar URLs when quote metadata has no username', () => {
    const html = '<aside class="quote" data-post="913" data-topic="1957183"><div class="title"><div class="quote-controls"></div><img alt="" width="24" height="24" src="https://cdn.ldstatic.com/user_avatar/linux.do/haleclipse/48/1130851_2.png" class="avatar"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/1957183/913">Cursor++ 轻指南 v0.0.10</a></div></div><blockquote><p>quoted text</p></blockquote></aside>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<strong class="quote-title__username">haleclipse</strong>');
    expect(result).toContain('<span class="quote-title__separator"> · </span>');
  });

  it('keeps real HTML images previewable even when their URLs have no file extension', () => {
    const result = imagePreviewListFromCatalog(createImagePreviewCatalog([
        '<p><img src="https://www.nodeseek.com/api/attachments/123" alt="photo"></p>',
        '<p><img class="emoji" src="https://www.nodeseek.com/images/emoji/smile.png" alt=":smile:" width="20" height="20"></p>'
      ]), 'https://www.nodeseek.com/api/attachments/123');

    expect(result).toEqual({
      urls: ['https://www.nodeseek.com/api/attachments/123'],
      index: 0
    });
  });
});
