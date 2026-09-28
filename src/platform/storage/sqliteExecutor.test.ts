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
  await expect(first.transaction(db, true, async () => 1)).rejects.toThrow('first rollback failed');
  expect(() => first.assertUsable()).toThrow('first frozen');
  const calls = db.execAsync.mock.calls.length;
  await expect(first.transaction(db, true, async () => 2)).rejects.toThrow('first frozen');
  expect(db.execAsync).toHaveBeenCalledTimes(calls);
  db.execAsync.mockImplementation(async () => undefined);
  await expect(second.transaction(db, true, async () => 3)).resolves.toBe(3);
});
