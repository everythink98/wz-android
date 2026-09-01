import { describe, expect, it } from 'vitest';
import { FORUM_BOUNDED_INLINE_IMAGE_ATTRIBUTE } from '@/domain/forum/forumContentMedia';

import {
  inlineForumImageAlignmentStyle,
  inlineForumImageAttachmentSize,
  inlineForumImageDisplaySize
} from './inlineMedia';
describe('inline media layout', () => {
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

  it('centers a Fabric image attachment in the text line', () => {
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

    expect(
      inlineForumImageAlignmentStyle(
        {
          class: 'sticker',
          src: 'https://cdn.example.com/sticker.png',
          width: '48',
          height: '48'
        },
        1,
        26
      )
    ).toEqual({});
  });

  it('gives inline text real horizontal attachment space without changing alignment', () => {
    const attributes = {
      alt: ':joy:',
      class: 'emoji',
      height: '20',
      src: 'https://cdn.ldstatic.com/images/emoji/twemoji/joy.png?v=15',
      title: ':joy:',
      width: '20'
    };

    expect(inlineForumImageAttachmentSize(attributes)).toEqual({ height: 20, width: 24 });
    expect(inlineForumImageAlignmentStyle(attributes, 1, 26)).toEqual({ transform: [{ translateY: 3 }] });
  });

  it('keeps ordinary flow images at natural size independent of reader font scale', () => {
    const attributes = { src: 'https://pic.example.com/reply.gif' };

    expect(inlineForumImageDisplaySize(attributes, 1.6, 320, { width: 30, height: 30 })).toEqual({
      width: 30,
      height: 30
    });
    expect(inlineForumImageAttachmentSize(attributes, 1.6, 320, { width: 30, height: 30 })).toEqual({
      width: 34,
      height: 30
    });
    expect(inlineForumImageDisplaySize(attributes, 1.6, 320, { width: 800, height: 400 })).toEqual({
      width: 316,
      height: 158
    });
  });

  it('caps trusted bounded assets without font scaling or dimension guesses', () => {
    const attributes = {
      [FORUM_BOUNDED_INLINE_IMAGE_ATTRIBUTE]: 'true',
      src: 'https://forum.example/face/wave.gif'
    };

    expect(inlineForumImageDisplaySize(attributes, 1.6, 320, { width: 100, height: 100 })).toEqual({
      width: 100,
      height: 100
    });
    expect(inlineForumImageDisplaySize(attributes, 1.6, 320, { width: 60, height: 30 })).toEqual({
      width: 60,
      height: 30
    });
    expect(inlineForumImageDisplaySize(attributes, 1.6, 320, { width: 800, height: 400 })).toEqual({
      width: 100,
      height: 50
    });
    expect(inlineForumImageDisplaySize(attributes, 1.6, 320, { width: 200, height: 800 })).toEqual({
      width: 25,
      height: 100
    });
    expect(
      inlineForumImageDisplaySize({ ...attributes, height: '40', width: '80' }, 1.6, 320, {
        width: 800,
        height: 400
      })
    ).toEqual({ width: 80, height: 40 });
  });

  it('leaves breathing room after an inline quote avatar', () => {
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
    ).toEqual({ marginRight: 6, transform: [{ translateY: 1 }] });
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
  });

  it('uses a neutral placeholder instead of guessing one size for every xhj sticker', () => {
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

  it('keeps decoded sticker dimensions within 100dp after reader font scaling', () => {
    expect(
      inlineForumImageDisplaySize(
        {
          class: 'sticker',
          alt: 'xhj015',
          src: 'https://www.nodeseek.com/static/image/sticker/xhj/015.gif'
        },
        1.3,
        320,
        { width: 82, height: 82 }
      )
    ).toEqual({ width: 100, height: 100 });
  });

  it('fills one missing sticker axis from the decoded aspect ratio', () => {
    const attributes = {
      class: 'sticker',
      alt: 'xhj003',
      src: 'https://www.nodeseek.com/static/image/sticker/xhj/003.png'
    };

    expect(inlineForumImageDisplaySize({ ...attributes, width: '57' }, 1, 320, { width: 57, height: 48 })).toEqual({
      width: 57,
      height: 48
    });
    expect(inlineForumImageDisplaySize({ ...attributes, height: '48' }, 1, 320, { width: 57, height: 48 })).toEqual({
      width: 57,
      height: 48
    });
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
});
