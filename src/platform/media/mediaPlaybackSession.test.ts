import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoPlayer } from 'expo-video';
import { MediaPlaybackSession } from './mediaPlaybackSession';

vi.mock('./mediaPlaybackDiagnostics', () => ({ recordMediaBudgetTimeout: vi.fn() }));

function nativePlayer(status = 'readyToPlay') {
  const listeners = new Map<string, Set<(event: Record<string, unknown>) => void>>();
  const player = {
    currentTime: 0,
    duration: 90,
    status,
    pause: vi.fn(),
    addListener: (name: string, listener: (event: Record<string, unknown>) => void) => {
      const callbacks = listeners.get(name) || new Set();
      callbacks.add(listener);
      listeners.set(name, callbacks);
      return { remove: () => callbacks.delete(listener) };
    }
  };
  // The external native boundary; production coordination is not mocked.
  return {
    player: player as unknown as VideoPlayer,
    listeners,
    emit: (name: string, event: Record<string, unknown>) => {
      for (const listener of listeners.get(name) || []) listener(event);
    }
  };
}

afterEach(() => vi.useRealTimers());

describe('route media playback', () => {
  it('restores a recycled video position after source preparation and leaves later seeks alone', () => {
    const session = new MediaPlaybackSession();
    session.remember('video', 23);
    const abandoned = nativePlayer('idle');
    const abandonedHandle = session.attach(abandoned.player, 'video', 'video', { onTimeout: vi.fn() });
    abandoned.emit('timeUpdate', { currentTime: 0, bufferedPosition: 0 });
    abandonedHandle.dispose();
    expect(session.position('video')).toBe(23);
    const native = nativePlayer('idle');
    session.attach(native.player, 'video', 'video', { onTimeout: vi.fn() });
    expect(native.player.currentTime).toBe(0);
    native.emit('statusChange', { status: 'readyToPlay' });
    expect(native.player.currentTime).toBe(23);
    native.player.currentTime = 5;
    native.emit('statusChange', { status: 'loading' });
    native.emit('statusChange', { status: 'readyToPlay' });
    expect(native.player.currentTime).toBe(5);
    session.dispose();
  });

  it('keeps the native fullscreen activity playing across the host pause but pauses when fullscreen backgrounds', () => {
    const session = new MediaPlaybackSession();
    const native = nativePlayer();
    session.attach(native.player, 'video', 'video', { onTimeout: vi.fn() });
    native.emit('fullscreenChange', { fullscreen: true, active: true });
    native.emit('playWhenReadyChange', { playWhenReady: true });
    session.updateGate(false);
    expect(native.player.pause).not.toHaveBeenCalled();
    native.emit('fullscreenChange', { fullscreen: true, active: false });
    expect(native.player.pause).toHaveBeenCalledTimes(1);
    native.emit('fullscreenChange', { fullscreen: true, active: true });
    session.updateGate(true);
    expect(native.player.pause).toHaveBeenCalledTimes(1);
    session.dispose();
  });
  it('renews only actual buffer progress after a backwards seek and terminates a later stall', () => {
    vi.useFakeTimers();
    const session = new MediaPlaybackSession();
    const native = nativePlayer();
    const onTimeout = vi.fn();
    const handle = session.attach(native.player, 'video', 'video', { onTimeout });
    handle.intent(true);
    handle.progress(70);
    native.emit('positionDiscontinuity', { currentTime: 5 });
    handle.status('loading');
    handle.progress(5);
    vi.advanceTimersByTime(20_000);
    handle.progress(9);
    vi.advanceTimersByTime(20_000);
    expect(onTimeout).not.toHaveBeenCalled();
    handle.progress(9);
    vi.advanceTimersByTime(10_001);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(native.player.pause).toHaveBeenCalled();
    session.dispose();
  });

  it('rejects playback from an inactive route and ignores old callbacks after disposal', () => {
    vi.useFakeTimers();
    const session = new MediaPlaybackSession();
    const native = nativePlayer();
    const onTimeout = vi.fn();
    const handle = session.attach(native.player, 'video', 'video', { onTimeout });
    const staleTime = [...native.listeners.get('timeUpdate')!][0];
    session.updateGate(false);
    native.emit('playWhenReadyChange', { playWhenReady: true });
    expect(native.player.pause).toHaveBeenCalled();
    native.player.currentTime = 12;
    handle.dispose();
    staleTime({ currentTime: 70, bufferedPosition: 90 });
    expect(session.position('video')).toBe(12);
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).not.toHaveBeenCalled();
    session.dispose();
  });
});
