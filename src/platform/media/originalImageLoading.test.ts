import { describe, expect, it, vi } from 'vitest';
import type { ImageURISource } from 'react-native';
import {
  markOriginalImageDisplayed,
  originalImageDisplayRevision,
  subscribeOriginalImageDisplay
} from './originalImageLoading';

describe('original image progressive loading', () => {
  it('isolates displayed originals by the complete media request identity', () => {
    const url = 'https://img.example.com/session-isolated-original.png';
    const epochOne = {
      cacheKey: `yaohuo:1:${url}`,
      headers: { 'X-WZ-Forum-Media-Identity': 'yaohuo:1' },
      uri: url
    } as ImageURISource & { cacheKey: string };
    const epochTwo = {
      cacheKey: `yaohuo:2:${url}`,
      headers: { 'X-WZ-Forum-Media-Identity': 'yaohuo:2' },
      uri: url
    } as ImageURISource & { cacheKey: string };

    expect(originalImageDisplayRevision(epochOne)).toBe(0);
    expect(originalImageDisplayRevision(epochTwo)).toBe(0);
    markOriginalImageDisplayed(epochOne);
    expect(originalImageDisplayRevision(epochOne)).toBe(1);
    expect(originalImageDisplayRevision(epochTwo)).toBe(0);
  });

  it('notifies only listeners for the displayed media identity', () => {
    const sourceA = { uri: 'https://img.example.com/notified-original-a.png' };
    const sourceB = { uri: 'https://img.example.com/notified-original-b.png' };
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const unsubscribeA = subscribeOriginalImageDisplay(sourceA, listenerA);
    const unsubscribeB = subscribeOriginalImageDisplay(sourceB, listenerB);

    markOriginalImageDisplayed(sourceA);

    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).not.toHaveBeenCalled();
    unsubscribeA();
    unsubscribeB();
  });

  it('keeps snapshot reads pure and promotes committed subscriptions', () => {
    const sources = Array.from({ length: 514 }, (_, index) => ({
      uri: `https://img.example.com/lru-original-${index}.png`
    }));

    sources.slice(0, 512).forEach(markOriginalImageDisplayed);
    expect(originalImageDisplayRevision(sources[0])).toBe(1);
    markOriginalImageDisplayed(sources[512]);

    expect(originalImageDisplayRevision(sources[0])).toBe(0);
    expect(originalImageDisplayRevision(sources[1])).toBe(1);

    const unsubscribe = subscribeOriginalImageDisplay(sources[1], () => {});
    unsubscribe();
    markOriginalImageDisplayed(sources[513]);

    expect(originalImageDisplayRevision(sources[1])).toBe(1);
    expect(originalImageDisplayRevision(sources[2])).toBe(0);
  });

  it('retains active revision listeners until they unsubscribe', () => {
    const activeSource = { uri: 'https://img.example.com/active-original.png' };
    markOriginalImageDisplayed(activeSource);
    const unsubscribe = subscribeOriginalImageDisplay(activeSource, () => {});

    Array.from({ length: 512 }, (_, index) => ({
      uri: `https://img.example.com/active-pressure-${index}.png`
    })).forEach(markOriginalImageDisplayed);
    expect(originalImageDisplayRevision(activeSource)).toBe(1);

    unsubscribe();
    Array.from({ length: 512 }, (_, index) => ({
      uri: `https://img.example.com/post-unsubscribe-pressure-${index}.png`
    })).forEach(markOriginalImageDisplayed);
    expect(originalImageDisplayRevision(activeSource)).toBe(0);
  });

  it('bounds eviction work while active originals exceed capacity and preserves their release order', () => {
    const prefix = 'https://img.example.com/bounded-revision-work/';
    const sources = Array.from({ length: 2_048 }, (_, index) => ({ uri: `${prefix}${index}.png` }));
    const active = sources.slice(0, 1_024);
    let notifications = 0;
    const releases = active.map((source) => subscribeOriginalImageDisplay(source, () => notifications++));
    const originalHas = Map.prototype.has;
    let membershipProbes = 0;
    const has = vi.spyOn(Map.prototype, 'has').mockImplementation(function (this: Map<unknown, unknown>, key) {
      if (typeof key === 'string' && key.startsWith(prefix)) membershipProbes++;
      return originalHas.call(this, key);
    });
    try {
      active.forEach(markOriginalImageDisplayed);
      markOriginalImageDisplayed(active[0]);
      sources.slice(active.length).forEach(markOriginalImageDisplayed);
      expect(active.map(originalImageDisplayRevision)).toEqual([2, ...Array(1_023).fill(1)]);
      expect(sources.slice(active.length).map(originalImageDisplayRevision)).toEqual(Array(1_024).fill(0));
      expect(notifications).toBe(1_025);
    } finally {
      releases.reverse().forEach((release) => release());
      has.mockRestore();
    }
    expect(active.map(originalImageDisplayRevision)).toEqual([2, ...Array(511).fill(1), ...Array(512).fill(0)]);
    markOriginalImageDisplayed({ uri: `${prefix}next.png` });
    expect(originalImageDisplayRevision(active[1])).toBe(0);
    expect(originalImageDisplayRevision(active[0])).toBe(2);
    expect(membershipProbes).toBeLessThanOrEqual(sources.length * 2);
  });

  it.each([false, true])('keeps a resubscribed callback after repeated cleanup (shared set: %s)', (sharedSet) => {
    const source = { uri: `https://img.example.com/repeated-original-cleanup-${sharedSet}.png` };
    const listener = vi.fn();
    const oldRelease = subscribeOriginalImageDisplay(source, listener);
    const retainOtherListener = sharedSet ? subscribeOriginalImageDisplay(source, () => {}) : () => {};
    markOriginalImageDisplayed(source);
    oldRelease();
    const release = subscribeOriginalImageDisplay(source, listener);
    try {
      oldRelease();
      markOriginalImageDisplayed(source);
      Array.from({ length: 512 }, (_, index) => ({
        uri: `https://img.example.com/repeated-cleanup-pressure-${sharedSet}/${index}.png`
      })).forEach(markOriginalImageDisplayed);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(originalImageDisplayRevision(source)).toBe(2);
    } finally {
      release();
      retainOtherListener();
    }
  });
});
