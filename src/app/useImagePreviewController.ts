import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createImagePreviewCatalog,
  imagePreviewListFromCatalog,
  normalizeImagePreviewUrl,
  type ImagePreviewList
} from '../htmlImages';
import type { TopicImageDeriver } from '../topicDerivedData';
import { errorMessage } from '../appUtils';
import { saveImageUriToLibrary } from '../imageSave';

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
}

type HtmlPartsSource = string[] | (() => string[]);

function htmlPartsFromSource(source: HtmlPartsSource) {
  return typeof source === 'function' ? source() : source;
}

export function useImagePreviewController({
  htmlParts,
  inlineSizedImageUrls,
  notify,
  topicImageDeriver
}: {
  htmlParts: HtmlPartsSource;
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
          htmlPartsFromSource(htmlParts).map((html) => topicImageDeriver.markInlineSizedImages(html, inlineSizedImageUrls))
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
    try {
      const uri = imagePreview.urls[imagePreview.index] || imagePreview.urls[0];
      await saveImageUriToLibrary(uri);
      notify('图片已保存');
    } catch (error) {
      notify(errorMessage(error));
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
