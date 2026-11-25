import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyTopicEditReceipt,
  draftFromTopicEdit,
  emptyTopicDraft,
  hasTopicEditChanges,
  topicDraftTarget,
  type TopicCreationSource,
  type TopicDraft,
  type TopicEditContext,
  type TopicSubmissionAttempt
} from '@/domain/forum/topicComposer';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import { loadTopicDraft, readTopicSubmissionAttempt } from '@/platform/persistence/topicDrafts';
import { verifyTopicDraftAttachments } from '@/platform/media/topicDraftAttachments';
import { errorMessage } from '@/platform/network/errors';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { TopicDraftBodySource } from './useTopicDraftPersistence';

type Scope = { source: TopicCreationSource | null; identityKey: string; target: string; editTopicId?: string };
type HydrationRequest = { verifiedEdit?: { key: string; sessionEpoch: number; context: TopicEditContext } };
type Run = { key: string; request: HydrationRequest; controller: AbortController };
type State = { key: string; request: HydrationRequest } & (
  | { phase: 'waiting' | 'requested' | 'ready' }
  | { phase: 'running'; run: Run }
  | { phase: 'failed' }
  | { phase: 'verification-required'; message: string }
  | { phase: 'verification-requested' | 'verification-reading'; message: string; controller: AbortController }
);

function editVerificationAttempt(state: State) {
  return state.phase === 'verification-requested' || state.phase === 'verification-reading' ? state : undefined;
}
export type UntouchedEditBaseline = {
  draftId: string;
  revision: number;
  source: TopicCreationSource;
  account: string;
  target: string;
  inputSnapshot: string;
};

export async function readTopicDraftAndAttempt(source: TopicCreationSource, identityKey: string, target: string) {
  const [stored, attempt] = await Promise.all([
    loadTopicDraft(source, identityKey, target),
    readTopicSubmissionAttempt(source, identityKey, target)
  ]);
  return { stored, attempt };
}

function isUntouchedEdit(draft: TopicDraft | null, attempt: TopicSubmissionAttempt | null) {
  return Boolean(
    draft?.edit &&
    draft.revision === 0 &&
    attempt?.draftId !== draft.id &&
    !draft.attachments.length &&
    !draft.pendingNodeSeekPolls.length &&
    !hasTopicEditChanges(draft)
  );
}

export function serializeTopicDraftInputSnapshot(draft: TopicDraft): string {
  const base = {
    id: draft.id,
    source: draft.source,
    identityKey: draft.identityKey,
    revision: draft.revision,
    title: draft.title,
    body: draft.body,
    mode: draft.mode,
    categoryId: draft.categoryId,
    additionalReward: draft.additionalReward ?? '',
    pendingNodeSeekPolls: draft.pendingNodeSeekPolls.map((poll) => ({
      localId: poll.localId,
      fingerprint: poll.fingerprint,
      title: poll.title,
      multiple: poll.multiple,
      isPublic: poll.isPublic,
      options: poll.options,
      remoteId: poll.remoteId ?? null
    })),
    attachments: draft.attachments.map((file) => ({
      id: file.id,
      uri: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      kind: file.kind,
      status: file.status,
      description: file.description,
      markup: file.markup ?? null,
      error: file.error ?? null
    })),
    edit: draft.edit
      ? {
          topicId: draft.edit.topicId,
          postId: draft.edit.postId ?? null,
          confirmedAttemptId: draft.edit.confirmedAttemptId ?? null,
          original: {
            title: draft.edit.original.title,
            body: draft.edit.original.body,
            categoryId: draft.edit.original.categoryId,
            rank: draft.edit.original.rank ?? null,
            tags: draft.edit.original.tags?.map((tag) => ({ id: tag.id ?? null, name: tag.name })) ?? null
          }
        }
      : null
  };
  if (draft.source === 'nodeseek') return JSON.stringify({ ...base, rank: draft.rank });
  if (draft.source === 'linuxdo') {
    return JSON.stringify({
      ...base,
      tags: draft.tags.map((tag) => ({ id: tag.id ?? null, name: tag.name })),
      postVoting: draft.postVoting,
      onlyPostVoting: draft.onlyPostVoting ?? false,
      appliedTemplate: draft.appliedTemplate
    });
  }
  return JSON.stringify({
    ...base,
    kind: draft.kind,
    reward: draft.reward,
    gift: { total: draft.gift.total, perPerson: draft.gift.perPerson },
    poll: {
      options: draft.poll.options,
      giftEnabled: draft.poll.giftEnabled,
      total: draft.poll.total,
      perPerson: draft.poll.perPerson
    },
    resources: draft.resources.map((item) => ({
      title: item.title,
      url: item.url,
      size: item.size,
      extension: item.extension,
      description: item.description
    }))
  });
}

