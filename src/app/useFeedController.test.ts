import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: () => undefined,
  useLayoutEffect: (effect: () => void) => effect(),
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
import { annotateSourceDiagnosticSummary } from '../sourceAdapterDiagnostics';
import { setDiagnosticWriter, type DiagnosticEvent, type DiagnosticTrace } from '../diagnostics';
import type { SourceGateway } from '../sources/sourceGateway';
import { shouldWaitForReaderDataBeforeFeed, useFeedController } from './useFeedController';
import type { FeedResponse, Topic } from '../types';

afterEach(() => {
  setDiagnosticWriter(null);
  vi.clearAllMocks();
});

describe('feed controller helpers', () => {
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
      hasYaohuoCredential: vi.fn(async () => false),
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

  it('records a blocked pagination guard while another feed read is active', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const pending = Promise.withResolvers<FeedResponse>();
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
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

  it('gives linux.do verification an exact read recovery that reports the resumed outcome', async () => {
    const showLinuxDoVerification = vi.fn();
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
      getFeed: vi.fn()
        .mockResolvedValueOnce({
          items: [],
          errors: {
            linuxdo: {
              kind: 'verification-required',
              message: 'linux.do 需要验证',
              verificationRequired: true
            }
          },
          hasMore: false,
          nextPage: null
        })
        .mockResolvedValueOnce({ items: [], errors: {}, hasMore: false, nextPage: null })
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({ source: 'linuxdo', reset: true, nocache: true });

    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    expect(recovery).toMatchObject({ key: expect.stringContaining('feed:linuxdo') });
    expect(recovery.isCurrent()).toBe(true);
    await expect(recovery.resume()).resolves.toBe('completed');
    expect(sourceGateway.getFeed).toHaveBeenCalledTimes(2);
  });

  it('REG-LINUXDO-002 keeps the feed recovery current when the resumed read still needs verification', async () => {
    const verificationFailure = {
      items: [],
      errors: {
        linuxdo: {
          kind: 'verification-required' as const,
          message: 'linux.do 需要验证',
          verificationRequired: true
        }
      },
      hasMore: false,
      nextPage: null
    };
    const showLinuxDoVerification = vi.fn();
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
      getFeed: vi.fn()
        .mockResolvedValueOnce(verificationFailure)
        .mockResolvedValueOnce(verificationFailure)
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await expect(controller.loadFeed({ source: 'linuxdo', reset: true, nocache: true })).resolves.toBe('verification-required');
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];

    await expect(recovery.resume()).resolves.toBe('verification-required');
    expect(recovery.isCurrent()).toBe(true);
    expect(showLinuxDoVerification).toHaveBeenCalledTimes(1);
  });

  it('REG-LINUXDO-003 reports an ordinary resumed feed failure to the verification owner', async () => {
    const showLinuxDoVerification = vi.fn();
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
      getFeed: vi.fn()
        .mockResolvedValueOnce({
          items: [],
          errors: {
            linuxdo: {
              kind: 'verification-required',
              message: 'linux.do 需要验证',
              verificationRequired: true
            }
          },
          hasMore: false,
          nextPage: null
        })
        .mockRejectedValueOnce(new Error('恢复读取网络失败'))
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({ source: 'linuxdo', reset: true, nocache: true });

    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    await expect(recovery.resume()).resolves.toBe('failed');
  });

  it('REG-SOURCE-002 rejects an HTTP-success feed result whose candidates all failed to parse', async () => {
    const notify = vi.fn();
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
      getFeed: vi.fn(async () => annotateSourceDiagnosticSummary({
        items: [],
        errors: {},
        hasMore: true,
        nextPage: 2
      }, {
        parserVariant: 'rendered-list',
        candidateCount: 2,
        validCount: 0,
        droppedCount: 2,
        isExpectedEmpty: false
      }))
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

    await expect(controller.loadFeed({ source: 'nodeseek', reset: true })).resolves.toBe('failed');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('无法解析'));
  });

  it('REG-SOURCE-002 rejects an aggregate first page when every source candidate failed to parse', async () => {
    const notify = vi.fn();
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
      getFeed: vi.fn(async () => annotateSourceDiagnosticSummary({
        items: [],
        errors: {},
        hasMore: true,
        nextPage: 2
      }, {
        parserVariant: 'aggregate-feed',
        candidateCount: 5,
        validCount: 0,
        droppedCount: 5,
        isExpectedEmpty: false
      }))
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

    await expect(controller.loadFeed({ source: 'all', reset: true, nocache: true })).resolves.toBe('failed');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('无法解析'));
  });

  it('REG-SOURCE-002 does not apply a failed single-source feed page', async () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => { lines.push(line); });
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
      getFeed: vi.fn(async () => ({
        items: [],
        errors: {
          nodeseek: { kind: 'ordinary' as const, message: '第二页请求失败' }
        },
        hasMore: false,
        nextPage: null
      }))
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

    await expect(controller.loadFeed({ source: 'nodeseek', page: 2 })).resolves.toBe('failed');

    expect(lines.map((line) => JSON.parse(line).phase)).not.toContain('apply');
  });

  it('REG-LINUXDO-002 retries the exact failed linux.do feed page and cursor', async () => {
    const showLinuxDoVerification = vi.fn();
    const sourceGateway = {
      hasYaohuoCredential: vi.fn(async () => false),
      getFeed: vi.fn()
        .mockResolvedValueOnce({
          items: [],
          errors: {
            linuxdo: {
              kind: 'verification-required',
              message: 'linux.do 需要验证',
              verificationRequired: true
            }
          },
          hasMore: false,
          nextPage: null
        })
        .mockResolvedValueOnce({ items: [], errors: {}, hasMore: false, nextPage: null })
    } as unknown as SourceGateway;
    const controller = useFeedController({
      notify: vi.fn(),
      readerData: createEmptyReaderData(),
      readerDataLoaded: true,
      showLinuxDoVerification,
      showNodeSeekVerification: vi.fn(),
      showYaohuoLogin: vi.fn(),
      sourceGateway
    });

    await controller.loadFeed({
      source: 'linuxdo',
      page: 3,
      cursor: 'failed-cursor',
      category: 'dev',
      feedFilter: 'hot'
    });
    const recovery = showLinuxDoVerification.mock.calls[0]?.[1];
    await expect(recovery.resume()).resolves.toBe('completed');

    expect(sourceGateway.getFeed).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: 'linuxdo',
      page: 3,
      cursor: 'failed-cursor',
      category: 'dev',
      feedFilter: 'hot'
    }), expect.any(Object));
    expect(sourceGateway.getFeed).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: 'linuxdo',
      page: 3,
      cursor: 'failed-cursor',
      category: 'dev',
      feedFilter: 'hot',
      nocache: true
    }), expect.any(Object));
  });
});
