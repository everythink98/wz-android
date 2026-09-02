import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Image as NativeImage,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageURISource,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData } from 'expo-image';
import { useRecyclingState } from '@shopify/flash-list';
import {
  useIMGElementProps,
  useIMGElementStateWithCache,
  type CustomBlockRenderer,
  type CustomTextualRenderer,
  type IMGElementProps
} from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { imageSourceFromUrl, normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import {
  selectImageDisplaySource,
  selectImageOriginalSource,
  type ImageDisplaySize
} from '@/platform/media/imagePreviewCatalog';
import {
  FORUM_FLOW_IMAGE_CONTEXT_ATTRIBUTE,
  INLINE_FORUM_IMAGE_TAG,
  isBoundedInlineForumImage,
  isInlineForumImage
} from '@/domain/forum/forumContentMedia';
import { inlineForumImageAlignmentStyle, inlineForumImageAttachmentSize } from '@/platform/media/inlineMedia';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { useForumContentWidth } from '@/ui/content/ForumContentWidth';
import type { HtmlRenderers } from './types';
import { createHtmlRendererStyles } from './htmlStyles';
import { useContentBoundarySpacing } from './TopicContentPresentation';
import {
  cachedCompatibleSvgArtifact,
  compatibleImageRequestIdentity,
  promoteCachedCompatibleSvgArtifact,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster,
  stableImageRequestKey,
  type CompatibleSvgArtifact
} from '@/platform/media/compatibleImageSources';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import {
  markOriginalImageDisplayed,
  originalImageDisplayIdentity,
  useOriginalImageDisplayRevision,
  useOriginalImageUpgradeEnabled
} from '@/platform/media/originalImageLoading';
import {
  cachedImageDisplayDimensions,
  rememberImageDisplayDimensions,
  type CachedImageDimensions
} from '@/platform/media/imageDisplayDimensions';
import { useTopicBodyMediaLease } from '../media/TopicBodyMediaCoordinator';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';

function imageDisplayCacheIdentity(source: ImageURISource) {
  return typeof (source as ImageURISource & { cacheKey?: unknown }).cacheKey === 'string'
    ? String((source as ImageURISource & { cacheKey: string }).cacheKey)
    : compatibleImageRequestIdentity(source);
}

function useImageSourceAttempt(source: ImageURISource, attemptId: string) {
  return useMemo(() => {
    void attemptId;
    return { ...source };
  }, [attemptId, source]);
}

function useCompatibleBodyImageArtifact({
  attemptIdentity,
  onTerminalFailure,
  source
}: {
  attemptIdentity: string;
  onTerminalFailure: () => void;
  source: ImageURISource;
}) {
  const requestIdentity = compatibleImageRequestIdentity(source);
  const consumption = useMemo(
    () => ({ controller: new AbortController(), requestIdentity: attemptIdentity }),
    [attemptIdentity]
  );
  const mountedRef = useRef(true);
  const attemptIdentityRef = useRef(attemptIdentity);
  const settledAttemptIdentityRef = useRef('');
  const posterRefreshIdentityRef = useRef('');
  const onTerminalFailureRef = useRef(onTerminalFailure);
  const [artifact, setArtifact] = useRecyclingState<CompatibleSvgArtifact | null>(null, [requestIdentity]);
  const cachedArtifact = cachedCompatibleSvgArtifact(source);
  useEffect(() => {
    if (cachedArtifact) promoteCachedCompatibleSvgArtifact(requestIdentity);
  }, [cachedArtifact, requestIdentity]);
  const activeArtifact = artifact?.requestIdentity === requestIdentity ? artifact : cachedArtifact;
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      consumption.controller.abort();
    };
  }, [consumption]);
  useLayoutEffect(() => {
    attemptIdentityRef.current = attemptIdentity;
    onTerminalFailureRef.current = onTerminalFailure;
  }, [attemptIdentity, onTerminalFailure]);
  const isCurrent = useCallback(
    () => mountedRef.current && attemptIdentityRef.current === attemptIdentity,
    [attemptIdentity]
  );
  const isSettled = useCallback(() => settledAttemptIdentityRef.current === attemptIdentity, [attemptIdentity]);
  const settle = useCallback(() => {
    if (!isCurrent() || isSettled()) return false;
    settledAttemptIdentityRef.current = attemptIdentity;
    return true;
  }, [attemptIdentity, isCurrent, isSettled]);
  const fail = useCallback(() => {
    if (!settle()) return;
    onTerminalFailureRef.current();
  }, [settle]);
  const recover = useCallback(async () => {
    try {
      const recovered = await recoverCompatibleSvgArtifact(source, { signal: consumption.controller.signal });
      if (!isCurrent() || isSettled()) return;
      if (recovered) setArtifact(recovered, true);
      else fail();
    } catch {
      fail();
    }
  }, [consumption, fail, isCurrent, isSettled, setArtifact, source]);
  const refresh = useCallback(
    async (currentArtifact: CompatibleSvgArtifact) => {
      try {
        const refreshed = await refreshCompatibleSvgPoster(currentArtifact, {
          signal: consumption.controller.signal
        });
        if (!isCurrent() || isSettled()) return;
        setArtifact(refreshed, true);
      } catch {
        fail();
      }
    },
    [consumption, fail, isCurrent, isSettled, setArtifact]
  );
  const handleError = useCallback(() => {
    if (!isCurrent() || isSettled()) return;
    if (!activeArtifact) {
      void recover();
      return;
    }
    if (posterRefreshIdentityRef.current === attemptIdentity) {
      fail();
      return;
    }
    posterRefreshIdentityRef.current = attemptIdentity;
    void refresh(activeArtifact);
  }, [activeArtifact, attemptIdentity, fail, isCurrent, isSettled, recover, refresh]);
  return {
    activeArtifact,
    activeSource: activeArtifact?.posterSource || source,
    handleError,
    isCurrent,
    isSettled,
    settle
  };
}

