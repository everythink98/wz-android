import { describe, expect, it } from 'vitest';
import {
  addSavedSearch,
  createEmptyReaderData,
  isFavorite,
  isLater,
  mergeReaderData,
  recordHistory,
  sanitizeReaderData,
  toggleFavorite,
  toggleLater,
  toggleSubscription,
  topicKey,
  updateProgress
} from './readerData';
import type { Topic } from './types';

const topic: Topic = {
  source: 'nodeseek',
  id: '723704',
  title: 'NodeSeek topic',
  author: 'alice',
  category: '日常',
  url: 'https://www.nodeseek.com/post-723704-1',
  createdAt: '2026-05-18T11:34:13.000Z',
  lastReplyAt: '2026-05-18T12:34:13.000Z',
  replyCount: 2
};

describe('Android reader data helpers', () => {
  it('stores only a topic summary when recording history', () => {
    const detail = {
      ...topic,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const data = recordHistory(createEmptyReaderData(), detail);

    expect(data.history[topicKey(topic)].topic).toEqual(topic);
    expect(data.history[topicKey(topic)].visitCount).toBe(1);
  });

  it('toggles favorites and later records independently', () => {
    let data = createEmptyReaderData();
    data = toggleFavorite(data, topic);
    data = toggleLater(data, topic);

    expect(isFavorite(data, topic)).toBe(true);
    expect(isLater(data, topic)).toBe(true);

    data = toggleFavorite(data, topic);
    expect(isFavorite(data, topic)).toBe(false);
    expect(isLater(data, topic)).toBe(true);
    expect(data.deletedRecords.favorites[topicKey(topic)]).toEqual(expect.any(String));
  });

  it('tracks reading progress, subscriptions, and saved searches', () => {
    let data = createEmptyReaderData();
    data = updateProgress(data, topic, { percent: 125, scrollY: 88 });
    data = toggleSubscription(data, { source: 'nodeseek', id: '日常', name: '日常' });
    data = addSavedSearch(data, '  VPS  ', 'nodeseek');

    expect(data.progress[topicKey(topic)].percent).toBe(100);
    expect(data.subscriptions['nodeseek:日常']?.name).toBe('日常');
    expect(data.savedSearches[0]).toMatchObject({ query: 'VPS', source: 'nodeseek' });
  });

  it('drops sensitive NodeSeek fields while sanitizing synced data', () => {
    const data = sanitizeReaderData({
      version: 1,
      favorites: {},
      history: {},
      later: {},
      progress: {},
      subscriptions: {},
      savedSearches: [],
      settings: {
        trackedKeywords: ['AI'],
        blockedKeywords: [],
        blockedUsers: [],
        blockedCategories: [],
        listDensity: 'compact'
      },
      nodeseekCookie: 'secret',
      nodeseekPassword: 'secret'
    });

    expect(data).not.toHaveProperty('nodeseekCookie');
    expect(data).not.toHaveProperty('nodeseekPassword');
    expect(data.settings.listDensity).toBe('compact');
  });

  it('keeps only reader appearance settings that can be shared safely', () => {
    const data = sanitizeReaderData({
      version: 1,
      favorites: {},
      history: {},
      later: {},
      progress: {},
      subscriptions: {},
      savedSearches: [],
      settings: {
        trackedKeywords: [],
        blockedKeywords: [],
        blockedUsers: [],
        blockedCategories: [],
        listDensity: 'loose',
        theme: 'dark',
        palette: 'blue',
        background: 'gray',
        fontScale: 1.2,
        lineHeight: 'loose',
        contentWidth: 'wide',
        fontFamily: 'serif',
        nodeseekCookie: 'secret'
      }
    });

    expect(data.settings).toMatchObject({
      listDensity: 'loose',
      theme: 'dark',
      palette: 'blue',
      background: 'gray',
      fontScale: 1.2,
      lineHeight: 'loose',
      contentWidth: 'wide',
      fontFamily: 'serif'
    });
    expect(data.settings).not.toHaveProperty('nodeseekCookie');
  });

  it('merges reader data without overwriting newer local or remote records', () => {
    const localOnly: Topic = { ...topic, id: '1', title: 'Local only' };
    const remoteOnly: Topic = { ...topic, id: '2', title: 'Remote only' };
    const sharedLocal: Topic = { ...topic, id: '3', title: 'Local newer' };
    const sharedRemote: Topic = { ...topic, id: '3', title: 'Remote older' };
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(localOnly)]: { topic: localOnly, savedAt: '2026-05-20T02:00:00.000Z' },
        [topicKey(sharedLocal)]: { topic: sharedLocal, savedAt: '2026-05-20T03:00:00.000Z' }
      },
      savedSearches: [
        { id: 'all:codex', query: 'codex', source: 'all', savedAt: '2026-05-20T03:00:00.000Z' }
      ]
    });
    const remote = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(remoteOnly)]: { topic: remoteOnly, savedAt: '2026-05-20T04:00:00.000Z' },
        [topicKey(sharedRemote)]: { topic: sharedRemote, savedAt: '2026-05-20T01:00:00.000Z' }
      },
      savedSearches: [
        { id: 'all:codex', query: 'codex', source: 'all', savedAt: '2026-05-20T01:00:00.000Z' },
        { id: 'nodeseek:vps', query: 'vps', source: 'nodeseek', savedAt: '2026-05-20T04:00:00.000Z' }
      ]
    });

    const merged = mergeReaderData(local, remote);

    expect(merged.favorites[topicKey(localOnly)]?.topic.title).toBe('Local only');
    expect(merged.favorites[topicKey(remoteOnly)]?.topic.title).toBe('Remote only');
    expect(merged.favorites[topicKey(sharedLocal)]?.topic.title).toBe('Local newer');
    expect(merged.savedSearches.map((item) => item.id)).toEqual(['nodeseek:vps', 'all:codex']);
  });

  it('keeps newer local deletions from being restored by older remote records', () => {
    const key = topicKey(topic);
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      deletedRecords: {
        favorites: { [key]: '2026-05-20T05:00:00.000Z' },
        history: {},
        later: {},
        subscriptions: {},
        savedSearches: {}
      }
    });
    const remote = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [key]: { topic, savedAt: '2026-05-20T04:00:00.000Z' }
      }
    });

    const merged = mergeReaderData(local, remote);

    expect(merged.favorites[key]).toBeUndefined();
    expect(merged.deletedRecords.favorites[key]).toBe('2026-05-20T05:00:00.000Z');
  });

  it('lets newer remote records replace older local deletion markers', () => {
    const key = topicKey(topic);
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      deletedRecords: {
        favorites: { [key]: '2026-05-20T03:00:00.000Z' },
        history: {},
        later: {},
        subscriptions: {},
        savedSearches: {}
      }
    });
    const remote = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [key]: { topic, savedAt: '2026-05-20T04:00:00.000Z' }
      }
    });

    const merged = mergeReaderData(local, remote);

    expect(merged.favorites[key]?.topic.title).toBe('NodeSeek topic');
    expect(merged.deletedRecords.favorites[key]).toBeUndefined();
  });
});
