import { StackActions } from '@react-navigation/native';

export function manageContentSourcesAction() {
  return StackActions.popTo('MainTabs', {
    screen: 'more',
    params: { intent: 'manage-content-sources' as const }
  });
}