type PreviewImageBlockProps = {
  alignment: 'center' | 'flex-end' | 'flex-start';
  attributes: Record<string, string | undefined>;
  boundarySpacing?: ViewStyle;
  contentWidth: number;
  displaySize?: ImageDisplaySize;
  errorTextStyle: StyleProp<TextStyle>;
  frameBackgroundColor: string;
  frameBorderColor: string;
  imageProps: IMGElementProps;
  imageSource: ImageURISource;
  loadingColor: string;
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  onOpenImagePreview: (
    url: string,
    displaySize?: ImageDisplaySize,
    renderedPosterUri?: string,
    referrerPolicy?: MediaReferrerPolicy
  ) => void;
  originalUri: string;
  src: string;
};

const STANDALONE_IMAGE_SPACING = { marginBottom: 8, marginTop: 6 } as const;

function ManagedOriginalImageLayer({
  forced,
  onDisplay,
  onRequestError,
  onTerminalFailure,
  requestIdentity,
  source
}: {
  forced: boolean;
  onDisplay: () => void;
  onRequestError: () => boolean;
  onTerminalFailure: () => void;
  requestIdentity: string;
  source: ImageURISource;
}) {
  const lease = useTopicBodyMediaLease({
    kind: 'original',
    priority: forced ? 'user' : 'upgrade',
    requestIdentity
  });
  const activeAttemptIdRef = useRef(lease.attemptId);
  useLayoutEffect(() => {
    activeAttemptIdRef.current = lease.attemptId;
  }, [lease.attemptId]);
  useEffect(() => {
    if (lease.failure) onTerminalFailure();
  }, [lease.failure, onTerminalFailure]);
  const attemptedSource = useImageSourceAttempt(source, lease.attemptId);
  if (!lease.admitted) return null;
  return (
    <ExpoImage
      testID="topic-image-original"
      allowDownscaling
      cachePolicy="disk"
      contentFit="contain"
      priority={forced ? 'high' : 'low'}
      recyclingKey={`${compatibleImageRequestIdentity(source)}:body-original`}
      source={attemptedSource}
      style={StyleSheet.absoluteFillObject}
      transition={150}
      onDisplay={() => {
        if (activeAttemptIdRef.current !== lease.attemptId) return;
        lease.settle('displayed');
        onDisplay();
      }}
      onError={() => {
        if (activeAttemptIdRef.current !== lease.attemptId) return;
        if (!onRequestError()) return;
        lease.settle('error');
        if (lease.attemptId === 'unmanaged') onTerminalFailure();
      }}
      onProgress={(event) => lease.progress(event.loaded)}
    />
  );
}

