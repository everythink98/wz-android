import { useCallback, useMemo, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import { normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import {
  createImagePreviewCatalogFromDescriptors,
  imagePreviewItemAt,
  imagePreviewListFromCatalog,
  type ImageDisplaySize,
  type ImagePreviewCatalog,
  type ImagePreviewList
} from '@/platform/media/imagePreviewCatalog';
import type { TopicImageDeriver } from '../model/topicDerivedData';
import { errorMessage } from '@/platform/network/errors';
import { saveImageUriToLibrary } from '@/platform/media/imageSave';
import type { Fetcher } from '@/platform/network/request';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import type { Source } from '@/domain/forum/models';
import type { MediaReferrerContext, MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { beginDiagnosticTrace, finishDiagnosticTrace, markDiagnosticStage } from '@/platform/diagnostics/diagnostics';
import { normalizeDiagnosticReason } from '@/platform/diagnostics/diagnosticPolicy';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
}

function sameDescriptorSequence(
  previous: readonly ForumImagePreviewDescriptor[],
  next: readonly ForumImagePreviewDescriptor[]
) {
  return (
    previous === next || (previous.length === next.length && previous.every((item, index) => item === next[index]))
  );
}

export function useImagePreviewController({
  beforeSave,
  contentSource,
  contentWidth,
  fetcher,
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
  inlineSizedImageUrls: Record<string, true>;
  mediaReferrer?: MediaReferrerContext;
  nodeSeekMediaUserAgent?: string;
  notify: (message: string) => void;
  topicImageDeriver: TopicImageDeriver;
}) {
  const [imagePreview, setImagePreview] = useState<ImagePreviewList | null>(null);
  const catalogSessionContext = useForumMediaRequestContext(contentSource);
  const catalogMediaContext = useMemo<ForumMediaRequestContext>(
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
  const catalogRef = useRef<ImagePreviewCatalog | null>(null);
  const catalogRegistrationRef = useRef<{
    descriptors: readonly ForumImagePreviewDescriptor[];
    inlineSizedImageSignature: string;
    mediaRevision: string;
    pixelRatio: number;
    topicImageDeriver: TopicImageDeriver;
    width: number;
  } | null>(null);
  const contentSourceRef = useCommittedRef(contentSource);
  const catalogMediaContextRef = useCommittedRef(catalogMediaContext);
  const inlineSizedImageUrlsRef = useCommittedRef(inlineSizedImageUrls);
  const topicImageDeriverRef = useCommittedRef(topicImageDeriver);
  const inlineSizedImageSignature = useMemo(
    () =>
      Object.keys(inlineSizedImageUrls)
        .filter((identity) => inlineSizedImageUrls[identity])
        .sort()
        .join('\n'),
    [inlineSizedImageUrls]
  );
  const mediaRevision = [
    catalogMediaContext.contentSource || '',
    catalogMediaContext.sessionIdentity,
    catalogMediaContext.referrer?.documentUrl || '',
    catalogMediaContext.referrer?.documentPolicy || ''
  ].join('\n');
  const pixelRatio = PixelRatio.get();
  const registerImagePreviewDescriptors = useCallback(
    (descriptors: readonly ForumImagePreviewDescriptor[]) => {
      const current = catalogRegistrationRef.current;
      if (
        current &&
        sameDescriptorSequence(current.descriptors, descriptors) &&
        current.inlineSizedImageSignature === inlineSizedImageSignature &&
        current.mediaRevision === mediaRevision &&
        current.pixelRatio === pixelRatio &&
        current.topicImageDeriver === topicImageDeriver &&
        current.width === contentWidth
      ) {
        return;
      }
      catalogRef.current = createImagePreviewCatalogFromDescriptors(
        descriptors,
        contentWidth,
        pixelRatio,
        catalogMediaContext,
        (url, referrerPolicy) => topicImageDeriver.isInlineSizedImage(url, referrerPolicy, inlineSizedImageUrls)
      );
      catalogRegistrationRef.current = {
        descriptors,
        inlineSizedImageSignature,
        mediaRevision,
        pixelRatio,
        topicImageDeriver,
        width: contentWidth
      };
    },
    [
      catalogMediaContext,
      contentWidth,
      inlineSizedImageUrls,
      inlineSizedImageSignature,
      mediaRevision,
      pixelRatio,
      topicImageDeriver
    ]
  );

  const openImagePreview = useCallback(
    (url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string, referrerPolicy?: MediaReferrerPolicy) => {
      const clean = normalizeImageCacheKey(url);
      if (
        clean &&
        topicImageDeriverRef.current.isInlineSizedImage(clean, referrerPolicy, inlineSizedImageUrlsRef.current)
      ) {
        return;
      }
      const catalog = catalogRef.current || {
        items: [],
        itemIndexBySourceUrl: {},
        mediaContext: catalogMediaContextRef.current
      };
      const nextPreview = imagePreviewListFromCatalog(
        catalog,
        url,
        contentSourceRef.current,
        displaySize,
        referrerPolicy
      );
      const posterUri = normalizeImagePreviewUrl(renderedPosterUri || '');
      const selectedItem = imagePreviewItemAt(nextPreview, nextPreview.index);
      if (posterUri.startsWith('file://') && selectedItem) {
        nextPreview.itemOverride = {
          ...selectedItem,
          displayUri: posterUri
        };
        nextPreview.itemOverrideIndex = nextPreview.index;
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
      const item = imagePreviewItemAt(imagePreview, imagePreview.index) || imagePreview.items[0];
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
    registerImagePreviewDescriptors,
    savePreviewImage,
    selectPreviewImage
  };
}
