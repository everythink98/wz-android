import { describe, expect, it } from 'vitest';
import { decodeLooseBase64, decodeResponseUtf8 } from './responseBytes';

describe('remote response bytes', () => {
  it('decodes the boundaries of each UTF-8 width and preserves the BOM and literal replacement character', () => {
    const bytes = Uint8Array.of(
      0xef,
      0xbb,
      0xbf,
      0x00,
      0x7f,
      0xc2,
      0x80,
      0xdf,
      0xbf,
      0xe0,
      0xa0,
      0x80,
      0xed,
      0x9f,
      0xbf,
      0xee,
      0x80,
      0x80,
      0xef,
      0xbf,
      0xbd,
      0xef,
      0xbf,
      0xbf,
      0xf0,
      0x90,
      0x80,
      0x80,
      0xf4,
      0x8f,
      0xbf,
      0xbf
    );
    expect(decodeResponseUtf8(bytes)).toBe(
      '\uFEFF\u0000\u007F\u0080\u07FF\u0800\uD7FF\uE000\uFFFD\uFFFF\u{10000}\u{10FFFF}'
    );
  });

  it.each(
    [
      [0xc0, 0xaf],
      [0xe0, 0x9f, 0xbf],
      [0xf0, 0x8f, 0xbf, 0xbf],
      [0xed, 0xa0, 0x80],
      [0xed, 0xbf, 0xbf],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0x80, 0xbf, 0xff],
      [0xe2, 0x82],
      [0xf0, 0x9f, 0x92]
    ].map((bytes) => [bytes] as const)
  )('replaces each malformed byte from %j, including before a valid character', (bytes) => {
    const replacements = '\uFFFD'.repeat(bytes.length);
    expect(decodeResponseUtf8(Uint8Array.from(bytes))).toBe(replacements);
    expect(decodeResponseUtf8(Uint8Array.of(...bytes, 0x41))).toBe(replacements + 'A');
  });

  it('joins complete code points across output chunks', () => {
    const text = 'a'.repeat(2047) + '😀' + '\uFEFF' + 'b'.repeat(2046) + '𐀀c';
    expect(decodeResponseUtf8(new TextEncoder().encode(text))).toBe(text);
  });

  it('decodes partial quartets, both base64 alphabets and input terminated by padding', () => {
    expect([...decodeLooseBase64('A')]).toEqual([]);
    expect([...decodeLooseBase64('AAAAA')]).toEqual([0, 0, 0]);
    expect([...decodeLooseBase64('/+8=ignored')]).toEqual([0xff, 0xef]);
    expect([...decodeLooseBase64('_ \n! -8')]).toEqual([0xff, 0xef]);
  });
});
