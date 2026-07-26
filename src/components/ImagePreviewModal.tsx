import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, useWindowDimensions, View, type ImageURISource } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ResumableZoom, fitContainer } from 'react-native-zoom-toolkit';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { imageSourceFromUrl, visibleImagePreviewThumbnails, type ImagePreviewList } from '../htmlImages';
import { createStyles, type ReaderTheme } from '../theme';
import { cachedCompatibleSvgArtifact, compatibleImageRequestIdentity, recoverCompatibleSvgArtifact, refreshCompatibleSvgPoster, type CompatibleSvgArtifact } from '../compatibleImageSources';
import { useForumMediaRequestContext } from '../mediaSessionEpoch';
import { forumMediaTargetClass, type ForumMediaRequestContext } from '../mediaRequestContext';
import { beginDiagnosticTrace, finishDiagnosticTrace, type DiagnosticTrace } from '../diagnostics';
import { CompatibleSvgDocumentView } from './CompatibleSvgDocumentView';

const EMPTY_PREVIEW_URLS: string[] = [];

type PreviewRequest = {
  recovering: boolean;
  settled: boolean;
};

type ImagePreviewModalProps = {
  preview: ImagePreviewList | null;
  nodeSeekMediaUserAgent?: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSave: () => void;
  onSelect: (index: number) => void;
};

function CompatiblePreviewThumbnail({
  url,
  mediaContext,
  nodeSeekUserAgent,
  styles
}: {
  url: string;
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const originalSource = useMemo(
    () => imageSourceFromUrl(
      url,
      { mediaContext, nodeSeekUserAgent }
    ) as ImageURISource,
    [mediaContext, nodeSeekUserAgent, url]
  );
  const requestIdentity = compatibleImageRequestIdentity(originalSource);
  const requestIdentityRef = useRef(requestIdentity);
  const recoveryIdentityRef = useRef('');
  const posterRefreshIdentityRef = useRef('');
  const [compatibleArtifact, setCompatibleArtifact] = useState<CompatibleSvgArtifact | null>(null);
  const activeArtifact = compatibleArtifact?.requestIdentity === requestIdentity
    ? compatibleArtifact
    : cachedCompatibleSvgArtifact(originalSource);

  useEffect(() => {
    requestIdentityRef.current = requestIdentity;
    recoveryIdentityRef.current = '';
    posterRefreshIdentityRef.current = '';
  }, [requestIdentity]);

  const recoverThumbnailArtifact = useCallback(() => {
    if (recoveryIdentityRef.current === requestIdentity) {
      return Promise.resolve(null);
    }
    recoveryIdentityRef.current = requestIdentity;
    return recoverCompatibleSvgArtifact(originalSource);
  }, [originalSource, requestIdentity]);

  const refreshThumbnailPoster = useCallback((artifact: CompatibleSvgArtifact) => {
    if (posterRefreshIdentityRef.current === requestIdentity) {
      return Promise.resolve(null);
    }
    posterRefreshIdentityRef.current = requestIdentity;
    return refreshCompatibleSvgPoster(artifact);
  }, [requestIdentity]);

  const recoverThumbnail = useCallback(async () => {
    try {
      const artifact = activeArtifact
        ? await refreshThumbnailPoster(activeArtifact)
        : await recoverThumbnailArtifact();
      if (requestIdentityRef.current === requestIdentity && artifact) {
        setCompatibleArtifact(artifact);
      }
    } catch {
      // A failed thumbnail stays on the existing image error state; the active preview settles separately.
    }
  }, [activeArtifact, recoverThumbnailArtifact, refreshThumbnailPoster, requestIdentity]);

  return (
    <ExpoImage
      source={activeArtifact?.posterSource || originalSource}
      style={styles.imagePreviewThumbnailImage}
      contentFit="cover"
      recyclingKey={`thumbnail:${mediaContext.sessionIdentity}:${url}:${activeArtifact?.posterRevision ?? 'native'}`}
      onError={() => {
        void recoverThumbnail();
      }}
    />
  );
}

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const mediaContext = useForumMediaRequestContext(props.preview?.contentSource);
  const activeIndex = props.preview?.index ?? 0;
  const activeUri = props.preview?.urls[activeIndex] || '';
  return (
    <ImagePreviewModalContent
      key={`${mediaContext.sessionIdentity}\u0000${activeIndex}\u0000${activeUri}\u0000${props.nodeSeekMediaUserAgent || ''}`}
      {...props}
      mediaContext={mediaContext}
    />
  );
}

