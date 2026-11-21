import { sqliteParameters as mockSqliteParameters } from '../../helpers/sqliteParameters';
import { createTopicEditTransport } from '../../helpers/topicEditingTransport';
import { createTopicProofTransport } from '../../helpers/topicCreationTransport';
import { loadLinuxDoTopicEditContext } from '@/sources/linuxdo/topicEditing';
import { loadNodeSeekTopicEditContext } from '@/sources/nodeseek/topicEditing';
import { loadYaohuoTopicEditContext } from '@/sources/yaohuo/topicEditing';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Buffer } from 'node:buffer';
import { Alert } from 'react-native';
import type { DatabaseSync } from 'node:sqlite';
import { useTopicComposerController } from '@/features/topic-composer/useTopicComposerController';
import type { TopicComposerRouteRuntimeValue } from '@/features/topic-composer/TopicComposerRouteRuntime';
import { loadLinuxDoTopicCreationContext } from '@/sources/linuxdo/topicCreation';
import {
  accountSessionSnapshotFromEvent,
  createAccountSessionSnapshot,
  createSiteSessionStates,
  siteSessionIdentityKey
} from '@/domain/session/siteSessionState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';
import { prepareRequestToSend } from '@/platform/network/request';
import { loadTopicDraft, readTopicSubmissionAttempt } from '@/platform/persistence/topicDrafts';
import * as topicDraftStore from '@/platform/persistence/topicDrafts';
import type { ComposerSnapshot } from '@/domain/forum/structuredComposer';
import { nodeSeekPendingPollToken, normalizePendingNodeSeekPoll } from '@/domain/forum/structuredComposer';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import { projectTestAccountSessions, testAccountUser } from '../../helpers/accountSessions';
import { useAccountRuntime } from '@/features/account/useAccountRuntime';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  markAccountSessionMigrationCompleted,
  saveAccountSessionSnapshot
} from '@/platform/storage/accountSessionStore';
import { accountQueryKeys, appQueryClient } from '@/platform/query/serverState';
import { browserFetchIntentFromInit } from '@/platform/network/browserFetchIntent';
import type { Fetcher } from '@/platform/network/request';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { render, fireEvent } from '../render';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual<typeof import('react-native-safe-area-context')>('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 })
}));
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WebView: React.forwardRef(function MockWebView(props: Record<string, unknown>, ref: unknown) {
      React.useImperativeHandle(ref, () => ({ stopLoading: jest.fn(), injectJavaScript: jest.fn() }), []);
      return React.createElement(View, { ...props, testID: 'login-webview' });
    })
  };
});
jest.mock('@/platform/network/managedCookies', () => ({
  ...jest.requireActual<typeof import('@/platform/network/managedCookies')>('@/platform/network/managedCookies'),
  setLinuxDoCookieResponseBarrier: jest.fn(async () => undefined),
  readManagedCookieHeader: jest.fn(async (url: string) => ({
    status: 'ok',
    header: url.startsWith('https://linux.do/') ? '_t=fixture-auth; _rt=fixture-runtime' : 'fixture=synthetic'
  }))
}));

const mockDatabases = new Map<string, DatabaseSync>();
let mockSqlFailure = '';
let mockDraftSaveGate: (() => Promise<void>) | undefined;
let mockReceiptGate: (() => Promise<void>) | undefined;
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => {
    const { DatabaseSync } = jest.requireActual<typeof import('node:sqlite')>('node:sqlite');
    const db = mockDatabases.get(name) || new DatabaseSync(':memory:');
    mockDatabases.set(name, db);
    const check = (sql: string) => {
      if (mockSqlFailure && sql.includes(mockSqlFailure)) {
        mockSqlFailure = '';
        throw new Error('disk full');
      }
    };
    return {
      execAsync: async (sql: string) => {
        check(sql);
        db.exec(sql);
      },
      runAsync: async (sql: string, ...args: unknown[]) => {
        check(sql);
        if (sql.includes('UPDATE topic_submission_attempts SET payload') && mockReceiptGate) {
          const gate = mockReceiptGate;
          mockReceiptGate = undefined;
          await gate();
        }
        if (sql.includes('INSERT INTO topic_drafts') && mockDraftSaveGate) {
          const gate = mockDraftSaveGate;
          mockDraftSaveGate = undefined;
          await gate();
        }
        return db.prepare(sql).run(...mockSqliteParameters(args));
      },
      getFirstAsync: async (sql: string, ...args: unknown[]) => {
        check(sql);
        return db.prepare(sql).get(...mockSqliteParameters(args)) ?? null;
      },
      getAllAsync: async (sql: string, ...args: unknown[]) => {
        check(sql);
        return db.prepare(sql).all(...mockSqliteParameters(args));
      },
      closeAsync: async () => undefined
    };
  }
}));

let sequence = 0;
async function setup(source: TopicCreationSource = 'nodeseek', editing = false) {
  const id = editing ? String(40000 + ++sequence) : `submit-${++sequence}`;
  const editTransport = createTopicEditTransport(source, id);
  const proofTransport = createTopicProofTransport('success');
  const sessions = projectTestAccountSessions(
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
  let postedResponse: () => Promise<Response> = async () =>
    new Response(JSON.stringify({ success: true, redirect: '/post-123-1' }));
  let requiredGroup = false;
  let beforeDispatch: (() => void) | undefined;
  const fetcher = jest.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    if (editing) {
      beforeDispatch?.();
      return editTransport.fetcher(url, init);
    }
    if (init?.method === 'POST' && !url.endsWith('/session/csrf')) beforeDispatch?.();
    const request = prepareRequestToSend(init);
    if (request?.method === 'POST' && !url.endsWith('/session/csrf')) return postedResponse();
    if (source === 'yaohuo') return proofTransport.fetcher(url, init);
    if (url.endsWith('/new-discussion')) {
      const config = Buffer.from(
        JSON.stringify({ user: { rank: 2 }, allCategory: [{ key: 'tech', cn_text: '技术' }] })
      ).toString('base64');
      return new Response(`<script>decode('${config}')</script>`);
    }
    if (url.endsWith('/latest')) {
      const settings = {
        min_topic_title_length: 6,
        min_first_post_length: 20,
        max_post_length: 64000,
        max_tags_per_topic: 8,
        authorized_extensions: 'png|pdf',
        post_voting_enabled: true
      };
      const preload = JSON.stringify({ siteSettings: JSON.stringify(settings) }).replace(/"/g, '&quot;');
      return new Response(`<div data-preloaded="${preload}"></div>`);
    }
    if (url.endsWith('/site.json'))
      return new Response(
        JSON.stringify({
          categories: [
            { id: 4, name: '技术', permission: 1 },
            { id: 5, name: '反馈', permission: 1, topic_template: '反馈模板' }
          ],
          groups: []
        })
      );
    if (url.endsWith('/session/current.json'))
      return new Response(JSON.stringify({ current_user: { id: 2, trust_level: 2, can_create_tag: true } }));
    if (url.includes('/tags/filter/search'))
      return new Response(
        JSON.stringify({
          results: [],
          ...(requiredGroup ? { required_tag_group: { name: '领域', min_count: 2 } } : {})
        })
      );
    if (url.endsWith('/session/csrf')) return new Response('{"csrf":"fixture"}');
    throw new Error(`Unexpected request ${url}`);
  });
  let ticketCurrent = true;
  const runtime: TopicComposerRouteRuntimeValue = {
    enabledSources: ['nodeseek', 'linuxdo', 'yaohuo'],
    sessions,
    sessionEpochs: { ...initialForumSessionEpochs },
    appActive: true,
    fetcher,
    ensureNetworkProxyReady: async () => undefined,
    ensureWritableSession: async (site) => ({
      source: site,
      identityKey: siteSessionIdentityKey(runtime.sessions[site]),
      sessionEpoch: 0
    }),
    isWritableSessionTicketCurrent: () => ticketCurrent,
    onSessionExpired: jest.fn(),
    requestAccountRecheck: jest.fn(),
    ensureNodeImageApiKey: async () => null,
    getUserAgent: () => 'fixture',
    getReadPlan: (source, operation) => ({
      source,
      operation,
      state: 'ready',
      lane: 'authenticated',
      transport: 'managed-session',
      cacheScope: 'authenticated:0'
    }),
    getTopic: async () => {
      throw new Error('No cached topic in this fixture');
    },
    getTopicEditContext: (options) => {
      const input = { ...options, fetcher };
      return options.source === 'linuxdo'
        ? loadLinuxDoTopicEditContext(input)
        : options.source === 'nodeseek'
          ? loadNodeSeekTopicEditContext(input)
          : loadYaohuoTopicEditContext(input);
    },
    getEmojiUrls: async () => ({}),
    getLinuxDoTopicCreationContext: ({ signal }) =>
      loadLinuxDoTopicCreationContext({ fetcher, userAgent: 'fixture', signal }),
    openAccount: jest.fn<TopicComposerRouteRuntimeValue['openAccount']>(),
    notify: jest.fn()
  };
  const onPosted = jest.fn();
  const onAccepted = jest.fn();
  const onEdited = jest.fn();
  const hook = await renderHook(
    ({ value, active = true }: { value: TopicComposerRouteRuntimeValue; active?: boolean }) =>
      useTopicComposerController({
        runtime: value,
        intent: editing ? { kind: 'edit', source, topicId: '123' } : { kind: 'create', initialSource: source },
        active,
        onPosted,
        onAccepted,
        onEdited
      }),
    { initialProps: { value: runtime } }
  );
  return {
    ...hook,
    editTransport,
    onEdited,
    runtime,
    source,
    fetcher,
    onPosted,
    onAccepted,
    posts: () => fetcher.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.endsWith('/session/csrf')),
    response: (fn: () => Promise<Response>) => {
      postedResponse = fn;
    },
    requireGroup: () => {
      requiredGroup = true;
    },
    expireAtDispatch: () => {
      beforeDispatch = () => {
        ticketCurrent = false;
      };
    }
  };
}

