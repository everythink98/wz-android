import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { WebView } from 'react-native-webview';
import { useContentWidth, type CustomBlockRenderer } from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { imageRequestHeadersForUrl, imageSourceFromUrl, isNodeSeekHost } from '@/platform/media/imageRequestSource';
import { inlineForumImageDisplaySize } from '@/platform/media/inlineMedia';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '@/domain/forum/videoEmbeds';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import type { HtmlRenderers } from './types';
import { createHtmlRendererStyles, trimsTrailingBlockSpacing } from './htmlStyles';
import { FORUM_LINK_CARD_TAG, FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG } from '@/domain/forum/html';
import { ForumContentVideo } from '@/ui/content/ForumContentVideo';
import { readManagedCookieHeader } from '@/platform/network/managedCookies';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { createForumStickerRenderers } from '@/ui/content/ForumStickerContent';

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

const VIDEO_STICKER_READY_MESSAGE = 'wz-video-sticker-ready';
const VIDEO_STICKER_ERROR_MESSAGE = 'wz-video-sticker-error';

function ForumVideoStickerBrowser({
  fallbackSrc,
  loadingColor,
  mediaContext,
  mediaSessionIdentity,
  nodeSeekUserAgent,
  src,
  videoStyle
}: {
  fallbackSrc: string;
  loadingColor: string;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  nodeSeekUserAgent?: string;
  src: string;
  videoStyle: StyleProp<ViewStyle>;
}) {
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const document = useMemo(() => videoStickerBrowserDocument(src), [src]);
  if (!document) {
    return (
      <View pointerEvents="none" style={videoStyle}>
        {fallbackSrc ? (
          <ExpoImage
            contentFit="contain"
            recyclingKey={`${mediaSessionIdentity}:${fallbackSrc}`}
            source={imageSourceFromUrl(fallbackSrc, { mediaContext, nodeSeekUserAgent })}
            style={embedStyles.stickerVideoFallback}
          />
        ) : null}
      </View>
    );
  }
  const fail = () => {
    setReady(false);
    setLoadFailed(true);
  };
  return (
    <View pointerEvents="none" style={videoStyle}>
      {fallbackSrc ? (
        <ExpoImage
          contentFit="contain"
          recyclingKey={`${mediaSessionIdentity}:${fallbackSrc}`}
          source={imageSourceFromUrl(fallbackSrc, { mediaContext, nodeSeekUserAgent })}
          style={embedStyles.stickerVideoFallback}
        />
      ) : null}
      {!loadFailed ? (
        <WebView
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          allowsInlineMediaPlayback
          bounces={false}
          containerStyle={embedStyles.stickerVideoFill}
          domStorageEnabled={false}
          geolocationEnabled={false}
          javaScriptCanOpenWindowsAutomatically={false}
          javaScriptEnabled
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="never"
          onContentProcessDidTerminate={fail}
          onError={fail}
          onHttpError={fail}
          onMessage={(event) => {
            if (event.nativeEvent.data === VIDEO_STICKER_READY_MESSAGE) {
              setReady(true);
              setLoadFailed(false);
            } else if (event.nativeEvent.data === VIDEO_STICKER_ERROR_MESSAGE) {
              fail();
            }
          }}
          onRenderProcessGone={fail}
          onShouldStartLoadWithRequest={(request) =>
            request.isTopFrame === false || isVideoStickerBootstrapUrl(request.url, document.source.baseUrl)
          }
          originWhitelist={['*']}
          pointerEvents="none"
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          sharedCookiesEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          source={document.source}
          style={[embedStyles.stickerVideoFill, embedStyles.transparentWebView, { opacity: ready ? 1 : 0 }]}
          thirdPartyCookiesEnabled={false}
          userAgent={nodeSeekUserAgent}
        />
      ) : null}
      {!ready && !loadFailed ? (
        <View style={embedStyles.stickerVideoLoading}>
          <ActivityIndicator color={loadingColor} size="small" />
        </View>
      ) : null}
    </View>
  );
}

const embedStyles = StyleSheet.create({
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
  transparentWebView: {
    backgroundColor: 'transparent'
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
    return (
      <ForumVideoStickerBrowser
        key={`${mediaSessionIdentity}:${src}`}
        fallbackSrc={fallbackSrc}
        loadingColor={theme.primary}
        mediaContext={mediaContext}
        mediaSessionIdentity={mediaSessionIdentity}
        nodeSeekUserAgent={nodeSeekMediaUserAgent}
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
    ...createForumStickerRenderers({
      fontScale: settings.fontScale,
      imageStyle: htmlRendererStyles.inlineForumImage,
      mediaContext,
      mediaSessionIdentity,
      nodeSeekMediaUserAgent,
      textStyle: htmlRendererStyles.inlineForumImageText,
      trimsTrailingBlockSpacing
    }),
    [FORUM_LINK_CARD_TAG]: LinkCardRenderer,
    [FORUM_VIDEO_TAG]: ForumVideoRenderer,
    [FORUM_VIDEO_STICKER_TAG]: ForumVideoStickerRenderer,
    iframe: IframeRenderer
  };
}

function videoStickerBrowserDocument(src: string) {
  try {
    const url = new URL(src);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !isNodeSeekHost(url.hostname) ||
      !/^\/static\/image\/sticker\//i.test(url.pathname) ||
      !isVideoStickerUrl(url.toString())
    ) {
      return null;
    }
    const baseUrl = `${url.origin}/`;
    return {
      source: {
        baseUrl,
        html: videoStickerBrowserHtml(url.toString(), url.origin)
      }
    };
  } catch {
    return null;
  }
}

function videoStickerBrowserHtml(src: string, origin: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="origin">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${escapeHtmlAttribute(origin)}; style-src 'unsafe-inline'; script-src 'nonce-wz-video-sticker'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src 'none'; object-src 'none'; worker-src 'none'">
<style>
html, body, video { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
video { display: block; object-fit: contain; }
</style>
</head>
<body>
<video autoplay loop muted playsinline webkit-playsinline disablepictureinpicture src="${escapeHtmlAttribute(src)}"></video>
<script nonce="wz-video-sticker">
(() => {
  const video = document.querySelector('video');
  let settled = false;
  const post = (message) => window.ReactNativeWebView.postMessage(message);
  const play = () => video.play().catch(() => {});
  const ready = () => {
    if (settled) return;
    settled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => post('${VIDEO_STICKER_READY_MESSAGE}')));
  };
  video.addEventListener('loadeddata', ready, { once: true });
  video.addEventListener('error', () => post('${VIDEO_STICKER_ERROR_MESSAGE}'), { once: true });
  document.addEventListener('visibilitychange', () => document.hidden ? video.pause() : play());
  if (video.readyState >= 2) ready();
  play();
})();
</script>
</body>
</html>`;
}

function isVideoStickerBootstrapUrl(value: string, baseUrl: string) {
  const url = String(value || '').trim();
  return /^about:blank$/i.test(url) || url === baseUrl;
}

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
