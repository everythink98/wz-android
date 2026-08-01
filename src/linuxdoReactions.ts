import { discourseReactionStats, type DiscourseEmojiUrlMap, type DiscourseReactionStat } from '@/discourseReactions';
import type { Reply, TopicDetail } from '@/domain/forum/models';

export function linuxDoReactionStats(
  item: Pick<Reply | TopicDetail, 'siteExtension' | 'reactionSummary' | 'likeCount'>,
  emojiUrls: DiscourseEmojiUrlMap = {}
) {
  const boostCount = item.siteExtension?.source === 'linuxdo' ? item.siteExtension.boostCount : undefined;
  return [
    ...discourseReactionStats(item, emojiUrls),
    typeof boostCount === 'number' && boostCount > 0 ? { id: 'boost', label: '加电', value: boostCount } : null
  ].filter((stat): stat is DiscourseReactionStat => Boolean(stat));
}
