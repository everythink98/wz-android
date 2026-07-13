import { describe, expect, it } from 'vitest';
import { createNodeImageAuthRequestGate } from './nodeImageAuthRequestGate';

describe('NodeImage authorization request gate', () => {
  it('shares one pending authorization between concurrent callers', async () => {
    const gate = createNodeImageAuthRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(second.promise).toBe(first.promise);
    expect(second.owner).toBe(first.owner);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(gate.finish(first.owner, 'saved-key')).toBe(true);
    await expect(first.promise).resolves.toBe('saved-key');
  });

  it('resolves cancellation and allows a later fresh request', async () => {
    const gate = createNodeImageAuthRequestGate();
    const first = gate.begin();
    gate.finish(first.owner, null);
    await expect(first.promise).resolves.toBeNull();

    const second = gate.begin();
    expect(second.created).toBe(true);
    expect(second.promise).not.toBe(first.promise);
  });

  it('rejects stale completion from a canceled authorization owner', async () => {
    const gate = createNodeImageAuthRequestGate();
    const first = gate.begin();
    gate.finish(first.owner, null);
    await expect(first.promise).resolves.toBeNull();

    const second = gate.begin();
    expect(gate.finish(first.owner, 'stale-key')).toBe(false);
    expect(gate.finish(second.owner, 'fresh-key')).toBe(true);
    await expect(second.promise).resolves.toBe('fresh-key');
  });
});
