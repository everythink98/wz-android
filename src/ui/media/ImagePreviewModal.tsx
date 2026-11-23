import { ActivityIndicator } from 'react-native-paper';
import { recordUserInteraction } from '@/platform/network/userPresence';
import { isLinuxDoPacketCover } from '@/domain/forum/linuxDoPacket';
import { LinuxDoPacketCover } from '@/ui/content/LinuxDoPacketCover';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import {
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
  type GestureTouchEvent,
  usePanGesture
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ResumableZoom, fitContainer, type ResumableZoomRefType } from 'react-native-zoom-toolkit';
import { X } from 'lucide-react-native';
import { imageRequestHeadersForUrl, imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { type ImagePreviewItem, type ImagePreviewList } from '@/platform/media/imagePreviewCatalog';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { NavigationBackdropProvider, NavigationBackdropTarget, NavigationGlass } from '@/ui/navigation/NavigationGlass';
import {
  readerRadii,
  type ReaderStyleSettings,
  fontFamilyValue,
  type ReaderTheme,
  textSizeStyle
} from '@/ui/theme/tokens';
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

type PreviewLoadState =
  { phase: 'pending' } | { phase: 'recovering'; generation: number } | { phase: 'loaded' | 'failed' | 'retired' };
type PreviewPosterRefresh = { phase: 'idle' } | { phase: 'running' | 'finished'; sourceIdentity: string };

class PreviewLoadOwner {
  private state: PreviewLoadState = { phase: 'pending' };
  private listeners = new Set<() => void>();
  private poster: PreviewPosterRefresh = { phase: 'idle' };
  private generation = 0;
  private readonly identity: string;
  private nativeFailure = false;
  readonly loadMetricsRef: { current: PreviewImageLoadMetrics };
  readonly previewDiagnosticRef: { current: { fallback: boolean; trace: DiagnosticTrace } | null } = { current: null };
  readonly svgArtifactConsumer = new AbortController();

  constructor(
    readonly requestIdentity: string,
    sourceIdentity: string,
    startedAt: number
  ) {
    this.identity = sourceIdentity;
    this.loadMetricsRef = { current: { sourceIdentity, startedAt } };
  }

  get sourceIdentity() {
    return this.state.phase === 'retired' ? '' : this.identity;
  }
  get settled() {
    return this.state.phase === 'loaded' || this.state.phase === 'failed' || this.state.phase === 'retired';
  }
  get nativeFailed() {
    return this.nativeFailure;
  }
  get requestGeneration() {
    return this.generation;
  }
  get recovering() {
    return this.state.phase === 'recovering';
  }

  getStatus = (): PreviewStatus =>
    this.state.phase === 'loaded' ? 'loaded' : this.state.phase === 'failed' ? 'failed' : 'loading';
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private commit(state: PreviewLoadState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  settle(outcome: 'loaded' | 'failed') {
    if (outcome === 'failed') this.nativeFailure = true;
    this.commit({ phase: outcome });
  }

  nativeError() {
    this.nativeFailure = true;
  }

  beginRecovery() {
    if (this.settled || this.recovering) return null;
    this.commit({ phase: 'recovering', generation: this.generation });
    return this.generation;
  }

  finishRecovery(generation: number) {
    if (this.state.phase === 'recovering' && this.state.generation === generation) this.commit({ phase: 'pending' });
  }

  invalidateRecovery() {
    this.generation += 1;
    if (this.state.phase === 'recovering') this.commit({ phase: 'pending' });
  }

  claimPosterRefresh(sourceIdentity: string) {
    if (this.poster.phase !== 'idle' && this.poster.sourceIdentity === sourceIdentity) {
      return this.poster.phase === 'running' ? 'busy' : 'already-attempted';
    }
    this.poster = { phase: 'running', sourceIdentity };
    return 'started';
  }

  finishPosterRefresh(sourceIdentity: string) {
    if (this.poster.phase === 'running' && this.poster.sourceIdentity === sourceIdentity)
      this.poster = { phase: 'finished', sourceIdentity };
  }

  reopenSettled() {
    if (!this.settled) return false;
    this.commit({ phase: 'pending' });
    return true;
  }

  dispose() {
    if (this.state.phase === 'retired') return;
    this.invalidateRecovery();
    this.svgArtifactConsumer.abort();
    this.commit({ phase: 'retired' });
  }
}

function createPreviewLoadOwner(requestIdentity: string, sourceIdentity: string, startedAt = 0) {
  return new PreviewLoadOwner(requestIdentity, sourceIdentity, startedAt);
}

type ImagePreviewModalProps = {
  preview: ImagePreviewList | null;
  nodeSeekMediaUserAgent?: string;
  onClose: () => void;
  onSave?: () => void;
  onSelect: (index: number) => void;
  onVisibleImageChange?: (item: ImagePreviewItem | null) => void;
  onInteraction?: () => void;
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
  onVisibleImageChange?: ImagePreviewModalProps['onVisibleImageChange'];
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

type PreviewRingTransition = { phase: 'idle' | 'animating' } | { phase: 'committing'; ring: PreviewRingState };

/** Owns the JS ring and queued destination; UI-thread animation is a separate physical receipt. */
class PreviewRingController {
  private currentRing: PreviewRingState;
  private transition: PreviewRingTransition = { phase: 'idle' };
  private pendingExternalRebuild = false;
  private requestedIndex: number;
  private destination: number;

  constructor(
    private items: readonly ImagePreviewItem[],
    index: number,
    private overrideIndex: number | undefined,
    private override: ImagePreviewItem | undefined,
    private open: boolean
  ) {
    this.currentRing = createPreviewRingState(items, index, overrideIndex, override);
    this.requestedIndex = index;
    this.destination = index;
  }

  get ring() {
    return this.currentRing;
  }
  get activeIndex() {
    return this.currentRing.activeIndex;
  }
  get desiredIndex() {
    return this.destination;
  }
  get transitioning() {
    return this.transition.phase !== 'idle';
  }
  get needsRebuild() {
    return this.pendingExternalRebuild;
  }

  commitPublished(ring: PreviewRingState) {
    if (this.transition.phase !== 'committing' || this.transition.ring !== ring) return false;
    this.transition = { phase: 'idle' };
    return true;
  }

  rebuild(index: number) {
    this.currentRing = createPreviewRingState(this.items, index, this.overrideIndex, this.override);
    this.transition = { phase: 'idle' };
    this.pendingExternalRebuild = false;
    this.destination = this.currentRing.activeIndex;
    return this.currentRing;
  }

  observeCatalog(
    items: readonly ImagePreviewItem[],
    overrideIndex: number | undefined,
    override: ImagePreviewItem | undefined,
    open: boolean
  ) {
    const reopening = open && !this.open;
    const changed = this.items !== items || this.override !== override || this.overrideIndex !== overrideIndex;
    this.items = items;
    this.override = override;
    this.overrideIndex = overrideIndex;
    this.open = open;
    return { reopening, changed };
  }

  requestExternal(index: number, catalogChanged: boolean, reopening: boolean, animationRunning: boolean) {
    if (!reopening && !catalogChanged && this.requestedIndex === index) return 'unchanged';
    this.requestedIndex = index;
    this.destination = index;
    if (this.transitioning || animationRunning) {
      this.pendingExternalRebuild = true;
      return 'deferred';
    }
    return 'rebuild';
  }

  started(targetIndex: number) {
    this.transition = { phase: 'animating' };
    if (this.destination === this.activeIndex) this.destination = targetIndex;
  }

  canceled() {
    this.transition = { phase: 'idle' };
    if (!this.pendingExternalRebuild) this.destination = this.activeIndex;
  }

  commitStep(direction: -1 | 1, targetIndex: number, targetSlot: number, recycleSlot: number) {
    const currentRing = this.currentRing;
    const target = currentRing.slots.find(({ slot }) => slot === targetSlot);
    if (target?.page?.index !== targetIndex || targetIndex !== currentRing.activeIndex + direction) {
      this.transition = { phase: 'idle' };
      return null;
    }
    const recycledIndex = targetIndex + direction;
    const recycledItem = previewItemAtIndex(this.items, recycledIndex, this.overrideIndex, this.override);
    const nextSlots = currentRing.slots.map((slot): PreviewRingSlot => {
      if (slot.slot === currentRing.activeSlot) return { ...slot, role: direction === 1 ? -1 : 1 };
      if (slot.slot === targetSlot) return { ...slot, role: 0 };
      if (slot.slot === recycleSlot)
        return { ...slot, page: recycledItem ? { index: recycledIndex, item: recycledItem } : null, role: direction };
      return slot;
    });
    const nextRing = { activeIndex: targetIndex, activeSlot: targetSlot, slots: nextSlots };
    const notifySelection = !this.pendingExternalRebuild;
    if (notifySelection) this.requestedIndex = targetIndex;
    this.currentRing = nextRing;
    this.transition = { phase: 'committing', ring: nextRing };
    return { ring: nextRing, notifySelection };
  }

  requestMove(index: number) {
    this.destination = clampIndex(index, this.items.length);
    this.pendingExternalRebuild = false;
    return this.destination;
  }
}

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
  if (!props.preview?.items.length) return null;
  return <ImagePreviewModalContent key={mediaContext.sessionIdentity} {...props} mediaContext={mediaContext} />;
}

function ImagePreviewModalContent({
  preview,
  nodeSeekMediaUserAgent,
  mediaContext,
  onClose,
  onSave,
  onSelect,
  onVisibleImageChange,
  onInteraction
}: ImagePreviewModalProps & { mediaContext: ForumMediaRequestContext }) {
  const { styles, theme } = useReaderThemeStyles(createStyles);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const previewItems = preview?.items || EMPTY_PREVIEW_ITEMS;
  const itemOverride = preview?.itemOverride;
  const itemOverrideIndex = preview?.itemOverrideIndex;
  const previewCount = previewItems.length;
  const requestedIndex = clampIndex(preview?.index ?? 0, previewCount);
  const [previewRing] = useState(
    () => new PreviewRingController(previewItems, requestedIndex, itemOverrideIndex, itemOverride, Boolean(preview))
  );
  const [ring, setRing] = useState(() => previewRing.ring);
  const activeIndex = ring.activeIndex;
  const [activeZoomed, setActiveZoomed] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [animatedSvgZoomSuspended, setAnimatedSvgZoomSuspended] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, PreviewResolution>>({});
  const zoomRefs = useRef(new Map<number, ResumableZoomRefType>());
  const mountedRef = useRef(true);
  const overlayOpacity = useSharedValue(1);
  const pullTranslateY = useSharedValue(0);
  const closing = useSharedValue(false);
  const ringTranslateX = useSharedValue(0);
  const activeZoomScale = useSharedValue(1);
  const zoomGestureActive = useSharedValue(false);
  const lastInteractionAt = useSharedValue(0);
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
    if (previewRing.commitPublished(ring)) transitioning.value = false;
  }, [previewRing, ring, transitioning]);

  const rebuildRing = useCallback(
    (index: number) => {
      zoomRefs.current.get(previewRing.activeIndex)?.reset(false);
      const nextRing = previewRing.rebuild(index);
      for (const slot of nextRing.slots) {
        setSlotRole(slot.slot, slot.role);
      }
      ringTranslateX.value = 0;
      pullTranslateY.value = 0;
      overlayOpacity.value = 1;
      activeZoomScale.value = 1;
      activeIndexOnUI.value = nextRing.activeIndex;
      transitioning.value = false;
      setActiveZoomed(false);
      setAnimatedSvgZoomSuspended(false);
      setRing(nextRing);
    },
    [
      activeIndexOnUI,
      activeZoomScale,
      overlayOpacity,
      previewRing,
      pullTranslateY,
      ringTranslateX,
      setSlotRole,
      transitioning
    ]
  );

  useEffect(() => {
    const previewOpen = Boolean(preview && previewCount > 0);
    const { reopening, changed: catalogChanged } = previewRing.observeCatalog(
      previewItems,
      itemOverrideIndex,
      itemOverride,
      previewOpen
    );
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
    if (previewRing.requestExternal(requestedIndex, catalogChanged, reopening, transitioning.value) === 'rebuild')
      rebuildRing(requestedIndex);
  }, [
    closing,
    overlayOpacity,
    preview,
    previewCount,
    previewItems,
    previewRing,
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
  const reportInteraction = useCallback(() => {
    lastInteractionAt.value = performance.now();
    onInteraction?.();
  }, [lastInteractionAt, onInteraction]);
  const reportContinuousInteraction = useCallback(() => {
    'worklet';
    const now = performance.now();
    if (onInteraction && now - lastInteractionAt.value >= 1000) {
      lastInteractionAt.value = now;
      scheduleOnRN(onInteraction);
    }
  }, [lastInteractionAt, onInteraction]);
  const handleZoomGestureStart = useCallback(
    (index: number) => {
      if (previewRing.activeIndex !== index) return;
      zoomGestureActive.value = true;
      reportInteraction();
      setAnimatedSvgZoomSuspended(true);
    },
    [previewRing, reportInteraction, zoomGestureActive]
  );
  const handleZoomGestureSettled = useCallback(
    (index: number, scale: number) => {
      if (previewRing.activeIndex !== index) return;
      if (zoomGestureActive.value) reportInteraction();
      zoomGestureActive.value = false;
      const zoomed = Math.abs(scale - 1) > 0.001;
      setActiveZoomed(zoomed);
      setAnimatedSvgZoomSuspended(zoomed);
    },
    [previewRing, reportInteraction, zoomGestureActive]
  );
  useLayoutEffect(() => {
    zoomGestureActive.value = false;
  }, [activeIndex, zoomGestureActive]);
  const handleZoomUpdate = useCallback(
    (index: number, scale: number) => {
      'worklet';
      if (activeIndexOnUI.value === index) {
        activeZoomScale.value = scale;
        if (zoomGestureActive.value) reportContinuousInteraction();
      }
    },
    [activeIndexOnUI, activeZoomScale, reportContinuousInteraction, zoomGestureActive]
  );

  const markTransitionStarted = useCallback(
    (targetIndex: number) => {
      if (!mountedRef.current) {
        return;
      }
      previewRing.started(targetIndex);
      zoomRefs.current.get(previewRing.activeIndex)?.reset(false);
      activeZoomScale.value = 1;
      setActiveZoomed(false);
      setAnimatedSvgZoomSuspended(false);
    },
    [activeZoomScale, previewRing]
  );

  const cancelTransition = useCallback(() => {
    previewRing.canceled();
    if (previewRing.needsRebuild) rebuildRing(previewRing.desiredIndex);
  }, [previewRing, rebuildRing]);

  const commitRingStep = useCallback(
    (direction: -1 | 1, targetIndex: number, targetSlot: number, recycleSlot: number) => {
      if (!mountedRef.current) {
        return;
      }
      const committed = previewRing.commitStep(direction, targetIndex, targetSlot, recycleSlot);
      if (!committed) {
        transitioning.value = false;
        return;
      }
      activeIndexOnUI.value = targetIndex;
      setRing(committed.ring);
      if (committed.notifySelection) onSelect(targetIndex);
    },
    [activeIndexOnUI, onSelect, previewRing, transitioning]
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
      if (previewRing.transitioning || transitioning.value) {
        return false;
      }
      const currentRing = previewRing.ring;
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
    [animateRingStep, markTransitionStarted, previewRing, transitioning]
  );

  const moveToIndex = useCallback(
    (index: number) => {
      const nextIndex = previewRing.requestMove(index);
      if (!previewRing.transitioning && !transitioning.value && nextIndex !== previewRing.activeIndex) {
        startRingStep(nextIndex > previewRing.activeIndex ? 1 : -1);
      }
    },
    [previewRing, startRingStep, transitioning]
  );

  const queueGestureStep = useCallback(
    (direction: -1 | 1) => {
      moveToIndex(previewRing.desiredIndex + direction);
    },
    [moveToIndex, previewRing]
  );

  useEffect(() => {
    if (previewRing.transitioning || transitioning.value) {
      return;
    }
    if (previewRing.needsRebuild) {
      rebuildRing(previewRing.desiredIndex);
      return;
    }
    const desiredIndex = previewRing.desiredIndex;
    if (desiredIndex !== ring.activeIndex) {
      startRingStep(desiredIndex > ring.activeIndex ? 1 : -1);
    }
  }, [previewRing, rebuildRing, ring, startRingStep, transitioning]);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') {
        moveToIndex(previewRing.desiredIndex + 1);
      } else if (event.nativeEvent.actionName === 'decrement') {
        moveToIndex(previewRing.desiredIndex - 1);
      }
    },
    [moveToIndex, previewRing]
  );

  const handleSave = useCallback(async () => {
    if (!onSave || saving) {
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

  const closePreview = useCallback(() => {
    if (mountedRef.current) onClose();
  }, [onClose]);

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
          scheduleOnRN(closePreview);
        }
        return;
      }
      pullTranslateY.value = withTiming(0);
      overlayOpacity.value = withTiming(1);
    },
    [closePreview, closing, height, overlayOpacity, pullTranslateY]
  );

  const previousSlot = ring.slots.find(({ page, role }) => role === -1 && page?.index === activeIndex - 1)?.slot ?? -1;
  const nextSlot = ring.slots.find(({ page, role }) => role === 1 && page?.index === activeIndex + 1)?.slot ?? -1;
  const recycleForPrevious = ring.slots.length === 3 ? (ring.slots.find(({ role }) => role === 1)?.slot ?? -1) : -1;
  const recycleForNext = ring.slots.length === 3 ? (ring.slots.find(({ role }) => role === -1)?.slot ?? -1) : -1;
  const singlePreviewTouch = (event: GestureTouchEvent) => {
    'worklet';
    const touch =
      event.numberOfTouches !== 1 || Math.abs(activeZoomScale.value - 1) > 0.001 ? undefined : event.allTouches[0];
    if (!touch) GestureStateManager.fail(event.handlerTag);
    return touch;
  };
  const previewGesture = usePanGesture({
    manualActivation: true,
    maxPointers: 1,
    onTouchesDown: (event) => {
      'worklet';
      const touch = singlePreviewTouch(event);
      if (!touch) return;
      gestureAxis.value = 0;
      gestureQueuesTransition.value = transitioning.value;
      gestureStartX.value = touch.absoluteX;
      gestureStartY.value = touch.absoluteY;
      if (onInteraction) scheduleOnRN(reportInteraction);
    },
    onTouchesMove: (event) => {
      'worklet';
      const touch = singlePreviewTouch(event);
      if (!touch) return;
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
      reportContinuousInteraction();
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
    <Modal visible transparent animationType="none" onRequestClose={closePreview}>
      <NavigationBackdropProvider>
        <GestureHandlerRootView
          onTouchStart={recordUserInteraction}
          onTouchMove={recordUserInteraction}
          style={[styles.imagePreviewOverlay, componentStyles.transparentOverlay]}
        >
          <View style={StyleSheet.absoluteFill}>
            <NavigationBackdropTarget active={chromeVisible} testID="image-preview-glass-content">
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
                              onToggleChrome={() => {
                                reportInteraction();
                                setChromeVisible((current) => !current);
                              }}
                              onVisibleImageChange={onVisibleImageChange}
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
            </NavigationBackdropTarget>
          </View>
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
              text: [activeItem?.alt, `第 ${activeIndex + 1} 张，共 ${previewCount} 张`].filter(Boolean).join('，')
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
                  onPress={closePreview}
                >
                  <NavigationGlass variant="media" />
                  <X size={22} color={theme.onOverlay} strokeWidth={1.8} />
                </Pressable>
                <View style={styles.imagePreviewCounter}>
                  <NavigationGlass variant="media" />
                  <Text accessibilityLiveRegion="polite" style={styles.imagePreviewCount}>
                    {activeIndex + 1}/{previewCount}
                  </Text>
                </View>
                <View style={componentStyles.chromeSpacer} />
              </View>
              {onSave ? (
                <View
                  pointerEvents="box-none"
                  style={[componentStyles.bottomBar, { bottom: Math.max(insets.bottom, 16) }]}
                >
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
                    <NavigationGlass variant="media" />
                    <Text style={styles.imagePreviewButtonText}>{saving ? '保存中…' : '保存'}</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
        </GestureHandlerRootView>
      </NavigationBackdropProvider>
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

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  const fontFamily = fontFamilyValue(settings.uiFontFamily);
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
    imagePreviewCount: { color: theme.onOverlay, fontFamily, ...textSizeStyle(13), fontWeight: '600' },
    imagePreviewCounter: {
      minHeight: 36,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: readerRadii.control,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.18)'
    },
    imagePreviewTextButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 58,
      minHeight: 44,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: readerRadii.control,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.18)'
    },
    imagePreviewButtonText: { color: theme.onOverlay, fontFamily, ...textSizeStyle(13), fontWeight: '700' },
    imagePreviewClose: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 44,
      height: 44,
      borderRadius: readerRadii.pill,
      overflow: 'hidden',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255, 255, 255, 0.18)'
    },
    imagePreviewScroll: { flex: 1, width: '100%' },
    imagePreviewState: {
      position: 'absolute',
      alignSelf: 'center',
      top: '46%',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: readerRadii.surface,
      backgroundColor: 'rgba(0, 0, 0, 0.58)',
      paddingHorizontal: 14,
      paddingVertical: 11
    },
    imagePreviewStateText: { color: theme.onOverlay, fontFamily, ...textSizeStyle(13), fontWeight: '600' }
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
  onVisibleImageChange,
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
  const progressDeadline = useRef(0);
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
  const sourceIdentity = `${requestIdentity}\u0000${retryVersion}`;
  const [logicalLoadOwner, setLogicalLoadOwner] = useState(() =>
    createPreviewLoadOwner(requestIdentity, sourceIdentity)
  );
  if (logicalLoadOwner.requestIdentity !== requestIdentity) {
    setLogicalLoadOwner(createPreviewLoadOwner(requestIdentity, sourceIdentity));
  }
  const { loadMetricsRef, previewDiagnosticRef, svgArtifactConsumer } = logicalLoadOwner;
  useLayoutEffect(() => {
    if (!loadMetricsRef.current.startedAt) loadMetricsRef.current.startedAt = Date.now();
  }, [loadMetricsRef]);
  const loadStatus = useSyncExternalStore(
    logicalLoadOwner.subscribe,
    logicalLoadOwner.getStatus,
    logicalLoadOwner.getStatus
  );
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
  const svgViewIdentity = activeAnimatedArtifact
    ? `${sourceIdentity}\u0000${activeAnimatedArtifact.requestIdentity}`
    : '';
  const [svgPresentation, setSvgPresentation] = useState({ viewIdentity: '', posterIdentity: '' });
  const readySvgViewIdentity = svgPresentation.viewIdentity;
  const displayedSvgPosterIdentity = svgPresentation.posterIdentity;
  const svgPosterIdentity = activeAnimatedArtifact
    ? `${svgViewIdentity}\u0000${activeAnimatedArtifact.posterRevision}`
    : '';
  const animatedSvgPosterReady = displayedSvgPosterIdentity === svgPosterIdentity;
  const [imageState, setImageState] = useState<PreviewImageState>({
    regionEligible: false,
    sourceIdentity
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
  const status = logicalLoadOwner.sourceIdentity === sourceIdentity ? loadStatus : 'loading';
  useLayoutEffect(() => {
    if (!active) return;
    onVisibleImageChange?.(status === 'loaded' ? item : null);
    return () => onVisibleImageChange?.(null);
  }, [active, item, onVisibleImageChange, status]);
  const regionEligible = imageState.sourceIdentity === sourceIdentity && imageState.regionEligible;
  const suppressLoadingOverlay =
    displayedBeforeMount && !knownArtifact && !logicalLoadOwner.nativeFailed && retryVersion === 0;
  const setCurrentRegionEligibility = useCallback(
    (eligible: boolean) => {
      setImageState({
        regionEligible: eligible,
        sourceIdentity
      });
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
      terminalReason: NonNullable<DiagnosticFields['terminalReason']>,
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
      if (!mountedRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity || logicalLoadOwner.settled) {
        return;
      }
      logicalLoadOwner.settle('loaded');
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
    },
    [finishActiveDiagnostic, loadMetricsRef, originalSource, logicalLoadOwner, sourceIdentity]
  );

  const settleFailure = useCallback(
    (fallback: boolean, terminalReason: 'fallback-error' | 'native-error' | 'timeout') => {
      if (!mountedRef.current || !activeRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
        return;
      }
      logicalLoadOwner.settle('failed');
      finishActiveDiagnostic('failure', fallback, terminalReason, previewImageMetricFields(loadMetricsRef.current));
    },
    [finishActiveDiagnostic, loadMetricsRef, logicalLoadOwner, sourceIdentity]
  );

  const recoverSvgArtifact = useCallback(
    async (diagnosticSource = originalSource) => {
      if (
        !mountedRef.current ||
        !activeRef.current ||
        logicalLoadOwner.sourceIdentity !== sourceIdentity ||
        logicalLoadOwner.settled ||
        logicalLoadOwner.recovering
      ) {
        return;
      }
      const generation = logicalLoadOwner.beginRecovery();
      if (generation === null) return;
      currentDiagnostic(true);
      try {
        const artifact = await recoverCompatibleSvgArtifact(diagnosticSource, {
          signal: svgArtifactConsumer.signal
        });
        if (
          !mountedRef.current ||
          !activeRef.current ||
          logicalLoadOwner.sourceIdentity !== sourceIdentity ||
          logicalLoadOwner.settled ||
          generation !== logicalLoadOwner.requestGeneration
        ) {
          return;
        }
        logicalLoadOwner.finishRecovery(generation);
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
        if (generation === logicalLoadOwner.requestGeneration) {
          settleFailure(true, 'fallback-error');
        }
      }
    },
    [
      currentDiagnostic,
      loadMetricsRef,
      onResolution,
      originalSource,
      logicalLoadOwner,
      resolutionIdentity,
      setCompatibleSvgArtifact,
      setResolution,
      settleFailure,
      sourceIdentity,
      svgArtifactConsumer
    ]
  );

  const refreshSvgPoster = useCallback(
    async (artifact: CompatibleSvgArtifact, terminalOnFailure: boolean) => {
      if (!mountedRef.current || !activeRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
        return;
      }
      const refresh = logicalLoadOwner.claimPosterRefresh(sourceIdentity);
      if (refresh === 'busy') return;
      if (refresh === 'already-attempted') {
        if (terminalOnFailure) {
          settleFailure(true, 'fallback-error');
        }
        return;
      }
      if (logicalLoadOwner.reopenSettled()) {
        loadMetricsRef.current = { sourceIdentity, startedAt: Date.now() };
      }
      currentDiagnostic(true);
      try {
        const refreshed = await refreshCompatibleSvgPoster(artifact, {
          signal: svgArtifactConsumer.signal
        });
        if (!mountedRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
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
        logicalLoadOwner.finishPosterRefresh(sourceIdentity);
      }
    },
    [
      currentDiagnostic,
      loadMetricsRef,
      onResolution,
      logicalLoadOwner,
      resolutionIdentity,
      setCompatibleSvgArtifact,
      setResolution,
      settleFailure,
      sourceIdentity,
      svgArtifactConsumer
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
    if (svgArtifactConsumer.signal.aborted) {
      setLogicalLoadOwner(createPreviewLoadOwner(requestIdentity, sourceIdentity, loadMetricsRef.current.startedAt));
      return;
    }
    return () => {
      logicalLoadOwner.dispose();
      finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
    };
  }, [finishActiveDiagnostic, loadMetricsRef, logicalLoadOwner, requestIdentity, sourceIdentity, svgArtifactConsumer]);

  useEffect(() => {
    if (!activeArtifact) {
      return;
    }
    setResolution(activeArtifact.dimensions);
    onResolution(resolutionIdentity, activeArtifact.dimensions);
  }, [activeArtifact, onResolution, resolutionIdentity, setResolution]);

  useEffect(() => {
    if (!active) {
      setSvgPresentation({ viewIdentity: '', posterIdentity: '' });
      logicalLoadOwner.invalidateRecovery();
      finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
      return;
    }
    if (!logicalLoadOwner.settled) {
      if (!previewDiagnosticRef.current) {
        loadMetricsRef.current = {
          sourceIdentity,
          startedAt: Date.now()
        };
      }
      currentDiagnostic(false);
    }
    if (logicalLoadOwner.nativeFailed && !logicalLoadOwner.settled) {
      void recoverSvgArtifact();
    }
  }, [
    active,
    currentDiagnostic,
    finishActiveDiagnostic,
    loadMetricsRef,
    logicalLoadOwner,
    previewDiagnosticRef,
    recoverSvgArtifact,
    sourceIdentity
  ]);

  useEffect(() => {
    if (!active || logicalLoadOwner.settled || status !== 'loading') {
      return undefined;
    }
    progressDeadline.current = Date.now() + IMAGE_LOAD_TIMEOUT_MS;
    const checkProgress = () => {
      const remaining = progressDeadline.current - Date.now();
      if (remaining > 0) timeout = setTimeout(checkProgress, remaining);
      else settleFailure(false, 'timeout');
    };
    let timeout = setTimeout(checkProgress, IMAGE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [active, retryVersion, settleFailure, logicalLoadOwner, status]);

  useEffect(() => {
    if (!active) {
      setRegionSuspended(false);
      setRegionState({ scale: 1, sourceIdentity, viewport: FULL_PREVIEW_VIEWPORT });
      return undefined;
    }
    if (status !== 'loaded' || knownArtifact || !regionEligible || isLinuxDoPacketCover(originalSource.uri || '')) {
      return undefined;
    }
    const cacheKey = originalSource.cacheKey || originalSource.uri;
    if (!cacheKey) {
      return undefined;
    }
    let cancelled = false;
    void ExpoImage.getCachePathAsync(cacheKey)
      .then((filePath) => {
        if (
          cancelled ||
          !mountedRef.current ||
          !activeRef.current ||
          logicalLoadOwner.sourceIdentity !== sourceIdentity
        ) {
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
    logicalLoadOwner,
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

    finishActiveDiagnostic('stale', false, 'stale', previewImageMetricFields(loadMetricsRef.current));
    const nextRetryVersion = retryVersion + 1;
    const nextSourceIdentity = `${requestIdentity}\u0000${nextRetryVersion}`;
    logicalLoadOwner.dispose();
    setLogicalLoadOwner(createPreviewLoadOwner(requestIdentity, nextSourceIdentity, Date.now()));
    setRetryState({ requestIdentity, version: nextRetryVersion });
  }, [finishActiveDiagnostic, loadMetricsRef, logicalLoadOwner, requestIdentity, retryVersion]);
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
          {status !== 'failed' && mediaContext.contentSource === 'linuxdo' && isLinuxDoPacketCover(item.originalUri) ? (
            <LinuxDoPacketCover
              key={JSON.stringify([mediaContext.sessionIdentity, sourceIdentity, retryVersion])}
              cover={item.originalUri}
              dimensions={imageSize}
              settle={(outcome) =>
                outcome === 'displayed' ? settleLoaded(false) : settleFailure(false, 'native-error')
              }
            />
          ) : status !== 'failed' ? (
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
                if (!mountedRef.current || !activeRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
                  return;
                }
                setSvgPresentation((current) => ({ ...current, posterIdentity: svgPosterIdentity }));
              }}
              onAnimatedPosterError={() => {
                if (!mountedRef.current || !activeRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
                  return;
                }
                setSvgPresentation((current) =>
                  current.posterIdentity === svgPosterIdentity ? { ...current, posterIdentity: '' } : current
                );
                void refreshSvgPoster(activeAnimatedArtifact!, false);
              }}
              onDisplay={() => settleLoaded(false)}
              onError={(diagnosticSource) => {
                if (!mountedRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
                  return;
                }
                logicalLoadOwner.nativeError();
                if (activeRef.current) {
                  void recoverSvgArtifact(diagnosticSource);
                }
              }}
              onLoad={(event) => {
                const source = event.source;
                if (!mountedRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
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
                if (
                  !mountedRef.current ||
                  logicalLoadOwner.sourceIdentity !== sourceIdentity ||
                  logicalLoadOwner.settled
                ) {
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
              }}
              onPosterDisplay={() => settleLoaded(true)}
              onPosterError={() => {
                void refreshSvgPoster(knownArtifact!, true);
              }}
              onProgress={(event) => {
                if (
                  !mountedRef.current ||
                  logicalLoadOwner.sourceIdentity !== sourceIdentity ||
                  logicalLoadOwner.settled
                ) {
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
                  progressDeadline.current = Date.now() + IMAGE_LOAD_TIMEOUT_MS;
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
                  logicalLoadOwner.sourceIdentity !== sourceIdentity ||
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
                if (!mountedRef.current || !activeRef.current || logicalLoadOwner.sourceIdentity !== sourceIdentity) {
                  return;
                }
                setSvgPresentation((current) => ({ ...current, viewIdentity: svgViewIdentity }));
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
