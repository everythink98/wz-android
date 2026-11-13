import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqliteParameters } from '../../../tests/helpers/sqliteParameters';
import {
  MAX_COMPOSER_MARKDOWN_LENGTH,
  MAX_COMPOSER_POLL_COUNT,
  nodeSeekPendingPollToken,
  normalizePendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import { prepareRequestToSend, withRequestBeforeSend } from '@/platform/network/request';
import { runNodeSeekAction } from './actionClient';
import { buildNodeSeekPollCreateRequest } from './actionRequest';
import { materializePendingNodeSeekPolls, type PendingNodeSeekPollCreation } from './pendingPolls';

const journal = vi.hoisted(() => new Map<string, { localId: string; fingerprint: string; remoteId: string | null }>());
const journalMock = vi.hoisted(() => {
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
vi.mock('@/platform/persistence/nodeSeekPollJournal', () => journalMock);

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
  it('keeps dispatch evidence independent of an already persisted remote result', async () => {
    const failure = new Error('late transport failure');
    const observed: boolean[] = [];
    await expect(
      materializePendingNodeSeekPolls({
        ...context(),
        createPoll: async (_poll, lifecycle) => {
          observed.push(lifecycle.dispatchState.mayHaveSent);
          await lifecycle.persistResult({ id: 74 });
          observed.push(lifecycle.dispatchState.mayHaveSent);
          const local = withRequestBeforeSend(
            async (_url, init) => {
              prepareRequestToSend(init);
              observed.push(lifecycle.dispatchState.mayHaveSent);
              throw failure;
            },
            () => {},
            lifecycle.dispatchState
          );
          return local('https://www.nodeseek.com/local-fixture', { method: 'POST' });
        }
      })
    ).rejects.toBe(failure);
    expect(observed).toEqual([false, false, true]);
    expect([...journal.values()]).toEqual([{ localId: poll.localId, fingerprint: poll.fingerprint, remoteId: '74' }]);
  });

  it('retains a known remote claim when its journal write fails before any dispatch evidence', async () => {
    const failure = new Error('journal unavailable');
    const save = vi.spyOn(journalMock, 'saveNodeSeekPollJournalEntry').mockRejectedValueOnce(failure);
    let lifecycle: PendingNodeSeekPollCreation | undefined;
    const createPoll = vi.fn(async (_poll, owner: PendingNodeSeekPollCreation) => {
      lifecycle = owner;
      await owner.persistResult({ id: 75 });
      return { id: 75 };
    });
    try {
      await expect(materializePendingNodeSeekPolls({ ...context(), createPoll })).rejects.toBe(failure);
      expect(lifecycle?.dispatchState.mayHaveSent).toBe(false);
      expect(journal.size).toBe(1);
      await expect(materializePendingNodeSeekPolls({ ...context(), createPoll })).rejects.toThrow('上次创建结果未知');
      expect(createPoll).toHaveBeenCalledTimes(1);
    } finally {
      save.mockRestore();
    }
  });

  it('retains a confirmed poll claim after completion persistence fails and a fresh module reopens it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'wz-pending-poll-'));
    const connections: DatabaseSync[] = [];
    let failCompletion = true;
    const outsideNetwork = vi.fn(() => {
      throw new Error('External transport is disabled');
    });
    vi.stubGlobal('fetch', outsideNetwork);
    vi.doMock('expo-sqlite', () => ({
      openDatabaseAsync: async (name: string) => {
        const db = new DatabaseSync(join(directory, name));
        connections.push(db);
        return {
          execAsync: async (sql: string) => db.exec(sql),
          runAsync: async (sql: string, ...args: unknown[]) => {
            if (failCompletion && sql.includes('ON CONFLICT')) {
              failCompletion = false;
              throw new Error('injected completion failure');
            }
            return db.prepare(sql).run(...sqliteParameters(args));
          },
          getFirstAsync: async (sql: string, ...args: unknown[]) =>
            db.prepare(sql).get(...sqliteParameters(args)) ?? null,
          getAllAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...sqliteParameters(args)),
          closeAsync: async () => {
            db.close();
            connections.splice(connections.indexOf(db), 1);
          }
        };
      }
    }));
    vi.doMock('@react-native-async-storage/async-storage', () => ({
      default: { getItem: async () => null, removeItem: async () => {} }
    }));
    vi.doUnmock('@/platform/persistence/nodeSeekPollJournal');
    vi.resetModules();
    try {
      const durable = await import('./pendingPolls');
      const { runNodeSeekAction } = await import('./actionClient');
      const transport = vi.fn(async (_input: string, init?: RequestInit) => {
        prepareRequestToSend(init);
        return new Response('{"id":901}', { headers: { 'content-type': 'application/json' } });
      });
      const options: Parameters<typeof durable.materializePendingNodeSeekPolls>[0] = {
        ...context(),
        createPoll: vi.fn<Parameters<typeof durable.materializePendingNodeSeekPolls>[0]['createPoll']>(
          async (value, lifecycle) => {
            const result = await runNodeSeekAction({
              request: buildNodeSeekPollCreateRequest({ poll: value }),
              fetcher: withRequestBeforeSend(transport, () => {}, lifecycle.dispatchState),
              userAgent: 'NodeSeek UA'
            });
            await lifecycle.persistResult(result);
            return result;
          }
        )
      };

      await expect(durable.materializePendingNodeSeekPolls(options)).rejects.toThrow('injected completion failure');
      const inspection = new DatabaseSync(join(directory, 'composer-journal.db'));
      try {
        expect(inspection.prepare('SELECT remote_id FROM nodeseek_poll_journal').get()).toEqual({ remote_id: null });
      } finally {
        inspection.close();
      }
      connections.splice(0).forEach((db) => db.close());
      vi.resetModules();
      const reopened = await import('./pendingPolls');
      await expect(reopened.materializePendingNodeSeekPolls(options)).rejects.toThrow('上次创建结果未知');

      expect(transport).toHaveBeenCalledTimes(1);
      expect(options.createPoll).toHaveBeenCalledTimes(1);
      expect(outsideNetwork).not.toHaveBeenCalled();
    } finally {
      connections.splice(0).forEach((db) => db.close());
      vi.doMock('@/platform/persistence/nodeSeekPollJournal', () => journalMock);
      vi.doUnmock('expo-sqlite');
      vi.doUnmock('@react-native-async-storage/async-storage');
      vi.resetModules();
      vi.unstubAllGlobals();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('materializes the maximum draft once without rescanning the body for every known poll', async () => {
    const polls = Array.from({ length: MAX_COMPOSER_POLL_COUNT }, (_, index) =>
      normalizePendingNodeSeekPoll({
        localId: `poll_work_${String(index).padStart(8, '0')}`,
        title: `Question ${index}`,
        options: ['A', 'B'],
        multiple: false,
        isPublic: false
      })
    );
    for (const [index, poll] of polls.entries())
      journal.set(`nodeseek:42/${poll.localId}/${poll.fingerprint}`, { ...poll, remoteId: String(index + 1) });
    const tokens = [...polls]
      .reverse()
      .map((poll) => nodeSeekPendingPollToken(poll.localId))
      .join('\n');
    const controls = 'before\n<img src="/safe.png">\n```text\nordinary code\n```\nafter\n';
    const prefix = controls + 'x'.repeat(MAX_COMPOSER_MARKDOWN_LENGTH - controls.length - tokens.length - 1) + '\n';
    const content = prefix + tokens;
    const budget = content.length * 6;
    let units = 0;
    const splitDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'split');
    const sliceDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'slice');
    if (!splitDescriptor?.value || !sliceDescriptor?.value) throw new Error('Expected the real draft string methods');
    const split = String.prototype.split;
    const slice = String.prototype.slice;
    const tick = (length: number) => {
      units += length;
      if (units > budget) throw new Error(`Pending poll text exceeded ${budget} UTF-16 units`);
    };
    // eslint-disable-next-line no-extend-native -- Measure real string processing; the exact descriptor is restored below.
    Object.defineProperty(String.prototype, 'split', {
      ...splitDescriptor,
      value(this: string, ...args: Parameters<typeof split>) {
        tick(this.length);
        return Reflect.apply(split, this, args);
      }
    });
    // eslint-disable-next-line no-extend-native -- Count copied output ranges so moving the scan to slice cannot pass.
    Object.defineProperty(String.prototype, 'slice', {
      ...sliceDescriptor,
      value(this: string, ...args: Parameters<typeof slice>) {
        const result = Reflect.apply(slice, this, args);
        tick(result.length);
        return result;
      }
    });
    const createPoll = vi.fn(async () => {
      throw new Error('Known poll must not be created again');
    });
    let result: string;
    try {
      result = await materializePendingNodeSeekPolls({ ...context(), content, polls, createPoll });
    } finally {
      // eslint-disable-next-line no-extend-native -- Restore both methods even when the work budget rejects the draft.
      Object.defineProperty(String.prototype, 'split', splitDescriptor);
      // eslint-disable-next-line no-extend-native -- Restore the exact original slice descriptor.
      Object.defineProperty(String.prototype, 'slice', sliceDescriptor);
    }
    expect(result).toBe(
      prefix +
        [...polls]
          .reverse()
          .map((_, index) => `nsapp://vote?id=${polls.length - index}`)
          .join('\n')
    );
    expect(units).toBeLessThan(budget);
    expect(createPoll).not.toHaveBeenCalled();
  });

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

  it('retains rejection of pending tokens with extra internal whitespace', async () => {
    journal.set(`nodeseek:42/${poll.localId}/${poll.fingerprint}`, { ...poll, remoteId: '91' });
    const createPoll = vi.fn(async () => {
      throw new Error('Known poll must not be created again');
    });
    await expect(
      materializePendingNodeSeekPolls({
        ...context(),
        content: `<!-- wz:nodeseek-poll: ${poll.localId} -->`,
        createPoll
      })
    ).rejects.toThrow('本地投票数据不完整');
    expect(createPoll).not.toHaveBeenCalled();
  });

  it('rejects an invalid known remote id before creating the next poll', async () => {
    const next = normalizePendingNodeSeekPoll({ ...poll, localId: 'poll_next_123' });
    journal.set(`nodeseek:42/${poll.localId}/${poll.fingerprint}`, { ...poll, remoteId: 'bad-id' });
    const createPoll = vi.fn(async () => {
      throw new Error('Next poll must not be created');
    });
    await expect(
      materializePendingNodeSeekPolls({
        ...context(),
        polls: [poll, next],
        content: `${nodeSeekPendingPollToken(poll.localId)}\n${nodeSeekPendingPollToken(next.localId)}`,
        createPoll
      })
    ).rejects.toThrow('NodeSeek 投票 id 不正确');
    expect(createPoll).not.toHaveBeenCalled();
    expect(journal.size).toBe(1);
  });

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

it('preserves an unknown dispatched poll across nested transport observers and a SQLite reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wz-nested-poll-proof-'));
  const connections: DatabaseSync[] = [];
  const outsideNetwork = vi.fn(() => {
    throw new Error('External transport disabled');
  });
  vi.stubGlobal('fetch', outsideNetwork);
  vi.doMock('expo-sqlite', () => ({
    openDatabaseAsync: async (name: string) => {
      const db = new DatabaseSync(join(directory, name));
      connections.push(db);
      return {
        execAsync: async (sql: string) => db.exec(sql),
        runAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).run(...sqliteParameters(args)),
        getFirstAsync: async (sql: string, ...args: unknown[]) =>
          db.prepare(sql).get(...sqliteParameters(args)) ?? null,
        getAllAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...sqliteParameters(args)),
        closeAsync: async () => {
          db.close();
          connections.splice(connections.indexOf(db), 1);
        }
      };
    }
  }));
  vi.doMock('@react-native-async-storage/async-storage', () => ({
    default: { getItem: async () => null, removeItem: async () => {} }
  }));
  vi.doUnmock('@/platform/persistence/nodeSeekPollJournal');
  vi.resetModules();
  const outer = { mayHaveSent: false };
  const childStates: { mayHaveSent: boolean }[] = [];
  const failure = new Error('connection lost after synthetic dispatch');
  const transport = vi.fn(async (_input: string, init?: RequestInit) => {
    prepareRequestToSend(init);
    throw failure;
  });
  const rows = () => {
    const inspection = new DatabaseSync(join(directory, 'composer-journal.db'));
    try {
      return inspection.prepare('SELECT local_id, remote_id FROM nodeseek_poll_journal').all();
    } finally {
      inspection.close();
    }
  };
  try {
    const durable = await import('./pendingPolls');
    const { runNodeSeekAction } = await import('./actionClient');
    const options: Parameters<typeof durable.materializePendingNodeSeekPolls>[0] = {
      ...context(),
      createPoll: async (value, lifecycle) => {
        childStates.push(lifecycle.dispatchState);
        const account = withRequestBeforeSend(transport, () => {}, outer);
        return runNodeSeekAction({
          request: buildNodeSeekPollCreateRequest({ poll: value }),
          fetcher: withRequestBeforeSend(account, () => {}, lifecycle.dispatchState),
          userAgent: 'Synthetic provider'
        });
      }
    };
    const first = await durable.materializePendingNodeSeekPolls(options).catch((error: unknown) => error);
    const afterFirst = rows();
    connections.splice(0).forEach((db) => db.close());
    vi.resetModules();
    const reopened = await import('./pendingPolls');
    const second = await reopened.materializePendingNodeSeekPolls(options).catch((error: unknown) => error);
    expect(first).toBe(failure);
    expect(afterFirst).toEqual([{ local_id: poll.localId, remote_id: null }]);
    expect(rows()).toEqual([{ local_id: poll.localId, remote_id: null }]);
    expect(second).toBeInstanceOf(Error);
    expect((second as Error).message).toContain('上次创建结果未知');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(childStates[0]?.mayHaveSent).toBe(true);
    expect(outsideNetwork).not.toHaveBeenCalled();
  } finally {
    connections.splice(0).forEach((db) => db.close());
    vi.doMock('@/platform/persistence/nodeSeekPollJournal', () => journalMock);
    vi.doUnmock('expo-sqlite');
    vi.doUnmock('@react-native-async-storage/async-storage');
    vi.resetModules();
    vi.unstubAllGlobals();
    rmSync(directory, { recursive: true, force: true });
  }
});
