import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DatabaseSync } from 'node:sqlite';
import { loadTopicDraft, readTopicSubmissionAttempt } from '@/platform/persistence/topicDrafts';
import type { TopicCreationSource } from '@/domain/forum/topicComposer';
import type { ComposerHostMessage } from '@/ui/composer/structuredComposerBridge';
import { createTopicProofTransport, topicProofBody, topicProofTitle } from '../../helpers/topicCreationTransport';
import { createTopicEditTransport } from '../../helpers/topicEditingTransport';
import { TopicCreationFixture } from '../topicCreationFixture';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, fireEvent, render, waitFor } from '../render';

const mockDatabases = new Map<string, DatabaseSync>();
const mockFiles = new Set<string>();
// Replace native I/O only: routes, controllers, gateways and SQLite statements remain production code.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => {
    const { DatabaseSync } = jest.requireActual<typeof import('node:sqlite')>('node:sqlite');
    const db = mockDatabases.get(name) || new DatabaseSync(':memory:');
    mockDatabases.set(name, db);
    const parameters = (args: unknown[]) => (Array.isArray(args[0]) ? args[0] : args) as (string | number | null)[];
    return {
      execAsync: async (sql: string) => db.exec(sql),
      runAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).run(...parameters(args)),
      getFirstAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).get(...parameters(args)) ?? null,
      getAllAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...parameters(args))
    };
  }
}));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('/');
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    write() {
      mockFiles.add(this.uri);
    }
  }
  return { File, Paths: { cache: 'file:///synthetic-cache', document: 'file:///synthetic-documents' } };
});
jest.mock('react-native-reanimated', () => ({
  ...jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated'),
  __esModule: true,
  useAnimatedKeyboard: () =>
    jest.requireActual<typeof import('react')>('react').useRef({ height: { value: 0 }, state: { value: 0 } }).current,
  useAnimatedReaction: () => {}
}));

const sites = ['nodeseek', 'linuxdo', 'yaohuo'] as const;
const observe = () => {};
type Rendered = Awaited<ReturnType<typeof render>>;
function messages(view: Rendered): ComposerHostMessage[] {
  return view
    .getByTestId('structured-composer-webview')
    .props.postMessageMock.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
}
async function editor(view: Rendered, source: TopicCreationSource) {
  await waitFor(() => expect(view.getByLabelText('帖子标题')).toBeTruthy());
  // Deliver the Native stack's appearance event; RNTL does not execute its animation.
  await fireEvent(view.getByLabelText('帖子标题'), 'appear');
  if (source === 'yaohuo') return null;
  await waitFor(() => expect(view.getByTestId('structured-composer-webview')).toBeTruthy());
  await fireEvent(view.getByTestId('structured-composer-webview'), 'loadEnd');
  const serialized = view
    .getByTestId('structured-composer-webview')
    .props.source.html.match(/id="composer-initial-document">(.*?)<\/script>/s)?.[1];
  const init = JSON.parse(serialized) as Extract<ComposerHostMessage, { type: 'INIT' }>;
  expect(init).toBeDefined();
  const onMessage = view.getByTestId('structured-composer-webview').props.onMessage;
  const send = (type: string, payload: object) =>
    onMessage({
      nativeEvent: {
        data: JSON.stringify({ type, payload: { documentEpoch: init!.payload.documentEpoch, ...payload } })
      }
    });
  await act(() => send('READY', { revision: 0 }));
  return { send, initial: init!.payload.markdown };
}
function snapshot(markdown: string, revision = 1) {
  return { markdown, revision, mode: 'rich', isEmpty: false, validationIssues: [], pendingNodeSeekPolls: [] };
}
async function respondToSnapshot(view: Rendered, current: Awaited<ReturnType<typeof editor>>, body: string) {
  if (!current) return;
  const request = messages(view).findLast((message) => message.type === 'REQUEST_SNAPSHOT');
  expect(request).toBeDefined();
  await act(() => current.send('SNAPSHOT', { requestId: request!.payload.requestId, snapshot: snapshot(body) }));
}
function rejection(source: TopicCreationSource) {
  return new Response(
    source === 'yaohuo'
      ? '<div class="tip">发帖失败：Mock 拒绝</div>'
      : '{"errors":["Mock rejected"],"success":false,"message":"Mock rejected"}',
    { status: 422 }
  );
}

