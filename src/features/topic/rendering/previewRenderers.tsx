import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageURISource,
  type StyleProp,
  type TextStyle
} from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData, type ImageProgressEventData } from 'expo-image';
import {
  useContentWidth,
  useIMGElementProps,
  useIMGElementStateWithCache,
  type CustomBlockRenderer,
  type CustomMixedRenderer,
  type IMGElementProps
} from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { imageSourceFromUrl, normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import {
  isInlineForumImage,
  selectImageDisplaySource,
  selectImageOriginalSource,
  type ImageDisplayCandidateKind,
  type ImageDisplaySize
} from '@/platform/media/imagePreviewCatalog';
import {
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize,
  INLINE_FORUM_IMAGE_TAG,
  shouldMarkLoadedImageInline
} from '@/platform/media/inlineMedia';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { HtmlRenderers } from './types';
import { createHtmlRendererStyles, trimsTrailingBlockSpacing } from './htmlStyles';
import {
  cachedCompatibleSvgArtifact,
  compatibleImageRequestIdentity,
  promoteCachedCompatibleSvgArtifact,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster,
  type CompatibleSvgArtifact
} from '@/platform/media/compatibleImageSources';
import { forumMediaTargetClass, type ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticFields, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
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

type BodyImageLoadMetrics = {
  cacheType?: ImageLoadEventData['cacheType'];
  firstProgressAt?: number;
  loadedAt?: number;
  loadedBytes?: number;
  requestIdentity: string;
  sourceHeight?: number;
  sourceWidth?: number;
  startedAt: number;
  totalBytes?: number;
};

function bodyImageMetricFields(
  metrics: BodyImageLoadMetrics,
  finishedAt = Date.now(),
  includeDisplayTime = false
): DiagnosticFields {
  return {
    ...(metrics.cacheType ? { cacheType: metrics.cacheType } : {}),
    ...(metrics.firstProgressAt === undefined
      ? {}
      : { firstProgressMs: Math.max(0, metrics.firstProgressAt - metrics.startedAt) }),
    ...(metrics.loadedAt === undefined ? {} : { loadMs: Math.max(0, metrics.loadedAt - metrics.startedAt) }),
    ...(metrics.loadedBytes === undefined ? {} : { loadedBytes: metrics.loadedBytes }),
    ...(metrics.sourceHeight === undefined ? {} : { sourceHeight: metrics.sourceHeight }),
    ...(metrics.sourceWidth === undefined ? {} : { sourceWidth: metrics.sourceWidth }),
    ...(metrics.totalBytes === undefined ? {} : { totalBytes: metrics.totalBytes }),
    ...(includeDisplayTime ? { displayMs: Math.max(0, finishedAt - metrics.startedAt) } : {})
  };
}

function PreviewImageBlock({
  attributes,
  candidateKind,
  errorTextStyle,
  frameBackgroundColor,
  frameBorderColor,
  imageProps,
  imageSource,
  loadingColor,
  markInlineSizedImageUrl,
  mediaContext,
  mediaSessionIdentity,
  nodeSeekMediaUserAgent,
  onOpenImagePreview,
  originalUri,
  src,
  trimTrailingBlockSpacing
}: {
  attributes: Record<string, string | undefined>;
  candidateKind: ImageDisplayCandidateKind;
  errorTextStyle: StyleProp<TextStyle>;
  frameBackgroundColor: string;
  frameBorderColor: string;
  imageProps: IMGElementProps;
  imageSource: ImageURISource;
  loadingColor: string;
  markInlineSizedImageUrl: (url: string) => void;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  nodeSeekMediaUserAgent?: string;
  onOpenImagePreview: (url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string) => void;
  originalUri: string;
  src: string;
  trimTrailingBlockSpacing: boolean;
}) {
  const requestIdentity = compatibleImageRequestIdentity(imageSource);
  const originalSource = useMemo(() => {
    const cleanOriginalUri = normalizeImagePreviewUrl(originalUri);
    return cleanOriginalUri && cleanOriginalUri !== normalizeImagePreviewUrl(src)
      ? (imageSourceFromUrl(cleanOriginalUri, {
          baseSource: imageProps.source,
          mediaContext,
          nodeSeekUserAgent: nodeSeekMediaUserAgent
        }) as ImageURISource)
      : null;
  }, [imageProps.source, mediaContext, nodeSeekMediaUserAgent, originalUri, src]);
  const originalRequestIdentity = originalImageDisplayIdentity(originalSource);
  const originalDisplayRevision = useOriginalImageDisplayRevision(originalSource);
  const originalUpgradeEnabled = useOriginalImageUpgradeEnabled();
  const mountedRef = useRef(true);
  const requestIdentityRef = useRef(requestIdentity);
  const bodyStartedAtRef = useRef(0);
  const settledRequestIdentityRef = useRef('');
  const posterRefreshIdentityRef = useRef('');
  const bodyMetricsRef = useRef<BodyImageLoadMetrics>({
    requestIdentity,
    startedAt: Date.now()
  });
  const bodyDiagnosticRef = useRef<{ fallback: boolean; requestIdentity: string; trace: DiagnosticTrace } | null>(null);
  const currentBodyTrace = useCallback(
    (fallback = false) => {
      if (!mountedRef.current) {
        return null;
      }
      const previous = bodyDiagnosticRef.current;
      if (previous?.requestIdentity !== requestIdentity) {
        if (previous) {
          finishDiagnosticTrace(previous.trace, 'stale', { fallback: 'none', terminalReason: 'stale' });
        }
        bodyDiagnosticRef.current = {
          fallback,
          requestIdentity,
          trace: beginDiagnosticTrace(
            'media',
            'load',
            {
              candidateKind,
              mediaClass: forumMediaTargetClass(src, mediaContext.contentSource),
              mediaRef: diagnosticRef('media', src),
              mediaRole: 'body',
              source: mediaContext.contentSource || 'unknown',
              surface: 'body'
            },
            bodyStartedAtRef.current || Date.now()
          )
        };
      } else if (fallback && previous) {
        previous.fallback = true;
      }
      return bodyDiagnosticRef.current;
    },
    [candidateKind, mediaContext.contentSource, requestIdentity, src]
  );
  const finishBodyFailure = useCallback(
    (fallback: boolean) => {
      const diagnostic = currentBodyTrace(fallback);
      if (diagnostic) {
        finishDiagnosticTrace(diagnostic.trace, 'failure', {
          ...bodyImageMetricFields(bodyMetricsRef.current),
          fallback: fallback ? 'svg' : 'none',
          terminalReason: fallback ? 'fallback-error' : 'native-error'
        });
        bodyDiagnosticRef.current = null;
      }
    },
    [currentBodyTrace]
  );
  const [loadedImage, setLoadedImage] = useState<{
    cacheType: ImageLoadEventData['cacheType'];
    dimensions: CachedImageDimensions;
    imageLoadIdentity: string;
    requestIdentity: string;
  } | null>(null);
  const [displayedImageLoadIdentity, setDisplayedImageLoadIdentity] = useState('');
  const [compatibleSvgArtifact, setCompatibleSvgArtifact] = useState<CompatibleSvgArtifact | null>(null);
  const [failedRequestIdentity, setFailedRequestIdentity] = useState('');
  const [forcedOriginalIdentity, setForcedOriginalIdentity] = useState('');
  const [displayedOriginalIdentity, setDisplayedOriginalIdentity] = useState('');
  const [failedOriginal, setFailedOriginal] = useState({ identity: '', revision: -1 });
  const contentWidth = Math.max(1, imageProps.contentWidth || 1);
  const cachedArtifact = cachedCompatibleSvgArtifact(imageSource);
  useEffect(() => {
    if (cachedArtifact) {
      promoteCachedCompatibleSvgArtifact(requestIdentity);
    }
  }, [cachedArtifact, requestIdentity]);
  const activeArtifact =
    compatibleSvgArtifact?.requestIdentity === requestIdentity ? compatibleSvgArtifact : cachedArtifact;
  const activeFallbackSource = activeArtifact?.posterSource || null;
  const activeImageSource = activeFallbackSource || imageSource;
  const imageLoadIdentity = `${requestIdentity}:${activeArtifact ? `compatible:${activeArtifact.posterRevision}` : 'native'}`;
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const startedAt = Date.now();
    requestIdentityRef.current = requestIdentity;
    bodyStartedAtRef.current = startedAt;
    bodyMetricsRef.current = { requestIdentity, startedAt };
  }, [requestIdentity]);
  const recoverSvgArtifact = useCallback(async () => {
    try {
      const artifact = await recoverCompatibleSvgArtifact(imageSource);
      if (
        !mountedRef.current ||
        requestIdentityRef.current !== requestIdentity ||
        settledRequestIdentityRef.current === requestIdentity
      ) {
        return;
      }
      if (artifact) {
        setCompatibleSvgArtifact(artifact);
        return;
      }
      settledRequestIdentityRef.current = requestIdentity;
      finishBodyFailure(false);
      setFailedRequestIdentity(requestIdentity);
    } catch {
      if (
        mountedRef.current &&
        requestIdentityRef.current === requestIdentity &&
        settledRequestIdentityRef.current !== requestIdentity
      ) {
        settledRequestIdentityRef.current = requestIdentity;
        finishBodyFailure(true);
        setFailedRequestIdentity(requestIdentity);
      }
    }
  }, [finishBodyFailure, imageSource, requestIdentity]);
  const refreshSvgPoster = useCallback(
    async (artifact: CompatibleSvgArtifact) => {
      try {
        const refreshed = await refreshCompatibleSvgPoster(artifact);
        if (
          !mountedRef.current ||
          requestIdentityRef.current !== requestIdentity ||
          settledRequestIdentityRef.current === requestIdentity
        ) {
          return;
        }
        setCompatibleSvgArtifact(refreshed);
      } catch {
        if (
          mountedRef.current &&
          requestIdentityRef.current === requestIdentity &&
          settledRequestIdentityRef.current !== requestIdentity
        ) {
          settledRequestIdentityRef.current = requestIdentity;
          finishBodyFailure(true);
          setFailedRequestIdentity(requestIdentity);
        }
      }
    },
    [finishBodyFailure, requestIdentity]
  );
  const handleImageError = useCallback(() => {
    if (
      !mountedRef.current ||
      requestIdentityRef.current !== requestIdentity ||
      settledRequestIdentityRef.current === requestIdentity
    ) {
      return;
    }
    if (activeArtifact) {
      if (posterRefreshIdentityRef.current === requestIdentity) {
        settledRequestIdentityRef.current = requestIdentity;
        finishBodyFailure(true);
        setFailedRequestIdentity(requestIdentity);
        return;
      }
      posterRefreshIdentityRef.current = requestIdentity;
      currentBodyTrace(true);
      void refreshSvgPoster(activeArtifact);
      return;
    }
    currentBodyTrace(true);
    void recoverSvgArtifact();
  }, [activeArtifact, currentBodyTrace, finishBodyFailure, recoverSvgArtifact, refreshSvgPoster, requestIdentity]);
  const handleImageLoadStart = useCallback(() => {
    if (
      mountedRef.current &&
      requestIdentityRef.current === requestIdentity &&
      settledRequestIdentityRef.current !== requestIdentity
    ) {
      if (bodyMetricsRef.current.requestIdentity !== requestIdentity) {
        const startedAt = Date.now();
        bodyStartedAtRef.current = startedAt;
        bodyMetricsRef.current = { requestIdentity, startedAt };
      }
      currentBodyTrace(Boolean(activeFallbackSource));
    }
  }, [activeFallbackSource, currentBodyTrace, requestIdentity]);
  const handleImageLoad = useCallback(
    (event: ImageLoadEventData) => {
      if (
        !mountedRef.current ||
        requestIdentityRef.current !== requestIdentity ||
        settledRequestIdentityRef.current === requestIdentity
      ) {
        return;
      }
      const width = Number(event.source.width);
      const height = Number(event.source.height);
      if (!(width > 0 && height > 0)) {
        return;
      }
      bodyMetricsRef.current = {
        ...bodyMetricsRef.current,
        cacheType: event.cacheType,
        loadedAt: Date.now(),
        sourceHeight: height,
        sourceWidth: width
      };
      setLoadedImage({
        cacheType: event.cacheType,
        dimensions: { height, width },
        imageLoadIdentity,
        requestIdentity
      });
    },
    [imageLoadIdentity, requestIdentity]
  );
  const handleImageDisplay = useCallback(() => {
    if (
      !mountedRef.current ||
      requestIdentityRef.current !== requestIdentity ||
      settledRequestIdentityRef.current === requestIdentity
    ) {
      return;
    }
    setDisplayedImageLoadIdentity(imageLoadIdentity);
  }, [imageLoadIdentity, requestIdentity]);
  const handleImageProgress = useCallback(
    (event: ImageProgressEventData) => {
      if (
        !mountedRef.current ||
        requestIdentityRef.current !== requestIdentity ||
        settledRequestIdentityRef.current === requestIdentity
      ) {
        return;
      }
      const loadedBytes = Number(event.loaded);
      const totalBytes = Number(event.total);
      bodyMetricsRef.current = {
        ...bodyMetricsRef.current,
        ...(bodyMetricsRef.current.firstProgressAt === undefined ? { firstProgressAt: Date.now() } : {}),
        ...(Number.isFinite(loadedBytes) && loadedBytes >= 0 ? { loadedBytes } : {}),
        ...(Number.isFinite(totalBytes) && totalBytes >= 0 ? { totalBytes } : {})
      };
    },
    [requestIdentity]
  );
  const loadFailed = failedRequestIdentity === requestIdentity;
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (requestIdentityRef.current === requestIdentity && settledRequestIdentityRef.current !== requestIdentity) {
        currentBodyTrace();
      }
    }, 10_000);
    return () => {
      clearTimeout(timeout);
      const active = bodyDiagnosticRef.current;
      if (active?.requestIdentity === requestIdentity) {
        finishDiagnosticTrace(active.trace, 'stale', {
          ...bodyImageMetricFields(bodyMetricsRef.current),
          fallback: active.fallback ? 'svg' : 'none',
          terminalReason: 'stale'
        });
        bodyDiagnosticRef.current = null;
      }
    };
  }, [currentBodyTrace, requestIdentity]);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (requestIdentityRef.current !== requestIdentity || settledRequestIdentityRef.current === requestIdentity) {
        return;
      }
      settledRequestIdentityRef.current = requestIdentity;
      const diagnostic = currentBodyTrace();
      if (diagnostic) {
        finishDiagnosticTrace(diagnostic.trace, 'failure', {
          ...bodyImageMetricFields(bodyMetricsRef.current),
          fallback: diagnostic.fallback ? 'svg' : 'none',
          terminalReason: 'timeout'
        });
        bodyDiagnosticRef.current = null;
      }
      setFailedRequestIdentity(requestIdentity);
    }, 30_000);
    return () => clearTimeout(timeout);
  }, [currentBodyTrace, requestIdentity]);
  const cacheKey = `${mediaSessionIdentity}:${normalizeImagePreviewUrl(src).trim()}`;
  const cachedDimensions = cachedImageDisplayDimensions(cacheKey);
  useEffect(() => {
    if (cachedDimensions) {
      rememberImageDisplayDimensions(cacheKey, cachedDimensions);
    }
  }, [cacheKey, cachedDimensions]);
  const activeLoadedImage =
    loadedImage?.requestIdentity === requestIdentity && loadedImage.imageLoadIdentity === imageLoadIdentity
      ? loadedImage
      : null;
  const naturalDimensions = activeLoadedImage
    ? activeLoadedImage.dimensions
    : cachedDimensions || { height: Math.round(contentWidth * 0.75), width: contentWidth };
  const {
    height: _specifiedStyleHeight,
    width: _specifiedStyleWidth,
    ...naturalImageStyle
  } = StyleSheet.flatten(imageProps.style) || {};
  const imageState = useIMGElementStateWithCache({
    ...imageProps,
    cachedNaturalDimensions: naturalDimensions,
    height: undefined,
    source: imageSource,
    style: [naturalImageStyle, { resizeMode: 'contain' }],
    width: undefined
  });
  useEffect(() => {
    if (!activeLoadedImage || !cacheKey) {
      return;
    }
    const dimensions = activeLoadedImage.dimensions;
    rememberImageDisplayDimensions(cacheKey, dimensions);
    if (shouldMarkLoadedImageInline(attributes, dimensions.width, dimensions.height)) {
      markInlineSizedImageUrl(src);
    }
  }, [activeLoadedImage, attributes, cacheKey, markInlineSizedImageUrl, src]);
  const { width: _width, height: _height, ...containerStyle } = StyleSheet.flatten(imageState.containerStyle) || {};
  const sharedContainerStyle = [
    { flexDirection: 'row' as const, alignSelf: 'stretch' as const, justifyContent: 'center' as const },
    containerStyle,
    trimTrailingBlockSpacing ? { marginBottom: -4 } : null
  ];
  const imageStateFrameStyle = [
    {
      alignItems: 'center' as const,
      backgroundColor: frameBackgroundColor,
      borderColor: frameBorderColor,
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
  const progressiveIdentityRef = useRef(progressiveIdentity);
  const originalForced = Boolean(originalRequestIdentity) && forcedOriginalIdentity === originalRequestIdentity;
  const originalFailed =
    failedOriginal.identity === progressiveIdentity && failedOriginal.revision === originalDisplayRevision;
  const originalDisplayed = Boolean(progressiveIdentity) && displayedOriginalIdentity === progressiveIdentity;
  const shouldLoadOriginal = Boolean(
    progressiveSource &&
    !originalFailed &&
    (originalDisplayRevision > 0 || originalForced || (originalUpgradeEnabled && imageDisplayed))
  );
  useLayoutEffect(() => {
    progressiveIdentityRef.current = progressiveIdentity;
  }, [progressiveIdentity]);
  useEffect(() => {
    if (!imageDisplayed || settledRequestIdentityRef.current === requestIdentity) {
      return;
    }
    settledRequestIdentityRef.current = requestIdentity;
    const diagnostic = bodyDiagnosticRef.current;
    if (diagnostic?.requestIdentity === requestIdentity) {
      const displayedAt = Date.now();
      finishDiagnosticTrace(
        diagnostic.trace,
        'success',
        {
          ...bodyImageMetricFields(bodyMetricsRef.current, displayedAt, true),
          fallback: activeFallbackSource ? 'svg' : 'none',
          terminalReason: activeFallbackSource ? 'fallback-loaded' : 'loaded'
        },
        displayedAt
      );
      bodyDiagnosticRef.current = null;
    }
  }, [activeFallbackSource, imageDisplayed, requestIdentity]);
  return (
    <Pressable
      accessibilityLabel={imageState.alt || '查看图片'}
      accessibilityRole="button"
      style={sharedContainerStyle}
      onPress={(event) => {
        event.stopPropagation?.();
        if (originalRequestIdentity) {
          setForcedOriginalIdentity(originalRequestIdentity);
        }
        onOpenImagePreview(src, activeLoadedImage?.dimensions || cachedDimensions, activeArtifact?.posterSource.uri);
      }}
    >
      <View testID="topic-image-frame" style={[{ overflow: 'hidden' as const }, imageState.dimensions]}>
        {!loadFailed && !originalDisplayed ? (
          <ExpoImage
            cachePolicy="memory-disk"
            contentFit="contain"
            priority="normal"
            recyclingKey={imageLoadIdentity}
            source={activeImageSource}
            style={[imageState.dimensions, imageState.type === 'success' ? imageState.imageStyle : null]}
            onDisplay={handleImageDisplay}
            onError={handleImageError}
            onLoad={handleImageLoad}
            onLoadStart={handleImageLoadStart}
            onProgress={handleImageProgress}
          />
        ) : null}
        {shouldLoadOriginal ? (
          <ExpoImage
            testID="topic-image-original"
            cachePolicy="memory-disk"
            contentFit="contain"
            placeholder={activeImageSource}
            placeholderContentFit="contain"
            priority={originalForced ? 'high' : 'low'}
            recyclingKey={`${progressiveIdentity}:body-original`}
            source={progressiveSource}
            style={StyleSheet.absoluteFillObject}
            transition={150}
            onDisplay={() => {
              if (
                !mountedRef.current ||
                progressiveIdentityRef.current !== progressiveIdentity ||
                displayedOriginalIdentity === progressiveIdentity
              ) {
                return;
              }
              setDisplayedOriginalIdentity(progressiveIdentity);
              markOriginalImageDisplayed(originalSource);
            }}
            onError={() => {
              if (
                !mountedRef.current ||
                progressiveIdentityRef.current !== progressiveIdentity ||
                displayedOriginalIdentity === progressiveIdentity
              ) {
                return;
              }
              setFailedOriginal({ identity: progressiveIdentity, revision: originalDisplayRevision });
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

export function createPreviewRenderers({
  htmlBaseStyle,
  htmlRendererStyles,
  markInlineSizedImageUrl,
  mediaContext,
  mediaSessionIdentity,
  nodeSeekMediaUserAgent,
  onOpenImagePreview,
  settings,
  theme
}: {
  htmlBaseStyle: { lineHeight?: number };
  htmlRendererStyles: ReturnType<typeof createHtmlRendererStyles>;
  markInlineSizedImageUrl: (url: string) => void;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  nodeSeekMediaUserAgent?: string;
  onOpenImagePreview: (url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string) => void;
  settings: Pick<ReaderSettings, 'fontScale'>;
  theme: ReaderTheme;
}): HtmlRenderers {
  const PreviewImageRenderer: CustomBlockRenderer = (props) => {
    const contentWidth = useContentWidth();
    const imageProps = useIMGElementProps(props);
    const attributes = props.tnode.attributes;
    const inlineSrc = attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
    if (isInlineForumImage(attributes)) {
      if (!inlineSrc) {
        return <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
      }
      return (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${inlineSrc}`}
          source={imageSourceFromUrl(inlineSrc, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
          style={[
            htmlRendererStyles.inlineForumImage,
            inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth),
            inlineForumImageAlignmentStyle(attributes, settings.fontScale, htmlBaseStyle.lineHeight)
          ]}
        />
      );
    }
    const displaySource = selectImageDisplaySource(attributes, contentWidth, PixelRatio.get());
    if (!displaySource) {
      return <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
    }
    const src = displaySource.uri;
    const originalUri = selectImageOriginalSource(attributes) || src;
    const imageSource = imageSourceFromUrl(src, {
      baseSource: imageProps.source,
      mediaContext,
      nodeSeekUserAgent: nodeSeekMediaUserAgent
    });
    return (
      <PreviewImageBlock
        key={`${mediaSessionIdentity}:${src}`}
        attributes={attributes}
        candidateKind={displaySource.candidateKind}
        errorTextStyle={htmlRendererStyles.inlineForumImageText}
        frameBackgroundColor={theme.surface2}
        frameBorderColor={theme.line}
        imageProps={imageProps}
        imageSource={imageSource as ImageURISource}
        loadingColor={theme.primary}
        markInlineSizedImageUrl={markInlineSizedImageUrl}
        mediaContext={mediaContext}
        mediaSessionIdentity={mediaSessionIdentity}
        nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
        onOpenImagePreview={onOpenImagePreview}
        originalUri={originalUri}
        src={src}
        trimTrailingBlockSpacing={trimsTrailingBlockSpacing(props.tnode)}
      />
    );
  };

  const InlineForumImageRenderer: CustomMixedRenderer = (props) => {
    const contentWidth = useContentWidth();
    const attributes = (props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {};
    const src = attributes.src || '';
    const label = attributes.alt || attributes.title || '';
    if (!src) {
      return <Text style={htmlRendererStyles.inlineForumImageText}>{label}</Text>;
    }
    const isInlineImage = isInlineForumImage(attributes);
    if (isInlineImage) {
      return (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${src}`}
          source={imageSourceFromUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
          style={[
            htmlRendererStyles.inlineForumImage,
            inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth),
            inlineForumImageAlignmentStyle(attributes, settings.fontScale, htmlBaseStyle.lineHeight)
          ]}
        />
      );
    }
    return <Text style={htmlRendererStyles.inlineForumImageText}>{label || src}</Text>;
  };
  return {
    img: PreviewImageRenderer,
    [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer
  };
}
