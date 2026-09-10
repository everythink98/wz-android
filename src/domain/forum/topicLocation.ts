import type { ReplyLocationTarget, Source, TopicDetail, TopicLocationTarget } from './models';
import { matchesReplyLocation } from './replyLocation';
import { isDiscourseSource } from './sourceCatalog';

export function topicLocationForReply(
  source: Source,
  target: ReplyLocationTarget,
  topic?: TopicDetail | null
): TopicLocationTarget {
  const hasCommentId = target.commentId !== undefined;
  const validIdentity = hasCommentId
    ? Number.isSafeInteger(target.commentId) && target.commentId! > 0
    : Number.isSafeInteger(target.floor) && target.floor! > 0;
  const openingIdentity =
    validIdentity &&
    (hasCommentId
      ? Boolean(topic && target.commentId === topic.commentId)
      : isDiscourseSource(source) && target.floor === 1);
  const authorMatches =
    target.expectedAuthorUsername === undefined ||
    Boolean(
      topic &&
      matchesReplyLocation(
        {
          author: topic.author,
          authorId: topic.authorId,
          commentId: topic.commentId,
          floor: isDiscourseSource(source) ? 1 : undefined,
          contentHtml: '',
          createdAt: ''
        },
        target
      )
    );
  return openingIdentity && authorMatches ? { kind: 'opening' } : { kind: 'reply', target };
}

export function resolveTopicLocation(topic: TopicDetail | null, location: TopicLocationTarget | undefined) {
  return topic && location?.kind === 'reply' ? topicLocationForReply(topic.source, location.target, topic) : location;
}
