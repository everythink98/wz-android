import {
  StackActions,
  createNavigationContainerRef,
  type NavigationState,
  type PartialState
} from '@react-navigation/native';
import type { UserActivityTab, UserReference } from '@/domain/forum/models';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import type { Screen } from '@/ui/navigation/types';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { LibraryTab } from '@/domain/forum/feed';
import { dispatchTopicRoute } from '@/ui/navigation/appRouteActions';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateMainTab(screen: keyof MainTabParamList) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(StackActions.popTo('MainTabs', { screen }));
}

function appScreenForRouteName(routeName?: string): Screen {
  if (routeName === 'Topic' || routeName === 'ReadingSettings' || routeName === 'TopicComposer') return 'topic';
  if (routeName === 'User') return 'user';
  if (routeName === 'Library') return 'library';
  if (routeName === 'NotificationDetail' || routeName === 'NotificationSettings') return 'notifications';
  if (routeName === 'NodeSeekCredits' || routeName === 'LinuxDoCredit' || routeName === 'NetworkSettings')
    return 'more';
  if (routeName === 'search' || routeName === 'more' || routeName === 'notifications') return routeName;
  return 'feed';
}

export function currentAppRoute() {
  const route = navigationRef.getCurrentRoute();
  return {
    routeKey: route?.name === 'ReadingSettings' ? '' : route?.key || '',
    screen: appScreenForRouteName(route?.name)
  };
}

export function currentRecoveryRoute() {
  const route = navigationRef.getCurrentRoute();
  if (!route) return undefined;
  const { key, name, params } = route;
  const tab = name === 'feed' || name === 'search' || name === 'notifications' || name === 'more';
  const reading = name === 'Topic' && (params as RootStackParamList['Topic'] | undefined)?.topic.source === 'linuxdo';
  return { key, tab, reading };
}

export function hasAppRoute(key: string) {
  const root = navigationRef.getRootState();
  const contains = (state: NavigationState | PartialState<NavigationState>): boolean =>
    state.routes.some((route) => route.key === key || (route.state !== undefined && contains(route.state)));
  return !!root && contains(root);
}

export function isAccountCenterFocused() {
  return navigationRef.getCurrentRoute()?.name === 'more';
}

export function openLibraryRoute(initialTab: LibraryTab = 'favorites') {
  if (!navigationRef.isReady()) return false;
  navigationRef.navigate('Library', { initialTab });
  return true;
}

export function isNativeStackScreen() {
  const routeName = navigationRef.getCurrentRoute()?.name;
  return (
    routeName === 'Topic' ||
    routeName === 'TopicComposer' ||
    routeName === 'User' ||
    routeName === 'Library' ||
    routeName === 'NotificationDetail' ||
    routeName === 'NotificationSettings' ||
    routeName === 'NodeSeekCredits' ||
    routeName === 'LinuxDoCredit' ||
    routeName === 'ReadingSettings' ||
    routeName === 'NetworkSettings'
  );
}

export function pushTopicRoute(destination: RootStackParamList['Topic']) {
  if (!navigationRef.isReady()) return false;
  dispatchTopicRoute(() => navigationRef.dispatch(StackActions.push('Topic', destination)));
  return true;
}

export function pushUserRoute(user: UserReference, initialTab?: UserActivityTab) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.push('User', { user, ...(initialTab ? { initialTab } : {}) }));
  return true;
}

export function openNodeSeekCreditsRoute(destination: RootStackParamList['NodeSeekCredits']) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.push('NodeSeekCredits', destination));
  return true;
}

export function openLinuxDoCreditRoute(destination: RootStackParamList['LinuxDoCredit']) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.push('LinuxDoCredit', destination));
  return true;
}

export function openNotificationsRoute(source?: NotificationSource) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.popTo('MainTabs', { screen: 'notifications', params: source ? { source } : {} }));
  return true;
}
