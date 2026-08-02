import type { AppStyles } from './styles';
import { memo, type ComponentType } from 'react';
import { NavigationContainer, StackActions, createNavigationContainerRef, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { TabBarIcon, tabNavItems } from '@/ui/navigation/NavBar';
import { triggerPressFeedback } from '@/ui/controls/AppControls';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { Screen } from '@/ui/navigation/types';
import type { Topic, UserReference } from '@/domain/forum/models';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateMainTab(screen: keyof MainTabParamList) {
  if (!navigationRef.isReady()) {
    return;
  }
  navigationRef.dispatch(StackActions.popTo('MainTabs', { screen }));
}

function appScreenForRouteName(routeName?: string): Screen {
  if (routeName === 'Topic' || routeName === 'ReadingSettings') {
    return 'topic';
  }
  if (routeName === 'User') {
    return 'user';
  }
  if (routeName === 'search' || routeName === 'library' || routeName === 'more') {
    return routeName;
  }
  return 'feed';
}

function currentAppRoute() {
  const route = navigationRef.getCurrentRoute();
  return {
    routeKey: route?.name === 'ReadingSettings' ? '' : route?.key || '',
    screen: appScreenForRouteName(route?.name)
  };
}

function currentAppScreen(): Screen {
  return currentAppRoute().screen;
}

export function shouldUpdateAppRootScreen(previousScreen: Screen, nextScreen: Screen) {
  return previousScreen !== nextScreen;
}

export function navigateAppScreen(screen: Screen) {
  if (!navigationRef.isReady()) {
    return false;
  }
  if (currentAppScreen() === screen) {
    return true;
  }
  if (screen === 'topic' || screen === 'user') return false;
  navigateMainTab(screen);
  return true;
}

export function isReadingSettingsScreen() {
  return navigationRef.getCurrentRoute()?.name === 'ReadingSettings';
}

export function pushTopicRoute(topic: Topic) {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.dispatch(StackActions.push('Topic', { topic }));
  return true;
}

export function pushUserRoute(user: UserReference) {
  if (!navigationRef.isReady()) return false;
  navigationRef.dispatch(StackActions.push('User', { user }));
  return true;
}

function MainTabsHost({
  moreHasBadge,
  FeedRouteComponent,
  LibraryRouteComponent,
  MoreRouteComponent,
  SearchRouteComponent,
  styles,
  theme
}: {
  moreHasBadge: boolean;
  FeedRouteComponent: ComponentType;
  LibraryRouteComponent: ComponentType;
  MoreRouteComponent: ComponentType;
  SearchRouteComponent: ComponentType;
  styles: AppStyles;
  theme: ReaderTheme;
}) {
  return (
    <Tab.Navigator
      initialRouteName="feed"
      screenOptions={({ route }) => {
        const item = tabNavItems.find((entry) => entry.value === route.name) || tabNavItems[0];
        return {
          headerShown: false,
          lazy: false,
          tabBarShowLabel: false,
          tabBarStyle: styles.nav,
          tabBarItemStyle: styles.navItem,
          tabBarButtonTestID: `main-tab-${item.value}`,
          tabBarAccessibilityLabel: item.value === 'more' && moreHasBadge ? '更多，有可用更新' : item.label,
          tabBarIcon: ({ focused }: { focused: boolean }) => (
            <TabBarIcon
              focused={focused}
              icon={item.icon}
              label={item.label}
              showBadge={item.value === 'more' && moreHasBadge}
              styles={styles}
              theme={theme}
            />
          )
        };
      }}
      screenListeners={{
        tabPress: () => {
          triggerPressFeedback();
        }
      }}
    >
      <Tab.Screen name="feed" component={FeedRouteComponent} options={{ title: '首页' }} />
      <Tab.Screen name="search" component={SearchRouteComponent} options={{ title: '搜索' }} />
      <Tab.Screen name="library" component={LibraryRouteComponent} options={{ title: '收藏' }} />
      <Tab.Screen name="more" component={MoreRouteComponent} options={{ title: '更多' }} />
    </Tab.Navigator>
  );
}

export const AppNavigator = memo(function AppNavigator({
  moreHasBadge,
  navigationTheme,
  FeedRouteComponent,
  LibraryRouteComponent,
  MoreRouteComponent,
  ReadingSettingsRouteComponent,
  SearchRouteComponent,
  TopicRouteComponent,
  UserRouteComponent,
  styles,
  theme,
  onReady,
  onScreenChange
}: {
  moreHasBadge: boolean;
  navigationTheme: Theme;
  FeedRouteComponent: ComponentType;
  LibraryRouteComponent: ComponentType;
  MoreRouteComponent: ComponentType;
  ReadingSettingsRouteComponent: ComponentType;
  SearchRouteComponent: ComponentType;
  TopicRouteComponent: ComponentType<NativeStackScreenProps<RootStackParamList, 'Topic'>>;
  UserRouteComponent: ComponentType<NativeStackScreenProps<RootStackParamList, 'User'>>;
  styles: AppStyles;
  theme: ReaderTheme;
  onReady: () => void;
  onScreenChange: (screen: Screen, routeKey: string) => void;
}) {
  const publishCurrentScreen = () => {
    const route = currentAppRoute();
    onScreenChange(route.screen, route.routeKey);
  };
  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={() => {
        publishCurrentScreen();
        onReady();
      }}
      onStateChange={publishCurrentScreen}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          freezeOnBlur: true,
          contentStyle: { backgroundColor: theme.background }
        }}
      >
        <Stack.Screen name="MainTabs">
          {() => (
            <MainTabsHost
              moreHasBadge={moreHasBadge}
              FeedRouteComponent={FeedRouteComponent}
              LibraryRouteComponent={LibraryRouteComponent}
              MoreRouteComponent={MoreRouteComponent}
              SearchRouteComponent={SearchRouteComponent}
              styles={styles}
              theme={theme}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Topic" component={TopicRouteComponent} />
        <Stack.Screen
          name="ReadingSettings"
          component={ReadingSettingsRouteComponent}
          options={{ headerShown: true, title: '阅读设置' }}
        />
        <Stack.Screen name="User" component={UserRouteComponent} />
      </Stack.Navigator>
    </NavigationContainer>
  );
});
