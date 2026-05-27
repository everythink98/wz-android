import type { Category, Source, Topic, UserProfile } from './types';

export const readerDataVersion = 2;
export const MAX_HISTORY_RECORDS = 1000;
export const MAX_PROGRESS_RECORDS = 1000;

export interface TopicRecord {
  topic: Topic;
  savedAt: string;
  visitCount?: number;
}

export interface ReadingProgressRecord {
  topic: Topic;
  percent: number;
  scrollY: number;
  updatedAt: string;
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
  palette: 'mint';
  background: 'warm';
  fontScale: number;
  lineHeight: 'compact' | 'standard' | 'loose';
  contentWidth: 'narrow' | 'standard' | 'wide';
  fontFamily: 'sans' | 'serif';
}

export interface ReaderData {
  version: 2;
  favorites: Record<string, TopicRecord>;
  history: Record<string, TopicRecord>;
  progress: Record<string, ReadingProgressRecord>;
  followedUsers: Record<string, FollowedUserRecord>;
  deletedRecords: DeletedRecords;
  settings: ReaderSettings;
}

const validSources = new Set<Source>(['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']);
const sensitiveUrlParamPattern = /^(cookie|token|password|secret|authorization|session|sid|sidyaohuo|csrf)$/i;

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
  return `https://yaohuo.me/bbs/userinfo.aspx?touserid=${encodeURIComponent(cleanId)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function isSource(value: unknown): value is Source {
  return typeof value === 'string' && validSources.has(value as Source);
}

function isTopic(value: unknown): value is Topic {
  const item = value as Partial<Topic>;
  return Boolean(
    item
    && isSource(item.source)
    && typeof item.id === 'string'
    && item.id
    && typeof item.title === 'string'
    && item.title
    && typeof item.url === 'string'
    && item.url
    && typeof item.createdAt === 'string'
    && dateValue(item.createdAt) > 0
    && (item.lastReplyAt === undefined || (typeof item.lastReplyAt === 'string' && dateValue(item.lastReplyAt) > 0))
  );
}

function isUserProfile(value: unknown): value is UserProfile {
  const item = value as Partial<UserProfile>;
  return Boolean(
    item
    && isSource(item.source)
    && typeof item.id === 'string'
    && item.id
    && typeof item.username === 'string'
    && item.username
    && typeof item.url === 'string'
    && item.url
  );
}

function sanitizeTopicUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveUrlParamPattern.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function topicSummary(topic: Topic): Topic {
  return {
    source: topic.source,
    id: String(topic.id),
    title: topic.title,
    author: topic.author || '',
    authorId: topic.authorId,
    authorAvatar: topic.authorAvatar,
    authorUrl: topic.authorUrl ? sanitizeTopicUrl(topic.authorUrl) : undefined,
    categoryId: topic.categoryId,
    category: topic.category,
    url: sanitizeTopicUrl(topic.url),
    createdAt: topic.createdAt,
    lastReplyAt: topic.lastReplyAt,
    replyCount: Number(topic.replyCount || 0),
    viewCount: topic.viewCount,
    excerpt: topic.excerpt
  };
}

function userSummary(user: UserProfile): UserProfile {
  const id = String(user.id || user.username || '').trim();
  return {
    source: user.source,
    id,
    username: user.username || user.displayName || '',
    displayName: user.displayName,
    avatar: user.avatar ? sanitizeTopicUrl(user.avatar) : undefined,
    url: sanitizeTopicUrl(userProfileUrl(user.source, id, user.url)),
    bio: user.bio,
    joinedAt: user.joinedAt,
    topicCount: typeof user.topicCount === 'number' ? user.topicCount : undefined,
    replyCount: typeof user.replyCount === 'number' ? user.replyCount : undefined,
    postCount: typeof user.postCount === 'number' ? user.postCount : undefined,
    topics: Array.isArray(user.topics) ? user.topics.filter(isTopic).map(topicSummary).slice(0, 50) : []
  };
}

function clampPercent(value: unknown) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function createEmptyDeletedRecords(): DeletedRecords {
  return {
    favorites: {},
    history: {},
    followedUsers: {}
  };
}

export function createEmptyReaderData(): ReaderData {
  return {
    version: readerDataVersion,
    favorites: {},
    history: {},
    progress: {},
    followedUsers: {},
    deletedRecords: createEmptyDeletedRecords(),
    settings: {
      listDensity: 'standard',
      theme: 'light',
      palette: 'mint',
      background: 'warm',
      fontScale: 1,
      lineHeight: 'standard',
      contentWidth: 'standard',
      fontFamily: 'sans'
    }
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
    const candidate = record as Partial<TopicRecord>;
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
      visitCount: typeof candidate.visitCount === 'number' && candidate.visitCount > 0 ? Math.round(candidate.visitCount) : undefined
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

function normalizeProgress(value: unknown): Record<string, ReadingProgressRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, ReadingProgressRecord> = {};
  for (const record of Object.values(value)) {
    const candidate = record as Partial<ReadingProgressRecord>;
    if (!candidate.topic || !isTopic(candidate.topic)) {
      continue;
    }
    const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '';
    if (dateValue(updatedAt) <= 0) {
      continue;
    }
    const topic = topicSummary(candidate.topic);
    next[topicKey(topic)] = {
      topic,
      percent: clampPercent(candidate.percent),
      scrollY: typeof candidate.scrollY === 'number' && candidate.scrollY > 0 ? Math.round(candidate.scrollY) : 0,
      updatedAt
    };
  }
  return next;
}

function normalizeFollowedUsers(value: unknown): Record<string, FollowedUserRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, FollowedUserRecord> = {};
  for (const record of Object.values(value)) {
    const candidate = record as Partial<FollowedUserRecord>;
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
  return next;
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

function normalizeSettings(value: unknown): ReaderSettings {
  const base = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const fontScale = typeof base.fontScale === 'number' && Number.isFinite(base.fontScale)
    ? Math.max(0.9, Math.min(1.25, Math.round(base.fontScale * 100) / 100))
    : 1;
  return {
    listDensity: base.listDensity === 'compact' || base.listDensity === 'loose' ? base.listDensity : 'standard',
    theme: base.theme === 'dark' ? 'dark' : 'light',
    palette: 'mint',
    background: 'warm',
    fontScale,
    lineHeight: base.lineHeight === 'compact' || base.lineHeight === 'loose' ? base.lineHeight : 'standard',
    contentWidth: base.contentWidth === 'narrow' || base.contentWidth === 'wide' ? base.contentWidth : 'standard',
    fontFamily: base.fontFamily === 'serif' ? 'serif' : 'sans'
  };
}

export function sanitizeReaderData(value: unknown): ReaderData {
  if (!value || typeof value !== 'object' || (value as Partial<ReaderData>).version !== readerDataVersion) {
    return createEmptyReaderData();
  }
  const data = value as Partial<ReaderData>;
  return {
    version: readerDataVersion,
    favorites: normalizeRecordMap(data.favorites),
    history: limitRecordMap(normalizeRecordMap(data.history), MAX_HISTORY_RECORDS, (record) => record.savedAt),
    progress: limitRecordMap(normalizeProgress(data.progress), MAX_PROGRESS_RECORDS, (record) => record.updatedAt),
    followedUsers: normalizeFollowedUsers(data.followedUsers),
    deletedRecords: normalizeDeletedRecords(data.deletedRecords),
    settings: normalizeSettings(data.settings)
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

function markDeleted(deletedRecords: DeletedRecords, section: keyof DeletedRecords, key: string, deletedAt = nowIso()): DeletedRecords {
  return {
    ...deletedRecords,
    [section]: {
      ...deletedRecords[section],
      [key]: deletedAt
    }
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
  const remoteHasSettings = hasOwnObjectField(remoteValue, 'settings');
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
    progress: mergeTimedMap(local.progress, remote.progress, (record) => record.updatedAt),
    followedUsers: followedUsers.records,
    deletedRecords: {
      favorites: favorites.deleted,
      history: history.deleted,
      followedUsers: followedUsers.deleted
    },
    settings: remoteHasSettings ? remote.settings : local.settings
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

export function updateProgress(data: ReaderData, topic: Topic, progress: { percent: number; scrollY: number }) {
  const summary = topicSummary(topic);
  return {
    ...data,
    progress: {
      ...data.progress,
      [topicKey(summary)]: {
        topic: summary,
        percent: clampPercent(progress.percent),
        scrollY: Math.max(0, Math.round(progress.scrollY)),
        updatedAt: nowIso()
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

export function isFavorite(data: ReaderData, topic: Pick<Topic, 'source' | 'id'>) {
  return Boolean(data.favorites[topicKey(topic)]);
}

export function isUserFollowed(data: ReaderData, user: Pick<UserProfile, 'source' | 'id'>) {
  return Boolean(data.followedUsers[userKey(user)]);
}
