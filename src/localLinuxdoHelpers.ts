import type { Topic } from './types';
import { absoluteUrl, isRecord } from './localHtml';
import { accessRequirementLevelValue, accessRequirementSpecificity } from './appUtils';

export const LINUXDO_BASE_URL = 'https://linux.do';
export const LINUXDO_UNCATEGORIZED_CATEGORY_NAME = '未分类';

const NEWEST_TOPIC_PARAMS = {
  order: 'created',
  ascending: 'false'
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

export function linuxDoLatestParams(page: number, category?: string) {
  return {
    ...NEWEST_TOPIC_PARAMS,
    ...(page > 1 ? { page: page - 1 } : {}),
    ...(category ? { category: /^\d+$/.test(category) ? Number(category) : category } : {})
  };
}
