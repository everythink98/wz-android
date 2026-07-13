import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Buffer } from 'buffer';
import { safeFileName } from './backupFiles';
import { dataImageFileFromUrl, imageRequestHeadersForUrl, isHttpOrHttpsUrl } from './htmlImages';
import type { Fetcher } from './request';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason,
  withDiagnosticFetcher,
  type DiagnosticTrace
} from './diagnostics';

function imageFileExtension(uri: string) {
  return uri.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1]?.replace('jpeg', 'jpg') || 'jpg';
}

function responseContentType(response: Response) {
  return response.headers.get('content-type') || '';
}

function assertDownloadedImage(response: Response) {
  if (!response.ok) {
    throw new Error('图片下载失败');
  }
  const contentType = responseContentType(response);
  if (contentType && !/^image\//i.test(contentType)) {
    throw new Error('下载内容不是图片');
  }
}

async function assertReadableImageFile(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || info.size <= 0) {
    throw new Error('图片文件无效');
  }
}

async function downloadImageWithFetcher(uri: string, target: string, fetcher: Fetcher, trace: DiagnosticTrace, nodeSeekCookieHeader: string, nodeSeekUserAgent: string) {
  const headers = imageRequestHeadersForUrl(uri, nodeSeekCookieHeader, nodeSeekUserAgent);
  const response = await withDiagnosticFetcher(trace, fetcher)(uri, headers ? { headers } : undefined);
  assertDownloadedImage(response);
  markDiagnosticStage(trace, 'parse', { contentType: responseContentType(response) || 'unknown' });
  const content = Buffer.from(await response.arrayBuffer()).toString('base64');
  await FileSystem.writeAsStringAsync(target, content, { encoding: FileSystem.EncodingType.Base64 });
}

export async function saveImageUriToLibrary(
  uri: string,
  fetcher: Fetcher = fetch,
  parentTrace?: DiagnosticTrace,
  nodeSeekCookieHeader = '',
  nodeSeekUserAgent = ''
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
      const target = `${baseDirectory}${safeFileName('forum-image', dataImage?.extension || imageFileExtension(uri))}`;
      savedUri = target;
      markDiagnosticStage(trace, 'persist', { state: 'temporary-file' });
      if (dataImage) {
        await FileSystem.writeAsStringAsync(target, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        await downloadImageWithFetcher(uri, target, fetcher, trace, nodeSeekCookieHeader, nodeSeekUserAgent);
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
