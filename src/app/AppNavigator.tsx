import { createContext, memo, type ReactNode, useContext } from 'react';
import { NavigationContainer, StackActions, createNavigationContainerRef, type NavigatorScreenParams, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabBarIcon, tabNavItems } from '../components/NavBar';
import { triggerPressFeedback } from '../components/AppControls';
import type { createStyles, ReaderTheme } from '../theme';
import type { Screen } from '../appTypes';

export type MainTabParamList = {
  feed: undefined;
  search: undefined;
  library: undefined;
  more: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Topic: undefined;
  ReadingSettings: undefined;
  User: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const TopicScreenRendererContext = createContext<() => ReactNode>(() => null);

function TopicRouteScreen() {
  return useContext(TopicScreenRendererContext)();
}

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
  return previousScreen === 'topic'
    || previousScreen === 'user'
    || nextScreen === 'topic'
    || nextScreen === 'user';
}

export function currentTopicRouteKey() {
  const route = navigationRef.getCurrentRoute();
  return route?.name === 'Topic' ? route.key : null;
}

export function previousTopicRouteKey() {
  if (!navigationRef.isReady()) {
    return null;
  }
  const state = navigationRef.getRootState();
  const currentIndex = state.index ?? state.routes.length - 1;
  const previousRoute = state.routes[currentIndex - 1];
  return previousRoute?.name === 'Topic' ? previousRoute.key : null;
}

export function navigateAppScreen(screen: Screen) {
  if (!navigationRef.isReady()) {
    return false;
  }
  if (currentAppScreen() === screen) {
    return true;
  }
  if (screen === 'topic') {
    navigationRef.dispatch(StackActions.push('Topic'));
  } else if (screen === 'user') {
    navigationRef.dispatch(StackActions.push('User'));
  } else {
    navigateMainTab(screen);
  }
  return true;
}

export function openReadingSettingsScreen() {
  if (!navigationRef.isReady() || currentAppScreen() !== 'topic') {
    return false;
  }
  navigationRef.dispatch(StackActions.push('ReadingSettings'));
  return true;
}

export function openReadingSettingsFromCurrentTopic(saveTopicRoute: (routeKey: string) => void) {
  const routeKey = currentTopicRouteKey();
  if (!routeKey) {
    return false;
  }
  saveTopicRoute(routeKey);
  return openReadingSettingsScreen();
}

export function isReadingSettingsScreen() {
  return navigationRef.getCurrentRoute()?.name === 'ReadingSettings';
}

export function pushTopicRoute() {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.dispatch(StackActions.push('Topic'));
  return true;
}

function MainTabsHost({
  moreHasBadge,
  renderFeedTab,
  renderLibraryTab,
  renderMoreTab,
  renderSearchTab,
  styles,
  theme,
  onTabPress
}: {
  moreHasBadge: boolean;
  renderFeedTab: () => ReactNode;
  renderLibraryTab: () => ReactNode;
  renderMoreTab: () => ReactNode;
  renderSearchTab: () => ReactNode;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onTabPress: (target: keyof MainTabParamList) => void;
}) {
  return (
    <Tab.Navigator
      initialRouteName="feed"
      screenOptions={({ route }) => {
        const item = tabNavItems.find((entry) => entry.value === route.name) || tabNavItems[0];
        return {
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: styles.nav,
          tabBarItemStyle: styles.navItem,
          tabBarButtonTestID: `main-tab-${item.value}`,
          tabBarAccessibilityLabel: item.value === 'more' && moreHasBadge ? '更多，有可用更新' : item.label,
          tabBarIcon: ({ focused }: { focused: boolean }) => (
            <TabBarIcon focused={focused} icon={item.icon} label={item.label} showBadge={item.value === 'more' && moreHasBadge} styles={styles} theme={theme} />
          )
        };
      }}
      screenListeners={({ route }) => ({
        tabPress: () => {
          triggerPressFeedback();
          onTabPress(route.name as keyof MainTabParamList);
        }
      })}
    >
      <Tab.Screen name="feed" options={{ title: '首页' }}>
        {renderFeedTab}
      </Tab.Screen>
      <Tab.Screen name="search" options={{ title: '搜索' }}>
        {renderSearchTab}
      </Tab.Screen>
      <Tab.Screen name="library" options={{ title: '收藏' }}>
        {renderLibraryTab}
      </Tab.Screen>
      <Tab.Screen name="more" options={{ title: '更多' }}>
        {renderMoreTab}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export const AppNavigator = memo(function AppNavigator({
  moreHasBadge,
  navigationTheme,
  renderFeedTab,
  renderLibraryTab,
  renderMoreTab,
  renderReadingSettingsScreen,
  renderSearchTab,
  renderTopicScreen,
  renderUserScreen,
  styles,
  theme,
  onReady,
  onScreenChange,
  onTabPress,
  onTopicClosing,
  onUserClosing
}: {
  moreHasBadge: boolean;
  navigationTheme: Theme;
  renderFeedTab: () => ReactNode;
  renderLibraryTab: () => ReactNode;
  renderMoreTab: () => ReactNode;
  renderReadingSettingsScreen: () => ReactNode;
  renderSearchTab: () => ReactNode;
  renderTopicScreen: () => ReactNode;
  renderUserScreen: () => ReactNode;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onReady: () => void;
  onScreenChange: (screen: Screen, routeKey: string) => void;
  onTabPress: (target: keyof MainTabParamList) => void;
  onTopicClosing: () => void;
  onUserClosing: () => void;
}) {
  const publishCurrentScreen = () => {
    const route = currentAppRoute();
    onScreenChange(route.screen, route.routeKey);
  };
  return (
    <TopicScreenRendererContext.Provider value={renderTopicScreen}>
      <NavigationContainer
        ref={navigationRef}
        theme={navigationTheme}
        onReady={() => {
          publishCurrentScreen();
          onReady();
        }}
        onStateChange={publishCurrentScreen}
      >
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', freezeOnBlur: true, contentStyle: { backgroundColor: theme.background } }}>
        <Stack.Screen name="MainTabs">
          {() => (
            <MainTabsHost
              moreHasBadge={moreHasBadge}
              renderFeedTab={renderFeedTab}
              renderLibraryTab={renderLibraryTab}
              renderMoreTab={renderMoreTab}
              renderSearchTab={renderSearchTab}
              styles={styles}
              theme={theme}
              onTabPress={onTabPress}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Topic" component={TopicRouteScreen} listeners={{ transitionEnd: (event) => {
          if (event.data.closing) {
            onTopicClosing();
          }
        } }} />
        <Stack.Screen name="ReadingSettings" options={{ headerShown: true, title: '阅读设置' }}>
          {renderReadingSettingsScreen}
        </Stack.Screen>
        <Stack.Screen name="User" listeners={{ transitionEnd: (event) => {
          if (event.data.closing) {
            onUserClosing();
          }
        } }}>
          {renderUserScreen}
        </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </TopicScreenRendererContext.Provider>
  );
});
