import { Buffer } from 'buffer';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  cachedCompatibleSvgArtifact,
  recoverCompatibleSvgArtifact,
  refreshCompatibleSvgPoster
} from './compatibleImageSources';
import type { Fetcher } from './request';

const complexSvg = readFileSync('tests/fixtures/complex-svg-document.svg', 'utf8');

function poster(width: number, height: number, uri: string, documentWidth = width, documentHeight = height) {
  return { documentHeight, documentWidth, height, uri, width };
}

describe('compatible remote image sources', () => {
  it('[REG-TOPIC-038] preserves the original complex SVG document while producing a poster artifact', async () => {
    const source = { uri: 'https://images.example.com/report.svg' };
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response(complexSvg, {
          headers: { 'content-type': 'image/svg+xml; charset=utf-8' }
        })
    );
    const renderPoster = vi.fn(async () => poster(640, 360, 'file:///cache/report.png', 320, 180));

    const artifact = await recoverCompatibleSvgArtifact(source, { fetcher, renderPoster });

    expect(artifact).toMatchObject({
      animated: true,
      dimensions: { height: 180, width: 320 },
      posterSource: { height: 360, uri: 'file:///cache/report.png', width: 640 }
    });
    expect(Buffer.from(String(artifact?.documentDataUri).split(',')[1] || '', 'base64').toString('utf8')).toBe(
      complexSvg
    );
    expect(renderPoster).toHaveBeenCalledWith(
      Buffer.from(complexSvg, 'utf8').toString('base64'),
      expect.any(String),
      expect.any(Number)
    );
    expect(cachedCompatibleSvgArtifact(source)).toEqual(artifact);
  });

  it('[REG-TOPIC-038] does not strip link elements or otherwise rewrite accepted SVG bytes', async () => {
    const svg =
      '\uFEFF<svg width="10" height="5"><a href="https://example.com/?value=1&gt;0"><text>linked</text></a></svg>\n';
    const artifact = await recoverCompatibleSvgArtifact(
      { uri: 'https://images.example.com/linked.svg' },
      {
        fetcher: async () => new Response(Buffer.from(svg, 'utf8'), { headers: { 'content-type': 'image/svg+xml' } }),
        renderPoster: async () => poster(10, 5, 'file:///cache/linked.png')
      }
    );

    expect(Buffer.from(String(artifact?.documentDataUri).split(',')[1] || '', 'base64')).toEqual(
      Buffer.from(svg, 'utf8')
    );
  });

  it('[REG-TOPIC-038] single-flights poster rendering and reuses the cached artifact with managed request headers intact', async () => {
    const source = {
      headers: {
        'X-WZ-Forum-Media-Source': 'nodeseek',
        Referer: 'https://www.nodeseek.com/'
      },
      uri: 'https://images.example.com/cache.svg'
    };
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response('<svg width="10" height="5"></svg>', {
          headers: { 'content-type': 'image/svg+xml' }
        })
    );
    const renderPoster = vi.fn(async () => poster(10, 5, 'file:///cache/cache.png'));

    const [first, concurrent] = await Promise.all([
      recoverCompatibleSvgArtifact(source, { fetcher, renderPoster }),
      recoverCompatibleSvgArtifact(source, { fetcher, renderPoster })
    ]);
    const cached = await recoverCompatibleSvgArtifact(source, { fetcher, renderPoster });

    expect(concurrent).toBe(first);
    expect(cached).toBe(first);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(renderPoster).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      source.uri,
      expect.objectContaining({
        headers: expect.objectContaining({
          ...source.headers,
          Accept: 'image/svg+xml,image/*,*/*;q=0.8'
        }),
        signal: expect.any(AbortSignal)
      })
    );
  });

  it('[REG-TOPIC-038] rebuilds an evicted poster from the preserved SVG without another network request', async () => {
    const source = { uri: 'https://images.example.com/evicted-poster.svg' };
    const fetcher = vi.fn<Fetcher>(
      async () =>
        new Response(complexSvg, {
          headers: { 'content-type': 'image/svg+xml' }
        })
    );
    const renderPoster = vi
      .fn()
      .mockResolvedValueOnce(poster(320, 180, 'file:///cache/evicted.png'))
      .mockResolvedValueOnce(poster(320, 180, 'file:///cache/evicted.png'));
    const original = await recoverCompatibleSvgArtifact(source, { fetcher, renderPoster });
    expect(original).not.toBeNull();

    const [first, concurrent] = await Promise.all([
      refreshCompatibleSvgPoster(original!, { renderPoster }),
      refreshCompatibleSvgPoster(original!, { renderPoster })
    ]);

    expect(concurrent).toBe(first);
    expect(first.documentDataUri).toBe(original?.documentDataUri);
    expect(first.posterRevision).toBeGreaterThan(original?.posterRevision || 0);
    expect((first.posterSource as ImageURISourceWithCacheKey).cacheKey).not.toBe(
      (original?.posterSource as ImageURISourceWithCacheKey).cacheKey
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(renderPoster).toHaveBeenCalledTimes(2);
    expect(cachedCompatibleSvgArtifact(source)).toBe(first);
  });

  it.each([
    ['SMIL animate', '<svg><animate attributeName="opacity" from="0" to="1" /></svg>'],
    ['SMIL animateTransform', '<svg><animateTransform attributeName="transform" type="rotate" /></svg>'],
    ['SMIL animateMotion', '<svg><animateMotion path="M0,0 L1,1" /></svg>'],
    ['SMIL set', '<svg><set attributeName="opacity" to="1" begin="1s" /></svg>'],
    ['inline CSS animation', '<svg><rect style="animation: reveal 1s linear" /></svg>'],
    [
      'CSS animation property',
      '<svg><style>@keyframes reveal { from { opacity: 0 } to { opacity: 1 } }.panel { animation-name: reveal; }</style></svg>'
    ]
  ])('detects %s as an animated SVG', async (_label, svg) => {
    const source = { uri: `https://images.example.com/animated-${encodeURIComponent(_label)}.svg` };
    const artifact = await recoverCompatibleSvgArtifact(source, {
      fetcher: async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }),
      renderPoster: async () => poster(1, 1, 'file:///cache/animated.png')
    });

    expect(artifact?.animated).toBe(true);
  });

  it.each([
    ['plain markup', '<svg><rect width="1" height="1" /></svg>'],
    ['disabled animation', '<svg><rect style="animation: none" /></svg>'],
    ['disabled shorthand animation', '<svg><rect style="animation: 1s none" /></svg>'],
    ['duration-only animation', '<svg><rect style="animation: 0s" /></svg>'],
    ['disabled animation-name list', '<svg><style>.x { animation-name: none, none }</style></svg>'],
    [
      'global animation-name resets',
      '<svg><style>.x { animation-name: initial }.y { animation-name: unset }</style></svg>'
    ],
    ['unused keyframes', '<svg><style>@keyframes reveal { from { opacity: 0 } to { opacity: 1 } }</style></svg>'],
    [
      'commented animation',
      '<svg><!-- <animate attributeName="opacity" /> --><style>/* .x { animation: reveal 1s } */</style></svg>'
    ]
  ])('keeps %s marked as a static SVG', async (label, svg) => {
    const source = { uri: `https://images.example.com/static-${encodeURIComponent(label)}.svg` };
    const artifact = await recoverCompatibleSvgArtifact(source, {
      fetcher: async () =>
        new Response(svg, {
          headers: { 'content-type': 'image/svg+xml' }
        }),
      renderPoster: async () => poster(1, 1, 'file:///cache/static.png')
    });

    expect(artifact?.animated).toBe(false);
  });

  it('uses poster dimensions only when the SVG has no intrinsic dimensions', async () => {
    const artifact = await recoverCompatibleSvgArtifact(
      { uri: 'https://images.example.com/no-dimensions.svg' },
      {
        fetcher: async () =>
          new Response('<svg><rect width="10" height="5" /></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          }),
        renderPoster: async () => poster(90, 45, 'file:///cache/no-dimensions.png')
      }
    );

    expect(artifact?.dimensions).toEqual({ height: 45, width: 90 });
    expect(artifact?.posterSource).toMatchObject({ height: 45, uri: 'file:///cache/no-dimensions.png', width: 90 });
  });

  it('derives a missing intrinsic dimension from the SVG viewBox aspect ratio', async () => {
    const artifact = await recoverCompatibleSvgArtifact(
      { uri: 'https://images.example.com/one-dimension.svg' },
      {
        fetcher: async () =>
          new Response('<svg width="100" viewBox="0 0 200 100"></svg>', {
            headers: { 'content-type': 'image/svg+xml' }
          }),
        renderPoster: async () => poster(999, 999, 'file:///cache/one-dimension.png', 100, 50)
      }
    );

    expect(artifact?.dimensions).toEqual({ height: 50, width: 100 });
  });

  it('[REG-TOPIC-038] ignores SVG-shaped comments before the real document root', async () => {
    const svg = '<!-- <svg viewBox="0 0 1 100"> --><svg viewBox="0 0 2 1"></svg>';
    const artifact = await recoverCompatibleSvgArtifact(
      { uri: 'https://images.example.com/root-comment.svg' },
      {
        fetcher: async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }),
        renderPoster: async () => poster(500, 500, 'file:///cache/root-comment.png', 2, 1)
      }
    );

    expect(artifact?.dimensions).toEqual({ height: 1, width: 2 });
  });

  it('[REG-TOPIC-038] uses the native validated document dimensions instead of decoding raw attributes twice', async () => {
    const svg = '<svg width="100" height="&#50;00" viewBox="0 0 1 1"></svg>';
    const artifact = await recoverCompatibleSvgArtifact(
      { uri: 'https://images.example.com/entity-dimensions.svg' },
      {
        fetcher: async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }),
        renderPoster: async () => poster(100, 200, 'file:///cache/entity-dimensions.png', 100, 200)
      }
    );

    expect(artifact?.dimensions).toEqual({ height: 200, width: 100 });
  });

  it('rejects a non-SVG response without invoking the poster renderer', async () => {
    const source = { uri: 'https://images.example.com/not-svg.png' };
    const renderPoster = vi.fn(async () => poster(1, 1, 'file:///cache/not-svg.png'));

    await expect(
      recoverCompatibleSvgArtifact(source, {
        fetcher: async () => new Response('<svg></svg>', { headers: { 'content-type': 'image/png' } }),
        renderPoster
      })
    ).resolves.toBeNull();

    expect(renderPoster).not.toHaveBeenCalled();
    expect(cachedCompatibleSvgArtifact(source)).toBeNull();
  });

  it('[REG-PERF-009] keeps render-safe reads pure while recovery promotes the 32-entry LRU', async () => {
    const renderPoster = async (_svgBase64: string, cacheKey: string) => poster(1, 1, `file:///cache/${cacheKey}.png`);
    const recover = (uri: string) =>
      recoverCompatibleSvgArtifact(
        { uri },
        {
          fetcher: async () => new Response('<svg></svg>', { headers: { 'content-type': 'image/svg+xml' } }),
          renderPoster
        }
      );
    for (let index = 0; index < 40; index += 1) {
      await recover(`https://images.example.com/lru-warmup-${index}.svg`);
    }
    const anchor = { uri: 'https://images.example.com/lru-anchor.svg' };
    await recover(anchor.uri);
    for (let index = 0; index < 31; index += 1) {
      await recover(`https://images.example.com/lru-filler-${index}.svg`);
    }
    expect(cachedCompatibleSvgArtifact(anchor)).not.toBeNull();

    await recover('https://images.example.com/lru-overflow.svg');

    expect(cachedCompatibleSvgArtifact(anchor)).toBeNull();
    expect(cachedCompatibleSvgArtifact({ uri: 'https://images.example.com/lru-filler-0.svg' })).not.toBeNull();

    const promotedAnchor = { uri: 'https://images.example.com/lru-promoted-anchor.svg' };
    await recover(promotedAnchor.uri);
    for (let index = 0; index < 31; index += 1) {
      await recover(`https://images.example.com/lru-promoted-filler-${index}.svg`);
    }
    await recover(promotedAnchor.uri);
    await recover('https://images.example.com/lru-promoted-overflow.svg');

    expect(cachedCompatibleSvgArtifact(promotedAnchor)).not.toBeNull();
    expect(cachedCompatibleSvgArtifact({ uri: 'https://images.example.com/lru-promoted-filler-0.svg' })).toBeNull();
  });

  it('[REG-TOPIC-038] bounds the complete recovery pipeline before downloads or base64 poster payloads accumulate', async () => {
    let activeFetches = 0;
    let maxActiveFetches = 0;
    const gate = new Promise<void>((resolve) => setTimeout(resolve, 25));
    const fetcher = vi.fn<Fetcher>(async () => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await gate;
      activeFetches -= 1;
      return new Response('<svg width="1" height="1"></svg>', {
        headers: { 'content-type': 'image/svg+xml' }
      });
    });
    const recoveries = Array.from({ length: 32 }, (_, index) =>
      recoverCompatibleSvgArtifact(
        {
          uri: `https://images.example.com/bounded-${index}.svg`
        },
        {
          fetcher,
          renderPoster: async () => poster(1, 1, `file:///cache/bounded-${index}.png`)
        }
      )
    );
    const overflow = recoverCompatibleSvgArtifact(
      { uri: 'https://images.example.com/bounded-overflow.svg' },
      {
        fetcher,
        renderPoster: async () => poster(1, 1, 'file:///cache/bounded-overflow.png')
      }
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );

    const [artifacts, overflowResult] = await Promise.all([Promise.all(recoveries), overflow]);

    expect(artifacts.every(Boolean)).toBe(true);
    expect(maxActiveFetches).toBeLessThanOrEqual(2);
    expect(overflowResult).toEqual({ error: expect.objectContaining({ message: 'SVG 兼容队列已满' }) });
    expect(fetcher).toHaveBeenCalledTimes(32);
  });

  it('[REG-TOPIC-038] gives a late download only the recovery deadline that remains', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const posterResolvers: ((value: ReturnType<typeof poster>) => void)[] = [];
    const recoveries: Promise<unknown>[] = [];
    let renderCalls = 0;
    let lateFetchStartedAt = -1;
    let settleLateFetch: ((response: Response) => void) | undefined;
    const renderPoster = vi.fn(() => {
      renderCalls += 1;
      if (renderCalls <= 2) {
        return new Promise<ReturnType<typeof poster>>((resolve) => posterResolvers.push(resolve));
      }
      return Promise.resolve(poster(1, 1, 'file:///cache/unexpected-late-poster.png'));
    });
    const fetcher = vi.fn<Fetcher>(async (input, init) => {
      if (String(input).includes('late-download')) {
        lateFetchStartedAt = Date.now();
        return await new Promise<Response>((resolve, reject) => {
          settleLateFetch = resolve;
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      }
      return new Response('<svg width="1" height="1"></svg>', {
        headers: { 'content-type': 'image/svg+xml' }
      });
    });

    try {
      const first = recoverCompatibleSvgArtifact(
        { uri: 'https://images.example.com/deadline-first.svg' },
        {
          fetcher,
          renderPoster
        }
      );
      const second = recoverCompatibleSvgArtifact(
        { uri: 'https://images.example.com/deadline-second.svg' },
        {
          fetcher,
          renderPoster
        }
      );
      const late = recoverCompatibleSvgArtifact(
        { uri: 'https://images.example.com/late-download.svg' },
        {
          fetcher,
          renderPoster
        }
      );
      recoveries.push(first, second, late);
      const lateOutcome = late.then(
        (value) => ({ value }),
        (error: unknown) => ({ error })
      );
      for (let attempt = 0; attempt < 20 && posterResolvers.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(posterResolvers).toHaveLength(2);

      now.mockReturnValue(29_990);
      posterResolvers[0](poster(1, 1, 'file:///cache/deadline-first.png'));
      await first;
      for (let attempt = 0; attempt < 20 && lateFetchStartedAt < 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      expect(lateFetchStartedAt).toBe(29_990);
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        lateOutcome,
        new Promise<{ watchdog: true }>((resolve) => {
          watchdog = setTimeout(() => resolve({ watchdog: true }), 200);
        })
      ]);
      if (watchdog) {
        clearTimeout(watchdog);
      }
      expect(outcome).toEqual({
        error: expect.objectContaining({ message: '请求超时，请稍后重试' })
      });

      posterResolvers[1](poster(1, 1, 'file:///cache/deadline-second.png'));
      await second;
    } finally {
      posterResolvers.forEach((resolve, index) => {
        resolve(poster(1, 1, `file:///cache/deadline-cleanup-${index}.png`));
      });
      for (let attempt = 0; attempt < 20 && !settleLateFetch; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      settleLateFetch?.(new Response('', { headers: { 'content-type': 'text/plain' } }));
      await Promise.allSettled(recoveries);
      now.mockRestore();
    }
  });

  it('[REG-TOPIC-038] refreshes an existing poster without shrinking a full artifact LRU', async () => {
    const recover = (uri: string) =>
      recoverCompatibleSvgArtifact(
        { uri },
        {
          fetcher: async () => new Response('<svg></svg>', { headers: { 'content-type': 'image/svg+xml' } }),
          renderPoster: async () => poster(1, 1, `file:///cache/${encodeURIComponent(uri)}.png`)
        }
      );
    for (let index = 0; index < 40; index += 1) {
      await recover(`https://images.example.com/refresh-warmup-${index}.svg`);
    }
    const oldest = { uri: 'https://images.example.com/refresh-oldest.svg' };
    const current = { uri: 'https://images.example.com/refresh-current.svg' };
    await recover(oldest.uri);
    for (let index = 0; index < 30; index += 1) {
      await recover(`https://images.example.com/refresh-filler-${index}.svg`);
    }
    const artifact = await recover(current.uri);

    await refreshCompatibleSvgPoster(artifact!, {
      renderPoster: async () => poster(1, 1, 'file:///cache/refreshed.png')
    });

    expect(cachedCompatibleSvgArtifact(oldest)).not.toBeNull();
  });

  it.each([
    [
      'advertised content length',
      new Response('', {
        headers: {
          'content-length': String(1024 * 1024 + 1),
          'content-type': 'image/svg+xml'
        }
      })
    ],
    [
      'actual response bytes',
      new Response(`<svg>${'x'.repeat(1024 * 1024)}</svg>`, {
        headers: { 'content-type': 'image/svg+xml' }
      })
    ]
  ])('rejects an SVG over the 1 MiB limit by %s', async (label, response) => {
    const source = { uri: `https://images.example.com/oversize-${encodeURIComponent(label)}.svg` };
    const renderPoster = vi.fn(async () => poster(1, 1, 'file:///cache/oversize.png'));

    await expect(
      recoverCompatibleSvgArtifact(source, {
        fetcher: async () => response.clone(),
        renderPoster
      })
    ).resolves.toBeNull();

    expect(renderPoster).not.toHaveBeenCalled();
    expect(cachedCompatibleSvgArtifact(source)).toBeNull();
  });

  it('[REG-TOPIC-034] accepts an exact 1 MiB SVG without rewriting or rescanning its body', async () => {
    const svg = complexSvg.replace('</svg>', `${' '.repeat(1024 * 1024 - Buffer.byteLength(complexSvg))}</svg>`);
    const renderPoster = vi.fn(async () => poster(1, 1, 'file:///cache/max.svg.png'));

    const artifact = await recoverCompatibleSvgArtifact(
      { uri: 'https://images.example.com/max.svg' },
      {
        fetcher: async () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } }),
        renderPoster
      }
    );

    expect(Buffer.byteLength(svg)).toBe(1024 * 1024);
    expect(Buffer.from(String(artifact?.documentDataUri).split(',')[1] || '', 'base64').toString()).toBe(svg);
    expect(renderPoster).toHaveBeenCalledTimes(1);
  });

  it('[REG-TOPIC-034] rejects an oversized Blob before copying it into a JS ArrayBuffer', async () => {
    const close = vi.fn();
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const response = {
      blob: vi.fn(async () => ({ arrayBuffer, close, size: 1024 * 1024 + 1 })),
      headers: new Headers({ 'content-type': 'image/svg+xml' }),
      ok: true
    } as unknown as Response;

    await expect(
      recoverCompatibleSvgArtifact(
        { uri: 'https://images.example.com/oversize-blob.svg' },
        {
          fetcher: async () => response,
          renderPoster: vi.fn()
        }
      )
    ).resolves.toBeNull();

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

type ImageURISourceWithCacheKey = { cacheKey?: string };
