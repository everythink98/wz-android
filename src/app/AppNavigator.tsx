import type { AppStyles } from './styles';
import { memo, type ComponentType } from 'react';
import { Pressable } from 'react-native';
import { NavigationContainer, type CompositeScreenProps, type Theme } from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
  type BottomTabScreenProps
} from '@react-navigation/bottom-tabs';
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
type NotificationsTabProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'notifications'>,
  NativeStackScreenProps<RootStackParamList>
>;
const headerButtonStyle = { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' } as const;
const tabBarIconStyle = { width: '100%' } as const;

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
  getNotificationsRoute,
  getMoreRoute,
  getSearchRoute,
  styles,
  theme
}: {
  moreBadgeState: MoreBadgeState;
  FeedRouteComponent: ComponentType;
  getNotificationsRoute: () => ComponentType<NotificationsTabProps>;
  getMoreRoute: () => ComponentType;
  getSearchRoute: () => ComponentType;
  styles: AppStyles;
  theme: ReaderTheme;
}) {
  return (
    <Tab.Navigator
      initialRouteName="feed"
      detachInactiveScreens={false}
      screenOptions={({ route }) => {
        const item = tabNavItems.find((entry) => entry.value === route.name) || tabNavItems[0];
        return {
          freezeOnBlur: route.name !== 'feed' && route.name !== 'search',
          headerShown: false,
          tabBarShowLabel: false,
          tabBarStyle: styles.nav,
          tabBarItemStyle: styles.navItem,
          tabBarIconStyle,
          tabBarButton: QuietTabBarButton,
          tabBarButtonTestID: `main-tab-${item.value}`,
          tabBarAccessibilityLabel:
            item.value === 'more'
              ? moreBadgeAccessibilityLabel(moreBadgeState)
              : item.value === 'notifications' && (moreBadgeState === 'messages' || moreBadgeState === 'both')
                ? '消息，有新消息'
                : item.label,
          tabBarIcon: ({ focused }: { focused: boolean }) => (
            <TabBarIcon
              focused={focused}
              icon={item.icon}
              label={item.label}
              showBadge={
                item.value === 'more'
                  ? moreBadgeState === 'update' || moreBadgeState === 'both'
                  : item.value === 'notifications' && (moreBadgeState === 'messages' || moreBadgeState === 'both')
              }
            />
          )
        };
      }}
    >
      <Tab.Screen name="feed" component={FeedRouteComponent} options={{ title: '首页' }} />
      <Tab.Screen name="search" getComponent={getSearchRoute} options={{ title: '搜索' }} />
      <Tab.Screen
        name="notifications"
        getComponent={getNotificationsRoute}
        options={({ navigation }) => ({
          headerShown: true,
          headerShadowVisible: false,
          title: '消息',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="消息通知设置"
              style={headerButtonStyle}
              onPress={() => navigation.getParent()?.navigate('NotificationSettings')}
            >
              <Settings color={theme.ink} size={20} strokeWidth={1.8} />
            </Pressable>
          )
        })}
      />
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
  getNodeSeekCreditsRoute,
  getSearchRoute,
  getTopicRoute,
  getTopicComposerRoute,
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
  getNotificationsRoute: () => ComponentType<NotificationsTabProps>;
  getReadingSettingsRoute: () => ComponentType;
  getNodeSeekCreditsRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'NodeSeekCredits'>>;
  getSearchRoute: () => ComponentType;
  getTopicRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'Topic'>>;
  getTopicComposerRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'TopicComposer'>>;
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
              getNotificationsRoute={getNotificationsRoute}
              getMoreRoute={getMoreRoute}
              getSearchRoute={getSearchRoute}
              styles={styles}
              theme={theme}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Topic" getComponent={getTopicRoute} />
        <Stack.Screen name="TopicComposer" getComponent={getTopicComposerRoute} />
        <Stack.Screen name="Library" getComponent={getLibraryRoute} options={{ headerShown: true, title: '收藏' }} />
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
        <Stack.Screen
          name="NodeSeekCredits"
          getComponent={getNodeSeekCreditsRoute}
          options={{ headerShown: true, title: '鸡腿流水' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
});
