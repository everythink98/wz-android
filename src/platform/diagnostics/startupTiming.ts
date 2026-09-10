export type StartupPhase =
  | 'js-entry'
  | 'react-mounted'
  | 'reader-start'
  | 'reader-read'
  | 'reader-parsed'
  | 'reader-cleaned'
  | 'reader-serialized'
  | 'reader-ready'
  | 'sessions-start'
  | 'sessions-read'
  | 'sessions-ready'
  | 'navigation-ready'
  | 'page-layout'
  | 'page-ready'
  | 'splash-hidden'
  | 'feed-content'
  | 'feed-empty'
  | 'feed-error';

let recorder: ((phase: StartupPhase) => void) | undefined;

export function setStartupTimingRecorder(next: typeof recorder) {
  recorder = next;
}

// The bootstrap installs Native's process clock without making storage depend on RN.
export function recordStartupPhase(phase: StartupPhase) {
  try {
    recorder?.(phase);
  } catch {
    // Timing must never change startup or recovery behavior.
  }
}
