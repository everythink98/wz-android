import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useLayoutEffect } from 'react';
import { createRoot } from 'test-renderer';
import type { DatabaseSync } from 'node:sqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { sqliteParameters as mockSqliteParameters } from '../../helpers/sqliteParameters';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import * as DraftStore from '@/platform/persistence/topicDrafts';
import * as RuntimeContext from '@/features/topic-composer/TopicComposerRouteRuntime';
import type { RootStackParamList } from '@/ui/navigation/appRouteTypes';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { resolveReaderStyleSettings, createTheme } from '@/ui/theme/tokens';
import { createTopicProofTransport, topicProofBody, topicProofTitle } from '../../helpers/topicCreationTransport';
import { TopicCreationFixture, type TopicProofObservation } from '../topicCreationFixture';
import { QueryTestWrapper } from '../QueryTestWrapper';
import { act, waitFor } from '../render';

const mockDatabases = new Map<string, DatabaseSync>();
const mockFiles = new Set<string>();
let mockDraftReadGate: { started: () => void; resume: Promise<void> } | undefined;
let mockCapturedNavigation: NavigationContainerRefWithCurrent<RootStackParamList> | undefined;

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => {
    const { DatabaseSync } = jest.requireActual<typeof import('node:sqlite')>('node:sqlite');
    const db = mockDatabases.get(name) || new DatabaseSync(':memory:');
    mockDatabases.set(name, db);
    return {
      execAsync: async (sql: string) => db.exec(sql),
      runAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).run(...mockSqliteParameters(args)),
      getFirstAsync: async (sql: string, ...args: unknown[]) => {
        const result = db.prepare(sql).get(...mockSqliteParameters(args)) ?? null;
        if (mockDraftReadGate && sql.includes('FROM topic_drafts')) {
          const gate = mockDraftReadGate;
          mockDraftReadGate = undefined;
          gate.started();
          await gate.resume;
        }
        return result;
      },
      getAllAsync: async (sql: string, ...args: unknown[]) => db.prepare(sql).all(...mockSqliteParameters(args))
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
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual<typeof import('@react-navigation/native')>('@react-navigation/native');
  return {
    ...actual,
    useNavigationContainerRef: function useObservedNavigation() {
      const ref = actual.useNavigationContainerRef<RootStackParamList>();
      mockCapturedNavigation = ref;
      return ref;
    }
  };
});

const sites = ['nodeseek', 'linuxdo', 'yaohuo'] as const;
const settings = createEmptyReaderData().settings;
const style = { settings: resolveReaderStyleSettings(settings), theme: createTheme(settings) };
const marker = (token: string) => `file:///synthetic-cache/topic-proof-${token}.seeded`;
beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockFiles.clear();
  mockDraftReadGate = undefined;
  mockCapturedNavigation = undefined;
});
afterAll(() => mockDatabases.forEach((db) => db.close()));

