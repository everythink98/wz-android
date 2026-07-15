import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonActions, StackActions as RouterStackActions, StackRouter } from '@react-navigation/routers';

const navigation = vi.hoisted(() => ({
  dispatch: vi.fn(),
  getCurrentRoute: vi.fn(),
  getRootState: vi.fn(),
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

import { AppNavigator, currentTopicRouteKey, navigateAppScreen, navigateMainTab, openReadingSettingsFromCurrentTopic, previousTopicRouteKey, shouldUpdateAppRootScreen } from './AppNavigator';

describe('AppNavigator', () => {
  it('skips parent-only rerenders when its navigation props are unchanged', () => {
    expect(AppNavigator).toMatchObject({ $$typeof: Symbol.for('react.memo') });
  });

  it('keeps main-tab state inside the navigator while publishing detail transitions', () => {
    expect(shouldUpdateAppRootScreen('feed', 'more')).toBe(false);
    expect(shouldUpdateAppRootScreen('search', 'library')).toBe(false);
    expect(shouldUpdateAppRootScreen('more', 'topic')).toBe(true);
    expect(shouldUpdateAppRootScreen('topic', 'more')).toBe(true);
    expect(shouldUpdateAppRootScreen('topic', 'user')).toBe(true);
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

  it('keeps nested Topic and User routes distinct and pops them one level at a time', () => {
    const router = StackRouter({ initialRouteName: 'MainTabs' });
    const options = {
      routeNames: ['MainTabs', 'Topic', 'User'],
      routeParamList: { MainTabs: undefined, Topic: undefined, User: undefined },
      routeGetIdList: {},
      routeKeyChanges: [],
      routePreloadList: {}
    };
    let state = router.getInitialState(options);
    for (const action of [
      RouterStackActions.push('Topic'),
      RouterStackActions.push('User'),
      RouterStackActions.push('Topic')
    ]) {
      const result = router.getStateForAction(state, action, options);
      if (!result) {
        throw new Error(`Navigation action ${action.type} was not handled`);
      }
      state = router.getRehydratedState(result, options);
    }

    expect(state.routes.map((route) => route.name)).toEqual(['MainTabs', 'Topic', 'User', 'Topic']);
    expect(state.routes[1]?.key).not.toBe(state.routes[3]?.key);

    for (const expectedRoutes of [
      ['MainTabs', 'Topic', 'User'],
      ['MainTabs', 'Topic'],
      ['MainTabs']
    ]) {
      const result = router.getStateForAction(state, RouterStackActions.pop(1), options);
      if (!result) {
        throw new Error('Stack pop was not handled');
      }
      state = router.getRehydratedState(result, options);
      expect(state.routes.map((route) => route.name)).toEqual(expectedRoutes);
    }
  });
});

describe('topic route keys', () => {
  beforeEach(() => {
    navigation.isReady.mockReturnValue(true);
  });

  it('identifies both the active Topic route and the Topic directly below User', () => {
    navigation.getCurrentRoute.mockReturnValue({ key: 'Topic-active', name: 'Topic' });
    expect(currentTopicRouteKey()).toBe('Topic-active');

    navigation.getCurrentRoute.mockReturnValue({ key: 'User-active', name: 'User' });
    navigation.getRootState.mockReturnValue({
      index: 2,
      routes: [
        { key: 'MainTabs', name: 'MainTabs' },
        { key: 'Topic-return', name: 'Topic' },
        { key: 'User-active', name: 'User' }
      ]
    });
    expect(currentTopicRouteKey()).toBeNull();
    expect(previousTopicRouteKey()).toBe('Topic-return');
  });

  it('[REG-TOPIC-002] saves the current Topic snapshot before opening reading settings', () => {
    const events: string[] = [];
    const saveTopicRoute = vi.fn(() => events.push('save'));
    navigation.dispatch.mockImplementation(() => events.push('push'));
    navigation.getCurrentRoute.mockReturnValue({ key: 'Topic-active', name: 'Topic' });

    expect(openReadingSettingsFromCurrentTopic(saveTopicRoute)).toBe(true);

    expect(saveTopicRoute).toHaveBeenCalledWith('Topic-active');
    expect(events).toEqual(['save', 'push']);
  });
});

describe('navigateAppScreen', () => {
  beforeEach(() => {
    navigation.dispatch.mockClear();
    navigation.isReady.mockReturnValue(true);
    navigation.getCurrentRoute.mockReturnValue({ key: 'feed', name: 'feed' });
  });

  it('pushes detail routes but returns tab destinations through the existing MainTabs route', () => {
    expect(navigateAppScreen('topic')).toBe(true);
    expect(navigateAppScreen('user')).toBe(true);
    expect(navigateAppScreen('library')).toBe(true);

    expect(navigation.dispatch.mock.calls).toEqual([
      [{ type: 'PUSH', payload: { name: 'Topic' } }],
      [{ type: 'PUSH', payload: { name: 'User' } }],
      [{ type: 'POP_TO', payload: { name: 'MainTabs', params: { screen: 'library' } } }]
    ]);
  });
});
