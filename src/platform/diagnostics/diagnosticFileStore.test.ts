import { beforeEach, describe, expect, it, vi } from 'vitest';
import { File, Paths } from 'expo-file-system';

const boundary = vi.hoisted(() => ({
  failWrites: false,
  files: new Map<string, Uint8Array>(),
  nativeEvents: [] as Record<string, unknown>[],
  nativeJournal: undefined as
    | undefined
    | {
        buildId: string;
        processSessionId: string;
        appendBatch: (lines: string) => Promise<void>;
        snapshot: () => Promise<unknown>;
        persistCrashSync: (lines: string) => boolean;
      },
  openCount: 0,
  writeCount: 0,
  shared: [] as { content: string; uri: string }[],
  sharingAvailable: true,
  sharingModuleLoads: 0
}));

vi.mock('react-native', () => ({
  NativeModules: {
    get DiagnosticsModule() {
      return boundary.nativeJournal;
    },
    NetworkProxyModule: {
      readNetworkDiagnosticEvents: vi.fn(async () => boundary.nativeEvents)
    }
  }
}));

vi.mock('expo-file-system', () => {
  const cache = { uri: 'file:///cache/' };
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  class File {
    uri: string;

    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts
        .map((part) => (typeof part === 'string' ? part : part.uri))
        .join('')
        .replace(/([^:])\/{2,}/g, '$1/');
    }

    get exists() {
      return boundary.files.has(this.uri);
    }

    get size() {
      return boundary.files.get(this.uri)?.byteLength || 0;
    }

    create(options?: { overwrite?: boolean }) {
      if (this.exists && !options?.overwrite) {
        throw new Error('already exists');
      }
      boundary.files.set(this.uri, new Uint8Array());
    }

    delete() {
      if (!boundary.files.delete(this.uri)) {
        throw new Error('missing file');
      }
    }

    async move(_destination: File) {
      // SDK 57 exposes move as an asynchronous API; callers must await it.
    }

    moveSync(destination: File) {
      const bytes = boundary.files.get(this.uri);
      if (!bytes) {
        throw new Error('missing file');
      }
      boundary.files.set(destination.uri, bytes);
      boundary.files.delete(this.uri);
      this.uri = destination.uri;
    }

    async text() {
      return decoder.decode(boundary.files.get(this.uri) || new Uint8Array());
    }

    write(content: string | Uint8Array) {
      if (boundary.failWrites) {
        throw new Error('disk full');
      }
      boundary.files.set(this.uri, typeof content === 'string' ? encoder.encode(content) : content);
    }

    open() {
      boundary.openCount += 1;
      const file = this;
      let offset = 0;
      return {
        close: vi.fn(),
        get offset() {
          return offset;
        },
        set offset(value: number | null) {
          offset = value || 0;
        },
        get size() {
          return file.size;
        },
        writeBytes(bytes: Uint8Array) {
          boundary.writeCount += 1;
          if (boundary.failWrites) {
            throw new Error('disk full');
          }
          const current = boundary.files.get(file.uri) || new Uint8Array();
          const writeOffset = Math.min(offset, current.byteLength);
          const next = new Uint8Array(Math.max(current.byteLength, writeOffset + bytes.byteLength));
          next.set(current);
          next.set(bytes, writeOffset);
          boundary.files.set(file.uri, next);
          offset = writeOffset + bytes.byteLength;
        }
      };
    }
  }

  return { File, Paths: { cache } };
});

vi.mock('expo-sharing', () => {
  boundary.sharingModuleLoads += 1;
  return {
    isAvailableAsync: vi.fn(async () => boundary.sharingAvailable),
    shareAsync: vi.fn(async (uri: string) => {
      boundary.shared.push({
        content: new TextDecoder().decode(boundary.files.get(uri) || new Uint8Array()),
        uri
      });
    })
  };
});

