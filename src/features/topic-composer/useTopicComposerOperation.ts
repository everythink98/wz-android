import { useCallback, useRef, useState } from 'react';
import type { CreateTopicResult, TopicEditResult, TopicSubmissionAttempt } from '@/domain/forum/topicComposer';
import type { RequestDispatchState } from '@/platform/network/request';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type Progress<Result> =
  | { phase: 'preflight' }
  | { phase: 'prepared' | 'claimed'; attempt: TopicSubmissionAttempt }
  | { phase: 'received'; attempt: TopicSubmissionAttempt; result: Result };
type Admission =
  | { kind: 'idle' }
  | { kind: 'travel'; owner: object; command: 'switch' | 'leave' | 'acknowledge' | 'discard' }
  | { kind: 'submitting'; owner: object; mode: 'create' | 'edit' };

function createSubmissionRun<Result>() {
  let progress: Progress<Result> = { phase: 'preflight' };
  const dispatchState: RequestDispatchState = { mayHaveSent: false };
  return {
    dispatchState,
    get attempt() {
      return progress.phase === 'preflight' ? undefined : progress.attempt;
    },
    get result() {
      return progress.phase === 'received' ? progress.result : undefined;
    },
    prepare(attempt: TopicSubmissionAttempt) {
      progress = { phase: 'prepared', attempt };
    },
    claim(attempt: TopicSubmissionAttempt) {
      progress = { phase: 'claimed', attempt };
    },
    received(result: Result) {
      if (progress.phase === 'preflight') throw new Error('尚未创建发布记录');
      progress = { phase: 'received', attempt: progress.attempt, result };
    }
  };
}

export function useTopicComposerOperation(isMounted: () => boolean) {
  const mountedRef = useCommittedRef(isMounted);
  const current = useRef<Admission>({ kind: 'idle' });
  const [snapshot, setSnapshot] = useState(current.current);
  const publish = useCallback(
    (next: Admission) => {
      current.current = next;
      if (mountedRef.current()) setSnapshot(next);
    },
    [mountedRef]
  );
  const isIdle = useCallback(() => current.current.kind === 'idle', []);
  const isSubmitting = useCallback(() => current.current.kind === 'submitting', []);
  const travel = useCallback(
    (command: Extract<Admission, { kind: 'travel' }>['command']) => {
      if (current.current.kind !== 'idle') return null;
      const owner = {};
      publish({ kind: 'travel', owner, command });
      return owner;
    },
    [publish]
  );
  const create = useCallback(() => {
    if (current.current.kind !== 'idle') return null;
    const run = createSubmissionRun<CreateTopicResult>();
    publish({ kind: 'submitting', mode: 'create', owner: run });
    return run;
  }, [publish]);
  const edit = useCallback(() => {
    if (current.current.kind !== 'idle') return null;
    const run = createSubmissionRun<TopicEditResult>();
    publish({ kind: 'submitting', mode: 'edit', owner: run });
    return run;
  }, [publish]);
  const release = useCallback(
    (owner: object) => {
      if (current.current.kind !== 'idle' && current.current.owner === owner) publish({ kind: 'idle' });
    },
    [publish]
  );
  return { busy: snapshot.kind === 'submitting', isIdle, isSubmitting, travel, create, edit, release };
}
