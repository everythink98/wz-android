import { openDatabaseAsync } from 'expo-sqlite';
import { useTopicComposerController } from '@/features/topic-composer/useTopicComposerController';
import type { TopicComposerRouteRuntimeValue } from '@/features/topic-composer/TopicComposerRouteRuntime';
import { draftFromTopicEdit, type TopicSubmissionAttempt } from '@/domain/forum/topicComposer';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import {
  beginTopicSubmissionAttempt,
  loadTopicDraft,
  readTopicSubmissionAttempt,
  saveTopicDraft,
  settleTopicSubmissionAttempt
} from '@/platform/persistence/topicDrafts';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { editYaohuoTopic, loadYaohuoTopicEditContext } from '@/sources/yaohuo/topicEditing';
import { projectTestAccountSessions, testAccountUser } from '../../tests/helpers/accountSessions';
import { createTopicEditTransport } from '../../tests/helpers/topicEditingTransport';
import { check } from '../proofCheck';

type Controller = ReturnType<typeof useTopicComposerController>;

export async function verifyEditorReceiptReview(host: {
  hook: (useValue: () => Controller) => Promise<() => Controller>;
  unmount: () => void | Promise<void>;
  until: (test: () => unknown, message: string) => Promise<void>;
}) {
  const source = 'yaohuo';
  const topicId = '123';
  const target = 'edit:123';
  const userId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  const identityKey = `yaohuo:${userId}`;
  const transport = createTopicEditTransport(source, userId);
  const options = { fetcher: transport.fetcher, userAgent: 'isolated-editor-receipt' };
  const context = await loadYaohuoTopicEditContext({ ...options, identityKey, topicId });
  const first = { ...draftFromTopicEdit(context), additionalReward: '1000' };
  const sent: TopicSubmissionAttempt = {
    id: `reward-${userId}`,
    source,
    identityKey,
    target,
    draftId: first.id,
    additionalReward: first.additionalReward,
    revision: first.revision,
    startedAt: Date.now(),
    status: 'sending'
  };
  const sessions = createSiteSessionStates();
  sessions.yaohuo = {
    ...sessions.yaohuo,
    status: 'logged-in',
    currentUser: { ...testAccountUser(source), id: userId }
  };
  const unexpected = () => {
    throw new Error('Unexpected service in isolated editor receipt check');
  };
  const runtime: TopicComposerRouteRuntimeValue = {
    enabledSources: [source],
    sessions: projectTestAccountSessions(sessions),
    sessionEpochs: initialForumSessionEpochs,
    appActive: true,
    fetcher: options.fetcher,
    ensureNetworkProxyReady: async () => {},
    ensureWritableSession: async () => ({ source, identityKey, sessionEpoch: 0 }),
    isWritableSessionTicketCurrent: (ticket) =>
      ticket.source === source && ticket.identityKey === identityKey && ticket.sessionEpoch === 0,
    getUserAgent: () => options.userAgent,
    getTopicEditContext: (request) => loadYaohuoTopicEditContext({ ...options, ...request }),
    getReadPlan: unexpected,
    getTopic: unexpected,
    getEmojiUrls: unexpected,
    getLinuxDoTopicCreationContext: unexpected,
    ensureNodeImageApiKey: unexpected,
    onSessionExpired: unexpected,
    requestAccountRecheck: unexpected,
    openAccount: unexpected,
    notify: () => {}
  };
  check(!(await loadTopicDraft(source, identityKey, target)), 'Receipt scope already contains a draft');
  check(
    !(await readTopicSubmissionAttempt(source, identityKey, target)),
    'Receipt scope already contains a submission'
  );
  check(await saveTopicDraft(first), 'Could not create the isolated editing draft');
  try {
    const get = await host.hook(function useEditor() {
      return useTopicComposerController({
        runtime,
        intent: { kind: 'edit', source, topicId },
        active: true,
        onPosted: unexpected,
        onAccepted: unexpected
      });
    });
    await host.until(() => get().editContext && !get().loading, 'Retained editor did not hydrate');
    check(get().draft?.additionalReward === '1000', 'Retained editor did not observe the original reward');
    await beginTopicSubmissionAttempt(sent);
    const receipt = await editYaohuoTopic({ ...options, draft: first });
    check(receipt.status === 'saved', 'Isolated source did not acknowledge the reward');
    const latest = '旧回执落盘前由另一个编辑器保存的新正文';
    get().change((value) => ({ ...value, body: latest }));
    await get().flush();
    check((await loadTopicDraft(source, identityKey, target))?.body === latest, 'New content was not durable');
    check(await settleTopicSubmissionAttempt(sent, receipt), 'Could not settle the original reward');
    await get().submit();
    const writes = transport.writes().map((write) => new URLSearchParams(write.body));
    check(
      writes.length === 2 &&
        writes[0]?.get('additionalReward') === '1000' &&
        !writes[1]?.has('additionalReward') &&
        writes[1]?.get('book_content') === latest,
      'Retained editor lost the new content or repeated the settled reward'
    );
    check(transport.blockedRequests() === 0, 'Unexpected transport in isolated edit');
    check(!(await loadTopicDraft(source, identityKey, target)), 'Submitted revision remained in SQLite');
    check((await readTopicSubmissionAttempt(source, identityKey, target))?.status === 'saved', 'Missing final receipt');
  } finally {
    await host.unmount();
    const db = await openDatabaseAsync('topic-drafts.db', { useNewConnection: true });
    try {
      await db.withExclusiveTransactionAsync(async (transaction) => {
        for (const table of ['topic_drafts', 'topic_submission_attempts'])
          await transaction.runAsync(
            `DELETE FROM ${table} WHERE source=? AND identity_key=? AND target=?`,
            source,
            identityKey,
            target
          );
        await transaction.runAsync(
          'DELETE FROM discarded_topic_drafts WHERE source=? AND identity_key=? AND target=? AND draft_id=?',
          source,
          identityKey,
          target,
          first.id
        );
      });
    } finally {
      await db.closeAsync();
    }
  }
}
