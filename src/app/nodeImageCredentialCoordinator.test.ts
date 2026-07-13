import { describe, expect, it, vi } from 'vitest';
import { createNodeImageCredentialCoordinator } from './nodeImageCredentialCoordinator';

function credentialStore(initial: string | null) {
  let value = initial;
  const writes: Array<string | null> = [];
  return {
    clear: vi.fn(async () => {
      value = null;
      writes.push(null);
    }),
    read: vi.fn(async () => value),
    save: vi.fn(async (next: string) => {
      value = next;
      writes.push(next);
    }),
    value: () => value,
    writes
  };
}

describe('NodeImage credential coordinator', () => {
  it('serializes saves and exposes the stored value after pending writes', async () => {
    const store = credentialStore('old');
    const coordinator = createNodeImageCredentialCoordinator(store);

    const first = coordinator.replace('first');
    const second = coordinator.replace('second');

    await Promise.all([first.promise, second.promise]);
    await expect(coordinator.read()).resolves.toBe('second');
    expect(store.writes).toEqual(['first', 'second']);
  });

  it('restores a canceled authorization after its already-started save', async () => {
    const releaseFirst = Promise.withResolvers<void>();
    let value: string | null = 'old';
    const writes: Array<string | null> = [];
    const coordinator = createNodeImageCredentialCoordinator({
      read: async () => value,
      save: async (next) => {
        if (next === 'authorization-a') {
          await releaseFirst.promise;
        }
        value = next;
        writes.push(next);
      },
      clear: async () => {
        value = null;
        writes.push(null);
      }
    });
    const baseline = await coordinator.read();
    const authorizationA = coordinator.replace('authorization-a');
    const restore = coordinator.replaceIfCurrent(authorizationA.revision, baseline);

    releaseFirst.resolve();
    await Promise.all([authorizationA.promise, restore!.promise]);

    expect(value).toBe('old');
    expect(writes).toEqual(['authorization-a', 'old']);
  });

  it('keeps a newer authorization last when an older save completes late', async () => {
    const releaseFirst = Promise.withResolvers<void>();
    let value: string | null = 'old';
    const writes: Array<string | null> = [];
    const coordinator = createNodeImageCredentialCoordinator({
      read: async () => value,
      save: async (next) => {
        if (next === 'authorization-a') {
          await releaseFirst.promise;
        }
        value = next;
        writes.push(next);
      },
      clear: async () => {
        value = null;
        writes.push(null);
      }
    });

    const baselineA = await coordinator.read();
    const authorizationA = coordinator.replace('authorization-a');
    const restoreA = coordinator.replaceIfCurrent(authorizationA.revision, baselineA)!;
    const baselineB = coordinator.read();
    const authorizationB = baselineB.then((baseline) => ({ baseline, mutation: coordinator.replace('authorization-b') }));

    releaseFirst.resolve();
    const next = await authorizationB;
    await Promise.all([authorizationA.promise, restoreA.promise, next.mutation.promise]);

    expect(next.baseline).toBe('old');
    expect(value).toBe('authorization-b');
    expect(writes).toEqual(['authorization-a', 'old', 'authorization-b']);
  });

  it('does not let a stale cancellation overwrite a newer explicit mutation', async () => {
    const store = credentialStore('old');
    const coordinator = createNodeImageCredentialCoordinator(store);
    const authorization = coordinator.replace('authorization');
    const newer = coordinator.replace('manual');

    expect(coordinator.replaceIfCurrent(authorization.revision, 'old')).toBeNull();
    await Promise.all([authorization.promise, newer.promise]);
    expect(store.value()).toBe('manual');
  });
});
