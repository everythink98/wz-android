import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { NativeModules, PixelRatio, StyleSheet } from 'react-native';
import { useHtmlRenderingController } from '../../src/app/useHtmlRenderingController';
import { ForumContentVideo } from '../../src/components/ForumContentVideo';
import { FORUM_VIDEO_TAG } from '../../src/localHtml';
import { createEmptyReaderData } from '../../src/readerData';
import { createStyles, createTheme } from '../../src/theme';
import type { TopicDetail } from '../../src/types';
import { setDiagnosticWriter } from '../../src/diagnostics';

const imageUrl = 'https://img.example.com/topic.png';
let mockImageRef: { height: number; width: number } | null = null;
let mockImageLoadOptions: { onError?: (error: Error, retry: () => void) => void } | undefined;
let mockSourceHeaders: Record<string, string> | undefined;
let mockUseImageImplementation: (source: { uri?: string }, options?: unknown, dependencies?: unknown[]) => typeof mockImageRef;
const mockExpoImageProps = jest.fn();
const mockUseImage = jest.fn((source: { uri?: string }, options?: unknown, dependencies?: unknown[]) => mockUseImageImplementation(source, options, dependencies));
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
      return ReactModule.createElement(View, { testID: 'expo-image' });
    },
    useImage: (source: { uri?: string }, options?: unknown, dependencies?: unknown[]) => mockUseImage(source, options, dependencies)
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

