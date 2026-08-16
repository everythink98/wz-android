import type { QuotedPostMetadata, Reply, Source, TopicDetail, TopicPoll } from '@/domain/forum/models';
import type { ForumImagePreviewDescriptor } from '@/domain/forum/forumContentMedia';
import { accessRequirementFromNoticeText } from '@/domain/forum/accessRequirements';
import { textContentFromHtml } from '@/domain/forum/html';
import { forumAccessRequirementText } from '@/domain/forum/presentation';
import {
  requirePreparedForumContent,
  type CompiledForumContentSegment,
  type ForumContentIslandRegion,
  type ForumContentIslandSegment,
  type ForumContentSelectableRegion
} from '@/domain/forum/topicContentSplit';
import {
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  topicQuotedPostInstanceKey,
  type QuotedPostReference
} from '@/domain/forum/quotedPosts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { stableTextHash } from './contentIdentity';

type IslandRegionWith<Segment extends ForumContentIslandSegment> = Omit<ForumContentIslandRegion, 'segment'> & {
  segment: Segment;
};

export type TopicRenderableContentRegion =
  ForumContentSelectableRegion | IslandRegionWith<Exclude<ForumContentIslandSegment, { type: 'poll' | 'quote' }>>;

export type TopicContentItem =
  | { type: 'content'; key: string; region: TopicRenderableContentRegion }
  | {
      type: 'quoteSummary';
      key: string;
      instanceKey: string;
      quote: QuotedPostMetadata;
      region: IslandRegionWith<Extract<CompiledForumContentSegment, { type: 'quote' }>>;
    }
  | {
      type: 'poll';
      key: string;
      poll: TopicPoll;
      region: IslandRegionWith<Extract<CompiledForumContentSegment, { type: 'poll' }>>;
    }
  | { type: 'accessNotice'; key: string; label: string; detail: string };

export type AcceptedAnswerPresentation = {
  floor: number;
  instanceKey: string;
  reference: QuotedPostReference;
  reply?: Reply;
};

type TopicOpeningSeed = Pick<
  TopicDetail,
  'accessRequirement' | 'contentHtml' | 'id' | 'polls' | 'preparedContent' | 'source'
>;
type AcceptedAnswerSeed = Pick<TopicDetail, 'acceptedAnswerFloor' | 'id' | 'replies' | 'source'>;

type PlannedTopicContent = {
  contentItems: TopicContentItem[];
  previewImages: readonly ForumImagePreviewDescriptor[];
};

const plannedReplyContentCache = new WeakMap<Reply, Map<string, PlannedTopicContent>>();

function isAccessNotice(topic: TopicOpeningSeed) {
  if (!topic.accessRequirement) return false;
  const text = textContentFromHtml(topic.contentHtml || '');
  return !text || Boolean(accessRequirementFromNoticeText(text));
}

function plannedContentItemsFromCompilation(
  compilation: ReturnType<typeof requirePreparedForumContent>,
  keyPrefix: string,
  topicId?: string
): PlannedTopicContent {
  let quoteIndex = 0;
  return {
    contentItems: compilation.regions.map((region): TopicContentItem => {
      if (region.kind === 'island' && region.segment.type === 'poll') {
        return {
          type: 'poll',
          key: `${keyPrefix}-poll-${region.segment.poll.name || region.segment.poll.id || region.keySuffix}`,
          poll: region.segment.poll,
          region: region as IslandRegionWith<Extract<CompiledForumContentSegment, { type: 'poll' }>>
        };
      }
      if (region.kind === 'island' && region.segment.type === 'quote') {
        const index = quoteIndex++;
        const referenceKey = quotedPostReferenceKey(region.segment.quote.reference);
        return {
          type: 'quoteSummary',
          key: `${keyPrefix}-quote-${index}-${referenceKey}`,
          instanceKey: topicQuotedPostInstanceKey(topicId!, region.segment.quote.reference),
          quote: region.segment.quote,
          region: region as IslandRegionWith<Extract<CompiledForumContentSegment, { type: 'quote' }>>
        };
      }
      return {
        type: 'content',
        key: `${keyPrefix}-${region.keySuffix}`,
        region: region as TopicRenderableContentRegion
      };
    }),
    previewImages: compilation.previewImages
  };
}

function topicContent(topic: TopicOpeningSeed, showsAccessNotice: boolean): PlannedTopicContent {
  if (showsAccessNotice) {
    return {
      contentItems: [
        {
          type: 'accessNotice',
          key: 'topic-access-notice',
          label: forumAccessRequirementText(topic.accessRequirement),
          detail: topic.accessRequirement?.detail || '当前账号暂无权限查看这个帖子'
        }
      ],
      previewImages: []
    };
  }
  return plannedContentItemsFromCompilation(
    requirePreparedForumContent(topic.preparedContent, topic.contentHtml, {
      polls: topic.polls,
      role: 'opening',
      source: topic.source,
      topicId: topic.id
    }),
    'topic',
    topic.id
  );
}

