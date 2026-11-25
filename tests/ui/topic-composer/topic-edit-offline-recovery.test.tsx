import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useLayoutEffect, useState } from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { DatabaseSync } from 'node:sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sqliteParameters as mockSqliteParameters } from '../../helpers/sqliteParameters';
import { createTopicEditTransport } from '../../helpers/topicEditingTransport';
import { createTopicProofTransport } from '../../helpers/topicCreationTransport';
import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { createSiteSessionStates, siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import {
  draftFromTopicEdit,
  type TopicComposerIntent,
  type TopicCreationSource,
  type TopicDraft,
  type TopicDraftAttachment,
  type TopicEditContext,
  type TopicSubmissionAttempt
} from '@/domain/forum/topicComposer';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { prepareRequestToSend, type Fetcher } from '@/platform/network/request';
import * as topicDraftStore from '@/platform/persistence/topicDrafts';
import { loadTopicDraft, readTopicSubmissionAttempt, saveTopicDraft } from '@/platform/persistence/topicDrafts';
import { loadLinuxDoTopicCreationContext } from '@/sources/linuxdo/topicCreation';
import { loadLinuxDoTopicEditContext } from '@/sources/linuxdo/topicEditing';
import { loadNodeSeekTopicEditContext } from '@/sources/nodeseek/topicEditing';
import { loadYaohuoTopicEditContext } from '@/sources/yaohuo/topicEditing';
import { useTopicComposerController } from '@/features/topic-composer/useTopicComposerController';
import type { TopicComposerRouteRuntimeValue } from '@/features/topic-composer/TopicComposerRouteRuntime';
import { TopicComposerScreen } from '@/features/topic-composer/TopicComposerScreen';
import { act, fireEvent, render, waitFor } from '../render';

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  default: {
    ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated').default,
    View: require('react-native').View,
    createAnimatedComponent: (component: unknown) => component
  },
  useAnimatedKeyboard: () =>
    (require('react') as typeof import('react')).useRef({ height: { value: 0 }, state: { value: 0 } }).current,
  useSharedValue: (value: unknown) =>
    (require('react') as typeof import('react')).useRef({
      value,
      set(next: unknown) {
        this.value = next;
      }
    }).current,
  useAnimatedStyle: (factory: () => unknown) => factory(),
  runOnUI: (callback: (...args: unknown[]) => unknown) => callback,
  runOnJS:
    <T extends unknown[]>(callback: (...args: T) => unknown) =>
    (...args: T) =>
      callback(...args),
  useAnimatedReaction: () => {}
}));

const mockDatabases = new Map<string, DatabaseSync>();
const mockExistingFiles = new Set<string>();
let mockDraftWriteCount = 0;
let mockSqlReadFailure = '';

jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    create() {}
  }
  class File extends Directory {
    get exists() {
      return !this.uri.includes('/topic-draft-attachments/') || mockExistingFiles.has(this.uri);
    }
    delete() {}
  }
  return { Directory, File, Paths: { document: 'file:///private', cache: 'file:///cache' } };
});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => {
    const { DatabaseSync } = jest.requireActual<typeof import('node:sqlite')>('node:sqlite');
    const db = mockDatabases.get(name) || new DatabaseSync(':memory:');
    mockDatabases.set(name, db);
    return {
      execAsync: async (sql: string) => db.exec(sql),
      runAsync: async (sql: string, ...args: unknown[]) => {
        if (/INSERT INTO topic_drafts|UPDATE topic_drafts/i.test(sql)) mockDraftWriteCount += 1;
        return db.prepare(sql).run(...mockSqliteParameters(args));
      },
      getFirstAsync: async (sql: string, ...args: unknown[]) => {
        if (mockSqlReadFailure && sql.includes(mockSqlReadFailure)) {
          mockSqlReadFailure = '';
          throw new Error('storage read unavailable');
        }
        return db.prepare(sql).get(...mockSqliteParameters(args)) ?? null;
      },
      getAllAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...mockSqliteParameters(args)),
      closeAsync: async () => undefined
    };
  }
}));

let sequence = 0;

function sessionsFor(id: string) {
  return projectTestAccountSessions(
    createSiteSessionStates(
      Object.fromEntries(
        (['nodeseek', 'linuxdo', 'yaohuo'] as const).map((site) => [
          site,
          {
            site,
            status: 'logged-in',
            cookieSummary: ['fixture'],
            isVerifying: false,
            currentUser: { ...testAccountUser(site), id }
          }
        ])
      )
    )
  );
}

function createRuntime({
  accountId,
  fetcher,
  getTopicEditContext,
  appActive = true
}: {
  accountId: string;
  fetcher: Fetcher;
  getTopicEditContext?: TopicComposerRouteRuntimeValue['getTopicEditContext'];
  appActive?: boolean;
}): TopicComposerRouteRuntimeValue {
  const sessions = sessionsFor(accountId);
  return {
    enabledSources: ['nodeseek', 'linuxdo', 'yaohuo'],
    sessions,
    sessionEpochs: { ...initialForumSessionEpochs },
    appActive,
    fetcher,
    ensureNetworkProxyReady: async () => undefined,
    ensureWritableSession: async (site) => ({
      source: site,
      identityKey: siteSessionIdentityKey(sessions[site]),
      sessionEpoch: 0
    }),
    isWritableSessionTicketCurrent: () => true,
    onSessionExpired: jest.fn(),
    requestAccountRecheck: jest.fn(),
    ensureNodeImageApiKey: async () => null,
    getUserAgent: () => 'fixture',
    getReadPlan: (site, operation) => ({
      source: site,
      operation,
      state: 'ready',
      lane: 'authenticated',
      transport: 'managed-session',
      cacheScope: 'authenticated:0'
    }),
    getTopic: async () => {
      throw new Error('No cached topic in fixture');
    },
    getTopicEditContext:
      getTopicEditContext ||
      ((options) => {
        const input = { ...options, fetcher };
        return options.source === 'linuxdo'
          ? loadLinuxDoTopicEditContext(input)
          : options.source === 'nodeseek'
            ? loadNodeSeekTopicEditContext(input)
            : loadYaohuoTopicEditContext(input);
      }),
    getEmojiUrls: async () => ({}),
    getLinuxDoTopicCreationContext: ({ signal }) =>
      loadLinuxDoTopicCreationContext({ fetcher, userAgent: 'fixture', signal }),
    openAccount: jest.fn<TopicComposerRouteRuntimeValue['openAccount']>(),
    notify: jest.fn()
  };
}

type Controller = ReturnType<typeof useTopicComposerController>;

function ComposerTestHost({
  runtime,
  intent,
  active = true,
  onPosted = jest.fn(),
  onAccepted = jest.fn(),
  onEdited = jest.fn(),
  onController
}: {
  runtime: TopicComposerRouteRuntimeValue;
  intent: TopicComposerIntent;
  active?: boolean;
  onPosted?: () => void;
  onAccepted?: () => void;
  onEdited?: (source: TopicCreationSource, topicId: string) => void;
  onController: (controller: Controller) => void;
}) {
  const controller = useTopicComposerController({
    runtime,
    intent,
    active,
    onPosted,
    onAccepted,
    onEdited
  });
  useLayoutEffect(() => {
    onController(controller);
  });
  const [onBack] = useState(() => jest.fn());
  const [onManageSources] = useState(() => jest.fn());
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 400, height: 800 },
        insets: { top: 24, left: 0, right: 0, bottom: 24 }
      }}
    >
      <TopicComposerScreen
        active={active && runtime.appActive}
        editorEnabled
        controller={controller}
        sessions={runtime.sessions}
        enabledSources={runtime.enabledSources}
        onBack={onBack}
        onOpenAccount={runtime.openAccount}
        onManageSources={onManageSources}
      />
    </SafeAreaProvider>
  );
}

