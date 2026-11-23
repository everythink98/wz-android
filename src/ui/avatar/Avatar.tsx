import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SvgXml } from 'react-native-svg';
import { loadRemoteAvatarSvgText } from '@/platform/media/avatarImages';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';

import type { Source } from '@/domain/forum/models';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { type ReaderStyleSettings, fontFamilyValue, textSizeStyle, type ReaderTheme } from '@/ui/theme/tokens';

type AvatarImageState =
  { kind: 'native'; retryCount: 0 | 1 } | { kind: 'fallback' } | { kind: 'svg'; xml: string } | { kind: 'text' };

type GraphemeSegmenter = {
  segment: (value: string) => Iterable<{ segment: string }>;
};

let graphemeSegmenter: GraphemeSegmenter | undefined;

export function avatarInitial(name?: string) {
  const text = (name || '').trim();
  if (!text) {
    return '?';
  }
  const Segmenter = (
    globalThis.Intl as unknown as
      { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter } | undefined
  )?.Segmenter;
  if (!graphemeSegmenter && Segmenter) graphemeSegmenter = new Segmenter(undefined, { granularity: 'grapheme' });
  const segment = graphemeSegmenter?.segment(text)[Symbol.iterator]().next().value?.segment ?? Array.from(text)[0];
  return segment?.toUpperCase() || '?';
}

export const Avatar = memo(function Avatar({
  contentSource,
  large,
  name,
  small,
  tiny,
  uri
}: {
  contentSource: Source | null;
  large?: boolean;
  name?: string;
  small?: boolean;
  tiny?: boolean;
  uri?: string;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const mediaContext = useForumMediaRequestContext(contentSource);

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, tiny ? styles.tiny : small ? styles.small : large ? styles.large : styles.topic]}
    >
      <Text style={[styles.text, large && styles.largeText, (small || tiny) && styles.smallText]}>
        {avatarInitial(name)}
      </Text>
      {uri ? (
        <AvatarImage
          key={`${contentSource}:${mediaContext.sessionIdentity}:${uri}`}
          imageStyle={styles.image}
          mediaContext={mediaContext}
          uri={uri}
        />
      ) : null}
    </View>
  );
});

function AvatarImage({
  imageStyle,
  mediaContext,
  uri
}: {
  imageStyle: StyleProp<ImageStyle>;
  mediaContext: ForumMediaRequestContext;
  uri: string;
}) {
  const [image, setImage] = useState<AvatarImageState>({ kind: 'native', retryCount: 0 });
  const source = useMemo(() => imageSourceFromUrl(uri, { mediaContext }), [mediaContext, uri]);
  const currentImageRef = useRef(image);
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const publishImage = useCallback((next: AvatarImageState) => {
    currentImageRef.current = next;
    setImage(next);
  }, []);
  const retryOrFailImage = useCallback(() => {
    if (!mountedRef.current || currentImageRef.current !== image || image.kind !== 'native') return;
    if (image.retryCount === 0) {
      publishImage({ kind: 'native', retryCount: 1 });
      return;
    }
    const fallback: AvatarImageState = { kind: 'fallback' };
    publishImage(fallback);
    void loadRemoteAvatarSvgText(uri, undefined, { mediaContext }).then((xml) => {
      if (!mountedRef.current || currentImageRef.current !== fallback) return;
      publishImage(xml ? { kind: 'svg', xml } : { kind: 'text' });
    });
  }, [image, mediaContext, publishImage, uri]);

  if (image.kind === 'svg') {
    return (
      <View style={StyleSheet.absoluteFill}>
        <SvgXml xml={image.xml} width="100%" height="100%" />
      </View>
    );
  }
  if (image.kind !== 'native') return null;
  const imageKey = `${mediaContext.sessionIdentity}:${uri}:${image.retryCount}`;
  return (
    <ExpoImage
      key={imageKey}
      source={source}
      style={[imageStyle, StyleSheet.absoluteFill]}
      contentFit="cover"
      recyclingKey={imageKey}
      cachePolicy={image.retryCount > 0 ? 'none' : undefined}
      onError={retryOrFailImage}
    />
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderStyleSettings) {
  return StyleSheet.create({
    avatar: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 34,
      height: 34,
      overflow: 'hidden',
      backgroundColor: theme.surface2,
      borderColor: theme.line,
      borderRadius: 17,
      borderWidth: StyleSheet.hairlineWidth
    },
    small: { width: 32, height: 32, borderRadius: 16 },
    tiny: { width: 24, height: 24, borderRadius: 12 },
    topic: { width: 42, height: 42, borderRadius: 21 },
    large: { width: 56, height: 56, borderRadius: 28 },
    image: { width: '100%', height: '100%' },
    text: {
      color: theme.primary,
      fontFamily: fontFamilyValue(settings.uiFontFamily),
      ...textSizeStyle(13),
      fontWeight: '700'
    },
    smallText: textSizeStyle(11),
    largeText: textSizeStyle(22)
  });
}
