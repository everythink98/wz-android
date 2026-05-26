import type { Category, Source, Topic, UserProfile } from './types';

export const readerDataVersion = 1;
export const MAX_HISTORY_RECORDS = 1000;
export const MAX_PROGRESS_RECORDS = 1000;

export interface TopicRecord {
  topic: Topic;
  savedAt: string;
  updatedAt?: string;
  tags?: string[];
  note?: string;
  visitCount?: number;
}

export interface ReadingProgressRecord {
  topic: Topic;
  percent: number;
  scrollY: number;
  updatedAt: string;
}

export interface CategorySubscriptionRecord {
  source: Source;
  id: string;
  name: string;
  subscribedAt: string;
}

export interface FollowedUserRecord {
  user: UserProfile;
  followedAt: string;
}

export interface DeletedRecords {
  favorites: Record<string, string>;
  history: Record<string, string>;
  later: Record<string, string>;
  subscriptions: Record<string, string>;
  followedUsers: Record<string, string>;
}

export interface ReaderSettings {
  trackedKeywords: string[];
  blockedKeywords: string[];
  blockedUsers: string[];
  blockedCategories: string[];
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
  version: 1;
  favorites: Record<string, TopicRecord>;
  history: Record<string, TopicRecord>;
  later: Record<string, TopicRecord>;
  progress: Record<string, ReadingProgressRecord>;
  subscriptions: Record<string, CategorySubscriptionRecord>;
  followedUsers: Record<string, FollowedUserRecord>;
  deletedRecords: DeletedRecords;
  settings: ReaderSettings;
}

const validSources = new Set<Source>(['v2ex', 'linuxdo', 'nodeseek', 'yaohuo']);
const privateLocalSources = new Set<Source>(['yaohuo']);
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

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const clean = item.trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result.slice(0, 100);
}

function createEmptyDeletedRecords(): DeletedRecords {
  return {
    favorites: {},
    history: {},
    later: {},
    subscriptions: {},
    followedUsers: {}
  };
}

