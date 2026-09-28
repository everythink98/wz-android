// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TopicDraft, TopicSubmissionAttempt } from '@/domain/forum/topicComposer';

const harness = vi.hoisted(() => ({ directory: '', connections: [] as { close(): void }[], fail: '' }));
vi.mock('expo-sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { join } = await import('node:path');
  return {
    openDatabaseAsync: async (name: string) => {
      const db = new DatabaseSync(join(harness.directory, name));
      harness.connections.push(db);
      const check = (sql: string) => {
        if (harness.fail && sql.includes(harness.fail)) {
          harness.fail = '';
          throw new Error('disk unavailable');
        }
      };
      return {
        execAsync: async (sql: string) => {
          check(sql);
          db.exec(sql);
        },
        runAsync: async (sql: string, ...args: (string | number | null)[]) => {
          check(sql);
          return db.prepare(sql).run(...args);
        },
        getFirstAsync: async (sql: string, ...args: (string | number | null)[]) => {
          check(sql);
          return db.prepare(sql).get(...args) ?? null;
        },
        getAllAsync: async (sql: string, ...args: (string | number | null)[]) => {
          check(sql);
          return db.prepare(sql).all(...args);
        },
        closeAsync: async () => {
          db.close();
          harness.connections = harness.connections.filter((item) => item !== db);
        }
      };
    }
  };
});

const draft = (revision = 1, identityKey = 'nodeseek:42'): TopicDraft => ({
  id: 'draft-one',
  source: 'nodeseek',
  identityKey,
  revision,
  updatedAt: revision,
  title: '标题',
  body: '需要保留的正文',
  mode: 'source',
  categoryId: 'daily',
  rank: 0,
  attachments: [],
  pendingNodeSeekPolls: []
});
const attempt = (saved = draft(), id = 'attempt-one'): TopicSubmissionAttempt => ({
  id,
  source: saved.source,
  identityKey: saved.identityKey,
  draftId: saved.id,
  revision: saved.revision,
  startedAt: 1234,
  status: 'sending'
});
const load = () => import('./topicDrafts');
const inspect = () => {
  const db = new DatabaseSync(join(harness.directory, 'topic-drafts.db'));
  harness.connections.push(db);
  return db;
};

beforeEach(() => {
  vi.resetModules();
  harness.fail = '';
  harness.directory = mkdtempSync(join(tmpdir(), 'wz-topic-drafts-'));
});
afterEach(() => {
  harness.connections.forEach((db) => db.close());
  harness.connections = [];
  rmSync(harness.directory, { recursive: true, force: true });
});