describe('large topic drafts through production create and edit screens', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockFiles.clear();
  });
  afterAll(() => mockDatabases.forEach((db) => db.close()));

  it.each(sites)(
    '%s retains a 60000-character draft across reopen, rejection and 300 publish presses',
    async (source) => {
      const token = `00ca000${sites.indexOf(source)}`;
      const identity = (site: TopicCreationSource) => `${site}:${parseInt(token, 16) + 1000}`;
      const transport = createTopicProofTransport('success');
      const fetch = transport.fetcher;
      const bodies: string[] = [];
      let release: ((failed?: boolean) => void) | undefined;
      transport.fetcher = async (url, init) => {
        const result = await fetch(url, init);
        if (init?.method !== 'POST') return result;
        bodies.push(String(init.body));
        return new Promise<Response>((resolve) => {
          release = (failed) => resolve(failed ? rejection(source) : result);
        });
      };
      const view = await render(
        <TopicCreationFixture
          token={token}
          source={source}
          transport={transport}
          kind="success"
          observe={observe}
          onNotice={observe}
        />,
        { wrapper: QueryTestWrapper }
      );
      const body = `START-${source}\n${'压力正文 & <raw> 数据\n'.repeat(5000)}`.slice(0, 59_990) + '\nEXACT-END';
      try {
        await waitFor(() => expect(view.getByText('打开测试发帖')).toBeTruthy());
        await fireEvent.press(view.getByText('打开测试发帖'));
        const old = await editor(view, source);
        if (old) await act(() => old.send('SNAPSHOT', { snapshot: snapshot(body) }));
        else await fireEvent.changeText(view.getByLabelText('帖子正文'), body);
        for (let index = 0; index < 100; index++)
          await fireEvent.changeText(view.getByLabelText('帖子标题'), `压力草稿标题 ${index}`);
        await fireEvent.press(view.getByLabelText('返回'));
        await respondToSnapshot(view, old, body);
        await waitFor(() => expect(view.getByText('打开测试发帖')).toBeTruthy());
        expect((await loadTopicDraft(source, identity(source)))?.body).toBe(body);
        await fireEvent.press(view.getByText('打开测试发帖'));
        const current = await editor(view, source);
        expect(view.getByLabelText('帖子标题').props.value).toBe('压力草稿标题 99');
        if (old)
          await act(() => {
            for (let index = 0; index < 100; index++) old.send('SNAPSHOT', { snapshot: snapshot('STALE', index + 2) });
          });
        expect((await loadTopicDraft(source, identity(source)))?.body).toBe(body);
        if (current) expect(current.initial).toBe(body);
        else expect(view.getByLabelText('帖子正文').props.value).toBe(body);
        for (let attempt = 0; attempt < 2; attempt++) {
          const before = current ? messages(view).filter((message) => message.type === 'REQUEST_SNAPSHOT').length : 0;
          for (let index = 0; index < 100; index++) await fireEvent.press(view.getByLabelText('发布'));
          if (current)
            expect(messages(view).filter((message) => message.type === 'REQUEST_SNAPSHOT')).toHaveLength(before + 1);
          await respondToSnapshot(view, current, body);
          await waitFor(() => expect(transport.writes).toHaveLength(attempt + 1));
          if (attempt === 0)
            for (let index = 0; index < 100; index++) await fireEvent.press(view.getByLabelText('发布'));
          expect(transport.writes).toHaveLength(attempt + 1);
          const posted =
            source === 'nodeseek'
              ? JSON.parse(bodies[attempt]!).content
              : source === 'linuxdo'
                ? JSON.parse(bodies[attempt]!).raw
                : new URLSearchParams(bodies[attempt]!).get('book_content');
          expect(posted === (source === 'yaohuo' ? body.replace(/\n/g, '\r\n') : body)).toBe(true);
          await act(() => release?.(attempt === 0));
          if (attempt === 0) {
            await waitFor(() => expect(view.getByLabelText('发布')).toBeEnabled());
            expect((await readTopicSubmissionAttempt(source, identity(source)))?.status).toBe('rejected');
            expect((await loadTopicDraft(source, identity(source)))?.body).toBe(body);
          }
        }
        await waitFor(() => expect(view.getByLabelText('Mock 新主题详情')).toBeTruthy());
        expect(await loadTopicDraft(source, identity(source))).toBeNull();
        expect((await readTopicSubmissionAttempt(source, identity(source)))?.status).toBe('posted');
        for (const other of sites.filter((site) => site !== source))
          expect(await loadTopicDraft(other, identity(other))).toMatchObject({
            title: topicProofTitle(other),
            body: topicProofBody(other)
          });
        expect(transport.blockedRequests).toBe(0);
      } finally {
        await act(() => release?.());
        await view.unmount();
      }
    },
    40_000
  );

  it.each(sites)(
    '%s preserves a 60000-character original through rejection, reopen and 300 save presses',
    async (source) => {
      const token = `00ed000${sites.indexOf(source)}`;
      const userId = String(parseInt(token, 16) + 1000);
      const identity = `${source}:${userId}`;
      const transport = createTopicProofTransport('success');
      const editing = createTopicEditTransport(source, userId);
      const body =
        `  ORIGINAL-${source}\n${'[custom]原始正文 &amp; <raw> 保留[/custom]\n'.repeat(2500)}`.slice(0, 59_990) +
        '\nEXACT-END';
      editing.state.body = body;
      let release: ((failed?: boolean) => void) | undefined;
      editing.respond(
        () =>
          new Promise<Response | undefined>((resolve) => {
            release = (failed) => resolve(failed ? rejection(source) : undefined);
          })
      );
      const view = await render(
        <TopicCreationFixture
          token={token}
          source={source}
          transport={transport}
          editTransport={editing}
          kind="edit"
          observe={observe}
          onNotice={observe}
        />,
        { wrapper: QueryTestWrapper }
      );
      try {
        await waitFor(() => expect(view.getByText('编辑测试主帖')).toBeTruthy());
        await fireEvent.press(view.getByText('编辑测试主帖'));
        let current = await editor(view, source);
        if (current) expect(current.initial).toBe(body);
        else expect(view.getByLabelText('帖子正文').props.value).toBe(body);
        for (let index = 0; index < 100; index++)
          await fireEvent.changeText(view.getByLabelText('帖子标题'), `保留原文编辑标题 ${index}`);
        for (let attempt = 0; attempt < 2; attempt++) {
          const before = current ? messages(view).filter((message) => message.type === 'REQUEST_SNAPSHOT').length : 0;
          for (let index = 0; index < 100; index++) await fireEvent.press(view.getByLabelText('保存修改'));
          if (current)
            expect(messages(view).filter((message) => message.type === 'REQUEST_SNAPSHOT')).toHaveLength(before + 1);
          await respondToSnapshot(view, current, body);
          await waitFor(() => expect(editing.writes()).toHaveLength(attempt + 1));
          if (attempt === 0)
            for (let index = 0; index < 100; index++) await fireEvent.press(view.getByLabelText('保存修改'));
          expect(editing.writes()).toHaveLength(attempt + 1);
          await act(() => release?.(attempt === 0));
          if (attempt === 0) {
            await waitFor(() => expect(view.getByLabelText('保存修改')).toBeEnabled());
            expect((await readTopicSubmissionAttempt(source, identity, 'edit:123'))?.status).toBe('rejected');
            expect((await loadTopicDraft(source, identity, 'edit:123'))?.body).toBe(body);
            expect(editing.state.title).toBe('原有主帖标题');
            await fireEvent.press(view.getByLabelText('返回'));
            await respondToSnapshot(view, current, body);
            await waitFor(() => expect(view.getByText('编辑测试主帖')).toBeTruthy());
            const old = current;
            await fireEvent.press(view.getByText('编辑测试主帖'));
            current = await editor(view, source);
            if (old)
              await act(() => {
                for (let index = 0; index < 100; index++)
                  old.send('SNAPSHOT', { snapshot: snapshot('STALE EDIT', index + 2) });
              });
            expect((await loadTopicDraft(source, identity, 'edit:123'))?.body).toBe(body);
            expect(view.getByLabelText('帖子标题').props.value).toBe('保留原文编辑标题 99');
            if (current) expect(current.initial).toBe(body);
          }
        }
        await waitFor(() => expect(view.getByText('编辑测试主帖')).toBeTruthy());
        expect(editing.state.body === body).toBe(true);
        expect(editing.state.title).toBe('保留原文编辑标题 99');
        expect(await loadTopicDraft(source, identity, 'edit:123')).toBeNull();
        expect((await readTopicSubmissionAttempt(source, identity, 'edit:123'))?.status).toBe('saved');
        for (const target of ['create', 'edit:456'])
          expect(await loadTopicDraft(source, identity, target)).toMatchObject({
            title: topicProofTitle(source),
            body: topicProofBody(source)
          });
        expect(editing.blockedRequests()).toBe(0);
      } finally {
        await act(() => release?.());
        await view.unmount();
      }
    },
    40_000
  );
});
