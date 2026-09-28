import type { SQLiteDatabase } from 'expo-sqlite';

export function createSqliteExecutor(uncertainMessage: string, rollbackMessage: string) {
  let queue: Promise<unknown> = Promise.resolve();
  let transactionUncertain = false;
  const assertUsable = () => {
    if (transactionUncertain) throw new Error(uncertainMessage);
  };
  return {
    assertUsable,
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
      const result = queue.then(operation, operation);
      queue = result.catch(() => undefined);
      return result;
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
          transactionUncertain = true;
          throw new AggregateError([error, rollback], rollbackMessage);
        }
        throw error;
      }
    }
  };
}
