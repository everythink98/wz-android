import { z } from 'zod';
import { accessRequirementFromText, decodeHtml } from './localHtml';
import { sourceCatalog, sourceValues } from './sourceCatalog';
import type { AccessRequirement, Category, Source, Topic, UserProfile } from './types';

export const readerDataVersion = 2;
export const MAX_HISTORY_RECORDS = 1000;
export const MAX_DELETED_RECORDS = 1000;
export const MAX_READER_STRING_LENGTH = 4096;
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.4;
export const FONT_SCALE_STEP = 0.05;

export interface TopicRecord {
  topic: Topic;
  savedAt: string;
  visitCount?: number;
}

export interface FollowedUserRecord {
  user: UserProfile;
  followedAt: string;
}

export interface DeletedRecords {
  favorites: Record<string, string>;
  history: Record<string, string>;
  followedUsers: Record<string, string>;
}

export interface ReaderSettings {
  listDensity: 'compact' | 'standard' | 'loose';
  theme: 'light' | 'dark';
  fontScale: number;
  lineHeight: 'compact' | 'standard' | 'loose';
  contentWidth: 'narrow' | 'standard' | 'wide';
  fontFamily: 'sans' | 'serif';
}

export interface ReaderData {
  version: 2;
  favorites: Record<string, TopicRecord>;
  history: Record<string, TopicRecord>;
  followedUsers: Record<string, FollowedUserRecord>;
  deletedRecords: DeletedRecords;
  settings: ReaderSettings;
}

const sensitiveUrlParamPattern = /(^|[^a-z0-9])(cookie|token|password|secret|authorization|auth|session|sidyaohuo|sid|csrf)([^a-z0-9]|$)/i;
const defaultReaderSettings: ReaderSettings = {
  listDensity: 'standard',
  theme: 'light',
  fontScale: 1,
  lineHeight: 'standard',
  contentWidth: 'standard',
  fontFamily: 'sans'
};

const sourceSchema = z.enum(sourceValues as [Source, ...Source[]]);
const storedStringSchema = z.string().max(MAX_READER_STRING_LENGTH);
const requiredStoredStringSchema = storedStringSchema.min(1);
const dateStringSchema = storedStringSchema.refine((value) => dateValue(value) > 0);
const topicShapeSchema = z.object({
  source: sourceSchema,
  id: requiredStoredStringSchema,
  title: requiredStoredStringSchema,
  url: requiredStoredStringSchema,
  createdAt: dateStringSchema,
  lastReplyAt: dateStringSchema.optional()
}).passthrough();
const userProfileShapeSchema = z.object({
  source: sourceSchema,
  id: requiredStoredStringSchema,
  username: requiredStoredStringSchema,
  url: requiredStoredStringSchema,
  topics: z.array(z.unknown()).optional()
}).passthrough();
const topicRecordSchema = z.object({
  topic: topicShapeSchema,
  savedAt: dateStringSchema
}).passthrough();
const followedUserRecordSchema = z.object({
  user: userProfileShapeSchema,
  followedAt: dateStringSchema
}).passthrough();
const readerSettingsSchema = z.object({
  listDensity: z.unknown().optional(),
  theme: z.unknown().optional(),
  fontScale: z.unknown().optional(),
  lineHeight: z.unknown().optional(),
  contentWidth: z.unknown().optional(),
  fontFamily: z.unknown().optional()
}).passthrough();
const readerDataSchema = z.object({
  version: z.literal(readerDataVersion),
  favorites: z.unknown().optional(),
  history: z.unknown().optional(),
  followedUsers: z.unknown().optional(),
  deletedRecords: z.unknown().optional(),
  settings: z.unknown().optional()
}).passthrough();

