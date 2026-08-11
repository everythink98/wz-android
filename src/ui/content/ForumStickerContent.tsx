import { useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import type RenderHTML from 'react-native-render-html';
import { TChildrenRenderer, useContentWidth, type CustomBlockRenderer, type TNode } from 'react-native-render-html';
import {
  FORUM_INLINE_MEDIA_LINE_TAG,
  FORUM_STICKER_ROW_TAG,
  FORUM_STICKER_TAG
} from '@/domain/forum/forumContentMedia';
import { inlineForumImageDisplaySize } from '@/platform/media/inlineMedia';
import { imageSourceFromUrl, normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import { cachedImageDisplayDimensions, rememberImageDisplayDimensions } from '@/platform/media/imageDisplayDimensions';
import { compatibleImageRequestIdentity } from '@/platform/media/compatibleImageSources';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { normalizeMediaReferrerPolicy, type MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';

export type ForumStickerImageRenderProps = {
  accessibilityLabel?: string;
  onLoad?: ComponentProps<typeof ExpoImage>['onLoad'];
  recyclingKey: string;
  referrerPolicy?: MediaReferrerPolicy;
  src: string;
  style: ComponentProps<typeof ExpoImage>['style'];
};

type ForumStickerRenderersOptions = {
  fontScale: number;
  imageStyle?: StyleProp<ImageStyle>;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  nodeSeekMediaUserAgent?: string;
  renderImage?: (props: ForumStickerImageRenderProps) => ReactNode;
  textStyle?: StyleProp<TextStyle>;
  useContentBoundarySpacing?: (tnode: TNode) => ViewStyle | undefined;
};

export function createForumStickerRenderers({
  fontScale,
  imageStyle,
  mediaContext,
  nodeSeekMediaUserAgent,
  renderImage,
  textStyle,
  useContentBoundarySpacing = () => undefined
}: ForumStickerRenderersOptions) {
  const ForumStickerRenderer: CustomBlockRenderer = (props) => {
    const attributes = props.tnode.attributes || {};
    const referrerPolicy = normalizeMediaReferrerPolicy(attributes.referrerpolicy);
    const src = attributes.src || '';
    const label = attributes.alt || attributes.title || '';
    const contentWidth = useContentWidth();
    const normalizedSrc = normalizeImagePreviewUrl(src).trim();
    const source = imageSourceFromUrl(src, {
      mediaContext,
      nodeSeekUserAgent: nodeSeekMediaUserAgent,
      referrerPolicy
    });
    const cacheKey = normalizedSrc
      ? typeof (source as { cacheKey?: unknown }).cacheKey === 'string'
        ? String((source as { cacheKey: string }).cacheKey)
        : compatibleImageRequestIdentity(source)
      : '';
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
    const imageProps: ForumStickerImageRenderProps = {
      accessibilityLabel: label || '表情',
      onLoad: (event) => {
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
      },
      recyclingKey: cacheKey,
      ...(referrerPolicy ? { referrerPolicy } : {}),
      src,
      style: [styles.image, imageStyle, size]
    };
    return renderImage ? (
      renderImage(imageProps)
    ) : (
      <ExpoImage
        accessibilityLabel={imageProps.accessibilityLabel}
        accessibilityRole="image"
        accessible
        contentFit="contain"
        onLoad={imageProps.onLoad}
        recyclingKey={imageProps.recyclingKey}
        source={source}
        style={imageProps.style}
      />
    );
  };

  const ForumStickerRowRenderer: CustomBlockRenderer = (props) => {
    const boundarySpacing = useContentBoundarySpacing(props.tnode);
    return (
      <View style={[styles.stickerRow, boundarySpacing]} testID="forum-sticker-row">
        <TChildrenRenderer tchildren={props.tnode.children} />
      </View>
    );
  };

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
  }
});
