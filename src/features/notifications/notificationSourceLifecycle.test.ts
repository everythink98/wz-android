import { describe, expect, it, vi } from 'vitest';
import {
  createNotificationSourceLifecycleRegistry,
  markNotificationSourcesCleaning,
  notificationSourceIsOperational,
  operationalNotificationSources,
  runNotificationSourceCleanup
} from './notificationSourceLifecycle';

describe('notification source lifecycle', () => {
  it('derives operational sources from intent and lifecycle', () => {
    const registry = createNotificationSourceLifecycleRegistry();

    expect(operationalNotificationSources(registry, ['nodeseek', 'linuxdo'], true)).toEqual(['nodeseek', 'linuxdo']);
    markNotificationSourcesCleaning(registry, ['nodeseek']);
    expect(operationalNotificationSources(registry, ['nodeseek', 'linuxdo'], true)).toEqual(['linuxdo']);
    expect(notificationSourceIsOperational(registry, 'nodeseek', false, ['nodeseek'])).toBe(false);
  });

  it('serializes cleanup and keeps failures paused until a successful retry', async () => {
    const registry = createNotificationSourceLifecycleRegistry();
    const onTransition = vi.fn();
    let rejectCleanup!: (error: Error) => void;
    const cleanup = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectCleanup = reject;
        })
    );
    markNotificationSourcesCleaning(registry, ['nodeseek']);

    const first = runNotificationSourceCleanup(registry, 'nodeseek', cleanup, onTransition);
    const duplicate = runNotificationSourceCleanup(registry, 'nodeseek', cleanup, onTransition);
    await Promise.resolve();
    rejectCleanup(new Error('cleanup failed'));
    await expect(first.operation).rejects.toThrow('cleanup failed');

    expect(duplicate).toEqual({ operation: first.operation, started: false });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(registry.nodeseek.phase).toBe('cleanup-failed');
    expect(notificationSourceIsOperational(registry, 'nodeseek', true, ['nodeseek'])).toBe(false);

    const retry = runNotificationSourceCleanup(registry, 'nodeseek', async () => undefined, onTransition);
    await expect(retry.operation).resolves.toBeUndefined();
    expect(registry.nodeseek.phase).toBe('clean');
    expect(notificationSourceIsOperational(registry, 'nodeseek', true, ['nodeseek'])).toBe(true);
  });
});
