import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import React from 'react';
import { NativeModules, StyleSheet } from 'react-native';
import { ImagePreviewModal } from '../../src/components/ImagePreviewModal';
import { createEmptyReaderData } from '../../src/readerData';
import { createStyles, createTheme } from '../../src/theme';
import { ForumSessionEpochProvider, mediaSessionIdentityForSource } from '../../src/mediaSessionEpoch';
import { initialForumSessionEpochs } from '../../src/app/serverState';
import { setDiagnosticWriter } from '../../src/diagnostics';

const mockRenderSvgPoster = jest.fn(async (_svgBase64: string, _cacheKey: string) => ({
  documentHeight: 1025,
  documentWidth: 920,
  height: 1025,
  uri: 'file:///cache/complex-svg-poster.png',
  width: 920
}));
let mockZoomScale = 1;
let mockPagerNextToken = 0;
let mockZoomNextToken = 0;
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
  return {
    Image: ({ contentFit, testID, ...props }: {
      contentFit?: string;
      onDisplay?: () => void;
      onError?: () => void;
      onLoad?: (event: { source: { height: number; width: number } }) => void;
      onLoadStart?: () => void;
      source?: { uri?: string };
      testID?: string;
    }) => {
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
      return ReactModule.createElement(
        NativeView,
        { ...props, testID: testID || (contentFit === 'contain' ? 'active-preview-image' : 'preview-thumbnail-image') }
      );
    }
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const GestureView = NativeView as React.ComponentType<Record<string, unknown>>;
  const gesture = () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const value: Record<string, unknown> = { handlers };
    for (const name of [
      'activeOffsetX', 'activeOffsetY', 'enabled', 'failOffsetX', 'failOffsetY', 'maxPointers'
    ]) {
      value[name] = () => value;
    }
    for (const name of ['onEnd', 'onFinalize', 'onUpdate']) {
      value[name] = (handler: (...args: unknown[]) => void) => {
        handlers[name] = handler;
        return value;
      };
    }
    return value;
  };
  return {
    Gesture: {
      Native: gesture,
      Pan: gesture,
      Simultaneous: (...gestures: Array<{ handlers?: Record<string, (...args: unknown[]) => void> }>) => ({
        handlers: Object.fromEntries(
          ['onEnd', 'onFinalize', 'onUpdate'].map((name) => [name, (...args: unknown[]) => {
            for (const item of gestures) {
              item.handlers?.[name]?.(...args);
            }
          }])
        )
      })
    },
    GestureDetector: ({ children, gesture: value }: {
      children?: React.ReactNode;
      gesture?: { handlers?: Record<string, (...args: unknown[]) => void> };
    }) => ReactModule.createElement(
      GestureView,
      {
        testID: 'image-preview-pull-gesture',
        onEnd: value?.handlers?.onEnd,
        onFinalize: value?.handlers?.onFinalize,
        onUpdate: value?.handlers?.onUpdate
      },
      children
    ),
    GestureHandlerRootView: ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement(
      NativeView,
      props,
      children
    )
  };
});

