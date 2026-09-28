import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticFields } from '@/platform/diagnostics/diagnosticPolicy';

const boundary = vi.hoisted(() => ({
  persisted: '',
  exports: [] as string[],
  append: async (_lines: string): Promise<void> => undefined
}));
vi.mock('react-native', () => ({
  NativeModules: {
    DiagnosticsModule: {
      buildId: 'a'.repeat(32),
      processSessionId: `process-${'b'.repeat(32)}`,
      appendBatch: (lines: string) => boundary.append(lines),
      snapshot: async () => ({ jsLines: boundary.persisted, health: { available: true } })
    }
  }
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'mock://cache/' } },
  File: class {
    exists = false;
  }
}));
vi.mock('@/platform/diagnostics/diagnosticExportFiles', () => ({
  createDiagnosticExport: async (content: string) => {
    boundary.exports.push(content);
    return { uri: 'mock://diagnostics.txt', exists: true, delete: () => undefined };
  },
  pruneDiagnosticExports: () => undefined
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: async () => undefined }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  boundary.persisted = '';
  boundary.exports = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('diagnostic event storm at the production writer', () => {
  it.each(['resolve', 'reject'] as const)(
    'bounds 10,000 completed traces behind a stalled writer and accounts for every event after %s',
    async (settlement) => {
      const { appendDiagnosticLogLine, exportDiagnosticLog } =
        await import('@/platform/diagnostics/diagnosticFileStore');
      const { beginDiagnosticTrace, finishDiagnosticTrace, setDiagnosticWriter } =
        await import('@/platform/diagnostics/diagnostics');
      const batches: string[] = [];
      let active = 0;
      let maximumActive = 0;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve, reject) => {
        release = () => (settlement === 'resolve' ? resolve() : reject(new Error('injected native write failure')));
      });
      boundary.append = async (lines) => {
        batches.push(lines);
        active++;
        maximumActive = Math.max(maximumActive, active);
        try {
          if (batches.length === 1) await held;
          boundary.persisted += lines;
        } finally {
          active--;
        }
      };
      setDiagnosticWriter(appendDiagnosticLogLine);
      try {
        beginDiagnosticTrace('topic', 'open', { source: 'linuxdo' });
        await vi.advanceTimersByTimeAsync(0);
        expect(batches).toHaveLength(1);
        for (let index = 0; index < 10_000; index++) {
          const trace = beginDiagnosticTrace('topic', 'open', {
            source: 'linuxdo',
            count: index,
            title: 'STRESS_PRIVATE_TOKEN'
          } as unknown as DiagnosticFields);
          finishDiagnosticTrace(trace, 'success');
        }
        const timedOutExport = exportDiagnosticLog({ appVersion: '1.0.0', versionCode: 1 });
        await vi.advanceTimersByTimeAsync(5_001);
        await timedOutExport;
        const stalled = JSON.parse(boundary.exports[0]!.split('\n')[1]!);
        expect(stalled.writerStatus).toBe('timeout');
        expect(stalled.droppedCount).toBeGreaterThan(19_000);
        expect(stalled.writeFailureCount).toBe(1);
        expect(batches).toHaveLength(1);
        expect(active).toBe(1);
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(batches).toHaveLength(2);
        expect(Buffer.byteLength(batches.join(''))).toBeLessThanOrEqual(128 * 1024);
        expect(maximumActive).toBe(1);
        expect(active).toBe(0);
        expect(vi.getTimerCount()).toBe(0);

        await exportDiagnosticLog({ appVersion: '1.0.0', versionCode: 1 });
        const settled = JSON.parse(boundary.exports.at(-1)!.split('\n')[1]!);
        const persistedCount = boundary.persisted.trim().split('\n').length;
        expect(settled.writerStatus).toBe('settled');
        expect(settled.eventCount).toBe(persistedCount);
        expect(persistedCount + settled.droppedCount).toBe(20_001);
        expect(settled.droppedCount - stalled.droppedCount).toBe(settlement === 'reject' ? 1 : 0);
        expect(boundary.persisted).not.toContain('STRESS_PRIVATE_TOKEN');

        const resumed = beginDiagnosticTrace('topic', 'open', { count: 20_002 });
        finishDiagnosticTrace(resumed, 'success');
        await vi.advanceTimersByTimeAsync(0);
        expect(batches).toHaveLength(3);
        expect(boundary.persisted.trim().split('\n').length).toBe(persistedCount + 2);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        setDiagnosticWriter(null);
        release();
        await vi.advanceTimersByTimeAsync(0);
      }
    }
  );
});
