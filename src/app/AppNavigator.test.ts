import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonActions, StackActions as RouterStackActions, StackRouter } from '@react-navigation/routers';
import type { Topic, UserReference } from '@/domain/forum/models';

const navigation = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getCurrentRoute: vi.fn(),
  isReady: vi.fn(() => true)
}));

vi.mock('@react-navigation/native', () => ({
  NavigationContainer: () => null,
  StackActions: {
    popTo: (name: string, params: object) => ({ type: 'POP_TO', payload: { name, params } }),
    push: (name: string, params?: object) => ({ type: 'PUSH', payload: { name, params } })
  },
  createNavigationContainerRef: () => navigation
}));
vi.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({ Navigator: () => null, Screen: () => null })
}));
vi.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({ Navigator: () => null, Screen: () => null })
}));
vi.mock('lucide-react-native', () => ({ Settings: () => null }));
vi.mock('react-native', () => ({ View: () => null }));
vi.mock('@/ui/navigation/NavBar', () => ({ TabBarIcon: () => null, tabNavItems: [] }));
vi.mock('@/ui/controls/pressFeedback', () => ({ triggerPressFeedback: vi.fn() }));

import {
  isNativeStackScreen,
  navigateAppScreen,
  navigateMainTab,
  pushTopicRoute,
  pushUserRoute,
  shouldUpdateAppRootScreen
} from './appNavigation';

const topic: Topic = {
  source: 'linuxdo',
  id: '42',
  title: 'Topic 42',
  author: 'alice',
  url: 'https://linux.do/t/42',
  createdAt: '2026-01-01T00:00:00.000Z',
  replyCount: 0
};
const user: UserReference = { source: 'linuxdo', id: '7', username: 'alice', url: 'https://linux.do/u/alice' };

describe('AppNavigator', () => {
  it('publishes only real route changes', () => {
    expect(shouldUpdateAppRootScreen('feed', 'topic')).toBe(true);
    expect(shouldUpdateAppRootScreen('topic', 'user')).toBe(true);
    expect(shouldUpdateAppRootScreen('feed', 'feed')).toBe(false);
  });
});

describe('navigation commands', () => {
  beforeEach(() => {
    navigation.dispatch.mockClear();
    navigation.isReady.mockReturnValue(true);
    navigation.getCurrentRoute.mockReturnValue({ key: 'feed', name: 'feed' });
  });

  it('returns tab destinations through the existing MainTabs route', () => {
    navigateMainTab('search');
    expect(navigation.dispatch).toHaveBeenCalledWith({
      type: 'POP_TO',
      payload: { name: 'MainTabs', params: { screen: 'search' } }
    });
  });

  it('[REG-NOTIFY-004] leaves hardware back to every native stack route', () => {
    for (const name of [
      'Topic',
      'User',
      'Notifications',
      'NotificationDetail',
      'NotificationSettings',
      'ReadingSettings'
    ]) {
      navigation.getCurrentRoute.mockReturnValue({ key: name, name });
      expect(isNativeStackScreen()).toBe(true);
    }

    navigation.getCurrentRoute.mockReturnValue({ key: 'more', name: 'more' });
    expect(isNativeStackScreen()).toBe(false);
  });

  it('requires canonical data for detail routes', () => {
    expect(navigateAppScreen('topic')).toBe(false);
    expect(navigateAppScreen('user')).toBe(false);
    expect(pushTopicRoute(topic)).toBe(true);
    expect(pushUserRoute(user)).toBe(true);

    expect(navigation.dispatch.mock.calls).toEqual([
      [{ type: 'PUSH', payload: { name: 'Topic', params: { topic } } }],
      [{ type: 'PUSH', payload: { name: 'User', params: { user } } }]
    ]);
  });

  it('pops MainTabs without stacking another tab host', () => {
    const router = StackRouter({ initialRouteName: 'MainTabs' });
    const options = {
      routeNames: ['MainTabs', 'Topic'],
      routeParamList: { MainTabs: undefined, Topic: undefined },
      routeGetIdList: {},
      routeKeyChanges: [],
      routePreloadList: {}
    };
    const initial = router.getInitialState(options);
    const topicState = router.getStateForAction(initial, CommonActions.navigate('Topic'), options);
    if (!topicState) throw new Error('Topic navigation was not handled');
    const result = router.getStateForAction(
      router.getRehydratedState(topicState, options),
      RouterStackActions.popTo('MainTabs', { screen: 'more' }),
      options
    );
    if (!result) throw new Error('MainTabs pop was not handled');

    expect(result.routes.map((route) => route.name)).toEqual(['MainTabs']);
    expect(result.routes[0]?.params).toEqual({ screen: 'more' });
  });
});
