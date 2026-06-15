import type { Reply, Source, Topic, TopicDetail, UserProfile } from './types';
import { accessRequirementLevelValue, accessRequirementSpecificity } from './appUtils';
import { ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE, accessRequirementFromText, textContentFromHtml } from './localHtml';

const accessRequirementNoticeStartPattern = new RegExp(`^(?:${ACCESS_REQUIREMENT_NOTICE_PATTERN_SOURCE})`, 'i');

export function nodeSeekUserIdFromValue(value?: string) {
  const text = String(value || '').trim();
  return text.match(/(?:^|\/)space\/(\d+)(?:[/?#]|$)/)?.[1]
    || (/^\d+$/.test(text) ? text : '');
}

function nodeSeekAuthorId(authorId?: string, authorUrl?: string) {
  return nodeSeekUserIdFromValue(authorId) || nodeSeekUserIdFromValue(authorUrl);
}

function detailContentLooksRestricted(topic: Topic | TopicDetail) {
  if (!('contentHtml' in topic)) {
    return false;
  }
  const text = textContentFromHtml(topic.contentHtml).replace(/\s+/g, ' ').trim();
  if (!text || text.length > 240 || !accessRequirementFromText(text)) {
    return false;
  }
  return accessRequirementNoticeStartPattern.test(text);
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
    return !accessRequirementLevelValue(topic.accessRequirement) && Boolean(accessRequirementLevelValue(fallback.accessRequirement));
  }
  return accessRequirementSpecificity(fallback.accessRequirement) > accessRequirementSpecificity(topic.accessRequirement);
}

export function topicWithAuthorFallback<T extends Topic | TopicDetail>(topic: T | null, fallback?: Topic | null): T | null {
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
  const fallbackTopicFields = hasRestrictedPlaceholder ? {
    title: fallback.title || topic.title,
    author: fallback.author || topic.author,
    categoryId: fallback.categoryId || topic.categoryId,
    category: fallback.category || topic.category
  } : {};
  if (topic.source !== 'nodeseek') {
    const hasFallbackFields = Object.keys(fallbackTopicFields).length > 0;
    return Object.keys(accessRequirementFields).length || hasFallbackFields
      ? { ...topic, ...accessRequirementFields, ...fallbackTopicFields }
      : topic;
  }
  const fallbackAuthorId = nodeSeekAuthorId(fallback.authorId, fallback.authorUrl);
  if (topic.authorId && !hasRestrictedPlaceholder) {
    return Object.keys(accessRequirementFields).length ? { ...topic, ...accessRequirementFields } : topic;
  }
  const authorId = topic.authorId || fallbackAuthorId;
  if (!authorId && !hasRestrictedPlaceholder) {
    return Object.keys(accessRequirementFields).length ? { ...topic, ...accessRequirementFields } : topic;
  }
  return {
    ...topic,
    ...accessRequirementFields,
    ...fallbackTopicFields,
    author: hasRestrictedPlaceholder ? fallback.author || topic.author : topic.author || fallback.author,
    authorId: authorId || topic.authorId,
    authorAvatar: topic.authorAvatar || fallback.authorAvatar,
    authorUrl: topic.authorUrl || fallback.authorUrl
  };
}

export function userFromTopic(topic: Topic | TopicDetail): UserProfile | null {
  const nodeSeekId = topic.source === 'nodeseek' ? nodeSeekAuthorId(topic.authorId, topic.authorUrl) : '';
  const id = nodeSeekId || topic.authorId || topic.author;
  if (!id && !topic.authorUrl) {
    return null;
  }
  if (topic.source === 'nodeseek' && !nodeSeekId) {
    return null;
  }
  return {
    source: topic.source,
    id,
    username: topic.author || id,
    displayName: topic.author || undefined,
    avatar: topic.authorAvatar,
    url: topic.authorUrl || '',
    topics: []
  };
}

export function userFromReply(reply: Reply, source?: Source): UserProfile | null {
  if (!source) {
    return null;
  }
  const nodeSeekId = source === 'nodeseek' ? nodeSeekAuthorId(reply.authorId, reply.authorUrl) : '';
  const id = nodeSeekId || reply.authorId || reply.author;
  if (!id && !reply.authorUrl) {
    return null;
  }
  if (source === 'nodeseek' && !nodeSeekId) {
    return null;
  }
  return {
    source,
    id,
    username: reply.author || id,
    displayName: reply.author || undefined,
    avatar: reply.authorAvatar,
    url: reply.authorUrl || '',
    topics: []
  };
}