function AdmittedPreviewImageBlock({
  alignment,
  attributes,
  boundarySpacing,
  bodyMediaLease,
  contentWidth: availableContentWidth,
  displaySize,
  errorTextStyle,
  frameBackgroundColor,
  frameBorderColor,
  imageProps,
  imageSource,
  loadingColor,
  mediaContext,
  nodeSeekMediaUserAgent,
  onOpenImagePreview,
  originalUri,
  src
}: PreviewImageBlockProps & { bodyMediaLease: ReturnType<typeof useTopicBodyMediaLease> }) {
  const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
  const requestIdentity = compatibleImageRequestIdentity(imageSource);
  const cacheKey = imageDisplayCacheIdentity(imageSource);
  const bodyRequestIdentity = `${requestIdentity}\u0000attempt:${bodyMediaLease.attemptId}`;
  const originalSource = useMemo(() => {
    const cleanOriginalUri = normalizeImagePreviewUrl(originalUri);
    return cleanOriginalUri && cleanOriginalUri !== normalizeImagePreviewUrl(src)
      ? (imageSourceFromUrl(cleanOriginalUri, {
          baseSource: imageProps.source,
          mediaContext,
          nodeSeekUserAgent: nodeSeekMediaUserAgent,
          referrerPolicy
        }) as ImageURISource)
      : null;
  }, [imageProps.source, mediaContext, nodeSeekMediaUserAgent, originalUri, referrerPolicy, src]);
  const originalRequestIdentity = originalImageDisplayIdentity(originalSource);
  const originalDisplayRevision = useOriginalImageDisplayRevision(originalSource);
  const originalUpgradeEnabled = useOriginalImageUpgradeEnabled();
  const mountedRef = useRef(true);
  const [loadedImage, setLoadedImage] = useRecyclingState<{
    cacheType: ImageLoadEventData['cacheType'];
    dimensions: CachedImageDimensions;
    imageLoadIdentity: string;
    requestIdentity: string;
  } | null>(null, [requestIdentity]);
  const [displayedImageLoadIdentity, setDisplayedImageLoadIdentity] = useRecyclingState('', [requestIdentity]);
  const [failedRequestIdentity, setFailedRequestIdentity] = useRecyclingState('', [requestIdentity]);
  const [forcedOriginalIdentity, setForcedOriginalIdentity] = useRecyclingState('', [requestIdentity]);
  const [displayedOriginalIdentity, setDisplayedOriginalIdentity] = useRecyclingState('', [requestIdentity]);
  const [failedOriginal, setFailedOriginal] = useRecyclingState({ identity: '', revision: -1 }, [requestIdentity]);
  const contentWidth = Math.max(1, availableContentWidth);
  const handleTerminalFailure = useCallback(
    () => setFailedRequestIdentity(bodyRequestIdentity, true),
    [bodyRequestIdentity, setFailedRequestIdentity]
  );
  const {
    activeArtifact,
    activeSource: activeImageSource,
    handleError: handleImageError,
    isCurrent: isCurrentImageAttempt,
    isSettled: isImageAttemptSettled,
    settle: settleImageAttempt
  } = useCompatibleBodyImageArtifact({
    attemptIdentity: bodyRequestIdentity,
    onTerminalFailure: handleTerminalFailure,
    source: imageSource
  });
  const imageLoadIdentity = `${bodyRequestIdentity}:${activeArtifact ? `compatible:${activeArtifact.posterRevision}` : 'native'}`;
  const imageVisualIdentity = `${requestIdentity}:${activeArtifact ? `compatible:${activeArtifact.posterRevision}` : 'native'}`;
  const attemptedImageSource = useImageSourceAttempt(activeImageSource, bodyMediaLease.attemptId);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const handleImageLoad = useCallback(
    (event: ImageLoadEventData) => {
      if (!isCurrentImageAttempt() || isImageAttemptSettled()) return;
      const width = Number(event.source.width);
      const height = Number(event.source.height);
      if (!(width > 0 && height > 0)) {
        return;
      }
      const knownDimensions = cachedImageDisplayDimensions(cacheKey);
      rememberImageDisplayDimensions(cacheKey, { height, width });
      setLoadedImage(
        {
          cacheType: event.cacheType,
          dimensions: { height, width },
          imageLoadIdentity,
          requestIdentity: bodyRequestIdentity
        },
        knownDimensions?.height === height && knownDimensions.width === width
      );
    },
    [bodyRequestIdentity, cacheKey, imageLoadIdentity, isCurrentImageAttempt, isImageAttemptSettled, setLoadedImage]
  );
  const handleImageDisplay = useCallback(() => {
    if (!isCurrentImageAttempt() || isImageAttemptSettled()) return;
    setDisplayedImageLoadIdentity(imageLoadIdentity, true);
  }, [imageLoadIdentity, isCurrentImageAttempt, isImageAttemptSettled, setDisplayedImageLoadIdentity]);
  const handleImageProgress = useCallback(
    (event: { loaded: number }) => {
      if (!isCurrentImageAttempt() || isImageAttemptSettled()) return;
      bodyMediaLease.progress(event.loaded);
    },
    [bodyMediaLease, isCurrentImageAttempt, isImageAttemptSettled]
  );
  const loadFailed = failedRequestIdentity === bodyRequestIdentity;
  const cachedDimensions = cachedImageDisplayDimensions(cacheKey);
  const activeLoadedImage =
    loadedImage?.requestIdentity === bodyRequestIdentity && loadedImage.imageLoadIdentity === imageLoadIdentity
      ? loadedImage
      : null;
  const naturalDimensions = activeLoadedImage
    ? activeLoadedImage.dimensions
    : cachedDimensions || displaySize || { height: Math.round(contentWidth * 0.75), width: contentWidth };
  const {
    height: _specifiedStyleHeight,
    width: _specifiedStyleWidth,
    ...naturalImageStyle
  } = StyleSheet.flatten(imageProps.style) || {};
  const imageState = useIMGElementStateWithCache({
    ...imageProps,
    cachedNaturalDimensions: naturalDimensions,
    contentWidth,
    height: undefined,
    source: imageSource,
    style: [naturalImageStyle, { resizeMode: 'contain' }],
    width: undefined
  });
  const { width: _width, height: _height, ...containerStyle } = StyleSheet.flatten(imageState.containerStyle) || {};
  const sharedContainerStyle = [
    { flexDirection: 'row' as const, alignSelf: 'stretch' as const, justifyContent: alignment },
    containerStyle,
    boundarySpacing
  ];
  const imageStateFrameStyle = [
    {
      alignItems: 'center' as const,
      backgroundColor: frameBackgroundColor,
      borderColor: frameBorderColor,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center' as const,
      overflow: 'hidden' as const
    },
    imageState.dimensions
  ];
  const imageLoadingOverlayStyle = [StyleSheet.absoluteFillObject, imageStateFrameStyle];
  const imageDisplayed = Boolean(activeLoadedImage) && displayedImageLoadIdentity === imageLoadIdentity;
  const cachedOriginalArtifact =
    originalSource && originalDisplayRevision > 0 ? cachedCompatibleSvgArtifact(originalSource) : null;
  useEffect(() => {
    if (cachedOriginalArtifact) {
      promoteCachedCompatibleSvgArtifact(originalRequestIdentity);
    }
  }, [cachedOriginalArtifact, originalRequestIdentity]);
  const progressiveSource = cachedOriginalArtifact?.posterSource || originalSource;
  const progressiveIdentity = progressiveSource ? compatibleImageRequestIdentity(progressiveSource) : '';
  const originalAttemptIdentity = `${progressiveIdentity}\u0000revision:${originalDisplayRevision}`;
  const originalLeaseIdentity = `${progressiveIdentity}\u0000revision:${originalDisplayRevision}`;
  const progressiveIdentityRef = useRef(originalAttemptIdentity);
  const originalForced = Boolean(originalRequestIdentity) && forcedOriginalIdentity === originalRequestIdentity;
  const originalFailed =
    failedOriginal.identity === originalAttemptIdentity && failedOriginal.revision === originalDisplayRevision;
  const originalDisplayed = Boolean(progressiveIdentity) && displayedOriginalIdentity === progressiveIdentity;
  const shouldLoadOriginal = Boolean(
    progressiveSource &&
    !originalFailed &&
    (originalDisplayRevision > 0 || originalForced || (originalUpgradeEnabled && imageDisplayed))
  );
  useLayoutEffect(() => {
    progressiveIdentityRef.current = originalAttemptIdentity;
  }, [originalAttemptIdentity]);
  useEffect(() => {
    if (!imageDisplayed || !settleImageAttempt()) return;
    bodyMediaLease.settle('displayed');
  }, [bodyMediaLease, imageDisplayed, settleImageAttempt]);
  useEffect(() => {
    if (loadFailed) bodyMediaLease.settle('error');
  }, [bodyMediaLease, loadFailed]);
  return (
    <Pressable
      accessibilityLabel={imageState.alt || '查看图片'}
      accessibilityRole="button"
      style={sharedContainerStyle}
      onPress={(event) => {
        event.stopPropagation?.();
        if (originalRequestIdentity) {
          setForcedOriginalIdentity(originalRequestIdentity, true);
        }
        if (referrerPolicy) {
          onOpenImagePreview(
            src,
            activeLoadedImage?.dimensions || cachedDimensions,
            activeArtifact?.posterSource.uri,
            referrerPolicy
          );
        } else {
          onOpenImagePreview(src, activeLoadedImage?.dimensions || cachedDimensions, activeArtifact?.posterSource.uri);
        }
      }}
    >
      <View
        testID="topic-image-frame"
        style={[{ borderRadius: 10, overflow: 'hidden' as const }, imageState.dimensions]}
      >
        {!loadFailed ? (
          <ExpoImage
            allowDownscaling
            cachePolicy="disk"
            contentFit="contain"
            priority="normal"
            recyclingKey={imageVisualIdentity}
            source={attemptedImageSource}
            style={[imageState.dimensions, imageState.type === 'success' ? imageState.imageStyle : null]}
            onDisplay={handleImageDisplay}
            onError={handleImageError}
            onLoad={handleImageLoad}
            onProgress={handleImageProgress}
          />
        ) : null}
        {shouldLoadOriginal && progressiveSource ? (
          <ManagedOriginalImageLayer
            forced={originalForced}
            requestIdentity={originalLeaseIdentity}
            source={progressiveSource}
            onDisplay={() => {
              if (
                !mountedRef.current ||
                progressiveIdentityRef.current !== originalAttemptIdentity ||
                displayedOriginalIdentity === progressiveIdentity
              ) {
                return;
              }
              setDisplayedOriginalIdentity(progressiveIdentity, true);
              markOriginalImageDisplayed(originalSource);
            }}
            onRequestError={() => {
              if (
                !mountedRef.current ||
                progressiveIdentityRef.current !== originalAttemptIdentity ||
                displayedOriginalIdentity === progressiveIdentity
              ) {
                return false;
              }
              return true;
            }}
            onTerminalFailure={() => {
              if (
                !mountedRef.current ||
                progressiveIdentityRef.current !== originalAttemptIdentity ||
                displayedOriginalIdentity === progressiveIdentity
              ) {
                return;
              }
              setFailedOriginal({ identity: originalAttemptIdentity, revision: originalDisplayRevision }, true);
            }}
          />
        ) : null}
        {!imageDisplayed && !loadFailed && !originalDisplayed ? (
          <View style={imageLoadingOverlayStyle}>
            <ActivityIndicator color={loadingColor} size="small" />
          </View>
        ) : loadFailed && !originalDisplayed ? (
          <View style={imageLoadingOverlayStyle}>
            <Text numberOfLines={2} style={errorTextStyle}>
              {imageState.alt || '图片加载失败'}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function PreviewImageBlock(props: PreviewImageBlockProps) {
  const requestIdentity = compatibleImageRequestIdentity(props.imageSource);
  const bodyMediaLease = useTopicBodyMediaLease({ kind: 'base', requestIdentity });
  const contentWidth = Math.max(1, props.contentWidth);
  const cacheKey = imageDisplayCacheIdentity(props.imageSource);
  const cachedDimensions = cachedImageDisplayDimensions(cacheKey);
  const sourceDimensions = cachedDimensions || props.displaySize;
  const displayWidth = sourceDimensions ? Math.min(sourceDimensions.width, contentWidth) : contentWidth;
  const dimensions = sourceDimensions
    ? {
        height: Math.max(1, Math.round((sourceDimensions.height * displayWidth) / sourceDimensions.width)),
        width: displayWidth
      }
    : { height: Math.round(contentWidth * 0.75), width: contentWidth };
  if (bodyMediaLease.admitted) {
    return <AdmittedPreviewImageBlock {...props} bodyMediaLease={bodyMediaLease} />;
  }
  const frameStyle = [
    {
      alignItems: 'center' as const,
      alignSelf: props.alignment,
      backgroundColor: props.frameBackgroundColor,
      borderColor: props.frameBorderColor,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: 'center' as const,
      overflow: 'hidden' as const
    },
    dimensions,
    props.boundarySpacing
  ];
  if (bodyMediaLease.failure) {
    return (
      <Pressable
        accessibilityLabel="图片加载失败，点按重试"
        accessibilityRole="button"
        style={frameStyle}
        onPress={bodyMediaLease.retry}
      >
        <Text numberOfLines={2} style={props.errorTextStyle}>
          图片加载失败，点按重试
        </Text>
      </Pressable>
    );
  }
  return <View testID="topic-image-idle" style={frameStyle} />;
}

function ManagedSemanticInlineForumImage({
  accessibilityLabel,
  attributes,
  contentWidth,
  fallbackTextStyle,
  lineHeight,
  onPress,
  scale,
  source
}: {
  accessibilityLabel?: string;
  attributes: Record<string, string | undefined>;
  contentWidth: number;
  fallbackTextStyle: StyleProp<TextStyle>;
  lineHeight?: number;
  onPress?: () => void;
  scale: number;
  source: ImageURISource;
}) {
  const requestIdentity = compatibleImageRequestIdentity(source);
  const cacheKey = imageDisplayCacheIdentity(source);
  const lease = useTopicBodyMediaLease({ kind: 'inline', requestIdentity });
  const [naturalDimensions, setNaturalDimensions] = useRecyclingState<CachedImageDimensions | null>(
    cachedImageDisplayDimensions(cacheKey) || null,
    [requestIdentity]
  );
  const requestGeneration = `wz-inline-attempt-${stableImageRequestKey(lease.attemptId)}`;
  const nativeSource = useMemo(
    () => ({ ...source, uri: inlineFrescoSourceUri(source.uri, requestIdentity) }),
    [requestIdentity, source]
  );
  if (lease.failure) {
    return (
      <Text
        accessibilityLabel="图片加载失败，点按重试"
        accessibilityRole="button"
        style={fallbackTextStyle}
        onPress={(event) => {
          event.stopPropagation?.();
          lease.retry();
        }}
      >
        图片加载失败，点按重试
      </Text>
    );
  }
  const attachmentSize = inlineForumImageAttachmentSize(
    attributes,
    scale,
    contentWidth,
    naturalDimensions || undefined
  );
  const image = (
    <NativeImage
      {...{ internal_analyticTag: requestGeneration }}
      key={lease.attachmentKey}
      testID={lease.admitted ? 'topic-inline-image' : 'topic-inline-image-waiting'}
      resizeMode="contain"
      source={lease.admitted ? nativeSource : undefined}
      style={attachmentSize}
      onError={
        lease.admitted
          ? (event) => {
              if (!isInlineImageRequestEvent(event, requestGeneration)) return;
              lease.settle('error');
            }
          : undefined
      }
      onLoad={
        lease.admitted
          ? (event) => {
              if (!isInlineImageRequestEvent(event, requestGeneration)) return;
              if (!isInlineForumImage(attributes) || isBoundedInlineForumImage(attributes)) {
                const loadedSource = (event as { nativeEvent?: { source?: { height?: unknown; width?: unknown } } })
                  .nativeEvent?.source;
                const width = Number(loadedSource?.width);
                const height = Number(loadedSource?.height);
                if (width > 0 && height > 0) {
                  rememberImageDisplayDimensions(cacheKey, { height, width });
                  setNaturalDimensions({ height, width });
                }
              }
              lease.settle('displayed');
            }
          : undefined
      }
      onProgress={
        lease.admitted
          ? (event) => {
              if (!isInlineImageRequestEvent(event, requestGeneration)) return;
              lease.progress(event.nativeEvent.loaded);
            }
          : undefined
      }
    />
  );
  const attachmentStyle = [attachmentSize, inlineForumImageAlignmentStyle(attributes, scale, lineHeight)];
  return onPress ? (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={attachmentStyle}
      testID="topic-inline-image-attachment"
      onPress={(event) => {
        event.stopPropagation?.();
        onPress();
      }}
    >
      {image}
    </Pressable>
  ) : (
    <View style={attachmentStyle} testID="topic-inline-image-attachment">
      {image}
    </View>
  );
}

function ManagedMixedForumImage({
  accessibilityLabel,
  attributes,
  contentWidth: availableContentWidth,
  errorTextStyle,
  frameBackgroundColor,
  frameBorderColor,
  loadingColor,
  onOpenImagePreview,
  originalSource,
  referrerPolicy,
  scale,
  source,
  src
}: {
  accessibilityLabel: string;
  attributes: Record<string, string | undefined>;
  contentWidth: number;
  errorTextStyle: StyleProp<TextStyle>;
  frameBackgroundColor: string;
  frameBorderColor: string;
  loadingColor: string;
  onOpenImagePreview: (
    url: string,
    displaySize?: ImageDisplaySize,
    renderedPosterUri?: string,
    referrerPolicy?: MediaReferrerPolicy
  ) => void;
  originalSource: ImageURISource | null;
  referrerPolicy?: MediaReferrerPolicy;
  scale: number;
  source: ImageURISource;
  src: string;
}) {
  const requestIdentity = compatibleImageRequestIdentity(source);
  const cacheKey = imageDisplayCacheIdentity(source);
  const lease = useTopicBodyMediaLease({ kind: 'inline', requestIdentity });
  const attemptIdentity = `${requestIdentity}\u0000attempt:${lease.attemptId}`;
  const mountedRef = useRef(true);
  const [naturalDimensions, setNaturalDimensions] = useRecyclingState<CachedImageDimensions | null>(
    cachedImageDisplayDimensions(cacheKey) || null,
    [requestIdentity]
  );
  const [displayedImageIdentity, setDisplayedImageIdentity] = useRecyclingState('', [requestIdentity]);
  const [failedAttemptIdentity, setFailedAttemptIdentity] = useRecyclingState('', [requestIdentity]);
  const [forcedOriginalIdentity, setForcedOriginalIdentity] = useRecyclingState('', [requestIdentity]);
  const [displayedOriginalIdentity, setDisplayedOriginalIdentity] = useRecyclingState('', [requestIdentity]);
  const [failedOriginal, setFailedOriginal] = useRecyclingState({ identity: '', revision: -1 }, [requestIdentity]);
  const handleTerminalFailure = useCallback(
    () => setFailedAttemptIdentity(attemptIdentity, true),
    [attemptIdentity, setFailedAttemptIdentity]
  );
  const { activeArtifact, activeSource, handleError, isCurrent, isSettled, settle } = useCompatibleBodyImageArtifact({
    attemptIdentity,
    onTerminalFailure: handleTerminalFailure,
    source
  });
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const imageVisualIdentity = `${requestIdentity}:${activeArtifact ? `compatible:${activeArtifact.posterRevision}` : 'native'}`;
  const requestGeneration = `wz-inline-attempt-${stableImageRequestKey(`${lease.attemptId}:${imageVisualIdentity}`)}`;
  const nativeSource = useMemo(
    () => ({ ...activeSource, uri: inlineFrescoSourceUri(activeSource.uri, requestIdentity) }),
    [activeSource, requestIdentity]
  );
  const contentWidth = Math.max(1, availableContentWidth);
  const dimensions = inlineForumImageAttachmentSize(attributes, scale, contentWidth, naturalDimensions || undefined);
  const imageDisplayed = displayedImageIdentity === imageVisualIdentity;
  const loadFailed = failedAttemptIdentity === attemptIdentity || Boolean(lease.failure);
  useEffect(() => {
    if (failedAttemptIdentity === attemptIdentity) lease.settle('error');
  }, [attemptIdentity, failedAttemptIdentity, lease]);
  const originalRequestIdentity = originalImageDisplayIdentity(originalSource);
  const originalDisplayRevision = useOriginalImageDisplayRevision(originalSource);
  const originalUpgradeEnabled = useOriginalImageUpgradeEnabled();
  const cachedOriginalArtifact =
    originalSource && originalDisplayRevision > 0 ? cachedCompatibleSvgArtifact(originalSource) : null;
  useEffect(() => {
    if (cachedOriginalArtifact) promoteCachedCompatibleSvgArtifact(originalRequestIdentity);
  }, [cachedOriginalArtifact, originalRequestIdentity]);
  const progressiveSource = cachedOriginalArtifact?.posterSource || originalSource;
  const progressiveIdentity = progressiveSource ? compatibleImageRequestIdentity(progressiveSource) : '';
  const originalAttemptIdentity = `${progressiveIdentity}\u0000revision:${originalDisplayRevision}`;
  const progressiveIdentityRef = useRef(originalAttemptIdentity);
  const originalForced = Boolean(originalRequestIdentity) && forcedOriginalIdentity === originalRequestIdentity;
  const originalFailed =
    failedOriginal.identity === originalAttemptIdentity && failedOriginal.revision === originalDisplayRevision;
  const originalDisplayed = Boolean(progressiveIdentity) && displayedOriginalIdentity === progressiveIdentity;
  const shouldLoadOriginal = Boolean(
    progressiveSource &&
    !originalFailed &&
    (originalDisplayRevision > 0 || originalForced || (originalUpgradeEnabled && imageDisplayed))
  );
  useLayoutEffect(() => {
    progressiveIdentityRef.current = originalAttemptIdentity;
  }, [originalAttemptIdentity]);
  const frameStyle = [
    {
      backgroundColor: frameBackgroundColor,
      borderColor: frameBorderColor,
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: 'hidden' as const,
      position: 'relative' as const
    },
    dimensions
  ];
  if (loadFailed) {
    return (
      <Pressable
        accessibilityLabel="图片加载失败，点按重试"
        accessibilityRole="button"
        style={frameStyle}
        testID="topic-inline-image-attachment"
        onPress={(event) => {
          event.stopPropagation?.();
          lease.retry();
        }}
      >
        <View style={[StyleSheet.absoluteFillObject, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text numberOfLines={2} style={errorTextStyle}>
            图片加载失败，点按重试
          </Text>
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={frameStyle}
      testID="topic-inline-image-attachment"
      onPress={(event) => {
        event.stopPropagation?.();
        if (originalRequestIdentity) setForcedOriginalIdentity(originalRequestIdentity, true);
        const displaySize = naturalDimensions || cachedImageDisplayDimensions(cacheKey) || undefined;
        if (referrerPolicy) {
          onOpenImagePreview(src, displaySize, activeArtifact?.posterSource.uri, referrerPolicy);
        } else {
          onOpenImagePreview(src, displaySize, activeArtifact?.posterSource.uri);
        }
      }}
    >
      <NativeImage
        {...{ internal_analyticTag: requestGeneration }}
        key={`${lease.attachmentKey}:${activeArtifact?.posterRevision || 'native'}`}
        testID={lease.admitted ? 'topic-inline-image' : 'topic-inline-image-waiting'}
        resizeMode="contain"
        source={lease.admitted ? nativeSource : undefined}
        style={dimensions}
        onError={
          lease.admitted
            ? (event) => {
                if (!isInlineImageRequestEvent(event, requestGeneration)) return;
                handleError();
              }
            : undefined
        }
        onLoad={
          lease.admitted
            ? (event) => {
                if (!isInlineImageRequestEvent(event, requestGeneration) || !isCurrent() || isSettled()) return;
                const loadedSource = (event as { nativeEvent?: { source?: { height?: unknown; width?: unknown } } })
                  .nativeEvent?.source;
                const width = Number(loadedSource?.width);
                const height = Number(loadedSource?.height);
                if (width > 0 && height > 0) {
                  rememberImageDisplayDimensions(cacheKey, { height, width });
                  setNaturalDimensions({ height, width });
                }
                setDisplayedImageIdentity(imageVisualIdentity, true);
                if (settle()) lease.settle('displayed');
              }
            : undefined
        }
        onProgress={
          lease.admitted
            ? (event) => {
                if (!isInlineImageRequestEvent(event, requestGeneration) || !isCurrent() || isSettled()) return;
                lease.progress(event.nativeEvent.loaded);
              }
            : undefined
        }
      />
      {shouldLoadOriginal && progressiveSource ? (
        <ManagedOriginalImageLayer
          forced={originalForced}
          requestIdentity={originalAttemptIdentity}
          source={progressiveSource}
          onDisplay={() => {
            if (
              !mountedRef.current ||
              progressiveIdentityRef.current !== originalAttemptIdentity ||
              displayedOriginalIdentity === progressiveIdentity
            ) {
              return;
            }
            setDisplayedOriginalIdentity(progressiveIdentity, true);
            markOriginalImageDisplayed(originalSource);
          }}
          onRequestError={() =>
            mountedRef.current &&
            progressiveIdentityRef.current === originalAttemptIdentity &&
            displayedOriginalIdentity !== progressiveIdentity
          }
          onTerminalFailure={() => {
            if (
              !mountedRef.current ||
              progressiveIdentityRef.current !== originalAttemptIdentity ||
              displayedOriginalIdentity === progressiveIdentity
            ) {
              return;
            }
            setFailedOriginal({ identity: originalAttemptIdentity, revision: originalDisplayRevision }, true);
          }}
        />
      ) : null}
      {lease.admitted && !imageDisplayed && !originalDisplayed ? (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { alignItems: 'center', backgroundColor: frameBackgroundColor, justifyContent: 'center' }
          ]}
        >
          <ActivityIndicator color={loadingColor} size="small" />
        </View>
      ) : null}
    </Pressable>
  );
}

function isInlineImageRequestEvent(event: unknown, requestGeneration: string) {
  return (
    (event as { nativeEvent?: { requestGeneration?: unknown } } | null)?.nativeEvent?.requestGeneration ===
    requestGeneration
  );
}

function inlineFrescoSourceUri(uri: string | undefined, requestIdentity: string) {
  if (!uri || !/^https?:\/\//i.test(uri)) return uri;
  return `${uri.split('#', 1)[0]}#wz-inline-${stableImageRequestKey(requestIdentity)}`;
}

export function createPreviewRenderers({
  htmlBaseStyle,
  htmlRendererStyles,
  mediaContext,
  nodeSeekMediaUserAgent,
  onOpenImagePreview,
  settings,
  theme
}: {
  htmlBaseStyle: { lineHeight?: number };
  htmlRendererStyles: ReturnType<typeof createHtmlRendererStyles>;
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  onOpenImagePreview: (
    url: string,
    displaySize?: ImageDisplaySize,
    renderedPosterUri?: string,
    referrerPolicy?: MediaReferrerPolicy
  ) => void;
  settings: Pick<ReaderSettings, 'fontScale'>;
  theme: ReaderTheme;
}): HtmlRenderers {
  const PreviewImageRenderer: CustomBlockRenderer = (props) => {
    const continuationSpacing = useContentBoundarySpacing(props.tnode);
    const contentWidth = useForumContentWidth();
    const imageProps = useIMGElementProps(props);
    const attributes = props.tnode.attributes;
    const boundarySpacing =
      attributes[FORUM_FLOW_IMAGE_CONTEXT_ATTRIBUTE] === 'standalone' ? STANDALONE_IMAGE_SPACING : continuationSpacing;
    const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
    const inlineSrc = attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
    if (isInlineForumImage(attributes)) {
      if (!inlineSrc) {
        return (
          <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || '图片'}</Text>
        );
      }
      return (
        <ManagedSemanticInlineForumImage
          attributes={attributes}
          contentWidth={contentWidth}
          fallbackTextStyle={htmlRendererStyles.inlineForumImageText}
          lineHeight={htmlBaseStyle.lineHeight}
          scale={settings.fontScale}
          source={
            imageSourceFromUrl(inlineSrc, {
              mediaContext,
              nodeSeekUserAgent: nodeSeekMediaUserAgent,
              referrerPolicy
            }) as ImageURISource
          }
        />
      );
    }
    const displaySource = selectImageDisplaySource(attributes, contentWidth, PixelRatio.get());
    if (!displaySource) {
      return (
        <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || '图片'}</Text>
      );
    }
    const src = displaySource.uri;
    const originalUri = selectImageOriginalSource(attributes) || src;
    const imageSource = imageSourceFromUrl(src, {
      baseSource: imageProps.source,
      mediaContext,
      nodeSeekUserAgent: nodeSeekMediaUserAgent,
      referrerPolicy
    });
    return (
      <PreviewImageBlock
        key={compatibleImageRequestIdentity(imageSource as ImageURISource)}
        alignment={forumImageRowAlignment(props.tnode)}
        attributes={attributes}
        boundarySpacing={boundarySpacing}
        contentWidth={contentWidth}
        displaySize={displaySource.displaySize}
        errorTextStyle={htmlRendererStyles.inlineForumImageText}
        frameBackgroundColor={theme.surface2}
        frameBorderColor={theme.line}
        imageProps={imageProps}
        imageSource={imageSource as ImageURISource}
        loadingColor={theme.primary}
        mediaContext={mediaContext}
        nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
        onOpenImagePreview={onOpenImagePreview}
        originalUri={originalUri}
        src={src}
      />
    );
  };

  const InlineForumImageRenderer: CustomTextualRenderer = (props) => {
    const contentWidth = useForumContentWidth();
    const attributes = (props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {};
    const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
    const src = attributes.src || '';
    const label = attributes.alt || attributes.title || '';
    if (!src) {
      return <Text style={htmlRendererStyles.inlineForumImageText}>{label || '图片'}</Text>;
    }
    const semanticInlineImage = isInlineForumImage(attributes);
    const displaySource = semanticInlineImage
      ? { uri: src }
      : selectImageDisplaySource(attributes, contentWidth, PixelRatio.get());
    if (!displaySource) {
      return <Text style={htmlRendererStyles.inlineForumImageText}>{label || '图片'}</Text>;
    }
    const displayUri = displaySource.uri;
    const imageSource = imageSourceFromUrl(displayUri, {
      mediaContext,
      nodeSeekUserAgent: nodeSeekMediaUserAgent,
      referrerPolicy
    }) as ImageURISource;
    if (semanticInlineImage) {
      return (
        <ManagedSemanticInlineForumImage
          attributes={attributes}
          contentWidth={contentWidth}
          fallbackTextStyle={htmlRendererStyles.inlineForumImageText}
          lineHeight={htmlBaseStyle.lineHeight}
          scale={settings.fontScale}
          source={imageSource}
        />
      );
    }
    const originalUri = selectImageOriginalSource(attributes) || displayUri;
    const originalSource =
      normalizeImagePreviewUrl(originalUri) !== normalizeImagePreviewUrl(displayUri)
        ? (imageSourceFromUrl(originalUri, {
            baseSource: imageSource,
            mediaContext,
            nodeSeekUserAgent: nodeSeekMediaUserAgent,
            referrerPolicy
          }) as ImageURISource)
        : null;
    return (
      <ManagedMixedForumImage
        accessibilityLabel={label || '查看图片'}
        attributes={attributes}
        contentWidth={contentWidth}
        errorTextStyle={htmlRendererStyles.inlineForumImageText}
        frameBackgroundColor={theme.surface2}
        frameBorderColor={theme.line}
        loadingColor={theme.primary}
        onOpenImagePreview={onOpenImagePreview}
        originalSource={originalSource}
        referrerPolicy={referrerPolicy}
        scale={settings.fontScale}
        source={imageSource}
        src={displayUri}
      />
    );
  };
  return {
    img: PreviewImageRenderer,
    [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer
  };
}

function forumImageRowAlignment(tnode: unknown): 'center' | 'flex-end' | 'flex-start' {
  const textAlign = (tnode as { styles?: { nativeBlockFlow?: { textAlign?: unknown } } } | null)?.styles
    ?.nativeBlockFlow?.textAlign;
  if (textAlign === 'center') return 'center';
  if (textAlign === 'right' || textAlign === 'end') return 'flex-end';
  return 'flex-start';
}
