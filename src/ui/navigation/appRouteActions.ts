import {
  StackActions,
  type NavigationAction,
  type NavigationHelpers,
  type ParamListBase
} from '@react-navigation/native';

export function dispatchFocusedRoute(
  navigation: Pick<NavigationHelpers<ParamListBase>, 'isFocused' | 'dispatch'>,
  action: NavigationAction
) {
  if (navigation.isFocused()) navigation.dispatch(action);
}

export function manageContentSourcesAction() {
  return StackActions.popTo('MainTabs', {
    screen: 'more',
    params: { intent: 'manage-content-sources' as const }
  });
}
