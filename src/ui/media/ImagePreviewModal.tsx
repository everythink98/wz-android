import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PixelRatio,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type ImageURISource
} from 'react-native';
import type { ImageLoadEventData } from 'expo-image';
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent
} from 'react-native-pager-view';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ResumableZoom, fitContainer, type ResumableZoomRefType } from 'react-native-zoom-toolkit';
import { X } from 'lucide-react-native';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { type ImagePreviewItem, type ImagePreviewList } from '@/platform/media/imagePreviewCatalog';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';
import {
  cachedCompatibleSvgArtifact,
  compatibleImageRequestIdentity,
  promoteCachedCompatibleSvgArtifact,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster,
  type CompatibleSvgArtifact
} from '@/platform/media/compatibleImageSources';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import { forumMediaTargetClass, type ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { markOriginalImageDisplayed, originalImageDisplayRevision } from '@/platform/media/originalImageLoading';
import { previewBitmapDecodeTarget } from '@/platform/media/previewBitmapBudget';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticFields, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { useReadNetworkRuntimeGeneration } from '@/platform/network/readNetworkRuntime';
import { CompatibleSvgDocumentView } from '@/ui/content/CompatibleSvgDocumentView';
import { PreviewPageLoadLayer } from './PreviewPageLoadLayer';

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

type PreviewPagerWindowPage = {
  index: number;
  item: ImagePreviewItem;
  slot: number;
};

type PreviewPagerCommand = {
  animated: boolean;
  position: number;
  targetIndex: number;
};

type PreviewPagerDrag = {
  pages: readonly (PreviewPagerWindowPage | null)[] | null;
  selectionHandled: boolean;
};

type PreviewPagerOwnership = {
  command: PreviewPagerCommand | null;
  drag: PreviewPagerDrag | null;
  pendingCommand: PreviewPagerCommand | null;
};

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const mediaContext = useForumMediaRequestContext(props.preview?.contentSource);
  return <ImagePreviewModalContent key={mediaContext.sessionIdentity} {...props} mediaContext={mediaContext} />;
}

