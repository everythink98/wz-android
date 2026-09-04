import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const patch = readFileSync(join(process.cwd(), 'patches', 'react-native+0.86.3.patch'), 'utf8');

describe('react-native inline media patch', () => {
  it('forwards standard events with the Native request generation that produced them', () => {
    expect(patch).toContain('onProgress,');
    expect(patch).toContain('nativeProps.onProgress = onProgress;');
    expect(patch).toContain('nativeProps.shouldNotifyLoadEvents = true;');
    expect(patch).not.toContain('TextInlineImageNativeComponent.js');
    expect(patch).toContain('view.setRequestGeneration(analyticTag?.takeIf { it.startsWith("wz-inline-attempt-") })');
    expect(patch).toContain('val requestSource = imageSource.source');
    expect(patch).toContain('val requestGeneration = this.requestGeneration');
    expect(patch).toContain('combinedListener.addListener(requestDownloadListener)');
    expect(patch).toContain('builder.setControllerListener(requestDownloadListener)');
    expect(patch).toContain('hierarchy.setProgressBarImage(requestDownloadListener)');
    expect(patch.match(/\.withRequestGeneration\(requestGeneration\)/g)).toHaveLength(5);
  });

  it('keeps generation-tagged requests out of the standard event coalescing bucket', () => {
    expect(patch).toContain('override fun canCoalesce(): Boolean = requestGeneration == null');
  });

  it('tags draw failures from the request-bound controller listener', () => {
    expect(patch).toContain('object : RequestBoundImageDownloadListener(requestGeneration)');
    expect(patch).toContain('.withRequestGeneration(requestDownloadListener.requestGeneration)');
  });

  it('does not let fixed line height shrink a line that contains an inline view', () => {
    expect(patch).toContain('TextInlineViewPlaceholderSpan::class.java');
    expect(patch).toContain('containsInlineView && currentHeight >= lineHeight');
    expect(patch).toContain('val leading = lineHeight - currentHeight');
  });

  it('keeps inline view attachment geometry independent of system font scale', () => {
    expect(patch).toContain('inlineViewSizeToPixels(fragment.getDouble(FR_KEY_WIDTH))');
    expect(patch).toContain('inlineViewSizeToPixels(fragment.width)');
    expect(patch).toContain('ceil(PixelUtil.toPixelFromDIP(size).toDouble()).toInt()');
    expect(patch).not.toContain('+        val width = PixelUtil.toPixelFromSP');
    expect(patch).not.toContain('+                PixelUtil.toPixelFromSP(fragment.width)');
    expect(patch).toContain('TextLayoutManager.inlineViewSizeToPixels(155.0)).isEqualTo(155)');
    expect(patch).toContain('TextLayoutManager.inlineViewSizeToPixels(132.1)).isEqualTo(133)');
  });
});
