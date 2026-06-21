import { useCallback, useMemo, useRef, useState } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { safeFileName } from '../backupFiles';
import {
  createImagePreviewCatalog,
  dataImageFileFromUrl,
  imageRequestHeadersForUrl,
  imagePreviewListFromCatalog,
  normalizeImagePreviewUrl,
  type ImagePreviewList
} from '../htmlImages';
import type { TopicImageDeriver } from '../topicDerivedData';
import { errorMessage } from '../appUtils';

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
}

export function useImagePreviewController({
  htmlParts,
  inlineSizedImageUrls,
  notify,
  topicImageDeriver
}: {
  htmlParts: string[];
  inlineSizedImageUrls: Record<string, true>;
  notify: (message: string) => void;
  topicImageDeriver: TopicImageDeriver;
}) {
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);
  const inlineSizedImageUrlsRef = useRef(inlineSizedImageUrls);
  inlineSizedImageUrlsRef.current = inlineSizedImageUrls;
  const resolveImagePreview = useMemo(() => {
    let catalog: ReturnType<typeof createImagePreviewCatalog> | null = null;
    return (tappedUrl: string) => {
      if (!catalog) {
        catalog = createImagePreviewCatalog(
          htmlParts.map((html) => topicImageDeriver.markInlineSizedImages(html, inlineSizedImageUrls))
        );
      }
      return imagePreviewListFromCatalog(catalog, tappedUrl);
    };
  }, [htmlParts, inlineSizedImageUrls, topicImageDeriver]);
  const resolveImagePreviewRef = useRef(resolveImagePreview);
  resolveImagePreviewRef.current = resolveImagePreview;

  const openImagePreview = useCallback((url: string) => {
    const clean = normalizeImageCacheKey(url);
    if (clean && inlineSizedImageUrlsRef.current[clean]) {
      return;
    }
    const nextPreview = resolveImagePreviewRef.current(url);
    if (nextPreview.urls.length > 0) {
      setImagePreview(nextPreview);
    }
  }, []);
  const closeImagePreview = useCallback(() => setImagePreview(null), []);
  const showPreviousImage = useCallback(() => {
    setImagePreview((current) => current && current.urls.length > 1 ? {
      ...current,
      index: (current.index + current.urls.length - 1) % current.urls.length
    } : current);
  }, []);
  const showNextImage = useCallback(() => {
    setImagePreview((current) => current && current.urls.length > 1 ? {
      ...current,
      index: (current.index + 1) % current.urls.length
    } : current);
  }, []);
  const selectPreviewImage = useCallback((index: number) => {
    setImagePreview((current) => current ? {
      ...current,
      index: Math.max(0, Math.min(index, current.urls.length - 1))
    } : current);
  }, []);
  const savePreviewImage = useCallback(async () => {
    if (!imagePreview?.urls.length) {
      return;
    }
    let downloadedUri = '';
    let shouldDeleteFile = false;
    try {
      const uri = imagePreview.urls[imagePreview.index] || imagePreview.urls[0];
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        notify('没有图片保存权限');
        return;
      }
      const extension = uri.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1]?.replace('jpeg', 'jpg') || 'jpg';
      const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDirectory) {
        notify('无法创建图片文件');
        return;
      }
      shouldDeleteFile = baseDirectory === FileSystem.cacheDirectory;
      const dataImage = dataImageFileFromUrl(uri);
      const target = `${baseDirectory}${safeFileName('forum-image', dataImage?.extension || extension)}`;
      if (dataImage) {
        await FileSystem.writeAsStringAsync(target, dataImage.base64, { encoding: FileSystem.EncodingType.Base64 });
        downloadedUri = target;
      } else {
        const headers = imageRequestHeadersForUrl(uri);
        const downloaded = await FileSystem.downloadAsync(uri, target, headers ? { headers } : undefined);
        downloadedUri = downloaded.uri;
      }
      await MediaLibrary.saveToLibraryAsync(downloadedUri);
      notify('图片已保存');
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      if (shouldDeleteFile && downloadedUri) {
        await FileSystem.deleteAsync(downloadedUri, { idempotent: true }).catch(() => undefined);
      }
    }
  }, [imagePreview, notify]);

  return {
    closeImagePreview,
    imagePreview,
    openImagePreview,
    savePreviewImage,
    selectPreviewImage,
    showNextImage,
    showPreviousImage
  };
}
