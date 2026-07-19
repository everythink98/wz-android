import { absoluteUrl, isRecord } from './localHtml';
import { LINUXDO_BASE_URL } from './localLinuxdoHelpers';
import type { ReactionSummary, Reply, TopicDetail } from './types';

export type LinuxDoReactionStat = {
  id: string;
  label: string;
  value: number;
  imageUrl?: string;
};

export type LinuxDoEmojiUrlMap = Record<string, string>;

const STANDARD_REACTION_EMOJIS = new Set([
  '+1',
  'clap',
  'confetti_ball',
  'distorted_face',
  'heart',
  'hugs',
  'laughing',
  'open_mouth'
]);

function visiblePositiveReaction(
  id: string,
  count: number | undefined,
  emojiUrls: LinuxDoEmojiUrlMap,
  useLinuxDoEmojiFallback = true
): LinuxDoReactionStat | null {
  if (typeof count !== 'number' || count <= 0) {
    return null;
  }
  return reactionStat({ id, count }, emojiUrls, useLinuxDoEmojiFallback);
}

function reactionLabel(id: string) {
  return id.replace(/_/g, ' ');
}

function reactionStat(
  reaction: ReactionSummary,
  emojiUrls: LinuxDoEmojiUrlMap,
  useLinuxDoEmojiFallback = true
): LinuxDoReactionStat {
  const imageUrl = useLinuxDoEmojiFallback ? linuxDoEmojiUrlForReaction(reaction.id, emojiUrls) : undefined;
  return {
    id: reaction.id,
    label: reactionLabel(reaction.id),
    value: reaction.count,
    ...(imageUrl ? { imageUrl } : {})
  };
}

function linuxDoEmojiUrlForReaction(id: string, emojiUrls: LinuxDoEmojiUrlMap = {}) {
  const fromCatalog = emojiUrls[id];
  if (fromCatalog) {
    return fromCatalog;
  }
  if (!STANDARD_REACTION_EMOJIS.has(id)) {
    return undefined;
  }
  const pathId = encodeURIComponent(id).replace(/%2B/g, '+');
  return `${LINUXDO_BASE_URL}/images/emoji/twemoji/${pathId}.png`;
}

export function linuxDoReactionStats(
  item: Pick<Reply | TopicDetail, 'boostCount' | 'reactionSummary' | 'likeCount'>,
  emojiUrls: LinuxDoEmojiUrlMap = {}
) {
  const reactions = item.reactionSummary || [];
  const hasHeartReaction = reactions.some((reaction) => reaction.id === 'heart');
  return [
    hasHeartReaction ? null : visiblePositiveReaction('heart', item.likeCount, emojiUrls),
    ...reactions.map((reaction) => reactionStat(reaction, emojiUrls)),
    typeof item.boostCount === 'number' && item.boostCount > 0
      ? { id: 'boost', label: '加电', value: item.boostCount }
      : null
  ].filter((stat): stat is LinuxDoReactionStat => Boolean(stat));
}

export function discourseReactionStats(
  item: Pick<Reply | TopicDetail, 'reactionSummary' | 'likeCount'>
) {
  const reactions = item.reactionSummary || [];
  const hasHeartReaction = reactions.some((reaction) => reaction.id === 'heart');
  return [
    hasHeartReaction ? null : visiblePositiveReaction('heart', item.likeCount, {}, false),
    ...reactions.map((reaction) => reactionStat(reaction, {}, false))
  ].filter((stat): stat is LinuxDoReactionStat => Boolean(stat));
}

export function linuxDoEmojiUrlMapFromData(data: unknown): LinuxDoEmojiUrlMap {
  const urls: LinuxDoEmojiUrlMap = {};
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
      const url = absoluteUrl(emoji.url, LINUXDO_BASE_URL);
      if (name && url) {
        urls[name] = url;
      }
    });
  });
  return urls;
}
