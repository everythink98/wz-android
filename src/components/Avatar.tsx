import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SvgXml } from 'react-native-svg';
import { loadRemoteAvatarSvgText } from '../avatarImages';
import { imageSourceFromUrl } from '../htmlImages';
import { useForumMediaRequestContext } from '../mediaSessionEpoch';
import type { createStyles } from '../theme';
import type { Source } from '../types';

const MAX_IMAGE_RETRY_COUNT = 1;

type GraphemeSegmenter = {
  segment: (value: string) => Iterable<{ segment: string }>;
};

export function avatarInitial(name?: string) {
  const text = (name || '').trim();
  if (!text) {
    return '?';
  }
  const Segmenter = (globalThis.Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter } | undefined)?.Segmenter;
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
  styles,
  uri
}: {
  contentSource: Source | null;
  name?: string;
  small?: boolean;
  tiny?: boolean;
  styles: ReturnType<typeof createStyles>;
  uri?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);
  const [svgXml, setSvgXml] = useState<string | null>(null);
  const mediaContext = useForumMediaRequestContext(contentSource);
  const mediaSessionIdentity = mediaContext.sessionIdentity;

  useEffect(() => {
    let cancelled = false;
    setImageFailed(false);
    setImageRetryCount(0);
    setSvgXml(null);
    if (!uri) {
      return () => {
        cancelled = true;
      };
    }
    loadRemoteAvatarSvgText(uri, undefined, {
      mediaContext
    }).then((xml) => {
      if (!cancelled) {
        setSvgXml(xml);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mediaContext, mediaSessionIdentity, uri]);

  const retryOrFailImage = useCallback(() => {
    if (imageRetryCount < MAX_IMAGE_RETRY_COUNT) {
      setImageRetryCount((current) => current + 1);
      return;
    }
    setImageFailed(true);
  }, [imageRetryCount]);

  return (
    <View style={[styles.replyAvatar, tiny ? styles.feedAvatarTiny : small ? styles.replyAvatarSmall : styles.topicAvatar]}>
      <Text style={[styles.replyAvatarText, (small || tiny) && styles.replyAvatarSmallText]}>{avatarInitial(name)}</Text>
      {svgXml ? (
        <View style={StyleSheet.absoluteFillObject}>
          <SvgXml
            xml={svgXml}
            width="100%"
            height="100%"
          />
        </View>
      ) : uri && !imageFailed ? (
        <ExpoImage
          key={`${mediaSessionIdentity}:${uri}:${imageRetryCount}`}
          source={imageSourceFromUrl(uri, { mediaContext })}
          style={[styles.replyAvatarImage, StyleSheet.absoluteFillObject]}
          contentFit="cover"
          recyclingKey={`${mediaSessionIdentity}:${uri}:${imageRetryCount}`}
          cachePolicy={imageRetryCount > 0 ? 'none' : undefined}
          onError={retryOrFailImage}
        />
      ) : null}
    </View>
  );
}
