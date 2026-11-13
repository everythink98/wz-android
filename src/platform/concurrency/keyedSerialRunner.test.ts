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

  it.each(['fulfilled', 'rejected'] as const)(
    'dispatches queued work before follow-up observer microtasks after a %s result',
    async (outcome) => {
      const runner = createKeyedSerialRunner<string>();
      const pending = Promise.withResolvers<string>();
      const events: string[] = [];
      const first = runner.run('key', () => {
        events.push('first');
        return pending.promise;
      });
      const second = runner.run('key', async () => {
        events.push('second');
      });
      const observe = () => {
        events.push('observer');
        queueMicrotask(() => events.push('observer:microtask'));
        return runner.run('key', async () => {
          events.push('third');
        });
      };
      const observed = first.then(observe, observe);

      expect(events).toEqual([]);
      if (outcome === 'fulfilled') pending.resolve('done');
      else pending.reject(new Error('failed'));
      await Promise.all([observed, second]);

      expect(events).toEqual(['first', 'observer', 'second', 'observer:microtask', 'third']);
    }
  );

  it('queues reentrant work and recovers after an operation throws synchronously', async () => {
    const runner = createKeyedSerialRunner<string>();
    const events: string[] = [];
    const failure = new Error('failed before returning a promise');
    let nested: Promise<void> | undefined;
    const first = runner.run('key', () => {
      events.push('first');
      nested = runner.run('key', async () => {
        events.push('nested');
      });
      throw failure;
    });
    const second = runner.run('key', async () => {
      events.push('second');
    });

    expect(events).toEqual([]);
    await expect(first).rejects.toBe(failure);
    await second;
    await nested;
    expect(events).toEqual(['first', 'second', 'nested']);
  });

  it('keeps later work behind the current owner after an older job settles', async () => {
    const runner = createKeyedSerialRunner<string>();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const secondEntered = Promise.withResolvers<void>();
    const events: string[] = [];
    const firstJob = runner.run('key', () => first.promise);
    const secondJob = runner.run('key', async () => {
      events.push('second:start');
      secondEntered.resolve();
      await second.promise;
      events.push('second:end');
    });
    first.resolve();
    await secondEntered.promise;
    const thirdJob = runner.run('key', async () => {
      events.push('third');
    });
    try {
      await Promise.resolve();
      expect(events).toEqual(['second:start']);
    } finally {
      second.resolve();
      await Promise.all([firstJob, secondJob, thirdJob]);
    }
    expect(events).toEqual(['second:start', 'second:end', 'third']);
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
