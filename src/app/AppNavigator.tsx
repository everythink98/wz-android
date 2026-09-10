import type { AppStyles } from './styles';
import { memo, type ComponentType } from 'react';
import { Pressable } from 'react-native';
import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator, type BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { TabBarIcon, tabNavItems } from '@/ui/navigation/NavBar';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { Screen } from '@/ui/navigation/types';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { currentAppRoute, navigationRef } from './appNavigation';
import { ChevronLeft, Settings } from 'lucide-react-native';
import { moreBadgeAccessibilityLabel, type MoreBadgeState } from '@/ui/navigation/moreBadge';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const headerButtonStyle = { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' } as const;

function QuietTabBarButton(props: BottomTabBarButtonProps) {
  return (
    <Pressable
      role={props.role}
      aria-label={props['aria-label']}
      aria-selected={props['aria-selected']}
      accessibilityLargeContentTitle={props.accessibilityLargeContentTitle}
      accessibilityShowsLargeContentViewer={props.accessibilityShowsLargeContentViewer}
      disabled={props.disabled}
      style={props.style}
      testID={props.testID}
      onLongPress={props.onLongPress}
      onPress={props.onPress}
    >
      {props.children}
    </Pressable>
  );
}

function MainTabsHost({
  moreBadgeState,
  FeedRouteComponent,
  getLibraryRoute,
  getMoreRoute,
  getSearchRoute,
  styles
}: {
  moreBadgeState: MoreBadgeState;
  FeedRouteComponent: ComponentType;
  getLibraryRoute: () => ComponentType;
  getMoreRoute: () => ComponentType;
  getSearchRoute: () => ComponentType;
  styles: AppStyles;
}) {
  return (
    <Tab.Navigator
      initialRouteName="feed"
      screenOptions={({ route }) => {
        const item = tabNavItems.find((entry) => entry.value === route.name) || tabNavItems[0];
        return {
          freezeOnBlur: true,
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: styles.nav,
          tabBarItemStyle: styles.navItem,
          tabBarButton: QuietTabBarButton,
          tabBarButtonTestID: `main-tab-${item.value}`,
          tabBarAccessibilityLabel: item.value === 'more' ? moreBadgeAccessibilityLabel(moreBadgeState) : item.label,
          tabBarIcon: ({ focused }: { focused: boolean }) => (
            <TabBarIcon
              focused={focused}
              icon={item.icon}
              label={item.label}
              showBadge={item.value === 'more' && moreBadgeState !== 'none'}
            />
          )
        };
      }}
    >
      <Tab.Screen name="feed" component={FeedRouteComponent} options={{ title: '首页' }} />
      <Tab.Screen name="search" getComponent={getSearchRoute} options={{ title: '搜索' }} />
      <Tab.Screen name="library" getComponent={getLibraryRoute} options={{ title: '收藏' }} />
      <Tab.Screen name="more" getComponent={getMoreRoute} options={{ title: '更多' }} />
    </Tab.Navigator>
  );
}

export const AppNavigator = memo(function AppNavigator({
  moreBadgeState,
  navigationTheme,
  FeedRouteComponent,
  getLibraryRoute,
  getMoreRoute,
  getNotificationDetailRoute,
  getNotificationSettingsRoute,
  getNotificationsRoute,
  getReadingSettingsRoute,
  getSearchRoute,
  getTopicRoute,
  getUserRoute,
  styles,
  theme,
  onReady,
  onScreenChange
}: {
  moreBadgeState: MoreBadgeState;
  navigationTheme: Theme;
  FeedRouteComponent: ComponentType;
  getLibraryRoute: () => ComponentType;
  getMoreRoute: () => ComponentType;
  getNotificationDetailRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'NotificationDetail'>>;
  getNotificationSettingsRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'NotificationSettings'>>;
  getNotificationsRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'Notifications'>>;
  getReadingSettingsRoute: () => ComponentType;
  getSearchRoute: () => ComponentType;
  getTopicRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'Topic'>>;
  getUserRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'User'>>;
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
        screenOptions={({ navigation }) => ({
          headerShown: false,
          headerShadowVisible: false,
          headerLeft: ({ canGoBack, tintColor }) =>
            canGoBack ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="返回"
                style={headerButtonStyle}
                onPress={() => navigation.goBack()}
              >
                <ChevronLeft color={tintColor || theme.ink} size={24} strokeWidth={1.8} />
              </Pressable>
            ) : null,
          animation: 'slide_from_right',
          freezeOnBlur: true,
          contentStyle: { backgroundColor: theme.background }
        })}
      >
        <Stack.Screen name="MainTabs">
          {() => (
            <MainTabsHost
              moreBadgeState={moreBadgeState}
              FeedRouteComponent={FeedRouteComponent}
              getLibraryRoute={getLibraryRoute}
              getMoreRoute={getMoreRoute}
              getSearchRoute={getSearchRoute}
              styles={styles}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Topic" getComponent={getTopicRoute} />
        <Stack.Screen
          name="Notifications"
          getComponent={getNotificationsRoute}
          options={({ navigation }) => ({
            headerShown: true,
            title: '消息',
            headerRight: () => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="消息通知设置"
                style={headerButtonStyle}
                onPress={() => navigation.navigate('NotificationSettings')}
              >
                <Settings color={theme.ink} size={20} strokeWidth={1.8} />
              </Pressable>
            )
          })}
        />
        <Stack.Screen
          name="NotificationDetail"
          getComponent={getNotificationDetailRoute}
          options={{ headerShown: true, title: '消息详情' }}
        />
        <Stack.Screen
          name="NotificationSettings"
          getComponent={getNotificationSettingsRoute}
          options={{ headerShown: true, title: '消息通知设置' }}
        />
        <Stack.Screen
          name="ReadingSettings"
          getComponent={getReadingSettingsRoute}
          options={{ headerShown: true, title: '阅读设置' }}
        />
        <Stack.Screen name="User" getComponent={getUserRoute} />
      </Stack.Navigator>
    </NavigationContainer>
  );
});
