export const PREVIEW_BITMAP_MAX_EDGE = 2_048;
export const PREVIEW_BITMAP_MAX_PIXELS = PREVIEW_BITMAP_MAX_EDGE * PREVIEW_BITMAP_MAX_EDGE;

export type PreviewBitmapDecodeTarget = {
  height: number;
  scale: 1;
  width: number;
};

export function previewBitmapDecodeTarget(
  viewport: { height: number; width: number },
  pixelRatio: number
): PreviewBitmapDecodeTarget {
  const density = positiveFinite(pixelRatio);
  const rawWidth = positiveFinite(viewport.width) * density;
  const rawHeight = positiveFinite(viewport.height) * density;
  const scale = Math.min(
    1,
    PREVIEW_BITMAP_MAX_EDGE / rawWidth,
    PREVIEW_BITMAP_MAX_EDGE / rawHeight,
    Math.sqrt(PREVIEW_BITMAP_MAX_PIXELS / (rawWidth * rawHeight))
  );

  return {
    height: Math.max(1, Math.floor(rawHeight * scale)),
    scale: 1,
    width: Math.max(1, Math.floor(rawWidth * scale))
  };
}

export function withPreviewBitmapDecodeTarget<T extends object>(
  source: T,
  target: PreviewBitmapDecodeTarget
): T & PreviewBitmapDecodeTarget {
  return { ...source, ...target };
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
