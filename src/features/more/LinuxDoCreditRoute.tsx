import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { ContentSourceDisabledState, RecoverableEmptyState } from '@/ui/controls/FeedbackStates';
import { manageContentSourcesAction } from '@/ui/navigation/appRouteActions';
import { useMoreRouteRuntime } from './MoreRouteRuntime';
import { useLinuxDoCredit } from './useLinuxDoCredit';
import { LinuxDoCreditScreen } from './LinuxDoCreditScreen';

export function LinuxDoCreditRoute({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'LinuxDoCredit'>) {
  const runtime = useMoreRouteRuntime();
  const focused = useIsFocused();
  const session = runtime.account.read.sessions.linuxdo;
  const enabled = runtime.account.enabledSessionSources.includes('linuxdo');
  const sameIdentity =
    session.identityTrust === 'confirmed' && `linuxdo:${session.currentUser?.id}` === route.params.identityKey;
  const controller = useLinuxDoCredit({
    active: focused && runtime.account.active && enabled && sameIdentity && session.canWrite,
    gateway: runtime.account.read.gateway,
    userId: route.params.userId,
    username: route.params.username,
    sessionEpoch: runtime.account.read.sessionEpochs.linuxdo,
    connectSilently: runtime.account.center.linuxDoCredit.connectSilently,
    connecting: runtime.account.center.linuxDoCredit.busy,
    transactions: true
  });
  if (!enabled)
    return (
      <ContentSourceDisabledState
        source="linuxdo"
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
    <LinuxDoCreditScreen
      account={controller.account}
      entries={controller.entries}
      busy={controller.busy}
      refreshing={controller.refreshing}
      loaded={controller.loaded}
      hasMore={controller.hasMore}
      error={controller.error}
      forumVerificationRequired={controller.forumVerificationRequired}
      onLoadMore={controller.loadMore}
      onRefresh={() => void controller.refresh()}
      onConnect={() => {
        if (controller.forumVerificationRequired)
          void runtime.account.center.command({ type: 'open-login', site: 'linuxdo' });
        else void runtime.account.center.linuxDoCredit.open();
      }}
    />
  );
}
