import type { QuotedPostMetadata, Reply, Source, TopicDetail, TopicPoll } from '@/domain/forum/models';
import { accessRequirementFromNoticeText } from '@/domain/forum/accessRequirements';
import { textContentFromHtml } from '@/domain/forum/html';
import { forumAccessRequirementText } from '@/domain/forum/presentation';
import {
  compileForumContent,
  type ForumContentCompileRole,
  type ForumContentRendering
} from '@/domain/forum/topicContentSplit';
import {
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  topicQuotedPostInstanceKey,
  type QuotedPostReference
} from '@/domain/forum/quotedPosts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { stableTextHash } from './contentIdentity';

export type TopicContentItem =
  | {
      type: 'content';
      key: string;
      html: string;
      rendering?: ForumContentRendering;
      groupKey: string;
      continuation: 'only' | 'first' | 'middle' | 'last';
      networkMediaCount: number;
    }
  | {
      type: 'contentVideo';
      key: string;
      src: string;
      groupKey: string;
      continuation: 'only' | 'first' | 'middle' | 'last';
      networkMediaCount: number;
      rendering?: ForumContentRendering;
    }
  | {
      type: 'quoteSummary';
      key: string;
      instanceKey: string;
      quote: QuotedPostMetadata;
    }
  | { type: 'poll'; key: string; poll: TopicPoll }
  | { type: 'accessNotice'; key: string; label: string; detail: string };

export type AcceptedAnswerPresentation = {
  floor: number;
  instanceKey: string;
  reference: QuotedPostReference;
  reply?: Reply;
};

type TopicOpeningSeed = Pick<TopicDetail, 'accessRequirement' | 'contentHtml' | 'id' | 'polls' | 'source'>;
type AcceptedAnswerSeed = Pick<TopicDetail, 'acceptedAnswerFloor' | 'id' | 'replies' | 'source'>;

const plannedReplyContentCache = new WeakMap<Reply, Map<string, TopicContentItem[]>>();

function isAccessNotice(topic: TopicOpeningSeed) {
  if (!topic.accessRequirement) return false;
  const text = textContentFromHtml(topic.contentHtml || '');
  return !text || Boolean(accessRequirementFromNoticeText(text));
}

function plannedContentItems({
  html,
  keyPrefix,
  polls,
  role,
  source,
  topicId
}: {
  html: string;
  keyPrefix: string;
  polls?: TopicPoll[];
  role: ForumContentCompileRole;
  source: Source;
  topicId?: string;
}): TopicContentItem[] {
  let quoteIndex = 0;
  return compileForumContent({ html, polls, role, source, topicId }).rows.map((row): TopicContentItem => {
    if (row.type === 'poll') {
      return {
        type: 'poll',
        key: `${keyPrefix}-poll-${row.poll.name || row.poll.id || row.keySuffix}`,
        poll: row.poll
      };
    }
    if (row.type === 'quote') {
      const index = quoteIndex++;
      const referenceKey = quotedPostReferenceKey(row.quote.reference);
      return {
        type: 'quoteSummary',
        key: `${keyPrefix}-quote-${index}-${referenceKey}`,
        instanceKey: topicQuotedPostInstanceKey(topicId!, row.quote.reference),
        quote: row.quote
      };
    }
    if (row.type === 'video') {
      return {
        type: 'contentVideo',
        key: `${keyPrefix}-video-${row.keySuffix}-${stableTextHash(row.src)}`,
        continuation: row.continuation,
        groupKey: row.groupKey,
        networkMediaCount: row.networkMediaCount,
        rendering: row.rendering,
        src: row.src
      };
    }
    return {
      type: 'content',
      key: `${keyPrefix}-content-${row.keySuffix}-${stableTextHash(row.html)}`,
      continuation: row.continuation,
      groupKey: row.groupKey,
      html: row.html,
      rendering: row.rendering,
      networkMediaCount: row.networkMediaCount
    };
  });
}

function topicContentItems(topic: TopicOpeningSeed, showsAccessNotice: boolean): TopicContentItem[] {
  if (showsAccessNotice) {
    return [
      {
        type: 'accessNotice',
        key: 'topic-access-notice',
        label: forumAccessRequirementText(topic.accessRequirement),
        detail: topic.accessRequirement?.detail || '当前账号暂无权限查看这个帖子'
      }
    ];
  }
  return plannedContentItems({
    html: topic.contentHtml || '',
    keyPrefix: 'topic',
    polls: topic.polls,
    role: 'opening',
    source: topic.source,
    topicId: topic.id
  });
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
  const items = plannedContentItems({
    html: reply.contentHtml,
    keyPrefix,
    polls: reply.polls,
    role,
    source
  });
  const replyCache = plannedReplyContentCache.get(reply) || new Map<string, TopicContentItem[]>();
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
  return plannedReplyContentItems(reply, source, `topic-quote-${stableTextHash(instanceKey)}`, 'quoted-reply');
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
  const fullItems = plannedReplyContentItems(reply, source, `accepted-answer-${floor}`, 'accepted-answer');
  const firstItem = fullItems[0];
  const firstAdditionalPoll = fullItems.slice(1).find((item) => item.type === 'poll');
  return {
    fullItems,
    previewItems: [firstItem, firstAdditionalPoll].filter((item): item is TopicContentItem => Boolean(item))
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
      showsAccessNotice: false
    };
  }
  const showsAccessNotice = isAccessNotice(topic);
  const polls = topic.polls || [];
  return {
    contentItems: topicContentItems(topic, showsAccessNotice),
    legacyPollsVisible:
      !isDiscourseSource(topic.source) && topic.source !== 'nodeseek' && !showsAccessNotice && polls.length > 0,
    polls,
    showsAccessNotice
  };
}

export function buildTopicOpeningPresentation({
  loadedQuotedReplies,
  sourceReplies,
  topic
}: {
  loadedQuotedReplies: Record<string, Reply>;
  sourceReplies: Reply[];
  topic: TopicDetail | null;
}) {
  const content = buildTopicOpeningContent(topic);
  return {
    ...content,
    acceptedAnswer: buildAcceptedAnswerPresentation({
      loadedQuotedReplies,
      showsAccessNotice: content.showsAccessNotice,
      sourceReplies,
      topic
    })
  };
}
