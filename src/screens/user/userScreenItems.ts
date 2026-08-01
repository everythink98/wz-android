import type { Topic, UserReference, UserReplyActivity } from '@/domain/forum/models';

export type UserActivityTab = 'topics' | 'replies';

export type UserListItem =
  { type: 'topic'; key: string; topic: Topic } | { type: 'reply'; key: string; reply: UserReplyActivity };

function uniqueListKey(baseKey: string, seen: Map<string, number>) {
  const count = seen.get(baseKey) || 0;
  seen.set(baseKey, count + 1);
  return count === 0 ? baseKey : `${baseKey}:${count + 1}`;
}

export function createUserListItems(
  tab: UserActivityTab,
  topics: Topic[],
  replies: UserReplyActivity[]
): UserListItem[] {
  const seen = new Map<string, number>();
  if (tab === 'replies') {
    return replies.map((reply) => ({
      type: 'reply',
      key: uniqueListKey(`${reply.source}:reply:${reply.id}`, seen),
      reply
    }));
  }
  return topics.map((topic) => ({ type: 'topic', key: uniqueListKey(`${topic.source}:${topic.id}`, seen), topic }));
}

export function userListItemKey(item: UserListItem) {
  return item.key;
}

export function userListItemType(item: UserListItem) {
  return item.type;
}

export function userListInstanceKey(user: UserReference, tab: UserActivityTab) {
  return `${user.source}:${user.id || user.username}:${tab}`;
}
