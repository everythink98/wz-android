import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { parseDataImageUrl } from '@/domain/forum/html';
import { safeFileName } from '@/platform/storage/backupFiles';
import { imageRequestHeadersForUrl, isHttpOrHttpsUrl } from './imageRequestSource';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

interface ImageSaveRequestOptions {
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
  signal?: AbortSignal;
  assertCurrent?: () => void;
}

interface NativeImageDownload {
  validateInlineImage(uri: string, extension: string): Promise<void>;
  createDownload(): string;
  download(
    id: string,
    url: string,
    headers: Record<string, string>
  ): Promise<{ uri: string; contentType: string; byteCount: number }>;
  cancelDownload(id: string): void;
  releaseDownload(id: string): void;
}

type ImageSaveLease =
  | { kind: 'unowned' }
  | { kind: 'local-file'; uri: string }
  | { kind: 'downloading'; native: NativeImageDownload; id: string }
  | { kind: 'downloaded'; native: NativeImageDownload; id: string; uri: string };

function assertCurrent(options: ImageSaveRequestOptions) {
  if (options.signal?.aborted) throw new Error('图片保存已取消');
  options.assertCurrent?.();
}

async function assertReadableImageFile(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || info.size <= 0) {
    throw new Error('图片文件无效');
  }
}

export async function saveLocalImageFileToLibrary(uri: string, assertCurrent: () => void): Promise<void> {
  if (!/^file:\/\/\/.+/u.test(uri)) throw new Error('图片地址必须是本机文件。');
  assertCurrent();
  await assertReadableImageFile(uri);
  assertCurrent();
  // The installed Expo module uses MediaStore directly from API 30; its legacy factory needs write access.
  if (Platform.OS !== 'android' || Number(Platform.Version) < 30) {
    const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
    assertCurrent();
    if (!permission.granted) throw new Error('没有图片保存权限');
  }
  // The caller owns the input file and releases it after the native copy finishes.
  await MediaLibrary.Asset.create(uri);
}

export async function saveImageUriToLibrary(
  uri: string,
  requestOptions: ImageSaveRequestOptions,
  parentTrace?: DiagnosticTrace
) {
  const dataImage = parseDataImageUrl(uri);
  const trace =
    parentTrace ||
    beginDiagnosticTrace('media', 'save-image', {
      channel: dataImage ? 'data' : isHttpOrHttpsUrl(uri) ? 'remote' : 'unsupported'
    });
  const ownsTrace = !parentTrace;
  try {
    if (!dataImage && !isHttpOrHttpsUrl(uri)) {
      throw new Error('图片地址不支持保存');
    }
    assertCurrent(requestOptions);
    let lease: ImageSaveLease = { kind: 'unowned' };
    const abort = () => {
      if (lease.kind === 'downloading' || lease.kind === 'downloaded') lease.native.cancelDownload(lease.id);
    };
    try {
      markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
      if (dataImage) {
        const baseDirectory = FileSystem.cacheDirectory;
        if (!baseDirectory) throw new Error('无法创建图片文件');
        lease = { kind: 'local-file', uri: `${baseDirectory}${safeFileName('forum-image', dataImage.extension)}` };
        await FileSystem.writeAsStringAsync(lease.uri, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
        assertCurrent(requestOptions);
        if (Platform.OS === 'android') {
          const native = requireOptionalNativeModule<NativeImageDownload>('ImageDownload');
          if (!native?.validateInlineImage) throw new Error('当前安装包不支持保存图片，请更新后重试。');
          await native.validateInlineImage(lease.uri, dataImage.extension);
        }
      } else {
        const native = requireOptionalNativeModule<NativeImageDownload>('ImageDownload');
        if (!native) throw new Error('当前安装包不支持保存图片，请更新后重试。');
        const id = native.createDownload();
        lease = { kind: 'downloading', native, id };
        requestOptions.signal?.addEventListener('abort', abort);
        assertCurrent(requestOptions);
        const downloaded = await native.download(id, uri, imageRequestHeadersForUrl(uri, requestOptions) || {});
        lease = { kind: 'downloaded', native, id, uri: downloaded.uri };
        markDiagnosticStage(trace, 'parse', {
          contentType: downloaded.contentType || 'unknown',
          byteCount: downloaded.byteCount
        });
      }
      markDiagnosticStage(trace, 'persist', { state: 'media-library-start' });
      await saveLocalImageFileToLibrary(lease.uri, () => assertCurrent(requestOptions));
      markDiagnosticStage(trace, 'persist', { state: 'media-library' });
    } finally {
      requestOptions.signal?.removeEventListener('abort', abort);
      switch (lease.kind) {
        case 'unowned':
          break;
        case 'local-file':
          await FileSystem.deleteAsync(lease.uri, { idempotent: true }).catch(() => undefined);
          break;
        case 'downloading':
        case 'downloaded':
          lease.native.releaseDownload(lease.id);
          break;
        default: {
          const unreachable: never = lease;
          throw new Error(`Unknown image save lease: ${unreachable}`);
        }
      }
    }
    if (ownsTrace) {
      finishDiagnosticTrace(trace, 'success');
    }
  } catch (error) {
    if (ownsTrace) {
      const reason = normalizeDiagnosticReason(error);
      finishDiagnosticTrace(trace, reason === 'permission_denied' ? 'blocked' : 'failure', { reason });
    }
    throw error;
  }
}