import {
  appendDiagnosticLogLine,
  exportDiagnosticLog,
  initializeDiagnosticFileLogging,
  type DiagnosticExportMetadata
} from './diagnosticFileStore';
import { beginDiagnosticTrace, finishDiagnosticTrace, recordDiagnosticError, setDiagnosticWriter } from './diagnostics';
import { diagnosticRef, type DiagnosticFields } from './diagnosticPolicy';
import { readNativeReadNetworkDiagnosticLines } from './nativeReadNetworkDiagnostics';
const sharingLoadsAtImport = boundary.sharingModuleLoads;

const metadata: DiagnosticExportMetadata = {
  androidApiLevel: 35,
  appVersion: '1.3.54',
  currentScreen: 'topic',
  deviceModel: 'Pixel 8',
  expoVersion: '54.0.33',
  fontScale: 1,
  linuxDoSession: 'logged-in',
  nodeSeekSession: 'verified',
  proxyEnabled: false,
  reactNativeVersion: '0.81.5',
  screenHeight: 2400,
  screenWidth: 1080,
  theme: 'dark',
  versionCode: 58,
  yaohuoSession: 'anonymous'
};

beforeEach(() => {
  setDiagnosticWriter(null);
  boundary.failWrites = false;
  boundary.files.clear();
  boundary.nativeEvents.length = 0;
  boundary.nativeJournal = undefined;
  boundary.openCount = 0;
  boundary.writeCount = 0;
  boundary.shared.length = 0;
  boundary.sharingAvailable = true;
});

