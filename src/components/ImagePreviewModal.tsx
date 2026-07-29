import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type ImageURISource
} from 'react-native';
import { Image as ExpoImage, type ImageLoadEventData, type ImageProgressEventData } from 'expo-image';
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ResumableZoom, fitContainer, type ResumableZoomRefType } from 'react-native-zoom-toolkit';
import { X } from 'lucide-react-native';
import { imageSourceFromUrl, type ImagePreviewItem, type ImagePreviewList } from '../htmlImages';
import { createStyles, type ReaderTheme } from '../theme';
import {
  cachedCompatibleSvgArtifact,
  compatibleImageRequestIdentity,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster,
  type CompatibleSvgArtifact
} from '../compatibleImageSources';
import { useForumMediaRequestContext } from '../mediaSessionEpoch';
import { forumMediaTargetClass, type ForumMediaRequestContext } from '../mediaRequestContext';
import {
  beginDiagnosticTrace,
  diagnosticRef,
  finishDiagnosticTrace,
  type DiagnosticFields,
  type DiagnosticTrace
} from '../diagnostics';
import { CompatibleSvgDocumentView } from './CompatibleSvgDocumentView';

const EMPTY_PREVIEW_ITEMS: ImagePreviewItem[] = [];
const IMAGE_LOAD_TIMEOUT_MS = 30_000;
const PAGE_SWIPE_DISTANCE_RATIO = 0.18;
const PAGE_SWIPE_VELOCITY = 800;
const PULL_CLOSE_DISTANCE_RATIO = 0.25;
const PULL_CLOSE_VELOCITY = 1_200;

type PreviewStatus = 'failed' | 'loaded' | 'loading';
type PreviewResolution = { height: number; width: number };
type PreviewImageLoadMetrics = {
  cacheType?: ImageLoadEventData['cacheType'];
  firstProgressAt?: number;
  loadedAt?: number;
  loadedBytes?: number;
  sourceHeight?: number;
  sourceIdentity: string;
  sourceWidth?: number;
  startedAt: number;
  totalBytes?: number;
};

type ImagePreviewModalProps = {
  preview: ImagePreviewList | null;
  nodeSeekMediaUserAgent?: string;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onClose: () => void;
  onSave: () => void;
  onSelect: (index: number) => void;
};

type PreviewPageProps = {
  active: boolean;
  activeZoomed: boolean;
  animatedSvgZoomSuspended: boolean;
  height: number;
  index: number;
  item: ImagePreviewItem;
  maxScale: number;
  mediaContext: ForumMediaRequestContext;
  nodeSeekUserAgent?: string;
  onRegisterZoom: (index: number, reference: ResumableZoomRefType | null) => void;
  onResolution: (requestIdentity: string, resolution: PreviewResolution) => void;
  onToggleChrome: () => void;
  onZoomGestureSettled: (index: number, scale: number) => void;
  onZoomGestureStart: (index: number) => void;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  width: number;
};

type VerticalPullState = {
  released: boolean;
  translateY: number;
  velocityY: number;
};

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const mediaContext = useForumMediaRequestContext(props.preview?.contentSource);
  return <ImagePreviewModalContent key={mediaContext.sessionIdentity} {...props} mediaContext={mediaContext} />;
}

