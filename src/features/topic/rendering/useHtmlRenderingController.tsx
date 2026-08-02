import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageURISource,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from 'react-native';
import { useEvent } from 'expo';
import { Image as ExpoImage, type ImageLoadEventData, type ImageProgressEventData } from 'expo-image';
import { VideoView, useVideoPlayer, type VideoPlayerStatus, type VideoSource } from 'expo-video';
import { WebView } from 'react-native-webview';
import {
  getNativePropsForTNode,
  TChildrenRenderer,
  useContentWidth,
  useIMGElementProps,
  useIMGElementStateWithCache,
  type CustomBlockRenderer,
  type CustomMixedRenderer,
  type IMGElementProps
} from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { createTopicImageDeriver } from '../model/topicDerivedData';
import {
  imageSourceFromUrl,
  imageRequestHeadersForUrl,
  isHttpOrHttpsUrl,
  normalizeImagePreviewUrl
} from '@/platform/media/imageRequestSource';
import {
  isInlineForumImage,
  isPreviewableImageUrl,
  selectImageDisplaySource,
  selectImageOriginalSource,
  type ImageDisplayCandidateKind,
  type ImageDisplaySize
} from '@/platform/media/imagePreviewCatalog';
import {
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize,
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG,
  shouldMarkLoadedImageInline
} from '@/platform/media/inlineMedia';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '@/domain/forum/videoEmbeds';
import { parseForumTopicLink, parseForumUserLink } from '@/domain/forum/links';
import { androidRipple, fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '@/ui/theme/tokens';
import type { Topic, TopicDetail, UserReference } from '@/domain/forum/models';
import type { HtmlRenderers, HtmlRenderersProps } from './types';
import { buildHtmlRenderingStyles, createHtmlRendererStyles, trimsTrailingBlockSpacing } from './htmlStyles';
import { FORUM_REPLY_REFERENCE_TAG } from '@/domain/forum/topicContentHtml';
import {
  FORUM_LINK_CARD_TAG,
  FORUM_TERMINAL_REPORT_TAG,
  FORUM_TERMINAL_TAB_TAG,
  FORUM_VIDEO_STICKER_TAG,
  FORUM_VIDEO_TAG
} from '@/domain/forum/html';
import { ForumContentVideo } from '@/ui/content/ForumContentVideo';
import { ForumCallout } from '@/ui/content/ForumCallout';
import { hasSameYaohuoTopicLayout } from '../model/screenHelpers';
import {
  cachedCompatibleSvgArtifact,
  compatibleImageRequestIdentity,
  promoteCachedCompatibleSvgArtifact,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster,
  type CompatibleSvgArtifact
} from '@/platform/media/compatibleImageSources';
import { readManagedCookieHeader } from '@/platform/network/managedCookies';
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
  DISCOURSE_CALLOUT_ATTRIBUTE,
  DISCOURSE_CALLOUT_CONTENT_CLASS,
  DISCOURSE_CALLOUT_FOLD_ATTRIBUTE,
  DISCOURSE_CALLOUT_TITLE_CLASS,
  DISCOURSE_CALLOUT_TYPE_ATTRIBUTE,
  DISCOURSE_CALLOUT_REGISTRY,
  isDiscourseCalloutType,
  type DiscourseCalloutFold
} from '@/domain/forum/callouts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';

export async function readManagedWebViewCookieHeader(url: string) {
  const result = await readManagedCookieHeader(url);
  if (result.status === 'ok') {
    return result.header;
  }
  throw new Error(result.status === 'unsupported' ? '原生 Cookie 读取能力不可用' : result.message);
}

