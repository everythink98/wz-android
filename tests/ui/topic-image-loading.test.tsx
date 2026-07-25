import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import { useHtmlRenderingController } from '../../src/app/useHtmlRenderingController';
import { ForumContentVideo } from '../../src/components/ForumContentVideo';
import { FORUM_VIDEO_TAG } from '../../src/localHtml';
import { createEmptyReaderData } from '../../src/readerData';
import { createStyles, createTheme } from '../../src/theme';
import type { TopicDetail } from '../../src/types';

const imageUrl = 'https://img.example.com/topic.png';
let mockImageRef: { height: number; width: number } | null = null;
let mockImageLoadOptions: { onError?: (error: Error, retry: () => void) => void } | undefined;
let mockSourceHeaders: Record<string, string> | undefined;
let mockUseImageImplementation: (source: { uri?: string }, options?: unknown, dependencies?: unknown[]) => typeof mockImageRef;
const mockExpoImageProps = jest.fn();
const mockUseImage = jest.fn((source: { uri?: string }, options?: unknown, dependencies?: unknown[]) => mockUseImageImplementation(source, options, dependencies));
const mockReadMediaCookieHeader = jest.fn<(url: string) => Promise<string>>();
const mockUseVideoPlayer = jest.fn((source: unknown) => ({
  pause: jest.fn(),
  play: jest.fn(),
  playing: false,
  source
}));

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

jest.mock('react-native-webview', () => ({ WebView: () => null }));

jest.mock('../../src/managedCookies', () => ({
  ...jest.requireActual<typeof import('../../src/managedCookies')>('../../src/managedCookies'),
  readMediaCookieHeader: (url: string) => mockReadMediaCookieHeader(url)
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
    mockReadMediaCookieHeader.mockReset();
    mockUseVideoPlayer.mockClear();
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
    mockUseImageImplementation = (source) => {
      const ReactModule = require('react') as typeof React;
      const [image, setImage] = ReactModule.useState(null as typeof mockImageRef);
      const cacheKey = String((source as { cacheKey?: string }).cacheKey || '');
      ReactModule.useEffect(() => {
        if (cacheKey.startsWith('yaohuo:1:')) {
          resolveEpochOne = setImage;
        } else if (cacheKey.startsWith('yaohuo:2:')) {
          resolveEpochTwo = setImage;
        }
      }, [cacheKey]);
      return image;
    };
    const screen = await render(<TopicImageHarness mediaSessionIdentity="yaohuo:1" />);

    await waitFor(() => expect(mockUseImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ cacheKey: `yaohuo:1:${imageUrl}`, uri: imageUrl }),
      expect.any(Object),
      expect.any(Array)
    ));
    await screen.rerender(<TopicImageHarness mediaSessionIdentity="yaohuo:2" />);
    await waitFor(() => expect(mockUseImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ cacheKey: `yaohuo:2:${imageUrl}`, uri: imageUrl }),
      expect.any(Object),
      expect.any(Array)
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

  it('[REG-ACCOUNT-029] ignores an old epoch Cookie result for the same video URL', async () => {
    const videoUrl = 'https://yaohuo.me/media/private-topic.mp4';
    const epochOneCookie = deferred<string>();
    const epochTwoCookie = deferred<string>();
    mockReadMediaCookieHeader
      .mockReturnValueOnce(epochOneCookie.promise)
      .mockReturnValueOnce(epochTwoCookie.promise);
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
    await waitFor(() => expect(mockReadMediaCookieHeader).toHaveBeenCalledTimes(1));
    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(null);

    await controller.rerender({ mediaSessionIdentity: 'yaohuo:2' });
    const secondRenderer = controller.result.current.htmlRenderers[FORUM_VIDEO_TAG] as unknown as (
      props: typeof videoProps
    ) => React.ReactElement<typeof ForumContentVideo>;
    const secondVideo = secondRenderer(videoProps);
    expect(secondVideo.key).toBe(`yaohuo:2:${videoUrl}`);
    await video.rerender(secondVideo);
    await waitFor(() => expect(mockReadMediaCookieHeader).toHaveBeenCalledTimes(2));

    await act(async () => {
      epochTwoCookie.resolve('session=B');
      await epochTwoCookie.promise;
    });
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Cookie: 'session=B' }),
      uri: videoUrl
    })));

    const callsAfterCurrentCookie = mockUseVideoPlayer.mock.calls.length;
    await act(async () => {
      epochOneCookie.resolve('session=A');
      await epochOneCookie.promise;
    });
    expect(mockUseVideoPlayer).toHaveBeenCalledTimes(callsAfterCurrentCookie);
    expect(mockUseVideoPlayer).not.toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({ Cookie: 'session=A' })
    }));
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
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('REG-TOPIC-018 recovers an SVG response whose png URL the Android decoder rejects', async () => {
    const svgImageUrl = 'https://img.example.com/dynamic-report.png';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="920" height="1025"><text><a href="https://example.com"><tspan>report</tspan></a></text></svg>';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? 'image/svg+xml; charset=utf-8' : null
      },
      ok: true,
      text: async () => svg
    } as Response);
    try {
      const screen = await render(<TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} />);

      await act(() => mockImageLoadOptions?.onError?.(new Error('Cannot load SVG from stream'), jest.fn()));

      await waitFor(() => expect(mockUseImage).toHaveBeenLastCalledWith(
        expect.objectContaining({ uri: expect.stringMatching(/^data:image\/svg\+xml;base64,/) }),
        expect.any(Object),
        expect.any(Array)
      ));
      const fallbackSource = mockUseImage.mock.calls.at(-1)?.[0];
      const encodedSvg = String(fallbackSource?.uri || '').split(',')[1] || '';
      expect(Buffer.from(encodedSvg, 'base64').toString('utf8')).toContain('<tspan>report</tspan>');
      expect(Buffer.from(encodedSvg, 'base64').toString('utf8')).not.toMatch(/<\/?a\b/i);
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
      expect(screen.queryByText('测试图片')).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
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
