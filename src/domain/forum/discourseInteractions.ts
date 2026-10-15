import { findClusterBreak } from '@codemirror/state';
import type { Reply } from './models';

export type DiscourseInteractionPatch = Partial<
  Pick<Reply, 'currentUserReaction' | 'reactionSummary' | 'likeCount' | 'liked' | 'canLike' | 'siteExtension'>
>;

export function discourseReactionPreview(
  post: Pick<Reply, 'currentUserReaction' | 'reactionSummary' | 'liked'>,
  reactionId: string,
  reactionForLike: string
): DiscourseInteractionPatch {
  const previousId =
    post.currentUserReaction?.id ?? (post.currentUserReaction === undefined && post.liked ? reactionForLike : null);
  const nextId = previousId === reactionId ? null : reactionId;
  const counts = new Map((post.reactionSummary || []).map(({ id, count }) => [id, count]));
  if (previousId) counts.set(previousId, Math.max(0, (counts.get(previousId) || 0) - 1));
  if (nextId) counts.set(nextId, (counts.get(nextId) || 0) + 1);
  return {
    currentUserReaction: nextId ? { id: nextId, canUndo: true } : null,
    reactionSummary: [...counts].flatMap(([id, count]) => (count > 0 ? [{ id, count }] : [])),
    liked: nextId === reactionForLike
  };
}

export type DiscourseInteractionConfig = {
  reactionsEnabled: boolean;
  enabledReactions: string[];
  reactionForLike: string;
  boostsEnabled: boolean;
  maxBoostsPerPost: number;
};

export function discourseBoostStats(content: string, emojiNames: readonly string[]) {
  const names = new Set(emojiNames);
  let emojiCount = 0;
  const text = content.trim().replace(/:([a-z0-9_+-]+)(?::t\d)?:/g, (shortcode, name: string) => {
    if (!names.has(name)) return shortcode;
    emojiCount += 1;
    return '\uFFFC';
  });
  let length = 0;
  for (let start = 0; start < text.length; length += 1) {
    const end = findClusterBreak(text, start);
    const cluster = text.slice(start, end);
    if (/[\p{Extended_Pictographic}\p{Regional_Indicator}]|[0-9#*]\uFE0F?\u20E3/u.test(cluster)) emojiCount += 1;
    start = end;
  }
  return { length, emojiCount, valid: length > 0 && length <= 16 && emojiCount <= 5 && content.length <= 1000 };
}
