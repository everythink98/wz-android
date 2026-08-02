import type { AppStyles } from './styles';
import { memo, type ComponentType } from 'react';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { TabBarIcon, tabNavItems } from '@/ui/navigation/NavBar';
import { triggerPressFeedback } from '@/ui/controls/pressFeedback';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { Screen } from '@/ui/navigation/types';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { currentAppRoute, navigationRef } from './appNavigation';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
function MainTabsHost({
  moreHasBadge,
  FeedRouteComponent,
  LibraryRouteComponent,
  MoreRouteComponent,
  SearchRouteComponent,
  styles
}: {
  moreHasBadge: boolean;
  FeedRouteComponent: ComponentType;
  LibraryRouteComponent: ComponentType;
  MoreRouteComponent: ComponentType;
  SearchRouteComponent: ComponentType;
  styles: AppStyles;
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
