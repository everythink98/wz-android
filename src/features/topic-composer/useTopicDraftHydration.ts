import { useCallback, useEffect, useRef, useState } from 'react';
import {
  draftFromTopicEdit,
  emptyTopicDraft,
  type TopicCreationSource,
  type TopicDraft,
  type TopicEditContext,
  type TopicSubmissionAttempt
} from '@/domain/forum/topicComposer';
import { loadTopicDraft, readTopicSubmissionAttempt } from '@/platform/persistence/topicDrafts';
import { verifyTopicDraftAttachments } from '@/platform/media/topicDraftAttachments';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';

type Scope = { source: TopicCreationSource | null; identityKey: string; target: string; editTopicId?: string };
type Run = { key: string; request: object; controller: AbortController };
type State = { key: string; request: object } & (
  { phase: 'waiting' | 'requested' | 'ready' } | { phase: 'running'; run: Run } | { phase: 'failed' }
);
export type RestoredTopicDraft = {
  stored: TopicDraft | null;
  draft: TopicDraft | null;
  attempt: TopicSubmissionAttempt | null;
  editing: TopicEditContext | null;
};

export function useTopicDraftHydration(input: {
  scope: Scope;
  getDraft(): TopicDraft | null;
  waitForPendingUpload(): Promise<unknown> | undefined;
  flush(): Promise<TopicDraft | null>;
  persist(value: TopicDraft): Promise<void>;
  readEditContext(
    source: TopicCreationSource,
    identityKey: string,
    topicId: string,
    signal: AbortSignal
  ): Promise<TopicEditContext>;
  started(): void;
  restored(value: RestoredTopicDraft): void;
  failed(cause: unknown): void;
}) {
  const inputRef = useCommittedRef(input);
  const key = JSON.stringify(input.scope);
  const keyRef = useCommittedRef(key);
  const [snapshot, setSnapshot] = useState<State>({ phase: 'waiting', key: '', request: {} });
  const current = useRef(snapshot);
  const publish = useCallback((value: State) => {
    current.current = value;
    setSnapshot(value);
  }, []);
  const request = snapshot.request;
  const retry = useCallback(() => {
    const state = current.current;
    if (
      keyRef.current !== key ||
      state.request !== request ||
      state.key !== keyRef.current ||
      !['failed', 'ready'].includes(state.phase)
    )
      return;
    publish({ phase: 'requested', key: state.key, request: {} });
  }, [key, keyRef, publish, request]);

  useEffect(() => {
    const { source, identityKey, target, editTopicId } = inputRef.current.scope;
    if (!source) {
      publish({ phase: 'waiting', key, request });
      return;
    }
    const run: Run = { key, request, controller: new AbortController() };
    publish({ phase: 'running', key, request, run });
    const owns = () =>
      current.current.phase === 'running' &&
      current.current.run === run &&
      !run.controller.signal.aborted &&
      keyRef.current === run.key;
    inputRef.current.started();
    void (async () => {
      const previous = inputRef.current.getDraft();
      const upload = inputRef.current.waitForPendingUpload();
      if (upload) await upload;
      if (!owns()) return;
      if (previous?.source === source) await inputRef.current.flush();
      if (!owns()) return;
      if (!identityKey || identityKey.endsWith(':anonymous')) {
        inputRef.current.restored({ stored: null, draft: null, attempt: null, editing: null });
        if (owns()) publish({ phase: 'ready', key, request });
        return;
      }
      const [stored, attempt] = await Promise.all([
        loadTopicDraft(source, identityKey, target),
        readTopicSubmissionAttempt(source, identityKey, target)
      ]);
      if (!owns()) return;
      const editing =
        editTopicId && !stored
          ? await inputRef.current.readEditContext(source, identityKey, editTopicId, run.controller.signal)
          : null;
      if (!owns()) return;
      let restored = stored
        ? await verifyTopicDraftAttachments(stored)
        : editing
          ? draftFromTopicEdit(editing)
          : emptyTopicDraft(source, identityKey);
      if (!owns()) return;
      if (restored.edit && attempt?.draftId === restored.id && attempt.confirmed) {
        const original = { ...restored.edit.original, ...attempt.confirmed };
        if (JSON.stringify(original) !== JSON.stringify(restored.edit.original))
          restored = {
            ...restored,
            ...(attempt.revision === restored.revision ? attempt.confirmed : {}),
            edit: { ...restored.edit, original },
            revision: restored.revision + 1,
            updatedAt: Date.now()
          } as TopicDraft;
      }
      if (stored && JSON.stringify(restored.attachments) !== JSON.stringify(stored.attachments))
        restored = { ...restored, revision: stored.revision + 1, updatedAt: Date.now() };
      if (!owns()) return;
      inputRef.current.restored({
        stored,
        draft: restored,
        attempt: attempt?.status === 'saved' && attempt.draftId !== restored.id ? null : attempt,
        editing
      });
      if (!owns()) return;
      if (stored && restored.revision !== stored.revision) await inputRef.current.persist(restored);
      if (owns()) publish({ phase: 'ready', key, request });
    })().catch((cause) => {
      if (!owns()) return;
      publish({ phase: 'failed', key, request });
      if (keyRef.current === run.key && current.current.request === run.request) inputRef.current.failed(cause);
    });
    return () => run.controller.abort();
  }, [inputRef, key, keyRef, publish, request]);
  return {
    loading:
      snapshot.key !== key ||
      snapshot.phase === 'waiting' ||
      snapshot.phase === 'requested' ||
      snapshot.phase === 'running',
    retry
  };
}
