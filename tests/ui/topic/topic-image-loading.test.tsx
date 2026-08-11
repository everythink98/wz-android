import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';
import { NativeModules, StyleSheet, Text } from 'react-native';
import { useHtmlRenderingController } from '@/features/topic/rendering/useHtmlRenderingController';
import { ForumContentVideo } from '@/ui/content/ForumContentVideo';
import { FORUM_LINK_CARD_TAG, FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG } from '@/domain/forum/html';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { createTheme } from '@/ui/theme/tokens';
import { createTestStyles as createStyles } from '../styleFixture';
import type { TopicDetail } from '@/domain/forum/models';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { FORUM_STICKER_ROW_TAG, FORUM_STICKER_TAG } from '@/domain/forum/forumContentMedia';
import {
  markOriginalImageDisplayed,
  OriginalImageUpgradeBoundary,
  useOriginalImageUpgradeEnabled
} from '@/platform/media/originalImageLoading';
import {
  getReadNetworkRuntimeSnapshot,
  publishReadNetworkRuntimeRotation
} from '@/platform/network/readNetworkRuntime';
import {
  TopicBodyMediaCoordinatorProvider,
  TopicBodyMediaRowBoundary,
  useTopicBodyMediaLease
} from '@/features/topic/media/TopicBodyMediaCoordinator';
import { ManagedTopicContentVideo } from '@/features/topic/media/ManagedTopicContentVideo';
import { TopicContentPresentationProvider } from '@/features/topic/rendering/TopicContentPresentation';

const imageUrl = 'https://img.example.com/topic.png';
let mockSourceHeaders: Record<string, string> | undefined;
const mockExpoImageProps = jest.fn();
const mockUseImage = jest.fn();
let mockVideoStatus = 'idle';
let mockVideoBufferedPosition = 0;
const mockUseVideoPlayer = jest.fn((source: unknown) => ({
  bufferedPosition: mockVideoBufferedPosition,
  pause: jest.fn(),
  play: jest.fn(),
  playing: false,
  status: mockVideoStatus,
  timeUpdateEventInterval: 0,
  source
}));
const mockRetainReadNetworkGeneration = jest.fn(async (generation: number) => ({ generation, retained: true }));
const mockReleaseReadNetworkGeneration = jest.fn(async (_generation: number) => true);
const mockRenderSvgPoster = jest.fn(async (_svgBase64: string, _cacheKey: string) => ({
  documentHeight: 1025,
  documentWidth: 920,
  height: 1025,
  uri: 'file:///cache/complex-svg-poster.png',
  width: 920
}));
const mockWebView = jest.fn((_props: unknown) => null);

type MockExpoImageProps = {
  allowDownscaling?: boolean;
  cachePolicy?: 'disk' | 'memory' | 'memory-disk' | 'none';
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
  style?: unknown;
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
  useEvent: jest.fn((_player, eventName, initialValue) =>
    eventName === 'statusChange'
      ? { status: mockVideoStatus }
      : eventName === 'timeUpdate'
        ? { bufferedPosition: mockVideoBufferedPosition, currentTime: 0 }
        : initialValue
  )
}));

