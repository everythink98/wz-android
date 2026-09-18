import { openDatabaseAsync } from 'expo-sqlite';
import { createEmptyReaderData, type ReaderData } from '@/domain/reader/readerData';
import { ReaderTransaction, readReaderSnapshot } from '@/platform/storage/readerDatabase';
import { importReaderDataBackup, loadReaderState } from '@/platform/storage/readerDataStore';

// The existing isolated proof owns the fixture database. Preserve its contents
// and use a separate native connection to verify every committed import.
export async function verifyDeletionBoundaries() {
  await loadReaderState();
  const db = await openDatabaseAsync('reader-data.db', { useNewConnection: true });
  const original = await readReaderSnapshot(db);
  async function replace(data: ReaderData) {
    await db.execAsync('BEGIN IMMEDIATE');
    try {
      const writer = await ReaderTransaction.open(db);
      await writer.replaceBackupSnapshot(data);
      await writer.finish();
      await db.execAsync('COMMIT');
    } catch (error) {
      await db.execAsync('ROLLBACK');
      throw error;
    }
  }
  const results: { count: number; day: number; collection: string; present: boolean }[] = [];
  try {
    for (const count of [999, 1000, 1001]) {
      for (const day of [1, 2, 3]) {
        const local = createEmptyReaderData();
        const incoming = createEmptyReaderData();
        const key = 'nodeseek:917';
        for (const collection of ['favorites', 'history', 'followedUsers'] as const) {
          local.deletedRecords[collection][key] = '2026-06-02T00:00:00Z';
          for (let i = 0; i < count - 1; i++)
            incoming.deletedRecords[collection][`nodeseek:other-${i}`] = '2026-07-01T00:00:00Z';
          const at = `2026-06-0${day}T00:00:00Z`;
          if (collection === 'followedUsers') {
            incoming.followedUsers[key] = {
              user: {
                source: 'nodeseek',
                id: '917',
                username: 'fixture',
                topics: [],
                url: 'https://www.nodeseek.com/space/917'
              },
              followedAt: at
            };
          } else {
            incoming[collection][key] = {
              topic: {
                source: 'nodeseek',
                id: '917',
                title: 'Device boundary',
                url: 'https://www.nodeseek.com/post-917-1',
                author: 'fixture',
                category: '日常',
                createdAt: '2026-06-01T00:00:00Z',
                replyCount: 0
              },
              savedAt: at
            };
          }
        }
        await replace(local);
        await importReaderDataBackup(JSON.stringify(incoming));
        const reopened = await openDatabaseAsync('reader-data.db', { useNewConnection: true });
        try {
          const actual = await readReaderSnapshot(reopened);
          for (const collection of ['favorites', 'history', 'followedUsers'] as const) {
            const present = Boolean(actual[collection][key]);
            if (present !== day > 2 || Object.keys(actual.deletedRecords[collection]).length > 1000)
              throw new Error(`Native import conflict: ${collection}/${count}/${day}`);
            results.push({ count, day, collection, present });
          }
        } finally {
          await reopened.closeAsync();
        }
      }
    }
    return results;
  } finally {
    await replace(original);
    if (JSON.stringify(await readReaderSnapshot(db)) !== JSON.stringify(original))
      throw new Error('Fixture restoration mismatch');
    await db.closeAsync();
  }
}
