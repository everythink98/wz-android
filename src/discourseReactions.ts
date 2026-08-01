import { absoluteUrl, isRecord } from './localHtml';
import type { ReactionSummary, Reply, TopicDetail } from './types';

export type DiscourseReactionStat = {
  id: string;
  label: string;
  value: number;
  imageUrl?: string;
};

export type DiscourseEmojiUrlMap = Record<string, string>;

function reactionLabel(id: string) {
  return id.replace(/_/g, ' ');
}

function reactionStat(reaction: ReactionSummary, emojiUrls: DiscourseEmojiUrlMap): DiscourseReactionStat {
  const imageUrl = emojiUrls[reaction.id];
  return {
    id: reaction.id,
    label: reactionLabel(reaction.id),
    value: reaction.count,
    ...(imageUrl ? { imageUrl } : {})
  };
}

export function discourseReactionStats(
  item: Pick<Reply | TopicDetail, 'reactionSummary' | 'likeCount'>,
  emojiUrls: DiscourseEmojiUrlMap = {}
) {
  const reactions = item.reactionSummary || [];
  const hasHeartReaction = reactions.some((reaction) => reaction.id === 'heart');
  const likeCount = item.likeCount;
  return [
    !hasHeartReaction && typeof likeCount === 'number' && likeCount > 0
      ? reactionStat({ id: 'heart', count: likeCount }, emojiUrls)
      : null,
    ...reactions.map((reaction) => reactionStat(reaction, emojiUrls))
  ].filter((stat): stat is DiscourseReactionStat => Boolean(stat));
}

export function discourseEmojiUrlMapFromData(data: unknown, baseUrl: string): DiscourseEmojiUrlMap {
  const urls: DiscourseEmojiUrlMap = {};
  if (!isRecord(data)) {
    return urls;
  }
  Object.values(data).forEach((group) => {
    if (!Array.isArray(group)) {
      return;
    }
    group.forEach((emoji) => {
      if (!isRecord(emoji)) {
        return;
      }
      const name = String(emoji.name || '').trim();
      const url = absoluteUrl(emoji.url, baseUrl);
      if (name && url) {
        urls[name] = url;
      }
    });
  });
  return urls;
}
