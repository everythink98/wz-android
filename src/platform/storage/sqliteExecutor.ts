import type { SQLiteDatabase } from 'expo-sqlite';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';

type SqliteHealth = { phase: 'usable' } | { phase: 'frozen'; cause: AggregateError };

export function createSqliteExecutor(uncertainMessage: string, rollbackMessage: string) {
  const operations = createKeyedSerialRunner<null>();
  const freezeListeners = new Set<() => void>();
  let health: SqliteHealth = { phase: 'usable' };
  const assertUsable = () => {
    if (health.phase === 'frozen') throw new Error(uncertainMessage, { cause: health.cause });
  };
  return {
    assertUsable,
    subscribeToFreeze(listener: () => void) {
      if (health.phase === 'frozen') listener();
      else freezeListeners.add(listener);
      return () => {
        freezeListeners.delete(listener);
      };
    },
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      return operations.run(null, operation);
    },
    // Each database owns its queue and frozen state; no unrelated work may join a transaction.
    async transaction<T>(
      db: Pick<SQLiteDatabase, 'execAsync'>,
      write: boolean,
      operation: () => Promise<T>
    ): Promise<T> {
      assertUsable();
      await db.execAsync(write ? 'BEGIN IMMEDIATE' : 'BEGIN DEFERRED');
      try {
        const result = await operation();
        await db.execAsync('COMMIT');
        return result;
      } catch (error) {
        try {
          await db.execAsync('ROLLBACK');
        } catch (rollback) {
          const cause = new AggregateError([error, rollback], rollbackMessage);
          health = { phase: 'frozen', cause };
          const listeners = [...freezeListeners];
          freezeListeners.clear();
          for (const listener of listeners) listener();
          throw cause;
        }
        throw error;
      }
    }
  };
}
