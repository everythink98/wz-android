import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor, within } from '../render';
import React from 'react';
import { NativeModules, PixelRatio, StyleSheet } from 'react-native';
import { ImagePreviewModal } from '@/ui/media/ImagePreviewModal';
import { ForumSessionEpochProvider, mediaSessionIdentityForSource } from '@/platform/media/mediaSessionEpoch';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { originalImageDisplayRevision } from '@/platform/media/originalImageLoading';
import {
  getReadNetworkRuntimeSnapshot,
  publishReadNetworkRuntimeRotation
} from '@/platform/network/readNetworkRuntime';

const mockRenderSvgPoster = jest.fn(async (_svgBase64: string, _cacheKey: string) => ({
  documentHeight: 1025,
  documentWidth: 920,
  height: 1025,
  uri: 'file:///cache/complex-svg-poster.png',
  width: 920
}));
const mockGetImageCachePath = jest.fn(
  async (cacheKey: string): Promise<string | null> => `/cache/${encodeURIComponent(cacheKey)}`
);
let mockZoomScale = 1;
let mockZoomVisibleRect = { height: 100, width: 100, x: 0, y: 0 };
let mockGestureNextToken = 0;
let mockGestureHandlerTag = 0;
const mockGestureStateManagers = new Map<number, { activate: () => void; fail: () => void }>();
let mockDeferAnimations = false;
const mockDeferredAnimationCallbacks: (() => void)[] = [];
let mockZoomNextToken = 0;
const mockZoomResets = jest.fn<(index: string) => void>();
const mockPreviewImageUnmounts = jest.fn<(testID: string) => void>();
let mockPreviewImageNextToken = 0;
let mockWebViewMounts = 0;
let mockWebViewUnmounts = 0;
let mockWebViewNextToken = 0;

async function mockFetchSvgDocument(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  if (!response.ok || !/(?:image|application)\/svg\+xml/i.test(response.headers.get('content-type') || '')) {
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length <= 1024 * 1024 ? { base64: bytes.toString('base64') } : null;
}

jest.mock('react-native-webview', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const WebViewMock = NativeView as React.ComponentType<Record<string, unknown>>;
  return {
    WebView: (props: Record<string, unknown>) => {
      const token = ReactModule.useRef(0);
      if (token.current === 0) {
        token.current = ++mockWebViewNextToken;
      }
      ReactModule.useEffect(() => {
        mockWebViewMounts += 1;
        return () => {
          mockWebViewUnmounts += 1;
        };
      }, []);
      return ReactModule.createElement(WebViewMock, { ...props, mockWebViewToken: token.current });
    }
  };
});

jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const ExpoImageMock = NativeView as React.ComponentType<Record<string, unknown>>;
  const Image = ({
    contentFit,
    testID,
    ...props
  }: {
    contentFit?: string;
    onDisplay?: () => void;
    onError?: () => void;
    onLoad?: (event: {
      source: { height: number; isAnimated?: boolean; mediaType?: string | null; width: number };
    }) => void;
    onLoadStart?: () => void;
    source?: { uri?: string };
    testID?: string;
  }) => {
    const token = ReactModule.useRef(0);
    const latestTestID = ReactModule.useRef(testID);
    if (token.current === 0) {
      token.current = ++mockPreviewImageNextToken;
    }
    latestTestID.current = testID;
    ReactModule.useEffect(
      () => () => {
        if (latestTestID.current?.startsWith('preview-image-')) {
          mockPreviewImageUnmounts(latestTestID.current);
        }
      },
      []
    );
    ReactModule.useLayoutEffect(() => {
      if (props.source?.uri?.includes('fast-cache')) {
        props.onLoadStart?.();
        props.onLoad?.({ source: { height: 480, width: 640 } });
        props.onDisplay?.();
      } else if (props.source?.uri?.includes('fast-error')) {
        props.onLoadStart?.();
        props.onError?.();
      }
    }, [props.source?.uri]);
    return ReactModule.createElement(ExpoImageMock, {
      ...props,
      mockImageInstanceToken: token.current,
      testID: testID || (contentFit === 'contain' ? 'active-preview-image' : 'preview-thumbnail-image')
    });
  };
  Image.getCachePathAsync = (cacheKey: string) => mockGetImageCachePath(cacheKey);
  return { Image };
});

jest.mock('react-native-reanimated', () => {
  const ReactModule = require('react') as typeof React;
  const actual = jest.requireActual('react-native-reanimated/mock') as Record<string, unknown>;
  return {
    ...actual,
    useSharedValue<Value>(initialValue: Value) {
      const sharedValue = ReactModule.useRef<{ value: Value } | null>(null);
      if (!sharedValue.current) {
        sharedValue.current = { value: initialValue };
      }
      return sharedValue.current;
    },
    withTiming: (value: unknown, _config?: unknown, callback?: (finished: boolean) => void) => {
      if (callback && mockDeferAnimations) {
        mockDeferredAnimationCallbacks.push(() => callback(true));
      } else {
        callback?.(true);
      }
      return value;
    }
  };
});

jest.mock('react-native-worklets', () => ({
  ...(jest.requireActual('react-native-worklets') as Record<string, unknown>),
  scheduleOnRN: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => callback(...args)
}));

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const GestureView = NativeView as React.ComponentType<Record<string, unknown>>;
  return {
    GestureStateManager: {
      activate: (handlerTag: number) => mockGestureStateManagers.get(handlerTag)?.activate(),
      fail: (handlerTag: number) => mockGestureStateManagers.get(handlerTag)?.fail()
    },
    usePanGesture: (config: Record<string, (...args: any[]) => void>) => ({
      config,
      handlerTag: ++mockGestureHandlerTag
    }),
    GestureDetector: ({
      children,
      gesture: value
    }: {
      children?: React.ReactNode;
      gesture?: { config: Record<string, (...args: any[]) => void>; handlerTag: number };
    }) => {
      const token = ReactModule.useRef(0);
      if (token.current === 0) {
        token.current = ++mockGestureNextToken;
      }
      const mockGesture = ({
        pointers = 1,
        pointersOnMove = pointers,
        translationX = 0,
        translationY = 0,
        velocityX = 0,
        velocityY = 0,
        canceled = false
      }: {
        pointers?: number;
        pointersOnMove?: number;
        translationX?: number;
        translationY?: number;
        velocityX?: number;
        velocityY?: number;
        canceled?: boolean;
      }) => {
        let active = false;
        let failed = false;
        const state = {
          activate: () => {
            if (!failed) {
              active = true;
            }
          },
          fail: () => {
            failed = true;
            active = false;
          }
        };
        const touches = (count: number, moved: boolean) =>
          Array.from({ length: count }, (_, index) => ({
            absoluteX: 200 + (moved ? translationX : 0) + index * 40,
            absoluteY: 400 + (moved ? translationY : 0) + index * 40,
            id: index,
            x: 200 + (moved ? translationX : 0) + index * 40,
            y: 400 + (moved ? translationY : 0) + index * 40
          }));
        const touchEvent = (count: number, moved: boolean) => ({
          allTouches: touches(count, moved),
          changedTouches: touches(count, moved),
          handlerTag: value?.handlerTag,
          numberOfTouches: count
        });
        if (value) mockGestureStateManagers.set(value.handlerTag, state);
        value?.config.onTouchesDown?.(touchEvent(pointers, false));
        if (pointersOnMove !== pointers) {
          value?.config.onTouchesDown?.(touchEvent(pointersOnMove, false));
        }
        value?.config.onTouchesMove?.(touchEvent(pointersOnMove, true));
        const panEvent = { translationX, translationY, velocityX, velocityY };
        if (active && !failed) {
          value?.config.onActivate?.(panEvent);
          value?.config.onUpdate?.(panEvent);
          value?.config.onDeactivate?.({ ...panEvent, canceled });
        }
        value?.config.onFinalize?.({ ...panEvent, canceled: canceled || !(active && !failed) });
        return { active, failed };
      };
      return ReactModule.createElement(
        GestureView,
        {
          mockGesture,
          mockGestureToken: token.current,
          testID: 'image-preview-gesture'
        },
        children
      );
    },
    GestureHandlerRootView: ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement(NativeView, props, children)
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 36 })
}));

jest.mock('react-native-zoom-toolkit', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const ZoomMockView = NativeView as React.ComponentType<Record<string, unknown>>;
  return {
    fitContainer: (ratio: number, size: { width: number; height: number }) => {
      if (size.width / size.height > ratio) {
        return { height: size.height, width: size.height * ratio };
      }
      return { height: size.width / ratio, width: size.width };
    },
    ResumableZoom: ReactModule.forwardRef(
      (
        {
          children,
          ...props
        }: {
          children: React.ReactElement<{ testID?: string }>;
        },
        ref: React.ForwardedRef<{
          getState: () => {
            childSize: { height: number; width: number };
            containerSize: { height: number; width: number };
            maxScale: number;
            scale: number;
            translateX: number;
            translateY: number;
          };
          getVisibleRect: () => typeof mockZoomVisibleRect;
          reset: () => void;
        }>
      ) => {
        const token = ReactModule.useRef(0);
        if (token.current === 0) {
          token.current = ++mockZoomNextToken;
        }
        const index = children.props.testID?.replace('preview-zoom-content-', '') || 'unknown';
        ReactModule.useImperativeHandle(ref, () => ({
          getState: () => ({
            childSize: { height: 100, width: 100 },
            containerSize: { height: 100, width: 100 },
            maxScale: 20,
            scale: mockZoomScale,
            translateX: 0,
            translateY: 0
          }),
          getVisibleRect: () => mockZoomVisibleRect,
          reset: () => mockZoomResets(index)
        }));
        return ReactModule.createElement(
          ZoomMockView,
          { ...props, mockZoomToken: token.current, testID: `preview-zoom-${index}` },
          children
        );
      }
    )
  };
});

