// Native events can wake the proof while Android has paused MainActivity's JS timers.
export function waitForMediaProofChange(changes: Set<() => void>) {
  return new Promise<void>((resolve) => {
    const resume = () => {
      clearTimeout(timer);
      changes.delete(resume);
      resolve();
    };
    const timer = setTimeout(resume, 100);
    changes.add(resume);
  });
}