async function ready(test: Awaited<ReturnType<typeof setup>>) {
  await waitFor(() => expect(test.result.current.context?.source).toBe(test.source));
  await act(() =>
    test.result.current.change((draft) => ({
      ...draft,
      title: '这是一个完整主题标题',
      body: '这是长度足够的正文，用来验证发布之前的保存、检查和结果处理。',
      categoryId: test.source === 'linuxdo' ? '4' : test.source === 'yaohuo' ? '213' : 'tech'
    }))
  );
}
function snapshot(markdown: string, validationIssues: ComposerSnapshot['validationIssues'] = []): ComposerSnapshot {
  return { markdown, validationIssues, mode: 'source', revision: 3, isEmpty: false, pendingNodeSeekPolls: [] };
}
beforeEach(async () => {
  await AsyncStorage.clear();
  mockSqlFailure = '';
  mockDraftSaveGate = undefined;
  mockReceiptGate = undefined;
  appQueryClient.clear();
});
afterEach(() => {
  appQueryClient.clear();
  jest.restoreAllMocks();
});

async function setupAccountChain(source: TopicCreationSource, failureStatus: number, probeOutcome = 'same') {
  const id = String(50000 + ++sequence);
  appQueryClient.setQueryData(
    accountQueryKeys.snapshot(source),
    accountSessionSnapshotFromEvent(createAccountSessionSnapshot(source), {
      type: 'session-updated',
      loggedIn: true,
      currentUser: { ...testAccountUser(source), id }
    })
  );
  await saveAccountSessionSnapshot(
    appQueryClient.getQueryData<ReturnType<typeof createAccountSessionSnapshot>>(accountQueryKeys.snapshot(source))!
  );
  await markAccountSessionMigrationCompleted();
  jest
    .spyOn(SecureStore, 'getItemAsync')
    .mockImplementation(async (key) => (key.endsWith('-user-agent') ? 'Saved fixture browser UA' : null));
  const transport = createTopicProofTransport('success');
  let writeStatus = failureStatus;
  let writes = 0;
  let probes = 0;
  const fetcher: Fetcher = async (input, init) => {
    if (input === 'https://linux.do/cdn-cgi/trace') return new Response('ip=192.0.2.17\nhttp=h2\n');
    if (
      browserFetchIntentFromInit(init)?.owner === 'account' ||
      (source === 'yaohuo' && input.endsWith('/wapindex.aspx?sid=-2'))
    ) {
      probes++;
      if (probeOutcome === 'unknown') return new Response('{"errors":["请先登录"]}', { status: 403 });
      if (source === 'linuxdo' && probeOutcome === 'expired' && probes === 1) return new Response('', { status: 404 });
      if (source === 'linuxdo')
        return new Response(
          JSON.stringify({ current_user: probeOutcome === 'anonymous' ? null : { id, username: id } })
        );
      if (source === 'nodeseek') return new Response(`<a class="Username" href="/space/${id}">proof</a>`);
      return new Response(
        `<div class="top2"><a href="/myfile.aspx">我的地盘</a><a href="/bbs/userinfo.aspx?touserid=${id}">proof</a><a href="/bbs/book_list_search.aspx">帖子</a><a href="/bbs/messagelist.aspx">信箱</a></div>`
      );
    }
    if (init?.method === 'POST' && !input.endsWith('/session/csrf')) {
      prepareRequestToSend(init);
      writes++;
      if (writeStatus)
        return new Response(source === 'yaohuo' ? '<div class="tip">请先登录网站</div>' : '{"errors":["请先登录"]}', {
          status: writeStatus
        });
    }
    return transport.fetcher(input, init);
  };
  let chain!: {
    account: ReturnType<typeof useAccountRuntime>;
    controller: ReturnType<typeof useTopicComposerController>;
    runtime: TopicComposerRouteRuntimeValue;
  };
  const notify = () => {};
  const openUser = async () => {};
  const loginNavigation = { linuxdo: () => true, nodeseek: () => true, yaohuo: () => true, nodeimage: () => true };
  function ComposerHarness({
    runtime,
    account
  }: {
    runtime: TopicComposerRouteRuntimeValue;
    account: ReturnType<typeof useAccountRuntime>;
  }) {
    const controller = useTopicComposerController({
      runtime,
      intent: { kind: 'create', initialSource: source },
      active: true,
      onPosted: () => {},
      onAccepted: () => {}
    });
    chain = { account, controller, runtime };
    return null;
  }
  function Harness() {
    const account = useAccountRuntime({
      appActive: true,
      enabledSources: [source],
      fetcher,
      loginNavigation,
      notify,
      nodeSeekRecoveryThreshold: 1,
      openUser,
      ready: true,
      screen: 'topic',
      webViewBlockMessage: ''
    });
    const runtime: TopicComposerRouteRuntimeValue = {
      enabledSources: [source],
      sessions: account.read.accountSessionViewModels,
      sessionEpochs: account.read.forumSessionEpochs,
      appActive: true,
      fetcher,
      ensureNetworkProxyReady: async () => {},
      ...account.write,
      getUserAgent: () => 'synthetic',
      getEmojiUrls: account.read.readGateway.getEmojiUrls,
      getReadPlan: account.read.readGateway.getReadPlan,
      getLinuxDoTopicCreationContext: account.read.readGateway.getLinuxDoTopicCreationContext,
      getTopicEditContext: account.read.readGateway.getTopicEditContext,
      getTopic: account.read.readGateway.getTopic,
      openAccount: (site, message, recovery) =>
        site === 'linuxdo'
          ? account.hosts.showLinuxDoVerification(message, recovery)
          : site === 'nodeseek'
            ? account.hosts.requestNodeSeekVerification(message || '请登录 NodeSeek')
            : account.hosts.showYaohuoLogin(message),
      notify: () => {}
    };
    return (
      <>
        {account.read.sessionsReady ? <ComposerHarness runtime={runtime} account={account} /> : null}
        {account.hosts.element}
      </>
    );
  }
  const view = await render(<Harness />, { wrapper: QueryTestWrapper });
  await waitFor(() => expect(chain?.account.read.sessionsReady).toBe(true));
  await waitFor(() => expect(chain.controller.context?.source).toBe(source));
  await act(() =>
    chain.controller.change((draft) => ({
      ...draft,
      title: '写入恢复完整标题',
      body: '需要完整保留的草稿正文，这条synthetic请求绝不会到达真实原站。',
      categoryId: source === 'linuxdo' ? '4' : source === 'yaohuo' ? '213' : 'tech'
    }))
  );
  return {
    view,
    chain: () => chain,
    id,
    writes: () => writes,
    probes: () => probes,
    succeed: () => {
      writeStatus = 0;
    }
  };
}

