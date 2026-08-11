import { describe, expect, it, vi } from 'vitest';
import {
  advanceCredentialWriteGeneration,
  createCredentialWriteGate,
  enqueueCredentialWriteForGeneration,
  replaceCredentialWrite
} from './credentialWriteGate';

describe('credential write gate', () => {
  it('serializes writes for one generation', async () => {
    const gate = createCredentialWriteGate();
    const first = Promise.withResolvers<void>();
    const order: string[] = [];
    const firstWrite = enqueueCredentialWriteForGeneration(gate, gate.generation, async () => {
      order.push('first:start');
      await first.promise;
      order.push('first:end');
      return 'first';
    });
    const secondWrite = enqueueCredentialWriteForGeneration(gate, gate.generation, () => {
      order.push('second');
      return 'second';
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['first:start']);
    first.resolve();

    await expect(firstWrite).resolves.toBe('first');
    await expect(secondWrite).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('invalidates queued and in-flight writes after a replacement', async () => {
    const gate = createCredentialWriteGate();
    const first = Promise.withResolvers<void>();
    const oldWrite = enqueueCredentialWriteForGeneration(gate, gate.generation, async ({ isCurrent }) => {
      await first.promise;
      return isCurrent() ? 'old' : 'stale';
    });
    const queuedOld = enqueueCredentialWriteForGeneration(gate, gate.generation, () => 'queued-old');
    const replacement = replaceCredentialWrite(gate, () => 'new');
    first.resolve();

    await expect(oldWrite).resolves.toBeUndefined();
    await expect(queuedOld).resolves.toBeUndefined();
    await expect(replacement).resolves.toBe('new');
  });

  it('does not run work submitted for a stale explicit generation', async () => {
    const gate = createCredentialWriteGate();
    const staleGeneration = gate.generation;
    advanceCredentialWriteGeneration(gate);
    const task = vi.fn(() => 'must-not-run');

    await expect(enqueueCredentialWriteForGeneration(gate, staleGeneration, task)).resolves.toBeUndefined();
    expect(task).not.toHaveBeenCalled();
  });
});
