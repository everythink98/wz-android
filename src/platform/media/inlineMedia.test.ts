import { describe, expect, it } from 'vitest';

import { inlineForumImageAlignmentStyle, inlineForumImageDisplaySize } from './inlineMedia';
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

  it('[REG-TOPIC-066] keeps decoded sticker dimensions within 100dp after reader font scaling', () => {
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

  it('[REG-TOPIC-066] fills one missing sticker axis from the decoded aspect ratio', () => {
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
