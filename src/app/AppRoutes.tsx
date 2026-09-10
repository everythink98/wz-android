/* eslint-disable @typescript-eslint/no-require-imports -- React Navigation getComponent defers synchronous page evaluation. */
import type { ComponentProps } from 'react';
import { AppNavigator } from './AppNavigator';
import { FeedRoute, FeedRouteRuntimeProvider, type FeedRouteRuntimeValue } from '@/features/feed/FeedRoute';
import { LibraryRouteRuntimeProvider, type LibraryRouteRuntimeValue } from '@/features/library/LibraryRouteRuntime';
import { MoreRouteRuntimeProvider, type MoreRouteRuntimeValue } from '@/features/more/MoreRouteRuntime';
import { SearchRouteRuntimeProvider, type SearchRouteRuntimeValue } from '@/features/search/SearchRouteRuntime';
import { TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRouteRuntime';
import { UserRouteRuntimeProvider, type UserRouteRuntimeValue } from '@/features/user/UserRouteRuntime';
import {
  NotificationRouteRuntimeProvider,
  type NotificationRouteRuntimeValue
} from '@/features/notifications/NotificationRouteRuntime';

const getLibraryRoute = () =>
  require('@/features/library/LibraryRoute')
    .LibraryRoute as typeof import('@/features/library/LibraryRoute').LibraryRoute;
const getMoreRoute = () =>
  require('@/features/more/MoreRoute').MoreRoute as typeof import('@/features/more/MoreRoute').MoreRoute;
const getSearchRoute = () =>
  require('@/features/search/SearchRoute').SearchRoute as typeof import('@/features/search/SearchRoute').SearchRoute;
const getTopicRoute = () =>
  require('@/features/topic/TopicRoute').TopicRoute as typeof import('@/features/topic/TopicRoute').TopicRoute;
const getUserRoute = () =>
  require('@/features/user/UserRoute').UserRoute as typeof import('@/features/user/UserRoute').UserRoute;
const getNotificationsRoute = () =>
  require('@/features/notifications/NotificationRoute')
    .NotificationsRoute as typeof import('@/features/notifications/NotificationRoute').NotificationsRoute;
const getReadingSettingsRoute = () =>
  require('@/features/more/MoreRoute')
    .ReadingSettingsRoute as typeof import('@/features/more/MoreRoute').ReadingSettingsRoute;
const getNotificationDetailRoute = () =>
  require('@/features/notifications/NotificationRoute')
    .NotificationDetailRoute as typeof import('@/features/notifications/NotificationRoute').NotificationDetailRoute;
const getNotificationSettingsRoute = () =>
  require('@/features/notifications/NotificationRoute')
    .NotificationSettingsRoute as typeof import('@/features/notifications/NotificationRoute').NotificationSettingsRoute;

type NavigatorProps = ComponentProps<typeof AppNavigator>;

export function AppRoutes({
  feedRouteRuntime,
  libraryRouteRuntime,
  moreBadgeState,
  moreRouteRuntime,
  notificationRouteRuntime,
  navigationTheme,
  searchRouteRuntime,
  styles,
  theme,
  topicRouteRuntime,
  userRouteRuntime,
  onReady,
  onScreenChange
}: {
  feedRouteRuntime: FeedRouteRuntimeValue;
  libraryRouteRuntime: LibraryRouteRuntimeValue;
  moreBadgeState: NavigatorProps['moreBadgeState'];
  moreRouteRuntime: MoreRouteRuntimeValue;
  notificationRouteRuntime: NotificationRouteRuntimeValue;
  navigationTheme: NavigatorProps['navigationTheme'];
  searchRouteRuntime: SearchRouteRuntimeValue;
  styles: NavigatorProps['styles'];
  theme: NavigatorProps['theme'];
  topicRouteRuntime: TopicRouteRuntimeValue;
  userRouteRuntime: UserRouteRuntimeValue;
  onReady: NavigatorProps['onReady'];
  onScreenChange: NavigatorProps['onScreenChange'];
}) {
  return (
    <TopicRouteRuntimeProvider value={topicRouteRuntime}>
      <UserRouteRuntimeProvider value={userRouteRuntime}>
        <FeedRouteRuntimeProvider value={feedRouteRuntime}>
          <SearchRouteRuntimeProvider value={searchRouteRuntime}>
            <LibraryRouteRuntimeProvider value={libraryRouteRuntime}>
              <MoreRouteRuntimeProvider value={moreRouteRuntime}>
                <NotificationRouteRuntimeProvider value={notificationRouteRuntime}>
                  <AppNavigator
                    moreBadgeState={moreBadgeState}
                    navigationTheme={navigationTheme}
                    FeedRouteComponent={FeedRoute}
                    getLibraryRoute={getLibraryRoute}
                    getMoreRoute={getMoreRoute}
                    getNotificationDetailRoute={getNotificationDetailRoute}
                    getNotificationSettingsRoute={getNotificationSettingsRoute}
                    getNotificationsRoute={getNotificationsRoute}
                    getReadingSettingsRoute={getReadingSettingsRoute}
                    getSearchRoute={getSearchRoute}
                    getTopicRoute={getTopicRoute}
                    getUserRoute={getUserRoute}
                    styles={styles}
                    theme={theme}
                    onReady={onReady}
                    onScreenChange={onScreenChange}
                  />
                </NotificationRouteRuntimeProvider>
              </MoreRouteRuntimeProvider>
            </LibraryRouteRuntimeProvider>
          </SearchRouteRuntimeProvider>
        </FeedRouteRuntimeProvider>
      </UserRouteRuntimeProvider>
    </TopicRouteRuntimeProvider>
  );
}