export function createEmptyReaderData(): ReaderData {
  return {
    version: readerDataVersion,
    favorites: {},
    history: {},
    later: {},
    progress: {},
    subscriptions: {},
    followedUsers: {},
    deletedRecords: createEmptyDeletedRecords(),
    settings: {
      trackedKeywords: [],
      blockedKeywords: [],
      blockedUsers: [],
      blockedCategories: [],
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
    const updatedAt = typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined;
    if (dateValue(savedAt) <= 0 || (updatedAt !== undefined && dateValue(updatedAt) <= 0)) {
      continue;
    }
    const topic = topicSummary(candidate.topic);
    next[topicKey(topic)] = {
      topic,
      savedAt,
      updatedAt,
      tags: Array.isArray(candidate.tags) ? candidate.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      note: typeof candidate.note === 'string' ? candidate.note : undefined,
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

function normalizeSubscriptions(value: unknown): Record<string, CategorySubscriptionRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, CategorySubscriptionRecord> = {};
  for (const record of Object.values(value)) {
    const candidate = record as Partial<CategorySubscriptionRecord>;
    if (!isSource(candidate.source) || !candidate.id || !candidate.name) {
      continue;
    }
    const subscription = {
      source: candidate.source,
      id: String(candidate.id),
      name: candidate.name,
      subscribedAt: typeof candidate.subscribedAt === 'string' ? candidate.subscribedAt : nowIso()
    };
    next[categoryKey(subscription)] = subscription;
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
    later: normalizeDeletedRecordMap(base.later),
    subscriptions: normalizeDeletedRecordMap(base.subscriptions),
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
    trackedKeywords: normalizeStringList(base.trackedKeywords),
    blockedKeywords: normalizeStringList(base.blockedKeywords),
    blockedUsers: normalizeStringList(base.blockedUsers),
    blockedCategories: normalizeStringList(base.blockedCategories),
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
    later: normalizeRecordMap(data.later),
    progress: limitRecordMap(normalizeProgress(data.progress), MAX_PROGRESS_RECORDS, (record) => record.updatedAt),
    subscriptions: normalizeSubscriptions(data.subscriptions),
    followedUsers: normalizeFollowedUsers(data.followedUsers),
    deletedRecords: normalizeDeletedRecords(data.deletedRecords),
    settings: normalizeSettings(data.settings)
  };
}

function isPrivateTopicRecord(record: TopicRecord | ReadingProgressRecord) {
  return privateLocalSources.has(record.topic.source);
}

function filterPrivateTopicRecords<T extends TopicRecord | ReadingProgressRecord>(records: Record<string, T>) {
  return Object.fromEntries(Object.entries(records).filter(([, record]) => !isPrivateTopicRecord(record)));
}

function filterPrivateSubscriptions(records: Record<string, CategorySubscriptionRecord>) {
  return Object.fromEntries(Object.entries(records).filter(([, record]) => !privateLocalSources.has(record.source)));
}

function filterPrivateDeleted(records: Record<string, string>) {
  return Object.fromEntries(Object.entries(records).filter(([key]) => !key.startsWith('yaohuo:')));
}

export function sanitizeReaderDataForSync(value: unknown): ReaderData {
  const data = sanitizeReaderData(value);
  return sanitizeReaderData({
    ...data,
    favorites: filterPrivateTopicRecords(data.favorites),
    history: filterPrivateTopicRecords(data.history),
    later: filterPrivateTopicRecords(data.later),
    progress: filterPrivateTopicRecords(data.progress),
    subscriptions: filterPrivateSubscriptions(data.subscriptions),
    followedUsers: Object.fromEntries(Object.entries(data.followedUsers).filter(([, record]) => !privateLocalSources.has(record.user.source))),
    deletedRecords: {
      favorites: filterPrivateDeleted(data.deletedRecords.favorites),
      history: filterPrivateDeleted(data.deletedRecords.history),
      later: filterPrivateDeleted(data.deletedRecords.later),
      subscriptions: filterPrivateDeleted(data.deletedRecords.subscriptions),
      followedUsers: filterPrivateDeleted(data.deletedRecords.followedUsers)
    }
  });
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

function topicRecordTime(record: TopicRecord) {
  return record.updatedAt || record.savedAt;
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
  const favorites = mergeTimedMapWithDeleted(local.favorites, remote.favorites, local.deletedRecords.favorites, remote.deletedRecords.favorites, topicRecordTime);
  const history = mergeTimedMapWithDeleted(local.history, remote.history, local.deletedRecords.history, remote.deletedRecords.history, topicRecordTime);
  const later = mergeTimedMapWithDeleted(local.later, remote.later, local.deletedRecords.later, remote.deletedRecords.later, topicRecordTime);
  const subscriptions = mergeTimedMapWithDeleted(
    local.subscriptions,
    remote.subscriptions,
    local.deletedRecords.subscriptions,
    remote.deletedRecords.subscriptions,
    (record) => record.subscribedAt
  );
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
    later: later.records,
    progress: mergeTimedMap(local.progress, remote.progress, (record) => record.updatedAt),
    subscriptions: subscriptions.records,
    followedUsers: followedUsers.records,
    deletedRecords: {
      favorites: favorites.deleted,
      history: history.deleted,
      later: later.deleted,
      subscriptions: subscriptions.deleted,
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

export function toggleLater(data: ReaderData, topic: Topic) {
  const summary = topicSummary(topic);
  const key = topicKey(summary);
  const next = { ...data.later };
  let deletedRecords = data.deletedRecords;
  if (next[key]) {
    delete next[key];
    deletedRecords = markDeleted(deletedRecords, 'later', key);
  } else {
    next[key] = { topic: summary, savedAt: nowIso() };
    deletedRecords = clearDeleted(deletedRecords, 'later', key);
  }
  return { ...data, later: next, deletedRecords };
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

export function toggleSubscription(data: ReaderData, category: Pick<Category, 'source' | 'id' | 'name'>) {
  const key = categoryKey(category);
  const next = { ...data.subscriptions };
  let deletedRecords = data.deletedRecords;
  if (next[key]) {
    delete next[key];
    deletedRecords = markDeleted(deletedRecords, 'subscriptions', key);
  } else {
    next[key] = {
      source: category.source,
      id: category.id,
      name: category.name,
      subscribedAt: nowIso()
    };
    deletedRecords = clearDeleted(deletedRecords, 'subscriptions', key);
  }
  return { ...data, subscriptions: next, deletedRecords };
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

export function updateTopicRecord(
  data: ReaderData,
  section: 'favorites' | 'history',
  topic: Pick<Topic, 'source' | 'id'>,
  patch: Pick<TopicRecord, 'tags' | 'note'>
) {
  const key = topicKey(topic);
  const record = data[section][key];
  if (!record) {
    return data;
  }
  return {
    ...data,
    [section]: {
      ...data[section],
      [key]: {
        ...record,
        tags: normalizeStringList(patch.tags),
        note: typeof patch.note === 'string' ? patch.note.trim() : '',
        updatedAt: nowIso()
      }
    }
  };
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

export function restoreRecords(data: ReaderData, section: 'favorites' | 'history', records: Record<string, TopicRecord>) {
  const restored = normalizeRecordMap(records);
  const deleted = { ...data.deletedRecords[section] };
  for (const key of Object.keys(restored)) {
    delete deleted[key];
  }
  return sanitizeReaderData({
    ...data,
    [section]: {
      ...data[section],
      ...restored
    },
    deletedRecords: {
      ...data.deletedRecords,
      [section]: deleted
    }
  });
}

export function exportFavoritesMarkdown(data: ReaderData) {
  const records = Object.values(data.favorites)
    .sort((left, right) => dateValue(right.savedAt) - dateValue(left.savedAt));
  if (!records.length) {
    return '# 收藏\n\n暂无收藏\n';
  }
  const lines = ['# 收藏', ''];
  for (const record of records) {
    const topic = record.topic;
    lines.push(`- [${topic.title}](${topic.url})`);
    lines.push(`  - 来源：${topic.source}${topic.category ? ` · ${topic.category}` : ''}`);
    if (record.tags?.length) {
      lines.push(`  - 标签：${record.tags.join(', ')}`);
    }
    if (record.note) {
      lines.push(`  - 备注：${record.note}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function isFavorite(data: ReaderData, topic: Pick<Topic, 'source' | 'id'>) {
  return Boolean(data.favorites[topicKey(topic)]);
}

export function isLater(data: ReaderData, topic: Pick<Topic, 'source' | 'id'>) {
  return Boolean(data.later[topicKey(topic)]);
}

export function isSubscribed(data: ReaderData, category: Pick<Category, 'source' | 'id'>) {
  return Boolean(data.subscriptions[categoryKey(category)]);
}

export function isUserFollowed(data: ReaderData, user: Pick<UserProfile, 'source' | 'id'>) {
  return Boolean(data.followedUsers[userKey(user)]);
}
