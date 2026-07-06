import type { LinuxDoFeedFilter, Topic } from './types';
import { absoluteUrl, isRecord } from './localHtml';
import { accessRequirementLevelValue, accessRequirementSpecificity } from './appUtils';

export const LINUXDO_BASE_URL = 'https://linux.do';
export const LINUXDO_UNCATEGORIZED_CATEGORY_NAME = '未分类';

const LINUXDO_FEED_PATHS: Record<LinuxDoFeedFilter, string> = {
  latest: '/latest.json',
  hot: '/hot.json',
  'new-all': '/new.json',
  'new-topics': '/new.json',
  'new-replies': '/new.json'
};

export function normalizeLinuxDoTopicId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text) && Number(text) > 0 ? text : '';
}

export function linuxDoUserUrl(username: string) {
  return `${LINUXDO_BASE_URL}/u/${encodeURIComponent(username)}`;
}

export function linuxDoAvatarUrl(value: unknown) {
  const text = String(value || '');
  return text ? absoluteUrl(text.replace('{size}', '96'), LINUXDO_BASE_URL) : undefined;
}

export function isLinuxDoUncategorizedCategory(category: unknown) {
  if (!isRecord(category)) {
    return false;
  }
  const name = String(category.name || '').trim();
  const slug = String(category.slug || '').trim().toLowerCase();
  return name === LINUXDO_UNCATEGORIZED_CATEGORY_NAME || slug === 'uncategorized';
}

export function preferredLinuxDoAccessRequirement(
  topicRequirement?: Topic['accessRequirement'],
  categoryRequirement?: Topic['accessRequirement']
) {
  if (!topicRequirement) {
    return categoryRequirement;
  }
  if (!categoryRequirement) {
    return topicRequirement;
  }
  const topicSpecificity = accessRequirementSpecificity(topicRequirement);
  const categorySpecificity = accessRequirementSpecificity(categoryRequirement);
  if (categorySpecificity > topicSpecificity) {
    return categoryRequirement;
  }
  if (categorySpecificity < topicSpecificity) {
    return topicRequirement;
  }
  if (topicRequirement.type === 'level' && categoryRequirement.type === 'level') {
    const topicLevel = accessRequirementLevelValue(topicRequirement);
    const categoryLevel = accessRequirementLevelValue(categoryRequirement);
    if (!topicLevel && categoryLevel) {
      return categoryRequirement;
    }
    if (topicLevel && categoryLevel && categoryLevel > topicLevel) {
      return categoryRequirement;
    }
  }
  return topicRequirement;
}

export function linuxDoFeedPath(filter: LinuxDoFeedFilter = 'latest') {
  return LINUXDO_FEED_PATHS[filter] || LINUXDO_FEED_PATHS.latest;
}

export function linuxDoFeedParams(page: number, category?: string, filter: LinuxDoFeedFilter = 'latest') {
  return {
    ...(page > 1 ? { page: page - 1 } : {}),
    ...(category ? { category: /^\d+$/.test(category) ? Number(category) : category } : {}),
    ...(filter === 'new-topics' ? { subset: 'topics' } : {}),
    ...(filter === 'new-replies' ? { subset: 'replies' } : {})
  };
}
