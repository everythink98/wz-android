import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type ImageURISource,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData } from 'expo-image';
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
  selectImageDisplaySource,
  selectImageOriginalSource,
  type ImageDisplaySize
} from '@/platform/media/imagePreviewCatalog';
import { INLINE_FORUM_IMAGE_TAG, isInlineForumImage } from '@/domain/forum/forumContentMedia';
import {
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize,
  shouldMarkLoadedImageInline
} from '@/platform/media/inlineMedia';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { HtmlRenderers } from './types';
import { createHtmlRendererStyles } from './htmlStyles';
import { useContentBoundarySpacing } from './TopicContentPresentation';
import {
  cachedCompatibleSvgArtifact,
  compatibleImageRequestIdentity,
  promoteCachedCompatibleSvgArtifact,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster,
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

type PreviewImageBlockProps = {
  attributes: Record<string, string | undefined>;
  boundarySpacing?: ViewStyle;
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
};

function ManagedOriginalImageLayer({
  attemptIdentity,
  forced,
  onDisplay,
  onRequestError,
  onTerminalFailure,
  placeholder,
  requestIdentity,
  source
}: {
  attemptIdentity: string;
  forced: boolean;
  onDisplay: () => void;
  onRequestError: () => boolean;
  onTerminalFailure: () => void;
  placeholder: ImageURISource;
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
  if (!lease.admitted) return null;
  return (
    <ExpoImage
      key={lease.attemptId}
      testID="topic-image-original"
      allowDownscaling
      cachePolicy="disk"
      contentFit="contain"
      placeholder={placeholder}
      placeholderContentFit="contain"
      priority={forced ? 'high' : 'low'}
      recyclingKey={`${attemptIdentity}:body-original:${lease.attemptId}`}
      source={source}
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
  attributes,
  boundarySpacing,
  bodyMediaLease,
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
  src
}: PreviewImageBlockProps & { bodyMediaLease: ReturnType<typeof useTopicBodyMediaLease> }) {
  const requestIdentity = compatibleImageRequestIdentity(imageSource);
  const bodyRequestIdentity = `${requestIdentity}\u0000attempt:${bodyMediaLease.attemptId}`;
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
  const compatibleSvgConsumption = useMemo(
    () => ({ controller: new AbortController(), requestIdentity: bodyRequestIdentity }),
    [bodyRequestIdentity]
  );
  const mountedRef = useRef(true);
  const requestIdentityRef = useRef(bodyRequestIdentity);
  const settledRequestIdentityRef = useRef('');
  const posterRefreshIdentityRef = useRef('');
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
  const imageLoadIdentity = `${bodyRequestIdentity}:${activeArtifact ? `compatible:${activeArtifact.posterRevision}` : 'native'}`;
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      compatibleSvgConsumption.controller.abort();
    };
  }, [compatibleSvgConsumption]);
  useLayoutEffect(() => {
    requestIdentityRef.current = compatibleSvgConsumption.requestIdentity;
  }, [compatibleSvgConsumption]);
  const recoverSvgArtifact = useCallback(async () => {
    try {
      const artifact = await recoverCompatibleSvgArtifact(imageSource, {
        signal: compatibleSvgConsumption.controller.signal
      });
      if (
        !mountedRef.current ||
        requestIdentityRef.current !== bodyRequestIdentity ||
        settledRequestIdentityRef.current === bodyRequestIdentity
      ) {
        return;
      }
      if (artifact) {
        setCompatibleSvgArtifact(artifact);
        return;
      }
      settledRequestIdentityRef.current = bodyRequestIdentity;
      setFailedRequestIdentity(bodyRequestIdentity);
    } catch {
      if (
        mountedRef.current &&
        requestIdentityRef.current === bodyRequestIdentity &&
        settledRequestIdentityRef.current !== bodyRequestIdentity
      ) {
        settledRequestIdentityRef.current = bodyRequestIdentity;
        setFailedRequestIdentity(bodyRequestIdentity);
      }
    }
  }, [bodyRequestIdentity, compatibleSvgConsumption, imageSource]);
  const refreshSvgPoster = useCallback(
    async (artifact: CompatibleSvgArtifact) => {
      try {
        const refreshed = await refreshCompatibleSvgPoster(artifact, {
          signal: compatibleSvgConsumption.controller.signal
        });
        if (
          !mountedRef.current ||
          requestIdentityRef.current !== bodyRequestIdentity ||
          settledRequestIdentityRef.current === bodyRequestIdentity
        ) {
          return;
        }
        setCompatibleSvgArtifact(refreshed);
      } catch {
        if (
          mountedRef.current &&
          requestIdentityRef.current === bodyRequestIdentity &&
          settledRequestIdentityRef.current !== bodyRequestIdentity
        ) {
          settledRequestIdentityRef.current = bodyRequestIdentity;
          setFailedRequestIdentity(bodyRequestIdentity);
        }
      }
    },
    [bodyRequestIdentity, compatibleSvgConsumption]
  );
  const handleImageError = useCallback(() => {
    if (
      !mountedRef.current ||
      requestIdentityRef.current !== bodyRequestIdentity ||
      settledRequestIdentityRef.current === bodyRequestIdentity
    ) {
      return;
    }
    if (activeArtifact) {
      if (posterRefreshIdentityRef.current === bodyRequestIdentity) {
        settledRequestIdentityRef.current = bodyRequestIdentity;
        setFailedRequestIdentity(bodyRequestIdentity);
        return;
      }
      posterRefreshIdentityRef.current = bodyRequestIdentity;
      void refreshSvgPoster(activeArtifact);
      return;
    }
    void recoverSvgArtifact();
  }, [activeArtifact, bodyRequestIdentity, recoverSvgArtifact, refreshSvgPoster]);
  const handleImageLoad = useCallback(
    (event: ImageLoadEventData) => {
      if (
        !mountedRef.current ||
        requestIdentityRef.current !== bodyRequestIdentity ||
        settledRequestIdentityRef.current === bodyRequestIdentity
      ) {
        return;
      }
      const width = Number(event.source.width);
      const height = Number(event.source.height);
      if (!(width > 0 && height > 0)) {
        return;
      }
      setLoadedImage({
        cacheType: event.cacheType,
        dimensions: { height, width },
        imageLoadIdentity,
        requestIdentity: bodyRequestIdentity
      });
    },
    [bodyRequestIdentity, imageLoadIdentity]
  );
  const handleImageDisplay = useCallback(() => {
    if (
      !mountedRef.current ||
      requestIdentityRef.current !== bodyRequestIdentity ||
      settledRequestIdentityRef.current === bodyRequestIdentity
    ) {
      return;
    }
    setDisplayedImageLoadIdentity(imageLoadIdentity);
  }, [bodyRequestIdentity, imageLoadIdentity]);
  const handleImageProgress = useCallback(
    (event: { loaded: number }) => {
      if (
        !mountedRef.current ||
        requestIdentityRef.current !== bodyRequestIdentity ||
        settledRequestIdentityRef.current === bodyRequestIdentity
      ) {
        return;
      }
      bodyMediaLease.progress(event.loaded);
    },
    [bodyMediaLease, bodyRequestIdentity]
  );
  const loadFailed = failedRequestIdentity === bodyRequestIdentity;
  const cacheKey = `${mediaSessionIdentity}:${normalizeImagePreviewUrl(src).trim()}`;
  const cachedDimensions = cachedImageDisplayDimensions(cacheKey);
  useEffect(() => {
    if (cachedDimensions) {
      rememberImageDisplayDimensions(cacheKey, cachedDimensions);
    }
  }, [cacheKey, cachedDimensions]);
  const activeLoadedImage =
    loadedImage?.requestIdentity === bodyRequestIdentity && loadedImage.imageLoadIdentity === imageLoadIdentity
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
    boundarySpacing
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
    if (!imageDisplayed || settledRequestIdentityRef.current === bodyRequestIdentity) {
      return;
    }
    settledRequestIdentityRef.current = bodyRequestIdentity;
    bodyMediaLease.settle('displayed');
  }, [bodyMediaLease, bodyRequestIdentity, imageDisplayed]);
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
          setForcedOriginalIdentity(originalRequestIdentity);
        }
        onOpenImagePreview(src, activeLoadedImage?.dimensions || cachedDimensions, activeArtifact?.posterSource.uri);
      }}
    >
      <View testID="topic-image-frame" style={[{ overflow: 'hidden' as const }, imageState.dimensions]}>
        {!loadFailed && !originalDisplayed ? (
          <ExpoImage
            allowDownscaling
            cachePolicy="disk"
            contentFit="contain"
            priority="normal"
            recyclingKey={imageLoadIdentity}
            source={activeImageSource}
            style={[imageState.dimensions, imageState.type === 'success' ? imageState.imageStyle : null]}
            onDisplay={handleImageDisplay}
            onError={handleImageError}
            onLoad={handleImageLoad}
            onProgress={handleImageProgress}
          />
        ) : null}
        {shouldLoadOriginal && progressiveSource ? (
          <ManagedOriginalImageLayer
            attemptIdentity={originalAttemptIdentity}
            forced={originalForced}
            placeholder={activeImageSource}
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
              setDisplayedOriginalIdentity(progressiveIdentity);
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
              setFailedOriginal({ identity: originalAttemptIdentity, revision: originalDisplayRevision });
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
  const contentWidth = Math.max(1, props.imageProps.contentWidth || 1);
  const cacheKey = `${props.mediaSessionIdentity}:${normalizeImagePreviewUrl(props.src).trim()}`;
  const cachedDimensions = cachedImageDisplayDimensions(cacheKey);
  const dimensions = cachedDimensions
    ? {
        height: Math.max(1, Math.round((cachedDimensions.height * contentWidth) / cachedDimensions.width)),
        width: contentWidth
      }
    : { height: Math.round(contentWidth * 0.75), width: contentWidth };
  if (bodyMediaLease.admitted) {
    return <AdmittedPreviewImageBlock {...props} bodyMediaLease={bodyMediaLease} key={bodyMediaLease.attemptId} />;
  }
  const frameStyle = [
    {
      alignItems: 'center' as const,
      alignSelf: 'center' as const,
      backgroundColor: props.frameBackgroundColor,
      borderColor: props.frameBorderColor,
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

function ManagedInlineForumImage({
  recyclingKey,
  source,
  style
}: {
  recyclingKey: string;
  source: ImageURISource;
  style: StyleProp<ImageStyle & ViewStyle>;
}) {
  const requestIdentity = compatibleImageRequestIdentity(source);
  const lease = useTopicBodyMediaLease({ kind: 'inline', requestIdentity });
  if (!lease.admitted) return <View style={style} />;
  return (
    <ExpoImage
      key={lease.attemptId}
      allowDownscaling
      cachePolicy="disk"
      contentFit="contain"
      recyclingKey={`${recyclingKey}:${lease.attemptId}`}
      source={source}
      style={style}
      onDisplay={() => lease.settle('displayed')}
      onError={() => lease.settle('error')}
      onProgress={(event) => lease.progress(event.loaded)}
    />
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
    const boundarySpacing = useContentBoundarySpacing(props.tnode);
    const contentWidth = useContentWidth();
    const imageProps = useIMGElementProps(props);
    const attributes = props.tnode.attributes;
    const inlineSrc = attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
    if (isInlineForumImage(attributes)) {
      if (!inlineSrc) {
        return <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
      }
      return (
        <ManagedInlineForumImage
          recyclingKey={`${mediaSessionIdentity}:${inlineSrc}`}
          source={
            imageSourceFromUrl(inlineSrc, {
              mediaContext,
              nodeSeekUserAgent: nodeSeekMediaUserAgent
            }) as ImageURISource
          }
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
        boundarySpacing={boundarySpacing}
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
        <ManagedInlineForumImage
          recyclingKey={`${mediaSessionIdentity}:${src}`}
          source={
            imageSourceFromUrl(src, {
              mediaContext,
              nodeSeekUserAgent: nodeSeekMediaUserAgent
            }) as ImageURISource
          }
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