function initialDocumentFromWebView(webView: ReturnType<Awaited<ReturnType<typeof render>>['getByTestId']>) {
  const html = String(webView.props.source?.html || '');
  const raw = html.match(/id="composer-initial-document">([\s\S]*?)<\/script>/)?.[1];
  return raw ? JSON.parse(raw) : null;
}

type BridgeMessage = {
  type: string;
  payload?: {
    documentEpoch?: number;
    markdown?: string;
    mode?: 'rich' | 'source';
    readOnly?: boolean;
    requestId?: string;
  };
};

async function attachWebViewBridge(
  webView: ReturnType<Awaited<ReturnType<typeof render>>['getByTestId']>,
  { deferReady = false } = {}
) {
  const initial = initialDocumentFromWebView(webView) as BridgeMessage | null;
  const state = {
    documentEpoch: initial?.payload?.documentEpoch ?? 0,
    markdown: initial?.payload?.markdown ?? '',
    mode: (initial?.payload?.mode ?? 'source') as 'rich' | 'source',
    readOnly: Boolean(initial?.payload?.readOnly),
    revision: 0,
    messages: [] as BridgeMessage[]
  };
  const reply = (type: string, payload: unknown) => {
    void Promise.resolve().then(() => {
      webView.props.onMessage?.({ nativeEvent: { data: JSON.stringify({ type, payload }) } });
    });
  };
  const emitReady = (documentEpoch = state.documentEpoch) =>
    fireEvent(webView, 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'READY', payload: { documentEpoch, revision: 0 } }) }
    });
  webView.props.postMessageMock.mockImplementation((raw: string) => {
    const parsed = JSON.parse(raw) as BridgeMessage;
    state.messages.push(parsed);
    if (parsed.type === 'INIT') {
      state.documentEpoch = parsed.payload?.documentEpoch ?? state.documentEpoch;
      state.markdown = parsed.payload?.markdown ?? '';
      state.mode = parsed.payload?.mode ?? state.mode;
      state.readOnly = Boolean(parsed.payload?.readOnly);
      state.revision = 0;
      if (!deferReady) reply('READY', { documentEpoch: state.documentEpoch, revision: 0 });
    } else if (parsed.type === 'SET_READ_ONLY') {
      state.readOnly = Boolean(parsed.payload?.readOnly);
    } else if (parsed.type === 'REQUEST_SNAPSHOT' && parsed.payload?.requestId) {
      reply('SNAPSHOT', {
        documentEpoch: state.documentEpoch,
        requestId: parsed.payload.requestId,
        snapshot: {
          revision: state.revision,
          markdown: state.markdown,
          mode: state.mode,
          isEmpty: !state.markdown.trim(),
          validationIssues: [],
          pendingNodeSeekPolls: []
        }
      });
    }
  });
  await fireEvent(webView, 'loadEnd');
  if (!deferReady) await emitReady();
  return {
    get state() {
      return state;
    },
    clearMessages() {
      state.messages.length = 0;
    },
    emitReady,
    emitUserEdit(markdown: string) {
      state.markdown = markdown;
      state.revision += 1;
      return fireEvent(webView, 'message', {
        nativeEvent: {
          data: JSON.stringify({
            type: 'SNAPSHOT',
            payload: {
              documentEpoch: state.documentEpoch,
              snapshot: {
                revision: state.revision,
                markdown,
                mode: state.mode,
                isEmpty: !markdown.trim(),
                validationIssues: [],
                pendingNodeSeekPolls: []
              }
            }
          })
        }
      });
    }
  };
}

function draftAttachment(draft: TopicDraft, id = 'att-file-1'): TopicDraftAttachment {
  const uri = `file:///private/topic-draft-attachments/${draft.source}/account-${encodeURIComponent(draft.identityKey)}/${draft.id}/${id}.png`;
  mockExistingFiles.add(uri);
  return {
    id,
    uri,
    name: `${id}.png`,
    mimeType: 'image/png',
    size: 512,
    kind: 'image',
    status: 'uploaded',
    description: '',
    markup: `![${id}](https://img.invalid/${id}.png)`
  };
}

