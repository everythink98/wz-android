import { useCallback, useMemo, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import { normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import {
  createImagePreviewCatalog,
  imagePreviewListFromCatalog,
  type ImageDisplaySize,
  type ImagePreviewList
} from '@/platform/media/imagePreviewCatalog';
import type { TopicImageDeriver } from '../model/topicDerivedData';
import { errorMessage } from '@/platform/network/errors';
import { saveImageUriToLibrary } from '@/platform/media/imageSave';
import type { Fetcher } from '@/platform/network/request';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import type { Source } from '@/domain/forum/models';
import type { MediaReferrerContext, MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
}

type HtmlPartsSource = string[] | (() => string[]);

function htmlPartsFromSource(source: HtmlPartsSource) {
  return typeof source === 'function' ? source() : source;
}

export function useImagePreviewController({
  beforeSave,
  contentSource,
  contentWidth,
  fetcher,
  htmlParts,
  inlineSizedImageUrls,
  mediaReferrer,
  nodeSeekMediaUserAgent,
  notify,
  topicImageDeriver
}: {
  beforeSave?: () => Promise<void>;
  contentSource: Source | null;
  contentWidth: number;
  fetcher?: Fetcher;
  htmlParts: HtmlPartsSource;
  inlineSizedImageUrls: Record<string, true>;
  mediaReferrer?: MediaReferrerContext;
  nodeSeekMediaUserAgent?: string;
  notify: (message: string) => void;
  topicImageDeriver: TopicImageDeriver;
}) {
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);
  const catalogSessionContext = useForumMediaRequestContext(contentSource);
  const catalogMediaContext = useMemo(
    () => (mediaReferrer ? { ...catalogSessionContext, referrer: mediaReferrer } : catalogSessionContext),
    [catalogSessionContext, mediaReferrer]
  );
  const previewSessionContext = useForumMediaRequestContext(imagePreview?.contentSource);
  const previewMediaContext = useMemo(
    () =>
      imagePreview?.referrer ? { ...previewSessionContext, referrer: imagePreview.referrer } : previewSessionContext,
    [imagePreview?.referrer, previewSessionContext]
  );
  const saveBusyRef = useRef(false);
  const inlineSizedImageUrlsRef = useCommittedRef(inlineSizedImageUrls);
  const topicImageDeriverRef = useCommittedRef(topicImageDeriver);
  const resolveImagePreview = useMemo(() => {
    let catalog: ReturnType<typeof createImagePreviewCatalog> | null = null;
    return (tappedUrl: string, tappedDisplaySize?: ImageDisplaySize, tappedReferrerPolicy?: MediaReferrerPolicy) => {
      if (!catalog) {
        catalog = createImagePreviewCatalog(
          htmlPartsFromSource(htmlParts).map((html) =>
            topicImageDeriver.markInlineSizedImages(html, inlineSizedImageUrls)
          ),
          contentWidth,
          PixelRatio.get(),
          catalogMediaContext
        );
      }
      return imagePreviewListFromCatalog(catalog, tappedUrl, contentSource, tappedDisplaySize, tappedReferrerPolicy);
    };
  }, [catalogMediaContext, contentSource, contentWidth, htmlParts, inlineSizedImageUrls, topicImageDeriver]);
  const resolveImagePreviewRef = useCommittedRef(resolveImagePreview);

  const openImagePreview = useCallback(
    (url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string, referrerPolicy?: MediaReferrerPolicy) => {
      const clean = normalizeImageCacheKey(url);
      if (
        clean &&
        topicImageDeriverRef.current.isInlineSizedImage(clean, referrerPolicy, inlineSizedImageUrlsRef.current)
      ) {
        return;
      }
      const nextPreview = resolveImagePreviewRef.current(url, displaySize, referrerPolicy);
      const posterUri = normalizeImagePreviewUrl(renderedPosterUri || '');
      if (posterUri.startsWith('file://') && nextPreview.items[nextPreview.index]) {
        nextPreview.items[nextPreview.index] = {
          ...nextPreview.items[nextPreview.index],
          displayUri: posterUri
        };
      }
      if (nextPreview.items.length > 0) {
        setImagePreview(nextPreview);
      }
    },
    []
  );
  const closeImagePreview = useCallback(() => setImagePreview(null), []);
  const selectPreviewImage = useCallback((index: number) => {
    setImagePreview((current) =>
      current
        ? {
            ...current,
            index: Math.max(0, Math.min(index, current.items.length - 1))
          }
        : current
    );
  }, []);
  const savePreviewImage = useCallback(async () => {
    const trace = beginDiagnosticTrace('media', 'save-preview', {
      itemCount: imagePreview?.items.length || 0
    });
    if (!imagePreview?.items.length) {
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
      const item = imagePreview.items[imagePreview.index] || imagePreview.items[0];
      const uri = item.originalUri;
      markDiagnosticStage(trace, 'guard', { state: 'network-ready' });
      await beforeSave?.();
      await saveImageUriToLibrary(
        uri,
        {
          mediaContext: previewMediaContext,
          nodeSeekUserAgent: nodeSeekMediaUserAgent,
          referrerPolicy: item.referrerPolicy
        },
        fetcher,
        trace
      );
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
  }, [beforeSave, fetcher, imagePreview, nodeSeekMediaUserAgent, notify, previewMediaContext]);

  return {
    closeImagePreview,
    imagePreview,
    openImagePreview,
    savePreviewImage,
    selectPreviewImage
  };
}
