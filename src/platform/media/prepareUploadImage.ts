import { RequestCanceledError } from '@/platform/network/request';
import type { File as ImageFile } from 'expo-file-system';
import type { ImageManipulatorContext, ImageRef } from 'expo-image-manipulator';

export type UploadImageAsset = { uri: string; name: string; mimeType: string; size?: number };
type PreparationResources =
  | { phase: 'original' }
  | { phase: 'rendering'; context: ImageManipulatorContext }
  | { phase: 'rendered'; context: ImageManipulatorContext; image: ImageRef }
  | { phase: 'converted'; context: ImageManipulatorContext; image: ImageRef; file: ImageFile }
  | { phase: 'owned-copy'; file: ImageFile };

// Only this preparation owns the generated cache file; the picked original is never removed.
export async function prepareUploadImage(file: UploadImageAsset, maxBytes: number, signal?: AbortSignal) {
  const assertCurrent = () => {
    if (signal?.aborted) throw new RequestCanceledError();
  };
  const invalid = (message: string) => Object.assign(new Error(message), { reason: 'image_conversion_failed' });
  let resources: PreparationResources = { phase: 'original' };
  const cleanup = () => {
    if (resources.phase !== 'converted' && resources.phase !== 'owned-copy') return;
    try {
      if (resources.file.exists) resources.file.delete();
    } catch {
      /* Cache cleanup must not turn confirmed uploads into failures. */
    }
  };
  try {
    assertCurrent();
    const { File } = await import('expo-file-system');
    const original = new File(file.uri);
    const checkSize = (asset: InstanceType<typeof File>, output = false) => {
      if (!asset.exists || asset.size <= 0) throw invalid('图片文件为空或无法读取');
      if (asset.size > maxBytes) throw invalid(output ? '转换后的图片超过 20MB，请选择其他图片' : '图片不能超过 20MB');
    };
    checkSize(original);
    const handle = original.open();
    let header: string;
    try {
      header = String.fromCharCode(...handle.readBytes(12));
    } finally {
      handle.close();
    }
    assertCurrent();
    const preservedFormat = /^(GIF87a|GIF89a)/.test(header)
      ? 'gif'
      : header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP'
        ? 'webp'
        : null;
    const name = (extension: string) => `${file.name.replace(/\.[^.]*$/, '') || 'image'}.${extension}`;
    if (preservedFormat) {
      return {
        file: { ...file, name: name(preservedFormat), mimeType: `image/${preservedFormat}`, size: original.size },
        cleanup
      };
    }
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    assertCurrent();
    const context = ImageManipulator.manipulate(file.uri);
    resources = { phase: 'rendering', context };
    try {
      const rendered = await context.renderAsync();
      resources = { phase: 'rendered', context, image: rendered };
      assertCurrent();
      const result = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: 1 });
      resources = { phase: 'converted', context, image: rendered, file: new File(result.uri) };
    } finally {
      if (resources.phase === 'rendered' || resources.phase === 'converted') resources.image?.release();
      context.release();
      if (resources.phase === 'converted') resources = { phase: 'owned-copy', file: resources.file };
    }
    assertCurrent();
    const output = resources.file;
    checkSize(output, true);
    return { file: { uri: output.uri, name: name('webp'), mimeType: 'image/webp', size: output.size }, cleanup };
  } catch (error) {
    cleanup();
    if (error instanceof RequestCanceledError || (error as { reason?: string })?.reason === 'image_conversion_failed')
      throw error;
    throw invalid('图片转换失败，请选择其他图片');
  }
}
