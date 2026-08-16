import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { useContentWidth, type CustomBlockRenderer } from 'react-native-render-html';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { imageRequestHeadersForUrl, isNodeSeekHost } from '@/platform/media/imageRequestSource';
import { inlineForumImageDisplaySize } from '@/platform/media/inlineMedia';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '@/domain/forum/videoEmbeds';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import type { HtmlRenderers } from './types';
import { createHtmlRendererStyles } from './htmlStyles';
import { useContentBoundarySpacing } from './TopicContentPresentation';
import { FORUM_LINK_CARD_TAG, FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG } from '@/domain/forum/html';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { createForumStickerRenderers } from '@/ui/content/ForumStickerContent';
import { useTopicBodyMediaLease } from '../media/TopicBodyMediaCoordinator';
import { ManagedTopicContentVideo } from '../media/ManagedTopicContentVideo';
import { ManagedTopicMediaImage } from '../media/ManagedTopicMediaImage';
import {
  normalizeMediaReferrerPolicy,
  type MediaReferrerContext,
  type MediaReferrerPolicy
} from '@/domain/forum/mediaReferrer';

function isVideoStickerUrl(url: string) {
  return /\.(?:webm|mp4|mov)(?:[?#].*)?$/i.test(url);
}

function videoStickerRequestHeaders(
  url: string,
  mediaContext: ForumMediaRequestContext,
  userAgent?: string,
  referrerPolicy?: MediaReferrerPolicy
): Record<string, string> | undefined {
  const headers = imageRequestHeadersForUrl(url, { mediaContext, nodeSeekUserAgent: userAgent, referrerPolicy });
  return headers
    ? {
        ...headers,
        Accept: 'video/webm,video/mp4,video/*,*/*;q=0.8'
      }
    : undefined;
}

const VIDEO_STICKER_READY_MESSAGE = 'wz-video-sticker-ready';
const VIDEO_STICKER_ERROR_MESSAGE = 'wz-video-sticker-error';
const VIDEO_STICKER_PROGRESS_MESSAGE = 'wz-video-sticker-progress';

function ForumVideoStickerWebView({
  document,
  loadingColor,
  nodeSeekUserAgent,
  requestIdentity
}: {
  document: NonNullable<ReturnType<typeof videoStickerBrowserDocument>>;
  loadingColor: string;
  nodeSeekUserAgent?: string;
  requestIdentity: string;
}) {
  const lease = useTopicBodyMediaLease({
    kind: 'video',
    requestIdentity
  });
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setReady(false);
    setLoadFailed(Boolean(lease.failure));
  }, [lease.attemptId, lease.failure]);
  const fail = () => {
    lease.settle('error');
    setReady(false);
    if (lease.attemptId === 'unmanaged') setLoadFailed(true);
  };
  if (!lease.admitted || loadFailed) {
    return <View pointerEvents="none" style={embedStyles.stickerVideoFill} />;
  }
  return (
    <>
      <WebView
        key={lease.attemptId}
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
        onLoadProgress={(event) => lease.progress(event.nativeEvent.progress)}
        onMessage={(event) => {
          if (event.nativeEvent.data.startsWith(`${VIDEO_STICKER_PROGRESS_MESSAGE}:`)) {
            lease.progress(Number(event.nativeEvent.data.slice(VIDEO_STICKER_PROGRESS_MESSAGE.length + 1)));
          } else if (event.nativeEvent.data === VIDEO_STICKER_READY_MESSAGE) {
            lease.settle('displayed');
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
        testID={`topic-video-sticker-${lease.attemptId}`}
      />
      {!ready && !loadFailed ? (
        <View style={embedStyles.stickerVideoLoading}>
          <ActivityIndicator color={loadingColor} size="small" />
        </View>
      ) : null}
    </>
  );
}

function ForumVideoStickerBrowser({
  fallbackSrc,
  loadingColor,
  mediaContext,
  mediaSessionIdentity,
  nodeSeekUserAgent,
  referrerPolicy,
  src,
  videoStyle
}: {
  fallbackSrc: string;
  loadingColor: string;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  nodeSeekUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
  src: string;
  videoStyle: StyleProp<ViewStyle>;
}) {
  const document = useMemo(
    () => videoStickerBrowserDocument(src, mediaContext.referrer, referrerPolicy),
    [mediaContext.referrer, referrerPolicy, src]
  );
  const requestIdentity = useMemo(() => {
    const referrer =
      videoStickerRequestHeaders(src, mediaContext, nodeSeekUserAgent, referrerPolicy)?.Referer || 'none';
    return `video-sticker:${mediaSessionIdentity}:${src}:referrer:${referrer}`;
  }, [mediaContext, mediaSessionIdentity, nodeSeekUserAgent, referrerPolicy, src]);
  return (
    <View pointerEvents="none" style={videoStyle}>
      {fallbackSrc ? (
        <ManagedTopicMediaImage
          contentFit="contain"
          kind="sticker"
          mediaContext={mediaContext}
          nodeSeekMediaUserAgent={nodeSeekUserAgent}
          referrerPolicy={referrerPolicy}
          src={fallbackSrc}
          style={embedStyles.stickerVideoFallback}
        />
      ) : null}
      {document ? (
        <ForumVideoStickerWebView
          document={document}
          loadingColor={loadingColor}
          nodeSeekUserAgent={nodeSeekUserAgent}
          requestIdentity={requestIdentity}
        />
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
  const VideoEmbedWebView = ({ embedUrl }: { embedUrl: string }) => {
    const lease = useTopicBodyMediaLease({
      kind: 'video',
      requestIdentity: `iframe:${mediaSessionIdentity}:${embedUrl}`
    });
    if (!lease.admitted) {
      return <View pointerEvents="none" style={embedStyles.webView} />;
    }
    const fail = () => lease.settle('error');
    return (
      <WebView
        key={lease.attemptId}
        allowsFullscreenVideo
        domStorageEnabled
        javaScriptEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        onContentProcessDidTerminate={fail}
        onError={fail}
        onHttpError={fail}
        onLoad={() => lease.settle('displayed')}
        onLoadProgress={(event) => lease.progress(event.nativeEvent.progress)}
        onRenderProcessGone={fail}
        onShouldStartLoadWithRequest={(request) => shouldAllowBilibiliWebViewNavigation(request.url)}
        source={{ uri: embedUrl }}
        setSupportMultipleWindows={false}
        style={embedStyles.webView}
        testID={`topic-video-embed-${lease.attemptId}`}
      />
    );
  };

  const VideoEmbedBlock = ({ boundarySpacing, embedUrl }: { boundarySpacing?: ViewStyle; embedUrl: string }) => (
    <View
      style={[embedStyles.videoFrame, { borderColor: theme.line, backgroundColor: theme.surface2 }, boundarySpacing]}
      testID="topic-video-embed-frame"
    >
      {webViewBlockMessage ? (
        <View style={embedStyles.blockedWebView}>
          <Text style={[htmlRendererStyles.inlineForumImageText, { color: theme.muted }]}>{webViewBlockMessage}</Text>
        </View>
      ) : (
        <VideoEmbedWebView embedUrl={embedUrl} />
      )}
    </View>
  );

  const ForumVideoStickerRenderer: CustomBlockRenderer = (props) => {
    const boundarySpacing = useContentBoundarySpacing(props.tnode);
    const attributes = props.tnode.attributes || {};
    const src = attributes.src || '';
    const fallbackSrc = attributes['data-fallback-src'] || '';
    const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
    const contentWidth = useContentWidth();
    const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
    if (!src) {
      return fallbackSrc ? (
        <ManagedTopicMediaImage
          contentFit="contain"
          kind="sticker"
          mediaContext={mediaContext}
          nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
          referrerPolicy={referrerPolicy}
          src={fallbackSrc}
          style={[htmlRendererStyles.inlineForumImage, size, boundarySpacing]}
        />
      ) : null;
    }
    if (!isVideoStickerUrl(src)) {
      return (
        <ManagedTopicMediaImage
          contentFit="contain"
          kind="sticker"
          mediaContext={mediaContext}
          nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
          referrerPolicy={referrerPolicy}
          src={src}
          style={[htmlRendererStyles.inlineForumImage, size, boundarySpacing]}
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
        referrerPolicy={referrerPolicy}
        src={src}
        videoStyle={[size, embedStyles.inlineVideoSticker, embedStyles.stickerVideoFrame, boundarySpacing]}
      />
    );
  };

  const ForumVideoRenderer: CustomBlockRenderer = (props) => {
    const boundarySpacing = useContentBoundarySpacing(props.tnode);
    const attributes = props.tnode.attributes || {};
    const poster = attributes.poster || '';
    const src = attributes.src || '';
    const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
    if (!src) {
      return null;
    }
    return (
      <ManagedTopicContentVideo
        key={`${mediaSessionIdentity}:${src}`}
        boundarySpacing={boundarySpacing}
        mediaContext={mediaContext}
        nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
        poster={poster}
        referrerPolicy={referrerPolicy}
        src={src}
        theme={theme}
      />
    );
  };

  const LinkCardRenderer: CustomBlockRenderer = (props) => {
    const boundarySpacing = useContentBoundarySpacing(props.tnode);
    const attributes = props.tnode.attributes || {};
    const href = attributes.href || '';
    const site = attributes.site || '';
    const title = attributes.title || site || href;
    const description = attributes.description || '';
    const imageSrc = attributes['image-src'] || '';
    const iconSrc = attributes['icon-src'] || '';
    const imageReferrerPolicy = normalizeMediaReferrerPolicy(attributes['image-referrerpolicy']);
    const iconReferrerPolicy = normalizeMediaReferrerPolicy(attributes['icon-referrerpolicy']);
    if (!href) {
      return null;
    }
    return (
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="link"
        android_ripple={androidRipple(theme.mist)}
        style={[embedStyles.linkCard, { backgroundColor: theme.surface, borderColor: theme.line }, boundarySpacing]}
        onPress={(event) => {
          event.stopPropagation?.();
          openHtmlLink(href, event);
        }}
      >
        {site || iconSrc ? (
          <View style={embedStyles.linkCardHeader}>
            {iconSrc ? (
              <ManagedTopicMediaImage
                contentFit="contain"
                kind="poster"
                mediaContext={mediaContext}
                nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
                referrerPolicy={iconReferrerPolicy}
                src={iconSrc}
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
            <ManagedTopicMediaImage
              contentFit="cover"
              kind="poster"
              mediaContext={mediaContext}
              nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
              referrerPolicy={imageReferrerPolicy}
              src={imageSrc}
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
    const boundarySpacing = useContentBoundarySpacing(props.tnode);
    const src = props.tnode.attributes.src || '';
    const embed = nsEmbedFromUrl(src);
    if (embed?.type !== 'bilibili') {
      return null;
    }
    return <VideoEmbedBlock boundarySpacing={boundarySpacing} embedUrl={embed.embedUrl} />;
  };
  return {
    ...createForumStickerRenderers({
      fontScale: settings.fontScale,
      imageStyle: htmlRendererStyles.inlineForumImage,
      mediaContext,
      mediaSessionIdentity,
      nodeSeekMediaUserAgent,
      renderImage: (props) => (
        <ManagedTopicMediaImage
          {...props}
          contentFit="contain"
          kind="sticker"
          mediaContext={mediaContext}
          nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
        />
      ),
      textStyle: htmlRendererStyles.inlineForumImageText,
      useContentBoundarySpacing
    }),
    [FORUM_LINK_CARD_TAG]: LinkCardRenderer,
    [FORUM_VIDEO_TAG]: ForumVideoRenderer,
    [FORUM_VIDEO_STICKER_TAG]: ForumVideoStickerRenderer,
    iframe: IframeRenderer
  };
}

function videoStickerBrowserDocument(
  src: string,
  referrer?: MediaReferrerContext,
  referrerPolicy?: MediaReferrerPolicy
) {
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
    let baseUrl = `${url.origin}/`;
    let policy: MediaReferrerPolicy = 'origin';
    if (referrer) {
      policy = 'no-referrer';
      try {
        const documentUrl = new URL(referrer.documentUrl);
        if (documentUrl.protocol === 'http:' || documentUrl.protocol === 'https:') {
          documentUrl.username = '';
          documentUrl.password = '';
          documentUrl.hash = '';
          baseUrl = documentUrl.toString();
          policy =
            normalizeMediaReferrerPolicy(referrerPolicy) ||
            normalizeMediaReferrerPolicy(referrer.documentPolicy) ||
            'strict-origin-when-cross-origin';
        }
      } catch {
        // Keep the media load alive while matching the shared resolver's no-Referer fallback.
      }
    }
    return {
      source: {
        baseUrl,
        html: videoStickerBrowserHtml(url.toString(), url.origin, policy)
      }
    };
  } catch {
    return null;
  }
}

function videoStickerBrowserHtml(src: string, origin: string, referrerPolicy: MediaReferrerPolicy) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="${referrerPolicy}">
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
  let lastBufferedEnd = -1;
  const post = (message) => window.ReactNativeWebView.postMessage(message);
  const play = () => video.play().catch(() => {});
  const progress = () => {
    if (settled) return;
    let bufferedEnd = 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      bufferedEnd = Math.max(bufferedEnd, video.buffered.end(index));
    }
    if (!Number.isFinite(bufferedEnd) || bufferedEnd <= lastBufferedEnd) return;
    lastBufferedEnd = bufferedEnd;
    post('${VIDEO_STICKER_PROGRESS_MESSAGE}:' + String(1 + bufferedEnd));
  };
  const ready = () => {
    if (settled) return;
    settled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => post('${VIDEO_STICKER_READY_MESSAGE}')));
  };
  video.addEventListener('progress', progress);
  video.addEventListener('loadedmetadata', progress, { once: true });
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
