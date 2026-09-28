import {
  fingerprintNodeSeekPoll,
  nodeSeekPendingPollTokenRanges,
  replacePendingNodeSeekPollToken,
  type PendingNodeSeekPoll
} from '@/domain/forum/structuredComposer';
import { createKeyedSerialRunner } from '@/platform/concurrency/keyedSerialRunner';
import {
  claimNodeSeekPollJournalEntry,
  readNodeSeekPollJournalEntry,
  releaseNodeSeekPollJournalEntry,
  saveNodeSeekPollJournalEntry
} from '@/platform/persistence/nodeSeekPollJournal';
import type { RequestDispatchState } from '@/platform/network/request';
import { nodeSeekCreatedPollId } from './actionClient';

const creations = createKeyedSerialRunner<string>();

export class PendingNodeSeekPollError extends Error {
  constructor(
    message: string,
    readonly outcome: 'blocked' | 'canceled' = 'blocked'
  ) {
    super(message);
  }
}

export type PendingNodeSeekPollCreation = {
  dispatchState: RequestDispatchState;
  persistResult(result: unknown): Promise<void>;
};

export async function materializePendingNodeSeekPolls({
  content,
  polls,
  identityKey,
  assertCurrent,
  confirmReplacement,
  createPoll,
  notify
}: {
  content: string;
  polls: PendingNodeSeekPoll[];
  identityKey: string;
  assertCurrent: () => void;
  confirmReplacement: (poll: PendingNodeSeekPoll) => Promise<boolean>;
  createPoll: (poll: PendingNodeSeekPoll, lifecycle: PendingNodeSeekPollCreation) => Promise<unknown>;
  notify: (message: string) => void;
}) {
  let markdown = content;
  const invalid = (message: string) => {
    notify(message);
    return new PendingNodeSeekPollError(message);
  };
  const tokenRanges = nodeSeekPendingPollTokenRanges(content);
  const tokenIds = tokenRanges.map((range) => range.localId);
  const pollIds = polls.map((poll) => poll.localId);
  if (
    content.split('<!-- wz:nodeseek-poll:').length - 1 !== tokenRanges.length ||
    tokenIds.length !== polls.length ||
    new Set(tokenIds).size !== tokenIds.length ||
    new Set(pollIds).size !== pollIds.length ||
    tokenIds.some((id) => !pollIds.includes(id))
  )
    throw invalid('本地投票数据不完整，请移除后重新插入');
  for (const poll of polls) {
    assertCurrent();
    if (fingerprintNodeSeekPoll(poll) !== poll.fingerprint) throw invalid('投票草稿校验失败，请重新打开投票编辑器');
  }
  const confirmedReplacements = new Set<string>();
  const unknown = () => invalid('该投票上次创建结果未知。请先到 NodeSeek 原站确认，修改或移除投票后再发送。');
  const checkedRemoteId = async (poll: PendingNodeSeekPoll) => {
    assertCurrent();
    const journal = await readNodeSeekPollJournalEntry(identityKey, poll.localId, poll.fingerprint);
    assertCurrent();
    if (journal?.remoteId) return journal.remoteId;
    if (journal) throw unknown();
    const previous = await readNodeSeekPollJournalEntry(identityKey, poll.localId);
    assertCurrent();
    if (previous && !confirmedReplacements.has(poll.localId)) {
      if (!(await confirmReplacement(poll))) throw new PendingNodeSeekPollError('已取消创建新投票', 'canceled');
      confirmedReplacements.add(poll.localId);
    }
    assertCurrent();
    return undefined;
  };
  const key = (poll: PendingNodeSeekPoll) => `${identityKey}\u0000${poll.localId}\u0000${poll.fingerprint}`;
  // Check the entire draft before creating any remote object.
  for (const poll of polls) await creations.run(key(poll), () => checkedRemoteId(poll));
  for (const poll of polls) {
    const intent = { localId: poll.localId, fingerprint: poll.fingerprint };
    const remoteId = await creations.run(key(poll), async () => {
      const existing = await checkedRemoteId(poll);
      if (existing) return existing;
      const reservation = await claimNodeSeekPollJournalEntry(identityKey, intent);
      if (!reservation.claimed) {
        if (reservation.entry.remoteId) return reservation.entry.remoteId;
        throw unknown();
      }
      const dispatchState: RequestDispatchState = { mayHaveSent: false };
      let createdId = '';
      const persistResult = async (result: unknown) => {
        createdId = nodeSeekCreatedPollId(result);
        await saveNodeSeekPollJournalEntry(identityKey, { ...intent, remoteId: createdId });
      };
      try {
        assertCurrent();
        const result = await createPoll(poll, { dispatchState, persistResult });
        if (!createdId) await persistResult(result);
        assertCurrent();
        return createdId;
      } catch (error) {
        const failure =
          error && typeof error === 'object' ? (error as { reason?: unknown; serverRejected?: unknown }) : null;
        if (!createdId && (!dispatchState.mayHaveSent || failure?.reason === 'http-401' || failure?.serverRejected))
          await releaseNodeSeekPollJournalEntry(identityKey, intent);
        else if (!createdId) notify('投票创建结果未知。请先到 NodeSeek 原站确认，修改或移除投票后再发送。');
        throw error;
      }
    });
    markdown = replacePendingNodeSeekPollToken(markdown, poll.localId, remoteId);
  }
  if (markdown.includes('<!-- wz:nodeseek-poll:')) throw invalid('本地投票数据不完整，请移除后重新插入');
  return markdown;
}
