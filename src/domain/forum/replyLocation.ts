import type { Reply, ReplyLocationTarget } from './models';

export function matchesReplyLocation(reply: Reply, target: ReplyLocationTarget) {
  if (
    target.expectedAuthorUsername !== undefined &&
    (!target.expectedAuthorUsername.trim() ||
      (reply.authorId || reply.author).toLowerCase() !== target.expectedAuthorUsername.trim().toLowerCase())
  )
    return false;
  if (target.commentId !== undefined) return reply.commentId === target.commentId;
  return target.floor !== undefined && reply.floor === target.floor;
}

export function findReplyLocation(replies: readonly Reply[], target: ReplyLocationTarget) {
  let found: Reply | undefined;
  const identity = { ...target, expectedAuthorUsername: undefined };
  for (const reply of replies) {
    if (!matchesReplyLocation(reply, identity)) continue;
    if (
      found ||
      reply.replyLocationConflict === 'identity' ||
      (target.commentId === undefined && reply.replyLocationConflict === 'floor')
    )
      return undefined;
    found = reply;
  }
  return found && matchesReplyLocation(found, target) ? found : undefined;
}
