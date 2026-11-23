export type LocalReaderFontFamily = `WzLocalFont_${string}`;
export type ReaderFontFamily = 'app' | 'system' | LocalReaderFontFamily;

export const BUILT_IN_READER_FONT_NAME = '思源黑体';
export const BUILT_IN_READER_FONT_EDITION = 'Noto Sans SC';

export type LocalReaderFont = {
  family: LocalReaderFontFamily;
  name: string;
};

export function isLocalReaderFontFamily(value: unknown): value is LocalReaderFontFamily {
  return typeof value === 'string' && /^WzLocalFont_[a-f0-9]{64}$/.test(value);
}

export function isReaderFontFamily(value: unknown): value is ReaderFontFamily {
  return value === 'app' || value === 'system' || isLocalReaderFontFamily(value);
}