jest.mock('react-native-pager-view', () => {
  const ReactModule = require('react') as typeof React;
  const { View: NativeView } = require('react-native') as typeof import('react-native');
  const PagerMockView = NativeView as React.ComponentType<Record<string, unknown>>;
  return {
    __esModule: true,
    default: ReactModule.forwardRef(({
      children,
      initialPage = 0,
      onPageSelected,
      ...props
    }: {
      children?: React.ReactNode;
      initialPage?: number;
      onPageSelected?: (event: { nativeEvent: { position: number } }) => void;
    }, ref: React.ForwardedRef<{
      setPage: (index: number) => void;
      setPageWithoutAnimation: (index: number) => void;
      setScrollEnabled: (enabled: boolean) => void;
    }>) => {
      const token = ReactModule.useRef(0);
      if (token.current === 0) {
        token.current = ++mockPagerNextToken;
      }
      const [index, setIndex] = ReactModule.useState(initialPage);
      const select = (nextIndex: number) => {
        setIndex(nextIndex);
        onPageSelected?.({ nativeEvent: { position: nextIndex } });
      };
      ReactModule.useImperativeHandle(ref, () => ({
        setPage: select,
        setPageWithoutAnimation: select,
        setScrollEnabled: () => undefined
      }));
      return ReactModule.createElement(
        PagerMockView,
        { ...props, mockPagerToken: token.current, testID: 'image-preview-pager' },
        children,
        ReactModule.createElement(NativeView, {
          accessibilityLabel: 'mock-next-gallery-page',
          onTouchEnd: () => select(Math.min(index + 1, ReactModule.Children.count(children) - 1))
        })
      );
    })
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
    ResumableZoom: ReactModule.forwardRef(({
      children,
      ...props
    }: {
      children: React.ReactElement<{ testID?: string }>;
    }, ref: React.ForwardedRef<{
      getState: () => { scale: number };
      reset: () => void;
    }>) => {
      const token = ReactModule.useRef(0);
      if (token.current === 0) {
        token.current = ++mockZoomNextToken;
      }
      ReactModule.useImperativeHandle(ref, () => ({
        getState: () => ({ scale: mockZoomScale }),
        reset: () => undefined
      }));
      const index = children.props.testID?.replace('preview-zoom-content-', '') || 'unknown';
      return ReactModule.createElement(
        ZoomMockView,
        { ...props, mockZoomToken: token.current, testID: `preview-zoom-${index}` },
        children
      );
    })
  };
});

jest.mock('lucide-react-native', () => ({ X: () => null }));

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);

function previewItem(originalUri: string, displayUri = originalUri) {
  return { displayUri, originalUri };
}

function previewProps(items: ReturnType<typeof previewItem>[], index = 0) {
  return { contentSource: null, items, index } as const;
}

function callbacks(overrides: Partial<{
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSave: () => void;
  onSelect: (index: number) => void;
}> = {}) {
  return {
    onClose: jest.fn<() => void>(),
    onNext: jest.fn<() => void>(),
    onPrevious: jest.fn<() => void>(),
    onSave: jest.fn<() => void>(),
    onSelect: jest.fn<(index: number) => void>(),
    ...overrides
  };
}