function ImagePreviewModalContent({
  preview,
  nodeSeekMediaUserAgent,
  mediaContext,
  styles,
  theme,
  onClose,
  onNext,
  onPrevious,
  onSave,
  onSelect
}: ImagePreviewModalProps & { mediaContext: ForumMediaRequestContext }) {
  const { width, height } = useWindowDimensions();
  const previewUrls = preview?.urls || EMPTY_PREVIEW_URLS;
  const previewCount = previewUrls.length;
  const activeIndex = preview?.index ?? 0;
  const activeUri = previewUrls[activeIndex] || '';
  const previewKey = `${mediaContext.sessionIdentity}:${activeIndex}:${activeUri}`;
  const originalImageSource = useMemo(() => imageSourceFromUrl(
    activeUri,
    { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent }
  ) as ImageURISource, [activeUri, mediaContext, nodeSeekMediaUserAgent]);
  const imageRequestIdentity = compatibleImageRequestIdentity(originalImageSource);
  const previewRequest = useRef<PreviewRequest>({
    recovering: false,
    settled: false
  }).current;
  const mountedRef = useRef(true);
  const previewDiagnosticRef = useRef<{
    fallback: boolean;
    requestIdentity: string;
    trace: DiagnosticTrace;
  } | null>(null);
  const [compatibleSvgArtifact, setCompatibleSvgArtifact] = useState<CompatibleSvgArtifact | null>(null);
  const [imageState, setImageState] = useState<{
    request: PreviewRequest | null;
    requestIdentity: string;
    resolution: { width: number; height: number } | null;
    status: 'loading' | 'loaded' | 'failed';
  }>({ request: null, requestIdentity: '', resolution: null, status: 'loading' });
  const activeImageState = imageState.request === previewRequest
    ? imageState
    : { request: previewRequest, requestIdentity: imageRequestIdentity, resolution: null, status: 'loading' as const };
  const cachedArtifact = cachedCompatibleSvgArtifact(originalImageSource);
  const activeArtifact = compatibleSvgArtifact?.requestIdentity === imageRequestIdentity
    ? compatibleSvgArtifact
    : cachedArtifact;
  const thumbnailItems = useMemo(() => (previewCount ? visibleImagePreviewThumbnails(previewUrls, activeIndex) : []), [activeIndex, previewCount, previewUrls]);
  const currentPreviewTrace = useCallback((fallback = false) => {
    const previous = previewDiagnosticRef.current;
    if (previous?.requestIdentity !== imageRequestIdentity) {
      if (previous) {
        finishDiagnosticTrace(previous.trace, 'stale', { fallback: previous.fallback ? 'svg' : 'none', terminalReason: 'stale' });
      }
      previewDiagnosticRef.current = {
        fallback,
        requestIdentity: imageRequestIdentity,
        trace: beginDiagnosticTrace('media', 'load', {
          mediaClass: forumMediaTargetClass(activeUri, mediaContext.contentSource),
          source: mediaContext.contentSource || 'unknown',
          surface: 'preview'
        })
      };
    } else if (fallback && previous) {
      previous.fallback = true;
    }
    return previewDiagnosticRef.current;
  }, [activeUri, imageRequestIdentity, mediaContext.contentSource]);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => () => {
    const active = previewDiagnosticRef.current;
    if (active?.requestIdentity === imageRequestIdentity) {
      finishDiagnosticTrace(active.trace, 'stale', { fallback: active.fallback ? 'svg' : 'none', terminalReason: 'stale' });
      previewDiagnosticRef.current = null;
    }
  }, [imageRequestIdentity]);
  useEffect(() => {
    if (!activeUri) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      if (
        !mountedRef.current
        || previewRequest.settled
      ) {
        return;
      }
      previewRequest.settled = true;
      previewRequest.recovering = false;
      const diagnostic = currentPreviewTrace();
      if (diagnostic) {
        finishDiagnosticTrace(diagnostic.trace, 'failure', {
          fallback: diagnostic.fallback ? 'svg' : 'none',
          terminalReason: 'timeout'
        });
        previewDiagnosticRef.current = null;
      }
      setImageState({ request: previewRequest, requestIdentity: imageRequestIdentity, resolution: null, status: 'failed' });
    }, 30_000);
    return () => clearTimeout(timeout);
  }, [activeUri, currentPreviewTrace, imageRequestIdentity, previewRequest]);

  const previewResolution = activeImageState.resolution || activeArtifact?.dimensions || null;
  const imagePreviewSize = useMemo(() => {
    if (!previewResolution?.width || !previewResolution.height) {
      return { width, height };
    }
    return fitContainer(previewResolution.width / previewResolution.height, { width, height });
  }, [height, previewResolution, width]);

  const imagePreviewMaxScale = useMemo(() => {
    if (!previewResolution?.width || !previewResolution.height || !imagePreviewSize.width || !imagePreviewSize.height) {
      return 6;
    }
    const pixelScale = Math.max(previewResolution.width / imagePreviewSize.width, previewResolution.height / imagePreviewSize.height);
    return Math.max(3, Math.min(8, pixelScale));
  }, [imagePreviewSize, previewResolution]);

  const settlePreviewLoaded = useCallback((resolution: { height: number; width: number } | null, fallback: boolean) => {
    if (!mountedRef.current || previewRequest.settled) {
      return;
    }
    previewRequest.settled = true;
    previewRequest.recovering = false;
    const diagnostic = currentPreviewTrace(fallback);
    if (diagnostic) {
      finishDiagnosticTrace(diagnostic.trace, 'success', {
        fallback: fallback ? 'svg' : 'none',
        terminalReason: fallback ? 'fallback-loaded' : 'loaded'
      });
      previewDiagnosticRef.current = null;
    }
    setImageState({ request: previewRequest, requestIdentity: imageRequestIdentity, resolution, status: 'loaded' });
  }, [currentPreviewTrace, imageRequestIdentity, previewRequest]);

  const settlePreviewFailure = useCallback((fallback: boolean, terminalReason: 'fallback-error' | 'native-error') => {
    if (!mountedRef.current || previewRequest.settled) {
      return;
    }
    previewRequest.settled = true;
    previewRequest.recovering = false;
    const diagnostic = currentPreviewTrace(fallback);
    if (diagnostic) {
      finishDiagnosticTrace(diagnostic.trace, 'failure', {
        fallback: fallback ? 'svg' : 'none',
        terminalReason
      });
      previewDiagnosticRef.current = null;
    }
    setImageState({ request: previewRequest, requestIdentity: imageRequestIdentity, resolution: null, status: 'failed' });
  }, [currentPreviewTrace, imageRequestIdentity, previewRequest]);

  const recoverSvgArtifact = useCallback(async () => {
    if (!mountedRef.current || previewRequest.settled) {
      return;
    }
    if (activeArtifact) {
      settlePreviewFailure(true, 'fallback-error');
      return;
    }
    if (previewRequest.recovering) {
      return;
    }
    previewRequest.recovering = true;
    currentPreviewTrace(true);
    setImageState({ request: previewRequest, requestIdentity: imageRequestIdentity, resolution: null, status: 'loading' });
    try {
      const artifact = await recoverCompatibleSvgArtifact(originalImageSource);
      if (!mountedRef.current || previewRequest.settled) {
        return;
      }
      if (artifact) {
        setCompatibleSvgArtifact(artifact);
        setImageState({
          request: previewRequest,
          requestIdentity: imageRequestIdentity,
          resolution: artifact.dimensions,
          status: 'loading'
        });
        return;
      }
      settlePreviewFailure(true, 'native-error');
    } catch {
      settlePreviewFailure(true, 'fallback-error');
    }
  }, [activeArtifact, currentPreviewTrace, imageRequestIdentity, originalImageSource, previewRequest, settlePreviewFailure]);

  if (!preview || previewCount === 0) {
    return null;
  }
  const hasMany = previewCount > 1;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.imagePreviewOverlay}>
        <View style={styles.imagePreviewTopBar}>
          <Text style={styles.imagePreviewCount}>{activeIndex + 1} / {previewCount}</Text>
          <View style={styles.imagePreviewTopActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="保存图片" style={styles.imagePreviewTextButton} onPress={onSave}>
              <Text style={styles.imagePreviewButtonText}>保存</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={styles.imagePreviewClose} onPress={onClose}>
              <X size={22} color={theme.onOverlay} strokeWidth={1.8} />
            </Pressable>
          </View>
        </View>
        <View style={styles.imagePreviewScroll}>
          <ResumableZoom
            key={`${previewKey}:${activeArtifact ? 'svg-document' : 'native'}`}
            style={styles.imagePreviewScroll}
            maxScale={imagePreviewMaxScale}
            extendGestures
          >
            {activeArtifact ? (
              <CompatibleSvgDocumentView
                artifact={activeArtifact}
                style={[styles.imagePreviewImage, imagePreviewSize]}
                onLoad={() => settlePreviewLoaded(activeArtifact.dimensions, true)}
                onError={() => settlePreviewFailure(true, 'fallback-error')}
              />
            ) : (
              <ExpoImage
                key={`${imageRequestIdentity}:native`}
                contentFit="contain"
                recyclingKey={`${mediaContext.sessionIdentity}:${activeUri}:native`}
                source={originalImageSource}
                style={[styles.imagePreviewImage, imagePreviewSize]}
                onLoadStart={() => {
                  if (!mountedRef.current || previewRequest.settled) {
                    return;
                  }
                  currentPreviewTrace(false);
                  setImageState({ request: previewRequest, requestIdentity: imageRequestIdentity, resolution: null, status: 'loading' });
                }}
                onLoad={(event) => {
                  const source = event.source;
                  settlePreviewLoaded(source.width > 0 && source.height > 0
                    ? { width: source.width, height: source.height }
                    : null, false);
                }}
                onError={recoverSvgArtifact}
              />
            )}
          </ResumableZoom>
        </View>
        {activeImageState.status === 'loading' ? (
          <View style={styles.imagePreviewState}>
            <ActivityIndicator color={theme.onOverlay} />
            <Text style={styles.imagePreviewStateText}>图片加载中...</Text>
          </View>
        ) : null}
        {activeImageState.status === 'failed' ? (
          <View style={styles.imagePreviewState}>
            <Text style={styles.imagePreviewStateText}>图片加载失败</Text>
          </View>
        ) : null}
        {hasMany ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imagePreviewThumbnailRail} contentContainerStyle={styles.imagePreviewThumbnailContent}>
            {thumbnailItems.map(({ url, index }) => (
              <Pressable key={`${url}-${index}`} accessibilityRole="button" accessibilityLabel={`查看第 ${index + 1} 张图片`} style={[styles.imagePreviewThumbnail, index === activeIndex && styles.imagePreviewThumbnailActive]} onPress={() => onSelect(index)}>
                <CompatiblePreviewThumbnail
                  url={url}
                  mediaContext={mediaContext}
                  nodeSeekUserAgent={nodeSeekMediaUserAgent}
                  styles={styles}
                />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {hasMany ? (
          <View style={styles.imagePreviewControls}>
            <Pressable accessibilityRole="button" accessibilityLabel="上一张图片" style={styles.imagePreviewControl} onPress={onPrevious}>
              <ChevronLeft size={25} color={theme.onOverlay} strokeWidth={1.8} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="下一张图片" style={styles.imagePreviewControl} onPress={onNext}>
              <ChevronRight size={25} color={theme.onOverlay} strokeWidth={1.8} />
            </Pressable>
          </View>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}
