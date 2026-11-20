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

export function goBackFromFocusedRoute(navigation: FocusedRouteNavigation) {
  dispatchFocusedRoute(navigation, CommonActions.goBack());
}

export function manageContentSourcesAction() {
  return StackActions.popTo('MainTabs', {
    screen: 'more',
    params: { intent: 'manage-content-sources' as const }
  });
}