describe('Image preview', () => {
  beforeEach(() => {
    mockZoomScale = 1;
    mockPagerNextToken = 0;
    mockZoomNextToken = 0;
    mockWebViewMounts = 0;
    mockWebViewUnmounts = 0;
    mockWebViewNextToken = 0;
    mockRenderSvgPoster.mockClear();
    NativeModules.SvgRendererModule = {
      fetchSvgDocument: mockFetchSvgDocument,
      renderPoster: mockRenderSvgPoster
    };
  });

  it('mounts only the current and adjacent originals with the display image as placeholder', async () => {
    const items = Array.from({ length: 5 }, (_, index) => previewItem(
      `https://example.com/original-${index}.png`,
      `https://example.com/display-${index}.png`
    ));
    const view = await render(
      <ImagePreviewModal
        preview={previewProps(items, 2)}
        styles={styles}
        theme={theme}
        {...callbacks()}
      />
    );

    expect(view.queryByTestId('preview-image-0')).toBeNull();
    expect(view.getByTestId('preview-image-1').props).toEqual(expect.objectContaining({
      allowDownscaling: true,
      cachePolicy: 'memory-disk',
      placeholder: expect.objectContaining({ uri: items[1]?.displayUri }),
      priority: 'low',
      transition: 150
    }));
    expect(view.getByTestId('preview-image-2').props).toEqual(expect.objectContaining({
      allowDownscaling: false,
      placeholder: expect.objectContaining({ uri: items[2]?.displayUri }),
      priority: 'high',
      source: expect.objectContaining({ uri: items[2]?.originalUri })
    }));
    expect(view.getByTestId('preview-image-3').props.priority).toBe('low');
    expect(view.queryByTestId('preview-image-4')).toBeNull();
    expect(view.queryByTestId('preview-thumbnail-image')).toBeNull();

    await fireEvent(view.getByLabelText('mock-next-gallery-page'), 'touchEnd');
    expect(view.getByTestId('preview-image-2').props.allowDownscaling).toBe(true);
    expect(view.getByTestId('preview-image-3').props.allowDownscaling).toBe(false);
  });

  it('REG-TOPIC-031 settles an immediate cache hit only after the image is displayed', async () => {
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([
          previewItem('https://example.com/fast-cache.png', 'https://example.com/fast-cache-thumb.png')
        ])}
        styles={styles}
        theme={theme}
        {...callbacks()}
      />
    );

    expect(view.queryByText('图片加载中...')).toBeNull();
    expect(view.queryByText('图片加载失败')).toBeNull();
  });

  it('shows one active failure and retries only that page', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    try {
      const items = [
        previewItem('https://example.com/broken.png', 'https://example.com/broken-thumb.png'),
        previewItem('https://example.com/neighbor.png', 'https://example.com/neighbor-thumb.png')
      ];
      const view = await render(
        <ImagePreviewModal preview={previewProps(items)} styles={styles} theme={theme} {...callbacks()} />
      );
      const neighborKey = view.getByTestId('preview-image-1').props.recyclingKey;

      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByText('图片加载失败')).toBeTruthy());
      const failedKey = view.getByTestId('preview-image-0').props.recyclingKey;

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
          styles={styles}
          theme={theme}
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

  it('[REG-TOPIC-046] handles a real horizontal gesture without looping and toggles the centered chrome on a single tap', async () => {
    const onSelect = jest.fn<(index: number) => void>();
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([
          previewItem('https://example.com/one.png'),
          previewItem('https://example.com/two.png'),
          previewItem('https://example.com/three.png')
        ], 1)}
        styles={styles}
        theme={theme}
        {...callbacks({ onSelect })}
      />
    );

    expect(view.getByText('2/3')).toBeTruthy();
    expect(view.queryByLabelText('上一张图片')).toBeNull();
    expect(view.queryByLabelText('下一张图片')).toBeNull();
    const galleryGesture = view.getByTestId('image-preview-pull-gesture');
    await fireEvent(galleryGesture, 'end', {
      translationX: -500,
      translationY: 10,
      velocityX: -1_000,
      velocityY: 0
    });
    expect(onSelect).toHaveBeenLastCalledWith(2);
    expect(view.getByText('3/3')).toBeTruthy();
    await fireEvent(galleryGesture, 'end', {
      translationX: -500,
      translationY: 10,
      velocityX: -1_000,
      velocityY: 0
    });
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
    const view = await render(
      <ImagePreviewModal preview={preview} styles={styles} theme={theme} {...props} />
    );
    await fireEvent(view.getByTestId('preview-zoom-0'), 'tap', {});
    expect(view.queryByLabelText('关闭图片预览')).toBeNull();

    await view.rerender(<ImagePreviewModal preview={null} styles={styles} theme={theme} {...props} />);
    await view.rerender(<ImagePreviewModal preview={preview} styles={styles} theme={theme} {...props} />);

    expect(view.getByLabelText('关闭图片预览')).toBeTruthy();
    expect(view.getByLabelText('保存图片')).toBeTruthy();
  });

  it('shows an already displayed adjacent page without restoring its spinner', async () => {
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([
          previewItem('https://example.com/current.png'),
          previewItem('https://example.com/preloaded.png')
        ])}
        styles={styles}
        theme={theme}
        {...callbacks()}
      />
    );
    await fireEvent(view.getByTestId('preview-image-0'), 'display');
    await fireEvent(view.getByTestId('preview-image-1'), 'display');
    await fireEvent(view.getByLabelText('mock-next-gallery-page'), 'touchEnd');

    expect(view.queryByText('图片加载中...')).toBeNull();
  });

  it('updates the active zoom ceiling from the original pixel dimensions', async () => {
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([previewItem('https://example.com/resolution.png')])}
        styles={styles}
        theme={theme}
        {...callbacks()}
      />
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
      <ImagePreviewModal
        preview={{ contentSource: null, items: [item], index: 0 }}
        styles={styles}
        theme={theme}
        {...callbacks()}
      />
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
        preview={previewProps([
          previewItem('https://example.com/one.png'),
          previewItem('https://example.com/two.png')
        ])}
        styles={styles}
        theme={theme}
        {...callbacks({ onClose, onSelect })}
      />
    );
    const galleryAccessibility = view.getByLabelText('图片预览，第 1 张，共 2 张');

    await fireEvent(galleryAccessibility, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onSelect).not.toHaveBeenCalled();
    await fireEvent(galleryAccessibility, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(view.getByLabelText('图片预览，第 2 张，共 2 张').props.accessibilityValue.text).toBe('第 2 张，共 2 张');
    await fireEvent(view.root!, 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a disabled save state until the save promise settles', async () => {
    let finishSave: (() => void) | undefined;
    const onSave = jest.fn<() => Promise<void>>(() => new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([previewItem('https://example.com/save.png')])}
        styles={styles}
        theme={theme}
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

  it('[REG-TOPIC-032] settles a stalled active preview within the 30 second budget', async () => {
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
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      await fireEvent(view.getByTestId('preview-image-0'), 'loadStart');
      await act(async () => jest.advanceTimersByTime(30_000));

      expect(view.getByText('图片加载失败')).toBeTruthy();
      await fireEvent(view.getByTestId('preview-image-0'), 'display');
      expect(view.getByText('图片加载失败')).toBeTruthy();
      const events = diagnosticLines.map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({ area: 'media', phase: 'intent', surface: 'preview' }));
      const timeoutEvent = events.find((event) => event.outcome === 'failure' && event.terminalReason === 'timeout');
      expect(timeoutEvent).toBeTruthy();
      expect(timeoutEvent).not.toHaveProperty('displayMs');
      await fireEvent(view.getByLabelText('mock-next-gallery-page'), 'touchEnd');
      expect(view.getByTestId('preview-image-0').props.allowDownscaling).toBe(false);
    } finally {
      setDiagnosticWriter(null);
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
          styles={styles}
          theme={theme}
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
      expect(events[0]).toEqual(expect.objectContaining({
        candidateKind: 'lightbox',
        mediaRef: expect.stringMatching(/^media-\d+$/),
        mediaRole: 'preview-active'
      }));
      expect(events.at(-1)).toEqual(expect.objectContaining({
        cacheType: 'disk',
        displayMs: 30,
        firstProgressMs: 10,
        loadedBytes: 4096,
        loadMs: 20,
        sourceHeight: 600,
        sourceWidth: 400,
        totalBytes: 8192
      }));
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
          styles={styles}
          theme={theme}
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
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      await fireEvent(view.getByTestId('preview-image-0'), 'display');
      await fireEvent(view.getByTestId('preview-image-1'), 'loadStart');
      jest.setSystemTime(6_000);
      await fireEvent(view.getByLabelText('mock-next-gallery-page'), 'touchEnd');
      jest.setSystemTime(6_010);
      await fireEvent(view.getByTestId('preview-image-1'), 'load', {
        cacheType: 'disk',
        source: { height: 600, mediaType: 'image/png', url: '', width: 400 }
      });
      jest.setSystemTime(6_020);
      await fireEvent(view.getByTestId('preview-image-1'), 'display');

      const successes = diagnosticLines
        .map((line) => JSON.parse(line))
        .filter((event) => event.outcome === 'success');
      expect(successes.at(-1)).toEqual(expect.objectContaining({ displayMs: 20, loadMs: 10 }));
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('REG-TOPIC-020 defers incompatible SVG recovery until the page is active', async () => {
    const secondUrl = 'https://example.com/dynamic-preview.svg';
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([
            previewItem('https://example.com/first.png'),
            previewItem(secondUrl)
          ])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );

      await fireEvent(view.getByTestId('preview-image-1'), 'error');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(view.queryByTestId('compatible-svg-document-view')).toBeNull();

      await fireEvent(view.getByLabelText('mock-next-gallery-page'), 'touchEnd');
      expect(view.queryByTestId('preview-image-1')?.props.allowDownscaling).toBe(true);
      await act(async () => resolveFetch?.(new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><tspan>report</tspan></text><animate attributeName="opacity" /></svg>',
        { headers: { 'content-type': 'image/svg+xml' } }
      )));
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

  it('REG-TOPIC-018 renders an active incompatible SVG in the isolated document view', async () => {
    const imageUrl = 'https://example.com/active-dynamic.svg';
    const bodyPosterUrl = 'file:///cache/complex-svg-poster.png';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><tspan>active</tspan></text><animate attributeName="opacity" /></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl, bodyPosterUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());
      expect(view.getByTestId('preview-continuity-0').props.source).toEqual(expect.objectContaining({ uri: bodyPosterUrl }));
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

  it('REG-TOPIC-045 keeps Chromium fixed outside zoom and hides it behind the poster', async () => {
    const imageUrl = 'https://example.com/zoomed-dynamic.svg';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460"><animate attributeName="opacity" /></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
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
      expect(view.getByTestId('image-preview-pager').props.scrollEnabled).toBe(false);
      await fireEvent(view.getByTestId('preview-continuity-0'), 'display');
      expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity).toBe(0);
      expect(view.getByTestId('preview-continuity-0').props.recyclingKey).toBe(posterKey);

      mockZoomScale = 3;
      await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
      expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(documentToken);
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);
      expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity).toBe(0);
      expect(view.getByTestId('image-preview-pager').props.scrollEnabled).toBe(false);

      mockZoomScale = 1;
      await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
      await waitFor(() => expect(
        StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity
      ).not.toBe(0));
      expect(view.getByTestId('image-preview-pager').props.scrollEnabled).toBe(true);
      expect(view.queryByTestId('preview-continuity-0')).toBeNull();
      expect(view.getByTestId('compatible-svg-document-view').props.mockWebViewToken).toBe(documentToken);
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);

      await fireEvent(view.getByTestId('preview-zoom-0'), 'pinchStart', {});
      expect(StyleSheet.flatten(view.getByTestId('compatible-svg-document-view').props.style).opacity).toBe(0);
      expect(view.getByTestId('preview-continuity-0').props.recyclingKey).toBe(posterKey);
      await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
      expect((await waitFor(() => view.getByTestId('compatible-svg-document-view'))).props.mockWebViewToken).toBe(documentToken);
      expect(mockWebViewMounts).toBe(1);
      expect(mockWebViewUnmounts).toBe(0);
      expect(view.queryByTestId('preview-continuity-0')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-043 keeps a rebuilt animation poster when the document settles and the page deactivates', async () => {
    const imageUrl = 'https://example.com/deferred-dynamic.svg';
    const items = [previewItem(imageUrl), previewItem('https://example.com/second.png')];
    const sharedCallbacks = callbacks();
    const modal = (index: number) => (
      <ImagePreviewModal
        preview={previewProps(items, index)}
        styles={styles}
        theme={theme}
        {...sharedCallbacks}
      />
    );
    const initialPoster = {
      documentHeight: 460,
      documentWidth: 920,
      height: 460,
      uri: 'file:///cache/deferred-initial.png',
      width: 920
    };
    const refreshedPoster = { ...initialPoster, uri: 'file:///cache/deferred-refreshed.png' };
    let resolveRefresh: ((poster: typeof refreshedPoster) => void) | undefined;
    mockRenderSvgPoster
      .mockResolvedValueOnce(initialPoster)
      .mockImplementationOnce(() => new Promise<typeof refreshedPoster>((resolve) => {
        resolveRefresh = resolve;
      }));
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460"><animate attributeName="opacity" /></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
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
      expect(continuity.props.source).toEqual(expect.objectContaining({
        uri: refreshedPoster.uri
      }));
      expect(continuity.props.recyclingKey).not.toBe(firstPosterKey);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-018 uses the recovered artifact poster when no body poster was supplied', async () => {
    const imageUrl = 'https://example.com/catalog-dynamic.svg';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><animate attributeName="opacity" /></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
    try {
      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      await fireEvent(view.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(view.getByTestId('compatible-svg-document-view')).toBeTruthy());

      expect(view.getByTestId('preview-continuity-0').props.source).toEqual(expect.objectContaining({
        uri: 'file:///cache/complex-svg-poster.png'
      }));
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-018 restores the body poster while an SVG document view remounts', async () => {
    const imageUrl = 'https://example.com/revisit-dynamic.svg';
    const bodyPosterUrl = 'file:///cache/revisit-body-poster.png';
    const items = [
      previewItem(imageUrl, bodyPosterUrl),
      previewItem('https://example.com/second.png')
    ];
    const sharedCallbacks = callbacks();
    const modal = (index: number) => (
      <ImagePreviewModal
        preview={previewProps(items, index)}
        styles={styles}
        theme={theme}
        {...sharedCallbacks}
      />
    );
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="460"><text>revisit</text><animate attributeName="opacity" /></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
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

  it('REG-TOPIC-018 sizes a cached SVG preview from the artifact before mounting its document view', async () => {
    const imageUrl = 'https://example.com/cached-dynamic.svg';
    mockRenderSvgPoster.mockResolvedValueOnce({
      documentHeight: 4_600,
      documentWidth: 9_200,
      height: 4_600,
      uri: 'file:///cache/cached-dynamic-poster.png',
      width: 9_200
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="9200" height="4600"><text>cached</text><animate attributeName="opacity" /></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
    try {
      const first = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      await fireEvent(first.getByTestId('preview-image-0'), 'error');
      await waitFor(() => expect(first.getByTestId('compatible-svg-document-view')).toBeTruthy());
      await first.unmount();

      const cached = await render(
        <ImagePreviewModal
          preview={{
            contentSource: null,
            index: 0,
            items: [{
              displaySize: { height: 100, width: 100 },
              displayUri: 'file:///cache/body-poster.png',
              originalUri: imageUrl
            }]
          }}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      const pageStyle = StyleSheet.flatten(cached.getByTestId('preview-zoom-content-0').props.style);

      expect(pageStyle.width / pageStyle.height).toBeCloseTo(2);
      expect(cached.getByTestId('preview-zoom-0').props.maxScale).toBe(8);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-043 keeps a static incompatible SVG on its poster without mounting Chromium', async () => {
    const imageUrl = 'https://example.com/static-report.svg';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="74ch" height="47em"><text>VPS Remaining Value</text></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
    try {
      const first = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );

      await fireEvent(first.getByTestId('preview-image-0'), 'error');
      await waitFor(() => first.getByTestId('preview-svg-poster-0'));
      await first.unmount();

      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      const poster = view.getByTestId('preview-svg-poster-0');

      expect(poster.props.source).toEqual(expect.objectContaining({
        uri: 'file:///cache/complex-svg-poster.png'
      }));
      expect(poster.props.allowDownscaling).toBe(false);
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

  it('REG-TOPIC-043 retries a failed static poster rebuild without refetching the SVG', async () => {
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
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(
      '<svg xmlns="http://www.w3.org/2000/svg" width="740" height="470"><text>static report</text></svg>',
      { headers: { 'content-type': 'image/svg+xml' } }
    ));
    try {
      const first = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      await fireEvent(first.getByTestId('preview-image-0'), 'error');
      await waitFor(() => first.getByTestId('preview-svg-poster-0'));
      await first.unmount();

      const view = await render(
        <ImagePreviewModal
          preview={previewProps([previewItem(imageUrl)])}
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      );
      await fireEvent(view.getByTestId('preview-svg-poster-0'), 'error');
      await waitFor(() => expect(view.getByText('重试')).toBeTruthy());
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await fireEvent.press(view.getByText('重试'));
      await fireEvent(view.getByTestId('preview-svg-poster-0'), 'error');
      await waitFor(() => expect(view.getByTestId('preview-svg-poster-0').props.source).toEqual(expect.objectContaining({
        uri: 'file:///cache/refreshed-static-report.png'
      })));
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(view.getByText('图片加载中...')).toBeTruthy();

      await fireEvent(view.getByTestId('preview-svg-poster-0'), 'display');
      expect(view.queryByText('图片加载中...')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-019 keeps NodeSeek request identity private and session-scoped', async () => {
    const imageUrl = 'https://www.nodeseek.com/uploads/private-topic.png';
    const sessionIdentity = mediaSessionIdentityForSource('nodeseek', { ...initialForumSessionEpochs, nodeseek: 4 });
    const view = await render(
      <ForumSessionEpochProvider sessionEpochs={{ ...initialForumSessionEpochs, nodeseek: 4 }}>
        <ImagePreviewModal
          preview={{ contentSource: 'nodeseek', items: [previewItem(imageUrl)], index: 0 }}
          nodeSeekMediaUserAgent="WZ-Preview-Test"
          styles={styles}
          theme={theme}
          {...callbacks()}
        />
      </ForumSessionEpochProvider>
    );

    expect(view.getByTestId('preview-image-0').props.source).toEqual(expect.objectContaining({
      cacheKey: `${sessionIdentity}:${imageUrl}`,
      headers: expect.objectContaining({
        'User-Agent': 'WZ-Preview-Test',
        'X-WZ-Forum-Media-Identity': sessionIdentity,
        'X-WZ-Forum-Media-Source': 'nodeseek'
      })
    }));
    expect(view.getByTestId('preview-image-0').props.source.headers).not.toHaveProperty('Cookie');
  });

  it('[REG-ACCOUNT-029][REG-TOPIC-041] replaces the request and resets zoom when its media epoch changes', async () => {
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
          styles={styles}
          theme={theme}
          {...sharedCallbacks}
        />
      </ForumSessionEpochProvider>
    );
    const view = await render(modal(4));
    const epochFourImage = view.getByTestId('preview-image-0');
    const epochFourSource = epochFourImage.props.source;
    const epochFourPagerToken = view.getByTestId('image-preview-pager').props.mockPagerToken;
    const epochFourZoomToken = view.getByTestId('preview-zoom-0').props.mockZoomToken;
    const staleNextPage = view.getByLabelText('mock-next-gallery-page').props.onTouchEnd;
    expect(epochFourImage.props.recyclingKey).toBe(`${epochFourIdentity}:${imageUrl}:0:native`);
    await fireEvent(view.getByTestId('preview-zoom-0'), 'doubleTapStart', {});
    mockZoomScale = 3;
    await fireEvent(view.getByTestId('preview-zoom-0'), 'gestureEnd');
    expect(view.getByTestId('image-preview-pager').props.scrollEnabled).toBe(false);
    expect(view.getByTestId('preview-zoom-0').props.panEnabled).toBe(true);

    await view.rerender(modal(5));

    const epochFiveImage = view.getByTestId('preview-image-0');
    expect(epochFiveImage.props.recyclingKey).toBe(`${epochFiveIdentity}:${imageUrl}:0:native`);
    expect(epochFiveImage.props.source).toEqual(expect.objectContaining({ cacheKey: `${epochFiveIdentity}:${imageUrl}` }));
    expect(epochFiveImage.props.source).not.toBe(epochFourSource);
    expect(view.getByTestId('image-preview-pager').props.scrollEnabled).toBe(true);
    expect(view.getByTestId('preview-zoom-0').props.panEnabled).toBe(false);
    expect(view.getByTestId('image-preview-pager').props.mockPagerToken).not.toBe(epochFourPagerToken);
    expect(view.getByTestId('preview-zoom-0').props.mockZoomToken).not.toBe(epochFourZoomToken);
    await act(() => staleNextPage?.());
    expect(sharedCallbacks.onSelect).not.toHaveBeenCalled();
  });

  it('closes only after a quarter-screen pull or a fast release', async () => {
    const onClose = jest.fn<() => void>();
    const view = await render(
      <ImagePreviewModal
        preview={previewProps([previewItem('https://example.com/pull.png')])}
        styles={styles}
        theme={theme}
        {...callbacks({ onClose })}
      />
    );
    const pullGesture = view.getByTestId('image-preview-pull-gesture');

    await fireEvent(pullGesture, 'end', { translationY: -1_000, velocityY: -2_000 });
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent(pullGesture, 'end', { translationY: 100, velocityY: 400 });
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent(pullGesture, 'end', { translationY: 100, velocityY: 1_200 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
