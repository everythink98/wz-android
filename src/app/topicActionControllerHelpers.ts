import type { Source, Topic, TopicDetail } from '../types';

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

function isActionSource(source: Source | undefined, supportedSources: Source[]) {
  return Boolean(source && supportedSources.includes(source));
}
