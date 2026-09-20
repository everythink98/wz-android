import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { requireOptionalNativeModule } from 'expo';
import { safeFileName } from '@/platform/storage/backupFiles';
import { dataImageFileFromUrl, imageRequestHeadersForUrl, isHttpOrHttpsUrl } from './imageRequestSource';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';

export interface ImageSaveRequestOptions {
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
  signal?: AbortSignal;
  assertCurrent?: () => void;
}

interface NativeImageDownload {
  createDownload(): string;
  download(
    id: string,
    url: string,
    headers: Record<string, string>
  ): Promise<{ uri: string; contentType: string; byteCount: number }>;
  cancelDownload(id: string): void;
  releaseDownload(id: string): void;
}

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

export async function saveImageUriToLibrary(
  uri: string,
  requestOptions: ImageSaveRequestOptions,
  parentTrace?: DiagnosticTrace
) {
  const dataImage = dataImageFileFromUrl(uri);
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
    const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    markDiagnosticStage(trace, 'credential', { isGranted: permission.granted });
    if (!permission.granted) {
      throw new Error('没有图片保存权限');
    }
    assertCurrent(requestOptions);
    let savedUri = '';
    let native: NativeImageDownload | null = null;
    let downloadId: string | undefined;
    const abort = () => {
      if (downloadId) native?.cancelDownload(downloadId);
    };
    try {
      markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
      if (dataImage) {
        const baseDirectory = FileSystem.cacheDirectory;
        if (!baseDirectory) throw new Error('无法创建图片文件');
        savedUri = `${baseDirectory}${safeFileName('forum-image', dataImage.extension)}`;
        await FileSystem.writeAsStringAsync(savedUri, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        native = requireOptionalNativeModule<NativeImageDownload>('ImageDownload');
        if (!native) throw new Error('当前安装包不支持保存图片，请更新后重试。');
        downloadId = native.createDownload();
        requestOptions.signal?.addEventListener('abort', abort);
        assertCurrent(requestOptions);
        const downloaded = await native.download(downloadId, uri, imageRequestHeadersForUrl(uri, requestOptions) || {});
        savedUri = downloaded.uri;
        markDiagnosticStage(trace, 'parse', {
          contentType: downloaded.contentType || 'unknown',
          byteCount: downloaded.byteCount
        });
      }
      assertCurrent(requestOptions);
      await assertReadableImageFile(savedUri);
      assertCurrent(requestOptions);
      markDiagnosticStage(trace, 'parse', { state: 'file-readable' });
      markDiagnosticStage(trace, 'persist', { state: 'media-library-start' });
      await MediaLibrary.Asset.create(savedUri);
      markDiagnosticStage(trace, 'persist', { state: 'media-library' });
    } finally {
      requestOptions.signal?.removeEventListener('abort', abort);
      if (native && downloadId) native.releaseDownload(downloadId);
      else if (savedUri) await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => undefined);
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
