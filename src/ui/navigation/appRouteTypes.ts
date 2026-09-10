import type { NavigatorScreenParams } from '@react-navigation/native';
import type { TopicLocationTarget, Topic, UserReference } from '@/domain/forum/models';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification } from '@/domain/notifications/models';

export type MainTabParamList = {
  feed: undefined;
  search: undefined;
  library: undefined;
  more: { intent?: 'manage-content-sources' } | undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Notifications: { source?: NotificationSource } | undefined;
  NotificationDetail: { notification: ForumNotification; identityKey: string };
  NotificationSettings: undefined;
  Topic: { topic: Topic; location?: TopicLocationTarget; locationRequestId?: number };
  ReadingSettings: undefined;
  User: { user: UserReference };
};
