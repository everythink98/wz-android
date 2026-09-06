import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { Image as ExpoImage, type ImageLoadEventData } from 'expo-image';
import {
  GestureDetector,
  GestureHandlerRootView,
  GestureStateManager,
  usePanGesture
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ResumableZoom, fitContainer, type ResumableZoomRefType } from 'react-native-zoom-toolkit';
import X from 'lucide-react-native/icons/x';
import { imageRequestHeadersForUrl, imageSourceFromUrl } from '@/platform/media/imageRequestSource';
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
import { previewBitmapDecodeTarget, previewMaxScale } from '@/platform/media/previewBitmapBudget';
import { beginDiagnosticTrace, finishDiagnosticTrace } from '@/platform/diagnostics/diagnostics';
import { diagnosticRef, type DiagnosticFields, type DiagnosticTrace } from '@/platform/diagnostics/diagnosticPolicy';
import { useReadNetworkRuntimeGeneration } from '@/platform/network/readNetworkRuntime';
import { CompatibleSvgDocumentView } from '@/ui/content/CompatibleSvgDocumentView';
import { PreviewPageLoadLayer } from './PreviewPageLoadLayer';
import { PreviewRegionImage, type PreviewRegionViewport } from './PreviewRegionImage';

const EMPTY_PREVIEW_ITEMS: ImagePreviewItem[] = [];
const IMAGE_LOAD_TIMEOUT_MS = 30_000;
const PAGE_SWIPE_DISTANCE_RATIO = 0.18;
const PAGE_SWIPE_VELOCITY = 800;
const PAGE_TRANSITION_DURATION_MS = 220;
const PULL_CLOSE_DISTANCE_RATIO = 0.25;
const PULL_CLOSE_VELOCITY = 1_200;
const GESTURE_DIRECTION_LOCK_DISTANCE = 12;
const SVG_IMAGE_URI_PATTERN = /(?:^data:image\/svg\+xml(?:[;,]|$)|\.svg(?:[?#&]|$))/i;

type PreviewStatus = 'failed' | 'loaded' | 'loading';
type PreviewImageState = {
  regionEligible: boolean;
  sourceIdentity: string;
  status: PreviewStatus;
};
type PreviewResolution = { height: number; width: number };
type PreviewRegionState = {
  scale: number;
  sourceIdentity: string;
  viewport: PreviewRegionViewport;
};
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
  onZoomUpdate: (index: number, scale: number) => void;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  width: number;
};

type VerticalPullState = {
  released: boolean;
  translateY: number;
  velocityY: number;
};

type PreviewRingPage = {
  index: number;
  item: ImagePreviewItem;
};

type PreviewRingRole = -1 | 0 | 1;

type PreviewRingSlot = {
  page: PreviewRingPage | null;
  role: PreviewRingRole;
  slot: number;
};

type PreviewRingState = {
  activeIndex: number;
  activeSlot: number;
  slots: PreviewRingSlot[];
};

const FULL_PREVIEW_VIEWPORT: PreviewRegionViewport = { height: 1, width: 1, x: 0, y: 0 };

function currentPreviewRegion(reference: ResumableZoomRefType | null): Omit<PreviewRegionState, 'sourceIdentity'> {
  const state = reference?.getState();
  const rect = reference?.getVisibleRect?.();
  const childWidth = state?.childSize?.width;
  const childHeight = state?.childSize?.height;
  const stateScale = state?.scale;
  const scale = typeof stateScale === 'number' && Number.isFinite(stateScale) && stateScale > 0 ? stateScale : 1;
  if (!rect || !childWidth || !childHeight) {
    return { scale, viewport: FULL_PREVIEW_VIEWPORT };
  }
  const x = clampUnit(rect.x / childWidth);
  const y = clampUnit(rect.y / childHeight);
  const right = clampUnit((rect.x + rect.width) / childWidth);
  const bottom = clampUnit((rect.y + rect.height) / childHeight);
  if (right <= x || bottom <= y) {
    return { scale, viewport: FULL_PREVIEW_VIEWPORT };
  }
  return { scale, viewport: { height: bottom - y, width: right - x, x, y } };
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function ImagePreviewModal(props: ImagePreviewModalProps) {
  const sessionContext = useForumMediaRequestContext(props.preview?.contentSource);
  const mediaContext = useMemo(
    () => (props.preview?.referrer ? { ...sessionContext, referrer: props.preview.referrer } : sessionContext),
    [props.preview?.referrer, sessionContext]
  );
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
  const itemOverride = preview?.itemOverride;
  const itemOverrideIndex = preview?.itemOverrideIndex;
  const previewCount = previewItems.length;
  const requestedIndex = clampIndex(preview?.index ?? 0, previewCount);
  const [ring, setRing] = useState(() =>
    createPreviewRingState(previewItems, requestedIndex, itemOverrideIndex, itemOverride)
  );
  const activeIndex = ring.activeIndex;
  const [activeZoomed, setActiveZoomed] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [animatedSvgZoomSuspended, setAnimatedSvgZoomSuspended] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, PreviewResolution>>({});
  const zoomRefs = useRef(new Map<number, ResumableZoomRefType>());
  const ringRef = useRef(ring);
  const previewItemsRef = useRef(previewItems);
  const itemOverrideRef = useRef(itemOverride);
  const itemOverrideIndexRef = useRef(itemOverrideIndex);
  const activeIndexRef = useRef(requestedIndex);
  const requestedIndexRef = useRef(requestedIndex);
  const desiredIndexRef = useRef(requestedIndex);
  const pendingExternalRebuildRef = useRef(false);
  const transitioningRef = useRef(false);
  const releaseTransitionAfterCommitRef = useRef(false);
  const previewOpenRef = useRef(Boolean(preview));
  const mountedRef = useRef(true);
  const overlayOpacity = useSharedValue(1);
  const pullTranslateY = useSharedValue(0);
  const closing = useSharedValue(false);
  const ringTranslateX = useSharedValue(0);
  const activeZoomScale = useSharedValue(1);
  const activeIndexOnUI = useSharedValue(requestedIndex);
  const transitioning = useSharedValue(false);
  const gestureAxis = useSharedValue(0);
  const gestureQueuesTransition = useSharedValue(false);
  const gestureStartX = useSharedValue(0);
  const gestureStartY = useSharedValue(0);
  const slot0Role = useSharedValue<PreviewRingRole>(ring.slots.find(({ slot }) => slot === 0)?.role ?? 0);
  const slot1Role = useSharedValue<PreviewRingRole>(ring.slots.find(({ slot }) => slot === 1)?.role ?? 0);
  const slot2Role = useSharedValue<PreviewRingRole>(ring.slots.find(({ slot }) => slot === 2)?.role ?? 0);

  const setSlotRole = useCallback(
    (slot: number, role: PreviewRingRole) => {
      'worklet';
      if (slot === 0) {
        slot0Role.value = role;
      } else if (slot === 1) {
        slot1Role.value = role;
      } else {
        slot2Role.value = role;
      }
    },
    [slot0Role, slot1Role, slot2Role]
  );

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    if (!releaseTransitionAfterCommitRef.current) {
      return;
    }
    releaseTransitionAfterCommitRef.current = false;
    transitioningRef.current = false;
    transitioning.value = false;
  }, [ring, transitioning]);

  const rebuildRing = useCallback(
    (index: number) => {
      const nextRing = createPreviewRingState(
        previewItemsRef.current,
        index,
        itemOverrideIndexRef.current,
        itemOverrideRef.current
      );
      zoomRefs.current.get(activeIndexRef.current)?.reset(false);
      for (const slot of nextRing.slots) {
        setSlotRole(slot.slot, slot.role);
      }
      ringTranslateX.value = 0;
      pullTranslateY.value = 0;
      overlayOpacity.value = 1;
      activeZoomScale.value = 1;
      activeIndexOnUI.value = nextRing.activeIndex;
      transitioning.value = false;
      transitioningRef.current = false;
      releaseTransitionAfterCommitRef.current = false;
      pendingExternalRebuildRef.current = false;
      activeIndexRef.current = nextRing.activeIndex;
      desiredIndexRef.current = nextRing.activeIndex;
      ringRef.current = nextRing;
      setActiveZoomed(false);
      setAnimatedSvgZoomSuspended(false);
      setRing(nextRing);
    },
    [activeIndexOnUI, activeZoomScale, overlayOpacity, pullTranslateY, ringTranslateX, setSlotRole, transitioning]
  );

  useEffect(() => {
    const previewOpen = Boolean(preview && previewCount > 0);
    const reopening = previewOpen && !previewOpenRef.current;
    const catalogChanged =
      previewItemsRef.current !== previewItems ||
      itemOverrideRef.current !== itemOverride ||
      itemOverrideIndexRef.current !== itemOverrideIndex;
    previewItemsRef.current = previewItems;
    itemOverrideRef.current = itemOverride;
    itemOverrideIndexRef.current = itemOverrideIndex;
    previewOpenRef.current = previewOpen;
    closing.value = false;
    overlayOpacity.value = 1;
    pullTranslateY.value = 0;
    if (!previewOpen) {
      return;
    }
    if (reopening) {
      setChromeVisible(true);
      setActiveZoomed(false);
      setAnimatedSvgZoomSuspended(false);
    }
    if (!reopening && !catalogChanged && requestedIndexRef.current === requestedIndex) {
      return;
    }
    requestedIndexRef.current = requestedIndex;
    desiredIndexRef.current = requestedIndex;
    if (transitioningRef.current || transitioning.value) {
      pendingExternalRebuildRef.current = true;
      return;
    }
    rebuildRing(requestedIndex);
  }, [
    closing,
    overlayOpacity,
    preview,
    previewCount,
    previewItems,
    itemOverride,
    itemOverrideIndex,
    pullTranslateY,
    rebuildRing,
    requestedIndex,
    transitioning
  ]);

  const activeItem = previewItemAtIndex(previewItems, activeIndex, itemOverrideIndex, itemOverride);
  const activeRequestIdentity = activeItem ? previewResolutionIdentity(mediaContext, activeItem) : '';
  const activeResolution = resolutions[activeRequestIdentity] || activeItem?.displaySize || null;
  const imagePreviewMaxScale = useMemo(() => {
    return previewMaxScale(activeResolution, { width, height }, PixelRatio.get());
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
    setAnimatedSvgZoomSuspended(true);
  }, []);
  const handleZoomGestureSettled = useCallback((index: number, scale: number) => {
    if (activeIndexRef.current !== index) {
      return;
    }
    const zoomed = Math.abs(scale - 1) > 0.001;
    setActiveZoomed(zoomed);
    setAnimatedSvgZoomSuspended(zoomed);
  }, []);
  const handleZoomUpdate = useCallback(
    (index: number, scale: number) => {
      'worklet';
      if (activeIndexOnUI.value === index) {
        activeZoomScale.value = scale;
      }
    },
    [activeIndexOnUI, activeZoomScale]
  );

  const markTransitionStarted = useCallback(
    (targetIndex: number) => {
      if (!mountedRef.current) {
        return;
      }
      transitioningRef.current = true;
      if (desiredIndexRef.current === activeIndexRef.current) {
        desiredIndexRef.current = targetIndex;
      }
      zoomRefs.current.get(activeIndexRef.current)?.reset(false);
      activeZoomScale.value = 1;
      setActiveZoomed(false);
      setAnimatedSvgZoomSuspended(false);
    },
    [activeZoomScale]
  );

  const cancelTransition = useCallback(() => {
    transitioningRef.current = false;
    if (pendingExternalRebuildRef.current) {
      rebuildRing(desiredIndexRef.current);
    } else {
      desiredIndexRef.current = activeIndexRef.current;
    }
  }, [rebuildRing]);

  const commitRingStep = useCallback(
    (direction: -1 | 1, targetIndex: number, targetSlot: number, recycleSlot: number) => {
      if (!mountedRef.current) {
        return;
      }
      const currentRing = ringRef.current;
      const target = currentRing.slots.find(({ slot }) => slot === targetSlot);
      if (target?.page?.index !== targetIndex || targetIndex !== currentRing.activeIndex + direction) {
        transitioningRef.current = false;
        transitioning.value = false;
        return;
      }
      const recycledIndex = targetIndex + direction;
      const recycledItem = previewItemAtIndex(
        previewItemsRef.current,
        recycledIndex,
        itemOverrideIndexRef.current,
        itemOverrideRef.current
      );
      const nextSlots = currentRing.slots.map((slot) => {
        if (slot.slot === currentRing.activeSlot) {
          return { ...slot, role: (direction === 1 ? -1 : 1) as PreviewRingRole };
        }
        if (slot.slot === targetSlot) {
          return { ...slot, role: 0 as PreviewRingRole };
        }
        if (slot.slot === recycleSlot) {
          return {
            ...slot,
            page: recycledItem ? { index: recycledIndex, item: recycledItem } : null,
            role: direction
          };
        }
        return slot;
      });
      const nextRing = { activeIndex: targetIndex, activeSlot: targetSlot, slots: nextSlots };
      const notifySelection = !pendingExternalRebuildRef.current;
      if (notifySelection) {
        requestedIndexRef.current = targetIndex;
      }
      activeIndexRef.current = targetIndex;
      activeIndexOnUI.value = targetIndex;
      ringRef.current = nextRing;
      releaseTransitionAfterCommitRef.current = true;
      setRing(nextRing);
      if (notifySelection) {
        onSelect(targetIndex);
      }
    },
    [activeIndexOnUI, onSelect, transitioning]
  );

  const animateRingStep = useCallback(
    (direction: -1 | 1, targetIndex: number, currentSlot: number, targetSlot: number, recycleSlot: number) => {
      'worklet';
      if (transitioning.value) {
        return;
      }
      transitioning.value = true;
      activeZoomScale.value = 1;
      scheduleOnRN(markTransitionStarted, targetIndex);
      ringTranslateX.value = withTiming(-direction * width, { duration: PAGE_TRANSITION_DURATION_MS }, (finished) => {
        if (!finished) {
          ringTranslateX.value = 0;
          transitioning.value = false;
          scheduleOnRN(cancelTransition);
          return;
        }
        setSlotRole(currentSlot, direction === 1 ? -1 : 1);
        setSlotRole(targetSlot, 0);
        if (recycleSlot >= 0) {
          setSlotRole(recycleSlot, direction);
        }
        activeIndexOnUI.value = targetIndex;
        ringTranslateX.value = 0;
        scheduleOnRN(commitRingStep, direction, targetIndex, targetSlot, recycleSlot);
      });
    },
    [
      activeIndexOnUI,
      activeZoomScale,
      cancelTransition,
      commitRingStep,
      markTransitionStarted,
      ringTranslateX,
      setSlotRole,
      transitioning,
      width
    ]
  );

  const startRingStep = useCallback(
    (direction: -1 | 1) => {
      if (transitioningRef.current || transitioning.value) {
        return false;
      }
      const currentRing = ringRef.current;
      const targetIndex = currentRing.activeIndex + direction;
      const target = currentRing.slots.find(({ page, role }) => role === direction && page?.index === targetIndex);
      if (!target) {
        return false;
      }
      const recycle =
        currentRing.slots.length === 3
          ? (currentRing.slots.find(({ role }) => role === (direction === 1 ? -1 : 1))?.slot ?? -1)
          : -1;
      markTransitionStarted(targetIndex);
      animateRingStep(direction, targetIndex, currentRing.activeSlot, target.slot, recycle);
      return true;
    },
    [animateRingStep, markTransitionStarted, transitioning]
  );

  const moveToIndex = useCallback(
    (index: number) => {
      const nextIndex = clampIndex(index, previewItemsRef.current.length);
      desiredIndexRef.current = nextIndex;
      pendingExternalRebuildRef.current = false;
      if (!transitioningRef.current && !transitioning.value && nextIndex !== activeIndexRef.current) {
        startRingStep(nextIndex > activeIndexRef.current ? 1 : -1);
      }
    },
    [startRingStep, transitioning]
  );

  const queueGestureStep = useCallback(
    (direction: -1 | 1) => {
      moveToIndex(desiredIndexRef.current + direction);
    },
    [moveToIndex]
  );

  useEffect(() => {
    if (transitioningRef.current || transitioning.value) {
      return;
    }
    if (pendingExternalRebuildRef.current) {
      rebuildRing(desiredIndexRef.current);
      return;
    }
    const desiredIndex = desiredIndexRef.current;
    if (desiredIndex !== ring.activeIndex) {
      startRingStep(desiredIndex > ring.activeIndex ? 1 : -1);
    }
  }, [rebuildRing, ring, startRingStep, transitioning]);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') {
        moveToIndex(desiredIndexRef.current + 1);
      } else if (event.nativeEvent.actionName === 'decrement') {
        moveToIndex(desiredIndexRef.current - 1);
      }
    },
    [moveToIndex]
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

  const previousSlot = ring.slots.find(({ page, role }) => role === -1 && page?.index === activeIndex - 1)?.slot ?? -1;
  const nextSlot = ring.slots.find(({ page, role }) => role === 1 && page?.index === activeIndex + 1)?.slot ?? -1;
  const recycleForPrevious = ring.slots.length === 3 ? (ring.slots.find(({ role }) => role === 1)?.slot ?? -1) : -1;
  const recycleForNext = ring.slots.length === 3 ? (ring.slots.find(({ role }) => role === -1)?.slot ?? -1) : -1;
  const previewGesture = usePanGesture({
    manualActivation: true,
    maxPointers: 1,
    onTouchesDown: (event) => {
      'worklet';
      if (event.numberOfTouches !== 1 || Math.abs(activeZoomScale.value - 1) > 0.001) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      const touch = event.allTouches[0];
      if (!touch) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      gestureAxis.value = 0;
      gestureQueuesTransition.value = transitioning.value;
      gestureStartX.value = touch.absoluteX;
      gestureStartY.value = touch.absoluteY;
    },
    onTouchesMove: (event) => {
      'worklet';
      if (event.numberOfTouches !== 1 || Math.abs(activeZoomScale.value - 1) > 0.001) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      const touch = event.allTouches[0];
      if (!touch) {
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      if (transitioning.value) {
        gestureQueuesTransition.value = true;
      }
      const deltaX = touch.absoluteX - gestureStartX.value;
      const deltaY = touch.absoluteY - gestureStartY.value;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < GESTURE_DIRECTION_LOCK_DISTANCE) {
        return;
      }
      gestureAxis.value = Math.abs(deltaX) > Math.abs(deltaY) ? 1 : 2;
      GestureStateManager.activate(event.handlerTag);
    },
    onUpdate: (event) => {
      'worklet';
      if (gestureQueuesTransition.value) {
        return;
      }
      if (gestureAxis.value === 1) {
        const atBoundary = (event.translationX > 0 && previousSlot < 0) || (event.translationX < 0 && nextSlot < 0);
        ringTranslateX.value = event.translationX * (atBoundary ? 0.25 : 1);
      } else if (gestureAxis.value === 2) {
        handleVerticalPull({
          released: false,
          translateY: Math.max(0, event.translationY),
          velocityY: event.velocityY
        });
      }
    },
    onDeactivate: (event) => {
      'worklet';
      if (event.canceled) {
        return;
      }
      if (gestureAxis.value === 2) {
        if (!gestureQueuesTransition.value) {
          handleVerticalPull({
            released: true,
            translateY: Math.max(0, event.translationY),
            velocityY: event.velocityY
          });
        }
        return;
      }
      if (gestureAxis.value !== 1) {
        return;
      }
      const horizontalDistance = Math.abs(event.translationX);
      const verticalDistance = Math.abs(event.translationY);
      const horizontalVelocity = Math.abs(event.velocityX);
      const verticalVelocity = Math.abs(event.velocityY);
      const shouldMove =
        horizontalDistance > verticalDistance &&
        (horizontalDistance >= width * PAGE_SWIPE_DISTANCE_RATIO ||
          (horizontalVelocity >= PAGE_SWIPE_VELOCITY && horizontalVelocity > verticalVelocity));
      const signedMovement = horizontalDistance > 1 ? event.translationX : event.velocityX;
      const direction = signedMovement < 0 ? 1 : -1;
      if (gestureQueuesTransition.value) {
        if (shouldMove && signedMovement !== 0) {
          scheduleOnRN(queueGestureStep, direction);
        }
        return;
      }
      const targetSlot = direction === 1 ? nextSlot : previousSlot;
      if (!shouldMove || signedMovement === 0 || targetSlot < 0) {
        ringTranslateX.value = withTiming(0, { duration: PAGE_TRANSITION_DURATION_MS });
        return;
      }
      animateRingStep(
        direction,
        activeIndex + direction,
        ring.activeSlot,
        targetSlot,
        direction === 1 ? recycleForNext : recycleForPrevious
      );
    },
    onFinalize: (event) => {
      'worklet';
      const queuedTransition = gestureQueuesTransition.value;
      gestureAxis.value = 0;
      gestureQueuesTransition.value = false;
      if (event.canceled && !queuedTransition) {
        ringTranslateX.value = withTiming(0, { duration: PAGE_TRANSITION_DURATION_MS });
        pullTranslateY.value = withTiming(0);
        overlayOpacity.value = withTiming(1);
      }
    }
  });

  const backgroundStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }), [overlayOpacity]);
  const previewPullStyle = useAnimatedStyle(
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
        <GestureDetector gesture={previewGesture}>
          <Animated.View style={[styles.imagePreviewScroll, previewPullStyle]}>
            <View testID="image-preview-ring" style={componentStyles.ringViewport}>
              {ring.slots.map(({ page, slot }) => {
                const selected = page?.index === activeIndex;
                const role = slot === 0 ? slot0Role : slot === 1 ? slot1Role : slot2Role;
                return (
                  <PreviewRingSlotView
                    key={`preview-physical-slot-${slot}`}
                    role={role}
                    selected={selected}
                    slot={slot}
                    translateX={ringTranslateX}
                    width={width}
                  >
                    {page ? (
                      <PreviewPage
                        active={selected}
                        activeZoomed={selected && activeZoomed}
                        animatedSvgZoomSuspended={selected && animatedSvgZoomSuspended}
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
                        onZoomUpdate={handleZoomUpdate}
                        styles={styles}
                        theme={theme}
                        width={width}
                      />
                    ) : null}
                  </PreviewRingSlotView>
                );
              })}
            </View>
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

function PreviewRingSlotView({
  children,
  role,
  selected,
  slot,
  translateX,
  width
}: {
  children: ReactNode;
  role: SharedValue<PreviewRingRole>;
  selected: boolean;
  slot: number;
  translateX: SharedValue<number>;
  width: number;
}) {
  const positionStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: role.value * width + translateX.value }] }),
    [role, translateX, width]
  );
  return (
    <Animated.View
      collapsable={false}
      pointerEvents={selected ? 'auto' : 'none'}
      testID={`preview-physical-slot-${slot}`}
      style={[componentStyles.ringSlot, positionStyle]}
    >
      {children}
    </Animated.View>
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

function PreviewPage({
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
  onZoomUpdate,
  styles,
  theme,
  width
}: PreviewPageProps) {
  const runtimeGeneration = useReadNetworkRuntimeGeneration(mediaContext.contentSource);
  const decodeTarget = useMemo(() => previewBitmapDecodeTarget({ width, height }, PixelRatio.get()), [height, width]);
  const originalSource = useMemo(
    () =>
      imageSourceFromUrl(item.originalUri, {
        mediaContext,
        nodeSeekUserAgent,
        referrerPolicy: item.referrerPolicy
      }) as ImageURISource & { cacheKey?: string },
    [item.originalUri, item.referrerPolicy, mediaContext, nodeSeekUserAgent]
  );
  const displaySource = useMemo(
    () =>
      imageSourceFromUrl(item.displayUri, {
        mediaContext,
        nodeSeekUserAgent,
        referrerPolicy: item.referrerPolicy
      }) as ImageURISource,
    [item.displayUri, item.referrerPolicy, mediaContext, nodeSeekUserAgent]
  );
  const displayedBeforeMount = useMemo(() => originalImageDisplayRevision(originalSource) > 0, [originalSource]);
  const requestIdentity = compatibleImageRequestIdentity(originalSource);
  const resolutionIdentity = previewResolutionIdentity(mediaContext, item);
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
  const [initialLoadStartedAt] = useState(Date.now);
  const logicalLoadOwner = useMemo(
    () => ({
      loadMetricsRef: {
        current: { sourceIdentity: baseSourceIdentity, startedAt: initialLoadStartedAt } as PreviewImageLoadMetrics
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
    [baseSourceIdentity, initialLoadStartedAt]
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
  const [imageState, setImageState] = useState<PreviewImageState>({
    regionEligible: false,
    sourceIdentity,
    status: 'loading'
  });
  const [cachedOriginalState, setCachedOriginalState] = useState<{
    filePath: string | null;
    sourceIdentity: string;
  }>({ filePath: null, sourceIdentity });
  const [regionState, setRegionState] = useState<PreviewRegionState>({
    scale: 1,
    sourceIdentity,
    viewport: FULL_PREVIEW_VIEWPORT
  });
  const [regionSuspended, setRegionSuspended] = useState(false);
  const status = imageState.sourceIdentity === sourceIdentity ? imageState.status : 'loading';
  const regionEligible = imageState.sourceIdentity === sourceIdentity && imageState.regionEligible;
  const suppressLoadingOverlay =
    displayedBeforeMount && !knownArtifact && !nativeFailedRef.current && retryVersion === 0;
  const setCurrentStatus = useCallback(
    (nextStatus: PreviewStatus) => {
      setImageState((current) => ({
        regionEligible: current.sourceIdentity === sourceIdentity && current.regionEligible,
        sourceIdentity,
        status: nextStatus
      }));
    },
    [sourceIdentity]
  );
  const setCurrentRegionEligibility = useCallback(
    (eligible: boolean) => {
      setImageState((current) => ({
        regionEligible: eligible,
        sourceIdentity,
        status: current.sourceIdentity === sourceIdentity ? current.status : 'loading'
      }));
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
  const syncPreviewRegion = useCallback(() => {
    setRegionState({ sourceIdentity, ...currentPreviewRegion(zoomRef.current) });
  }, [sourceIdentity]);
  const startZoomGesture = useCallback(() => {
    setRegionSuspended(true);
    onZoomGestureStart(index);
  }, [index, onZoomGestureStart]);
  const settleZoomGesture = useCallback(() => {
    const nextRegion = currentPreviewRegion(zoomRef.current);
    setRegionState({ sourceIdentity, ...nextRegion });
    setRegionSuspended(false);
    onZoomGestureSettled(index, nextRegion.scale);
  }, [index, onZoomGestureSettled, sourceIdentity]);

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

  useEffect(() => {
    if (!active) {
      setRegionSuspended(false);
      setRegionState({ scale: 1, sourceIdentity, viewport: FULL_PREVIEW_VIEWPORT });
      return undefined;
    }
    if (status !== 'loaded' || knownArtifact || !regionEligible) {
      return undefined;
    }
    const cacheKey = originalSource.cacheKey || originalSource.uri;
    if (!cacheKey) {
      return undefined;
    }
    let cancelled = false;
    void ExpoImage.getCachePathAsync(cacheKey)
      .then((filePath) => {
        if (cancelled || !mountedRef.current || !activeRef.current || sourceIdentityRef.current !== sourceIdentity) {
          return;
        }
        setCachedOriginalState({ filePath, sourceIdentity });
        if (filePath) {
          syncPreviewRegion();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    active,
    knownArtifact,
    originalSource,
    regionEligible,
    sourceIdentity,
    sourceIdentityRef,
    status,
    syncPreviewRegion
  ]);

  const imageSize = useMemo(() => {
    const layoutResolution = knownArtifact?.dimensions || resolution || item.displaySize;
    if (!layoutResolution?.width || !layoutResolution.height) {
      return { width, height };
    }
    return fitContainer(layoutResolution.width / layoutResolution.height, { width, height });
  }, [height, item.displaySize, knownArtifact?.dimensions, resolution, width]);
  const cachedOriginalPath =
    cachedOriginalState.sourceIdentity === sourceIdentity ? cachedOriginalState.filePath : null;
  const currentRegion =
    regionState.sourceIdentity === sourceIdentity
      ? regionState
      : { scale: 1, sourceIdentity, viewport: FULL_PREVIEW_VIEWPORT };

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
    <View testID={`preview-page-${index}`} style={componentStyles.page}>
      <ResumableZoom
        ref={attachZoomRef}
        extendGestures
        maxScale={maxScale}
        panEnabled={active && activeZoomed}
        pinchEnabled={active}
        style={componentStyles.page}
        tapsEnabled={active}
        onDoubleTapStart={startZoomGesture}
        onGestureEnd={settleZoomGesture}
        onPanStart={startZoomGesture}
        onPinchStart={startZoomGesture}
        onTap={onToggleChrome}
        onUpdate={(state) => {
          'worklet';
          onZoomUpdate(index, state.scale);
        }}
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
                if (!mountedRef.current || sourceIdentityRef.current !== sourceIdentity) {
                  return;
                }
                setCurrentRegionEligibility(
                  source.isAnimated !== true &&
                    source.mediaType !== 'image/svg+xml' &&
                    !SVG_IMAGE_URI_PATTERN.test(item.originalUri.trim())
                );
                if (source.width > 0 && source.height > 0) {
                  const nextResolution = { width: source.width, height: source.height };
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
          {active && status === 'loaded' && !knownArtifact && regionEligible && cachedOriginalPath ? (
            <PreviewRegionImage
              pointerEvents="none"
              filePath={cachedOriginalPath}
              scale={currentRegion.scale}
              style={StyleSheet.absoluteFill}
              suspended={regionSuspended}
              testID={`preview-region-${index}`}
              viewport={currentRegion.viewport}
              onSourceSize={(event) => {
                const nextResolution = event.nativeEvent;
                if (
                  !mountedRef.current ||
                  !activeRef.current ||
                  sourceIdentityRef.current !== sourceIdentity ||
                  nextResolution.width <= 0 ||
                  nextResolution.height <= 0
                ) {
                  return;
                }
                setResolution(nextResolution);
                onResolution(resolutionIdentity, nextResolution);
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

function previewItemAtIndex(
  items: readonly ImagePreviewItem[],
  index: number,
  itemOverrideIndex?: number,
  itemOverride?: ImagePreviewItem
) {
  return itemOverrideIndex === index && itemOverride ? itemOverride : items[index];
}

function createPreviewRingState(
  items: readonly ImagePreviewItem[],
  activeIndex: number,
  itemOverrideIndex?: number,
  itemOverride?: ImagePreviewItem
): PreviewRingState {
  const clampedActiveIndex = clampIndex(activeIndex, items.length);
  if (items.length === 0) {
    return { activeIndex: clampedActiveIndex, activeSlot: 0, slots: [] };
  }
  const activeSlot =
    items.length <= 2
      ? clampedActiveIndex
      : clampedActiveIndex === 0
        ? 0
        : clampedActiveIndex === items.length - 1
          ? 2
          : 1;
  const slots: PreviewRingSlot[] = Array.from({ length: Math.min(3, items.length) }, (_, slot) => ({
    page: null,
    role: 0,
    slot
  }));
  const assignedRoles = new Set<PreviewRingRole>();
  for (let role = -1 as PreviewRingRole; role <= 1; role += 1) {
    const index = clampedActiveIndex + role;
    const item = previewItemAtIndex(items, index, itemOverrideIndex, itemOverride);
    if (item) {
      const slot = activeSlot + role;
      slots[slot] = { page: { index, item }, role, slot };
      assignedRoles.add(role);
    }
  }
  const unassignedRole = ([-1, 1] as const).find((role) => !assignedRoles.has(role));
  if (unassignedRole !== undefined) {
    const emptySlot = slots.find(({ page }) => page === null);
    if (emptySlot) {
      emptySlot.role = unassignedRole;
    }
  }
  return { activeIndex: clampedActiveIndex, activeSlot, slots };
}

function previewResolutionIdentity(mediaContext: ForumMediaRequestContext, item: ImagePreviewItem) {
  const referrer =
    imageRequestHeadersForUrl(item.originalUri, { mediaContext, referrerPolicy: item.referrerPolicy })?.Referer ||
    'none';
  return `${mediaContext.sessionIdentity}\u0000${item.originalUri}\u0000referrer:${referrer}`;
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
    ...StyleSheet.absoluteFill
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
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center'
  },
  hiddenMedia: {
    opacity: 0
  },
  overlayBackground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000'
  },
  page: {
    flex: 1
  },
  previewPage: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  ringSlot: {
    ...StyleSheet.absoluteFill
  },
  ringViewport: {
    flex: 1,
    overflow: 'hidden'
  },
  transparentOverlay: {
    backgroundColor: 'transparent'
  }
});
