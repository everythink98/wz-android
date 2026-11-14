import { describe, expect, it } from 'vitest';
import { createLinuxDoCookieHandoff } from './linuxDoCookieHandoff';

describe('LinuxDo Cookie handoff ownership', () => {
  it('waits for the physical unmount and preparation and retains the separate Credit settlement', async () => {
    const cookies = createLinuxDoCookieHandoff();
    const owner = new AbortController();
    const marker = Promise.withResolvers<void>();
    const credit = Promise.withResolvers<void>();
    const calls: string[] = [];
    cookies.observeMount(true);
    void cookies.prepare({
      owner: owner.signal,
      generation: 1,
      marker: marker.promise,
      ownerIsCurrent: () => true,
      apply: async () => {
        calls.push('prepared');
      }
    });
    const close = cookies.close(1, async () => {
      calls.push('closed');
    });
    cookies.reconcileCredit(() => credit.promise);
    let settled = false;
    const completed = cookies.settled().then(() => {
      settled = true;
    });
    marker.resolve();
    await Promise.resolve();
    expect(calls).toEqual(['prepared']);
    expect(settled).toBe(false);
    cookies.observeMount(false);
    await close;
    expect(calls).toEqual(['prepared', 'closed']);
    expect(settled).toBe(false);
    credit.resolve();
    await completed;
    expect(settled).toBe(true);
  });

  it('does not unlock a new handoff when an older unmount wait completes', async () => {
    const cookies = createLinuxDoCookieHandoff();
    const generations: number[] = [];
    cookies.observeMount(true);
    const retired = cookies.close(1, async (generation) => {
      generations.push(generation);
    });
    const retiredResult = retired.catch(() => 'retired');
    cookies.cancelHandoff();
    const current = cookies.close(2, async (generation) => {
      generations.push(generation);
    });
    cookies.observeMount(false);
    await expect(retiredResult).resolves.toBe('retired');
    await current;
    expect(generations).toEqual([2]);
  });
});
