import type { Reply, Source } from '@/domain/forum/models';
import { requirePreparedForumContent } from '@/domain/forum/topicContentSplit';

export function filterRepliesWithImages(replies: Reply[], source: Source) {
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
    return content.previewImages.length + signature.previewImages.length > 0;
  });
}
