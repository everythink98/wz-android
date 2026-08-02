import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SvgXml } from 'react-native-svg';
import { loadRemoteAvatarSvgText } from '@/platform/media/avatarImages';
import { imageSourceFromUrl } from '@/platform/media/imageRequestSource';
import { useForumMediaRequestContext } from '@/platform/media/mediaSessionEpoch';

import type { Source } from '@/domain/forum/models';
import type { ReaderSettings } from '@/domain/reader/readerData';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { fontFamilyValue, type ReaderTheme } from '@/ui/theme/tokens';

const MAX_IMAGE_RETRY_COUNT = 1;

type GraphemeSegmenter = {
  segment: (value: string) => Iterable<{ segment: string }>;
};

export function avatarInitial(name?: string) {
  const text = (name || '').trim();
  if (!text) {
    return '?';
  }
  const Segmenter = (
    globalThis.Intl as unknown as
      { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter } | undefined
  )?.Segmenter;
  const segment = Segmenter
    ? new Segmenter(undefined, { granularity: 'grapheme' }).segment(text)[Symbol.iterator]().next().value?.segment
    : Array.from(text)[0];
  return segment?.toUpperCase() || '?';
}

export function Avatar({
  contentSource,
  name,
  small,
  tiny,
  uri
}: {
  contentSource: Source | null;
  name?: string;
  small?: boolean;
  tiny?: boolean;
  uri?: string;
}) {
  const { styles } = useReaderThemeStyles(createStyles);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);
  const [svgXml, setSvgXml] = useState<string | null>(null);
  const mediaContext = useForumMediaRequestContext(contentSource);
  const mediaSessionIdentity = mediaContext.sessionIdentity;
  const fallbackIdentity = `${mediaSessionIdentity}:${uri || ''}`;
  const fallbackIdentityRef = useRef(fallbackIdentity);

  useLayoutEffect(() => {
    fallbackIdentityRef.current = fallbackIdentity;
    setImageFailed(false);
    setImageRetryCount(0);
    setSvgXml(null);
    return () => {
      fallbackIdentityRef.current = '';
    };
  }, [fallbackIdentity, mediaContext]);

  const loadSvgFallback = useCallback(
    async (requestedUri: string) => {
      const requestedFallbackIdentity = fallbackIdentity;
      const xml = await loadRemoteAvatarSvgText(requestedUri, undefined, {
        mediaContext
      });
      if (fallbackIdentityRef.current === requestedFallbackIdentity) {
        setSvgXml(xml);
      }
    },
    [fallbackIdentity, mediaContext]
  );

  const retryOrFailImage = useCallback(() => {
    if (imageRetryCount < MAX_IMAGE_RETRY_COUNT) {
      setImageRetryCount((current) => current + 1);
      return;
    }
    setImageFailed(true);
    if (uri) {
      void loadSvgFallback(uri);
    }
  }, [imageRetryCount, loadSvgFallback, uri]);

  return (
    <View style={[styles.avatar, tiny ? styles.tiny : small ? styles.small : styles.topic]}>
      <Text style={[styles.text, (small || tiny) && styles.smallText]}>{avatarInitial(name)}</Text>
      {svgXml ? (
        <View style={StyleSheet.absoluteFillObject}>
          <SvgXml xml={svgXml} width="100%" height="100%" />
        </View>
      ) : uri && !imageFailed ? (
        <ExpoImage
          key={`${mediaSessionIdentity}:${uri}:${imageRetryCount}`}
          source={imageSourceFromUrl(uri, { mediaContext })}
          style={[styles.image, StyleSheet.absoluteFillObject]}
          contentFit="cover"
          recyclingKey={`${mediaSessionIdentity}:${uri}:${imageRetryCount}`}
          cachePolicy={imageRetryCount > 0 ? 'none' : undefined}
          onError={retryOrFailImage}
        />
      ) : null}
    </View>
  );
}

function createStyles(theme: ReaderTheme, settings: ReaderSettings) {
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
    image: { width: '100%', height: '100%' },
    text: {
      color: theme.primary,
      fontFamily: fontFamilyValue(settings.fontFamily),
      fontSize: 13,
      fontWeight: '700'
    },
    smallText: { fontSize: 11 }
  });
}