function previewItem(originalUri: string, displayUri = originalUri) {
  return { displayUri, originalUri };
}

function previewProps(items: ReturnType<typeof previewItem>[], index = 0) {
  return { contentSource: null, items, index } as const;
}

function callbacks(
  overrides: Partial<{
    onClose: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onSave: () => void;
    onSelect: (index: number) => void;
  }> = {}
) {
  return {
    onClose: jest.fn<() => void>(),
    onNext: jest.fn<() => void>(),
    onPrevious: jest.fn<() => void>(),
    onSave: jest.fn<() => void>(),
    onSelect: jest.fn<(index: number) => void>(),
    ...overrides
  };
}

type PreviewGestureInput = {
  canceled?: boolean;
  pointers?: number;
  pointersOnMove?: number;
  translationX?: number;
  translationY?: number;
  velocityX?: number;
  velocityY?: number;
};

type PreviewRender = Awaited<ReturnType<typeof render>>;

async function performPreviewGesture(view: PreviewRender, input: PreviewGestureInput) {
  let result: { active: boolean; failed: boolean } | undefined;
  await act(() => {
    result = view.getByTestId('image-preview-gesture').props.mockGesture(input);
  });
  return result;
}

async function swipePreviewNext(view: PreviewRender) {
  return performPreviewGesture(view, { translationX: -500, translationY: 10, velocityX: -1_000 });
}

async function swipePreviewPrevious(view: PreviewRender) {
  return performPreviewGesture(view, { translationX: 500, translationY: 10, velocityX: 1_000 });
}

async function flushNextPreviewAnimation() {
  await act(() => mockDeferredAnimationCallbacks.shift()?.());
}

