import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { accountQueryKeys, forumWriteReceiptKeys } from '@/platform/query/serverState';
import {
  cancelForumSourceQueries,
  forumSessionEpochsAfterSourceChange,
  removeUnconfirmedForumSourceQueries,
  resetForumSourceQueries
} from './sessionQueryOwnership';

describe('session query ownership', () => {
  it('increments only the changed source epoch', () => {
    expect(
      forumSessionEpochsAfterSourceChange({ ...initialForumSessionEpochs, linuxdo: 2, nodeseek: 3 }, 'linuxdo')
    ).toEqual({
      ...initialForumSessionEpochs,
      linuxdo: 3,
      nodeseek: 3
    });
  });

  it('cancels dirty-source and aggregate reads without evicting their last trusted data', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    });
    const sourceKey = ['forum', 'nodeseek', 'topic', { topicId: '1' }] as const;
    const aggregateKey = ['forum', 'all', 'feed', { page: 1 }] as const;
    const otherKey = ['forum', 'linuxdo', 'topic', { topicId: '2' }] as const;
    const sourceAbort = vi.fn();
    const aggregateAbort = vi.fn();
    const otherAbort = vi.fn();
    const pendingRead =
      (onAbort: () => void) =>
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              onAbort();
              reject(new Error('aborted'));
            },
            { once: true }
          );
        });

    client.setQueryData(sourceKey, 'trusted NodeSeek topic');
    client.setQueryData(aggregateKey, 'trusted aggregate');
    client.setQueryData(otherKey, 'trusted linux.do topic');
    void client.query({ queryKey: sourceKey, queryFn: pendingRead(sourceAbort), staleTime: 0 });
    void client.query({ queryKey: aggregateKey, queryFn: pendingRead(aggregateAbort), staleTime: 0 });
    void client.query({ queryKey: otherKey, queryFn: pendingRead(otherAbort), staleTime: 0 });
    await Promise.resolve();

    await cancelForumSourceQueries('nodeseek', client);

    expect(sourceAbort).toHaveBeenCalledTimes(1);
    expect(aggregateAbort).toHaveBeenCalledTimes(1);
    expect(otherAbort).not.toHaveBeenCalled();
    expect(client.getQueryData(sourceKey)).toBe('trusted NodeSeek topic');
    expect(client.getQueryData(aggregateKey)).toBe('trusted aggregate');
    expect(client.getQueryData(otherKey)).toBe('trusted linux.do topic');
    await client.cancelQueries();
  });
  it('cancels only the disabled source when aggregate ownership has already changed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const sourceKey = ['forum', 'nodeseek', 'feed'] as const;
    const aggregateKey = ['forum', 'all', 'feed'] as const;
    const sourceAbort = vi.fn();
    const aggregateAbort = vi.fn();
    const pendingRead =
      (onAbort: () => void) =>
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            onAbort();
            reject(new Error('aborted'));
          });
        });
    void client.query({ queryKey: sourceKey, queryFn: pendingRead(sourceAbort) }).catch(() => undefined);
    void client.query({ queryKey: aggregateKey, queryFn: pendingRead(aggregateAbort) }).catch(() => undefined);
    await Promise.resolve();

    await cancelForumSourceQueries('nodeseek', client, false);

    expect(sourceAbort).toHaveBeenCalledOnce();
    expect(aggregateAbort).not.toHaveBeenCalled();
    await client.cancelQueries();
  });
  it('removes unconfirmed source data while keeping account, aggregate, and write receipt queries', () => {
    const client = new QueryClient();
    const sourceFeed = ['forum', 'nodeseek', 'feed'] as const;
    const account = accountQueryKeys.snapshot('nodeseek');
    const aggregate = ['forum', 'all', 'feed'] as const;
    const otherSource = ['forum', 'linuxdo', 'feed'] as const;
    const receipt = forumWriteReceiptKeys.nodeSeekPoll({
      identityKey: 'nodeseek:7',
      sessionEpoch: 2,
      pollId: '11',
      kind: 'vote'
    });
    client.setQueryData(sourceFeed, 'untrusted');
    client.setQueryData(account, 'canonical');
    client.setQueryData(aggregate, 'safe');
    client.setQueryData(otherSource, 'other');
    client.setQueryData(receipt, 'awaiting-read');

    removeUnconfirmedForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(sourceFeed)).toBeUndefined();
    expect(client.getQueryData(account)).toBe('canonical');
    expect(client.getQueryData(aggregate)).toBe('safe');
    expect(client.getQueryData(otherSource)).toBe('other');
    expect(client.getQueryData(receipt)).toBe('awaiting-read');
  });

  it('clears receipts only for the source whose session was reset', () => {
    const client = new QueryClient();
    const nodeSeekReceipt = forumWriteReceiptKeys.nodeSeekPoll({
      identityKey: 'nodeseek:7',
      sessionEpoch: 2,
      pollId: '11',
      kind: 'lock'
    });
    const linuxDoReceipt = forumWriteReceiptKeys.discoursePolicy({ identityKey: 'linuxdo:8', sessionEpoch: 3 });
    client.setQueryData(nodeSeekReceipt, 'awaiting-read');
    client.setQueryData(linuxDoReceipt, 'awaiting-readback');

    resetForumSourceQueries('nodeseek', client);

    expect(client.getQueryData(nodeSeekReceipt)).toBeUndefined();
    expect(client.getQueryData(linuxDoReceipt)).toBe('awaiting-readback');

    resetForumSourceQueries('linuxdo', client);

    expect(client.getQueryData(linuxDoReceipt)).toBeUndefined();
  });
});
