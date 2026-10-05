import type { UserReference } from '@/domain/forum/models';
import { parseForumUserLink } from '@/domain/forum/links';
import { sourceCatalog } from '@/domain/forum/sourceCatalog';
import { userReferenceFromUsername } from '@/domain/forum/userNavigation';
import type { ForumNotification } from '@/domain/notifications/models';

export function notificationActorUser(notification: ForumNotification): UserReference | null {
  const { source, actor } = notification;
  const id = actor.id?.trim();
  if (!id) return null;
  if (source === 'linuxdo') {
    const user = userReferenceFromUsername(source, id, actor.name);
    return user ? { ...user, avatar: actor.avatarUrl } : null;
  }
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) return null;
  const path = source === 'nodeseek' ? `/space/${id}` : `/bbs/userinfo.aspx?touserid=${id}`;
  const user = parseForumUserLink(path, sourceCatalog[source].baseUrl);
  return user ? { ...user, displayName: actor.name, avatar: actor.avatarUrl } : null;
}
