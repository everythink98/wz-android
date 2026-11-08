import { toByteArray } from 'base64-js';

export function decodeLooseBase64(value: string): Uint8Array {
  const unpadded = value.split('=', 1)[0].replace(/[^A-Za-z0-9+/_-]/g, '');
  if (unpadded.length < 2) return new Uint8Array();
  return toByteArray(unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '='));
}

const MINIMUM_CODE_POINT_BY_WIDTH = [0, 0, 0x80, 0x800, 0x10000];

function utf8SequenceWidth(lead: number): number {
  if (lead < 0xc2 || lead > 0xf4) return 0;
  if (lead < 0xe0) return 2;
  if (lead < 0xf0) return 3;
  return 4;
}

// Preserve a leading BOM and one replacement per malformed byte in remote data.
export function decodeResponseUtf8(bytes: Uint8Array): string {
  let output = '';
  const chunk: number[] = [];
  for (let index = 0; index < bytes.length; index++) {
    const first = bytes[index];
    let codePoint = first;
    if (first >= 0x80) {
      const width = utf8SequenceWidth(first);
      codePoint = first & (0x7f >> width);
      let size = 1;
      while (size < width && index + size < bytes.length && (bytes[index + size] & 0xc0) === 0x80) {
        codePoint = codePoint * 64 + (bytes[index + size] & 0x3f);
        size++;
      }
      const scalar = codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
      if (size === width && codePoint >= MINIMUM_CODE_POINT_BY_WIDTH[width] && scalar) index += size - 1;
      else codePoint = 0xfffd;
    }
    chunk.push(codePoint);
    // Keep large responses below Hermes's variadic argument limit.
    if (chunk.length === 2048) {
      output += String.fromCodePoint(...chunk);
      chunk.length = 0;
    }
  }
  return output + String.fromCodePoint(...chunk);
}
