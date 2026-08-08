import { useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type RenderHTML from 'react-native-render-html';
import { TChildrenRenderer, useContentWidth, type CustomBlockRenderer, type TNode } from 'react-native-render-html';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG,
  inlineForumImageDisplaySize
} from '@/platform/media/inlineMedia';
import { imageSourceFromUrl, normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import { cachedImageDisplayDimensions, rememberImageDisplayDimensions } from '@/platform/media/imageDisplayDimensions';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';

type ForumStickerRenderersOptions = {
  fontScale: number;
  imageStyle?: StyleProp<ImageStyle>;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  nodeSeekMediaUserAgent?: string;
  textStyle?: StyleProp<TextStyle>;
  trimsTrailingBlockSpacing?: (tnode: TNode) => boolean;
};

export function createForumStickerRenderers({
  fontScale,
  imageStyle,
  mediaContext,
  mediaSessionIdentity,
  nodeSeekMediaUserAgent,
  textStyle,
  trimsTrailingBlockSpacing = () => false
}: ForumStickerRenderersOptions) {
  const ForumStickerRenderer: CustomBlockRenderer = (props) => {
    const attributes = props.tnode.attributes || {};
    const src = attributes.src || '';
    const label = attributes.alt || attributes.title || '';
    const contentWidth = useContentWidth();
    const normalizedSrc = normalizeImagePreviewUrl(src).trim();
    const cacheKey = normalizedSrc ? `${mediaSessionIdentity}:${normalizedSrc}` : '';
    const [loadedDimensions, setLoadedDimensions] = useState<{
      cacheKey: string;
      dimensions: { height: number; width: number };
    } | null>(null);
    const naturalDimensions =
      loadedDimensions?.cacheKey === cacheKey
        ? loadedDimensions.dimensions
        : cacheKey
          ? cachedImageDisplayDimensions(cacheKey)
          : undefined;
    const size = inlineForumImageDisplaySize(attributes, fontScale, contentWidth, naturalDimensions);
    if (!src) {
      return <Text style={textStyle}>{label}</Text>;
    }
    return (
      <ExpoImage
        accessibilityLabel={label || '表情'}
        accessibilityRole="image"
        accessible
        contentFit="contain"
        onLoad={(event) => {
          const dimensions = { height: event.source.height, width: event.source.width };
          if (
            !cacheKey ||
            !Number.isFinite(dimensions.height) ||
            !Number.isFinite(dimensions.width) ||
            !(dimensions.height > 0 && dimensions.width > 0)
          ) {
            return;
          }
          rememberImageDisplayDimensions(cacheKey, dimensions);
          setLoadedDimensions({ cacheKey, dimensions });
        }}
        recyclingKey={`${mediaSessionIdentity}:${src}`}
        source={imageSourceFromUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent })}
        style={[styles.image, imageStyle, size]}
      />
    );
  };

  const ForumStickerRowRenderer: CustomBlockRenderer = (props) => (
    <View style={[styles.stickerRow, trimsTrailingBlockSpacing(props.tnode) ? styles.trimmedStickerRow : null]}>
      <TChildrenRenderer tchildren={props.tnode.children} />
    </View>
  );

  const ForumInlineMediaLineRenderer: CustomBlockRenderer = (props) => (
    <View style={styles.inlineMediaLine}>
      <TChildrenRenderer tchildren={props.tnode.children} />
    </View>
  );

  return {
    [FORUM_INLINE_MEDIA_LINE_TAG]: ForumInlineMediaLineRenderer,
    [FORUM_STICKER_ROW_TAG]: ForumStickerRowRenderer,
    [FORUM_STICKER_TAG]: ForumStickerRenderer
  } satisfies NonNullable<ComponentProps<typeof RenderHTML>['renderers']>;
}

const styles = StyleSheet.create({
  image: {
    marginHorizontal: 2
  },
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
  trimmedStickerRow: {
    marginBottom: -4
  }
});