function isVideoStickerUrl(url: string) {
  return /\.(?:webm|mp4|mov)(?:[?#].*)?$/i.test(url);
}

function videoStickerRequestHeaders(
  url: string,
  mediaContext: ForumMediaRequestContext,
  userAgent?: string
): Record<string, string> | undefined {
  const headers = imageRequestHeadersForUrl(url, { mediaContext, nodeSeekUserAgent: userAgent });
  return headers
    ? {
        ...headers,
        Accept: 'video/webm,video/mp4,video/*,*/*;q=0.8'
      }
    : undefined;
}

function domText(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { children?: unknown; data?: unknown };
  const ownText = typeof record.data === 'string' ? record.data : '';
  const childText = Array.isArray(record.children) ? record.children.map(domText).join('') : '';
  return `${ownText}${childText}`;
}

function tnodeText(tnode: unknown) {
  return (domText(tnode) || domText((tnode as { domNode?: unknown }).domNode)).replace(/\u00a0/g, ' ').trim();
}

function terminalNodeAttribute(node: unknown, name: string) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as {
    attribs?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    getAttribute?: (name: string) => unknown;
  };
  return String(record.attributes?.[name] || record.attribs?.[name] || record.getAttribute?.(name) || '');
}

function terminalNodeChildren(node: unknown) {
  if (!node || typeof node !== 'object') {
    return [];
  }
  const record = node as { childNodes?: unknown[]; children?: unknown[] };
  return Array.isArray(record.childNodes) ? record.childNodes : Array.isArray(record.children) ? record.children : [];
}

function terminalNodeTagName(node: unknown) {
  if (!node || typeof node !== 'object') {
    return '';
  }
  const record = node as { name?: unknown; tagName?: unknown };
  return String(record.tagName || record.name || '').toLowerCase();
}

function terminalNodeHasClass(node: unknown, className: string) {
  return terminalNodeAttribute(node, 'class').split(/\s+/).includes(className);
}

function terminalTextStyle(tnode: unknown) {
  const style = terminalNodeAttribute(tnode, 'style');
  const color = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1].trim();
  const backgroundColor = style.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i)?.[1].trim();
  return {
    ...(color ? { color } : {}),
    ...(backgroundColor ? { backgroundColor } : {})
  };
}

function terminalTextChildren(tnode: unknown, key: string, style: TextStyle = {}): ReactNode[] {
  if (!tnode || typeof tnode !== 'object') {
    return [];
  }
  const record = tnode as { children?: unknown; data?: unknown; tagName?: unknown; type?: unknown };
  if (record.type === 'text') {
    const text = typeof record.data === 'string' ? record.data : '';
    return text
      ? [
          Object.keys(style).length ? (
            <Text key={key} style={style}>
              {text}
            </Text>
          ) : (
            text
          )
        ]
      : [];
  }
  if (terminalNodeTagName(tnode) === 'br') {
    return ['\n'];
  }
  const nextStyle = { ...style, ...terminalTextStyle(tnode) };
  return terminalNodeChildren(tnode).flatMap((child, index) =>
    terminalTextChildren(child, `${key}.${index}`, nextStyle)
  );
}

export function shouldShowVideoStickerLoading(
  firstFrameRendered: boolean,
  loadFailed: boolean,
  status: VideoPlayerStatus
) {
  return !loadFailed && (status === 'loading' || (status !== 'error' && !firstFrameRendered));
}

