import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(value: T) => ({ current: value }),
  useState: <T,>(initial: T | (() => T)) => {
    let state = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [state, (next: T | ((current: T) => T)) => {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next;
    }];
  }
}));

vi.mock('@react-native-cookies/cookies', () => ({
  default: {
    flush: vi.fn(async () => undefined),
    get: vi.fn(async () => ({})),
    clearByName: vi.fn(async () => true)
  }
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined)
}));

vi.mock('react-native', () => ({
  NativeModules: {
    LinuxDoCookieModule: {}
  }
}));

import { createEmptyReaderData } from '../readerData';
import { setDiagnosticWriter, type DiagnosticEvent, type DiagnosticTrace } from '../diagnostics';
import type { SourceGateway } from '../sources/sourceGateway';
import { mergedFeedResponseAfterSplitFetch, shouldWaitForReaderDataBeforeFeed, useFeedController } from './useFeedController';
import type { FeedResponse, Topic } from '../types';

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('feed controller helpers', () => {
  const response: FeedResponse = {
    items: [],
    errors: {},
    hasMore: true,
    nextPage: 3
  };

  it('does not apply partial all-feed load-more results when any source failed', () => {
    expect(mergedFeedResponseAfterSplitFetch([response], { yaohuo: { kind: 'ordinary', message: 'HTTP 500' } }, true)).toBeNull();
  });

  it('keeps partial all-feed refresh results when a source failed', () => {
    expect(mergedFeedResponseAfterSplitFetch([response], { yaohuo: { kind: 'ordinary', message: 'HTTP 500' } }, false)).toEqual(response);
  });

  it('lets the default all feed load before reader data finishes loading', () => {
    expect(shouldWaitForReaderDataBeforeFeed('all', 'all')).toBe(false);
    expect(shouldWaitForReaderDataBeforeFeed('all', 'favorite')).toBe(true);
  });

  it('traces one feed read through gateway context, apply counts, and one terminal event', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const topic: Topic = {
      source: 'v2ex',
      id: 'private-topic-id',
      title: 'private title',
      author: 'private author',
      url: 'https://www.v2ex.com/t/private?token=secret',
      createdAt: '2026-07-10T00:00:00.000Z',
      replyCount: 0
    };
    let gatewayTrace: DiagnosticTrace | undefined;
    const sourceGateway = {
      getFeed: vi.fn(async (_options, context) => {
        gatewayTrace = context?.trace;
        return { items: [topic], errors: {}, hasMore: true, nextPage: 2 };
      })
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({ source: 'v2ex', reset: true, nocache: true });

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(gatewayTrace?.traceId).toBe(events[0]?.traceId);
    expect(events.map((event) => event.phase)).toEqual(['intent', 'guard', 'apply', 'finish']);
    expect(events.find((event) => event.phase === 'apply')).toMatchObject({ beforeCount: 0, afterCount: 1 });
    expect(events.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ area: 'feed', operation: 'load', outcome: 'success' })
    ]);
    expect(lines.join('')).not.toMatch(/private-topic-id|private title|private author|v2ex\.com|token=secret/);
  });

  it('silently records a current feed read replaced inside the WebView queue as stale', async () => {
    const lines: string[] = [];
    const notify = vi.fn();
    setDiagnosticWriter((line) => { lines.push(line); });
    const sourceGateway = {
      getFeed: vi.fn(async () => {
        throw new Error('请求已被新请求替代');
      })
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify,
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({ source: 'nodeseek', reset: true });

    expect(notify).not.toHaveBeenCalled();
    expect(lines.map((line) => JSON.parse(line)).filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ area: 'feed', outcome: 'stale', reason: 'superseded' })
    ]);
  });

  it('records a replaced feed that resolves after ignoring abort as stale instead of canceled', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const firstResponse = Promise.withResolvers<FeedResponse>();
    const sourceGateway = {
      getFeed: vi.fn()
        .mockImplementationOnce(() => firstResponse.promise)
        .mockResolvedValueOnce({ items: [], errors: {}, hasMore: false, nextPage: null })
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    const replaced = controller.loadFeed({ source: 'v2ex', reset: true });
    await vi.waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledTimes(1));
    await controller.loadFeed({ source: 'v2ex', reset: true });
    firstResponse.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
    await replaced;

    const terminals = lines.map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.phase === 'finish');
    expect(terminals).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'stale', reason: 'superseded' }),
      expect.objectContaining({ outcome: 'success' })
    ]));
    expect(terminals).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'canceled', reason: 'canceled' })
    ]));
  });

  it('records an explicitly aborted feed that resolves late as canceled', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const pending = Promise.withResolvers<FeedResponse>();
    const sourceGateway = {
      getFeed: vi.fn(() => pending.promise)
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    const load = controller.loadFeed({ source: 'v2ex', reset: true });
    await vi.waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledTimes(1));
    controller.abortFeedRequests();
    pending.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
    await load;

    expect(lines.map((line) => JSON.parse(line)).filter(({ phase }) => phase === 'finish')).toEqual([
      expect.objectContaining({ outcome: 'canceled', reason: 'canceled' })
    ]);
  });

  it('records a blocked pagination guard while another feed read is active', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const pending = Promise.withResolvers<FeedResponse>();
    const sourceGateway = {
      getFeed: vi.fn(() => pending.promise)
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    const first = controller.loadFeed({ source: 'v2ex', reset: true });
    await vi.waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledTimes(1));
    await controller.loadFeed({ source: 'v2ex', page: 2 });
    pending.resolve({ items: [], errors: {}, hasMore: false, nextPage: null });
    await first;

    const terminalEvents = lines
      .map((line) => JSON.parse(line) as DiagnosticEvent)
      .filter((event) => event.phase === 'finish');
    expect(terminalEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'blocked', reason: 'busy' }),
      expect.objectContaining({ outcome: 'success' })
    ]));
    expect(new Set(terminalEvents.map((event) => event.traceId)).size).toBe(2);
  });

  it('starts the aggregated base feed before the managed Yaohuo read settles', async () => {
    const yaohuoRead = Promise.withResolvers<null>();
    const sourceGateway = {
      getFeed: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      getFeedIfCredentialed: vi.fn(() => yaohuoRead.promise)
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    const load = controller.loadFeed({ source: 'all', reset: true });
    await vi.waitFor(() => expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'all' }),
      expect.any(Object)
    ));
    yaohuoRead.resolve(null);
    await load;

    expect(sourceGateway.getFeed).toHaveBeenCalledTimes(1);
    expect(sourceGateway.getFeedIfCredentialed).toHaveBeenCalledTimes(1);
  });

  it('starts an aggregated base load-more page before the managed Yaohuo read settles', async () => {
    const yaohuoRead = Promise.withResolvers<null>();
    const getFeed = vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null }));
    const sourceGateway = {
      getFeed,
      getFeedIfCredentialed: vi.fn(() => yaohuoRead.promise)
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    const load = controller.loadFeed({ source: 'all', page: 2 });
    await Promise.resolve();
    await Promise.resolve();
    const baseReadsBeforeCredentialSettled = getFeed.mock.calls.length;
    yaohuoRead.resolve(null);
    await load;

    expect(baseReadsBeforeCredentialSettled).toBe(1);
  });

  it('keeps the Yaohuo credential lookup inside its managed gateway read', async () => {
    const credential = Promise.withResolvers<boolean>();
    const hasYaohuoCredential = vi.fn(() => credential.promise);
    const sourceGateway = {
      hasYaohuoCredential,
      getFeed: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      getFeedIfCredentialed: vi.fn(async () => null)
    } as unknown as SourceGateway & { getFeedIfCredentialed: ReturnType<typeof vi.fn> };
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    const load = controller.loadFeed({ source: 'all', reset: true });
    await vi.waitFor(() => expect(sourceGateway.getFeedIfCredentialed).toHaveBeenCalledTimes(1));
    await load;

    expect(hasYaohuoCredential).not.toHaveBeenCalled();
  });

  it('does not apply a partial aggregated load-more page when Yaohuo has no credential', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const sourceGateway = {
      getFeed: vi.fn(async () => ({
        items: [{
          source: 'v2ex',
          id: 'partial-page-topic',
          title: 'partial page topic',
          author: 'author',
          url: 'https://www.v2ex.com/t/1',
          createdAt: '2026-07-12T00:00:00.000Z',
          replyCount: 0
        }],
        errors: { nodeseek: { kind: 'ordinary', message: 'HTTP 500' } },
        hasMore: true,
        nextPage: 3
      })),
      getFeedIfCredentialed: vi.fn(async () => null)
    } as unknown as SourceGateway;
    const notify = vi.fn();
    const controller = useFeedController({
      notify,
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({ source: 'all', page: 2 });

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply' })
    ]));
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });

  it('passes the aggregate feed trace into the managed Yaohuo read', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const sourceGateway = {
      getFeed: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      getFeedIfCredentialed: vi.fn(async () => null)
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({ source: 'all', reset: true });

    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(sourceGateway.getFeedIfCredentialed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'yaohuo' }),
      expect.objectContaining({ trace: expect.objectContaining({ traceId: events[0]?.traceId }) })
    );
  });

  it('records temporary Yaohuo credential suppression separately from a missing cookie', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const sourceGateway = {
      getFeed: vi.fn(async () => ({ items: [], errors: {}, hasMore: false, nextPage: null })),
      getFeedIfCredentialed: vi.fn(async () => null)
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway,
      yaohuoCredentialSuppressed: true
    });

    await controller.loadFeed({ source: 'all', reset: true });

    expect(sourceGateway.getFeedIfCredentialed).not.toHaveBeenCalled();
    expect(lines.map((line) => JSON.parse(line))).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'credential', source: 'yaohuo', state: 'disabled', hasCredential: false })
    ]));
  });

  it('keeps the aggregated base feed when the yaohuo credential check fails', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const topic: Topic = {
      source: 'v2ex',
      id: 'safe-topic',
      title: 'safe title',
      author: 'safe author',
      url: 'https://www.v2ex.com/t/1',
      createdAt: '2026-07-12T00:00:00.000Z',
      replyCount: 0
    };
    const sourceGateway = {
      getFeed: vi.fn(async () => ({ items: [topic], errors: {}, hasMore: false, nextPage: null })),
      getFeedIfCredentialed: vi.fn(async () => {
        throw new Error('private yaohuo store failure');
      })
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification: vi.fn(),
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({ source: 'all', reset: true });

    expect(sourceGateway.getFeed).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'all' }),
      expect.any(Object)
    );
    const events = lines.map((line) => JSON.parse(line) as DiagnosticEvent);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'apply', source: 'all', itemCount: 1 }),
      expect.objectContaining({ phase: 'finish', outcome: 'partial', partialErrorCount: 1 })
    ]));
    expect(lines.join('')).not.toMatch(/private|safe-topic|safe title|safe author|v2ex\.com/);
  });
});
