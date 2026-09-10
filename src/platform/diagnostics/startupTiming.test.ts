import { afterEach, expect, it, vi } from 'vitest';
import { recordStartupPhase, setStartupTimingRecorder } from './startupTiming';

afterEach(() => setStartupTimingRecorder(undefined));

it('forwards a phase to the installed process clock and isolates unavailable diagnostics', () => {
  expect(() => recordStartupPhase('reader-start')).not.toThrow();
  const recorder = vi.fn();
  setStartupTimingRecorder(recorder);
  recordStartupPhase('reader-ready');
  expect(recorder).toHaveBeenCalledWith('reader-ready');
  setStartupTimingRecorder(() => {
    throw new Error('native unavailable');
  });
  expect(() => recordStartupPhase('page-ready')).not.toThrow();
});
