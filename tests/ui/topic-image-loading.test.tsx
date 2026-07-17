import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { PixelRatio, StyleSheet } from 'react-native';
import { useHtmlRenderingController } from '../../src/app/useHtmlRenderingController';
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
  useVideoPlayer: () => ({ pause: jest.fn(), play: jest.fn(), playing: false })
}));

jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('../../src/components/ForumContentVideo', () => ({ ForumContentVideo: () => null }));

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

function TopicImageHarness({ attributes = { alt: '测试图片', src: imageUrl } }: { attributes?: Record<string, string> }) {
  const { htmlRenderers } = useHtmlRenderingController({
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
    const screen = await render(<TopicImageHarness />);

    await act(() => mockImageLoadOptions?.onError?.(new Error('decode failed'), jest.fn()));

    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
    expect(screen.getByText('测试图片')).toBeTruthy();
    expect(mockExpoImageProps).not.toHaveBeenCalled();
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
