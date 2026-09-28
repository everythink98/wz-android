import { createSqliteExecutor } from '@/platform/storage/sqliteExecutor';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { z } from 'zod';
import {
  topicDraftTarget,
  type TopicEditResult,
  type TopicEditableFields,
  CreateTopicResult,
  TopicCreationSource,
  TopicDraft,
  TopicSubmissionAttempt
} from '@/domain/forum/topicComposer';

const sourceSchema = z.enum(['nodeseek', 'linuxdo', 'yaohuo']);
const identifier = z.string().min(1).max(256);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const editableFieldsSchema = z.object({
  title: z.string(),
  body: z.string(),
  categoryId: z.string(),
  rank: counter.optional(),
  tags: z.array(z.object({ id: counter.optional(), name: z.string() })).optional()
});
const targetSchema = z.string().regex(/^(create|edit:\d+)$/);
const draftBase = {
  edit: z
    .object({ topicId: z.string().regex(/^\d+$/), postId: counter.optional(), original: editableFieldsSchema })
    .optional(),
  additionalReward: z.string().optional(),
  id: identifier,
  identityKey: identifier,
  revision: counter,
  updatedAt: counter,
  title: z.string(),
  body: z.string(),
  mode: z.enum(['rich', 'source']),
  categoryId: z.string(),
  pendingNodeSeekPolls: z.array(
    z.object({
      localId: identifier,
      fingerprint: z.string(),
      title: z.string(),
      multiple: z.boolean(),
      isPublic: z.boolean(),
      options: z.array(z.string()),
      remoteId: z.string().optional()
    })
  ),
  attachments: z.array(
    z.object({
      id: identifier,
      uri: z.string(),
      name: z.string(),
      mimeType: z.string(),
      size: counter,
      kind: z.enum(['image', 'attachment', 'yaohuo-file']),
      status: z.enum(['queued', 'uploading', 'uploaded', 'failed', 'unknown']),
      description: z.string(),
      markup: z.string().optional(),
      error: z.string().optional()
    })
  )
};
const draftSchema = z.discriminatedUnion('source', [
  z.object({ ...draftBase, source: z.literal('nodeseek'), rank: counter }),
  z.object({
    ...draftBase,
    source: z.literal('linuxdo'),
    tags: z.array(z.object({ id: counter.optional(), name: z.string() })),
    postVoting: z.boolean(),
    onlyPostVoting: z.boolean().optional(),
    appliedTemplate: z.string()
  }),
  z.object({
    ...draftBase,
    source: z.literal('yaohuo'),
    kind: z.enum(['normal', 'gift', 'poll', 'files', 'resources']),
    reward: z.string(),
    gift: z.object({ total: z.string(), perPerson: z.string() }),
    poll: z.object({
      options: z.array(z.string()),
      giftEnabled: z.boolean(),
      total: z.string(),
      perPerson: z.string()
    }),
    resources: z.array(
      z.object({ title: z.string(), url: z.string(), size: z.string(), extension: z.string(), description: z.string() })
    )
  })
]);
const resultSchema = z.object({
  status: z.enum(['posted', 'enqueued', 'rejected', 'unknown', 'saved', 'partial', 'conflict']),
  confirmed: editableFieldsSchema.partial().optional(),
  latest: editableFieldsSchema.optional(),
  message: z.string(),
  topic: z.object({ id: identifier, source: sourceSchema, title: z.string() }).passthrough().optional()
});
const attemptSchema = z.object({
  target: targetSchema.optional(),
  confirmed: editableFieldsSchema.partial().optional(),
  id: identifier,
  source: sourceSchema,
  identityKey: identifier,
  draftId: identifier,
  revision: counter,
  startedAt: counter,
  status: z.enum(['sending', 'posted', 'enqueued', 'rejected', 'unknown', 'saved', 'partial', 'conflict']),
  result: resultSchema.optional()
});

