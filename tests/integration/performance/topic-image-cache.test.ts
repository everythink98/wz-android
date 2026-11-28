// @vitest-environment jsdom
import { QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { prepareImagePreviewCatalog, projectImagePreviewCatalog } from '@/platform/media/imagePreviewCatalog';
import { createAppQueryClient } from '@/platform/query/serverState';
import {
  catalogSize,
  imageTopicKey,
  pagesPerTopic,
  prepareImageTopic,
  topicCount
} from '../../../dev/media-pressure-proof/image-cache-workload';

it('retains fifteen distinct compiled topics while warm and drops every inactive query after the client cache interval', async () => {
  vi.useFakeTimers();
  const client = createAppQueryClient();
  let release = () => {};
  try {
    for (let number = 1; number <= topicCount; number++) {
      const samples = {
        animation: `https://example.invalid/${number}/animated.gif`,
        photos: Array.from(
          { length: pagesPerTopic * 2 - 1 },
          (_, index) => `https://example.invalid/${number}/photo-${index}.jpg`
        )
      };
      const key = imageTopicKey(number);
      const topic = await client.fetchQuery({ queryKey: key, queryFn: () => prepareImageTopic(number, samples) });
      const previews = topic.preparedContent.contentPlan.previewImages;
      expect(previews).toHaveLength(catalogSize);
      expect([
        previews[0].source,
        previews.at(-1)?.source,
        ...previews.slice(1, samples.photos.length).map((image) => image.source)
      ]).toEqual([samples.animation, ...samples.photos]);
      const catalog = projectImagePreviewCatalog(prepareImagePreviewCatalog(previews, 320, 3), {
        contentSource: 'nodeseek',
        sessionIdentity: 'fixture'
      });
      expect(catalog.items).toHaveLength(catalogSize);
      expect(catalog.indexForUrl(samples.photos[0])).toBe(catalogSize - 1);
      release();
      release = new QueryObserver(client, { queryKey: key }).subscribe(() => {});
    }
    const cached = () => client.getQueryCache().getAll().length;
    expect(cached()).toBe(topicCount);
    // The observer models staying inside the last topic while the previous details expire.
    await vi.advanceTimersByTimeAsync(300_001);
    expect(cached()).toBe(1);
    expect(client.getQueryData(imageTopicKey(topicCount))).toBeDefined();
    release();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(cached()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(cached()).toBe(0);
  } finally {
    release();
    client.clear();
    vi.useRealTimers();
  }
});
