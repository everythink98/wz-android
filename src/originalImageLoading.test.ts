import { describe, expect, it, vi } from 'vitest';
import type { ImageURISource } from 'react-native';
import {
  markOriginalImageDisplayed,
  originalImageDisplayRevision,
  subscribeOriginalImageDisplay
} from './originalImageLoading';

describe('original image progressive loading', () => {
  it('[REG-TOPIC-048] isolates displayed originals by the complete media request identity', () => {
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

  it('[REG-PERF-007] notifies only listeners for the displayed media identity', () => {
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

  it('[REG-PERF-007][REG-PERF-009] keeps snapshot reads pure and promotes committed subscriptions', () => {
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

  it('[REG-PERF-007] retains active revision listeners until they unsubscribe', () => {
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
});
