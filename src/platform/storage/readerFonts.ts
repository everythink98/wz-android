import type { LocalReaderFont, LocalReaderFontFamily } from '@/domain/reader/readerFonts';

export type DownloadableReaderFont = LocalReaderFont & { url: string; byteCount: number; edition?: string };

export type ReaderFontDownloadProgress =
  { phase: 'connecting' } | { phase: 'downloading'; percent: number } | { phase: 'installing' };

// The local family encodes the checksum of the exact upstream file.
export const downloadableReaderFonts: readonly DownloadableReaderFont[] = [
  {
    family: 'WzLocalFont_e8f396decc1f0963a016a989c3d8852e863d1350996f573860a80767c83a1cd3',
    name: '思源宋体',
    edition: 'Noto Serif SC',
    byteCount: 11625800,
    url: 'https://raw.githubusercontent.com/notofonts/noto-cjk/9b0f1436e455d902de067a2501422e5dc71ad16b/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf'
  },
  {
    family: 'WzLocalFont_abd13364163e3cd84372b333f2fdcee9efb848634668f1c0ce5788dcd059ee61',
    name: '霞鹜文楷屏幕阅读版',
    byteCount: 26095590,
    url: 'https://github.com/lxgw/LxgwWenKai-Screen/releases/download/v1.530/LXGWWenKaiScreen.ttf'
  },
  {
    family: 'WzLocalFont_fc42109cec4e0af7efd4d4d7f6de138d00e87b8b48987432808e43af33580530',
    name: 'IBM Plex Sans SC',
    byteCount: 6975144,
    url: 'https://raw.githubusercontent.com/IBM/plex/2e90fe366fdc27c12682db13e5aa20ded3d90908/packages/plex-sans-sc/fonts/complete/otf/hinted/IBMPlexSansSC-Regular.otf'
  },
  {
    family: 'WzLocalFont_29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031',
    name: 'Inter',
    byteCount: 876576,
    url: 'https://raw.githubusercontent.com/google/fonts/06bfe0d62a98375cb09c942fa18e68bd32cff057/ofl/inter/Inter%5Bopsz,wght%5D.ttf'
  }
];

type FontInstallResult = { font: LocalReaderFont } | { error: string };

type NativeReaderFonts = {
  list(): Promise<LocalReaderFont[]>;
  prepare(family: LocalReaderFontFamily): Promise<boolean>;
  add(uri: string, name: string): Promise<FontInstallResult>;
  download(url: string, family: LocalReaderFontFamily, name: string, byteCount: number): Promise<FontInstallResult>;
  addListener(
    event: 'downloadProgress',
    listener: (event: { family: LocalReaderFontFamily; progress: ReaderFontDownloadProgress }) => void
  ): { remove(): void };
};

async function nativeReaderFonts() {
  const { requireOptionalNativeModule } = await import('expo');
  return requireOptionalNativeModule<NativeReaderFonts>('ReaderFonts');
}

export async function listLocalReaderFonts() {
  const native = await nativeReaderFonts();
  return (await native?.list()) ?? [];
}

export async function prepareLocalReaderFont(family: LocalReaderFontFamily) {
  try {
    const native = await nativeReaderFonts();
    return (await native?.prepare(family)) ?? false;
  } catch {
    return false;
  }
}

export async function pickLocalReaderFont() {
  const native = await nativeReaderFonts();
  if (!native) throw new Error('当前安装包无法导入字体，请更新后重试。');
  // Some Android providers report font files as generic binary documents.
  const { getDocumentAsync } = await import('expo-document-picker');
  const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
  const asset = result.assets?.[0];
  if (result.canceled || !asset) return null;
  const imported = await native.add(asset.uri, asset.name);
  if ('error' in imported) throw new Error(imported.error);
  return imported.font;
}

export async function downloadReaderFont(
  font: DownloadableReaderFont,
  onProgress: (progress: ReaderFontDownloadProgress) => void
) {
  const native = await nativeReaderFonts();
  if (!native?.download) throw new Error('当前安装包无法下载字体，请更新后重试。');
  const subscription = native.addListener('downloadProgress', ({ family, progress }) => {
    if (family === font.family) onProgress(progress);
  });
  try {
    const downloaded = await native.download(font.url, font.family, font.name, font.byteCount);
    if ('error' in downloaded) throw new Error(downloaded.error);
    return downloaded.font;
  } finally {
    subscription.remove();
  }
}
