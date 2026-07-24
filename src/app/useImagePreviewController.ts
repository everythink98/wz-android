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
import type { Fetcher } from '../request';
import {
  beginDiagnosticTrace,
  finishDiagnosticTrace,
  markDiagnosticStage,
  normalizeDiagnosticReason
} from '../diagnostics';
import { useCommittedRef } from './useCommittedRef';

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
}

type HtmlPartsSource = string[] | (() => string[]);

function htmlPartsFromSource(source: HtmlPartsSource) {
  return typeof source === 'function' ? source() : source;
}

export function useImagePreviewController({
  beforeSave,
  fetcher,
  htmlParts,
  inlineSizedImageUrls,
  nodeSeekMediaUserAgent,
  notify,
  topicImageDeriver
}: {
  beforeSave?: () => Promise<void>;
  fetcher?: Fetcher;
  htmlParts: HtmlPartsSource;
  inlineSizedImageUrls: Record<string, true>;
  nodeSeekMediaUserAgent?: string;
  notify: (message: string) => void;
  topicImageDeriver: TopicImageDeriver;
}) {
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);
  const saveBusyRef = useRef(false);
  const inlineSizedImageUrlsRef = useCommittedRef(inlineSizedImageUrls);
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
  const resolveImagePreviewRef = useCommittedRef(resolveImagePreview);

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
    const trace = beginDiagnosticTrace('media', 'save-preview', {
      itemCount: imagePreview?.urls.length || 0
    });
    if (!imagePreview?.urls.length) {
      markDiagnosticStage(trace, 'guard', { state: 'empty-preview' });
      finishDiagnosticTrace(trace, 'noop', { reason: 'not_ready' });
      return;
    }
    if (saveBusyRef.current) {
      markDiagnosticStage(trace, 'guard', { state: 'busy' });
      finishDiagnosticTrace(trace, 'blocked', { reason: 'busy' });
      return;
    }
    saveBusyRef.current = true;
    try {
      const uri = imagePreview.urls[imagePreview.index] || imagePreview.urls[0];
      markDiagnosticStage(trace, 'guard', { state: 'network-ready' });
      await beforeSave?.();
      await saveImageUriToLibrary(uri, fetcher, trace, {
        nodeSeekUserAgent: nodeSeekMediaUserAgent
      });
      markDiagnosticStage(trace, 'apply', { state: 'saved' });
      finishDiagnosticTrace(trace, 'success');
      notify('图片已保存');
    } catch (error) {
      const reason = normalizeDiagnosticReason(error);
      finishDiagnosticTrace(trace, reason === 'permission_denied' ? 'blocked' : 'failure', { reason });
      notify(errorMessage(error));
    } finally {
      saveBusyRef.current = false;
    }
  }, [beforeSave, fetcher, imagePreview, nodeSeekMediaUserAgent, notify]);

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
