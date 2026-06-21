import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SvgXml } from 'react-native-svg';
import { loadRemoteAvatarSvgText } from '../avatarImages';
import { imageSourceFromUrl } from '../htmlImages';
import { createStyles } from '../theme';

const MAX_IMAGE_RETRY_COUNT = 1;

function avatarInitial(name?: string) {
  return (name || '?').trim().slice(0, 1).toUpperCase() || '?';
}

export function Avatar({
  name,
  small,
  styles,
  uri
}: {
  name?: string;
  small?: boolean;
  styles: ReturnType<typeof createStyles>;
  uri?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);
  const [svgXml, setSvgXml] = useState<string | null>(null);

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
    const controller = new AbortController();
    loadRemoteAvatarSvgText(uri, fetch, { signal: controller.signal }).then((xml) => {
      if (!cancelled) {
        setSvgXml(xml);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [uri]);

  const retryOrFailImage = useCallback(() => {
    if (imageRetryCount < MAX_IMAGE_RETRY_COUNT) {
      setImageRetryCount((current) => current + 1);
      return;
    }
    setImageFailed(true);
  }, [imageRetryCount]);

  return (
    <View style={[styles.replyAvatar, small ? styles.replyAvatarSmall : styles.topicAvatar]}>
      <Text style={[styles.replyAvatarText, small && styles.replyAvatarSmallText]}>{avatarInitial(name)}</Text>
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
          key={`${uri}:${imageRetryCount}`}
          source={imageSourceFromUrl(uri)}
          style={[styles.replyAvatarImage, StyleSheet.absoluteFillObject]}
          contentFit="cover"
          recyclingKey={`${uri}:${imageRetryCount}`}
          cachePolicy={imageRetryCount > 0 ? 'none' : undefined}
          onError={retryOrFailImage}
        />
      ) : null}
    </View>
  );
}
