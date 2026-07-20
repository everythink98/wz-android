import { describe, expect, it, vi } from 'vitest';
import {
  createAppQueryClient,
  forumQueryKeys,
  resetForumSourceQueries,
  subscribeForumSourceResets
} from './serverState';

describe('forum server state', () => {
  it('deduplicates concurrent reads and keeps the successful value for the same key', async () => {
    const client = createAppQueryClient();
    let resolveRead: ((value: string) => void) | undefined;
    const queryFn = vi.fn(() => new Promise<string>((resolve) => {
      resolveRead = resolve;
    }));
    const queryKey = forumQueryKeys.topic('nodeseek', '123');

    const first = client.fetchQuery({ queryKey, queryFn });
    const second = client.fetchQuery({ queryKey, queryFn });
    resolveRead?.('topic');

    await expect(Promise.all([first, second])).resolves.toEqual(['topic', 'topic']);
    await expect(client.fetchQuery({ queryKey, queryFn })).resolves.toBe('topic');
    expect(queryFn).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('does not retry failed reads', async () => {
    const client = createAppQueryClient();
    const queryFn = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(client.fetchQuery({
      queryKey: forumQueryKeys.feed('all', 'default'),
      queryFn
    })).rejects.toThrow('offline');
    expect(queryFn).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('clears the changed source and aggregate data without touching unrelated source caches', () => {
    const client = createAppQueryClient();
    const nodeSeekKey = forumQueryKeys.topic('nodeseek', '123');
    const linuxDoKey = forumQueryKeys.topic('linuxdo', '456');
    const aggregateKey = forumQueryKeys.feedPage('all', 'default', 1);
    client.setQueryData(nodeSeekKey, 'private NodeSeek topic');
    client.setQueryData(linuxDoKey, 'private linux.do topic');
    client.setQueryData(aggregateKey, 'aggregate containing private NodeSeek data');

    resetForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(nodeSeekKey)).toBeUndefined();
    expect(client.getQueryData(aggregateKey)).toBeUndefined();
    expect(client.getQueryData(linuxDoKey)).toBe('private linux.do topic');
    client.clear();
  });

  it('publishes the exact session transition that invalidated presentation state', () => {
    const client = createAppQueryClient();
    const listener = vi.fn();
    const unsubscribe = subscribeForumSourceResets(listener);

    resetForumSourceQueries('nodeseek', client, 'session-updated');

    expect(listener).toHaveBeenCalledWith({
      source: 'nodeseek',
      reason: 'session-updated'
    });
    unsubscribe();
    client.clear();
  });

  it('publishes the exact recovery owner that may resume after a session update', () => {
    const client = createAppQueryClient();
    const listener = vi.fn();
    const unsubscribe = subscribeForumSourceResets(listener);

    resetForumSourceQueries('linuxdo', client, 'session-updated', 'topic:linuxdo:123');

    expect(listener).toHaveBeenCalledWith({
      source: 'linuxdo',
      reason: 'session-updated',
      preserveRecoveryKey: 'topic:linuxdo:123'
    });
    unsubscribe();
    client.clear();
  });
});
