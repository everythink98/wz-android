import { useCallback, useEffect, useLayoutEffect, useRef, useState, useReducer } from 'react';
import type { Topic, TopicDetail, TopicLocationTarget, ReadingAnchor } from '@/domain/forum/models';
import type { ReaderCommand } from '@/domain/reader/readerRecordState';
import { readingResumeAnchor, type DiscourseReadingState } from '@/domain/forum/discourseReading';
import type { ReadGateway } from '@/sources/readGateway';

import type { TopicEntryVisit } from './model/topicEntryVisit';

type EntryChoice =
  | { phase: 'waiting' }
  | {
      phase: 'ready';
      anchor?: ReadingAnchor;
      location?: TopicLocationTarget;
      baseline?: number;
      highest?: number;
    };
type EntryDecision = {
  key: string;
  choice: EntryChoice;
  position: 'pending' | 'confirmed';
  window: 'pending' | 'confirmed';
};
type EntryDecisionEvent =
  { type: 'enter'; value: EntryDecision } | { type: 'positioned' } | { type: 'window-loaded' } | { type: 'failed' };

function chooseEntry(
  key: string,
  current: DiscourseReadingState[string] | undefined,
  location?: TopicLocationTarget,
  cachedFloor = false
): EntryDecision {
  const anchor = location ? undefined : readingResumeAnchor(current);
  const target: TopicLocationTarget | undefined = anchor
    ? anchor.floor <= 1
      ? { kind: 'opening' }
      : { kind: 'reply', target: { floor: anchor.floor, readingResume: true } }
    : undefined;
  return {
    key,
    choice: {
      phase: 'ready',
      anchor,
      location: target,
      baseline: current?.highestKnown || undefined,
      highest: current?.server.highestPostNumber
    },
    position: !anchor && location?.kind !== 'reply' ? 'confirmed' : 'pending',
    window: !anchor || anchor.floor <= 1 || cachedFloor ? 'confirmed' : 'pending'
  };
}

function entryDecision(state: EntryDecision, event: EntryDecisionEvent): EntryDecision {
  switch (event.type) {
    case 'enter':
      return event.value.key === state.key && state.choice.phase === 'ready' ? state : event.value;
    case 'positioned':
      return state.position === 'confirmed' ? state : { ...state, position: 'confirmed' };
    case 'window-loaded':
      return state.window === 'confirmed' ? state : { ...state, window: 'confirmed' };
    case 'failed':
      return {
        ...state,
        position: 'confirmed',
        window: 'confirmed',
        choice: {
          phase: 'ready',
          baseline: state.choice.phase === 'ready' ? state.choice.baseline : undefined,
          highest: state.choice.phase === 'ready' ? state.choice.highest : undefined
        }
      };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function useTopicReadingEntry({
  active,
  focused,
  topic,
  detail,
  location,
  hasCachedFloor,
  visit,
  gateway,
  commit
}: {
  active: boolean;
  focused: boolean;
  topic: Topic;
  detail: TopicDetail | null;
  location?: TopicLocationTarget;
  hasCachedFloor: (floor: number) => boolean;
  visit: TopicEntryVisit;
  gateway: ReadGateway;
  commit: (command: ReaderCommand) => void;
}) {
  const { reading, getTopicReading } = gateway;
  const ordinaryTopic = topic.source === 'linuxdo' && !topic.isPrivateMessage && !detail?.isPrivateMessage;
  const enabled = ordinaryTopic && reading !== undefined;
  const recorded = useRef('');
  const [registration, setRegistration] = useState('');
  const visitSettled = visit.settled;
  const canRegister = visit.cached || Boolean(detail);
  function initialEntry(): EntryDecision {
    if (!enabled) return chooseEntry(visit.key, undefined);
    const current = reading.state()[topic.id];
    if (location || !reading.scope()) return chooseEntry(visit.key, current, location);
    if (
      visit.cached &&
      detail &&
      current?.anchor &&
      (current.anchor.floor <= 1 || hasCachedFloor(current.anchor.floor))
    )
      return chooseEntry(visit.key, current, undefined, true);
    return { key: visit.key, choice: { phase: 'waiting' }, position: 'pending', window: 'pending' };
  }
  const [decision, dispatch] = useReducer(entryDecision, undefined, initialEntry);
  if (decision.key !== visit.key) dispatch({ type: 'enter', value: initialEntry() });
  const choice = decision.choice.phase === 'ready' ? decision.choice : undefined;

  useLayoutEffect(() => {
    if (!active || !ordinaryTopic || recorded.current === `${topic.source}:${topic.id}`) return;
    recorded.current = `${topic.source}:${topic.id}`;
    commit({ type: 'visit', topic, at: new Date().toISOString() });
  }, [active, commit, ordinaryTopic, topic]);

  useEffect(() => {
    if (!focused || !enabled || !canRegister) return;
    // Another consumer may have supplied the in-flight Query without registering this entry.
    const controller = new AbortController();
    if (!visit.claimCachedRegistration(controller.signal)) return;
    void getTopicReading(topic.id, { signal: controller.signal, trackVisit: true })
      .catch(() => undefined)
      .finally(() => {
        if (controller.signal.aborted) return;
        visit.settleRequest(controller.signal);
        setRegistration(visit.key);
      });
    return () => controller.abort();
  }, [focused, canRegister, enabled, getTopicReading, topic.id, visit]);

  useEffect(() => {
    if (!active || !enabled || (decision.key === visit.key && decision.choice.phase === 'ready')) return;
    const choose = () =>
      dispatch({ type: 'enter', value: chooseEntry(visit.key, reading?.state()[topic.id], location) });
    if (location || visit.settled || (!visit.cached && detail)) {
      choose();
      return;
    }
    if (visit.cached) {
      const timer = setTimeout(choose, 1000);
      return () => clearTimeout(timer);
    }
  }, [
    active,
    decision.key,
    decision.choice.phase,
    detail,
    enabled,
    reading,
    location,
    registration,
    topic.id,
    visit,
    visitSettled
  ]);

  const positioned = useCallback(() => dispatch({ type: 'positioned' }), []);
  const windowLoaded = useCallback(() => dispatch({ type: 'window-loaded' }), []);
  const failed = useCallback(() => dispatch({ type: 'failed' }), []);
  return {
    ready: !enabled || (decision.key === visit.key && decision.choice.phase === 'ready'),
    positionReady: !enabled || (decision.key === visit.key && decision.position === 'confirmed'),
    windowReady: !enabled || (decision.key === visit.key && decision.window === 'confirmed'),
    anchor: !enabled || location ? undefined : choice?.anchor,
    location: location || (enabled ? choice?.location : undefined),
    baseline: choice?.baseline,
    highest: choice?.highest,
    positioned,
    windowLoaded,
    failed
  };
}
