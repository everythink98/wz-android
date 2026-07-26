import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Buffer } from 'buffer';
import { safeFileName } from './backupFiles';
import { dataImageFileFromUrl, imageRequestHeadersForUrl, isHttpOrHttpsUrl } from './htmlImages';
import { fetchWithTimeout, type Fetcher } from './request';
import type { ForumMediaRequestContext } from './mediaRequestContext';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticTrace
} from './diagnostics';

export interface ImageSaveRequestOptions {
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
}

function imageFileExtension(uri: string) {
  const extension = uri.match(/\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|webp)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension || 'jpg';
}

function responseContentType(response: Response) {
  return response.headers.get('content-type') || '';
}

function imageFileExtensionFromContentType(contentType: string) {
  switch (contentType.split(';', 1)[0]?.trim().toLowerCase()) {
    case 'image/apng':
      return 'apng';
    case 'image/avif':
      return 'avif';
    case 'image/bmp':
    case 'image/x-ms-bmp':
      return 'bmp';
    case 'image/gif':
      return 'gif';
    case 'image/heic':
      return 'heic';
    case 'image/heif':
      return 'heif';
    case 'image/jpeg':
    case 'image/jpg':
    case 'image/pjpeg':
      return 'jpg';
    case 'image/png':
    case 'image/x-png':
      return 'png';
    case 'application/svg+xml':
    case 'image/svg+xml':
      return 'svg';
    case 'image/webp':
      return 'webp';
    default:
      return '';
  }
}

function isImageContentType(contentType: string) {
  const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase() || '';
  return mimeType.startsWith('image/') || mimeType === 'application/svg+xml';
}

function assertDownloadedImage(response: Response) {
  if (!response.ok) {
    throw new Error('图片下载失败');
  }
  const contentType = responseContentType(response);
  if (contentType && !isImageContentType(contentType)) {
    throw new Error('下载内容不是图片');
  }
}

async function assertReadableImageFile(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || info.size <= 0) {
    throw new Error('图片文件无效');
  }
}

async function downloadImageWithFetcher(
  uri: string,
  fetcher: Fetcher,
  trace: DiagnosticTrace,
  requestOptions: ImageSaveRequestOptions
) {
  const headers = imageRequestHeadersForUrl(uri, {
    mediaContext: requestOptions.mediaContext,
    nodeSeekUserAgent: requestOptions.nodeSeekUserAgent
  });
  const response = await fetchWithTimeout(uri, headers ? { headers } : {}, {
    fetcher: withDiagnosticFetcher(trace, fetcher)
  });
  assertDownloadedImage(response);
  const contentType = responseContentType(response);
  markDiagnosticStage(trace, 'parse', { contentType: contentType || 'unknown' });
  return {
    base64: Buffer.from(await response.arrayBuffer()).toString('base64'),
    extension: imageFileExtensionFromContentType(contentType)
  };
}

export async function saveImageUriToLibrary(
  uri: string,
  requestOptions: ImageSaveRequestOptions,
  fetcher: Fetcher = fetch,
  parentTrace?: DiagnosticTrace
) {
  const dataImage = dataImageFileFromUrl(uri);
  const trace = parentTrace || beginDiagnosticTrace('media', 'save-image', {
    channel: dataImage ? 'data' : isHttpOrHttpsUrl(uri) ? 'remote' : 'unsupported'
  });
  const ownsTrace = !parentTrace;
  try {
    if (!dataImage && !isHttpOrHttpsUrl(uri)) {
      throw new Error('图片地址不支持保存');
    }
    const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    markDiagnosticStage(trace, 'credential', { isGranted: permission.granted });
    if (!permission.granted) {
      throw new Error('没有图片保存权限');
    }
    const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
    if (!baseDirectory) {
      throw new Error('无法创建图片文件');
    }
    const shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;
    let savedUri = '';
    try {
      const fallbackExtension = dataImage?.extension || imageFileExtension(uri);
      savedUri = `${baseDirectory}${safeFileName('forum-image', fallbackExtension)}`;
      markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
      if (dataImage) {
        await FileSystem.writeAsStringAsync(savedUri, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        const downloaded = await downloadImageWithFetcher(uri, fetcher, trace, requestOptions);
        if (downloaded.extension && downloaded.extension !== fallbackExtension) {
          savedUri = `${baseDirectory}${safeFileName('forum-image', downloaded.extension)}`;
        }
        await FileSystem.writeAsStringAsync(savedUri, downloaded.base64, { encoding: FileSystem.EncodingType.Base64 });
      }
      await assertReadableImageFile(savedUri);
      markDiagnosticStage(trace, 'parse', { state: 'file-readable' });
      markDiagnosticStage(trace, 'persist', { state: 'media-library-start' });
      await MediaLibrary.saveToLibraryAsync(savedUri);
      markDiagnosticStage(trace, 'persist', { state: 'media-library' });
    } finally {
      if (shouldDeleteFile && savedUri) {
        await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => undefined);
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
