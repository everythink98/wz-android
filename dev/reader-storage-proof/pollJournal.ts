import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDatabaseAsync } from 'expo-sqlite';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderTransaction, readReaderSnapshot } from '@/platform/storage/readerDatabase';
import * as reader from '@/platform/storage/readerDataStore';
import * as journal from '@/platform/persistence/nodeSeekPollJournal';
import { normalizePendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import { buildNodeSeekPollCreateRequest } from '@/sources/nodeseek/actionRequest';
import { nodeSeekCreatedPollId, runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import {
  prepareRequestToSend,
  withRequestBeforeSend,
  type Fetcher,
  type RequestDispatchState
} from '@/platform/network/request';

const sessionKey = 'reader-storage-poll-proof-session';
const transportCheckpointKey = 'reader-storage-poll-proof-transport';
const fingerprint = '0123456789abcdef';
const intent = (localId: string) => ({ localId, fingerprint });
const legacyKey = (identity: string) => `wz:composer:nodeseek-polls:${encodeURIComponent(identity)}`;
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function rejects(operation: Promise<unknown>, message: string) {
  let rejected = false;
  try {
    await operation;
  } catch {
    rejected = true;
  }
  check(rejected, message);
}

const actionPoll = (localId: string) =>
  normalizePendingNodeSeekPoll({
    localId,
    title: 'Synthetic journal transport proof',
    multiple: false,
    isPublic: true,
    options: ['Synthetic option A', 'Synthetic option B']
  });
const actionIdentity = (token: string) => `nodeseek:proof-${token}-transport`;
let pendingAction: { settled: boolean; operation: Promise<unknown> } | undefined;

// Exercise production action/request/journal seams, not a copy of the UI materializer.
// The actual controller's claim/retry orchestration remains owned by its UI tests.
export async function exercisePollActionTransport(token: string) {
  check(/^[a-f0-9]{32}$/.test(token), 'Invalid synthetic transport token');
  check((await AsyncStorage.getItem(transportCheckpointKey)) === null, 'Previous transport proof requires inspection');
  const identity = actionIdentity(token);
  const otherIdentity = `${identity}-other`;
  let transportAttempts = 0;
  let confirmPendingTransport!: () => void;
  const pendingTransportEntered = new Promise<void>((resolve) => {
    confirmPendingTransport = resolve;
  });

  const startAction = (localId: string, mode: 'known' | 'rejected' | 'unknown' | 'pending' | 'not-sent') => {
    const poll = actionPoll(localId);
    const dispatch: RequestDispatchState = { mayHaveSent: false };
    let guardCalls = 0;
    const fetcher: Fetcher = async (input, init) => {
      check(input === 'https://www.nodeseek.com/api/vote/info', 'Unexpected synthetic action endpoint');
      check(init?.method === 'POST', 'Synthetic poll did not use the production create request');
      const observer = await openDatabaseAsync('composer-journal.db', { useNewConnection: true });
      try {
        const row = await observer.getFirstAsync<{ remote_id: string | null }>(
          'SELECT remote_id FROM nodeseek_poll_journal WHERE identity_key=? AND local_id=? AND fingerprint=?',
          identity,
          poll.localId,
          poll.fingerprint
        );
        check(row?.remote_id === null, 'Transport began before the durable claim was visible to another connection');
      } finally {
        await observer.closeAsync();
      }
      const wire = prepareRequestToSend(init);
      check(dispatch.mayHaveSent, 'Final transport did not mark dispatch');
      check(
        JSON.stringify(JSON.parse(String(wire?.body))) ===
          JSON.stringify({
            title: poll.title,
            multiple: false,
            isPublic: true,
            items: poll.options
          }),
        'Production request changed the synthetic poll body'
      );
      transportAttempts++;
      if (mode === 'pending') {
        confirmPendingTransport();
        return new Promise<Response>(() => {});
      }
      return new Response(
        JSON.stringify(
          mode === 'rejected'
            ? { success: false, message: 'Synthetic rejection' }
            : mode === 'unknown'
              ? { success: true }
              : { success: true, data: { id: 901 } }
        ),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    };
    return {
      poll,
      dispatch,
      run: () =>
        runNodeSeekAction({
          request: buildNodeSeekPollCreateRequest({ poll }),
          timeoutMs: 0,
          fetcher: withRequestBeforeSend(
            fetcher,
            () => {
              if (mode === 'not-sent' && ++guardCalls === 2) throw new Error('Synthetic final guard rejected');
            },
            dispatch
          )
        })
    };
  };

  const known = startAction('poll_action_known', 'known');
  check((await journal.claimNodeSeekPollJournalEntry(identity, known.poll)).claimed, 'Known fixture claim failed');
  const remoteId = nodeSeekCreatedPollId(await known.run());
  await journal.saveNodeSeekPollJournalEntry(identity, { ...known.poll, remoteId });
  check(
    (await journal.readNodeSeekPollJournalEntry(otherIdentity, known.poll.localId, known.poll.fingerprint)) === null,
    'Confirmed result leaked to another account'
  );

  for (const mode of ['not-sent', 'rejected'] as const) {
    const action = startAction(`poll_action_${mode.replace('-', '_')}`, mode);
    check((await journal.claimNodeSeekPollJournalEntry(identity, action.poll)).claimed, 'Release fixture claim failed');
    let error: unknown;
    try {
      await action.run();
    } catch (caught) {
      error = caught;
    }
    check(error, 'Rejected synthetic action succeeded');
    check(action.dispatch.mayHaveSent === (mode === 'rejected'), 'Dispatch boundary misclassified an unsent request');
    if (mode === 'rejected')
      check((error as { serverRejected?: boolean }).serverRejected === true, 'Explicit rejection was not classified');
    await journal.releaseNodeSeekPollJournalEntry(identity, action.poll);
    check(
      (await journal.readNodeSeekPollJournalEntry(identity, action.poll.localId, action.poll.fingerprint)) === null,
      'Definitely rejected or unsent intent remained claimed'
    );
  }

  const unknown = startAction('poll_action_unknown', 'unknown');
  check((await journal.claimNodeSeekPollJournalEntry(identity, unknown.poll)).claimed, 'Unknown fixture claim failed');
  const unconfirmed = await unknown.run();
  await rejects(
    Promise.resolve().then(() => nodeSeekCreatedPollId(unconfirmed)),
    'Ambiguous response invented a remote id'
  );
  check(unknown.dispatch.mayHaveSent, 'Unknown response was treated as unsent');
  check(
    !(await journal.claimNodeSeekPollJournalEntry(identity, unknown.poll)).claimed,
    'Unknown response released its claim'
  );

  const inflight = startAction('poll_action_pending', 'pending');
  check((await journal.claimNodeSeekPollJournalEntry(identity, inflight.poll)).claimed, 'Pending fixture claim failed');
  const operation = inflight.run();
  const pending = { settled: false, operation };
  pendingAction = pending;
  void operation.then(
    () => {
      pending.settled = true;
    },
    () => {
      pending.settled = true;
    }
  );
  await Promise.race([
    pendingTransportEntered,
    operation.then(() => {
      throw new Error('Pending transport unexpectedly completed');
    })
  ]);
  // A separate account can still commit while the synthetic request remains outstanding.
  check(
    (await journal.claimNodeSeekPollJournalEntry(otherIdentity, inflight.poll)).claimed,
    'Network held the journal transaction'
  );
  await journal.releaseNodeSeekPollJournalEntry(otherIdentity, inflight.poll);
  check(!pending.settled && inflight.dispatch.mayHaveSent, 'Process checkpoint is not an in-flight request');
  check(transportAttempts === 4, 'Unexpected synthetic transport attempt count');
  await AsyncStorage.setItem(
    transportCheckpointKey,
    JSON.stringify({ token, transportAttempts, pendingAtCheckpoint: true })
  );
  check(!pending.settled, 'Request settled before the interruption receipt');
  return {
    transportAttempts,
    durableClaimObservedBeforeSend: true,
    knownResultPersisted: true,
    crossAccountIsolated: true,
    unsentReleased: true,
    explicitRejectionReleased: true,
    unconfirmedResponseRetained: true,
    networkOutsideTransaction: true,
    pendingAtCheckpoint: true
  };
}

export async function verifyReopenedPollActionTransport(token: string) {
  check(pendingAction === undefined, 'Transport proof must reopen in a new JS process');
  const checkpoint = JSON.parse((await AsyncStorage.getItem(transportCheckpointKey)) || 'null') as {
    token: string;
    transportAttempts: number;
    pendingAtCheckpoint: boolean;
  } | null;
  check(
    checkpoint?.token === token && checkpoint.transportAttempts === 4 && checkpoint.pendingAtCheckpoint,
    'Missing in-flight synthetic transport checkpoint'
  );
  const identity = actionIdentity(token);
  let retryTransports = 0;
  for (const [localId, remoteId] of [
    ['poll_action_known', '901'],
    ['poll_action_unknown', null],
    ['poll_action_pending', null]
  ] as const) {
    const poll = actionPoll(localId);
    const reservation = await journal.claimNodeSeekPollJournalEntry(identity, poll);
    check(
      !reservation.claimed && reservation.entry.remoteId === remoteId,
      'Reopen lost a transport claim or confirmed result'
    );
    const dispatch = { mayHaveSent: false };
    await rejects(
      runNodeSeekAction({
        request: buildNodeSeekPollCreateRequest({ poll }),
        timeoutMs: 0,
        fetcher: withRequestBeforeSend(
          async () => {
            retryTransports++;
            throw new Error('Unexpected synthetic retry');
          },
          () => check(reservation.claimed, 'Persisted reservation denies a new create'),
          dispatch
        )
      }),
      'Persisted intent allowed a synthetic create'
    );
    check(!dispatch.mayHaveSent, 'Denied create reached transport');
  }
  for (const localId of ['poll_action_not_sent', 'poll_action_rejected']) {
    const poll = actionPoll(localId);
    check(
      (await journal.claimNodeSeekPollJournalEntry(identity, poll)).claimed,
      'Released intent could not be reclaimed after reopen'
    );
    await journal.releaseNodeSeekPollJournalEntry(identity, poll);
  }
  check(retryTransports === 0, 'Reopened intents reached synthetic transport');
  return {
    pendingTransportRetained: true,
    unconfirmedResponseRetained: true,
    knownRemoteId: '901',
    retryTransports,
    releasedIntentsReusable: true
  };
}

export async function exercisePollJournal(token: string) {
  check((await AsyncStorage.getItem(sessionKey)) === null, 'Previous poll proof requires inspection');
  await AsyncStorage.setItem(sessionKey, token);
  const identity = `nodeseek:proof-${token}`;
  const legacyIdentity = `${identity}-legacy`;
  const corruptIdentity = `${identity}-corrupt`;
  const concurrent = intent('poll_concurrent');
  const claims = await Promise.all(
    Array.from({ length: 8 }, () => journal.claimNodeSeekPollJournalEntry(identity, concurrent))
  );
  check(claims.filter((claim) => claim.claimed).length === 1, 'Concurrent claims created multiple owners');
  await journal.saveNodeSeekPollJournalEntry(identity, { ...concurrent, remoteId: '501' });
  await journal.saveNodeSeekPollJournalEntry(identity, { ...concurrent, remoteId: null });
  await journal.releaseNodeSeekPollJournalEntry(identity, concurrent);
  await rejects(
    journal.saveNodeSeekPollJournalEntry(identity, { ...concurrent, remoteId: '502' }),
    'Conflicting remote id was accepted'
  );
  check(
    (await journal.readNodeSeekPollJournalEntry(identity, concurrent.localId, fingerprint))?.remoteId === '501',
    'Known remote id regressed'
  );
  await journal.claimNodeSeekPollJournalEntry(identity, intent('poll_pending'));
  for (let index = 0; index < 35; index++)
    await journal.saveNodeSeekPollJournalEntry(identity, {
      ...intent(`poll_many_${index}`),
      remoteId: String(600 + index)
    });
  check(
    (await journal.readNodeSeekPollJournalEntry(identity, 'poll_many_0', fingerprint))?.remoteId === '600',
    'Old known id was evicted after 32 entries'
  );
  const db = await openDatabaseAsync('composer-journal.db', { useNewConnection: true });
  try {
    await db.execAsync('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
    await db.runAsync(
      'INSERT INTO nodeseek_poll_journal(identity_key, local_id, fingerprint, remote_id) VALUES (?, ?, ?, ?)',
      identity,
      'poll_competing',
      fingerprint,
      '700'
    );
    const competing = journal.claimNodeSeekPollJournalEntry(identity, intent('poll_competing'));
    const unlock = new Promise<void>((resolve, reject) => {
      setTimeout(() => void db.execAsync('COMMIT').then(resolve, reject), 100);
    });
    const [result] = await Promise.all([competing, unlock]);
    check(!result.claimed && result.entry.remoteId === '700', 'Independent native writer lost its claim');
    check(
      (
        await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) AS count FROM nodeseek_poll_journal WHERE identity_key=?',
          identity
        )
      )?.count === 38,
      'Native journal lost or duplicated entries'
    );
  } finally {
    await db.closeAsync();
  }
  await AsyncStorage.setItem(
    legacyKey(legacyIdentity),
    JSON.stringify([
      { ...intent('poll_legacy_known'), remoteId: '801' },
      { ...intent('poll_legacy_pending'), remoteId: null }
    ])
  );
  check(
    (await journal.readNodeSeekPollJournalEntry(legacyIdentity, 'poll_legacy_known'))?.remoteId === '801',
    'Legacy known id did not migrate'
  );
  check((await AsyncStorage.getItem(legacyKey(legacyIdentity))) === null, 'Committed legacy key was retained');
  await AsyncStorage.setItem(legacyKey(corruptIdentity), '{broken');
  await rejects(
    journal.claimNodeSeekPollJournalEntry(corruptIdentity, intent('poll_blocked')),
    'Corrupt legacy allowed a claim'
  );
  check((await AsyncStorage.getItem(legacyKey(corruptIdentity))) === '{broken', 'Corrupt legacy was erased');

  await reader.loadReaderState();
  const readerDb = await openDatabaseAsync('reader-data.db', { useNewConnection: true });
  const original = await readReaderSnapshot(readerDb);
  try {
    await reader.importReaderDataBackup(JSON.stringify(createEmptyReaderData()));
    await reader.commitReaderCommand({ type: 'clear-history', at: new Date().toISOString() });
    check(Object.keys((await readReaderSnapshot(readerDb)).history).length === 0, 'Reader clear did not execute');
    check(
      (await journal.readNodeSeekPollJournalEntry(identity, concurrent.localId))?.remoteId === '501',
      'Reader import or clear changed the poll journal'
    );
    check(
      !(await journal.claimNodeSeekPollJournalEntry(identity, intent('poll_pending'))).claimed,
      'Reader import or clear released an uncertain poll'
    );
  } finally {
    await readerDb.execAsync('BEGIN IMMEDIATE');
    try {
      const writer = await ReaderTransaction.open(readerDb);
      await writer.replaceBackupSnapshot(original);
      await writer.finish();
      await readerDb.execAsync('COMMIT');
      check(
        JSON.stringify(await readReaderSnapshot(readerDb)) === JSON.stringify(original),
        'Reader fixture restore mismatch'
      );
    } catch (error) {
      await readerDb.execAsync('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await readerDb.closeAsync();
    }
  }
  const actionTransport = await exercisePollActionTransport(token);
  return {
    concurrentClaims: claims.length,
    winningClaims: 1,
    entries: 38,
    monotonic: true,
    competingWriter: true,
    legacyMigrated: true,
    corruptLegacyBlocked: true,
    readerImportClearIsolated: true,
    readerRestored: true,
    actionTransport
  };
}

export async function verifyReopenedPollJournal() {
  const token = await AsyncStorage.getItem(sessionKey);
  check(token && /^[a-f0-9]{32}$/.test(token), 'Missing owned poll proof session');
  const identity = `nodeseek:proof-${token}`;
  const identities = [
    identity,
    `${identity}-legacy`,
    `${identity}-corrupt`,
    actionIdentity(token),
    `${actionIdentity(token)}-other`
  ];
  for (const [localId, remoteId] of [
    ['poll_concurrent', '501'],
    ['poll_pending', null],
    ['poll_many_0', '600'],
    ['poll_many_34', '634'],
    ['poll_competing', '700']
  ] as const) {
    const claim = await journal.claimNodeSeekPollJournalEntry(identity, intent(localId));
    check(!claim.claimed && claim.entry.remoteId === remoteId, 'Reopened journal repeated or lost an intent');
  }
  check(
    !(await journal.claimNodeSeekPollJournalEntry(identities[1], intent('poll_legacy_pending'))).claimed,
    'Reopened legacy pending intent was lost'
  );
  await rejects(
    journal.claimNodeSeekPollJournalEntry(identities[2], intent('poll_blocked')),
    'Reopen bypassed corrupt legacy'
  );
  check((await AsyncStorage.getItem(legacyKey(identities[2]))) === '{broken', 'Reopen erased corrupt legacy');
  const actionTransport = await verifyReopenedPollActionTransport(token);
  const db = await openDatabaseAsync('composer-journal.db', { useNewConnection: true });
  try {
    const count = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM nodeseek_poll_journal WHERE identity_key=?',
      identity
    );
    check(count?.count === 38, 'Reopen changed journal cardinality');
    await db.execAsync('BEGIN IMMEDIATE');
    for (const account of identities) {
      await db.runAsync('DELETE FROM nodeseek_poll_journal WHERE identity_key=?', account);
      await db.runAsync('DELETE FROM nodeseek_poll_migration WHERE identity_key=?', account);
    }
    await db.execAsync('COMMIT');
  } finally {
    await db.closeAsync();
  }
  for (const account of identities) await AsyncStorage.removeItem(legacyKey(account));
  await AsyncStorage.removeItem(sessionKey);
  await AsyncStorage.removeItem(transportCheckpointKey);
  return {
    reopened: true,
    entries: 38,
    pendingRetained: true,
    knownRetained: true,
    corruptLegacyBlocked: true,
    ownFixtureRemoved: true,
    actionTransport
  };
}
