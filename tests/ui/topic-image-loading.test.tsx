import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { NativeModules, StyleSheet, Text } from 'react-native';
import { useHtmlRenderingController } from '@/app/useHtmlRenderingController';
import { ForumContentVideo } from '@/ui/content/ForumContentVideo';
import { FORUM_VIDEO_TAG } from '@/domain/forum/html';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from './styleFixture';
import type { TopicDetail } from '@/domain/forum/models';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { imageSourceFromUrl } from '@/platform/media/htmlImages';
import {
  markOriginalImageDisplayed,
  OriginalImageUpgradeBoundary,
  useOriginalImageUpgradeEnabled
} from '@/platform/media/originalImageLoading';

const imageUrl = 'https://img.example.com/topic.png';
let mockSourceHeaders: Record<string, string> | undefined;
const mockExpoImageProps = jest.fn();
const mockUseImage = jest.fn();
const mockUseVideoPlayer = jest.fn((source: unknown) => ({
  pause: jest.fn(),
  play: jest.fn(),
  playing: false,
  source
}));
const mockRenderSvgPoster = jest.fn(async (_svgBase64: string, _cacheKey: string) => ({
  documentHeight: 1025,
  documentWidth: 920,
  height: 1025,
  uri: 'file:///cache/complex-svg-poster.png',
  width: 920
}));
const mockWebView = jest.fn((_props: unknown) => null);

type MockExpoImageProps = {
  onDisplay?: () => void;
  onError?: (event: { error: string }) => void;
  onLoad?: (event: {
    cacheType: 'none' | 'disk' | 'memory';
    source: { height: number; mediaType: string | null; url: string; width: number };
  }) => void;
  onLoadStart?: () => void;
  onProgress?: (event: { loaded: number; total: number }) => void;
  placeholder?: { uri?: string };
  priority?: 'high' | 'low' | 'normal';
  recyclingKey?: string;
  source?: { cacheKey?: string; headers?: Record<string, string>; uri?: string };
  testID?: string;
  transition?: number;
};

function latestImageProps(uri?: string) {
  const calls = mockExpoImageProps.mock.calls
    .map(([props]) => props as MockExpoImageProps)
    .filter((props) => !uri || props.source?.uri === uri);
  const props = calls.at(-1);
  if (!props) {
    throw new Error(`No ExpoImage render${uri ? ` for ${uri}` : ''}`);
  }
  return props;
}

async function loadAndDisplayImage(
  props: MockExpoImageProps,
  dimensions = { height: 240, width: 320 },
  cacheType: 'none' | 'disk' | 'memory' = 'none'
) {
  await act(() =>
    props.onLoad?.({
      cacheType,
      source: { ...dimensions, mediaType: 'image/png', url: props.source?.uri || '' }
    })
  );
  await act(() => props.onDisplay?.());
}

async function mockFetchSvgDocument(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers });
  if (!response.ok || !/(?:image|application)\/svg\+xml/i.test(response.headers.get('content-type') || '')) {
    return null;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length <= 1024 * 1024 ? { base64: bytes.toString('base64') } : null;
}

jest.mock('expo-image', () => {
  const ReactModule = require('react') as typeof React;
  const { View } = require('react-native') as typeof import('react-native');
  return {
    Image: (props: Record<string, unknown>) => {
      mockExpoImageProps(props);
      return ReactModule.createElement(View, {
        testID: typeof props.testID === 'string' ? props.testID : 'expo-image'
      });
    },
    useImage: (source: { uri?: string }, options?: unknown, dependencies?: unknown[]) =>
      mockUseImage(source, options, dependencies)
  };
});

jest.mock('expo', () => ({
  useEvent: jest.fn((_player, _eventName, initialValue) => initialValue)
}));

jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: (source: unknown) => mockUseVideoPlayer(source)
}));

jest.mock('react-native-webview', () => ({ WebView: (props: unknown) => mockWebView(props) }));

jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual<typeof import('@/platform/network/managedCookies')>('@/platform/network/managedCookies')
}));

