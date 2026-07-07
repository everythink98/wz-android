import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { Buffer } from 'buffer';
import { safeFileName } from './backupFiles';
import { dataImageFileFromUrl, imageRequestHeadersForUrl, isHttpOrHttpsUrl } from './htmlImages';
import type { Fetcher } from './request';

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

async function downloadImageWithFetcher(uri: string, target: string, fetcher: Fetcher) {
  const headers = imageRequestHeadersForUrl(uri);
  const response = await fetcher(uri, headers ? { headers } : undefined);
  assertDownloadedImage(response);
  const content = Buffer.from(await response.arrayBuffer()).toString('base64');
  await FileSystem.writeAsStringAsync(target, content, { encoding: FileSystem.EncodingType.Base64 });
}

export async function saveImageUriToLibrary(uri: string, fetcher: Fetcher = fetch) {
  const dataImage = dataImageFileFromUrl(uri);
  if (!dataImage && !isHttpOrHttpsUrl(uri)) {
    throw new Error('图片地址不支持保存');
  }
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
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
    if (dataImage) {
      await FileSystem.writeAsStringAsync(target, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
    } else {
      await downloadImageWithFetcher(uri, target, fetcher);
    }
    await assertReadableImageFile(savedUri);
    await MediaLibrary.saveToLibraryAsync(savedUri);
  } finally {
    if (shouldDeleteFile && savedUri) {
      await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => undefined);
    }
  }
}
