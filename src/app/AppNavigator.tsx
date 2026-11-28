import type { AppStyles } from './styles';
import {
  forwardRef,
  memo,
  useContext,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ComponentType,
  type ReactNode
} from 'react';
import { HeaderHeightContext } from '@react-navigation/elements';
import {
  Platform,
  Pressable,
  requireNativeComponent,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewProps
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { NavigationContainer, type CompositeScreenProps, type Theme } from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
  type BottomTabScreenProps
} from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { InnerScreen, ScreenContext } from 'react-native-screens';
import DelayedFreeze from 'react-native-screens/src/components/helpers/DelayedFreeze';
import { TabBarIcon, TabBarLabel, TabBarItemContent, tabNavItems } from '@/ui/navigation/NavBar';
import { IconButton } from '@/ui/controls/ButtonControls';
import { goBackFromFocusedRoute } from '@/ui/navigation/appRouteActions';
import { NavigationBackdropProvider, NavigationBackdropTarget, NavigationGlass } from '@/ui/navigation/NavigationGlass';
import type { ReaderTheme } from '@/ui/theme/tokens';
import type { Screen } from '@/ui/navigation/types';
import type { MainTabParamList, RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { currentAppRoute, navigationRef } from './appNavigation';
import { ChevronLeft, Settings } from 'lucide-react-native';
import { moreBadgeAccessibilityLabel, type MoreBadgeState } from '@/ui/navigation/moreBadge';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const MIN_TAB_BAR_BOTTOM_PADDING = 8;
const renderEmptyTabBarIcon = () => null;
const hiddenTabBarIcon = { display: 'none' } as const;
const RetainedTabScene = requireNativeComponent<ViewProps & { inactive?: boolean }>('WzRetainedTabScene');
const MainTabScreen = forwardRef<ComponentRef<typeof InnerScreen>, ComponentPropsWithoutRef<typeof InnerScreen>>(
  function MainTabScreen(props, ref) {
    if (Platform.OS !== 'android' || props.enabled !== false || typeof props.activityState !== 'number') {
      return <InnerScreen {...props} ref={ref} />;
    }
    const inactive = props.activityState === 0;
    return (
      <RetainedTabScene
        ref={ref}
        style={props.style}
        inactive={inactive}
        pointerEvents={inactive ? 'none' : props.pointerEvents}
        importantForAccessibility={inactive ? 'no-hide-descendants' : 'auto'}
      >
        {props.freezeOnBlur ? (
          <DelayedFreeze freeze={props.shouldFreeze ?? inactive}>{props.children}</DelayedFreeze>
        ) : (
          props.children
        )}
      </RetainedTabScene>
    );
  }
);
type NotificationsTabProps = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'notifications'>,
  NativeStackScreenProps<RootStackParamList>
>;
function RouteBackdrop({ children }: { children: ReactNode }) {
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  return (
    <NavigationBackdropTarget active topInset={headerHeight}>
      {children}
    </NavigationBackdropTarget>
  );
}

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
  onBottomTabBarLayout
}: {
  moreBadgeState: MoreBadgeState;
  FeedRouteComponent: ComponentType;
  getNotificationsRoute: () => ComponentType<NotificationsTabProps>;
  getMoreRoute: () => ComponentType;
  getSearchRoute: () => ComponentType;
  styles: AppStyles;
  onBottomTabBarLayout?: (event: LayoutChangeEvent) => void;
}) {
  const bottom = useContext(SafeAreaInsetsContext)?.bottom;
  return (
    <NavigationBackdropProvider>
      <Tab.Navigator
        initialRouteName="feed"
        detachInactiveScreens={false}
        safeAreaInsets={bottom === undefined ? undefined : { bottom: Math.max(bottom, MIN_TAB_BAR_BOTTOM_PADDING) }}
        screenLayout={({ children, route }) =>
          route.name === 'feed' || route.name === 'more' ? children : <RouteBackdrop>{children}</RouteBackdrop>
        }
        screenOptions={({ route }) => {
          const item = tabNavItems.find((entry) => entry.value === route.name) || tabNavItems[0];
          const showBadge =
            item.value === 'more'
              ? moreBadgeState === 'update' || moreBadgeState === 'both'
              : item.value === 'notifications' && (moreBadgeState === 'messages' || moreBadgeState === 'both');
          return {
            freezeOnBlur: route.name !== 'feed' && route.name !== 'search',
            headerShown: false,
            headerTitleStyle: styles.headerTitle,
            headerTitleAllowFontScaling: true,
            tabBarLabelPosition: 'below-icon',
            // Android selection changes immediately, so one icon can keep its native view across focus changes.
            tabBarLabel: ({ focused }: { focused: boolean }) =>
              Platform.OS === 'android' ? (
                <TabBarItemContent focused={focused} item={item} showBadge={showBadge} />
              ) : (
                <TabBarLabel focused={focused} label={item.label} />
              ),
            tabBarStyle: [styles.nav, styles.navOverlay],
            tabBarBackground: () => (
              <View style={StyleSheet.absoluteFill} onLayout={onBottomTabBarLayout}>
                <NavigationGlass cropToViewport pauseWhenHidden />
              </View>
            ),
            tabBarItemStyle: styles.navItem,
            tabBarButton: QuietTabBarButton,
            tabBarButtonTestID: `main-tab-${item.value}`,
            tabBarAccessibilityLabel:
              item.value === 'more'
                ? moreBadgeAccessibilityLabel(moreBadgeState)
                : item.value === 'notifications' && (moreBadgeState === 'messages' || moreBadgeState === 'both')
                  ? '消息，有新消息'
                  : item.label,
            // Android draws its single icon alongside the custom label. An omitted icon draws MissingIcon.
            tabBarIconStyle: Platform.OS === 'android' ? hiddenTabBarIcon : undefined,
            tabBarIcon:
              Platform.OS === 'android'
                ? renderEmptyTabBarIcon
                : ({ focused }: { focused: boolean }) => (
                    <TabBarIcon focused={focused} icon={item.icon} showBadge={showBadge} />
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
              <IconButton
                icon={Settings}
                iconOnly
                label="消息通知设置"
                onPress={() => {
                  if (navigation.isFocused()) navigation.getParent()?.navigate('NotificationSettings');
                }}
              />
            )
          })}
        />
        <Tab.Screen name="more" getComponent={getMoreRoute} options={{ title: '我的' }} />
      </Tab.Navigator>
    </NavigationBackdropProvider>
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
  getNetworkSettingsRoute,
  getNodeSeekCreditsRoute,
  getLinuxDoCreditRoute,
  getSearchRoute,
  getTopicRoute,
  getTopicComposerRoute,
  getUserRoute,
  styles,
  theme,
  onReady,
  onScreenChange,
  onBottomTabBarLayout
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
  getNetworkSettingsRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'NetworkSettings'>>;
  getNodeSeekCreditsRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'NodeSeekCredits'>>;
  getLinuxDoCreditRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'LinuxDoCredit'>>;
  getSearchRoute: () => ComponentType;
  getTopicRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'Topic'>>;
  getTopicComposerRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'TopicComposer'>>;
  getUserRoute: () => ComponentType<NativeStackScreenProps<RootStackParamList, 'User'>>;
  styles: AppStyles;
  theme: ReaderTheme;
  onReady: () => void;
  onScreenChange: (screen: Screen, routeKey: string) => void;
  onBottomTabBarLayout?: (event: LayoutChangeEvent) => void;
}) {
  const publishCurrentScreen = () => {
    const route = currentAppRoute();
    onScreenChange(route.screen, route.routeKey);
  };
  return (
    <NavigationBackdropProvider>
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
          screenLayout={({ children, route }) =>
            route.name === 'MainTabs' ||
            route.name === 'Topic' ||
            route.name === 'User' ||
            route.name === 'TopicComposer' ? (
              children
            ) : (
              <RouteBackdrop>{children}</RouteBackdrop>
            )
          }
          screenOptions={({ navigation }) => ({
            headerShown: false,
            headerShadowVisible: false,
            headerTitleStyle: styles.headerTitle,
            headerLeft: ({ canGoBack }) =>
              canGoBack ? (
                <IconButton
                  icon={ChevronLeft}
                  iconOnly
                  iconSize={24}
                  label="返回"
                  onPress={() => goBackFromFocusedRoute(navigation)}
                />
              ) : null,
            animation: 'slide_from_right',
            freezeOnBlur: true,
            contentStyle: { backgroundColor: theme.background }
          })}
        >
          <Stack.Screen name="MainTabs">
            {() => (
              <ScreenContext.Provider value={MainTabScreen}>
                <MainTabsHost
                  moreBadgeState={moreBadgeState}
                  FeedRouteComponent={FeedRouteComponent}
                  getNotificationsRoute={getNotificationsRoute}
                  getMoreRoute={getMoreRoute}
                  getSearchRoute={getSearchRoute}
                  styles={styles}
                  onBottomTabBarLayout={onBottomTabBarLayout}
                />
              </ScreenContext.Provider>
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
          <Stack.Screen
            name="NetworkSettings"
            getComponent={getNetworkSettingsRoute}
            options={({ route }) => ({
              headerShown: route.params?.page !== 'proxies',
              title: route.params?.page === 'log' ? '网络日志' : '网络设置'
            })}
          />
          <Stack.Screen name="User" getComponent={getUserRoute} />
          <Stack.Screen
            name="NodeSeekCredits"
            getComponent={getNodeSeekCreditsRoute}
            options={{ headerShown: true, title: '鸡腿流水' }}
          />
          <Stack.Screen
            name="LinuxDoCredit"
            getComponent={getLinuxDoCreditRoute}
            options={{ headerShown: true, title: 'LDC 收支明细' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </NavigationBackdropProvider>
  );
});