jest.mock('react-native-render-html', () => ({
  getNativePropsForTNode: jest.fn(() => ({})),
  TChildrenRenderer: () => null,
  useContentWidth: () => 320,
  useIMGElementProps: (props: { tnode: { attributes: Record<string, string> } }) => ({
    alt: props.tnode.attributes.alt || '测试图片',
    computeMaxWidth: (width: number) => width,
    containerProps: {},
    contentWidth: 320,
    height: props.tnode.attributes.height,
    objectFit: 'contain',
    source: { headers: mockSourceHeaders, uri: props.tnode.attributes.src },
    style: {},
    width: props.tnode.attributes.width
  }),
  useIMGElementStateWithCache: ({
    cachedNaturalDimensions,
    height: specifiedHeight,
    source,
    width: specifiedWidth
  }: {
    cachedNaturalDimensions: { height: number; width: number };
    height?: string;
    source: unknown;
    width?: string;
  }) => {
    const specified =
      Number(specifiedWidth) > 0 && Number(specifiedHeight) > 0
        ? { height: Number(specifiedHeight), width: Number(specifiedWidth) }
        : cachedNaturalDimensions;
    const width = Math.min(specified.width, 320);
    const height = Math.round((specified.height * width) / specified.width);
    return {
      alt: '测试图片',
      containerStyle: {},
      dimensions: { height, width },
      imageStyle: {},
      source,
      type: 'success'
    };
  }
}));

const readerData = createEmptyReaderData();
const theme = createTheme(readerData.settings);
const styles = createStyles(theme, readerData.settings, 800);
const noop = () => undefined;
const topic: TopicDetail = {
  author: 'alice',
  contentHtml: `<p><img src="${imageUrl}" alt="测试图片"></p>`,
  createdAt: '2026-07-17T00:00:00.000Z',
  id: 'image-topic',
  replies: [],
  replyCount: 0,
  source: 'yaohuo',
  title: '图片加载测试',
  url: 'https://yaohuo.me/bbs-1.html'
};

function TopicImageHarness({
  attributes = { alt: '测试图片', src: imageUrl },
  mediaSessionIdentity = 'yaohuo:2',
  onOpenImagePreview = noop,
  originalImageUpgradeEnabled = true
}: {
  attributes?: Record<string, string>;
  mediaSessionIdentity?: string;
  onOpenImagePreview?: (url: string, displaySize?: { height: number; width: number }, displayedUri?: string) => void;
  originalImageUpgradeEnabled?: boolean;
}) {
  const { htmlRenderers } = useHtmlRenderingController({
    mediaSessionIdentity,
    onOpenExternalUrl: noop,
    onOpenImagePreview,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic: topic,
    settings: readerData.settings,
    styles,
    theme,
    topicDetail: topic,
    topicKey: 'yaohuo:image-topic',
    webViewBlockMessage: ''
  });
  const ImageRenderer = htmlRenderers.img as unknown as React.ComponentType<Record<string, unknown>> | undefined;
  return ImageRenderer ? (
    <OriginalImageUpgradeBoundary enabled={originalImageUpgradeEnabled}>
      {React.createElement(ImageRenderer, {
        tnode: {
          attributes
        }
      } as never)}
    </OriginalImageUpgradeBoundary>
  ) : null;
}

function htmlRenderingControllerProps(mediaSessionIdentity: string) {
  return {
    mediaSessionIdentity,
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic: topic,
    settings: readerData.settings,
    styles,
    theme,
    topicDetail: topic,
    topicKey: 'yaohuo:image-topic',
    webViewBlockMessage: ''
  };
}

