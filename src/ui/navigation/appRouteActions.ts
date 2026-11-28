import {
  CommonActions,
  StackActions,
  type NavigationAction,
  type NavigationHelpers,
  type ParamListBase
} from '@react-navigation/native';

export type FocusedRouteNavigation = Pick<NavigationHelpers<ParamListBase>, 'isFocused' | 'dispatch'>;

export function dispatchFocusedRoute(navigation: FocusedRouteNavigation, action: NavigationAction) {
  if (navigation.isFocused()) navigation.dispatch(action);
}

let topicRouteDispatch: ((dispatch: () => void) => void) | undefined;

export function installTopicRouteDispatch(handler: NonNullable<typeof topicRouteDispatch>) {
  topicRouteDispatch = handler;
  return () => {
    if (topicRouteDispatch === handler) topicRouteDispatch = undefined;
  };
}

export function dispatchTopicRoute(dispatch: () => void) {
  if (topicRouteDispatch) topicRouteDispatch(dispatch);
  else dispatch();
}

export function goBackFromFocusedRoute(navigation: FocusedRouteNavigation) {
  dispatchFocusedRoute(navigation, CommonActions.goBack());
}

export function manageContentSourcesAction() {
  return StackActions.popTo('MainTabs', {
    screen: 'more',
    params: { intent: 'manage-content-sources' as const }
  });
}
