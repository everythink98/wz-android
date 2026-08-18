import { describe, expect, it } from 'vitest';
import {
  PREVIEW_BITMAP_MAX_EDGE,
  PREVIEW_BITMAP_MAX_PIXELS,
  previewBitmapDecodeTarget,
  previewMaxScale,
  withPreviewBitmapDecodeTarget
} from './previewBitmapBudget';

describe('preview bitmap budget', () => {
  it('[REG-TOPIC-075] caps a high-density phone viewport before native image decode', () => {
    expect(previewBitmapDecodeTarget({ height: 867, width: 411 }, 2.625)).toEqual({
      height: 2_048,
      scale: 1,
      width: 970
    });
  });

  it.each([
    { height: Number.NaN, pixelRatio: 2, width: 411 },
    { height: Number.POSITIVE_INFINITY, pixelRatio: 2, width: 411 },
    { height: 867, pixelRatio: Number.NaN, width: 0 },
    { height: -867, pixelRatio: Number.NEGATIVE_INFINITY, width: -411 },
    { height: 0, pixelRatio: 0, width: Number.POSITIVE_INFINITY }
  ])('[REG-TOPIC-075] bounds invalid viewport input %#', ({ height, pixelRatio, width }) => {
    const target = previewBitmapDecodeTarget({ height, width }, pixelRatio);

    expect(Number.isFinite(target.height)).toBe(true);
    expect(Number.isFinite(target.width)).toBe(true);
    expect(target.height).toBeGreaterThanOrEqual(1);
    expect(target.width).toBeGreaterThanOrEqual(1);
    expect(target.height).toBeLessThanOrEqual(PREVIEW_BITMAP_MAX_EDGE);
    expect(target.width).toBeLessThanOrEqual(PREVIEW_BITMAP_MAX_EDGE);
    expect(target.height * target.width).toBeLessThanOrEqual(PREVIEW_BITMAP_MAX_PIXELS);
  });

  it('[REG-TOPIC-075] preserves request identity while adding the native decode target', () => {
    const source = {
      cacheKey: 'nodeseek:4:https://cdn.example.com/original.webp',
      headers: { Referer: 'https://www.nodeseek.com/' },
      uri: 'https://cdn.example.com/original.webp'
    };

    expect(withPreviewBitmapDecodeTarget(source, { height: 1_920, scale: 1, width: 1_080 })).toEqual({
      ...source,
      height: 1_920,
      scale: 1,
      width: 1_080
    });
  });

  it('[REG-TOPIC-112] reaches original 1:1 pixels without the old fixed 8x ceiling', () => {
    expect(previewMaxScale({ height: 10_000, width: 1_080 }, { height: 800, width: 400 }, 1)).toBeCloseTo(12.5);
    expect(previewMaxScale({ height: 10_000, width: 1_080 }, { height: 800, width: 400 }, 2)).toBeCloseTo(6.25);
  });

  it('[REG-TOPIC-112] falls back safely when 1:1 scale inputs are invalid', () => {
    expect(previewMaxScale(null, { height: 800, width: 400 }, 2)).toBe(6);
    expect(previewMaxScale({ height: Number.NaN, width: 1_080 }, { height: 800, width: 400 }, 2)).toBe(6);
    expect(previewMaxScale({ height: 10_000, width: 1_080 }, { height: 0, width: 400 }, 2)).toBe(6);
  });
});