describe('写入账号恢复接线', () => {
  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'preserves a %s failed draft through expiry, real login host detection and an explicit second submit',
    async (source) => {
      const test = await setupAccountChain(source, 401, 'expired');
      const originalEpoch = test.chain().runtime.sessionEpochs[source];
      await act(async () => {
        await test.chain().controller.submit();
      });
      await waitFor(() => expect(test.chain().account.read.accountSessionViewModels[source].isLoggedIn).toBe(false));
      expect(test.chain().runtime.sessionEpochs[source]).toBe(originalEpoch + 1);
      expect((await loadTopicDraft(source, `${source}:${test.id}`))?.body).toContain('需要完整保留');
      expect(await readTopicSubmissionAttempt(source, `${source}:${test.id}`)).toMatchObject({
        status: 'rejected',
        result: { status: 'rejected', message: expect.stringContaining('登录') }
      });
      expect(test.writes()).toBe(1);
      await act(async () => {
        await test.chain().runtime.openAccount(source);
      });
      await waitFor(() => expect(test.view.getByTestId('login-webview')).toBeTruthy());
      expect(test.chain().account.hosts.surfaces[source]).toBe(true);
      if (source === 'linuxdo')
        await fireEvent(test.view.getByTestId('login-webview'), 'message', {
          nativeEvent: {
            url: 'https://linux.do',
            data: JSON.stringify({
              type: 'linuxdo-webview',
              documentKey: 'https://linux.do/latest:1234',
              userAgent: 'Saved fixture browser UA',
              status: 'logged-in',
              hasChallengeMarker: false,
              hasSessionInitialization: true
            })
          }
        });
      await fireEvent.press(test.view.getByText('检测登录'));
      await waitFor(() => expect(test.chain().account.read.accountSessionViewModels[source].isLoggedIn).toBe(true));
      await waitFor(() => expect(test.chain().account.hosts.surfaces[source]).toBe(false));
      await waitFor(() => expect(test.chain().controller.context?.source).toBe(source));
      expect(test.writes()).toBe(1);
      expect(test.chain().controller.draft?.body).toContain('需要完整保留');
      test.succeed();
      await act(async () => {
        await test.chain().controller.submit();
      });
      expect(test.writes()).toBe(2);
      expect(test.chain().controller.attempt?.status).toBe('posted');
      await test.view.unmount();
    }
  );
  it.each([
    ['anonymous', 403],
    ['same', 404],
    ['unknown', 404]
  ] satisfies [string, number][])(
    'settles publishing Account as %s after login HTTP %s without replaying the write',
    async (outcome, status) => {
      const test = await setupAccountChain('linuxdo', status, outcome);
      await act(async () => {
        await test.chain().controller.submit();
      });
      await waitFor(() => expect(test.probes()).toBe(1));
      await waitFor(() => expect(test.chain().account.read.accountSessionViewModels.linuxdo.isVerifying).toBe(false));
      expect(test.chain().account.read.accountSessionViewModels.linuxdo.isLoggedIn).toBe(outcome !== 'anonymous');
      expect(test.writes()).toBe(1);
      expect((await loadTopicDraft('linuxdo', `linuxdo:${test.id}`))?.body).toContain('需要完整保留');
      expect(await readTopicSubmissionAttempt('linuxdo', `linuxdo:${test.id}`)).toMatchObject({
        status: 'rejected',
        result: { status: 'rejected', message: expect.stringContaining('登录') }
      });
      await act(async () => {
        await test.chain().runtime.openAccount('linuxdo');
      });
      await waitFor(() => expect(test.view.getByTestId('login-webview')).toBeTruthy());
      await fireEvent.press(test.view.getByLabelText('关闭'));
      await waitFor(() => expect(test.chain().account.hosts.surfaces.linuxdo).toBe(false));
      expect(test.writes()).toBe(1);
      await test.view.unmount();
    }
  );
});