const schema = `
CREATE TABLE topic_drafts (source TEXT NOT NULL, identity_key TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(source, identity_key, target));
CREATE TABLE discarded_topic_drafts (source TEXT NOT NULL, identity_key TEXT NOT NULL, target TEXT NOT NULL, draft_id TEXT NOT NULL,
  PRIMARY KEY(source, identity_key, target, draft_id));
CREATE TABLE topic_submission_attempts (source TEXT NOT NULL, identity_key TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(source, identity_key, target));
CREATE TABLE topic_creation_preferences (name TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 2;
`;
let databasePromise: Promise<SQLiteDatabase> | undefined;
const { enqueue, transaction, assertUsable } = createSqliteExecutor(
  '草稿事务状态不明，请重新启动后核对。',
  '草稿事务无法确认，未清理原记录。'
);
const activeAttempts = new Set<string>();
const attemptKey = (attempt: TopicSubmissionAttempt) =>
  `${attempt.source}\u0000${attempt.identityKey}\u0000${attempt.target || 'create'}\u0000${attempt.id}`;

function account(source: TopicCreationSource, identityKey: string) {
  sourceSchema.parse(source);
  if (
    !identityKey.startsWith(`${source}:`) ||
    identityKey === `${source}:anonymous` ||
    identityKey.slice(source.length + 1).trim() === '' ||
    identityKey.trim() !== identityKey
  )
    throw new Error('发帖账号身份不正确');
}

async function connect() {
  const db = await openDatabaseAsync('topic-drafts.db', { useNewConnection: true });
  try {
    await db.execAsync('PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    await transaction(db, true, async () => {
      const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      if (!version?.user_version) await db.execAsync(schema);
      else if (version.user_version === 1) {
        for (const table of ['topic_drafts', 'topic_submission_attempts', 'discarded_topic_drafts'])
          await db.execAsync(`ALTER TABLE ${table} RENAME TO ${table}_v1`);
        await db.execAsync(
          schema.replace('CREATE TABLE topic_creation_preferences (name TEXT PRIMARY KEY, value TEXT NOT NULL);', '')
        );
        for (const table of ['topic_drafts', 'topic_submission_attempts', 'discarded_topic_drafts']) {
          const column = table === 'discarded_topic_drafts' ? 'draft_id' : 'payload';
          await db.execAsync(
            `INSERT INTO ${table} SELECT source, identity_key, 'create', ${column} FROM ${table}_v1; DROP TABLE ${table}_v1;`
          );
        }
      } else if (version.user_version !== 2) throw new Error('草稿数据库版本无法识别，未修改原记录。');
    });
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    if (
      ['topic_drafts', 'discarded_topic_drafts', 'topic_submission_attempts', 'topic_creation_preferences'].some(
        (name) => !tables.some((table) => table.name === name)
      )
    )
      throw new Error('草稿数据库不完整，未清理原记录。');
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}

function database() {
  assertUsable();
  databasePromise ??= connect().catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
}

async function read<T extends TopicDraft | TopicSubmissionAttempt>(
  db: SQLiteDatabase,
  table: 'topic_drafts' | 'topic_submission_attempts',
  source: TopicCreationSource,
  identityKey: string,
  target = 'create'
): Promise<T | null> {
  account(source, identityKey);
  targetSchema.parse(target);
  const row = await db.getFirstAsync<{ payload: string }>(
    `SELECT payload FROM ${table} WHERE source=? AND identity_key=? AND target=?`,
    source,
    identityKey,
    target
  );
  if (!row) return null;
  try {
    const value = (table === 'topic_drafts' ? draftSchema : attemptSchema).parse(JSON.parse(row.payload));
    if (value.source !== source || value.identityKey !== identityKey) throw new Error('identity mismatch');
    if (('status' in value ? value.target || 'create' : topicDraftTarget(value)) !== target)
      throw new Error('target mismatch');
    if (
      'status' in value &&
      (value.status === 'sending' ? value.result : !value.result || value.status !== value.result.status)
    )
      throw new Error('status mismatch');
    return value as T;
  } catch {
    throw new Error('本机发帖记录已损坏，已保留原记录并阻止发送。');
  }
}

async function removeDraft(db: SQLiteDatabase, draft: TopicDraft) {
  await db.runAsync(
    'INSERT OR IGNORE INTO discarded_topic_drafts VALUES (?, ?, ?, ?)',
    draft.source,
    draft.identityKey,
    topicDraftTarget(draft),
    draft.id
  );
  await db.runAsync(
    'DELETE FROM topic_drafts WHERE source=? AND identity_key=? AND target=?',
    draft.source,
    draft.identityKey,
    topicDraftTarget(draft)
  );
}

