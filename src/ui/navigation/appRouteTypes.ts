import type { NavigatorScreenParams } from '@react-navigation/native';
import type { ReplyLocationTarget, Topic, UserReference } from '@/domain/forum/models';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification } from '@/domain/notifications/models';

export type MainTabParamList = {
  feed: undefined;
  search: undefined;
  library: undefined;
  more: undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Notifications: { source?: NotificationSource } | undefined;
  NotificationDetail: { notification: ForumNotification; identityKey: string };
  NotificationSettings: undefined;
  Topic: { topic: Topic; targetReply?: ReplyLocationTarget };
  ReadingSettings: undefined;
  User: { user: UserReference };
};
