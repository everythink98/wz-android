import type { Topic, UserReplyActivity } from '@/domain/forum/models';

export type UserActivityTab = 'topics' | 'replies';

export type UserListItem =
  | { type: 'tabs'; key: string }
  | { type: 'topic'; key: string; topic: Topic }
  | { type: 'reply'; key: string; reply: UserReplyActivity };

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
  const items: UserListItem[] = [{ type: 'tabs', key: 'user-activity-tabs' }];
  if (tab === 'replies') {
    for (const reply of replies) {
      items.push({
        type: 'reply',
        key: uniqueListKey(`${reply.source}:reply:${reply.id}`, seen),
        reply
      });
    }
  } else {
    for (const topic of topics) {
      items.push({ type: 'topic', key: uniqueListKey(`${topic.source}:${topic.id}`, seen), topic });
    }
  }
  return items;
}

export function userListItemKey(item: UserListItem) {
  return item.key;
}

export function userListItemType(item: UserListItem) {
  return item.type;
}