function ImagePreviewModalContent({
  preview,
  nodeSeekMediaUserAgent,
  mediaContext,
  styles,
  theme,
  onClose,
  onSave,
  onSelect
}: ImagePreviewModalProps & { mediaContext: ForumMediaRequestContext }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const previewItems = preview?.items || EMPTY_PREVIEW_ITEMS;
  const previewCount = previewItems.length;
  const requestedIndex = clampIndex(preview?.index ?? 0, previewCount);
  const [activeIndex, setActiveIndex] = useState(requestedIndex);
  const [activeZoomed, setActiveZoomed] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [pagerScrollEnabled, setPagerScrollEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [animatedSvgZoomSuspended, setAnimatedSvgZoomSuspended] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, PreviewResolution>>({});
  const pagerRef = useRef<PagerView>(null);
  const zoomRefs = useRef(new Map<number, ResumableZoomRefType>());
  const activeIndexRef = useRef(requestedIndex);
  const requestedIndexRef = useRef(requestedIndex);
  const previewOpenRef = useRef(Boolean(preview));
  const mountedRef = useRef(true);
  const overlayOpacity = useSharedValue(1);
  const pullTranslateY = useSharedValue(0);
  const closing = useSharedValue(false);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (requestedIndexRef.current === requestedIndex) {
      return;
    }
    requestedIndexRef.current = requestedIndex;
    zoomRefs.current.get(activeIndexRef.current)?.reset(false);
    activeIndexRef.current = requestedIndex;
    setActiveZoomed(false);
    setAnimatedSvgZoomSuspended(false);
    setPagerScrollEnabled(true);
    setActiveIndex(requestedIndex);
    pagerRef.current?.setScrollEnabled(true);
    pagerRef.current?.setPageWithoutAnimation(requestedIndex);
  }, [requestedIndex]);

  useEffect(() => {
    const previewOpen = Boolean(preview);
    if (previewOpen && !previewOpenRef.current) {
      setChromeVisible(true);
      setActiveZoomed(false);
      setAnimatedSvgZoomSuspended(false);
      setPagerScrollEnabled(true);
      pagerRef.current?.setScrollEnabled(true);
    }
    previewOpenRef.current = previewOpen;
    closing.value = false;
    overlayOpacity.value = 1;
    pullTranslateY.value = 0;
  }, [closing, overlayOpacity, preview, pullTranslateY]);

  const activeItem = previewItems[activeIndex];
  const activeRequestIdentity = activeItem
    ? previewResolutionIdentity(mediaContext.sessionIdentity, activeItem.originalUri)
    : '';
  const activeResolution = resolutions[activeRequestIdentity] || activeItem?.displaySize || null;
  const imagePreviewMaxScale = useMemo(() => {
    if (!activeResolution?.width || !activeResolution.height) {
      return 6;
    }
    const fitted = fitContainer(activeResolution.width / activeResolution.height, { width, height });
    if (!fitted.width || !fitted.height) {
      return 6;
    }
    const pixelScale = Math.max(activeResolution.width / fitted.width, activeResolution.height / fitted.height);
    return Math.max(3, Math.min(8, pixelScale));
  }, [activeResolution, height, width]);

  const handleResolution = useCallback((requestIdentity: string, resolution: PreviewResolution) => {
    setResolutions((current) => {
      const previous = current[requestIdentity];
      if (previous?.width === resolution.width && previous.height === resolution.height) {
        return current;
      }
      return { ...current, [requestIdentity]: resolution };
    });
  }, []);

  const handleIndexChange = useCallback((index: number) => {
    if (!mountedRef.current) {
      return;
    }
    const nextIndex = clampIndex(index, previewCount);
    const previousIndex = activeIndexRef.current;
    if (nextIndex === previousIndex) {
      return;
    }
    zoomRefs.current.get(previousIndex)?.reset(false);
    requestedIndexRef.current = nextIndex;
    activeIndexRef.current = nextIndex;
    setActiveZoomed(false);
    setAnimatedSvgZoomSuspended(false);
    setPagerScrollEnabled(true);
    pagerRef.current?.setScrollEnabled(true);
    setActiveIndex(nextIndex);
    onSelect(nextIndex);
  }, [onSelect, previewCount]);

  const handlePageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    handleIndexChange(event.nativeEvent.position);
  }, [handleIndexChange]);

  const moveToIndex = useCallback((index: number) => {
    const nextIndex = clampIndex(index, previewCount);
    if (nextIndex === activeIndexRef.current) {
      return;
    }
    zoomRefs.current.get(activeIndexRef.current)?.reset(false);
    setActiveZoomed(false);
    setAnimatedSvgZoomSuspended(false);
    setPagerScrollEnabled(true);
    pagerRef.current?.setScrollEnabled(true);
    pagerRef.current?.setPage(nextIndex);
  }, [previewCount]);

  const moveFromIndex = useCallback((startIndex: number, delta: number) => {
    if (activeIndexRef.current !== startIndex) {
      return;
    }
    moveToIndex(startIndex + delta);
  }, [moveToIndex]);

  const handleAccessibilityAction = useCallback((event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === 'increment') {
      moveToIndex(activeIndex + 1);
    } else if (event.nativeEvent.actionName === 'decrement') {
      moveToIndex(activeIndex - 1);
    }
  }, [activeIndex, moveToIndex]);

  const handleSave = useCallback(async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave();
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }, [onSave, saving]);

  const registerZoom = useCallback((index: number, reference: ResumableZoomRefType | null) => {
    if (reference) {
      zoomRefs.current.set(index, reference);
    } else {
      zoomRefs.current.delete(index);
    }
  }, []);
  const handleZoomGestureStart = useCallback((index: number) => {
    if (activeIndexRef.current !== index) {
      return;
    }
    setPagerScrollEnabled(false);
    pagerRef.current?.setScrollEnabled(false);
    setAnimatedSvgZoomSuspended(true);
  }, []);
  const handleZoomGestureSettled = useCallback((index: number, scale: number) => {
    if (activeIndexRef.current !== index) {
      return;
    }
    const zoomed = Math.abs(scale - 1) > 0.001;
    setActiveZoomed(zoomed);
    setPagerScrollEnabled(!zoomed);
    pagerRef.current?.setScrollEnabled(!zoomed);
    setAnimatedSvgZoomSuspended(zoomed);
  }, []);

  const handleVerticalPull = useCallback(({ released, translateY, velocityY }: VerticalPullState) => {
    'worklet';
    const distance = Math.max(0, translateY);
    pullTranslateY.value = distance;
    overlayOpacity.value = Math.max(0.2, 1 - distance / Math.max(1, height * 0.5));
    if (!released) {
      return;
    }
    if (distance >= height * PULL_CLOSE_DISTANCE_RATIO || velocityY >= PULL_CLOSE_VELOCITY) {
      if (!closing.value) {
        closing.value = true;
        scheduleOnRN(onClose);
      }
      return;
    }
    pullTranslateY.value = withTiming(0);
    overlayOpacity.value = withTiming(1);
  }, [closing, height, onClose, overlayOpacity, pullTranslateY]);

  const pullToCloseGesture = useMemo(() => Gesture.Pan()
    .enabled(pagerScrollEnabled)
    .maxPointers(1)
    .activeOffsetY(12)
    .failOffsetX([-12, 12])
    .onUpdate((event) => {
      'worklet';
      handleVerticalPull({
        released: false,
        translateY: Math.max(0, event.translationY),
        velocityY: event.velocityY
      });
    })
    .onEnd((event) => {
      'worklet';
      handleVerticalPull({
        released: true,
        translateY: Math.max(0, event.translationY),
        velocityY: event.velocityY
      });
    })
    .onFinalize((_event, success) => {
      'worklet';
      if (!success) {
        pullTranslateY.value = withTiming(0);
        overlayOpacity.value = withTiming(1);
      }
    }), [handleVerticalPull, overlayOpacity, pagerScrollEnabled, pullTranslateY]);
  const horizontalPageGesture = useMemo(() => Gesture.Pan()
    .enabled(pagerScrollEnabled)
    .maxPointers(1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onEnd((event) => {
      'worklet';
      const horizontalDistance = Math.abs(event.translationX);
      const verticalDistance = Math.abs(event.translationY);
      const horizontalVelocity = Math.abs(event.velocityX);
      const verticalVelocity = Math.abs(event.velocityY);
      if (
        horizontalDistance <= verticalDistance
        || (
          horizontalDistance < width * PAGE_SWIPE_DISTANCE_RATIO
          && (horizontalVelocity < PAGE_SWIPE_VELOCITY || horizontalVelocity <= verticalVelocity)
        )
      ) {
        return;
      }
      const signedMovement = horizontalDistance > 1 ? event.translationX : event.velocityX;
      if (signedMovement !== 0) {
        scheduleOnRN(moveFromIndex, activeIndex, signedMovement < 0 ? 1 : -1);
      }
    }), [activeIndex, moveFromIndex, pagerScrollEnabled, width]);
  const pagerGesture = useMemo(
    () => Gesture.Simultaneous(pullToCloseGesture, horizontalPageGesture, Gesture.Native()),
    [horizontalPageGesture, pullToCloseGesture]
  );

  const backgroundStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }), [overlayOpacity]);
  const pagerPullStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: pullTranslateY.value }]
  }), [pullTranslateY]);

  if (!preview || previewCount === 0) {
    return null;
  }

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <GestureHandlerRootView style={[styles.imagePreviewOverlay, componentStyles.transparentOverlay]}>
        <Animated.View pointerEvents="none" style={[componentStyles.overlayBackground, backgroundStyle]} />
        <GestureDetector gesture={pagerGesture}>
          <Animated.View style={[styles.imagePreviewScroll, pagerPullStyle]}>
            <PagerView
              ref={pagerRef}
              testID="image-preview-pager"
              initialPage={requestedIndex}
              offscreenPageLimit={1}
              orientation="horizontal"
              overScrollMode="never"
              overdrag={false}
              scrollEnabled={pagerScrollEnabled}
              style={componentStyles.pagerPage}
              onPageSelected={handlePageSelected}
            >
              {previewItems.map((item, index) => (
                <View
                  key={`${index}\u0000${mediaContext.sessionIdentity}\u0000${item.originalUri}\u0000${nodeSeekMediaUserAgent || ''}`}
                  collapsable={false}
                  style={componentStyles.pagerPage}
                >
                  {Math.abs(index - activeIndex) <= 1 ? (
                    <PreviewPagerPage
                      active={index === activeIndex}
                      activeZoomed={index === activeIndex && activeZoomed}
                      animatedSvgZoomSuspended={index === activeIndex && animatedSvgZoomSuspended}
                      height={height}
                      index={index}
                      item={item}
                      maxScale={imagePreviewMaxScale}
                      mediaContext={mediaContext}
                      nodeSeekUserAgent={nodeSeekMediaUserAgent}
                      onRegisterZoom={registerZoom}
                      onResolution={handleResolution}
                      onToggleChrome={() => setChromeVisible((current) => !current)}
                      onZoomGestureSettled={handleZoomGestureSettled}
                      onZoomGestureStart={handleZoomGestureStart}
                      styles={styles}
                      theme={theme}
                      width={width}
                    />
                  ) : null}
                </View>
              ))}
            </PagerView>
          </Animated.View>
        </GestureDetector>
        <View
          accessible
          accessibilityActions={[
            { name: 'decrement', label: '上一张图片' },
            { name: 'increment', label: '下一张图片' }
          ]}
          accessibilityLabel={`图片预览，第 ${activeIndex + 1} 张，共 ${previewCount} 张`}
          accessibilityRole="adjustable"
          accessibilityValue={{
            min: 1,
            max: previewCount,
            now: activeIndex + 1,
            text: `第 ${activeIndex + 1} 张，共 ${previewCount} 张`
          }}
          pointerEvents="none"
          style={componentStyles.accessibilityPager}
          onAccessibilityAction={handleAccessibilityAction}
        />
        {chromeVisible ? (
          <>
            <View pointerEvents="box-none" style={[styles.imagePreviewTopBar, { top: Math.max(insets.top, 12) }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="关闭图片预览" style={styles.imagePreviewClose} onPress={onClose}>
                <X size={22} color={theme.onOverlay} strokeWidth={1.8} />
              </Pressable>
              <Text accessibilityLiveRegion="polite" style={styles.imagePreviewCount}>{activeIndex + 1}/{previewCount}</Text>
              <View style={componentStyles.chromeSpacer} />
            </View>
            <View pointerEvents="box-none" style={[componentStyles.bottomBar, { bottom: Math.max(insets.bottom, 16) }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="保存图片"
                accessibilityState={{ busy: saving, disabled: saving }}
                disabled={saving}
                style={[styles.imagePreviewTextButton, saving && componentStyles.disabledButton]}
                onPress={() => {
                  void handleSave();
                }}
              >
                <Text style={styles.imagePreviewButtonText}>{saving ? '保存中…' : '保存'}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </GestureHandlerRootView>
    </Modal>
  );
}

function PreviewPagerPage({
  active,
  activeZoomed,
  animatedSvgZoomSuspended,
  height,
  index,
  item,
  maxScale,
  mediaContext,
  nodeSeekUserAgent,
  onRegisterZoom,
  onResolution,
  onToggleChrome,
  onZoomGestureSettled,
  onZoomGestureStart,
  styles,
  theme,
  width
}: PreviewPageProps) {
  const originalSource = useMemo(() => imageSourceFromUrl(
    item.originalUri,
    { mediaContext, nodeSeekUserAgent }
  ) as ImageURISource, [item.originalUri, mediaContext, nodeSeekUserAgent]);
  const displaySource = useMemo(() => imageSourceFromUrl(
    item.displayUri,
    { mediaContext, nodeSeekUserAgent }
  ) as ImageURISource, [item.displayUri, mediaContext, nodeSeekUserAgent]);
  const requestIdentity = compatibleImageRequestIdentity(originalSource);
  const resolutionIdentity = previewResolutionIdentity(mediaContext.sessionIdentity, item.originalUri);
  const [retryVersion, setRetryVersion] = useState(0);
  const [fullQuality, setFullQuality] = useState(active);
  const [resolution, setResolution] = useState<PreviewResolution | null>(item.displaySize || null);
  const [compatibleSvgArtifact, setCompatibleSvgArtifact] = useState<CompatibleSvgArtifact | null>(null);
  const zoomRef = useRef<ResumableZoomRefType>(null);
  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  const settledRef = useRef(false);
  const recoveringRef = useRef(false);
  const nativeFailedRef = useRef(false);
  const posterRefreshRef = useRef({ attempted: false, inFlight: false, sourceIdentity: '' });
  const requestGenerationRef = useRef(0);
  const cachedArtifact = useMemo(() => cachedCompatibleSvgArtifact(originalSource), [originalSource]);
  const knownArtifact = compatibleSvgArtifact?.requestIdentity === requestIdentity
    ? compatibleSvgArtifact
    : cachedArtifact;
  const activeArtifact = active ? knownArtifact : null;
  const activeAnimatedArtifact = activeArtifact?.animated ? activeArtifact : null;
  const sourceIdentity = `${requestIdentity}\u0000${retryVersion}`;
  const svgViewIdentity = activeAnimatedArtifact
    ? `${sourceIdentity}\u0000${activeAnimatedArtifact.requestIdentity}`
    : '';
  const [readySvgViewIdentity, setReadySvgViewIdentity] = useState('');
  const [displayedSvgPosterIdentity, setDisplayedSvgPosterIdentity] = useState('');
  const svgPosterIdentity = activeAnimatedArtifact
    ? `${svgViewIdentity}\u0000${activeAnimatedArtifact.posterRevision}`
    : '';
  const animatedSvgPosterReady = displayedSvgPosterIdentity === svgPosterIdentity;
  const sourceIdentityRef = useRef(sourceIdentity);
  const loadMetricsRef = useRef<PreviewImageLoadMetrics>({
    sourceIdentity,
    startedAt: Date.now()
  });
  const previewDiagnosticRef = useRef<{ fallback: boolean; trace: DiagnosticTrace } | null>(null);
  const [imageState, setImageState] = useState<{ sourceIdentity: string; status: PreviewStatus }>({
    sourceIdentity,
    status: 'loading'
  });
  activeRef.current = active;
  const status = imageState.sourceIdentity === sourceIdentity ? imageState.status : 'loading';
  const setCurrentStatus = useCallback((nextStatus: PreviewStatus) => {
    setImageState({ sourceIdentity, status: nextStatus });
  }, [sourceIdentity]);
  const attachZoomRef = useCallback((reference: ResumableZoomRefType | null) => {
    zoomRef.current = reference;
    onRegisterZoom(index, reference);
  }, [index, onRegisterZoom]);
  const settleZoomGesture = useCallback(() => {
    onZoomGestureSettled(index, zoomRef.current?.getState().scale ?? 1);
  }, [index, onZoomGestureSettled]);

  const finishActiveDiagnostic = useCallback((
    outcome: 'failure' | 'stale' | 'success',
    fallback: boolean,
    terminalReason: string,
    fields: DiagnosticFields = {},
    finishedAt = Date.now()
  ) => {
    const diagnostic = previewDiagnosticRef.current;
    if (!diagnostic) {
      return;
    }
    finishDiagnosticTrace(diagnostic.trace, outcome, {
      ...fields,
      fallback: fallback || diagnostic.fallback ? 'svg' : 'none',
      terminalReason
    }, finishedAt);
    previewDiagnosticRef.current = null;
  }, []);

  const currentDiagnostic = useCallback((fallback = false) => {
    if (!activeRef.current) {
      return null;
    }
    if (!previewDiagnosticRef.current) {
      previewDiagnosticRef.current = {
        fallback,
        trace: beginDiagnosticTrace('media', 'load', {
          candidateKind: 'lightbox',
          mediaClass: forumMediaTargetClass(item.originalUri, mediaContext.contentSource),
          mediaRef: diagnosticRef('media', item.originalUri),
          mediaRole: 'preview-active',
          source: mediaContext.contentSource || 'unknown',
          surface: 'preview'
        }, loadMetricsRef.current.startedAt)
      };
    } else if (fallback) {
      previewDiagnosticRef.current.fallback = true;
    }
    return previewDiagnosticRef.current;
  }, [item.originalUri, mediaContext.contentSource]);

  const settleLoaded = useCallback((fallback: boolean) => {
    if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity || settledRef.current) {
      return;
    }
    settledRef.current = true;
    recoveringRef.current = false;
    if (activeRef.current) {
      const displayedAt = Date.now();
      finishActiveDiagnostic(
        'success',
        fallback,
        fallback ? 'fallback-loaded' : 'loaded',
        previewImageMetricFields(loadMetricsRef.current, displayedAt, true),
        displayedAt
      );
    }
    setCurrentStatus('loaded');
  }, [finishActiveDiagnostic, setCurrentStatus, sourceIdentity]);

  const settleFailure = useCallback((fallback: boolean, terminalReason: 'fallback-error' | 'native-error' | 'timeout') => {
    if (
      !mountedRef.current
      || !activeRef.current
      || sourceIdentityRef.current !== sourceIdentity
    ) {
      return;
    }
    nativeFailedRef.current = true;
    settledRef.current = true;
    recoveringRef.current = false;
    finishActiveDiagnostic(
      'failure',
      fallback,
      terminalReason,
      previewImageMetricFields(loadMetricsRef.current)
    );
    setCurrentStatus('failed');
  }, [finishActiveDiagnostic, setCurrentStatus, sourceIdentity]);

  const recoverSvgArtifact = useCallback(async () => {
    if (
      !mountedRef.current
      || !activeRef.current
      || sourceIdentityRef.current !== sourceIdentity
      || settledRef.current
      || recoveringRef.current
    ) {
      return;
    }
    recoveringRef.current = true;
    currentDiagnostic(true);
    setCurrentStatus('loading');
    const generation = requestGenerationRef.current;
    try {
      const artifact = await recoverCompatibleSvgArtifact(originalSource);
      if (
        !mountedRef.current
        || !activeRef.current
        || sourceIdentityRef.current !== sourceIdentity
        || settledRef.current
        || generation !== requestGenerationRef.current
      ) {
        return;
      }
      recoveringRef.current = false;
      if (!artifact) {
        settleFailure(true, 'native-error');
        return;
      }
      setCompatibleSvgArtifact(artifact);
      setResolution(artifact.dimensions);
      loadMetricsRef.current = {
        ...loadMetricsRef.current,
        loadedAt: Date.now(),
        sourceHeight: artifact.dimensions.height,
        sourceWidth: artifact.dimensions.width
      };
      onResolution(resolutionIdentity, artifact.dimensions);
    } catch {
      if (generation === requestGenerationRef.current) {
        settleFailure(true, 'fallback-error');
      }
    }
  }, [currentDiagnostic, onResolution, originalSource, resolutionIdentity, setCurrentStatus, settleFailure, sourceIdentity]);

  const refreshSvgPoster = useCallback(async (artifact: CompatibleSvgArtifact, terminalOnFailure: boolean) => {
    if (
      !mountedRef.current
      || !activeRef.current
      || sourceIdentityRef.current !== sourceIdentity
    ) {
      return;
    }
    if (posterRefreshRef.current.sourceIdentity !== sourceIdentity) {
      posterRefreshRef.current = { attempted: false, inFlight: false, sourceIdentity };
    }
    if (posterRefreshRef.current.inFlight) {
      return;
    }
    if (posterRefreshRef.current.attempted) {
      if (terminalOnFailure) {
        settleFailure(true, 'fallback-error');
      }
      return;
    }
    posterRefreshRef.current.attempted = true;
    posterRefreshRef.current.inFlight = true;
    if (settledRef.current) {
      settledRef.current = false;
      loadMetricsRef.current = { sourceIdentity, startedAt: Date.now() };
    }
    currentDiagnostic(true);
    setCurrentStatus('loading');
    try {
      const refreshed = await refreshCompatibleSvgPoster(artifact);
      if (
        !mountedRef.current
        || sourceIdentityRef.current !== sourceIdentity
      ) {
        return;
      }
      setCompatibleSvgArtifact(refreshed);
      setResolution(refreshed.dimensions);
      onResolution(resolutionIdentity, refreshed.dimensions);
    } catch {
      if (terminalOnFailure) {
        settleFailure(true, 'fallback-error');
      }
    } finally {
      if (posterRefreshRef.current.sourceIdentity === sourceIdentity) {
        posterRefreshRef.current.inFlight = false;
      }
    }
  }, [currentDiagnostic, onResolution, resolutionIdentity, setCurrentStatus, settleFailure, sourceIdentity]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
      finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
    };
  }, [finishActiveDiagnostic]);

  useEffect(() => {
    if (!activeArtifact) {
      return;
    }
    setResolution(activeArtifact.dimensions);
    onResolution(resolutionIdentity, activeArtifact.dimensions);
  }, [activeArtifact, onResolution, resolutionIdentity]);

  useEffect(() => {
    if (!active) {
      if (!nativeFailedRef.current) {
        setFullQuality(false);
      }
      setReadySvgViewIdentity('');
      setDisplayedSvgPosterIdentity('');
      requestGenerationRef.current += 1;
      recoveringRef.current = false;
      finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
      return;
    }
    if (!settledRef.current) {
      if (!previewDiagnosticRef.current) {
        loadMetricsRef.current = {
          sourceIdentity,
          startedAt: Date.now()
        };
      }
      currentDiagnostic(false);
    }
    if (!nativeFailedRef.current) {
      setFullQuality(true);
    }
    if (nativeFailedRef.current && !settledRef.current) {
      void recoverSvgArtifact();
    }
  }, [active, currentDiagnostic, finishActiveDiagnostic, recoverSvgArtifact, sourceIdentity]);

  useEffect(() => {
    if (!active || settledRef.current || status !== 'loading') {
      return undefined;
    }
    const timeout = setTimeout(() => settleFailure(false, 'timeout'), IMAGE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [active, retryVersion, settleFailure, status]);

  const imageSize = useMemo(() => {
    const layoutResolution = knownArtifact?.dimensions || resolution || item.displaySize;
    if (!layoutResolution?.width || !layoutResolution.height) {
      return { width, height };
    }
    return fitContainer(layoutResolution.width / layoutResolution.height, { width, height });
  }, [height, item.displaySize, knownArtifact?.dimensions, resolution, width]);

  const retry = useCallback(() => {
    if (!activeRef.current) {
      return;
    }
    requestGenerationRef.current += 1;
    settledRef.current = false;
    recoveringRef.current = false;
    nativeFailedRef.current = false;
    setFullQuality(true);
    finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
    setCurrentStatus('loading');
    const nextRetryVersion = retryVersion + 1;
    const nextSourceIdentity = `${requestIdentity}\u0000${nextRetryVersion}`;
    sourceIdentityRef.current = nextSourceIdentity;
    loadMetricsRef.current = {
      sourceIdentity: nextSourceIdentity,
      startedAt: Date.now()
    };
    setRetryVersion(nextRetryVersion);
  }, [finishActiveDiagnostic, requestIdentity, retryVersion, setCurrentStatus]);

  return (
    <View testID={`preview-page-${index}`} style={componentStyles.pagerPage}>
      <ResumableZoom
        ref={attachZoomRef}
        extendGestures
        maxScale={maxScale}
        panEnabled={active && activeZoomed}
        pinchEnabled={active}
        style={componentStyles.pagerPage}
        tapsEnabled={active}
        onDoubleTapStart={() => onZoomGestureStart(index)}
        onGestureEnd={settleZoomGesture}
        onPanStart={() => onZoomGestureStart(index)}
        onPinchStart={() => onZoomGestureStart(index)}
        onTap={onToggleChrome}
      >
        <View testID={`preview-zoom-content-${index}`} style={[componentStyles.previewPage, imageSize]}>
          {activeAnimatedArtifact ? (
          <ExpoImage
            key={`${sourceIdentity}:${activeAnimatedArtifact.posterRevision}:continuity`}
            testID={animatedSvgZoomSuspended || readySvgViewIdentity !== svgViewIdentity
              ? `preview-continuity-${index}`
              : undefined}
            cachePolicy="memory-disk"
            contentFit="contain"
            pointerEvents="none"
            priority="high"
            recyclingKey={`${mediaContext.sessionIdentity}:${sourceIdentity}:${activeAnimatedArtifact.posterRevision}:continuity`}
            source={activeAnimatedArtifact.posterSource}
            style={[
              StyleSheet.absoluteFill,
              readySvgViewIdentity === svgViewIdentity
                && (!animatedSvgZoomSuspended || !animatedSvgPosterReady)
                ? componentStyles.hiddenMedia
                : null
            ]}
            onDisplay={() => {
              if (!mountedRef.current || !activeRef.current || sourceIdentityRef.current !== sourceIdentity) {
                return;
              }
              setDisplayedSvgPosterIdentity(svgPosterIdentity);
            }}
            onError={() => {
              setDisplayedSvgPosterIdentity((identity) => identity === svgPosterIdentity ? '' : identity);
              void refreshSvgPoster(activeAnimatedArtifact, false);
            }}
          />
          ) : knownArtifact ? (
            <ExpoImage
              key={`${sourceIdentity}:${knownArtifact.posterRevision}:${active ? 'active' : 'warm'}:poster`}
              allowDownscaling={!active}
              testID={`preview-svg-poster-${index}`}
              cachePolicy="memory-disk"
              contentFit="contain"
              priority={active ? 'high' : 'low'}
              recyclingKey={`${mediaContext.sessionIdentity}:${sourceIdentity}:${knownArtifact.posterRevision}:poster`}
              source={knownArtifact.posterSource}
              style={StyleSheet.absoluteFill}
              onDisplay={() => settleLoaded(true)}
              onError={() => {
                void refreshSvgPoster(knownArtifact, true);
              }}
            />
          ) : (
            <ExpoImage
              allowDownscaling={!fullQuality}
              key={sourceIdentity}
              testID={`preview-image-${index}`}
              cachePolicy="memory-disk"
              contentFit="contain"
              placeholder={displaySource}
              placeholderContentFit="contain"
              priority={active ? 'high' : 'low'}
              recyclingKey={`${mediaContext.sessionIdentity}:${item.originalUri}:${retryVersion}:native`}
              source={originalSource}
              style={StyleSheet.absoluteFill}
              transition={150}
              onDisplay={() => settleLoaded(false)}
              onError={() => {
                if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity) {
                  return;
                }
                nativeFailedRef.current = true;
                if (activeRef.current) {
                  void recoverSvgArtifact();
                }
              }}
              onLoad={(event) => {
                const source = event.source;
                if (source.width > 0 && source.height > 0) {
                  const nextResolution = { width: source.width, height: source.height };
                  if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity) {
                    return;
                  }
                  loadMetricsRef.current = {
                    ...loadMetricsRef.current,
                    cacheType: event.cacheType,
                    loadedAt: Date.now(),
                    sourceHeight: source.height,
                    sourceWidth: source.width
                  };
                  setResolution(nextResolution);
                  onResolution(resolutionIdentity, nextResolution);
                }
              }}
              onLoadStart={() => {
                if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity || settledRef.current) {
                  return;
                }
                if (!previewDiagnosticRef.current) {
                  loadMetricsRef.current = {
                    sourceIdentity,
                    startedAt: Date.now()
                  };
                }
                if (activeRef.current) {
                  currentDiagnostic(false);
                }
                setCurrentStatus('loading');
              }}
              onProgress={(event: ImageProgressEventData) => {
                if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity || settledRef.current) {
                  return;
                }
                const loadedBytes = Number(event.loaded);
                const totalBytes = Number(event.total);
                loadMetricsRef.current = {
                  ...loadMetricsRef.current,
                  ...(loadMetricsRef.current.firstProgressAt === undefined ? { firstProgressAt: Date.now() } : {}),
                  ...(Number.isFinite(loadedBytes) && loadedBytes >= 0 ? { loadedBytes } : {}),
                  ...(Number.isFinite(totalBytes) && totalBytes >= 0 ? { totalBytes } : {})
                };
              }}
            />
          )}
        </View>
      </ResumableZoom>
      {activeAnimatedArtifact ? (
        <View pointerEvents="none" style={componentStyles.documentOverlay}>
          <View style={[componentStyles.previewPage, imageSize]}>
            <CompatibleSvgDocumentView
              key={`${activeAnimatedArtifact.requestIdentity}:${retryVersion}`}
              artifact={activeAnimatedArtifact}
              style={[
                StyleSheet.absoluteFill,
                readySvgViewIdentity === svgViewIdentity
                  && (!animatedSvgZoomSuspended || !animatedSvgPosterReady)
                  ? null
                  : componentStyles.hiddenMedia
              ]}
              onLoad={() => {
                if (!mountedRef.current || !activeRef.current || sourceIdentityRef.current !== sourceIdentity) {
                  return;
                }
                setReadySvgViewIdentity(svgViewIdentity);
                settleLoaded(true);
              }}
              onError={() => settleFailure(true, 'fallback-error')}
            />
          </View>
        </View>
      ) : null}
      {active && status === 'loading' ? (
        <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.imagePreviewState}>
          <ActivityIndicator color={theme.onOverlay} />
          <Text style={styles.imagePreviewStateText}>图片加载中...</Text>
        </View>
      ) : null}
      {active && status === 'failed' ? (
        <View accessibilityRole="alert" style={styles.imagePreviewState}>
          <Text style={styles.imagePreviewStateText}>图片加载失败</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="重试加载图片" style={styles.imagePreviewTextButton} onPress={retry}>
            <Text style={styles.imagePreviewButtonText}>重试</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function clampIndex(index: number, count: number) {
  return Math.max(0, Math.min(index, Math.max(0, count - 1)));
}

function previewResolutionIdentity(sessionIdentity: string, originalUri: string) {
  return `${sessionIdentity}\u0000${originalUri}`;
}

function previewImageMetricFields(
  metrics: PreviewImageLoadMetrics,
  finishedAt = Date.now(),
  includeDisplayTime = false
): DiagnosticFields {
  return {
    ...(metrics.cacheType ? { cacheType: metrics.cacheType } : {}),
    ...(metrics.firstProgressAt === undefined ? {} : { firstProgressMs: Math.max(0, metrics.firstProgressAt - metrics.startedAt) }),
    ...(metrics.loadedAt === undefined ? {} : { loadMs: Math.max(0, metrics.loadedAt - metrics.startedAt) }),
    ...(metrics.loadedBytes === undefined ? {} : { loadedBytes: metrics.loadedBytes }),
    ...(metrics.sourceHeight === undefined ? {} : { sourceHeight: metrics.sourceHeight }),
    ...(metrics.sourceWidth === undefined ? {} : { sourceWidth: metrics.sourceWidth }),
    ...(metrics.totalBytes === undefined ? {} : { totalBytes: metrics.totalBytes }),
    ...(includeDisplayTime ? { displayMs: Math.max(0, finishedAt - metrics.startedAt) } : {})
  };
}

const componentStyles = StyleSheet.create({
  accessibilityPager: {
    ...StyleSheet.absoluteFillObject
  },
  bottomBar: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 2
  },
  chromeSpacer: {
    height: 44,
    width: 44
  },
  disabledButton: {
    opacity: 0.55
  },
  documentOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  hiddenMedia: {
    opacity: 0
  },
  overlayBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000'
  },
  pagerPage: {
    flex: 1
  },
  previewPage: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  transparentOverlay: {
    backgroundColor: 'transparent'
  }
});
