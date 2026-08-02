import { describe, expect, it } from 'vitest';

import { sanitizeContentHtml } from '@/domain/forum/contentSanitizer';
import {
  flowInlineImagesInMixedParagraphs,
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize
} from './inlineMedia';

describe('inline media layout', () => {
  it('[REG-TOPIC-030] does not reactivate an unsafe lazy image URL after sanitization', () => {
    const sanitized = sanitizeContentHtml(
      '<img src="/safe.png" data-original="javascript:x.png">',
      'https://linux.do/t/example/1'
    );

    expect(flowInlineImagesInMixedParagraphs(sanitized)).toContain('src="https://linux.do/safe.png"');
  });

  it('uses the source dimensions for small forum emoji display', () => {
    expect(
      inlineForumImageDisplaySize({
        class: 'emoji',
        src: 'https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15',
        alt: ':joy:',
        title: ':joy:',
        width: '20',
        height: '20'
      })
    ).toEqual({ width: 20, height: 20 });
  });

  it('nudges small forum emoji down to the middle of the text line', () => {
    expect(
      inlineForumImageAlignmentStyle(
        {
          class: 'emoji',
          src: 'https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15',
          alt: ':joy:',
          title: ':joy:',
          width: '20',
          height: '20'
        },
        1,
        26
      )
    ).toEqual({ transform: [{ translateY: 3 }] });
  });

  it('[REG-TOPIC-054] leaves breathing room after an inline quote avatar', () => {
    expect(
      inlineForumImageAlignmentStyle(
        {
          class: 'avatar',
          src: 'https://cdn.ldstatic.com/user_avatar/linux.do/alice/48/1.png',
          width: '24',
          height: '24'
        },
        1,
        26
      )
    ).toEqual({
      marginRight: 6,
      transform: [{ translateY: 1 }]
    });
  });

  it('keeps real images block-like even when mixed with paragraph text', () => {
    const mixed = '<p>hello 😟<img alt="image" src="https://cdn.example.com/sticker.png"></p>';
    const standalone = '<p><img alt="image" src="https://cdn.example.com/photo.jpg"></p>';

    expect(flowInlineImagesInMixedParagraphs(mixed)).toContain(
      '<img alt="image" src="https://cdn.example.com/sticker.png">'
    );
    expect(flowInlineImagesInMixedParagraphs(mixed)).not.toContain(
      '<forum-inline-image alt="image" src="https://cdn.example.com/sticker.png">'
    );
    expect(flowInlineImagesInMixedParagraphs(standalone)).toContain(
      '<img alt="image" src="https://cdn.example.com/photo.jpg">'
    );
  });

  it('renders forum emoji in mixed paragraphs through the inline image path', () => {
    const html =
      '<p>hello <img class="emoji" src="https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15" alt=":joy:" title=":joy:" width="20" height="20"></p>';

    expect(flowInlineImagesInMixedParagraphs(html)).toContain('<forum-inline-image class="emoji"');
    expect(flowInlineImagesInMixedParagraphs(html)).not.toContain('<img class="emoji"');
  });

  it('renders standalone V2EX emoji through the inline image path', () => {
    const html =
      '<p><img src="https://www.v2ex.com/static/img/emoji/smile.png" alt=":smile:" width="20" height="20"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-image');
    expect(result).not.toContain('<forum-sticker-row>');
    expect(result).not.toContain('<img');
  });

  it('renders standalone linux.do emoji through the inline image path', () => {
    const html =
      '<p><img class="emoji" src="https://linux.do/images/emoji/twemoji/grinning_face.png" alt=":grinning_face:" width="20" height="20"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-image class="emoji"');
    expect(result).not.toContain('<forum-sticker-row>');
    expect(result).not.toContain('<img class="emoji"');
  });

  it('[REG-XIAOYINSI-017] keeps 小隐寺 topic and reply emoji on the inline image path', () => {
    const html =
      '<p>哈喽，各位<img src="https://forum.xiaoyinsi.com/images/emoji/twitter/waving_hand.png?v=15" title=":waving_hand:" class="emoji" alt=":waving_hand:" width="20" height="20"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain(
      '<forum-inline-image src="https://forum.xiaoyinsi.com/images/emoji/twitter/waving_hand.png?v=15"'
    );
    expect(result).toContain('class="emoji"');
    expect(result).not.toContain('<img');
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

  it('keeps small text-mixed NodeSeek stickers inline', () => {
    const html =
      '<p>文字 <img class="sticker" width="30" height="26" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" loading="lazy" alt="ac01"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).not.toContain('<forum-sticker-row>');
    expect(result).toContain('<forum-inline-media-line>文字 <forum-sticker class="sticker"');
  });

  it('keeps text-mixed no-dimension NodeSeek ac stickers inline', () => {
    const html =
      '<p>然而我并不知道发生了什么 也不在意 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" loading="lazy" alt="ac01"> 但是啥瓜有人说下吗</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain(
      '<forum-inline-media-line>然而我并不知道发生了什么 也不在意 <forum-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" loading="lazy" alt="ac01">ac01</forum-sticker> 但是啥瓜有人说下吗</forum-inline-media-line>'
    );
    expect(result).not.toContain('<forum-inline-image class="sticker"');
    expect(result).not.toContain('<forum-sticker-row>');
    expect(result).not.toContain('<img class="sticker"');
  });

  it('REG-TOPIC-011 keeps quoted greater-than signs inside sticker attributes', () => {
    const html =
      '<p>正文 <img class="sticker" title="1 > 0" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01"> 结尾</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain(
      '<forum-inline-media-line>正文 <forum-sticker class="sticker" title="1 &gt; 0" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01">ac01</forum-sticker> 结尾</forum-inline-media-line>'
    );
    expect(result).not.toContain('0" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01"> 结尾');
  });

  it('keeps small no-dimension NodeSeek xhj stickers inline with surrounding text', () => {
    const html =
      '<p>应该可以类比成公交车和出租车 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/xhj/001.png" alt="xhj001"><br>公交车便宜，但是路程不是直达，会绕路</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-media-line>应该可以类比成公交车和出租车 <forum-sticker class="sticker"');
    expect(result).toContain('src="https://www.nodeseek.com/static/image/sticker/xhj/001.png"');
    expect(result).toContain('</forum-inline-media-line><p>公交车便宜，但是路程不是直达，会绕路</p>');
    expect(result).not.toContain('<forum-sticker-row>');
  });

  it('preserves text order around a text-mixed no-dimension NodeSeek emoji sticker', () => {
    const html =
      '<p>公交车便宜 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/35.png" alt="emoji35"> 出租车直达</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain(
      '<forum-inline-media-line>公交车便宜 <forum-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/35.png" alt="emoji35">emoji35</forum-sticker> 出租车直达</forum-inline-media-line>'
    );
    expect(result).not.toContain('<forum-inline-image class="sticker"');
    expect(result).not.toContain('<forum-sticker-row>');
  });

  it('keeps unknown no-dimension NodeSeek sticker packs inline instead of guessing a large layout', () => {
    const html =
      '<p>公交车便宜 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/unknown/01.png" alt="unknown01"> 出租车直达</p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<forum-inline-media-line>公交车便宜 <forum-sticker class="sticker"');
    expect(result).toContain('src="https://www.nodeseek.com/static/image/sticker/unknown/01.png"');
    expect(result).toContain('出租车直达</forum-inline-media-line>');
    expect(result).not.toContain('<forum-sticker-row>');
  });

  it('preserves text before a line break when a later text line contains a no-dimension NodeSeek sticker', () => {
    const html =
      '<p>rt,刚坠机，我只是带上自己的ip段<br>ipv6顶一会儿 <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/35.png" alt="emoji35"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('rt,刚坠机，我只是带上自己的ip段');
    expect(result).toContain(
      '<forum-inline-media-line>ipv6顶一会儿 <forum-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/35.png" alt="emoji35">emoji35</forum-sticker></forum-inline-media-line>'
    );
    expect(result).not.toContain('<forum-inline-image class="sticker"');
    expect(result).not.toContain('<forum-sticker-row>');
  });

  it('renders media-only NodeSeek sticker source lines as one sticker row', () => {
    const html =
      '<p>正文<br><img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01"> <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/02.png" alt="ac02"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>正文</p>');
    expect(result).toContain('<forum-sticker-row><forum-sticker class="sticker"');
    expect(result.match(/<forum-sticker/g)).toHaveLength(3);
    expect(result.match(/<forum-sticker-row>/g)).toHaveLength(1);
  });

  it('keeps multi-sticker NodeSeek rows as one natural wrapping row', () => {
    const html =
      '<p>借楼同收！ 我+99<br><img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/01.png" alt="ac01"> <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/02.png" alt="ac02"> <img class="sticker" src="https://www.nodeseek.com/static/image/sticker/ac/03.png" alt="ac03"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>借楼同收！ 我+99</p>');
    expect(result.match(/<forum-sticker class="sticker"/g)).toHaveLength(3);
    expect(result.match(/<forum-sticker-row>/g)).toHaveLength(1);
  });

  it('keeps adjacent sticker videos in one source line', () => {
    const html =
      '<p>正文<br><forum-video-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/00.webm" data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/00.png" alt="emoji00" width="100" height="100"></forum-video-sticker>  <forum-video-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/00.webm" data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/00.png" alt="emoji00" width="100" height="100"></forum-video-sticker></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>正文</p>');
    expect(result).toContain('<forum-sticker-row><forum-video-sticker class="sticker"');
    expect(result).toContain('data-forum-sticker-row="true"');
    expect(result.match(/<forum-sticker-row>/g)).toHaveLength(1);
  });

  it('moves large text-mixed sticker videos out of the text paragraph', () => {
    const html =
      '<p>hhhhhhh <forum-video-sticker class="sticker" src="https://www.nodeseek.com/static/image/sticker/emoji/00.webm" data-fallback-src="https://www.nodeseek.com/static/image/sticker/emoji/00.png" alt="emoji00" width="100" height="100"></forum-video-sticker></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<p>hhhhhhh</p>');
    expect(result).toContain('<forum-sticker-row><forum-video-sticker class="sticker"');
    expect(result).toContain('data-forum-sticker-row="true"');
    expect(result).toContain('</forum-video-sticker></forum-sticker-row>');
    expect(result).not.toContain('<forum-sticker src="https://www.nodeseek.com/static/image/sticker/emoji/00.png"');
  });

  it('uses a readable inline size for xhj sticker images without explicit dimensions', () => {
    expect(
      inlineForumImageDisplaySize({
        alt: 'xhj032',
        src: 'https://cdn.example.com/xhj032.png'
      })
    ).toEqual({ width: 48, height: 48 });
  });

  it('uses known NodeSeek sticker source dimensions when source omits dimensions', () => {
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'ac01',
        src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png'
      })
    ).toEqual({ width: 64, height: 55 });
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'xhj001',
        src: 'https://www.nodeseek.com/static/image/sticker/xhj/001.png'
      })
    ).toEqual({ width: 48, height: 48 });
  });

  it('keeps inline sticker source dimensions when they are already readable', () => {
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'ac01',
        src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
        width: '30',
        height: '26'
      })
    ).toEqual({ width: 30, height: 26 });
  });

  it('caps inline NodeSeek xhj sticker source dimensions without treating them as emoji', () => {
    expect(
      inlineForumImageDisplaySize({
        alt: 'xhj032',
        title: 'xhj032',
        src: 'https://cdn.example.com/xhj032.png',
        width: '120',
        height: '99'
      })
    ).toEqual({ width: 64, height: 53 });
  });

  it('uses NodeSeek sticker source dimensions as the fallback row size', () => {
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'ac01',
        src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
        'data-forum-sticker-row': 'true'
      })
    ).toEqual({ width: 150, height: 130 });
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'emoji35',
        src: 'https://www.nodeseek.com/static/image/sticker/emoji/35.png',
        'data-forum-sticker-row': 'true'
      })
    ).toEqual({ width: 100, height: 100 });
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'duck01',
        src: 'https://www.nodeseek.com/static/image/sticker/duck/01.png',
        'data-forum-sticker-row': 'true'
      })
    ).toEqual({ width: 100, height: 100 });
  });

  it('scales sticker rows down to the app content width while preserving aspect ratio', () => {
    expect(
      inlineForumImageDisplaySize(
        {
          class: 'sticker',
          alt: 'ac01',
          src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
          'data-forum-sticker-row': 'true'
        },
        1,
        180
      )
    ).toEqual({ width: 99, height: 86 });
  });

  it('does not scale sticker rows with the reader font size', () => {
    expect(
      inlineForumImageDisplaySize(
        {
          class: 'sticker',
          alt: 'ac01',
          src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
          'data-forum-sticker-row': 'true'
        },
        1.6,
        320
      )
    ).toEqual({ width: 100, height: 87 });
  });

  it('keeps small standalone sticker row source dimensions instead of enlarging them', () => {
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'ac01',
        src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
        width: '30',
        height: '26',
        'data-forum-sticker-row': 'true'
      })
    ).toEqual({ width: 30, height: 26 });
  });

  it('uses explicit sticker row dimensions when content width is unknown', () => {
    expect(
      inlineForumImageDisplaySize({
        class: 'sticker',
        alt: 'ac01',
        src: 'https://www.nodeseek.com/static/image/sticker/ac/01.png',
        width: '120',
        height: '99',
        'data-forum-sticker-row': 'true'
      })
    ).toEqual({ width: 120, height: 99 });
  });

  it('caps generic forum emoji near text size when source dimensions are large', () => {
    expect(
      inlineForumImageDisplaySize({
        class: 'emoji',
        alt: ':party:',
        title: ':party:',
        src: 'https://cdn.example.com/emoji/party.png',
        width: '64',
        height: '64'
      })
    ).toEqual({ width: 24, height: 24 });
  });

  it('does not turn lightbox gallery images into inline emoji-sized images', () => {
    const html =
      '<p><div class="lightbox-wrapper"><a class="lightbox" href="https://cdn.example.com/original.png"><img alt="image" src="https://cdn.example.com/optimized.png" width="689" height="411"></a></div><br>text <img class="emoji" src="https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15" alt=":joy:" title=":joy:" width="20" height="20"></p>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain(
      '<img alt="image" src="https://cdn.example.com/optimized.png" width="689" height="411" data-forum-original-src="https://cdn.example.com/original.png">'
    );
    expect(result).not.toContain('<img alt="image" src="https://cdn.example.com/original.png"');
    expect(result).toContain('<forum-inline-image class="emoji"');
  });

  it('shows linux.do quote usernames from quote metadata in quote headers', () => {
    const html =
      '<aside class="quote" data-username="alice"><div class="title"><div class="quote-controls"></div><div class="quote-title__text-content"><a href="https://linux.do/t/topic/1">Quoted topic</a></div></div><blockquote><p>quoted text</p></blockquote></aside>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<strong class="quote-title__username">alice</strong>');
    expect(result).toContain('<span class="quote-title__separator"> · </span>');
  });

  it('falls back to linux.do quote header avatar URLs when quote metadata has no username', () => {
    const html =
      '<aside class="quote" data-post="913" data-topic="1957183"><div class="title"><div class="quote-controls"></div><img alt="" width="24" height="24" src="https://cdn.ldstatic.com/user_avatar/linux.do/haleclipse/48/1130851_2.png" class="avatar"><div class="quote-title__text-content"><a href="https://linux.do/t/topic/1957183/913">Cursor++ 轻指南 v0.0.10</a></div></div><blockquote><p>quoted text</p></blockquote></aside>';
    const result = flowInlineImagesInMixedParagraphs(html);

    expect(result).toContain('<strong class="quote-title__username">haleclipse</strong>');
    expect(result).toContain('<span class="quote-title__separator"> · </span>');
  });
});