function userProfileUrl(source: Source, id: string, fallback = '') {
  const cleanId = String(id || '').trim();
  if (fallback) {
    return fallback;
  }
  if (!cleanId) {
    return '';
  }
  if (source === 'nodeseek') {
    return `https://www.nodeseek.com/space/${encodeURIComponent(cleanId)}`;
  }
  if (source === 'linuxdo') {
    return `https://linux.do/u/${encodeURIComponent(cleanId)}`;
  }
  if (source === 'v2ex') {
    return `https://www.v2ex.com/member/${encodeURIComponent(cleanId)}`;
  }
  return `https://www.yaohuo.me/bbs/userinfo.aspx?touserid=${encodeURIComponent(cleanId)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isTopic(value: unknown): value is Topic {
  return topicShapeSchema.safeParse(value).success;
}

function isUserProfile(value: unknown): value is UserProfile {
  return userProfileShapeSchema.safeParse(value).success;
}

function cleanString(value: unknown, fallback = '') {
  if (typeof value !== 'string' || value.length > MAX_READER_STRING_LENGTH) {
    return fallback;
  }
  return value;
}

function cleanOptionalString(value: unknown) {
  const clean = cleanString(value).trim();
  return clean || undefined;
}

function cleanOptionalLabelString(value: unknown) {
  const clean = cleanOptionalString(value);
  return clean && clean.length <= 32 ? clean : undefined;
}

function cleanNonNegativeInteger(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : fallback;
}

function cleanOptionalNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function isSensitiveUrlParamKey(key: string) {
  return sensitiveUrlParamPattern.test(key.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

function sanitizeTopicUrl(value: unknown, source?: Source) {
  try {
    const raw = cleanString(value).trim();
    if (!raw) {
      return '';
    }
    const url = source ? new URL(raw, sourceCatalog[source].baseUrl) : new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveUrlParamKey(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return '';
  }
}

function accessRequirementSummary(value?: AccessRequirement, topic?: Topic) {
  if (!value || !['login', 'level', 'permission'].includes(value.type) || !value.label) {
    return undefined;
  }
  const detail = typeof value.detail === 'string' ? value.detail : undefined;
  const isOldNodeSeekInsideInference = topic?.source === 'nodeseek'
    && (String(topic.categoryId || '').trim().toLowerCase() === 'inside' || String(topic.category || '').trim() === '内版')
    && value.type === 'level'
    && /^lv\s*2$/i.test(String(detail || '').trim())
    && Boolean(String(topic.excerpt || '').trim());
  if (isOldNodeSeekInsideInference) {
    return undefined;
  }
  const detected = detail ? accessRequirementFromText(detail) : undefined;
  if (detected?.type === 'level') {
    return detected;
  }
  return {
    type: value.type,
    label: value.label,
    detail
  };
}

function topicSummary(topic: Topic): Topic {
  const accessRequirement = accessRequirementSummary(topic.accessRequirement, topic);
  return {
    source: topic.source,
    id: cleanString(topic.id),
    title: decodeHtml(cleanString(topic.title)),
    author: cleanString(topic.author),
    authorId: cleanOptionalString(topic.authorId),
    authorAvatar: cleanOptionalString(topic.authorAvatar) ? sanitizeTopicUrl(topic.authorAvatar) : undefined,
    authorLevelLabel: cleanOptionalLabelString(topic.authorLevelLabel),
    authorUrl: cleanOptionalString(topic.authorUrl) ? sanitizeTopicUrl(topic.authorUrl) : undefined,
    categoryId: cleanOptionalString(topic.categoryId),
    category: cleanOptionalString(topic.category),
    url: sanitizeTopicUrl(topic.url, topic.source),
    createdAt: cleanString(topic.createdAt),
    lastReplyAt: cleanOptionalString(topic.lastReplyAt),
    replyCount: cleanNonNegativeInteger(topic.replyCount),
    viewCount: cleanOptionalNonNegativeInteger(topic.viewCount),
    excerpt: cleanOptionalString(topic.excerpt),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

function userSummary(user: UserProfile): UserProfile {
  const id = cleanString(user.id || user.username).trim();
  const username = cleanString(user.username || user.displayName);
  const displayName = cleanUserDisplayName(user);
  const topicCount = cleanUserStat(user.source, user.topicCount);
  const replyCount = cleanUserStat(user.source, user.replyCount);
  const postCount = user.source === 'yaohuo'
    ? topicCount && replyCount ? topicCount + replyCount : undefined
    : cleanUserStat(user.source, user.postCount) || (topicCount && replyCount ? topicCount + replyCount : undefined);
  const topics = Array.isArray(user.topics)
    ? user.topics.filter(isTopic).map(topicSummary).map((topic) => (
      user.source === 'yaohuo' && isPollutedYaohuoUserText(topic.author)
        ? { ...topic, author: displayName || username || id }
        : topic
    )).slice(0, 50)
    : [];
  return {
    source: user.source,
    id,
    username,
    displayName,
    avatar: cleanOptionalString(user.avatar) ? sanitizeTopicUrl(user.avatar) : undefined,
    levelLabel: cleanOptionalLabelString(user.levelLabel),
    url: sanitizeTopicUrl(userProfileUrl(user.source, id, user.url)),
    bio: cleanOptionalString(user.bio),
    joinedAt: cleanOptionalString(user.joinedAt),
    topicCount,
    replyCount,
    postCount,
    topics
  };
}

function createEmptyDeletedRecords(): DeletedRecords {
  return {
    favorites: {},
    history: {},
    followedUsers: {}
  };
}

function cleanUserDisplayName(user: UserProfile) {
  const displayName = cleanString(user.displayName).trim();
  if (
    user.source === 'yaohuo'
    && isPollutedYaohuoUserText(displayName)
  ) {
    return user.username || user.id;
  }
  return displayName || undefined;
}

function cleanUserStat(source: Source, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (source === 'yaohuo' && value > 999_999) {
    return undefined;
  }
  return value;
}

function isPollutedYaohuoUserText(value: unknown) {
  const text = String(value || '').trim();
  return !text || text.length > 32 || /正在论坛|查看更多|动态|人气|留言板|小时前|分钟前|今天|昨天/.test(text);
}

export function createEmptyReaderData(): ReaderData {
  return {
    version: readerDataVersion,
    favorites: {},
    history: {},
    followedUsers: {},
    deletedRecords: createEmptyDeletedRecords(),
    settings: { ...defaultReaderSettings }
  };
}

export function topicKey(topic: Pick<Topic, 'source' | 'id'>) {
  return `${topic.source}:${topic.id}`;
}

export function categoryKey(category: Pick<Category, 'source' | 'id'>) {
  return `${category.source}:${category.id}`;
}

export function userKey(user: Pick<UserProfile, 'source' | 'id'>) {
  return `${user.source}:${user.id}`;
}

function normalizeRecordMap(value: unknown): Record<string, TopicRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, TopicRecord> = {};
  for (const record of Object.values(value)) {
    const parsed = topicRecordSchema.safeParse(record);
    if (!parsed.success) {
      continue;
    }
    const candidate = parsed.data as unknown as Partial<TopicRecord>;
    if (!candidate.topic || !isTopic(candidate.topic)) {
      continue;
    }
    const savedAt = typeof candidate.savedAt === 'string' ? candidate.savedAt : '';
    if (dateValue(savedAt) <= 0) {
      continue;
    }
    const topic = topicSummary(candidate.topic);
    next[topicKey(topic)] = {
      topic,
      savedAt,
      visitCount: typeof candidate.visitCount === 'number' && Number.isFinite(candidate.visitCount) && candidate.visitCount > 0 ? Math.round(candidate.visitCount) : undefined
    };
  }
  return next;
}

function limitRecordMap<T>(records: Record<string, T>, limit: number, getTime: (record: T) => string | undefined) {
  return Object.fromEntries(
    Object.entries(records)
      .sort(([, left], [, right]) => dateValue(getTime(right)) - dateValue(getTime(left)))
      .slice(0, limit)
  );
}

function normalizeFollowedUsers(value: unknown): Record<string, FollowedUserRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, FollowedUserRecord> = {};
  for (const record of Object.values(value)) {
    const parsed = followedUserRecordSchema.safeParse(record);
    if (!parsed.success) {
      continue;
    }
    const candidate = parsed.data as Partial<FollowedUserRecord>;
    if (!candidate.user || !isUserProfile(candidate.user)) {
      continue;
    }
    const followedAt = typeof candidate.followedAt === 'string' ? candidate.followedAt : '';
    if (dateValue(followedAt) <= 0) {
      continue;
    }
    const user = userSummary(candidate.user);
    next[userKey(user)] = {
      user,
      followedAt
    };
  }
  return next;
}

function normalizeDeletedRecordMap(value: unknown, normalizeKey?: (key: string) => string): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, deletedAt] of Object.entries(value)) {
    if (typeof key === 'string' && key && typeof deletedAt === 'string' && dateValue(deletedAt) > 0) {
      const nextKey = normalizeKey ? normalizeKey(key) : key;
      if (nextKey && dateValue(deletedAt) > dateValue(next[nextKey])) {
        next[nextKey] = deletedAt;
      }
    }
  }
  return limitDeletedRecordMap(next);
}

function limitDeletedRecordMap(records: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(records)
      .sort(([, left], [, right]) => dateValue(right) - dateValue(left))
      .slice(0, MAX_DELETED_RECORDS)
  );
}

function normalizeDeletedRecords(value: unknown): DeletedRecords {
  const base = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<DeletedRecords>
    : {};
  return {
    favorites: normalizeDeletedRecordMap(base.favorites),
    history: normalizeDeletedRecordMap(base.history),
    followedUsers: normalizeDeletedRecordMap(base.followedUsers)
  };
}

export function sanitizeReaderSettings(value: unknown): ReaderSettings {
  const parsed = readerSettingsSchema.safeParse(value);
  const base = parsed.success ? parsed.data as Record<string, unknown> : {};
  return mergeReaderSettings(defaultReaderSettings, base);
}

export function normalizeFontScale(value: unknown, fallback = 1) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, Math.round(Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP * 100) / 100))
    : fallback;
}

export function fontScaleFromSliderPosition(position: number, width: number) {
  const ratio = Number.isFinite(position) && Number.isFinite(width) && width > 0
    ? Math.max(0, Math.min(1, position / width))
    : 0;
  return normalizeFontScale(FONT_SCALE_MIN + ratio * (FONT_SCALE_MAX - FONT_SCALE_MIN));
}

function mergeReaderSettings(local: ReaderSettings, value: unknown): ReaderSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return local;
  }
  const base = value as Record<string, unknown>;
  return {
    listDensity: base.listDensity === 'compact' || base.listDensity === 'standard' || base.listDensity === 'loose' ? base.listDensity : local.listDensity,
    theme: base.theme === 'light' || base.theme === 'dark' ? base.theme : local.theme,
    fontScale: normalizeFontScale(base.fontScale, local.fontScale),
    lineHeight: base.lineHeight === 'compact' || base.lineHeight === 'standard' || base.lineHeight === 'loose' ? base.lineHeight : local.lineHeight,
    contentWidth: base.contentWidth === 'narrow' || base.contentWidth === 'standard' || base.contentWidth === 'wide' ? base.contentWidth : local.contentWidth,
    fontFamily: base.fontFamily === 'sans' || base.fontFamily === 'serif' ? base.fontFamily : local.fontFamily
  };
}

export function sanitizeReaderData(value: unknown): ReaderData {
  const parsed = readerDataSchema.safeParse(value);
  if (!parsed.success) {
    return createEmptyReaderData();
  }
  const data = parsed.data as Partial<ReaderData>;
  return {
    version: readerDataVersion,
    favorites: normalizeRecordMap(data.favorites),
    history: limitRecordMap(normalizeRecordMap(data.history), MAX_HISTORY_RECORDS, (record) => record.savedAt),
    followedUsers: normalizeFollowedUsers(data.followedUsers),
    deletedRecords: normalizeDeletedRecords(data.deletedRecords),
    settings: sanitizeReaderSettings(data.settings)
  };
}

function dateValue(value: string | undefined) {
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function mergeTimedMap<T>(local: Record<string, T>, remote: Record<string, T>, getTime: (record: T) => string | undefined) {
  const merged = { ...local };
  for (const [key, remoteRecord] of Object.entries(remote)) {
    const localRecord = merged[key];
    if (!localRecord || dateValue(getTime(remoteRecord)) > dateValue(getTime(localRecord))) {
      merged[key] = remoteRecord;
    }
  }
  return merged;
}

function hasOwnObjectField(value: unknown, key: string) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, key)
  );
}

function ownObjectField(value: unknown, key: string) {
  if (!hasOwnObjectField(value, key)) {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}

function mergeDeletedMap(local: Record<string, string>, remote: Record<string, string>) {
  const merged = { ...local };
  for (const [key, remoteDeletedAt] of Object.entries(remote)) {
    if (dateValue(remoteDeletedAt) > dateValue(merged[key])) {
      merged[key] = remoteDeletedAt;
    }
  }
  return limitDeletedRecordMap(merged);
}

function mergeTimedMapWithDeleted<T>(
  local: Record<string, T>,
  remote: Record<string, T>,
  localDeleted: Record<string, string>,
  remoteDeleted: Record<string, string>,
  getTime: (record: T) => string | undefined
) {
  const records = mergeTimedMap(local, remote, getTime);
  const deleted = mergeDeletedMap(localDeleted, remoteDeleted);
  for (const [key, record] of Object.entries(records)) {
    if (dateValue(deleted[key]) >= dateValue(getTime(record))) {
      delete records[key];
    } else {
      delete deleted[key];
    }
  }
  return { records, deleted };
}

function markDeleted(deletedRecords: DeletedRecords, section: keyof DeletedRecords, key: string, deletedAt = nowIso()): DeletedRecords {
  return {
    ...deletedRecords,
    [section]: limitDeletedRecordMap({
      ...deletedRecords[section],
      [key]: deletedAt
    })
  };
}

function clearDeleted(deletedRecords: DeletedRecords, section: keyof DeletedRecords, key: string): DeletedRecords {
  const next = { ...deletedRecords[section] };
  delete next[key];
  return {
    ...deletedRecords,
    [section]: next
  };
}

export function mergeReaderData(localValue: unknown, remoteValue: unknown): ReaderData {
  const local = sanitizeReaderData(localValue);
  const remote = sanitizeReaderData(remoteValue);
  const remoteSettings = ownObjectField(remoteValue, 'settings');
  const favorites = mergeTimedMapWithDeleted(local.favorites, remote.favorites, local.deletedRecords.favorites, remote.deletedRecords.favorites, (record) => record.savedAt);
  const history = mergeTimedMapWithDeleted(local.history, remote.history, local.deletedRecords.history, remote.deletedRecords.history, (record) => record.savedAt);
  const followedUsers = mergeTimedMapWithDeleted(
    local.followedUsers,
    remote.followedUsers,
    local.deletedRecords.followedUsers,
    remote.deletedRecords.followedUsers,
    (record) => record.followedAt
  );

  return sanitizeReaderData({
    version: readerDataVersion,
    favorites: favorites.records,
    history: history.records,
    followedUsers: followedUsers.records,
    deletedRecords: {
      favorites: favorites.deleted,
      history: history.deleted,
      followedUsers: followedUsers.deleted
    },
    settings: mergeReaderSettings(local.settings, remoteSettings)
  });
}

export function recordHistory(data: ReaderData, topic: Topic) {
  const summary = topicSummary(topic);
  const key = topicKey(summary);
  const existing = data.history[key];
  return {
    ...data,
    history: {
      ...data.history,
      [key]: {
        ...existing,
        topic: summary,
        savedAt: nowIso(),
        visitCount: (existing?.visitCount || 0) + 1
      }
    },
    deletedRecords: clearDeleted(data.deletedRecords, 'history', key)
  };
}

export function toggleFavorite(data: ReaderData, topic: Topic) {
  const summary = topicSummary(topic);
  const key = topicKey(summary);
  const next = { ...data.favorites };
  let deletedRecords = data.deletedRecords;
  if (next[key]) {
    delete next[key];
    deletedRecords = markDeleted(deletedRecords, 'favorites', key);
  } else {
    next[key] = { topic: summary, savedAt: nowIso() };
    deletedRecords = clearDeleted(deletedRecords, 'favorites', key);
  }
  return { ...data, favorites: next, deletedRecords };
}

export function updateFavoriteTopic(data: ReaderData, topic: Topic) {
  const summary = topicSummary(topic);
  const key = topicKey(summary);
  const existing = data.favorites[key];
  if (!existing) {
    return data;
  }
  return {
    ...data,
    favorites: {
      ...data.favorites,
      [key]: {
        ...existing,
        topic: summary
      }
    }
  };
}

export function toggleFollowedUser(data: ReaderData, user: UserProfile) {
  const summary = userSummary(user);
  const key = userKey(summary);
  const next = { ...data.followedUsers };
  let deletedRecords = data.deletedRecords;
  if (next[key]) {
    delete next[key];
    deletedRecords = markDeleted(deletedRecords, 'followedUsers', key);
  } else {
    next[key] = { user: summary, followedAt: nowIso() };
    deletedRecords = clearDeleted(deletedRecords, 'followedUsers', key);
  }
  return { ...data, followedUsers: next, deletedRecords };
}

export function removeRecords(data: ReaderData, section: 'favorites' | 'history', topics: Array<Pick<Topic, 'source' | 'id'>>) {
  const next = { ...data[section] };
  let deletedRecords = data.deletedRecords;
  for (const topic of topics) {
    const key = topicKey(topic);
    if (next[key]) {
      delete next[key];
      deletedRecords = markDeleted(deletedRecords, section, key);
    }
  }
  return {
    ...data,
    [section]: next,
    deletedRecords
  };
}

export function removeFollowedUsers(data: ReaderData, users: Array<Pick<UserProfile, 'source' | 'id'>>) {
  const next = { ...data.followedUsers };
  let deletedRecords = data.deletedRecords;
  for (const user of users) {
    const key = userKey(user);
    if (next[key]) {
      delete next[key];
      deletedRecords = markDeleted(deletedRecords, 'followedUsers', key);
    }
  }
  return {
    ...data,
    followedUsers: next,
    deletedRecords
  };
}

export function clearRecords(data: ReaderData, section: 'history') {
  return removeRecords(data, section, Object.values(data[section]).map((record) => record.topic));
}

export function isUserFollowed(data: ReaderData, user: Pick<UserProfile, 'source' | 'id'>) {
  return Boolean(data.followedUsers[userKey(user)]);
}
