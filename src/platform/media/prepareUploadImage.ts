import { RequestCanceledError } from '@/platform/network/request';

export type UploadImageAsset = { uri: string; name: string; mimeType: string; size?: number };

// Only this preparation owns the generated cache file; the picked original is never removed.
export async function prepareUploadImage(file: UploadImageAsset, maxBytes: number, signal?: AbortSignal) {
  const assertCurrent = () => {
    if (signal?.aborted) throw new RequestCanceledError();
  };
  const invalid = (message: string) => Object.assign(new Error(message), { reason: 'image_conversion_failed' });
  let cleanup = () => {};
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
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    let output: InstanceType<typeof File>;
    try {
      rendered = await context.renderAsync();
      assertCurrent();
      const result = await rendered.saveAsync({ format: SaveFormat.WEBP, compress: 1 });
      output = new File(result.uri);
      cleanup = () => {
        try {
          if (output.exists) output.delete();
        } catch {
          /* Cache cleanup must not turn confirmed uploads into failures. */
        }
      };
    } finally {
      rendered?.release();
      context.release();
    }
    assertCurrent();
    checkSize(output, true);
    return { file: { uri: output.uri, name: name('webp'), mimeType: 'image/webp', size: output.size }, cleanup };
  } catch (error) {
    cleanup();
    if (error instanceof RequestCanceledError || (error as { reason?: string })?.reason === 'image_conversion_failed')
      throw error;
    throw invalid('图片转换失败，请选择其他图片');
  }
}
