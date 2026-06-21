import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import {
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
import { parseForumTopicLink } from '../appUtils';
import { fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '../theme';
import type { Topic, TopicDetail } from '../types';
import type { HtmlRenderers, HtmlRenderersProps } from '../appTypes';
import { buildHtmlRenderingStyles } from '../htmlRenderingStyles';

function normalizeImageCacheKey(url: string) {
  return normalizeImagePreviewUrl(url).trim();
}

export function useHtmlRenderingController({
  onOpenExternalUrl,
  onOpenImagePreview,
  onOpenTopic,
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
  selectedTopic: Topic | null;
  settings: ReaderSettings;
  styles: {
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
    htmlIgnoredStyles,
    htmlTagsStyles
  } = useMemo(() => buildHtmlRenderingStyles({ settings, theme }), [
    settings.fontFamily,
    settings.fontScale,
    settings.lineHeight,
    theme
  ]);
  const htmlRenderers = useMemo<HtmlRenderers>(() => {
    const VideoEmbedBlock = ({ embedUrl }: { embedUrl: string }) => (
      <View style={[embedStyles.videoFrame, { borderColor: theme.line, backgroundColor: theme.surface2 }]}>
        <WebView
          allowsFullscreenVideo
          domStorageEnabled
          javaScriptEnabled
          onShouldStartLoadWithRequest={(request) => shouldAllowBilibiliWebViewNavigation(request.url)}
          source={{ uri: embedUrl }}
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
    return { iframe: IframeRenderer, img: PreviewImageRenderer, [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer };
  }, [htmlBaseStyle.lineHeight, markImageInlineSized, onOpenImagePreview, settings.fontScale, styles.inlineForumImage, styles.inlineForumImageText, theme.line, theme.surface2]);

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
        onPress: (event, href) => {
          if (isPreviewableImageUrl(href)) {
            event.stopPropagation?.();
            onOpenImagePreview(href);
            return;
          }
          const appTopic = parseForumTopicLink(href, selectedTopic?.url || topicDetail?.url);
          if (appTopic) {
            event.stopPropagation?.();
            void onOpenTopic(appTopic);
            return;
          }
          if (isHttpOrHttpsUrl(href)) {
            onOpenExternalUrl(href);
          }
        }
      },
      img: {
        enableExperimentalPercentWidth: true
      },
      ol: listRendererProps,
      ul: listRendererProps
    };
  }, [onOpenExternalUrl, onOpenImagePreview, onOpenTopic, selectedTopic?.url, settings.fontFamily, settings.fontScale, settings.lineHeight, theme.ink, topicDetail?.url]);

  return {
    htmlBaseStyle,
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
