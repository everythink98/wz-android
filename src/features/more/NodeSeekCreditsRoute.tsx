import { useLayoutEffect } from 'react';
import { RefreshCw } from 'lucide-react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { ContentSourceDisabledState, RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import { IconButton } from '@/ui/controls/ButtonControls';
import { useMoreRouteRuntime } from './MoreRouteRuntime';
import { useNodeSeekCredits } from './useNodeSeekCredits';
import { NodeSeekCreditsScreen } from './NodeSeekCreditsScreen';

export function NodeSeekCreditsRoute({
  navigation,
  route
}: NativeStackScreenProps<RootStackParamList, 'NodeSeekCredits'>) {
  const runtime = useMoreRouteRuntime();
  const focused = useIsFocused();
  const session = runtime.account.read.sessions.nodeseek;
  const enabled = runtime.account.enabledSessionSources.includes('nodeseek');
  const sameIdentity = session.canWrite && `nodeseek:${session.currentUser?.id}` === route.params.identityKey;
  const currency = route.params.currency ?? 'coin';
  const controller = useNodeSeekCredits({
    active: focused && runtime.account.active && enabled && sameIdentity,
    gateway: runtime.account.read.gateway,
    userId: route.params.userId,
    sessionEpoch: runtime.account.read.sessionEpochs.nodeseek,
    currency
  });
  const { busy, refreshing, refresh } = controller;
  useLayoutEffect(() => {
    navigation.setOptions({
      title: currency === 'coin' ? '鸡腿流水' : '星辰流水',
      headerRight:
        enabled && sameIdentity
          ? () => (
              <IconButton
                iconOnly
                ghost
                icon={RefreshCw}
                iconSize={20}
                label="刷新流水"
                loading={busy || refreshing}
                onPress={() => void refresh()}
              />
            )
          : undefined
    });
  }, [navigation, currency, enabled, sameIdentity, busy, refreshing, refresh]);
  if (!enabled)
    return (
      <ContentSourceDisabledState
        source="nodeseek"
        onBack={navigation.goBack}
        onManage={() => navigation.dispatch(manageContentSourcesAction())}
      />
    );
  if (!sameIdentity)
    return (
      <RecoverableEmptyState
        message="账号已变化或暂不可用，请返回账号中心"
        actionLabel="返回账号中心"
        onAction={navigation.goBack}
      />
    );
  return (
    <NodeSeekCreditsScreen
      currency={controller.currency}
      summary={controller.summary}
      error={controller.error}
      busy={controller.busy}
      refreshing={controller.refreshing}
      loaded={controller.loaded}
      hasMore={controller.hasMore}
      loadMore={controller.loadMore}
      refresh={controller.refresh}
    />
  );
}