jest.mock('expo-video', () => ({
  VideoView: () => null,
  useVideoPlayer: (source: unknown, setup?: (player: ReturnType<typeof mockUseVideoPlayer>) => void) => {
    const ReactModule = require('react') as typeof React;
    return ReactModule.useMemo(() => {
      const player = mockUseVideoPlayer(source);
      setup?.(player);
      return player;
    }, [setup, source]);
  }
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
  continuation = 'only',
  mediaSessionIdentity,
  onOpenImagePreview = noop,
  originalImageUpgradeEnabled = true,
  topicSource = 'yaohuo'
}: {
  attributes?: Record<string, string>;
  continuation?: 'only' | 'first' | 'middle' | 'last';
  mediaSessionIdentity?: string;
  onOpenImagePreview?: (url: string, displaySize?: { height: number; width: number }, displayedUri?: string) => void;
  originalImageUpgradeEnabled?: boolean;
  topicSource?: TopicDetail['source'];
}) {
  const selectedTopic =
    topicSource === topic.source
      ? topic
      : {
          ...topic,
          source: topicSource,
          url: topicSource === 'nodeseek' ? 'https://www.nodeseek.com/post-859086-1' : 'https://linux.do/t/123'
        };
  const resolvedMediaSessionIdentity = mediaSessionIdentity || `${topicSource}:2`;
  const { htmlRenderers } = useHtmlRenderingController({
    mediaSessionIdentity: resolvedMediaSessionIdentity,
    onOpenExternalUrl: noop,
    onOpenImagePreview,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic,
    settings: readerData.settings,
    theme,
    topicDetail: selectedTopic,
    topicKey: `${topicSource}:image-topic`,
    webViewBlockMessage: ''
  });
  const ImageRenderer = htmlRenderers.img as unknown as React.ComponentType<Record<string, unknown>> | undefined;
  return ImageRenderer ? (
    <TopicContentPresentationProvider continuation={continuation}>
      <OriginalImageUpgradeBoundary enabled={originalImageUpgradeEnabled}>
        {React.createElement(ImageRenderer, {
          tnode: {
            attributes
          }
        } as never)}
      </OriginalImageUpgradeBoundary>
    </TopicContentPresentationProvider>
  ) : null;
}

function NodeSeekVideoStickerHarness() {
  const videoUrl = 'https://www.nodeseek.com/static/image/sticker/emoji/13.webm';
  const fallbackUrl = 'https://www.nodeseek.com/static/image/sticker/emoji/13.png';
  const nodeSeekTopic: TopicDetail = {
    ...topic,
    id: '859086',
    source: 'nodeseek',
    url: 'https://www.nodeseek.com/post-859086-1'
  };
  const { htmlRenderers } = useHtmlRenderingController({
    mediaSessionIdentity: 'nodeseek:4',
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic: nodeSeekTopic,
    settings: readerData.settings,
    theme,
    topicDetail: nodeSeekTopic,
    topicKey: 'nodeseek:859086',
    webViewBlockMessage: ''
  });
  const Renderer = htmlRenderers[FORUM_VIDEO_STICKER_TAG] as unknown as
    React.ComponentType<Record<string, unknown>> | undefined;
  return Renderer
    ? React.createElement(Renderer, {
        tnode: {
          attributes: {
            alt: 'sticker',
            'data-fallback-src': fallbackUrl,
            height: '100',
            src: videoUrl,
            width: '100'
          }
        }
      } as never)
    : null;
}

function NodeSeekImageStickerHarness({ src }: { src: string }) {
  const nodeSeekTopic: TopicDetail = {
    ...topic,
    id: '859086',
    source: 'nodeseek',
    url: 'https://www.nodeseek.com/post-859086-1'
  };
  const { htmlRenderers } = useHtmlRenderingController({
    mediaSessionIdentity: 'nodeseek:4',
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic: nodeSeekTopic,
    settings: readerData.settings,
    theme,
    topicDetail: nodeSeekTopic,
    topicKey: 'nodeseek:859086',
    webViewBlockMessage: ''
  });
  const Renderer = htmlRenderers[FORUM_STICKER_TAG] as unknown as
    React.ComponentType<Record<string, unknown>> | undefined;
  return Renderer
    ? React.createElement(Renderer, {
        tnode: {
          attributes: {
            alt: 'sticker',
            class: 'sticker',
            src
          }
        }
      } as never)
    : null;
}

function NodeSeekCustomMediaHarness({
  attributes,
  rendererKey,
  webViewBlockMessage = ''
}: {
  attributes: Record<string, string>;
  rendererKey: string;
  webViewBlockMessage?: string;
}) {
  const nodeSeekTopic: TopicDetail = {
    ...topic,
    id: '859086',
    source: 'nodeseek',
    url: 'https://www.nodeseek.com/post-859086-1'
  };
  const { htmlRenderers } = useHtmlRenderingController({
    mediaSessionIdentity: 'nodeseek:4',
    onOpenExternalUrl: noop,
    onOpenImagePreview: noop,
    onOpenTopic: noop,
    onOpenUser: noop,
    selectedTopic: nodeSeekTopic,
    settings: readerData.settings,
    theme,
    topicDetail: nodeSeekTopic,
    topicKey: 'nodeseek:859086',
    webViewBlockMessage
  });
  const Renderer = htmlRenderers[rendererKey] as unknown as React.ComponentType<Record<string, unknown>> | undefined;
  return Renderer ? React.createElement(Renderer, { tnode: { attributes } } as never) : null;
}

function MediaLeaseBlocker({ id }: { id: string }) {
  const lease = useTopicBodyMediaLease({ kind: 'poster', requestIdentity: `test-blocker:${id}` });
  return <Text testID={`media-blocker-${id}`}>{lease.admitted ? 'running' : 'waiting'}</Text>;
}

function ThreeMediaLeaseBlockers() {
  return (
    <>
      <MediaLeaseBlocker id="one" />
      <MediaLeaseBlocker id="two" />
      <MediaLeaseBlocker id="three" />
    </>
  );
}

function FourMediaLeaseBlockers() {
  return (
    <>
      <ThreeMediaLeaseBlockers />
      <MediaLeaseBlocker id="four" />
    </>
  );
}

const nodeSeekVideoMediaContext = { contentSource: 'nodeseek' as const, sessionIdentity: 'nodeseek:video-test' };

function CoordinatedVideoHarness({ src }: { src: string }) {
  return (
    <ManagedTopicContentVideo
      mediaContext={nodeSeekVideoMediaContext}
      mediaSessionIdentity={nodeSeekVideoMediaContext.sessionIdentity}
      src={src}
      theme={theme}
    />
  );
}

const linkCardIconUrl = 'https://img.example.com/link-icon.png';
const linkCardThumbnailUrl = 'https://img.example.com/link-thumbnail.png';
const trailingStickerUrl = 'https://img.example.com/trailing-sticker.png';
const secondStickerUrl = 'https://img.example.com/second-sticker.png';
const firstBilibiliIframeUrl = 'https://player.bilibili.com/player.html?aid=1';
const secondBilibiliIframeUrl = 'https://player.bilibili.com/player.html?aid=2';

function NodeSeekLinkCardHarness() {
  return (
    <NodeSeekCustomMediaHarness
      rendererKey={FORUM_LINK_CARD_TAG}
      attributes={{
        description: 'card description',
        href: 'https://example.com/article',
        'icon-src': linkCardIconUrl,
        'image-src': linkCardThumbnailUrl,
        site: 'example.com',
        title: 'card title'
      }}
    />
  );
}

function NodeSeekIframeHarness({
  src = firstBilibiliIframeUrl,
  webViewBlockMessage
}: {
  src?: string;
  webViewBlockMessage?: string;
}) {
  return (
    <NodeSeekCustomMediaHarness rendererKey="iframe" attributes={{ src }} webViewBlockMessage={webViewBlockMessage} />
  );
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
    mockVideoStatus = 'idle';
    mockVideoBufferedPosition = 0;
    mockRetainReadNetworkGeneration.mockClear();
    mockReleaseReadNetworkGeneration.mockClear();
    mockRenderSvgPoster.mockClear();
    mockWebView.mockClear();
    NativeModules.SvgRendererModule = {
      fetchSvgDocument: mockFetchSvgDocument,
      renderPoster: mockRenderSvgPoster
    };
    NativeModules.NetworkProxyModule = {
      retainReadNetworkGeneration: mockRetainReadNetworkGeneration,
      releaseReadNetworkGeneration: mockReleaseReadNetworkGeneration
    };
  });

  it('[REG-PERF-010] does not create an Expo Image source before the route coordinator grants a permit', async () => {
    await render(
      <TopicBodyMediaCoordinatorProvider active paused viewportRowKeys={['opening-row']}>
        <TopicBodyMediaRowBoundary rowKey="opening-row">
          <TopicImageHarness />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    expect(mockExpoImageProps).not.toHaveBeenCalled();
  });

  it('[REG-PERF-010] removes both outer image margins for a middle continuation row', async () => {
    const view = await render(<TopicImageHarness continuation="middle" />);

    expect(view.getByLabelText('测试图片')).toHaveStyle({ marginBottom: 0, marginTop: 0 });
  });

  it('[REG-PERF-010] keeps stickers, link-card art, and iframe browsers unmounted while their row is paused', async () => {
    await render(
      <TopicBodyMediaCoordinatorProvider active paused viewportRowKeys={['special-media-row']}>
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <NodeSeekImageStickerHarness src={trailingStickerUrl} />
          <NodeSeekLinkCardHarness />
          <NodeSeekVideoStickerHarness />
          <NodeSeekIframeHarness />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    expect(mockExpoImageProps).not.toHaveBeenCalled();
    expect(mockWebView).not.toHaveBeenCalled();
  });

  it('[REG-PROXY-001] renders the proxy block message instead of mounting an iframe WebView', async () => {
    const view = await render(<NodeSeekIframeHarness webViewBlockMessage="代理状态切换中" />);

    expect(view.getByText('代理状态切换中')).toBeTruthy();
    expect(mockWebView).not.toHaveBeenCalled();
  });

  it('[REG-PERF-010] removes continuation margins from every custom block-media frame', async () => {
    const videoUrl = 'https://cdn.example.com/boundary-video.mp4';
    const view = await render(
      <TopicContentPresentationProvider continuation="middle">
        <NodeSeekLinkCardHarness />
        <NodeSeekIframeHarness />
        <NodeSeekCustomMediaHarness rendererKey={FORUM_STICKER_ROW_TAG} attributes={{}} />
        <NodeSeekCustomMediaHarness rendererKey={FORUM_VIDEO_TAG} attributes={{ src: videoUrl }} />
      </TopicContentPresentationProvider>
    );

    expect(view.getByRole('link', { name: 'card title' })).toHaveStyle({ marginBottom: 0, marginTop: 0 });
    expect(view.getByTestId('topic-video-embed-frame')).toHaveStyle({ marginBottom: 0, marginTop: 0 });
    expect(view.getByTestId('forum-sticker-row')).toHaveStyle({ marginBottom: 0, marginTop: 0 });
    await waitFor(() =>
      expect(view.getByTestId('forum-content-video-frame')).toHaveStyle({ marginBottom: 0, marginTop: 0 })
    );
  });

  it('[REG-PERF-010] does not let whitespace-only art consume the remaining media permit', async () => {
    await render(
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['special-media-row']}>
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <ThreeMediaLeaseBlockers />
          {[' ', '\t', '\n', ' \t '].map((src, index) => (
            <NodeSeekCustomMediaHarness
              key={`blank-art-${index}`}
              rendererKey={FORUM_STICKER_TAG}
              attributes={{ alt: 'blank art', src }}
            />
          ))}
          <NodeSeekImageStickerHarness src={trailingStickerUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    await waitFor(() => expect(latestImageProps(trailingStickerUrl)).toBeTruthy());
  });

  it('[REG-PERF-010] gives link-card icon, thumbnail, and sticker independent image leases', async () => {
    await render(
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['special-media-row']}>
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <ThreeMediaLeaseBlockers />
          <NodeSeekLinkCardHarness />
          <NodeSeekImageStickerHarness src={trailingStickerUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    await waitFor(() => expect(latestImageProps(linkCardIconUrl)).toBeTruthy());
    expect(
      mockExpoImageProps.mock.calls.some(
        ([props]) => (props as MockExpoImageProps).source?.uri === linkCardThumbnailUrl
      )
    ).toBe(false);
    expect(
      mockExpoImageProps.mock.calls.some(([props]) => (props as MockExpoImageProps).source?.uri === trailingStickerUrl)
    ).toBe(false);
    const icon = latestImageProps(linkCardIconUrl);
    expect(icon).toEqual(
      expect.objectContaining({
        allowDownscaling: true,
        cachePolicy: 'disk',
        recyclingKey: expect.stringContaining(`nodeseek:4:${linkCardIconUrl}`)
      })
    );

    await act(() => icon.onDisplay?.());
    await waitFor(() => expect(latestImageProps(linkCardThumbnailUrl)).toBeTruthy());
    const thumbnail = latestImageProps(linkCardThumbnailUrl);
    expect(thumbnail).toEqual(
      expect.objectContaining({
        allowDownscaling: true,
        cachePolicy: 'disk',
        recyclingKey: expect.stringContaining(`nodeseek:4:${linkCardThumbnailUrl}`)
      })
    );
    expect(latestImageProps(linkCardIconUrl).recyclingKey).toBe(icon.recyclingKey);

    await act(() => thumbnail.onError?.({ error: 'thumbnail failed' }));
    await waitFor(() => expect(latestImageProps(linkCardThumbnailUrl).recyclingKey).not.toBe(thumbnail.recyclingKey));
    const retriedThumbnail = latestImageProps(linkCardThumbnailUrl);
    await act(() => retriedThumbnail.onError?.({ error: 'thumbnail retry failed' }));
    await waitFor(() => expect(latestImageProps(trailingStickerUrl)).toBeTruthy());
    expect(latestImageProps(trailingStickerUrl)).toEqual(
      expect.objectContaining({ allowDownscaling: true, cachePolicy: 'disk' })
    );
  });

  it('[REG-PERF-010] releases an admitted sticker lease when that renderer unmounts', async () => {
    const tree = (showFirst: boolean) => (
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['special-media-row']}>
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <ThreeMediaLeaseBlockers />
          {showFirst ? (
            <NodeSeekCustomMediaHarness
              key="first-sticker"
              rendererKey={FORUM_STICKER_TAG}
              attributes={{ alt: 'first sticker', src: trailingStickerUrl }}
            />
          ) : null}
          <NodeSeekCustomMediaHarness
            key="second-sticker"
            rendererKey={FORUM_STICKER_TAG}
            attributes={{ alt: 'second sticker', src: secondStickerUrl }}
          />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const screen = await render(tree(true));

    await waitFor(() => expect(latestImageProps(trailingStickerUrl)).toBeTruthy());
    expect(
      mockExpoImageProps.mock.calls.some(([props]) => (props as MockExpoImageProps).source?.uri === secondStickerUrl)
    ).toBe(false);

    await screen.rerender(tree(false));
    await waitFor(() => expect(latestImageProps(secondStickerUrl)).toBeTruthy());
  });

  it('[REG-PERF-010] settles video-sticker readiness and iframe load before admitting the next resource', async () => {
    const fallbackUrl = 'https://www.nodeseek.com/static/image/sticker/emoji/13.png';
    await render(
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['special-media-row']}>
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <ThreeMediaLeaseBlockers />
          <NodeSeekVideoStickerHarness />
          <NodeSeekIframeHarness />
          <NodeSeekImageStickerHarness src={trailingStickerUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    await waitFor(() => expect(latestImageProps(fallbackUrl)).toBeTruthy());
    expect(mockWebView).not.toHaveBeenCalled();
    await act(() => latestImageProps(fallbackUrl).onDisplay?.());
    await waitFor(() =>
      expect(
        mockWebView.mock.calls.some(
          ([props]) => typeof (props as { source?: { html?: unknown } }).source?.html === 'string'
        )
      ).toBe(true)
    );
    const videoStickerWebView = mockWebView.mock.calls
      .map(
        ([props]) =>
          props as {
            onMessage?: (event: { nativeEvent: { data: string } }) => void;
            source?: { html?: string };
          }
      )
      .find((props) => typeof props.source?.html === 'string')!;

    await act(() => videoStickerWebView.onMessage?.({ nativeEvent: { data: 'wz-video-sticker-ready' } }));
    await waitFor(() =>
      expect(
        mockWebView.mock.calls.some(([props]) =>
          String((props as { source?: { uri?: string } }).source?.uri || '').includes('aid=1')
        )
      ).toBe(true)
    );
    const iframeWebView = mockWebView.mock.calls
      .map(([props]) => props as { onLoad?: () => void; source?: { uri?: string } })
      .find((props) => String(props.source?.uri || '').includes('aid=1'))!;
    expect(
      mockExpoImageProps.mock.calls.some(([props]) => (props as MockExpoImageProps).source?.uri === trailingStickerUrl)
    ).toBe(false);

    await act(() => iframeWebView.onLoad?.());
    await waitFor(() => expect(latestImageProps(trailingStickerUrl)).toBeTruthy());
  });

  it('[REG-PERF-010] keeps a progressing video-sticker bootstrap alive beyond sixty seconds', async () => {
    const fallbackUrl = 'https://www.nodeseek.com/static/image/sticker/emoji/13.png';
    const onDiagnosticFinish = jest.fn((_aggregate: unknown) => undefined);
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    try {
      const screen = await render(
        <TopicBodyMediaCoordinatorProvider
          active
          diagnosticSession={{
            networkMediaCount: 2,
            plannedRowCount: 1,
            source: 'nodeseek',
            topicRef: 'topic-video-sticker-buffering'
          }}
          onDiagnosticFinish={onDiagnosticFinish}
          paused={false}
          viewportRowKeys={['special-media-row']}
        >
          <TopicBodyMediaRowBoundary rowKey="special-media-row">
            <NodeSeekVideoStickerHarness />
          </TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      await waitFor(() => expect(latestImageProps(fallbackUrl)).toBeTruthy());
      await act(() => latestImageProps(fallbackUrl).onDisplay?.());
      const latestVideoSticker = () =>
        mockWebView.mock.calls
          .map(
            ([props]) =>
              props as {
                onMessage?: (event: { nativeEvent: { data: string } }) => void;
                source?: { html?: string };
              }
          )
          .filter((props) => typeof props.source?.html === 'string')
          .at(-1)!;
      await waitFor(() => expect(latestVideoSticker()).toBeTruthy());
      expect(latestVideoSticker().source?.html).toContain("video.addEventListener('progress'");
      expect(latestVideoSticker().source?.html).toContain("video.addEventListener('loadedmetadata'");
      expect(latestVideoSticker().source?.html).toContain('wz-video-sticker-progress');

      for (let index = 0; index < 4; index += 1) {
        await act(async () => {
          jest.advanceTimersByTime(20_000);
        });
        await act(() =>
          latestVideoSticker().onMessage?.({ nativeEvent: { data: `wz-video-sticker-progress:${index + 1}` } })
        );
      }

      await screen.unmount();
      expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
      expect(onDiagnosticFinish).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: 0, timeoutCount: 0, timerHighWater: 1 })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-PERF-010] remounts a failed video sticker once before releasing its slot', async () => {
    const fallbackUrl = 'https://www.nodeseek.com/static/image/sticker/emoji/13.png';
    await render(
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['special-media-row']}>
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <ThreeMediaLeaseBlockers />
          <NodeSeekVideoStickerHarness />
          <NodeSeekImageStickerHarness src={trailingStickerUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    await waitFor(() => expect(latestImageProps(fallbackUrl)).toBeTruthy());
    await act(() => latestImageProps(fallbackUrl).onDisplay?.());
    await waitFor(() =>
      expect(
        mockWebView.mock.calls.filter(
          ([props]) => typeof (props as { source?: { html?: unknown } }).source?.html === 'string'
        )
      ).toHaveLength(1)
    );
    const firstVideoSticker = mockWebView.mock.calls
      .map(([props]) => props as { onError?: (event: unknown) => void; source?: { html?: string }; testID?: string })
      .find((props) => typeof props.source?.html === 'string')!;
    expect(
      mockExpoImageProps.mock.calls.some(([props]) => (props as MockExpoImageProps).source?.uri === trailingStickerUrl)
    ).toBe(false);

    await act(() => firstVideoSticker.onError?.({ nativeEvent: {} }));
    await waitFor(() =>
      expect(
        mockWebView.mock.calls.filter(
          ([props]) => typeof (props as { source?: { html?: unknown } }).source?.html === 'string'
        )
      ).toHaveLength(2)
    );
    const retriedVideoSticker = mockWebView.mock.calls
      .map(([props]) => props as { onError?: (event: unknown) => void; source?: { html?: string }; testID?: string })
      .filter((props) => typeof props.source?.html === 'string')
      .at(-1)!;
    expect(retriedVideoSticker.testID).not.toBe(firstVideoSticker.testID);
    expect(
      mockExpoImageProps.mock.calls.some(([props]) => (props as MockExpoImageProps).source?.uri === trailingStickerUrl)
    ).toBe(false);

    await act(() => retriedVideoSticker.onError?.({ nativeEvent: {} }));
    await waitFor(() => expect(latestImageProps(trailingStickerUrl)).toBeTruthy());
  });

  it('[REG-PERF-010] settles an iframe error before admitting a second iframe', async () => {
    await render(
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['special-media-row']}>
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <ThreeMediaLeaseBlockers />
          <NodeSeekIframeHarness src={firstBilibiliIframeUrl} />
          <NodeSeekIframeHarness src={secondBilibiliIframeUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    await waitFor(() =>
      expect(
        mockWebView.mock.calls.some(([props]) =>
          String((props as { source?: { uri?: string } }).source?.uri || '').includes('aid=1')
        )
      ).toBe(true)
    );
    expect(
      mockWebView.mock.calls.some(([props]) =>
        String((props as { source?: { uri?: string } }).source?.uri || '').includes('aid=2')
      )
    ).toBe(false);
    const firstIframe = mockWebView.mock.calls
      .map(([props]) => props as { onError?: (event: unknown) => void; source?: { uri?: string } })
      .find((props) => String(props.source?.uri || '').includes('aid=1'))!;

    await act(() => firstIframe.onError?.({ nativeEvent: {} }));
    await waitFor(() =>
      expect(
        mockWebView.mock.calls.filter(([props]) =>
          String((props as { source?: { uri?: string } }).source?.uri || '').includes('aid=1')
        )
      ).toHaveLength(2)
    );
    const retriedFirstIframe = mockWebView.mock.calls
      .map(([props]) => props as { onError?: (event: unknown) => void; source?: { uri?: string } })
      .filter((props) => String(props.source?.uri || '').includes('aid=1'))
      .at(-1)!;
    await act(() => retriedFirstIframe.onError?.({ nativeEvent: {} }));
    await waitFor(() =>
      expect(
        mockWebView.mock.calls.some(([props]) =>
          String((props as { source?: { uri?: string } }).source?.uri || '').includes('aid=2')
        )
      ).toBe(true)
    );
  });

  it('[REG-PERF-010] does not retain a native generation or create a video player while its row is paused', async () => {
    await render(
      <TopicBodyMediaCoordinatorProvider active paused viewportRowKeys={['video-row']}>
        <TopicBodyMediaRowBoundary rowKey="video-row">
          <NodeSeekCustomMediaHarness
            rendererKey={FORUM_VIDEO_TAG}
            attributes={{ src: 'https://cdn.example.com/paused-video.mp4' }}
          />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    expect(mockRetainReadNetworkGeneration).not.toHaveBeenCalled();
    expect(mockUseVideoPlayer).not.toHaveBeenCalled();
  });

  it('[REG-PERF-010] retains the exact native generation and creates a player only after video admission', async () => {
    const videoUrl = 'https://cdn.example.com/admitted-video.mp4';
    const tree = (blocked: boolean) => (
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['video-row']}>
        <TopicBodyMediaRowBoundary rowKey="video-row">
          {blocked ? <FourMediaLeaseBlockers /> : <ThreeMediaLeaseBlockers />}
          <NodeSeekCustomMediaHarness rendererKey={FORUM_VIDEO_TAG} attributes={{ src: videoUrl }} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const screen = await render(tree(true));

    expect(mockRetainReadNetworkGeneration).not.toHaveBeenCalled();
    expect(mockUseVideoPlayer).not.toHaveBeenCalled();

    await screen.rerender(tree(false));
    const generation = getReadNetworkRuntimeSnapshot().generation;
    await waitFor(() => expect(mockRetainReadNetworkGeneration).toHaveBeenCalledWith(generation));
    await waitFor(() =>
      expect(mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === videoUrl)).toBe(true)
    );
    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-WZ-Read-Network-Generation': String(generation) }),
        uri: videoUrl
      })
    );
  });

  it('[REG-PERF-010] reports native video progress only when the buffered position advances', async () => {
    const progress = jest.fn();
    const admission = {
      admitted: true,
      attemptId: 'video-progress:1',
      failure: null,
      progress,
      retry: jest.fn(),
      settle: jest.fn()
    } as const;
    mockVideoStatus = 'loading';
    const tree = () => (
      <ForumContentVideo
        admission={admission}
        mediaContext={nodeSeekVideoMediaContext}
        src="https://cdn.example.com/progress-video.mp4"
        theme={theme}
      />
    );
    const screen = await render(tree());
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(1));

    expect(mockUseVideoPlayer.mock.results[0]?.value).toEqual(expect.objectContaining({ timeUpdateEventInterval: 1 }));
    expect(progress).not.toHaveBeenCalled();

    mockVideoBufferedPosition = 1;
    await screen.rerender(tree());
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenLastCalledWith(1);

    await screen.rerender(tree());
    mockVideoBufferedPosition = 0.5;
    await screen.rerender(tree());
    expect(progress).toHaveBeenCalledTimes(1);

    mockVideoBufferedPosition = 2;
    await screen.rerender(tree());
    expect(progress).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(2);
  });

  it('[REG-PERF-010] keeps a continuously buffering native video alive beyond sixty seconds', async () => {
    const videoUrl = 'https://cdn.example.com/long-buffering-video.mp4';
    const onDiagnosticFinish = jest.fn((_aggregate: unknown) => undefined);
    mockVideoStatus = 'loading';
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    const tree = () => (
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-video-buffering'
        }}
        onDiagnosticFinish={onDiagnosticFinish}
        paused={false}
        viewportRowKeys={['video-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="video-row">
          <CoordinatedVideoHarness src={videoUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    try {
      const screen = await render(tree());
      await waitFor(() =>
        expect(mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === videoUrl)).toBe(
          true
        )
      );

      for (const bufferedPosition of [1, 2, 3, 4]) {
        await act(async () => {
          jest.advanceTimersByTime(20_000);
        });
        mockVideoBufferedPosition = bufferedPosition;
        await screen.rerender(tree());
      }

      await screen.unmount();
      expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
      expect(onDiagnosticFinish).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: 0, timeoutCount: 0, timerHighWater: 1 })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it.each(['readyToPlay', 'error'] as const)(
    '[REG-PERF-010] settles %s before admitting the next body video',
    async (settledStatus) => {
      const firstVideoUrl = `https://cdn.example.com/${settledStatus}-first.mp4`;
      const secondVideoUrl = `https://cdn.example.com/${settledStatus}-second.mp4`;
      const tree = () => (
        <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['video-row']}>
          <TopicBodyMediaRowBoundary rowKey="video-row">
            <ThreeMediaLeaseBlockers />
            <NodeSeekCustomMediaHarness
              key="first-video"
              rendererKey={FORUM_VIDEO_TAG}
              attributes={{ src: firstVideoUrl }}
            />
            <NodeSeekCustomMediaHarness
              key="second-video"
              rendererKey={FORUM_VIDEO_TAG}
              attributes={{ src: secondVideoUrl }}
            />
          </TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      const screen = await render(tree());

      await waitFor(() =>
        expect(
          mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === firstVideoUrl)
        ).toBe(true)
      );
      expect(
        mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === secondVideoUrl)
      ).toBe(false);

      mockVideoStatus = settledStatus;
      await screen.rerender(tree());
      await waitFor(() =>
        expect(
          mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === secondVideoUrl)
        ).toBe(true)
      );
    }
  );

  it('[REG-PERF-010] releases a loading video admission and its exact generation when it unmounts', async () => {
    const firstVideoUrl = 'https://cdn.example.com/unmounted-first.mp4';
    const secondVideoUrl = 'https://cdn.example.com/unmounted-second.mp4';
    const tree = (showFirst: boolean) => (
      <TopicBodyMediaCoordinatorProvider active paused={false} viewportRowKeys={['video-row']}>
        <TopicBodyMediaRowBoundary rowKey="video-row">
          <ThreeMediaLeaseBlockers />
          {showFirst ? (
            <NodeSeekCustomMediaHarness
              key="first-video"
              rendererKey={FORUM_VIDEO_TAG}
              attributes={{ src: firstVideoUrl }}
            />
          ) : null}
          <NodeSeekCustomMediaHarness
            key="second-video"
            rendererKey={FORUM_VIDEO_TAG}
            attributes={{ src: secondVideoUrl }}
          />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const screen = await render(tree(true));
    const generation = getReadNetworkRuntimeSnapshot().generation;

    await waitFor(() =>
      expect(mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === firstVideoUrl)).toBe(
        true
      )
    );
    expect(mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === secondVideoUrl)).toBe(
      false
    );

    await screen.rerender(tree(false));
    await waitFor(() => expect(mockReleaseReadNetworkGeneration).toHaveBeenCalledWith(generation));
    await waitFor(() =>
      expect(
        mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === secondVideoUrl)
      ).toBe(true)
    );
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

  it('[REG-TOPIC-064] gives an unknown host the owning forum profile in the native image view', async () => {
    await render(<TopicImageHarness />);

    expect(mockUseImage).not.toHaveBeenCalled();
    expect(mockExpoImageProps).toHaveBeenCalledWith(
      expect.objectContaining({
        cachePolicy: 'disk',
        priority: 'normal',
        source: expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
            'Accept-Language': expect.any(String),
            Referer: 'https://www.yaohuo.me/',
            'X-WZ-Forum-Media-Source': 'yaohuo'
          }),
          uri: imageUrl
        })
      })
    );
  });

  it('[REG-PROXY-010] remounts a same-source loading body image once on runtime rotation', async () => {
    const view = await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-body-runtime-remount'
        }}
        paused={false}
        viewportRowKeys={['body-image-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="body-image-row">
          <TopicImageHarness topicSource="nodeseek" />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const firstImage = latestImageProps(imageUrl);
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    const retriedImage = latestImageProps(imageUrl);
    expect(retriedImage.recyclingKey).not.toBe(firstImage.recyclingKey);
    await loadAndDisplayImage(firstImage, { height: 600, width: 400 });
    expect(view.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
    await loadAndDisplayImage(retriedImage, { height: 600, width: 400 });
    expect(view.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
  });

  it('[REG-PROXY-010] resets the loading body-image deadline before a runtime rotation remount', async () => {
    const onDiagnosticFinish = jest.fn((_aggregate: unknown) => undefined);
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    try {
      const screen = await render(
        <TopicBodyMediaCoordinatorProvider
          active
          diagnosticSession={{
            networkMediaCount: 1,
            plannedRowCount: 1,
            source: 'nodeseek',
            topicRef: 'topic-body-runtime-deadline'
          }}
          onDiagnosticFinish={onDiagnosticFinish}
          paused={false}
          viewportRowKeys={['body-image-row']}
        >
          <TopicBodyMediaRowBoundary rowKey="body-image-row">
            <TopicImageHarness topicSource="nodeseek" />
          </TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      const firstImage = latestImageProps(imageUrl);
      await act(async () => {
        jest.advanceTimersByTime(29_900);
      });
      const before = getReadNetworkRuntimeSnapshot();

      await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

      expect(latestImageProps(imageUrl).recyclingKey).not.toBe(firstImage.recyclingKey);
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await screen.unmount();
      expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
      expect(onDiagnosticFinish).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 0, timeoutCount: 0 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-PROXY-010] keeps an already displayed body image mounted across runtime rotation', async () => {
    const view = await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-body-runtime-displayed'
        }}
        paused={false}
        viewportRowKeys={['body-image-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="body-image-row">
          <TopicImageHarness topicSource="nodeseek" />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const displayedImage = latestImageProps(imageUrl);
    await loadAndDisplayImage(displayedImage);
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(latestImageProps(imageUrl).recyclingKey).toBe(displayedImage.recyclingKey);
    expect(view.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
  });

  it('[REG-PROXY-010] retries only the still-loading original upgrade layer', async () => {
    const displayUrl = 'https://cdn.example.com/runtime-display.png';
    const originalUrl = 'https://cdn.example.com/runtime-original.png';
    await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 2,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-original-runtime-remount'
        }}
        paused={false}
        viewportRowKeys={['original-image-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="original-image-row">
          <TopicImageHarness
            attributes={{ alt: '运行时轮换图片', 'data-original': originalUrl, src: displayUrl }}
            topicSource="nodeseek"
          />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const displayImage = latestImageProps(displayUrl);
    await loadAndDisplayImage(displayImage);
    const firstOriginal = latestImageProps(originalUrl);
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    const retriedOriginal = latestImageProps(originalUrl);
    expect(latestImageProps(displayUrl).recyclingKey).toBe(displayImage.recyclingKey);
    expect(retriedOriginal.recyclingKey).not.toBe(firstOriginal.recyclingKey);
    await act(() => firstOriginal.onError?.({ error: 'stale old generation' }));
    expect(latestImageProps(originalUrl).recyclingKey).toBe(retriedOriginal.recyclingKey);
  });

  it('[REG-PROXY-010] resets the loading original-image deadline before a runtime rotation remount', async () => {
    const displayUrl = 'https://cdn.example.com/runtime-deadline-display.png';
    const originalUrl = 'https://cdn.example.com/runtime-deadline-original.png';
    const onDiagnosticFinish = jest.fn((_aggregate: unknown) => undefined);
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    try {
      const screen = await render(
        <TopicBodyMediaCoordinatorProvider
          active
          diagnosticSession={{
            networkMediaCount: 2,
            plannedRowCount: 1,
            source: 'nodeseek',
            topicRef: 'topic-original-runtime-deadline'
          }}
          onDiagnosticFinish={onDiagnosticFinish}
          paused={false}
          viewportRowKeys={['original-image-row']}
        >
          <TopicBodyMediaRowBoundary rowKey="original-image-row">
            <TopicImageHarness
              attributes={{ alt: '运行时轮换原图', 'data-original': originalUrl, src: displayUrl }}
              topicSource="nodeseek"
            />
          </TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      await loadAndDisplayImage(latestImageProps(displayUrl));
      const firstOriginal = latestImageProps(originalUrl);
      await act(async () => {
        jest.advanceTimersByTime(29_900);
      });
      const before = getReadNetworkRuntimeSnapshot();

      await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

      expect(latestImageProps(originalUrl).recyclingKey).not.toBe(firstOriginal.recyclingKey);
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await screen.unmount();
      expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
      expect(onDiagnosticFinish).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 0, timeoutCount: 0 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-PERF-010] does not let runtime rotation bypass an exhausted original-image retry budget', async () => {
    const displayUrl = 'https://cdn.example.com/failed-runtime-display.png';
    const originalUrl = 'https://cdn.example.com/failed-runtime-original.png';
    const view = await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 2,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-original-runtime-exhausted'
        }}
        paused={false}
        viewportRowKeys={['failed-original-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="failed-original-row">
          <TopicImageHarness
            attributes={{ alt: '失败原图', 'data-original': originalUrl, src: displayUrl }}
            topicSource="nodeseek"
          />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    await loadAndDisplayImage(latestImageProps(displayUrl));
    const firstOriginal = latestImageProps(originalUrl);
    await act(() => firstOriginal.onError?.({ error: 'first original failure' }));
    const retriedOriginal = latestImageProps(originalUrl);
    expect(retriedOriginal.recyclingKey).not.toBe(firstOriginal.recyclingKey);
    await act(() => retriedOriginal.onError?.({ error: 'second original failure' }));
    expect(view.queryByTestId('topic-image-original')).toBeNull();
    const originalRenderCount = mockExpoImageProps.mock.calls.filter(
      ([props]) => (props as MockExpoImageProps).source?.uri === originalUrl
    ).length;
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    expect(
      mockExpoImageProps.mock.calls.filter(([props]) => (props as MockExpoImageProps).source?.uri === originalUrl)
    ).toHaveLength(originalRenderCount);
    expect(view.queryByTestId('topic-image-original')).toBeNull();
  });

  it('[REG-PROXY-010] remounts the bounded inline, sticker, and link-card working set on runtime rotation', async () => {
    const inlineUrl = 'https://img.example.com/runtime-inline.png';
    await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 5,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-special-media-runtime'
        }}
        paused={false}
        viewportRowKeys={['special-media-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="special-media-row">
          <TopicImageHarness
            attributes={{ alt: 'inline', class: 'emoji', height: '24', src: inlineUrl, width: '24' }}
            topicSource="nodeseek"
          />
          <NodeSeekImageStickerHarness src={trailingStickerUrl} />
          <NodeSeekLinkCardHarness />
          <NodeSeekIframeHarness />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const runningUrls = [inlineUrl, trailingStickerUrl, linkCardIconUrl, linkCardThumbnailUrl];
    await waitFor(() => runningUrls.forEach((url) => expect(latestImageProps(url)).toBeTruthy()));
    const firstKeys = runningUrls.map((url) => latestImageProps(url).recyclingKey);
    expect(
      mockWebView.mock.calls.some(([props]) =>
        String((props as { source?: { uri?: string } }).source?.uri || '').includes('aid=1')
      )
    ).toBe(false);
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    await waitFor(() =>
      runningUrls.forEach((url, index) => expect(latestImageProps(url).recyclingKey).not.toBe(firstKeys[index]))
    );
    expect(
      mockWebView.mock.calls.some(([props]) =>
        String((props as { source?: { uri?: string } }).source?.uri || '').includes('aid=1')
      )
    ).toBe(false);
  });

  it('[REG-PROXY-010] remounts an admitted iframe through the coordinator runtime attempt', async () => {
    await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-iframe-runtime'
        }}
        paused={false}
        viewportRowKeys={['iframe-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="iframe-row">
          <NodeSeekIframeHarness />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const iframeCalls = () =>
      mockWebView.mock.calls
        .map(([props]) => props as { source?: { uri?: string }; testID?: string })
        .filter((props) => String(props.source?.uri || '').includes('aid=1'));
    await waitFor(() => expect(iframeCalls()).toHaveLength(1));
    const firstAttemptId = iframeCalls()[0]?.testID;
    const before = getReadNetworkRuntimeSnapshot();

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

    await waitFor(() => expect(iframeCalls()).toHaveLength(2));
    expect(iframeCalls().at(-1)?.testID).not.toBe(firstAttemptId);
  });

  it('[REG-PROXY-010] remounts only an unhealthy same-source video player', async () => {
    const videoUrl = 'https://cdn.example.com/runtime-video.mp4';
    const tree = () => (
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-video-runtime'
        }}
        paused={false}
        viewportRowKeys={['video-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="video-row">
          <CoordinatedVideoHarness src={videoUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    const before = getReadNetworkRuntimeSnapshot();
    const loadingVideo = await render(tree());
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(1));
    const loadingPlayerCount = mockUseVideoPlayer.mock.calls.length;

    await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(loadingPlayerCount + 1));
    await loadingVideo.unmount();
    mockRetainReadNetworkGeneration.mockClear();
    mockReleaseReadNetworkGeneration.mockClear();

    mockVideoStatus = 'readyToPlay';
    const healthyPlayerCountBeforeRender = mockUseVideoPlayer.mock.calls.length;
    const healthyVideo = await render(tree());
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(healthyPlayerCountBeforeRender + 1));
    const healthyPlayerCount = mockUseVideoPlayer.mock.calls.length;
    const current = getReadNetworkRuntimeSnapshot();
    await waitFor(() => expect(mockRetainReadNetworkGeneration).toHaveBeenLastCalledWith(current.generation));

    await act(() => publishReadNetworkRuntimeRotation(current.generation + 1, 'nodeseek'));

    expect(mockUseVideoPlayer).toHaveBeenCalledTimes(healthyPlayerCount);
    expect(mockReleaseReadNetworkGeneration).not.toHaveBeenCalledWith(current.generation);

    await act(() => publishReadNetworkRuntimeRotation(current.generation + 2, 'linuxdo'));

    expect(mockUseVideoPlayer).toHaveBeenCalledTimes(healthyPlayerCount);
    expect(mockReleaseReadNetworkGeneration).not.toHaveBeenCalledWith(current.generation);

    mockVideoStatus = 'error';
    await healthyVideo.rerender(tree());
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(healthyPlayerCount + 1));
    await waitFor(() => expect(mockReleaseReadNetworkGeneration).toHaveBeenCalledWith(current.generation));
    expect(mockRetainReadNetworkGeneration).toHaveBeenLastCalledWith(current.generation + 2);
    await healthyVideo.unmount();
  });

  it('[REG-PROXY-010] resets the loading video deadline before a runtime rotation remount', async () => {
    const videoUrl = 'https://cdn.example.com/runtime-deadline-video.mp4';
    const onDiagnosticFinish = jest.fn((_aggregate: unknown) => undefined);
    mockVideoStatus = 'loading';
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    try {
      const screen = await render(
        <TopicBodyMediaCoordinatorProvider
          active
          diagnosticSession={{
            networkMediaCount: 1,
            plannedRowCount: 1,
            source: 'nodeseek',
            topicRef: 'topic-video-runtime-deadline'
          }}
          onDiagnosticFinish={onDiagnosticFinish}
          paused={false}
          viewportRowKeys={['video-row']}
        >
          <TopicBodyMediaRowBoundary rowKey="video-row">
            <CoordinatedVideoHarness src={videoUrl} />
          </TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      await waitFor(() =>
        expect(mockUseVideoPlayer.mock.calls.some(([source]) => (source as { uri?: string }).uri === videoUrl)).toBe(
          true
        )
      );
      const firstPlayerCount = mockUseVideoPlayer.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(29_900);
      });
      const before = getReadNetworkRuntimeSnapshot();

      await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));

      await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(firstPlayerCount + 1));
      await act(async () => {
        jest.advanceTimersByTime(200);
      });
      await screen.unmount();
      expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
      expect(onDiagnosticFinish).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 0, timeoutCount: 0 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('[REG-PROXY-010] creates no video player until its native generation lease is acquired', async () => {
    const leasedGeneration = getReadNetworkRuntimeSnapshot().generation;
    let resolveRetain: ((lease: { generation: number; retained: boolean }) => void) | undefined;
    mockRetainReadNetworkGeneration.mockImplementationOnce(
      () =>
        new Promise<{ generation: number; retained: boolean }>((resolve) => {
          resolveRetain = resolve;
        })
    );

    const video = await render(
      <ForumContentVideo
        mediaContext={{ contentSource: 'nodeseek', sessionIdentity: 'nodeseek:lease-gate' }}
        src="https://cdn.example.com/lease-gated-video.mp4"
        theme={theme}
      />
    );

    await waitFor(() => expect(mockRetainReadNetworkGeneration).toHaveBeenCalledTimes(1));
    expect(mockUseVideoPlayer).not.toHaveBeenCalled();

    await act(() => publishReadNetworkRuntimeRotation(leasedGeneration + 1, 'linuxdo'));
    await act(() => resolveRetain?.({ generation: leasedGeneration, retained: true }));
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(1));
    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-WZ-Read-Network-Generation': String(leasedGeneration)
        })
      })
    );
    await video.unmount();
  });

  it('[REG-PROXY-010] reacquires the native current generation when the JS snapshot is stale', async () => {
    const staleGeneration = getReadNetworkRuntimeSnapshot().generation;
    const nativeCurrentGeneration = staleGeneration + 1;
    mockRetainReadNetworkGeneration.mockResolvedValueOnce({
      generation: nativeCurrentGeneration,
      retained: false
    });

    const video = await render(
      <ForumContentVideo
        mediaContext={{ contentSource: 'yaohuo', sessionIdentity: 'yaohuo:native-publish-window' }}
        src="https://cdn.example.com/native-publish-window.mp4"
        theme={theme}
      />
    );

    await waitFor(() => expect(mockRetainReadNetworkGeneration).toHaveBeenNthCalledWith(1, staleGeneration));
    await waitFor(() => expect(mockRetainReadNetworkGeneration).toHaveBeenNthCalledWith(2, nativeCurrentGeneration));
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(1));
    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-WZ-Read-Network-Generation': String(nativeCurrentGeneration)
        })
      })
    );
    await video.unmount();
  });

  it('[REG-PROXY-010] reacquires the native current generation for managed video before JS applies publish', async () => {
    const videoUrl = 'https://cdn.example.com/managed-native-publish-window.mp4';
    const staleGeneration = getReadNetworkRuntimeSnapshot().generation;
    const nativeCurrentGeneration = staleGeneration + 1;
    mockRetainReadNetworkGeneration.mockResolvedValueOnce({
      generation: nativeCurrentGeneration,
      retained: false
    });

    const video = await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-managed-native-publish-window'
        }}
        paused={false}
        viewportRowKeys={['video-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="video-row">
          <CoordinatedVideoHarness src={videoUrl} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    await waitFor(() => expect(mockRetainReadNetworkGeneration).toHaveBeenNthCalledWith(1, staleGeneration));
    await waitFor(() => expect(mockRetainReadNetworkGeneration).toHaveBeenNthCalledWith(2, nativeCurrentGeneration));
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalledTimes(1));
    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-WZ-Read-Network-Generation': String(nativeCurrentGeneration)
        })
      })
    );
    expect(mockRetainReadNetworkGeneration).toHaveBeenCalledTimes(2);
    await video.unmount();
  });

  it('[REG-PROXY-010] settles a managed video lease rejected at the same native generation without looping', async () => {
    const generation = getReadNetworkRuntimeSnapshot().generation;
    mockRetainReadNetworkGeneration
      .mockResolvedValueOnce({ generation, retained: false })
      .mockResolvedValueOnce({ generation, retained: false });

    const video = await render(
      <TopicBodyMediaCoordinatorProvider
        active
        diagnosticSession={{
          networkMediaCount: 1,
          plannedRowCount: 1,
          source: 'nodeseek',
          topicRef: 'topic-managed-native-lease-failure'
        }}
        paused={false}
        viewportRowKeys={['video-row']}
      >
        <TopicBodyMediaRowBoundary rowKey="video-row">
          <CoordinatedVideoHarness src="https://cdn.example.com/managed-native-lease-failure.mp4" />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );

    await waitFor(() => expect(video.getByLabelText('视频加载失败，点按重试')).toBeTruthy());
    expect(mockRetainReadNetworkGeneration).toHaveBeenCalledTimes(2);
    expect(mockUseVideoPlayer).not.toHaveBeenCalled();
    await video.unmount();
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
          headers: expect.objectContaining({ Referer: 'https://www.yaohuo.me/' }),
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

  it('[REG-TOPIC-059] keeps a displayed image mounted when the preview action changes', async () => {
    const firstPreviewAction = jest.fn();
    const latestPreviewAction = jest.fn();
    const screen = await render(<TopicImageHarness onOpenImagePreview={firstPreviewAction} />);

    await loadAndDisplayImage(latestImageProps(imageUrl));
    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);

    await screen.rerender(<TopicImageHarness onOpenImagePreview={latestPreviewAction} />);

    expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
    fireEvent.press(screen.getByLabelText('测试图片'));
    expect(latestPreviewAction).toHaveBeenCalledWith(imageUrl, { height: 240, width: 320 }, undefined);
    expect(firstPreviewAction).not.toHaveBeenCalled();
  });

  it('[REG-TOPIC-059] keeps the shared renderer registry stable and routes through the latest actions', async () => {
    const firstActions = {
      onOpenExternalUrl: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenExternalUrl']>(),
      onOpenImagePreview: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview']>(),
      onOpenTopic: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenTopic']>(),
      onOpenUser: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenUser']>()
    };
    const latestActions = {
      onOpenExternalUrl: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenExternalUrl']>(),
      onOpenImagePreview: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenImagePreview']>(),
      onOpenTopic: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenTopic']>(),
      onOpenUser: jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenUser']>()
    };
    const controller = await renderHook(
      (actions: typeof firstActions) =>
        useHtmlRenderingController({
          ...htmlRenderingControllerProps('yaohuo:2'),
          ...actions
        }),
      { initialProps: firstActions }
    );
    const firstRenderers = controller.result.current.htmlRenderers;

    await controller.rerender(latestActions);

    expect(controller.result.current.htmlRenderers).toBe(firstRenderers);
    const openLink = controller.result.current.htmlRenderersProps.a?.onPress;
    const event = { stopPropagation: jest.fn() };
    openLink?.(event as never, 'https://img.example.com/latest.png', {} as never, {} as never);
    openLink?.(event as never, 'https://yaohuo.me/bbs-654.html', {} as never, {} as never);
    openLink?.(event as never, 'https://www.yaohuo.me/userinfo.aspx?userid=42', {} as never, {} as never);
    openLink?.(event as never, 'https://example.com/latest', {} as never, {} as never);

    expect(latestActions.onOpenImagePreview).toHaveBeenCalledWith('https://img.example.com/latest.png');
    expect(latestActions.onOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ id: '654', source: 'yaohuo' }));
    expect(latestActions.onOpenUser).toHaveBeenCalledWith(expect.objectContaining({ id: '42', source: 'yaohuo' }));
    expect(latestActions.onOpenExternalUrl).toHaveBeenCalledWith('https://example.com/latest');
    expect(Object.values(firstActions).every((action) => action.mock.calls.length === 0)).toBe(true);
  });

  it('[REG-TOPIC-059] resolves relative links with the latest Topic base URL and user candidates', async () => {
    const firstTopic: TopicDetail = {
      ...topic,
      author: 'owner',
      id: 'context-topic',
      replies: [
        {
          author: 'alice',
          authorId: '1',
          contentHtml: '<p>first</p>',
          createdAt: '2026-07-17T00:01:00.000Z'
        }
      ],
      source: 'nodeseek',
      url: 'https://www.nodeseek.com/archive/'
    };
    const latestTopic: TopicDetail = {
      ...firstTopic,
      replies: [{ ...firstTopic.replies[0], authorId: '2' }],
      url: 'https://www.nodeseek.com/post-123-1'
    };
    const onOpenUser = jest.fn<Parameters<typeof useHtmlRenderingController>[0]['onOpenUser']>();
    const controller = await renderHook(
      ({ selectedTopic, topicDetail }: { selectedTopic: TopicDetail; topicDetail: TopicDetail }) =>
        useHtmlRenderingController({
          ...htmlRenderingControllerProps('nodeseek:2'),
          onOpenUser,
          selectedTopic,
          topicDetail,
          topicKey: 'nodeseek:context-topic'
        }),
      { initialProps: { selectedTopic: firstTopic, topicDetail: firstTopic } }
    );
    const firstRenderers = controller.result.current.htmlRenderers;

    await controller.rerender({ selectedTopic: latestTopic, topicDetail: latestTopic });

    expect(controller.result.current.htmlRenderers).toBe(firstRenderers);
    const event = { stopPropagation: jest.fn() };
    controller.result.current.htmlRenderersProps.a?.onPress?.(
      event as never,
      'member?t=alice',
      {} as never,
      {} as never
    );
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(onOpenUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: '2', source: 'nodeseek', username: 'alice' })
    );
  });

  it.each([
    ['Topic identity', { topicKey: 'yaohuo:next-topic' }],
    [
      'source',
      {
        selectedTopic: { ...topic, source: 'v2ex', url: 'https://www.v2ex.com/t/123' },
        topicDetail: { ...topic, source: 'v2ex', url: 'https://www.v2ex.com/t/123' }
      }
    ],
    ['theme', { theme: createTheme({ ...readerData.settings, theme: 'dark' }) }],
    ['font family', { settings: { ...readerData.settings, fontFamily: 'serif' } }],
    ['font scale', { settings: { ...readerData.settings, fontScale: 1.1 } }],
    ['line height', { settings: { ...readerData.settings, lineHeight: 'loose' } }],
    ['NodeSeek User-Agent', { nodeSeekMediaUserAgent: 'latest-agent' }],
    ['WebView policy', { webViewBlockMessage: 'blocked' }]
  ] satisfies [string, Partial<Parameters<typeof useHtmlRenderingController>[0]>][])(
    '[REG-TOPIC-059] rebuilds the renderer registry when %s changes',
    async (_label, changedProps) => {
      const initialProps = htmlRenderingControllerProps('yaohuo:2');
      const controller = await renderHook(
        (props: Parameters<typeof useHtmlRenderingController>[0]) => useHtmlRenderingController(props),
        { initialProps }
      );
      const firstRenderers = controller.result.current.htmlRenderers;

      await controller.rerender({ ...initialProps, ...changedProps });

      expect(controller.result.current.htmlRenderers).not.toBe(firstRenderers);
    }
  );

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

  it('[REG-PERF-010] does not emit a diagnostic trace for each body image', async () => {
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

      expect(diagnosticLines).toEqual([]);
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

  it('[REG-TOPIC-064] keeps a video Accept header when the shared media profile is applied', async () => {
    const videoUrl = 'https://cdn.example.com/topic.mp4';

    await render(
      <ForumContentVideo
        mediaContext={{ contentSource: 'nodeseek', sessionIdentity: 'nodeseek:4' }}
        src={videoUrl}
        theme={theme}
      />
    );

    expect(mockUseVideoPlayer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'video/webm,video/mp4,video/*,*/*;q=0.8',
          'X-WZ-Forum-Media-Kind': 'video'
        }),
        uri: videoUrl
      })
    );
  });

  it('[REG-TOPIC-065] renders transparent NodeSeek video stickers in Chromium without native player churn', async () => {
    const fallbackUrl = 'https://www.nodeseek.com/static/image/sticker/emoji/13.png';
    const screen = await render(<NodeSeekVideoStickerHarness />);

    expect(mockUseVideoPlayer).not.toHaveBeenCalled();
    expect(latestImageProps(fallbackUrl).source?.uri).toBe(fallbackUrl);
    expect(mockWebView).toHaveBeenCalledTimes(1);
    const firstWebViewProps = mockWebView.mock.calls[0][0] as {
      mediaPlaybackRequiresUserAction?: boolean;
      onMessage?: (event: { nativeEvent: { data: string } }) => void;
      source?: { baseUrl?: string; html?: string };
      style?: unknown;
      thirdPartyCookiesEnabled?: boolean;
    };
    expect(firstWebViewProps.mediaPlaybackRequiresUserAction).toBe(false);
    expect(firstWebViewProps.thirdPartyCookiesEnabled).toBe(false);
    expect(firstWebViewProps.source).toEqual(
      expect.objectContaining({
        baseUrl: 'https://www.nodeseek.com/',
        html: expect.stringContaining('https://www.nodeseek.com/static/image/sticker/emoji/13.webm')
      })
    );
    expect(StyleSheet.flatten(firstWebViewProps.style)).toEqual(
      expect.objectContaining({ backgroundColor: 'transparent', opacity: 0 })
    );

    await act(() => firstWebViewProps.onMessage?.({ nativeEvent: { data: 'wz-video-sticker-ready' } }));
    const readyWebViewProps = mockWebView.mock.calls.at(-1)?.[0] as { source?: unknown; style?: unknown };
    expect(readyWebViewProps.source).toBe(firstWebViewProps.source);
    expect(StyleSheet.flatten(readyWebViewProps.style)).toEqual(
      expect.objectContaining({ backgroundColor: 'transparent', opacity: 1 })
    );

    await screen.rerender(<NodeSeekVideoStickerHarness />);
    expect(mockUseVideoPlayer).not.toHaveBeenCalled();
    expect((mockWebView.mock.calls.at(-1)?.[0] as { source?: unknown }).source).toBe(firstWebViewProps.source);
  });

  it('[REG-TOPIC-066] sizes image stickers from decoded dimensions instead of folder guesses', async () => {
    const rectangularUrl = 'https://www.nodeseek.com/static/image/sticker/xhj/003.png';
    const squareUrl = 'https://www.nodeseek.com/static/image/sticker/xhj/015.gif';
    const screen = await render(<NodeSeekImageStickerHarness src={rectangularUrl} />);

    await act(() =>
      latestImageProps(rectangularUrl).onLoad?.({
        cacheType: 'none',
        source: { height: 48, mediaType: 'image/png', url: rectangularUrl, width: 57 }
      })
    );
    expect(StyleSheet.flatten(latestImageProps(rectangularUrl).style)).toEqual(
      expect.objectContaining({ height: 48, width: 57 })
    );

    await screen.rerender(<NodeSeekImageStickerHarness src={squareUrl} />);
    await act(() =>
      latestImageProps(squareUrl).onLoad?.({
        cacheType: 'none',
        source: { height: 82, mediaType: 'image/gif', url: squareUrl, width: 82 }
      })
    );
    expect(StyleSheet.flatten(latestImageProps(squareUrl).style)).toEqual(
      expect.objectContaining({ height: 82, width: 82 })
    );

    await screen.unmount();
    await render(<NodeSeekImageStickerHarness src={squareUrl} />);
    expect(StyleSheet.flatten(latestImageProps(squareUrl).style)).toEqual(
      expect.objectContaining({ height: 82, width: 82 })
    );
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

    const video = await render(React.createElement(firstRenderer, videoProps));
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
    expect(secondRenderer).not.toBe(firstRenderer);
    await video.rerender(React.createElement(secondRenderer, videoProps));
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
      expect(diagnosticLines).toEqual([]);
    } finally {
      setDiagnosticWriter(null);
      fetchSpy.mockRestore();
    }
  });

  it('[REG-TOPIC-032] gives each stalled body-image attempt one 30 second no-progress budget', async () => {
    const timeoutImageUrl = 'https://img.example.com/stalled-body-image.png';
    const onDiagnosticFinish = jest.fn((_aggregate: unknown) => undefined);
    jest.useFakeTimers();
    try {
      const screen = await render(
        <TopicBodyMediaCoordinatorProvider
          active
          diagnosticSession={{
            networkMediaCount: 1,
            plannedRowCount: 1,
            source: 'yaohuo',
            topicRef: 'topic-timeout-test'
          }}
          onDiagnosticFinish={onDiagnosticFinish}
          paused={false}
          viewportRowKeys={['timeout-row']}
        >
          <TopicBodyMediaRowBoundary rowKey="timeout-row">
            <TopicImageHarness attributes={{ alt: '超时图片', src: timeoutImageUrl }} />
          </TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      const stalledImageProps = latestImageProps(timeoutImageUrl);

      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(1);
      expect(StyleSheet.flatten(screen.getByTestId('topic-image-frame').props.style)).toMatchObject({
        height: 240,
        width: 320
      });
      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.root?.queryAll((instance) => instance.type === 'ActivityIndicator')).toHaveLength(0);
      expect(screen.getByText('图片加载失败，点按重试')).toBeTruthy();
      expect(screen.queryByTestId('expo-image')).toBeNull();
      await act(() =>
        stalledImageProps.onLoad?.({
          cacheType: 'none',
          source: { height: 400, mediaType: 'image/png', url: timeoutImageUrl, width: 1_600 }
        })
      );
      expect(StyleSheet.flatten(screen.getByLabelText('图片加载失败，点按重试').props.style)).toMatchObject({
        height: 240,
        width: 320
      });
      expect(screen.getByText('图片加载失败，点按重试')).toBeTruthy();
      await screen.unmount();
      expect(onDiagnosticFinish).toHaveBeenCalledTimes(1);
      expect(onDiagnosticFinish).toHaveBeenCalledWith(
        expect.objectContaining({ retryCount: 1, timeoutCount: 2, timerHighWater: 1 })
      );
    } finally {
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

  it('[REG-PERF-010] releases an in-flight SVG recovery when its body image unmounts', async () => {
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

      expect(diagnosticLines).toEqual([]);
      await act(async () => {
        resolvePendingResponse(
          new Response('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          })
        );
        await pendingResponse;
      });
      expect(mockRenderSvgPoster).not.toHaveBeenCalled();
      expect(diagnosticLines).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
      setDiagnosticWriter(null);
    }
  });

  it('[REG-PERF-010] stops an SVG recovery before poster work when its Topic route becomes inactive', async () => {
    const svgImageUrl = 'https://img.example.com/inactive-route-complex.svg';
    let resolvePendingResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolvePendingResponse = resolve;
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => pendingResponse);
    const renderBody = (active: boolean) => (
      <TopicBodyMediaCoordinatorProvider active={active} paused={false} viewportRowKeys={['svg-row']}>
        <TopicBodyMediaRowBoundary rowKey="svg-row">
          <TopicImageHarness attributes={{ alt: '测试图片', src: svgImageUrl }} />
        </TopicBodyMediaRowBoundary>
      </TopicBodyMediaCoordinatorProvider>
    );
    try {
      const screen = await render(renderBody(true));
      await act(() => latestImageProps(svgImageUrl).onError?.({ error: 'native SVG failure' }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

      await screen.rerender(renderBody(false));
      await act(async () => {
        resolvePendingResponse(
          new Response('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          })
        );
        await pendingResponse;
      });

      expect(screen.getByTestId('topic-image-idle')).toBeTruthy();
      expect(mockRenderSvgPoster).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('[REG-PROXY-010] releases the old SVG consumer when runtime rotation replaces its body attempt', async () => {
    const svgImageUrl = 'https://img.example.com/replaced-attempt-complex.svg';
    let resolvePendingResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolvePendingResponse = resolve;
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => pendingResponse);
    try {
      await render(
        <TopicBodyMediaCoordinatorProvider
          active
          diagnosticSession={{
            networkMediaCount: 1,
            plannedRowCount: 1,
            source: 'nodeseek',
            topicRef: 'topic-svg-attempt-owner'
          }}
          paused={false}
          viewportRowKeys={['svg-row']}
        >
          <TopicBodyMediaRowBoundary rowKey="svg-row">
            <TopicImageHarness
              attributes={{ alt: '测试图片', src: svgImageUrl }}
              mediaSessionIdentity="nodeseek:svg-attempt"
              topicSource="nodeseek"
            />
          </TopicBodyMediaRowBoundary>
        </TopicBodyMediaCoordinatorProvider>
      );
      const oldAttempt = latestImageProps(svgImageUrl);
      await act(() => oldAttempt.onError?.({ error: 'native SVG failure' }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const before = getReadNetworkRuntimeSnapshot();

      await act(() => publishReadNetworkRuntimeRotation(before.generation + 1, 'nodeseek'));
      expect(latestImageProps(svgImageUrl).recyclingKey).not.toBe(oldAttempt.recyclingKey);
      await act(async () => {
        resolvePendingResponse(
          new Response('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          })
        );
        await pendingResponse;
      });

      expect(mockRenderSvgPoster).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
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

  it('REG-TOPIC-038 releases the late SVG consumer from the previous media epoch before poster work', async () => {
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
      expect(mockRenderSvgPoster).toHaveBeenCalledTimes(1);

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
