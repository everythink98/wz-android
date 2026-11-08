import { vi } from 'vitest';

export function createDiscourseReadingClock() {
  let clock = 0;
  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      clock += Math.min(1000, ms - elapsed);
      await vi.advanceTimersByTimeAsync(Math.min(1000, ms - elapsed));
    }
  };
  return { now: () => clock, advance };
}
