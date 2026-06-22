import type { Screen } from '../appTypes';
import type { TopicSnapshot } from '../appTypes';
import type { OptimisticActionState } from '../topicActionState';
import type { Source, Topic, TopicDetail, TopicPoll } from '../types';

type TopicActionTopic = Topic | TopicDetail;

export const YAOHUO_DEFAULT_CLASS_ID = '177';

export function currentTopicActionTopic(topicDetail: TopicDetail | null, selectedTopic: Topic | null) {
  return topicDetail || selectedTopic;
}

export function isNodeSeekActionTopic(topic: TopicActionTopic | null): topic is TopicActionTopic & { source: 'nodeseek' } {
  return topic?.source === 'nodeseek';
}

export function isYaohuoActionTopic(topic: TopicActionTopic | null): topic is TopicActionTopic & { source: 'yaohuo' } {
  return topic?.source === 'yaohuo';
}

export function isLinuxDoActionTopic(topic: TopicActionTopic | null): topic is TopicActionTopic & { source: 'linuxdo' } {
  return topic?.source === 'linuxdo';
}

export function canSubmitReplyToTopic(topic: TopicActionTopic | null): topic is TopicActionTopic {
  return isActionSource(topic?.source, ['nodeseek', 'linuxdo', 'yaohuo']);
}

export function canVotePollOnTopic(topic: TopicActionTopic | null): topic is TopicActionTopic {
  return isActionSource(topic?.source, ['nodeseek', 'linuxdo', 'yaohuo']);
}

export function topicReplyActionKey(topicKey: string) {
  return `reply:${topicKey}`;
}

export function yaohuoFavoriteActionKey(topicKey: string) {
  return `yaohuo-favorite:${topicKey}`;
}

export function topicPollVoteActionKey(topicKey: string, poll: Pick<TopicPoll, 'id' | 'name' | 'postId'>) {
  return `vote:${topicKey}:${poll.id || poll.name || poll.postId || 'poll'}`;
}

export function nodeSeekAttendanceActionKey() {
  return 'nodeseek:attendance';
}

export function isTopicScopedActionKey(key: string) {
  return key !== nodeSeekAttendanceActionKey();
}

export function shouldInvalidateTopicActionsOnScreenChange(currentScreen: Screen, nextScreen: Screen) {
  return currentScreen === 'topic' && nextScreen !== 'topic';
}

export function hasPendingOptimisticTopicAction(actions: Record<string, OptimisticActionState>) {
  return Object.values(actions).some((action) => action.inFlight);
}

export function topicSnapshotForUserReturn(snapshot: TopicSnapshot, hasPendingOptimisticAction: boolean): TopicSnapshot {
  if (!hasPendingOptimisticAction) {
    return snapshot;
  }
  return {
    ...snapshot,
    selectedTopic: snapshot.selectedTopic || snapshot.topicDetail,
    topicDetail: null,
    topicReplies: [],
    replyHasMore: false,
    replyNextPage: null,
    replyNextOffset: null,
    unreadReplyCount: 0,
    expandedQuotes: {},
    loadedQuotedReplies: {},
    loadingQuotedFloors: {},
    scrollY: 0
  };
}

function isActionSource(source: Source | undefined, supportedSources: Source[]) {
  return Boolean(source && supportedSources.includes(source));
}
