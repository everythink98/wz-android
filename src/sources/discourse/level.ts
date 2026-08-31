import { isRecord } from '@/domain/forum/html';

export interface DiscourseLevelRequirement {
  key:
    | 'days_visited'
    | 'likes_given'
    | 'likes_received'
    | 'post_count'
    | 'topics_entered'
    | 'posts_read_count'
    | 'time_read'
    | `connect:${string}`;
  label: string;
  current: number;
  required: number;
  met: boolean;
  direction: 'minimum' | 'maximum';
  ratio: number;
  displayCurrent: string;
  displayRequired: string;
  unit?: 'seconds';
  change?: number;
  displayChange?: string;
}

export interface DiscourseActivityStats {
  daysVisited: number;
  topicsEntered: number;
  postsReadCount: number;
  timeRead: number;
  likesGiven: number;
  likesReceived: number;
  postCount: number;
  topicCount: number;
}

export interface DiscourseLevelProfile {
  username: string;
  displayName?: string;
  currentLevel: number;
  targetLevel: number | null;
  source: 'summary' | 'connect';
  estimate: boolean;
  note: string;
  requirements: DiscourseLevelRequirement[];
  activity: DiscourseActivityStats;
  achievedCount: number;
  totalCount: number;
  fetchedAt: string;
}

export type DiscourseSummaryInput = Record<string, unknown>;

type LevelRequirementConfig = {
  key: DiscourseLevelRequirement['key'];
  label: string;
  required: number;
  unit?: DiscourseLevelRequirement['unit'];
};

const LEVEL_REQUIREMENTS: Record<number, LevelRequirementConfig[]> = {
  0: [
    { key: 'topics_entered', label: '浏览话题', required: 5 },
    { key: 'posts_read_count', label: '已读帖子', required: 30 },
    { key: 'time_read', label: '阅读时长', required: 600, unit: 'seconds' }
  ],
  1: [
    { key: 'days_visited', label: '访问天数', required: 15 },
    { key: 'likes_given', label: '送出赞', required: 1 },
    { key: 'likes_received', label: '获赞', required: 1 },
    { key: 'post_count', label: '帖子数量', required: 3 },
    { key: 'topics_entered', label: '浏览话题', required: 20 },
    { key: 'posts_read_count', label: '已读帖子', required: 100 },
    { key: 'time_read', label: '阅读时长', required: 3600, unit: 'seconds' }
  ],
  2: [
    { key: 'days_visited', label: '访问天数', required: 50 },
    { key: 'likes_given', label: '送出赞', required: 30 },
    { key: 'likes_received', label: '获赞', required: 20 },
    { key: 'post_count', label: '帖子数量', required: 10 },
    { key: 'topics_entered', label: '浏览话题', required: 500 },
    { key: 'posts_read_count', label: '已读帖子', required: 20000 },
    { key: 'time_read', label: '阅读时长', required: 36000, unit: 'seconds' }
  ]
};

export function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function discourseAccountCount(value: unknown) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function trustLevelFromRecord(value: Record<string, unknown>) {
  const raw = value.trust_level ?? value.trustLevel;
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const level = Number(raw);
  if (!Number.isFinite(level) || level < 0) {
    return null;
  }
  return Math.floor(level);
}

function displayNumber(value: number, unit?: DiscourseLevelRequirement['unit']) {
  if (unit === 'seconds') {
    const minutes = Math.floor(value / 60);
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${hours}小时${rest}分` : `${hours}小时`;
    }
    return `${minutes}分`;
  }
  return String(value);
}

export function displayDiscourseLevelChange(value: number, unit?: DiscourseLevelRequirement['unit']) {
  if (!value) {
    return '';
  }
  return `较上次 ${value > 0 ? '+' : '-'}${displayNumber(Math.abs(value), unit)}`;
}

function activityFromSummary(summary: DiscourseSummaryInput): DiscourseActivityStats {
  return {
    daysVisited: numberValue(summary.days_visited),
    topicsEntered: numberValue(summary.topics_entered),
    postsReadCount: numberValue(summary.posts_read_count),
    timeRead: numberValue(summary.time_read),
    likesGiven: numberValue(summary.likes_given),
    likesReceived: numberValue(summary.likes_received),
    postCount: numberValue(summary.post_count),
    topicCount: numberValue(summary.topic_count)
  };
}

function rawRequirementValue(summary: DiscourseSummaryInput, key: DiscourseLevelRequirement['key']) {
  return numberValue(summary[key]);
}

function levelRequirementsMet(summary: DiscourseSummaryInput, level: number) {
  const requirements = LEVEL_REQUIREMENTS[level];
  return Boolean(
    requirements?.length && requirements.every((item) => rawRequirementValue(summary, item.key) >= item.required)
  );
}

function levelValue(summary: DiscourseSummaryInput, user: Record<string, unknown>) {
  const summaryLevel = trustLevelFromRecord(summary);
  const userLevel = trustLevelFromRecord(user);
  const explicitLevel = Math.max(summaryLevel ?? -1, userLevel ?? -1);
  if (explicitLevel >= 0) {
    return explicitLevel;
  }
  let level = 0;
  while (level < 2 && levelRequirementsMet(summary, level)) {
    level += 1;
  }
  return level;
}

function noteForLevel(level: number) {
  if (level >= 4) {
    return '4 级通常由人工授予，这里只显示当前活跃数据。';
  }
  if (level >= 2) {
    return '2 级以上涉及最近 100 天等滚动规则，此处为参考进度。';
  }
  return '按 Discourse 信任等级规则和本机读取到的统计估算。';
}

function targetLevelFor(level: number) {
  return level >= 4 ? null : level + 1;
}

export function buildDiscourseLevelProfileFromSummary(summaryInput: DiscourseSummaryInput): DiscourseLevelProfile {
  const user = isRecord(summaryInput.user) ? summaryInput.user : {};
  const username = String(summaryInput.username || user.username || '').trim();
  const currentLevel = levelValue(summaryInput, user);
  const requirements = (LEVEL_REQUIREMENTS[currentLevel] || []).map((config) => {
    const current = rawRequirementValue(summaryInput, config.key);
    const met = current >= config.required;
    return {
      key: config.key,
      label: config.label,
      current,
      required: config.required,
      met,
      direction: 'minimum' as const,
      ratio: config.required > 0 ? Math.min(current / config.required, 1) : met ? 1 : 0,
      displayCurrent: displayNumber(current, config.unit),
      displayRequired: displayNumber(config.required, config.unit),
      ...(config.unit ? { unit: config.unit } : {})
    };
  });
  const achievedCount = requirements.filter((item) => item.met).length;
  return {
    username: username || 'unknown',
    displayName: typeof user.name === 'string' ? user.name : undefined,
    currentLevel,
    targetLevel: targetLevelFor(currentLevel),
    source: 'summary',
    estimate: true,
    note: noteForLevel(currentLevel),
    requirements,
    activity: activityFromSummary(summaryInput),
    achievedCount,
    totalCount: requirements.length,
    fetchedAt: new Date().toISOString()
  };
}
