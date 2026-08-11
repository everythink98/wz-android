import { useMemo } from 'react';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { imageRequestHeadersForUrl } from '@/platform/media/imageRequestSource';
import { ForumContentVideo, type ForumContentVideoAdmission } from '@/ui/content/ForumContentVideo';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTopicBodyMediaLease } from './TopicBodyMediaCoordinator';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { ManagedTopicMediaImage } from './ManagedTopicMediaImage';

export function ManagedTopicContentVideo({
  boundarySpacing,
  mediaContext,
  nodeSeekMediaUserAgent,
  poster,
  referrerPolicy,
  src,
  theme
}: {
  boundarySpacing?: StyleProp<ViewStyle>;
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  poster?: string;
  referrerPolicy?: MediaReferrerPolicy;
  src: string;
  theme: ReaderTheme;
}) {
  const requestHeaders = useMemo(
    () => imageRequestHeadersForUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent, referrerPolicy }),
    [mediaContext, nodeSeekMediaUserAgent, referrerPolicy, src]
  );
  const resolvedReferer = requestHeaders?.Referer || 'none';
  const admission = useTopicBodyMediaLease({
    automaticRetry: false,
    kind: 'video',
    requestIdentity: `video:${mediaContext.sessionIdentity}:${src}:referrer:${resolvedReferer}`
  }) satisfies ForumContentVideoAdmission;
  return (
    <ForumContentVideo
      admission={admission}
      boundarySpacing={boundarySpacing}
      mediaContext={mediaContext}
      nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
      poster={
        poster ? (
          <ManagedTopicMediaImage
            contentFit="cover"
            decorative
            kind="poster"
            mediaContext={mediaContext}
            nodeSeekMediaUserAgent={nodeSeekMediaUserAgent}
            referrerPolicy={referrerPolicy}
            src={poster}
            style={StyleSheet.absoluteFillObject}
          />
        ) : undefined
      }
      referrerPolicy={referrerPolicy}
      src={src}
      theme={theme}
    />
  );
}
