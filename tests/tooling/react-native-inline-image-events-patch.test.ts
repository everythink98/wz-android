import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('react-native inline media patch', () => {
  it('forwards standard events with the Native request generation that produced them', () => {
    const patch = readFileSync(join(process.cwd(), 'patches', 'react-native+0.81.5.patch'), 'utf8');

    for (const handler of ['onLoadStart', 'onProgress', 'onLoad', 'onError', 'onLoadEnd']) {
      expect(patch).toContain(`${handler}={${handler}}`);
    }
    for (const event of ['topLoadStart', 'topProgress', 'topLoad', 'topError', 'topLoadEnd']) {
      expect(patch).toContain(event);
    }
    expect(patch).toContain('shouldNotifyLoadEvents={');
    expect(patch).toContain('internal_analyticTag={nativeProps.internal_analyticTag}');
    expect(patch).toContain('internal_analyticTag: true');
    expect(patch).toContain('view.setRequestGeneration(analyticTag?.takeIf { it.startsWith("wz-inline-attempt-") })');
    expect(patch).toContain('val requestSource = imageSource.source');
    expect(patch).toContain('val requestGeneration = this.requestGeneration');
    expect(patch).toContain('combinedListener.addListener(requestDownloadListener)');
    expect(patch).toContain('builder.setControllerListener(requestDownloadListener)');
    expect(patch).toContain('hierarchy.setProgressBarImage(requestDownloadListener)');
    expect(patch.match(/\.withRequestGeneration\(requestGeneration\)/g)).toHaveLength(5);
  });

  it('keeps generation-tagged requests out of the standard event coalescing bucket', () => {
    const patch = readFileSync(join(process.cwd(), 'patches', 'react-native+0.81.5.patch'), 'utf8');

    expect(patch).toContain('override fun canCoalesce(): Boolean = requestGeneration == null');
  });

  it('tags draw failures from the request-bound controller listener', () => {
    const patch = readFileSync(join(process.cwd(), 'patches', 'react-native+0.81.5.patch'), 'utf8');

    expect(patch).toContain('object : RequestBoundImageDownloadListener(requestGeneration)');
    expect(patch).toContain('.withRequestGeneration(requestDownloadListener.requestGeneration)');
  });

  it('does not let fixed line height shrink a line that contains an inline view', () => {
    const patch = readFileSync(join(process.cwd(), 'patches', 'react-native+0.81.5.patch'), 'utf8');

    expect(patch).toContain('TextInlineViewPlaceholderSpan::class.java');
    expect(patch).toContain('containsInlineView && currentHeight >= lineHeight');
    expect(patch).toContain('val leading = lineHeight - currentHeight');
  });

  it('keeps inline view attachment geometry independent of system font scale', () => {
    const patch = readFileSync(join(process.cwd(), 'patches', 'react-native+0.81.5.patch'), 'utf8');

    expect(patch).toContain('inlineViewSizeToPixels(fragment.getDouble(FR_KEY_WIDTH))');
    expect(patch).toContain('inlineViewSizeToPixels(fragment.width)');
    expect(patch).toContain('ceil(PixelUtil.toPixelFromDIP(size).toDouble()).toInt()');
    expect(patch).not.toContain('+        val width = PixelUtil.toPixelFromSP');
    expect(patch).not.toContain('+                PixelUtil.toPixelFromSP(fragment.width)');
    expect(patch).toContain('TextLayoutManager.inlineViewSizeToPixels(155.0)).isEqualTo(155)');
    expect(patch).toContain('TextLayoutManager.inlineViewSizeToPixels(132.1)).isEqualTo(133)');
  });
});
