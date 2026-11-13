import { expect, it, vi } from 'vitest';
import { createSqliteExecutor } from './sqliteExecutor';

it('serializes each owner, recovers its queue after failure, and freezes only an uncertain owner', async () => {
  const first = createSqliteExecutor('first frozen', 'first rollback failed');
  const second = createSqliteExecutor('second frozen', 'second rollback failed');
  const db = { execAsync: vi.fn(async (_sql: string) => undefined) };
  const events: string[] = [];
  let release!: () => void;
  const pending = first.enqueue(async () => {
    events.push('first start');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new Error('operation failed');
  });
  const failed = expect(pending).rejects.toThrow('operation failed');
  const queued = first.enqueue(async () => {
    events.push('first next');
  });
  await second.enqueue(() =>
    second.transaction(db, false, async () => {
      events.push('second');
    })
  );
  expect(events).toEqual(['first start', 'second']);
  expect(db.execAsync.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN DEFERRED', 'COMMIT']);
  release();
  await failed;
  await queued;
  expect(events).toEqual(['first start', 'second', 'first next']);

  db.execAsync.mockImplementation(async (sql) => {
    if (sql === 'COMMIT' || sql === 'ROLLBACK') throw new Error(sql);
  });
  const failure: unknown = await first.transaction(db, true, async () => 1).catch((error) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure).toMatchObject({ message: 'first rollback failed' });
  let rejected: unknown;
  try {
    first.assertUsable();
  } catch (error) {
    rejected = error;
  }
  expect(rejected).toMatchObject({ message: 'first frozen', cause: failure });
  if (!(rejected instanceof Error)) throw new Error('Missing frozen-owner failure');
  expect(rejected.cause).toBe(failure);
  const calls = db.execAsync.mock.calls.length;
  await expect(first.transaction(db, true, async () => 2)).rejects.toThrow('first frozen');
  expect(db.execAsync).toHaveBeenCalledTimes(calls);
  db.execAsync.mockImplementation(async () => undefined);
  await expect(second.transaction(db, true, async () => 3)).resolves.toBe(3);
});

it.each(['BEGIN IMMEDIATE', 'COMMIT'])('keeps the owner usable after a recoverable %s failure', async (failedSql) => {
  const executor = createSqliteExecutor('frozen', 'rollback failed');
  const failure = new Error(`${failedSql} failed`);
  const failures = [failedSql];
  const db = {
    execAsync: vi.fn(async (sql: string) => {
      if (sql === failures[0]) {
        failures.shift();
        throw failure;
      }
    })
  };
  const operation = vi.fn(async () => 7);

  await expect(executor.transaction(db, true, operation)).rejects.toBe(failure);
  expect(db.execAsync.mock.calls.map(([sql]) => sql)).toEqual(
    failedSql === 'COMMIT' ? ['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'] : ['BEGIN IMMEDIATE']
  );
  expect(() => executor.assertUsable()).not.toThrow();
  await expect(executor.transaction(db, false, operation)).resolves.toBe(7);
});

it.each(['fulfilled', 'rejected'] as const)(
  'dispatches the next queued callback before observer microtasks after a %s result',
  async (outcome) => {
    const executor = createSqliteExecutor('frozen', 'rollback failed');
    const pending = Promise.withResolvers<void>();
    const events: string[] = [];
    const first = executor.enqueue(() => pending.promise);
    const second = executor.enqueue(async () => {
      events.push('next');
    });
    const observe = () => {
      events.push('observer');
      queueMicrotask(() => events.push('observer:microtask'));
    };
    const observed = first.then(observe, observe);

    if (outcome === 'fulfilled') pending.resolve();
    else pending.reject(new Error('failed'));
    await Promise.all([observed, second]);
    expect(events).toEqual(['observer', 'next', 'observer:microtask']);
  }
);

it('keeps dispatching queued callbacks after an uncertain transaction while blocking further SQL', async () => {
  const executor = createSqliteExecutor('frozen', 'rollback failed');
  const db = {
    execAsync: vi.fn(async (sql: string) => {
      if (sql === 'COMMIT' || sql === 'ROLLBACK') throw new Error(sql);
    })
  };
  const events: string[] = [];
  const first = executor.enqueue(() => executor.transaction(db, true, async () => 1)).catch((error) => error);
  const queued = executor
    .enqueue(() => {
      events.push('queued callback');
      return executor.transaction(db, false, async () => 2);
    })
    .catch((error) => error);
  const maintenance = executor.enqueue(async () => {
    events.push('maintenance');
  });

  const failure: unknown = await first;
  const blocked: unknown = await queued;
  await maintenance;
  expect(failure).toBeInstanceOf(AggregateError);
  expect(blocked).toBeInstanceOf(Error);
  if (!(blocked instanceof Error)) throw new Error('Missing frozen-owner failure');
  expect(blocked.cause).toBe(failure);
  expect(events).toEqual(['queued callback', 'maintenance']);
  expect(db.execAsync.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK']);
});
