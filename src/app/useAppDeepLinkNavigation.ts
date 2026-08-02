import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import type { Topic } from '@/domain/forum/models';
import { parseInternalTopicOpenLink } from '@/domain/forum/links';
import { pushTopicRoute } from './appNavigation';

export function useAppDeepLinkNavigation(
  linking: Pick<typeof Linking, 'addEventListener' | 'getInitialURL'> = Linking,
  pushTopic: typeof pushTopicRoute = pushTopicRoute
) {
  const pendingTopicRef = useRef<Topic | null>(null);
  const openUrl = useCallback(
    (url: string | null) => {
      const topic = url ? parseInternalTopicOpenLink(url) : null;
      if (topic && !pushTopic(topic)) pendingTopicRef.current = topic;
    },
    [pushTopic]
  );

  useEffect(() => {
    const subscription = linking.addEventListener('url', ({ url }) => openUrl(url));
    void linking
      .getInitialURL()
      .then(openUrl)
      .catch(() => undefined);
    return () => subscription.remove();
  }, [linking, openUrl]);

  return useCallback(() => {
    const topic = pendingTopicRef.current;
    if (!topic) return;
    pendingTopicRef.current = null;
    pushTopic(topic);
  }, [pushTopic]);
}
