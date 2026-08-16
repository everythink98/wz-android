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
      if (!topic) return;
      if (!pushTopic(topic)) pendingTopicRef.current = topic;
    },
    [pushTopic]
  );

  useEffect(() => {
    let active = true;
    const subscription = linking.addEventListener('url', ({ url }) => openUrl(url));
    void linking
      .getInitialURL()
      .then((url) => {
        if (!active) return;
        openUrl(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [linking, openUrl]);

  return useCallback(() => {
    const topic = pendingTopicRef.current;
    if (!topic) return;
    pendingTopicRef.current = null;
    pushTopic(topic);
  }, [pushTopic]);
}
