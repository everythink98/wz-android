import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle } from 'react-native';
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
import { parseForumTopicLink } from '../appUtils';
import { fontFamilyValue, lineHeightMultiplier, type ReaderTheme } from '../theme';
import type { Topic, TopicDetail } from '../types';
import type { HtmlBaseStyle, HtmlIgnoredStyles, HtmlRenderers, HtmlRenderersProps, HtmlTagsStyles } from '../appTypes';

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

  const htmlBaseStyle = useMemo<HtmlBaseStyle>(() => ({
    color: theme.ink,
    fontFamily: fontFamilyValue(settings.fontFamily),
    fontSize: Math.round(16 * settings.fontScale),
    lineHeight: Math.round(16 * settings.fontScale * lineHeightMultiplier(settings.lineHeight))
  }), [settings.fontFamily, settings.fontScale, settings.lineHeight, theme.ink]);
  const htmlTagsStyles = useMemo<HtmlTagsStyles>(() => {
    const htmlParagraph = {
      color: theme.ink,
      marginBottom: 10,
      marginTop: 6
    };
    return {
      body: {
        color: theme.ink,
        backgroundColor: 'transparent'
      },
      p: htmlParagraph,
      div: {
        color: theme.ink
      },
      span: {
        color: theme.ink
      },
      h1: {
        color: theme.ink,
        fontWeight: '700',
        lineHeight: Math.round(28 * settings.fontScale),
        marginBottom: 8,
        marginTop: 18
      },
      h2: {
        color: theme.ink,
        fontWeight: '700',
        lineHeight: Math.round(26 * settings.fontScale),
        marginBottom: 8,
        marginTop: 18
      },
      h3: {
        color: theme.ink,
        fontWeight: '600',
        lineHeight: Math.round(24 * settings.fontScale),
        marginBottom: 6,
        marginTop: 16
      },
      h4: {
        color: theme.ink,
        fontWeight: '600'
      },
      h5: {
        color: theme.ink,
        fontWeight: '600'
      },
      h6: {
        color: theme.muted,
        fontWeight: '600'
      },
      a: {
        color: theme.primary,
        textDecorationColor: theme.primary,
        textDecorationLine: 'underline'
      },
      img: { borderRadius: 8 },
      strong: {
        color: theme.ink
      },
      b: {
        color: theme.ink
      },
      em: {
        color: theme.ink
      },
      li: {
        color: theme.ink,
        marginBottom: 4
      },
      ul: {
        color: theme.ink,
        marginBottom: 10,
        marginTop: 8
      },
      ol: {
        color: theme.ink,
        marginBottom: 10,
        marginTop: 8
      },
      blockquote: {
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderWidth: StyleSheet.hairlineWidth,
        color: theme.muted,
        marginBottom: 12,
        marginTop: 12,
        paddingHorizontal: 13,
        paddingVertical: 11
      },
      pre: {
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 8,
        marginBottom: 12,
        marginTop: 12,
        padding: 12
      },
      code: {
        backgroundColor: 'transparent',
        color: theme.ink
      },
      mark: {
        backgroundColor: theme.surface2,
        color: theme.ink
      },
      table: {
        backgroundColor: 'transparent',
        borderColor: theme.line,
        borderWidth: StyleSheet.hairlineWidth
      },
      th: {
        color: theme.ink,
        backgroundColor: theme.surface2,
        borderColor: theme.line,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 8,
        paddingVertical: 7
      },
      td: {
        color: theme.ink,
        borderColor: theme.line,
        borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 8,
        paddingVertical: 7
      }
    };
  }, [settings.fontScale, theme]);
  const htmlIgnoredStyles = useMemo<HtmlIgnoredStyles>(() => [
    'backgroundColor',
    'borderTopColor',
    'borderRightColor',
    'borderBottomColor',
    'borderLeftColor',
    'color',
    'outlineColor',
    'textDecorationColor'
  ], []);
  const htmlRenderers = useMemo<HtmlRenderers>(() => {
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
    return { img: PreviewImageRenderer, [INLINE_FORUM_IMAGE_TAG]: InlineForumImageRenderer };
  }, [htmlBaseStyle.lineHeight, markImageInlineSized, onOpenImagePreview, settings.fontScale, styles.inlineForumImage, styles.inlineForumImageText, theme.line]);

  const htmlRenderersProps = useMemo<HtmlRenderersProps>(() => ({
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
    }
  }), [onOpenExternalUrl, onOpenImagePreview, onOpenTopic, selectedTopic?.url, topicDetail?.url]);

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
