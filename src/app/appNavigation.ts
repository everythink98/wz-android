import { StackActions, createNavigationContainerRef } from '@react-navigation/native';
import type { Topic, UserReference } from '@/domain/forum/models';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import type { Screen } from '@/ui/navigation/types';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateMainTab(screen: keyof MainTabParamList) {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(StackActions.popTo('MainTabs', { screen }));
}

function appScreenForRouteName(routeName?: string): Screen {
  if (routeName === 'Topic' || routeName === 'ReadingSettings') return 'topic';
  if (routeName === 'User') return 'user';
  if (routeName === 'Notifications' || routeName === 'NotificationDetail' || routeName === 'NotificationSettings') {
    return 'more';
  }
  if (routeName === 'search' || routeName === 'library' || routeName === 'more') return routeName;
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
  navigateMainTab(screen);
  return true;
}

export function isNativeStackScreen() {
  const routeName = navigationRef.getCurrentRoute()?.name;
  return (
    routeName === 'Topic' ||
    routeName === 'User' ||
    routeName === 'Notifications' ||
    routeName === 'NotificationDetail' ||
    routeName === 'NotificationSettings' ||
    routeName === 'ReadingSettings'
  );
}

export function pushTopicRoute(topic: Topic) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.push('Topic', { topic }));
  return true;
}

export function pushUserRoute(user: UserReference) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.push('User', { user }));
  return true;
}

export function openNotificationsRoute(source?: NotificationSource) {
  if (!navigationRef.isReady()) return false;
  navigationRef.navigate('Notifications', source ? { source } : undefined);
  return true;
}
