import type { Reply, Source, Topic, TopicDetail, UserReference } from './models';
import { accessRequirementLevelValue, accessRequirementSpecificity } from './presentation';
import { parseForumUserLink } from './links';
import { accessRequirementFromNoticeText, textContentFromHtml } from './html';

export function nodeSeekUserIdFromValue(value?: string) {
  const text = String(value || '').trim();
  return text.match(/(?:^|\/)space\/(\d+)(?:[/?#]|$)/)?.[1] || (/^\d+$/.test(text) ? text : '');
}

export function normalizeUserReference(user: UserReference): UserReference | null {
  const username = user.username?.trim() || undefined;
  const id =
    user.source === 'nodeseek'
      ? nodeSeekUserIdFromValue(user.id) || nodeSeekUserIdFromValue(user.url) || undefined
      : user.id?.trim() || username;
  if (!id && !username) return null;
  return {
    source: user.source,
    ...(id ? { id, ...(username ? { username } : {}) } : { username: username! }),
    displayName: user.displayName,
    avatar: user.avatar,
    url: user.url || ''
  };
}

function nodeSeekAuthorId(authorId?: string, authorUrl?: string) {
  return nodeSeekUserIdFromValue(authorId) || nodeSeekUserIdFromValue(authorUrl);
}

export function userReferenceFromUsername(source: Source, value: string, displayName = value): UserReference | null {
  const username = value.trim();
  if (!username) {
    return null;
  }
  const baseUrls: Partial<Record<Source, string>> = {
    linuxdo: 'https://linux.do/u/',
    nodeseek: 'https://www.nodeseek.com/member?t=',
    v2ex: 'https://www.v2ex.com/member/',
    xiaoyinsi: 'https://forum.xiaoyinsi.com/u/'
  };
  return {
    source,
    ...(source === 'nodeseek' ? {} : { id: username }),
    username,
    displayName,
    url: `${baseUrls[source] || ''}${encodeURIComponent(username)}`
  };
}

function discourseUserReference(
  source: 'linuxdo' | 'xiaoyinsi',
  authorId?: string,
  authorUrl?: string,
  displayName?: string,
  avatar?: string
): UserReference | null {
  const linked = authorUrl ? parseForumUserLink(authorUrl) : null;
  const username = authorId?.trim() || (linked?.source === source ? linked.username : undefined);
  const reference = username ? userReferenceFromUsername(source, username, displayName || username) : null;
  return reference
    ? {
        ...reference,
        avatar,
        url: linked?.source === source ? linked.url : reference.url
      }
    : null;
}

function detailContentLooksRestricted(topic: Topic | TopicDetail) {
  if (!('contentHtml' in topic)) {
    return false;
  }
  const text = textContentFromHtml(topic.contentHtml).replace(/\s+/g, ' ').trim();
  if (!text) {
    return false;
  }
  return Boolean(accessRequirementFromNoticeText(text, { requireStart: true }));
}

function shouldUseFallbackAccessRequirement(topic: Topic | TopicDetail, fallback: Topic) {
  if (!fallback.accessRequirement) {
    return false;
  }
  if (!topic.accessRequirement) {
    if ('contentHtml' in topic && String(topic.contentHtml || '').trim()) {
      return detailContentLooksRestricted(topic);
    }
    return true;
  }
  if (topic.accessRequirement.type === 'level' && fallback.accessRequirement.type === 'level') {
    return (
      !accessRequirementLevelValue(topic.accessRequirement) &&
      Boolean(accessRequirementLevelValue(fallback.accessRequirement))
    );
  }
  return (
    accessRequirementSpecificity(fallback.accessRequirement) > accessRequirementSpecificity(topic.accessRequirement)
  );
}

export function topicWithAuthorFallback<T extends Topic | TopicDetail>(
  topic: T | null,
  fallback?: Topic | null
): T | null {
  if (!topic) {
    return topic;
  }
  if (!fallback || fallback.source !== topic.source || fallback.id !== topic.id) {
    return topic;
  }
  const accessRequirementFields = shouldUseFallbackAccessRequirement(topic, fallback)
    ? { accessRequirement: fallback.accessRequirement }
    : {};
  const hasRestrictedPlaceholder = Boolean(topic.accessRequirement && topic.title === '受限帖子');
  const fallbackTopicFields = hasRestrictedPlaceholder
    ? {
        title: fallback.title || topic.title,
        author: fallback.author || topic.author,
        authorLevelLabel: fallback.authorLevelLabel || topic.authorLevelLabel,
        categoryId: fallback.categoryId || topic.categoryId,
        category: fallback.category || topic.category
      }
    : {};
  const replyCountFields =
    topic.source === 'nodeseek' && fallback.replyCount > topic.replyCount ? { replyCount: fallback.replyCount } : {};
  if (topic.source !== 'nodeseek') {
    const hasFallbackFields = Object.keys(fallbackTopicFields).length > 0;
    return Object.keys(accessRequirementFields).length || hasFallbackFields
      ? { ...topic, ...accessRequirementFields, ...fallbackTopicFields }
      : topic;
  }
  const hasReplyCountFields = Object.keys(replyCountFields).length > 0;
  const fallbackAuthorId = nodeSeekAuthorId(fallback.authorId, fallback.authorUrl);
  if (topic.authorId && !hasRestrictedPlaceholder) {
    return Object.keys(accessRequirementFields).length || hasReplyCountFields
      ? { ...topic, ...accessRequirementFields, ...replyCountFields }
      : topic;
  }
  const authorId = topic.authorId || fallbackAuthorId;
  if (!authorId && !hasRestrictedPlaceholder) {
    return Object.keys(accessRequirementFields).length || hasReplyCountFields
      ? { ...topic, ...accessRequirementFields, ...replyCountFields }
      : topic;
  }
  return {
    ...topic,
    ...replyCountFields,
    ...accessRequirementFields,
    ...fallbackTopicFields,
    author: hasRestrictedPlaceholder ? fallback.author || topic.author : topic.author || fallback.author,
    authorId: authorId || topic.authorId,
    authorAvatar: topic.authorAvatar || fallback.authorAvatar,
    authorLevelLabel: topic.authorLevelLabel || fallback.authorLevelLabel,
    authorUrl: topic.authorUrl || fallback.authorUrl
  };
}

export function userFromTopic(topic: Topic | TopicDetail): UserReference | null {
  if (topic.source === 'linuxdo' || topic.source === 'xiaoyinsi') {
    return discourseUserReference(topic.source, topic.authorId, topic.authorUrl, topic.author, topic.authorAvatar);
  }
  const nodeSeekId = topic.source === 'nodeseek' ? nodeSeekAuthorId(topic.authorId, topic.authorUrl) : '';
  const username = topic.author?.trim() || undefined;
  const id = nodeSeekId || (topic.source === 'nodeseek' ? '' : topic.authorId || username);
  if (!id && !username) {
    return null;
  }
  const identity = id ? { id, ...(username ? { username } : {}) } : { username: username! };
  return {
    source: topic.source,
    ...identity,
    displayName: username,
    avatar: topic.authorAvatar,
    url:
      topic.authorUrl ||
      (topic.source === 'nodeseek'
        ? id
          ? `https://www.nodeseek.com/space/${id}`
          : `https://www.nodeseek.com/member?t=${encodeURIComponent(username || '')}`
        : '')
  };
}

export function userFromReply(reply: Reply, source?: Source): UserReference | null {
  if (!source) {
    return null;
  }
  if (source === 'linuxdo' || source === 'xiaoyinsi') {
    return discourseUserReference(source, reply.authorId, reply.authorUrl, reply.author, reply.authorAvatar);
  }
  const nodeSeekId = source === 'nodeseek' ? nodeSeekAuthorId(reply.authorId, reply.authorUrl) : '';
  const username = reply.author?.trim() || undefined;
  const id = nodeSeekId || (source === 'nodeseek' ? '' : reply.authorId || username);
  if (!id && !username) {
    return null;
  }
  const identity = id ? { id, ...(username ? { username } : {}) } : { username: username! };
  return {
    source,
    ...identity,
    displayName: username,
    avatar: reply.authorAvatar,
    url:
      reply.authorUrl ||
      (source === 'nodeseek'
        ? id
          ? `https://www.nodeseek.com/space/${id}`
          : `https://www.nodeseek.com/member?t=${encodeURIComponent(username || '')}`
        : '')
  };
}
