import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Topic, TopicDetail, TopicLocationTarget, ReadingAnchor } from '@/domain/forum/models';
import type { ReaderCommand } from '@/domain/reader/readerRecordState';
import { readingResumeAnchor } from '@/domain/forum/discourseReading';
import type { ReadGateway } from '@/sources/readGateway';

export interface TopicEntryVisit {
  key: string;
  started: boolean;
  settled: boolean;
  cached: boolean;
}

export function useTopicReadingEntry({
  active,
  topic,
  detail,
  location,
  visitRef,
  gateway,
  commit
}: {
  active: boolean;
  topic: Topic;
  detail: TopicDetail | null;
  location?: TopicLocationTarget;
  visitRef: RefObject<TopicEntryVisit>;
  gateway: ReadGateway;
  commit: (command: ReaderCommand) => void;
}) {
  const visit = visitRef.current;
  const { reading, getTopicReading } = gateway;
  const ordinaryTopic = topic.source === 'linuxdo' && !topic.isPrivateMessage && !detail?.isPrivateMessage;
  const enabled = ordinaryTopic && Boolean(reading);
  const recorded = useRef('');
  const [registration, setRegistration] = useState('');
  const visitSettled = visit.settled;
  const hasDetail = Boolean(detail);
  const [decision, setDecision] = useState<{
    key: string;
    ready: boolean;
    positioned: boolean;
    windowReady: boolean;
    anchor?: ReadingAnchor;
    location?: TopicLocationTarget;
    baseline?: number;
    highest?: number;
  }>({ key: visit.key, ready: !enabled, positioned: !enabled, windowReady: !enabled });

  useLayoutEffect(() => {
    if (!active || !ordinaryTopic || recorded.current === `${topic.source}:${topic.id}`) return;
    recorded.current = `${topic.source}:${topic.id}`;
    commit({ type: 'visit', topic, at: new Date().toISOString() });
  }, [active, commit, ordinaryTopic, topic]);

  useEffect(() => {
    if (!active || !enabled || (!visit.cached && !hasDetail) || visit.started) return;
    // Another consumer may have supplied the in-flight Query without registering this entry.
    visit.cached = true;
    visit.started = true;
    const controller = new AbortController();
    void getTopicReading(topic.id, { signal: controller.signal, trackVisit: true })
      .catch(() => undefined)
      .finally(() => {
        visit.settled = true;
        if (!controller.signal.aborted) setRegistration(visit.key);
      });
    return () => controller.abort();
  }, [active, hasDetail, enabled, getTopicReading, topic.id, visit]);

  useEffect(() => {
    if (!active || !enabled || (decision.key === visit.key && decision.ready)) return;
    const choose = () => {
      const current = reading?.state()[topic.id];
      const anchor = location ? undefined : readingResumeAnchor(current);
      const target: TopicLocationTarget | undefined = anchor
        ? anchor.floor <= 1
          ? { kind: 'opening' }
          : { kind: 'reply', target: { floor: anchor.floor, readingResume: true } }
        : undefined;
      setDecision({
        key: visit.key,
        ready: true,
        positioned: !anchor && location?.kind !== 'reply',
        windowReady: !anchor || anchor.floor <= 1,
        anchor,
        location: target,
        baseline: current?.highestKnown || undefined,
        highest: current?.server.highestPostNumber
      });
    };
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
    decision.ready,
    detail,
    enabled,
    reading,
    location,
    registration,
    topic.id,
    visit,
    visitSettled
  ]);

  const positioned = useCallback(
    () => setDecision((current) => (current.positioned ? current : { ...current, positioned: true })),
    []
  );
  const windowLoaded = useCallback(
    () => setDecision((current) => (current.windowReady ? current : { ...current, windowReady: true })),
    []
  );
  const failed = useCallback(
    () =>
      setDecision((current) => ({
        ...current,
        ready: true,
        positioned: true,
        windowReady: true,
        anchor: undefined,
        location: undefined
      })),
    []
  );
  return {
    ready: !enabled || (decision.key === visit.key && decision.ready),
    positionReady: !enabled || (decision.key === visit.key && decision.positioned),
    windowReady: !enabled || (decision.key === visit.key && decision.windowReady),
    anchor: !enabled || location ? undefined : decision.anchor,
    location: location || (enabled ? decision.location : undefined),
    baseline: decision.baseline,
    highest: decision.highest,
    positioned,
    windowLoaded,
    failed
  };
}
