import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, AppState, Image } from 'react-native';
import { withPickedAttachmentCopies } from '@/platform/media/pickedAttachmentCopies';
import type { Topic } from '@/domain/forum/models';
import {
  applyTopicCategory,
  applyTopicEditReceipt,
  draftFromTopicEdit,
  normalizedTopicEditInput,
  topicSubmissionWithReceipt,
  emptyTopicDraft,
  validateTopicDraft,
  type CreateTopicResult,
  type TopicEditResult,
  type TopicCreationSource,
  type TopicDraft,
  type TopicDraftAttachment,
  type TopicEditContext,
  type TopicSubmissionAttempt,
  type TopicSubmissionReceipt,
  hasTopicEditChanges,
  topicDraftTarget,
  topicEditChanges,
  topicEditConflict,
  validateTopicEdit,
  yaohuoFileBytePolicy,
  type TopicComposerIntent
} from '@/domain/forum/topicComposer';
import { firstNodeSeekStardustIssue, type ComposerSnapshot } from '@/domain/forum/structuredComposer';
import { editLinuxDoTopic } from '@/sources/linuxdo/topicEditing';
import { editNodeSeekTopic } from '@/sources/nodeseek/topicEditing';
import { editYaohuoTopic } from '@/sources/yaohuo/topicEditing';
import { siteSessionIdentityKey } from '@/domain/session/siteSessionState';
import type { WritableSessionTicket } from '@/domain/session/writableSessionGate';
import type { ReadRecovery } from '@/platform/query/readRecovery';
import { errorMessage } from '@/platform/network/errors';
import {
  RequestCanceledError,
  isDefinitiveHttpRejection,
  withRequestBeforeSend,
  type Fetcher,
  type RequestDispatchState
} from '@/platform/network/request';
import {
  acknowledgeTopicSubmissionAttempt,
  beginTopicSubmissionAttempt,
  checkpointTopicEdit,
  discardTopicDraft,
  loadTopicDraft,
  readLastTopicCreationSource,
  readTopicSubmissionAttempt,
  saveLastTopicCreationSource,
  settleTopicSubmissionAttempt
} from '@/platform/persistence/topicDrafts';
import {
  knownTopicDraftAttachmentSize,
  persistTopicDraftAttachment,
  removeTopicDraftAttachmentFile
} from '@/platform/media/topicDraftAttachments';
import { createNodeSeekTopic, loadNodeSeekTopicCreationContext } from '@/sources/nodeseek/topicCreation';
import { createLinuxDoTopic, searchLinuxDoTopicTags } from '@/sources/linuxdo/topicCreation';
import { createYaohuoTopic, loadYaohuoTopicCreationContext } from '@/sources/yaohuo/topicCreation';
import { materializePendingNodeSeekPolls } from '@/sources/nodeseek/pendingPolls';
import { buildNodeSeekPollCreateRequest } from '@/sources/nodeseek/actionRequest';
import { runNodeSeekAction } from '@/sources/nodeseek/actionClient';
import { currentNodeImageApiKeyGeneration } from '@/sources/nodeimage/credentials';
import { fetchLinuxDoTemplates, recordLinuxDoTemplateUse } from '@/sources/linuxdo/templates';
import { resolveLinuxDoUpload } from '@/sources/linuxdo/uploadUrls';
import { sourceErrorFromUnknown } from '@/sources/sourceErrors';
import { forumResponseAccountFailure } from '@/sources/sessionFailure';
import { MAX_REPLY_IMAGE_UPLOAD_BYTES, normalizeReplyImageAsset } from '@/sources/imageUpload';
import type { StructuredReplyComposerHandle } from '@/ui/composer/StructuredReplyComposer';
import { useCommittedRef } from '@/ui/hooks/useCommittedRef';
import type { TopicComposerRouteRuntimeValue } from './TopicComposerRouteRuntime';
import { uploadTopicAttachment, validateTopicAttachment } from './topicCreationActions';
import { TopicDraftConflictError, useTopicDraftPersistence } from './useTopicDraftPersistence';
import { useTopicComposerOperation } from './useTopicComposerOperation';
import {
  readTopicDraftAndAttempt,
  serializeTopicDraftInputSnapshot,
  useTopicDraftHydration,
  type UntouchedEditBaseline
} from './useTopicDraftHydration';
import { useTopicDraftContext } from './useTopicDraftContext';

type UploadJob = { abort: AbortController; promise: Promise<string | undefined> };
type AttachmentWork =
  | { kind: 'idle' }
  | { kind: 'picking' }
  | { kind: 'upload'; upload: UploadJob }
  | { kind: 'picking-upload'; upload: UploadJob };

type RemoteEditReplacement = {
  previous: TopicDraft;
  draft: TopicDraft;
  stored: TopicDraft;
  origin: { kind: 'hydration'; editing: TopicEditContext } | { kind: 'rules'; signal: AbortSignal };
  sessionEpoch: number;
  ownsFocus(): boolean;
  finish(result: RemoteEditReplacementResult): void;
  onReady(): void;
};
type RemoteEditReplacementResult = { kind: 'accepted' | 'canceled' } | { kind: 'failed'; cause: unknown };
type RemoteEditReplacementState = {
  phase: 'awaiting-editor' | 'checking-storage';
  request: RemoteEditReplacement;
};

function isPicking(work: AttachmentWork) {
  return work.kind === 'picking' || work.kind === 'picking-upload';
}
function getUploadJob(work: AttachmentWork) {
  return 'upload' in work ? work.upload : null;
}

const SOURCES: TopicCreationSource[] = ['nodeseek', 'linuxdo', 'yaohuo'];
function confirm(title: string, message: string, label = '确定', cancelLabel = '取消') {
  return new Promise<boolean>((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: label, onPress: () => resolve(true) }
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    )
  );
}
function identifier() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function readReconciledAttempt(attempt: TopicSubmissionAttempt) {
  const stored = await readTopicSubmissionAttempt(attempt.source, attempt.identityKey, attempt.target);
  if (stored?.id === attempt.id && stored.draftId === attempt.draftId && stored.revision === attempt.revision)
    return stored;
  return topicSubmissionWithReceipt(attempt, {
    status: 'unknown',
    message: '本机提交记录已变化，请先到原站核对，勿重复提交'
  });
}

async function receiptAfterFailure(
  attempt: TopicSubmissionAttempt,
  mayHaveSent: boolean,
  cause: unknown,
  result?: TopicSubmissionReceipt
) {
  if (result)
    return topicSubmissionWithReceipt(attempt, {
      status: 'unknown',
      message: '原站已返回结果，但本机记录保存失败，请先到原站核对，勿重复提交',
      ...('confirmed' in result && result.confirmed ? { confirmed: result.confirmed } : {})
    });
  const verificationRequired =
    attempt.source === 'linuxdo' && sourceErrorFromUnknown('linuxdo', cause).kind === 'verification-required';
  const failure: TopicSubmissionReceipt = {
    status: mayHaveSent ? 'unknown' : 'rejected',
    message: mayHaveSent ? '提交结果未知，请先到原站核对，勿重复提交' : errorMessage(cause),
    ...(verificationRequired ? { verificationRequired: true } : {})
  };
  try {
    await settleTopicSubmissionAttempt(attempt, failure);
    return await readReconciledAttempt(attempt);
  } catch {
    return topicSubmissionWithReceipt(attempt, {
      status: 'unknown',
      message: '本机记录保存失败，请先到原站核对，勿重复提交'
    });
  }
}

