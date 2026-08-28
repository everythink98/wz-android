import { useMemo } from 'react';
import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { imageRequestHeadersForUrl } from '@/platform/media/imageRequestSource';
import { ForumContentAudio } from '@/ui/content/ForumContentAudio';
import { ForumContentVideo, type ForumContentMediaAdmission } from '@/ui/content/ForumContentVideo';
import type { ReaderTheme } from '@/ui/theme/tokens';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTopicBodyMediaLease } from './TopicBodyMediaCoordinator';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { ManagedTopicMediaImage } from './ManagedTopicMediaImage';
import { useTopicAudioControl } from './TopicAudioSession';

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
  const { admission } = useManagedTopicContentMediaAdmission(
    'video',
    src,
    mediaContext,
    nodeSeekMediaUserAgent,
    referrerPolicy
  );
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

export function ManagedTopicContentAudio({
  boundarySpacing,
  mediaContext,
  nodeSeekMediaUserAgent,
  referrerPolicy,
  src,
  theme
}: {
  boundarySpacing?: StyleProp<ViewStyle>;
  mediaContext: ForumMediaRequestContext;
  nodeSeekMediaUserAgent?: string;
  referrerPolicy?: MediaReferrerPolicy;
  src: string;
  theme: ReaderTheme;
}) {
  const { admission, requestIdentity } = useManagedTopicContentMediaAdmission(
    'audio',
    src,
    mediaContext,
    nodeSeekMediaUserAgent,
    referrerPolicy
  );
  const control = useTopicAudioControl({
    admission,
    id: requestIdentity,
    mediaContext,
    nodeSeekMediaUserAgent,
    referrerPolicy,
    src
  });
  return <ForumContentAudio boundarySpacing={boundarySpacing} theme={theme} {...control} />;
}

function useManagedTopicContentMediaAdmission(
  kind: 'audio' | 'video',
  src: string,
  mediaContext: ForumMediaRequestContext,
  nodeSeekMediaUserAgent?: string,
  referrerPolicy?: MediaReferrerPolicy
) {
  const requestHeaders = useMemo(
    () => imageRequestHeadersForUrl(src, { mediaContext, nodeSeekUserAgent: nodeSeekMediaUserAgent, referrerPolicy }),
    [mediaContext, nodeSeekMediaUserAgent, referrerPolicy, src]
  );
  const resolvedReferer = requestHeaders?.Referer || 'none';
  const requestIdentity = `${kind}:${mediaContext.sessionIdentity}:${src}:referrer:${resolvedReferer}`;
  const admission = useTopicBodyMediaLease({
    automaticRetry: false,
    kind,
    requestIdentity
  });
  return { admission, requestIdentity } satisfies {
    admission: ForumContentMediaAdmission;
    requestIdentity: string;
  };
}
