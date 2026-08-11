import { QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { accountQueryKeys, createAppQueryClient, forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { canonicalEnabledSourcesKey } from '@/domain/reader/contentSourcePreferences';
import { forumSessionEpochsAfterSourceChange, resetForumSourceQueries } from '@/features/account/sessionQueryOwnership';

describe('forum server state', () => {
  it('deduplicates concurrent reads and keeps the successful value for the same structured key', async () => {
    const client = createAppQueryClient();
    const pending = Promise.withResolvers<string>();
    const queryFn = vi.fn(() => pending.promise);
    const queryKey = forumQueryKeys.topic({
      source: 'nodeseek',
      topicId: '123',
      scope: initialForumSessionEpochs
    });

    const first = client.fetchQuery({ queryKey, queryFn });
    const second = client.fetchQuery({ queryKey, queryFn });
    pending.resolve('topic');

    await expect(Promise.all([first, second])).resolves.toEqual(['topic', 'topic']);
    await expect(client.fetchQuery({ queryKey, queryFn })).resolves.toBe('topic');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('does not retry failed reads', async () => {
    const client = createAppQueryClient();
    const queryFn = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(
      client.fetchQuery({
        queryKey: forumQueryKeys.feed({ source: 'all', scope: initialForumSessionEpochs }),
        queryFn
      })
    ).rejects.toThrow('offline');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('[REG-XIAOYINSI-015] scopes feed caches by source, category, and filter', () => {
    const latest = forumQueryKeys.feed({
      feedFilter: 'latest',
      scope: initialForumSessionEpochs,
      source: 'xiaoyinsi'
    });

    expect(latest).not.toEqual(
      forumQueryKeys.feed({ feedFilter: 'hot', scope: initialForumSessionEpochs, source: 'xiaoyinsi' })
    );
    expect(latest).not.toEqual(
      forumQueryKeys.feed({
        category: '开发',
        feedFilter: 'latest',
        scope: initialForumSessionEpochs,
        source: 'xiaoyinsi'
      })
    );
    expect(latest).not.toEqual(
      forumQueryKeys.feed({ feedFilter: 'latest', scope: initialForumSessionEpochs, source: 'linuxdo' })
    );
  });

  it('[REG-TOPIC-067] never shares partial reply caches between traversal orders', () => {
    const topicKey = forumQueryKeys.topic({
      source: 'nodeseek',
      topicId: '123',
      scope: initialForumSessionEpochs
    });

    expect(forumQueryKeys.replies(topicKey, 'oldest')).not.toEqual(forumQueryKeys.replies(topicKey, 'newest'));
    expect(forumQueryKeys.replies(topicKey, 'newest')).toEqual([...topicKey, 'replies', { order: 'newest' }]);
  });

  it('[REG-TOPIC-039] separates username resolution from the canonical user profile key', () => {
    const resolution = forumQueryKeys.userResolution({
      scope: initialForumSessionEpochs,
      username: 'lcy0828'
    });
    const profile = forumQueryKeys.user({
      scope: initialForumSessionEpochs,
      source: 'nodeseek',
      userId: '23042'
    });

    expect(resolution).toEqual(['forum', 'nodeseek', 'user-resolution', { sessionEpoch: 0, username: 'lcy0828' }]);
    expect(profile).toEqual(['forum', 'nodeseek', 'user', { sessionEpoch: 0, userId: '23042' }]);
  });

  it('[REG-SOURCE-011] isolates public and authenticated direct and aggregate read caches', () => {
    const topic = (readPlanScope: string) =>
      forumQueryKeys.topic({
        readPlanScope,
        source: 'xiaoyinsi',
        topicId: '42',
        scope: initialForumSessionEpochs
      });
    const reply = (readPlanScope: string) =>
      forumQueryKeys.reply({
        postNumber: 7,
        readPlanScope,
        source: 'linuxdo',
        topicId: '42',
        scope: initialForumSessionEpochs
      });
    const user = (readPlanScope: string) =>
      forumQueryKeys.user({
        readPlanScope,
        source: 'xiaoyinsi',
        userId: '7',
        scope: initialForumSessionEpochs
      });
    const resolution = (readPlanScope: string) =>
      forumQueryKeys.userResolution({ readPlanScope, scope: initialForumSessionEpochs, username: 'alice' });
    const search = (readPlanScope: string) =>
      forumQueryKeys.search({
        query: 'codex',
        readPlanScope,
        scope: initialForumSessionEpochs,
        sort: 'relevance',
        source: 'nodeseek'
      });
    const feed = (readPlanScope: string) =>
      forumQueryKeys.feed({ readPlanScope, scope: initialForumSessionEpochs, source: 'all' });
    const categories = (readPlanScope: string) =>
      forumQueryKeys.categories('all', initialForumSessionEpochs, undefined, readPlanScope);

    for (const key of [topic, reply, user, resolution, search, feed, categories]) {
      expect(key('public:omit')).not.toEqual(key('authenticated:4'));
      expect(JSON.stringify(key('public:omit'))).not.toMatch(/cookie|token/i);
    }
    expect(forumQueryKeys.replies(topic('public:omit'), 'oldest')).not.toEqual(
      forumQueryKeys.replies(topic('authenticated:4'), 'oldest')
    );
    expect(forumQueryKeys.replies(topic('public:omit'), 'oldest', 'public:omit')).not.toEqual(
      forumQueryKeys.replies(topic('public:omit'), 'oldest', 'authenticated:4')
    );
  });

  it('[REG-SOURCE-010] scopes all feed and categories keys by canonical enabled sources without changing single-source keys', () => {
    const v2exAndNodeSeek = canonicalEnabledSourcesKey([
      { source: 'v2ex', enabled: true },
      { source: 'nodeseek', enabled: true },
      { source: 'linuxdo', enabled: false }
    ]);
    const sameSetDifferentOrder = canonicalEnabledSourcesKey([
      { source: 'nodeseek', enabled: true },
      { source: 'linuxdo', enabled: false },
      { source: 'v2ex', enabled: true }
    ]);
    const v2exOnly = canonicalEnabledSourcesKey([
      { source: 'v2ex', enabled: true },
      { source: 'nodeseek', enabled: false }
    ]);
    const feed = (enabledSourcesKey: string) =>
      forumQueryKeys.feed({ enabledSourcesKey, scope: initialForumSessionEpochs, source: 'all' });
    const categories = (enabledSourcesKey: string) =>
      forumQueryKeys.categories('all', initialForumSessionEpochs, enabledSourcesKey);

    expect(feed(v2exAndNodeSeek)).toEqual(feed(sameSetDifferentOrder));
    expect(categories(v2exAndNodeSeek)).toEqual(categories(sameSetDifferentOrder));
    expect(feed(v2exAndNodeSeek)).not.toEqual(feed(v2exOnly));
    expect(categories(v2exAndNodeSeek)).not.toEqual(categories(v2exOnly));
    expect(
      forumQueryKeys.feed({ enabledSourcesKey: v2exAndNodeSeek, scope: initialForumSessionEpochs, source: 'v2ex' })
    ).toEqual(forumQueryKeys.feed({ enabledSourcesKey: v2exOnly, scope: initialForumSessionEpochs, source: 'v2ex' }));
    expect(forumQueryKeys.categories('v2ex', initialForumSessionEpochs, v2exAndNodeSeek)).toEqual(
      forumQueryKeys.categories('v2ex', initialForumSessionEpochs, v2exOnly)
    );
  });

  it('removes only the changed source and aggregate caches', () => {
    const client = createAppQueryClient();
    const nodeSeekKey = forumQueryKeys.topic({ source: 'nodeseek', topicId: '123', scope: initialForumSessionEpochs });
    const linuxDoKey = forumQueryKeys.topic({ source: 'linuxdo', topicId: '456', scope: initialForumSessionEpochs });
    const aggregateKey = forumQueryKeys.feed({ source: 'all', scope: initialForumSessionEpochs });
    client.setQueryData(nodeSeekKey, 'private NodeSeek topic');
    client.setQueryData(linuxDoKey, 'private linux.do topic');
    client.setQueryData(aggregateKey, 'aggregate containing private NodeSeek data');

    resetForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(nodeSeekKey)).toBeUndefined();
    expect(client.getQueryData(aggregateKey)).toBeUndefined();
    expect(client.getQueryData(linuxDoKey)).toBe('private linux.do topic');
  });

  it('[REG-ACCOUNT-019] never resets stable account snapshots with forum content', () => {
    const sources = ['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi'] as const;
    for (const changedSource of sources) {
      const client = createAppQueryClient();
      const snapshots = sources.map((source) => {
        const queryKey = accountQueryKeys.snapshot(source);
        client.setQueryData(queryKey, `${source} logged-in`);
        return { queryKey, source };
      });
      resetForumSourceQueries(changedSource, client);

      for (const { queryKey, source } of snapshots) {
        expect(client.getQueryData(queryKey)).toBe(`${source} logged-in`);
      }
    }
  });

  it('preserves only the exact active structured recovery query key', () => {
    const client = createAppQueryClient();
    const preserved = forumQueryKeys.topic({ source: 'linuxdo', topicId: '123', scope: initialForumSessionEpochs });
    const removed = forumQueryKeys.topic({ source: 'linuxdo', topicId: '456', scope: initialForumSessionEpochs });
    client.setQueryData(preserved, 'preserved');
    client.setQueryData(removed, 'removed');
    const observer = new QueryObserver(client, { queryKey: preserved });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(resetForumSourceQueries('linuxdo', client, preserved)).toBe(true);

    expect(client.getQueryData(preserved)).toBe('preserved');
    expect(client.getQueryData(removed)).toBeUndefined();
    unsubscribe();
  });

  it('[REG-ACCOUNT-042] keeps the committed Account snapshot while advancing the forum scope', () => {
    const client = createAppQueryClient();
    const accountKey = accountQueryKeys.snapshot('nodeseek');
    const feedKey = forumQueryKeys.feed({ source: 'nodeseek', scope: initialForumSessionEpochs });
    const snapshot = {
      site: 'nodeseek',
      status: 'logged-in',
      cookieSummary: ['session'],
      isVerifying: false,
      identityTrust: 'confirmed'
    };
    client.setQueryData(accountKey, snapshot);
    client.setQueryData(feedKey, 'private feed');

    resetForumSourceQueries('nodeseek', client);
    const nextScope = forumSessionEpochsAfterSourceChange(initialForumSessionEpochs, 'nodeseek');

    expect(nextScope.nodeseek).toBe(1);
    expect(client.getQueryData(accountKey)).toEqual(snapshot);
    expect(client.getQueryData(feedKey)).toBeUndefined();
  });

  it('[REG-ACCOUNT-031] clears changed-identity content without changing the Account key', () => {
    const client = createAppQueryClient();
    const accountKey = accountQueryKeys.snapshot('nodeseek');
    const oldFeedKey = forumQueryKeys.feed({
      source: 'nodeseek',
      scope: initialForumSessionEpochs
    });
    const otherFeedKey = forumQueryKeys.feed({
      source: 'linuxdo',
      scope: initialForumSessionEpochs
    });
    const nextAccount = {
      site: 'nodeseek' as const,
      status: 'logged-in' as const,
      cookieSummary: ['session'],
      isVerifying: false,
      identityTrust: 'confirmed' as const,
      currentUser: {
        source: 'nodeseek' as const,
        id: '18',
        username: 'charlie',
        url: 'https://www.nodeseek.com/space/18',
        topics: []
      }
    };
    client.setQueryData(accountKey, nextAccount);
    client.setQueryData(oldFeedKey, 'private account A feed');
    client.setQueryData(otherFeedKey, 'unrelated feed');

    resetForumSourceQueries('nodeseek', client);
    const nextScope = forumSessionEpochsAfterSourceChange(initialForumSessionEpochs, 'nodeseek');

    expect(nextScope.nodeseek).toBe(1);
    expect(client.getQueryData(oldFeedKey)).toBeUndefined();
    expect(client.getQueryData(otherFeedKey)).toBe('unrelated feed');
    expect(client.getQueryData(accountKey)).toEqual(nextAccount);
  });

  it('does not preserve an inactive recovery query', () => {
    const client = createAppQueryClient();
    const inactive = forumQueryKeys.topic({ source: 'linuxdo', topicId: '123', scope: initialForumSessionEpochs });
    client.setQueryData(inactive, 'inactive');

    expect(resetForumSourceQueries('linuxdo', client, inactive)).toBe(false);
    expect(client.getQueryData(inactive)).toBeUndefined();
  });

  it('does not preserve a stale or different-source recovery key', () => {
    const client = createAppQueryClient();
    const linuxDoKey = forumQueryKeys.topic({ source: 'linuxdo', topicId: '123', scope: initialForumSessionEpochs });
    const nodeSeekKey = forumQueryKeys.topic({ source: 'nodeseek', topicId: '456', scope: initialForumSessionEpochs });
    client.setQueryData(linuxDoKey, 'linux.do');
    client.setQueryData(nodeSeekKey, 'NodeSeek');

    expect(resetForumSourceQueries('linuxdo', client, nodeSeekKey)).toBe(false);

    expect(client.getQueryData(linuxDoKey)).toBeUndefined();
    expect(client.getQueryData(nodeSeekKey)).toBe('NodeSeek');
  });
});
