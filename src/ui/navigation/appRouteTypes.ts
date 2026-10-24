import type { NavigatorScreenParams } from '@react-navigation/native';
import type { TopicLocationTarget, Topic, UserReference, UserActivityTab } from '@/domain/forum/models';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';
import type { ForumNotification } from '@/domain/notifications/models';
import type { TopicComposerIntent } from '@/domain/forum/topicComposer';
import type { NodeSeekCreditCurrency } from '@/domain/forum/accountData';
import type { LibraryTab } from '@/domain/forum/feed';

export type MainTabParamList = {
  feed: undefined;
  search: undefined;
  more: { intent?: 'manage-content-sources' } | undefined;
  notifications: { source?: NotificationSource } | undefined;
};

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Library: { initialTab?: LibraryTab } | undefined;
  NotificationDetail: { notification: ForumNotification; identityKey: string };
  NotificationSettings: undefined;
  Topic: { topic: Topic; location?: TopicLocationTarget; locationRequestId?: number };
  TopicComposer: TopicComposerIntent;
  ReadingSettings: undefined;
  NodeSeekCredits: { identityKey: string; userId: string; currency?: NodeSeekCreditCurrency };
  LinuxDoCredit: { identityKey: string; userId: string; username: string };
  User: { user: UserReference; initialTab?: UserActivityTab };
};
