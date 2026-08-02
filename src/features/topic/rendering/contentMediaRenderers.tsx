import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useEvent } from 'expo';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer, type VideoPlayerStatus, type VideoSource } from 'expo-video';
import { WebView } from 'react-native-webview';
import {
  TChildrenRenderer,
  useContentWidth,
  type CustomBlockRenderer,
  type CustomMixedRenderer
} from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { imageRequestHeadersForUrl, imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import {
  inlineForumImageDisplaySize,
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG
} from '@/platform/media/inlineMedia';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '@/domain/forum/videoEmbeds';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import type { HtmlRenderers } from './types';
import { createHtmlRendererStyles, trimsTrailingBlockSpacing } from './htmlStyles';
import { FORUM_LINK_CARD_TAG, FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG } from '@/domain/forum/html';
import { ForumContentVideo } from '@/ui/content/ForumContentVideo';
import { readManagedCookieHeader } from '@/platform/network/managedCookies';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';

export async function readManagedWebViewCookieHeader(url: string) {
  const result = await readManagedCookieHeader(url);
  if (result.status === 'ok') {
    return result.header;
  }
  throw new Error(result.status === 'unsupported' ? '原生 Cookie 读取能力不可用' : result.message);
}

function isVideoStickerUrl(url: string) {
  return /\.(?:webm|mp4|mov)(?:[?#].*)?$/i.test(url);
}

function videoStickerRequestHeaders(
  url: string,
  mediaContext: ForumMediaRequestContext,
  userAgent?: string
): Record<string, string> | undefined {
  const headers = imageRequestHeadersForUrl(url, { mediaContext, nodeSeekUserAgent: userAgent });
  return headers
    ? {
        ...headers,
        Accept: 'video/webm,video/mp4,video/*,*/*;q=0.8'
      }
    : undefined;
}

export function shouldShowVideoStickerLoading(
  firstFrameRendered: boolean,
  loadFailed: boolean,
  status: VideoPlayerStatus
) {
  return !loadFailed && (status === 'loading' || (status !== 'error' && !firstFrameRendered));
}

function ForumVideoStickerVideo({
  fallbackSrc,
  headers,
  loadingColor,
  mediaContext,
  mediaSessionIdentity,
  src,
  videoStyle
}: {
  fallbackSrc: string;
  headers?: Record<string, string>;
  loadingColor: string;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  src: string;
  videoStyle: StyleProp<ViewStyle>;
}) {
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const source = useMemo<VideoSource>(
    () => ({
      uri: src,
      ...(headers ? { headers } : {}),
      contentType: 'progressive'
    }),
    [headers, src]
  );
  const player = useVideoPlayer(source, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
    nextPlayer.keepScreenOnWhilePlaying = false;
    nextPlayer.play();
  });
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
  useEffect(() => {
    setFirstFrameRendered(false);
  }, [headers, mediaSessionIdentity, src]);
  const loadFailed = status === 'error';
  const showLoading = shouldShowVideoStickerLoading(firstFrameRendered, loadFailed, status);
  const showFallback = fallbackSrc && (!firstFrameRendered || loadFailed);
  return (
    <View pointerEvents="none" style={videoStyle}>
      {!loadFailed ? (
        <VideoView
          allowsVideoFrameAnalysis={false}
          contentFit="contain"
          fullscreenOptions={{ enable: false }}
          nativeControls={false}
          onFirstFrameRender={() => {
            setFirstFrameRendered(true);
          }}
          player={player}
          style={embedStyles.stickerVideoFill}
          surfaceType="textureView"
          useExoShutter={false}
        />
      ) : null}
      {showFallback ? (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${fallbackSrc}`}
          source={imageSourceFromUrl(fallbackSrc, { mediaContext, nodeSeekUserAgent: headers?.['User-Agent'] })}
          style={embedStyles.stickerVideoFallback}
        />
      ) : null}
      {showLoading ? (
        <View style={embedStyles.stickerVideoLoading}>
          <ActivityIndicator color={loadingColor} size="small" />
        </View>
      ) : null}
    </View>
  );
}

const embedStyles = StyleSheet.create({
  inlineMediaLine: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  stickerRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
    marginTop: 8,
    rowGap: 6
  },
  stickerVideoFrame: {
    overflow: 'hidden'
  },
  inlineVideoSticker: {
    backgroundColor: 'transparent',
    marginHorizontal: 2
  },
  stickerVideoFill: {
    ...StyleSheet.absoluteFillObject
  },
  stickerVideoFallback: {
    ...StyleSheet.absoluteFillObject
  },
  stickerVideoLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  linkCard: {
    alignSelf: 'stretch',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    marginTop: 8,
    overflow: 'hidden',
    padding: 10
  },
  linkCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 8
  },
  linkCardIcon: {
    height: 18,
    marginRight: 7,
    width: 18
  },
  linkCardSite: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600'
  },
  linkCardBody: {
    flexDirection: 'row'
  },
  linkCardThumbnail: {
    borderRadius: 4,
    height: 58,
    marginRight: 10,
    width: 92
  },
  linkCardText: {
    flex: 1,
    minWidth: 0
  },
  linkCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22
  },
  linkCardDescription: {
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6
  },
  videoFrame: {
    alignSelf: 'stretch',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    marginTop: 8,
    overflow: 'hidden'
  },
  webView: {
    flex: 1
  },
  blockedWebView: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 12
  }
});

export function createContentMediaRenderers({
  htmlRendererStyles,
  mediaContext,
  mediaSessionIdentity,
  nodeSeekMediaUserAgent,
  openHtmlLink,
  settings,
  theme,
  webViewBlockMessage
}: {
  htmlRendererStyles: ReturnType<typeof createHtmlRendererStyles>;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  nodeSeekMediaUserAgent?: string;
  openHtmlLink: (href: string, event?: { stopPropagation?: () => void }) => void;
  settings: Pick<ReaderSettings, 'fontScale'>;
  theme: ReaderTheme;
  webViewBlockMessage: string;
}): HtmlRenderers {
  const VideoEmbedBlock = ({ embedUrl }: { embedUrl: string }) => (
    <View style={[embedStyles.videoFrame, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
      {webViewBlockMessage ? (
        <View style={embedStyles.blockedWebView}>
          <Text style={[htmlRendererStyles.inlineForumImageText, { color: theme.muted }]}>{webViewBlockMessage}</Text>
        </View>
      ) : (
        <WebView
          allowsFullscreenVideo
          domStorageEnabled
          javaScriptEnabled
          javaScriptCanOpenWindowsAutomatically={false}
          onShouldStartLoadWithRequest={(request) => shouldAllowBilibiliWebViewNavigation(request.url)}
          source={{ uri: embedUrl }}
          setSupportMultipleWindows={false}
          style={embedStyles.webView}
        />
      )}
    </View>
  );

  const ForumVideoStickerRenderer: CustomBlockRenderer = (props) => {
    const attributes = props.tnode.attributes || {};
    const src = attributes.src || '';
    const fallbackSrc = attributes['data-fallback-src'] || '';
    const contentWidth = useContentWidth();
    const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
    if (!src) {
      return fallbackSrc ? (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${fallbackSrc}`}
          source={imageSourceFromUrl(fallbackSrc, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
          style={[htmlRendererStyles.inlineForumImage, size]}
        />
      ) : null;
    }
    if (!isVideoStickerUrl(src)) {
      return (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${src}`}
          source={imageSourceFromUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
          style={[htmlRendererStyles.inlineForumImage, size]}
        />
      );
    }
    const headers = videoStickerRequestHeaders(src, mediaContext, nodeSeekMediaUserAgent);
    return (
      <ForumVideoStickerVideo
        key={`${mediaSessionIdentity}:${src}`}
        fallbackSrc={fallbackSrc}
        headers={headers}
        loadingColor={theme.primary}
        mediaContext={mediaContext}
        mediaSessionIdentity={mediaSessionIdentity}
        src={src}
        videoStyle={[size, embedStyles.inlineVideoSticker, embedStyles.stickerVideoFrame]}
      />
    );
  };

  const ForumVideoRenderer: CustomBlockRenderer = (props) => {
    const attributes = props.tnode.attributes || {};
    const src = attributes.src || '';
    if (!src) {
      return null;
    }
    return (
      <ForumContentVideo
        key={`${mediaSessionIdentity}:${src}`}
        headers={videoStickerRequestHeaders(src, mediaContext, nodeSeekMediaUserAgent)}
        mediaContext={mediaContext}
        src={src}
        theme={theme}
      />
    );
  };

  const ForumStickerRenderer: CustomMixedRenderer = (props) => {
    const attributes = props.tnode.attributes || {};
    const src = attributes.src || '';
    const contentWidth = useContentWidth();
    const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
    if (!src) {
      return <Text style={htmlRendererStyles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
    }
    return (
      <ExpoImage
        contentFit="contain"
        recyclingKey={`${mediaSessionIdentity}:${src}`}
        source={imageSourceFromUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
        style={[htmlRendererStyles.inlineForumImage, size]}
      />
    );
  };

  const ForumStickerRowRenderer: CustomBlockRenderer = (props) => {
    return (
      <View style={[embedStyles.stickerRow, trimsTrailingBlockSpacing(props.tnode) ? { marginBottom: -4 } : null]}>
        <TChildrenRenderer tchildren={props.tnode.children} />
      </View>
    );
  };

  const ForumInlineMediaLineRenderer: CustomBlockRenderer = (props) => {
    return (
      <View style={embedStyles.inlineMediaLine}>
        <TChildrenRenderer tchildren={props.tnode.children} />
      </View>
    );
  };

  const LinkCardRenderer: CustomBlockRenderer = (props) => {
    const attributes = props.tnode.attributes || {};
    const href = attributes.href || '';
    const site = attributes.site || '';
    const title = attributes.title || site || href;
    const description = attributes.description || '';
    const imageSrc = attributes['image-src'] || '';
    const iconSrc = attributes['icon-src'] || '';
    if (!href) {
      return null;
    }
    return (
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="link"
        android_ripple={androidRipple(theme.mist)}
        style={[embedStyles.linkCard, { backgroundColor: theme.surface, borderColor: theme.line }]}
        onPress={(event) => {
          event.stopPropagation?.();
          openHtmlLink(href, event);
        }}
      >
        {site || iconSrc ? (
          <View style={embedStyles.linkCardHeader}>
            {iconSrc ? (
              <ExpoImage
                contentFit="contain"
                recyclingKey={`${mediaSessionIdentity}:${iconSrc}`}
                source={imageSourceFromUrl(iconSrc, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
                style={embedStyles.linkCardIcon}
              />
            ) : null}
            {site ? (
              <Text numberOfLines={1} style={[embedStyles.linkCardSite, { color: theme.muted }]}>
                {site}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={embedStyles.linkCardBody}>
          {imageSrc ? (
            <ExpoImage
              contentFit="cover"
              recyclingKey={`${mediaSessionIdentity}:${imageSrc}`}
              source={imageSourceFromUrl(imageSrc, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
              style={[embedStyles.linkCardThumbnail, { backgroundColor: theme.surface2 }]}
            />
          ) : null}
          <View style={embedStyles.linkCardText}>
            <Text numberOfLines={3} style={[embedStyles.linkCardTitle, { color: theme.primaryStrong }]}>
              {title}
            </Text>
            {description ? (
              <Text numberOfLines={3} style={[embedStyles.linkCardDescription, { color: theme.ink }]}>
                {description}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  const IframeRenderer: CustomBlockRenderer = (props) => {
    const src = props.tnode.attributes.src || '';
    const embed = nsEmbedFromUrl(src);
    if (embed?.type !== 'bilibili') {
      return null;
    }
    return <VideoEmbedBlock embedUrl={embed.embedUrl} />;
  };
  return {
    [FORUM_INLINE_MEDIA_LINE_TAG]: ForumInlineMediaLineRenderer,
    [FORUM_STICKER_ROW_TAG]: ForumStickerRowRenderer,
    [FORUM_STICKER_TAG]: ForumStickerRenderer,
    [FORUM_LINK_CARD_TAG]: LinkCardRenderer,
    [FORUM_VIDEO_TAG]: ForumVideoRenderer,
    [FORUM_VIDEO_STICKER_TAG]: ForumVideoStickerRenderer,
    iframe: IframeRenderer
  };
}
