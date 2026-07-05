import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useEvent } from 'expo';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer, type VideoPlayerStatus, type VideoSource } from 'expo-video';
import { WebView } from 'react-native-webview';
import {
  getNativePropsForTNode,
  TChildrenRenderer,
  useContentWidth,
  useIMGElementProps,
  useIMGElementState,
  type CustomBlockRenderer,
  type CustomMixedRenderer
} from 'react-native-render-html';
import type { ReaderSettings } from '../readerData';
import { createTopicImageDeriver } from '../topicDerivedData';
import {
  imageSourceFromUrl,
  imageRequestHeadersForUrl,
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize,
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG,
  isHttpOrHttpsUrl,
  isInlineForumImage,
  isPreviewableImageUrl
} from '../htmlImages';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '../nsVideoEmbeds';
import { parseForumTopicLink, parseForumUserLink } from '../appUtils';
import { androidRipple, fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '../theme';
import type { Topic, TopicDetail, UserProfile } from '../types';
import type { HtmlRenderers, HtmlRenderersProps } from '../appTypes';
import { buildHtmlRenderingStyles } from '../htmlRenderingStyles';
import { FORUM_REPLY_REFERENCE_TAG } from '../topicContentHtml';
import { FORUM_LINK_CARD_TAG, FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG } from '../localHtml';
import { ForumContentVideo } from '../components/ForumContentVideo';

export function shouldShowPreviewImageLoading(imageStateType: 'loading' | 'success' | 'error', nativeImageLoaded: boolean) {
  return imageStateType === 'loading' || (imageStateType === 'success' && !nativeImageLoaded);
}

function isVideoStickerUrl(url: string) {
  return /\.(?:webm|mp4|mov)(?:[?#].*)?$/i.test(url);
}

function videoStickerRequestHeaders(url: string, cookieHeader?: string, userAgent?: string): Record<string, string> | undefined {
  const headers = imageRequestHeadersForUrl(url, cookieHeader, userAgent);
  return headers ? {
    ...headers,
    Accept: 'video/webm,video/mp4,video/*,*/*;q=0.8'
  } : undefined;
}

export function shouldShowVideoStickerLoading(firstFrameRendered: boolean, loadFailed: boolean, status: VideoPlayerStatus) {
  return !loadFailed && (status === 'loading' || (status !== 'error' && !firstFrameRendered));
}

function ForumVideoStickerVideo({
  fallbackSrc,
  headers,
  loadingColor,
  src,
  videoStyle
}: {
  fallbackSrc: string;
  headers?: Record<string, string>;
  loadingColor: string;
  src: string;
  videoStyle: StyleProp<ViewStyle>;
}) {
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const headerAccept = headers?.Accept || '';
  const headerCookie = headers?.Cookie || '';
  const headerReferer = headers?.Referer || '';
  const headerUserAgent = headers?.['User-Agent'] || '';
  const hasHeaders = Boolean(headers);
  const source = useMemo<VideoSource>(() => ({
    uri: src,
    ...(hasHeaders ? {
      headers: {
        ...(headerAccept ? { Accept: headerAccept } : {}),
        ...(headerCookie ? { Cookie: headerCookie } : {}),
        ...(headerReferer ? { Referer: headerReferer } : {}),
        ...(headerUserAgent ? { 'User-Agent': headerUserAgent } : {})
      }
    } : {}),
    contentType: 'progressive'
  }), [hasHeaders, headerAccept, headerCookie, headerReferer, headerUserAgent, src]);
  const player = useVideoPlayer(source, (nextPlayer) => {
    nextPlayer.loop = true;
    nextPlayer.muted = true;
    nextPlayer.keepScreenOnWhilePlaying = false;
    nextPlayer.play();
  });
  const status = useEvent(player, 'statusChange', { status: player.status }).status;
  useEffect(() => {
    setFirstFrameRendered(false);
  }, [headerAccept, headerCookie, headerReferer, headerUserAgent, src]);
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
        <Image
          resizeMode="contain"
          source={imageSourceFromUrl(fallbackSrc, undefined, headers?.Cookie, headers?.['User-Agent'])}
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

export function useHtmlRenderingController({
  onOpenExternalUrl,
  onOpenImagePreview,
  onOpenTopic,
  onOpenUser,
  nodeSeekMediaCookieHeader,
  nodeSeekMediaUserAgent,
  selectedTopic,
  settings,
  styles,
  theme,
  topicDetail,
  topicKey
}: {
  onOpenExternalUrl: (url: string) => void;
  onOpenImagePreview: (url: string) => void;
  onOpenTopic: (topic: Topic) => void | Promise<void>;
  onOpenUser: (user: UserProfile) => void | Promise<void>;
  nodeSeekMediaUserAgent?: string;
  nodeSeekMediaCookieHeader?: string;
  selectedTopic: Topic | null;
  settings: ReaderSettings;
  styles: {
    htmlFloorLink: StyleProp<TextStyle>;
    htmlMentionLink: StyleProp<TextStyle>;
    htmlReplyReferenceFloorText: StyleProp<TextStyle>;
    htmlReplyReferenceLabel: StyleProp<TextStyle>;
    htmlReplyReferenceMentionText: StyleProp<TextStyle>;
    htmlReplyReferenceRow: StyleProp<ViewStyle>;
    htmlReplyReferenceSeparator: StyleProp<TextStyle>;
    inlineForumImage: StyleProp<ImageStyle>;
    inlineForumImageText: StyleProp<TextStyle>;
  };
  theme: ReaderTheme;
  topicDetail: TopicDetail | null;
  topicKey: string;
}) {
  const inlineSizedImageUrls = useMemo<Record<string, true>>(() => ({}), [selectedTopic?.id, selectedTopic?.source]);

  const topicImageDeriver = useMemo(
    () => createTopicImageDeriver(),
    [topicKey]
  );

  const {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlTagsStyles
  } = useMemo(() => buildHtmlRenderingStyles({ settings, theme }), [
    settings.fontFamily,
    settings.fontScale,
    settings.lineHeight,
    theme
  ]);
  const openHtmlLink = useCallback((href: string, event?: { stopPropagation?: () => void }) => {
    if (isPreviewableImageUrl(href)) {
      event?.stopPropagation?.();
      onOpenImagePreview(href);
      return;
    }
    const baseUrl = selectedTopic?.url || topicDetail?.url;
    const candidates = [
      ...(selectedTopic ? [selectedTopic] : []),
      ...(topicDetail ? [topicDetail, ...(topicDetail.replies || [])] : [])
    ];
    const appUser = parseForumUserLink(href, baseUrl, candidates);
    if (appUser) {
      event?.stopPropagation?.();
      void onOpenUser(appUser);
      return;
    }
    const appTopic = parseForumTopicLink(href, baseUrl);
    if (appTopic) {
      event?.stopPropagation?.();
      void onOpenTopic(appTopic);
      return;
    }
    if (isHttpOrHttpsUrl(href)) {
      onOpenExternalUrl(href);
    }
  }, [onOpenExternalUrl, onOpenImagePreview, onOpenTopic, onOpenUser, selectedTopic, topicDetail]);
  const htmlRenderers = useMemo<HtmlRenderers>(() => {
    const ReplyReferenceRenderer: CustomBlockRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const mention = attributes['data-mention'] || '';
      const floor = attributes['data-floor'] || '';
      const userHref = attributes['data-user-href'] || '';
      if (!mention && !floor) {
        return null;
      }
      return (
        <View style={styles.htmlReplyReferenceRow}>
          <Text style={styles.htmlReplyReferenceLabel}>回复</Text>
          {mention ? (
            <Pressable accessibilityRole="link" disabled={!userHref} onPress={(event) => openHtmlLink(userHref, event)}>
              <Text style={styles.htmlReplyReferenceMentionText}>{mention}</Text>
            </Pressable>
          ) : null}
          {mention && floor ? <Text style={styles.htmlReplyReferenceSeparator}>·</Text> : null}
          {floor ? <Text style={styles.htmlReplyReferenceFloorText}>{floor}</Text> : null}
        </View>
      );
    };
    const ReplyReferenceLinkRenderer: CustomMixedRenderer = (props) => {
      const className = String(props.tnode.attributes?.class || '');
      const isMentionLink = className.split(/\s+/).includes('forum-mention-link');
      const isFloorLink = className.split(/\s+/).includes('forum-floor-link');
      if (!isMentionLink && !isFloorLink) {
        const { InternalRenderer, ...internalRendererProps } = props;
        return <InternalRenderer {...internalRendererProps} />;
      }
      const nativeProps = getNativePropsForTNode(props);
      if (isFloorLink) {
        const { accessibilityRole: _accessibilityRole, onPress: _onPress, ...textProps } = nativeProps;
        return <Text {...textProps} style={[textProps.style, styles.htmlFloorLink]} />;
      }
      const href = props.tnode.attributes?.href || '';
      return (
        <Text
          {...nativeProps}
          accessibilityRole="link"
          onPress={(event) => openHtmlLink(href, event)}
          style={[nativeProps.style, styles.htmlMentionLink]}
        />
      );
    };
    const VideoEmbedBlock = ({ embedUrl }: { embedUrl: string }) => (
      <View style={[embedStyles.videoFrame, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
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
      </View>
    );
    const ForumVideoStickerRenderer: CustomBlockRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const src = attributes.src || '';
      const fallbackSrc = attributes['data-fallback-src'] || '';
      const contentWidth = useContentWidth();
      const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
      if (!src) {
        return fallbackSrc ? <Image source={imageSourceFromUrl(fallbackSrc, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, size]} /> : null;
      }
      if (!isVideoStickerUrl(src)) {
        return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, size]} />;
      }
      const headers = videoStickerRequestHeaders(src, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent);
      return (
        <ForumVideoStickerVideo
          key={`${src}:${headers?.Cookie ? 'auth' : 'anonymous'}`}
          fallbackSrc={fallbackSrc}
          headers={headers}
          loadingColor={theme.primary}
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
      return <ForumContentVideo src={src} theme={theme} />;
    };
    const ForumStickerRenderer: CustomMixedRenderer = (props) => {
      const attributes = props.tnode.attributes || {};
      const src = attributes.src || '';
      const contentWidth = useContentWidth();
      const size = inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth);
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
      }
      return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, size]} />;
    };
    const ForumStickerRowRenderer: CustomBlockRenderer = (props) => {
      return (
        <View style={embedStyles.stickerRow}>
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
              {iconSrc ? <ExpoImage contentFit="contain" source={imageSourceFromUrl(iconSrc, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={embedStyles.linkCardIcon} /> : null}
              {site ? <Text numberOfLines={1} style={[embedStyles.linkCardSite, { color: theme.muted }]}>{site}</Text> : null}
            </View>
          ) : null}
          <View style={embedStyles.linkCardBody}>
            {imageSrc ? <ExpoImage contentFit="cover" source={imageSourceFromUrl(imageSrc, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[embedStyles.linkCardThumbnail, { backgroundColor: theme.surface2 }]} /> : null}
            <View style={embedStyles.linkCardText}>
              <Text numberOfLines={3} style={[embedStyles.linkCardTitle, { color: theme.primaryStrong }]}>{title}</Text>
              {description ? <Text numberOfLines={3} style={[embedStyles.linkCardDescription, { color: theme.ink }]}>{description}</Text> : null}
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
    const PreviewImageRenderer: CustomBlockRenderer = (props) => {
      const [nativeImageLoadState, setNativeImageLoadState] = useState({ src: '', loaded: false });
      const contentWidth = useContentWidth();
      const imageProps = useIMGElementProps(props);
      const src = props.tnode.attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
      const nativeImageLoaded = nativeImageLoadState.src === src && nativeImageLoadState.loaded;
      const imageSource = imageSourceFromUrl(src, imageProps.source, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent);
      const imageState = useIMGElementState({
        ...imageProps,
        source: imageSource,
        style: [imageProps.style, { resizeMode: 'contain' }]
      });
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{props.tnode.attributes.alt || props.tnode.attributes.title || ''}</Text>;
      }
      if (isInlineForumImage(props.tnode.attributes)) {
        return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(props.tnode.attributes, settings.fontScale, contentWidth), inlineForumImageAlignmentStyle(props.tnode.attributes, settings.fontScale, htmlBaseStyle.lineHeight)]} />;
      }
      const { width: _width, height: _height, ...containerStyle } = StyleSheet.flatten(imageState.containerStyle) || {};
      const sharedContainerStyle = [{ flexDirection: 'row' as const, alignSelf: 'stretch' as const, justifyContent: 'center' as const }, containerStyle];
      const imageStateFrameStyle = [{
        alignItems: 'center' as const,
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderWidth: StyleSheet.hairlineWidth,
        justifyContent: 'center' as const,
        overflow: 'hidden' as const
      }, imageState.dimensions];
      const imageLoadingOverlayStyle = [StyleSheet.absoluteFillObject, imageStateFrameStyle];
      const showImageLoading = shouldShowPreviewImageLoading(imageState.type, nativeImageLoaded);
      const content = imageState.type === 'success' ? (
        <View style={[{ overflow: 'hidden' as const }, imageState.dimensions]}>
          <ExpoImage
            contentFit="contain"
            recyclingKey={src}
            source={imageState.source}
            style={[imageState.dimensions, imageState.imageStyle, nativeImageLoaded ? null : { opacity: 0 }]}
            onLoadStart={() => setNativeImageLoadState({ src, loaded: false })}
            onLoadEnd={() => setNativeImageLoadState({ src, loaded: true })}
            onError={(event) => {
              setNativeImageLoadState({ src, loaded: true });
              imageState.onError(new Error(event.error));
            }}
          />
          {showImageLoading ? (
            <View style={imageLoadingOverlayStyle}>
              <ActivityIndicator color={theme.primary} size="small" />
            </View>
          ) : null}
        </View>
      ) : showImageLoading ? (
        <View style={imageStateFrameStyle}>
          <ActivityIndicator color={theme.primary} size="small" />
        </View>
      ) : (
        <View style={imageStateFrameStyle}>
          <Text numberOfLines={2} style={styles.inlineForumImageText}>{imageState.alt || '图片加载失败'}</Text>
        </View>
      );
      return (
        <Pressable
          accessibilityLabel={imageState.alt || '查看图片'}
          accessibilityRole="button"
          style={sharedContainerStyle}
          onPress={(event) => {
            event.stopPropagation?.();
            onOpenImagePreview(src);
          }}
        >
          {content}
        </Pressable>
      );
    };
    const InlineForumImageRenderer: CustomMixedRenderer = (props) => {
      const contentWidth = useContentWidth();
      const attributes = ((props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {});
      const src = attributes.src || '';
      const label = attributes.alt || attributes.title || '';
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{label}</Text>;
      }
      const isInlineImage = isInlineForumImage(attributes);
      if (isInlineImage) {
        return <Image source={imageSourceFromUrl(src, undefined, nodeSeekMediaCookieHeader, nodeSeekMediaUserAgent)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(attributes, settings.fontScale, contentWidth), inlineForumImageAlignmentStyle(attributes, settings.fontScale, htmlBaseStyle.lineHeight)]} />;
      }
      return <Text style={styles.inlineForumImageText}>{label || src}</Text>;
    };
    return {
      a: ReplyReferenceLinkRenderer,
      [FORUM_INLINE_MEDIA_LINE_TAG]: ForumInlineMediaLineRenderer,
      [FORUM_STICKER_ROW_TAG]: ForumStickerRowRenderer,
      [FORUM_STICKER_TAG]: ForumStickerRenderer,
      [FORUM_LINK_CARD_TAG]: LinkCardRenderer,
      [FORUM_VIDEO_TAG]: ForumVideoRenderer,
      [FORUM_VIDEO_STICKER_TAG]: ForumVideoStickerRenderer,
      iframe: IframeRenderer,
      img: PreviewImageRenderer,
      [FORUM_REPLY_REFERENCE_TAG]: ReplyReferenceRenderer,
      [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer
    };
  }, [
    htmlBaseStyle.lineHeight,
    nodeSeekMediaCookieHeader,
    nodeSeekMediaUserAgent,
    onOpenImagePreview,
    openHtmlLink,
    settings.fontScale,
    styles.htmlFloorLink,
    styles.htmlMentionLink,
    styles.htmlReplyReferenceFloorText,
    styles.htmlReplyReferenceLabel,
    styles.htmlReplyReferenceMentionText,
    styles.htmlReplyReferenceRow,
    styles.htmlReplyReferenceSeparator,
    styles.inlineForumImage,
    styles.inlineForumImageText,
    theme.ink,
    theme.line,
    theme.mist,
    theme.muted,
    theme.primary,
    theme.primaryStrong,
    theme.surface,
    theme.surface2
  ]);

  const htmlRenderersProps = useMemo<HtmlRenderersProps>(() => {
    const listRendererProps = {
      enableDynamicMarkerBoxWidth: true,
      markerBoxStyle: {
        paddingRight: Math.round(6 * settings.fontScale)
      },
      markerTextStyle: {
        color: theme.ink,
        fontFamily: fontFamilyValue(settings.fontFamily),
        fontSize: Math.round(16 * settings.fontScale),
        lineHeight: Math.round(16 * settings.fontScale * lineHeightMultiplier(settings.lineHeight))
      }
    };
    return {
      a: {
        onPress: (event, href) => openHtmlLink(href, event)
      },
      img: {
        enableExperimentalPercentWidth: true
      },
      ol: listRendererProps,
      ul: listRendererProps
    };
  }, [openHtmlLink, settings.fontFamily, settings.fontScale, settings.lineHeight, theme.ink]);

  return {
    htmlBaseStyle,
    htmlClassesStyles,
    htmlIgnoredStyles,
    htmlRenderers,
    htmlRenderersProps,
    htmlTagsStyles,
    inlineSizedImageUrls,
    topicImageDeriver
  };
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
  }
});
