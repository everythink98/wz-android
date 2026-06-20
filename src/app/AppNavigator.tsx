import type { ReactNode } from 'react';
import { CommonActions, NavigationContainer, createNavigationContainerRef, type NavigatorScreenParams, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabBarIcon, tabNavItems } from '../components/NavBar';
import { triggerPressFeedback } from '../components/AppControls';
import type { createStyles, ReaderTheme } from '../theme';

export type MainTabParamList = {
  feed: undefined;
  search: undefined;
  library: undefined;
  more: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Topic: undefined;
  User: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateMainTab(screen: keyof MainTabParamList) {
  if (!navigationRef.isReady()) {
    return;
  }
  navigationRef.dispatch(CommonActions.navigate({
    name: 'MainTabs',
    params: { screen }
  }));
}

export function MainTabsHost({
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

export function AppNavigator({
  moreHasBadge,
  navigationTheme,
  renderFeedTab,
  renderLibraryTab,
  renderMoreTab,
  renderSearchTab,
  renderTopicScreen,
  renderUserScreen,
  styles,
  theme,
  onReady,
  onTabPress,
  onTopicClosing,
  onUserClosing
}: {
  moreHasBadge: boolean;
  navigationTheme: Theme;
  renderFeedTab: () => ReactNode;
  renderLibraryTab: () => ReactNode;
  renderMoreTab: () => ReactNode;
  renderSearchTab: () => ReactNode;
  renderTopicScreen: () => ReactNode;
  renderUserScreen: () => ReactNode;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onReady: () => void;
  onTabPress: (target: keyof MainTabParamList) => void;
  onTopicClosing: () => void;
  onUserClosing: () => void;
}) {
  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme} onReady={onReady}>
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
        <Stack.Screen name="Topic" listeners={{ transitionEnd: (event) => {
          if (event.data.closing) {
            onTopicClosing();
          }
        } }}>
          {renderTopicScreen}
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
  );
}
