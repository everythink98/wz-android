import type { Topic } from '@/domain/forum/models';
import type { NotificationSource } from '@/domain/forum/sourceCatalog';

export type NotificationKind = 'mention' | 'reply' | 'private-message' | 'reaction' | 'system' | 'other';

export interface NotificationCategory {
  id: string;
  label: string;
}

export type NotificationTarget =
  | { type: 'topic-post'; topicId: string; postNumber?: number; postId?: string; url: string }
  | { type: 'private-conversation'; conversationId: string }
  | { type: 'message-detail'; messageId: string; url: string }
  | { type: 'information' };

export interface ForumNotification {
  source: NotificationSource;
  id: string;
  kind: NotificationKind;
  actor: {
    id?: string;
    name: string;
    avatarUrl?: string;
  };
  title: string;
  preview?: string;
  createdAt: string | null;
  displayTime?: string;
  unread: boolean;
  target: NotificationTarget;
  remoteGroup?: string;
  remoteCursor?: string;
  remoteReadId?: string;
}

export interface NotificationPage {
  items: ForumNotification[];
  cursor: string | null;
  hasMore: boolean;
}

export interface NotificationUnreadSnapshot {
  total: number;
  checkedAt: string;
}

export interface NotificationMessage {
  id: string;
  author: string;
  contentHtml?: string;
  contentText?: string;
  createdAt: string | null;
  mine?: boolean;
}

export interface NotificationDetail {
  notification: ForumNotification;
  title: string;
  contentHtml?: string;
  contentText?: string;
  messages?: NotificationMessage[];
  reply?: {
    format: 'markdown' | 'plain-text';
    disabledReason?: string;
  };
  historyNotice?: string;
  topic?: Topic;
  unreadMessageIds?: string[];
}

export interface NotificationMarkResult {
  confirmed: boolean;
  message?: string;
}

export type NotificationReplyResult = NotificationMarkResult;
