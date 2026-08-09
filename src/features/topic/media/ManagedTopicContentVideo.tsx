import type { ForumMediaRequestContext } from '@/platform/media/mediaRequestContext';
import { ForumContentVideo, type ForumContentVideoAdmission } from '@/ui/content/ForumContentVideo';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTopicBodyMediaLease } from './TopicBodyMediaCoordinator';

export function ManagedTopicContentVideo({
  boundarySpacing,
  headers,
  mediaContext,
  mediaSessionIdentity,
  src,
  theme
}: {
  boundarySpacing?: StyleProp<ViewStyle>;
  headers?: Record<string, string>;
  mediaContext: ForumMediaRequestContext;
  mediaSessionIdentity: string;
  src: string;
  theme: ReaderTheme;
}) {
  const admission = useTopicBodyMediaLease({
    kind: 'video',
    requestIdentity: `video:${mediaSessionIdentity}:${src}`
  }) satisfies ForumContentVideoAdmission;
  return (
    <ForumContentVideo
      key={admission.attemptId}
      admission={admission}
      boundarySpacing={boundarySpacing}
      headers={headers}
      mediaContext={mediaContext}
      src={src}
      theme={theme}
    />
  );
}
