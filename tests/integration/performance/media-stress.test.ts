import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { sourceCatalog, sourceValues } from '@/domain/forum/sourceCatalog';
import { prepareSanitizedForumContent } from '@/domain/forum/topicContentSplit';
import { cachedCompatibleSvgArtifact, recoverCompatibleSvgArtifact } from '@/platform/media/compatibleImageSources';
import { cachedImageDisplayDimensions, rememberImageDisplayDimensions } from '@/platform/media/imageDisplayDimensions';
import {
  markOriginalImageDisplayed,
  originalImageDisplayRevision,
  subscribeOriginalImageDisplay
} from '@/platform/media/originalImageLoading';
import { previewBitmapDecodeTarget, PREVIEW_BITMAP_MAX_PIXELS } from '@/platform/media/previewBitmapBudget';
import type { Fetcher } from '@/platform/network/request';

// Node timings measure JS preparation/coordination, not Android decode, frames, GPU or PSS.
async function sample<T>(name: string, run: () => T | Promise<T>): Promise<T> {
  const durations: number[] = [];
  let result!: T;
  for (let index = 0; index < 9; index += 1) {
    const started = performance.now();
    result = await run();
    if (index >= 2) durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  console.info(
    JSON.stringify({
      benchmark: name,
      node: process.version,
      warmup: 2,
      samples: durations.length,
      medianMs: Number(durations[Math.floor(durations.length / 2)].toFixed(2)),
      p95Ms: Number(durations[Math.ceil(durations.length * 0.95) - 1].toFixed(2))
    })
  );
  return result;
}

function ownerText(plan: ReturnType<typeof prepareSanitizedForumContent>['contentPlan']) {
  return plan.rows
    .flatMap((row) => (JSON.parse(row.selectionToken) as { owners: { text: string }[] }).owners)
    .map((owner) => owner.text)
    .join('\n');
}

function normalizedWhitespace(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><path d="M0 0h16v8z"/></svg>';
const svgResponse = () => new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
const renderPoster = async (_base64: string, key: string) => ({
  documentHeight: 8,
  documentWidth: 16,
  height: 8,
  width: 16,
  uri: `file:///mock-cache/${key}.png`
});

describe('media preparation and lifecycle under synthetic pressure', () => {
  it.each(sourceValues)(
    'preserves ordered text and 1000 image previews for %s across content roles',
    async (source) => {
      const paragraphs = Array.from(
        { length: 1_000 },
        (_, index) => `paragraph-${index}: ${'中文 👩‍💻 text '.repeat(16)}`
      );
      for (const count of [100, 1_000]) {
        const urls = paragraphs.slice(0, count).map((_, index) => `https://media.invalid/${source}/${index}.webp`);
        const html = urls.map((url, index) => `<p>${paragraphs[index]}</p><img src="${url}">`).join('');
        const compile = (role: 'opening' | 'reply' | 'quoted-reply' | 'accepted-answer' | 'signature') =>
          prepareSanitizedForumContent(html, { baseUrl: sourceCatalog[source].baseUrl, role, source }).contentPlan;
        const opening = await sample(`html-images:${source}:${count}:${Buffer.byteLength(html)}bytes`, () =>
          compile('opening')
        );
        for (const plan of [
          opening,
          ...(count === 1_000 ? (['reply', 'quoted-reply', 'accepted-answer', 'signature'] as const).map(compile) : [])
        ]) {
          expect(plan.previewImages.map((image) => image.source)).toEqual(urls);
          expect(plan.rows.every((row) => row.networkMediaCount <= 4)).toBe(true);
          expect(plan.rows.reduce((total, row) => total + row.networkMediaCount, 0)).toBe(count);
          expect(normalizedWhitespace(ownerText(plan))).toBe(
            normalizedWhitespace(paragraphs.slice(0, count).join('\n'))
          );
          expect(new Set(plan.rows.map((row) => row.keySuffix)).size).toBe(plan.rows.length);
        }
      }
    },
    60_000
  );

  it.each([
    ['paragraphs', 2_000],
    ['paragraphs', 5_000],
    ['code', 1_000],
    ['tables', 200]
  ] as const)(
    'preserves selection content under %s pressure (%i)',
    async (kind, count) => {
      const sections = Array.from({ length: count }, (_, index) => {
        const body = '中文 👩‍💻 0123456789 '.repeat(16);
        const text = `section-${index}: ${body}`;
        if (kind === 'code') return { html: `<pre><code>${text}</code></pre>`, text };
        if (kind === 'tables') {
          const rows = Array.from({ length: 10 }, (_, row) => [`row-${index}-${row}`, body, 'end']);
          return {
            html: `<table><caption>section-${index}</caption>${rows
              .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
              .join('')}</table>`,
            text: [`section-${index}`, ...rows.flat()].join('\n')
          };
        }
        return { html: `<p>${text}</p>`, text };
      });
      const html = sections.map((section) => section.html).join('');
      const plan = await sample(
        `html-${kind}:${count}:${Buffer.byteLength(html)}bytes`,
        () =>
          prepareSanitizedForumContent(html, {
            baseUrl: sourceCatalog.nodeseek.baseUrl,
            role: 'opening',
            source: 'nodeseek'
          }).contentPlan
      );
      const text = ownerText(plan);
      expect(normalizedWhitespace(text)).toBe(normalizedWhitespace(sections.map((section) => section.text).join('\n')));
      expect(plan.previewImages).toHaveLength(0);
      expect(plan.rows.every((row) => row.networkMediaCount === 0)).toBe(true);
      if (kind === 'code') expect(plan.rows.filter((row) => row.type === 'codeBlock')).toHaveLength(count);
      console.info(
        JSON.stringify({ document: kind, sections: count, rows: plan.rows.length, selectionChars: text.length })
      );
    },
    60_000
  );

  it('bounds 1000 simultaneous SVG recoveries and recovers after every consumer cancels', async () => {
    let round = 0;
    await sample('svg-overload-cancel:1000', async () => {
      const identity = round++;
      const controllers = Array.from({ length: 1_000 }, () => new AbortController());
      let active = 0;
      let highWater = 0;
      let requests = 0;
      const fetcher: Fetcher = (_url, init) =>
        new Promise((_resolve, reject) => {
          requests += 1;
          active += 1;
          highWater = Math.max(highWater, active);
          const abort = () => {
            active -= 1;
            reject(new DOMException('synthetic cancel', 'AbortError'));
          };
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        });
      const work = controllers.map((controller, index) =>
        recoverCompatibleSvgArtifact(
          { uri: `https://media.invalid/burst-${identity}-${index}.svg` },
          { fetcher, renderPoster, signal: controller.signal }
        )
      );
      const settlement = Promise.allSettled(work);
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(active).toBe(2);
      } finally {
        controllers.forEach((controller) => controller.abort());
      }
      const results = await settlement;
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(968);
      expect(results.filter((result) => result.status === 'fulfilled' && result.value === null)).toHaveLength(32);
      expect(
        results.every(
          (result) => result.status === 'fulfilled' || (result.reason as Error).message === 'SVG 兼容队列已满'
        )
      ).toBe(true);
      expect(active).toBe(0);
      expect(requests).toBe(2);
      expect(highWater).toBe(2);
      const recovered = await recoverCompatibleSvgArtifact(
        { uri: `https://media.invalid/after-cancel-${identity}.svg` },
        { fetcher: async () => svgResponse(), renderPoster }
      );
      expect(recovered?.dimensions).toEqual({ height: 8, width: 16 });
    });
  }, 30_000);

  it('reuses one SVG request across 1000 consumers and keeps the last 32 artifacts through cache churn', async () => {
    let round = 0;
    await sample('svg-shared-and-cache-churn:1000-consumers:96-artifacts', async () => {
      const prefix = `https://media.invalid/cache-${round++}`;
      let requests = 0;
      const fetcher: Fetcher = async () => {
        requests += 1;
        return svgResponse();
      };
      const shared = await Promise.all(
        Array.from({ length: 1_000 }, () =>
          recoverCompatibleSvgArtifact({ uri: `${prefix}/shared.svg` }, { fetcher, renderPoster })
        )
      );
      expect(requests).toBe(1);
      expect(shared[0]).not.toBeNull();
      expect(shared.every((artifact) => artifact === shared[0])).toBe(true);
      const sources = Array.from({ length: 96 }, (_, index) => ({ uri: `${prefix}/${index}.svg` }));
      for (const source of sources) await recoverCompatibleSvgArtifact(source, { fetcher, renderPoster });
      expect(requests).toBe(97);
      expect(cachedCompatibleSvgArtifact({ uri: `${prefix}/shared.svg` })).toBeNull();
      expect(sources.map(cachedCompatibleSvgArtifact).filter(Boolean)).toHaveLength(32);
      expect(sources.slice(0, 64).every((source) => cachedCompatibleSvgArtifact(source) === null)).toBe(true);
      expect(sources.slice(64).every((source) => cachedCompatibleSvgArtifact(source) !== null)).toBe(true);
    });
  }, 30_000);

  it.each([8, 3_000])(
    'releases %i original-image subscriptions after repeated 10000-image churn',
    async (activeCount) => {
      let round = 0;
      await sample(`image-metadata:10000:active-subscriptions:${activeCount}`, () => {
        const prefix = `https://media.invalid/metadata-${round++}`;
        const sources = Array.from({ length: 10_000 }, (_, index) => ({ uri: `${prefix}/${index}.webp` }));
        let notifications = 0;
        const releases = sources
          .slice(0, activeCount)
          .map((source) => subscribeOriginalImageDisplay(source, () => notifications++));
        try {
          let maximumPixels = 0;
          for (const [index, source] of sources.entries()) {
            markOriginalImageDisplayed(source);
            rememberImageDisplayDimensions(source.uri, { height: 10_000 + index, width: 1_080 });
            const target = previewBitmapDecodeTarget({ height: 10_000 + index, width: 1_080 }, 4);
            maximumPixels = Math.max(maximumPixels, target.width * target.height);
          }
          expect(maximumPixels).toBeLessThanOrEqual(PREVIEW_BITMAP_MAX_PIXELS);
          expect(notifications).toBe(activeCount);
          expect(sources.slice(0, activeCount).every((source) => originalImageDisplayRevision(source) === 1)).toBe(
            true
          );
          expect(sources.map((source) => cachedImageDisplayDimensions(source.uri)).filter(Boolean)).toHaveLength(2_048);
        } finally {
          releases.forEach((release) => release());
        }
        expect(sources.filter((source) => originalImageDisplayRevision(source) > 0)).toHaveLength(512);
        sources.slice(-512).forEach(markOriginalImageDisplayed);
        expect(notifications).toBe(activeCount);
        expect(sources.slice(0, activeCount).every((source) => originalImageDisplayRevision(source) === 0)).toBe(true);
      });
    },
    60_000
  );
});