function plannedReplyContentItems(
  reply: Reply,
  source: Source,
  keyPrefix: string,
  role: 'accepted-answer' | 'quoted-reply'
) {
  const cacheKey = `${source}:${keyPrefix}:${role}`;
  const cached = plannedReplyContentCache.get(reply)?.get(cacheKey);
  if (cached) return cached;
  const items = plannedContentItemsFromCompilation(
    requirePreparedForumContent(reply.preparedContent, reply.contentHtml, {
      polls: reply.polls,
      role,
      source
    }),
    keyPrefix
  );
  const replyCache = plannedReplyContentCache.get(reply) || new Map<string, PlannedTopicContent>();
  replyCache.set(cacheKey, items);
  plannedReplyContentCache.set(reply, replyCache);
  return items;
}

export function buildTopicQuotedPostContentItems({
  instanceKey,
  reply,
  source
}: {
  instanceKey: string;
  reply: Reply;
  source: Source;
}) {
  return plannedReplyContentItems(reply, source, `topic-quote-${stableTextHash(instanceKey)}`, 'quoted-reply')
    .contentItems;
}

export function buildAcceptedAnswerContentItems({
  floor,
  reply,
  source
}: {
  floor: number;
  reply: Reply;
  source: Source;
}) {
  const fullItems = plannedReplyContentItems(reply, source, `accepted-answer-${floor}`, 'accepted-answer').contentItems;
  const firstItem = fullItems[0];
  const terminalDefaultTabId =
    firstItem?.type === 'content' &&
    firstItem.region.kind === 'island' &&
    firstItem.region.segment.type === 'terminalReportHeader'
      ? firstItem.region.segment.defaultTabId
      : '';
  const firstTerminalBody = terminalDefaultTabId
    ? fullItems
        .slice(1)
        .find(
          (item) =>
            'region' in item &&
            item.region.kind === 'island' &&
            item.region.segment.ancestorFrames.some(
              (frame) => frame.kind === 'terminalTab' && frame.tabId === terminalDefaultTabId
            )
        )
    : undefined;
  const firstAdditionalPoll = fullItems.slice(1).find((item) => item.type === 'poll');
  return {
    fullItems,
    previewItems: Array.from(
      new Set(
        [firstItem, firstTerminalBody, firstAdditionalPoll].filter((item): item is TopicContentItem => Boolean(item))
      )
    )
  };
}

function acceptedAnswerForTopic(
  topic: AcceptedAnswerSeed,
  sourceReplies: Reply[],
  loadedQuotedReplies: Record<string, Reply>,
  showsAccessNotice: boolean
): AcceptedAnswerPresentation | null {
  if (showsAccessNotice || !isDiscourseSource(topic.source)) return null;
  const flaggedReply =
    sourceReplies.find((reply) => reply.acceptedAnswer) || topic.replies.find((reply) => reply.acceptedAnswer);
  const acceptedFloor = flaggedReply?.floor ?? topic.acceptedAnswerFloor;
  const reference = quotedPostReferenceFromReply(topic.source, topic.id, acceptedFloor);
  if (!reference) return null;
  const referenceKey = quotedPostReferenceKey(reference);
  const candidate =
    (acceptedFloor
      ? sourceReplies.find((reply) => reply.floor === acceptedFloor) ||
        topic.replies.find((reply) => reply.floor === acceptedFloor) ||
        loadedQuotedReplies[referenceKey]
      : undefined) || flaggedReply;
  return {
    floor: reference.postNumber,
    instanceKey: `accepted-answer:${topic.id}:${referenceKey}`,
    reference,
    ...(candidate && !candidate.systemAction && candidate.contentHtml.trim() ? { reply: candidate } : {})
  };
}

export function buildAcceptedAnswerPresentation({
  loadedQuotedReplies,
  showsAccessNotice,
  sourceReplies,
  topic
}: {
  loadedQuotedReplies: Record<string, Reply>;
  showsAccessNotice: boolean;
  sourceReplies: Reply[];
  topic: AcceptedAnswerSeed | null;
}) {
  return topic ? acceptedAnswerForTopic(topic, sourceReplies, loadedQuotedReplies, showsAccessNotice) : null;
}

export function buildTopicOpeningContent(topic: TopicOpeningSeed | null) {
  if (!topic) {
    return {
      contentItems: [] as TopicContentItem[],
      legacyPollsVisible: false,
      polls: [] as TopicPoll[],
      previewImages: [] as readonly ForumImagePreviewDescriptor[],
      showsAccessNotice: false
    };
  }
  const showsAccessNotice = isAccessNotice(topic);
  const polls = topic.polls || [];
  const content = topicContent(topic, showsAccessNotice);
  return {
    contentItems: content.contentItems,
    legacyPollsVisible:
      !isDiscourseSource(topic.source) && topic.source !== 'nodeseek' && !showsAccessNotice && polls.length > 0,
    polls,
    previewImages: content.previewImages,
    showsAccessNotice
  };
}
