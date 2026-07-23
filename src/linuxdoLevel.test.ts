import { beforeEach, describe, expect, it, vi } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  buildLinuxDoLevelProfileFromSummary,
  getLinuxDoLevelProfile
} from './linuxdoLevel';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => store.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key);
      }),
      __store: store
    }
  };
});

const asyncStorage = AsyncStorage as typeof AsyncStorage & { __store: Map<string, string> };

describe('linux.do level profile', () => {
  beforeEach(() => {
    asyncStorage.__store.clear();
    vi.clearAllMocks();
  });

  it('REG-ACCOUNT-009 cancels a level read before fallback or snapshot persistence when credentials change', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      return new Response(JSON.stringify({ username: 'old-user', trust_level: 1 }), {
        headers: { 'content-type': 'application/json' }
      });
    });

    await expect(getLinuxDoLevelProfile({
      fetcher,
      signal: controller.signal
    })).rejects.toThrow('请求已取消');

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('calculates level 1 progress from summary statistics', () => {
    const profile = buildLinuxDoLevelProfileFromSummary({
      username: 'alice',
      trust_level: 1,
      days_visited: 14,
      likes_given: 1,
      likes_received: 0,
      post_count: 3,
      topics_entered: 20,
      posts_read_count: 99,
      time_read: 3600
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 1,
      targetLevel: 2,
      source: 'summary',
      estimate: true,
      achievedCount: 4,
      totalCount: 7
    });
    expect(profile.requirements.map((item) => [item.key, item.current, item.required, item.met])).toEqual([
      ['days_visited', 14, 15, false],
      ['likes_given', 1, 1, true],
      ['likes_received', 0, 1, false],
      ['post_count', 3, 3, true],
      ['topics_entered', 20, 20, true],
      ['posts_read_count', 99, 100, false],
      ['time_read', 3600, 3600, true]
    ]);
  });

  it('keeps official level 0 even when the level 0 requirements are complete', () => {
    const profile = buildLinuxDoLevelProfileFromSummary({
      username: 'alice',
      trust_level: 0,
      topics_entered: 5,
      posts_read_count: 30,
      time_read: 600
    });

    expect(profile).toMatchObject({
      currentLevel: 0,
      targetLevel: 1,
      achievedCount: 3,
      totalCount: 3
    });
    expect(profile.requirements.map((item) => item.key)).toEqual([
      'topics_entered',
      'posts_read_count',
      'time_read'
    ]);
  });

  it('infers level 1 only when the official payload omits the trust level', () => {
    const profile = buildLinuxDoLevelProfileFromSummary({
      username: 'alice',
      topics_entered: 5,
      posts_read_count: 30,
      time_read: 600
    });

    expect(profile).toMatchObject({
      currentLevel: 1,
      targetLevel: 2,
      achievedCount: 0,
      totalCount: 7
    });
    expect(profile.requirements.map((item) => item.key)).toEqual([
      'days_visited',
      'likes_given',
      'likes_received',
      'post_count',
      'topics_entered',
      'posts_read_count',
      'time_read'
    ]);
  });

  it('keeps level 2 progress as an estimate and uses the broader reference targets', () => {
    const profile = buildLinuxDoLevelProfileFromSummary({
      username: 'alice',
      trust_level: 2,
      days_visited: 40,
      likes_given: 30,
      likes_received: 20,
      post_count: 11,
      topics_entered: 800,
      posts_read_count: 2000,
      time_read: 12000
    });

    expect(profile).toMatchObject({
      currentLevel: 2,
      targetLevel: 3,
      estimate: true,
      note: expect.stringContaining('参考')
    });
    expect(profile.requirements.some((item) => item.key === 'days_visited' && item.required === 50)).toBe(true);
    expect(profile.requirements.some((item) => item.key === 'topics_entered' && item.required === 500)).toBe(true);
  });

  it('uses official connect progress for level 2 and above when available', async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      requests.push(input);
      if (input === 'https://linux.do/my/summary.json') {
        return new Response(JSON.stringify({
          user_summary: {
            user: { username: 'alice', trust_level: 2 },
            days_visited: 40,
            likes_given: 10,
            likes_received: 8,
            post_count: 5,
            topics_entered: 300,
            posts_read_count: 1000,
            time_read: 12000
          }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://connect.linux.do/') {
        return new Response(`
          <div class="card">
            <h2 class="card-title">信任等级 3</h2>
            <span class="badge badge-warning">未达成</span>
            <div class="card-subtitle">最近 100 天</div>
            <div class="tl3-ring">
              <div class="tl3-ring-circle met" style="--val: 50; --max: 50"></div>
              <div class="tl3-ring-label">访问天数</div>
            </div>
            <div class="tl3-ring">
              <div class="tl3-ring-circle" style="--val: 400; --max: 500"></div>
              <div class="tl3-ring-label">浏览话题</div>
            </div>
            <div class="tl3-bar-item">
              <div class="tl3-bar-label">已读帖子</div>
              <div class="tl3-bar-nums">1,500 / 20,000</div>
              <div class="tl3-bar-fill" style="--val: 1500; --max: 20000"></div>
            </div>
            <div class="tl3-veto-item unmet">
              <div class="tl3-veto-back">
                <div class="tl3-veto-label">被禁言</div>
                <div class="tl3-veto-value">1</div>
              </div>
            </div>
            <div class="status-unmet">还未达到 TL3</div>
          </div>
        `, {
          headers: { 'content-type': 'text/html' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getLinuxDoLevelProfile({
      fetcher
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 2,
      targetLevel: 3,
      source: 'connect',
      estimate: false,
      note: expect.stringContaining('官方')
    });
    expect(profile.requirements.map((item) => [item.label, item.current, item.required, item.met])).toEqual([
      ['访问天数', 50, 50, true],
      ['浏览话题', 400, 500, false],
      ['已读帖子', 1500, 20000, false],
      ['被禁言', 1, 0, false]
    ]);
    expect(requests).toEqual([
      'https://linux.do/my/summary.json',
      'https://connect.linux.do/'
    ]);
  });

  it('falls back to the summary estimate when official connect progress is unavailable', async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      requests.push(input);
      if (input === 'https://linux.do/my/summary.json') {
        return new Response(JSON.stringify({
          user_summary: {
            user: { username: 'alice', trust_level: 2 },
            days_visited: 40,
            likes_given: 30,
            likes_received: 20,
            post_count: 11,
            topics_entered: 800,
            posts_read_count: 2000,
            time_read: 12000
          }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://connect.linux.do/') {
        return new Response('<html>login required</html>', {
          status: 403,
          headers: { 'content-type': 'text/html' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getLinuxDoLevelProfile({
      fetcher
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 2,
      targetLevel: 3,
      source: 'summary',
      estimate: true,
      note: expect.stringContaining('参考')
    });
    expect(profile.requirements.some((item) => item.key === 'days_visited' && item.required === 50)).toBe(true);
    expect(requests).toEqual([
      'https://linux.do/my/summary.json',
      'https://connect.linux.do/'
    ]);
  });

  it('reads current account summary and records the previous snapshot delta', async () => {
    asyncStorage.__store.set('linuxdo-level-snapshot:alice', JSON.stringify({
      username: 'alice',
      values: {
        days_visited: 13,
        posts_read_count: 80,
        time_read: 3467
      }
    }));
    const fetcher = vi.fn(async (input: string) => {
      expect(input).toBe('https://linux.do/my/summary.json');
      return new Response(JSON.stringify({
        user_summary: {
          user: { username: 'alice', trust_level: 1 },
          days_visited: 15,
          likes_given: 1,
          likes_received: 1,
          post_count: 3,
          topics_entered: 20,
          posts_read_count: 100,
          time_read: 3600
        }
      }), {
        headers: { 'content-type': 'application/json' }
      });
    });

    const profile = await getLinuxDoLevelProfile({
      userAgent: 'Mozilla/5.0',
      fetcher
    });

    expect(profile.username).toBe('alice');
    expect(profile.requirements.find((item) => item.key === 'days_visited')?.change).toBe(2);
    expect(profile.requirements.find((item) => item.key === 'posts_read_count')?.change).toBe(20);
    expect(profile.requirements.find((item) => item.key === 'time_read')?.displayChange).toBe('较上次 +2分');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'linuxdo-level-snapshot:alice',
      expect.stringContaining('"posts_read_count":100')
    );
  });

  it('falls back to the current username summary when my summary is not JSON', async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      requests.push(input);
      if (input === 'https://linux.do/my/summary.json') {
        return new Response('<html>not json</html>', {
          headers: { 'content-type': 'text/html' }
        });
      }
      if (input === 'https://linux.do/session/current.json') {
        return new Response(JSON.stringify({
          current_user: { username: 'alice' }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://linux.do/u/alice/summary.json') {
        return new Response(JSON.stringify({
          user_summary: {
            user: { username: 'alice', trust_level: 1 },
            days_visited: 15,
            likes_given: 1,
            likes_received: 1,
            post_count: 3,
            topics_entered: 20,
            posts_read_count: 100,
            time_read: 3600
          }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getLinuxDoLevelProfile({
      fetcher
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 1,
      achievedCount: 7
    });
    expect(requests).toEqual([
      'https://linux.do/my/summary.json',
      'https://linux.do/session/current.json',
      'https://linux.do/u/alice/summary.json'
    ]);
  });

  it('reports Cloudflare verification instead of a malformed level payload', async () => {
    const fetcher = vi.fn(async () => new Response('<html><div class="cf-turnstile"></div></html>', {
      status: 403,
      headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }
    }));

    const error = await getLinuxDoLevelProfile({
      fetcher
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      message: 'linux.do 需要完成 Cloudflare 验证',
      source: 'linuxdo',
      reason: 'cloudflare'
    });
  });

  it('uses the current session trust level when my summary omits it', async () => {
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      requests.push(input);
      if (input === 'https://linux.do/my/summary.json') {
        return new Response(JSON.stringify({
          user_summary: {
            user: { username: 'alice' },
            days_visited: 1,
            likes_given: 0,
            likes_received: 0,
            post_count: 0,
            topics_entered: 1,
            posts_read_count: 1,
            time_read: 60
          }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://linux.do/session/current.json') {
        return new Response(JSON.stringify({
          current_user: { username: 'alice', trust_level: 1 }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getLinuxDoLevelProfile({
      fetcher
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 1,
      targetLevel: 2
    });
    expect(profile.requirements.map((item) => item.key)).toEqual([
      'days_visited',
      'likes_given',
      'likes_received',
      'post_count',
      'topics_entered',
      'posts_read_count',
      'time_read'
    ]);
    expect(requests).toEqual([
      'https://linux.do/my/summary.json',
      'https://linux.do/session/current.json'
    ]);
  });

  it('uses the current session username when my summary omits it', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://linux.do/my/summary.json') {
        return new Response(JSON.stringify({
          user_summary: {
            trust_level: 1,
            days_visited: 3,
            likes_given: 0,
            likes_received: 0,
            post_count: 0,
            topics_entered: 6,
            posts_read_count: 40,
            time_read: 800
          }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://linux.do/session/current.json') {
        return new Response(JSON.stringify({
          current_user: { username: 'alice', trust_level: 1 }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getLinuxDoLevelProfile({
      fetcher
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 1,
      targetLevel: 2
    });
  });

  it('keeps the current session trust level when the fallback summary does not include it', async () => {
    const fetcher = vi.fn(async (input: string) => {
      if (input === 'https://linux.do/my/summary.json') {
        return new Response('<html>not json</html>', {
          headers: { 'content-type': 'text/html' }
        });
      }
      if (input === 'https://linux.do/session/current.json') {
        return new Response(JSON.stringify({
          current_user: { username: 'alice', trust_level: 1 }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      if (input === 'https://linux.do/u/alice/summary.json') {
        return new Response(JSON.stringify({
          user_summary: {
            username: 'alice',
            topics_entered: 5,
            posts_read_count: 30,
            time_read: 600
          }
        }), {
          headers: { 'content-type': 'application/json' }
        });
      }
      throw new Error(`unexpected ${input}`);
    });

    const profile = await getLinuxDoLevelProfile({
      fetcher
    });

    expect(profile).toMatchObject({
      username: 'alice',
      currentLevel: 1,
      targetLevel: 2
    });
    expect(profile.requirements.map((item) => item.key)).toEqual([
      'days_visited',
      'likes_given',
      'likes_received',
      'post_count',
      'topics_entered',
      'posts_read_count',
      'time_read'
    ]);
  });
});
