import { afterEach, describe, expect, it } from 'vitest';
import { setDiagnosticWriter } from '@/platform/diagnostics/diagnostics';
import { linkDiagnosticRefs } from '@/platform/diagnostics/diagnosticPolicy';
import { playerLoadDiagnosticAttempt, recordMediaBudgetTimeout } from './mediaPlaybackDiagnostics';

afterEach(() => setDiagnosticWriter(null));

describe('native media diagnostic lifecycle', () => {
  it('preserves a playback failure after readiness and correlates its budget without media contents', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const uri = 'https://private.invalid/media?token=SECRET';
    const identity = `audio:private-session:${uri}`;
    linkDiagnosticRefs('media', [uri, identity]);
    const attempt = playerLoadDiagnosticAttempt(uri, 'audio', 7);
    attempt.stage('player-replace');
    attempt.ready();
    attempt.failed(new Error('codec failed SECRET'));
    attempt.failed(new Error('duplicate SECRET'));
    recordMediaBudgetTimeout(identity, 'audio', 30_000);
    const events = lines.map((line) => JSON.parse(line));
    const load = events.find((event) => event.operation === 'player-load' && event.phase === 'intent');
    expect(events.find((event) => event.operation === 'player-error')?.parentTraceId).toBe(load.traceId);
    expect(events.filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ operation: 'player-load', outcome: 'success' }),
      expect.objectContaining({ operation: 'player-error', outcome: 'failure', mediaFailure: 'decode_error' }),
      expect.objectContaining({ operation: 'media-budget', reason: 'timeout' })
    ]);
    expect(new Set(events.map((event) => event.mediaRef)).size).toBe(1);
    expect(lines.join('')).not.toMatch(/SECRET|private/);
  });

  it('ignores native callbacks after the owning attempt is canceled', () => {
    const lines: string[] = [];
    setDiagnosticWriter((line) => {
      lines.push(line);
    });
    const attempt = playerLoadDiagnosticAttempt('https://example.invalid/canceled', 'video', 1);
    attempt.canceled();
    attempt.ready();
    attempt.failed(new Error('late failure'));
    expect(lines.map((line) => JSON.parse(line)).filter((event) => event.phase === 'finish')).toEqual([
      expect.objectContaining({ operation: 'player-load', outcome: 'canceled' })
    ]);
  });
});
