import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('react-native inline image events patch', () => {
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
});