describe('创建主题发布控制器', () => {
  it('keeps a child poll dispatch separate from the unsent topic and never repeats an unknown poll creation', async () => {
    const test = await setup('nodeseek');
    await ready(test);
    const poll = normalizePendingNodeSeekPoll({
      localId: 'child-poll-dispatch',
      title: '未确认投票',
      multiple: false,
      isPublic: true,
      options: ['A', 'B']
    });
    await act(() =>
      test.result.current.change((draft) => ({
        ...draft,
        body: nodeSeekPendingPollToken(poll.localId),
        pendingNodeSeekPolls: [poll]
      }))
    );
    test.response(async () => {
      throw new Error('connection lost after poll dispatch');
    });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(test.posts()[0]?.[0]).toBe('https://www.nodeseek.com/api/vote/info');
    expect(test.result.current.attempt?.status).toBe('rejected');
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(test.result.current.error).toContain('上次创建结果未知');
    await test.unmount();
  });
  it.each([
    ['linuxdo', 401],
    ['linuxdo', 404],
    ['nodeseek', 401],
    ['yaohuo', 401]
  ] satisfies [TopicCreationSource, number][])(
    'reports a %s main-post edit HTTP %s failure and retains the edit without replaying',
    async (source, status) => {
      const test = await setup(source, true);
      await waitFor(() => expect(test.result.current.editContext?.source).toBe(source));
      await act(() => test.result.current.change((draft) => ({ ...draft, title: '需要保留的编辑标题' })));
      test.editTransport.respond(
        () =>
          new Response(
            source === 'yaohuo' ? '<div class="tip">请先登录网站</div>' : '{"errors":["您需要登录才能执行此操作。"]}',
            { status }
          )
      );
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.editTransport.writes()).toHaveLength(1);
      expect(test.result.current.attempt?.status).toBe('rejected');
      expect(
        await loadTopicDraft(source, siteSessionIdentityKey(test.runtime.sessions[source]), 'edit:123')
      ).toMatchObject({ title: '需要保留的编辑标题' });
      if (status === 401) expect(test.runtime.onSessionExpired).toHaveBeenCalledWith(source, 0);
      else expect(test.runtime.requestAccountRecheck).toHaveBeenCalledWith(source, 0);
      await test.unmount();
    }
  );
  it('keeps a LINUX DO post draft when the server returns a verification page with HTTP 401', async () => {
    const test = await setup('linuxdo');
    await ready(test);
    test.response(
      async () =>
        new Response('<title>Just a moment...</title>', { status: 401, headers: { 'content-type': 'text/html' } })
    );
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(await loadTopicDraft('linuxdo', siteSessionIdentityKey(test.runtime.sessions.linuxdo))).toMatchObject({
      body: '这是长度足够的正文，用来验证发布之前的保存、检查和结果处理。'
    });
    expect(test.runtime.onSessionExpired).not.toHaveBeenCalled();
    expect(test.runtime.requestAccountRecheck).not.toHaveBeenCalled();
    await test.unmount();
  });

  it.each([401, 404])(
    'ignores a stale linux.do publishing HTTP %s response while retaining its rejected receipt',
    async (status) => {
      const test = await setup('linuxdo');
      await ready(test);
      test.response(async () => {
        test.expireAtDispatch();
        test.runtime.isWritableSessionTicketCurrent = () => false;
        return new Response('{"errors":["您需要登录才能执行此操作。"]}', { status });
      });
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.posts()).toHaveLength(1);
      expect(test.result.current.attempt?.status).toBe('rejected');
      expect(test.runtime.onSessionExpired).not.toHaveBeenCalled();
      expect(test.runtime.requestAccountRecheck).not.toHaveBeenCalled();
      await test.unmount();
    }
  );

  it.each([
    ['linuxdo', 401],
    ['linuxdo', 403],
    ['linuxdo', 404],
    ['nodeseek', 401],
    ['yaohuo', 401]
  ] satisfies [TopicCreationSource, number][])(
    'reports a %s publishing login failure HTTP %s and preserves the draft without replaying',
    async (source, status) => {
      const test = await setup(source);
      await ready(test);
      test.response(
        async () =>
          new Response(
            source === 'yaohuo'
              ? '<div class="tip">请先登录网站</div>'
              : JSON.stringify({ errors: ['您需要登录才能执行此操作。'] }),
            { status }
          )
      );
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.posts()).toHaveLength(1);
      expect(test.result.current.attempt?.status).toBe('rejected');
      expect(test.result.current.error).toContain('登录');
      expect(await loadTopicDraft(source, siteSessionIdentityKey(test.runtime.sessions[source]))).toMatchObject({
        body: '这是长度足够的正文，用来验证发布之前的保存、检查和结果处理。'
      });
      if (status === 401) {
        expect(test.runtime.onSessionExpired).toHaveBeenCalledWith(source, 0);
        expect(test.runtime.requestAccountRecheck).not.toHaveBeenCalled();
      } else {
        expect(test.runtime.requestAccountRecheck).toHaveBeenCalledWith(source, 0);
        expect(test.runtime.onSessionExpired).not.toHaveBeenCalled();
      }
      await test.unmount();
    }
  );
  it.each([false, true])(
    'clears corrected editor errors without dropping other field errors (edit=%s)',
    async (editing) => {
      const test = await setup('nodeseek', editing);
      await ready(test);
      const pendingNodeSeekPolls = [
        { localId: 'poll_local_1', fingerprint: '', title: '', options: [], multiple: false, isPublic: true }
      ];
      await act(() => test.result.current.change((draft) => ({ ...draft, title: '', body: '', pendingNodeSeekPolls })));
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.errors).toMatchObject({
        title: '请输入标题',
        body: '请输入正文',
        poll: '请输入投票标题'
      });

      await act(() => test.result.current.acceptSnapshot({ ...snapshot(''), mode: 'rich', pendingNodeSeekPolls }));
      expect(test.result.current.errors.body).toBe('请输入正文');
      expect(test.result.current.errors.poll).toBe('请输入投票标题');
      await act(() => test.result.current.acceptSnapshot(snapshot('已经补充完整的正文内容。')));
      expect(test.result.current.errors).toEqual({ title: '请输入标题' });
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.errors).toEqual({ title: '请输入标题' });
      expect(test.posts()).toHaveLength(0);
      expect(test.editTransport.writes()).toHaveLength(0);
    }
  );

  it.each(['nodeseek', 'linuxdo', 'yaohuo'] as const)(
    'preserves untouched raw body across consecutive %s edits without publishing',
    async (source) => {
      const test = await setup(source, true);
      await waitFor(() => expect(test.result.current.editContext?.source).toBe(source));
      const original = test.result.current.draft!.body;
      expect(original).toBe(test.editTransport.state.body);
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.editTransport.writes()).toHaveLength(0);
      await act(() => {
        test.result.current.change((value) => ({ ...value, title: '第一次编辑' }));
        if (source !== 'yaohuo')
          test.result.current.acceptSnapshot({ ...snapshot('编辑器初始化时的归一化文本'), revision: 0 });
      });
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.error).toBe('');
      expect(test.onEdited).toHaveBeenCalledWith(source, '123');
      expect(test.onPosted).not.toHaveBeenCalled();
      expect(test.editTransport.state.body).toBe(original);
      expect(test.editTransport.writes()).toHaveLength(1);
      expect(
        await loadTopicDraft(source, siteSessionIdentityKey(test.runtime.sessions[source]), 'edit:123')
      ).toBeNull();
      await test.unmount();
      const returned = await renderHook(() =>
        useTopicComposerController({
          runtime: test.runtime,
          intent: { kind: 'edit', source, topicId: '123' },
          active: true,
          onPosted: test.onPosted,
          onAccepted: test.onAccepted,
          onEdited: test.onEdited
        })
      );
      await waitFor(() => expect(returned.result.current.editContext).not.toBeNull());
      expect(test.onEdited).toHaveBeenCalledTimes(1);
      expect(returned.result.current.draft?.title).toBe('第一次编辑');
      await act(() => returned.result.current.change((value) => ({ ...value, title: '第二次编辑' })));
      await act(async () => {
        await returned.result.current.submit();
      });
      expect(test.editTransport.writes()).toHaveLength(2);
      expect(test.editTransport.state.title).toBe('第二次编辑');
      expect(test.editTransport.state.body).toBe(original);
    }
  );

  it.each(['reviewLatest', 'rebaseEdit'] as const)(
    'keeps the draft and reports a local save failure during %s',
    async (action) => {
      const test = await setup('nodeseek', true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      await act(() => test.result.current.change((value) => ({ ...value, title: '必须保留的本机标题' })));
      mockSqlFailure = 'INSERT INTO topic_drafts';
      await act(async () => {
        await expect(test.result.current[action]()).resolves.toBeUndefined();
      });
      expect(test.result.current.error).toContain('disk');
      expect(test.result.current.draft?.title).toBe('必须保留的本机标题');
      expect(test.editTransport.writes()).toHaveLength(0);
    }
  );

  it.each(['nodeseek', 'yaohuo'] as const)('confirms %s editing charges before any save request', async (source) => {
    const test = await setup(source, true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() =>
      test.result.current.change((value) =>
        value.source === 'nodeseek' ? { ...value, rank: 255 } : { ...value, additionalReward: '1000' }
      )
    );
    let accept = false;
    const dialog = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === (accept ? '确认保存' : '取消'))?.onPress?.();
    });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(dialog).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(source === 'nodeseek' ? '10 鸡腿' : '1000 妖晶'),
      expect.any(Array),
      expect.any(Object)
    );
    expect(test.editTransport.writes()).toHaveLength(0);
    accept = true;
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.editTransport.writes()).toHaveLength(1);
    expect(test.onEdited).toHaveBeenCalledTimes(1);
  });

  it.each(['nodeseek', 'yaohuo'] as const)(
    'ignores a stale %s charge confirmation after returning to the editor',
    async (source) => {
      const test = await setup(source, true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      await act(() =>
        test.result.current.change((value) =>
          value.source === 'nodeseek' ? { ...value, rank: 255 } : { ...value, additionalReward: '1000' }
        )
      );
      const dialog = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const confirmCharge = async () => {
        const expectedCalls = dialog.mock.calls.length + 1;
        let pending!: Promise<void>;
        await act(() => {
          pending = test.result.current.submit();
        });
        await waitFor(() => expect(dialog).toHaveBeenCalledTimes(expectedCalls));
        const press = dialog.mock.calls.at(-1)?.[2]?.find((button) => button.text === '确认保存')?.onPress;
        if (!press) throw new Error('Missing charge confirmation');
        return async () =>
          act(async () => {
            press();
            await pending;
          });
      };
      try {
        const oldConfirmation = await confirmCharge();
        await test.rerender({ value: test.runtime, active: false });
        await test.rerender({ value: test.runtime, active: true });
        await oldConfirmation();
        expect(test.editTransport.writes().length).toBe(0);
        expect(
          await readTopicSubmissionAttempt(source, siteSessionIdentityKey(test.runtime.sessions[source]), 'edit:123')
        ).toBeNull();

        const currentConfirmation = await confirmCharge();
        await currentConfirmation();
        expect(test.editTransport.writes().length).toBe(1);
        expect(test.onEdited).toHaveBeenCalledTimes(1);
      } finally {
        dialog.mockRestore();
        await test.unmount();
      }
    }
  );

  it('keeps local conflicting edits until the user reviews and explicitly rebases them', async () => {
    const test = await setup('nodeseek', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, title: '本机标题' })));
    test.editTransport.state.body = '其他客户端修改的正文';
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('conflict');
    expect(test.editTransport.writes()).toHaveLength(0);
    await act(async () => {
      await test.result.current.reviewLatest();
    });
    expect(test.result.current.draft?.title).toBe('本机标题');
    expect(test.result.current.draft?.body).not.toBe(test.editTransport.state.body);
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '继续编辑')?.onPress?.();
    });
    await act(async () => {
      await test.result.current.rebaseEdit();
    });
    expect(test.result.current.draft).toMatchObject({ title: '本机标题', body: test.editTransport.state.body });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.onEdited).toHaveBeenCalledTimes(1);
    expect(test.editTransport.writes()).toHaveLength(1);
  });

  it.each(['saved', 'partial'] as const)(
    'keeps the canonical title after a %s edit when a newer snapshot changes only the body',
    async (status) => {
      const test = await setup('linuxdo', true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      const canonical = status === 'saved' ? '本机提交的标题…' : test.editTransport.state.title;
      await act(() =>
        test.result.current.change((value) => ({
          ...value,
          title: status === 'saved' ? '本机提交的标题...' : canonical + ' ',
          ...(status === 'partial' ? { body: '第一次尝试保存的正文' } : {})
        }))
      );
      const latest = '服务器处理标题时继续输入的新正文，读者明确只希望更新正文这一项。';
      test.editTransport.respond(async (path) => {
        if (path === '/t/-/123.json') {
          if (status === 'saved') test.result.current.acceptSnapshot(snapshot(latest));
          test.editTransport.state.title = canonical;
          return new Response(JSON.stringify({ basic_topic: { id: 123, title: canonical } }));
        }
        if (path === '/posts/789.json' && status === 'partial') {
          test.result.current.acceptSnapshot(snapshot(latest));
          return new Response('{"errors":["正文拒绝"]}', { status: 422 });
        }
        return undefined;
      });
      await act(async () => {
        await test.result.current.submit();
      });
      const retained = test.result.current.draft;
      test.editTransport.respond(undefined);
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.editTransport.writes().map((request) => request.path)).toEqual([
        '/t/-/123.json',
        ...(status === 'partial' ? ['/posts/789.json'] : []),
        '/posts/789.json'
      ]);
      expect(retained).toMatchObject({ title: canonical, body: latest, edit: { original: { title: canonical } } });
    }
  );

  it.each(['pending', 'flushed', 'committing receipt'])(
    'retains newer input across a successful edit and reopening (%s)',
    async (stage) => {
      const test = await setup('nodeseek', true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      const sent = Promise.withResolvers<void>();
      const receipt = Promise.withResolvers<void>();
      test.editTransport.respond(async (path) => {
        if (path.includes('edit-discussion')) {
          sent.resolve();
          await receipt.promise;
        }
        return undefined;
      });
      await act(() => test.result.current.change((value) => ({ ...value, title: '第一版提交的标题' })));
      let saving!: Promise<void>;
      await act(() => {
        saving = test.result.current.submit();
      });
      await sent.promise;
      const latest = '保存上次修改时继续输入的正文';
      const recording = Promise.withResolvers<void>();
      const committing = Promise.withResolvers<void>();
      if (stage === 'committing receipt') {
        mockReceiptGate = () => {
          recording.resolve();
          return committing.promise;
        };
        receipt.resolve();
        await recording.promise;
      }
      await act(() => test.result.current.acceptSnapshot(snapshot(latest)));
      if (stage === 'flushed')
        await act(async () => {
          await test.result.current.flush();
        });
      await act(async () => {
        receipt.resolve();
        committing.resolve();
        await saving;
      });
      const owner = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
      expect(test.onEdited).not.toHaveBeenCalled();
      expect(await loadTopicDraft('nodeseek', owner, 'edit:123')).toMatchObject({
        body: latest,
        edit: { original: { title: '第一版提交的标题' } }
      });
      await test.unmount();
      const resumed = await renderHook(() =>
        useTopicComposerController({
          runtime: test.runtime,
          intent: { kind: 'edit', source: 'nodeseek', topicId: '123' },
          active: true,
          onEdited: test.onEdited,
          onAccepted: test.onAccepted,
          onPosted: test.onPosted
        })
      );
      await waitFor(() => expect(resumed.result.current.editContext).not.toBeNull());
      expect(test.onEdited).not.toHaveBeenCalled();
      expect(resumed.result.current.draft?.body).toBe(latest);
      expect(test.editTransport.writes()).toHaveLength(1);
      await act(async () => {
        await resumed.result.current.submit();
      });
      expect(test.editTransport.state.body).toBe(latest);
      expect(test.editTransport.writes()).toHaveLength(2);
      expect(test.onEdited).toHaveBeenCalledTimes(1);
    }
  );

  it.each(['reopened', 'still mounted'])(
    'does not repeat an acknowledged Yaohuo reward from a %s editor with newer body text',
    async (state) => {
      const test = await setup('yaohuo', true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        buttons?.find((button) => button.text === '确认保存')?.onPress?.();
      });
      await act(() => test.result.current.change((value) => ({ ...value, additionalReward: '1000' })));
      await act(async () => {
        await test.result.current.flush();
      });
      const enter = () =>
        renderHook(() =>
          useTopicComposerController({
            runtime: test.runtime,
            intent: { kind: 'edit', source: 'yaohuo', topicId: '123' },
            active: true,
            onEdited: test.onEdited,
            onAccepted: test.onAccepted,
            onPosted: test.onPosted
          })
        );
      let other = await enter();
      await waitFor(() => expect(other.result.current.editContext).not.toBeNull());
      const sent = Promise.withResolvers<void>();
      const receipt = Promise.withResolvers<void>();
      test.editTransport.respond(async () => {
        sent.resolve();
        await receipt.promise;
        return undefined;
      });
      let saving!: Promise<void>;
      await act(() => {
        saving = test.result.current.submit();
      });
      await sent.promise;
      const latest = '另一个编辑器保留的正文';
      await act(() => other.result.current.change((value) => ({ ...value, body: latest })));
      await act(async () => {
        await other.result.current.flush();
      });
      await act(async () => {
        receipt.resolve();
        await saving;
      });
      await test.unmount();
      test.editTransport.respond(undefined);
      if (state === 'reopened') {
        await other.unmount();
        other = await enter();
        await waitFor(() => expect(other.result.current.editContext).not.toBeNull());
        expect(other.result.current.draft).toMatchObject({ body: latest, additionalReward: '' });
      }
      await act(async () => {
        await other.result.current.submit();
      });
      expect(
        test.editTransport.writes().map((write) => new URLSearchParams(write.body).get('additionalReward') || '')
      ).toEqual(['1000', '']);
      expect(test.editTransport.state.body).toBe(latest);
    }
  );

  it('preserves editor input received while reviewing a new baseline and while persisting it', async () => {
    const test = await setup('linuxdo', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, body: '保留本机初稿' })));
    test.editTransport.state.title = '其他客户端的新标题';
    await act(async () => {
      await test.result.current.reviewLatest();
    });
    const confirm = Promise.withResolvers<() => void>();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      confirm.resolve(() => buttons?.find((button) => button.text === '继续编辑')?.onPress?.());
    });
    const entered = Promise.withResolvers<void>();
    const saveGate = Promise.withResolvers<void>();
    let rebasing!: Promise<void>;
    await act(() => {
      rebasing = test.result.current.rebaseEdit();
    });
    const accept = await confirm.promise;
    await act(() => test.result.current.change((value) => ({ ...value, title: '确认期间修改的标题' })));
    mockDraftSaveGate = () => {
      entered.resolve();
      return saveGate.promise;
    };
    await act(() => accept());
    await entered.promise;
    const latest = '写入新基准期间又输入的正文';
    await act(() => test.result.current.acceptSnapshot(snapshot(latest)));
    await act(async () => {
      saveGate.resolve();
      await rebasing;
      await test.result.current.flush();
    });
    const expected = {
      title: '确认期间修改的标题',
      body: latest,
      edit: { original: { title: test.editTransport.state.title } }
    };
    expect(test.result.current.draft).toMatchObject(expected);
    expect(
      await loadTopicDraft('linuxdo', siteSessionIdentityKey(test.runtime.sessions.linuxdo), 'edit:123')
    ).toMatchObject(expected);
    expect(test.editTransport.writes()).toHaveLength(0);
  });

  it.each([false, true])(
    'records the selected dynamic template once for the active linux.do topic editor (editing: %s)',
    async (editing) => {
      const test = await setup('linuxdo', editing);
      if (editing) {
        await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
        test.editTransport.respond((path) =>
          path === '/discourse_templates/24/use' ? new Response('{"success":true}') : undefined
        );
      } else await ready(test);
      await act(async () => {
        await test.result.current.editorServices.useTemplate('24');
      });
      expect(test.posts().map(([url]) => new URL(url).pathname)).toEqual(['/discourse_templates/24/use']);
      await test.rerender({ value: test.runtime, active: false });
      await expect(test.result.current.editorServices.useTemplate('25')).rejects.toThrow();
      expect(test.posts()).toHaveLength(1);
      expect(test.onPosted).not.toHaveBeenCalled();
      expect(test.onEdited).not.toHaveBeenCalled();
    }
  );

  it('restores a partial edit and sends only remaining body after remount', async () => {
    const test = await setup('linuxdo', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    test.editTransport.respond((path) =>
      path === '/posts/789.json' ? new Response('{"errors":["正文拒绝"]}', { status: 422 }) : undefined
    );
    await act(() => test.result.current.change((value) => ({ ...value, title: '已保存标题', body: '待保存正文' })));
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('partial');
    expect(test.result.current.draft?.edit?.original.title).toBe('已保存标题');
    await test.unmount();
    test.editTransport.respond(undefined);
    const resumed = await renderHook(() =>
      useTopicComposerController({
        runtime: test.runtime,
        intent: { kind: 'edit', source: 'linuxdo', topicId: '123' },
        active: true,
        onPosted: test.onPosted,
        onAccepted: test.onAccepted,
        onEdited: test.onEdited
      })
    );
    await waitFor(() => expect(resumed.result.current.context?.source).toBe('linuxdo'));
    expect(resumed.result.current.error).toContain('部分修改已保存');
    expect(resumed.result.current.draft?.body).toBe('待保存正文');
    await act(async () => {
      await resumed.result.current.submit();
    });
    expect(test.editTransport.writes().map((row) => row.path)).toEqual([
      '/t/-/123.json',
      '/posts/789.json',
      '/posts/789.json'
    ]);
    expect(test.onEdited).toHaveBeenCalledTimes(1);
  });

  it.each(['acknowledge', 'restart'] as const)(
    'retains confirmed edit steps after local persistence fails and %s',
    async (recovery) => {
      const test = await setup('linuxdo', true);
      await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
      test.editTransport.respond((path) => {
        if (path !== '/posts/789.json') return undefined;
        mockSqlFailure = 'INSERT INTO topic_drafts';
        return new Response('{"errors":["正文拒绝"]}', { status: 422 });
      });
      await act(() => test.result.current.change((value) => ({ ...value, title: '已确认标题', body: '待保存正文' })));
      await act(async () => {
        await test.result.current.submit();
      });
      expect(test.result.current.attempt?.status).toBe('unknown');
      const identity = siteSessionIdentityKey(test.runtime.sessions.linuxdo);
      await act(() =>
        test.result.current.change((value) => ({ ...value, title: '之后继续修改的标题', body: '之后继续修改的正文' }))
      );
      let resumed = test;
      if (recovery === 'acknowledge') {
        jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
          buttons?.find((button) => button.text === '已核对，未保存')?.onPress?.();
        });
        mockSqlFailure = 'INSERT INTO topic_drafts';
        await act(async () => {
          await test.result.current.acknowledgeUnknown();
        });
        expect(test.result.current.attempt?.status).toBe('unknown');
        expect(await readTopicSubmissionAttempt('linuxdo', identity, 'edit:123')).toMatchObject({
          confirmed: { title: '已确认标题' }
        });
        await act(async () => {
          await test.result.current.acknowledgeUnknown();
        });
        expect(test.result.current.attempt).toBeNull();
      } else {
        await act(async () => {
          await test.result.current.flush();
        });
        await test.unmount();
        resumed = {
          ...test,
          ...(await renderHook(() =>
            useTopicComposerController({
              runtime: test.runtime,
              intent: { kind: 'edit', source: 'linuxdo', topicId: '123' },
              active: true,
              onPosted: test.onPosted,
              onAccepted: test.onAccepted,
              onEdited: test.onEdited
            })
          ))
        };
        await waitFor(() => expect(resumed.result.current.editContext).not.toBeNull());
      }
      expect(resumed.result.current.draft?.edit?.original.title).toBe('已确认标题');
      expect(resumed.result.current.draft?.title).toBe('之后继续修改的标题');
      expect(resumed.result.current.draft?.body).toBe('之后继续修改的正文');
      await act(() => resumed.result.current.change((value) => ({ ...value, title: '已确认标题' })));
      test.editTransport.respond(undefined);
      await act(async () => {
        await resumed.result.current.submit();
      });
      expect(test.editTransport.writes().map((row) => row.path)).toEqual([
        '/t/-/123.json',
        '/posts/789.json',
        '/posts/789.json'
      ]);
      expect(test.onEdited).toHaveBeenCalledTimes(1);
    }
  );

  it('preserves a late editor snapshot while confirmed fields are being saved locally', async () => {
    const test = await setup('linuxdo', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    let release: (() => void) | undefined;
    test.editTransport.respond((path) => {
      if (path !== '/posts/789.json') return undefined;
      mockDraftSaveGate = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      return new Response('{"errors":["正文拒绝"]}', { status: 422 });
    });
    await act(() => test.result.current.change((value) => ({ ...value, title: '已确认标题', body: '已提交正文' })));
    let pending: Promise<void> | undefined;
    await act(() => {
      pending = test.result.current.submit();
    });
    await waitFor(() => expect(release).toBeDefined());
    await act(() => test.result.current.acceptSnapshot(snapshot('编辑器晚到的最新正文')));
    await act(async () => {
      release!();
      await pending;
    });
    expect(test.result.current.draft?.body).toBe('编辑器晚到的最新正文');
    await act(async () => {
      await test.result.current.flush();
    });
    expect(
      await loadTopicDraft('linuxdo', siteSessionIdentityKey(test.runtime.sessions.linuxdo), 'edit:123')
    ).toMatchObject({
      body: '编辑器晚到的最新正文',
      edit: { original: { title: '已确认标题' } }
    });
  });

  it.each(['unknown', 'saved'] as const)('keeps a stored %s edit receipt when an older read fails', async (status) => {
    const test = await setup('nodeseek', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, title: '检查中的标题' })));
    const identity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
    const read = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    test.fetcher.mockImplementationOnce(async () => {
      read.resolve();
      await release.promise;
      throw new Error('过期读取失败');
    });
    let saving: Promise<void> | undefined;
    try {
      await act(() => {
        saving = test.result.current.submit();
      });
      await read.promise;
      const pending = await readTopicSubmissionAttempt('nodeseek', identity, 'edit:123');
      if (pending?.status !== 'sending') throw new Error('Missing pending edit');
      await topicDraftStore.settleTopicSubmissionAttempt(pending, { status, message: '原站核对结果' });
      await act(async () => {
        release.resolve();
        await saving;
      });
      expect(test.result.current.attempt).toEqual(await readTopicSubmissionAttempt('nodeseek', identity, 'edit:123'));
      expect(test.result.current.error).toBe(status === 'saved' ? '' : '原站核对结果');
      expect(test.editTransport.writes()).toHaveLength(0);
    } finally {
      release.resolve();
      await saving;
      await test.unmount();
    }
  });

  it('retains an unknown edit and blocks a second save', async () => {
    const test = await setup('nodeseek', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, title: '待核对标题' })));
    test.editTransport.respond(() => {
      throw new Error('connection lost');
    });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('unknown');
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.editTransport.writes()).toHaveLength(1);
    expect(test.onEdited).not.toHaveBeenCalled();
    expect(
      await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek), 'edit:123')
    ).toMatchObject({ title: '待核对标题' });
  });

  it('does not submit editing content after the account ticket expires', async () => {
    const test = await setup('nodeseek', true);
    await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
    await act(() => test.result.current.change((value) => ({ ...value, title: '另一账号不能发送此稿' })));
    test.expireAtDispatch();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.editTransport.writes()).toHaveLength(0);
    expect(test.onEdited).not.toHaveBeenCalled();
  });
  it.each(['posted', 'enqueued', 'rejected', 'unknown'] as const)(
    'settles a %s receipt while its retained route is inactive and allows editing on return',
    async (status) => {
      const test = await setup('linuxdo');
      await ready(test);
      const previousDraft = test.result.current.draft!;
      let respond!: (response: Response) => void;
      test.response(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          })
      );
      let submitting!: Promise<void>;
      await act(() => {
        submitting = test.result.current.submit();
      });
      await waitFor(() => expect(test.posts()).toHaveLength(1));
      await test.rerender({ value: test.runtime, active: false });
      await act(async () => {
        respond(
          new Response(
            JSON.stringify(
              status === 'posted'
                ? { post: { id: 101, topic_id: 123, post_number: 1 } }
                : status === 'enqueued'
                  ? { success: true, action: 'enqueued' }
                  : status === 'rejected'
                    ? { errors: ['Mock rejected'] }
                    : {}
            ),
            { status: status === 'rejected' ? 422 : 200 }
          )
        );
        await submitting;
      });
      expect((await readTopicSubmissionAttempt('linuxdo', previousDraft.identityKey))?.status).toBe(status);
      expect(test.onPosted).not.toHaveBeenCalled();
      expect(test.onAccepted).not.toHaveBeenCalled();
      await test.rerender({ value: test.runtime, active: true });
      expect(test.result.current.attempt?.status).toBe(status);
      if (status === 'posted' || status === 'enqueued') {
        expect(test.result.current.draft?.id).not.toBe(previousDraft.id);
        expect(test.result.current.draft?.body).toBe('');
      } else expect(test.result.current.draft?.body).toBe(previousDraft.body);
      await act(() => test.result.current.change((draft) => ({ ...draft, title: '返回后继续编辑' })));
      let allowed = false;
      await act(async () => {
        allowed = await test.result.current.leave();
      });
      expect(allowed).toBe(true);
      expect((await loadTopicDraft('linuxdo', previousDraft.identityKey))?.title).toBe('返回后继续编辑');
      expect(test.posts()).toHaveLength(1);
    }
  );

  it('does not reconcile or resend a submission while its original request is pending', async () => {
    const test = await setup();
    await ready(test);
    let respond!: (value: Response) => void;
    test.response(
      () =>
        new Promise((resolve) => {
          respond = resolve;
        })
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === '已核对，未发布')?.onPress?.();
    });
    let pending!: Promise<void>;
    await act(() => {
      pending = test.result.current.submit();
    });
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    await act(async () => {
      await test.result.current.acknowledgeUnknown();
      await test.result.current.submit();
    });
    const reconciled = alert.mock.calls.length;
    await act(async () => {
      respond(new Response(JSON.stringify({ success: true, redirect: '/post-123-1' })));
      await pending;
    });
    expect(reconciled).toBe(0);
    expect(test.posts()).toHaveLength(1);
    expect(test.onPosted).toHaveBeenCalledTimes(1);
  });

  it('分类切换先读取最后输入，不用新分类模板覆盖尚未自动保存的正文', async () => {
    const test = await setup('linuxdo');
    await ready(test);
    await act(() =>
      test.result.current.change((draft) =>
        draft.source === 'linuxdo' ? { ...draft, body: '旧模板', appliedTemplate: '旧模板' } : draft
      )
    );
    test.result.current.editorRef.current = {
      requestSnapshot: async () => snapshot('旧模板\n刚刚输入的最后一个字'),
      insertMarkup: async () => undefined,
      beginImageUpload: async () => 'upload-placeholder',
      finishImageUpload: async () => undefined
    };
    await act(async () => {
      await test.result.current.changeCategory('5');
    });
    expect(test.result.current.draft).toMatchObject({ categoryId: '5', body: '旧模板\n刚刚输入的最后一个字' });
  });
  it('取得最后输入并落盘后发送一次，成功仅清理提交的草稿版本', async () => {
    const test = await setup();
    await ready(test);
    test.result.current.editorRef.current = {
      requestSnapshot: async () => snapshot('最后输入的中文字符字'),
      insertMarkup: async () => undefined,
      beginImageUpload: async () => 'upload-placeholder',
      finishImageUpload: async () => undefined
    };
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(JSON.parse(String(test.posts()[0]![1]?.body))).toHaveProperty('content', '最后输入的中文字符字');
    expect(test.onPosted).toHaveBeenCalledWith(expect.objectContaining({ id: '123' }));
    const identity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
    expect(await loadTopicDraft('nodeseek', identity)).toBeNull();
    expect(await readTopicSubmissionAttempt('nodeseek', identity)).toHaveProperty('status', 'posted');
  });

  it.each(['posted', 'enqueued'] as const)(
    'preserves new input delivered while recording a %s publication',
    async (status) => {
      const test = await setup('linuxdo');
      await ready(test);
      const submitted = test.result.current.draft!.body;
      const recording = Promise.withResolvers<void>();
      const commit = Promise.withResolvers<void>();
      test.response(
        async () =>
          new Response(
            JSON.stringify(
              status === 'posted'
                ? { post: { id: 101, topic_id: 123, post_number: 1 } }
                : { success: true, action: 'enqueued' }
            )
          )
      );
      mockReceiptGate = () => {
        recording.resolve();
        return commit.promise;
      };
      let pending!: Promise<void>;
      await act(() => {
        pending = test.result.current.submit();
      });
      await recording.promise;
      const latest = '发布结果正在写入时继续输入的新正文';
      await act(() => test.result.current.acceptSnapshot(snapshot(latest)));
      await act(async () => {
        commit.resolve();
        await pending;
      });
      expect(test.posts()).toHaveLength(1);
      expect(JSON.parse(String(test.posts()[0]![1]?.body)).raw).toBe(submitted);
      expect(status === 'posted' ? test.onPosted : test.onAccepted).toHaveBeenCalledTimes(1);
      await test.unmount();
      expect(await loadTopicDraft('linuxdo', siteSessionIdentityKey(test.runtime.sessions.linuxdo))).toMatchObject({
        body: latest
      });
    }
  );

  it('编辑器报告未完成节点时保留完整正文并定位错误，零发布请求', async () => {
    const test = await setup();
    await ready(test);
    test.result.current.editorRef.current = {
      requestSnapshot: async () => snapshot('尚未完成的投票', [{ code: 'poll-invalid', message: '请补充投票选项' }]),
      insertMarkup: async () => undefined,
      beginImageUpload: async () => 'upload-placeholder',
      finishImageUpload: async () => undefined
    };
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.errors.body).toBe('请补充投票选项');
    expect(test.posts()).toHaveLength(0);
    expect(await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek))).toHaveProperty(
      'body',
      '尚未完成的投票'
    );
  });

  it('发送后连接中断保留未知记录，再次点击不能重复发送', async () => {
    const test = await setup();
    await ready(test);
    test.response(async () => {
      throw new Error('connection lost');
    });
    await act(async () => {
      await Promise.all([test.result.current.submit(), test.result.current.submit()]);
    });
    expect(test.result.current.attempt?.status).toBe('unknown');
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(test.result.current.attempt?.status).toBe('unknown');
    expect(await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek))).not.toBeNull();
  });

  it.each([
    { editing: false, returned: false },
    { editing: false, returned: true },
    { editing: true, returned: false },
    { editing: true, returned: true }
  ])(
    'keeps unknown writes protected from stale native confirmation (editing=$editing, returned=$returned)',
    async ({ editing, returned }) => {
      const test = await setup('nodeseek', editing);
      const loseResponse = async () => {
        throw new Error('connection lost after dispatch');
      };
      if (editing) {
        await waitFor(() => expect(test.result.current.editContext).not.toBeNull());
        await act(() =>
          test.result.current.change((value) => ({ ...value, body: '保存后的响应丢失，需要在原站核对。' }))
        );
        test.editTransport.respond(loseResponse);
      } else {
        await ready(test);
        test.response(loseResponse);
      }
      const writes = editing ? test.editTransport.writes : test.posts;
      const identity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
      const target = editing ? 'edit:123' : 'create';
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const askToAcknowledge = async () => {
        let pending: Promise<void> | undefined;
        await act(() => {
          pending = test.result.current.acknowledgeUnknown();
        });
        const confirm = alert.mock.calls
          .at(-1)?.[2]
          ?.find((button) => button.text === (editing ? '已核对，未保存' : '已核对，未发布'))?.onPress;
        if (!confirm) throw new Error('Missing unknown submission confirmation');
        return async () =>
          act(async () => {
            confirm();
            await pending;
          });
      };
      try {
        await act(async () => test.result.current.submit());
        const checkpoint = await readTopicSubmissionAttempt('nodeseek', identity, target);
        expect(checkpoint?.status).toBe('unknown');
        expect(writes()).toHaveLength(1);

        const oldConfirmation = await askToAcknowledge();
        await test.rerender({ value: test.runtime, active: false });
        if (returned) await test.rerender({ value: test.runtime, active: true });
        await oldConfirmation();
        if (!returned) await test.rerender({ value: test.runtime, active: true });
        await act(async () => test.result.current.submit());
        expect(writes()).toHaveLength(1);
        expect(await readTopicSubmissionAttempt('nodeseek', identity, target)).toEqual(checkpoint);

        const currentConfirmation = await askToAcknowledge();
        await currentConfirmation();
        expect(await readTopicSubmissionAttempt('nodeseek', identity, target)).toBeNull();
        expect(writes()).toHaveLength(1);
      } finally {
        alert.mockRestore();
        await test.unmount();
      }
    }
  );

  it('发送守卫拒绝过期凭证时记录明确未发送并允许修正后重试', async () => {
    const test = await setup();
    await ready(test);
    test.expireAtDispatch();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.attempt?.status).toBe('rejected');
    expect(test.onPosted).not.toHaveBeenCalled();
    expect(test.result.current.error).toContain('账号已变化');
  });

  it('keeps a restored account draft clear of an older publication adapter failure', async () => {
    const test = await setup();
    await ready(test);
    const returned = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const actualSettle = topicDraftStore.settleTopicSubmissionAttempt;
    // This is the adapter's return boundary, after the real journal transaction has committed.
    // It proves UI publication ownership, not a SQLite transaction or unknown-receipt failure.
    const settle = jest
      .spyOn(topicDraftStore, 'settleTopicSubmissionAttempt')
      .mockImplementationOnce(async (...args) => {
        await actualSettle(...args);
        returned.resolve();
        await release.promise;
        throw new Error('旧发布 adapter 回执失败');
      });
    let submitting: Promise<void> | undefined;
    try {
      await act(() => {
        submitting = test.result.current.submit();
      });
      await returned.promise;
      const originalIdentity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
      const next = {
        ...test.runtime,
        sessions: {
          ...test.runtime.sessions,
          nodeseek: {
            ...test.runtime.sessions.nodeseek,
            currentUser: { ...testAccountUser('nodeseek'), id: 'next-account' }
          }
        }
      };
      await test.rerender({ value: next });
      await waitFor(() => expect(test.result.current.draft?.identityKey).toBe('nodeseek:next-account'));
      await waitFor(() => expect(test.result.current.loading).toBe(false));
      const draft = test.result.current.draft;
      const error = test.result.current.error;
      await act(async () => {
        release.resolve();
        await submitting;
      });
      expect(test.result.current.error).toBe(error);
      expect(test.result.current.draft).toBe(draft);
      expect(test.onPosted).not.toHaveBeenCalled();
      expect(test.onAccepted).not.toHaveBeenCalled();
      expect(test.posts()).toHaveLength(1);
      expect(await readTopicSubmissionAttempt('nodeseek', originalIdentity)).toMatchObject({ status: 'posted' });
    } finally {
      await act(async () => {
        release.resolve();
        await submitting;
      });
      settle.mockRestore();
      await test.unmount();
    }
  });

  it('返回成功前账号变化，只结算原账号记录且不跳转新账号页面', async () => {
    const test = await setup();
    await ready(test);
    let finish!: (response: Response) => void;
    test.response(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    let submitting!: Promise<void>;
    await act(() => {
      submitting = test.result.current.submit();
    });
    await waitFor(() => expect(test.posts()).toHaveLength(1));
    const originalIdentity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
    const next = {
      ...test.runtime,
      sessions: {
        ...test.runtime.sessions,
        nodeseek: {
          ...test.runtime.sessions.nodeseek,
          currentUser: { ...testAccountUser('nodeseek'), id: 'other-account' }
        }
      }
    };
    await test.rerender({ value: next });
    await waitFor(() => expect(test.result.current.draft?.identityKey).toBe('nodeseek:other-account'));
    await act(async () => {
      finish(new Response('{"success":true,"redirect":"/post-123-1"}'));
      await submitting;
    });
    expect(test.onPosted).not.toHaveBeenCalled();
    expect(await loadTopicDraft('nodeseek', originalIdentity)).toBeNull();
    expect(test.result.current.draft?.identityKey).toBe('nodeseek:other-account');
  });

  it('linux.do 发布前重新核对必选标签组，缺少组时不发送', async () => {
    const test = await setup('linuxdo');
    await ready(test);
    test.requireGroup();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.errors.tags).toContain('领域');
    expect(test.posts()).toHaveLength(0);
  });

  it('审核回执只关闭编辑页，不把审核ID作为主题ID', async () => {
    const test = await setup('linuxdo');
    await ready(test);
    test.response(async () => new Response('{"success":true,"action":"enqueued","pending_post":{"id":99}}'));
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.onAccepted).toHaveBeenCalledTimes(1);
    expect(test.onPosted).not.toHaveBeenCalled();
    expect(test.runtime.notify).toHaveBeenCalledWith(expect.stringContaining('审核'));
  });

  it('原站成功后的本机结算失败保留发送门禁，不能再次发布', async () => {
    const test = await setup();
    await ready(test);
    test.response(async () => {
      mockSqlFailure = 'UPDATE topic_submission_attempts';
      return new Response('{"success":true}');
    });
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.result.current.error).toContain('本机记录保存失败');
    expect(test.result.current.attempt?.status).toBe('unknown');
    expect(test.onAccepted).not.toHaveBeenCalled();
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(await loadTopicDraft('nodeseek', siteSessionIdentityKey(test.runtime.sessions.nodeseek))).not.toBeNull();
  });
});