describe('topic proof seed ownership', () => {
  it.each([false, true])('keeps one actual seed job usable with Strict root=%s', async (strict) => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    mockDraftReadGate = { started: entered.resolve, resume: release.promise };
    const saved = jest.spyOn(DraftStore, 'saveTopicDraft');
    const observations: TopicProofObservation[] = [];
    const token = strict ? '00f15001' : '00f15000';
    const root = createRoot({ isStrictMode: strict });
    const transport = createTopicProofTransport('success');
    let setups = 0;
    function Harness() {
      useLayoutEffect(() => {
        setups++;
      }, []);
      return (
        <TopicCreationFixture
          token={token}
          source="nodeseek"
          transport={transport}
          kind="success"
          observe={(value) => observations.push(value)}
          onNotice={() => {}}
        />
      );
    }
    try {
      await act(() =>
        root.render(
          <ReaderStyleProvider value={style}>
            <QueryTestWrapper>
              <Harness />
            </QueryTestWrapper>
          </ReaderStyleProvider>
        )
      );
      expect(setups).toBe(strict ? 2 : 1);
      await entered.promise;
      await act(() => release.resolve());
      await waitFor(() => expect(mockFiles.has(marker(token))).toBe(true));
      await waitFor(() => expect(observations.some((value) => value.ready || value.error)).toBe(true));
      const ids = saved.mock.calls.filter(([draft]) => draft.source === 'nodeseek').map(([draft]) => draft.id);
      expect({ ids: new Set(ids).size, ready: observations.at(-1)?.ready, error: observations.at(-1)?.error }).toEqual({
        ids: 1,
        ready: true,
        error: undefined
      });
    } finally {
      release.resolve();
      await act(() => root.unmount());
      saved.mockRestore();
    }
  });

  it('keeps a replacement token separate while its predecessor seed is still running', async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    mockDraftReadGate = { started: entered.resolve, resume: release.promise };
    const transport = createTopicProofTransport('success');
    const observations: TopicProofObservation[] = [];
    const observe = (value: TopicProofObservation) => {
      observations.push(value);
    };
    const root = createRoot();
    const renderToken = (token: string) =>
      root.render(
        <ReaderStyleProvider value={style}>
          <QueryTestWrapper>
            <TopicCreationFixture
              token={token}
              source="nodeseek"
              transport={transport}
              kind="success"
              observe={observe}
              onNotice={() => {}}
            />
          </QueryTestWrapper>
        </ReaderStyleProvider>
      );
    try {
      await act(() => renderToken('00f15002'));
      await entered.promise;
      await act(() => renderToken('00f15003'));
      await act(() => release.resolve());
      await waitFor(() => expect(mockFiles.has(marker('00f15003'))).toBe(true));
      expect(mockFiles.has(marker('00f15002'))).toBe(true);
      await waitFor(() => expect(observations.at(-1)?.ready).toBe(true));
      for (const token of ['00f15002', '00f15003'])
        for (const site of sites)
          expect(await DraftStore.loadTopicDraft(site, `${site}:${parseInt(token, 16) + 1000}`)).toMatchObject({
            title: topicProofTitle(site),
            body: topicProofBody(site)
          });
    } finally {
      release.resolve();
      await act(() => root.unmount());
    }
  });
});

async function mountNavigationProbe(index: number, strict = false) {
  const token = `00f1510${index}`;
  const observations: TopicProofObservation[] = [];
  const observe = (value: TopicProofObservation) => {
    observations.push(value);
  };
  let runtime: RuntimeContext.TopicComposerRouteRuntimeValue | undefined;
  const actualProvider = RuntimeContext.TopicComposerRouteRuntimeProvider;
  const provider = jest.spyOn(RuntimeContext, 'TopicComposerRouteRuntimeProvider').mockImplementation((props) => {
    runtime = props.value;
    return actualProvider(props);
  });
  const transport = createTopicProofTransport('success');
  const actualFetch = transport.fetcher;
  let confirmed: Response | undefined;
  transport.fetcher = async (input, init) => {
    const response = await actualFetch(input, init);
    if (init?.method === 'POST') confirmed = response;
    return response;
  };
  const renderFixture = () => (
    <ReaderStyleProvider value={style}>
      <QueryTestWrapper>
        <TopicCreationFixture
          token={token}
          source="nodeseek"
          transport={transport}
          kind="inactive-receipt"
          observe={observe}
          onNotice={() => {}}
        />
      </QueryTestWrapper>
    </ReaderStyleProvider>
  );
  // A real completed seed isolates the navigation Strict replay from the independent seed defect.
  if (strict) {
    const prime = createRoot();
    try {
      await act(() => prime.render(renderFixture()));
      await waitFor(() => expect(observations.some((value) => value.ready)).toBe(true));
    } finally {
      await act(() => prime.unmount());
    }
    observations.length = 0;
  }
  const root = createRoot({ isStrictMode: strict });
  await act(() => root.render(renderFixture()));
  await waitFor(() => expect(observations.some((value) => value.ready)).toBe(true));
  if (!mockCapturedNavigation || !runtime) throw new Error('Expected actual ref and runtime');
  const navigation = mockCapturedNavigation;
  const currentRuntime = runtime;
  const subscriptions = new Set<() => void>();
  const add = navigation.addListener.bind(navigation);
  let inStateListener = false;
  const listen = jest.spyOn(navigation, 'addListener').mockImplementation((event, callback) => {
    const observed = new Proxy(callback, {
      apply(listener, receiver, args) {
        const previous = inStateListener;
        inStateListener = event === 'state';
        try {
          return Reflect.apply(listener, receiver, args);
        } finally {
          inStateListener = previous;
        }
      }
    });
    const unsubscribe = add(event, observed);
    const release = () => {
      subscriptions.delete(release);
      unsubscribe();
    };
    subscriptions.add(release);
    return release;
  });
  return {
    root,
    navigation,
    currentRuntime,
    subscriptions,
    transport,
    confirmed: () => confirmed,
    provider,
    listen,
    isStateCallback: () => inStateListener
  };
}

