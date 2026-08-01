import { sourceCatalog } from './sourceCatalog';
import type { AccessRequirement, FeedSource, Source } from './models';

export function sourceLabel(source: Source | FeedSource) {
  if (source === 'all') {
    return '全部';
  }
  return sourceCatalog[source].label;
}

export function forumAccessRequirementText(requirement?: AccessRequirement) {
  if (!requirement) {
    return '';
  }
  if (requirement.type === 'level') {
    const text = requirement.detail || '';
    const level =
      text.match(/(?:lv|level)\s*(?:of\s+|[:：#-]\s*)?(\d+)/i)?.[1] ||
      text.match(/trust level\s*(\d+)/i)?.[1] ||
      text.match(/等级(?:达到|达|至少|要求|需|需要|不低于|高于|大于)?\s*(\d+)/i)?.[1] ||
      text.match(/需要[^。；\n]{0,24}(\d+)\s*级[^。；\n]{0,16}(?:查看|阅读|才能|才可|以上)/i)?.[1];
    if (level) {
      return `需 Lv${level}`;
    }
  }
  return requirement.label;
}

export function accessRequirementLevelValue(requirement?: AccessRequirement) {
  const match = forumAccessRequirementText(requirement).match(/^需 Lv(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

export function accessRequirementSpecificity(requirement?: AccessRequirement) {
  if (!requirement) {
    return 0;
  }
  if (requirement.type === 'level') {
    return 3;
  }
  if (requirement.type === 'permission') {
    return 2;
  }
  return 1;
}

export function formatDateTime(value?: string) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatRelativeTime(value?: string) {
  const time = dateTime(value);
  if (!time) {
    return '';
  }
  const diff = Date.now() - time;
  if (diff < 60_000) {
    return '刚刚';
  }
  if (diff < 60 * 60_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  }
  return `${Math.floor(diff / (24 * 60 * 60_000))} 天前`;
}

export function topicListDisplayTime(topic: { source: Source; createdAt: string; lastReplyAt?: string }) {
  return topic.lastReplyAt || topic.createdAt;
}

export function topicListDisplayTimeText(topic: {
  source: Source;
  createdAt: string;
  lastReplyAt?: string;
  displayTimeText?: string;
}) {
  return topic.displayTimeText?.trim() || formatRelativeTime(topicListDisplayTime(topic));
}

export function dateTime(value?: string) {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}