it('keeps a child poll dispatch separate from an unsent main-topic edit and retains its unknown journal', async () => {
  const test = await setup('nodeseek', true);
  try {
    await waitFor(() => expect(test.result.current.editContext?.source).toBe('nodeseek'));
    const poll = normalizePendingNodeSeekPoll({
      localId: 'edit-child-poll-proof',
      title: '未确认编辑投票',
      multiple: false,
      isPublic: true,
      options: ['A', 'B']
    });
    await act(() =>
      test.result.current.change((draft) => ({
        ...draft,
        body: nodeSeekPendingPollToken(poll.localId),
        pendingNodeSeekPolls: [poll]
      }))
    );
    test.editTransport.respond((path) => {
      if (path === '/api/vote/info') throw new Error('connection lost after edit child poll dispatch');
      return undefined;
    });
    await act(async () => {
      await test.result.current.submit();
    });
    const firstStatus = test.result.current.attempt?.status;
    const identity = siteSessionIdentityKey(test.runtime.sessions.nodeseek);
    const db = mockDatabases.get('composer-journal.db');
    const rows =
      db
        ?.prepare('SELECT local_id, remote_id FROM nodeseek_poll_journal WHERE identity_key = ? AND local_id = ?')
        .all(identity, poll.localId) ?? [];
    await act(async () => {
      await test.result.current.submit();
    });
    expect(test.posts()).toHaveLength(1);
    expect(test.posts()[0]?.[0]).toBe('https://www.nodeseek.com/api/vote/info');
    expect(firstStatus).toBe('rejected');
    expect(rows).toEqual([{ local_id: poll.localId, remote_id: null }]);
    expect(test.result.current.error).toContain('上次创建结果未知');
  } finally {
    await test.unmount();
  }
});
