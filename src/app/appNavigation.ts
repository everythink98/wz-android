import { StackActions, createNavigationContainerRef } from '@react-navigation/native';
import type { UserActivityTab, UserReference } from '@/domain/forum/models';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import type { Screen } from '@/ui/navigation/types';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';

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
  if (routeName === 'NodeSeekCredits') return 'more';
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

export function shouldUpdateAppRootScreen(previousScreen: Screen, nextScreen: Screen) {
  return previousScreen !== nextScreen;
}

export function navigateAppScreen(screen: Screen) {
  if (!navigationRef.isReady()) return false;
  if (currentAppRoute().screen === screen) return true;
  if (screen === 'topic' || screen === 'user') return false;
  if (screen === 'library') {
    navigationRef.navigate('Library');
    return true;
  }
  navigateMainTab(screen);
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
    routeName === 'ReadingSettings'
  );
}

export function pushTopicRoute(destination: RootStackParamList['Topic']) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.push('Topic', destination));
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

export function openNotificationsRoute(source?: NotificationSource) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.popTo('MainTabs', { screen: 'notifications', params: source ? { source } : {} }));
  return true;
}