async function seedOlderUntouchedEditDraft({
  source = 'nodeseek',
  accountId,
  topicId = '123',
  title = '旧标题',
  body = '旧草稿正文'
}: {
  source?: TopicCreationSource;
  accountId: string;
  topicId?: string;
  title?: string;
  body?: string;
}) {
  const transport = createTopicEditTransport(source, accountId);
  transport.state.title = title;
  transport.state.body = body;
  const identity = `${source}:${accountId}`;
  const editContext = await (source === 'linuxdo'
    ? loadLinuxDoTopicEditContext({
        identityKey: identity,
        topicId,
        userAgent: 'fixture',
        fetcher: transport.fetcher
      })
    : source === 'nodeseek'
      ? loadNodeSeekTopicEditContext({
          identityKey: identity,
          topicId,
          userAgent: 'fixture',
          fetcher: transport.fetcher
        })
      : loadYaohuoTopicEditContext({
          identityKey: identity,
          topicId,
          userAgent: 'fixture',
          fetcher: transport.fetcher
        }));
  const olderDraft = draftFromTopicEdit(editContext);
  expect(olderDraft.revision).toBe(0);
  expect(await saveTopicDraft(olderDraft)).toBe(true);
  return { transport, identity, olderDraft, editContext };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockDraftWriteCount = 0;
  mockSqlReadFailure = '';
  mockExistingFiles.clear();
  mockDatabases.forEach((db) => {
    try {
      db.exec(
        'DELETE FROM topic_drafts; DELETE FROM discarded_topic_drafts; DELETE FROM topic_submission_attempts; DELETE FROM topic_creation_preferences;'
      );
    } catch {
      // Table not created yet for non-draft DBs.
    }
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  mockDatabases.forEach((db) => db.close());
});

describe('H12 offline untouched edit recovery & refocus receipt settlement', () => {
  it('offers verification for the new editor account while preserving the previous account draft', async () => {
    const originalId = String(60000 + ++sequence);
    const nextId = String(60000 + ++sequence);
    const original = createTopicEditTransport('linuxdo', originalId);
    const next = createTopicEditTransport('linuxdo', nextId);
    let switched = false;
    let challenged = true;
    const editReadOwners: string[] = [];
    const fetcher = jest.fn<Fetcher>(async (input, init) => {
      if (String(input).endsWith('/t/123.json')) {
        editReadOwners.push(switched ? nextId : originalId);
        if (switched && challenged) {
          return new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
        }
      }
      return (switched ? next : original).fetcher(input, init);
    });
    const firstRuntime = createRuntime({ accountId: originalId, fetcher });
    const nextRuntime = createRuntime({ accountId: nextId, fetcher });
    nextRuntime.sessionEpochs = { ...nextRuntime.sessionEpochs, linuxdo: nextRuntime.sessionEpochs.linuxdo + 1 };
    let controller!: Controller;
    const page = (runtime: TopicComposerRouteRuntimeValue) => (
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'linuxdo', topicId: '123' }}
        onController={(current) => {
          controller = current;
        }}
      />
    );
    const view = await render(page(firstRuntime));
    try {
      await waitFor(() => expect(controller.editContext?.source).toBe('linuxdo'));
      await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
      const keptTitle = '保存上一个账号修改过的标题';
      await act(() => controller.change((draft) => ({ ...draft, title: keptTitle })));
      switched = true;
      await view.rerender(page(nextRuntime));
      await waitFor(() => expect(controller.loading).toBe(false));
      expect(await loadTopicDraft('linuxdo', 'linuxdo:' + originalId, 'edit:123')).toMatchObject({ title: keptTitle });
      expect(editReadOwners.filter((owner) => owner === nextId)).toHaveLength(1);
      const verify = await view.findByRole('button', { name: '完成验证后继续' });
      await fireEvent.press(verify);
      expect(nextRuntime.openAccount).toHaveBeenCalledTimes(1);
      const recovery = jest.mocked(nextRuntime.openAccount).mock.calls[0]![2]!;
      challenged = false;
      await act(async () => {
        const resumed = recovery.resume();
        expect(await recovery.resume()).toBe('stale');
        expect(await resumed).toBe('completed');
      });
      await waitFor(() => expect(controller.draft?.identityKey).toBe('linuxdo:' + nextId));
      expect(view.queryByTestId('draft-owner-overlay')).toBeNull();
      expect(editReadOwners.filter((owner) => owner === nextId)).toHaveLength(2);
      expect(original.writes()).toHaveLength(0);
      expect(next.writes()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it('unlocks only after the replacement WebView document is ready even if the old document starts late', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({ accountId });
    transport.state.title = '原站更新标题';
    transport.state.body = '原站更新后的正文';
    let offline = true;
    const runtime = createRuntime({
      accountId,
      fetcher: async (url, init) => {
        if (offline) throw new Error('网络连接失败');
        return transport.fetcher(url, init);
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      const bridge = await attachWebViewBridge(view.getByTestId('structured-composer-webview'), { deferReady: true });
      const oldEpoch = bridge.state.documentEpoch;
      mockDraftWriteCount = 0;
      offline = false;
      await fireEvent.press(view.getByRole('button', { name: '重试加载规则' }));
      await waitFor(() => expect(controller.replacementDocument?.draft.body).toBe('原站更新后的正文'));

      await bridge.emitReady(oldEpoch);
      await waitFor(() => expect(bridge.state.markdown).toBe('原站更新后的正文'));
      await bridge.emitReady(oldEpoch);
      expect(bridge.state.documentEpoch).toBeGreaterThan(oldEpoch);
      expect(bridge.state.messages).not.toContainEqual({ type: 'SET_READ_ONLY', payload: { readOnly: false } });
      expect(bridge.state.readOnly).toBe(true);
      expect(view.getByLabelText('帖子标题').props.editable).toBe(false);
      expect(controller.draft?.body).toBe('旧草稿正文');
      expect(controller.saveStatus).toBe('已恢复本机草稿');

      await bridge.emitReady();
      await waitFor(() => expect(controller.saveStatus).toBe('已载入原站最新内容'));
      expect(bridge.state.readOnly).toBe(false);
      expect(view.getByLabelText('帖子标题').props.editable).toBe(true);
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({ id: olderDraft.id, revision: 0 });
      expect(mockDraftWriteCount).toBe(0);
      expect(transport.writes()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it('loads remote body and new document epoch into the mounted WebView editor before lifting readOnly, with 0 extra SQLite writes', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({
      accountId,
      title: '旧草稿标题',
      body: '旧草稿正文'
    });
    transport.state.title = '原站更新标题';
    transport.state.body = '原站更新后的正文';

    let offline = true;
    const fetcher: Fetcher = async (url, init) => {
      if (offline) throw new Error('网络连接失败');
      return transport.fetcher(url, init);
    };
    const runtime = createRuntime({ accountId, fetcher });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));

      expect(controller.draft).toMatchObject({
        id: olderDraft.id,
        revision: 0,
        title: '旧草稿标题',
        body: '旧草稿正文'
      });
      expect(controller.saveStatus).toBe('已恢复本机草稿');
      expect(view.getByLabelText('帖子标题').props.editable).toBe(false);
      expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();

      const webView = view.getByTestId('structured-composer-webview');
      expect(initialDocumentFromWebView(webView)).toMatchObject({
        type: 'INIT',
        payload: expect.objectContaining({
          documentEpoch: 0,
          markdown: '旧草稿正文',
          readOnly: true
        })
      });
      const bridge = await attachWebViewBridge(webView);
      bridge.clearMessages();
      mockDraftWriteCount = 0;

      offline = false;
      await fireEvent.press(view.getByRole('button', { name: '重试加载规则' }));

      await waitFor(() => expect(controller.editContext?.original.body).toBe('原站更新后的正文'));
      await waitFor(() => expect(controller.saveStatus).toBe('已载入原站最新内容'));

      // Mounted WebView instance is reused (no remount) and receives INIT with new remote body & incremented documentEpoch BEFORE readOnly lifts.
      expect(view.getByTestId('structured-composer-webview')).toBe(webView);
      const initIndex = bridge.state.messages.findIndex(
        (message) =>
          message.type === 'INIT' &&
          message.payload?.documentEpoch === 1 &&
          message.payload?.markdown === '原站更新后的正文'
      );
      const unlockIndex = bridge.state.messages.findIndex(
        (message) => message.type === 'SET_READ_ONLY' && message.payload?.readOnly === false
      );
      expect(initIndex).toBeGreaterThanOrEqual(0);
      expect(unlockIndex).toBeGreaterThan(initIndex);
      expect(bridge.state).toMatchObject({
        documentEpoch: 1,
        markdown: '原站更新后的正文',
        readOnly: false
      });

      expect(controller.draft).toMatchObject({
        id: olderDraft.id,
        revision: 0,
        title: '原站更新标题',
        body: '原站更新后的正文',
        attachments: [],
        edit: { original: { title: '原站更新标题', body: '原站更新后的正文' } }
      });
      expect(view.getByLabelText('帖子标题').props.value).toBe('原站更新标题');
      expect(view.getByLabelText('帖子标题').props.editable).toBe(true);

      // Remote-initialized content must NOT trigger any SQLite write through autosave or flush.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
        await controller.flush();
      });
      expect(mockDraftWriteCount).toBe(0);
      expect(controller.saveStatus).toBe('已载入原站最新内容');
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
        id: olderDraft.id,
        revision: 0,
        body: '旧草稿正文'
      });
      expect(transport.writes()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it('recovers an untouched offline draft after a different draft no longer has an unresolved receipt', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft, editContext } = await seedOlderUntouchedEditDraft({ accountId });
    const pending: TopicSubmissionAttempt = {
      id: 'other-offline-edit',
      source: 'nodeseek',
      identityKey: identity,
      target: 'edit:123',
      draftId: olderDraft.id,
      revision: olderDraft.revision,
      startedAt: Date.now(),
      status: 'sending'
    };
    await topicDraftStore.beginTopicSubmissionAttempt(pending);
    await topicDraftStore.settleTopicSubmissionAttempt(pending, { status: 'unknown', message: '等待原站确认' });
    expect(await topicDraftStore.discardTopicDraft('nodeseek', identity, olderDraft.id, 0, 'edit:123')).toBe(true);
    const stored = draftFromTopicEdit(editContext);
    expect(await saveTopicDraft(stored)).toBe(true);
    transport.state.body = '另一页回执结束后的原站正文';
    let offline = true;
    const runtime = createRuntime({
      accountId,
      fetcher: async (url, init) => {
        if (offline) throw new Error('网络连接失败');
        return transport.fetcher(url, init);
      }
    });
    let controller!: Controller;
    const page = (active: boolean) => (
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        active={active}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    const view = await render(page(true));
    try {
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      expect(controller.draft).toMatchObject({ id: stored.id, revision: 0, body: '旧草稿正文' });
      expect(controller.attempt).toMatchObject({ id: pending.id, status: 'unknown' });
      expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();
      const bridge = await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
      await view.rerender(page(false));
      expect(await topicDraftStore.settleTopicSubmissionAttempt(pending, { status: 'saved', message: '已确认' })).toBe(
        true
      );
      mockDraftWriteCount = 0;
      offline = false;
      await view.rerender(page(true));

      await waitFor(() => expect(controller.editContext?.original.body).toBe('另一页回执结束后的原站正文'));
      expect(controller.attempt).toBeNull();
      expect(bridge.state.markdown).toBe('另一页回执结束后的原站正文');
      expect(controller.draft).toMatchObject({ id: stored.id, revision: 0, body: '另一页回执结束后的原站正文' });
      expect(controller.saveStatus).toBe('已载入原站最新内容');
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
        id: stored.id,
        revision: 0,
        body: '旧草稿正文'
      });
      expect(mockDraftWriteCount).toBe(0);
      expect(transport.writes()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it('restores the newer SQLite draft when another page saves during the initial online read', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({ accountId });
    transport.state.body = '原站的新正文';
    const readerStarted = Promise.withResolvers<void>();
    const releaseReader = Promise.withResolvers<void>();
    const runtime = createRuntime({
      accountId,
      fetcher: transport.fetcher,
      getTopicEditContext: async (options) => {
        const editing = await loadNodeSeekTopicEditContext({ ...options, fetcher: transport.fetcher });
        readerStarted.resolve();
        await releaseReader.promise;
        return editing;
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await readerStarted.promise;
      const newerDraft: TopicDraft = {
        ...olderDraft,
        revision: 1,
        body: '另一页先保存的正文',
        updatedAt: Date.now()
      };
      expect(await saveTopicDraft(newerDraft, olderDraft.revision)).toBe(true);
      mockDraftWriteCount = 0;
      await act(() => releaseReader.resolve());

      await waitFor(() => expect(controller.loading).toBe(false));
      expect(controller.draft).toMatchObject({ id: newerDraft.id, revision: 1, body: '另一页先保存的正文' });
      const bridge = await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
      expect(bridge.state.markdown).toBe('另一页先保存的正文');
      expect(controller.saveStatus).toBe('已恢复本机草稿');
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
        revision: 1,
        body: '另一页先保存的正文'
      });
      expect(mockDraftWriteCount).toBe(0);
      expect(transport.writes()).toHaveLength(0);
    } finally {
      releaseReader.resolve();
      await view.unmount();
    }
  });

  it('retains user input and routes through conflict flow when user edits while offline retry is in flight', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({
      accountId,
      title: '旧草稿标题',
      body: '旧草稿正文'
    });
    transport.state.title = '原站更新标题';
    transport.state.body = '原站更新后的正文';

    let offline = true;
    const retryStarted = Promise.withResolvers<void>();
    const releaseRetry = Promise.withResolvers<void>();
    let holdRetry = false;
    const fetcher: Fetcher = async (url, init) => {
      if (offline) throw new Error('网络连接失败');
      return transport.fetcher(url, init);
    };
    const runtime = createRuntime({
      accountId,
      fetcher,
      getTopicEditContext: async (options) => {
        if (offline) throw new Error('网络连接失败');
        if (holdRetry) {
          holdRetry = false;
          retryStarted.resolve();
          await releaseRetry.promise;
        }
        return loadNodeSeekTopicEditContext({ ...options, fetcher });
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      const webView = view.getByTestId('structured-composer-webview');
      const bridge = await attachWebViewBridge(webView);
      bridge.clearMessages();

      offline = false;
      holdRetry = true;
      await act(() => {
        controller.reloadContext();
      });
      await retryStarted.promise;

      await act(() => {
        controller.change((draft) => ({ ...draft, title: '重试期间输入的标题', body: '重试期间输入的正文' }));
      });
      await act(async () => {
        releaseRetry.resolve();
      });

      await waitFor(() => expect(controller.editContext?.original.body).toBe('原站更新后的正文'));
      expect(controller.draft).toMatchObject({
        id: olderDraft.id,
        title: '重试期间输入的标题',
        body: '重试期间输入的正文'
      });
      expect(controller.saveStatus).not.toBe('已载入原站最新内容');
      expect(controller.error).toContain('原站内容已更新');
      expect(view.getByRole('button', { name: '核对原站最新内容' })).toBeTruthy();
      expect(bridge.state.markdown).toBe('重试期间输入的正文');
      expect(
        bridge.state.messages.some(
          (message) => message.type === 'INIT' && message.payload?.markdown === '原站更新后的正文'
        )
      ).toBe(false);

      await act(async () => {
        await controller.submit();
      });
      expect(controller.attempt?.status).toBe('conflict');
      expect(transport.writes()).toHaveLength(0);
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
        title: '重试期间输入的标题',
        body: '重试期间输入的正文'
      });
    } finally {
      releaseRetry.resolve();
      await view.unmount();
    }
  });

  it('retains WebView editor snapshot input delivered while offline retry is in flight', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({
      accountId,
      title: '旧草稿标题',
      body: '旧草稿正文'
    });
    transport.state.body = '原站更新后的正文';

    let offline = true;
    const retryStarted = Promise.withResolvers<void>();
    const releaseRetry = Promise.withResolvers<void>();
    let holdRetry = false;
    const fetcher: Fetcher = async (url, init) => {
      if (offline) throw new Error('网络连接失败');
      return transport.fetcher(url, init);
    };
    const runtime = createRuntime({
      accountId,
      fetcher,
      getTopicEditContext: async (options) => {
        if (offline) throw new Error('网络连接失败');
        if (holdRetry) {
          holdRetry = false;
          retryStarted.resolve();
          await releaseRetry.promise;
        }
        return loadNodeSeekTopicEditContext({ ...options, fetcher });
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      const webView = view.getByTestId('structured-composer-webview');
      const bridge = await attachWebViewBridge(webView);
      bridge.clearMessages();

      offline = false;
      holdRetry = true;
      await act(() => {
        controller.reloadContext();
      });
      await retryStarted.promise;

      await bridge.emitUserEdit('WebView 重试期间输入的正文');
      await act(async () => {
        releaseRetry.resolve();
      });

      await waitFor(() => expect(controller.editContext?.original.body).toBe('原站更新后的正文'));
      expect(controller.draft).toMatchObject({ id: olderDraft.id, body: 'WebView 重试期间输入的正文' });
      expect(bridge.state.markdown).toBe('WebView 重试期间输入的正文');
      expect(controller.saveStatus).not.toBe('已载入原站最新内容');
      expect(controller.error).toContain('原站内容已更新');
      expect(
        bridge.state.messages.some(
          (message) => message.type === 'INIT' && message.payload?.markdown === '原站更新后的正文'
        )
      ).toBe(false);
      await act(async () => {
        await controller.flush();
      });
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
        body: 'WebView 重试期间输入的正文'
      });
      expect(transport.writes()).toHaveLength(0);
    } finally {
      releaseRetry.resolve();
      await view.unmount();
    }
  });

  it('loads remote body into Yaohuo native editor after offline retry with 0 extra SQLite writes', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({
      source: 'yaohuo',
      accountId,
      title: '妖火旧标题',
      body: '妖火旧草稿正文'
    });
    transport.state.title = '妖火原站新标题';
    transport.state.body = '妖火原站新正文';

    let offline = true;
    const runtime = createRuntime({
      accountId,
      fetcher: async (url, init) => {
        if (offline) throw new Error('网络连接失败');
        return transport.fetcher(url, init);
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'yaohuo', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      expect(view.getByLabelText('帖子正文').props.value).toBe('妖火旧草稿正文');
      expect(view.getByLabelText('帖子正文').props.editable).toBe(false);
      expect(controller.saveStatus).toBe('已恢复本机草稿');

      mockDraftWriteCount = 0;
      offline = false;
      await fireEvent.press(view.getByRole('button', { name: '重试加载规则' }));

      await waitFor(() => expect(controller.saveStatus).toBe('已载入原站最新内容'));
      expect(controller.draft).toMatchObject({
        id: olderDraft.id,
        revision: 0,
        title: '妖火原站新标题',
        body: '妖火原站新正文'
      });
      expect(view.getByLabelText('帖子正文').props.value).toBe('妖火原站新正文');
      expect(view.getByLabelText('帖子正文').props.editable).toBe(true);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
        await controller.flush();
      });
      expect(mockDraftWriteCount).toBe(0);
      expect(await loadTopicDraft('yaohuo', identity, 'edit:123')).toMatchObject({
        id: olderDraft.id,
        revision: 0,
        body: '妖火旧草稿正文'
      });
      expect(transport.writes()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it('retains attachment changes and routes through conflict flow when attachments change during offline retry', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({
      accountId,
      title: '旧草稿标题',
      body: '旧草稿正文'
    });
    transport.state.body = '原站更新后的正文';

    let offline = true;
    const retryStarted = Promise.withResolvers<void>();
    const releaseRetry = Promise.withResolvers<void>();
    let holdRetry = false;
    const fetcher: Fetcher = async (url, init) => {
      if (offline) throw new Error('网络连接失败');
      return transport.fetcher(url, init);
    };
    const runtime = createRuntime({
      accountId,
      fetcher,
      getTopicEditContext: async (options) => {
        if (offline) throw new Error('网络连接失败');
        if (holdRetry) {
          holdRetry = false;
          retryStarted.resolve();
          await releaseRetry.promise;
        }
        return loadNodeSeekTopicEditContext({ ...options, fetcher });
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      const webView = view.getByTestId('structured-composer-webview');
      const bridge = await attachWebViewBridge(webView);
      bridge.clearMessages();

      offline = false;
      holdRetry = true;
      await act(() => {
        controller.reloadContext();
      });
      await retryStarted.promise;

      const added = draftAttachment(olderDraft, 'mid-retry-img');
      await act(() => {
        controller.change((draft) => ({ ...draft, attachments: [added] }));
      });
      await act(async () => {
        releaseRetry.resolve();
      });

      await waitFor(() => expect(controller.editContext?.original.body).toBe('原站更新后的正文'));
      expect(controller.draft?.body).toBe('旧草稿正文');
      expect(controller.draft?.attachments).toEqual([added]);
      expect(controller.saveStatus).not.toBe('已载入原站最新内容');
      expect(controller.error).toContain('原站内容已更新');
      expect(bridge.state.markdown).toBe('旧草稿正文');
      expect(
        bridge.state.messages.some(
          (message) => message.type === 'INIT' && message.payload?.markdown === '原站更新后的正文'
        )
      ).toBe(false);
      await act(async () => {
        await controller.flush();
      });
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
        body: '旧草稿正文',
        attachments: [added]
      });
      expect(transport.writes()).toHaveLength(0);
    } finally {
      releaseRetry.resolve();
      await view.unmount();
    }
  });

  it('preserves local content and routes through SQLite conflict flow when another page saves to SQLite during retry', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, identity, olderDraft } = await seedOlderUntouchedEditDraft({
      accountId,
      title: '旧草稿标题',
      body: '旧草稿正文'
    });
    transport.state.body = '原站更新后的正文';

    let offline = true;
    const retryStarted = Promise.withResolvers<void>();
    const releaseRetry = Promise.withResolvers<void>();
    let holdRetry = false;
    const fetcher: Fetcher = async (url, init) => {
      if (offline) throw new Error('网络连接失败');
      return transport.fetcher(url, init);
    };
    const runtime = createRuntime({
      accountId,
      fetcher,
      getTopicEditContext: async (options) => {
        if (offline) throw new Error('网络连接失败');
        if (holdRetry) {
          holdRetry = false;
          retryStarted.resolve();
          await releaseRetry.promise;
        }
        return loadNodeSeekTopicEditContext({ ...options, fetcher });
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      const webView = view.getByTestId('structured-composer-webview');
      const bridge = await attachWebViewBridge(webView);
      bridge.clearMessages();

      offline = false;
      holdRetry = true;
      await act(() => {
        controller.reloadContext();
      });
      await retryStarted.promise;

      // Another page saves revision 1 to SQLite while retry is in flight.
      const peerDraft: TopicDraft = {
        ...olderDraft,
        revision: 1,
        title: '另一页更新的标题',
        body: '另一页更新的正文',
        updatedAt: Date.now()
      };
      expect(await saveTopicDraft(peerDraft, 0)).toBe(true);
      mockDraftWriteCount = 0;

      await act(async () => {
        releaseRetry.resolve();
      });

      await waitFor(() => expect(controller.editContext?.original.body).toBe('原站更新后的正文'));
      expect(controller.draft?.body).toBe('旧草稿正文');
      expect(bridge.state.markdown).toBe('旧草稿正文');
      expect(controller.saveStatus).toContain('其他页面更新');
      expect(controller.saveStatus).not.toBe('已载入原站最新内容');
      expect(controller.error).toContain('其他页面更新');
      expect(mockDraftWriteCount).toBe(0);
      expect(
        bridge.state.messages.some(
          (message) => message.type === 'INIT' && message.payload?.markdown === '原站更新后的正文'
        )
      ).toBe(false);

      // Existing conflict flow on leave protects the peer SQLite row.
      await act(() => {
        controller.change((draft) => ({ ...draft, title: '本页后续编辑标题' }));
      });
      const confirmExit = jest
        .spyOn(Alert, 'alert')
        .mockImplementation((_title, _message, buttons) =>
          buttons?.find((button) => button.style === 'cancel')?.onPress?.()
        );
      await act(async () => {
        expect(await controller.leave()).toBe(false);
      });
      expect(confirmExit).toHaveBeenCalledTimes(1);
      expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
        id: olderDraft.id,
        revision: 1,
        title: '另一页更新的标题',
        body: '另一页更新的正文'
      });
      expect(transport.writes()).toHaveLength(0);
    } finally {
      releaseRetry.resolve();
      await view.unmount();
    }
  });

  it('discards a stale remote retry result cleanly when the account switches while retry is in flight', async () => {
    const accountA = String(70000 + ++sequence);
    const accountB = String(70000 + ++sequence);
    const seededA = await seedOlderUntouchedEditDraft({
      accountId: accountA,
      title: '账号A旧标题',
      body: '账号A旧草稿正文'
    });
    const seededB = await seedOlderUntouchedEditDraft({
      accountId: accountB,
      title: '账号B标题',
      body: '账号B独立草稿正文'
    });
    const modifiedB: TopicDraft = {
      ...seededB.olderDraft,
      revision: 1,
      title: '账号B已修改标题',
      body: '账号B已修改正文',
      updatedAt: Date.now()
    };
    expect(await saveTopicDraft(modifiedB, 0)).toBe(true);

    seededA.transport.state.body = '账号A原站新正文';
    let offlineA = true;
    const retryStarted = Promise.withResolvers<void>();
    const releaseRetryA = Promise.withResolvers<TopicEditContext>();
    let holdRetryA = false;

    const runtimeA = createRuntime({
      accountId: accountA,
      fetcher: async (url, init) => {
        if (offlineA) throw new Error('网络连接失败');
        return seededA.transport.fetcher(url, init);
      },
      getTopicEditContext: async (options) => {
        if (offlineA) throw new Error('网络连接失败');
        if (holdRetryA) {
          holdRetryA = false;
          retryStarted.resolve();
          return releaseRetryA.promise;
        }
        return loadNodeSeekTopicEditContext({ ...options, fetcher: seededA.transport.fetcher });
      }
    });
    const runtimeB = createRuntime({
      accountId: accountB,
      fetcher: seededB.transport.fetcher
    });

    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtimeA}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      await attachWebViewBridge(view.getByTestId('structured-composer-webview'));

      offlineA = false;
      holdRetryA = true;
      await act(() => {
        controller.reloadContext();
      });
      await retryStarted.promise;

      await view.rerender(
        <ComposerTestHost
          runtime={runtimeB}
          intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      await waitFor(() => expect(controller.draft?.identityKey).toBe(`nodeseek:${accountB}`));
      await waitFor(() => expect(controller.editContext?.identityKey).toBe(`nodeseek:${accountB}`));
      const bridgeB = await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
      bridgeB.clearMessages();
      mockDraftWriteCount = 0;

      const staleRemoteA = await loadNodeSeekTopicEditContext({
        identityKey: seededA.identity,
        topicId: '123',
        userAgent: 'fixture',
        fetcher: seededA.transport.fetcher
      });
      await act(async () => {
        releaseRetryA.resolve(staleRemoteA);
        await Promise.resolve();
      });

      expect(controller.draft).toMatchObject({
        id: modifiedB.id,
        identityKey: `nodeseek:${accountB}`,
        title: '账号B已修改标题',
        body: '账号B已修改正文'
      });
      expect(bridgeB.state.markdown).toBe('账号B已修改正文');
      expect(controller.saveStatus).not.toBe('已载入原站最新内容');
      expect(mockDraftWriteCount).toBe(0);
      expect(
        bridgeB.state.messages.some(
          (message) => message.type === 'INIT' && message.payload?.markdown === '账号A原站新正文'
        )
      ).toBe(false);
      expect(await loadTopicDraft('nodeseek', seededA.identity, 'edit:123')).toMatchObject({
        id: seededA.olderDraft.id,
        body: '账号A旧草稿正文'
      });
      expect(await loadTopicDraft('nodeseek', seededB.identity, 'edit:123')).toMatchObject({
        id: modifiedB.id,
        body: '账号B已修改正文'
      });
      expect(seededA.transport.writes()).toHaveLength(0);
      expect(seededB.transport.writes()).toHaveLength(0);
    } finally {
      releaseRetryA.resolve(seededA.editContext);
      await view.unmount();
    }
  });

  it('keeps read-only protection when offline retry fails or SQLite verification read fails, then succeeds on a clean retry', async () => {
    const accountId = String(70000 + ++sequence);
    const { transport, olderDraft } = await seedOlderUntouchedEditDraft({
      accountId,
      title: '旧草稿标题',
      body: '旧草稿正文'
    });
    transport.state.body = '原站更新后的正文';

    let offline = true;
    const runtime = createRuntime({
      accountId,
      fetcher: async (url, init) => {
        if (offline) throw new Error('网络连接失败');
        return transport.fetcher(url, init);
      }
    });
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.loading).toBe(false));
      await waitFor(() => expect(controller.contextError).toContain('网络连接失败'));
      const webView = view.getByTestId('structured-composer-webview');
      const bridge = await attachWebViewBridge(webView, { deferReady: true });
      await bridge.emitReady();
      bridge.clearMessages();

      // Retry while online but SQLite read fails during verification -> must keep read-only protection and NOT apply remote body.
      offline = false;
      mockSqlReadFailure = 'SELECT payload FROM topic_drafts';
      await fireEvent.press(view.getByRole('button', { name: '重试加载规则' }));
      await waitFor(() => expect(controller.contextError).toContain('storage read unavailable'));
      expect(controller.editContext).toBeNull();
      expect(controller.draft?.body).toBe('旧草稿正文');
      expect(controller.saveStatus).toBe('已恢复本机草稿');
      expect(view.getByLabelText('帖子标题').props.editable).toBe(false);
      expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();
      expect(bridge.state.markdown).toBe('旧草稿正文');
      expect(bridge.state.messages.some((message) => message.type === 'INIT')).toBe(false);

      // READY presents the candidate, but a failed final SQLite read still leaves the local draft intact.
      await fireEvent.press(view.getByRole('button', { name: '重试加载规则' }));
      await waitFor(() => expect(bridge.state.markdown).toBe('原站更新后的正文'));
      mockSqlReadFailure = 'SELECT payload FROM topic_drafts';
      await bridge.emitReady();
      await waitFor(() => expect(controller.contextError).toContain('storage read unavailable'));
      await waitFor(() => expect(bridge.state.markdown).toBe('旧草稿正文'));
      expect(controller.draft?.body).toBe('旧草稿正文');
      expect(bridge.state.readOnly).toBe(true);
      expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();
      await bridge.emitReady();

      await fireEvent.press(view.getByRole('button', { name: '重试加载规则' }));
      await waitFor(() => expect(bridge.state.markdown).toBe('原站更新后的正文'));
      await bridge.emitReady();
      await waitFor(() => expect(controller.saveStatus).toBe('已载入原站最新内容'));
      expect(controller.draft).toMatchObject({ id: olderDraft.id, revision: 0, body: '原站更新后的正文' });
      expect(view.getByLabelText('帖子标题').props.editable).toBe(true);
      expect(bridge.state).toMatchObject({
        markdown: '原站更新后的正文',
        readOnly: false
      });
      expect(transport.writes()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it.each(['saved', 'rejected', 'conflict', 'partial', 'acknowledged'] as const)(
    'lifts only the stale wait lock on refocus when another edit page settles another draft receipt (%s) without corrupting this draft or resending',
    async (settlement) => {
      const accountId = String(70000 + ++sequence);
      const transport = createTopicEditTransport('nodeseek', accountId);
      const identity = `nodeseek:${accountId}`;
      const runtime = createRuntime({ accountId, fetcher: transport.fetcher });

      // Step 1: First edit page sends 1 request whose response is lost -> durable unknown receipt.
      let firstController!: Controller;
      const firstView = await render(
        <ComposerTestHost
          runtime={runtime}
          intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
          onController={(value) => {
            firstController = value;
          }}
        />
      );
      let discardedDraftId!: string;
      let pendingAttempt!: TopicSubmissionAttempt;
      try {
        await waitFor(() => expect(firstController.editContext).not.toBeNull());
        await attachWebViewBridge(firstView.getByTestId('structured-composer-webview'));
        discardedDraftId = firstController.draft!.id;
        await act(() => {
          firstController.change((draft) => ({ ...draft, title: '旧草稿待确认标题' }));
        });
        transport.respond(() => {
          throw new Error('connection lost');
        });
        await act(async () => {
          await firstController.submit();
        });
        expect(transport.writes()).toHaveLength(1);
        const recorded = await readTopicSubmissionAttempt('nodeseek', identity, 'edit:123');
        expect(recorded).toMatchObject({ draftId: discardedDraftId, status: 'unknown' });
        pendingAttempt = recorded!;
        expect(
          await topicDraftStore.discardTopicDraft(
            'nodeseek',
            identity,
            discardedDraftId,
            firstController.draft!.revision,
            'edit:123'
          )
        ).toBe(true);
      } finally {
        await firstView.unmount();
      }
      transport.respond(undefined);

      // Step 2: Save a different local edit draft with local body & attachment.
      const freshContext = await loadNodeSeekTopicEditContext({
        identityKey: identity,
        topicId: '123',
        userAgent: 'fixture',
        fetcher: transport.fetcher
      });
      const localDraftBase = draftFromTopicEdit(freshContext);
      const file = draftAttachment(localDraftBase, 'keep-on-refocus');
      const localDraft: TopicDraft = {
        ...localDraftBase,
        revision: 1,
        title: '本页保留的标题',
        body: '本页保留的正文内容',
        attachments: [file],
        updatedAt: Date.now()
      };
      expect(await saveTopicDraft(localDraft)).toBe(true);

      // Step 3: Open Page A -> sees localDraft + stale unknown lock from discardedDraftId.
      const onEdited = jest.fn();
      let controller!: Controller;
      const view = await render(
        <ComposerTestHost
          runtime={runtime}
          intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
          active
          onEdited={onEdited}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      try {
        await waitFor(() => expect(controller.editContext).not.toBeNull());
        const bridge = await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
        expect(controller.attempt).toMatchObject({
          id: pendingAttempt.id,
          draftId: discardedDraftId,
          status: 'unknown'
        });
        expect(view.getByText('上次保存结果尚未确认，请先到原站核对。')).toBeTruthy();
        expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();

        // Attempting to submit while locked sends 0 additional remote writes.
        await act(async () => {
          await controller.submit();
        });
        expect(transport.writes()).toHaveLength(1);
        bridge.clearMessages();

        // Step 4: Page A loses focus while another page settles the other draft's pending receipt.
        await view.rerender(
          <ComposerTestHost
            runtime={runtime}
            intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
            active={false}
            onEdited={onEdited}
            onController={(value) => {
              controller = value;
            }}
          />
        );

        if (settlement === 'acknowledged') {
          expect(
            await topicDraftStore.acknowledgeTopicSubmissionAttempt('nodeseek', identity, pendingAttempt.id, 'edit:123')
          ).toBe(true);
        } else {
          const db = mockDatabases.get('topic-drafts.db')!;
          const terminal: TopicSubmissionAttempt = {
            ...pendingAttempt,
            status: settlement,
            result: { status: settlement, message: `另一页已结算:${settlement}` }
          } as TopicSubmissionAttempt;
          db.prepare(
            'UPDATE topic_submission_attempts SET payload=? WHERE source=? AND identity_key=? AND target=?'
          ).run(JSON.stringify(terminal), 'nodeseek', identity, 'edit:123');
        }

        mockDraftWriteCount = 0;

        // Step 5: Refocus Page A -> lifts stale wait lock cleanly, preserves draft & attachments, 0 automatic resends!
        await view.rerender(
          <ComposerTestHost
            runtime={runtime}
            intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
            active
            onEdited={onEdited}
            onController={(value) => {
              controller = value;
            }}
          />
        );

        await waitFor(() => expect(controller.attempt).toBeNull());
        expect(view.queryByText('上次保存结果尚未确认，请先到原站核对。')).toBeNull();
        expect(view.getByRole('button', { name: '保存修改' })).not.toBeDisabled();
        expect(controller.draft).toMatchObject({
          id: localDraft.id,
          revision: 1,
          title: '本页保留的标题',
          body: '本页保留的正文内容',
          attachments: [file]
        });
        expect(bridge.state.markdown).toBe('本页保留的正文内容');
        expect(onEdited).not.toHaveBeenCalled();
        expect(mockDraftWriteCount).toBe(0);
        expect(await loadTopicDraft('nodeseek', identity, 'edit:123')).toMatchObject({
          id: localDraft.id,
          title: '本页保留的标题',
          body: '本页保留的正文内容',
          attachments: [file]
        });
        // Old attempt sent 1 time, automatic resend on page restore/refocus = 0!
        expect(transport.writes()).toHaveLength(1);
      } finally {
        await view.unmount();
      }
    }
  );

  it('also lifts a stale other-draft wait lock when the app returns to foreground (appActive false -> true) with 0 resends', async () => {
    const accountId = String(70000 + ++sequence);
    const transport = createTopicEditTransport('nodeseek', accountId);
    const identity = `nodeseek:${accountId}`;
    const runtime = createRuntime({ accountId, fetcher: transport.fetcher });

    const ctx = await loadNodeSeekTopicEditContext({
      identityKey: identity,
      topicId: '123',
      userAgent: 'fixture',
      fetcher: transport.fetcher
    });
    const localDraft: TopicDraft = {
      ...draftFromTopicEdit(ctx),
      revision: 1,
      title: '切后台前保留的标题',
      body: '切后台前保留的正文',
      updatedAt: Date.now()
    };
    expect(await saveTopicDraft(localDraft)).toBe(true);

    const otherAttempt: TopicSubmissionAttempt = {
      id: 'att-foreground-other',
      source: 'nodeseek',
      identityKey: identity,
      target: 'edit:123',
      draftId: 'other-bg-draft',
      revision: 1,
      startedAt: Date.now(),
      status: 'unknown',
      result: { status: 'unknown', message: '提交结果未知，请先到原站核对，勿重复提交' }
    };
    const db = mockDatabases.get('topic-drafts.db')!;
    db.prepare(
      'INSERT INTO topic_submission_attempts VALUES (?, ?, ?, ?) ON CONFLICT(source, identity_key, target) DO UPDATE SET payload=excluded.payload'
    ).run('nodeseek', identity, 'edit:123', JSON.stringify(otherAttempt));

    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
        active
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.editContext).not.toBeNull());
      expect(controller.attempt).toMatchObject({ id: 'att-foreground-other', status: 'unknown' });

      await view.rerender(
        <ComposerTestHost
          runtime={{ ...runtime, appActive: false }}
          intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
          active
          onController={(value) => {
            controller = value;
          }}
        />
      );

      db.prepare('UPDATE topic_submission_attempts SET payload=? WHERE source=? AND identity_key=? AND target=?').run(
        JSON.stringify({ ...otherAttempt, status: 'saved', result: { status: 'saved', message: '已保存' } }),
        'nodeseek',
        identity,
        'edit:123'
      );

      await view.rerender(
        <ComposerTestHost
          runtime={{ ...runtime, appActive: true }}
          intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
          active
          onController={(value) => {
            controller = value;
          }}
        />
      );

      await waitFor(() => expect(controller.attempt).toBeNull());
      expect(controller.draft).toMatchObject({
        id: localDraft.id,
        title: '切后台前保留的标题',
        body: '切后台前保留的正文'
      });
      expect(transport.writes()).toHaveLength(0);
    } finally {
      await view.unmount();
    }
  });

  it.each(['saved', 'rejected', 'conflict', 'partial'] as const)(
    'settles a terminal %s receipt for THIS draft on page refocus via existing settlement without resending',
    async (status) => {
      const accountId = String(70000 + ++sequence);
      const transport = createTopicEditTransport('linuxdo', accountId);
      const identity = `linuxdo:${accountId}`;
      const runtime = createRuntime({ accountId, fetcher: transport.fetcher });

      const onEdited = jest.fn();
      let controller!: Controller;
      const view = await render(
        <ComposerTestHost
          runtime={runtime}
          intent={{ kind: 'edit', source: 'linuxdo', topicId: '123' }}
          active
          onEdited={onEdited}
          onController={(value) => {
            controller = value;
          }}
        />
      );
      try {
        await waitFor(() => expect(controller.editContext).not.toBeNull());
        await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
        await act(() => {
          controller.change((draft) => ({ ...draft, title: '本稿新标题', body: '本稿新正文内容' }));
        });
        // First request fails after dispatch -> 1 remote write and durable unknown receipt for THIS draft.
        transport.respond(() => {
          throw new Error('connection lost');
        });
        await act(async () => {
          await controller.submit();
        });
        const sentWrites = transport.writes().length;
        expect(sentWrites).toBe(1);
        const currentAttempt = await readTopicSubmissionAttempt('linuxdo', identity, 'edit:123');
        expect(currentAttempt).toMatchObject({ draftId: controller.draft!.id, status: 'unknown' });

        await view.rerender(
          <ComposerTestHost
            runtime={runtime}
            intent={{ kind: 'edit', source: 'linuxdo', topicId: '123' }}
            active={false}
            onEdited={onEdited}
            onController={(value) => {
              controller = value;
            }}
          />
        );

        const db = mockDatabases.get('topic-drafts.db')!;
        const settledReceipt: TopicSubmissionAttempt = {
          ...currentAttempt!,
          ...(status === 'partial' ? { confirmed: { title: '本稿新标题' } } : {}),
          status,
          result: {
            status,
            ...(status === 'partial' ? { confirmed: { title: '本稿新标题' } } : {}),
            message: `本稿结算:${status}`
          }
        } as TopicSubmissionAttempt;
        db.prepare('UPDATE topic_submission_attempts SET payload=? WHERE source=? AND identity_key=? AND target=?').run(
          JSON.stringify(settledReceipt),
          'linuxdo',
          identity,
          'edit:123'
        );

        await view.rerender(
          <ComposerTestHost
            runtime={runtime}
            intent={{ kind: 'edit', source: 'linuxdo', topicId: '123' }}
            active
            onEdited={onEdited}
            onController={(value) => {
              controller = value;
            }}
          />
        );

        await waitFor(() => expect(controller.attempt?.status).toBe(status));
        expect(controller.attempt?.id).toBe(currentAttempt!.id);
        if (status === 'saved') {
          expect(onEdited).toHaveBeenCalledWith('linuxdo', '123');
          expect(controller.error).toBe('');
        } else {
          expect(onEdited).not.toHaveBeenCalled();
          expect(controller.error).toContain(`本稿结算:${status}`);
          if (status === 'partial') {
            expect(controller.draft?.edit?.original.title).toBe('本稿新标题');
            expect(controller.draft?.body).toBe('本稿新正文内容');
          }
        }
        // Old attempt sent 1 time; automatic resend on refocus = 0!
        expect(transport.writes()).toHaveLength(sentWrites);
      } finally {
        await view.unmount();
      }
    }
  );

  it('settles a terminal posted receipt for THIS create draft on refocus without resending', async () => {
    const accountId = String(70000 + ++sequence);
    const transport = createTopicProofTransport('success');
    let posts = 0;
    let failPost = true;
    const fetcher: Fetcher = async (url, init) => {
      if (init?.method === 'POST' && !url.endsWith('/session/csrf')) {
        prepareRequestToSend(init);
        posts += 1;
        if (failPost) throw new Error('connection lost');
      }
      return transport.fetcher(url, init);
    };
    const runtime = createRuntime({ accountId, fetcher });
    const identity = `nodeseek:${accountId}`;
    let controller!: Controller;
    const view = await render(
      <ComposerTestHost
        runtime={runtime}
        intent={{ kind: 'create', initialSource: 'nodeseek' }}
        active
        onController={(value) => {
          controller = value;
        }}
      />
    );
    try {
      await waitFor(() => expect(controller.context?.source).toBe('nodeseek'));
      await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
      await act(() => {
        controller.change((draft) => ({
          ...draft,
          title: '新主题标题测试',
          body: '新主题正文测试内容，长度足够通过校验。',
          categoryId: 'tech'
        }));
      });
      await act(async () => {
        await controller.submit();
      });
      expect(posts).toBe(1);
      const originalDraftId = controller.draft!.id;
      const recorded = await readTopicSubmissionAttempt('nodeseek', identity, 'create');
      expect(recorded).toMatchObject({ draftId: originalDraftId, status: 'unknown' });

      await view.rerender(
        <ComposerTestHost
          runtime={runtime}
          intent={{ kind: 'create', initialSource: 'nodeseek' }}
          active={false}
          onController={(value) => {
            controller = value;
          }}
        />
      );

      expect(
        await topicDraftStore.settleTopicSubmissionAttempt(recorded!, {
          status: 'posted',
          message: '主题已发布',
          topic: {
            id: '999',
            source: 'nodeseek',
            title: '新主题标题测试',
            author: 'tester',
            url: 'https://www.nodeseek.com/post-999-1',
            createdAt: '2026-01-01'
          }
        })
      ).toBe(true);

      failPost = false;
      await view.rerender(
        <ComposerTestHost
          runtime={runtime}
          intent={{ kind: 'create', initialSource: 'nodeseek' }}
          active
          onController={(value) => {
            controller = value;
          }}
        />
      );

      await waitFor(() => expect(controller.attempt?.status).toBe('posted'));
      expect(controller.draft?.id).not.toBe(originalDraftId);
      expect(controller.draft?.body).toBe('');
      expect(controller.error).toBe('');
      expect(posts).toBe(1);
    } finally {
      await view.unmount();
    }
  });

  it.each(['sending', 'unknown', 'read-failure'] as const)(
    'keeps submit protection active on refocus when persisted receipt check encounters %s',
    async (outcome) => {
      const accountId = String(70000 + ++sequence);
      const transport = createTopicEditTransport('nodeseek', accountId);
      const identity = `nodeseek:${accountId}`;
      const runtime = createRuntime({ accountId, fetcher: transport.fetcher });

      const ctx = await loadNodeSeekTopicEditContext({
        identityKey: identity,
        topicId: '123',
        userAgent: 'fixture',
        fetcher: transport.fetcher
      });
      const localDraftBase = draftFromTopicEdit(ctx);
      const file = draftAttachment(localDraftBase, 'protected-file');
      const localDraft: TopicDraft = {
        ...localDraftBase,
        revision: 1,
        title: '受保护的本页标题',
        body: '受保护的本页正文',
        attachments: [file],
        updatedAt: Date.now()
      };
      expect(await saveTopicDraft(localDraft)).toBe(true);

      let otherDraft: TopicDraft | undefined;
      const otherSendingStarted = Promise.withResolvers<void>();
      const releaseOtherSending = Promise.withResolvers<void>();
      let otherSubmitting: Promise<void> | undefined;
      let otherView: Awaited<ReturnType<typeof render>> | undefined;

      if (outcome === 'sending') {
        transport.respond(async () => {
          otherSendingStarted.resolve();
          await releaseOtherSending.promise;
          return undefined;
        });
        let otherController!: Controller;
        otherView = await render(
          <ComposerTestHost
            runtime={runtime}
            intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
            active
            onController={(value) => {
              otherController = value;
            }}
          />
        );
        await waitFor(() => expect(otherController.editContext).not.toBeNull());
        await attachWebViewBridge(otherView.getByTestId('structured-composer-webview'));
        otherDraft = otherController.draft!;
        await act(() => {
          otherSubmitting = otherController.submit();
        });
        await otherSendingStarted.promise;
        expect(transport.writes()).toHaveLength(1);
      } else {
        const otherAttempt: TopicSubmissionAttempt = {
          id: `att-${outcome}`,
          source: 'nodeseek',
          identityKey: identity,
          target: 'edit:123',
          draftId: 'other-edit-draft',
          revision: 1,
          startedAt: Date.now(),
          status: 'unknown',
          result: { status: 'unknown', message: '提交结果未知，请先到原站核对，勿重复提交' }
        };
        const db = mockDatabases.get('topic-drafts.db')!;
        db.prepare(
          'INSERT INTO topic_submission_attempts VALUES (?, ?, ?, ?) ON CONFLICT(source, identity_key, target) DO UPDATE SET payload=excluded.payload'
        ).run('nodeseek', identity, 'edit:123', JSON.stringify(otherAttempt));
      }

      let controller!: Controller;
      const view = await render(
        <ComposerTestHost
          runtime={runtime}
          intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
          active
          onController={(value) => {
            controller = value;
          }}
        />
      );
      try {
        await waitFor(() => expect(controller.editContext).not.toBeNull());
        await attachWebViewBridge(view.getByTestId('structured-composer-webview'));
        expect(controller.attempt?.status).toBe(outcome === 'sending' ? 'sending' : 'unknown');
        expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();

        await view.rerender(
          <ComposerTestHost
            runtime={runtime}
            intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
            active={false}
            onController={(value) => {
              controller = value;
            }}
          />
        );

        if (outcome === 'read-failure') mockSqlReadFailure = 'SELECT payload FROM topic_submission_attempts';

        await view.rerender(
          <ComposerTestHost
            runtime={runtime}
            intent={{ kind: 'edit', source: 'nodeseek', topicId: '123' }}
            active
            onController={(value) => {
              controller = value;
            }}
          />
        );

        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });

        expect(controller.attempt?.status).toBe(outcome === 'sending' ? 'sending' : 'unknown');
        expect(view.getByText('上次保存结果尚未确认，请先到原站核对。')).toBeTruthy();
        expect(view.getByRole('button', { name: '保存修改' })).toBeDisabled();

        const writesBefore = transport.writes().length;
        await act(async () => {
          await controller.submit();
        });
        expect(transport.writes()).toHaveLength(writesBefore);
        expect(controller.draft).toMatchObject({
          id: otherDraft ? otherDraft.id : localDraft.id,
          title: '受保护的本页标题',
          body: '受保护的本页正文',
          attachments: [file]
        });
      } finally {
        releaseOtherSending.resolve();
        if (otherSubmitting) await act(async () => otherSubmitting);
        if (otherView) await otherView.unmount();
        await view.unmount();
      }
    }
  );
});
