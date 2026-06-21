import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { safeFileName } from './backupFiles';
import { dataImageFileFromUrl, imageRequestHeadersForUrl } from './htmlImages';

function imageFileExtension(uri: string) {
  return uri.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1]?.replace('jpeg', 'jpg') || 'jpg';
}

function responseContentType(result: FileSystem.FileSystemDownloadResult) {
  return result.mimeType || result.headers['content-type'] || result.headers['Content-Type'] || '';
}

function assertDownloadedImage(result: FileSystem.FileSystemDownloadResult) {
  if (result.status < 200 || result.status >= 300) {
    throw new Error('图片下载失败');
  }
  const contentType = responseContentType(result);
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

export async function saveImageUriToLibrary(uri: string) {
  const permission = await MediaLibrary.requestPermissionsAsync();
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
    const dataImage = dataImageFileFromUrl(uri);
    const target = `${baseDirectory}${safeFileName('forum-image', dataImage?.extension || imageFileExtension(uri))}`;
    if (dataImage) {
      await FileSystem.writeAsStringAsync(target, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
      savedUri = target;
    } else {
      const headers = imageRequestHeadersForUrl(uri);
      const downloaded = await FileSystem.downloadAsync(uri, target, headers ? { headers } : undefined);
      savedUri = downloaded.uri;
      assertDownloadedImage(downloaded);
    }
    await assertReadableImageFile(savedUri);
    await MediaLibrary.saveToLibraryAsync(savedUri);
  } finally {
    if (shouldDeleteFile && savedUri) {
      await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => undefined);
    }
  }
}
