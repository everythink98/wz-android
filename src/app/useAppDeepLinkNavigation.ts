import { useCallback, useEffect, useRef } from 'react';
import { Linking } from 'react-native';
import { parseInternalTopicOpenLink } from '@/domain/forum/links';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { pushTopicRoute } from './appNavigation';

export function useAppDeepLinkNavigation(
  linking: Pick<typeof Linking, 'addEventListener' | 'getInitialURL'> = Linking,
  pushTopic: typeof pushTopicRoute = pushTopicRoute
) {
  const pendingDestinationRef = useRef<RootStackParamList['Topic'] | null>(null);
  const openUrl = useCallback(
    (url: string | null) => {
      const destination = url ? parseInternalTopicOpenLink(url) : null;
      if (!destination) return;
      if (!pushTopic(destination)) pendingDestinationRef.current = destination;
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
    const destination = pendingDestinationRef.current;
    if (!destination) return;
    pendingDestinationRef.current = null;
    pushTopic(destination);
  }, [pushTopic]);
}
