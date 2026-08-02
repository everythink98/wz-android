import type { Reply, TopicDetail, TopicPoll } from '@/domain/forum/models';
import { accessRequirementFromNoticeText } from '@/domain/forum/accessRequirements';
import { textContentFromHtml } from '@/domain/forum/html';
import { forumAccessRequirementText } from '@/domain/forum/presentation';
import { forumVideoBlockFromHtml, splitTopicContentHtml } from '@/domain/forum/topicContentSplit';
import {
  quotedPostReferenceFromReply,
  quotedPostReferenceKey,
  type QuotedPostReference
} from '@/domain/forum/quotedPosts';
import { isDiscourseSource } from '@/domain/forum/sourceCatalog';
import { splitDiscourseContentHtml } from '@/sources/discourse/content';
import { stableTextHash } from './contentIdentity';

export type TopicContentItem =
  | { type: 'content'; key: string; html: string }
  | { type: 'contentVideo'; key: string; src: string }
  | { type: 'poll'; key: string; poll: TopicPoll }
  | { type: 'accessNotice'; key: string; label: string; detail: string };

export type AcceptedAnswerPresentation = {
  floor: number;
  instanceKey: string;
  reference: QuotedPostReference;
  reply?: Reply;
};

type TopicOpeningSeed = Pick<TopicDetail, 'accessRequirement' | 'contentHtml' | 'polls' | 'source'>;
type AcceptedAnswerSeed = Pick<TopicDetail, 'acceptedAnswerFloor' | 'id' | 'replies' | 'source'>;

function isAccessNotice(topic: TopicOpeningSeed) {
  if (!topic.accessRequirement) return false;
  const text = textContentFromHtml(topic.contentHtml || '');
  return !text || Boolean(accessRequirementFromNoticeText(text));
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
  const parts = isDiscourseSource(topic.source)
    ? splitDiscourseContentHtml(topic.contentHtml || '', topic.polls || [])
    : [{ type: 'html' as const, html: topic.contentHtml || '' }];
  return parts.flatMap((part, partIndex): TopicContentItem[] => {
    if (part.type === 'poll') {
      return [
        {
          type: 'poll',
          key: `topic-poll-${part.poll.name || part.poll.id || partIndex}`,
          poll: part.poll
        }
      ];
    }
    return splitTopicContentHtml(part.html).map((html, index) => {
      const video = forumVideoBlockFromHtml(html);
      return video
        ? {
            type: 'contentVideo',
            key: `topic-video-${partIndex}-${index}-${stableTextHash(video.src)}`,
            src: video.src
          }
        : {
            type: 'content',
            key: `topic-content-${partIndex}-${index}-${stableTextHash(html)}`,
            html
          };
    });
  });
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
