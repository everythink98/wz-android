import { useLayoutEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createTopicListItemStateStore, type TopicListItemStateIndex } from '@/domain/forum/topicListItemState';
import { siteSessionIdentityKey, type SiteSessionViewModels } from '@/domain/session/siteSessionState';
import { createTopicEntryPrefetch } from '@/features/topic/model/topicEntryQuery';
import type { ForumSessionEpochs } from '@/platform/query/sessionEpochs';
import type { ReadGateway } from '@/sources/readGateway';
import type { Source } from '@/domain/forum/models';
import { useLatestCallback } from '@/ui/hooks/useLatestCallback';
import { installTopicRouteDispatch } from '@/ui/navigation/appRouteActions';
import type { Screen } from '@/ui/navigation/types';
import { hasAppRoute, navigationRef } from './appNavigation';

export function useAppTopicNavigationRuntime({
  appActive,
  enabledSources,
  readGateway,
  sessionEpochs,
  sessions,
  sessionsReady,
  publishNavigationScreen,
  cardIndex
}: {
  appActive: boolean;
  enabledSources: readonly Source[];
  readGateway: ReadGateway;
  sessionEpochs: ForumSessionEpochs;
  sessions: SiteSessionViewModels;
  sessionsReady: boolean;
  publishNavigationScreen: (screen: Screen, routeKey: string) => void;
  cardIndex: TopicListItemStateIndex;
}) {
  const queryClient = useQueryClient();
  const [entryPrefetch] = useState(() => createTopicEntryPrefetch(queryClient));
  const [topicStateIndex] = useState(() => createTopicListItemStateStore(cardIndex));
  useLayoutEffect(() => topicStateIndex.setIndex(cardIndex), [cardIndex, topicStateIndex]);

  const dispatchTopic = useLatestCallback((dispatch: () => void) => {
    const previousKey = navigationRef.getCurrentRoute()?.key;
    dispatch();
    const route = navigationRef.getCurrentRoute();
    if (route?.name !== 'Topic' || route.key === previousKey || !appActive || !sessionsReady) return;
    const destination = route.params;
    if (!destination || !enabledSources.includes(destination.topic.source)) return;
    const linuxDo = sessions.linuxdo;
    const identityKey =
      linuxDo.identityTrust === 'confirmed' && linuxDo.isLoggedIn ? siteSessionIdentityKey(linuxDo) : undefined;
    entryPrefetch.start({
      routeKey: route.key,
      topic: destination.topic,
      sessionEpochs,
      readGateway,
      policyAccount: identityKey ? { identityKey, sessionEpoch: sessionEpochs.linuxdo } : undefined
    });
  });
  useLayoutEffect(() => installTopicRouteDispatch(dispatchTopic), [dispatchTopic]);
  useLayoutEffect(() => () => entryPrefetch.discardRemoved(() => false), [entryPrefetch]);
  const onScreenChange = useLatestCallback((screen: Screen, routeKey: string) => {
    publishNavigationScreen(screen, routeKey);
    entryPrefetch.discardRemoved(hasAppRoute);
  });
  return { entryPrefetch, topicStateIndex, onScreenChange };
}
