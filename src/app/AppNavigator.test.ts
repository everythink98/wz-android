import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonActions, StackActions as RouterStackActions, StackRouter } from '@react-navigation/routers';

const navigation = vi.hoisted(() => ({
  dispatch: vi.fn(),
  isReady: vi.fn(() => true)
}));

vi.mock('@react-navigation/native', () => ({
  NavigationContainer: () => null,
  StackActions: {
    popTo: (name: string, params: object) => ({ type: 'POP_TO', payload: { name, params } }),
    push: (name: string) => ({ type: 'PUSH', payload: { name } })
  },
  createNavigationContainerRef: () => navigation
}));
vi.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({ Navigator: () => null, Screen: () => null })
}));
vi.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({ Navigator: () => null, Screen: () => null })
}));
vi.mock('../components/NavBar', () => ({ TabBarIcon: () => null, tabNavItems: [] }));
vi.mock('../components/AppControls', () => ({ triggerPressFeedback: vi.fn() }));

import { AppNavigator, navigateMainTab, shouldUpdateAppRootScreen } from './AppNavigator';

describe('AppNavigator', () => {
  it('skips parent-only rerenders when its navigation props are unchanged', () => {
    expect(AppNavigator).toMatchObject({ $$typeof: Symbol.for('react.memo') });
  });

  it('publishes every route transition', () => {
    expect(shouldUpdateAppRootScreen('feed', 'more')).toBe(true);
    expect(shouldUpdateAppRootScreen('search', 'library')).toBe(true);
    expect(shouldUpdateAppRootScreen('more', 'topic')).toBe(true);
    expect(shouldUpdateAppRootScreen('topic', 'more')).toBe(true);
    expect(shouldUpdateAppRootScreen('topic', 'user')).toBe(true);
  });

  it('publishes a tab change before treating a repeated tab press as same-screen', () => {
    expect(shouldUpdateAppRootScreen('feed', 'search')).toBe(true);
    expect(shouldUpdateAppRootScreen('search', 'search')).toBe(false);
  });
});

describe('navigateMainTab', () => {
  beforeEach(() => {
    navigation.dispatch.mockClear();
    navigation.isReady.mockReturnValue(true);
  });

  it('pops back to the existing MainTabs route', () => {
    navigateMainTab('search');

    expect(navigation.dispatch).toHaveBeenCalledWith({
      type: 'POP_TO',
      payload: {
        name: 'MainTabs',
        params: { screen: 'search' }
      }
    });
  });

  it('removes deep routes instead of stacking a second MainTabs route', () => {
    const router = StackRouter({ initialRouteName: 'MainTabs' });
    const options = {
      routeNames: ['MainTabs', 'Topic', 'User'],
      routeParamList: { MainTabs: undefined, Topic: undefined, User: undefined },
      routeGetIdList: {},
      routeKeyChanges: [],
      routePreloadList: {}
    };
    const initialState = router.getInitialState(options);
    const topicResult = router.getStateForAction(initialState, CommonActions.navigate('Topic'), options);
    if (!topicResult) {
      throw new Error('Topic navigation was not handled');
    }
    const topicState = router.getRehydratedState(topicResult, options);
    const mainTabsResult = router.getStateForAction(topicState, RouterStackActions.popTo('MainTabs', { screen: 'more' }), options);
    if (!mainTabsResult) {
      throw new Error('MainTabs pop was not handled');
    }
    const state = router.getRehydratedState(mainTabsResult, options);

    expect(state.routes.map((route) => route.name)).toEqual(['MainTabs']);
    expect(state.routes[0]?.params).toEqual({ screen: 'more' });
  });
});