describe('Image preview', () => {
  beforeEach(() => {
    mockZoomScale = 1;
    mockZoomVisibleRect = { height: 100, width: 100, x: 0, y: 0 };
    mockGestureNextToken = 0;
    mockGestureHandlerTag = 0;
    mockGestureStateManagers.clear();
    mockDeferAnimations = false;
    mockDeferredAnimationCallbacks.splice(0);
    mockZoomNextToken = 0;
    mockZoomResets.mockClear();
    mockPreviewImageUnmounts.mockClear();
    mockPreviewImageNextToken = 0;
    mockWebViewMounts = 0;
    mockWebViewUnmounts = 0;
    mockWebViewNextToken = 0;
    mockRenderSvgPoster.mockClear();
    mockGetImageCachePath.mockClear();
    NativeModules.SvgRendererModule = {
      fetchSvgDocument: mockFetchSvgDocument,
      renderPoster: mockRenderSvgPoster
    };
  });

  it('applies the tapped-item override without replacing the logical catalog', async () => {
    const items = [
      previewItem('https://example.com/first.png'),
      previewItem('https://example.com/original.png', 'https://example.com/catalog-display.png'),
      previewItem('https://example.com/third.png')
    ];
    const view = await render(
      <ImagePreviewModal
        preview={{
          contentSource: null,
          index: 1,
          itemOverride: {
            displaySize: { height: 360, width: 640 },
            displayUri: 'https://example.com/tapped-display.png',
            originalUri: 'https://example.com/original.png'
          },
          itemOverrideIndex: 1,
          items
        }}
        {...callbacks()}
      />
    );

    expect(view.getByTestId('preview-display-underlay-1').props.source).toEqual(
      expect.objectContaining({ uri: 'https://example.com/tapped-display.png' })
    );
    expect(items[1]?.displayUri).toBe('https://example.com/catalog-display.png');
  });

  it('isolates raster recycling by final Referer', async () => {
    const sharedUrl = 'https://cdn.example.com/shared-preview.png';
    const sharedItem = previewItem(sharedUrl);
    const items = [
      { ...sharedItem, referrerPolicy: 'no-referrer' as const },
      { ...sharedItem, referrerPolicy: 'origin' as const }
    ];
    const view = await render(
      <ImagePreviewModal
        preview={{
          contentSource: 'v2ex',
          index: 0,
          items,
          referrer: { documentUrl: 'https://www.v2ex.com/t/1233346' }
        }}
        {...callbacks()}
      />
    );

    const noReferrerImage = view.getByTestId('preview-image-0');
    const originImage = view.getByTestId('preview-image-1');
    expect(noReferrerImage.props.source.headers).not.toHaveProperty('Referer');
    expect(originImage.props.source.headers).toEqual(expect.objectContaining({ Referer: 'https://www.v2ex.com/' }));
    expect(noReferrerImage.props.recyclingKey).not.toBe(originImage.props.recyclingKey);
  });

  it('retries only the current unhealthy preview page for the triggering source', async () => {
    const items = [
      previewItem('https://example.com/runtime-current.png'),
      previewItem('https://example.com/runtime-adjacent.png')
    ];
    const view = await render(
      <ImagePreviewModal preview={{ contentSource: 'nodeseek', items, index: 0 }} {...callbacks()} />
    );
    const currentKey = view.getByTestId('preview-image-0').props.recyclingKey;
    const adjacentKey = view.getByTestId('preview-image-1').props.recyclingKey;
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(view.getByTestId('preview-image-0').props.recyclingKey).not.toBe(currentKey);
    expect(view.getByTestId('preview-image-1').props.recyclingKey).toBe(adjacentKey);
    await fireEvent(view.getByTestId('preview-image-0'), 'display');
    const displayedKey = view.getByTestId('preview-image-0').props.recyclingKey;
    const current = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(current.generation + 1, 'nodeseek'));

    expect(view.getByTestId('preview-image-0').props.recyclingKey).toBe(displayedKey);
  });

  it('defers an inactive loading preview retry until that page becomes active', async () => {
    const items = [
      previewItem('https://example.com/runtime-active.png'),
      previewItem('https://example.com/runtime-deferred.png')
    ];
    const sharedCallbacks = callbacks();
    const modal = (index: number) => (
      <ImagePreviewModal preview={{ contentSource: 'nodeseek', items, index }} {...sharedCallbacks} />
    );
    const view = await render(modal(0));
    const inactiveKey = view.getByTestId('preview-image-1').props.recyclingKey;
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(view.getByTestId('preview-image-1').props.recyclingKey).toBe(inactiveKey);
    await swipePreviewNext(view);
    const retriedKey = await waitFor(() => {
      const key = view.getByTestId('preview-image-1').props.recyclingKey;
      expect(key).not.toBe(inactiveKey);
      return key;
    });
    await view.rerender(modal(1));

    expect(view.getByTestId('preview-image-1').props.recyclingKey).toBe(retriedKey);
  });

  it('keeps a loaded adjacent preview healthy across rotation and later activation', async () => {
    const items = [
      previewItem('https://example.com/runtime-active.png'),
      previewItem('https://example.com/runtime-loaded-adjacent.png')
    ];
    const sharedCallbacks = callbacks();
    const modal = (index: number) => (
      <ImagePreviewModal preview={{ contentSource: 'nodeseek', items, index }} {...sharedCallbacks} />
    );
    const view = await render(modal(0));
    const adjacentImage = view.getByTestId('preview-image-1');
    const loadedKey = adjacentImage.props.recyclingKey;

    await fireEvent(adjacentImage, 'display');
    const before = getReadNetworkRuntimeSnapshot();
    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(view.getByTestId('preview-image-1').props.recyclingKey).toBe(loadedKey);
    await swipePreviewNext(view);
    await view.rerender(modal(1));

    expect(view.getByTestId('preview-image-1').props.recyclingKey).toBe(loadedKey);
  });

  it('mounts only current and adjacent originals and promotes them without cross-dissolving', async () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      previewItem(`https://example.com/original-${index}.png`, `https://example.com/display-${index}.png`)
    );
    const view = await render(<ImagePreviewModal preview={previewProps(items, 2)} {...callbacks()} />);

    expect(view.queryByTestId('preview-image-0')).toBeNull();
    expect(view.getByTestId('preview-image-1').props).toEqual(
      expect.objectContaining({
        allowDownscaling: true,
        cachePolicy: 'disk',
        priority: 'low',
        source: expect.objectContaining({ uri: items[1]?.originalUri })
      })
    );
    expect(view.getByTestId('preview-display-underlay-1').props).toEqual(
      expect.objectContaining({
        allowDownscaling: true,
        cachePolicy: 'disk',
        priority: 'low',
        source: expect.objectContaining({ uri: items[1]?.displayUri })
      })
    );
    expect(view.getByTestId('preview-image-2').props).toEqual(
      expect.objectContaining({
        allowDownscaling: true,
        cachePolicy: 'disk',
        priority: 'high',
        source: expect.objectContaining({ uri: items[2]?.originalUri })
      })
    );
    expect(view.getByTestId('preview-image-3').props.priority).toBe('low');
    expect(view.getByTestId('preview-image-1').props.transition).toBeUndefined();
    expect(view.getByTestId('preview-image-2').props.transition).toBeUndefined();
    expect(view.getByTestId('preview-image-3').props.transition).toBeUndefined();
    expect(view.queryByTestId('preview-image-4')).toBeNull();
    expect(view.queryByTestId('preview-thumbnail-image')).toBeNull();

    await swipePreviewNext(view);
    expect(view.getByTestId('preview-image-2').props.allowDownscaling).toBe(true);
    expect(view.getByTestId('preview-image-3').props.allowDownscaling).toBe(true);
    expect(view.getByTestId('preview-image-2').props.transition).toBeUndefined();
    expect(view.getByTestId('preview-image-3').props.transition).toBeUndefined();
  });

  it('gives cached full-resolution pixels only to the settled current page', async () => {
    const items = [
      previewItem('https://example.com/current-long.png'),
      previewItem('https://example.com/adjacent-long.png')
    ];
    const view = await render(<ImagePreviewModal preview={previewProps(items)} {...callbacks()} />);

    await fireEvent(view.getByTestId('preview-image-0'), 'load', {
      source: { height: 10_000, mediaType: 'image/png', width: 1_080 }
    });
    expect(view.queryByTestId('preview-region-0')).toBeNull();
    expect(mockGetImageCachePath).not.toHaveBeenCalled();
    await fireEvent(view.getByTestId('preview-image-0'), 'display');
    await fireEvent(view.getByTestId('preview-image-1'), 'load', {
      source: { height: 10_000, mediaType: 'image/png', width: 1_080 }
    });
    await fireEvent(view.getByTestId('preview-image-1'), 'display');

    await waitFor(() => expect(view.getByTestId('preview-region-0')).toBeTruthy());
    expect(view.queryByTestId('preview-region-1')).toBeNull();
    expect(mockGetImageCachePath).toHaveBeenCalledTimes(1);

    await fireEvent(view.getByTestId('preview-zoom-0'), 'pinchStart', {});
    expect(view.getByTestId('preview-region-0').props.suspended).toBe(true);
    mockZoomScale = 4;
    mockZoomVisibleRect = { height: 40, width: 50, x: 10, y: 20 };
    await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
    const settledRegion = view.getByTestId('preview-region-0').props;
    expect(settledRegion).toEqual(expect.objectContaining({ scale: 4, suspended: false }));
    expect(settledRegion.viewport).toEqual(expect.objectContaining({ width: 0.5, x: 0.1, y: 0.2 }));
    expect(settledRegion.viewport.height).toBeCloseTo(0.4);

    mockDeferAnimations = true;
    await swipePreviewNext(view);

    expect(view.getByTestId('preview-region-0')).toBeTruthy();
    expect(view.queryByTestId('preview-region-1')).toBeNull();
    expect(mockGetImageCachePath).toHaveBeenCalledTimes(1);

    await flushNextPreviewAnimation();

    await waitFor(() => expect(view.getByTestId('preview-region-1')).toBeTruthy());
    expect(view.queryByTestId('preview-region-0')).toBeNull();
    expect(mockGetImageCachePath).toHaveBeenCalledTimes(2);
    expect(view.getAllByTestId(/^preview-image-/)).toHaveLength(2);
  });

  it.each([
    {
      label: 'animated raster',
      source: { height: 1_000, isAnimated: true, mediaType: 'image/webp', width: 800 },
      uri: 'https://example.com/animated.webp'
    },
    {
      label: 'SVG',
      source: { height: 1_000, isAnimated: false, mediaType: null, width: 800 },
      uri: 'https://example.com/static.svg'
    }
  ])('keeps $label on the existing base path', async ({ source, uri }) => {
    const view = await render(<ImagePreviewModal preview={previewProps([previewItem(uri)])} {...callbacks()} />);

    await fireEvent(view.getByTestId('preview-image-0'), 'load', { source });
    await fireEvent(view.getByTestId('preview-image-0'), 'display');

    expect(view.getByTestId('preview-image-0')).toBeTruthy();
    expect(view.queryByTestId('preview-region-0')).toBeNull();
    expect(mockGetImageCachePath).not.toHaveBeenCalled();
  });

  it('keeps the base image when the original cache file is unavailable', async () => {
    mockGetImageCachePath.mockResolvedValueOnce(null);
    const view = await render(
      <ImagePreviewModal preview={previewProps([previewItem('https://example.com/cache-miss.png')])} {...callbacks()} />
    );

    await fireEvent(view.getByTestId('preview-image-0'), 'load', {
      source: { height: 10_000, mediaType: 'image/png', width: 1_080 }
    });
    await fireEvent(view.getByTestId('preview-image-0'), 'display');

    await waitFor(() => expect(mockGetImageCachePath).toHaveBeenCalledTimes(1));
    expect(view.getByTestId('preview-image-0')).toBeTruthy();
    expect(view.queryByTestId('preview-region-0')).toBeNull();
  });

  it('keeps a 2000-image catalog to three disk-only downscaled pages', async () => {
    const items = Array.from({ length: 2_000 }, (_, index) => previewItem(`https://example.com/catalog-${index}.png`));
    const onSelect = jest.fn<(index: number) => void>();
    const modal = (index: number) => (
      <ImagePreviewModal preview={previewProps(items, index)} {...callbacks({ onSelect })} />
    );
    const view = await render(modal(0));

    expect(view.getAllByTestId(/^preview-physical-slot-/)).toHaveLength(3);
    expect(view.getAllByTestId(/^preview-image-/)).toHaveLength(2);

    await view.rerender(modal(1_379));
    await waitFor(() => expect(view.getByText('1380/2000')).toBeTruthy());
    expect(view.getAllByTestId(/^preview-physical-slot-/)).toHaveLength(3);
    expect(view.getAllByTestId(/^preview-image-/)).toHaveLength(3);
    expect(view.getAllByTestId(/^preview-image-/)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ props: expect.objectContaining({ allowDownscaling: true, cachePolicy: 'disk' }) })
      ])
    );
    for (const image of view.getAllByTestId(/^preview-image-/)) {
      expect(image.props.allowDownscaling).toBe(true);
      expect(image.props.cachePolicy).toBe('disk');
    }

    const leavingSourceOwner = view.getByTestId('preview-image-1378').props;
    const currentOwner = view.getByTestId('preview-image-1379').props.mockImageInstanceToken;
    const targetOwner = view.getByTestId('preview-image-1380').props.mockImageInstanceToken;
    mockPreviewImageUnmounts.mockClear();

    await swipePreviewNext(view);
    expect(onSelect).toHaveBeenLastCalledWith(1_380);
    expect(view.getByText('1381/2000')).toBeTruthy();
    expect(view.getAllByTestId(/^preview-physical-slot-/)).toHaveLength(3);
    expect(view.getAllByTestId(/^preview-image-/)).toHaveLength(3);
    const reusedSourceOwner = view.getByTestId('preview-image-1381').props;
    expect(reusedSourceOwner.mockImageInstanceToken).toBe(leavingSourceOwner.mockImageInstanceToken);
    expect(reusedSourceOwner.source.uri).toBe(items[1_381]?.originalUri);
    expect(reusedSourceOwner.recyclingKey).not.toBe(leavingSourceOwner.recyclingKey);
    expect(view.getByTestId('preview-image-1379').props.mockImageInstanceToken).toBe(currentOwner);
    expect(view.getByTestId('preview-image-1380').props.mockImageInstanceToken).toBe(targetOwner);
    expect(mockPreviewImageUnmounts).not.toHaveBeenCalled();
  });

  it('reuses three native raster owners while their sources advance', async () => {
    const items = Array.from({ length: 100 }, (_, index) =>
      previewItem(`https://example.com/owner-original-${index}.png`, `https://example.com/owner-display-${index}.png`)
    );
    let selectedIndex = 20;
    const onSelect = jest.fn((index: number) => {
      selectedIndex = index;
    });
    const modal = () => <ImagePreviewModal preview={previewProps(items, selectedIndex)} {...callbacks({ onSelect })} />;
    const view = await render(modal());
    const mainTokens = new Set<number>();
    const underlayTokens = new Set<number>();
    const underlaySourceHistory = new Map<number, Set<string>>();
    const ownerSources = (pattern: RegExp) =>
      new Map<number, { recyclingKey: string; uri: string | null }>(
        view
          .getAllByTestId(pattern)
          .map((image) => [
            image.props.mockImageInstanceToken,
            { recyclingKey: image.props.recyclingKey, uri: image.props.source?.uri ?? null }
          ])
      );
    const rememberOwners = () => {
      for (const image of view.getAllByTestId(/^preview-image-/)) {
        mainTokens.add(image.props.mockImageInstanceToken);
      }
      for (const image of view.getAllByTestId(/^preview-display-underlay-/)) {
        const token = image.props.mockImageInstanceToken as number;
        underlayTokens.add(token);
        const history = underlaySourceHistory.get(token) ?? new Set<string>();
        history.add(`${image.props.recyclingKey}\u0000${image.props.source.uri}`);
        underlaySourceHistory.set(token, history);
      }
    };
    const settleMountedOwners = async () => {
      for (const image of view.getAllByTestId(/^preview-image-/)) {
        await fireEvent(image, 'display');
      }
    };

    rememberOwners();
    const initialMainOwners = ownerSources(/^preview-image-/);
    const initialUnderlayOwners = ownerSources(/^preview-display-underlay-/);
    await settleMountedOwners();

    for (let index = 21; index <= 30; index += 1) {
      await swipePreviewNext(view);
      await view.rerender(modal());
      expect(view.getByText(`${index + 1}/100`)).toBeTruthy();
      rememberOwners();
      await settleMountedOwners();
    }

    expect(mainTokens.size).toBeLessThanOrEqual(3);
    expect(underlayTokens.size).toBeLessThanOrEqual(3);
    const finalMainOwners = ownerSources(/^preview-image-/);
    const finalUnderlayOwners = ownerSources(/^(?:preview-display-underlay|preview-hidden-underlay-owner)-/);
    expect([...finalMainOwners.keys()].sort()).toEqual([...initialMainOwners.keys()].sort());
    expect([...finalUnderlayOwners.keys()].sort()).toEqual([...initialUnderlayOwners.keys()].sort());
    for (const [token, source] of finalMainOwners) {
      expect(source).not.toEqual(initialMainOwners.get(token));
    }
    for (const [token, source] of finalUnderlayOwners) {
      expect(source).not.toEqual(initialUnderlayOwners.get(token));
      expect(underlaySourceHistory.get(token)?.size).toBeGreaterThan(1);
    }
  });

  it('resets logical load ownership when a stable native slot changes source', async () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      previewItem(`https://example.com/reset-original-${index}.png`, `https://example.com/reset-display-${index}.png`)
    );
    const view = await render(<ImagePreviewModal preview={previewProps(items, 2)} {...callbacks()} />);
    const leavingImage = view.getByTestId('preview-image-1');
    const leavingOwnerToken = leavingImage.props.mockImageInstanceToken;
    const targetOwnerToken = view.getByTestId('preview-image-3').props.mockImageInstanceToken;
    const lateLeavingDisplay = leavingImage.props.onDisplay as () => void;

    await fireEvent(leavingImage, 'display');
    expect(view.queryByTestId('preview-display-underlay-1')).toBeNull();

    await swipePreviewNext(view);
    const nextImage = view.getByTestId('preview-image-3');
    const recycledImage = view.getByTestId('preview-image-4');
    expect(nextImage.props.mockImageInstanceToken).toBe(targetOwnerToken);
    expect(recycledImage.props.mockImageInstanceToken).toBe(leavingOwnerToken);
    expect(view.getByTestId('preview-display-underlay-4')).toBeTruthy();

    await act(lateLeavingDisplay);
    expect(view.getByTestId('preview-display-underlay-4')).toBeTruthy();

    await fireEvent(recycledImage, 'display');
    await waitFor(() => expect(view.queryByTestId('preview-display-underlay-4')).toBeNull());
  });

  it('never routes a remote continuity image through the Expo placeholder decoder', async () => {
    const items = [
      previewItem('https://example.com/same-original.png'),
      previewItem('https://example.com/distinct-original.png', 'https://example.com/distinct-display.png')
    ];
    const view = await render(<ImagePreviewModal preview={previewProps(items)} {...callbacks()} />);

    expect(view.getByTestId('preview-image-0').props.placeholder).toBeUndefined();
    expect(view.queryByTestId('preview-display-underlay-0')).toBeNull();
    expect(view.getByTestId('preview-image-1').props.placeholder).toBeUndefined();
    expect(view.getByTestId('preview-display-underlay-1').props).toEqual(
      expect.objectContaining({
        allowDownscaling: true,
        cachePolicy: 'disk',
        source: expect.objectContaining({ uri: items[1]?.displayUri })
      })
    );
  });

  it('gives every mounted preview bitmap an explicit native decode ceiling', async () => {
    const items = [
      previewItem('https://example.com/huge-original-a.png', 'https://example.com/huge-display-a.png'),
      previewItem('https://example.com/huge-original-b.png', 'https://example.com/huge-display-b.png')
    ];
    const view = await render(<ImagePreviewModal preview={previewProps(items)} {...callbacks()} />);
    const rasterImages = [
      ...view.getAllByTestId(/^preview-image-/),
      ...view.getAllByTestId(/^preview-display-underlay-/)
    ];

    expect(rasterImages).toHaveLength(4);
    for (const image of rasterImages) {
      const source = image.props.source as { height?: number; scale?: number; width?: number };
      expect(source.width).toEqual(expect.any(Number));
      expect(source.height).toEqual(expect.any(Number));
      expect(source.scale).toBe(1);
      expect(source.width!).toBeLessThanOrEqual(2_048);
      expect(source.height!).toBeLessThanOrEqual(2_048);
      expect(source.width! * source.height!).toBeLessThanOrEqual(4_194_304);
    }
  });

  it('keeps the selected target centered through page settlement', async () => {
    const items = Array.from({ length: 6 }, (_, index) => previewItem(`https://example.com/settle-${index}.png`));
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(<ImagePreviewModal preview={previewProps(items, 2)} {...callbacks({ onSelect })} />);
    const currentOwner = view.getByTestId('preview-image-2').props.mockImageInstanceToken;
    const targetOwner = view.getByTestId('preview-image-3').props.mockImageInstanceToken;
    const recycledOwner = view.getByTestId('preview-image-1').props.mockImageInstanceToken;
    const centeredImage = () => {
      const selectedSlot = view
        .getAllByTestId(/^preview-physical-slot-/)
        .find((slot) => slot.props.pointerEvents === 'auto');
      expect(selectedSlot).toBeTruthy();
      return within(selectedSlot!).getByTestId(/^preview-image-/);
    };

    expect(centeredImage().props.mockImageInstanceToken).toBe(currentOwner);
    expect(await swipePreviewNext(view)).toEqual({ active: true, failed: false });

    expect(onSelect).toHaveBeenLastCalledWith(3);
    expect(centeredImage().props.testID).toBe('preview-image-3');
    expect(centeredImage().props.mockImageInstanceToken).toBe(targetOwner);
    expect(view.getByTestId('preview-image-4').props.mockImageInstanceToken).toBe(recycledOwner);

    await swipePreviewPrevious(view);
    expect(onSelect.mock.calls.map(([index]) => index)).toEqual([3, 2]);
    expect(centeredImage().props.testID).toBe('preview-image-2');
    expect(centeredImage().props.mockImageInstanceToken).toBe(currentOwner);
  });

  it('gives pinch and a late second finger exclusive ownership of the index', async () => {
    const items = Array.from({ length: 3 }, (_, index) => previewItem(`https://example.com/pinch-${index}.png`));
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(<ImagePreviewModal preview={previewProps(items, 1)} {...callbacks({ onSelect })} />);

    await performPreviewGesture(view, { pointers: 2, translationX: -500, translationY: 80, velocityX: -1_000 });
    await performPreviewGesture(view, {
      pointers: 1,
      pointersOnMove: 2,
      translationX: -500,
      translationY: 10,
      velocityX: -1_000
    });
    mockZoomScale = 2;
    await fireEvent(view.getByTestId('preview-zoom-1'), 'update', { scale: 2 });
    await fireEvent(view.getByTestId('preview-zoom-1'), 'gestureEnd');
    await performPreviewGesture(view, { translationX: -500, translationY: 10, velocityX: -1_000 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(view.getByText('2/3')).toBeTruthy();
  });

  it('commits a slow swipe only after the distance threshold', async () => {
    const items = Array.from({ length: 3 }, (_, index) => previewItem(`https://example.com/slow-${index}.png`));
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(<ImagePreviewModal preview={previewProps(items, 1)} {...callbacks({ onSelect })} />);

    await performPreviewGesture(view, { translationX: -50, translationY: 4, velocityX: -100 });
    expect(onSelect).not.toHaveBeenCalled();
    expect(view.getByText('2/3')).toBeTruthy();

    await performPreviewGesture(view, { translationX: -200, translationY: 4, velocityX: -200 });
    expect(onSelect).toHaveBeenLastCalledWith(2);
    expect(view.getByText('3/3')).toBeTruthy();
  });

  it('rebuilds an idle non-adjacent external index without emitting a selection', async () => {
    const items = Array.from({ length: 6 }, (_, index) => previewItem(`https://example.com/window-${index}.png`));
    let selectedIndex = 2;
    const savedIndices: number[] = [];
    const onSelect = jest.fn((index: number) => {
      selectedIndex = index;
    });
    const onSave = jest.fn(() => {
      savedIndices.push(selectedIndex);
    });
    const modal = (index: number) => (
      <ImagePreviewModal preview={previewProps(items, index)} {...callbacks({ onSave, onSelect })} />
    );
    const view = await render(modal(selectedIndex));

    selectedIndex = 4;
    await view.rerender(modal(selectedIndex));
    await waitFor(() => expect(view.getByText('5/6')).toBeTruthy());
    expect(mockZoomResets).toHaveBeenCalledWith('2');
    mockZoomResets.mockClear();
    onSelect.mockClear();

    await fireEvent.press(view.getByLabelText('保存图片'));

    expect(view.getByText('5/6')).toBeTruthy();
    expect(view.getByTestId('preview-image-4')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    expect(mockZoomResets).not.toHaveBeenCalled();
    expect(savedIndices).toEqual([4]);
  });

  it('keeps the ring usable after a non-adjacent external rebuild', async () => {
    const items = Array.from({ length: 6 }, (_, index) => previewItem(`https://example.com/fenced-${index}.png`));
    let selectedIndex = 2;
    const savedIndices: number[] = [];
    const onSelect = jest.fn((index: number) => {
      selectedIndex = index;
    });
    const onSave = jest.fn(() => {
      savedIndices.push(selectedIndex);
    });
    const modal = (index: number) => (
      <ImagePreviewModal preview={previewProps(items, index)} {...callbacks({ onSave, onSelect })} />
    );
    const view = await render(modal(selectedIndex));

    selectedIndex = 4;
    await view.rerender(modal(selectedIndex));
    await waitFor(() => expect(view.getByText('5/6')).toBeTruthy());
    onSelect.mockClear();

    await fireEvent.press(view.getByLabelText('保存图片'));

    expect(view.getByText('5/6')).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    expect(savedIndices).toEqual([4]);

    await swipePreviewNext(view);
    await waitFor(() => expect(view.getByText('6/6')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('保存图片'));

    expect(onSelect).toHaveBeenLastCalledWith(5);
    expect(savedIndices).toEqual([4, 5]);
  });

  it('owns continuous middle transitions and both ring edges without losing logical order', async () => {
    const items = Array.from({ length: 7 }, (_, index) => previewItem(`https://example.com/ordered-${index}.png`));
    let selectedIndex = 0;
    const savedIndices: number[] = [];
    const onSelect = jest.fn((index: number) => {
      selectedIndex = index;
    });
    const onSave = jest.fn(() => {
      savedIndices.push(selectedIndex);
    });
    const view = await render(<ImagePreviewModal preview={previewProps(items)} {...callbacks({ onSave, onSelect })} />);
    expect(view.getAllByTestId(/^preview-physical-slot-/)).toHaveLength(3);
    await swipePreviewNext(view);
    for (let logicalIndex = 2; logicalIndex <= 6; logicalIndex += 1) {
      await swipePreviewNext(view);
      expect(view.getByText(`${logicalIndex + 1}/7`)).toBeTruthy();
    }
    expect(view.getAllByTestId(/^preview-physical-slot-/)).toHaveLength(3);
    await swipePreviewNext(view);
    expect(view.getByText('7/7')).toBeTruthy();
    await fireEvent.press(view.getByLabelText('保存图片'));
    expect(savedIndices).toEqual([6]);

    await swipePreviewPrevious(view);
    expect(view.getByText('6/7')).toBeTruthy();
    for (let logicalIndex = 4; logicalIndex >= 0; logicalIndex -= 1) {
      await swipePreviewPrevious(view);
      expect(view.getByText(`${logicalIndex + 1}/7`)).toBeTruthy();
    }

    expect(view.getAllByTestId(/^preview-physical-slot-/)).toHaveLength(3);
    expect(onSelect.mock.calls.map(([index]) => index)).toEqual([1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0]);
    expect(mockZoomResets.mock.calls.map(([index]) => Number(index))).toEqual([0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]);
  });

  it('settles an immediate cache hit only after the image is displayed', async () => {
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([
          previewItem('https://example.com/fast-cache.png', 'https://example.com/fast-cache-thumb.png')
        ])}
        {...callbacks()}
      />
    );

    expect(view.queryByText('图片加载中...')).toBeNull();
    expect(view.queryByText('图片加载失败')).toBeNull();
  });

  it('publishes fullscreen readiness only after the original is displayed', async () => {
    const originalUrl = 'https://example.com/fullscreen-ready-original.png';
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([previewItem(originalUrl, 'https://example.com/fullscreen-ready-display.png')])}
        {...callbacks()}
      />
    );
    const image = view.getByTestId('preview-image-0');

    expect(originalImageDisplayRevision(image.props.source)).toBe(0);
    await fireEvent(image, 'load', { source: { height: 900, width: 1_600 } });
    expect(originalImageDisplayRevision(image.props.source)).toBe(0);
    await fireEvent(image, 'display');
    expect(originalImageDisplayRevision(image.props.source)).toBe(1);
  });

  it('shows one active failure and retries only that page', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    try {
      const items = [
        previewItem('https://example.com/broken.png', 'https://example.com/broken-thumb.png'),
        previewItem('https://example.com/neighbor.png', 'https://example.com/neighbor-thumb.png')
      ];
      const view = await render(<ImagePreviewModal preview={previewProps(items)} {...callbacks()} />);
      const failedKey = view.getByTestId('preview-image-0').props.recyclingKey;
      const neighborKey = view.getByTestId('preview-image-1').props.recyclingKey;

      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByText('图片加载失败')).toBeTruthy());
      expect(view.queryByTestId('preview-image-0')).toBeNull();

      await fireEvent.press(view.getByLabelText('重试加载图片'));

      expect(view.getByText('图片加载中...')).toBeTruthy();
      expect(view.getByTestId('preview-image-0').props.recyclingKey).not.toBe(failedKey);
      expect(view.getByTestId('preview-image-1').props.recyclingKey).toBe(neighborKey);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('ignores a late display event from the failed request after retry', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem('https://example.com/retry-stale.png')])}
          {...callbacks()}
        />
      );
      const failedImage = view.getByTestId('preview-image-0');
      const lateDisplay = failedImage.props.onDisplay as () => void;
      await fireEvent(failedImage, 'error');
      await waitFor(() => expect(view.getByText('图片加载失败')).toBeTruthy());
      await fireEvent.press(view.getByLabelText('重试加载图片'));

      await act(async () => lateDisplay());

      expect(view.getByText('图片加载中...')).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('handles a real horizontal gesture without looping and toggles the centered chrome on a single tap', async () => {
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(
      <ImagePreviewModal
        preview={previewProps(
          [
            previewItem('https://example.com/one.png'),
            previewItem('https://example.com/two.png'),
            previewItem('https://example.com/three.png')
          ],
          1
        )}
        {...callbacks({ onSelect })}
      />
    );

    expect(view.getByText('2/3')).toBeTruthy();
    expect(view.queryByLabelText('上一张图片')).toBeNull();
    expect(view.queryByLabelText('下一张图片')).toBeNull();
    await swipePreviewNext(view);
    expect(onSelect).toHaveBeenLastCalledWith(2);
    expect(view.getByText('3/3')).toBeTruthy();
    await swipePreviewNext(view);
    expect(onSelect).toHaveBeenCalledTimes(1);

    await fireEvent(view.getByTestId('preview-zoom-2'), 'tap', {});
    expect(view.queryByLabelText('关闭图片预览')).toBeNull();
    expect(view.queryByLabelText('保存图片')).toBeNull();
    await fireEvent(view.getByTestId('preview-zoom-2'), 'tap', {});
    expect(view.getByLabelText('关闭图片预览')).toBeTruthy();
    expect(view.getByLabelText('保存图片')).toBeTruthy();
  });

  it('restores controls when a hidden preview is closed and opened again', async () => {
    const preview = previewProps([previewItem('https://example.com/reopen.png')]);
    const props = callbacks();
    const view = await render(<ImagePreviewModal preview={preview} {...props} />);
    await fireEvent(view.getByTestId('preview-zoom-0'), 'tap', {});
    expect(view.queryByLabelText('关闭图片预览')).toBeNull();

    await view.rerender(<ImagePreviewModal preview={null} {...props} />);
    await view.rerender(<ImagePreviewModal preview={preview} {...props} />);

    expect(view.getByLabelText('关闭图片预览')).toBeTruthy();
    expect(view.getByLabelText('保存图片')).toBeTruthy();
  });

  it('reopens a previously displayed original without restoring its spinner', async () => {
    jest.useFakeTimers();
    try {
      const preview = previewProps([previewItem('https://example.com/reopen-displayed.png')]);
      const props = callbacks();
      const view = await render(<ImagePreviewModal preview={preview} {...props} />);
      const firstImage = view.getByTestId('preview-image-0');
      const recyclingKey = firstImage.props.recyclingKey;

      expect(view.getByText('图片加载中...')).toBeTruthy();
      await fireEvent(firstImage, 'display');
      expect(view.queryByText('图片加载中...')).toBeNull();
      expect(originalImageDisplayRevision(firstImage.props.source)).toBeGreaterThan(0);

      await view.rerender(<ImagePreviewModal preview={null} {...props} />);
      await view.rerender(<ImagePreviewModal preview={preview} {...props} />);

      const reopenedImage = view.getByTestId('preview-image-0');
      expect(reopenedImage.props.recyclingKey).toBe(recyclingKey);
      expect(view.queryByText('图片加载中...')).toBeNull();
      await fireEvent(reopenedImage, 'loadStart');
      expect(view.queryByText('图片加载中...')).toBeNull();

      await act(async () => jest.advanceTimersByTime(30_000));
      expect(view.getByText('图片加载失败')).toBeTruthy();
      await fireEvent.press(view.getByText('重试'));
      expect(view.getByText('图片加载中...')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows an already displayed adjacent page without restoring its spinner', async () => {
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([
          previewItem('https://example.com/current.png'),
          previewItem('https://example.com/preloaded.png')
        ])}
        {...callbacks()}
      />
    );
    await fireEvent(view.getByTestId('preview-image-0'), 'display');
    await fireEvent(view.getByTestId('preview-image-1'), 'display');
    await swipePreviewNext(view);

    expect(view.queryByText('图片加载中...')).toBeNull();
  });

  it('updates the active zoom ceiling from the original pixel dimensions', async () => {
    const view = await render(
      <ImagePreviewModal preview={previewProps([previewItem('https://example.com/resolution.png')])} {...callbacks()} />
    );
    expect(view.getByTestId('preview-zoom-0').props.maxScale).toBe(6);

    await fireEvent(view.getByTestId('preview-image-0'), 'load', {
      source: { height: 480, width: 640 }
    });

    expect(view.getByTestId('preview-zoom-0').props.maxScale).toBe(3);
  });

  it('fits the page to the original dimensions once they are known', async () => {
    const item = {
      displaySize: { height: 800, width: 400 },
      displayUri: 'https://example.com/stable-thumb.png',
      originalUri: 'https://example.com/stable-original.png'
    };
    const view = await render(
      <ImagePreviewModal preview={{ contentSource: null, items: [item], index: 0 }} {...callbacks()} />
    );
    const before = StyleSheet.flatten(view.getByTestId('preview-zoom-content-0').props.style);

    await fireEvent(view.getByTestId('preview-image-0'), 'load', {
      source: { height: 400, width: 1_600 }
    });

    const after = StyleSheet.flatten(view.getByTestId('preview-zoom-content-0').props.style);
    expect(after).not.toMatchObject({ height: before.height, width: before.width });
    expect(after.width / after.height).toBeCloseTo(4);
  });

  it('exposes bounded adjustable page actions and Android Back closes the modal', async () => {
    const onClose = jest.fn<() => void>();
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([previewItem('https://example.com/one.png'), previewItem('https://example.com/two.png')])}
        {...callbacks({ onClose, onSelect })}
      />
    );
    const galleryAccessibility = view.getByLabelText('图片预览，第 1 张，共 2 张');

    await fireEvent(galleryAccessibility, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onSelect).not.toHaveBeenCalled();
    await fireEvent(galleryAccessibility, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(view.getByLabelText('图片预览，第 2 张，共 2 张').props.accessibilityValue.text).toBe('第 2 张，共 2 张');
    const [modal] = view.container.queryAll(({ props }) => typeof props.onRequestClose === 'function');
    await fireEvent(modal, 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies the latest requested index after the active transition settles', async () => {
    const items = Array.from({ length: 4 }, (_, index) => previewItem(`https://example.com/queued-${index}.png`));
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(<ImagePreviewModal preview={previewProps(items, 1)} {...callbacks({ onSelect })} />);
    const accessibility = view.getByLabelText('图片预览，第 2 张，共 4 张');
    mockDeferAnimations = true;

    await fireEvent(accessibility, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(accessibility, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onSelect).not.toHaveBeenCalled();

    await flushNextPreviewAnimation();
    expect(onSelect).toHaveBeenLastCalledWith(2);
    await flushNextPreviewAnimation();

    expect(onSelect.mock.calls.map(([index]) => index)).toEqual([2, 1]);
    expect(view.getByText('2/4')).toBeTruthy();
  });

  it('queues a rapid physical swipe without disturbing the active transition', async () => {
    const items = Array.from({ length: 5 }, (_, index) => previewItem(`https://example.com/rapid-${index}.png`));
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(<ImagePreviewModal preview={previewProps(items, 1)} {...callbacks({ onSelect })} />);
    mockDeferAnimations = true;

    expect(await swipePreviewNext(view)).toEqual({ active: true, failed: false });
    expect(await swipePreviewNext(view)).toEqual({ active: true, failed: false });
    expect(onSelect).not.toHaveBeenCalled();

    await flushNextPreviewAnimation();
    await flushNextPreviewAnimation();

    expect(onSelect.mock.calls.map(([index]) => index)).toEqual([2, 3]);
    expect(view.getByText('4/5')).toBeTruthy();
  });

  it('rebuilds to the latest external index only after the active transition settles', async () => {
    const items = Array.from({ length: 4 }, (_, index) => previewItem(`https://example.com/external-${index}.png`));
    const onSelect = jest.fn<(index: number) => void>();
    const modal = (index: number) => (
      <ImagePreviewModal preview={previewProps(items, index)} {...callbacks({ onSelect })} />
    );
    const view = await render(modal(1));
    mockDeferAnimations = true;

    await fireEvent(view.getByLabelText('图片预览，第 2 张，共 4 张'), 'accessibilityAction', {
      nativeEvent: { actionName: 'increment' }
    });
    await view.rerender(modal(3));
    expect(view.getByText('2/4')).toBeTruthy();

    await flushNextPreviewAnimation();

    expect(onSelect).not.toHaveBeenCalled();
    expect(view.getByText('4/4')).toBeTruthy();
    expect(view.getByTestId('preview-image-3')).toBeTruthy();
  });

  it('shows a disabled save state until the save promise settles', async () => {
    let finishSave: (() => void) | undefined;
    const onSave = jest.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([previewItem('https://example.com/save.png')])}
        {...callbacks({ onSave })}
      />
    );

    await fireEvent.press(view.getByLabelText('保存图片'));
    expect(view.getByText('保存中…')).toBeTruthy();
    expect(view.getByLabelText('保存图片').props.accessibilityState).toEqual({ busy: true, disabled: true });
    await fireEvent.press(view.getByLabelText('保存图片'));
    expect(onSave).toHaveBeenCalledTimes(1);

    await act(async () => finishSave?.());
    expect(view.getByText('保存')).toBeTruthy();
  });

  it('settles a stalled active preview within the 30 second budget', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    jest.useFakeTimers();
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([
            previewItem('https://example.com/stalled.png'),
            previewItem('https://example.com/next.png')
          ])}
          {...callbacks()}
        />
      );
      const stalledImage = view.getByTestId('preview-image-0');
      const lateDisplay = stalledImage.props.onDisplay as () => void;
      await fireEvent(stalledImage, 'loadStart');
      await act(async () => jest.advanceTimersByTime(30_000));

      expect(view.getByText('图片加载失败')).toBeTruthy();
      expect(view.queryByTestId('preview-image-0')).toBeNull();
      expect(mockPreviewImageUnmounts).toHaveBeenCalledWith('preview-image-0');
      await act(lateDisplay);
      expect(view.getByText('图片加载失败')).toBeTruthy();
      expect(view.queryByTestId('preview-image-0')).toBeNull();
      const events = diagnosticLines.map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({ area: 'media', phase: 'intent', surface: 'preview' }));
      const timeoutEvent = events.find((event) => event.outcome === 'failure' && event.terminalReason === 'timeout');
      expect(timeoutEvent).toBeTruthy();
      expect(timeoutEvent).not.toHaveProperty('displayMs');
      await swipePreviewNext(view);
      expect(view.getByTestId('preview-image-1').props.allowDownscaling).toBe(true);
      expect(view.getByTestId('preview-image-1').props.cachePolicy).toBe('disk');
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('treats advancing bytes as progress and times out only after 30 seconds without progress', async () => {
    jest.useFakeTimers();
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem('https://example.com/slow-progress.png')])}
          {...callbacks()}
        />
      );
      const image = view.getByTestId('preview-image-0');
      await fireEvent(image, 'loadStart');

      await act(async () => jest.advanceTimersByTime(20_000));
      await fireEvent(image, 'progress', { loaded: 1_024, total: 8_192 });
      await act(async () => jest.advanceTimersByTime(20_000));
      expect(view.queryByText('图片加载失败')).toBeNull();

      await fireEvent(image, 'progress', { loaded: 2_048, total: 8_192 });
      await act(async () => jest.advanceTimersByTime(20_000));
      expect(view.queryByText('图片加载失败')).toBeNull();

      await fireEvent(image, 'progress', { loaded: 3_072, total: 8_192 });
      await act(async () => jest.advanceTimersByTime(10_000));
      await fireEvent(image, 'progress', { loaded: 3_072, total: 8_192 });
      await act(async () => jest.advanceTimersByTime(19_999));

      expect(view.queryByText('图片加载失败')).toBeNull();
      expect(view.getByTestId('preview-image-0')).toBeTruthy();

      await act(async () => jest.advanceTimersByTime(1));

      expect(view.getByText('图片加载失败')).toBeTruthy();
      expect(view.queryByTestId('preview-image-0')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('summarizes active preview progress, cache and display timing without logging the URL', async () => {
    const diagnosticLines: string[] = [];
    const privateUrl = 'https://secret.example/original.png?token=ULTRA_FAKE_SECRET_9';
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(privateUrl, 'https://secret.example/display.png')])}
          {...callbacks()}
        />
      );
      const image = view.getByTestId('preview-image-0');
      await fireEvent(image, 'loadStart');
      jest.setSystemTime(1_010);
      await fireEvent(image, 'progress', { loaded: 4096, total: 8192 });
      jest.setSystemTime(1_020);
      await fireEvent(image, 'load', {
        cacheType: 'disk',
        source: { height: 600, mediaType: 'image/png', url: privateUrl, width: 400 }
      });
      jest.setSystemTime(1_030);
      await fireEvent(image, 'display');

      const events = diagnosticLines.map((line) => JSON.parse(line));
      expect(events[0]).toEqual(
        expect.objectContaining({
          candidateKind: 'lightbox',
          mediaRef: expect.stringMatching(/^media-\d+$/),
          mediaRole: 'preview-active'
        })
      );
      expect(events.at(-1)).toEqual(
        expect.objectContaining({
          cacheType: 'disk',
          displayMs: 30,
          firstProgressMs: 10,
          loadedBytes: 4096,
          loadMs: 20,
          sourceHeight: 600,
          sourceWidth: 400,
          totalBytes: 8192
        })
      );
      expect(diagnosticLines.join('')).not.toContain(privateUrl);
      expect(diagnosticLines.join('')).not.toContain('ULTRA_FAKE_SECRET_9');
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('keeps adjacent preview warmup outside active media diagnostics', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([
            previewItem('https://example.com/active.png'),
            previewItem('https://example.com/adjacent.png')
          ])}
          {...callbacks()}
        />
      );
      const intentCount = diagnosticLines.filter((line) => JSON.parse(line).phase === 'intent').length;
      const adjacent = view.getByTestId('preview-image-1');
      await fireEvent(adjacent, 'loadStart');
      await fireEvent(adjacent, 'progress', { loaded: 10, total: 20 });
      await fireEvent(adjacent, 'load', {
        cacheType: 'memory',
        source: { height: 200, mediaType: 'image/png', url: 'https://example.com/adjacent.png', width: 300 }
      });
      await fireEvent(adjacent, 'display');

      expect(diagnosticLines.filter((line) => JSON.parse(line).phase === 'intent')).toHaveLength(intentCount);
    } finally {
      setDiagnosticWriter(null);
    }
  });

  it('starts user-visible timing when a warming adjacent page becomes active', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([
            previewItem('https://example.com/timing-active.png'),
            previewItem('https://example.com/timing-adjacent.png')
          ])}
          {...callbacks()}
        />
      );
      await fireEvent(view.getByTestId('preview-image-0'), 'display');
      await fireEvent(view.getByTestId('preview-image-1'), 'loadStart');
      jest.setSystemTime(6_000);
      await swipePreviewNext(view);
      jest.setSystemTime(6_010);
      await fireEvent(view.getByTestId('preview-image-1'), 'load', {
        cacheType: 'disk',
        source: { height: 600, mediaType: 'image/png', url: '', width: 400 }
      });
      jest.setSystemTime(6_020);
      await fireEvent(view.getByTestId('preview-image-1'), 'display');

      const successes = diagnosticLines.map((line) => JSON.parse(line)).filter((event) => event.outcome === 'success');
      expect(successes.at(-1)).toEqual(expect.objectContaining({ displayMs: 20, loadMs: 10 }));
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('defers incompatible SVG recovery until the page is active', async () => {
    const secondUrl = 'https://example.com/dynamic-preview.svg';
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem('https://example.com/first.png'), previewItem(secondUrl)])}
          {...callbacks()}
        />
      );

      await fireEvent(view.getByTestId('preview-image-1'), 'error');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(view.queryByTestId('compatible-svg-document-view')).toBeNull();

      await swipePreviewNext(view);
      expect(view.queryByTestId('preview-image-1')?.props.allowDownscaling).toBe(true);
      await act(async () =>
        resolveFetch?.(
          new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><tspan>report</tspan></text><animate attributeName="opacity" /></svg>',
            { headers: { 'content-type': 'image/svg+xml' } }
          )
        )
      );
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await fireEvent(view.getByTestId('compatible-svg-document-view'), 'message', {
        nativeEvent: { data: 'wz-svg-ready' }
      });
      expect(view.queryByText('图片加载中...')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('releases SVG artifact work when its logical page leaves the physical window', async () => {
    const imageUrl = 'https://example.com/preview-unmounted-native-late.svg';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460"><text>late</text></svg>';
    let resolveNativeDocument: ((value: { base64: string }) => void) | undefined;
    const fetchSvgDocument = jest.fn(
      () =>
        new Promise<{ base64: string }>((resolve) => {
          resolveNativeDocument = resolve;
        })
    );
    NativeModules.SvgRendererModule = {
      fetchSvgDocument,
      renderPoster: mockRenderSvgPoster
    };
    const items = [
      previewItem(imageUrl),
      previewItem('https://example.com/preview-window-1.png'),
      previewItem('https://example.com/preview-window-2.png'),
      previewItem('https://example.com/preview-window-3.png')
    ];
    const sharedCallbacks = callbacks();
    const modal = (index: number) => <ImagePreviewModal preview={previewProps(items, index)} {...sharedCallbacks} />;
    const view = await render(modal(0));

    await fireEvent(view.getByTestId('preview-image-0'), 'error');
    await waitFor(() => expect(fetchSvgDocument).toHaveBeenCalledTimes(1));

    await view.rerender(modal(3));
    await waitFor(() => expect(view.queryByTestId('preview-page-0')).toBeNull());
    await act(async () => {
      resolveNativeDocument?.({ base64: Buffer.from(svg).toString('base64') });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRenderSvgPoster).not.toHaveBeenCalled();
    expect(view.queryByTestId('preview-svg-poster-0')).toBeNull();
    expect(view.queryByTestId('compatible-svg-document-view')).toBeNull();
  });

  it('renders an active incompatible SVG in the isolated document view', async () => {
    const imageUrl = 'https://example.com/active-dynamic.svg';
    const bodyPosterUrl = 'file:///cache/complex-svg-poster.png';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><tspan>active</tspan></text><animate attributeName="opacity" /></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const view = await render(
        <ImagePreviewModal preview={previewProps([previewItem(imageUrl, bodyPosterUrl)])} {...callbacks()} />
      );
      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());
      expect(view.getByTestId('preview-continuity-0').props.source).toEqual(
        expect.objectContaining({ uri: bodyPosterUrl })
      );
      expect(view.getByTestId('preview-continuity-0').props.allowDownscaling).toBe(true);
      expect(view.getByTestId('preview-continuity-0').props.cachePolicy).toBe('disk');
      const firstContinuityKey = view.getByTestId('preview-continuity-0').props.recyclingKey;
      await fireEvent(view.getByTestId('preview-continuity-0'), 'error');
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(2));
      expect(view.getByTestId('preview-continuity-0').props.recyclingKey).not.toBe(firstContinuityKey);
      expect(view.getByText('图片加载中...')).toBeTruthy();
      await fireEvent(view.getByTestId('compatible-svg-document-view'), 'message', {
        nativeEvent: { data: 'wz-svg-ready' }
      });

      expect(view.queryByText('图片加载中...')).toBeNull();
      expect(view.queryByTestId('preview-continuity-0')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps Chromium fixed outside zoom and hides it behind the poster', async () => {
    const imageUrl = 'https://example.com/zoomed-dynamic.svg';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460"><animate attributeName="opacity" /></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const view = await render(<ImagePreviewModal preview={previewProps([previewItem(imageUrl)])} {...callbacks()} />);
      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      const documentView = await waitFor(() => view.getByTestId('compatible-svg-document-view'));
      const documentToken = documentView.props.mockWebViewToken;
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);
      expect(within(view.getByTestId('preview-zoom-0')).queryByTestId('compatible-svg-document-view')).toBeNull();
      const posterKey = view.getByTestId('preview-continuity-0').props.recyclingKey;
      await fireEvent(documentView, 'message', { nativeEvent: { data: 'wz-svg-ready' } });
      expect(view.queryByTestId('preview-continuity-0')).toBeNull();

      await fireEvent(view.getByTestId('preview-zoom-0'), 'doubleTapStart', {});
      expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(documentToken);
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);
      await fireEvent(view.getByTestId('preview-continuity-0'), 'display');
      expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity).toBe(0);
      expect(view.getByTestId('preview-continuity-0').props.recyclingKey).toBe(posterKey);

      mockZoomScale = 3;
      await fireEvent(view.getByTestId('preview-zoom-0'), 'update', { scale: 3 });
      await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
      expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(documentToken);
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);
      expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity).toBe(0);

      mockZoomScale = 1;
      await fireEvent(view.getByTestId('preview-zoom-0'), 'update', { scale: 1 });
      await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
      await waitFor(() =>
        expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity).not.toBe(0)
      );
      expect(view.queryByTestId('preview-continuity-0')).toBeNull();
      expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(documentToken);
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);

      await fireEvent(view.getByTestId('preview-zoom-0'), 'pinchStart', {});
      expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity).toBe(0);
      expect(view.getByTestId('preview-continuity-0').props.recyclingKey).toBe(posterKey);
      await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
      expect((await waitFor(() => view.getByTestId('compatible-svg-document-view'))).props.mockWebViewToken).toBe(
        documentToken
      );
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);
      expect(view.queryByTestId('preview-continuity-0')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps a rebuilt animation poster when the document settles and the page deactivates', async () => {
    const imageUrl = 'https://example.com/deferred-dynamic.svg';
    const items = [previewItem(imageUrl), previewItem('https://example.com/second.png')];
    const sharedCallbacks = callbacks();
    const modal = (index: number) => <ImagePreviewModal preview={previewProps(items, index)} {...sharedCallbacks} />;
    const initialPoster = {
      documentHeight: 460,
      documentWidth: 920,
      height: 460,
      uri: 'file:///cache/deferred-initial.png',
      width: 920
    };
    const refreshedPoster = { ...initialPoster, uri: 'file:///cache/deferred-refreshed.png' };
    let resolveRefresh: ((poster: typeof refreshedPoster) => void) | undefined;
    mockRenderSvgPoster.mockResolvedValueOnce(initialPoster).mockImplementationOnce(
      () =>
        new Promise<typeof refreshedPoster>((resolve) => {
          resolveRefresh = resolve;
        })
    );
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460"><animate attributeName="opacity" /></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const view = await render(modal(0));
      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());
      const firstPosterKey = view.getByTestId('preview-continuity-0').props.recyclingKey;

      await fireEvent(view.getByTestId('preview-continuity-0'), 'error');
      await waitFor(() => expect(resolveRefresh).toBeDefined());
      await fireEvent(view.getByTestId('compatible-svg-document-view'), 'message', {
        nativeEvent: { data: 'wz-svg-ready' }
      });
      expect(view.queryByText('图片加载中...')).toBeNull();

      await view.rerender(modal(1));
      await waitFor(() => expect(view.queryByTestId('compatible-svg-document-view')).toBeNull());
      await act(async () => resolveRefresh?.(refreshedPoster));
      await view.rerender(modal(0));

      const continuity = await waitFor(() => view.getByTestId('preview-continuity-0'));
      expect(continuity.props.source).toEqual(
        expect.objectContaining({
          uri: refreshedPoster.uri
        })
      );
      expect(continuity.props.recyclingKey).not.toBe(firstPosterKey);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('uses the recovered artifact poster when no body poster was supplied', async () => {
    const imageUrl = 'https://example.com/catalog-dynamic.svg';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><animate attributeName="opacity" /></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const view = await render(<ImagePreviewModal preview={previewProps([previewItem(imageUrl)])} {...callbacks()} />);
      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());

      expect(view.getByTestId('preview-continuity-0').props.source).toEqual(
        expect.objectContaining({
          uri: 'file:///cache/complex-svg-poster.png'
        })
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('restores the body poster while an SVG document view remounts', async () => {
    const imageUrl = 'https://example.com/revisit-dynamic.svg';
    const bodyPosterUrl = 'file:///cache/revisit-body-poster.png';
    const items = [previewItem(imageUrl, bodyPosterUrl), previewItem('https://example.com/second.png')];
    const sharedCallbacks = callbacks();
    const modal = (index: number) => <ImagePreviewModal preview={previewProps(items, index)} {...sharedCallbacks} />;
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460"><text>revisit</text><animate attributeName="opacity" /></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const view = await render(modal(0));
      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());
      await fireEvent(view.getByTestId('compatible-svg-document-view'), 'message', {
        nativeEvent: { data: 'wz-svg-ready' }
      });
      expect(view.queryByTestId('preview-continuity-0')).toBeNull();

      await view.rerender(modal(1));
      await waitFor(() => expect(view.queryByTestId('compatible-svg-document-view')).toBeNull());
      expect(view.queryByTestId('preview-image-0')).toBeNull();
      expect(view.getByTestId('preview-svg-poster-0').props.source).toEqual(
        expect.objectContaining({ uri: 'file:///cache/complex-svg-poster.png' })
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      await view.rerender(modal(0));
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());

      expect(view.getByTestId('preview-continuity-0').props.source).toEqual(
        expect.objectContaining({ uri: 'file:///cache/complex-svg-poster.png' })
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('sizes a cached SVG preview from the artifact before mounting its document view', async () => {
    const imageUrl = 'https://example.com/cached-dynamic.svg';
    mockRenderSvgPoster.mockResolvedValueOnce({
      documentHeight: 4_600,
      documentWidth: 9_200,
      height: 4_600,
      uri: 'file:///cache/cached-dynamic-poster.png',
      width: 9_200
    });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="9200" height="4600"><text>cached</text><animate attributeName="opacity" /></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const first = await render(
        <ImagePreviewModal preview={previewProps([previewItem(imageUrl)])} {...callbacks()} />
      );
      await fireEvent(first.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(first.getByTestId('compatible-svg-document-view')).toBeTruthy());
      await first.unmount();

      const cached = await render(
        <ImagePreviewModal
          preview={{
            contentSource: null,
            index: 0,
            items: [
              {
                displaySize: { height: 100, width: 100 },
                displayUri: 'file:///cache/body-poster.png',
                originalUri: imageUrl
              }
            ]
          }}
          {...callbacks()}
        />
      );
      const pageStyle = StyleSheet.flatten(cached.getByTestId('preview-zoom-content-0').props.style);

      expect(pageStyle.width / pageStyle.height).toBeCloseTo(2);
      expect(cached.getByTestId('preview-zoom-0').props.maxScale).toBeCloseTo(
        9_200 / (pageStyle.width * PixelRatio.get())
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps a static incompatible SVG on its poster without mounting Chromium', async () => {
    const imageUrl = 'https://example.com/static-report.svg';
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="74ch" height="47em"><text>VPS Remaining Value</text></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const first = await render(
        <ImagePreviewModal preview={previewProps([previewItem(imageUrl)])} {...callbacks()} />
      );

      await fireEvent(first.getByTestId('preview-image-0'), 'error');
      await waitFor(() => first.getByTestId('preview-svg-poster-0'));
      await fireEvent(first.getByTestId('preview-svg-poster-0'), 'display');
      await first.unmount();

      const view = await render(<ImagePreviewModal preview={previewProps([previewItem(imageUrl)])} {...callbacks()} />);
      const poster = view.getByTestId('preview-svg-poster-0');

      expect(poster.props.source).toEqual(
        expect.objectContaining({
          uri: 'file:///cache/complex-svg-poster.png'
        })
      );
      expect(poster.props.allowDownscaling).toBe(true);
      expect(poster.props.cachePolicy).toBe('disk');
      expect(view.queryByTestId('compatible-svg-document-view')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await fireEvent(poster, 'display');
      expect(view.queryByText('图片加载中...')).toBeNull();

      const firstPosterKey = poster.props.recyclingKey;
      await fireEvent(poster, 'error');
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(2));
      const refreshedPoster = view.getByTestId('preview-svg-poster-0');
      expect(refreshedPoster.props.recyclingKey).not.toBe(firstPosterKey);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await fireEvent(refreshedPoster, 'display');
      expect(view.queryByText('图片加载中...')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('retries a failed static poster rebuild without refetching the SVG', async () => {
    const imageUrl = 'https://example.com/evicted-static-report.svg';
    mockRenderSvgPoster
      .mockResolvedValueOnce({
        documentHeight: 470,
        documentWidth: 740,
        height: 470,
        uri: 'file:///cache/evicted-static-report.png',
        width: 740
      })
      .mockRejectedValueOnce(new Error('poster file was evicted'))
      .mockResolvedValueOnce({
        documentHeight: 470,
        documentWidth: 740,
        height: 470,
        uri: 'file:///cache/refreshed-static-report.png',
        width: 740
      });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          '<svg xmlns="http://www.w3.org/2000/svg" width="740" height="470"><text>static report</text></svg>',
          { headers: { 'content-type': 'image/svg+xml' } }
        )
      );
    try {
      const first = await render(
        <ImagePreviewModal preview={previewProps([previewItem(imageUrl)])} {...callbacks()} />
      );
      await fireEvent(first.getByTestId('preview-image-0'), 'error');
      await waitFor(() => first.getByTestId('preview-svg-poster-0'));
      await first.unmount();

      const view = await render(<ImagePreviewModal preview={previewProps([previewItem(imageUrl)])} {...callbacks()} />);
      await fireEvent(view.getByTestId('preview-svg-poster-0'), 'error');
      await waitFor(() => expect(view.getByText('重试')).toBeTruthy());
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await fireEvent.press(view.getByText('重试'));
      await fireEvent(view.getByTestId('preview-svg-poster-0'), 'error');
      await waitFor(() =>
        expect(view.getByTestId('preview-svg-poster-0').props.source).toEqual(
          expect.objectContaining({
            uri: 'file:///cache/refreshed-static-report.png'
          })
        )
      );
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await fireEvent(view.getByTestId('preview-svg-poster-0'), 'display');
      expect(view.queryByText('图片加载中...')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps NodeSeek request identity private and session-scoped', async () => {
    const imageUrl = 'https://www.nodeseek.com/uploads/private-topic.png';
    const sessionIdentity = mediaSessionIdentityForSource('nodeseek', { ...initialForumSessionEpochs, nodeseek: 4 });
    const view = await render(
      <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: 4 }}>
        <ImagePreviewModal
          preview={{ contentSource: 'nodeseek', items: [previewItem(imageUrl)], index: 0 }}
          nodeSeekMediaUserAgent="WZ-Preview-Test"
          {...callbacks()}
        />
      </ForumSessionEpochProvider>
    );

    expect(view.getByTestId('preview-image-0').props.source).toEqual(
      expect.objectContaining({
        cacheKey: `${sessionIdentity}:${imageUrl}`,
        headers: expect.objectContaining({
          'User-Agent': 'WZ-Preview-Test',
          'X-WZ-Forum-Media-Identity': sessionIdentity,
          'X-WZ-Forum-Media-Source': 'nodeseek'
        })
      })
    );
    expect(view.getByTestId('preview-image-0').props.source.headers).not.toHaveProperty('Cookie');
  });

  it('replaces the request and resets zoom when its media epoch changes', async () => {
    const imageUrl = 'https://www.nodeseek.com/uploads/private-topic.png';
    const secondImageUrl = 'https://www.nodeseek.com/uploads/second-private-topic.png';
    const epochFourIdentity = mediaSessionIdentityForSource('nodeseek', { ...initialForumSessionEpochs, nodeseek: 4 });
    const epochFiveIdentity = mediaSessionIdentityForSource('nodeseek', { ...initialForumSessionEpochs, nodeseek: 5 });
    const sharedCallbacks = callbacks();
    const modal = (epoch: number) => (
      <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: epoch }}>
        <ImagePreviewModal
          preview={{ contentSource: 'nodeseek', items: [previewItem(imageUrl), previewItem(secondImageUrl)], index: 0 }}
          nodeSeekMediaUserAgent="WZ-Preview-Test"
          {...sharedCallbacks}
        />
      </ForumSessionEpochProvider>
    );
    const view = await render(modal(4));
    const epochFourImage = view.getByTestId('preview-image-0');
    const epochFourSource = epochFourImage.props.source;
    const epochFourRecyclingKey = epochFourImage.props.recyclingKey;
    const epochFourGestureToken = view.getByTestId('image-preview-gesture').props.mockGestureToken;
    const epochFourZoomToken = view.getByTestId('preview-zoom-0').props.mockZoomToken;
    const staleNextPage = view.getByTestId('image-preview-gesture').props.mockGesture;
    expect(epochFourRecyclingKey).toEqual(expect.stringContaining(epochFourIdentity));
    await fireEvent(view.getByTestId('preview-zoom-0'), 'doubleTapStart', {});
    mockZoomScale = 3;
    await fireEvent(view.getByTestId('preview-zoom-0'), 'update', { scale: 3 });
    await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
    expect(view.getByTestId('preview-zoom-0').props.panEnabled).toBe(true);

    await view.rerender(modal(5));

    const epochFiveImage = view.getByTestId('preview-image-0');
    expect(epochFiveImage.props.recyclingKey).toEqual(expect.stringContaining(epochFiveIdentity));
    expect(epochFiveImage.props.recyclingKey).not.toBe(epochFourRecyclingKey);
    expect(epochFiveImage.props.source).toEqual(
      expect.objectContaining({ cacheKey: `${epochFiveIdentity}:${imageUrl}` })
    );
    expect(epochFiveImage.props.source).not.toBe(epochFourSource);
    expect(view.getByTestId('preview-zoom-0').props.panEnabled).toBe(false);
    expect(view.getByTestId('image-preview-gesture').props.mockGestureToken).not.toBe(epochFourGestureToken);
    expect(view.getByTestId('preview-zoom-0').props.mockZoomToken).not.toBe(epochFourZoomToken);
    await act(() => staleNextPage?.({ translationX: -500, translationY: 10, velocityX: -1_000 }));
    expect(sharedCallbacks.onSelect).not.toHaveBeenCalled();
  });

  it('closes only after a quarter-screen pull or a fast release', async () => {
    const onClose = jest.fn<() => void>();
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([previewItem('https://example.com/pull.png')])}
        {...callbacks({ onClose })}
      />
    );
    await performPreviewGesture(view, { translationY: -1_000, velocityY: -2_000 });
    expect(onClose).not.toHaveBeenCalled();
    await performPreviewGesture(view, { translationY: 100, velocityY: 400 });
    expect(onClose).not.toHaveBeenCalled();
    await performPreviewGesture(view, { translationY: 100, velocityY: 1_200 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the current image open when an active swipe or pull is canceled', async () => {
    const onClose = jest.fn<() => void>();
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(
      <ImagePreviewModal
        preview={previewProps(
          [
            previewItem('https://example.com/previous.png'),
            previewItem('https://example.com/current.png'),
            previewItem('https://example.com/next.png')
          ],
          1
        )}
        {...callbacks({ onClose, onSelect })}
      />
    );

    await performPreviewGesture(view, { canceled: true, translationX: -500, translationY: 10, velocityX: -1_000 });
    await performPreviewGesture(view, { canceled: true, translationY: 300, velocityY: 1_200 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(view.getByText('2/3')).toBeTruthy();
  });
});
