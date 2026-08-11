import { useMemo, type ComponentProps } from 'react';
import { Image as ExpoImage } from 'expo-image';
import { View, type ImageURISource } from 'react-native';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { compatibleImageRequestIdentity } from '@/platform/media/compatibleImageSources';
import { imageSourceFromUrl, normalizeImagePreviewUrl } from '@/platform/media/imageRequestSource';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import type { ForumStickerImageRenderProps } from '@/ui/content/ForumStickerContent';
import { useTopicBodyMediaLease } from './TopicBodyMediaCoordinator';

export function ManagedTopicMediaImage({
  accessibilityLabel,
  contentFit,
  decorative = false,
  kind,
  mediaContext,
  nodeSeekMediaUserAgent,
  onLoad,
  referrerPolicy,
  src,
  style
}: Omit<ForumStickerImageRenderProps, 'recyclingKey'> & {
  contentFit: ComponentProps<typeof ExpoImage>['contentFit'];
  decorative?: boolean;
  kind: 'poster' | 'sticker';
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
}) {
  const normalizedSrc = normalizeImagePreviewUrl(src).trim();
  const source = useMemo(
    () =>
      imageSourceFromUrl(normalizedSrc, {
        mediaContext,
        nodeSeekUserAgent: nodeSeekMediaUserAgent,
        referrerPolicy
      }) as ImageURISource,
    [mediaContext, nodeSeekMediaUserAgent, normalizedSrc, referrerPolicy]
  );
  const requestIdentity = compatibleImageRequestIdentity(source);
  const lease = useTopicBodyMediaLease({ enabled: Boolean(normalizedSrc), kind, requestIdentity });
  if (!normalizedSrc || !lease.admitted) {
    return <View pointerEvents="none" style={style} />;
  }
  return (
    <ExpoImage
      key={lease.attemptId}
      accessibilityLabel={decorative ? undefined : accessibilityLabel}
      accessibilityRole={decorative ? undefined : 'image'}
      accessible={!decorative}
      allowDownscaling
      cachePolicy="disk"
      contentFit={contentFit}
      onDisplay={() => lease.settle('displayed')}
      onError={() => lease.settle('error')}
      onLoad={onLoad}
      onProgress={(event) => lease.progress(event.loaded)}
      recyclingKey={`${requestIdentity}:${lease.attemptId}`}
      source={source}
      style={style}
    />
  );
}
