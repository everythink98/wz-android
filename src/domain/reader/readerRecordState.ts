import type { Source, Topic, UserProfile } from '@/domain/forum/models';
import { createEmptyReaderData, sanitizeReaderSettings, topicKey, userKey, type ReaderSettings } from './readerData';

export const readerCollections = ['favorites', 'history', 'followedUsers'] as const;
export type ReaderCollection = (typeof readerCollections)[number];
export type ReaderKeys = Readonly<Record<string, unknown>>;

export interface ReaderMembership {
  favorites: ReaderKeys;
  history: ReaderKeys;
  followedUsers: ReaderKeys;
}

export interface ReaderView extends ReaderMembership {
  settings: ReaderSettings;
}

export interface ReaderState extends ReaderView {
  counts: Record<ReaderCollection, number>;
  revisions: Record<ReaderCollection, number>;
}

export type ReaderCommand =
  | { type: 'visit'; topic: Topic; at: string }
  | { type: 'topic-summary'; topic: Topic }
  | { type: 'favorite'; topic: Topic; enabled: boolean; at: string }
  | { type: 'follow'; user: UserProfile; enabled: boolean; at: string }
  | { type: 'delete'; collection: ReaderCollection; keys: readonly string[]; at: string }
  | { type: 'clear-history'; at: string }
  | { type: 'settings'; patch: Partial<ReaderSettings> };

export interface ReaderChange {
  membership: { collection: ReaderCollection; key: string; present: boolean }[];
  counts: Partial<Record<ReaderCollection, number>>;
  changed: ReaderCollection[];
  settings?: ReaderSettings;
}

export interface ReaderPageRequest {
  collection: ReaderCollection;
  sources: readonly Source[];
  source: Source | 'all';
  category: string;
  after?: { time: number; ordinal: number };
}

export function createEmptyReaderState(): ReaderState {
  return {
    favorites: {},
    history: {},
    followedUsers: {},
    settings: createEmptyReaderData().settings,
    counts: { favorites: 0, history: 0, followedUsers: 0 },
    revisions: { favorites: 0, history: 0, followedUsers: 0 }
  };
}

export function applyReaderChange(current: ReaderState, change: ReaderChange, committed = true): ReaderState {
  let next = current;
  const copied = new Set<ReaderCollection>();
  for (const item of change.membership) {
    if (Object.hasOwn(next[item.collection], item.key) === item.present) continue;
    if (!copied.has(item.collection)) {
      next = { ...next, [item.collection]: { ...next[item.collection] } };
      copied.add(item.collection);
    }
    const keys = next[item.collection] as Record<string, unknown>;
    if (item.present) keys[item.key] = true;
    else delete keys[item.key];
  }
  if (change.settings && JSON.stringify(change.settings) !== JSON.stringify(current.settings)) {
    next = { ...next, settings: change.settings };
  }
  for (const collection of readerCollections) {
    const count = change.counts[collection];
    if (count !== undefined && count !== next.counts[collection]) {
      next = { ...next, counts: { ...next.counts, [collection]: count } };
    }
  }
  if (committed && change.changed.length) {
    const revisions = { ...next.revisions };
    for (const collection of change.changed) revisions[collection]++;
    next = { ...next, revisions };
  }
  return next;
}

export function projectReaderCommand(current: ReaderState, command: ReaderCommand): ReaderState {
  const change: ReaderChange = { membership: [], counts: {}, changed: [] };
  const set = (collection: ReaderCollection, key: string, present: boolean) => {
    if (Object.hasOwn(current[collection], key) === present) return;
    change.membership.push({ collection, key, present });
    change.counts[collection] = (change.counts[collection] ?? current.counts[collection]) + (present ? 1 : -1);
  };
  switch (command.type) {
    case 'visit':
      set('history', topicKey(command.topic), true);
      break;
    case 'favorite':
      set('favorites', topicKey(command.topic), command.enabled);
      break;
    case 'follow':
      set('followedUsers', userKey(command.user), command.enabled);
      break;
    case 'delete':
      for (const key of new Set(command.keys)) set(command.collection, key, false);
      break;
    case 'clear-history':
      for (const key of Object.keys(current.history)) set('history', key, false);
      break;
    case 'settings':
      change.settings = sanitizeReaderSettings({ ...current.settings, ...command.patch });
      break;
  }
  return applyReaderChange(current, change, false);
}
