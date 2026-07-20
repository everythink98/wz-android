import { Buffer } from 'buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  cachedCompatibleImageSource,
  recoverCompatibleSvgImageSource,
  svgIntrinsicDimensions,
  stripSvgLinkElements
} from './compatibleImageSources';
import type { Fetcher } from './request';

describe('compatible remote image sources', () => {
  it('REG-TOPIC-018 removes SVG link wrappers without truncating quoted greater-than signs or linked text', () => {
    const svg = '<svg><text><a href="https://example.com/?label=1>0"><tspan>report</tspan></a></text></svg>';

    expect(stripSvgLinkElements(svg)).toBe('<svg><text><tspan>report</tspan></text></svg>');
    expect(svgIntrinsicDimensions('<svg width="920" height="1025.33" viewBox="0 0 920 1025.33"></svg>')).toEqual({
      height: 1025.33,
      width: 920
    });
    expect(svgIntrinsicDimensions('<svg width="100%" height="100%" viewBox="0 0 920 1025.33"></svg>')).toEqual({
      height: 1025.33,
      width: 920
    });
  });

  it('REG-TOPIC-018 recovers and reuses an SVG returned by a png URL after native decoding fails', async () => {
    const source = {
      headers: { Referer: 'https://forum.example.com', Cookie: 'session=test-only' },
      uri: 'https://images.example.com/dynamic-report.png'
    };
    const fetcher = vi.fn<Fetcher>(async () => new Response(
      '<svg xmlns="http://www.w3.org/2000/svg"><text><a href="https://example.com"><tspan>report</tspan></a></text></svg>',
      { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } }
    ));

    const recovered = await recoverCompatibleSvgImageSource(source, fetcher);
    const reused = await recoverCompatibleSvgImageSource(source, fetcher);

    expect(recovered).toEqual(reused);
    expect(cachedCompatibleImageSource(source)).toEqual(recovered);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(source.uri, expect.objectContaining({
      headers: expect.objectContaining({
        Accept: 'image/svg+xml,image/*,*/*;q=0.8',
        Cookie: 'session=test-only',
        Referer: 'https://forum.example.com'
      }),
      signal: expect.any(AbortSignal)
    }));
    const encoded = String(recovered?.uri || '').split(',')[1] || '';
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><text><tspan>report</tspan></text></svg>'
    );
  });

  it('does not replace a failed bitmap with non-SVG response bytes', async () => {
    const source = { uri: 'https://images.example.com/not-svg.png' };
    const fetcher = vi.fn<Fetcher>(async () => new Response('png-bytes', {
      headers: { 'content-type': 'image/png' }
    }));

    await expect(recoverCompatibleSvgImageSource(source, fetcher)).resolves.toBeNull();
    expect(cachedCompatibleImageSource(source)).toBeNull();
  });
});
