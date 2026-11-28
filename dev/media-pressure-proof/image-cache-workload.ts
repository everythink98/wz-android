import { prepareTopicContent } from '@/domain/forum/topicContentSplit';
import { forumQueryKeys } from '@/platform/query/serverState';
import { initialForumSessionEpochs } from '@/platform/query/sessionEpochs';

export const topicCount = 15;
export const catalogSize = 256;
export const pagesPerTopic = 4;
export type TopicImageSamples = { animation: string; photos: readonly string[] };

export function imageTopicKey(number: number) {
  return forumQueryKeys.topic({ source: 'nodeseek', topicId: String(number), scope: initialForumSessionEpochs });
}

export function prepareImageTopic(number: number, { animation, photos }: TopicImageSamples) {
  if (photos.length !== pagesPerTopic * 2 - 1) throw new Error('Expected seven different photographs');
  const image = (src: string) => `<p><img src="${src}" width="384" height="216"></p>`;
  const html = Array.from({ length: catalogSize }, (_, index) => {
    if (index === 0) return image(animation);
    if (index === catalogSize - 1) return image(photos[0]);
    if (index < photos.length) return image(photos[index]);
    // The eight browsed images are local. The rest reproduce distinct compiled media identities.
    return image(`https://example.invalid/${number}/${index}.jpg`);
  }).join('');
  return prepareTopicContent({
    author: 'fixture',
    id: String(number),
    source: 'nodeseek',
    title: `Image workload ${number}`,
    url: `https://example.invalid/topic/${number}`,
    contentHtml: html,
    createdAt: '2026-01-01T00:00:00Z',
    replies: [],
    replyCount: 0
  });
}
