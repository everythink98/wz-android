import { describe, expect, it } from 'vitest';
import {
  clearRecords,
  createEmptyReaderData,
  isFavorite,
  isUserFollowed,
  MAX_HISTORY_RECORDS,
  MAX_PROGRESS_RECORDS,
  mergeReaderData,
  recordHistory,
  removeFollowedUsers,
  removeRecords,
  sanitizeReaderData,
  toggleFavorite,
  toggleFollowedUser,
  toggleSubscription,
  topicKey,
  updateProgress,
  userKey
} from './readerData';
import type { Topic, UserProfile } from './types';

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

const profile: UserProfile = {
  source: 'nodeseek',
  id: '48872',
  username: 'alice',
  displayName: 'Alice',
  avatar: 'https://www.nodeseek.com/avatar/48872.png',
  url: 'https://www.nodeseek.com/space/48872',
  topics: []
};

describe('Android reader data helpers', () => {
  it('creates only the current Android reader data shape', () => {
    const data = createEmptyReaderData();

    expect(data.version).toBe(2);
    expect(data).not.toHaveProperty('later');
    expect(data.deletedRecords).not.toHaveProperty('later');
    expect(data).not.toHaveProperty('savedSearches');
    expect(data.deletedRecords).not.toHaveProperty('savedSearches');
    expect(data.settings).toMatchObject({
      theme: 'light',
      palette: 'mint',
      background: 'warm'
    });
  });

  it('rejects old reader data versions instead of migrating old fields', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      version: 1,
      favorites: {
        [topicKey(topic)]: { topic, savedAt: '2026-05-20T00:00:00.000Z' }
      },
      later: {
        [topicKey(topic)]: { topic, savedAt: '2026-05-20T00:00:00.000Z' }
      },
      savedSearches: [
        { id: 'all:gpt', query: 'GPT', source: 'all', savedAt: '2026-05-20T01:00:00.000Z' }
      ]
    });

    expect(data).toEqual(createEmptyReaderData());
  });

  it('stores only a topic summary when recording history', () => {
    const detail = {
      ...topic,
      contentHtml: '<p>body</p>',
      replies: []
    };
    const data = recordHistory(createEmptyReaderData(), detail);

    expect(data.history[topicKey(topic)].topic).toEqual(topic);
    expect(data.history[topicKey(topic)].visitCount).toBe(1);
    expect(data.history[topicKey(topic)]).not.toHaveProperty('tags');
    expect(data.history[topicKey(topic)]).not.toHaveProperty('note');
  });

  it('toggles favorites without keeping old later records', () => {
    let data = createEmptyReaderData();
    data = toggleFavorite(data, topic);

    expect(isFavorite(data, topic)).toBe(true);

    data = toggleFavorite(data, topic);
    expect(isFavorite(data, topic)).toBe(false);
    expect(data.deletedRecords.favorites[topicKey(topic)]).toEqual(expect.any(String));
    expect(data).not.toHaveProperty('later');
  });

  it('tracks reading progress and subscriptions', () => {
    let data = createEmptyReaderData();
    data = updateProgress(data, topic, { percent: 125, scrollY: 88 });
    data = toggleSubscription(data, { source: 'nodeseek', id: '日常', name: '日常' });

    expect(data.progress[topicKey(topic)].percent).toBe(100);
    expect(data.subscriptions['nodeseek:日常']?.name).toBe('日常');
  });

  it('stores followed users separately from favorite topics', () => {
    let data = createEmptyReaderData();

    data = toggleFollowedUser(data, profile);

    expect(isUserFollowed(data, profile)).toBe(true);
    expect(data.followedUsers[userKey(profile)]).toMatchObject({
      user: profile,
      followedAt: expect.any(String)
    });
    expect(data.favorites).toEqual({});

    data = toggleFollowedUser(data, profile);

    expect(isUserFollowed(data, profile)).toBe(false);
    expect(data.deletedRecords.followedUsers[userKey(profile)]).toEqual(expect.any(String));
  });

  it('keeps followed users created from topic authors even when the profile url is missing', () => {
    const partialProfile: UserProfile = {
      source: 'v2ex',
      id: 'neo',
      username: 'neo',
      displayName: 'neo',
      url: '',
      topics: []
    };

    const data = toggleFollowedUser(createEmptyReaderData(), partialProfile);

    expect(data.followedUsers[userKey(partialProfile)]?.user.url).toBe('https://www.v2ex.com/member/neo');
    expect(sanitizeReaderData(data).followedUsers[userKey(partialProfile)]?.user.url).toBe('https://www.v2ex.com/member/neo');
  });

  it('removes followed users with deletion markers', () => {
    let data = toggleFollowedUser(createEmptyReaderData(), profile);

    data = removeFollowedUsers(data, [profile]);

    expect(data.followedUsers).toEqual({});
    expect(data.deletedRecords.followedUsers[userKey(profile)]).toEqual(expect.any(String));
  });

  it('drops sensitive NodeSeek fields while sanitizing reader data', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      settings: {
        ...createEmptyReaderData().settings,
        listDensity: 'compact'
      },
      nodeseekCookie: 'secret',
      nodeseekPassword: 'secret'
    });

    expect(data).not.toHaveProperty('nodeseekCookie');
    expect(data).not.toHaveProperty('nodeseekPassword');
    expect(data.settings.listDensity).toBe('compact');
  });

  it('keeps only current Android appearance settings', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      settings: {
        ...createEmptyReaderData().settings,
        theme: 'system',
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
      theme: 'light',
      palette: 'mint',
      background: 'warm',
      fontScale: 1.2,
      lineHeight: 'loose',
      contentWidth: 'wide',
      fontFamily: 'serif'
    });
    expect(data.settings).not.toHaveProperty('nodeseekCookie');
  });

  it('merges current reader data without overwriting newer local or remote records', () => {
    const localOnly: Topic = { ...topic, id: '1', title: 'Local only' };
    const remoteOnly: Topic = { ...topic, id: '2', title: 'Remote only' };
    const sharedLocal: Topic = { ...topic, id: '3', title: 'Local newer' };
    const sharedRemote: Topic = { ...topic, id: '3', title: 'Remote older' };
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(localOnly)]: { topic: localOnly, savedAt: '2026-05-20T02:00:00.000Z' },
        [topicKey(sharedLocal)]: { topic: sharedLocal, savedAt: '2026-05-20T03:00:00.000Z' }
      }
    });
    const remote = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(remoteOnly)]: { topic: remoteOnly, savedAt: '2026-05-20T04:00:00.000Z' },
        [topicKey(sharedRemote)]: { topic: sharedRemote, savedAt: '2026-05-20T01:00:00.000Z' }
      }
    });

    const merged = mergeReaderData(local, remote);

    expect(merged.favorites[topicKey(localOnly)]?.topic.title).toBe('Local only');
    expect(merged.favorites[topicKey(remoteOnly)]?.topic.title).toBe('Remote only');
    expect(merged.favorites[topicKey(sharedLocal)]?.topic.title).toBe('Local newer');
  });

  it('removes records and clears history with deletion markers', () => {
    const secondTopic: Topic = { ...topic, id: '2', title: 'Second topic' };
    let data = createEmptyReaderData();
    data = toggleFavorite(data, topic);
    data = toggleFavorite(data, secondTopic);

    data = removeRecords(data, 'favorites', [topic, secondTopic]);
    expect(data.favorites).toEqual({});
    expect(Object.keys(data.deletedRecords.favorites)).toHaveLength(2);

    data = recordHistory(data, topic);
    data = recordHistory(data, secondTopic);
    data = clearRecords(data, 'history');
    expect(data.history).toEqual({});
    expect(Object.keys(data.deletedRecords.history)).toHaveLength(2);
  });

  it('lets newer deletion markers suppress older imported records', () => {
    const key = topicKey(topic);
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      deletedRecords: {
        favorites: { [key]: '2026-05-20T05:00:00.000Z' },
        history: {},
        subscriptions: {},
        followedUsers: {}
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

  it('lets newer imported records replace older local deletion markers', () => {
    const key = topicKey(topic);
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      deletedRecords: {
        favorites: { [key]: '2026-05-20T03:00:00.000Z' },
        history: {},
        subscriptions: {},
        followedUsers: {}
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

  it('keeps yaohuo data in local Android backups', () => {
    const yaohuoTopic: Topic = {
      ...topic,
      source: 'yaohuo',
      id: '1',
      title: '妖火帖子',
      url: 'https://yaohuo.me/bbs-1.html'
    };
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(yaohuoTopic)]: { topic: yaohuoTopic, savedAt: '2026-05-20T02:00:00.000Z' }
      }
    });

    expect(local.favorites[topicKey(yaohuoTopic)]?.topic.title).toBe('妖火帖子');
  });

  it('limits history and reading progress to the newest records', () => {
    const history: Record<string, unknown> = {};
    const progress: Record<string, unknown> = {};
    for (let index = 0; index < MAX_HISTORY_RECORDS + 20; index += 1) {
      const item = {
        ...topic,
        id: String(index),
        title: `Topic ${index}`
      };
      const time = new Date(Date.UTC(2026, 4, 20, 0, index)).toISOString();
      history[topicKey(item)] = { topic: item, savedAt: time };
      progress[topicKey(item)] = { topic: item, percent: 50, scrollY: index, updatedAt: time };
    }

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      history,
      progress
    });

    expect(Object.keys(data.history)).toHaveLength(MAX_HISTORY_RECORDS);
    expect(Object.keys(data.progress)).toHaveLength(MAX_PROGRESS_RECORDS);
    expect(data.history['nodeseek:0']).toBeUndefined();
    expect(data.progress['nodeseek:0']).toBeUndefined();
    expect(data.history[`nodeseek:${MAX_HISTORY_RECORDS + 19}`]?.topic.title).toBe(`Topic ${MAX_HISTORY_RECORDS + 19}`);
  });

  it('drops local topic records with unsafe missing links or timestamps', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        'nodeseek:broken': {
          topic: {
            source: 'nodeseek',
            id: 'broken',
            title: 'Broken topic'
          },
          savedAt: '2026-05-20T02:00:00.000Z'
        },
        [topicKey(topic)]: {
          topic,
          savedAt: '2026-05-20T03:00:00.000Z'
        }
      }
    });

    expect(data.favorites['nodeseek:broken']).toBeUndefined();
    expect(data.favorites[topicKey(topic)]?.topic.url).toBe(topic.url);
  });

  it('removes sensitive query parameters from stored topic links', () => {
    const unsafeTopic: Topic = {
      ...topic,
      source: 'yaohuo',
      id: '1',
      url: 'https://yaohuo.me/bbs/book_view.aspx?id=1&classid=177&sid=secret&token=hidden'
    };

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(unsafeTopic)]: {
          topic: unsafeTopic,
          savedAt: '2026-05-20T03:00:00.000Z'
        }
      }
    });

    const url = data.favorites[topicKey(unsafeTopic)]?.topic.url || '';
    const params = new URL(url).searchParams;
    expect(params.get('id')).toBe('1');
    expect(params.get('classid')).toBe('177');
    expect(url).not.toContain('secret');
    expect(params.has('sid')).toBe(false);
    expect(params.has('token')).toBe(false);
  });
});