export function useTopicComposerController({
  runtime,
  intent,
  active,
  isRouteFocused,
  onPosted,
  onAccepted,
  onEdited
}: {
  runtime: TopicComposerRouteRuntimeValue;
  intent: TopicComposerIntent;
  active: boolean;
  isRouteFocused?: () => boolean;
  onPosted: (topic: Topic) => void;
  onAccepted: () => void;
  onEdited?: (source: TopicCreationSource, topicId: string) => void;
}) {
  const initialSource = intent.kind === 'edit' ? intent.source : intent.initialSource;
  const editTopicId = intent.kind === 'edit' ? intent.topicId : undefined;
  const target = editTopicId ? `edit:${editTopicId}` : 'create';
  const targetRef = useCommittedRef(target);
  const runtimeRef = useCommittedRef(runtime);
  const activeRef = useCommittedRef(active);
  const confirmationFocusOwner = useRef<object | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    confirmationFocusOwner.current = {};
    return () => {
      confirmationFocusOwner.current = null;
    };
  }, [active]);
  const captureConfirmationFocus = useCallback(() => {
    const owner = confirmationFocusOwner.current;
    return () => owner !== null && confirmationFocusOwner.current === owner && (!isRouteFocused || isRouteFocused());
  }, [isRouteFocused]);
  const confirmOnCurrentRoute = useCallback(
    async (...args: Parameters<typeof confirm>) => {
      const ownsFocus = captureConfirmationFocus();
      return ownsFocus() && (await confirm(...args)) && ownsFocus();
    },
    [captureConfirmationFocus]
  );
  const editorRef = useRef<StructuredReplyComposerHandle>(null);
  const [source, setSource] = useState<TopicCreationSource | null>(initialSource || null);
  const sourceRef = useCommittedRef(source);
  const [draft, setDraft] = useState<TopicDraft | null>(null);
  const draftRef = useRef<TopicDraft | null>(null);
  const completedSubmission = useRef<TopicSubmissionAttempt | null>(null);

  const [uploading, setUploading] = useState(false);
  const attachmentWork = useRef<AttachmentWork>({ kind: 'idle' });
  const [error, setError] = useState('');

  const [errors, setErrors] = useState<Record<string, string>>({});

  const [attempt, setAttempt] = useState<TopicSubmissionAttempt | null>(null);
  const attemptRef = useRef<TopicSubmissionAttempt | null>(null);
  const untouchedEditBaselineRef = useRef<UntouchedEditBaseline | null>(null);
  const mounted = useRef(true);
  const [remoteLift, setRemoteLift] = useState<RemoteEditReplacementState | null>(null);
  const currentRemoteLift = useRef<RemoteEditReplacementState | null>(null);
  const publishRemoteLift = useCallback((state: RemoteEditReplacementState | null) => {
    currentRemoteLift.current = state;
    if (mounted.current) setRemoteLift(state);
  }, []);
  const finishRemoteLift = useCallback(
    (request: RemoteEditReplacement, result: RemoteEditReplacementResult) => {
      if (currentRemoteLift.current?.request !== request) return;
      publishRemoteLift(null);
      request.finish(result);
    },
    [publishRemoteLift]
  );
  const cancelRemoteLift = useCallback(() => {
    const request = currentRemoteLift.current?.request;
    if (request) finishRemoteLift(request, { kind: 'canceled' });
  }, [finishRemoteLift]);
  const [draftSites, setDraftSites] = useState<Partial<Record<TopicCreationSource, boolean>>>({});

  const installAttempt = useCallback((value: TopicSubmissionAttempt | null) => {
    attemptRef.current = value;
    if (mounted.current) setAttempt(value);
  }, []);
  const showReconciledAttempt = useCallback(
    (receipt: TopicSubmissionAttempt) => {
      if (
        !mounted.current ||
        draftRef.current?.id !== receipt.draftId ||
        siteSessionIdentityKey(runtimeRef.current.sessions[receipt.source]) !== receipt.identityKey
      )
        return;
      const completed = receipt.status === 'saved' || receipt.status === 'posted' || receipt.status === 'enqueued';
      if (completed) completedSubmission.current = receipt;
      installAttempt(receipt);
      setError(
        completed
          ? ''
          : receipt.result?.message || (receipt.status === 'partial' ? '部分修改已保存，请核对剩余修改后继续' : '')
      );
    },
    [installAttempt, runtimeRef]
  );
  const {
    busy,
    isIdle: operationIdle,
    isSubmitting: operationSubmitting,
    canChangeDraft,
    begin: beginOperation,
    release: releaseOperation
  } = useTopicComposerOperation(mounted);
  const {
    saveStatus,
    persist,
    hasSavedDraft,
    flush: flushDraft,
    edited: markDraftEdited,
    restored: restoreDraftPersistence,
    restorationFailed: reportDraftRestorationFailure,
    conflict: reportDraftConflict,
    retire: retireDraft,
    fresh: markFreshDraft,
    discarded: markDraftDiscarded,
    recordSnapshot,
    snapshotIssue
  } = useTopicDraftPersistence({
    getDraft: () => draftRef.current,
    isMounted: () => mounted.current,
    completedSubmissionId: (value) =>
      completedSubmission.current?.draftId === value.id ? completedSubmission.current.id : undefined,
    onSaved: (site) => setDraftSites((previous) => ({ ...previous, [site]: true }))
  });

  const session = source ? runtime.sessions[source] : null;
  const identityKey = session ? siteSessionIdentityKey(session) : '';
  const enabled = Boolean(source && runtime.enabledSources.includes(source));
  useEffect(() => {
    if (
      attempt?.status === 'saved' &&
      draft?.edit &&
      attempt.draftId === draft.id &&
      attempt.revision === draft.revision &&
      active &&
      runtime.appActive &&
      enabled &&
      draft.identityKey === identityKey
    )
      onEdited?.(draft.source, draft.edit.topicId);
  }, [attempt, draft, active, runtime.appActive, enabled, identityKey, onEdited]);

  const readEditContext = useCallback(
    async (site: TopicCreationSource, ownerKey: string, topicId: string, signal?: AbortSignal) => {
      const owner = runtimeRef.current;
      const ticket = await owner.ensureWritableSession(site);
      await owner.ensureNetworkProxyReady();
      if (
        !owner.isWritableSessionTicketCurrent(ticket) ||
        siteSessionIdentityKey(runtimeRef.current.sessions[site]) !== ownerKey
      )
        throw new Error('站点或账号已变化，请重新进入');
      const value = await owner.getTopicEditContext({
        source: site,
        identityKey: ownerKey,
        topicId,
        signal,
        userAgent: owner.getUserAgent(site)
      });
      if (
        signal?.aborted ||
        !runtimeRef.current.isWritableSessionTicketCurrent(ticket) ||
        siteSessionIdentityKey(runtimeRef.current.sessions[site]) !== ownerKey
      )
        throw new Error('编辑读取已失效');
      return value;
    },
    [runtimeRef]
  );

  const installDraft = useCallback((value: TopicDraft | null) => {
    draftRef.current = value;
    if (mounted.current) setDraft(value);
  }, []);
  const change = useCallback(
    (update: (current: TopicDraft) => TopicDraft) => {
      const current = draftRef.current;
      if (
        !current ||
        !canChangeDraft() ||
        siteSessionIdentityKey(runtimeRef.current.sessions[current.source]) !== current.identityKey
      )
        return;
      const next = update(current);
      if (next === current) return;
      installDraft({ ...next, revision: current.revision + 1, updatedAt: Date.now() });
      markDraftEdited();
      setErrors({});
    },
    [canChangeDraft, installDraft, runtimeRef, markDraftEdited]
  );

  const acceptSnapshot = useCallback(
    (snapshot: ComposerSnapshot, draftId?: string) => {
      const current = draftRef.current;
      if (!current || (draftId && current.id !== draftId) || current.source === 'yaohuo') return;
      recordSnapshot(current.id, snapshot.validationIssues);
      if (current.edit && snapshot.revision === 0) return;
      if (snapshot.revision === 0) {
        if (current.mode === snapshot.mode) return;
        if (!hasSavedDraft(current.id) && current.revision === 0) {
          installDraft({ ...current, mode: snapshot.mode });
          return;
        }
        installDraft({
          ...current,
          mode: snapshot.mode,
          revision: current.revision + 1,
          updatedAt: Date.now()
        });
        markDraftEdited();
        return;
      }
      const contentChanged =
        current.body !== snapshot.markdown ||
        JSON.stringify(current.pendingNodeSeekPolls) !== JSON.stringify(snapshot.pendingNodeSeekPolls);
      if (!contentChanged && current.mode === snapshot.mode) return;
      const next = {
        ...current,
        body: snapshot.markdown,
        mode: snapshot.mode,
        pendingNodeSeekPolls: snapshot.pendingNodeSeekPolls,
        revision: current.revision + 1,
        updatedAt: Date.now()
      };
      const saved = completedSubmission.current;
      installDraft(
        saved && saved.draftId === current.id && saved.revision === current.revision
          ? applyTopicEditReceipt(next, saved)
          : next
      );
      markDraftEdited();
      if (contentChanged)
        setErrors((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'body' && key !== 'poll'))
        );
    },
    [hasSavedDraft, installDraft, markDraftEdited, recordSnapshot]
  );

  const flush = useCallback(() => {
    const editor = draftRef.current?.source === 'yaohuo' ? null : editorRef.current;
    return flushDraft({ capture: editor ? () => editor.requestSnapshot() : undefined, accept: acceptSnapshot });
  }, [acceptSnapshot, flushDraft]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelRemoteLift();
      getUploadJob(attachmentWork.current)?.abort.abort();
    };
  }, [cancelRemoteLift]);
  useEffect(() => {
    if (initialSource) return;
    let alive = true;
    void readLastTopicCreationSource()
      .catch(() => null)
      .then((previous) => {
        if (!alive) return;
        const available = runtimeRef.current.enabledSources;
        setSource(
          previous && available.includes(previous)
            ? previous
            : SOURCES.find((site) => available.includes(site)) || 'nodeseek'
        );
      });
    return () => {
      alive = false;
    };
  }, [initialSource, runtimeRef]);

  useEffect(() => {
    let alive = true;
    void Promise.all(
      SOURCES.map(async (site) => {
        const key = siteSessionIdentityKey(runtime.sessions[site]);
        return [site, !key.endsWith(':anonymous') && Boolean(await loadTopicDraft(site, key))] as const;
      })
    )
      .then((rows) => {
        if (alive) setDraftSites(Object.fromEntries(rows));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [runtime.sessions]);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const value = draftRef.current;
      // Pickers pause the WebView. Its queued autosnapshot resumes with it; requesting
      // another snapshot on native foreground can time out before the renderer wakes.
      if (state !== 'active' && value) void persist(value).catch(() => undefined);
    });
    return () => listener.remove();
  }, [persist]);

  const assertLocalOwner = useCallback(
    (value: TopicDraft, ticket?: WritableSessionTicket) => {
      const currentRuntime = runtimeRef.current;
      const current = draftRef.current;
      if (
        !mounted.current ||
        !activeRef.current ||
        sourceRef.current !== value.source ||
        !current ||
        current.id !== value.id ||
        current.source !== value.source ||
        current.identityKey !== value.identityKey ||
        !currentRuntime.enabledSources.includes(value.source) ||
        siteSessionIdentityKey(currentRuntime.sessions[value.source]) !== value.identityKey ||
        (ticket && !currentRuntime.isWritableSessionTicketCurrent(ticket))
      ) {
        throw new Error('站点或账号已变化，请重新确认后重试');
      }
    },
    [activeRef, runtimeRef, sourceRef]
  );
  const assertOwner = useCallback(
    (value: TopicDraft, ticket?: WritableSessionTicket) => {
      assertLocalOwner(value, ticket);
      if (!runtimeRef.current.appActive) {
        throw new Error('站点或账号已变化，请重新确认后重试');
      }
    },
    [assertLocalOwner, runtimeRef]
  );
  const requestAccess = useCallback(
    async (value: TopicDraft, dispatchState?: RequestDispatchState) => {
      const owner = runtimeRef.current;
      const ticket = await owner.ensureWritableSession(value.source);
      assertOwner(value, ticket);
      await owner.ensureNetworkProxyReady();
      assertOwner(value, ticket);
      let reported = false;
      const accountFetcher: Fetcher = async (input, init) => {
        const response = await owner.fetcher(input, init);
        const reason =
          !reported && (await forumResponseAccountFailure(value.source, input, response, init?.signal ?? undefined));
        if (reason && !reported && !init?.signal?.aborted) {
          try {
            assertOwner(value, ticket);
          } catch {
            return response;
          }
          reported = true;
          if (reason === 'http-401') runtimeRef.current.onSessionExpired(ticket.source, ticket.sessionEpoch);
          else runtimeRef.current.requestAccountRecheck(ticket.source, ticket.sessionEpoch);
        }
        return response;
      };
      const fetcher: Fetcher = (input, init) =>
        withRequestBeforeSend(
          accountFetcher,
          () => assertOwner(value, ticket),
          init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase()) ? dispatchState : undefined
        )(input, init);
      return { ticket, fetcher, accountFetcher, userAgent: owner.getUserAgent(value.source) };
    },
    [assertOwner, runtimeRef]
  );

  const readWithVerification = useCallback(
    async <T>(value: TopicDraft, signal: AbortSignal, key: readonly unknown[], read: () => Promise<T>): Promise<T> => {
      const epoch = runtimeRef.current.sessionEpochs[value.source];
      let settled = false;
      const isCurrent = () => {
        try {
          assertOwner(value);
          return !settled && !signal.aborted && runtimeRef.current.sessionEpochs[value.source] === epoch;
        } catch {
          return false;
        }
      };
      let challenge: unknown;
      try {
        return await read();
      } catch (cause) {
        if (
          !isCurrent() ||
          value.source !== 'linuxdo' ||
          sourceErrorFromUnknown('linuxdo', cause).kind !== 'verification-required'
        )
          throw cause;
        challenge = cause;
      }
      return new Promise<T>((resolve, reject) => {
        const finish = (result: { value: T } | { error: unknown }) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', cancel);
          if ('value' in result) resolve(result.value);
          else reject(result.error);
        };
        const cancel = () => finish({ error: new Error('验证已取消，草稿已保留，请重试读取') });
        const recovery: ReadRecovery = {
          queryKey: ['create-topic', value.identityKey, value.id, epoch, ...key],
          isCurrent,
          cancel,
          resume: async () => {
            if (!isCurrent()) {
              cancel();
              return 'stale';
            }
            try {
              const result = await read();
              if (!isCurrent()) {
                cancel();
                return 'stale';
              }
              finish({ value: result });
              return 'completed';
            } catch (cause) {
              if (!isCurrent()) {
                cancel();
                return 'stale';
              }
              if (sourceErrorFromUnknown('linuxdo', cause).kind === 'verification-required')
                return 'verification-required';
              finish({ error: cause });
              throw cause;
            }
          }
        };
        signal.addEventListener('abort', cancel, { once: true });
        void Promise.resolve(runtimeRef.current.openAccount('linuxdo', errorMessage(challenge), recovery)).then(
          (accepted) => {
            if (!accepted) cancel();
          },
          (error: unknown) => finish({ error })
        );
      });
    },
    [assertOwner, runtimeRef]
  );
  const {
    loading,
    retry: retryDraft,
    recoverInitialEditRead
  } = useTopicDraftHydration({
    scope: { source, identityKey, target, editTopicId },
    sessionEpoch: source ? runtime.sessionEpochs[source] : 0,
    getDraft: () => draftRef.current,
    waitForPendingUpload: () => getUploadJob(attachmentWork.current)?.promise,
    flush,
    persist,
    readEditContext,
    captureEditVerification: ({ identityKey, target, sessionEpoch }) => {
      const ownsFocus = captureConfirmationFocus();
      return {
        isCurrent: () =>
          ownsFocus() &&
          runtimeRef.current.appActive &&
          runtimeRef.current.enabledSources.includes('linuxdo') &&
          targetRef.current === target &&
          runtimeRef.current.sessionEpochs.linuxdo === sessionEpoch &&
          siteSessionIdentityKey(runtimeRef.current.sessions.linuxdo) === identityKey,
        open: (message, recovery) => runtimeRef.current.openAccount('linuxdo', message, recovery)
      };
    },
    reportVerificationError: (cause) => setError(errorMessage(cause)),
    started: () => {
      untouchedEditBaselineRef.current = null;
      cancelRemoteLift();
      setError('');
      resetDraftContext();
      setErrors({});
    },
    restored: (result) => {
      if (!result.draft) {
        untouchedEditBaselineRef.current = null;
        cancelRemoteLift();
        installDraft(null);
        installAttempt(null);
        return;
      }
      untouchedEditBaselineRef.current = result.untouchedEditBaseline;
      const previous = draftRef.current;
      if (result.editing && result.bodySource === 'remote' && result.stored && previous?.id === result.draft.id) {
        void stageRemoteLift({
          previous,
          draft: result.draft,
          stored: result.stored,
          origin: { kind: 'hydration', editing: result.editing }
        });
      } else {
        cancelRemoteLift();
        restoreDraftPersistence(result.draft, result.stored, result.bodySource);
        installDraft(result.draft);
        if (result.editing) installRestoredEdit(result.editing, result.verifiedNow ? result.draft.id : undefined);
      }
      installAttempt(result.attempt);
      if (result.attempt?.status === 'partial' && result.attempt.draftId === result.draft.id)
        setError(result.attempt.result?.message || '部分修改已保存，请核对剩余修改后继续');
    },
    failed: (cause) => {
      setError(errorMessage(cause));
      reportDraftRestorationFailure(cause);
    }
  });
  const {
    context,
    editContext,
    contextLoading,
    failure: contextFailure,
    emojiUrls,
    reload: reloadContext,
    reset: resetDraftContext,
    installRestoredEdit,
    reviewedEdit: reviewEditContext,
    beginCategory: beginCategoryChange,
    ownsCategory: ownsCategoryChange
  } = useTopicDraftContext({
    source,
    identityKey,
    target,
    draft,
    sessionEpoch: source ? runtime.sessionEpochs[source] : 0,
    canRead:
      !loading &&
      active &&
      runtime.appActive &&
      enabled &&
      Boolean(session?.canWrite) &&
      remoteLift?.request.origin.kind !== 'hydration',
    getDraft: () => draftRef.current,
    readRules: async (value, signal) => {
      const read = async () => {
        const access = await requestAccess(value);
        const options = { ...access, signal };
        if (value.edit) {
          const editing = await runtimeRef.current.getTopicEditContext({
            source: value.source,
            topicId: value.edit.topicId,
            identityKey: value.identityKey,
            userAgent: access.userAgent,
            signal
          });
          assertOwner(value, access.ticket);
          return { context: editing.rules, editing };
        }
        const context =
          value.source === 'nodeseek'
            ? await loadNodeSeekTopicCreationContext(options)
            : value.source === 'linuxdo'
              ? await runtimeRef.current.getLinuxDoTopicCreationContext({ source: 'linuxdo', signal })
              : await loadYaohuoTopicCreationContext(options);
        assertOwner(value, access.ticket);
        return { context, editing: null };
      };
      const resolved = await readWithVerification(value, signal, ['rules'], read);
      const editing = resolved.editing;
      const fallback = untouchedEditBaselineRef.current;
      if (
        !editing ||
        !fallback ||
        fallback.draftId !== value.id ||
        fallback.source !== editing.source ||
        fallback.account !== editing.identityKey ||
        fallback.target !== `edit:${editing.topicId}`
      ) {
        return resolved;
      }
      const matchesUntouchedSnapshot = (candidate: TopicDraft | null) =>
        Boolean(
          candidate &&
          candidate.id === fallback.draftId &&
          candidate.source === fallback.source &&
          candidate.identityKey === fallback.account &&
          topicDraftTarget(candidate) === fallback.target &&
          candidate.revision === fallback.revision &&
          serializeTopicDraftInputSnapshot(candidate) === fallback.inputSnapshot
        );
      const routeLocalChangeConflict = (currentDraft: TopicDraft | null) => {
        untouchedEditBaselineRef.current = null;
        if (currentDraft?.edit && topicEditConflict(currentDraft.edit.original, editing.original))
          setError('原站内容已更新，请先核对后再保存');
        return resolved;
      };
      if (!matchesUntouchedSnapshot(draftRef.current)) return routeLocalChangeConflict(draftRef.current);

      const { stored: storedNow, attempt: attemptNow } = await readTopicDraftAndAttempt(
        fallback.source,
        fallback.account,
        fallback.target
      );
      if (signal.aborted) throw new Error('编辑读取已失效');
      assertOwner(value);
      if (untouchedEditBaselineRef.current !== fallback) return resolved;
      const previous = draftRef.current;
      if (!previous || !matchesUntouchedSnapshot(previous)) return routeLocalChangeConflict(previous);

      if (attemptNow?.status === 'sending' || attemptNow?.status === 'unknown') {
        installAttempt(attemptNow);
        return resolved;
      }
      if (attemptNow && attemptNow.draftId === fallback.draftId) {
        untouchedEditBaselineRef.current = null;
        if (attemptNow.status !== 'saved' || attemptNow.revision === fallback.revision)
          showReconciledAttempt(attemptNow);
        if (!matchesUntouchedSnapshot(storedNow)) {
          reportDraftConflict(fallback.draftId);
          setError(new TopicDraftConflictError().message);
        }
        return resolved;
      }
      if (!storedNow || !matchesUntouchedSnapshot(storedNow)) {
        untouchedEditBaselineRef.current = null;
        reportDraftConflict(fallback.draftId);
        setError(new TopicDraftConflictError().message);
        return resolved;
      }

      const remoteDraft: TopicDraft = {
        ...draftFromTopicEdit(editing),
        id: storedNow.id,
        updatedAt: storedNow.updatedAt
      };
      const accepted = await stageRemoteLift({
        previous,
        draft: remoteDraft,
        stored: storedNow,
        origin: { kind: 'rules', signal }
      });
      if (!accepted) throw new RequestCanceledError();
      return resolved;
    },
    readEmojis: (signal) => runtimeRef.current.getEmojiUrls({ source: 'linuxdo', signal }),
    rulesReady: (value, rules) => {
      const current = draftRef.current;
      const defaultCategoryId = rules.defaultCategoryId;
      if (
        !value.edit &&
        current?.id === value.id &&
        !current.categoryId &&
        defaultCategoryId &&
        rules.categories.some((item) => item.id === defaultCategoryId && item.canCreate !== false)
      ) {
        if (current.revision > 0) change((draft) => applyTopicCategory(draft, defaultCategoryId, rules));
        else if (
          operationIdle() &&
          siteSessionIdentityKey(runtimeRef.current.sessions[current.source]) === current.identityKey
        )
          installDraft(applyTopicCategory(current, defaultCategoryId, rules));
      }
    }
  });
  const validateRemoteLift = useCallback(
    (request: RemoteEditReplacement) => {
      if (currentRemoteLift.current?.request !== request) return false;
      const { previous } = request;
      try {
        assertOwner(previous);
        if (
          !request.ownsFocus() ||
          topicDraftTarget(previous) !== targetRef.current ||
          runtimeRef.current.sessionEpochs[previous.source] !== request.sessionEpoch
        ) {
          finishRemoteLift(request, { kind: 'canceled' });
          return false;
        }
      } catch {
        finishRemoteLift(request, { kind: 'canceled' });
        return false;
      }
      const current = draftRef.current;
      if (current === previous) return true;
      untouchedEditBaselineRef.current = null;
      if (current?.edit && request.draft.edit && topicEditConflict(current.edit.original, request.draft.edit.original))
        setError('原站内容已更新，请先核对后再保存');
      finishRemoteLift(request, { kind: 'accepted' });
      return false;
    },
    [assertOwner, finishRemoteLift, runtimeRef, targetRef]
  );
  const completeRemoteLift = useCallback(
    async (request: RemoteEditReplacement) => {
      if (currentRemoteLift.current?.phase !== 'awaiting-editor' || !validateRemoteLift(request)) return;
      publishRemoteLift({ phase: 'checking-storage', request });
      const { previous } = request;
      try {
        const { stored, attempt } = await readTopicDraftAndAttempt(
          previous.source,
          previous.identityKey,
          topicDraftTarget(previous)
        );
        if (!validateRemoteLift(request)) return;
        if (attempt?.status === 'sending' || attempt?.status === 'unknown') {
          installAttempt(attempt);
        } else {
          untouchedEditBaselineRef.current = null;
          if (
            !stored ||
            serializeTopicDraftInputSnapshot(stored) !== serializeTopicDraftInputSnapshot(request.stored)
          ) {
            reportDraftConflict(previous.id);
            setError(new TopicDraftConflictError().message);
          } else if (attempt?.draftId === previous.id) {
            if (attempt.status !== 'saved' || attempt.revision === previous.revision) showReconciledAttempt(attempt);
          } else {
            installDraft(request.draft);
            restoreDraftPersistence(request.draft, stored, 'remote');
          }
        }
        finishRemoteLift(request, { kind: 'accepted' });
      } catch (cause) {
        if (validateRemoteLift(request)) finishRemoteLift(request, { kind: 'failed', cause });
      }
    },
    [
      finishRemoteLift,
      installAttempt,
      installDraft,
      publishRemoteLift,
      reportDraftConflict,
      restoreDraftPersistence,
      showReconciledAttempt,
      validateRemoteLift
    ]
  );
  const stageRemoteLift = useCallback(
    (input: Pick<RemoteEditReplacement, 'previous' | 'draft' | 'stored' | 'origin'>) => {
      const { origin } = input;
      const signal = origin.kind === 'rules' ? origin.signal : undefined;
      const ownsFocus = captureConfirmationFocus();
      if (signal?.aborted || !ownsFocus()) return Promise.resolve(false);
      cancelRemoteLift();
      return new Promise<boolean>((resolve, reject) => {
        const cancel = () => finishRemoteLift(request, { kind: 'canceled' });
        const request: RemoteEditReplacement = {
          ...input,
          sessionEpoch: runtimeRef.current.sessionEpochs[input.previous.source],
          ownsFocus,
          onReady: () => {
            void completeRemoteLift(request);
          },
          finish: (result) => {
            signal?.removeEventListener('abort', cancel);
            if (origin.kind === 'hydration') {
              if (result.kind === 'accepted') installRestoredEdit(origin.editing);
              if (result.kind === 'failed') {
                reportDraftRestorationFailure(result.cause);
                setError(errorMessage(result.cause));
              }
            } else if (result.kind === 'failed') {
              reject(result.cause);
              return;
            }
            resolve(result.kind === 'accepted');
          }
        };
        signal?.addEventListener('abort', cancel, { once: true });
        publishRemoteLift({ phase: 'awaiting-editor', request });
      });
    },
    [
      cancelRemoteLift,
      captureConfirmationFocus,
      completeRemoteLift,
      finishRemoteLift,
      installRestoredEdit,
      publishRemoteLift,
      reportDraftRestorationFailure,
      runtimeRef
    ]
  );
  const pageFocused = active && runtime.appActive;
  const sessionEpoch = source ? runtime.sessionEpochs[source] : 0;
  useEffect(() => {
    if (!remoteLift || !validateRemoteLift(remoteLift.request)) return;
    if (remoteLift.phase === 'awaiting-editor' && draft?.source === 'yaohuo') remoteLift.request.onReady();
  }, [draft, enabled, identityKey, pageFocused, remoteLift, sessionEpoch, target, validateRemoteLift]);
  const wasFocusedRef = useRef(pageFocused);
  const refocusReceiptRunRef = useRef(0);
  useEffect(() => {
    const regained = pageFocused && !wasFocusedRef.current;
    wasFocusedRef.current = pageFocused;
    if (!pageFocused) {
      refocusReceiptRunRef.current += 1;
      return;
    }
    if (!regained || loading || operationSubmitting()) return;
    const currentDraft = draftRef.current;
    if (
      !source ||
      !identityKey ||
      identityKey.endsWith(':anonymous') ||
      !currentDraft ||
      currentDraft.source !== source ||
      currentDraft.identityKey !== identityKey
    )
      return;
    const checkedSource = source;
    const checkedIdentityKey = identityKey;
    const checkedTarget = topicDraftTarget(currentDraft);
    const checkedDraftId = currentDraft.id;
    const runId = ++refocusReceiptRunRef.current;
    void readTopicSubmissionAttempt(checkedSource, checkedIdentityKey, checkedTarget)
      .then((persisted) => {
        if (
          !mounted.current ||
          refocusReceiptRunRef.current !== runId ||
          operationSubmitting() ||
          sourceRef.current !== checkedSource ||
          siteSessionIdentityKey(runtimeRef.current.sessions[checkedSource]) !== checkedIdentityKey
        )
          return;
        const liveDraft = draftRef.current;
        if (!liveDraft || liveDraft.id !== checkedDraftId || topicDraftTarget(liveDraft) !== checkedTarget) return;
        const currentAttempt = attemptRef.current;
        const currentUnresolved = currentAttempt?.status === 'sending' || currentAttempt?.status === 'unknown';
        const persistedUnresolved = persisted?.status === 'sending' || persisted?.status === 'unknown';
        const clearWait = () => {
          if (!currentUnresolved) return;
          const staleMessage = currentAttempt.result?.message;
          installAttempt(null);
          setError((previous) =>
            previous === '请先核对上次保存结果' || (staleMessage && previous === staleMessage) ? '' : previous
          );
          if (untouchedEditBaselineRef.current?.draftId === liveDraft.id) reloadContext();
        };
        if (persistedUnresolved) {
          if (
            currentAttempt?.id !== persisted.id ||
            currentAttempt.status !== persisted.status ||
            currentAttempt.result?.message !== persisted.result?.message
          )
            installAttempt(persisted);
          return;
        }
        if (!persisted) {
          clearWait();
          return;
        }
        if (persisted.draftId === liveDraft.id) {
          if (currentAttempt?.id === persisted.id && currentAttempt.status === persisted.status) return;
          if (
            persisted.status === 'saved' &&
            liveDraft.edit?.confirmedAttemptId === persisted.id &&
            persisted.revision !== liveDraft.revision
          ) {
            if (currentUnresolved) installAttempt(null);
            return;
          }
          if (
            persisted.status === 'partial' ||
            (persisted.status === 'saved' && persisted.revision !== liveDraft.revision)
          ) {
            const updated = applyTopicEditReceipt(liveDraft, persisted);
            if (updated !== liveDraft) installDraft(updated);
          }
          showReconciledAttempt(persisted);
          if (
            (persisted.status === 'posted' || persisted.status === 'enqueued') &&
            liveDraft.revision === persisted.revision
          ) {
            untouchedEditBaselineRef.current = null;
            retireDraft(liveDraft.id);
            installDraft(emptyTopicDraft(liveDraft.source, liveDraft.identityKey));
            markFreshDraft();
            setDraftSites((previous) => ({ ...previous, [liveDraft.source]: false }));
          }
          return;
        }
        clearWait();
      })
      .catch(() => undefined);
  }, [
    identityKey,
    installAttempt,
    installDraft,
    loading,
    markFreshDraft,
    operationSubmitting,
    pageFocused,
    reloadContext,
    retireDraft,
    runtimeRef,
    showReconciledAttempt,
    source,
    sourceRef
  ]);
  useEffect(() => {
    if (!draft || loading) return;
    const timer = setTimeout(() => {
      void persist(draft).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, loading, persist]);
  useEffect(() => {
    if (editTopicId || !source || !enabled || loading || draft?.source !== source) return;
    let alive = true;
    void saveLastTopicCreationSource(source).catch((cause) => {
      if (alive) setError(`无法保存上次使用的网站：${errorMessage(cause)}`);
    });
    return () => {
      alive = false;
    };
  }, [source, enabled, loading, draft?.source, editTopicId]);

  const waitForUploads = useCallback(async () => {
    const pending = getUploadJob(attachmentWork.current);
    if (!pending) return true;
    const choice = await new Promise<'wait' | 'cancel' | 'stay'>((resolve) =>
      Alert.alert(
        '上传尚未结束',
        '可以等待上传完成，或取消剩余上传后继续。已完成的上传和本地文件都会保留。',
        [
          { text: '留在此页', style: 'cancel', onPress: () => resolve('stay') },
          { text: '取消剩余上传', onPress: () => resolve('cancel') },
          { text: '等待上传完成', onPress: () => resolve('wait') }
        ],
        { cancelable: true, onDismiss: () => resolve('stay') }
      )
    );
    if (choice === 'stay') return false;
    if (choice === 'cancel') pending.abort.abort();
    await pending.promise;
    return true;
  }, []);
  const switchSource = useCallback(
    async (next: TopicCreationSource) => {
      if (editTopicId || next === source) return;
      const run = beginOperation('travel');
      if (!run) return;
      try {
        if (!(await waitForUploads())) return;
        await flush();
        setSource(next);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        releaseOperation(run);
      }
    },
    [flush, source, waitForUploads, editTopicId, beginOperation, releaseOperation]
  );
  const leave = useCallback(async () => {
    const run = beginOperation('travel');
    if (!run) {
      setError('正在保存或发布，请等待结果');
      return false;
    }
    try {
      if (!(await waitForUploads())) return false;
      await flush();
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof TopicDraftConflictError) {
        const conflictedDraft = draftRef.current;
        const discardLocal = await confirm(
          '其他页面已更新草稿',
          '本页修改尚未保存。返回将放弃本页修改，保留其他页面保存的草稿。',
          '放弃本页修改并返回',
          '继续编辑'
        );
        return discardLocal && draftRef.current === conflictedDraft;
      }
      return false;
    } finally {
      releaseOperation(run);
    }
  }, [flush, waitForUploads, beginOperation, releaseOperation]);

  const applyConfirmedEdit = useCallback(
    async (value: TopicDraft, receipt: TopicSubmissionAttempt) => {
      if (draftRef.current?.id === value.id) value = draftRef.current;
      const updated = applyTopicEditReceipt(value, receipt);
      if (updated === value) return value;
      // Install before awaiting disk so late editor snapshots build on this revision.
      if (draftRef.current?.id === value.id) installDraft(updated);
      await persist(updated);
      return updated;
    },
    [persist, installDraft]
  );

  const captureLinuxDoVerification = useCallback(() => {
    const ownsFocus = captureConfirmationFocus();
    const linuxDoEpoch = runtimeRef.current.sessionEpochs.linuxdo;
    return (value: TopicDraft, message: string, ticket?: WritableSessionTicket) => {
      const isCurrent = () => {
        if (
          value.source !== 'linuxdo' ||
          !ownsFocus() ||
          runtimeRef.current.sessionEpochs.linuxdo !== linuxDoEpoch ||
          !runtimeRef.current.sessions.linuxdo.canWrite
        )
          return false;
        try {
          assertOwner(value, ticket);
          return true;
        } catch {
          return false;
        }
      };
      if (isCurrent())
        void (async () => runtimeRef.current.openAccount('linuxdo', message, { kind: 'website', isCurrent }))().catch(
          () => undefined
        );
    };
  }, [assertOwner, captureConfirmationFocus, runtimeRef]);

  const submit = useCallback(async () => {
    if (getUploadJob(attachmentWork.current) || loading || currentRemoteLift.current) return;
    if (
      editTopicId &&
      (!editContext ||
        (attempt?.status === 'saved' &&
          attempt.draftId === draftRef.current?.id &&
          attempt.revision === draftRef.current.revision))
    )
      return;
    const run = beginOperation('submitting');
    if (!run) return;
    const showVerification = captureLinuxDoVerification();
    setError('');
    const dispatchState: RequestDispatchState = { mayHaveSent: false };
    let owner = editTopicId ? null : draftRef.current;
    let recorded: TopicSubmissionAttempt | undefined;
    let received: TopicSubmissionReceipt | undefined;
    try {
      let value = await flush();
      let editing = editTopicId ? editContext : null;
      if (editing) {
        owner = value;
        if (!value?.edit) return;
        const previous = await readTopicSubmissionAttempt(value.source, value.identityKey, topicDraftTarget(value));
        assertOwner(value);
        if (
          previous?.draftId === value.id &&
          previous.status === 'saved' &&
          previous.revision === draftRef.current?.revision
        ) {
          installAttempt(previous);
          return;
        }
        if (previous && previous.status !== 'sending' && previous.status !== 'unknown')
          value = await applyConfirmedEdit(value, previous);
        if (!value.edit) return;
        if (!hasTopicEditChanges(value)) {
          runtimeRef.current.notify('没有需要保存的修改');
          return;
        }
        if (previous?.status === 'unknown' || previous?.status === 'sending') {
          installAttempt(previous);
          throw new Error('请先核对上次保存结果');
        }
      }
      const rules = editing?.rules ?? context;
      if (!value || !rules || (!editing && rules.source !== value.source))
        throw new Error('请先加载当前站点的发帖设置');
      const validation = editing ? validateTopicEdit(value, editing) : validateTopicDraft(value, rules);
      const sendsBody = !editing || value.source !== 'linuxdo' || value.body !== value.edit?.original.body;
      const issue = sendsBody ? snapshotIssue(value.id) : undefined;
      if (issue) validation.body = issue;
      if (value.source === 'nodeseek' && !validation.body) {
        const memberId = runtimeRef.current.sessions.nodeseek.currentUser?.id;
        let markerIssue = firstNodeSeekStardustIssue(value.body, memberId);
        if (markerIssue) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Only load the parser for a possible blocker on submit.
          const code = require('@/domain/forum/markdownCode') as typeof import('@/domain/forum/markdownCode');
          const activeMarkdown = code.maskMarkdownCode(value.body);
          if (activeMarkdown !== value.body) markerIssue = firstNodeSeekStardustIssue(activeMarkdown, memberId);
        }
        if (markerIssue) validation.body = markerIssue;
      }
      setErrors(validation);
      if (Object.keys(validation).length) return;

      const access = await requestAccess(value, dispatchState);
      const sentDraft = value;
      const assertCurrent = () => {
        assertOwner(sentDraft, access.ticket);
        if (draftRef.current?.revision !== sentDraft.revision)
          throw new Error(editTopicId ? '草稿已更新，请确认后重试' : '草稿已更新，请确认最新内容后重新发布');
      };
      if (editing) {
        if (
          value.source === 'nodeseek' &&
          value.rank === 255 &&
          value.edit?.original.rank !== 255 &&
          !(await confirmOnCurrentRoute('改为私有帖子', '原站将收取 10 鸡腿。', '确认保存'))
        )
          return;
        if (
          value.additionalReward &&
          !(await confirmOnCurrentRoute('确认追加悬赏', `本次将追加 ${value.additionalReward} 妖晶。`, '确认保存'))
        )
          return;
        if (value.source === 'linuxdo' && value.edit) {
          assertCurrent();
          editing = await readEditContext(value.source, value.identityKey, value.edit.topicId);
        }
      } else {
        if (value.source === 'linuxdo') {
          const latestTags = await searchLinuxDoTopicTags({
            ...access,
            categoryId: value.categoryId,
            selectedTags: value.tags,
            query: ''
          });
          assertCurrent();
          if (latestTags.forbidden || latestTags.forbiddenMessage) {
            setErrors({ tags: latestTags.forbiddenMessage || `此标签不可使用：${latestTags.forbidden}` });
            return;
          }
          if (latestTags.requiredGroup) {
            setErrors({
              tags: `请从${latestTags.requiredGroup.name || '要求的标签组'}选择至少 ${latestTags.requiredGroup.minCount} 个标签`
            });
            return;
          }
        }
        if (
          value.source === 'nodeseek' &&
          value.categoryId === 'inside' &&
          !(await confirmOnCurrentRoute(
            '发布到内版',
            `本次发布将收取 ${rules.source === 'nodeseek' ? rules.insideFee : 5} 鸡腿。`,
            '确认发布'
          ))
        )
          return;
        if (value.source === 'yaohuo') {
          const amount =
            value.kind === 'gift'
              ? value.gift.total
              : value.kind === 'poll' && value.poll.giftEnabled
                ? value.poll.total
                : value.kind === 'normal'
                  ? value.reward
                  : '';
          if (
            amount &&
            !(await confirmOnCurrentRoute('确认发布金额', `本帖包含 ${amount} 妖晶的悬赏或派币设置。`, '确认发布'))
          )
            return;
        }
      }
      assertCurrent();
      const submission: TopicSubmissionAttempt = {
        id: identifier(),
        source: value.source,
        identityKey: value.identityKey,
        ...(editing ? { target: topicDraftTarget(value) } : {}),
        ...(editing && value.additionalReward ? { additionalReward: value.additionalReward } : {}),
        draftId: value.id,
        revision: value.revision,
        startedAt: Date.now(),
        status: 'sending'
      };
      await beginTopicSubmissionAttempt(submission);
      recorded = submission;
      installAttempt(submission);
      let body = value.body;
      if (value.source === 'nodeseek' && (!editing || value.pendingNodeSeekPolls.length)) {
        body = await materializePendingNodeSeekPolls({
          content: body,
          polls: value.pendingNodeSeekPolls,
          identityKey: value.identityKey,
          assertCurrent,
          confirmReplacement: () =>
            editing
              ? confirmOnCurrentRoute('投票已有创建记录', '修改后的投票会创建新对象，继续？', '继续保存')
              : confirmOnCurrentRoute('投票已有创建记录', '修改后的投票会创建一个新对象，继续？', '继续发布'),
          notify: runtimeRef.current.notify,
          createPoll: async (poll, options) => {
            const response = await runNodeSeekAction({
              fetcher: withRequestBeforeSend(access.accountFetcher, assertCurrent, options.dispatchState),
              userAgent: access.userAgent,
              request: buildNodeSeekPollCreateRequest({ poll })
            });
            await options.persistResult(response);
            assertCurrent();
            return response;
          }
        });
      }
      assertCurrent();
      const fetcher = withRequestBeforeSend(access.fetcher, assertCurrent);
      let acknowledged: TopicSubmissionAttempt = submission;
      let result: CreateTopicResult | TopicEditResult;
      if (editing) {
        const options = { draft: { ...value, body }, fetcher, userAgent: access.userAgent };
        result =
          value.source === 'nodeseek'
            ? await editNodeSeekTopic(options)
            : value.source === 'yaohuo'
              ? await editYaohuoTopic(options)
              : await editLinuxDoTopic({
                  ...options,
                  context: editing,
                  checkpoint: (fields) =>
                    checkpointTopicEdit(submission, fields, normalizedTopicEditInput(sentDraft, fields))
                });
        if (result.status === 'saved') {
          result = { ...result, confirmed: { ...topicEditChanges(options.draft), ...result.confirmed } };
        }
        acknowledged = { ...submission, normalizedFrom: normalizedTopicEditInput(value, result.confirmed) };
      } else {
        const options = { input: { draft: value, body }, fetcher, userAgent: access.userAgent };
        result =
          value.source === 'nodeseek'
            ? await createNodeSeekTopic(options)
            : value.source === 'linuxdo'
              ? await createLinuxDoTopic(options)
              : await createYaohuoTopic(options);
      }

      received = result;
      const receipt = topicSubmissionWithReceipt(acknowledged, result);
      const published = result.status === 'posted' || result.status === 'enqueued';
      if (published || result.status === 'saved') completedSubmission.current = receipt;
      if (!(await settleTopicSubmissionAttempt(acknowledged, result))) {
        showReconciledAttempt(await readReconciledAttempt(acknowledged));
        return;
      }
      if (published || result.status === 'saved') {
        const current = draftRef.current;
        if (current?.id === value.id ? current.revision === value.revision : published)
          await Promise.allSettled(value.attachments.map((file) => removeTopicDraftAttachmentFile(sentDraft, file)));
        if (draftRef.current?.id === value.id && draftRef.current.revision > value.revision) {
          if (editing) await applyConfirmedEdit(value, receipt);
          await flushDraft({ accept: acceptSnapshot });
        }
      } else if (editing) await applyConfirmedEdit(value, receipt);
      if (
        !mounted.current ||
        draftRef.current?.id !== value.id ||
        siteSessionIdentityKey(runtimeRef.current.sessions[value.source]) !== value.identityKey
      )
        return;
      installAttempt(receipt);
      if (result.status === 'saved') runtimeRef.current.notify(result.message);
      else if (published) {
        const canNavigate = activeRef.current && runtimeRef.current.enabledSources.includes(value.source);
        if (draftRef.current.revision === value.revision) {
          untouchedEditBaselineRef.current = null;
          retireDraft(value.id);
          if (!canNavigate) {
            installDraft(emptyTopicDraft(value.source, value.identityKey));
            markFreshDraft();
            setDraftSites((previous) => ({ ...previous, [value.source]: false }));
          }
        }
        if (!canNavigate) return;
        runtimeRef.current.notify(result.message);
        if (result.status === 'posted' && result.topic) onPosted(result.topic);
        else onAccepted();
      } else {
        setError(result.message);
        if ('verificationRequired' in result && result.verificationRequired) showVerification(value, result.message);
      }
    } catch (cause) {
      if (recorded) {
        showReconciledAttempt(await receiptAfterFailure(recorded, dispatchState.mayHaveSent, cause, received));
      } else if (
        mounted.current &&
        owner &&
        draftRef.current?.id === owner.id &&
        siteSessionIdentityKey(runtimeRef.current.sessions[owner.source]) === owner.identityKey
      )
        setError(errorMessage(cause));
      if (
        owner?.source === 'linuxdo' &&
        !received &&
        sourceErrorFromUnknown('linuxdo', cause).kind === 'verification-required'
      )
        showVerification(owner, errorMessage(cause));
    } finally {
      releaseOperation(run);
    }
  }, [
    loading,
    editTopicId,
    editContext,
    attempt,
    beginOperation,
    captureLinuxDoVerification,
    flush,
    applyConfirmedEdit,
    confirmOnCurrentRoute,
    context,
    snapshotIssue,
    requestAccess,
    assertOwner,
    readEditContext,
    runtimeRef,
    showReconciledAttempt,
    flushDraft,
    acceptSnapshot,
    activeRef,
    retireDraft,
    installAttempt,
    installDraft,
    markFreshDraft,
    onPosted,
    onAccepted,
    releaseOperation
  ]);

  const acknowledgeUnknown = useCallback(async () => {
    const ownsFocus = captureConfirmationFocus();
    if (
      !ownsFocus() ||
      operationSubmitting() ||
      !attempt ||
      !(await confirm(
        editTopicId ? '确认未保存的部分' : '确认没有发布成功',
        editTopicId
          ? '请在原站核对剩余修改和追加悬赏，确认未生效后才解除再次保存限制。已确认保存的字段不会重发。'
          : '请先在原站核对。确认未发布后，才解除本稿的再次发布限制。',
        editTopicId ? '已核对，未保存' : '已核对，未发布'
      ))
    )
      return;
    if (!ownsFocus()) return;
    const run = beginOperation('travel');
    if (!run) return;
    try {
      if (
        draftRef.current?.source !== attempt.source ||
        siteSessionIdentityKey(runtimeRef.current.sessions[attempt.source]) !== attempt.identityKey
      )
        throw new Error('站点或账号已变化，请重新核对当前草稿');
      if (editTopicId) {
        // Keep the durable checkpoint until its confirmed baseline is safely in the draft.
        const recorded = await readTopicSubmissionAttempt(attempt.source, attempt.identityKey, target);
        if (!ownsFocus()) return;
        if (recorded?.id !== attempt.id) throw new Error('保存记录已变化，请重新进入后核对');
        const value = await flush();
        if (!ownsFocus()) return;
        if (value?.id === recorded.draftId) await applyConfirmedEdit(value, recorded);
      }
      if (!ownsFocus()) return;
      if (
        draftRef.current?.source !== attempt.source ||
        siteSessionIdentityKey(runtimeRef.current.sessions[attempt.source]) !== attempt.identityKey
      )
        throw new Error('站点或账号已变化，请重新核对当前草稿');
      if (!(await acknowledgeTopicSubmissionAttempt(attempt.source, attempt.identityKey, attempt.id, target))) {
        showReconciledAttempt(await readReconciledAttempt(attempt));
        return;
      }
      if (
        !mounted.current ||
        draftRef.current?.source !== attempt.source ||
        siteSessionIdentityKey(runtimeRef.current.sessions[attempt.source]) !== attempt.identityKey
      )
        return;
      installAttempt(null);
      setError('');
      if (untouchedEditBaselineRef.current?.draftId === draftRef.current?.id) reloadContext();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      releaseOperation(run);
    }
  }, [
    attempt,
    captureConfirmationFocus,
    runtimeRef,
    editTopicId,
    target,
    flush,
    applyConfirmedEdit,
    operationSubmitting,
    beginOperation,
    installAttempt,
    showReconciledAttempt,
    reloadContext,
    releaseOperation
  ]);
  const discard = useCallback(async () => {
    const ownsFocus = captureConfirmationFocus();
    if (!ownsFocus() || getUploadJob(attachmentWork.current) || !draftRef.current) return;
    const owner = draftRef.current;
    const run = beginOperation('travel');
    if (!run) return;
    try {
      if (!(await confirm('丢弃当前草稿', '只删除当前站点当前账号的本机草稿。', '丢弃'))) return;
      if (!ownsFocus()) return;
      if (
        draftRef.current?.id !== owner.id ||
        siteSessionIdentityKey(runtimeRef.current.sessions[owner.source]) !== owner.identityKey
      )
        throw new Error('站点或账号已变化，请重新确认后重试');
      const value = await flush();
      if (!value || !ownsFocus()) return;
      if (
        hasSavedDraft(value.id) &&
        !(await discardTopicDraft(value.source, value.identityKey, value.id, value.revision, topicDraftTarget(value)))
      )
        throw new Error('草稿已更新，请重试');
      untouchedEditBaselineRef.current = null;
      cancelRemoteLift();
      retireDraft(value.id);
      if (draftRef.current?.id === value.id) {
        if (value.edit) {
          installDraft(null);
          onAccepted();
        } else installDraft(emptyTopicDraft(value.source, value.identityKey));
        markDraftDiscarded();
        setDraftSites((previous) => ({ ...previous, [value.source]: false }));
      }
      for (const file of value.attachments) await removeTopicDraftAttachmentFile(value, file);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      releaseOperation(run);
    }
  }, [
    beginOperation,
    captureConfirmationFocus,
    flush,
    hasSavedDraft,
    installDraft,
    markDraftDiscarded,
    onAccepted,
    cancelRemoteLift,
    releaseOperation,
    retireDraft,
    runtimeRef
  ]);

  const insertMarkup = useCallback(
    async (markup: string) => {
      if (draftRef.current?.source === 'yaohuo')
        change((value) => ({ ...value, body: `${value.body}${value.body ? '\n' : ''}${markup}` }));
      else {
        if (!editorRef.current) throw new Error('编辑器尚未就绪，请稍后插入');
        await editorRef.current.insertMarkup(markup);
      }
    },
    [change]
  );

  const uploadFiles = useCallback(
    (files: TopicDraftAttachment[], insert = true) => {
      if (getUploadJob(attachmentWork.current) || !operationIdle()) return Promise.resolve(undefined);
      const value = draftRef.current;
      if (!value || !context || context.source !== value.source) return Promise.resolve(undefined);
      if (value.edit && !editContext?.permissions.body) return Promise.resolve(undefined);
      const abort = new AbortController();
      const showVerification = captureLinuxDoVerification();
      const promise = (async () => {
        const markups: string[] = [];
        let pendingVerification: { message: string; ticket: WritableSessionTicket } | undefined;
        const updateFile = async (id: string, patch: Partial<TopicDraftAttachment>) => {
          const current = draftRef.current;
          if (!current || current.id !== value.id || current.identityKey !== value.identityKey)
            throw new Error('上传所属草稿已变化，请先核对上传结果');
          const next = {
            ...current,
            revision: current.revision + 1,
            updatedAt: Date.now(),
            attachments: current.attachments.map((file) => (file.id === id ? { ...file, ...patch } : file))
          };
          // Account restoration waits for this promise. Persist the original owner's confirmed
          // result even if its session was replaced or this screen has already unmounted.
          installDraft(next);
          await persist(next);
        };
        try {
          if (
            files.some(
              (file) => draftRef.current?.attachments.find((item) => item.id === file.id)?.status === 'unknown'
            ) &&
            !(await confirmOnCurrentRoute(
              '核对上次上传结果',
              '上次上传可能已被原站接收。请先核对上传记录；确认仍需上传后，会创建新的远端文件。',
              '已核对，重新上传'
            ))
          )
            return;
          setUploading(true);
          setError('');
          const access = await requestAccess(value);
          const apiKey = value.source === 'nodeseek' ? await runtimeRef.current.ensureNodeImageApiKey() : null;
          const generation = currentNodeImageApiKeyGeneration();
          if (value.source === 'nodeseek' && !apiKey) throw new Error('请到账号中心获取 NodeImage 授权');
          for (const file of files) {
            if (abort.signal.aborted) break;
            assertOwner(value, access.ticket);
            const currentFile = draftRef.current?.attachments.find((item) => item.id === file.id);
            if (!currentFile || currentFile.status === 'uploaded') continue;
            await updateFile(file.id, { status: 'uploading', error: undefined });
            const dispatchState: RequestDispatchState = { mayHaveSent: false };
            let uploadResponseStatus: number | undefined;
            let confirmedMarkup: string | undefined;
            let placeholder: { editor: StructuredReplyComposerHandle; id: string } | undefined;
            try {
              if (insert && value.source !== 'yaohuo') {
                const editor = editorRef.current;
                if (!editor) throw new Error('编辑器尚未就绪，请稍后上传');
                placeholder = { editor, id: await editor.beginImageUpload() };
                assertOwner(value, access.ticket);
              }
              const markup = await uploadTopicAttachment({
                source: value.source,
                file: currentFile,
                context,
                signal: abort.signal,
                userAgent: access.userAgent,
                fetcher: async (input, init) => {
                  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes((init?.method || 'GET').toUpperCase());
                  const response = await withRequestBeforeSend(
                    access.fetcher,
                    () => {
                      assertOwner(value, access.ticket);
                      if (value.source === 'nodeseek' && generation !== currentNodeImageApiKeyGeneration())
                        throw new Error('NodeImage 凭据已变化');
                    },
                    mutation ? dispatchState : undefined
                  )(input, init);
                  if (mutation) uploadResponseStatus = response.status;
                  return response;
                },
                ensureNodeImageApiKey: async () => apiKey
              });
              confirmedMarkup = markup;
              await updateFile(file.id, { status: 'uploaded', markup, error: undefined });
              assertOwner(value, access.ticket);
              if (insert && value.source === 'yaohuo') {
                const current = draftRef.current!;
                installDraft({
                  ...current,
                  body: `${current.body}${current.body ? '\n' : ''}${markup}`,
                  revision: current.revision + 1,
                  updatedAt: Date.now()
                });
              } else if (placeholder) {
                await placeholder.editor.finishImageUpload(placeholder.id, markup);
                placeholder = undefined;
              } else markups.push(markup);
              if (draftRef.current) await persist(draftRef.current);
            } catch (cause) {
              // Only an explicit request rejection confirms that an upload did not succeed.
              // Timeout/conflict responses, 5xx and a lost response still require reconciliation.
              const unknown = dispatchState.mayHaveSent && !isDefinitiveHttpRejection(uploadResponseStatus);
              const verificationRequired =
                !confirmedMarkup &&
                value.source === 'linuxdo' &&
                sourceErrorFromUnknown('linuxdo', cause).kind === 'verification-required';
              const message =
                verificationRequired && unknown
                  ? `${errorMessage(cause)}；上传结果未知，请先核对，勿重复上传`
                  : errorMessage(cause);
              if (!confirmedMarkup)
                await updateFile(file.id, {
                  status: unknown ? 'unknown' : abort.signal.aborted && !uploadResponseStatus ? 'queued' : 'failed',
                  error: unknown ? '上传结果未知，请先核对，勿重复上传' : errorMessage(cause)
                });
              if (
                mounted.current &&
                !abort.signal.aborted &&
                draftRef.current?.id === value.id &&
                siteSessionIdentityKey(runtimeRef.current.sessions[value.source]) === value.identityKey
              )
                setError(
                  confirmedMarkup
                    ? `${file.kind === 'image' ? '图片已上传，可在“更多 → 图片上传记录”中再次插入' : '附件已上传，可在附件面板中再次插入'}：${errorMessage(cause)}`
                    : message
                );
              if (verificationRequired && !abort.signal.aborted)
                pendingVerification = { message, ticket: access.ticket };
              break;
            } finally {
              // Only the captured editor owns this token; a restored draft must never receive it.
              if (placeholder) await placeholder.editor.finishImageUpload(placeholder.id).catch(() => undefined);
            }
          }
        } catch (cause) {
          if (
            mounted.current &&
            draftRef.current?.id === value.id &&
            siteSessionIdentityKey(runtimeRef.current.sessions[value.source]) === value.identityKey
          )
            setError(errorMessage(cause));
        } finally {
          attachmentWork.current = isPicking(attachmentWork.current) ? { kind: 'picking' } : { kind: 'idle' };
          if (mounted.current) setUploading(false);
        }
        if (pendingVerification && !abort.signal.aborted)
          showVerification(value, pendingVerification.message, pendingVerification.ticket);
        return markups.length ? markups.join('\n') : undefined;
      })();
      const upload = { abort, promise };
      attachmentWork.current = isPicking(attachmentWork.current)
        ? { kind: 'picking-upload', upload }
        : { kind: 'upload', upload };
      return promise;
    },
    [
      assertOwner,
      captureLinuxDoVerification,
      confirmOnCurrentRoute,
      context,
      installDraft,
      persist,
      requestAccess,
      runtimeRef,
      editContext,
      operationIdle
    ]
  );

  const pickAttachments = useCallback(
    async (kind: TopicDraftAttachment['kind'], hostInsert = false) => {
      if (!context || isPicking(attachmentWork.current) || !operationIdle() || getUploadJob(attachmentWork.current))
        return;
      attachmentWork.current = { kind: 'picking' };
      setError('');
      const rejected: string[] = [];
      try {
        const value = await flush();
        if (!value) return;
        if (value.edit && !editContext?.permissions.body) throw new Error('原站不允许编辑正文');
        const ticket = await runtimeRef.current.ensureWritableSession(value.source);
        assertOwner(value, ticket);
        const limits =
          kind === 'yaohuo-file'
            ? {
                ...yaohuoFileBytePolicy,
                maxFiles: Math.max(0, 9 - value.attachments.filter((file) => file.kind === kind).length),
                maxFilesMessage: '文件帖最多选择 9 个文件'
              }
            : {
                maxBytes:
                  context.source === 'linuxdo'
                    ? kind === 'image'
                      ? context.maxImageBytes
                      : context.maxAttachmentBytes
                    : MAX_REPLY_IMAGE_UPLOAD_BYTES
              };
        return await withPickedAttachmentCopies(
          { type: kind === 'image' ? 'image/*' : '*/*', multiple: true, ...limits },
          async (selected) => {
            assertLocalOwner(value, ticket);
            if (selected.canceled) return;
            if (!operationIdle()) throw new Error('正在保存或发布，请稍后重新选择文件');
            if (
              kind === 'yaohuo-file' &&
              value.attachments.filter((file) => file.kind === kind).length + selected.assets.length > 9
            )
              throw new Error('文件帖最多选择 9 个文件');
            const added: TopicDraftAttachment[] = [];
            for (const asset of selected.assets) {
              let file: TopicDraftAttachment | undefined;
              try {
                const normalizedAsset =
                  kind === 'image' && !asset.mimeType
                    ? { ...asset, mimeType: normalizeReplyImageAsset({ uri: asset.uri, name: asset.name }).mimeType }
                    : asset;
                const size = Math.max(
                  normalizedAsset.size ?? 0,
                  knownTopicDraftAttachmentSize(normalizedAsset.uri) ?? 0
                );
                if (size > 0)
                  validateTopicAttachment(
                    {
                      ...normalizedAsset,
                      kind,
                      mimeType: normalizedAsset.mimeType || 'application/octet-stream',
                      size
                    },
                    context
                  );
                file = await persistTopicDraftAttachment({ draft: value, asset: normalizedAsset, kind });
                validateTopicAttachment(file, context);
                if (kind === 'yaohuo-file' && ['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimeType))
                  await Image.getSize(file.uri);
              } catch (cause) {
                if (file) await removeTopicDraftAttachmentFile(value, file);
                rejected.push(`${asset.name}：${errorMessage(cause)}`);
                continue;
              }
              const accepted = file;
              try {
                assertLocalOwner(value, ticket);
                if (!operationIdle()) throw new Error('正在保存或发布，请稍后重新选择文件');
                added.push(accepted);
                change((current) => ({ ...current, attachments: [...current.attachments, accepted] }));
              } catch (cause) {
                await removeTopicDraftAttachmentFile(value, accepted);
                throw cause;
              }
            }
            if (draftRef.current) await persist(draftRef.current);
            assertLocalOwner(value, ticket);
            if (kind !== 'yaohuo-file' && added.length) {
              assertOwner(value, ticket);
              return await uploadFiles(added, !hostInsert);
            }
          }
        );
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        const upload = getUploadJob(attachmentWork.current);
        attachmentWork.current = upload ? { kind: 'upload', upload } : { kind: 'idle' };
        if (rejected.length) setError((current) => [rejected.join('\n'), current].filter(Boolean).join('\n'));
      }
    },
    [
      assertLocalOwner,
      assertOwner,
      change,
      context,
      flush,
      persist,
      runtimeRef,
      uploadFiles,
      editContext,
      operationIdle
    ]
  );

  const removeAttachment = useCallback(
    async (file: TopicDraftAttachment) => {
      const value = draftRef.current;
      if (!value || isPicking(attachmentWork.current) || getUploadJob(attachmentWork.current) || !operationIdle())
        return;
      change((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== file.id) }));
      try {
        if (draftRef.current) await persist(draftRef.current);
        await removeTopicDraftAttachmentFile(value, file);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    [change, persist, operationIdle]
  );

  const searchTags = useCallback(
    async (query: string, signal = new AbortController().signal) => {
      const value = draftRef.current;
      if (!value || value.source !== 'linuxdo' || !value.categoryId || signal.aborted) return;
      try {
        const found = await readWithVerification(
          value,
          signal,
          ['tags', value.categoryId, value.tags, query],
          async () => {
            const access = await requestAccess(value);
            const result = await searchLinuxDoTopicTags({
              ...access,
              signal,
              categoryId: value.categoryId,
              selectedTags: value.tags,
              query
            });
            assertOwner(value, access.ticket);
            return result;
          }
        );
        if (!signal.aborted) return found;
      } catch (cause) {
        if (signal.aborted) return;
        try {
          assertOwner(value);
        } catch {
          return;
        }
        throw cause;
      }
    },
    [assertOwner, requestAccess, readWithVerification]
  );

  const runLinuxDoEditorService = async <T>(
    run: (access: Awaited<ReturnType<typeof requestAccess>>) => Promise<T>,
    unavailable = '当前站点不支持模板'
  ) => {
    const value = draftRef.current;
    if (!value || value.source !== 'linuxdo') throw new Error(unavailable);
    const showVerification = captureLinuxDoVerification();
    const access = await requestAccess(value);
    try {
      return await run(access);
    } catch (cause) {
      if (sourceErrorFromUnknown('linuxdo', cause).kind === 'verification-required')
        showVerification(value, errorMessage(cause), access.ticket);
      throw cause;
    }
  };
  const editorServices = {
    useTemplate: (id: string) => runLinuxDoEditorService((access) => recordLinuxDoTemplateUse({ ...access, id })),
    loadTemplates: () => runLinuxDoEditorService(fetchLinuxDoTemplates),
    resolveUpload: (shortUrl: string) =>
      runLinuxDoEditorService((access) => resolveLinuxDoUpload({ ...access, shortUrl }), '当前站点不支持该附件')
  };
  const replacementDocument: Pick<RemoteEditReplacement, 'draft' | 'onReady'> | undefined = remoteLift?.request;
  return {
    editing: Boolean(editTopicId),
    editContext,
    hasChanges: draft ? hasTopicEditChanges(draft) : false,
    source,
    draft,
    context,
    loading,
    contextLoading,
    busy,
    uploading,
    error,
    contextError: contextFailure.kind === 'none' ? '' : contextFailure.message,
    contextNeedsVerification: contextFailure.kind === 'verification',
    errors,
    saveStatus,
    attempt,
    draftSites,
    emojiUrls,
    editorRef,
    replacementDocument,
    enabled,
    session,
    change,
    acceptSnapshot,
    flush,
    switchSource,
    leave,
    submit,
    discard,
    acknowledgeUnknown,
    searchTags,
    pickAttachments,
    uploadFiles,
    removeAttachment,
    insertMarkup,
    editorServices,
    reloadContext,
    retryDraft,
    recoverInitialEditRead,
    reviewLatest: async () => {
      try {
        const value = await flush();
        if (!value?.edit) return;
        const fresh = await readEditContext(value.source, value.identityKey, value.edit.topicId);
        assertOwner(value);
        reviewEditContext(fresh);
        return fresh.original;
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    rebaseEdit: async () => {
      if (!editContext || attempt?.status === 'unknown' || attempt?.status === 'sending') return false;
      const run = beginOperation('rebasing');
      if (!run) return false;
      try {
        const value = await flush();
        if (!value?.edit) return false;
        if (
          !(await confirmOnCurrentRoute(
            '保留本机修改继续',
            '已核对原站最新内容。继续后，下次保存将以最新内容为基准提交你的修改。',
            '继续编辑'
          ))
        )
          return false;
        assertOwner(value);
        const current = draftRef.current;
        if (!current?.edit) return false;
        const updated = {
          ...current,
          ...editContext.original,
          ...topicEditChanges(current),
          edit: { ...current.edit, original: editContext.original },
          revision: current.revision + 1,
          updatedAt: Date.now()
        } as TopicDraft;
        installDraft(updated);
        try {
          await persist(updated);
        } catch (cause) {
          if (draftRef.current === updated) installDraft(current);
          throw cause;
        }
        assertOwner(updated);
        setError('');
        return true;
      } catch (cause) {
        setError(errorMessage(cause));
        return false;
      } finally {
        releaseOperation(run);
      }
    },
    changeCategory: async (categoryId: string) => {
      if (!context || operationSubmitting()) return;
      const request = beginCategoryChange();
      if (draftRef.current?.categoryId === categoryId) return;
      const before = draftRef.current;
      try {
        await flush();
        if (!ownsCategoryChange(request, before?.id)) return;
        change((value) => (value.edit ? { ...value, categoryId } : applyTopicCategory(value, categoryId, context)));
      } catch (cause) {
        setError(errorMessage(cause));
      }
    }
  };
}
