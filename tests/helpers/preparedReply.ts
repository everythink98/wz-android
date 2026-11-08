import type { Reply, Source } from '@/domain/forum/models';
import { prepareForumContentHtml } from '@/domain/forum/topicContentSplit';

export function preparedReply<T extends Reply>(reply: T, source: Source): T {
  const signatureHtml = String(reply.signatureHtml || '');
  reply.preparedContent = prepareForumContentHtml(reply.contentHtml, {
    polls: reply.polls,
    role: 'reply',
    source
  });
  reply.preparedSignature = signatureHtml.trim()
    ? prepareForumContentHtml(signatureHtml, { role: 'signature', source })
    : undefined;
  return reply;
}