export function loadTopicDraft(source: TopicCreationSource, identityKey: string, target = 'create') {
  return enqueue(async () => read<TopicDraft>(await database(), 'topic_drafts', source, identityKey, target));
}

export function saveTopicDraft(draft: TopicDraft) {
  // Capture before entering the asynchronous queue; callers may keep editing their in-memory object.
  const saved = draftSchema.parse(draft);
  account(saved.source, saved.identityKey);
  return enqueue(async () => {
    const db = await database();
    return transaction(db, true, async () => {
      const target = topicDraftTarget(saved);
      const previous = await read<TopicDraft>(db, 'topic_drafts', saved.source, saved.identityKey, target);
      const discarded = await db.getFirstAsync(
        'SELECT draft_id FROM discarded_topic_drafts WHERE source=? AND identity_key=? AND target=? AND draft_id=?',
        saved.source,
        saved.identityKey,
        target,
        saved.id
      );
      if (discarded || (previous && (previous.id !== saved.id || previous.revision > saved.revision))) return false;
      if (previous?.revision === saved.revision) return JSON.stringify(previous) === JSON.stringify(saved);
      await db.runAsync(
        'INSERT INTO topic_drafts VALUES (?, ?, ?, ?) ON CONFLICT(source, identity_key, target) DO UPDATE SET payload=excluded.payload',
        saved.source,
        saved.identityKey,
        target,
        JSON.stringify(saved)
      );
      return true;
    });
  });
}

export function discardTopicDraft(
  source: TopicCreationSource,
  identityKey: string,
  draftId: string,
  revision?: number,
  target = 'create'
) {
  return enqueue(async () => {
    const db = await database();
    return transaction(db, true, async () => {
      const draft = await read<TopicDraft>(db, 'topic_drafts', source, identityKey, target);
      if (!draft || draft.id !== draftId || (revision !== undefined && revision !== draft.revision)) return false;
      await removeDraft(db, draft);
      return true;
    });
  });
}

export function readTopicSubmissionAttempt(source: TopicCreationSource, identityKey: string, target = 'create') {
  return enqueue(async () => {
    const attempt = await read<TopicSubmissionAttempt>(
      await database(),
      'topic_submission_attempts',
      source,
      identityKey,
      target
    );
    if (attempt?.status !== 'sending' || activeAttempts.has(attemptKey(attempt))) return attempt;
    return {
      ...attempt,
      status: 'unknown' as const,
      result: { status: 'unknown' as const, message: '上次发布结果尚未确认，请先到原站核实。' }
    };
  });
}

export function beginTopicSubmissionAttempt(attempt: TopicSubmissionAttempt) {
  const saved = attemptSchema.parse(attempt);
  account(saved.source, saved.identityKey);
  if (saved.status !== 'sending' || saved.result) throw new Error('发布必须从待确认状态开始');
  return enqueue(async () => {
    const db = await database();
    await transaction(db, true, async () => {
      const previous = await read<TopicSubmissionAttempt>(
        db,
        'topic_submission_attempts',
        saved.source,
        saved.identityKey,
        saved.target || 'create'
      );
      if (previous && (previous.id === saved.id || previous.status === 'sending' || previous.status === 'unknown'))
        throw new Error('上次发布结果尚未确认，请先到原站核实，勿重复发送。');
      const draft = await read<TopicDraft>(
        db,
        'topic_drafts',
        saved.source,
        saved.identityKey,
        saved.target || 'create'
      );
      if (!draft || draft.id !== saved.draftId || draft.revision !== saved.revision)
        throw new Error('草稿已变化或尚未保存，请重试。');
      await db.runAsync(
        'INSERT INTO topic_submission_attempts VALUES (?, ?, ?, ?) ON CONFLICT(source, identity_key, target) DO UPDATE SET payload=excluded.payload',
        saved.source,
        saved.identityKey,
        saved.target || 'create',
        JSON.stringify(saved)
      );
    });
    activeAttempts.add(attemptKey(saved as TopicSubmissionAttempt));
  });
}

