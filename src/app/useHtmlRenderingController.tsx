import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  getNativePropsForTNode,
  TChildrenRenderer,
  useIMGElementProps,
  useIMGElementState,
  type CustomBlockRenderer,
  type CustomMixedRenderer
} from 'react-native-render-html';
import type { ReaderSettings } from '../readerData';
import { createTopicImageDeriver } from '../topicDerivedData';
import {
  imageSourceFromUrl,
  inlineForumImageAlignmentStyle,
  inlineForumImageDisplaySize,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  INLINE_FORUM_IMAGE_TAG,
  isHttpOrHttpsUrl,
  isInlineForumImage,
  isPreviewableImageUrl
} from '../htmlImages';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '../nsVideoEmbeds';
import { parseForumTopicLink, parseForumUserLink } from '../appUtils';
import { fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '../theme';
import type { Topic, TopicDetail, UserProfile } from '../types';
import type { HtmlRenderers, HtmlRenderersProps } from '../appTypes';
import { buildHtmlRenderingStyles } from '../htmlRenderingStyles';
import { FORUM_REPLY_REFERENCE_TAG } from '../topicContentHtml';
import { FORUM_VIDEO_STICKER_TAG, FORUM_VIDEO_TAG } from '../localHtml';
import { ForumContentVideo } from '../components/ForumContentVideo';

export function shouldShowPreviewImageLoading(imageStateType: 'loading' | 'success' | 'error', nativeImageLoaded: boolean) {
  return imageStateType === 'loading' || (imageStateType === 'success' && !nativeImageLoaded);
}

export function useHtmlRenderingController({
  onOpenExternalUrl,
  onOpenImagePreview,
  onOpenTopic,
  onOpenUser,
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
      const size = inlineForumImageDisplaySize(attributes, settings.fontScale);
      if (!src) {
        return fallbackSrc ? <Image source={imageSourceFromUrl(fallbackSrc)} style={[styles.inlineForumImage, size]} /> : null;
      }
      return (
        <View pointerEvents="none" style={[styles.inlineForumImage, size, embedStyles.stickerVideoFrame]}>
          <WebView
            allowsInlineMediaPlayback
            javaScriptEnabled={false}
            mediaPlaybackRequiresUserAction={false}
            originWhitelist={['*']}
            scrollEnabled={false}
            source={{ html: forumVideoStickerHtml(src, fallbackSrc) }}
            style={embedStyles.stickerWebView}
          />
        </View>
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
      const size = inlineForumImageDisplaySize(attributes, settings.fontScale);
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{attributes.alt || attributes.title || ''}</Text>;
      }
      return <Image source={imageSourceFromUrl(src)} style={[styles.inlineForumImage, size]} />;
    };
    const ForumStickerRowRenderer: CustomBlockRenderer = (props) => {
      return (
        <View style={embedStyles.stickerRow}>
          <TChildrenRenderer tchildren={props.tnode.children} />
        </View>
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
      const imageProps = useIMGElementProps(props);
      const src = props.tnode.attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
      const nativeImageLoaded = nativeImageLoadState.src === src && nativeImageLoadState.loaded;
      const imageSource = imageSourceFromUrl(src, imageProps.source);
      const imageState = useIMGElementState({
        ...imageProps,
        source: imageSource,
        style: [imageProps.style, { resizeMode: 'contain' }]
      });
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{props.tnode.attributes.alt || props.tnode.attributes.title || ''}</Text>;
      }
      if (isInlineForumImage(props.tnode.attributes)) {
        return <Image source={imageSourceFromUrl(src)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(props.tnode.attributes, settings.fontScale), inlineForumImageAlignmentStyle(props.tnode.attributes, settings.fontScale, htmlBaseStyle.lineHeight)]} />;
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
          <Image
            source={imageState.source}
            style={[{ resizeMode: 'contain' as const }, imageState.dimensions, imageState.imageStyle, nativeImageLoaded ? null : { opacity: 0 }]}
            resizeMethod="none"
            onLoadStart={() => setNativeImageLoadState({ src, loaded: false })}
            onLoadEnd={() => setNativeImageLoadState({ src, loaded: true })}
            onError={(event) => {
              setNativeImageLoadState({ src, loaded: true });
              imageState.onError(event.nativeEvent.error as unknown as Error);
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
      const attributes = ((props.tnode as unknown as { attributes?: Record<string, string | undefined> }).attributes || {});
      const src = attributes.src || '';
      const label = attributes.alt || attributes.title || '';
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{label}</Text>;
      }
      const isInlineImage = isInlineForumImage(attributes);
      if (isInlineImage) {
        return <Image source={imageSourceFromUrl(src)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(attributes, settings.fontScale), inlineForumImageAlignmentStyle(attributes, settings.fontScale, htmlBaseStyle.lineHeight)]} />;
      }
      return <Text style={styles.inlineForumImageText}>{label || src}</Text>;
    };
    return {
      a: ReplyReferenceLinkRenderer,
      [FORUM_STICKER_ROW_TAG]: ForumStickerRowRenderer,
      [FORUM_STICKER_TAG]: ForumStickerRenderer,
      [FORUM_VIDEO_TAG]: ForumVideoRenderer,
      [FORUM_VIDEO_STICKER_TAG]: ForumVideoStickerRenderer,
      iframe: IframeRenderer,
      img: PreviewImageRenderer,
      [FORUM_REPLY_REFERENCE_TAG]: ReplyReferenceRenderer,
      [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer
    };
  }, [
    htmlBaseStyle.lineHeight,
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
    theme.line,
    theme.primary,
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
  stickerRow: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 6,
    marginTop: 4
  },
  stickerVideoFrame: {
    overflow: 'hidden'
  },
  stickerWebView: {
    backgroundColor: 'transparent',
    flex: 1
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

function escapeHtmlAttribute(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function forumVideoStickerHtml(src: string, fallbackSrc: string) {
  const poster = fallbackSrc ? ` poster="${escapeHtmlAttribute(fallbackSrc)}"` : '';
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;}video,img{width:100%;height:100%;object-fit:contain;display:block;background:transparent;}</style></head><body><video autoplay loop muted playsinline webkit-playsinline${poster}><source src="${escapeHtmlAttribute(src)}"></video></body></html>`;
}
