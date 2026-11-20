import { z } from 'zod';
import { parseForumUserLink } from '@/domain/forum/links';
import { accessRequirementFromText } from '@/domain/forum/accessRequirements';
import { sourceCatalog, sourceValues } from '@/domain/forum/sourceCatalog';
import type {
  AccessRequirement,
  Category,
  Source,
  Topic,
  UserProfile,
  UserDetails,
  UserTopicsPage
} from '@/domain/forum/models';
import {
  defaultContentSourcePreferences,
  normalizeContentSourcePreferences,
  type ContentSourcePreference
} from './contentSourcePreferences';

export const readerDataVersion = 2;
export const MAX_HISTORY_RECORDS = 5000;
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

interface DeletedRecords {
  favorites: Record<string, string>;
  history: Record<string, string>;
  followedUsers: Record<string, string>;
}

export interface ReaderSettings {
  listDensity: 'compact' | 'standard' | 'loose';
  theme: 'light' | 'dark';
  fontScale: number;
  nodeSeekRecoveryThreshold: number;
  lineHeight: 'compact' | 'standard' | 'loose';
  contentWidth: 'narrow' | 'standard' | 'wide';
  fontFamily: 'sans' | 'serif';
  contentSources: ContentSourcePreference[];
}

export interface ReaderData {
  version: 2;
  favorites: Record<string, TopicRecord>;
  history: Record<string, TopicRecord>;
  followedUsers: Record<string, FollowedUserRecord>;
  deletedRecords: DeletedRecords;
  settings: ReaderSettings;
}

type ReaderDecodeMode = 'sanitize' | 'migration' | 'backup';
type ReaderBackupContent = Omit<ReaderData, 'settings'> & { settings: Partial<ReaderSettings> };

function createDefaultReaderSettings(): ReaderSettings {
  return {
    listDensity: 'standard',
    theme: 'light',
    fontScale: 1,
    nodeSeekRecoveryThreshold: 1,
    lineHeight: 'standard',
    contentWidth: 'standard',
    fontFamily: 'sans',
    contentSources: defaultContentSourcePreferences()
  };
}

const sourceSchema = z.enum(sourceValues as [Source, ...Source[]]);
const storedStringSchema = z.string().max(MAX_READER_STRING_LENGTH);
const requiredStoredStringSchema = storedStringSchema.min(1);
const dateStringSchema = storedStringSchema.refine((value) => dateValue(value) > 0);
// Source publication times may be unknown; local operation times must remain valid.
const topicDateSchema = z.union([dateStringSchema, z.literal('')]);
const topicShapeSchema = z
  .object({
    source: sourceSchema,
    id: requiredStoredStringSchema,
    title: requiredStoredStringSchema,
    url: requiredStoredStringSchema,
    createdAt: topicDateSchema,
    lastReplyAt: topicDateSchema.optional()
  })
  .loose();
const userProfileShapeSchema = z
  .object({
    source: sourceSchema,
    id: requiredStoredStringSchema,
    username: requiredStoredStringSchema,
    url: requiredStoredStringSchema,
    topics: z.array(z.unknown()).optional()
  })
  .loose();
const topicRecordSchema = z
  .object({
    topic: topicShapeSchema,
    savedAt: dateStringSchema
  })
  .loose();
const followedUserRecordSchema = z
  .object({
    user: userProfileShapeSchema,
    followedAt: dateStringSchema
  })
  .loose();
const readerDataSchema = z
  .object({
    version: z.literal(readerDataVersion),
    favorites: z.unknown().optional(),
    history: z.unknown().optional(),
    followedUsers: z.unknown().optional(),
    deletedRecords: z.unknown().optional(),
    settings: z.unknown().optional()
  })
  .loose();