export function settleTopicSubmissionAttempt(
  attempt: TopicSubmissionAttempt,
  result: CreateTopicResult | TopicEditResult
) {
  const savedResult = resultSchema.parse(result) as CreateTopicResult | TopicEditResult;
  if (savedResult.status === 'posted' && savedResult.topic && savedResult.topic.source !== attempt.source)
    throw new Error('发布结果来源不匹配，未清理草稿。');
  return enqueue(async () => {
    const db = await database();
    const settled = await transaction(db, true, async () => {
      const previous = await read<TopicSubmissionAttempt>(
        db,
        'topic_submission_attempts',
        attempt.source,
        attempt.identityKey,
        attempt.target || 'create'
      );
      if (
        !previous ||
        previous.id !== attempt.id ||
        previous.draftId !== attempt.draftId ||
        previous.revision !== attempt.revision
      )
        return false;
      if (previous.status === 'posted' || previous.status === 'enqueued' || previous.status === 'saved') return false;
      if (
        previous.status !== 'sending' &&
        savedResult.status !== 'posted' &&
        savedResult.status !== 'enqueued' &&
        savedResult.status !== 'saved'
      )
        return false;
      const updated = {
        ...previous,
        status: savedResult.status,
        result: savedResult,
        ...('confirmed' in savedResult && savedResult.confirmed ? { confirmed: savedResult.confirmed } : {})
      };
      await db.runAsync(
        'UPDATE topic_submission_attempts SET payload=? WHERE source=? AND identity_key=? AND target=?',
        JSON.stringify(updated),
        attempt.source,
        attempt.identityKey,
        attempt.target || 'create'
      );
      if (savedResult.status === 'posted' || savedResult.status === 'enqueued' || savedResult.status === 'saved') {
        const draft = await read<TopicDraft>(
          db,
          'topic_drafts',
          attempt.source,
          attempt.identityKey,
          attempt.target || 'create'
        );
        if (draft?.id === attempt.draftId && draft.revision === attempt.revision) await removeDraft(db, draft);
      }
      return true;
    });
    return settled;
  }).finally(() => {
    // The remote operation has finished even if its receipt could not be committed.
    // Keep the durable sending record as an unknown result, but allow explicit reconciliation.
    activeAttempts.delete(attemptKey(attempt));
  });
}

export function acknowledgeTopicSubmissionAttempt(
  source: TopicCreationSource,
  identityKey: string,
  attemptId: string,
  target = 'create'
) {
  return enqueue(async () => {
    const db = await database();
    return transaction(db, true, async () => {
      const attempt = await read<TopicSubmissionAttempt>(db, 'topic_submission_attempts', source, identityKey, target);
      if (!attempt || attempt.id !== attemptId) return false;
      if (activeAttempts.has(attemptKey(attempt))) throw new Error('发布仍在进行中，请等待结果。');
      await db.runAsync(
        'DELETE FROM topic_submission_attempts WHERE source=? AND identity_key=? AND target=?',
        source,
        identityKey,
        target
      );
      return true;
    });
  });
}

export function checkpointTopicEdit(attempt: TopicSubmissionAttempt, confirmed: Partial<TopicEditableFields>) {
  const fields = editableFieldsSchema.partial().parse(confirmed);
  return enqueue(async () => {
    const db = await database();
    await transaction(db, true, async () => {
      const current = await read<TopicSubmissionAttempt>(
        db,
        'topic_submission_attempts',
        attempt.source,
        attempt.identityKey,
        attempt.target
      );
      if (!current || current.id !== attempt.id || current.status !== 'sending')
        throw new Error('保存记录已变化，请先核对原站');
      await db.runAsync(
        'UPDATE topic_submission_attempts SET payload=? WHERE source=? AND identity_key=? AND target=?',
        JSON.stringify({ ...current, confirmed: fields }),
        attempt.source,
        attempt.identityKey,
        attempt.target || 'create'
      );
    });
  });
}

export function readLastTopicCreationSource() {
  return enqueue(async () => {
    const db = await database();
    const row = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM topic_creation_preferences WHERE name='last-source'"
    );
    return row ? sourceSchema.parse(row.value) : null;
  });
}

export function saveLastTopicCreationSource(source: TopicCreationSource) {
  sourceSchema.parse(source);
  return enqueue(async () => {
    const db = await database();
    await db.runAsync(
      "INSERT INTO topic_creation_preferences VALUES ('last-source', ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
      source
    );
  });
}