describe('topic block image loading', () => {
  beforeEach(() => {
    mockSourceHeaders = undefined;
    mockExpoImageProps.mockClear();
    mockUseImage.mockClear();
    mockUseVideoPlayer.mockClear();
    mockRenderSvgPoster.mockClear();
    mockWebView.mockClear();
    NativeModules.SvgRendererModule = {
      fetchSvgDocument: mockFetchSvgDocument,
      renderPoster: mockRenderSvgPoster
    };
  });

  it('[REG-PERF-008] composes nested original-image gates with the inactive route gate', async () => {
    const Probe = () => <Text>{useOriginalImageUpgradeEnabled() ? 'original active' : 'original paused'}</Text>;
    const view = await render(
      <OriginalImageUpgradeBoundary enabled={false}>
        <OriginalImageUpgradeBoundary enabled>
          <Probe />
        </OriginalImageUpgradeBoundary>
      </OriginalImageUpgradeBoundary>
    );

    expect(view.getByText('original paused')).toBeTruthy();
  });

  it('lets the mounted native image view own the body request lifecycle', async () => {
    await render(<TopicImageHarness />);

    expect(mockUseImage).not.toHaveBeenCalled();
    expect(mockExpoImageProps).toHaveBeenCalledWith(
      expect.objectContaining({
        cachePolicy: 'memory-disk',
        priority: 'normal',
        source: expect.objectContaining({ uri: imageUrl })
      })
    );
  });

  it('[REG-TOPIC-040] requests the smallest responsive candidate that fits the body pixels', async () => {
    const selectedUrl = 'https://img.example.com/body-640.png';
    await render(
      <TopicImageHarness
        attributes={{
          alt: '响应式图片',
          src: 'https://img.example.com/fallback-original.png',
          srcset: `https://img.example.com/body-320.png 320w, ${selectedUrl} 640w, https://img.example.com/original-2000.png 2000w`
        }}
      />
    );

    expect(latestImageProps(selectedUrl).source).toEqual(expect.objectContaining({ uri: selectedUrl }));
    expect(
      mockExpoImageProps.mock.calls.some(
        ([props]) => (props as MockExpoImageProps).source?.uri === 'https://img.example.com/original-2000.png'
      )
    ).toBe(false);
  });

  it('[REG-TOPIC-048] starts the low-priority original only after the display image is shown', async () => {
    const displayUrl = 'https://img.example.com/progressive-display.png';
    const originalUrl = 'https://img.example.com/progressive-original.png';
    mockSourceHeaders = { Referer: 'https://img.example.com/topic' };
    const screen = await render(
      <TopicImageHarness
        attributes={{
          alt: '渐进图片',
          'data-original': originalUrl,
          src: displayUrl
        }}
      />
    );
    const displayProps = latestImageProps(displayUrl);

    expect(
      mockExpoImageProps.mock.calls.some(([props]) => (props as MockExpoImageProps).source?.uri === originalUrl)
    ).toBe(false);
    await act(() =>
      displayProps.onLoad?.({
        cacheType: 'none',
        source: { height: 600, mediaType: 'image/png', url: displayUrl, width: 400 }
      })
    );
    expect(
      mockExpoImageProps.mock.calls.some(([props]) => (props as MockExpoImageProps).source?.uri === originalUrl)
    ).toBe(false);

    await act(() => displayProps.onDisplay?.());
    const originalProps = latestImageProps(originalUrl);
    expect(originalProps).toEqual(
      expect.objectContaining({
        placeholder: expect.objectContaining({ uri: displayUrl }),
        priority: 'low',
        source: expect.objectContaining({
          headers: expect.objectContaining({ Referer: 'https://img.example.com/topic' }),
          uri: originalUrl
        }),
        testID: 'topic-image-original',
        transition: 150
      })
    );
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
    const dimensionsBeforeUpgrade = StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style);

    await act(() => originalProps.onDisplay?.());

    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject(
      dimensionsBeforeUpgrade
    );
    expect(screen.getByTestId('topic-image-original')).toBeTruthy();
  });

  it('[REG-TOPIC-048] does not duplicate a request when display and original URLs match', async () => {
    const sharedUrl = 'https://img.example.com/already-original.png';
    const screen = await render(
      <TopicImageHarness
        attributes={{
          'data-original': sharedUrl,
          src: sharedUrl
        }}
      />
    );

    await loadAndDisplayImage(latestImageProps(sharedUrl));

    expect(screen.queryByTestId('topic-image-original')).toBeNull();
  });

  it('[REG-TOPIC-048] honors the nearby gate and isolates fullscreen readiness by media epoch', async () => {
    const displayUrl = 'https://img.example.com/gated-display.png';
    const originalUrl = 'https://img.example.com/gated-original.png';
    const screen = await render(
      <TopicImageHarness
        attributes={{ 'data-original': originalUrl, src: displayUrl }}
        originalImageUpgradeEnabled={false}
      />
    );

    await loadAndDisplayImage(latestImageProps(displayUrl));
    expect(screen.queryByTestId('topic-image-original')).toBeNull();

    await act(() =>
      markOriginalImageDisplayed(
        imageSourceFromUrl(originalUrl, {
          mediaContext: { contentSource: 'yaohuo', sessionIdentity: 'yaohuo:1' }
        })
      )
    );
    expect(screen.queryByTestId('topic-image-original')).toBeNull();

    await act(() =>
      markOriginalImageDisplayed(
        imageSourceFromUrl(originalUrl, {
          mediaContext: { contentSource: 'yaohuo', sessionIdentity: 'yaohuo:2' }
        })
      )
    );
    await waitFor(() => expect(screen.getByTestId('topic-image-original')).toBeTruthy());
    expect(latestImageProps(originalUrl).source).toEqual(
      expect.objectContaining({
        cacheKey: `yaohuo:2:${originalUrl}`
      })
    );
  });

  it('[REG-TOPIC-048] raises a tapped original to high priority and keeps the display image on background failure', async () => {
    const displayUrl = 'https://img.example.com/failure-display.png';
    const originalUrl = 'https://img.example.com/failure-original.png';
    const onOpenImagePreview = jest.fn();
    const screen = await render(
      <TopicImageHarness
        attributes={{ alt: '渐进失败图片', 'data-original': originalUrl, src: displayUrl }}
        originalImageUpgradeEnabled={false}
        onOpenImagePreview={onOpenImagePreview}
      />
    );

    await fireEvent.press(screen.getByLabelText('测试图片'));
    expect(latestImageProps(originalUrl).priority).toBe('high');
    expect(onOpenImagePreview).toHaveBeenCalledWith(displayUrl, undefined, undefined);
    await loadAndDisplayImage(latestImageProps(displayUrl));
    await act(() => latestImageProps(originalUrl).onError?.({ error: 'background failed' }));

    expect(screen.queryByTestId('topic-image-original')).toBeNull();
    expect(screen.queryByText('测试图片')).toBeNull();
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);

    await act(() =>
      markOriginalImageDisplayed(
        imageSourceFromUrl(originalUrl, {
          mediaContext: { contentSource: 'yaohuo', sessionIdentity: 'yaohuo:2' }
        })
      )
    );
    await waitFor(() => expect(screen.getByTestId('topic-image-original')).toBeTruthy());
  });

  it('keeps one loading indicator until the native image is displayed', async () => {
    const screen = await render(<TopicImageHarness />);
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 240,
      width: 320
    });
    const imageProps = latestImageProps(imageUrl);
    await act(() =>
      imageProps.onLoad?.({
        cacheType: 'none',
        source: { height: 600, mediaType: 'image/png', url: imageUrl, width: 400 }
      })
    );
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 480,
      width: 320
    });
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    await act(() => imageProps.onDisplay?.());
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
  });

  it('[REG-TOPIC-004] waits for a matching late onLoad after onDisplay without accepting an older request', async () => {
    const lateImageUrl = 'https://img.example.com/android-display-before-load.png';
    mockSourceHeaders = { Cookie: 'session=one' };
    const screen = await render(<TopicImageHarness attributes={{ alt: 'Android 事件顺序图片', src: lateImageUrl }} />);
    const firstImageProps = latestImageProps(lateImageUrl);

    await act(() => firstImageProps.onDisplay?.());
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 240,
      width: 320
    });
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    await act(() =>
      firstImageProps.onLoad?.({
        cacheType: 'memory',
        source: { height: 600, mediaType: 'image/png', url: lateImageUrl, width: 400 }
      })
    );
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 480,
      width: 320
    });
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);

    mockSourceHeaders = { Cookie: 'session=two' };
    await screen.rerender(<TopicImageHarness attributes={{ alt: 'Android 事件顺序图片', src: lateImageUrl }} />);
    await act(() =>
      firstImageProps.onLoad?.({
        cacheType: 'none',
        source: { height: 400, mediaType: 'image/png', url: lateImageUrl, width: 1_600 }
      })
    );

    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 480,
      width: 320
    });
  });

  it('[REG-TOPIC-004] replaces block thumbnail dimensions with the same request natural dimensions', async () => {
    const thumbnailImageUrl = 'https://img.example.com/block-thumbnail-dimensions.png';
    const screen = await render(
      <TopicImageHarness
        attributes={{
          alt: '带缩略尺寸的正文图',
          height: '100',
          src: thumbnailImageUrl,
          width: '200'
        }}
      />
    );
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 240,
      width: 320
    });

    await act(() =>
      latestImageProps(thumbnailImageUrl).onLoad?.({
        cacheType: 'none',
        source: { height: 400, mediaType: 'image/png', url: thumbnailImageUrl, width: 1_600 }
      })
    );

    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 80,
      width: 320
    });
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
  });

  it('summarizes progress, cache and display timing without logging the image URL', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    try {
      await render(<TopicImageHarness />);
      const imageProps = latestImageProps(imageUrl);
      await act(() => imageProps.onLoadStart?.());
      jest.setSystemTime(1_010);
      await act(() => imageProps.onProgress?.({ loaded: 4096, total: 8192 }));
      jest.setSystemTime(1_020);
      await act(() =>
        imageProps.onLoad?.({
          cacheType: 'disk',
          source: { height: 600, mediaType: 'image/png', url: imageUrl, width: 400 }
        })
      );
      jest.setSystemTime(1_030);
      await act(() => imageProps.onDisplay?.());

      const diagnosticEvents = diagnosticLines.map((line) => JSON.parse(line));
      expect(diagnosticEvents[0]).toEqual(
        expect.objectContaining({
          candidateKind: 'src',
          mediaRef: expect.stringMatching(/^media-\d+$/),
          mediaRole: 'body'
        })
      );
      expect(diagnosticEvents.at(-1)).toEqual(
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
      expect(diagnosticLines.join('')).not.toContain(imageUrl);
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('does not show the previous image while changed request headers are loading', async () => {
    mockSourceHeaders = { Cookie: 'session=one' };
    const screen = await render(<TopicImageHarness />);
    const firstImageProps = latestImageProps(imageUrl);
    await loadAndDisplayImage(firstImageProps);
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);

    mockExpoImageProps.mockClear();
    mockSourceHeaders = { Cookie: 'session=two' };
    await screen.rerender(<TopicImageHarness />);

    const secondImageProps = latestImageProps(imageUrl);
    expect(secondImageProps.source?.headers).toEqual(expect.objectContaining({ Cookie: 'session=two' }));
    expect(secondImageProps.recyclingKey).not.toBe(firstImageProps.recyclingKey);
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    await loadAndDisplayImage(firstImageProps, { height: 240, width: 320 });
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    await loadAndDisplayImage(secondImageProps, { height: 300, width: 320 });
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
  });

  it('[REG-ACCOUNT-029] changes the same image request identity when the media epoch changes', async () => {
    const screen = await render(<TopicImageHarness mediaSessionIdentity="yaohuo:1" />);
    const epochOneProps = latestImageProps(imageUrl);
    expect(epochOneProps.source).toEqual(
      expect.objectContaining({
        cacheKey: `yaohuo:1:${imageUrl}`,
        uri: imageUrl
      })
    );
    await screen.rerender(<TopicImageHarness mediaSessionIdentity="yaohuo:2" />);
    const epochTwoProps = latestImageProps(imageUrl);
    expect(epochTwoProps.source).toEqual(
      expect.objectContaining({
        cacheKey: `yaohuo:2:${imageUrl}`,
        uri: imageUrl
      })
    );
    expect(epochTwoProps.recyclingKey).not.toBe(epochOneProps.recyclingKey);

    await loadAndDisplayImage(epochTwoProps, { height: 300, width: 320 });
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 300,
      width: 320
    });
    await loadAndDisplayImage(epochOneProps, { height: 600, width: 320 });
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 300,
      width: 320
    });
  });

  it('[REG-ACCOUNT-029] rebuilds the native-managed video source when the media epoch changes', async () => {
    const videoUrl = 'https://yaohuo.me/media/private-topic.mp4';
    const controller = await renderHook(
      (props: { mediaSessionIdentity: string }) =>
        useHtmlRenderingController(htmlRenderingControllerProps(props.mediaSessionIdentity)),
      { initialProps: { mediaSessionIdentity: 'yaohuo:1' } }
    );
    const videoProps = { tnode: { attributes: { src: videoUrl } } };
    const firstRenderer = controller.result.current.htmlRenderers[FORUM_VIDEO_TAG] as unknown as (
      props: typeof videoProps
    ) => React.ReactElement<typeof ForumContentVideo>;
    const firstVideo = firstRenderer(videoProps);

    expect(firstVideo.key).toBe(`yaohuo:1:${videoUrl}`);
    const video = await render(firstVideo);
    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-WZ-Forum-Media-Source': 'yaohuo' }),
        uri: videoUrl
      })
    );
    expect(mockUseVideoPlayer.mock.calls.at(-1)?.[0]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: expect.any(String) })
      })
    );

    await controller.rerender({ mediaSessionIdentity: 'yaohuo:2' });
    const secondRenderer = controller.result.current.htmlRenderers[FORUM_VIDEO_TAG] as unknown as (
      props: typeof videoProps
    ) => React.ReactElement<typeof ForumContentVideo>;
    const secondVideo = secondRenderer(videoProps);
    expect(secondVideo.key).toBe(`yaohuo:2:${videoUrl}`);
    await video.rerender(secondVideo);
    await waitFor(() =>
      expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-WZ-Forum-Media-Source': 'yaohuo' }),
          uri: videoUrl
        })
      )
    );
  });

  it('ignores a stale image failure after the request headers change', async () => {
    mockSourceHeaders = { Cookie: 'session=one' };
    const fetchSpy = jest.spyOn(global, 'fetch');
    const screen = await render(<TopicImageHarness />);
    const staleImageProps = latestImageProps(imageUrl);

    mockSourceHeaders = { Cookie: 'session=two' };
    await screen.rerender(<TopicImageHarness />);
    const currentImageProps = latestImageProps(imageUrl);
    await act(() => staleImageProps.onError?.({ error: 'old request failed' }));

    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    expect(screen.queryByText('测试图片')).toBeNull();
    expect(currentImageProps.source?.headers).toEqual(expect.objectContaining({ Cookie: 'session=two' }));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('reuses natural dimensions on the first frame when the same URL is rendered again', async () => {
    const cachedImageUrl = 'https://img.example.com/portrait-cache.png';
    const attributes = { alt: '纵向图片', src: cachedImageUrl };
    const firstScreen = await render(<TopicImageHarness attributes={attributes} />);
    expect(StyleSheet.flatten(firstScreen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 240,
      width: 320
    });

    await loadAndDisplayImage(latestImageProps(cachedImageUrl), { height: 600, width: 400 });
    expect(StyleSheet.flatten(firstScreen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 480,
      width: 320
    });
    await firstScreen.unmount();

    const secondScreen = await render(<TopicImageHarness attributes={attributes} />);
    expect(StyleSheet.flatten(secondScreen.getByTestId('topic-image-frame').props.style)).toMatchObject({
      height: 480,
      width: 320
    });
    expect(secondScreen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
  });

  it('stops loading and shows alt text when decoding fails', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      headers: { get: () => 'image/png' },
      ok: true
    } as unknown as Response);
    const screen = await render(<TopicImageHarness />);

    await act(() => latestImageProps(imageUrl).onError?.({ error: 'decode failed' }));

    try {
      await waitFor(() => expect(screen.getByText('测试图片')).toBeTruthy());
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(screen.queryByTestId('expo-image')).toBeNull();
      const diagnosticEvents = diagnosticLines.map((line) => JSON.parse(line));
      expect(diagnosticEvents).toContainEqual(
        expect.objectContaining({
          area: 'media',
          phase: 'intent',
          surface: 'body'
        })
      );
      expect(diagnosticEvents).toContainEqual(
        expect.objectContaining({
          area: 'media',
          outcome: 'failure',
          terminalReason: 'native-error'
        })
      );
      expect(diagnosticLines.join('')).not.toContain(imageUrl);
    } finally {
      setDiagnosticWriter(null);
      fetchSpy.mockRestore();
    }
  });

  it('[REG-TOPIC-032] settles a stalled body image within the 30 second image budget', async () => {
    const timeoutImageUrl = 'https://img.example.com/stalled-body-image.png';
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    jest.useFakeTimers();
    try {
      const screen = await render(<TopicImageHarness attributes={{ alt: '超时图片', src: timeoutImageUrl }} />);
      const stalledImageProps = latestImageProps(timeoutImageUrl);

      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
      expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
        height: 240,
        width: 320
      });
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(screen.getByText('测试图片')).toBeTruthy();
      expect(screen.queryByTestId('expo-image')).toBeNull();
      await act(() =>
        stalledImageProps.onLoad?.({
          cacheType: 'none',
          source: { height: 400, mediaType: 'image/png', url: timeoutImageUrl, width: 1_600 }
        })
      );
      expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
        height: 240,
        width: 320
      });
      expect(screen.getByText('测试图片')).toBeTruthy();
      const diagnosticEvents = diagnosticLines.map((line) => JSON.parse(line));
      expect(diagnosticEvents).toContainEqual(
        expect.objectContaining({
          area: 'media',
          phase: 'intent',
          surface: 'body'
        })
      );
      expect(diagnosticEvents).toContainEqual(
        expect.objectContaining({
          area: 'media',
          outcome: 'failure',
          terminalReason: 'timeout'
        })
      );
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('REG-TOPIC-018 renders a Chromium poster after Android rejects an SVG response', async () => {
    const svgImageUrl = 'https://img.example.com/dynamic-report.png';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><a href="https://example.com"><tspan>report</tspan></a></text></svg>';
    const onOpenImagePreview = jest.fn();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(svg, {
        headers: { 'content-type': 'image/svg+xml; charset=utf-8' }
      })
    );
    try {
      const screen = await render(
        <TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} onOpenImagePreview={onOpenImagePreview} />
      );

      await act(() => latestImageProps(svgImageUrl).onError?.({ error: 'Cannot load SVG from stream' }));

      await waitFor(() => expect(latestImageProps('file:///cache/complex-svg-poster.png')).toBeTruthy());
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
      await loadAndDisplayImage(latestImageProps('file:///cache/complex-svg-poster.png'), { height: 1025, width: 920 });
      await fireEvent.press(screen.getByLabelText('测试图片'));
      const encodedSvg = String(mockRenderSvgPoster.mock.calls.at(-1)?.[0] || '');
      expect(Buffer.from(encodedSvg, 'base64').toString('utf8')).toBe(svg);
      expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1);
      expect(onOpenImagePreview).toHaveBeenCalledWith(
        svgImageUrl,
        { height: 1025, width: 920 },
        'file:///cache/complex-svg-poster.png'
      );
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(screen.queryByText('测试图片')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reports an abandoned SVG recovery as a stale fallback load', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    const svgImageUrl = 'https://img.example.com/pending-complex.svg';
    let resolvePendingResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolvePendingResponse = resolve;
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => pendingResponse);
    try {
      const screen = await render(<TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} />);
      await act(() => latestImageProps(svgImageUrl).onError?.({ error: 'native SVG failure' }));
      await screen.unmount();

      expect(diagnosticLines.map((line) => JSON.parse(line))).toContainEqual(
        expect.objectContaining({
          fallback: 'svg',
          outcome: 'stale',
          terminalReason: 'stale'
        })
      );
      await act(async () => {
        resolvePendingResponse(
          new Response('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          })
        );
        await pendingResponse;
      });
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1));
      const finishEvents = diagnosticLines.map((line) => JSON.parse(line)).filter((event) => event.phase === 'finish');
      expect(finishEvents).toEqual([
        expect.objectContaining({ fallback: 'svg', outcome: 'stale', terminalReason: 'stale' })
      ]);
    } finally {
      fetchSpy.mockRestore();
      setDiagnosticWriter(null);
    }
  });

  it('REG-TOPIC-038 keeps ten complex body images out of the React WebView tree', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><animate attributeName="opacity" /></svg>';
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(
      async () =>
        new Response(svg, {
          headers: { 'content-type': 'image/svg+xml' }
        })
    );
    try {
      await render(
        <>
          {Array.from({ length: 10 }, (_, index) => (
            <TopicImageHarness
              key={index}
              attributes={{ alt: `复杂图片 ${index + 1}`, src: `https://img.example.com/complex-${index}.svg` }}
            />
          ))}
        </>
      );
      const nativeErrors = mockExpoImageProps.mock.calls
        .map(([props]) => props as MockExpoImageProps)
        .filter((props) => props.source?.uri?.startsWith('https://img.example.com/complex-'))
        .map((props) => props.onError);
      expect(nativeErrors).toHaveLength(10);

      await act(() => {
        nativeErrors.forEach((onError) => onError?.({ error: 'native SVG failure' }));
      });
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(10));

      expect(mockWebView).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledTimes(10);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-038 rebuilds one evicted poster and then settles if the rebuilt file also fails', async () => {
    const svgImageUrl = 'https://img.example.com/evicted-complex-report.svg';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><animate attributeName="opacity" /></svg>';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(svg, {
        headers: { 'content-type': 'image/svg+xml' }
      })
    );
    try {
      const screen = await render(<TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} />);

      await act(() => latestImageProps(svgImageUrl).onError?.({ error: 'native SVG failure' }));
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1));
      const firstPosterProps = latestImageProps('file:///cache/complex-svg-poster.png');

      await act(() => firstPosterProps.onError?.({ error: 'poster file was evicted' }));
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(2));
      const secondPosterProps = latestImageProps('file:///cache/complex-svg-poster.png');
      expect(firstPosterProps.source?.cacheKey).not.toBe(secondPosterProps.source?.cacheKey);
      expect(firstPosterProps.recyclingKey).not.toBe(secondPosterProps.recyclingKey);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await act(() => secondPosterProps.onError?.({ error: 'rebuilt poster still unreadable' }));
      await waitFor(() => expect(screen.getByText('测试图片')).toBeTruthy());
      expect(mockRenderSvgPoster).toHaveBeenCalledTimes(2);
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-038 ignores a late SVG artifact from the previous media epoch', async () => {
    const svgImageUrl = 'https://img.example.com/epoch-complex-report.svg';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>';
    let resolveOldResponse!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOldResponse = resolve;
    });
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce(new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }));
    try {
      const screen = await render(
        <TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} mediaSessionIdentity="yaohuo:1" />
      );
      const oldImageProps = latestImageProps(svgImageUrl);
      await act(() => oldImageProps.onError?.({ error: 'old native SVG failure' }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      await screen.rerender(
        <TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} mediaSessionIdentity="yaohuo:2" />
      );
      const currentImageProps = latestImageProps(svgImageUrl);
      await act(() => currentImageProps.onError?.({ error: 'current native SVG failure' }));
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(
          mockExpoImageProps.mock.calls.some(
            ([props]) =>
              String((props as MockExpoImageProps).source?.uri || '').startsWith('file://') &&
              String((props as MockExpoImageProps).recyclingKey || '').includes('yaohuo:2')
          )
        ).toBe(true)
      );

      await act(async () => {
        resolveOldResponse(new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }));
        await oldResponse;
      });
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(2));

      expect(
        mockExpoImageProps.mock.calls.some(
          ([props]) =>
            String((props as MockExpoImageProps).source?.uri || '').startsWith('file://') &&
            String((props as MockExpoImageProps).recyclingKey || '').includes('yaohuo:1')
        )
      ).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps inline emoji on the native inline renderer without starting the block loader', async () => {
    await render(
      <TopicImageHarness
        attributes={{
          alt: 'emoji',
          class: 'emoji',
          height: '24',
          src: 'https://img.example.com/emoji.png',
          width: '24'
        }}
      />
    );

    expect(mockUseImage).not.toHaveBeenCalled();
  });
});
