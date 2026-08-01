import {
  createContext,
  memo,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  NavigationContainer,
  StackActions,
  createNavigationContainerRef,
  type NavigatorScreenParams,
  type Theme,
  useIsFocused
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FlashListRef } from '@shopify/flash-list';
import { View } from 'react-native';
import { TabBarIcon, tabNavItems } from '../components/NavBar';
import { triggerPressFeedback } from '../components/AppControls';
import type { createStyles, ReaderTheme } from '../theme';
import type { Screen } from '../appTypes';
import { OriginalImageUpgradeBoundary } from '../originalImageLoading';
import type { TopicListItem } from '../screens/TopicScreen';
import type { Source } from '../types';

export type MainTabParamList = {
  feed: undefined;
  search: undefined;
  library: undefined;
  more: undefined;
};

export type TopicRouteSeed = {
  source: Source;
  topicId: string;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Topic: TopicRouteSeed | undefined;
  ReadingSettings: undefined;
  User: undefined;
};

export type TopicRouteRenderRequest = {
  listRef: RefObject<FlashListRef<TopicListItem> | null>;
  routeKey: string;
  routeSource?: Source;
  seed?: TopicRouteSeed;
};

export type TopicRoutePresentation = {
  content: ReactNode;
  identity: string;
  loadingContent: ReactNode;
  routeSessionEpoch: number;
  sessionEpoch: number;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const TopicScreenRendererContext = createContext<(request: TopicRouteRenderRequest) => TopicRoutePresentation>(() => ({
  content: null,
  identity: '',
  loadingContent: null,
  routeSessionEpoch: 0,
  sessionEpoch: 0
}));

function topicRouteIdentity(seed?: TopicRouteSeed) {
  return seed ? `${seed.source}:${seed.topicId}` : '';
}

function topicRouteSource(identity: string) {
  const separator = identity.indexOf(':');
  return separator > 0 ? (identity.slice(0, separator) as Source) : undefined;
}

function topicPresentationMatchesRoute(
  presentation: TopicRoutePresentation | null,
  identity: string,
  sessionEpoch: number
) {
  return Boolean(
    presentation &&
    identity &&
    presentation.identity === identity &&
    presentation.routeSessionEpoch === sessionEpoch &&
    presentation.sessionEpoch === sessionEpoch
  );
}

function TopicRouteScreen({ route }: NativeStackScreenProps<RootStackParamList, 'Topic'>) {
  const renderTopicScreen = useContext(TopicScreenRendererContext);
  const focused = useIsFocused();
  const listRef = useRef<FlashListRef<TopicListItem> | null>(null);
  const seededIdentity = topicRouteIdentity(route.params);
  const [capturedIdentity, setCapturedIdentity] = useState('');
  const [cachedPresentation, setCachedPresentation] = useState<TopicRoutePresentation | null>(null);
  const expectedIdentity = seededIdentity || capturedIdentity;
  const routeSource = route.params?.source || topicRouteSource(capturedIdentity);
  const presentation = useMemo(
    () => renderTopicScreen({ listRef, routeKey: route.key, routeSource, seed: route.params }),
    [renderTopicScreen, route.key, route.params, routeSource]
  );
  const livePresentationMatchesRoute = topicPresentationMatchesRoute(
    presentation,
    expectedIdentity,
    presentation.routeSessionEpoch
  );
  const cachedPresentationMatchesRoute = topicPresentationMatchesRoute(
    cachedPresentation,
    expectedIdentity,
    presentation.routeSessionEpoch
  );
  const visiblePresentation =
    focused && livePresentationMatchesRoute ? presentation : cachedPresentationMatchesRoute ? cachedPresentation : null;
  const interactive = focused && livePresentationMatchesRoute;

  useLayoutEffect(() => {
    if (!seededIdentity && !capturedIdentity && focused && presentation.identity) {
      setCapturedIdentity(presentation.identity);
    }
  }, [capturedIdentity, focused, presentation.identity, seededIdentity]);

  useLayoutEffect(() => {
    if (focused && livePresentationMatchesRoute) {
      setCachedPresentation(presentation);
      return;
    }
    setCachedPresentation((current) =>
      topicPresentationMatchesRoute(current, expectedIdentity, presentation.routeSessionEpoch) ? current : null
    );
  }, [expectedIdentity, focused, livePresentationMatchesRoute, presentation]);

  return (
    <TopicRouteInteractionBoundary interactive={interactive}>
      {visiblePresentation?.content || presentation.loadingContent}
    </TopicRouteInteractionBoundary>
  );
}

function TopicRouteInteractionBoundary({ children, interactive }: { children: ReactNode; interactive: boolean }) {
  return (
    <OriginalImageUpgradeBoundary enabled={interactive}>
      <View
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
        pointerEvents={interactive ? 'auto' : 'none'}
        style={{ flex: 1 }}
      >
        {children}
      </View>
    </OriginalImageUpgradeBoundary>
  );
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
  return previousScreen !== nextScreen;
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

export function pushTopicRoute(seed?: TopicRouteSeed) {
  if (!navigationRef.isReady()) {
    return false;
  }
  navigationRef.dispatch(StackActions.push('Topic', seed));
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
  renderTopicScreen: (request: TopicRouteRenderRequest) => TopicRoutePresentation;
  renderUserScreen: () => ReactNode;
  styles: ReturnType<typeof createStyles>;
  theme: ReaderTheme;
  onReady: () => void;
  onScreenChange: (screen: Screen, routeKey: string) => void;
  onTabPress: (target: keyof MainTabParamList) => void;
  onTopicClosing: (routeKey: string) => void;
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
          <Stack.Screen
            name="Topic"
            component={TopicRouteScreen}
            listeners={({ route }) => ({
              transitionEnd: (event) => {
                if (event.data.closing) {
                  onTopicClosing(route.key);
                }
              }
            })}
          />
          <Stack.Screen name="ReadingSettings" options={{ headerShown: true, title: '阅读设置' }}>
            {renderReadingSettingsScreen}
          </Stack.Screen>
          <Stack.Screen
            name="User"
            listeners={{
              transitionEnd: (event) => {
                if (event.data.closing) {
                  onUserClosing();
                }
              }
            }}
          >
            {renderUserScreen}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </TopicScreenRendererContext.Provider>
  );
});
