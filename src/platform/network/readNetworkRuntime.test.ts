import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());

describe('read network rotation snapshot', () => {
  it('publishes only newer safe generations without changing earlier snapshots', async () => {
    const runtime = await import('./readNetworkRuntime');
    const initial = runtime.getReadNetworkRuntimeSnapshot();
    const observed = vi.fn();
    const unsubscribe = runtime.subscribeReadNetworkRuntime(observed);
    try {
      for (const generation of [NaN, Infinity, 1.5, -1, 0, Number.MAX_SAFE_INTEGER + 1]) {
        expect(runtime.publishReadNetworkRuntimeRotation(generation, 'nodeseek')).toBe(initial);
        expect(runtime.getReadNetworkRuntimeSnapshot()).toBe(initial);
      }
      expect(observed).not.toHaveBeenCalled();
      const first = runtime.publishReadNetworkRuntimeRotation(1, 'nodeseek');
      expect(first).toEqual({ generation: 1, triggerSource: 'nodeseek' });
      expect(runtime.getReadNetworkRuntimeSnapshot()).toBe(first);
      expect(runtime.currentReadNetworkRuntimeGeneration()).toBe(1);
      expect(observed).toHaveBeenCalledTimes(1);
      expect(runtime.publishReadNetworkRuntimeRotation(1, 'linuxdo')).toBe(first);
      expect(runtime.publishReadNetworkRuntimeRotation(0, 'linuxdo')).toBe(first);
      expect(observed).toHaveBeenCalledTimes(1);
      const second = runtime.publishReadNetworkRuntimeRotation(2, 'linuxdo');
      expect(second).toEqual({ generation: 2, triggerSource: 'linuxdo' });
      expect(second).not.toBe(first);
      expect(initial).toEqual({ generation: 0, triggerSource: null });
      expect(first).toEqual({ generation: 1, triggerSource: 'nodeseek' });
      expect(observed).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it('notifies only the distinct subscriptions that still own a listener', async () => {
    const runtime = await import('./readNetworkRuntime');
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = runtime.subscribeReadNetworkRuntime(first);
    const unsubscribeSecond = runtime.subscribeReadNetworkRuntime(second);
    try {
      runtime.publishReadNetworkRuntimeRotation(1, 'nodeseek');
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      unsubscribeFirst();
      unsubscribeFirst();
      runtime.publishReadNetworkRuntimeRotation(2, 'linuxdo');
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
      unsubscribeSecond();
      runtime.publishReadNetworkRuntimeRotation(3, 'v2ex');
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribeFirst();
      unsubscribeSecond();
    }
  });
});
