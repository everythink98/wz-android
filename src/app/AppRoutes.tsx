import type { ComponentProps } from 'react';
import { AppNavigator } from './AppNavigator';
import { FeedRoute, FeedRouteRuntimeProvider, type FeedRouteRuntimeValue } from '@/features/feed/FeedRoute';
import {
  LibraryRoute,
  LibraryRouteRuntimeProvider,
  type LibraryRouteRuntimeValue
} from '@/features/library/LibraryRoute';
import {
  MoreRoute,
  MoreRouteRuntimeProvider,
  ReadingSettingsRoute,
  type MoreRouteRuntimeValue
} from '@/features/more/MoreRoute';
import { SearchRoute, SearchRouteRuntimeProvider, type SearchRouteRuntimeValue } from '@/features/search/SearchRoute';
import { TopicRoute, TopicRouteRuntimeProvider, type TopicRouteRuntimeValue } from '@/features/topic/TopicRoute';
import { UserRoute, UserRouteRuntimeProvider, type UserRouteRuntimeValue } from '@/features/user/UserRoute';

type NavigatorProps = ComponentProps<typeof AppNavigator>;

export function AppRoutes({
  feedRouteRuntime,
  libraryRouteRuntime,
  moreHasBadge,
  moreRouteRuntime,
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
  moreHasBadge: boolean;
  moreRouteRuntime: MoreRouteRuntimeValue;
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
                <AppNavigator
                  moreHasBadge={moreHasBadge}
                  navigationTheme={navigationTheme}
                  FeedRouteComponent={FeedRoute}
                  LibraryRouteComponent={LibraryRoute}
                  MoreRouteComponent={MoreRoute}
                  ReadingSettingsRouteComponent={ReadingSettingsRoute}
                  SearchRouteComponent={SearchRoute}
                  TopicRouteComponent={TopicRoute}
                  UserRouteComponent={UserRoute}
                  styles={styles}
                  theme={theme}
                  onReady={onReady}
                  onScreenChange={onScreenChange}
                />
              </MoreRouteRuntimeProvider>
            </LibraryRouteRuntimeProvider>
          </SearchRouteRuntimeProvider>
        </FeedRouteRuntimeProvider>
      </UserRouteRuntimeProvider>
    </TopicRouteRuntimeProvider>
  );
}