describe('topic drafts and publication receipts', () => {
  it('migrates version one drafts, tombstones and unknown receipts without changing their payloads', async () => {
    const db = inspect();
    db.exec(`CREATE TABLE topic_drafts (source TEXT, identity_key TEXT, payload TEXT, PRIMARY KEY(source, identity_key));
      CREATE TABLE discarded_topic_drafts (source TEXT, identity_key TEXT, draft_id TEXT, PRIMARY KEY(source, identity_key, draft_id));
      CREATE TABLE topic_submission_attempts (source TEXT, identity_key TEXT, payload TEXT, PRIMARY KEY(source, identity_key));
      CREATE TABLE topic_creation_preferences (name TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1;`);
    db.prepare('INSERT INTO topic_drafts VALUES (?, ?, ?)').run('nodeseek', 'nodeseek:42', JSON.stringify(draft()));
    db.prepare('INSERT INTO topic_submission_attempts VALUES (?, ?, ?)').run(
      'nodeseek',
      'nodeseek:42',
      JSON.stringify(attempt())
    );
    db.prepare('INSERT INTO discarded_topic_drafts VALUES (?, ?, ?)').run('nodeseek', 'nodeseek:42', 'discarded');
    const store = await load();
    expect(await store.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft());
    expect(await store.readTopicSubmissionAttempt('nodeseek', 'nodeseek:42')).toHaveProperty('status', 'unknown');
    expect(await store.saveTopicDraft({ ...draft(), id: 'discarded', revision: 99 })).toBe(false);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 });
    expect(db.prepare('SELECT payload FROM topic_drafts').get()).toEqual({ payload: JSON.stringify(draft()) });
  });

  it('rolls back an interrupted migration and retains the old database', async () => {
    const db = inspect();
    db.exec(`CREATE TABLE topic_drafts (source TEXT, identity_key TEXT, payload TEXT, PRIMARY KEY(source, identity_key));
      CREATE TABLE discarded_topic_drafts (source TEXT, identity_key TEXT, draft_id TEXT, PRIMARY KEY(source, identity_key, draft_id));
      CREATE TABLE topic_submission_attempts (source TEXT, identity_key TEXT, payload TEXT, PRIMARY KEY(source, identity_key));
      CREATE TABLE topic_creation_preferences (name TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=1;`);
    db.prepare('INSERT INTO topic_drafts VALUES (?, ?, ?)').run('nodeseek', 'nodeseek:42', JSON.stringify(draft()));
    harness.fail = 'INSERT INTO topic_submission_attempts SELECT';
    const store = await load();
    await expect(store.loadTopicDraft('nodeseek', 'nodeseek:42')).rejects.toThrow('disk unavailable');
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
    expect(db.prepare('SELECT payload FROM topic_drafts').get()).toEqual({ payload: JSON.stringify(draft()) });
    expect(await store.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft());
  });

  it('keeps new-topic and two edit drafts separate across reopen, checkpoints and cleanup', async () => {
    const store = await load();
    const edit = (id: string): TopicDraft => ({
      ...draft(),
      id: `edit-${id}`,
      edit: {
        topicId: id,
        original: { title: '原始标题', body: '原始正文', categoryId: 'daily', rank: 0 }
      }
    });
    await store.saveTopicDraft(draft());
    await store.saveTopicDraft(edit('123'));
    await store.saveTopicDraft(edit('456'));
    const sending = { ...attempt(edit('123')), target: 'edit:123' };
    await store.beginTopicSubmissionAttempt(sending);
    await store.checkpointTopicEdit(sending, { title: '已经保存的标题' });
    vi.resetModules();
    const reopened = await load();
    expect(await reopened.readTopicSubmissionAttempt('nodeseek', 'nodeseek:42', 'edit:123')).toMatchObject({
      status: 'unknown',
      confirmed: { title: '已经保存的标题' }
    });
    expect(await reopened.loadTopicDraft('nodeseek', 'nodeseek:42', 'edit:456')).toEqual(edit('456'));
    expect(await reopened.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft());
    await reopened.settleTopicSubmissionAttempt(sending, { status: 'saved', message: '已确认保存' });
    expect(await reopened.loadTopicDraft('nodeseek', 'nodeseek:42', 'edit:123')).toBeNull();
    expect(await reopened.saveTopicDraft({ ...edit('123'), revision: 99 })).toBe(false);
    expect(await reopened.loadTopicDraft('nodeseek', 'nodeseek:42', 'edit:456')).toEqual(edit('456'));
    expect(await reopened.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft());
  });
  it('keeps the latest revision and separates accounts and sites across database reopen', async () => {
    const store = await load();
    expect(await Promise.all([store.saveTopicDraft(draft(3)), store.saveTopicDraft(draft(2))])).toEqual([true, false]);
    expect(await store.saveTopicDraft({ ...draft(3), body: 'same revision cannot replace text' })).toBe(false);
    await store.saveTopicDraft(draft(1, 'nodeseek:84'));
    const linux: TopicDraft = {
      ...draft(),
      source: 'linuxdo',
      identityKey: 'linuxdo:42',
      tags: [],
      postVoting: false,
      onlyPostVoting: true,
      appliedTemplate: ''
    };
    await store.saveTopicDraft(linux);
    await store.saveLastTopicCreationSource('yaohuo');
    vi.resetModules();
    const reopened = await load();
    expect(await reopened.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft(3));
    expect(await reopened.loadTopicDraft('nodeseek', 'nodeseek:84')).toEqual(draft(1, 'nodeseek:84'));
    expect(await reopened.loadTopicDraft('linuxdo', 'linuxdo:42')).toMatchObject({
      tags: [],
      body: draft().body,
      onlyPostVoting: true
    });
    expect(await reopened.readLastTopicCreationSource()).toBe('yaohuo');
  });

  it('prevents late saves from resurrecting discarded or published drafts', async () => {
    const store = await load();
    await store.saveTopicDraft(draft());
    expect(await store.discardTopicDraft('nodeseek', 'nodeseek:42', 'draft-one', 0)).toBe(false);
    expect(await store.discardTopicDraft('nodeseek', 'nodeseek:42', 'draft-one', 1)).toBe(true);
    expect(await store.saveTopicDraft(draft(100))).toBe(false);
    const next = { ...draft(), id: 'draft-two' };
    expect(await store.saveTopicDraft(next)).toBe(true);
    await store.beginTopicSubmissionAttempt(attempt(next));
    expect(await store.settleTopicSubmissionAttempt(attempt(next), { status: 'enqueued', message: '等待审核' })).toBe(
      true
    );
    expect(await store.loadTopicDraft('nodeseek', 'nodeseek:42')).toBeNull();
    expect(await store.saveTopicDraft({ ...next, revision: 100 })).toBe(false);
    expect(await store.saveTopicDraft(draft(100))).toBe(false);
  });

  it('recovers an interrupted send as unknown and blocks resending even after its draft is discarded', async () => {
    const store = await load();
    await store.saveTopicDraft(draft());
    await store.beginTopicSubmissionAttempt(attempt());
    await expect(store.acknowledgeTopicSubmissionAttempt('nodeseek', 'nodeseek:42', 'attempt-one')).rejects.toThrow(
      '仍在进行'
    );
    vi.resetModules();
    const reopened = await load();
    expect(await reopened.readTopicSubmissionAttempt('nodeseek', 'nodeseek:42')).toMatchObject({ status: 'unknown' });
    await expect(reopened.beginTopicSubmissionAttempt(attempt(draft(), 'attempt-two'))).rejects.toThrow('勿重复发送');
    await reopened.discardTopicDraft('nodeseek', 'nodeseek:42', 'draft-one');
    const next = { ...draft(), id: 'draft-two' };
    await reopened.saveTopicDraft(next);
    await expect(reopened.beginTopicSubmissionAttempt(attempt(next, 'attempt-two'))).rejects.toThrow('勿重复发送');
    expect(await reopened.acknowledgeTopicSubmissionAttempt('nodeseek', 'nodeseek:42', 'wrong')).toBe(false);
    expect(await reopened.acknowledgeTopicSubmissionAttempt('nodeseek', 'nodeseek:42', 'attempt-one')).toBe(true);
    await reopened.beginTopicSubmissionAttempt(attempt(next, 'attempt-two'));
  });

  it('clears only the submitted version and never lets a late result replace a newer receipt', async () => {
    const store = await load();
    await store.saveTopicDraft(draft());
    await store.beginTopicSubmissionAttempt(attempt());
    await store.saveTopicDraft(draft(2));
    await store.settleTopicSubmissionAttempt(attempt(), { status: 'posted', message: '已发布' });
    expect(await store.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft(2));
    expect(await store.settleTopicSubmissionAttempt(attempt(), { status: 'unknown', message: '旧异常' })).toBe(false);
    await store.beginTopicSubmissionAttempt(attempt(draft(2), 'attempt-two'));
    expect(await store.settleTopicSubmissionAttempt(attempt(), { status: 'posted', message: '迟到' })).toBe(false);
    await store.settleTopicSubmissionAttempt(attempt(draft(2), 'attempt-two'), {
      status: 'rejected',
      message: '被拒绝'
    });
    expect(await store.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft(2));
  });

  it('rolls back receipt and deletion together on disk failure and preserves corrupted data', async () => {
    const store = await load();
    await store.saveTopicDraft(draft());
    await store.beginTopicSubmissionAttempt(attempt());
    harness.fail = 'DELETE FROM topic_drafts';
    await expect(
      store.settleTopicSubmissionAttempt(attempt(), { status: 'posted', message: '已发布' })
    ).rejects.toThrow('disk');
    expect(await store.loadTopicDraft('nodeseek', 'nodeseek:42')).toEqual(draft());
    vi.resetModules();
    const reopened = await load();
    expect(await reopened.readTopicSubmissionAttempt('nodeseek', 'nodeseek:42')).toMatchObject({ status: 'unknown' });
    const db = inspect();
    db.prepare("UPDATE topic_drafts SET payload='{broken'").run();
    await expect(reopened.loadTopicDraft('nodeseek', 'nodeseek:42')).rejects.toThrow('损坏');
    await expect(reopened.saveTopicDraft(draft(2))).rejects.toThrow('损坏');
    await expect(reopened.discardTopicDraft('nodeseek', 'nodeseek:42', 'draft-one')).rejects.toThrow('损坏');
    expect(db.prepare('SELECT payload FROM topic_drafts').get()).toEqual({ payload: '{broken' });
  });

  it('requires a durable matching snapshot before sending and preserves unknown results', async () => {
    const store = await load();
    await expect(store.beginTopicSubmissionAttempt(attempt())).rejects.toThrow('尚未保存');
    await store.saveTopicDraft(draft());
    await expect(store.beginTopicSubmissionAttempt(attempt(draft(2)))).rejects.toThrow('已变化');
    await store.beginTopicSubmissionAttempt(attempt());
    await store.settleTopicSubmissionAttempt(attempt(), { status: 'unknown', message: '连接中断' });
    vi.resetModules();
    const reopened = await load();
    expect(await reopened.readTopicSubmissionAttempt('nodeseek', 'nodeseek:42')).toMatchObject({
      status: 'unknown',
      result: { message: '连接中断' }
    });
    await expect(reopened.beginTopicSubmissionAttempt(attempt(draft(), 'new'))).rejects.toThrow('勿重复发送');
  });

  it('allows explicit reconciliation after a receipt write fails without releasing another active send', async () => {
    const store = await load();
    await store.saveTopicDraft(draft());
    await store.beginTopicSubmissionAttempt(attempt());
    const other = draft(1, 'nodeseek:84');
    await store.saveTopicDraft(other);
    await store.beginTopicSubmissionAttempt(attempt(other));
    harness.fail = 'UPDATE topic_submission_attempts';
    await expect(
      store.settleTopicSubmissionAttempt(attempt(), { status: 'rejected', message: '未发布' })
    ).rejects.toThrow('disk');
    expect(await store.readTopicSubmissionAttempt('nodeseek', 'nodeseek:42')).toMatchObject({ status: 'unknown' });
    await expect(store.beginTopicSubmissionAttempt(attempt(draft(), 'new'))).rejects.toThrow('勿重复发送');
    expect(await store.acknowledgeTopicSubmissionAttempt('nodeseek', 'nodeseek:42', 'attempt-one')).toBe(true);
    expect(await store.readTopicSubmissionAttempt('nodeseek', 'nodeseek:84')).toMatchObject({ status: 'sending' });
    await expect(store.acknowledgeTopicSubmissionAttempt('nodeseek', 'nodeseek:84', 'attempt-one')).rejects.toThrow(
      '仍在进行'
    );
  });

  it('does not replace a corrupt receipt or let an account acknowledge another account sending attempt', async () => {
    const store = await load();
    await store.saveTopicDraft(draft());
    await store.beginTopicSubmissionAttempt(attempt());
    const other = draft(1, 'nodeseek:84');
    await store.saveTopicDraft(other);
    await store.beginTopicSubmissionAttempt(attempt(other));
    await store.settleTopicSubmissionAttempt(attempt(other), { status: 'unknown', message: '待核实' });
    expect(await store.acknowledgeTopicSubmissionAttempt('nodeseek', 'nodeseek:84', 'attempt-one')).toBe(true);
    await expect(store.acknowledgeTopicSubmissionAttempt('nodeseek', 'nodeseek:42', 'attempt-one')).rejects.toThrow(
      '仍在进行'
    );
    const db = inspect();
    db.prepare('UPDATE topic_submission_attempts SET payload=?').run(
      JSON.stringify({ ...attempt(), status: 'posted' })
    );
    await expect(store.readTopicSubmissionAttempt('nodeseek', 'nodeseek:42')).rejects.toThrow('损坏');
    await expect(store.beginTopicSubmissionAttempt(attempt(draft(), 'new'))).rejects.toThrow('损坏');
    expect(
      (db.prepare('SELECT payload FROM topic_submission_attempts').get() as { payload: string }).payload
    ).toContain('posted');
  });
});