export type RestoredTopicDraft =
  | {
      stored: null;
      draft: null;
      attempt: null;
      editing: null;
      bodySource: null;
      untouchedEditBaseline: null;
    }
  | {
      stored: TopicDraft | null;
      draft: TopicDraft;
      attempt: TopicSubmissionAttempt | null;
      editing: TopicEditContext | null;
      bodySource: TopicDraftBodySource;
      untouchedEditBaseline: UntouchedEditBaseline | null;
      verifiedNow?: boolean;
    };

export function useTopicDraftHydration(input: {
  scope: Scope;
  sessionEpoch: number;
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
  captureEditVerification(scope: { identityKey: string; target: string; sessionEpoch: number }): {
    isCurrent(): boolean;
    open(message: string, recovery: ReadRecovery): void | Promise<boolean>;
  };
  reportVerificationError(cause: unknown): void;
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
      state.key !== key ||
      !['failed', 'ready', 'verification-required'].includes(state.phase)
    )
      return;
    publish({ phase: 'requested', key, request: {} });
  }, [key, keyRef, publish, request]);

  const recoverInitialEditRead = useCallback(async () => {
    const state = current.current;
    if (state.phase !== 'verification-required' || state.key !== key || keyRef.current !== key) return;
    const { scope, sessionEpoch } = inputRef.current;
    const { source, identityKey, target, editTopicId } = scope;
    if (source !== 'linuxdo' || !editTopicId) return;
    const hasCurrentDraft = () => {
      const value = inputRef.current.getDraft();
      return value?.source === source && value.identityKey === identityKey && topicDraftTarget(value) === target;
    };
    if (hasCurrentDraft()) return;
    const access = inputRef.current.captureEditVerification({ identityKey, target, sessionEpoch });
    const controller = new AbortController();
    const owns = () =>
      keyRef.current === key &&
      !controller.signal.aborted &&
      editVerificationAttempt(current.current)?.controller === controller;
    const isCurrent = () => owns() && access.isCurrent() && !hasCurrentDraft();
    const cancel = () => {
      if (owns()) publish(state);
      controller.abort();
    };
    publish({ ...state, phase: 'verification-requested', controller });
    try {
      const accepted = await access.open(state.message, {
        queryKey: ['topic-edit-context', identityKey, editTopicId, sessionEpoch, controller],
        isCurrent,
        cancel,
        resume: async () => {
          const pending = current.current;
          if (pending.phase !== 'verification-requested' || !isCurrent()) return 'stale';
          publish({ ...pending, phase: 'verification-reading' });
          try {
            const context = await inputRef.current.readEditContext(source, identityKey, editTopicId, controller.signal);
            if (!isCurrent()) return 'stale';
            publish({ phase: 'requested', key, request: { verifiedEdit: { key, sessionEpoch, context } } });
            controller.abort();
            return 'completed';
          } catch (cause) {
            if (!isCurrent()) return 'stale';
            if (sourceErrorFromUnknown(source, cause).kind === 'verification-required') return 'verification-required';
            inputRef.current.reportVerificationError(cause);
            publish({ phase: 'failed', key, request: state.request });
            controller.abort();
            throw cause;
          } finally {
            if (owns()) publish(pending);
          }
        }
      });
      if (accepted === false) cancel();
    } catch (cause) {
      if (isCurrent()) inputRef.current.reportVerificationError(cause);
      cancel();
    }
  }, [inputRef, key, keyRef, publish]);

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
        inputRef.current.restored({
          stored: null,
          draft: null,
          attempt: null,
          editing: null,
          bodySource: null,
          untouchedEditBaseline: null
        });
        if (owns()) publish({ phase: 'ready', key, request });
        return;
      }
      let { stored, attempt } = await readTopicDraftAndAttempt(source, identityKey, target);
      if (!owns()) return;
      let editing: TopicEditContext | null = null;
      const verified = request.verifiedEdit;
      const verifiedContext =
        verified?.key === run.key && verified.sessionEpoch === inputRef.current.sessionEpoch ? verified.context : null;
      const unresolvedBeforeRead = attempt?.status === 'sending' || attempt?.status === 'unknown';
      if (editTopicId && (!stored || (isUntouchedEdit(stored, attempt) && !unresolvedBeforeRead))) {
        if (verifiedContext) {
          editing = verifiedContext;
        } else {
          const startingInput = stored && serializeTopicDraftInputSnapshot(stored);
          const startingAttempt = attempt;
          const result = await inputRef.current
            .readEditContext(source, identityKey, editTopicId, run.controller.signal)
            .then(
              (context) => ({ kind: 'loaded' as const, context }),
              (cause: unknown) => ({ kind: 'failed' as const, cause })
            );
          if (!owns()) return;
          ({ stored, attempt } = await readTopicDraftAndAttempt(source, identityKey, target));
          if (!owns()) return;
          if (result.kind === 'failed') {
            if (!stored) throw result.cause;
          } else if (
            !stored ||
            (isUntouchedEdit(stored, attempt) &&
              serializeTopicDraftInputSnapshot(stored) === startingInput &&
              startingAttempt?.id === attempt?.id &&
              startingAttempt?.status === attempt?.status)
          ) {
            editing = result.context;
          }
        }
      }
      const unresolvedAttempt = attempt?.status === 'sending' || attempt?.status === 'unknown';
      const draftAttempt = stored && attempt?.draftId === stored.id ? attempt : null;
      let bodySource: TopicDraftBodySource;
      let restored: TopicDraft;
      if (editing) {
        bodySource = 'remote';
        restored = draftFromTopicEdit(editing);
      } else if (stored) {
        bodySource = 'local';
        restored = await verifyTopicDraftAttachments(stored);
      } else {
        bodySource = 'fresh';
        restored = emptyTopicDraft(source, identityKey);
      }
      if (editing && stored) restored = { ...restored, id: stored.id, updatedAt: stored.updatedAt };
      if (!owns()) return;
      if (draftAttempt) restored = applyTopicEditReceipt(restored, draftAttempt);
      if (stored && JSON.stringify(restored.attachments) !== JSON.stringify(stored.attachments))
        restored = { ...restored, revision: stored.revision + 1, updatedAt: Date.now() };
      if (!owns()) return;
      const restoredAttempt = !attempt
        ? null
        : unresolvedAttempt
          ? attempt
          : attempt.draftId === restored.id && (attempt.status !== 'saved' || attempt.revision === restored.revision)
            ? attempt
            : null;
      const untouchedEditBaseline: UntouchedEditBaseline | null =
        !editing && stored && isUntouchedEdit(stored, attempt) && restored.revision === stored.revision
          ? {
              draftId: stored.id,
              revision: stored.revision,
              source,
              account: identityKey,
              target,
              inputSnapshot: serializeTopicDraftInputSnapshot(restored)
            }
          : null;
      inputRef.current.restored({
        stored,
        draft: restored,
        attempt: restoredAttempt,
        editing,
        bodySource,
        untouchedEditBaseline,
        verifiedNow: editing !== null && editing === verifiedContext
      });
      if (!owns()) return;
      if (stored && restored.revision !== stored.revision) await inputRef.current.persist(restored);
      if (owns()) publish({ phase: 'ready', key, request });
    })().catch((cause) => {
      if (!owns()) return;
      publish(
        source === 'linuxdo' && editTopicId && sourceErrorFromUnknown(source, cause).kind === 'verification-required'
          ? { phase: 'verification-required', key, request, message: errorMessage(cause) }
          : { phase: 'failed', key, request }
      );
      if (keyRef.current === run.key && current.current.request === run.request) inputRef.current.failed(cause);
    });
    return () => {
      run.controller.abort();
      const verification = editVerificationAttempt(current.current);
      if (verification?.key === key && verification.request === request) verification.controller.abort();
    };
  }, [inputRef, key, keyRef, publish, request]);
  return {
    loading:
      snapshot.key !== key ||
      snapshot.phase === 'waiting' ||
      snapshot.phase === 'requested' ||
      snapshot.phase === 'running',
    retry,
    recoverInitialEditRead:
      snapshot.key === key && (snapshot.phase === 'verification-required' || editVerificationAttempt(snapshot))
        ? recoverInitialEditRead
        : undefined
  };
}
