import { QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppQueryClient, forumQueryKeys } from './serverState';
import { initialForumSessionEpochs } from './sessionEpochs';
import {
  commitChangedAccountStatusQuery,
  commitExpiredAccountStatusQuery,
  resetForumSourceQueries
} from '@/app/sessionControllerHelpers';

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

  it('[REG-LINUXDO-005] separates anonymous and confirmed linux.do search caches', () => {
    const anonymous = forumQueryKeys.search({
      authenticated: false,
      query: 'codex',
      scope: initialForumSessionEpochs,
      sort: 'relevance',
      source: 'linuxdo'
    });
    const authenticated = forumQueryKeys.search({
      authenticated: true,
      query: 'codex',
      scope: initialForumSessionEpochs,
      sort: 'relevance',
      source: 'linuxdo'
    });

    expect(anonymous).not.toEqual(authenticated);
    expect(JSON.stringify(anonymous)).not.toMatch(/_t|cookie|token/i);
    expect(JSON.stringify(authenticated)).not.toMatch(/_t|cookie|token/i);
  });

  it('[REG-ACCOUNT-031] keeps an aggregate refresh with a pending identity out of the trusted aggregate cache', () => {
    const trustedFeed = forumQueryKeys.feed({
      source: 'all',
      scope: initialForumSessionEpochs
    });
    const pendingFeed = forumQueryKeys.feed({
      identityBarriers: ['nodeseek'],
      source: 'all',
      scope: initialForumSessionEpochs
    });
    const trustedCategories = forumQueryKeys.categories('all', initialForumSessionEpochs);
    const pendingCategories = forumQueryKeys.categories('all', initialForumSessionEpochs, ['nodeseek']);

    expect(pendingFeed).not.toEqual(trustedFeed);
    expect(pendingCategories).not.toEqual(trustedCategories);
    expect(JSON.stringify(pendingFeed)).toContain('nodeseek');
  });

  it('[REG-ACCOUNT-031] ignores identity barriers on single-source keys', () => {
    expect(
      forumQueryKeys.feed({
        identityBarriers: ['nodeseek'],
        source: 'linuxdo',
        scope: initialForumSessionEpochs
      })
    ).toEqual(
      forumQueryKeys.feed({
        source: 'linuxdo',
        scope: initialForumSessionEpochs
      })
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

  it('[REG-ACCOUNT-019] resets only the changed site active account projection', () => {
    const sources = ['nodeseek', 'linuxdo', 'yaohuo', 'xiaoyinsi'] as const;
    for (const changedSource of sources) {
      const client = createAppQueryClient();
      const observers = sources.map((source) => {
        const queryKey = forumQueryKeys.accountStatus({
          sessionEpochs: initialForumSessionEpochs,
          source
        });
        client.setQueryData(queryKey, `${source} logged-in`);
        const observer = new QueryObserver(client, { enabled: false, queryKey });
        const unsubscribe = observer.subscribe(() => undefined);
        return { observer, source, unsubscribe };
      });
      resetForumSourceQueries(changedSource, client);

      for (const { observer, source } of observers) {
        if (source === changedSource) {
          expect(observer.getCurrentResult()).toMatchObject({
            data: undefined,
            status: 'pending'
          });
        } else {
          expect(observer.getCurrentResult().data).toBe(`${source} logged-in`);
        }
      }
      observers.forEach(({ unsubscribe }) => unsubscribe());
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

  it('[REG-ACCOUNT-019] migrates only a committed expired Account result to the next credential scope', async () => {
    const client = createAppQueryClient();
    const accountKey = forumQueryKeys.accountStatus({
      sessionEpochs: initialForumSessionEpochs,
      source: 'nodeseek'
    });
    const feedKey = forumQueryKeys.feed({ source: 'nodeseek', scope: initialForumSessionEpochs });
    client.setQueryData(feedKey, 'private feed');
    const observer = new QueryObserver(client, {
      enabled: false,
      queryKey: accountKey,
      queryFn: async () => ({
        failed: true,
        session: { site: 'nodeseek', status: 'expired' }
      })
    });
    const unsubscribe = observer.subscribe(() => undefined);

    const result = await observer.refetch();
    const nextScope = commitExpiredAccountStatusQuery('nodeseek', initialForumSessionEpochs, accountKey, client);
    const nextAccountKey = forumQueryKeys.accountStatus({
      sessionEpochs: nextScope,
      source: 'nodeseek'
    });
    observer.setOptions({ enabled: false, queryKey: nextAccountKey });

    expect(result.data).toMatchObject({ session: { status: 'expired' } });
    expect(observer.getCurrentResult().data).toMatchObject({ session: { status: 'expired' } });
    expect(client.getQueryData(feedKey)).toBeUndefined();
    unsubscribe();
  });

  it('[REG-ACCOUNT-031] commits a changed identity only under the next source epoch', () => {
    const client = createAppQueryClient();
    const oldAccountKey = forumQueryKeys.accountStatus({
      sessionEpochs: initialForumSessionEpochs,
      source: 'nodeseek'
    });
    const probeKey = forumQueryKeys.accountStatusProbe({
      sessionEpochs: initialForumSessionEpochs,
      generation: 3,
      source: 'nodeseek'
    });
    const oldFeedKey = forumQueryKeys.feed({
      source: 'nodeseek',
      scope: initialForumSessionEpochs
    });
    const otherFeedKey = forumQueryKeys.feed({
      source: 'linuxdo',
      scope: initialForumSessionEpochs
    });
    const nextAccount = {
      session: {
        site: 'nodeseek' as const,
        status: 'logged-in' as const,
        cookieSummary: ['session'],
        isVerifying: false,
        currentUser: {
          source: 'nodeseek' as const,
          id: '18',
          username: 'charlie',
          url: 'https://www.nodeseek.com/space/18',
          topics: []
        }
      }
    };
    client.setQueryData(oldAccountKey, {
      session: {
        ...nextAccount.session,
        currentUser: { ...nextAccount.session.currentUser, id: '17', username: 'bob' }
      }
    });
    client.setQueryData(probeKey, nextAccount);
    client.setQueryData(oldFeedKey, 'private account A feed');
    client.setQueryData(otherFeedKey, 'unrelated feed');

    const nextScope = commitChangedAccountStatusQuery('nodeseek', initialForumSessionEpochs, probeKey, client);
    const nextAccountKey = forumQueryKeys.accountStatus({
      sessionEpochs: nextScope,
      source: 'nodeseek'
    });

    expect(nextScope.nodeseek).toBe(1);
    expect(client.getQueryData(oldAccountKey)).toBeUndefined();
    expect(client.getQueryData(oldFeedKey)).toBeUndefined();
    expect(client.getQueryData(otherFeedKey)).toBe('unrelated feed');
    expect(client.getQueryData(nextAccountKey)).toEqual(nextAccount);
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
