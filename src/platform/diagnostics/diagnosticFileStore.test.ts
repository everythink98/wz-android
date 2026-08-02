import { beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  failWrites: false,
  files: new Map<string, Uint8Array>(),
  openCount: 0,
  writeCount: 0,
  shared: [] as { content: string; uri: string }[],
  sharingAvailable: true
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

    move(destination: File) {
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

vi.mock('expo-sharing', () => ({
  isAvailableAsync: vi.fn(async () => boundary.sharingAvailable),
  shareAsync: vi.fn(async (uri: string) => {
    boundary.shared.push({
      content: new TextDecoder().decode(boundary.files.get(uri) || new Uint8Array()),
      uri
    });
  })
}));

import {
  appendDiagnosticLogLine,
  exportDiagnosticLog,
  initializeDiagnosticFileLogging,
  type DiagnosticExportMetadata
} from './diagnosticFileStore';
import { beginDiagnosticTrace, finishDiagnosticTrace, recordDiagnosticError, setDiagnosticWriter } from './diagnostics';
import { diagnosticRef, type DiagnosticFields } from './diagnosticPolicy';

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
  yaohuoSession: 'anonymous',
  xiaoyinsiSession: 'authorizing'
};

beforeEach(() => {
  setDiagnosticWriter(null);
  boundary.failWrites = false;
  boundary.files.clear();
  boundary.openCount = 0;
  boundary.writeCount = 0;
  boundary.shared.length = 0;
  boundary.sharingAvailable = true;
});

describe('diagnostic file store', () => {
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
        type: 'diagnostic-metadata',
        xiaoyinsiSession: 'authorizing'
      })
    );
    expect(lines.slice(1).map((line) => JSON.parse(line))).toEqual([{ sequence: 1 }, { sequence: 2 }]);
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