function ImagePreviewModalContent({
  preview,
  nodeSeekMediaUserAgent,
  mediaContext,
  onClose,
  onSave,
  onSelect
}: ImagePreviewModalProps & { mediaContext: ForumMediaRequestContext }) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
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
  const pagerWindow = useMemo(() => createPreviewPagerWindow(previewItems, activeIndex), [activeIndex, previewItems]);
  const pagerWindowIdentity = useMemo(
    () =>
      `${activeIndex}\u0001${pagerWindow.slots
        .map(({ page }) =>
          page ? `${page.index}\u0000${page.item.originalUri}\u0000${page.item.displayUri}` : 'empty'
        )
        .join('\u0001')}`,
    [activeIndex, pagerWindow.slots]
  );
  const pagerOwnershipRef = useRef<PreviewPagerOwnership>({
    command: null,
    drag: null,
    pendingCommand: null
  });
  const publishPagerCommand = useCallback((command: PreviewPagerCommand) => {
    const ownership = pagerOwnershipRef.current;
    if (ownership.drag) {
      ownership.drag.pages = null;
      ownership.pendingCommand = command;
      return;
    }
    ownership.command = command;
    ownership.pendingCommand = null;
    if (command.animated) {
      pagerRef.current?.setPage(command.position);
    } else {
      pagerRef.current?.setPageWithoutAnimation(command.position);
    }
  }, []);

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
  }, [requestedIndex]);

  useLayoutEffect(() => {
    if (previewCount === 0) {
      return;
    }
    publishPagerCommand({
      animated: false,
      position: pagerWindow.activePageIndex,
      targetIndex: activeIndex
    });
  }, [activeIndex, pagerWindow.activePageIndex, pagerWindowIdentity, previewCount, publishPagerCommand]);

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

  const handleIndexChange = useCallback(
    (index: number) => {
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
    },
    [onSelect, previewCount]
  );

  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const ownership = pagerOwnershipRef.current;
      const position = event.nativeEvent.position;
      if (ownership.drag) {
        if (ownership.drag.selectionHandled) {
          return;
        }
        ownership.drag.selectionHandled = true;
        const page = ownership.drag.pages?.[position];
        if (page) {
          handleIndexChange(page.index);
        }
        return;
      }
      if (ownership.command) {
        if (ownership.command.position !== position) {
          return;
        }
        const targetIndex = ownership.command.targetIndex;
        ownership.command = null;
        handleIndexChange(targetIndex);
      }
    },
    [handleIndexChange]
  );

  const handlePageScrollStateChanged = useCallback(
    (event: PageScrollStateChangedNativeEvent) => {
      const ownership = pagerOwnershipRef.current;
      if (event.nativeEvent.pageScrollState === 'dragging') {
        if (ownership.drag) {
          return;
        }
        if (ownership.command) {
          ownership.pendingCommand = ownership.command;
          ownership.command = null;
          ownership.drag = { pages: null, selectionHandled: false };
          return;
        }
        ownership.drag = {
          pages: pagerWindow.slots.map(({ page }) => page),
          selectionHandled: false
        };
        return;
      }
      if (event.nativeEvent.pageScrollState === 'idle' && ownership.drag) {
        ownership.drag = null;
        const pendingCommand = ownership.pendingCommand;
        ownership.pendingCommand = null;
        if (pendingCommand) {
          publishPagerCommand(pendingCommand);
        }
      }
    },
    [pagerWindow.slots, publishPagerCommand]
  );

  const moveToIndex = useCallback(
    (index: number) => {
      const nextIndex = clampIndex(index, previewCount);
      if (nextIndex === activeIndexRef.current) {
        return;
      }
      zoomRefs.current.get(activeIndexRef.current)?.reset(false);
      setActiveZoomed(false);
      setAnimatedSvgZoomSuspended(false);
      setPagerScrollEnabled(true);
      pagerRef.current?.setScrollEnabled(true);
      const targetPage = pagerWindow.pages.find((page) => page.index === nextIndex);
      if (targetPage) {
        publishPagerCommand({ animated: true, position: targetPage.slot, targetIndex: nextIndex });
      } else {
        handleIndexChange(nextIndex);
      }
    },
    [handleIndexChange, pagerWindow.pages, previewCount, publishPagerCommand]
  );

  const moveFromIndex = useCallback(
    (startIndex: number, delta: number) => {
      if (activeIndexRef.current !== startIndex) {
        return;
      }
      moveToIndex(startIndex + delta);
    },
    [moveToIndex]
  );

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') {
        moveToIndex(activeIndex + 1);
      } else if (event.nativeEvent.actionName === 'decrement') {
        moveToIndex(activeIndex - 1);
      }
    },
    [activeIndex, moveToIndex]
  );

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

  const handleVerticalPull = useCallback(
    ({ released, translateY, velocityY }: VerticalPullState) => {
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
    },
    [closing, height, onClose, overlayOpacity, pullTranslateY]
  );

  const pullToCloseGesture = useMemo(
    () =>
      Gesture.Pan()
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
        }),
    [handleVerticalPull, overlayOpacity, pagerScrollEnabled, pullTranslateY]
  );
  const horizontalPageGesture = useMemo(
    () =>
      Gesture.Pan()
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
            horizontalDistance <= verticalDistance ||
            (horizontalDistance < width * PAGE_SWIPE_DISTANCE_RATIO &&
              (horizontalVelocity < PAGE_SWIPE_VELOCITY || horizontalVelocity <= verticalVelocity))
          ) {
            return;
          }
          const signedMovement = horizontalDistance > 1 ? event.translationX : event.velocityX;
          if (signedMovement !== 0) {
            scheduleOnRN(moveFromIndex, activeIndex, signedMovement < 0 ? 1 : -1);
          }
        }),
    [activeIndex, moveFromIndex, pagerScrollEnabled, width]
  );
  const pagerGesture = useMemo(
    () => Gesture.Simultaneous(pullToCloseGesture, horizontalPageGesture, Gesture.Native()),
    [horizontalPageGesture, pullToCloseGesture]
  );

  const backgroundStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }), [overlayOpacity]);
  const pagerPullStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateY: pullTranslateY.value }]
    }),
    [pullTranslateY]
  );

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
              initialPage={pagerWindow.activePageIndex}
              offscreenPageLimit={1}
              orientation="horizontal"
              overScrollMode="never"
              overdrag={false}
              scrollEnabled={pagerScrollEnabled}
              style={componentStyles.pagerPage}
              onPageSelected={handlePageSelected}
              onPageScrollStateChanged={handlePageScrollStateChanged}
            >
              {pagerWindow.slots.map(({ page, slot }) => (
                <View key={`preview-physical-slot-${slot}`} collapsable={false} style={componentStyles.pagerPage}>
                  {page ? (
                    <PreviewPagerPage
                      active={page.index === activeIndex}
                      activeZoomed={page.index === activeIndex && activeZoomed}
                      animatedSvgZoomSuspended={page.index === activeIndex && animatedSvgZoomSuspended}
                      height={height}
                      index={page.index}
                      item={page.item}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭图片预览"
                style={styles.imagePreviewClose}
                onPress={onClose}
              >
                <X size={22} color={theme.onOverlay} strokeWidth={1.8} />
              </Pressable>
              <Text accessibilityLiveRegion="polite" style={styles.imagePreviewCount}>
                {activeIndex + 1}/{previewCount}
              </Text>
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

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
  const fontFamily = fontFamilyValue(settings.fontFamily);
  return StyleSheet.create({
    imagePreviewOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000'
    },
    imagePreviewTopBar: {
      position: 'absolute',
      top: 10,
      right: 14,
      left: 14,
      zIndex: 2,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between'
    },
    imagePreviewCount: { color: theme.onOverlay, fontFamily, fontSize: 13, fontWeight: '600' },
    imagePreviewTextButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 58,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewButtonText: { color: theme.onOverlay, fontFamily, fontSize: 13, fontWeight: '700' },
    imagePreviewClose: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.14)'
    },
    imagePreviewScroll: { flex: 1, width: '100%' },
    imagePreviewState: {
      position: 'absolute',
      alignSelf: 'center',
      top: '46%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 10,
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
      paddingHorizontal: 14,
      paddingVertical: 11
    },
    imagePreviewStateText: { color: theme.onOverlay, fontFamily, fontSize: 13, fontWeight: '600' }
  });
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
  const runtimeGeneration = useReadNetworkRuntimeGeneration(mediaContext.contentSource);
  const decodeTarget = useMemo(() => previewBitmapDecodeTarget({ width, height }, PixelRatio.get()), [height, width]);
  const originalSource = useMemo(
    () => imageSourceFromUrl(item.originalUri, { mediaContext, nodeSeekUserAgent }) as ImageURISource,
    [item.originalUri, mediaContext, nodeSeekUserAgent]
  );
  const displaySource = useMemo(
    () => imageSourceFromUrl(item.displayUri, { mediaContext, nodeSeekUserAgent }) as ImageURISource,
    [item.displayUri, mediaContext, nodeSeekUserAgent]
  );
  const displayedBeforeMount = useMemo(() => originalImageDisplayRevision(originalSource) > 0, [originalSource]);
  const requestIdentity = compatibleImageRequestIdentity(originalSource);
  const resolutionIdentity = previewResolutionIdentity(mediaContext.sessionIdentity, item.originalUri);
  const [retryState, setRetryState] = useState({ requestIdentity, version: 0 });
  const retryVersion = retryState.requestIdentity === requestIdentity ? retryState.version : 0;
  const [progressDeadlineVersion, setProgressDeadlineVersion] = useState(0);
  const [resolutionState, setResolutionState] = useState<{
    requestIdentity: string;
    value: PreviewResolution | null;
  }>({ requestIdentity, value: item.displaySize || null });
  const resolution =
    resolutionState.requestIdentity === requestIdentity ? resolutionState.value : item.displaySize || null;
  const setResolution = useCallback(
    (value: PreviewResolution) => setResolutionState({ requestIdentity, value }),
    [requestIdentity]
  );
  const [compatibleSvgArtifactState, setCompatibleSvgArtifactState] = useState<{
    requestIdentity: string;
    value: CompatibleSvgArtifact | null;
  }>({ requestIdentity, value: null });
  const compatibleSvgArtifact =
    compatibleSvgArtifactState.requestIdentity === requestIdentity ? compatibleSvgArtifactState.value : null;
  const setCompatibleSvgArtifact = useCallback(
    (value: CompatibleSvgArtifact) => setCompatibleSvgArtifactState({ requestIdentity, value }),
    [requestIdentity]
  );
  const zoomRef = useRef<ResumableZoomRefType>(null);
  const mountedRef = useRef(true);
  const activeRef = useRef(active);
  const baseSourceIdentity = `${requestIdentity}\u0000${0}`;
  const logicalLoadOwner = useMemo(
    () => ({
      loadMetricsRef: {
        current: { sourceIdentity: baseSourceIdentity, startedAt: Date.now() } as PreviewImageLoadMetrics
      },
      nativeFailedRef: { current: false },
      posterRefreshRef: { current: { attempted: false, inFlight: false, sourceIdentity: '' } },
      previewDiagnosticRef: {
        current: null as { fallback: boolean; trace: DiagnosticTrace } | null
      },
      recoveringRef: { current: false },
      requestGenerationRef: { current: 0 },
      settledRef: { current: false },
      sourceIdentityRef: { current: baseSourceIdentity },
      svgArtifactConsumerRef: { current: null as AbortController | null }
    }),
    [baseSourceIdentity]
  );
  const {
    loadMetricsRef,
    nativeFailedRef,
    posterRefreshRef,
    previewDiagnosticRef,
    recoveringRef,
    requestGenerationRef,
    settledRef,
    sourceIdentityRef,
    svgArtifactConsumerRef
  } = logicalLoadOwner;
  const cachedArtifact = useMemo(() => cachedCompatibleSvgArtifact(originalSource), [originalSource]);
  useEffect(() => {
    if (cachedArtifact) {
      promoteCachedCompatibleSvgArtifact(requestIdentity);
    }
  }, [cachedArtifact, requestIdentity]);
  const knownArtifact =
    compatibleSvgArtifact?.requestIdentity === requestIdentity ? compatibleSvgArtifact : cachedArtifact;
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
  const [imageState, setImageState] = useState<{ sourceIdentity: string; status: PreviewStatus }>({
    sourceIdentity,
    status: 'loading'
  });
  const status = imageState.sourceIdentity === sourceIdentity ? imageState.status : 'loading';
  const suppressLoadingOverlay =
    displayedBeforeMount && !knownArtifact && !nativeFailedRef.current && retryVersion === 0;
  const setCurrentStatus = useCallback(
    (nextStatus: PreviewStatus) => {
      setImageState({ sourceIdentity, status: nextStatus });
    },
    [sourceIdentity]
  );
  const attachZoomRef = useCallback(
    (reference: ResumableZoomRefType | null) => {
      zoomRef.current = reference;
      onRegisterZoom(index, reference);
    },
    [index, onRegisterZoom]
  );
  const settleZoomGesture = useCallback(() => {
    onZoomGestureSettled(index, zoomRef.current?.getState().scale ?? 1);
  }, [index, onZoomGestureSettled]);

  const finishActiveDiagnostic = useCallback(
    (
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
      finishDiagnosticTrace(
        diagnostic.trace,
        outcome,
        {
          ...fields,
          fallback: fallback || diagnostic.fallback ? 'svg' : 'none',
          terminalReason
        },
        finishedAt
      );
      previewDiagnosticRef.current = null;
    },
    [previewDiagnosticRef]
  );

  const currentDiagnostic = useCallback(
    (fallback = false) => {
      if (!activeRef.current) {
        return null;
      }
      if (!previewDiagnosticRef.current) {
        previewDiagnosticRef.current = {
          fallback,
          trace: beginDiagnosticTrace(
            'media',
            'load',
            {
              candidateKind: 'lightbox',
              mediaClass: forumMediaTargetClass(item.originalUri, mediaContext.contentSource),
              mediaRef: diagnosticRef('media', item.originalUri),
              mediaRole: 'preview-active',
              source: mediaContext.contentSource || 'unknown',
              surface: 'preview'
            },
            loadMetricsRef.current.startedAt
          )
        };
      } else if (fallback) {
        previewDiagnosticRef.current.fallback = true;
      }
      return previewDiagnosticRef.current;
    },
    [item.originalUri, loadMetricsRef, mediaContext.contentSource, previewDiagnosticRef]
  );

  const settleLoaded = useCallback(
    (fallback: boolean) => {
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
      markOriginalImageDisplayed(originalSource);
      setCurrentStatus('loaded');
    },
    [
      finishActiveDiagnostic,
      loadMetricsRef,
      originalSource,
      recoveringRef,
      setCurrentStatus,
      settledRef,
      sourceIdentity,
      sourceIdentityRef
    ]
  );

  const settleFailure = useCallback(
    (fallback: boolean, terminalReason: 'fallback-error' | 'native-error' | 'timeout') => {
      if (!mountedRef.current || !activeRef.current || sourceIdentityRef.current !== sourceIdentity) {
        return;
      }
      nativeFailedRef.current = true;
      settledRef.current = true;
      recoveringRef.current = false;
      finishActiveDiagnostic('failure', fallback, terminalReason, previewImageMetricFields(loadMetricsRef.current));
      setCurrentStatus('failed');
    },
    [
      finishActiveDiagnostic,
      loadMetricsRef,
      nativeFailedRef,
      recoveringRef,
      setCurrentStatus,
      settledRef,
      sourceIdentity,
      sourceIdentityRef
    ]
  );

  const recoverSvgArtifact = useCallback(async () => {
    if (
      !mountedRef.current ||
      !activeRef.current ||
      sourceIdentityRef.current !== sourceIdentity ||
      settledRef.current ||
      recoveringRef.current
    ) {
      return;
    }
    recoveringRef.current = true;
    currentDiagnostic(true);
    setCurrentStatus('loading');
    const generation = requestGenerationRef.current;
    try {
      const artifact = await recoverCompatibleSvgArtifact(originalSource, {
        signal: svgArtifactConsumerRef.current?.signal
      });
      if (
        !mountedRef.current ||
        !activeRef.current ||
        sourceIdentityRef.current !== sourceIdentity ||
        settledRef.current ||
        generation !== requestGenerationRef.current
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
  }, [
    currentDiagnostic,
    loadMetricsRef,
    onResolution,
    originalSource,
    recoveringRef,
    requestGenerationRef,
    resolutionIdentity,
    setCompatibleSvgArtifact,
    setCurrentStatus,
    setResolution,
    settledRef,
    settleFailure,
    sourceIdentity,
    sourceIdentityRef,
    svgArtifactConsumerRef
  ]);

  const refreshSvgPoster = useCallback(
    async (artifact: CompatibleSvgArtifact, terminalOnFailure: boolean) => {
      if (!mountedRef.current || !activeRef.current || sourceIdentityRef.current !== sourceIdentity) {
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
        const refreshed = await refreshCompatibleSvgPoster(artifact, {
          signal: svgArtifactConsumerRef.current?.signal
        });
        if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity) {
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
    },
    [
      currentDiagnostic,
      loadMetricsRef,
      onResolution,
      posterRefreshRef,
      resolutionIdentity,
      setCompatibleSvgArtifact,
      setCurrentStatus,
      setResolution,
      settledRef,
      settleFailure,
      sourceIdentity,
      sourceIdentityRef,
      svgArtifactConsumerRef
    ]
  );

  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    const svgArtifactConsumer = new AbortController();
    svgArtifactConsumerRef.current = svgArtifactConsumer;
    return () => {
      requestGenerationRef.current += 1;
      if (svgArtifactConsumerRef.current === svgArtifactConsumer) {
        svgArtifactConsumerRef.current = null;
      }
      svgArtifactConsumer.abort();
      finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
      sourceIdentityRef.current = '';
    };
  }, [finishActiveDiagnostic, loadMetricsRef, requestGenerationRef, sourceIdentityRef, svgArtifactConsumerRef]);

  useEffect(() => {
    if (!activeArtifact) {
      return;
    }
    setResolution(activeArtifact.dimensions);
    onResolution(resolutionIdentity, activeArtifact.dimensions);
  }, [activeArtifact, onResolution, resolutionIdentity, setResolution]);

  useEffect(() => {
    if (!active) {
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
    if (nativeFailedRef.current && !settledRef.current) {
      void recoverSvgArtifact();
    }
  }, [
    active,
    currentDiagnostic,
    finishActiveDiagnostic,
    loadMetricsRef,
    nativeFailedRef,
    previewDiagnosticRef,
    recoverSvgArtifact,
    recoveringRef,
    requestGenerationRef,
    settledRef,
    sourceIdentity
  ]);

  useEffect(() => {
    if (!active || settledRef.current || status !== 'loading') {
      return undefined;
    }
    const timeout = setTimeout(() => settleFailure(false, 'timeout'), IMAGE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [active, progressDeadlineVersion, retryVersion, settleFailure, settledRef, status]);

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
    finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
    setCurrentStatus('loading');
    const nextRetryVersion = retryVersion + 1;
    const nextSourceIdentity = `${requestIdentity}\u0000${nextRetryVersion}`;
    sourceIdentityRef.current = nextSourceIdentity;
    loadMetricsRef.current = {
      sourceIdentity: nextSourceIdentity,
      startedAt: Date.now()
    };
    setRetryState({ requestIdentity, version: nextRetryVersion });
  }, [
    finishActiveDiagnostic,
    loadMetricsRef,
    nativeFailedRef,
    recoveringRef,
    requestGenerationRef,
    requestIdentity,
    retryVersion,
    setCurrentStatus,
    settledRef,
    sourceIdentityRef
  ]);
  const handledRuntimeGenerationRef = useRef({ generation: runtimeGeneration, requestIdentity });
  useEffect(() => {
    if (handledRuntimeGenerationRef.current.requestIdentity !== requestIdentity) {
      handledRuntimeGenerationRef.current = { generation: runtimeGeneration, requestIdentity };
      return;
    }
    if (runtimeGeneration <= handledRuntimeGenerationRef.current.generation) {
      return;
    }
    if (status === 'loaded') {
      handledRuntimeGenerationRef.current.generation = runtimeGeneration;
      return;
    }
    if (!active) {
      return;
    }
    handledRuntimeGenerationRef.current.generation = runtimeGeneration;
    retry();
  }, [active, requestIdentity, retry, runtimeGeneration, status]);

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
          {status !== 'failed' ? (
            <PreviewPageLoadLayer
              active={active}
              activeAnimatedArtifact={activeAnimatedArtifact}
              animatedSvgPosterReady={animatedSvgPosterReady}
              animatedSvgZoomSuspended={animatedSvgZoomSuspended}
              displaySource={displaySource}
              displayUri={item.displayUri}
              decodeTarget={decodeTarget}
              index={index}
              knownArtifact={knownArtifact}
              mediaSessionIdentity={mediaContext.sessionIdentity}
              originalUri={item.originalUri}
              originalSource={originalSource}
              readySvgViewIdentity={readySvgViewIdentity}
              retryVersion={retryVersion}
              sourceIdentity={sourceIdentity}
              svgViewIdentity={svgViewIdentity}
              showDisplayUnderlay={!knownArtifact && status !== 'loaded'}
              onAnimatedPosterDisplay={() => {
                if (!mountedRef.current || !activeRef.current || sourceIdentityRef.current !== sourceIdentity) {
                  return;
                }
                setDisplayedSvgPosterIdentity(svgPosterIdentity);
              }}
              onAnimatedPosterError={() => {
                setDisplayedSvgPosterIdentity((identity) => (identity === svgPosterIdentity ? '' : identity));
                void refreshSvgPoster(activeAnimatedArtifact!, false);
              }}
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
              onPosterDisplay={() => settleLoaded(true)}
              onPosterError={() => {
                void refreshSvgPoster(knownArtifact!, true);
              }}
              onProgress={(event) => {
                if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity || settledRef.current) {
                  return;
                }
                const loadedBytes = Number(event.loaded);
                const totalBytes = Number(event.total);
                const previousLoadedBytes = loadMetricsRef.current.loadedBytes;
                const advanced =
                  Number.isFinite(loadedBytes) && loadedBytes > 0 && loadedBytes > (previousLoadedBytes ?? 0);
                loadMetricsRef.current = {
                  ...loadMetricsRef.current,
                  ...(loadMetricsRef.current.firstProgressAt === undefined ? { firstProgressAt: Date.now() } : {}),
                  ...(Number.isFinite(loadedBytes) && loadedBytes >= 0 ? { loadedBytes } : {}),
                  ...(Number.isFinite(totalBytes) && totalBytes >= 0 ? { totalBytes } : {})
                };
                if (advanced) {
                  setProgressDeadlineVersion((version) => version + 1);
                }
              }}
            />
          ) : null}
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
                readySvgViewIdentity === svgViewIdentity && (!animatedSvgZoomSuspended || !animatedSvgPosterReady)
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
      {active && status === 'loading' && !suppressLoadingOverlay ? (
        <View accessibilityLiveRegion="polite" pointerEvents="none" style={styles.imagePreviewState}>
          <ActivityIndicator color={theme.onOverlay} />
          <Text style={styles.imagePreviewStateText}>图片加载中...</Text>
        </View>
      ) : null}
      {active && status === 'failed' ? (
        <View accessibilityRole="alert" style={styles.imagePreviewState}>
          <Text style={styles.imagePreviewStateText}>图片加载失败</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重试加载图片"
            style={styles.imagePreviewTextButton}
            onPress={retry}
          >
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

function createPreviewPagerWindow(items: readonly ImagePreviewItem[], activeIndex: number) {
  const slots = Array.from({ length: Math.min(3, items.length) }, (_, slot) => ({
    page: null as PreviewPagerWindowPage | null,
    slot
  }));
  const pages: PreviewPagerWindowPage[] = [];
  const clampedActiveIndex = clampIndex(activeIndex, items.length);
  const activeSlot =
    items.length <= 2
      ? clampedActiveIndex
      : clampedActiveIndex === 0
        ? 0
        : clampedActiveIndex === items.length - 1
          ? 2
          : 1;
  for (let index = clampedActiveIndex - 1; index <= clampedActiveIndex + 1; index += 1) {
    const item = items[index];
    if (item) {
      const slot = activeSlot + index - clampedActiveIndex;
      const page = { index, item, slot };
      pages.push(page);
      slots[slot] = { page, slot };
    }
  }
  return {
    activePageIndex: activeSlot,
    pages,
    slots
  };
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