function userProfileUrl(source: Source, id: string, username = '') {
  const cleanId = String(id || '').trim();
  const cleanUsername = String(username || '').trim();
  if (!cleanId && !cleanUsername) {
    return '';
  }
  if (source === 'nodeseek') {
    return /^\d+$/.test(cleanId) ? `${sourceCatalog.nodeseek.baseUrl}/space/${encodeURIComponent(cleanId)}` : '';
  }
  if (source === 'linuxdo') {
    return `${sourceCatalog.linuxdo.baseUrl}/u/${encodeURIComponent(cleanUsername || cleanId)}`;
  }
  if (source === 'v2ex') {
    return `${sourceCatalog.v2ex.baseUrl}/member/${encodeURIComponent(cleanUsername || cleanId)}`;
  }
  return `${sourceCatalog.yaohuo.baseUrl}/bbs/userinfo.aspx?touserid=${encodeURIComponent(cleanId)}`;
}

function canonicalTopicUrl(source: Source, id: string) {
  const encodedId = encodeURIComponent(String(id || '').trim());
  if (!encodedId) {
    return '';
  }
  if (source === 'nodeseek') {
    return `${sourceCatalog[source].baseUrl}/post-${encodedId}-1`;
  }
  if (source === 'yaohuo') {
    return `${sourceCatalog[source].baseUrl}/bbs-${encodedId}.html`;
  }
  return `${sourceCatalog[source].baseUrl}/t/${encodedId}`;
}

function canonicalTopicAuthorUrl(topic: Topic) {
  const linked = parseForumUserLink(topic.authorUrl || '', sourceCatalog[topic.source].baseUrl);
  if (linked?.source === topic.source) {
    return userProfileUrl(topic.source, cleanString(linked.id || topic.authorId), cleanString(linked.username));
  }
  const authorId = cleanString(topic.authorId);
  return authorId ? userProfileUrl(topic.source, authorId, authorId) : '';
}

