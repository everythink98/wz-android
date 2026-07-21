import { QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  createAppQueryClient,
  emptyForumCredentialScope,
  forumQueryKeys
} from './serverState';
import { resetForumSourceQueries } from './sessionControllerHelpers';

describe('forum server state', () => {
  it('deduplicates concurrent reads and keeps the successful value for the same structured key', async () => {
    const client = createAppQueryClient();
    const pending = Promise.withResolvers<string>();
    const queryFn = vi.fn(() => pending.promise);
    const queryKey = forumQueryKeys.topic({
      source: 'nodeseek', topicId: '123', scope: emptyForumCredentialScope
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
    const queryFn = vi.fn(async () => { throw new Error('offline'); });

    await expect(client.fetchQuery({
      queryKey: forumQueryKeys.feed({ source: 'all', scope: emptyForumCredentialScope }),
      queryFn
    })).rejects.toThrow('offline');
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('[REG-LINUXDO-005] separates anonymous and confirmed linux.do search caches', () => {
    const anonymous = forumQueryKeys.search({
      authenticated: false,
      query: 'codex',
      scope: emptyForumCredentialScope,
      sort: 'relevance',
      source: 'linuxdo'
    });
    const authenticated = forumQueryKeys.search({
      authenticated: true,
      query: 'codex',
      scope: emptyForumCredentialScope,
      sort: 'relevance',
      source: 'linuxdo'
    });

    expect(anonymous).not.toEqual(authenticated);
    expect(JSON.stringify(anonymous)).not.toMatch(/_t|cookie|token/i);
    expect(JSON.stringify(authenticated)).not.toMatch(/_t|cookie|token/i);
  });

  it('removes only the changed source and aggregate caches', () => {
    const client = createAppQueryClient();
    const nodeSeekKey = forumQueryKeys.topic({ source: 'nodeseek', topicId: '123', scope: emptyForumCredentialScope });
    const linuxDoKey = forumQueryKeys.topic({ source: 'linuxdo', topicId: '456', scope: emptyForumCredentialScope });
    const aggregateKey = forumQueryKeys.feed({ source: 'all', scope: emptyForumCredentialScope });
    client.setQueryData(nodeSeekKey, 'private NodeSeek topic');
    client.setQueryData(linuxDoKey, 'private linux.do topic');
    client.setQueryData(aggregateKey, 'aggregate containing private NodeSeek data');

    resetForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(nodeSeekKey)).toBeUndefined();
    expect(client.getQueryData(aggregateKey)).toBeUndefined();
    expect(client.getQueryData(linuxDoKey)).toBe('private linux.do topic');
  });

  it('preserves only the exact active structured recovery query key', () => {
    const client = createAppQueryClient();
    const preserved = forumQueryKeys.topic({ source: 'linuxdo', topicId: '123', scope: emptyForumCredentialScope });
    const removed = forumQueryKeys.topic({ source: 'linuxdo', topicId: '456', scope: emptyForumCredentialScope });
    client.setQueryData(preserved, 'preserved');
    client.setQueryData(removed, 'removed');
    const observer = new QueryObserver(client, { queryKey: preserved });
    const unsubscribe = observer.subscribe(() => undefined);

    expect(resetForumSourceQueries('linuxdo', client, preserved)).toBe(true);

    expect(client.getQueryData(preserved)).toBe('preserved');
    expect(client.getQueryData(removed)).toBeUndefined();
    unsubscribe();
  });

  it('does not preserve an inactive recovery query', () => {
    const client = createAppQueryClient();
    const inactive = forumQueryKeys.topic({ source: 'linuxdo', topicId: '123', scope: emptyForumCredentialScope });
    client.setQueryData(inactive, 'inactive');

    expect(resetForumSourceQueries('linuxdo', client, inactive)).toBe(false);
    expect(client.getQueryData(inactive)).toBeUndefined();
  });

  it('does not preserve a stale or different-source recovery key', () => {
    const client = createAppQueryClient();
    const linuxDoKey = forumQueryKeys.topic({ source: 'linuxdo', topicId: '123', scope: emptyForumCredentialScope });
    const nodeSeekKey = forumQueryKeys.topic({ source: 'nodeseek', topicId: '456', scope: emptyForumCredentialScope });
    client.setQueryData(linuxDoKey, 'linux.do');
    client.setQueryData(nodeSeekKey, 'NodeSeek');

    expect(resetForumSourceQueries('linuxdo', client, nodeSeekKey)).toBe(false);

    expect(client.getQueryData(linuxDoKey)).toBeUndefined();
    expect(client.getQueryData(nodeSeekKey)).toBe('NodeSeek');
  });
});
