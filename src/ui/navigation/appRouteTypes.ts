import type { NavigatorScreenParams } from '@react-navigation/native';
import type { Topic, UserReference } from '@/domain/forum/models';

export type MainTabParamList = {
  feed: undefined;
  search: undefined;
  library: undefined;
  more: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Topic: { topic: Topic };
  ReadingSettings: undefined;
  User: { user: UserReference };
};