function ForumVideoStickerVideo({
  fallbackSrc,
  headers,
  loadingColor,
  mediaContext,
  mediaSessionIdentity,
  src,
  videoStyle
}: {
  fallbackSrc: string;
  headers?: Record<string, string>;
  loadingColor: string;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  src: string;
  videoStyle: StyleProp<ViewStyle>;
}) {
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const source = useMemo<VideoSource>(
    () => ({
      uri: src,
      ...(headers ? { headers } : {}),
      contentType: 'progressive'
    }),
    [headers, src]
  );
  const player = useVideoPlayer(source, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
    nextPlayer.keepScreenOnWhilePlaying = false;
    nextPlayer.play();
  });
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
  useEffect(() => {
    setFirstFrameRendered(false);
  }, [headers, mediaSessionIdentity, src]);
  const loadFailed = status === 'error';
  const showLoading = shouldShowVideoStickerLoading(firstFrameRendered, loadFailed, status);
  const showFallback = fallbackSrc && (!firstFrameRendered || loadFailed);
  return (
    <View pointerEvents="none" style={videoStyle}>
      {!loadFailed ? (
        <VideoView
          allowsVideoFrameAnalysis={false}
          contentFit="contain"
          fullscreenOptions={{ enable: false }}
          nativeControls={false}
          onFirstFrameRender={() => {
            setFirstFrameRendered(true);
          }}
          player={player}
          style={embedStyles.stickerVideoFill}
          surfaceType="textureView"
          useExoShutter={false}
        />
      ) : null}
      {showFallback ? (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${fallbackSrc}`}
          source={imageSourceFromUrl(fallbackSrc, { mediaContext, nodeSeekUserAgent: headers?.['User-Agent'] })}
          style={embedStyles.stickerVideoFallback}
        />
      ) : null}
      {showLoading ? (
        <View style={embedStyles.stickerVideoLoading}>
          <ActivityIndicator color={loadingColor} size="small" />
        </View>
      ) : null}
    </View>
  );
}

type PreviewImageDimensions = { height: number; width: number };

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

const PREVIEW_IMAGE_DIMENSIONS_CACHE_LIMIT = 512;
const previewImageDimensionsByUrl = new Map<string, PreviewImageDimensions>();

export function cachedPreviewImageDimensions(cacheKey: string) {
  return previewImageDimensionsByUrl.get(cacheKey);
}

export function rememberPreviewImageDimensions(cacheKey: string, dimensions: PreviewImageDimensions) {
  previewImageDimensionsByUrl.delete(cacheKey);
  previewImageDimensionsByUrl.set(cacheKey, dimensions);
  if (previewImageDimensionsByUrl.size > PREVIEW_IMAGE_DIMENSIONS_CACHE_LIMIT) {
    previewImageDimensionsByUrl.delete(previewImageDimensionsByUrl.keys().next().value!);
  }
}

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
    dimensions: PreviewImageDimensions;
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
  const cachedDimensions = cachedPreviewImageDimensions(cacheKey);
  useEffect(() => {
    if (cachedDimensions) {
      rememberPreviewImageDimensions(cacheKey, cachedDimensions);
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
    rememberPreviewImageDimensions(cacheKey, dimensions);
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

export function useHtmlRenderingController({
  mediaSessionIdentity,
  onOpenExternalUrl,
  onOpenImagePreview,
  onOpenTopic,
  onOpenUser,
  nodeSeekMediaUserAgent,
  selectedTopic,
  settings,
  styleSettings,
  theme,
  topicDetail,
  topicKey,
  webViewBlockMessage
}: {
  onOpenExternalUrl: (url: string) => void;
  mediaSessionIdentity: string;
  onOpenImagePreview: (url: string, displaySize?: ImageDisplaySize, renderedPosterUri?: string) => void;
  onOpenTopic: (topic: Topic) => void | Promise<void>;
  onOpenUser: (user: UserReference) => void | Promise<void>;
  nodeSeekMediaUserAgent?: string;
  selectedTopic: Topic | null;
  settings: ReaderSettings;
  styleSettings?: ReaderSettings;
  theme: ReaderTheme;
  topicDetail: TopicDetail | null;
  topicKey: string;
  webViewBlockMessage: string;
}) {
  const mediaContext = useMemo<ForumMediaRequestContext>(
    () => ({
      contentSource: selectedTopic?.source || null,
      sessionIdentity: mediaSessionIdentity
    }),
    [mediaSessionIdentity, selectedTopic?.source]
  );
  const htmlTopicDetailRef = useRef(topicDetail);
  const htmlTopicDetail = hasSameYaohuoTopicLayout(htmlTopicDetailRef.current, topicDetail)
    ? htmlTopicDetailRef.current
    : topicDetail;
  useLayoutEffect(() => {
    htmlTopicDetailRef.current = htmlTopicDetail;
  }, [htmlTopicDetail]);
  const [inlineSizedImageState, setInlineSizedImageState] = useState<{ topicKey: string; urls: Record<string, true> }>({
    topicKey: '',
    urls: {}
  });
  const emptyInlineSizedImageUrls = useMemo<Record<string, true>>(() => ({}), [topicKey]);
  const inlineSizedImageUrls =
    inlineSizedImageState.topicKey === topicKey ? inlineSizedImageState.urls : emptyInlineSizedImageUrls;
  const markInlineSizedImageUrl = useCallback(
    (url: string) => {
      const clean = normalizeImagePreviewUrl(url).trim();
      if (!clean) {
        return;
      }
      setInlineSizedImageState((current) =>
        current.topicKey === topicKey && current.urls[clean]
          ? current
          : {
              topicKey,
              urls: {
                ...(current.topicKey === topicKey ? current.urls : {}),
                [clean]: true
              }
            }
      );
    },
    [topicKey]
  );

  const topicImageDeriver = useMemo(() => createTopicImageDeriver(), [topicKey]);

  const { htmlBaseStyle, htmlClassesStyles, htmlIgnoredStyles, htmlTagsStyles } = useMemo(
    () =>
      buildHtmlRenderingStyles({
        enableDiscourseCallouts: isDiscourseSource(mediaContext.contentSource),
        settings,
        theme
      }),
    [mediaContext.contentSource, settings.fontFamily, settings.fontScale, settings.lineHeight, theme]
  );
  const resolvedStyleSettings = styleSettings || settings;
  const htmlRendererStyles = useMemo(
    () => createHtmlRendererStyles(resolvedStyleSettings, theme),
    [resolvedStyleSettings.fontFamily, resolvedStyleSettings.fontScale, theme]
  );
  const openHtmlLink = useCallback(
    (href: string, event?: { stopPropagation?: () => void }) => {
      event?.stopPropagation?.();
      if (isPreviewableImageUrl(href)) {
        onOpenImagePreview(href);
        return;
      }
      const baseUrl = selectedTopic?.url || htmlTopicDetail?.url;
      const candidates = [
        ...(selectedTopic ? [selectedTopic] : []),
        ...(htmlTopicDetail ? [htmlTopicDetail, ...(htmlTopicDetail.replies || [])] : [])
      ];
      const appUser = parseForumUserLink(href, baseUrl, candidates);
      if (appUser) {
        void onOpenUser(appUser);
        return;
      }
      const appTopic = parseForumTopicLink(href, baseUrl);
      if (appTopic) {
        void onOpenTopic(appTopic);
        return;
      }
      if (isHttpOrHttpsUrl(href)) {
        onOpenExternalUrl(href);
      }
    },
    [htmlTopicDetail, onOpenExternalUrl, onOpenImagePreview, onOpenTopic, onOpenUser, selectedTopic]
  );
  const htmlRenderers = useMemo<HtmlRenderers>(() => {
    const BlockquoteRenderer: CustomBlockRenderer = (props) => {
      const renderOrdinaryQuote = () => {
        const { InternalRenderer, ...internalRendererProps } = props;
        return (
          <InternalRenderer
            {...internalRendererProps}
            style={trimsTrailingBlockSpacing(props.tnode) ? { ...props.style, marginBottom: -4 } : props.style}
          />
        );
      };
      const attributes = props.tnode.attributes || {};
      const type = attributes[DISCOURSE_CALLOUT_TYPE_ATTRIBUTE];
      const foldValue = attributes[DISCOURSE_CALLOUT_FOLD_ATTRIBUTE];
      if (
        !isDiscourseSource(mediaContext.contentSource) ||
        attributes[DISCOURSE_CALLOUT_ATTRIBUTE] !== 'true' ||
        !isDiscourseCalloutType(type) ||
        (foldValue !== undefined && foldValue !== 'collapsed' && foldValue !== 'expanded')
      ) {
        return renderOrdinaryQuote();
      }
      const titleNodes = props.tnode.children.filter(
        (child) => terminalNodeTagName(child) === 'div' && terminalNodeHasClass(child, DISCOURSE_CALLOUT_TITLE_CLASS)
      );
      const contentNodes = props.tnode.children.filter(
        (child) => terminalNodeTagName(child) === 'div' && terminalNodeHasClass(child, DISCOURSE_CALLOUT_CONTENT_CLASS)
      );
      if (titleNodes.length !== 1 || contentNodes.length > 1) {
        return renderOrdinaryQuote();
      }
      const titleNode = titleNodes[0];
      const contentNode = contentNodes[0];
      return (
        <ForumCallout
          body={contentNode ? <TChildrenRenderer tchildren={[contentNode]} /> : undefined}
          fold={foldValue as DiscourseCalloutFold | undefined}
          theme={theme}
          title={<TChildrenRenderer tchildren={[titleNode]} />}
          titleLabel={tnodeText(titleNode) || DISCOURSE_CALLOUT_REGISTRY[type].title}
          trimTrailingBlockSpacing={trimsTrailingBlockSpacing(props.tnode)}
          type={type}
        />
      );
    };
    const ReplyReferenceRenderer: CustomBlockRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const mention = attributes['data-mention'] || '';
      const floor = attributes['data-floor'] || '';
      const userHref = attributes['data-user-href'] || '';
      if (!mention && !floor) {
        return null;
      }
      return (
        <View style={htmlRendererStyles.htmlReplyReferenceRow}>
          <Text style={htmlRendererStyles.htmlReplyReferenceLabel}>回复</Text>
          {mention ? (
            <Pressable accessibilityRole="link" disabled={!userHref} onPress={(event) => openHtmlLink(userHref, event)}>
              <Text style={htmlRendererStyles.htmlReplyReferenceMentionText}>{mention}</Text>
            </Pressable>
          ) : null}
          {mention && floor ? <Text style={htmlRendererStyles.htmlReplyReferenceSeparator}>·</Text> : null}
          {floor ? <Text style={htmlRendererStyles.htmlReplyReferenceFloorText}>{floor}</Text> : null}
        </View>
      );
    };
    const ReplyReferenceLinkRenderer: CustomMixedRenderer = (props) => {
      const className = String(props.tnode.attributes?.class || '');
      const isMentionLink = className.split(/\s+/).includes('forum-mention-link');
      const isFloorLink = className.split(/\s+/).includes('forum-floor-link');
      if (!isMentionLink && !isFloorLink) {
        const { InternalRenderer, ...internalRendererProps } = props;
        return <InternalRenderer {...internalRendererProps} />;
      }
      const nativeProps = getNativePropsForTNode(props);
      if (isFloorLink) {
        const { accessibilityRole: _accessibilityRole, onPress: _onPress, ...textProps } = nativeProps;
        return <Text {...textProps} style={[textProps.style, htmlRendererStyles.htmlFloorLink]} />;
      }
      const href = props.tnode.attributes?.href || '';
      return (
        <Text
          {...nativeProps}
          accessibilityRole="link"
          onPress={(event) => openHtmlLink(href, event)}
          style={[nativeProps.style, htmlRendererStyles.htmlMentionLink]}
        />
      );
    };
    const VideoEmbedBlock = ({ embedUrl }: { embedUrl: string }) => (
      <View style={[embedStyles.videoFrame, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
        {webViewBlockMessage ? (
          <View style={embedStyles.blockedWebView}>
            <Text style={[htmlRendererStyles.inlineForumImageText, { color: theme.muted }]}>{webViewBlockMessage}</Text>
          </View>
        ) : (
          <WebView
            allowsFullscreenVideo
            domStorageEnabled
            javaScriptEnabled
            javaScriptCanOpenWindowsAutomatically={false}
            onShouldStartLoadWithRequest={(request) => shouldAllowBilibiliWebViewNavigation(request.url)}
            source={{ uri: embedUrl }}
            setSupportMultipleWindows={false}
            style={embedStyles.webView}
          />
        )}
      </View>
    );
    const ForumVideoStickerRenderer: CustomBlockRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const src = attributes.src || '';
      const fallbackSrc = attributes['data-fallback-src'] || '';
      const contentWidth = useContentWidth();
      const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
      if (!src) {
        return fallbackSrc ? (
          <ExpoImage
            contentFit="contain"
            recyclingKey={`${mediaSessionIdentity}:${fallbackSrc}`}
            source={imageSourceFromUrl(fallbackSrc, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
            style={[htmlRendererStyles.inlineForumImage, size]}
          />
        ) : null;
      }
      if (!isVideoStickerUrl(src)) {
        return (
          <ExpoImage
            contentFit="contain"
            recyclingKey={`${mediaSessionIdentity}:${src}`}
            source={imageSourceFromUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
            style={[htmlRendererStyles.inlineForumImage, size]}
          />
        );
      }
      const headers = videoStickerRequestHeaders(src, mediaContext, nodeSeekMediaUserAgent);
      return (
        <ForumVideoStickerVideo
          key={`${mediaSessionIdentity}:${src}`}
          fallbackSrc={fallbackSrc}
          headers={headers}
          loadingColor={theme.primary}
          mediaContext={mediaContext}
          mediaSessionIdentity={mediaSessionIdentity}
          src={src}
          videoStyle={[size, embedStyles.inlineVideoSticker, embedStyles.stickerVideoFrame]}
        />
      );
    };
    const ForumVideoRenderer: CustomBlockRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const src = attributes.src || '';
      if (!src) {
        return null;
      }
      return (
        <ForumContentVideo
          key={`${mediaSessionIdentity}:${src}`}
          headers={videoStickerRequestHeaders(src, mediaContext, nodeSeekMediaUserAgent)}
          mediaContext={mediaContext}
          src={src}
          theme={theme}
        />
      );
    };
    const ForumStickerRenderer: CustomMixedRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const src = attributes.src || '';
      const contentWidth = useContentWidth();
      const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
      if (!src) {
        return <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
      }
      return (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${src}`}
          source={imageSourceFromUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
          style={[htmlRendererStyles.inlineForumImage, size]}
        />
      );
    };
    const ForumStickerRowRenderer: CustomBlockRenderer = (props) => {
      return (
        <View style={[embedStyles.stickerRow, trimsTrailingBlockSpacing(props.tnode) ? { marginBottom: -4 } : null]}>
          <TChildrenRenderer tchildren={props.tnode.children} />
        </View>
      );
    };
    const ForumInlineMediaLineRenderer: CustomBlockRenderer = (props) => {
      return (
        <View style={embedStyles.inlineMediaLine}>
          <TChildrenRenderer tchildren={props.tnode.children} />
        </View>
      );
    };
    const LinkCardRenderer: CustomBlockRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const href = attributes.href || '';
      const site = attributes.site || '';
      const title = attributes.title || site || href;
      const description = attributes.description || '';
      const imageSrc = attributes['image-src'] || '';
      const iconSrc = attributes['icon-src'] || '';
      if (!href) {
        return null;
      }
      return (
        <Pressable
          accessibilityLabel={title}
          accessibilityRole="link"
          android_ripple={androidRipple(theme.mist)}
          style={[embedStyles.linkCard, { backgroundColor: theme.surface, borderColor: theme.line }]}
          onPress={(event) => {
            event.stopPropagation?.();
            openHtmlLink(href, event);
          }}
        >
          {site || iconSrc ? (
            <View style={embedStyles.linkCardHeader}>
              {iconSrc ? (
                <ExpoImage
                  contentFit="contain"
                  recyclingKey={`${mediaSessionIdentity}:${iconSrc}`}
                  source={imageSourceFromUrl(iconSrc, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
                  style={embedStyles.linkCardIcon}
                />
              ) : null}
              {site ? (
                <Text numberOfLines={1} style={[embedStyles.linkCardSite, { color: theme.muted }]}>
                  {site}
                </Text>
              ) : null}
            </View>
          ) : null}
          <View style={embedStyles.linkCardBody}>
            {imageSrc ? (
              <ExpoImage
                contentFit="cover"
                recyclingKey={`${mediaSessionIdentity}:${imageSrc}`}
                source={imageSourceFromUrl(imageSrc, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
                style={[embedStyles.linkCardThumbnail, { backgroundColor: theme.surface2 }]}
              />
            ) : null}
            <View style={embedStyles.linkCardText}>
              <Text numberOfLines={3} style={[embedStyles.linkCardTitle, { color: theme.primaryStrong }]}>
                {title}
              </Text>
              {description ? (
                <Text numberOfLines={3} style={[embedStyles.linkCardDescription, { color: theme.ink }]}>
                  {description}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    };
    const TerminalReportRenderer: CustomBlockRenderer = (props) => {
      const tabNodes = props.tnode.children.filter(
        (child) => String((child as { tagName?: unknown }).tagName || '').toLowerCase() === FORUM_TERMINAL_TAB_TAG
      );
      const [activeIndex, setActiveIndex] = useState(0);
      if (!tabNodes.length) {
        return <TChildrenRenderer tchildren={props.tnode.children} />;
      }
      const activeTab = tabNodes[Math.min(activeIndex, tabNodes.length - 1)];
      return (
        <View style={terminalStyles.report}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={terminalStyles.tabRow}>
            {tabNodes.map((tabNode, index) => {
              const title = String(
                (tabNode as { attributes?: Record<string, string | undefined> }).attributes?.title || `Tab ${index + 1}`
              );
              const active = index === activeIndex;
              return (
                <Pressable
                  key={`${title}:${index}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`切换到${title}`}
                  android_ripple={androidRipple(theme.primarySoft)}
                  style={[
                    terminalStyles.tabButton,
                    index === 0 ? terminalStyles.tabButtonFirst : null,
                    index === tabNodes.length - 1 ? terminalStyles.tabButtonLast : null,
                    active ? terminalStyles.tabButtonActive : terminalStyles.tabButtonInactive,
                    {
                      backgroundColor: active ? theme.surface : theme.surface2,
                      borderColor: theme.line,
                      borderBottomColor: active ? theme.surface : theme.line
                    }
                  ]}
                  onPress={() => setActiveIndex(index)}
                >
                  <Text
                    numberOfLines={1}
                    style={[terminalStyles.tabText, { color: active ? theme.primaryStrong : theme.ink }]}
                  >
                    {title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[terminalStyles.contentPanel, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <TChildrenRenderer tchildren={(activeTab as { children?: typeof props.tnode.children }).children || []} />
          </View>
        </View>
      );
    };
    const TerminalDivRenderer: CustomBlockRenderer = (props) => {
      const className = String(props.tnode.attributes?.class || '');
      if (!className.split(/\s+/).includes('forum-terminal-code')) {
        const { InternalRenderer, ...internalRendererProps } = props;
        return <InternalRenderer {...internalRendererProps} />;
      }
      const textChildren = terminalTextChildren(
        (props.tnode as { domNode?: unknown }).domNode || props.tnode,
        'terminal'
      );
      return (
        <View style={terminalStyles.codePanel}>
          <ScrollView horizontal>
            <Text selectable style={terminalStyles.codeText}>
              {textChildren.length ? textChildren : tnodeText(props.tnode)}
            </Text>
          </ScrollView>
        </View>
      );
    };
    const IframeRenderer: CustomBlockRenderer = (props) => {
      const src = props.tnode.attributes.src || '';
      const embed = nsEmbedFromUrl(src);
      if (embed?.type !== 'bilibili') {
        return null;
      }
      return <VideoEmbedBlock embedUrl={embed.embedUrl} />;
    };
    const PreviewImageRenderer: CustomBlockRenderer = (props) => {
      const contentWidth = useContentWidth();
      const imageProps = useIMGElementProps(props);
      const attributes = props.tnode.attributes;
      const inlineSrc = attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
      if (isInlineForumImage(attributes)) {
        if (!inlineSrc) {
          return (
            <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>
          );
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
      const attributes =
        (props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {};
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
      a: ReplyReferenceLinkRenderer,
      blockquote: BlockquoteRenderer,
      div: TerminalDivRenderer,
      [FORUM_INLINE_MEDIA_LINE_TAG]: ForumInlineMediaLineRenderer,
      [FORUM_STICKER_ROW_TAG]: ForumStickerRowRenderer,
      [FORUM_STICKER_TAG]: ForumStickerRenderer,
      [FORUM_LINK_CARD_TAG]: LinkCardRenderer,
      [FORUM_TERMINAL_REPORT_TAG]: TerminalReportRenderer,
      [FORUM_VIDEO_TAG]: ForumVideoRenderer,
      [FORUM_VIDEO_STICKER_TAG]: ForumVideoStickerRenderer,
      iframe: IframeRenderer,
      img: PreviewImageRenderer,
      [FORUM_REPLY_REFERENCE_TAG]: ReplyReferenceRenderer,
      [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer
    };
  }, [
    htmlBaseStyle.lineHeight,
    mediaContext,
    mediaSessionIdentity,
    nodeSeekMediaUserAgent,
    onOpenImagePreview,
    openHtmlLink,
    markInlineSizedImageUrl,
    settings.fontScale,
    htmlRendererStyles.htmlFloorLink,
    htmlRendererStyles.htmlMentionLink,
    htmlRendererStyles.htmlReplyReferenceFloorText,
    htmlRendererStyles.htmlReplyReferenceLabel,
    htmlRendererStyles.htmlReplyReferenceMentionText,
    htmlRendererStyles.htmlReplyReferenceRow,
    htmlRendererStyles.htmlReplyReferenceSeparator,
    htmlRendererStyles.inlineForumImage,
    htmlRendererStyles.inlineForumImageText,
    theme,
    theme.ink,
    theme.line,
    theme.mist,
    theme.muted,
    theme.primary,
    theme.primarySoft,
    theme.primaryStrong,
    theme.surface,
    theme.surface2,
    webViewBlockMessage
  ]);

  const htmlRenderersProps = useMemo<HtmlRenderersProps>(() => {
    const listRendererProps = {
      enableDynamicMarkerBoxWidth: true,
      markerBoxStyle: {
        paddingRight: Math.round(6 * settings.fontScale)
      },
      markerTextStyle: {
        color: theme.ink,
        fontFamily: fontFamilyValue(settings.fontFamily),
        fontSize: Math.round(16 * settings.fontScale),
        lineHeight: Math.round(16 * settings.fontScale * lineHeightMultiplier(settings.lineHeight))
      }
    };
    return {
      a: {
        onPress: (event, href) => openHtmlLink(href, event)
      },
      img: {
        enableExperimentalPercentWidth: true
      },
      ol: listRendererProps,
      ul: listRendererProps
    };
  }, [openHtmlLink, settings.fontFamily, settings.fontScale, settings.lineHeight, theme.ink]);

  return {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    inlineSizedImageUrls,
    topicImageDeriver
  };
}

const embedStyles = StyleSheet.create({
  inlineMediaLine: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  stickerRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
    marginTop: 8,
    rowGap: 6
  },
  stickerVideoFrame: {
    overflow: 'hidden'
  },
  inlineVideoSticker: {
    backgroundColor: 'transparent',
    marginHorizontal: 2
  },
  stickerVideoFill: {
    ...StyleSheet.absoluteFillObject
  },
  stickerVideoFallback: {
    ...StyleSheet.absoluteFillObject
  },
  stickerVideoLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  linkCard: {
    alignSelf: 'stretch',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    marginTop: 8,
    overflow: 'hidden',
    padding: 10
  },
  linkCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8
  },
  linkCardIcon: {
    height: 18,
    marginRight: 7,
    width: 18
  },
  linkCardSite: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600'
  },
  linkCardBody: {
    flexDirection: 'row'
  },
  linkCardThumbnail: {
    borderRadius: 4,
    height: 58,
    marginRight: 10,
    width: 92
  },
  linkCardText: {
    flex: 1,
    minWidth: 0
  },
  linkCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22
  },
  linkCardDescription: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6
  },
  videoFrame: {
    alignSelf: 'stretch',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    marginTop: 8,
    overflow: 'hidden'
  },
  webView: {
    flex: 1
  },
  blockedWebView: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 12
  }
});

const terminalStyles = StyleSheet.create({
  report: {
    alignSelf: 'stretch',
    marginBottom: 12,
    marginTop: 8
  },
  tabRow: {
    paddingBottom: 0,
    paddingHorizontal: 0
  },
  tabButton: {
    borderRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: -StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
    zIndex: 1
  },
  tabButtonFirst: {
    borderTopLeftRadius: 8
  },
  tabButtonLast: {
    borderTopRightRadius: 8,
    marginRight: 0
  },
  tabButtonActive: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: -StyleSheet.hairlineWidth,
    zIndex: 2
  },
  tabButtonInactive: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18
  },
  contentPanel: {
    alignSelf: 'stretch',
    borderRadius: 8,
    borderTopLeftRadius: 0,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: -StyleSheet.hairlineWidth,
    padding: 8
  },
  codePanel: {
    alignSelf: 'stretch',
    backgroundColor: '#111827',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
    marginTop: 0,
    padding: 12
  },
  codeText: {
    color: '#d1d5db',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19
  }
});
