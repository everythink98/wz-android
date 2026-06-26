import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import {
  getNativePropsForTNode,
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
  INLINE_FORUM_IMAGE_TAG,
  isForumInlineSizedImage,
  isHttpOrHttpsUrl,
  isInlineForumImage,
  isPreviewableImageUrl,
  normalizeImagePreviewUrl,
  withForumImageDimensions
} from '../htmlImages';
import { nsEmbedFromUrl, shouldAllowBilibiliWebViewNavigation } from '../nsVideoEmbeds';
import { parseForumTopicLink, parseForumUserLink } from '../appUtils';
import { fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '../theme';
import type { Topic, TopicDetail, UserProfile } from '../types';
import type { HtmlRenderers, HtmlRenderersProps } from '../appTypes';
import { buildHtmlRenderingStyles } from '../htmlRenderingStyles';
import { FORUM_REPLY_REFERENCE_TAG } from '../topicContentHtml';

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
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
  const [inlineSizedImageUrls, setInlineSizedImageUrls] = useState<Record<string, true>>({});
  const inlineSizedImageUrlsRef = useRef(inlineSizedImageUrls);
  inlineSizedImageUrlsRef.current = inlineSizedImageUrls;
  useEffect(() => {
    setInlineSizedImageUrls({});
  }, [selectedTopic?.id, selectedTopic?.source]);

  const topicImageDeriver = useMemo(
    () => createTopicImageDeriver(),
    [topicKey]
  );

  const markImageInlineSized = useCallback((url: string) => {
    const clean = normalizeImageCacheKey(url);
    if (!clean || inlineSizedImageUrlsRef.current[clean]) {
      return;
    }
    setInlineSizedImageUrls((current) => current[clean] ? current : { ...current, [clean]: true });
  }, []);

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
    const IframeRenderer: CustomBlockRenderer = (props) => {
      const src = props.tnode.attributes.src || '';
      const embed = nsEmbedFromUrl(src);
      if (embed?.type !== 'bilibili') {
        return null;
      }
      return <VideoEmbedBlock embedUrl={embed.embedUrl} />;
    };
    const PreviewImageRenderer: CustomBlockRenderer = (props) => {
      const imageProps = useIMGElementProps(props);
      const src = props.tnode.attributes.src || (typeof imageProps.source.uri === 'string' ? imageProps.source.uri : '');
      const imageSource = imageSourceFromUrl(src, imageProps.source);
      const imageState = useIMGElementState({
        ...imageProps,
        source: imageSource,
        style: [imageProps.style, { resizeMode: 'contain' }]
      });
      const sizedAttributes = withForumImageDimensions(props.tnode.attributes, imageState.type === 'success' ? imageState.dimensions : null);
      const runtimeInlineSized = !isInlineForumImage(props.tnode.attributes) && isForumInlineSizedImage(imageState.type === 'success' ? imageState.dimensions : null);
      useEffect(() => {
        if (runtimeInlineSized) {
          markImageInlineSized(src);
        }
      }, [markImageInlineSized, runtimeInlineSized, src]);
      if (!src) {
        return <Text style={styles.inlineForumImageText}>{props.tnode.attributes.alt || props.tnode.attributes.title || ''}</Text>;
      }
      if (isInlineForumImage(sizedAttributes)) {
        return <Image source={imageSourceFromUrl(src)} style={[styles.inlineForumImage, inlineForumImageDisplaySize(sizedAttributes, settings.fontScale), inlineForumImageAlignmentStyle(sizedAttributes, settings.fontScale, htmlBaseStyle.lineHeight)]} />;
      }
      const { width: _width, height: _height, ...containerStyle } = StyleSheet.flatten(imageState.containerStyle) || {};
      const sharedContainerStyle = [{ flexDirection: 'row' as const, alignSelf: 'stretch' as const, justifyContent: 'center' as const }, containerStyle];
      const content = imageState.type === 'success' ? (
        <Image
          source={imageState.source}
          style={[{ resizeMode: 'contain' as const }, imageState.dimensions, imageState.imageStyle]}
          resizeMethod="none"
          onError={(event) => imageState.onError(event.nativeEvent.error as unknown as Error)}
        />
      ) : imageState.type === 'loading' ? (
        <View style={imageState.dimensions} />
      ) : (
        <View style={[{ borderColor: theme.line, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' as const, overflow: 'hidden' as const }, imageState.dimensions]}>
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
      iframe: IframeRenderer,
      img: PreviewImageRenderer,
      [FORUM_REPLY_REFERENCE_TAG]: ReplyReferenceRenderer,
      [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer
    };
  }, [
    htmlBaseStyle.lineHeight,
    markImageInlineSized,
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
