import { describe, expect, it } from 'vitest';
import {
  createEmptyReaderData,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  MAX_DELETED_RECORDS,
  MAX_HISTORY_RECORDS,
  MAX_READER_STRING_LENGTH,
  mergeReaderData,
  normalizeFontScale,
  sanitizeReaderData,
  sanitizeReaderSettings,
  topicKey,
  userKey,
  validateStoredReaderData
} from './readerData';
import type { Topic, UserProfile } from '@/domain/forum/models';

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
  it.each(['nodeseek', 'linuxdo', 'v2ex', 'yaohuo'] as const)(
    'preserves unknown %s publication dates in every saved topic collection',
    (source) => {
      const item = { ...topic, source, createdAt: '', lastReplyAt: '' };
      const user = { ...profile, source, topics: [item] };
      const record = { topic: item, savedAt: '2026-09-20T00:00:00.000Z' };
      const data = {
        ...createEmptyReaderData(),
        favorites: { [topicKey(item)]: record },
        history: { [topicKey(item)]: record },
        followedUsers: { [userKey(user)]: { user, followedAt: record.savedAt } }
      };
      expect(validateStoredReaderData(data)).toEqual(data);
      const clean = sanitizeReaderData(data);
      expect(clean.favorites[topicKey(item)].topic.createdAt).toBe('');
      expect(clean.history[topicKey(item)].topic.createdAt).toBe('');
      expect(clean.followedUsers[userKey(user)].user.topics[0].createdAt).toBe('');
      expect(clean.favorites[topicKey(item)].topic.lastReplyAt).toBeUndefined();
    }
  );

  it('still rejects corrupt publication dates and missing operation times', () => {
    const savedAt = '2026-09-20T00:00:00.000Z';
    for (const patch of [
      { createdAt: undefined },
      { createdAt: null },
      { createdAt: 123 },
      { createdAt: 'not-a-date' },
      { lastReplyAt: 'not-a-date' }
    ]) {
      const data = {
        ...createEmptyReaderData(),
        favorites: { [topicKey(topic)]: { topic: { ...topic, ...patch }, savedAt } }
      };
      expect(() => validateStoredReaderData(data)).toThrow('主题记录');
      expect(sanitizeReaderData(data).favorites).toEqual({});
    }
    const item = { ...topic, createdAt: '', lastReplyAt: '' };
    for (const invalid of [
      { favorites: { [topicKey(item)]: { topic: item, savedAt: '' } } },
      { followedUsers: { [userKey(profile)]: { user: profile, followedAt: '' } } },
      { deletedRecords: { favorites: { [topicKey(item)]: '' } } }
    ]) {
      const data = { ...createEmptyReaderData(), ...invalid };
      expect(() => validateStoredReaderData(data)).toThrow();
      const clean = sanitizeReaderData(data);
      expect(clean.favorites).toEqual({});
      expect(clean.followedUsers).toEqual({});
      expect(clean.deletedRecords.favorites).toEqual({});
    }
  });

  it('normalizes font scale to 5% steps between 85% and 140%', () => {
    expect(normalizeFontScale(0.2)).toBe(FONT_SCALE_MIN);
    expect(normalizeFontScale(2)).toBe(FONT_SCALE_MAX);
    expect(normalizeFontScale(1.12)).toBe(1.1);
    expect(normalizeFontScale(1.13)).toBe(1.15);
    expect(normalizeFontScale(1.2)).toBe(1.2);
    expect(normalizeFontScale(Number.NaN, 1.05)).toBe(1.05);
  });

  it('creates only the current Android reader data shape', () => {
    const data = createEmptyReaderData();

    expect(data.version).toBe(2);
    expect(data).not.toHaveProperty('subscriptions');
    expect(data).not.toHaveProperty('later');
    expect(data.deletedRecords).not.toHaveProperty('subscriptions');
    expect(data.deletedRecords).not.toHaveProperty('later');
    expect(data).not.toHaveProperty('savedSearches');
    expect(data.deletedRecords).not.toHaveProperty('savedSearches');
    expect(data.settings).toMatchObject({
      theme: 'light'
    });
    expect(data.settings).not.toHaveProperty('palette');
    expect(data.settings).not.toHaveProperty('background');
  });

  it('accepts only the current Android reader data version', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      version: 1,
      favorites: {
        [topicKey(topic)]: { topic, savedAt: '2026-05-20T00:00:00.000Z' }
      },
      later: {
        [topicKey(topic)]: { topic, savedAt: '2026-05-20T00:00:00.000Z' }
      },
      savedSearches: [{ id: 'all:gpt', query: 'GPT', source: 'all', savedAt: '2026-05-20T01:00:00.000Z' }]
    });

    expect(data).toEqual(createEmptyReaderData());
  });

  it('drops old inferred NodeSeek inside-category access markers from readable favorite summaries', () => {
    const readableInsideTopic: Topic = {
      ...topic,
      id: '7202',
      title: '新版块“内版”，以及试行版规',
      categoryId: 'inside',
      category: '内版',
      excerpt: '为什么会有这个版块，以及这里的试行版规。',
      accessRequirement: {
        type: 'level',
        label: '需等级',
        detail: 'Lv2'
      }
    };

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(readableInsideTopic)]: {
          topic: readableInsideTopic,
          savedAt: '2026-06-04T06:59:04.776Z'
        }
      }
    });

    expect(data.favorites[topicKey(readableInsideTopic)].topic.accessRequirement).toBeUndefined();
  });

  it('keeps explicit NodeSeek inside Lv2 markers when no readable excerpt is known', () => {
    const restrictedTopic: Topic = {
      ...topic,
      id: '760813',
      title: '求新闻类app分流域名合集',
      categoryId: 'inside',
      category: '内版',
      excerpt: '',
      accessRequirement: {
        type: 'level',
        label: '需等级',
        detail: 'Lv2'
      }
    };

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(restrictedTopic)]: {
          topic: restrictedTopic,
          savedAt: '2026-06-04T06:59:04.776Z'
        }
      }
    });

    expect(data.favorites[topicKey(restrictedTopic)].topic.accessRequirement).toEqual({
      type: 'level',
      label: '需等级',
      detail: 'Lv2'
    });
  });

  it('normalizes old favorite permission details that mention a required NodeSeek level', () => {
    const restrictedTopic: Topic = {
      ...topic,
      id: '760813',
      title: '求新闻类app分流域名合集',
      accessRequirement: {
        type: 'permission',
        label: '需权限',
        detail: '查看本帖需要Lv2，您的权限不足😑，请赚取🍗升级您的用户等级'
      }
    };

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(restrictedTopic)]: {
          topic: restrictedTopic,
          savedAt: '2026-06-04T06:59:04.776Z'
        }
      }
    });

    expect(data.favorites[topicKey(restrictedTopic)].topic.accessRequirement).toMatchObject({
      type: 'level',
      label: '需等级'
    });
  });

  it('drops old reading progress records during sanitizing', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      progress: {
        [topicKey(topic)]: { topic, percent: 50, scrollY: 88, updatedAt: '2026-05-20T00:00:00.000Z' }
      }
    });

    expect(data).not.toHaveProperty('progress');
    expect(data).not.toHaveProperty('subscriptions');
  });

  it('never creates a NodeSeek followed-user key from a username', () => {
    expect(() => userKey({ source: 'nodeseek', id: 'xy' })).toThrow('NodeSeek 用户 ID 必须是数字');
    expect(userKey({ source: 'nodeseek', id: '8052' })).toBe('nodeseek:8052');
  });

  it('drops polluted yaohuo followed user display names during sanitizing', () => {
    const data = sanitizeReaderData({
      version: 2,
      favorites: {},
      history: {},
      followedUsers: {
        'yaohuo:36925': {
          user: {
            source: 'yaohuo',
            id: '36925',
            username: '李慕婉o',
            displayName: '369256小时前正在论坛查询标题:醒图7小时前查看更多动态人气值4,443空间人气6今日人气留言板',
            url: 'https://yaohuo.me/bbs/userinfo.aspx?touserid=36925',
            topicCount: 1659,
            replyCount: 3698222,
            postCount: 3699881,
            topics: [
              {
                ...topic,
                source: 'yaohuo',
                id: '1540797',
                author: '369256小时前正在论坛查询标题:醒图7小时前查看更多动态人气值4,443空间人气6今日人气留言板',
                authorId: '36925',
                authorUrl: 'https://yaohuo.me/bbs/userinfo.aspx?touserid=36925',
                url: 'https://yaohuo.me/bbs/book_view.aspx?siteid=1000&classid=201&id=1540797'
              }
            ]
          },
          followedAt: '2026-05-28T15:31:33.012Z'
        }
      },
      deletedRecords: { favorites: {}, history: {}, followedUsers: {} }
    });

    expect(data.followedUsers['yaohuo:36925']?.user.displayName).toBe('李慕婉o');
    expect(data.followedUsers['yaohuo:36925']?.user.topicCount).toBe(1659);
    expect(data.followedUsers['yaohuo:36925']?.user.replyCount).toBeUndefined();
    expect(data.followedUsers['yaohuo:36925']?.user.postCount).toBeUndefined();
    expect(data.followedUsers['yaohuo:36925']?.user.topics[0].author).toBe('李慕婉o');
  });

  it('sanitizes followed-user statistics as non-negative integers', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      followedUsers: {
        'nodeseek:48872': {
          user: {
            ...profile,
            topicCount: -1,
            replyCount: 1.6,
            postCount: -3
          },
          followedAt: '2026-05-28T15:31:33.012Z'
        },
        'yaohuo:7': {
          user: {
            source: 'yaohuo',
            id: '7',
            username: '火友',
            url: 'https://www.yaohuo.me/bbs/userinfo.aspx?touserid=7',
            topicCount: 0,
            replyCount: 4,
            topics: []
          },
          followedAt: '2026-05-28T15:31:33.012Z'
        }
      }
    });

    expect(data.followedUsers['nodeseek:48872']?.user).toMatchObject({ replyCount: 2 });
    expect(data.followedUsers['nodeseek:48872']?.user.topicCount).toBeUndefined();
    expect(data.followedUsers['nodeseek:48872']?.user.postCount).toBeUndefined();
    expect(data.followedUsers['yaohuo:7']?.user.postCount).toBe(4);
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
      fontScale: 1.2,
      lineHeight: 'loose',
      contentWidth: 'wide',
      fontFamily: 'serif'
    });
    expect(data.settings).not.toHaveProperty('palette');
    expect(data.settings).not.toHaveProperty('background');
    expect(data.settings).not.toHaveProperty('nodeseekCookie');
  });

  it('adds default content sources to old v2 reader settings without changing the version', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      settings: { theme: 'dark' }
    });

    expect(data.version).toBe(2);
    expect(data.settings.theme).toBe('dark');
    expect(data.settings.contentSources).toEqual([
      { source: 'v2ex', enabled: true },
      { source: 'linuxdo', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true }
    ]);
  });

  it('keeps default content sources isolated between new and sanitized settings', () => {
    createEmptyReaderData().settings.contentSources[0].enabled = false;

    expect(createEmptyReaderData().settings.contentSources[0]).toEqual({ source: 'v2ex', enabled: true });
    expect(sanitizeReaderSettings({}).contentSources[0]).toEqual({ source: 'v2ex', enabled: true });
  });

  it('sanitizes the NodeSeek read-channel recovery threshold for storage and backup data', () => {
    expect(createEmptyReaderData().settings.nodeSeekRecoveryThreshold).toBe(1);
    expect(
      sanitizeReaderData({
        ...createEmptyReaderData(),
        settings: { ...createEmptyReaderData().settings, nodeSeekRecoveryThreshold: 3.6 }
      }).settings.nodeSeekRecoveryThreshold
    ).toBe(4);
    expect(
      sanitizeReaderData({
        ...createEmptyReaderData(),
        settings: { ...createEmptyReaderData().settings, nodeSeekRecoveryThreshold: -10 }
      }).settings.nodeSeekRecoveryThreshold
    ).toBe(1);
    expect(
      sanitizeReaderData({
        ...createEmptyReaderData(),
        settings: { ...createEmptyReaderData().settings, nodeSeekRecoveryThreshold: 99 }
      }).settings.nodeSeekRecoveryThreshold
    ).toBe(5);
  });

  it('keeps current-version data limited to active Android fields', () => {
    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      subscriptions: {
        'nodeseek:daily': { source: 'nodeseek', id: 'daily', name: '日常', subscribedAt: '2026-05-20T00:00:00.000Z' }
      },
      deletedRecords: {
        ...createEmptyReaderData().deletedRecords,
        subscriptions: { 'nodeseek:daily': '2026-05-20T01:00:00.000Z' }
      },
      settings: {
        ...createEmptyReaderData().settings,
        trackedKeywords: ['linux'],
        blockedKeywords: ['广告'],
        blockedUsers: ['spammer'],
        blockedCategories: ['nodeseek:daily']
      }
    });

    expect(data).not.toHaveProperty('subscriptions');
    expect(data.deletedRecords).not.toHaveProperty('subscriptions');
    expect(data.settings).not.toHaveProperty('trackedKeywords');
    expect(data.settings).not.toHaveProperty('blockedKeywords');
    expect(data.settings).not.toHaveProperty('blockedUsers');
    expect(data.settings).not.toHaveProperty('blockedCategories');
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

  it('lets newer deletion markers suppress older imported records', () => {
    const key = topicKey(topic);
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      deletedRecords: {
        favorites: { [key]: '2026-05-20T05:00:00.000Z' },
        history: {},
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

  it.each([999, 1000, 1001])('resolves deletion conflicts before retaining %s markers', (count) => {
    for (const collection of ['favorites', 'history', 'followedUsers'] as const) {
      for (const day of [1, 2, 3]) {
        const local = createEmptyReaderData();
        const remote = createEmptyReaderData();
        const key = collection === 'followedUsers' ? userKey(profile) : topicKey(topic);
        local.deletedRecords[collection][key] = '2026-06-02T00:00:00Z';
        for (let index = 0; index < count - 1; index++) {
          remote.deletedRecords[collection][`nodeseek:other-${index}`] = '2026-07-01T00:00:00Z';
        }
        const at = `2026-06-0${day}T00:00:00Z`;
        if (collection === 'followedUsers') remote.followedUsers[key] = { user: profile, followedAt: at };
        else remote[collection][key] = { topic, savedAt: at };
        const merged = mergeReaderData(local, remote);
        expect(Boolean(merged[collection][key]), `${collection}: day ${day}`).toBe(day > 2);
        expect(Object.keys(merged.deletedRecords[collection]).length).toBeLessThanOrEqual(MAX_DELETED_RECORDS);
      }
    }
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

  it('validates history without trimming existing records', () => {
    const history: Record<string, unknown> = {};
    for (let index = 0; index < MAX_HISTORY_RECORDS + 20; index += 1) {
      const item = {
        ...topic,
        id: String(index),
        title: `Topic ${index}`
      };
      const time = new Date(Date.UTC(2026, 4, 20, 0, index)).toISOString();
      history[topicKey(item)] = { topic: item, savedAt: time };
    }

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      history
    });

    expect(Object.keys(data.history)).toHaveLength(MAX_HISTORY_RECORDS + 20);
    expect(data.history['nodeseek:0']).toBeDefined();
    expect(data.history[`nodeseek:${MAX_HISTORY_RECORDS + 19}`]?.topic.title).toBe(`Topic ${MAX_HISTORY_RECORDS + 19}`);
  });

  it('validates deletion markers without trimming persisted records', () => {
    const favorites: Record<string, string> = {};
    for (let index = 0; index < MAX_DELETED_RECORDS + 2; index += 1) {
      favorites[`nodeseek:${index}`] = new Date(Date.UTC(2026, 4, 20, 0, index)).toISOString();
    }

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      deletedRecords: {
        favorites,
        history: {},
        followedUsers: {}
      }
    });

    expect(Object.keys(data.deletedRecords.favorites)).toHaveLength(MAX_DELETED_RECORDS + 2);
    expect(data.deletedRecords.favorites['nodeseek:0']).toBeDefined();
    expect(data.deletedRecords.favorites[`nodeseek:${MAX_DELETED_RECORDS + 1}`]).toEqual(expect.any(String));
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

  it.each([
    {
      label: 'a Yaohuo URL with remote query credentials',
      source: 'yaohuo' as const,
      id: '1',
      suppliedUrl: 'https://yaohuo.me/bbs/book_view.aspx?id=1&classid=177&sid=secret&token=hidden',
      expectedUrl: 'https://www.yaohuo.me/bbs-1.html'
    },
    {
      label: 'a NodeSeek URL with userinfo, token variants and a fragment',
      source: 'nodeseek' as const,
      id: 'unsafe-url',
      suppliedUrl:
        'https://user:pass@www.nodeseek.com/post-723704-1?access_token=secret&auth_token=secret&csrf_token=secret&ok=1#reply',
      expectedUrl: 'https://www.nodeseek.com/post-unsafe-url-1'
    },
    {
      label: 'a relative URL',
      source: 'nodeseek' as const,
      id: 'relative',
      suppliedUrl: '/post-723704-1?session=secret&tab=1',
      expectedUrl: 'https://www.nodeseek.com/post-relative-1'
    },
    {
      label: 'an unsafe URL scheme',
      source: 'nodeseek' as const,
      id: 'unsafe-link',
      suppliedUrl: 'javascript:alert(1)',
      expectedUrl: 'https://www.nodeseek.com/post-unsafe-link-1'
    }
  ])('rebuilds $label from source identity only', ({ expectedUrl, id, source, suppliedUrl }) => {
    const unsafeTopic: Topic = {
      ...topic,
      source,
      id,
      url: suppliedUrl
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
    const parsed = new URL(url);
    expect(url).toBe(expectedUrl);
    expect(parsed.username).toBe('');
    expect(parsed.password).toBe('');
    expect(parsed.hash).toBe('');
    expect([...parsed.searchParams]).toEqual([]);
    expect(url).not.toMatch(/secret|hidden|alert/);
  });

  it('drops unsafe object fields and non-finite numbers while sanitizing topic records', () => {
    const unsafeTopic = {
      ...topic,
      id: 'unsafe-fields',
      author: { name: 'object author' },
      authorId: ['bad'],
      authorAvatar: 42,
      authorLevelLabel: { label: 'Lv6' },
      category: { label: 'bad' },
      replyCount: Number.POSITIVE_INFINITY,
      viewCount: Number.NaN,
      excerpt: { text: 'bad' }
    };

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        'nodeseek:unsafe-fields': {
          topic: unsafeTopic,
          savedAt: '2026-05-20T03:00:00.000Z',
          visitCount: Number.POSITIVE_INFINITY
        }
      }
    });

    const clean = data.favorites['nodeseek:unsafe-fields'];
    expect(clean?.topic.author).toBe('');
    expect(clean?.topic.authorId).toBeUndefined();
    expect(clean?.topic.authorAvatar).toBeUndefined();
    expect(clean?.topic.authorLevelLabel).toBeUndefined();
    expect(clean?.topic.category).toBeUndefined();
    expect(clean?.topic.replyCount).toBe(0);
    expect(clean?.topic.viewCount).toBeUndefined();
    expect(clean?.topic.excerpt).toBeUndefined();
    expect(clean?.visitCount).toBeUndefined();
  });

  it('decodes HTML entities in stored topic titles', () => {
    const encodedTopic: Topic = {
      ...topic,
      id: 'encoded-title',
      title: '&#129765;完辣，ai又来抢饭碗啦，装机仔下岗'
    };

    const data = sanitizeReaderData({
      ...createEmptyReaderData(),
      favorites: {
        [topicKey(encodedTopic)]: {
          topic: encodedTopic,
          savedAt: '2026-05-20T03:00:00.000Z'
        }
      }
    });

    expect(data.favorites[topicKey(encodedTopic)]?.topic.title).toBe('🫥完辣，ai又来抢饭碗啦，装机仔下岗');
  });

  it('rejects records with strings beyond the local backup field limit', () => {
    const unsafeTopic: Topic = {
      ...topic,
      id: 'too-long',
      title: 'x'.repeat(MAX_READER_STRING_LENGTH + 1)
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

    expect(data.favorites[topicKey(unsafeTopic)]).toBeUndefined();
  });

  it('merges reader settings field by field and keeps local values for invalid remote fields', () => {
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      settings: {
        ...createEmptyReaderData().settings,
        theme: 'dark',
        listDensity: 'compact',
        fontScale: 1.1,
        nodeSeekRecoveryThreshold: 1
      }
    });
    const remote = {
      ...createEmptyReaderData(),
      settings: {
        theme: 'blue',
        listDensity: 'wide',
        fontScale: 1.2,
        lineHeight: 'loose',
        nodeSeekRecoveryThreshold: 3
      }
    };

    const merged = mergeReaderData(local, remote);

    expect(merged.settings.theme).toBe('dark');
    expect(merged.settings.listDensity).toBe('compact');
    expect(merged.settings.fontScale).toBe(1.2);
    expect(merged.settings.lineHeight).toBe('loose');
    expect(merged.settings.nodeSeekRecoveryThreshold).toBe(3);
  });

  it('merges a valid remote content source selection into reader settings', () => {
    const local = createEmptyReaderData();
    const remote = {
      ...createEmptyReaderData(),
      settings: {
        contentSources: [
          { source: 'linuxdo', enabled: false },
          { source: 'v2ex', enabled: true }
        ]
      }
    };

    expect(mergeReaderData(local, remote).settings.contentSources).toEqual([
      { source: 'linuxdo', enabled: false },
      { source: 'v2ex', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'yaohuo', enabled: true }
    ]);
  });

  it('keeps local reader settings when remote settings is not an object', () => {
    const local = sanitizeReaderData({
      ...createEmptyReaderData(),
      settings: {
        ...createEmptyReaderData().settings,
        theme: 'dark',
        listDensity: 'compact'
      }
    });
    const remote = {
      ...createEmptyReaderData(),
      settings: null
    };

    const merged = mergeReaderData(local, remote);

    expect(merged.settings).toEqual(local.settings);
  });
});
