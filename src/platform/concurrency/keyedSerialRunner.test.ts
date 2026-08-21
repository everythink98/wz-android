import { describe, expect, it, vi } from 'vitest';
import { createKeyedSerialRunner } from './keyedSerialRunner';

describe('keyed serial runner', () => {
  it('serializes the same key while allowing different keys to run concurrently', async () => {
    const runner = createKeyedSerialRunner<string>();
    const releaseFirst = Promise.withResolvers<void>();
    const events: string[] = [];
    const first = runner.run('same', async () => {
      events.push('first:start');
      await releaseFirst.promise;
      events.push('first:end');
    });
    const second = runner.run('same', async () => {
      events.push('second');
    });
    const other = runner.run('other', async () => {
      events.push('other');
    });

    await other;
    expect(events).toEqual(['first:start', 'other']);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'other', 'first:end', 'second']);
  });

  it('runs the next operation after a rejection', async () => {
    const runner = createKeyedSerialRunner<string>();

    await expect(runner.run('key', async () => Promise.reject(new Error('first failed')))).rejects.toThrow(
      'first failed'
    );
    await expect(runner.run('key', async () => 'next')).resolves.toBe('next');
  });

  it('releases a settled tail', async () => {
    const runner = createKeyedSerialRunner<object>();
    const key = {};
    const deleteSpy = vi.spyOn(Map.prototype, 'delete');

    await runner.run(key, async () => undefined);
    await Promise.resolve();

    expect(deleteSpy).toHaveBeenCalledWith(key);
    deleteSpy.mockRestore();
  });
});
