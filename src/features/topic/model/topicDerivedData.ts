import type { Reply, Source } from '@/domain/forum/models';
import type { MediaReferrerPolicy } from '@/domain/forum/mediaReferrer';
import { requirePreparedForumContent } from '@/domain/forum/topicContentSplit';

export type InlineSizedImageUrlMap = Record<string, true>;

interface TopicImageDeriverOptions {
  requestIdentityForImage?: (url: string, referrerPolicy?: MediaReferrerPolicy) => string;
}

export interface TopicImageDeriver {
  isInlineSizedImage: (
    url: string,
    referrerPolicy: MediaReferrerPolicy | undefined,
    inlineSizedImageUrls: Readonly<Record<string, boolean | undefined>>
  ) => boolean;
}

export function createTopicImageDeriver(options: TopicImageDeriverOptions = {}): TopicImageDeriver {
  const requestIdentityForImage = options.requestIdentityForImage;

  return {
    isInlineSizedImage: (url, referrerPolicy, inlineSizedImageUrls) =>
      Boolean(
        inlineSizedImageUrls[
          requestIdentityForImage ? requestIdentityForImage(url, referrerPolicy) : normalizeImageIdentityUrl(url)
        ]
      )
  };
}

function normalizeImageIdentityUrl(url: string) {
  return url.trim();
}

export function filterRepliesWithImages(
  replies: Reply[],
  inlineSizedImageUrls: InlineSizedImageUrlMap,
  deriver: TopicImageDeriver,
  source: Source
) {
  return replies.filter((reply) => {
    const content = requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
      polls: reply.polls,
      role: 'reply',
      source
    });
    const signature = requirePreparedForumContent(reply.preparedSignature, reply.signatureHtml, {
      role: 'signature',
      source
    });
    return [...content.previewImages, ...signature.previewImages].some(
      (image) => !deriver.isInlineSizedImage(image.source, image.referrerPolicy, inlineSizedImageUrls)
    );
  });
}
