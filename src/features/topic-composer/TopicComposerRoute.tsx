import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIsFocused, usePreventRemove, StackActions, type NavigationAction } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Topic, TopicDetail } from '@/domain/forum/models';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import {
  dispatchFocusedRoute,
  goBackFromFocusedRoute,
  manageContentSourcesAction
} from '@/ui/navigation/appRouteActions';
import { useTopicComposerRouteRuntime } from './TopicComposerRouteRuntime';
import { useTopicComposerController } from './useTopicComposerController';
import { TopicComposerScreen } from './TopicComposerScreen';
import { isCancelledError, useQueryClient } from '@tanstack/react-query';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import { forumQueryKeys } from '@/platform/query/serverState';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

export function TopicComposerRoute({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TopicComposer'>) {
  const runtime = useTopicComposerRouteRuntime();
  const queryClient = useQueryClient();
  const runtimeRef = useCommittedRef(runtime);
  const focused = useIsFocused();
  const leaveOwner = useRef({});
  const getTopRouteKey = useCallback(() => {
    const state = navigation.getState();
    return state.routes[state.index]?.key;
  }, [navigation]);
  useLayoutEffect(() => {
    let top = getTopRouteKey();
    const unsubscribe = navigation.addListener('state', ({ data: { state } }) => {
      const next = state.routes[state.index]?.key;
      if (next !== top) {
        top = next;
        leaveOwner.current = {};
      }
    });
    return () => {
      leaveOwner.current = {};
      unsubscribe();
    };
  }, [getTopRouteKey, navigation]);
  const [entered, setEntered] = useState(() => navigation.getState().routes[0]?.key === route.key);
  useEffect(
    () =>
      navigation.addListener('transitionEnd', ({ data }) => {
        if (!data.closing && navigation.isFocused()) setEntered(true);
      }),
    [navigation]
  );
  const [exitAction, setExitAction] = useState<NavigationAction | null>(null);
  const posted = useCallback((topic: Topic) => setExitAction(StackActions.replace('Topic', { topic })), []);
  const accepted = useCallback(() => setExitAction(StackActions.pop()), []);
  const edited = useCallback(
    (source: TopicCreationSource, topicId: string) => {
      const { getReadPlan, sessionEpochs, sessions } = runtimeRef.current;
      const epoch = sessionEpochs[source];
      const identityKey = siteSessionIdentityKey(sessions[source]);
      const plan = getReadPlan(source, 'topic');
      const isCurrent = () =>
        runtimeRef.current.sessionEpochs[source] === epoch &&
        siteSessionIdentityKey(runtimeRef.current.sessions[source]) === identityKey &&
        runtimeRef.current.getReadPlan(source, 'topic').cacheScope === plan.cacheScope;
      const detailKey = forumQueryKeys.topic({
        source,
        scope: sessionEpochs,
        topicId,
        readPlanScope: plan.cacheScope
      });
      const topicCache = queryClient.getQueryCache().find<TopicDetail>({ queryKey: detailKey, exact: true });
      const previous = topicCache?.state.data;
      if (plan.state === 'ready' && plan.lane === 'authenticated' && topicCache && previous) {
        // linux.do's settled visit observer intentionally disables automatic detail refetches.
        // Refresh the opening from the same authority while the reader retains its route and live data.
        const refreshKey = [...detailKey, 'edit-refresh', identityKey];
        queryClient.removeQueries({ queryKey: refreshKey, exact: true });
        void queryClient
          .fetchQuery({
            queryKey: refreshKey,
            gcTime: 0,
            networkMode: 'always',
            retry: false,
            queryFn: async ({ signal }) => {
              await queryClient.cancelQueries({ predicate: (query) => query === topicCache });
              if (signal.aborted || !isCurrent()) return null;
              const fresh = await runtimeRef.current.getTopic(
                { source, id: topicId, topic: previous, trackVisit: false, signal },
                { plan }
              );
              if (
                signal.aborted ||
                !isCurrent() ||
                queryClient.getQueryCache().get(topicCache.queryHash) !== topicCache
              )
                return null;
              queryClient.setQueryData<TopicDetail>(
                detailKey,
                (current) =>
                  current && {
                    ...current,
                    title: fresh.title,
                    category: fresh.category,
                    categoryId: fresh.categoryId,
                    tags: fresh.tags,
                    contentHtml: fresh.contentHtml,
                    preparedContent: fresh.preparedContent,
                    excerpt: fresh.excerpt,
                    mediaReferrer: fresh.mediaReferrer,
                    accessRequirement: fresh.accessRequirement,
                    polls: fresh.polls,
                    policy:
                      current.policy?.postId === fresh.policy?.postId &&
                      current.policy?.version === fresh.policy?.version
                        ? current.policy
                        : fresh.policy
                  }
              );
              return null;
            }
          })
          .catch((error) => {
            if (!isCancelledError(error) && isCurrent()) {
              runtimeRef.current.notify('修改已保存，正文刷新失败，可在主题菜单刷新全文');
            }
          });
      }
      if (plan.state === 'ready' && plan.lane === 'authenticated')
        void queryClient.invalidateQueries({ queryKey: detailKey, exact: true, refetchType: 'none' });
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) => {
          if (queryKey[0] !== 'forum' || (queryKey[1] !== source && queryKey[1] !== 'all')) return false;
          return (
            ['feed', 'search', 'semantic-search'].includes(String(queryKey[2])) ||
            (queryKey[2] === 'user' && queryKey[4] === 'topics')
          );
        },
        refetchType: 'none'
      });
      setExitAction(StackActions.pop());
    },
    [queryClient, runtimeRef]
  );
  const controller = useTopicComposerController({
    runtime,
    intent: route.params,
    active: focused,
    isRouteFocused: navigation.isFocused,
    onPosted: posted,
    onAccepted: accepted,
    onEdited: edited
  });
  usePreventRemove(!exitAction, ({ data }) => {
    const origin = getTopRouteKey();
    const owner = leaveOwner.current;
    void controller.leave().then((allow) => {
      if (!allow || leaveOwner.current !== owner || getTopRouteKey() !== origin) return;
      if (origin === route.key) dispatchFocusedRoute(navigation, data.action);
      else navigation.dispatch(data.action);
    });
  });
  useEffect(() => {
    if (exitAction) navigation.dispatch(exitAction);
  }, [exitAction, navigation]);
  return (
    <TopicComposerScreen
      active={focused && runtime.appActive}
      routeFocus={navigation}
      editorEnabled={entered}
      controller={controller}
      sessions={runtime.sessions}
      enabledSources={runtime.enabledSources}
      onBack={() => goBackFromFocusedRoute(navigation)}
      onOpenAccount={runtime.openAccount}
      onManageSources={() => dispatchFocusedRoute(navigation, manageContentSourcesAction())}
    />
  );
}