jest.mock('../../src/managedCookies', () => ({
  ...jest.requireActual<typeof import('../../src/managedCookies')>('../../src/managedCookies')
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
    objectFit: 'contain',
    source: { headers: mockSourceHeaders, uri: props.tnode.attributes.src },
    style: {}
  }),
  useIMGElementStateWithCache: ({ cachedNaturalDimensions, source }: {
    cachedNaturalDimensions: { height: number; width: number };
    source: unknown;
  }) => {
    const width = Math.min(cachedNaturalDimensions.width, 320);
    const height = Math.round(cachedNaturalDimensions.height * width / cachedNaturalDimensions.width);
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
  mediaSessionIdentity = 'yaohuo:2'
}: {
  attributes?: Record<string, string>;
  mediaSessionIdentity?: string;
}) {
  const { htmlRenderers } = useHtmlRenderingController({
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
  });
  const ImageRenderer = htmlRenderers.img as unknown as React.ComponentType<Record<string, unknown>> | undefined;
  return ImageRenderer ? React.createElement(ImageRenderer, {
    tnode: {
      attributes
    }
  } as never) : null;
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
    mockImageRef = null;
    mockImageLoadOptions = undefined;
    mockSourceHeaders = undefined;
    mockUseImageImplementation = (_source, options) => {
      mockImageLoadOptions = options as typeof mockImageLoadOptions;
      return mockImageRef;
    };
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

  it('replaces the only loading indicator with the already loaded image reference', async () => {
    const screen = await render(<TopicImageHarness />);
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({ height: 240, width: 320 });
    expect(mockUseImage).toHaveBeenCalledWith(
      expect.objectContaining({ uri: imageUrl }),
      expect.objectContaining({ maxWidth: Math.ceil(320 * PixelRatio.get()) }),
      expect.any(Array)
    );

    mockImageRef = { height: 240, width: 320 };
    await screen.rerender(<TopicImageHarness />);

    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
    expect(mockExpoImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: mockImageRef }));
  });

  it('does not show the previous image while changed request headers are loading', async () => {
    let resolveImage: ((image: typeof mockImageRef) => void) | undefined;
    mockSourceHeaders = { Cookie: 'session=one' };
    mockUseImageImplementation = (source, _options, dependencies = []) => {
      const ReactModule = require('react') as typeof React;
      const [image, setImage] = ReactModule.useState(null as typeof mockImageRef);
      ReactModule.useEffect(() => {
        resolveImage = setImage;
      }, [source.uri, ...dependencies]);
      return image;
    };
    const screen = await render(<TopicImageHarness />);
    const firstImageRef = { height: 240, width: 320 };
    await act(() => resolveImage?.(firstImageRef));
    await waitFor(() => expect(mockExpoImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: firstImageRef })));

    mockExpoImageProps.mockClear();
    mockSourceHeaders = { Cookie: 'session=two' };
    await screen.rerender(<TopicImageHarness />);

    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    expect(mockExpoImageProps).not.toHaveBeenCalled();

    const secondImageRef = { height: 300, width: 320 };
    await act(() => resolveImage?.(secondImageRef));
    await waitFor(() => expect(mockExpoImageProps).toHaveBeenCalledWith(expect.objectContaining({ source: secondImageRef })));
  });

  it('[REG-ACCOUNT-029] changes the same image request identity when the media epoch changes', async () => {
    let resolveEpochOne!: (image: typeof mockImageRef) => void;
    let resolveEpochTwo!: (image: typeof mockImageRef) => void;
    mockUseImageImplementation = (source, _options, dependencies = []) => {
      const ReactModule = require('react') as typeof React;
      const [image, setImage] = ReactModule.useState(null as typeof mockImageRef);
      const cacheKey = String((source as { cacheKey?: string }).cacheKey || '');
      ReactModule.useEffect(() => {
        setImage(null);
        if (cacheKey.startsWith('yaohuo:1:')) {
          resolveEpochOne = setImage;
        } else if (cacheKey.startsWith('yaohuo:2:')) {
          resolveEpochTwo = setImage;
        }
      }, dependencies);
      return image;
    };
    const screen = await render(<TopicImageHarness mediaSessionIdentity="yaohuo:1" />);

    await waitFor(() => expect(mockUseImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ cacheKey: `yaohuo:1:${imageUrl}`, uri: imageUrl }),
      expect.any(Object),
      [expect.stringContaining(`yaohuo:1:${imageUrl}`)]
    ));
    await screen.rerender(<TopicImageHarness mediaSessionIdentity="yaohuo:2" />);
    await waitFor(() => expect(mockUseImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ cacheKey: `yaohuo:2:${imageUrl}`, uri: imageUrl }),
      expect.any(Object),
      [expect.stringContaining(`yaohuo:2:${imageUrl}`)]
    ));

    const epochTwoImage = { height: 300, width: 320 };
    await act(() => resolveEpochTwo(epochTwoImage));
    await waitFor(() => expect(mockExpoImageProps).toHaveBeenLastCalledWith(expect.objectContaining({
      recyclingKey: `yaohuo:2:${imageUrl}`,
      source: epochTwoImage
    })));

    mockExpoImageProps.mockClear();
    await act(() => resolveEpochOne({ height: 240, width: 320 }));
    expect(mockExpoImageProps).not.toHaveBeenCalled();
  });

  it('[REG-ACCOUNT-029] rebuilds the native-managed video source when the media epoch changes', async () => {
    const videoUrl = 'https://yaohuo.me/media/private-topic.mp4';
    const controller = await renderHook(
      (props: { mediaSessionIdentity: string }) => useHtmlRenderingController(
        htmlRenderingControllerProps(props.mediaSessionIdentity)
      ),
      { initialProps: { mediaSessionIdentity: 'yaohuo:1' } }
    );
    const videoProps = { tnode: { attributes: { src: videoUrl } } };
    const firstRenderer = controller.result.current.htmlRenderers[FORUM_VIDEO_TAG] as unknown as (
      props: typeof videoProps
    ) => React.ReactElement<typeof ForumContentVideo>;
    const firstVideo = firstRenderer(videoProps);

    expect(firstVideo.key).toBe(`yaohuo:1:${videoUrl}`);
    const video = await render(firstVideo);
    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ 'X-WZ-Forum-Media-Source': 'yaohuo' }),
      uri: videoUrl
    }));
    expect(mockUseVideoPlayer.mock.calls.at(-1)?.[0]).not.toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Cookie: expect.any(String) })
    }));

    await controller.rerender({ mediaSessionIdentity: 'yaohuo:2' });
    const secondRenderer = controller.result.current.htmlRenderers[FORUM_VIDEO_TAG] as unknown as (
      props: typeof videoProps
    ) => React.ReactElement<typeof ForumContentVideo>;
    const secondVideo = secondRenderer(videoProps);
    expect(secondVideo.key).toBe(`yaohuo:2:${videoUrl}`);
    await video.rerender(secondVideo);
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ 'X-WZ-Forum-Media-Source': 'yaohuo' }),
      uri: videoUrl
    })));
  });

  it('ignores a stale image failure after the request headers change', async () => {
    const errorCallbacks: Array<NonNullable<typeof mockImageLoadOptions>['onError']> = [];
    mockSourceHeaders = { Cookie: 'session=one' };
    mockUseImageImplementation = (_source, options) => {
      const onError = (options as typeof mockImageLoadOptions)?.onError;
      if (onError) {
        errorCallbacks.push(onError);
      }
      return null;
    };
    const screen = await render(<TopicImageHarness />);
    const staleError = errorCallbacks.at(-1);

    mockSourceHeaders = { Cookie: 'session=two' };
    await screen.rerender(<TopicImageHarness />);
    await act(() => staleError?.(new Error('old request failed'), jest.fn()));

    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    expect(screen.queryByText('测试图片')).toBeNull();
  });

  it('reuses natural dimensions on the first frame when the same URL is rendered again', async () => {
    const cachedImageUrl = 'https://img.example.com/portrait-cache.png';
    const attributes = { alt: '纵向图片', src: cachedImageUrl };
    const firstScreen = await render(<TopicImageHarness attributes={attributes} />);
    expect(StyleSheet.flatten(firstScreen.getByTestId('topic-image-frame').props.style)).toMatchObject({ height: 240, width: 320 });

    mockImageRef = { height: 600, width: 400 };
    await firstScreen.rerender(<TopicImageHarness attributes={attributes} />);
    expect(StyleSheet.flatten(firstScreen.getByTestId('topic-image-frame').props.style)).toMatchObject({ height: 480, width: 320 });
    await firstScreen.unmount();

    mockImageRef = null;
    const secondScreen = await render(<TopicImageHarness attributes={attributes} />);
    expect(StyleSheet.flatten(secondScreen.getByTestId('topic-image-frame').props.style)).toMatchObject({ height: 480, width: 320 });
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

    await act(() => mockImageLoadOptions?.onError?.(new Error('decode failed'), jest.fn()));

    try {
      await waitFor(() => expect(screen.getByText('测试图片')).toBeTruthy());
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(mockExpoImageProps).not.toHaveBeenCalled();
      const diagnosticEvents = diagnosticLines.map((line) => JSON.parse(line));
      expect(diagnosticEvents).toContainEqual(expect.objectContaining({
        area: 'media',
        phase: 'intent',
        surface: 'body'
      }));
      expect(diagnosticEvents).toContainEqual(expect.objectContaining({
        area: 'media',
        outcome: 'failure',
        terminalReason: 'native-error'
      }));
      expect(diagnosticLines.join('')).not.toContain(imageUrl);
    } finally {
      setDiagnosticWriter(null);
      fetchSpy.mockRestore();
    }
  });

  it('[REG-TOPIC-032] settles a stalled body image within the 30 second image budget', async () => {
    const diagnosticLines: string[] = [];
    setDiagnosticWriter((line) => {
      diagnosticLines.push(line);
    });
    jest.useFakeTimers();
    try {
      const screen = await render(<TopicImageHarness />);

      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(screen.getByText('测试图片')).toBeTruthy();
      mockImageRef = { height: 240, width: 320 };
      await screen.rerender(<TopicImageHarness />);
      expect(mockExpoImageProps).not.toHaveBeenCalled();
      expect(screen.getByText('测试图片')).toBeTruthy();
      const diagnosticEvents = diagnosticLines.map((line) => JSON.parse(line));
      expect(diagnosticEvents).toContainEqual(expect.objectContaining({
        area: 'media',
        phase: 'intent',
        surface: 'body'
      }));
      expect(diagnosticEvents).toContainEqual(expect.objectContaining({
        area: 'media',
        outcome: 'failure',
        terminalReason: 'timeout'
      }));
    } finally {
      setDiagnosticWriter(null);
      jest.useRealTimers();
    }
  });

  it('REG-TOPIC-018 renders a Chromium poster after Android rejects an SVG response', async () => {
    const svgImageUrl = 'https://img.example.com/dynamic-report.png';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><a href="https://example.com"><tspan>report</tspan></a></text></svg>';
    const startedSources: string[] = [];
    mockUseImageImplementation = (source, options, dependencies = []) => {
      const ReactModule = require('react') as typeof React;
      mockImageLoadOptions = options as typeof mockImageLoadOptions;
      ReactModule.useEffect(() => {
        startedSources.push(String(source.uri || ''));
      }, dependencies);
      return null;
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(svg, {
      headers: { 'content-type': 'image/svg+xml; charset=utf-8' }
    }));
    try {
      const screen = await render(<TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} />);

      await act(() => mockImageLoadOptions?.onError?.(new Error('Cannot load SVG from stream'), jest.fn()));

      await waitFor(() => expect(mockUseImage).toHaveBeenLastCalledWith(
        expect.objectContaining({ uri: 'file:///cache/complex-svg-poster.png' }),
        expect.any(Object),
        expect.any(Array)
      ));
      await waitFor(() => expect(startedSources).toEqual([
        svgImageUrl,
        'file:///cache/complex-svg-poster.png'
      ]));
      const encodedSvg = String(mockRenderSvgPoster.mock.calls.at(-1)?.[0] || '');
      expect(Buffer.from(encodedSvg, 'base64').toString('utf8')).toBe(svg);
      expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1);
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
      expect(screen.queryByText('测试图片')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-038 keeps ten complex body images out of the React WebView tree', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><animate attributeName="opacity" /></svg>';
    const nativeErrors: Array<NonNullable<typeof mockImageLoadOptions>['onError']> = [];
    mockUseImageImplementation = (source, options) => {
      if (!source.uri?.startsWith('file://')) {
        nativeErrors.push((options as typeof mockImageLoadOptions)?.onError);
      }
      return null;
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(svg, {
      headers: { 'content-type': 'image/svg+xml' }
    }));
    try {
      await render(<>
        {Array.from({ length: 10 }, (_, index) => (
          <TopicImageHarness
            key={index}
            attributes={{ alt: `复杂图片 ${index + 1}`, src: `https://img.example.com/complex-${index}.svg` }}
          />
        ))}
      </>);
      expect(nativeErrors).toHaveLength(10);

      await act(() => {
        nativeErrors.forEach((onError) => onError?.(new Error('native SVG failure'), jest.fn()));
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
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><animate attributeName="opacity" /></svg>';
    mockUseImageImplementation = (_source, options) => {
      mockImageLoadOptions = options as typeof mockImageLoadOptions;
      return null;
    };
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(svg, {
      headers: { 'content-type': 'image/svg+xml' }
    }));
    try {
      const screen = await render(<TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} />);

      await act(() => mockImageLoadOptions?.onError?.(new Error('native SVG failure'), jest.fn()));
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mockUseImage.mock.calls.filter(([source]) => source.uri?.startsWith('file://'))).toHaveLength(1));

      await act(() => mockImageLoadOptions?.onError?.(new Error('poster file was evicted'), jest.fn()));
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(mockUseImage.mock.calls.filter(([source]) => source.uri?.startsWith('file://'))).toHaveLength(2));

      const posterCalls = mockUseImage.mock.calls.filter(([source]) => source.uri?.startsWith('file://'));
      expect((posterCalls[0]?.[0] as { cacheKey?: string }).cacheKey)
        .not.toBe((posterCalls[1]?.[0] as { cacheKey?: string }).cacheKey);
      expect(posterCalls[0]?.[2]).not.toEqual(posterCalls[1]?.[2]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await act(() => mockImageLoadOptions?.onError?.(new Error('rebuilt poster still unreadable'), jest.fn()));
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
    mockUseImageImplementation = (_source, options) => {
      mockImageLoadOptions = options as typeof mockImageLoadOptions;
      return null;
    };
    const fetchSpy = jest.spyOn(global, 'fetch')
      .mockImplementationOnce(() => oldResponse)
      .mockResolvedValueOnce(new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }));
    try {
      const screen = await render(
        <TopicImageHarness
          attributes={{ alt: '测试图片', src: svgImageUrl }}
          mediaSessionIdentity="yaohuo:1"
        />
      );
      const oldError = mockImageLoadOptions?.onError;
      await act(() => oldError?.(new Error('old native SVG failure'), jest.fn()));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      await screen.rerender(
        <TopicImageHarness
          attributes={{ alt: '测试图片', src: svgImageUrl }}
          mediaSessionIdentity="yaohuo:2"
        />
      );
      await act(() => mockImageLoadOptions?.onError?.(new Error('current native SVG failure'), jest.fn()));
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mockUseImage.mock.calls.some(([source, , dependencies]) => (
        source.uri?.startsWith('file://') && String(dependencies?.[0] || '').includes('yaohuo:2')
      ))).toBe(true));

      await act(async () => {
        resolveOldResponse(new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }));
        await oldResponse;
      });
      await waitFor(() => expect(mockRenderSvgPoster).toHaveBeenCalledTimes(2));

      expect(mockUseImage.mock.calls.some(([source, , dependencies]) => (
        source.uri?.startsWith('file://') && String(dependencies?.[0] || '').includes('yaohuo:1')
      ))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('keeps inline emoji on the native inline renderer without starting the block loader', async () => {
    await render(<TopicImageHarness attributes={{
      alt: 'emoji',
      class: 'emoji',
      height: '24',
      src: 'https://img.example.com/emoji.png',
      width: '24'
    }} />);

    expect(mockUseImage).not.toHaveBeenCalled();
  });
});
