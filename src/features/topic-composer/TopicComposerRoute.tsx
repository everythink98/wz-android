import { useCallback, useEffect, useState } from 'react';
import { useIsFocused, usePreventRemove, StackActions, type NavigationAction } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Topic, TopicDetail } from '@/domain/forum/models';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import { useTopicComposerRouteRuntime } from './TopicComposerRouteRuntime';
import { useTopicComposerController } from './useTopicComposerController';
import { TopicComposerScreen } from './TopicComposerScreen';
import { useQueryClient } from '@tanstack/react-query';
import { isRecord } from '@/domain/forum/html';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

export function TopicComposerRoute({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'TopicComposer'>) {
  const runtime = useTopicComposerRouteRuntime();
  const queryClient = useQueryClient();
  const runtimeRef = useCommittedRef(runtime);
  const focused = useIsFocused();
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
      const epoch = runtimeRef.current.sessionEpochs[source];
      const topics = queryClient.getQueryCache().findAll({
        predicate: ({ queryKey }) =>
          queryKey[0] === 'forum' &&
          queryKey[1] === source &&
          queryKey[2] === 'topic' &&
          queryKey.length === 4 &&
          isRecord(queryKey[3]) &&
          queryKey[3].topicId === topicId &&
          queryKey[3].sessionEpoch === epoch
      });
      const previous = topics[0]?.state.data as TopicDetail | undefined;
      if (previous) {
        // linux.do's settled visit observer intentionally disables automatic detail refetches.
        // Refresh the opening explicitly without replacing any loaded reply window or route.
        void queryClient
          .cancelQueries({ predicate: (query) => topics.includes(query) })
          .then(async () => {
            const fresh = await runtimeRef.current.getTopic({
              source,
              id: topicId,
              topic: previous,
              trackVisit: false
            });
            if (runtimeRef.current.sessionEpochs[source] !== epoch) return;
            for (const query of topics)
              queryClient.setQueryData<TopicDetail>(query.queryKey, (current) =>
                current
                  ? {
                      ...fresh,
                      replies: current.replies,
                      replyHasMore: current.replyHasMore,
                      replyNextPage: current.replyNextPage,
                      replyNextOffset: current.replyNextOffset,
                      replyCompleteness: current.replyCompleteness
                    }
                  : current
              );
          })
          .catch(() => runtimeRef.current.notify('修改已保存，正文刷新失败，可在主题菜单刷新全文'));
      }
      void queryClient.invalidateQueries({
        predicate: ({ queryKey }) => {
          if (queryKey[0] !== 'forum' || (queryKey[1] !== source && queryKey[1] !== 'all')) return false;
          if (queryKey[2] === 'topic')
            return queryKey.length === 4 && isRecord(queryKey[3]) && queryKey[3].topicId === topicId;
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
    onPosted: posted,
    onAccepted: accepted,
    onEdited: edited
  });
  usePreventRemove(!exitAction, ({ data }) => {
    void controller.leave().then((allow) => {
      if (allow) setExitAction(data.action);
    });
  });
  useEffect(() => {
    if (exitAction) navigation.dispatch(exitAction);
  }, [exitAction, navigation]);
  return (
    <TopicComposerScreen
      active={focused && runtime.appActive}
      editorEnabled={entered}
      controller={controller}
      sessions={runtime.sessions}
      enabledSources={runtime.enabledSources}
      onBack={() => navigation.goBack()}
      onOpenAccount={runtime.openAccount}
      onManageSources={() => navigation.dispatch(manageContentSourcesAction())}
    />
  );
}
