import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { Reply, TopicDetail } from '@/domain/forum/models';
import type { SessionSite } from '@/domain/session/siteSessionState';
import { createSiteSessionStates } from '@/domain/session/siteSessionState';
import {
  ensureWritableSessionTicket,
  validateWritableSessionTicket,
  type WritableSessionSnapshot
} from '@/domain/session/writableSessionGate';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { forumQueryKeys } from '@/platform/query/serverState';
import type { Fetcher } from '@/platform/network/request';
import { useTopicSessionController } from '@/features/topic/useTopicSessionController';
import { useTopicActionsController } from '@/features/topic/actions/useTopicActionsController';
import { ReplyComposerSheet } from '@/features/topic/components/ReplyComposerSheet';
import { createTopicStyles } from '@/features/topic/styles';
import { useReaderThemeStyles } from '@/ui/theme/ReaderStyleProvider';
import { projectTestAccountSessions, testAccountUser } from '../helpers/accountSessions';

export type ComposerOutcome = 'success' | 'network-error' | 'rejected' | 'unconfirmed' | 'refresh-error';
export type ComposerEntry = 'reply' | 'floor' | 'edit' | 'message';
export const COMPOSER_DRAFT = 'Local mock reply; never sent.';

// HTTP/adapter boundary only. The callers, mutation, parser and composer remain production code.
export function createComposerTransport(outcome: ComposerOutcome = 'success', hold = false, delayMs = 0) {
  const requests: { path: string; method: string; body: string }[] = [];
  const waiters = new Set<() => void>();
  let stopped = false;
  const transport = {
    outcome,
    hold,
    requests,
    confirmations: 0,
    refreshes: 0,
    delayMs,
    onChange: () => {},
    setObserver(observer: () => void) {
      transport.onChange = observer;
    },
    setOutcome(next: ComposerOutcome) {
      transport.outcome = next;
    },
    confirm() {
      transport.confirmations++;
      transport.onChange();
    },
    release() {
      transport.hold = false;
      waiters.forEach((release) => release());
      waiters.clear();
    },
    dispose() {
      stopped = true;
      transport.release();
    },
    async respond(signal?: AbortSignal | null) {
      if (transport.delayMs) await new Promise((resolve) => setTimeout(resolve, transport.delayMs));
      if (transport.hold) {
        await new Promise<void>((resolve) => {
          const release = () => {
            signal?.removeEventListener('abort', release);
            waiters.delete(release);
            resolve();
          };
          waiters.add(release);
          if (signal?.aborted) release();
          else signal?.addEventListener('abort', release, { once: true });
        });
      }
      if (stopped || signal?.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      if (transport.outcome === 'network-error') throw new Error('Mock network offline');
    },
    async refresh() {
      transport.refreshes++;
      if (transport.outcome === 'refresh-error') return false;
      return true;
    },
    fetcher: (async (input, init) => {
      const url = new URL(input);
      const method = init?.method || 'GET';
      if (url.origin === 'https://linux.do' && url.pathname === '/session/csrf' && method === 'GET')
        return new Response(JSON.stringify({ csrf: 'synthetic-csrf' }));
      if (url.origin === 'https://www.yaohuo.me' && url.pathname === '/bbs-42.html' && method === 'GET')
        return new Response(
          '<form action="/bbs/book_re.aspx"><input name="id" value="42"><input name="__CSRFToken" value="synthetic-csrf"></form>'
        );
      const allowed =
        (url.origin === 'https://www.nodeseek.com' &&
          ['/api/content/new-comment', '/api/content/edit-comment'].includes(url.pathname) &&
          method === 'POST') ||
        (url.origin === 'https://linux.do' &&
          ((url.pathname === '/posts.json' && method === 'POST') ||
            (url.pathname === '/posts/101.json' && method === 'PUT'))) ||
        (url.origin === 'https://www.yaohuo.me' && url.pathname === '/bbs/book_re.aspx' && method === 'POST');
      if (!allowed) throw new Error(`Unmatched mock request: ${method} ${url.origin}${url.pathname}`);
      requests.push({ path: url.pathname, method, body: String(init?.body || '') });
      transport.onChange();
      await transport.respond(init?.signal);
      if (transport.outcome === 'rejected')
        return new Response(JSON.stringify({ success: false, errors: ['Mock rejected'], message: 'Mock rejected' }), {
          status: 403
        });
      if (transport.outcome === 'unconfirmed')
        return new Response(url.hostname.includes('yaohuo') ? '<div class="tip">正在处理</div>' : 'invalid response');
      transport.confirm();
      return new Response(
        url.hostname.includes('yaohuo')
          ? '<div class="tip">评论成功</div>'
          : JSON.stringify({ success: true, id: 101, topic_id: 42, post_number: 2 })
      );
    }) satisfies Fetcher
  };
  return transport;
}

export type ComposerTransport = ReturnType<typeof createComposerTransport>;
export type ComposerObservation = { visible: boolean; content: string; busy: boolean; intent: string; notice: string };

export function composerAccount(source: SessionSite, epoch = 0) {
  const user = testAccountUser(source);
  const states = createSiteSessionStates();
  states[source] = { ...states[source], status: 'logged-in', currentUser: user };
  const sessions = projectTestAccountSessions(states);
  const snapshot: WritableSessionSnapshot = {
    source,
    authenticated: true,
    authSurfaceOpen: false,
    identityKey: `${source}:${user.id}`,
    identityTrust: sessions[source].identityTrust,
    sessionEpoch: epoch,
    sourceEnabled: true
  };
  return { sessions, snapshot };
}

export function TopicSubmissionFixture({
  source = 'nodeseek',
  entry = 'reply',
  transport,
  observe,
  topicId = '42',
  epoch = 0,
  active = true,
  reopenAfterSuccess = false
}: {
  source?: SessionSite;
  entry?: Exclude<ComposerEntry, 'message'>;
  transport: ComposerTransport;
  observe?: (state: ComposerObservation) => void;
  topicId?: string;
  epoch?: number;
  active?: boolean;
  reopenAfterSuccess?: boolean;
}) {
  const { styles, theme } = useReaderThemeStyles(createTopicStyles);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [touches, setTouches] = useState(0);
  const account = useMemo(() => composerAccount(source, epoch), [source, epoch]);
  const sessionEpochs = useMemo(() => ({ ...initialForumSessionEpochs, [source]: epoch }), [source, epoch]);
  const topic = useMemo<TopicDetail>(
    () => ({
      source,
      id: topicId,
      title: 'Local composer proof',
      author: 'fixture',
      url: 'https://example.invalid/topic',
      createdAt: '2026-09-18T00:00:00Z',
      replyCount: 1,
      canCreatePost: true,
      categoryId: '177',
      contentHtml: '<p>Local topic</p>',
      replies: []
    }),
    [source, topicId]
  );
  const reply = useMemo<Reply>(
    () => ({
      author: 'fixture-user',
      authorId: '123',
      floor: 2,
      commentId: 101,
      canEdit: true,
      contentHtml: '<p>Original reply</p>',
      contentMarkdown: COMPOSER_DRAFT,
      createdAt: '2026-09-18T00:01:00Z'
    }),
    []
  );
  const topicSession = useTopicSessionController({ topic, notify: setNotice });
  const { state, commands } = topicSession;
  const actions = useTopicActionsController({
    active,
    sessionEpochs,
    linuxDoUserAgent: () => 'composer-proof',
    showLinuxDoVerification: (message) => setNotice(message || ''),
    ensureNodeImageApiKey: async () => 'synthetic-api-key',
    ensureWritableSession: () =>
      ensureWritableSessionTicket(
        () => account.snapshot,
        async () => ({ status: 'same' })
      ),
    isWritableSessionTicketCurrent: (ticket) => validateWritableSessionTicket(ticket, account.snapshot),
    fetcher: transport.fetcher,
    getNodeSeekUserAgent: () => 'composer-proof',
    notify: setNotice,
    onSessionExpired: () => {},
    requestAccountRecheck: () => {},
    readGateway: {
      getReadPlan: () => ({
        state: 'ready',
        lane: 'authenticated',
        authenticated: true,
        transport: 'managed-session',
        cacheScope: 'composer-proof'
      })
    },
    refreshTopicReplies: transport.refresh,
    siteSessionViewModels: account.sessions,
    topicDetail: topic,
    topicReplies: [reply],
    topicSession
  });
  const visible = state.replyComposerIntent.kind !== 'closed';
  const reopened = useRef(false);
  useEffect(() => {
    if (reopenAfterSuccess && transport.confirmations === 1 && !visible && !reopened.current) {
      reopened.current = true;
      commands.composer.toggle(true);
    }
  }, [commands.composer, reopenAfterSuccess, transport, visible]);
  useEffect(() => {
    observe?.({
      visible,
      content: state.replyContent,
      busy: actions.actionBusy,
      intent: state.replyComposerIntent.kind,
      notice
    });
  }, [observe, visible, state.replyContent, state.replyComposerIntent.kind, actions.actionBusy, notice]);
  function open() {
    setNotice('');
    if (entry === 'edit') {
      const detailKey = forumQueryKeys.topic({
        source,
        topicId,
        scope: sessionEpochs,
        readPlanScope: 'composer-proof'
      });
      queryClient.setQueryData(forumQueryKeys.replies(detailKey, 'oldest', 'composer-proof'), {
        pages: [{ items: [reply], hasMore: false, nextPage: null }],
        pageParams: [null]
      });
      commands.composer.editReply({
        commentId: 101,
        floor: 2,
        contentMarkdown: COMPOSER_DRAFT,
        topicId,
        ticket: account.snapshot
      });
    } else if (entry === 'floor') commands.composer.replyToFloor(reply);
    else commands.composer.toggle(true);
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingTop: 70, paddingHorizontal: 12, gap: 8 }}>
        <Button title="打开测试回复" onPress={open} />
        <Button title="打开空白回复" onPress={() => commands.composer.toggle(true)} />
        <Button title="填入测试草稿" onPress={() => commands.composer.changeContent(COMPOSER_DRAFT)} />
        <Button title="底层按钮" onPress={() => setTouches((value) => value + 1)} />
        <Text testID="composer-proof-touch">{`touches=${touches}`}</Text>
        <Text testID="composer-proof-state">
          {JSON.stringify({ visible, content: state.replyContent, busy: actions.actionBusy })}
        </Text>
        <Text testID="composer-proof-notice">{notice}</Text>
      </View>
      <ReplyComposerSheet
        actionBusy={actions.actionBusy}
        intent={state.replyComposerIntent}
        replyContent={state.replyContent}
        replyFace={state.replyFace}
        source={source}
        topicId={topicId}
        styles={styles}
        theme={theme}
        visible={visible}
        routeActive={active}
        pendingNodeSeekPolls={state.replyPendingNodeSeekPolls}
        onReplyComposerOpenChange={commands.composer.toggle}
        onReplyContentChange={commands.composer.changeContent}
        onReplyFaceChange={commands.composer.changeFace}
        onReplySnapshot={commands.composer.changeSnapshot}
        onSubmitReply={actions.submitReply}
        onUploadReplyImage={actions.uploadReplyImage}
      />
    </View>
  );
}