describe('diagnostic file store', () => {
  it('does not load native sharing while installing startup diagnostics', () => {
    expect(sharingLoadsAtImport).toBe(0);
  });
  it('distinguishes missing and failed legacy collection from an available empty window', async () => {
    expect(await readNativeReadNetworkDiagnosticLines({})).toBeUndefined();
    expect(await readNativeReadNetworkDiagnosticLines({ readNetworkDiagnosticEvents: async () => [] })).toBe('');
    await expect(
      readNativeReadNetworkDiagnosticLines({
        readNetworkDiagnosticEvents: async () => {
          throw new Error('failed');
        }
      })
    ).rejects.toThrow();
    await expect(
      readNativeReadNetworkDiagnosticLines({ readNetworkDiagnosticEvents: async () => ({}) })
    ).rejects.toThrow();
  });

  it('exports every persisted native request beyond the former 512-event memory window', async () => {
    const nativeLines = Array.from({ length: 600 }, (_, index) =>
      JSON.stringify({
        diagnosticKind: 'network',
        timeMs: 1_786_199_367_000 + index,
        operation: 'request',
        phase: 'call-start',
        source: 'linuxdo',
        callId: (index + 1).toString(16),
        requestId: `request-${index + 1}`,
        buildId: 'a'.repeat(32),
        processSessionId: `process-${'b'.repeat(32)}`
      })
    ).join('\n');
    boundary.nativeJournal = {
      buildId: 'a'.repeat(32),
      processSessionId: `process-${'b'.repeat(32)}`,
      appendBatch: async () => undefined,
      persistCrashSync: () => true,
      snapshot: async () => ({ nativeLines, health: { available: true } })
    };
    await exportDiagnosticLog(metadata);
    const events = boundary.shared[0].content
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.filter((event) => event.type === 'native-read-network')).toHaveLength(600);
    expect(events[1]).toMatchObject({ eventCount: 600, nativeRejectedEventCount: 0 });
    expect(events.at(-1)).toMatchObject({ requestId: 'request-600', buildId: 'a'.repeat(32) });
  });

  it('bounds stalled native writes and still exports other available evidence', async () => {
    vi.useFakeTimers();
    const releases: (() => void)[] = [];
    const appendBatch = vi.fn((_lines: string) => new Promise<void>((resolve) => releases.push(resolve)));
    try {
      boundary.nativeJournal = {
        buildId: 'a'.repeat(32),
        processSessionId: `process-${'b'.repeat(32)}`,
        appendBatch,
        persistCrashSync: () => false,
        snapshot: async () => ({ jsLines: '{"sequence":91827}\n', health: { available: true } })
      };
      for (let burst = 0; burst < 3; burst += 1) {
        for (let index = 0; index < 100; index += 1)
          appendDiagnosticLogLine(JSON.stringify({ padding: 'x'.repeat(4000) }));
        const exported = exportDiagnosticLog(metadata);
        await vi.advanceTimersByTimeAsync(5_001);
        await exported;
        expect(appendBatch).toHaveBeenCalledTimes(1);
      }
      expect(boundary.shared.map((entry) => JSON.parse(entry.content.split('\n')[1]).writerStatus)).toEqual([
        'timeout',
        'timeout',
        'timeout'
      ]);
      const coverage = JSON.parse(boundary.shared[0].content.split('\n')[1]);
      expect(coverage.droppedCount).toBeGreaterThan(0);
      expect(coverage.writeFailureCount).toBeGreaterThan(0);
      expect(appendBatch).toHaveBeenCalledTimes(1);
      expect(new TextEncoder().encode(appendBatch.mock.calls[0][0]).length).toBeLessThanOrEqual(128 * 1024);
      expect(boundary.shared[0].content).toContain('"sequence":91827');
      appendDiagnosticLogLine('{"sequence":91828}');
      await vi.advanceTimersByTimeAsync(0);
      expect(appendBatch).toHaveBeenCalledTimes(1);
      appendBatch.mockImplementation(async () => undefined);
      releases.splice(0).forEach((release) => release());
      await vi.advanceTimersByTimeAsync(0);
      expect(appendBatch).toHaveBeenCalledTimes(2);
      expect(appendBatch.mock.calls[1][0]).toContain('"sequence":91828');
      await exportDiagnosticLog(metadata);
      expect(JSON.parse(boundary.shared.at(-1)!.content.split('\n')[1]).writerStatus).toBe('settled');
    } finally {
      appendBatch.mockImplementation(async () => undefined);
      releases.splice(0).forEach((release) => release());
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
  });

  it('waits for native persistence and exports previous-process events with their original build', async () => {
    let persisted = '';
    let crash = '';
    const oldEvent = JSON.stringify({
      schemaVersion: 1,
      time: '2026-09-07T00:00:00.000Z',
      appSessionId: 'old-session',
      traceId: 'trace-1',
      operation: 'js-error',
      buildId: 'a'.repeat(32)
    });
    boundary.nativeJournal = {
      buildId: 'b'.repeat(32),
      processSessionId: `process-${'c'.repeat(32)}`,
      appendBatch: async (lines) => {
        await Promise.resolve();
        persisted += lines;
      },
      persistCrashSync: (lines) => {
        crash = lines;
        return true;
      },
      snapshot: async () => ({
        jsLines: `${oldEvent}\n${persisted}`,
        nativeLines: '',
        crashLines: crash,
        health: { available: true, js: { rotationCount: 3 } }
      })
    };
    setDiagnosticWriter(appendDiagnosticLogLine);
    beginDiagnosticTrace('topic', 'open');
    recordDiagnosticError('app', 'js-error', new Error('PRIVATE_SECRET'), { isFatal: true });
    expect(crash).toContain('"isFatal":true');
    expect(crash).toContain('"operation":"open"');
    await exportDiagnosticLog(metadata);
    const lines = boundary.shared[0].content
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines[1]).toMatchObject({ journalStatus: 'available', jsRotationCount: 3 });
    expect(lines[1].sources.js).toMatchObject({ status: 'available', firstEventAt: '2026-09-07T00:00:00.000Z' });
    expect(lines.filter((line) => line.operation === 'js-error')).toHaveLength(2);
    expect(lines.find((line) => line.appSessionId === 'old-session')).toHaveProperty('buildId', 'a'.repeat(32));
    expect(lines.at(-1)).toMatchObject({ buildId: 'b'.repeat(32), processSessionId: `process-${'c'.repeat(32)}` });
    expect(boundary.openCount).toBe(0);
    expect(boundary.shared[0].content).not.toContain('PRIVATE_SECRET');
  });

  it('exports persisted cookie decisions and separates an old protocol check from the local identity', async () => {
    const results = [
      'source_denied',
      'redirect_denied',
      'barrier_blocked',
      'epoch_changed',
      'canceled',
      'callback_timeout',
      'pending_write',
      'settled',
      'applied',
      'flush_failed',
      'persisted'
    ];
    const nativeLines = results
      .map((cookieResult, index) =>
        JSON.stringify({
          diagnosticKind: 'network',
          timeMs: 1_786_199_367_200 + index,
          phase: 'finish',
          operation: ['flush_failed', 'persisted'].includes(cookieResult) ? 'cookie-persist' : 'cookie-response',
          source: 'linuxdo',
          cookieResult,
          cookieKind: 'login',
          cookieAction: 'set',
          cookieLifetime: 'persistent',
          cookieAccepted: index % 2 ? 'not_submitted' : 'rejected',
          cookieEpoch: 3,
          requestCookieEpoch: 2,
          cookieWriteSequence: 7,
          hasLoginCookie: true,
          loginCookieChanged: false,
          surfaceGeneration: 9,
          processSessionId: `process-${'a'.repeat(32)}`,
          appSessionId: 'session-old-1',
          traceId: 'trace-42',
          callId: 'abc',
          cookieName: 'PRIVATE_COOKIE',
          cookieHash: 'PRIVATE_COOKIE',
          headers: 'PRIVATE_COOKIE'
        })
      )
      .join('\n');
    boundary.nativeJournal = {
      buildId: 'b'.repeat(32),
      processSessionId: `process-${'b'.repeat(32)}`,
      appendBatch: async () => undefined,
      persistCrashSync: () => true,
      snapshot: async () => ({
        nativeLines,
        crashLines: '',
        health: { available: true },
        jsLines: JSON.stringify({
          source: 'linuxdo',
          operation: 'account-reconcile',
          phase: 'finish',
          state: 'confirmed',
          time: new Date(1_786_199_367_190).toISOString(),
          processSessionId: `process-${'a'.repeat(32)}`
        })
      })
    };
    await exportDiagnosticLog({ ...metadata, linuxDoSession: 'logged-in' });
    const exported = boundary.shared[0].content;
    const events = exported
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.filter((event) => event.cookieResult).map((event) => event.cookieResult)).toEqual(results);
    expect(events.find((event) => event.type === 'diagnostic-account-summary')).toMatchObject({
      localSnapshot: 'logged-in',
      lastCheckResult: 'authenticated',
      checkedInCurrentProcess: false
    });
    expect(events.find((event) => event.cookieResult === 'flush_failed')).toMatchObject({
      surfaceGeneration: 9,
      cookieWriteSequence: 7,
      traceId: 'trace-42',
      callId: 'abc',
      hasLoginCookie: true
    });
    expect(exported).toContain('"cookieAccepted":"not_submitted"');
    expect(exported).not.toContain('PRIVATE_COOKIE');
  });

  it('exports available logs when native collection fails and reports damaged legacy lines', async () => {
    boundary.nativeJournal = {
      buildId: 'a'.repeat(32),
      processSessionId: `process-${'b'.repeat(32)}`,
      appendBatch: async () => {
        throw new Error('PRIVATE_DISK_ERROR');
      },
      persistCrashSync: () => false,
      snapshot: async () => {
        throw new Error('PRIVATE_NATIVE_ERROR');
      }
    };
    boundary.files.set(
      new File(Paths.cache, 'forum-reader-diagnostic-previous.jsonl').uri,
      new TextEncoder().encode('{"sequence":91827}\nPRIVATE_BROKEN_LINE\n')
    );
    appendDiagnosticLogLine('{"sequence":2}');
    await exportDiagnosticLog(metadata);
    const lines = boundary.shared[0].content
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines[1]).toMatchObject({ journalStatus: 'failed', damagedLineCount: 1 });
    expect(lines[1].sources.legacyPrevious).toMatchObject({ status: 'partial', damagedLineCount: 1 });
    expect(lines[1].writeFailureCount).toBeGreaterThan(0);
    expect(lines).toContainEqual({ sequence: 91827 });
    expect(boundary.shared[0].content).not.toContain('PRIVATE_');
  });

  it('defers business-path file IO and batches consecutive events onto one handle', async () => {
    for (let sequence = 0; sequence < 100; sequence += 1) {
      appendDiagnosticLogLine(JSON.stringify({ sequence }));
    }

    expect(boundary.openCount).toBe(0);

    await exportDiagnosticLog(metadata);

    expect(boundary.openCount).toBe(1);
    expect(boundary.writeCount).toBe(1);
    expect(boundary.shared[0].content).toContain('"sequence":99');
  });

  it('exports a safe metadata header followed by logs and deletes the temporary file', async () => {
    appendDiagnosticLogLine('{"sequence":1}');
    appendDiagnosticLogLine('{"sequence":2}');

    await exportDiagnosticLog({
      ...metadata,
      currentScreen: '../../secret?token=bad' as DiagnosticExportMetadata['currentScreen'],
      deviceModel: 'Pixel 8 /secret/path?token=bad'
    });

    expect(boundary.shared).toHaveLength(1);
    const lines = boundary.shared[0].content.trim().split('\n');
    expect(JSON.parse(lines[0])).toEqual(
      expect.objectContaining({
        androidApiLevel: 35,
        appVersion: '1.3.54',
        currentScreen: 'unknown',
        deviceModel: 'unknown',
        schemaVersion: 1,
        type: 'diagnostic-metadata'
      })
    );
    expect(JSON.parse(lines[1])).toMatchObject({ type: 'diagnostic-coverage', journalStatus: 'unavailable' });
    expect(JSON.parse(lines[2])).toMatchObject({ type: 'diagnostic-account-summary', lastCheckResult: 'unknown' });
    expect(lines.slice(3).map((line) => JSON.parse(line))).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(boundary.shared[0].uri).toMatch(/forum-reader-diagnostic-\d+\.txt$/);
    expect(boundary.files.has(boundary.shared[0].uri)).toBe(false);
  });

  it('keeps two one-megabyte windows and exports the previous window before the current one', async () => {
    for (let sequence = 0; sequence < 540; sequence += 1) {
      appendDiagnosticLogLine(JSON.stringify({ padding: 'x'.repeat(4000), sequence }));
    }

    await exportDiagnosticLog(metadata);

    const content = boundary.shared[0].content;
    expect(content).not.toContain('"sequence":0,');
    expect(content.indexOf('"sequence":260')).toBeLessThan(content.indexOf('"sequence":539'));
    const persistedLogs = [...boundary.files.entries()].filter(([uri]) => uri.endsWith('.jsonl'));
    expect(persistedLogs).toHaveLength(2);
    expect(persistedLogs.every(([, bytes]) => bytes.byteLength <= 1024 * 1024)).toBe(true);
  });

  it('never lets a writer failure affect the app', () => {
    boundary.failWrites = true;

    expect(() => appendDiagnosticLogLine('{"sequence":1}')).not.toThrow();
  });

  it('deletes the temporary export when the system share chooser is unavailable', async () => {
    boundary.sharingAvailable = false;

    await expect(exportDiagnosticLog(metadata)).rejects.toThrow('当前设备不支持分享诊断日志');
    expect([...boundary.files.keys()].some((uri) => uri.endsWith('.txt'))).toBe(false);
  });

  it('keeps secrets, ids, content, URLs and paths out of the final exported file', async () => {
    const secret = 'EXPORT_SECRET_91827';
    const topicId = 'EXPORT_TOPIC_ID_91827';
    const title = 'EXPORT_PRIVATE_TITLE_91827';
    const body = 'EXPORT_PRIVATE_BODY_91827';
    const url = `https://linux.do/private/${topicId}?token=${secret}`;
    const filePath = `C:\\Users\\private\\${secret}.txt`;
    setDiagnosticWriter(appendDiagnosticLogLine);
    const trace = beginDiagnosticTrace('topic', 'open', {
      topicRef: diagnosticRef('topic', topicId),
      title,
      body,
      url,
      filePath,
      payload: { secret }
    } as unknown as DiagnosticFields);
    finishDiagnosticTrace(trace, 'failure', { reason: 'invalid_response' });
    recordDiagnosticError('app', 'js-error', new Error(`${title} ${body} ${url} ${filePath}`));

    await exportDiagnosticLog(metadata);

    const exported = boundary.shared[0].content;
    for (const privateValue of [secret, topicId, title, body, url, filePath]) {
      expect(exported).not.toContain(privateValue);
    }
    expect(exported).toContain('"topicRef":"topic-');
  });

  it('exports allowlisted native runtime phases without network secrets', async () => {
    const secret = 'NATIVE_RUNTIME_SECRET_91827';
    boundary.nativeEvents.push({
      timeMs: 1_786_199_367_265,
      operation: 'rotate-read-runtime',
      phase: 'intent',
      traceIdentity: 'trace-42',
      source: 'linuxdo',
      previousGeneration: 3,
      generation: 4
    });
    boundary.nativeEvents.push({
      timeMs: 1_786_199_367_267,
      operation: 'request',
      phase: 'connection-acquired',
      generation: 3,
      source: 'nodeseek',
      lane: 'media',
      method: 'GET',
      callId: '1a2b3c',
      imageTraceId: 'trace-43',
      imageSessionId: 'session-native-91827',
      mediaRef: 'media-43',
      imageConsumer: 'svg-probe',
      clientId: '2b3c4d',
      poolId: '3c4d5e',
      dispatcherId: '4d5e6f',
      connectionId: '5e6f70',
      elapsedMs: 43,
      queuedCount: 0,
      runningCount: 1,
      addressFamily: 'ipv4',
      protocol: 'h2',
      url: `https://nodeseek.com/private?token=${secret}`,
      ip: '203.0.113.42',
      cookie: `session=${secret}`,
      message: secret
    });
    boundary.nativeEvents.push({
      timeMs: 1_786_199_367_268,
      operation: 'rotate-read-runtime',
      phase: 'publish',
      traceIdentity: 'trace-42',
      source: 'linuxdo',
      previousGeneration: 3,
      generation: 4,
      dispatcherId: '6f7081',
      forumPoolId: '708192',
      mediaPoolId: '8192a3',
      imageClientId: '92a3b4'
    });
    boundary.nativeEvents.push({
      timeMs: 1_786_199_367_269,
      operation: 'rotate-read-runtime',
      phase: 'drain',
      traceIdentity: 'trace-42',
      source: 'linuxdo',
      generation: 3,
      queuedCount: 0,
      runningCount: 0,
      leaseCount: 0,
      cronetActiveCount: 1
    });
    boundary.nativeEvents.push({
      timeMs: 1_786_199_367_270,
      operation: 'rotate-read-runtime',
      phase: 'finish',
      traceIdentity: 'trace-42',
      source: 'linuxdo',
      previousGeneration: 3,
      generation: 4,
      outcome: 'retired'
    });
    boundary.nativeEvents.push({
      timeMs: 1_786_199_367_271,
      operation: 'cookie-response',
      phase: 'finish',
      source: 'linuxdo',
      traceId: 'trace-42',
      cookieCount: 2,
      cookieRevision: 7,
      cookieResult: 'applied',
      cookieEpoch: 3,
      requestCookieEpoch: 2,
      cookieWriteSequence: 5,
      cookieKind: 'login',
      cookieAction: 'delete',
      cookieLifetime: 'expired',
      cookieAccepted: 'accepted',
      hasLoginCookie: false,
      cookie: secret,
      cookieHash: secret,
      headers: { 'Set-Cookie': secret },
      url: `https://linux.do/private?${secret}`
    });
    appendDiagnosticLogLine(
      JSON.stringify({
        type: 'test-event',
        time: new Date(1_786_199_367_300).toISOString(),
        sequence: 'later-js-event'
      })
    );

    await exportDiagnosticLog(metadata);

    const exported = boundary.shared[0].content;
    expect(exported).toContain('"type":"native-read-network"');
    expect(exported).toContain('"nativePhase":"connection-acquired"');
    expect(exported).toContain('"operation":"cookie-response"');
    expect(exported).toContain('"cookieCount":2');
    expect(exported).toContain('"cookieResult":"applied"');
    expect(exported).toContain('"cookieKind":"login"');
    expect(exported).toContain('"cookieAction":"delete"');
    expect(exported).toContain('"hasLoginCookie":false');
    expect(exported).toContain('"requestCookieEpoch":2');
    expect(exported).toContain('"checkedInCurrentProcess":false');
    expect(exported).not.toContain('cookieHash');
    expect(exported).toContain('"traceId":"trace-43"');
    expect(exported).toContain('"appSessionId":"session-native-91827"');
    expect(exported).toContain('"mediaRef":"media-43"');
    expect(exported).toContain('"imageConsumer":"svg-probe"');
    expect(exported).toContain('"generation":3');
    expect(exported).toContain('"addressFamily":"ipv4"');
    expect(exported).toContain('"networkProtocol":"h2"');
    expect(exported).toContain('"nativePhase":"publish"');
    expect(exported).toContain('"forumPoolId":"708192"');
    expect(exported).toContain('"mediaPoolId":"8192a3"');
    const exportedEvents = exported
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const rotationEvents = exportedEvents.filter((event) => event.operation === 'rotate-read-runtime');
    expect(rotationEvents.map((event) => event.phase)).toEqual(['intent', 'apply', 'apply', 'finish']);
    expect(new Set(rotationEvents.map((event) => event.traceId))).toEqual(new Set(['trace-42']));
    expect(rotationEvents.filter((event) => event.phase === 'finish')).toHaveLength(1);
    expect(rotationEvents).toContainEqual(expect.objectContaining({ nativePhase: 'drain', cronetActiveCount: 1 }));
    expect(exported.indexOf('"nativePhase":"finish"')).toBeLessThan(exported.indexOf('"sequence":"later-js-event"'));
    expect(exported).not.toContain(secret);
    expect(exported).not.toContain('203.0.113.42');
  });

  it('installs one global JS error handler that records before delegating', async () => {
    let persistedBeforeDelegate = false;
    const originalHandler = vi.fn(() => {
      persistedBeforeDelegate = [...boundary.files.entries()].some(
        ([uri, bytes]) => uri.endsWith('.jsonl') && new TextDecoder().decode(bytes).includes('"operation":"js-error"')
      );
    });
    let installedHandler: ((error: unknown, isFatal?: boolean) => void) | undefined;
    const setGlobalHandler = vi.fn((handler: typeof installedHandler) => {
      installedHandler = handler;
    });
    Object.defineProperty(globalThis, 'ErrorUtils', {
      configurable: true,
      value: {
        getGlobalHandler: () => installedHandler || originalHandler,
        setGlobalHandler
      }
    });

    initializeDiagnosticFileLogging();
    initializeDiagnosticFileLogging();
    installedHandler?.(new Error('boom'), true);
    await exportDiagnosticLog(metadata);

    expect(setGlobalHandler).toHaveBeenCalledTimes(1);
    expect(originalHandler).toHaveBeenCalledWith(expect.any(Error), true);
    expect(persistedBeforeDelegate).toBe(true);
    expect(boundary.shared[0].content).toContain('"operation":"js-error"');
    Reflect.deleteProperty(globalThis, 'ErrorUtils');
  });
});