function isTopic(value: unknown): value is Topic {
  return topicShapeSchema.safeParse(value).success;
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

function hasPortableUrl(summary: { url: string }) {
  return summary.url.length > 0 && summary.url.length <= MAX_READER_STRING_LENGTH;
}

function cleanOptionalLabelString(value: unknown) {
  const clean = cleanOptionalString(value);
  return clean && clean.length <= 32 ? clean : undefined;
}

function cleanNonNegativeInteger(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

function cleanOptionalNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function sanitizePortableUrl(value: unknown, source?: Source) {
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
    url.search = '';
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
  const isOldNodeSeekInsideInference =
    topic?.source === 'nodeseek' &&
    (String(topic.categoryId || '')
      .trim()
      .toLowerCase() === 'inside' ||
      String(topic.category || '').trim() === '内版') &&
    value.type === 'level' &&
    /^lv\s*2$/i.test(String(detail || '').trim()) &&
    Boolean(String(topic.excerpt || '').trim());
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

export function topicSummary(topic: Topic): Topic {
  const accessRequirement = accessRequirementSummary(topic.accessRequirement, topic);
  return {
    source: topic.source,
    id: cleanString(topic.id),
    title: cleanString(topic.title),
    author: cleanString(topic.author),
    authorId: cleanOptionalString(topic.authorId),
    authorAvatar: cleanOptionalString(topic.authorAvatar)
      ? sanitizePortableUrl(topic.authorAvatar, topic.source) || undefined
      : undefined,
    authorLevelLabel: cleanOptionalLabelString(topic.authorLevelLabel),
    authorUrl: cleanOptionalString(topic.authorUrl) ? canonicalTopicAuthorUrl(topic) || undefined : undefined,
    categoryId: cleanOptionalString(topic.categoryId),
    category: cleanOptionalString(topic.category),
    url: canonicalTopicUrl(topic.source, topic.id),
    createdAt: cleanString(topic.createdAt),
    lastReplyAt: cleanOptionalString(topic.lastReplyAt),
    replyCount: topic.replyCount === undefined ? undefined : cleanNonNegativeInteger(topic.replyCount),
    ...(topic.source !== 'linuxdo' && Number.isSafeInteger(topic.replyWatermark) && topic.replyWatermark! >= 0
      ? { replyWatermark: topic.replyWatermark }
      : {}),
    viewCount: cleanOptionalNonNegativeInteger(topic.viewCount),
    excerpt: cleanOptionalString(topic.excerpt),
    ...(topic.source === 'linuxdo' && topic.isPrivateMessage === true ? { isPrivateMessage: true } : {}),
    ...(accessRequirement ? { accessRequirement } : {})
  };
}

export function userSummary(user: UserDetails & Partial<UserTopicsPage>): UserProfile {
  const id = cleanString(user.id || user.username).trim();
  const username = cleanString(user.username || user.displayName);
  const displayName = cleanUserDisplayName(user);
  const topicCount = cleanUserStat(user.source, user.topicCount);
  const replyCount = cleanUserStat(user.source, user.replyCount);
  const derivedPostCount = topicCount !== undefined && replyCount !== undefined ? topicCount + replyCount : undefined;
  const postCount =
    user.source === 'yaohuo' ? derivedPostCount : (cleanUserStat(user.source, user.postCount) ?? derivedPostCount);
  const topics = Array.isArray(user.topics)
    ? user.topics
        .filter(isTopic)
        .map(topicSummary)
        .filter(hasPortableUrl)
        .map((topic) =>
          user.source === 'yaohuo' && isPollutedYaohuoUserText(topic.author)
            ? { ...topic, author: displayName || username || id }
            : topic
        )
        .slice(0, 50)
    : [];
  return {
    source: user.source,
    id,
    username,
    displayName,
    avatar: cleanOptionalString(user.avatar) ? sanitizePortableUrl(user.avatar, user.source) || undefined : undefined,
    levelLabel: cleanOptionalLabelString(user.levelLabel),
    url: userProfileUrl(user.source, id, username),
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

function cleanUserDisplayName(user: UserDetails) {
  const displayName = cleanString(user.displayName).trim();
  if (user.source === 'yaohuo' && isPollutedYaohuoUserText(displayName)) {
    return user.username || user.id;
  }
  return displayName || undefined;
}

function cleanUserStat(source: Source, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  if (source === 'yaohuo' && value > 999_999) {
    return undefined;
  }
  return Math.round(value);
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
    settings: createDefaultReaderSettings()
  };
}

export function topicKey(topic: Pick<Topic, 'source' | 'id'>) {
  return `${topic.source}:${topic.id}`;
}

export function categoryKey(category: Pick<Category, 'source' | 'id'>) {
  return topicKey(category);
}

export function userKey(user: Pick<UserProfile, 'source' | 'id'>) {
  if (user.source === 'nodeseek' && !/^\d+$/.test(user.id)) {
    throw new Error('NodeSeek 用户 ID 必须是数字');
  }
  return `${user.source}:${user.id}`;
}

function recordMap(value: unknown, mode: ReaderDecodeMode): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (value !== undefined && mode !== 'sanitize') throw new Error('本机资料记录格式不完整，未修改原资料。');
  return {};
}

function normalizeRecordMap(value: unknown, mode: ReaderDecodeMode): Record<string, TopicRecord> {
  const records = recordMap(value, mode);
  const next: Record<string, TopicRecord> = {};
  for (const [key, record] of Object.entries(records)) {
    const parsed = topicRecordSchema.safeParse(record);
    if (!parsed.success) {
      if (mode !== 'sanitize') throw new Error('本机主题记录无法完整迁移，未修改原资料。');
      continue;
    }
    const candidate = parsed.data as unknown as TopicRecord;
    if (mode !== 'sanitize') {
      const count = candidate.visitCount;
      if (key !== topicKey(candidate.topic) || (count !== undefined && (!Number.isSafeInteger(count) || count < 0)))
        throw new Error('本机主题记录无法完整迁移，未修改原资料。');
      if (mode === 'migration') continue;
    }
    const topic = topicSummary(candidate.topic);
    if (!hasPortableUrl(topic)) continue;
    next[topicKey(topic)] = {
      topic,
      savedAt: candidate.savedAt,
      visitCount:
        typeof candidate.visitCount === 'number' && Number.isFinite(candidate.visitCount) && candidate.visitCount > 0
          ? Math.round(candidate.visitCount)
          : undefined
    };
  }
  return mode === 'migration' ? (records as ReaderData['favorites']) : next;
}

function limitRecordMap<T>(records: Record<string, T>, limit: number, getTime: (record: T) => string | undefined) {
  return Object.fromEntries(
    Object.entries(records)
      .map(([key, record]) => ({ key, record, time: dateValue(getTime(record)) }))
      .sort((left, right) => right.time - left.time)
      .slice(0, limit)
      .map(({ key, record }) => [key, record])
  );
}

function normalizeFollowedUsers(value: unknown, mode: ReaderDecodeMode): Record<string, FollowedUserRecord> {
  const records = recordMap(value, mode);
  const next: Record<string, FollowedUserRecord> = {};
  for (const [key, record] of Object.entries(records)) {
    const parsed = followedUserRecordSchema.safeParse(record);
    if (!parsed.success || (parsed.data.user.source === 'nodeseek' && !/^\d+$/.test(parsed.data.user.id))) {
      if (mode !== 'sanitize') throw new Error('本机关注记录无法完整迁移，未修改原资料。');
      continue;
    }
    const candidate = parsed.data as FollowedUserRecord;
    if (mode !== 'sanitize') {
      if (key !== userKey(candidate.user)) throw new Error('本机关注记录无法完整迁移，未修改原资料。');
      if (mode === 'migration') continue;
    }
    const user = userSummary(candidate.user);
    if (!user.id || !hasPortableUrl(user)) continue;
    next[userKey(user)] = { user, followedAt: candidate.followedAt };
  }
  return mode === 'migration' ? (records as ReaderData['followedUsers']) : next;
}

function normalizeDeletedRecordMap(value: unknown, mode: ReaderDecodeMode): Record<string, string> {
  const records = recordMap(value, mode);
  const next: Record<string, string> = {};
  for (const [key, deletedAt] of Object.entries(records)) {
    if (!key || typeof deletedAt !== 'string' || dateValue(deletedAt) <= 0) {
      if (mode !== 'sanitize') throw new Error('本机删除标记无法完整迁移，未修改原资料。');
    } else if (mode === 'sanitize') {
      next[key] = deletedAt;
    }
  }
  return mode === 'sanitize' ? next : (records as Record<string, string>);
}

function limitDeletedRecordMap(records: Record<string, string>) {
  return limitRecordMap(records, MAX_DELETED_RECORDS, (time) => time);
}

export function sanitizeReaderSettings(value: unknown): ReaderSettings {
  return { ...createDefaultReaderSettings(), ...readerSettingsPatch(value) };
}

export function normalizeFontScale(value: unknown, fallback = 1) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(
        FONT_SCALE_MIN,
        Math.min(FONT_SCALE_MAX, Math.round(Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP * 100) / 100)
      )
    : fallback;
}

function readerSettingsPatch(value: unknown): Partial<ReaderSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const base = value as Record<string, unknown>;
  const patch: Partial<ReaderSettings> = {};
  if (base.listDensity === 'compact' || base.listDensity === 'standard' || base.listDensity === 'loose')
    patch.listDensity = base.listDensity;
  if (base.theme === 'light' || base.theme === 'dark') patch.theme = base.theme;
  if (typeof base.fontScale === 'number' && Number.isFinite(base.fontScale))
    patch.fontScale = normalizeFontScale(base.fontScale);
  if (typeof base.nodeSeekRecoveryThreshold === 'number' && Number.isFinite(base.nodeSeekRecoveryThreshold))
    patch.nodeSeekRecoveryThreshold = Math.max(1, Math.min(5, Math.round(base.nodeSeekRecoveryThreshold)));
  if (base.lineHeight === 'compact' || base.lineHeight === 'standard' || base.lineHeight === 'loose')
    patch.lineHeight = base.lineHeight;
  if (base.contentWidth === 'narrow' || base.contentWidth === 'standard' || base.contentWidth === 'wide')
    patch.contentWidth = base.contentWidth;
  if (base.fontFamily === 'sans' || base.fontFamily === 'serif') patch.fontFamily = base.fontFamily;
  if (Array.isArray(base.contentSources)) patch.contentSources = normalizeContentSourcePreferences(base.contentSources);
  return patch;
}

function decodeReaderData(value: unknown, mode: ReaderDecodeMode): ReaderBackupContent {
  const parsed = readerDataSchema.safeParse(value);
  if (!parsed.success) {
    if (mode === 'sanitize') return createEmptyReaderData();
    throw new Error('本机资料版本或格式不受支持，未修改原资料。');
  }
  const data = parsed.data;
  const deleted = recordMap(data.deletedRecords, mode);
  return {
    version: readerDataVersion,
    favorites: normalizeRecordMap(data.favorites, mode),
    history: normalizeRecordMap(data.history, mode),
    followedUsers: normalizeFollowedUsers(data.followedUsers, mode),
    deletedRecords: {
      favorites: normalizeDeletedRecordMap(deleted.favorites, mode),
      history: normalizeDeletedRecordMap(deleted.history, mode),
      followedUsers: normalizeDeletedRecordMap(deleted.followedUsers, mode)
    },
    settings: readerSettingsPatch(data.settings)
  };
}

export function readReaderBackupContent(value: unknown): ReaderBackupContent {
  return decodeReaderData(value, 'backup');
}

export function sanitizeReaderData(value: unknown): ReaderData {
  const data = decodeReaderData(value, 'sanitize');
  return { ...data, settings: { ...createDefaultReaderSettings(), ...data.settings } };
}

// Migration validates the persisted representation without rewriting summaries, keys or retention.
export function validateStoredReaderData(value: unknown): ReaderData {
  const data = decodeReaderData(value, 'migration');
  return { ...data, settings: { ...createDefaultReaderSettings(), ...data.settings } };
}

export function validateStoredReaderRecords(
  collection: 'favorites' | 'history' | 'followedUsers',
  records: Record<string, unknown>
): (TopicRecord | FollowedUserRecord)[] {
  return collection === 'followedUsers'
    ? Object.values(normalizeFollowedUsers(records, 'migration'))
    : Object.values(normalizeRecordMap(records, 'migration'));
}

function dateValue(value: string | undefined) {
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

function mergeTimedMap<T>(
  local: Record<string, T>,
  remote: Record<string, T>,
  getTime: (record: T) => string | undefined
) {
  const merged = { ...local };
  for (const [key, remoteRecord] of Object.entries(remote)) {
    const localRecord = merged[key];
    if (!localRecord || dateValue(getTime(remoteRecord)) > dateValue(getTime(localRecord))) {
      merged[key] = remoteRecord;
    }
  }
  return merged;
}

function mergeDeletedMap(local: Record<string, string>, remote: Record<string, string>) {
  const merged = { ...local };
  for (const [key, remoteDeletedAt] of Object.entries(remote)) {
    if (dateValue(remoteDeletedAt) > dateValue(merged[key])) {
      merged[key] = remoteDeletedAt;
    }
  }
  return merged;
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

export function mergeReaderData(localValue: unknown, remote: ReaderBackupContent): ReaderData {
  const local = sanitizeReaderData(localValue);
  const favorites = mergeTimedMapWithDeleted(
    local.favorites,
    remote.favorites,
    local.deletedRecords.favorites,
    remote.deletedRecords.favorites,
    (record) => record.savedAt
  );
  const history = mergeTimedMapWithDeleted(
    local.history,
    remote.history,
    local.deletedRecords.history,
    remote.deletedRecords.history,
    (record) => record.savedAt
  );
  const followedUsers = mergeTimedMapWithDeleted(
    local.followedUsers,
    remote.followedUsers,
    local.deletedRecords.followedUsers,
    remote.deletedRecords.followedUsers,
    (record) => record.followedAt
  );

  return {
    version: readerDataVersion,
    favorites: favorites.records,
    history: limitRecordMap(
      history.records,
      Math.max(MAX_HISTORY_RECORDS, Object.keys(local.history).length, Object.keys(remote.history).length),
      (record) => record.savedAt
    ),
    followedUsers: followedUsers.records,
    deletedRecords: {
      favorites: limitDeletedRecordMap(favorites.deleted),
      history: limitDeletedRecordMap(history.deleted),
      followedUsers: limitDeletedRecordMap(followedUsers.deleted)
    },
    settings: { ...local.settings, ...remote.settings }
  };
}

export function isUserFollowed(
  data: { followedUsers: Readonly<Record<string, unknown>> },
  user: Pick<UserProfile, 'source' | 'id'>
) {
  return Boolean(data.followedUsers[userKey(user)]);
}
