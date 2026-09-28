import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeSeekPendingPollToken, normalizePendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import { prepareRequestToSend, withRequestBeforeSend } from '@/platform/network/request';
import { runNodeSeekAction } from './actionClient';
import { buildNodeSeekPollCreateRequest } from './actionRequest';
import { materializePendingNodeSeekPolls, type PendingNodeSeekPollCreation } from './pendingPolls';

const journal = vi.hoisted(() => new Map<string, { localId: string; fingerprint: string; remoteId: string | null }>());
vi.mock('@/platform/persistence/nodeSeekPollJournal', () => {
  type Entry = { localId: string; fingerprint: string; remoteId: string | null };
  const key = (account: string, entry: { localId: string; fingerprint: string }) =>
    `${account}/${entry.localId}/${entry.fingerprint}`;
  return {
    readNodeSeekPollJournalEntry: async (account: string, localId: string, fingerprint?: string) =>
      fingerprint
        ? (journal.get(key(account, { localId, fingerprint })) ?? null)
        : ([...journal].find(
            ([entryKey, entry]) => entryKey.startsWith(`${account}/`) && entry.localId === localId
          )?.[1] ?? null),
    claimNodeSeekPollJournalEntry: async (account: string, intent: Omit<Entry, 'remoteId'>) => {
      const previous = journal.get(key(account, intent));
      if (previous) return { claimed: false, entry: previous };
      const entry = { ...intent, remoteId: null };
      journal.set(key(account, intent), entry);
      return { claimed: true, entry };
    },
    saveNodeSeekPollJournalEntry: async (account: string, entry: Entry) => {
      journal.set(key(account, entry), entry);
    },
    releaseNodeSeekPollJournalEntry: async (account: string, entry: Entry) => {
      journal.delete(key(account, entry));
    }
  };
});

const poll = normalizePendingNodeSeekPoll({
  localId: 'poll_one_123',
  title: '投票',
  options: ['A', 'B'],
  multiple: false,
  isPublic: false
});
const context = () => ({
  content: nodeSeekPendingPollToken(poll.localId),
  polls: [poll],
  identityKey: 'nodeseek:42',
  assertCurrent: vi.fn(),
  confirmReplacement: vi.fn(async () => true),
  notify: vi.fn()
});
beforeEach(() => journal.clear());

describe('shared pending NodeSeek poll preparation', () => {
  it.each(
    [408, 409].flatMap((status) => [
      { status, body: 'upstream timeout or conflict' },
      { status, body: JSON.stringify({ message: 'upstream timeout error' }) }
    ])
  )(
    'retains the poll reservation after an ambiguous HTTP $status ($body) and blocks a second creation',
    async ({ status, body }) => {
      const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
        prepareRequestToSend(init);
        return new Response(body, { status });
      });
      const createPoll = async (_poll: typeof poll, lifecycle: PendingNodeSeekPollCreation) =>
        runNodeSeekAction({
          request: buildNodeSeekPollCreateRequest({ poll }),
          fetcher: withRequestBeforeSend(fetcher, () => {}, lifecycle.dispatchState)
        });
      await expect(materializePendingNodeSeekPolls({ ...context(), createPoll })).rejects.toMatchObject({ status });
      expect(journal.size).toBe(1);
      await expect(materializePendingNodeSeekPolls({ ...context(), createPoll })).rejects.toThrow('上次创建结果未知');
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each([408, 409])(
    'allows explicit retry after an HTTP %s business refusal confirms no poll was created',
    async (status) => {
      let requests = 0;
      const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
        prepareRequestToSend(init);
        requests++;
        return new Response(
          JSON.stringify(requests === 1 ? { success: false, error: '投票选项无效' } : { success: true, id: 93 }),
          { status: requests === 1 ? status : 200 }
        );
      });
      const createPoll = async (_poll: typeof poll, lifecycle: PendingNodeSeekPollCreation) =>
        runNodeSeekAction({
          request: buildNodeSeekPollCreateRequest({ poll }),
          fetcher: withRequestBeforeSend(fetcher, () => {}, lifecycle.dispatchState)
        });
      await expect(materializePendingNodeSeekPolls({ ...context(), createPoll })).rejects.toThrow('投票选项无效');
      expect(journal.size).toBe(0);
      expect(await materializePendingNodeSeekPolls({ ...context(), createPoll })).toBe('nsapp://vote?id=93');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  );

  it('claims before the request and shares one remotely created poll across concurrent consumers', async () => {
    const createPoll = vi.fn(async (_poll, lifecycle: PendingNodeSeekPollCreation) => {
      expect([...journal.values()]).toEqual([{ localId: poll.localId, fingerprint: poll.fingerprint, remoteId: null }]);
      lifecycle.dispatchState.mayHaveSent = true;
      await lifecycle.persistResult({ success: true, id: 91 });
      return { success: true, id: 91 };
    });
    const results = await Promise.all([
      materializePendingNodeSeekPolls({ ...context(), createPoll }),
      materializePendingNodeSeekPolls({ ...context(), createPoll })
    ]);
    expect(results).toEqual(['nsapp://vote?id=91', 'nsapp://vote?id=91']);
    expect(createPoll).toHaveBeenCalledTimes(1);
  });

  it('blocks unknown outcomes and validates every pending marker before any remote creation', async () => {
    const createPoll = vi.fn(async (_poll, lifecycle: PendingNodeSeekPollCreation) => {
      lifecycle.dispatchState.mayHaveSent = true;
      throw new Error('connection lost');
    });
    await expect(materializePendingNodeSeekPolls({ ...context(), createPoll })).rejects.toThrow('connection lost');
    await expect(materializePendingNodeSeekPolls({ ...context(), createPoll })).rejects.toThrow('上次创建结果未知');
    expect(createPoll).toHaveBeenCalledTimes(1);
    journal.clear();
    const bad = { ...poll, localId: 'poll_two_123', fingerprint: 'invalid' };
    await expect(
      materializePendingNodeSeekPolls({
        ...context(),
        polls: [poll, bad],
        content: `${nodeSeekPendingPollToken(poll.localId)}\n${nodeSeekPendingPollToken(bad.localId)}`,
        createPoll
      })
    ).rejects.toThrow('校验失败');
    expect(createPoll).toHaveBeenCalledTimes(1);
    expect(journal.size).toBe(0);
  });

  it('retains a known result when the account changes after creation and releases definitely unsent claims', async () => {
    let current = true;
    const assertCurrent = () => {
      if (!current) throw new Error('stale identity');
    };
    const createPoll = vi.fn(async (_poll, lifecycle: PendingNodeSeekPollCreation) => {
      lifecycle.dispatchState.mayHaveSent = true;
      await lifecycle.persistResult({ id: 92 });
      current = false;
      throw new Error('stale identity');
    });
    await expect(materializePendingNodeSeekPolls({ ...context(), assertCurrent, createPoll })).rejects.toThrow('stale');
    current = true;
    expect(await materializePendingNodeSeekPolls({ ...context(), assertCurrent, createPoll })).toBe(
      'nsapp://vote?id=92'
    );
    expect(createPoll).toHaveBeenCalledTimes(1);
    journal.clear();
    await expect(
      materializePendingNodeSeekPolls({
        ...context(),
        createPoll: async () => {
          throw new Error('not sent');
        }
      })
    ).rejects.toThrow('not sent');
    expect(journal.size).toBe(0);
  });
});