describe('confirmed topic proof navigation wait', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  });
  it.each([false, true])(
    'waits for actual commit and next turn before returning the same Response with Strict=%s',
    async (strict) => {
      const view = await mountNavigationProbe(strict ? 1 : 0, strict);
      let settled = false;
      let result: Response | undefined;
      try {
        await act(async () => {
          void view.currentRuntime
            .fetcher('https://www.nodeseek.com/api/content/new-discussion', {
              method: 'POST',
              body: JSON.stringify({ title: 'Local proof', content: 'Local only', category: 'tech' })
            })
            .then((value) => {
              settled = true;
              result = value;
            });
          for (let index = 0; index < 12; index++) await Promise.resolve();
        });
        expect(view.transport.writes).toHaveLength(1);
        expect(view.confirmed()?.status).toBe(200);
        expect(view.navigation.getCurrentRoute()?.name).toBe('Topic');
        expect(view.subscriptions.size).toBe(0);
        expect(settled).toBe(false);
        await act(() => jest.advanceTimersByTimeAsync(0));
        expect(settled).toBe(true);
        expect(result).toBe(view.confirmed());
      } finally {
        await act(() => view.root.unmount());
        for (const release of view.subscriptions) release();
        view.listen.mockRestore();
        view.provider.mockRestore();
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    }
  );

  it.each([
    { stage: 'state', cancel: 'abort' },
    { stage: 'state', cancel: 'unmount' },
    { stage: 'next-turn', cancel: 'abort' },
    { stage: 'next-turn', cancel: 'unmount' }
  ] as const)('retires $stage resources on $cancel and returns the confirmed Response', async ({ stage, cancel }) => {
    const index =
      2 + ['state-abort', 'state-unmount', 'next-turn-abort', 'next-turn-unmount'].indexOf(`${stage}-${cancel}`);
    const view = await mountNavigationProbe(index);
    const controller = new AbortController();
    let settled = false,
      unmounted = false;
    let result: Response | undefined, failure: unknown;
    const navigate =
      stage === 'state' ? jest.spyOn(view.navigation, 'navigate').mockImplementation(() => {}) : undefined;
    const timers: unknown[] = [];
    const actualSetTimeout = global.setTimeout;
    const schedule = jest.spyOn(global, 'setTimeout').mockImplementation((...args) => {
      const handle = Reflect.apply(actualSetTimeout, global, args);
      if (view.isStateCallback() && args[1] === 0) timers.push(handle);
      return handle;
    });
    const clear = jest.spyOn(global, 'clearTimeout');
    try {
      await act(async () => {
        void view.currentRuntime
          .fetcher('https://www.nodeseek.com/api/content/new-discussion', {
            method: 'POST',
            body: JSON.stringify({ title: 'Local proof', content: 'Local only', category: 'tech' }),
            signal: controller.signal
          })
          .then(
            (value) => {
              settled = true;
              result = value;
            },
            (error: unknown) => {
              settled = true;
              failure = error;
            }
          );
        for (let index = 0; index < 12; index++) await Promise.resolve();
      });
      expect(view.transport.writes).toHaveLength(1);
      expect(view.confirmed()?.status).toBe(200);
      expect(settled).toBe(false);
      if (stage === 'next-turn') {
        expect(view.navigation.getCurrentRoute()?.name).toBe('Topic');
        expect(timers).toHaveLength(1);
      } else {
        expect(view.subscriptions.size).toBe(1);
        expect(timers).toHaveLength(0);
      }
      if (cancel === 'abort') await act(() => controller.abort());
      else {
        await act(() => view.root.unmount());
        unmounted = true;
      }
      await act(async () => {
        for (let index = 0; index < 12; index++) await Promise.resolve();
      });
      const uncleared = timers.filter((handle) => !clear.mock.calls.some(([value]) => value === handle)).length;
      expect({
        settled,
        sameResponse: result === view.confirmed(),
        subscriptions: view.subscriptions.size,
        uncleared,
        error: failure
      }).toEqual({ settled: true, sameResponse: true, subscriptions: 0, uncleared: 0, error: undefined });
    } finally {
      if (!unmounted) await act(() => view.root.unmount());
      for (const release of view.subscriptions) release();
      navigate?.mockRestore();
      view.listen.mockRestore();
      view.provider.mockRestore();
      schedule.mockRestore();
      clear.mockRestore();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});
