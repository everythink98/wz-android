import { describe, expect, it } from 'vitest';
import type { ImageURISource } from 'react-native';
import {
  isOriginalImageUpgradeNearViewport,
  markOriginalImageDisplayed,
  originalImageDisplayRevision
} from './originalImageLoading';

describe('original image progressive loading', () => {
  it('[REG-TOPIC-048] gates upgrades to the viewport and its preload distance', () => {
    const viewport = { height: 600, offsetY: 1_000 };

    expect(isOriginalImageUpgradeNearViewport({ height: 100, y: 180 }, viewport, 720)).toBe(true);
    expect(isOriginalImageUpgradeNearViewport({ height: 100, y: 179 }, viewport, 720)).toBe(false);
    expect(isOriginalImageUpgradeNearViewport({ height: 100, y: 2_320 }, viewport, 720)).toBe(true);
    expect(isOriginalImageUpgradeNearViewport({ height: 100, y: 2_321 }, viewport, 720)).toBe(false);
  });

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
});
